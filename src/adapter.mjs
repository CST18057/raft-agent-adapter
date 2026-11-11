// SPDX-License-Identifier: MIT
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Rpc, initializeParams } from './rpc.mjs';
import { option, thinkingInfo, catalogKey, reasoningMeta, modelMap, stampCategories } from './model-config.mjs';
import { loadConfig, version, localDir } from './config.mjs';
import { backends, readBackendState, writeBackendState, initializeCacheKey, readInitializeCache, writeInitializeCache } from './backends.mjs';

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-V')) {
  console.log(`raft-agent-adapter ${version} (Grok ACP compatibility slot)`);
  process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
  console.log('Local agent ACP adapter for Raft. Supports: agent stdio (Grok compatibility slot). Not the Grok CLI.');
  process.exit(0);
}
if (args[0] !== 'agent' || !args.includes('stdio')) {
  console.error('This executable is the agent compatibility adapter, not Grok Build. Use the agent CLI directly for login, updates and configuration.');
  process.exit(2);
}

const config = loadConfig();
const backend = backends[config.backendId];
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const env = { ...process.env };
if (config.proxyUrl) {
  for (const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY']) env[key] = config.proxyUrl;
  env.NO_PROXY = env.NO_PROXY || 'localhost,127.0.0.1,::1,[::1]';
}
let rpc = null;
let primed = null;
let liveInitialized = null;
let backendStart = null;
let hostInitializeParams = null;
let loading = false;
let shuttingDown = false;
let hostRequestId = 0;
const hostRequests = new Map();
const sessions = new Map();

// Spawn the backend only when a real request needs it. Raft probes this slot
// with initialize for model detection and account usage; spawning a coding
// agent for those probes is the CPU/RSS spike this adapter must avoid.
function backendRpc() {
  if (rpc) return rpc;
  rpc = new Rpc(config.spawn.command, config.spawn.args, { cwd: process.cwd(), env });
  rpc.onNotification = message => {
    if (loading) return;
    send(message);
    const update = message.params?.update;
    const usage = update?.sessionUpdate === 'usage_update' ? backend.usageOf?.(update) : null;
    if (usage) sessions.get(message.params.sessionId)?.usageByRequest.set(usage.key, usage.usage);
  };
  rpc.onRequest = message => new Promise((resolve, reject) => {
    const id = `${backend.id}-host-${++hostRequestId}`;
    const timer = setTimeout(() => { hostRequests.delete(id); reject(new Error(`Raft did not answer the ${backend.displayName} host request`)); }, 120000);
    hostRequests.set(id, { resolve, reject, timer });
    send({ ...message, id });
  });
  rpc.child.on('exit', () => { if (!shuttingDown) void shutdown(1, { release: false }); });
  return rpc;
}

function state(sessionId) {
  const value = sessions.get(sessionId);
  if (!value) throw Object.assign(new Error('Session not opened by this adapter process'), { rpc: { code: -32602 } });
  return value;
}

const knownSessionDir = () => path.join(localDir(), `${backend.id}-sessions`);
const sessionMarker = id => /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id ?? '') ? path.join(knownSessionDir(), id) : null;
function rememberSession(id) {
  const marker = sessionMarker(id);
  if (!marker) return;
  try { mkdirSync(knownSessionDir(), { recursive: true }); writeFileSync(marker, ''); }
  catch (error) { console.error(`[raft-agent-adapter] Cannot record ${backend.displayName} session ${id}: ${error.message}`); }
}
function knownSession(id) {
  const marker = sessionMarker(id);
  return Boolean(marker && existsSync(marker));
}

function loadCatalog(models) {
  try {
    const loaded = JSON.parse(readFileSync(config.catalogPath, 'utf8'));
    if (loaded.schema === 1 && loaded.key === catalogKey(config.executable, models)) return loaded.models;
    console.error('[raft-agent-adapter] Thinking options changed; run `npm run models:refresh`, then refresh the model list in Raft.');
  } catch {
    console.error('[raft-agent-adapter] No verified thinking catalog; run `npm run models:refresh` to discover options for all models.');
  }
  return null;
}

