// SPDX-License-Identifier: MIT
import path from 'node:path';
import assert from 'node:assert/strict';
import { Rpc, initializeParams } from '../src/rpc.mjs';
import { projectRoot, launcherPath } from '../src/config.mjs';

const launcher = process.argv.includes('--launcher');
const rpc = new Rpc(launcher ? launcherPath : process.execPath,
  [...(launcher ? [] : [path.join(projectRoot, 'src/adapter.mjs')]), 'agent', 'stdio']);
try {
  const init = await rpc.request('initialize', initializeParams);
  assert.equal(init.protocolVersion, 1);
  assert.equal(init.agentCapabilities?.loadSession, true);
  const models = init._meta?.modelState?.availableModels ?? [];
  assert.ok(models.length > 0, 'No models returned');
  console.log(JSON.stringify({ passed: true, modelCount: models.length, defaultModel: init._meta.modelState.currentModelId, modelInference: false }));
} finally { await rpc.close(); }
