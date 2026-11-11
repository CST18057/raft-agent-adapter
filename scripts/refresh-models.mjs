// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { Rpc, initializeParams } from '../src/rpc.mjs';
import { option, thinkingInfo, catalogKey } from '../src/model-config.mjs';
import { loadConfig, localDir } from '../src/config.mjs';
import { backends, initializeCacheKey, writeInitializeCache } from '../src/backends.mjs';

const config = loadConfig();
const backend = backends[config.backendId];
const env = { ...process.env };
if (config.proxyUrl) for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) env[key] = config.proxyUrl;
const rpc = new Rpc(config.spawn.command, config.spawn.args, { env });
let sessionId;
try {
  const initialized = await rpc.request('initialize', initializeParams);
  const opened = await rpc.request('session/new', { cwd: process.cwd(), mcpServers: [] });
  sessionId = opened.sessionId;
  const models = backend.modelEntries(opened, option);
  const catalog = { schema: 1, generatedAt: new Date().toISOString(), backend: backend.id, key: catalogKey(config.executable, option(opened, 'model')?.options ?? []), models: {} };
  for (const [i, model] of models.entries()) {
    const selected = await rpc.request('session/set_config_option', { sessionId, configId: 'model', value: model.value });
    if (option(selected, 'model')?.currentValue !== model.value) throw new Error(`${backend.displayName} did not confirm the selected model.`);
    catalog.models[model.value] = thinkingInfo(selected, backend.thinkingConfigId);
    if ((i + 1) % 20 === 0) console.log(`Read thinking options for ${i + 1}/${models.length} models`);
  }
  try {
    writeInitializeCache(localDir(), backend.id, initializeCacheKey(config), { initialize: initialized, configOptions: opened.configOptions });
  } catch (error) {
    console.error(`[raft-agent-adapter] Cannot cache initialize state: ${error.message}`);
  }
  fs.mkdirSync(path.dirname(config.catalogPath), { recursive: true });
  fs.writeFileSync(config.catalogPath + '.tmp', JSON.stringify(catalog, null, 2));
  fs.renameSync(config.catalogPath + '.tmp', config.catalogPath);
  console.log(JSON.stringify({ passed: true, backend: backend.id, modelCount: models.length }));
} finally {
  if (sessionId) for (const method of backend.closeMethods) {
    if (await rpc.request(method, { sessionId }, 10000).then(() => true, () => false)) break;
  }
  await rpc.close();
}
