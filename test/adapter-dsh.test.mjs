// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Rpc, initializeParams } from '../src/rpc.mjs';
import { projectRoot } from '../src/config.mjs';
import { option } from '../src/model-config.mjs';

async function fixture(t, extraEnv = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-dsh-test-'));
  const configFile = path.join(temp, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({
    backend: 'dsh',
    dshExe: process.execPath,
    dshArgs: [path.join(projectRoot, 'test/fake-dsh.mjs')]
  }));
  const env = {
    ...process.env,
    RAFT_ADAPTER_CONFIG: configFile,
    RAFT_ADAPTER_LOCAL: temp,
    MOCK_STATE_FILE: path.join(temp, 'sessions.json'),
    ...extraEnv
  };
  const start = () => new Rpc(process.execPath, [path.join(projectRoot, 'src/adapter.mjs'), 'agent', 'stdio'], { cwd: temp, env });
  const clients = [];
  const open = () => { const rpc = start(); clients.push(rpc); return rpc; };
  t.after(async () => { for (const rpc of clients) await rpc.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  const rpc = open();
  const calls = () => JSON.parse(fs.readFileSync(path.join(temp, 'sessions.json'), 'utf8')).calls;
  return { rpc, open, temp, calls };
}

test('handshake flattens grouped dsh models and claims loadSession', async t => {
  const { rpc } = await fixture(t);
  const init = await rpc.request('initialize', initializeParams);
  assert.equal(init.protocolVersion, 1);
  assert.equal(init.agentCapabilities.loadSession, true); // injected: session/load maps to session/resume
  assert.equal(init._meta['raft-agent-adapter'].backend, 'dsh');
  const models = init._meta.modelState.availableModels;
  assert.deepEqual(models.map(m => m.modelId), ['dsh:["mock","plain"]', 'dsh:["mock","pro"]']);
  assert.equal(models[0].name, 'DSH · Plain');
  assert.equal(init._meta.modelState.currentModelId, 'dsh:["mock","plain"]');
  assert.deepEqual(models[0]._meta.reasoningEfforts, ['low', 'medium', 'high']); // the '' provider-default option is filtered
});

test('set_model maps to set_config_option and validates reasoning effort', async t => {
  const { rpc } = await fixture(t);
  await rpc.request('initialize', initializeParams);
  const session = await rpc.request('session/new', { cwd: process.cwd(), mcpServers: [] });
  const select = (modelId, effort) => rpc.request('session/set_model', { sessionId: session.sessionId, modelId, ...(effort ? { _meta: { reasoningEffort: effort } } : {}) });
  const pro = await select('dsh:["mock","pro"]', 'max');
  assert.equal(option(pro, 'model').currentValue, '["mock","pro"]');
  assert.equal(option(pro, 'reasoning_effort').currentValue, 'max');
  await assert.rejects(select('dsh:["mock","pro"]', 'low'), /Available: medium, high, max/);
  await assert.rejects(select('devin:swe-2-high', 'high'), /different adapter backend.*current: DSH/);
});

test('session/load resumes and missing sessions return Raft-recoverable errors', async t => {
  const { rpc, open, temp } = await fixture(t);
  await rpc.request('initialize', initializeParams);
  const { sessionId } = await rpc.request('session/new', { cwd: temp, mcpServers: [] });
  await rpc.close();
  const resumed = open();
  await resumed.request('initialize', initializeParams);
  const loaded = await resumed.request('session/load', { sessionId, cwd: temp, mcpServers: [] });
  assert.equal(loaded.sessionId, sessionId);
  // Raft only auto-recovers to a fresh session when the error text matches
  // /(path|session).*(not found|missing)/i — assert the contract directly.
  await assert.rejects(
    resumed.request('session/load', { sessionId: 'foreign-session-id', cwd: temp, mcpServers: [] }),
    /\b(session|path)\b.*\b(not found|missing)\b/i
  );
});

test('interject during a busy turn is deferred and delivered as the next prompt', async t => {
  const { rpc, calls } = await fixture(t);
  await rpc.request('initialize', initializeParams);
  const { sessionId } = await rpc.request('session/new', { cwd: process.cwd(), mcpServers: [] });
  const primary = rpc.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'base-held' }] });
  const interject = await rpc.request('_x.ai/interject', { sessionId, text: 'injected-followup', interjectionId: 'i1' });
  assert.equal(interject.accepted, true);
  await primary;
  await new Promise(resolve => setTimeout(resolve, 100));
  const entries = calls().filter(c => c.method === 'prompt-received' || c.method === 'prompt-settled');
  const baseSettled = entries.findIndex(c => c.method === 'prompt-settled' && c.text === 'base-held');
  const injectedReceived = entries.findIndex(c => c.method === 'prompt-received' && c.text === 'injected-followup');
  assert.ok(baseSettled >= 0 && injectedReceived > baseSettled, `expected deferred delivery after settle, got ${JSON.stringify(entries)}`);
});

test('a cached handshake resumes the primed session instead of starting dsh again', async t => {
  const { rpc, open, calls, temp } = await fixture(t);
  await rpc.request('initialize', initializeParams);
  await rpc.close();
  const second = open();
  await second.request('initialize', initializeParams);
  // The second handshake is answered from initialize-cache.json; no backend.
  assert.equal(calls().filter(c => c.method === 'initialize').length, 1);
  await second.request('session/new', { cwd: temp, mcpServers: [] });
  const news = calls().filter(c => c.method === 'session/new');
  const resumes = calls().filter(c => c.method === 'session/resume');
  assert.equal(news.length, 1, `expected one persistent primed session, got ${JSON.stringify(news)}`);
  assert.equal(resumes.length, 1);
  assert.equal(resumes[0].sessionId, 'dsh-fixture-1');
});

test('session/delete maps to the dsh close surface', async t => {
  const { rpc, calls } = await fixture(t);
  await rpc.request('initialize', initializeParams);
  const { sessionId } = await rpc.request('session/new', { cwd: process.cwd(), mcpServers: [] });
  await rpc.request('session/delete', { sessionId });
  const closeCalls = calls().filter(c => c.method === 'session/close' && c.sessionId === sessionId);
  assert.equal(closeCalls.length, 1);
});

test('authenticate drops the cached handshake so the next probe re-reads the backend', async t => {
  const { rpc, open, calls } = await fixture(t);
  await rpc.request('initialize', initializeParams);
  await rpc.close();
  const second = open();
  await second.request('initialize', initializeParams);
  // Cache hit: still only the first process's backend initialize.
  assert.equal(calls().filter(c => c.method === 'initialize').length, 1);
  await second.request('authenticate', { methodId: 'browser' });
  // authenticate starts the backend (initialize #2) and invalidates the cache.
  assert.equal(calls().filter(c => c.method === 'initialize').length, 2);
  const third = open();
  await third.request('initialize', initializeParams);
  // The invalidated entry forces a live handshake (initialize #3).
  assert.equal(calls().filter(c => c.method === 'initialize').length, 3);
});

test('a model without reasoning support rejects effort with a clear error', async t => {
  const { rpc } = await fixture(t, { MOCK_BARE_MODEL: '1' });
  await rpc.request('initialize', initializeParams);
  const { sessionId } = await rpc.request('session/new', { cwd: process.cwd(), mcpServers: [] });
  await rpc.request('session/set_model', { sessionId, modelId: 'dsh:["mock","bare"]' });
  await assert.rejects(
    rpc.request('session/set_model', { sessionId, modelId: 'dsh:["mock","bare"]', _meta: { reasoningEffort: 'high' } }),
    /no reasoning effort control/
  );
});
