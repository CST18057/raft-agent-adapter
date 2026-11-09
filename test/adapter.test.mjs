// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Rpc, initializeParams } from '../src/rpc.mjs';
import { projectRoot } from '../src/config.mjs';
import { option, reasoningMeta, catalogKey } from '../src/model-config.mjs';

async function fixture(t, extraEnv = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-devin-test-'));
  const configFile = path.join(temp, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({ devinExe: process.execPath, devinArgs: [path.join(projectRoot, 'test/fake-devin.mjs')] }));
  const env = { ...process.env, DEVIN_EXE: process.execPath, DEVIN_ADAPTER_CONFIG: configFile, MOCK_STATE_FILE: path.join(temp, 'sessions.json'), ...extraEnv };
  const start = () => new Rpc(process.execPath, [path.join(projectRoot, 'src/adapter.mjs'), 'agent', 'stdio'], { cwd: temp, env });
  const clients = [];
  const open = () => { const rpc = start(); clients.push(rpc); return rpc; };
  t.after(async () => { for (const rpc of clients) await rpc.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  const rpc = open();
  return { rpc, open, temp };
}

test('version and help work before Devin or local configuration is installed', () => {
  for (const arg of ['--version', '--help']) {
    const output = execFileSync(process.execPath, [path.join(projectRoot, 'src/adapter.mjs'), arg], { encoding: 'utf8', env: { ...process.env, DEVIN_ADAPTER_CONFIG: 'missing.json' } });
    assert.match(output, /adapter/i);
  }
});

test('reasoning metadata preserves native defaults and filters unsupported Raft vocabulary', () => {
  assert.deepEqual(reasoningMeta({ efforts: ['none', 'low', 'xhigh'], defaultEffort: 'none' }), { reasoningEfforts: ['low', 'xhigh'] });
  assert.notEqual(catalogKey(process.execPath, [{ value: 'one' }]), catalogKey(process.execPath, [{ value: 'two' }]));
});

test('handshake exposes SWE-2 thinking and selection returns the applied Max configuration', async t => {
  const { rpc } = await fixture(t);
  const init = await rpc.request('initialize', initializeParams);
  const swe = init._meta.modelState.availableModels[0];
  assert.deepEqual(swe._meta.reasoningEfforts, ['medium', 'high', 'max']);
  assert.equal(swe._meta.reasoningEffort, 'high');
  const session = await rpc.request('session/new', { cwd: process.cwd(), mcpServers: [] });
  const select = (modelId, effort) => rpc.request('session/set_model', { sessionId: session.sessionId, modelId, ...(effort ? { _meta: { reasoningEffort: effort } } : {}) });
  const max = await select(swe.modelId, 'max');
  assert.equal(option(max, 'model').currentValue, 'swe-2-high');
  assert.equal(option(max, 'thought_level').currentValue, 'max');
  await assert.rejects(select(swe.modelId, 'low'), /Available: medium, high, max/);
  assert.equal(option(await select(swe.modelId), 'thought_level').currentValue, 'high');
  assert.equal(option(await select('devin:gpt-lite-none'), 'thought_level').currentValue, 'none');
  assert.equal(option(await select('devin:gpt-lite-none', 'xhigh'), 'thought_level').currentValue, 'xhigh');
  await assert.rejects(select('grok-model', 'high'), /Select a Devin model/);
  await assert.rejects(rpc.request('unsupported/extension', {}), /Unsupported Raft\/Grok extension/);
  await rpc.request('session/delete', { sessionId: session.sessionId });
  await assert.rejects(rpc.request('session/prompt', { sessionId: session.sessionId, prompt: [] }), /Session not opened/);
});

test('host instructions appear once and injected work completes before the primary turn ends', async t => {
  const { rpc } = await fixture(t);
  await rpc.request('initialize', initializeParams);
  const { sessionId } = await rpc.request('session/new', { cwd: process.cwd(), mcpServers: [], _meta: { systemPromptOverride: 'ROLE_MARKER' } });
  let injectionDone = false;
  const base = rpc.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'base-held' }] });
  const injected = rpc.request('_x.ai/interject', { sessionId, text: 'injected-held', interjectionId: 'injection-1' }).then(value => { injectionDone = true; return value; });
  const primary = await base;
  assert.equal(injectionDone, true);
  assert.deepEqual(primary._meta.usage, { inputTokens: 1, outputTokens: 2 });
  assert.equal((await injected).accepted, true);
  const texts = rpc.notifications.map(note => note.params?.update?.content?.text || '').join('\n');
  assert.equal(texts.split('ROLE_MARKER').length - 1, 1);
  assert.match(texts, /base-held/); assert.match(texts, /injected-held/);
});

test('permission requests reach the host and session-load history is suppressed', async t => {
  const { rpc, open, temp } = await fixture(t);
  await rpc.request('initialize', initializeParams);
  const { sessionId } = await rpc.request('session/new', { cwd: temp, mcpServers: [] });
  let permissionRequests = 0;
  rpc.onRequest = message => { assert.equal(message.method, 'session/request_permission'); permissionRequests++; return { outcome: { outcome: 'selected', optionId: 'once' } }; };
  await rpc.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'permission-test' }] });
  assert.equal(permissionRequests, 1);
  await rpc.close();
  const resumed = open();
  await resumed.request('initialize', initializeParams);
  const loaded = await resumed.request('session/load', { sessionId, cwd: temp, mcpServers: [] });
  assert.equal(loaded.sessionId, sessionId);
  assert.ok(!resumed.notifications.some(note => JSON.stringify(note).includes('HISTORY_REPLAY')));
});

test('authenticate is forwarded and drops the unauthenticated primed session', async t => {
  const { rpc } = await fixture(t);
  await rpc.request('initialize', initializeParams);   // primes fixture-1 internally
  await rpc.request('authenticate', { methodId: 'devin-browser', _meta: { api_key: 'probe' } });
  const fresh = await rpc.request('session/new', { cwd: process.cwd(), mcpServers: [] });
  assert.equal(fresh.sessionId, 'fixture-2'); // not the released primed session
  await rpc.request('session/delete', { sessionId: fresh.sessionId });
});

test('missing mid-turn capability fails initialization explicitly', async t => {
  const { rpc } = await fixture(t, { MOCK_NO_MID_TURN: '1' });
  await assert.rejects(rpc.request('initialize', initializeParams), /required session resume or mid-turn/);
});
