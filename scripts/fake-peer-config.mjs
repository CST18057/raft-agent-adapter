// SPDX-License-Identifier: MIT
// Write an adapter config that points the adapter at the deterministic local
// fake ACP peer, so launcher/end-to-end checks need no account or network.
// Usage: node scripts/fake-peer-config.mjs <output-file> [--backend dsh]
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../src/config.mjs';

const output = process.argv[2];
const backend = process.argv.includes('--backend') ? process.argv[process.argv.indexOf('--backend') + 1] : 'devin';
if (!output) {
  console.error('Usage: node scripts/fake-peer-config.mjs <output-file> [--backend dsh]');
  process.exit(2);
}
const config = backend === 'dsh'
  ? { backend: 'dsh', dshExe: process.execPath, dshArgs: [path.join(projectRoot, 'test', 'fake-dsh.mjs')] }
  : { backend: 'devin', devinExe: process.execPath, devinArgs: [path.join(projectRoot, 'test', 'fake-devin.mjs')] };
fs.writeFileSync(output, JSON.stringify(config, null, 2) + '\n');
console.log(output);
