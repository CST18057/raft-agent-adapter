// SPDX-License-Identifier: MIT
// Explicit opt-in: real Devin configuration calls, without a model prompt.
import assert from 'node:assert/strict';
import path from 'node:path';
import { Rpc, initializeParams } from '../src/rpc.mjs';
import { projectRoot, launcherPath } from '../src/config.mjs';
import { option } from '../src/model-config.mjs';

const launcher = process.argv.includes('--launcher');
const rpc = new Rpc(launcher ? launcherPath : process.execPath,
  [...(launcher ? [] : [path.join(projectRoot, 'src/adapter.mjs')]), 'agent', 'stdio']);
let sessionId;
try {
  const init = await rpc.request('initialize', initializeParams);
  const swe = init._meta.modelState.availableModels.find(model => model.modelId === 'devin:swe-2-high');
  assert.ok(swe?._meta.reasoningEfforts.includes('max'), 'Refresh-Models.ps1 should expose SWE-2 Max');
  const opened = await rpc.request('session/new', { cwd: process.cwd(), mcpServers: [] });
  sessionId = opened.sessionId;
  const select = effort => rpc.request('session/set_model', { sessionId: opened.sessionId, modelId: swe.modelId, ...(effort ? { _meta: { reasoningEffort: effort } } : {}) });
  const max = await select('max');
  assert.equal(option(max, 'thought_level').currentValue, 'max');
  await assert.rejects(select('low'), /does not offer/);
  const defaults = await select();
  assert.equal(option(defaults, 'thought_level').currentValue, 'high');
  console.log(JSON.stringify({ passed: true, swe2Max: true, unsupportedLowRejected: true, defaultHigh: true, modelInference: false }));
} finally {
  if (sessionId) await rpc.request('session/delete', { sessionId }).catch(() => {});
  await rpc.close();
}
