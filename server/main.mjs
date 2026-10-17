import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { HostAPI } from './host.mjs';
import { Tunnel } from './tunnel.mjs';

const required = ['PICODE_URL', 'PICODE_EXT_TOKEN', 'PICODE_EXT_DATA', 'PICODE_EXT_PORT', 'PICODE_EXT_PROXY_SECRET'];
if (Number(process.versions.node.split('.')[0]) < 22 || required.some(key => !process.env[key])) {
  process.stderr.write('Tailscale needs Node.js 22 or newer and must be started by COGNIX[WS].\n');
  process.exit(1);
}
const host = new HostAPI({ url: process.env.PICODE_URL, token: process.env.PICODE_EXT_TOKEN, dataDir: process.env.PICODE_EXT_DATA });
const tunnel = new Tunnel({ host, dataDir: process.env.PICODE_EXT_DATA });
const secret = Buffer.from(process.env.PICODE_EXT_PROXY_SECRET);
export const server = http.createServer((request, response) => {
  const supplied = Buffer.from(request.headers['x-picode-proxy-secret'] || '');
  const reply = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
  if (supplied.length !== secret.length || !timingSafeEqual(supplied, secret)) { reply(401, { message: 'Open this through COGNIX[WS].' }); return; }
  if (request.method === 'GET' && new URL(request.url, 'http://127.0.0.1').pathname === '/status') { reply(200, tunnel.status()); return; }
  reply(404, { message: 'This action is unavailable.' });
});
server.listen(Number(process.env.PICODE_EXT_PORT), '127.0.0.1', () => tunnel.start());
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { tunnel.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); });
