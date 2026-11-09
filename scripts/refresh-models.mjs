// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { Rpc, initializeParams } from '../src/rpc.mjs';
import { option, thinkingInfo, catalogKey } from '../src/model-config.mjs';
import { loadConfig } from '../src/config.mjs';

const config = loadConfig();
const env = { ...process.env };
if (config.proxyUrl) for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) env[key] = config.proxyUrl;
const rpc = new Rpc(config.devinExe, config.devinArgs, { env });
let sessionId;
try {
  await rpc.request('initialize', initializeParams);
  const opened = await rpc.request('session/new', { cwd: process.cwd(), mcpServers: [] });
  sessionId = opened.sessionId;
  const models = option(opened, 'model').options;
  const catalog = { schema: 1, generatedAt: new Date().toISOString(), key: catalogKey(config.devinExe, models), models: {} };
  for (const [i, model] of models.entries()) {
    const selected = await rpc.request('session/set_config_option', { sessionId, configId: 'model', value: model.value });
    if (option(selected, 'model')?.currentValue !== model.value) throw new Error('Devin did not confirm the selected model.');
    catalog.models[model.value] = thinkingInfo(selected);
    if ((i + 1) % 20 === 0) console.log(`Read thinking options for ${i + 1}/${models.length} models`);
  }
  fs.mkdirSync(path.dirname(config.catalogPath), { recursive: true });
  fs.writeFileSync(config.catalogPath + '.tmp', JSON.stringify(catalog, null, 2));
  fs.renameSync(config.catalogPath + '.tmp', config.catalogPath);
  console.log(JSON.stringify({ passed: true, modelCount: models.length }));
} finally {
  if (sessionId) await rpc.request('session/delete', { sessionId }).catch(() => {});
  await rpc.close();
}
