import { execFile as execFileCb } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RENEW_WITHIN_MS = 30 * 24 * 3600 * 1000;

// run is the process boundary: tests replace it.
export function runTailscale(args, timeoutMs, execFile = execFileCb) {
  return new Promise(resolve => {
    execFile('tailscale', args, { timeout: timeoutMs, maxBuffer: 4 << 20 }, (error, stdout, stderr) => {
      resolve({ error, code: error?.code, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// readStatus maps `tailscale status --json` to one state and next action,
// the same states COGNIX[WS] used while Tailscale was built in (ADR-0339).
export function readStatus(result) {
  if (result.code === 'ENOENT') return { state: 'needs-attention', next: 'open', reason: 'not-installed' };
  if (result.error && !result.stdout) return { state: 'needs-attention', next: 'retry', reason: 'unreachable' };
  let st;
  try { st = JSON.parse(result.stdout); } catch { return { state: 'needs-attention', next: 'retry', reason: 'unreachable' }; }
  if (st.BackendState === 'NeedsLogin') return { state: 'needs-setup', next: 'sign-in', reason: 'needs-login' };
  if (st.BackendState !== 'Running') return { state: 'needs-attention', next: 'retry', reason: 'not-running' };
  const name = String(st.Self?.DNSName || '').trim().replace(/\.$/, '').toLowerCase();
  if (!name) return { state: 'needs-attention', next: 'open', reason: 'dns-missing' };
  return { state: 'running', name };
}

// certIssue classifies `tailscale cert`'s failure without reflecting its text.
export function certFailure(stderr) {
  if (/does not support getting TLS certs|HTTPS.*(disabled|not enabled)/i.test(stderr)) return 'https-disabled';
  if (/Access denied|--operator/i.test(stderr)) return 'permission';
  return 'failed';
}

export function leafPaths(dataDir) {
  return { cert: join(dataDir, 'tailscale.crt'), key: join(dataDir, 'tailscale.key') };
}

// needsIssue says whether the leaf on disk is missing, for another name, or
// inside its last 30 days.
export function needsIssue(dataDir, name, now = Date.now()) {
  const { cert } = leafPaths(dataDir);
  if (!existsSync(cert)) return true;
  try {
    const x = new X509Certificate(readFileSync(cert));
    if (!x.checkHost(name)) return true;
    return new Date(x.validTo).getTime() - now < RENEW_WITHIN_MS;
  } catch { return true; }
}

export async function issue(dataDir, name, run = runTailscale) {
  mkdirSync(dataDir, { recursive: true });
  const { cert, key } = leafPaths(dataDir);
  const r = await run(['cert', '--cert-file', cert, '--key-file', key, name], 120_000);
  if (r.error) return { ok: false, reason: certFailure(r.stderr) };
  return { ok: true };
}