// Starts the backend on first use. A cache hit answers initialize without a
// child process; the first real session request initializes the same way.
function startBackend() {
  if (!backendStart) {
    backendStart = backendRpc().request('initialize', hostInitializeParams ?? initializeParams)
      .then(initialized => {
        const capabilities = backend.checkInit(initialized);
        liveInitialized = initialized;
        return { initialized, capabilities };
      })
      .catch(error => { backendStart = null; throw error; });
  }
  return backendStart;
}

function persistInitializeCache(initialized, session) {
  if (!initialized || !session?.configOptions?.length) return;
  try {
    writeInitializeCache(localDir(), backend.id, initializeCacheKey(config), {
      initialize: initialized,
      configOptions: session.configOptions
    });
  } catch (error) {
    console.error(`[raft-agent-adapter] Cannot cache ${backend.displayName} initialize state: ${error.message}`);
  }
}

function cachedInitializeResponse(entry) {
  const snapshot = { configOptions: entry.configOptions };
  if (!option(snapshot, 'model')?.options?.length) throw new Error('cached model options are missing');
  const capabilities = backend.checkInit(entry.initialize);
  return {
    ...entry.initialize,
    agentCapabilities: capabilities,
    _meta: { ...(entry.initialize._meta ?? {}), modelState: modelResult(snapshot), 'raft-agent-adapter': { version, backend: backend.id } }
  };
}

function canResumePrimed(params) {
  if (!backend.persistentPrimed || params.mcpServers?.length) return false;
  if (path.resolve(params.cwd) !== process.cwd()) return false;
  const stored = readBackendState(localDir(), backend.id);
  return Boolean(stored && path.resolve(stored.primedCwd ?? '') === process.cwd());
}

// Raft-facing model surface: backend base ids map to families (swe-2-high →
// swe-2), so the model dropdown names the model and the effort dropdown names
// the level. Rebuilt whenever a session response advertises a changed model
// list — an effort-only change cannot alter the split, so it stays stable.
let surface = null;
let surfaceKey = '';
function rebuildSurface(session) {
  const modelOption = option(session, 'model');
  const entries = backend.modelEntries(session, option);
  const catalog = loadCatalog(modelOption?.options ?? []);
  const current = modelOption?.currentValue;
  const map = modelMap(entries, value => catalog?.[value]?.defaultEffort
    ?? (value === current ? thinkingInfo(session, backend.thinkingConfigId).defaultEffort : undefined));
  surface = { entries, catalog, map };
  surfaceKey = entries.map(e => e.value).join('');
}
function observeConfig(result) {
  const entries = backend.modelEntries(result, option);
  if (entries.length && entries.map(e => e.value).join('') !== surfaceKey) rebuildSurface(result);
}

function modelResult(session) {
  rebuildSurface(session);
  const { entries, catalog, map } = surface;
  const modelOption = option(session, 'model');
  const fallback = config.defaultModel ?? backend.builtinDefaultModel ?? entries[0]?.value ?? '';
  return {
    currentModelId: `${backend.modelPrefix}${map.toRaftId(modelOption?.currentValue ?? fallback)}`,
    availableModels: entries.map(o => ({
      modelId: `${backend.modelPrefix}${map.toRaftId(o.value)}`, name: backend.agentLabel(o.name),
      _meta: reasoningMeta(o.value === modelOption?.currentValue ? thinkingInfo(session, backend.thinkingConfigId) : catalog?.[o.value])
    }))
  };
}

