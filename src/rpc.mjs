// SPDX-License-Identifier: MIT
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class Rpc {
  constructor(command, args, options = {}) {
    this.nextId = 0;
    this.pending = new Map();
    this.notifications = [];
    this.stderr = '';
    this.child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...options });
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-20000); });
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', (code, signal) => this.fail(new Error(`RPC child exited (${code}, ${signal}) ${this.stderr.slice(-2000)}`)));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.method) {
        if (Object.hasOwn(message, 'id')) {
          Promise.resolve(this.onRequest?.(message) ?? Promise.reject(new Error(`Unsupported host request ${message.method}`)))
            .then(result => this.send({ jsonrpc: '2.0', id: message.id, result }), error => this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: error.message } }));
        } else {
          this.notifications.push(message);
          if (this.notifications.length > 200) this.notifications.shift();
          this.onNotification?.(message);
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = Object.assign(new Error(message.error.message), { rpc: message.error });
        pending.reject(error);
      } else pending.resolve(message.result);
    });
  }
  send(message) { if (!this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params, timeout = 60000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timed out: ${method}; ${this.stderr.slice(-2000)}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
  fail(error) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); }
  async close() {
    this.fail(new Error('RPC closed'));
    this.child.stdin.end();
    if (this.child.exitCode === null) {
      await new Promise(resolve => {
        const timer = setTimeout(() => { this.child.kill(); resolve(); }, 3000);
        this.child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    this.lines.close();
  }
}

export const initializeParams = {
  protocolVersion: 1,
  clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  clientInfo: { name: 'raft-devin-adapter-probe', version: '0.2.0' },
  _meta: { startupHints: { nonInteractive: true, skipGitStatus: true, skipProjectLayout: true }, clientType: 'raft-daemon', clientVersion: '1.0.0' }
};
