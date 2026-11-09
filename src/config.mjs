// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const version = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;
export const launcherPath = path.join(projectRoot, 'bin', process.platform === 'win32' ? 'grok.exe' : 'grok');

export function loadConfig() {
  const configPath = process.env.DEVIN_ADAPTER_CONFIG || path.join(projectRoot, 'adapter.config.json');
  let local = {};
  try { local = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot read adapter configuration; check its JSON syntax.'); }
  const explicit = process.env.DEVIN_EXE || local.devinExe;
  if (explicit && (!fs.existsSync(explicit) || !fs.statSync(explicit).isFile())) throw new Error('The configured Devin executable does not exist.');
  const candidates = explicit ? [explicit] : [];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'devin', 'cli', 'bin', 'devin.exe'));
  } else if (process.env.HOME) {
    // Standalone Devin CLI install locations on macOS/Linux. The .local/bin
    // entry is a PATH-visible symlink; the _versions path is its real target,
    // which keeps discovery working when the daemon's PATH is minimal.
    candidates.push(
      path.join(process.env.HOME, '.local', 'bin', 'devin'),
      path.join(process.env.HOME, '.local', 'share', 'devin', 'cli', '_versions', 'current', 'bin', 'devin')
    );
  }
  for (const entry of (process.env.PATH || '').split(path.delimiter)) {
    candidates.push(path.join(entry, process.platform === 'win32' ? 'devin.exe' : 'devin'));
  }
  const devinExe = candidates.find(candidate => candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!devinExe) throw new Error('Devin CLI was not found. Install it first, or set DEVIN_EXE / devinExe to its executable path.');
  // Explicit local configuration overrides inherited proxy variables only for
  // the Devin child. Empty configuration preserves its normal environment.
  const proxyUrl = process.env.DEVIN_ADAPTER_PROXY || local.proxyUrl || '';
  if (proxyUrl) {
    let parsed;
    try { parsed = new URL(proxyUrl); } catch { throw new Error('proxyUrl must be a valid proxy URL.'); }
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol)) throw new Error('Unsupported proxy protocol.');
  }
  return {
    devinExe: path.resolve(devinExe), proxyUrl,
    devinArgs: Array.isArray(local.devinArgs) && local.devinArgs.every(arg => typeof arg === 'string') ? local.devinArgs : ['acp'],
    defaultModel: local.defaultModel || 'swe-2-high',
    catalogPath: path.join(projectRoot, '.local', 'model-catalog.json')
  };
}
