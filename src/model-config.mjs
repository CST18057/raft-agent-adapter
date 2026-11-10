// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';

// Values accepted by Raft's Grok model parser. Devin's "none" is represented
// by Raft's Default choice when it is the native model default.
const raftEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export const option = (session, id) => session.configOptions?.find(o => o.id === id);

export function thinkingInfo(session, configId) {
  const thinking = option(session, configId);
  return {
    efforts: (thinking?.options ?? []).map(o => o.value).filter(v => typeof v === 'string' && v),
    ...(thinking?.currentValue ? { defaultEffort: thinking.currentValue } : {})
  };
}

export function catalogKey(executable, models) {
  const stat = statSync(executable);
  return createHash('sha256').update(JSON.stringify({
    binary: { size: stat.size, modified: stat.mtimeMs },
    models
  })).digest('hex');
}

export function reasoningMeta(info) {
  if (!info) return {};
  return {
    reasoningEfforts: info.efforts.filter(e => raftEfforts.has(e)),
    ...(raftEfforts.has(info.defaultEffort) ? { reasoningEffort: info.defaultEffort } : {})
  };
}