// Applies a Raft model choice: the family id resolves to the backend base id,
// then the chosen reasoning effort maps to the backend's thinking option.
// Legacy base ids (profiles saved before families) and hand-written combos
// (devin:swe-2-max → swe-2-high + max) resolve too.
async function applyModel(sessionId, modelId, effort) {
  await startBackend();
  const prefixed = modelId?.startsWith(backend.modelPrefix);
  const raw = prefixed ? modelId.slice(backend.modelPrefix.length) : modelId;
  const resolved = surface ? surface.map.resolve(raw) : { base: raw };
  if (!resolved) {
    if (!prefixed) throw new Error(`"${modelId}" belongs to a different adapter backend (current: ${backend.displayName}). Refresh the model list in Raft and select a ${backend.displayName} · model — or switch adapter.config.json's backend back.`);
    throw new Error(`"${modelId}" is not a model this ${backend.displayName} backend offers. Refresh the model list in Raft.`);
  }
  let result = await backendRpc().request('session/set_config_option', { sessionId, configId: 'model', value: resolved.base });
  const requested = effort ?? resolved.effort;
  if (requested) {
    const thinking = option(result, backend.thinkingConfigId);
    if (!thinking) throw new Error(`${backend.displayName} offers no reasoning effort control for this model (requested: ${requested})`);
    if (!thinking.options?.some(o => o.value === requested)) throw new Error(`${backend.displayName} does not offer requested reasoning effort: ${requested}. Available: ${thinking.options.map(o => o.value).filter(Boolean).join(', ') || 'model default only'}`);
    result = await backendRpc().request('session/set_config_option', { sessionId, configId: backend.thinkingConfigId, value: requested });
    if (option(result, backend.thinkingConfigId)?.currentValue !== requested) throw new Error(`${backend.displayName} did not apply requested reasoning effort: ${requested}`);
  }
  observeConfig(result);
  console.error(`[raft-agent-adapter] Model configured: ${option(result, 'model')?.currentValue}; thinking=${option(result, backend.thinkingConfigId)?.currentValue ?? 'default'}`);
  return stampCategories(result, backend.thinkingConfigId);
}

async function releasePrimed() {
  if (!primed) return;
  const id = primed.sessionId;
  primed = null;
  for (const method of backend.closeMethods) {
    try { await backendRpc().request(method, { sessionId: id }, 10000); return; }
    catch { /* try the next close surface */ }
  }
}

async function drainDeferred(current, sessionId) {
  // Backend without mid-turn delivery: queued interjections are sent as one
  // follow-up prompt once the active turn settles, so messages are not lost.
  while (current.deferred.length) {
    const texts = current.deferred.splice(0);
    const requeued = await backendRpc().request('session/prompt', { sessionId, prompt: [{ type: 'text', text: texts.join('\n') }] }, 24 * 60 * 60 * 1000)
      .then(() => false, error => {
        if (/already in flight/i.test(error.message)) { current.deferred.unshift(...texts); return true; }
        console.error(`[raft-agent-adapter] Dropped ${texts.length} deferred interjection(s): ${error.message}`);
        return false;
      });
    if (requeued || !backend.queuesPrompts) break;
  }
}

function sumUsage(usages) {
  if (!usages.length) return null;
  const total = {};
  for (const usage of usages) for (const [name, count] of Object.entries(usage)) total[name] = (total[name] ?? 0) + count;
  return total;
}

async function prompt(params, isMidTurn = false) {
  const current = state(params.sessionId);
  const content = [...(params.prompt ?? [])];
  if (current.needsInstructions && current.standingPrompt) {
    content.unshift({ type: 'text', text: '[Raft host instructions for this agent session]\n' + current.standingPrompt + '\n[End Raft host instructions]' });
    current.needsInstructions = false;
  }
  current.usageByRequest.clear();
  const pending = backendRpc().request('session/prompt', { ...params, prompt: content }, 24 * 60 * 60 * 1000);
  if (isMidTurn) {
    current.midTurns.add(pending);
    try { return await pending; } finally { current.midTurns.delete(pending); }
  }
  const result = await pending;
  // Devin accepts prompts during an active turn. Keep the Raft turn open
  // until those deliveries finish, instead of acknowledging an unexecuted queue.
  while (current.midTurns.size) await Promise.allSettled([...current.midTurns]);
  const drained = drainDeferred(current, params.sessionId);
  if (backend.queuesPrompts) await drained;
  const usage = result.usage ?? sumUsage([...current.usageByRequest.values()]);
  return { ...result, _meta: { ...result._meta, ...(usage ? { usage } : {}) } };
}

