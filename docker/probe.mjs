// SPDX-License-Identifier: MIT
// End-to-end probe: drives the adapter through the same ACP sequence Raft's
// daemon uses for its Grok Build slot (agent --no-leader --always-approve
// stdio -> initialize -> session/new|load -> set_model -> delete).
// Never submits an inference prompt. Set DEVIN_API_KEY to authenticate first.
import assert from 'node:assert/strict';
import { Rpc, initializeParams } from '../src/rpc.mjs';
import { launcherPath } from '../src/config.mjs';
import { option } from '../src/model-config.mjs';

const viaPath = process.argv.includes('--via-path');
const expectModels = process.argv.includes('--expect-models');
const args = ['agent', '--no-leader', '--always-approve', 'stdio'];

const rpc = new Rpc(viaPath ? 'grok' : launcherPath, args);
let sessionId;
const report = { passed: true };
try {
  const init = await rpc.request('initialize', initializeParams);
  assert.equal(init.protocolVersion, 1);
  assert.equal(init.agentCapabilities?.loadSession, true);
  const backend = init._meta?.['raft-agent-adapter']?.backend;
  const thinkingId = backend === 'dsh' ? 'reasoning_effort' : 'thought_level';
  if (backend !== 'dsh') assert.equal(init.agentCapabilities?._meta?.['cognition.ai/midTurnPrompts'], true);
  const models = init._meta?.modelState?.availableModels ?? [];
  if (expectModels) assert.ok(models.length > 0, 'expected a non-empty model list');
  report.models = models.length;

  if (process.env.DEVIN_API_KEY) {
    await rpc.request('authenticate', { methodId: 'devin-browser', _meta: { api_key: process.env.DEVIN_API_KEY } });
    report.authenticated = true;
  }

  const opened = await rpc.request('session/new', { cwd: process.cwd(), mcpServers: [] });
  sessionId = opened.sessionId;
  assert.ok(sessionId, 'session/new returned no sessionId');
  report.session = sessionId;

  const current = models.find(m => m.modelId === init._meta.modelState.currentModelId) ?? models[0];
  if (current) {
    const effort = current._meta?.reasoningEfforts?.at(-1);
    const selected = await rpc.request('session/set_model', {
      sessionId, modelId: current.modelId,
      ...(effort ? { _meta: { reasoningEffort: effort } } : {})
    });
    report.model = option(selected, 'model')?.currentValue;
    report.thoughtLevel = option(selected, thinkingId)?.currentValue;
  }

  const loaded = await rpc.request('session/load', { sessionId, cwd: process.cwd(), mcpServers: [] });
  assert.equal(loaded.sessionId ?? sessionId, sessionId);
  report.resumed = true;

  await rpc.request('session/delete', { sessionId });
  report.deleted = true;
} finally {
  await rpc.close();
}
console.log(JSON.stringify(report, null, 2));
