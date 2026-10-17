import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { certFailure, readStatus, needsIssue, leafPaths } from '../server/tailscale.mjs';
import { Tunnel } from '../server/tunnel.mjs';

const running = { stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'Casa-PC.tail1234.ts.net.' } }) };

test('status states with one next action', () => {
  assert.deepEqual(readStatus({ code: 'ENOENT', error: new Error('x'), stdout: '' }), { state: 'needs-attention', next: 'open', reason: 'not-installed' });
  assert.equal(readStatus({ stdout: JSON.stringify({ BackendState: 'NeedsLogin' }) }).state, 'needs-setup');
  assert.equal(readStatus({ stdout: JSON.stringify({ BackendState: 'Stopped' }) }).reason, 'not-running');
  assert.equal(readStatus({ stdout: JSON.stringify({ BackendState: 'Running', Self: {} }) }).reason, 'dns-missing');
  assert.deepEqual(readStatus(running), { state: 'running', name: 'casa-pc.tail1234.ts.net' });
  assert.equal(readStatus({ stdout: 'not json' }).next, 'retry');
});

test('certificate failures are classified, never echoed', () => {
  assert.equal(certFailure('500 Internal Server Error: your Tailscale account does not support getting TLS certs'), 'https-disabled');
  assert.equal(certFailure('Access denied: cert access denied; use sudo tailscale set --operator=$USER'), 'permission');
  assert.equal(certFailure('something else'), 'failed');
});

// selfSigned makes a leaf for name valid for days, with openssl.
function selfSigned(dir, name, days) {
  const { cert, key } = leafPaths(dir);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', key, '-out', cert, '-days', String(days), '-subj', '/CN=' + name, '-addext', 'subjectAltName=DNS:' + name], { stdio: 'ignore' });
}

test('a leaf is issued when missing, for another name, or near its end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tst-'));
  assert.ok(needsIssue(dir, 'casa-pc.tail1234.ts.net'));
  selfSigned(dir, 'casa-pc.tail1234.ts.net', 80);
  assert.ok(!needsIssue(dir, 'casa-pc.tail1234.ts.net'));
  assert.ok(needsIssue(dir, 'other.tail1234.ts.net'));
  selfSigned(dir, 'casa-pc.tail1234.ts.net', 10);
  assert.ok(needsIssue(dir, 'casa-pc.tail1234.ts.net'));
});

test('running: the certificate is issued once and handed to COGNIX', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tst-'));
  const calls = [];
  const run = async args => {
    calls.push(args[0]);
    if (args[0] === 'status') return running;
    selfSigned(dir, 'casa-pc.tail1234.ts.net', 80);
    return { stdout: '' };
  };
  const puts = [];
  const host = { request: async (path, opts) => { puts.push([path, opts.body.name]); return {}; } };
  const t = new Tunnel({ host, dataDir: dir, run });
  await t.check();
  assert.deepEqual(puts, [['/api/ext/v1/tunnel/certificate', 'casa-pc.tail1234.ts.net']]);
  assert.deepEqual(t.status(), { state: 'connected', addresses: ['casa-pc.tail1234.ts.net'], phoneNeeds: 'app', reach: 'network', next: '' });
  await t.check();
  assert.equal(calls.filter(c => c === 'cert').length, 1, 'a fresh leaf is not issued again');
  assert.equal(puts.length, 1, 'nor handed again');
});

test('HTTPS disabled or no permission: open, no handoff', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tst-'));
  const run = async args => args[0] === 'status' ? running : { error: new Error('exit 1'), stderr: 'does not support getting TLS certs' };
  const host = { request: async () => { throw new Error('must not hand off'); } };
  const t = new Tunnel({ host, dataDir: dir, run });
  await t.check();
  assert.deepEqual([t.status().state, t.status().next], ['needs-attention', 'open']);
});

test('signed out: needs setup, sign in', async () => {
  const t = new Tunnel({ host: {}, dataDir: '/x', run: async () => ({ stdout: JSON.stringify({ BackendState: 'NeedsLogin' }) }) });
  await t.check();
  assert.deepEqual([t.status().state, t.status().next], ['needs-setup', 'sign-in']);
});
