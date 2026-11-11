// SPDX-License-Identifier: MIT
// Per-backend descriptors: the Raft/Grok wire surface stays fixed while each
// native agent protocol differs in capability bits, session lifecycle and
// model catalog shape. adapter.mjs consumes only this contract.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function missingSessionError(sessionId, cause) {
  // Raft's Grok driver only auto-recovers to a fresh session when the resume
  // failure matches /(path|session).*(not found|missing)/i. Translate any
  // backend resume rejection into that shape so switching agents or backends
  // self-heals instead of surfacing a startup error.
  const error = new Error(`session not found: ${sessionId}${cause?.message ? ` (${cause.message})` : ''}`);
  error.cause = cause;
  return error;
}

function modelEntriesOf(options) {
  // ACP model options may be a flat option list (Devin) or provider-grouped
  // (dsh: [{group, name, options:[{value,name}]}]). Always emit flat entries.
  return (options ?? []).flatMap(entry =>
    Array.isArray(entry.options)
      ? entry.options.map(o => ({ value: o.value, name: o.name ?? o.value }))
      : [{ value: entry.value, name: entry.name ?? entry.value }]
  ).filter(entry => typeof entry.value === 'string' && entry.value);
}

const base = {
  agentLabel(name) { return `${this.displayName} · ${name}`; },
  modelEntries(result, option) { return modelEntriesOf(option(result, 'model')?.options); },
  // Release for the unclaimed primed session and Raft-closed sessions.
  closeMethods: ['session/delete', 'session/close'],
};

async function resumeOrCreatePrimed(rpc, cwd, state) {
  // Every dsh session/new is persisted permanently; probes would otherwise
  // leak one dead session per detection round. Reuse the stored catalog
  // session via session/resume (its response also carries configOptions).
  const stored = state?.primedSessionId;
  if (stored && path.resolve(state.primedCwd ?? '') === path.resolve(cwd)) {
    try {
      const resumed = await rpc.request('session/resume', { sessionId: stored, cwd, mcpServers: [] }, 90000);
      return { ...resumed, sessionId: stored };
    } catch { /* stale or foreign id: fall through to a fresh session */ }
  }
  return rpc.request('session/new', { cwd, mcpServers: [] }, 90000);
}

export const backends = {
  devin: {
    ...base,
    id: 'devin',
    displayName: 'Devin',
    modelPrefix: 'devin:',
    thinkingConfigId: 'thought_level',
    builtinDefaultModel: 'swe-2-high',
    midTurn: true,
    nativeLoad: true,
    loadMethod: 'session/load',
    persistentPrimed: false,
    permissionMode: 'bypass',
    async openPrimed(rpc, cwd) {
      return rpc.request('session/new', { cwd, mcpServers: [] }, 90000);
    },
    checkInit(initialized) {
      const caps = initialized.agentCapabilities;
      if (caps?.loadSession !== true || caps?._meta?.['cognition.ai/midTurnPrompts'] !== true) {
        throw new Error('Devin no longer advertises required session resume or mid-turn prompt capabilities; refusing an incompatible launch');
      }
      return caps;
    },
    resumeParams: params => params,
  },

  dsh: {
    ...base,
    id: 'dsh',
    displayName: 'DSH',
    modelPrefix: 'dsh:',
    thinkingConfigId: 'reasoning_effort',
    midTurn: false,
    nativeLoad: false,
    loadMethod: 'session/resume',
    persistentPrimed: true,
    closeMethods: ['session/close'],
    async openPrimed(rpc, cwd, state) {
      const created = await resumeOrCreatePrimed(rpc, cwd, state);
      if (!created.sessionId) throw new Error('DSH did not return a session ID');
      return created;
    },
    checkInit(initialized) {
      const caps = initialized.agentCapabilities;
      if (caps?.sessionCapabilities?.resume === undefined || caps?.sessionCapabilities?.close === undefined) {
        throw new Error('DeepSeek Harness does not advertise the required session resume/close capabilities; refusing an incompatible launch');
      }
      // Raft's Grok driver requires loadSession=true. session/resume is the
      // semantic equivalent (no replay), so the adapter claims it and maps
      // session/load -> session/resume internally.
      return { ...caps, loadSession: true };
    },
    resumeParams: params => ({ sessionId: params.sessionId, cwd: params.cwd, mcpServers: params.mcpServers ?? [] }),
    missingSessionError,
  },

  codebuddy: {
    ...base,
    id: 'codebuddy',
    displayName: 'CodeBuddy',
    modelPrefix: 'codebuddy:',
    thinkingConfigId: 'thought_level',
    builtinDefaultModel: 'default-model',
    midTurn: false,
    queuesPrompts: true,
    nativeLoad: true,
    loadMethod: 'session/load',
    persistentPrimed: true,
    closeMethods: [],
    interactiveAuth: true,
    knownSessionsOnly: true,
    permissionMode: 'fullAccess',
    missingSessionError,
    openPrimed: resumeOrCreatePrimed,
    checkInit(initialized) {
      const caps = initialized.agentCapabilities;
      if (caps?.loadSession !== true) throw new Error('CodeBuddy no longer advertises session loading; refusing an incompatible launch');
      return caps;
    },
    usageOf(update) {
      const raw = update._meta?.usage;
      const key = update._meta?.['codebuddy.ai/requestId'] ?? update._meta?.['codebuddy.ai/messageId'];
      if (!key || typeof raw?.prompt_tokens !== 'number' || typeof raw.completion_tokens !== 'number') return null;
      const usage = { inputTokens: raw.prompt_tokens, outputTokens: raw.completion_tokens, totalTokens: raw.total_tokens ?? raw.prompt_tokens + raw.completion_tokens };
      return { key, usage };
    },
    resumeParams: params => params,
  },
};

