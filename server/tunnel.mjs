import { readFileSync } from 'node:fs';
import { issue, leafPaths, needsIssue, readStatus, runTailscale } from './tailscale.mjs';

// Every minute: read tailscale's status; when it runs, keep this node's
// certificate fresh and handed to COGNIX[WS], which serves it by name.
export class Tunnel {
  constructor({ host, dataDir, run = runTailscale, every = 60_000, now = () => Date.now() }) {
    this.host = host; this.dataDir = dataDir; this.run = run; this.every = every; this.now = now;
    this.state = 'connecting'; this.next = ''; this.name = ''; this.handed = ''; this.timer = null;
  }

  status() {
    return { state: this.state, addresses: this.state === 'connected' ? [this.name] : [], phoneNeeds: 'app', reach: 'network', next: this.next };
  }

  set(state, next = '') { this.state = state; this.next = next; }

  async check() {
    const st = readStatus(await this.run(['status', '--json'], 5_000));
    if (st.state !== 'running') { this.set(st.state, st.next); return; }
    this.name = st.name;
    if (needsIssue(this.dataDir, this.name, this.now())) {
      const r = await issue(this.dataDir, this.name, this.run);
      if (!r.ok) { this.set('needs-attention', r.reason === 'failed' ? 'retry' : 'open'); return; }
      this.handed = '';
    }
    if (this.handed !== this.name) {
      const { cert, key } = leafPaths(this.dataDir);
      try {
        await this.host.request('/api/ext/v1/tunnel/certificate', { method: 'PUT', body: { name: this.name, cert: readFileSync(cert, 'utf8'), key: readFileSync(key, 'utf8') } });
        this.handed = this.name;
      } catch { this.set('needs-attention', 'retry'); return; }
    }
    this.set('connected');
  }

  start() {
    const loop = async () => { try { await this.check(); } catch { this.set('needs-attention', 'retry'); } };
    loop();
    this.timer = setInterval(loop, this.every);
  }

  stop() { if (this.timer) clearInterval(this.timer); }
}
