// Server uji lokal: menyajikan dist/ dan memetakan /api/* ke handler Netlify Function yang SAMA dengan produksi (database memori, Telegram palsu).
import http from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join } from 'node:path';
process.env.RJ_MEMORY_DB = '1'; process.env.DATA_ENC_KEY = randomBytes(32).toString('base64'); process.env.SESSION_SECRET = randomBytes(48).toString('base64url');
process.env.TELEGRAM_BOT_TOKEN = '111:E2E-TOKEN';
const root = new URL('../../', import.meta.url).pathname, PORT = Number(process.env.PORT ?? 8899);
const { hashPassword } = await import(root + 'netlify/functions/_lib/auth'); process.env.ADMIN_PASSWORD_HASH = hashPassword('e2e-password-123');

const sent: string[] = []; const realFetch = globalThis.fetch;
globalThis.fetch = (async (i: RequestInfo | URL, init?: RequestInit) => {
  if (String(i).startsWith('https://api.telegram.org/')) { const b = JSON.parse(String(init?.body ?? '{}')); if (String(i).endsWith('/sendMessage')) sent.push(b.text); return new Response(JSON.stringify({ ok: true, result: { message_id: 1, username: 'e2e_bot', first_name: 'E2E' } })); }
  return realFetch(i, init);
}) as typeof fetch;

const routes = new Map<string, (r: Request) => Promise<Response>>(); const dir = root + 'netlify/functions/';
for (const f of await readdir(dir)) { if (!f.endsWith('.ts') || f.startsWith('_')) continue; const m = await import(dir + f); if (m.config?.path) routes.set(m.config.path, m.default); }
const csp = /Content-Security-Policy = "([^"]+)"/.exec(await readFile(root + 'netlify.toml', 'utf8'))![1];
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  if (url.pathname === '/__sent') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(sent)); }
  const h = routes.get(url.pathname);
  if (h) {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await h(new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body }));
    res.statusCode = r.status; r.headers.forEach((v, k) => { if (k !== 'set-cookie') res.setHeader(k, v); }); const sc = r.headers.getSetCookie(); if (sc.length) res.setHeader('set-cookie', sc);
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  let file = join(root, 'dist', url.pathname); let data: Buffer;
  try { data = await readFile(file); } catch { file = join(root, 'dist', 'index.html'); data = await readFile(file); }
  res.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream'); res.setHeader('content-security-policy', csp); res.setHeader('x-frame-options', 'DENY'); res.end(data);
}).listen(PORT, () => console.log('READY ' + PORT));