function backendStatePath(dir) {
  return path.join(dir, 'backend-state.json');
}

export function readBackendState(dir, backendId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(backendStatePath(dir), 'utf8'));
    const entry = parsed?.[backendId];
    if (entry && typeof entry.primedSessionId === 'string') return entry;
  } catch { /* absent or corrupt state starts fresh */ }
  return null;
}

export function writeBackendState(dir, backendId, entry) {
  const file = backendStatePath(dir);
  let parsed = {};
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* fresh */ }
  parsed[backendId] = entry;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(parsed, null, 2));
  fs.renameSync(file + '.tmp', file);
}

// A successful backend initialize response plus the session config options is
// enough to answer Raft's model detection without starting the backend again.
// Raft probes this slot with initialize on startup, on reconnects and on model
// refreshes; spawning a full coding agent for each probe is the dominant cost.
function initializeCachePath(dir) {
  return path.join(dir, 'initialize-cache.json');
}

export function initializeCacheKey(config) {
  try {
    // Resolve aliases (PATH symlinks, npm .bin shims) so the same install
    // shares one cache key; size+mtime still invalidates on an upgrade.
    const executable = fs.realpathSync(config.executable);
    const stat = fs.statSync(executable);
    return createHash('sha256').update(JSON.stringify({
      backendId: config.backendId,
      executable,
      args: config.spawn?.args ?? [],
      size: stat.size,
      modified: stat.mtimeMs
    })).digest('hex');
  } catch { return null; }
}

export function readInitializeCache(dir, backendId, key) {
  if (!key) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(initializeCachePath(dir), 'utf8'));
    const entry = parsed?.schema === 1 ? parsed?.[backendId] : null;
    if (entry?.key !== key) return null;
    if (!entry.initialize || !Array.isArray(entry.configOptions)) return null;
    return entry;
  } catch { /* absent or corrupt cache falls back to a live handshake */ }
  return null;
}

export function writeInitializeCache(dir, backendId, key, entry) {
  if (!key) return;
  const file = initializeCachePath(dir);
  let parsed = { schema: 1 };
  try {
    const current = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (current?.schema === 1) parsed = current;
  } catch { /* fresh */ }
  parsed[backendId] = { ...entry, key, writtenAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(parsed, null, 2));
  fs.renameSync(file + '.tmp', file);
}