async function openPrimed() {
  const stored = backend.persistentPrimed ? readBackendState(localDir(), backend.id) : null;
  const usable = stored && (!backend.knownSessionsOnly || knownSession(stored.primedSessionId)) ? stored : null;
  const opened = await backend.openPrimed(backendRpc(), process.cwd(), usable);
  if (backend.knownSessionsOnly) rememberSession(opened.sessionId);
  if (backend.persistentPrimed && opened.sessionId !== stored?.primedSessionId) {
    writeBackendState(localDir(), backend.id, { primedSessionId: opened.sessionId, primedCwd: process.cwd() });
  }
  return opened;
}

async function handle(method, params) {
  if (method === 'initialize') {
    hostInitializeParams = params;
    const cached = readInitializeCache(localDir(), backend.id, initializeCacheKey(config));
    if (cached) {
      try {
        // Raft's model/usage probes stop after initialize; answer them without
        // starting the backend, which can cost seconds and hundreds of MB.
        return cachedInitializeResponse(cached);
      } catch (error) {
        console.error(`[raft-agent-adapter] Ignoring unusable ${backend.displayName} initialize cache: ${error.message}`);
      }
    }
    const { initialized, capabilities } = await startBackend();
    if (primed) await releasePrimed();
    primed = await openPrimed();
    persistInitializeCache(initialized, primed);
    return { ...initialized, agentCapabilities: capabilities, _meta: { ...initialized._meta, modelState: modelResult(primed), 'raft-agent-adapter': { version, backend: backend.id } } };
  }
  if (method === 'authenticate') {
    if (backend.interactiveAuth) throw new Error(`${backend.displayName} sign-in is interactive and would log out the current account; sign in with the codebuddy CLI or set CODEBUDDY_API_KEY instead.`);
    await startBackend();
    const result = await backendRpc().request(method, params, 120000);
    // Account state changed: drop the unauthenticated primed session so the
    // next session open discovers the real model options for the account.
    await releasePrimed();
    return result;
  }
  if (method === 'session/new' || method === 'session/load') {
    const { _meta: meta = {}, ...nativeParams } = params;
    if (method === 'session/load' && backend.knownSessionsOnly && !knownSession(params.sessionId)) throw backend.missingSessionError(params.sessionId);
    if (method === 'session/load' && !backend.nativeLoad && sessions.has(params.sessionId)) {
      // The session is already live in this bridge process; there is nothing
      // to resume. (dsh rejects a resume of an active session.)
      return { sessionId: params.sessionId };
    }
    await startBackend();
    let opened;
    if (method === 'session/new' && primed && path.resolve(params.cwd) === process.cwd() && !(params.mcpServers?.length)) {
      opened = primed;
      primed = null;
      if (backend.persistentPrimed) writeBackendState(localDir(), backend.id, { primedSessionId: null, primedCwd: process.cwd() });
    } else if (method === 'session/new' && !primed && canResumePrimed(params)) {
      // The cached handshake did not open a backend session. Resume the
      // persisted primed session now instead of leaving it unused.
      primed = await openPrimed();
      opened = primed;
      primed = null;
      if (backend.persistentPrimed) writeBackendState(localDir(), backend.id, { primedSessionId: null, primedCwd: process.cwd() });
    } else {
      await releasePrimed();
      const nativeMethod = method === 'session/load' ? backend.loadMethod : method;
      const nativeCall = method === 'session/load' ? backend.resumeParams(nativeParams) : nativeParams;
      loading = method === 'session/load' && backend.nativeLoad;
      try { opened = await backendRpc().request(nativeMethod, nativeCall, 90000); }
      catch (error) {
        if (method === 'session/load' && backend.missingSessionError && !backend.knownSessionsOnly) throw backend.missingSessionError(params.sessionId, error);
        throw error;
      }
      finally { loading = false; }
    }
    const sessionId = opened.sessionId ?? params.sessionId;
    if (!sessionId) throw new Error(`${backend.displayName} did not return a session ID`);
    if (backend.knownSessionsOnly) rememberSession(sessionId);
    if (backend.permissionMode) {
      try {
        await backendRpc().request('session/set_config_option', { sessionId, configId: 'mode', value: backend.permissionMode });
      } catch (error) {
        console.error(`[raft-agent-adapter] ${backend.displayName} did not accept permission mode ${backend.permissionMode}: ${error.message}`);
      }
    }
    observeConfig(opened);
    if (method === 'session/new' && liveInitialized) persistInitializeCache(liveInitialized, opened);
    sessions.set(sessionId, { standingPrompt: meta.systemPromptOverride ?? '', needsInstructions: true, midTurns: new Set(), deferred: [], usageByRequest: new Map() });
    return stampCategories({ ...opened, sessionId }, backend.thinkingConfigId);
  }
  if (method === 'session/set_model') return applyModel(params.sessionId, params.modelId, params._meta?.reasoningEffort);
  if (method === 'session/set_config_option') {
    // Raft's generic ACP path applies model and thinking level through this
    // method; the grok driver uses session/set_model instead. Forwarding both
    // keeps the bridge working whichever surface a host chooses.
    if (params.configId === 'model') return applyModel(params.sessionId, params.value, params._meta?.reasoningEffort);
    await startBackend();
    const configId = ['thought_level', 'reasoning_effort', backend.thinkingConfigId].includes(params.configId) ? backend.thinkingConfigId : params.configId;
    const result = await backendRpc().request('session/set_config_option', { sessionId: params.sessionId, configId, value: params.value });
    observeConfig(result);
    return stampCategories(result, backend.thinkingConfigId);
  }
  if (method === 'session/prompt') return prompt(params);
  if (method === 'session/delete' || method === 'session/close') {
    state(params.sessionId);
    if (!backend.closeMethods.length) { sessions.delete(params.sessionId); return {}; }
    // Forward the requested method when the backend speaks it (Devin's
    // delete-vs-close distinction is meaningful); otherwise map to close.
    const candidates = backend.closeMethods.includes(method) ? [method] : backend.closeMethods;
    let last;
    for (const closeMethod of candidates) {
      try { const result = await backendRpc().request(closeMethod, params); sessions.delete(params.sessionId); return result; }
      catch (error) { last = error; }
    }
    throw last;
  }
  if (method === '_x.ai/interject') {
    const current = state(params.sessionId);
    if (!backend.midTurn) {
      current.deferred.push(params.text);
      return { accepted: true, interjectionId: params.interjectionId };
    }
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
    if (message.method === 'session/cancel' && rpc) rpc.notify(message.method, message.params);
    return;
  }
  handle(message.method, message.params ?? {}).then(
    result => send({ jsonrpc: '2.0', id: message.id, result }),
    error => send({ jsonrpc: '2.0', id: message.id, error: { code: error.rpc?.code ?? -32603, message: error.message } })
  );
});

async function shutdown(exitCode = 0, { release = true } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const h of hostRequests.values()) { clearTimeout(h.timer); h.reject(new Error('Raft host disconnected')); }
  hostRequests.clear();
  if (release) {
    try { await releasePrimed(); } catch { /* backend may already be gone */ }
  }
  if (rpc) {
    try { await rpc.close(); } catch { /* backend may already be gone */ }
  }
  lines.close();
  // The stdin readline keeps the event loop alive after SIGTERM/EOF; without an
  // explicit exit the adapter lingers after Raft kills a model-detection probe.
  process.exit(exitCode);
}
lines.on('close', () => void shutdown(0));
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
