// SPDX-License-Identifier: MIT
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Rpc } from './rpc.mjs';
import { option, thinkingInfo, catalogKey, reasoningMeta } from './model-config.mjs';
import { loadConfig, version } from './config.mjs';

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-V')) {
  console.log(`raft-devin-adapter ${version} (Devin CLI; Grok ACP compatibility slot)`);
  process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
  console.log('Local Devin ACP adapter for Raft. Supports: agent stdio (Grok compatibility slot). Not the Grok CLI.');
  process.exit(0);
}
if (args[0] !== 'agent' || !args.includes('stdio')) {
  console.error('This executable is the Devin compatibility adapter, not Grok Build. Use devin directly for login, updates and configuration.');
  process.exit(2);
}

const config = loadConfig();
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const env = { ...process.env };
if (config.proxyUrl) {
  for (const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY']) env[key] = config.proxyUrl;
  env.NO_PROXY = env.NO_PROXY || 'localhost,127.0.0.1,::1,[::1]';
}
const rpc = new Rpc(config.devinExe, config.devinArgs, { cwd: process.cwd(), env });
let primed = null;
let loading = false;
let shuttingDown = false;
let hostRequestId = 0;
const hostRequests = new Map();
const sessions = new Map();

rpc.onNotification = message => { if (!loading) send(message); };
rpc.onRequest = message => new Promise((resolve, reject) => {
  const id = `devin-host-${++hostRequestId}`;
  const timer = setTimeout(() => { hostRequests.delete(id); reject(new Error('Raft did not answer the Devin host request')); }, 120000);
  hostRequests.set(id, { resolve, reject, timer });
  send({ ...message, id });
});

function state(sessionId) {
  const value = sessions.get(sessionId);
  if (!value) throw Object.assign(new Error('Session not opened by this adapter process'), { rpc: { code: -32602 } });
  return value;
}

function modelResult(session) {
  const modelOption = option(session, 'model');
  let catalog;
  try {
    const loaded = JSON.parse(readFileSync(config.catalogPath, 'utf8'));
    if (loaded.schema === 1 && loaded.key === catalogKey(config.devinExe, modelOption?.options ?? [])) catalog = loaded.models;
    else console.error('[raft-devin-adapter] Thinking options changed; run Refresh-Models.ps1, then refresh the model list in Raft.');
  } catch {
    console.error('[raft-devin-adapter] No verified thinking catalog; run Refresh-Models.ps1 to discover options for all models.');
  }
  return {
    currentModelId: `devin:${modelOption?.currentValue ?? config.defaultModel ?? 'swe-2-high'}`,
    availableModels: (modelOption?.options ?? []).map(o => ({
      modelId: `devin:${o.value}`, name: `Devin · ${o.name}`,
      _meta: reasoningMeta(o.value === modelOption.currentValue ? thinkingInfo(session) : catalog?.[o.value])
    }))
  };
}

async function releasePrimed() {
  if (!primed) return;
  const id = primed.sessionId;
  primed = null;
  try { await rpc.request('session/delete', { sessionId: id }, 10000); }
  catch { await rpc.request('session/close', { sessionId: id }, 10000).catch(() => {}); }
}

async function prompt(params, isMidTurn = false) {
  const current = state(params.sessionId);
  const content = [...(params.prompt ?? [])];
  if (current.needsInstructions && current.standingPrompt) {
    content.unshift({ type: 'text', text: '[Raft host instructions for this agent session]\n' + current.standingPrompt + '\n[End Raft host instructions]' });
    current.needsInstructions = false;
  }
  const pending = rpc.request('session/prompt', { ...params, prompt: content }, 24 * 60 * 60 * 1000);
  if (isMidTurn) {
    current.midTurns.add(pending);
    try { return await pending; } finally { current.midTurns.delete(pending); }
  }
  const result = await pending;
  // Devin accepts prompts during an active turn. Keep the Raft turn open
  // until those deliveries finish, instead of acknowledging an unexecuted queue.
  while (current.midTurns.size) await Promise.allSettled([...current.midTurns]);
  return { ...result, _meta: { ...result._meta, ...(result.usage ? { usage: result.usage } : {}) } };
}

async function handle(method, params) {
  if (method === 'initialize') {
    const initialized = await rpc.request(method, params);
    if (initialized.agentCapabilities?.loadSession !== true || initialized.agentCapabilities?._meta?.['cognition.ai/midTurnPrompts'] !== true) {
      throw new Error('Devin no longer advertises required session resume or mid-turn prompt capabilities; refusing an incompatible launch');
    }
    primed = await rpc.request('session/new', { cwd: process.cwd(), mcpServers: [] }, 90000);
    return { ...initialized, _meta: { ...initialized._meta, modelState: modelResult(primed), 'raft-devin-adapter': version } };
  }
  if (method === 'session/new' || method === 'session/load') {
    const { _meta: meta = {}, ...nativeParams } = params;
    let opened;
    if (method === 'session/new' && primed && path.resolve(params.cwd) === process.cwd() && !(params.mcpServers?.length)) {
      opened = primed;
      primed = null;
    } else {
      await releasePrimed();
      loading = method === 'session/load';
      try { opened = await rpc.request(method, nativeParams, 90000); }
      finally { loading = false; }
    }
    const sessionId = opened.sessionId ?? params.sessionId;
    if (!sessionId) throw new Error('Devin did not return a session ID');
    sessions.set(sessionId, { standingPrompt: meta.systemPromptOverride ?? '', needsInstructions: true, midTurns: new Set() });
    return { ...opened, sessionId };
  }
  if (method === 'session/set_model') {
    const modelId = params.modelId;
    if (!modelId?.startsWith('devin:')) throw new Error('Select a Devin model from the adapter model list; Grok model IDs cannot be used with Devin');
    let result = await rpc.request('session/set_config_option', { sessionId: params.sessionId, configId: 'model', value: modelId.slice(6) });
    if (params._meta?.reasoningEffort) {
      const thinking = option(result, 'thought_level');
      const effort = params._meta.reasoningEffort;
      if (!thinking?.options?.some(o => o.value === effort)) throw new Error(`Devin does not offer requested reasoning effort: ${effort}. Available: ${(thinking?.options ?? []).map(o => o.value).join(', ') || 'model default only'}`);
      result = await rpc.request('session/set_config_option', { sessionId: params.sessionId, configId: 'thought_level', value: effort });
      if (option(result, 'thought_level')?.currentValue !== effort) throw new Error(`Devin did not apply requested reasoning effort: ${effort}`);
    }
    console.error(`[raft-devin-adapter] Model configured: ${option(result, 'model')?.currentValue}; thinking=${option(result, 'thought_level')?.currentValue ?? 'default'}`);
    return result;
  }
  if (method === 'session/prompt') return prompt(params);
  if (method === 'session/delete' || method === 'session/close') {
    state(params.sessionId);
    const result = await rpc.request(method, params);
    sessions.delete(params.sessionId);
    return result;
  }
  if (method === '_x.ai/interject') {
    await prompt({ sessionId: params.sessionId, prompt: [{ type: 'text', text: params.text }] }, true);
    return { accepted: true, interjectionId: params.interjectionId };
  }
  throw Object.assign(new Error(`Unsupported Raft/Grok extension: ${method}`), { rpc: { code: -32601 } });
}

const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); return; }
  const hostRequest = hostRequests.get(message.id);
  if (hostRequest && !message.method) {
    hostRequests.delete(message.id);
    clearTimeout(hostRequest.timer);
    if (message.error) hostRequest.reject(Object.assign(new Error(message.error.message), { rpc: message.error }));
    else hostRequest.resolve(message.result);
    return;
  }
  if (!message.method) return;
  if (!Object.hasOwn(message, 'id')) {
    if (message.method === 'session/cancel') rpc.notify(message.method, message.params);
    return;
  }
  handle(message.method, message.params ?? {}).then(
    result => send({ jsonrpc: '2.0', id: message.id, result }),
    error => send({ jsonrpc: '2.0', id: message.id, error: { code: error.rpc?.code ?? -32603, message: error.message } })
  );
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const h of hostRequests.values()) { clearTimeout(h.timer); h.reject(new Error('Raft host disconnected')); }
  hostRequests.clear();
  await releasePrimed();
  await rpc.close();
}
lines.on('close', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
rpc.child.on('exit', () => { if (!shuttingDown) { lines.close(); process.exitCode = 1; } });
