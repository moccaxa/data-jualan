import { randomBytes } from 'node:crypto';
process.env.RJ_MEMORY_DB = '1';
process.env.DATA_ENC_KEY = randomBytes(32).toString('base64');
process.env.SESSION_SECRET = randomBytes(48).toString('base64url');
const TOKEN = '123456:SECRET-TOKEN-XYZ'; process.env.TELEGRAM_BOT_TOKEN = TOKEN;
const R = new URL('../', import.meta.url).pathname;
const { hashPassword } = await import(R + 'netlify/functions/_lib/auth'); process.env.ADMIN_PASSWORD_HASH = hashPassword('rahasia-admin-123');
const { db } = await import(R + 'netlify/functions/_lib/db');
const { encrypt } = await import(R + 'netlify/functions/_lib/crypto');
const { runReminders } = await import(R + 'netlify/functions/_lib/reminderEngine');
const { sendMessage, TelegramError } = await import(R + 'netlify/functions/_lib/telegram');
const { buildReminderMessage } = await import(R + 'shared/message');
const { validateStored } = await import(R + 'shared/validate');

let mode = 'ok'; const sent: { chat: string; text: string }[] = []; let calls = 0; let delay = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input), method = u.split('/').pop()!; calls++;
  if (!u.startsWith(`https://api.telegram.org/bot${TOKEN}/`)) throw new Error('URL tak terduga ' + u);
  const body = JSON.parse(String(init?.body ?? '{}')); const r = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s });
  if (delay) await new Promise(x => setTimeout(x, delay));
  if (mode === 'net') throw new Error('ECONNRESET ' + u); // pesan asli memuat URL+token: harus tidak bocor
  if (mode === 'token') return r({ ok: false, description: 'Unauthorized' }, 401);
  if (mode === 'blocked') return r({ ok: false, description: 'Forbidden: bot was blocked by the user' }, 403);
  if (mode === 'chat') return r({ ok: false, description: 'Bad Request: chat not found' }, 400);
  if (mode === 'rate') return r({ ok: false, description: 'Too Many Requests', parameters: { retry_after: 7 } }, 429);
  if (method === 'getMe') return r({ ok: true, result: { username: 'rekap_bot', first_name: 'Rekap' } });
  if (method === 'getUpdates') return r({ ok: true, result: [{ message: { chat: { id: 111, type: 'private', first_name: 'Admin', username: 'adm' } } }, { my_chat_member: { chat: { id: -100222, type: 'group', title: 'Grup Jualan' } } }, { message: { chat: { id: 111, type: 'private', first_name: 'Admin' } } }] });
  if (method === 'sendMessage') { sent.push({ chat: String(body.chat_id), text: body.text }); return r({ ok: true, result: { message_id: sent.length } }); }
  return r({ ok: false }, 404);
}) as typeof fetch;

let fail = 0; const eq = (n: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
const mk = (id: string, o: object = {}) => { const r = validateStored({ id, buyerId: 'BY-T1', buyerName: 'Budi ' + id, whatsapp: '6281234567890', product: 'Zoom Premium', plan: 'Private', variation: 'Pro', durationValue: 1, durationUnit: 'month', orderDate: '2026-10-02', startDate: '2026-10-02', expiryDate: '2026-11-02', expiryManual: false, accountEmail: 'rahasia@mail.com', accountPasswordEnc: encrypt('PASSWORD-RAHASIA'), sellPrice: 10000, costPrice: 5000, quantity: 1, supplier: 'FH Satu', notes: 'catatan uji', cancelled: false, reminderEnabled: true, reminderOffsets: [7], followedUp: false, createdAt: 'x', updatedAt: 'x', version: 1, ...o }); if (!r.ok) throw new Error(r.error); return r.v; };
const NOW = new Date('2026-10-26T01:30:00Z'); // 08:30 WIB; tx.expiry 2 Nov - 7 hari = 26 Okt
const BEFORE = new Date('2026-10-26T00:30:00Z'); // 07:30 WIB
const reset = async (txs = [mk('TX-1')], tg = {}) => { await db.setTx(txs); await db.setLogs([]); await db.setTg({ enabled: true, chatId: '555', sendHour: 8, offsets: [14, 7, 3, 1, 0], ...tg }); sent.length = 0; mode = 'ok'; delay = 0; };

// pesan
const msg = buildReminderMessage(mk('TX-1'), '2026-10-26');
eq('pesan memuat field sesuai format', ['🔔 REMINDER MASA AKTIF', 'Buyer: Budi TX-1', 'Plan: Private', 'Durasi: 1 bulan', 'Tanggal Habis: 2 November 2026', 'Sisa Durasi: 7 hari', 'FH / Beli di Siapa: FH Satu', 'Catatan: catatan uji'].every(s => msg.includes(s)), true);
eq('pesan TIDAK memuat password/email', msg.includes('PASSWORD') || msg.includes('rahasia@'), false);
// engine
await reset([mk('TX-1')], { enabled: false }); let r = await runReminders({ now: NOW }); eq('nonaktif → tidak kirim', [sent.length, r.sent], [0, 0]);
await reset(); r = await runReminders({ now: BEFORE }); eq('sebelum jam kirim → tidak kirim', sent.length, 0);
await reset(); r = await runReminders({ now: NOW }); eq('jam kirim → terkirim 1', [r.sent, sent.length, sent[0]?.chat], [1, 1, '555']);
eq('log: Terjadwal(klaim) lalu Terkirim', (await db.logs()).map(l => l.status), ['Terjadwal', 'Terkirim']);
r = await runReminders({ now: new Date('2026-10-26T05:00:00Z') }); eq('jalan ulang → TIDAK terkirim ganda', [sent.length, r.skipped], [1, 1]);
await reset([mk('TX-1')]); const [a, b] = await Promise.all([runReminders({ now: NOW }), runReminders({ now: NOW })]); eq('dua proses bersamaan → hanya satu pesan', [sent.length, a.sent + b.sent], [1, 1]);
await reset([mk('TX-1')], { offsets: [14, 3] }); await runReminders({ now: NOW }); eq('offset tidak dipilih di pengaturan global → tidak kirim', sent.length, 0);
await reset([mk('TX-1', { reminderEnabled: false }), mk('TX-2', { cancelled: true }), mk('TX-3', { deletedAt: 'D' }), mk('TX-4', { reminderOffsets: [3] })]); await runReminders({ now: NOW });
eq('reminder nonaktif/dibatalkan/dihapus/offset lain → tidak kirim', sent.length, 0);
await reset([mk('TX-1', { expiryDate: '2026-11-09', expiryManual: true })]); await runReminders({ now: NOW }); eq('tanggal habis diubah → jadwal bergeser, tidak kirim di tanggal lama', sent.length, 0);
await runReminders({ now: new Date('2026-11-02T01:30:00Z') }); eq('...dan terkirim di tanggal baru (9 Nov − 7 = 2 Nov)', sent.length, 1);
await reset([mk('TX-1')]); await db.setLogs([{ key: 'TX-1|7|2026-10-26', txId: 'TX-1', offset: 7, sendDate: '2026-10-26', status: 'Ditindaklanjuti', at: 'x', channel: 'manual' }]); await runReminders({ now: NOW }); eq('sudah ditindaklanjuti → tidak kirim', sent.length, 0);
// kegagalan
await reset(); mode = 'chat'; r = await runReminders({ now: NOW }); let logs = await db.logs();
eq('chat salah → Gagal + pesan ramah', [r.failed, logs.at(-1)!.status, logs.at(-1)!.detail!.includes('Chat ID tidak ditemukan')], [1, 'Gagal', true]);
mode = 'ok'; r = await runReminders({ now: NOW }); eq('kegagalan eksplisit dicoba ulang & berhasil', [r.sent, sent.length, (await db.logs()).at(-1)!.status], [1, 1, 'Terkirim']);
await reset(); mode = 'chat'; for (let i = 0; i < 5; i++) await runReminders({ now: NOW }); eq('berhenti mencoba setelah 3 kegagalan', (await db.logs()).filter(l => l.status === 'Gagal').length, 3);
await reset([mk('TX-1'), mk('TX-2')]); mode = 'net'; r = await runReminders({ now: NOW }); eq('error jaringan → semua dicoba, tanpa kebocoran token', [r.failed, JSON.stringify(await db.logs()).includes('SECRET-TOKEN')], [2, false]);
await reset([mk('TX-1'), mk('TX-2')]); mode = 'rate'; r = await runReminders({ now: NOW }); eq('rate limit → berhenti, sisanya tidak dicoba', [r.failed, calls > 0, r.notes.some(n => n.includes('Dihentikan'))], [1, true, true]);
await reset(); await db.setLogs([{ key: 'TX-1|7|2026-10-26', txId: 'TX-1', offset: 7, sendDate: '2026-10-26', status: 'Terjadwal', at: 'x', channel: 'telegram', detail: 'mengirim' }]);
await runReminders({ now: NOW }); await runReminders({ now: NOW }); eq('proses terhenti saat kirim (hasil tak diketahui) → TIDAK dikirim ulang', [sent.length, (await db.logs()).at(-1)!.detail!.startsWith('Tidak diketahui')], [0, true]);
await reset(); await db.setTg({ enabled: true, chatId: '', sendHour: 8, offsets: [7] }); r = await runReminders({ now: NOW }); eq('tanpa Chat ID → error jelas', [sent.length, r.error], [0, 'Chat ID belum diatur.']);
process.env.TELEGRAM_CHAT_ID = '999'; await runReminders({ now: NOW }); eq('fallback ke TELEGRAM_CHAT_ID', sent[0]?.chat, '999'); delete process.env.TELEGRAM_CHAT_ID;
// pemetaan error
const code = async (m: string) => { mode = m; try { await sendMessage('1', 'x'); return 'ok'; } catch (e) { return (e as InstanceType<typeof TelegramError>).kind + ':' + (e as Error).message.includes(TOKEN); } };
eq('401 → token', await code('token'), 'token:false'); eq('403 → blocked', await code('blocked'), 'blocked:false'); eq('429 → rate', await code('rate'), 'rate:false'); eq('network → tanpa token di pesan', await code('net'), 'network:false');
mode = 'ok'; delete process.env.TELEGRAM_BOT_TOKEN; eq('tanpa token → pesan env', await code('ok'), 'token:false'); process.env.TELEGRAM_BOT_TOKEN = TOKEN;
// handler /api/telegram
const call = async (mod: string, path: string, init: RequestInit & { cookie?: string; hdr?: Record<string, string> } = {}) => {
  const h = (await import(R + 'netlify/functions/' + mod)).default;
  const res: Response = await h(new Request('https://x.test' + path, { ...init, headers: { 'content-type': 'application/json', ...(init.method && init.method !== 'GET' && !init.hdr ? { 'x-rekap': '1' } : {}), ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.hdr ?? {}) } })); return { res, body: await res.json() as any };
};
eq('/api/telegram tanpa login → 401', (await call('telegram', '/api/telegram')).res.status, 401);
const login = await call('auth-login', '/api/auth-login', { method: 'POST', body: JSON.stringify({ password: 'rahasia-admin-123' }) }); const cookie = login.res.headers.get('set-cookie')!.split(';')[0];
const put = (o: object) => call('telegram', '/api/telegram', { method: 'PUT', cookie, body: JSON.stringify(o) });
eq('chat ID tidak valid ditolak', (await put({ enabled: true, chatId: 'abc; DROP', sendHour: 8, offsets: [7] })).res.status, 422); eq('jam 24 ditolak', (await put({ enabled: true, chatId: '123456', sendHour: 24, offsets: [7] })).res.status, 422);
let p = await put({ enabled: true, chatId: '-100123456', sendHour: 9, offsets: [1, 7, 7] }); eq('simpan pengaturan (grup, offset unik)', [p.res.status, p.body.settings.chatId, p.body.settings.offsets], [200, '-100123456', [7, 1]]);
eq('status tidak membocorkan token', JSON.stringify(p.body).includes('SECRET'), false);
const act = (action: string, x: object = {}) => call('telegram', '/api/telegram', { method: 'POST', cookie, body: JSON.stringify({ action, ...x }) });
eq('connect → username bot', (await act('connect')).body.bot.username, 'rekap_bot');
eq('detect → daftar chat unik', (await act('detect')).body.chats, [{ id: 111, type: 'private', name: 'Admin' }, { id: -100222, type: 'group', name: 'Grup Jualan' }]);
await reset([mk('TX-1')], { chatId: '777' }); let t = await act('test'); eq('tes koneksi terkirim & tercatat di riwayat', [t.res.status, sent.at(-1)!.chat, t.body.history[0].detail], [200, '777', 'Pesan tes koneksi']);
t = await act('test-reminder', { txId: 'TX-1', offset: 7 }); eq('tes reminder berawalan TES, tanpa password', [sent.at(-1)!.text.startsWith('🧪 TES'), sent.at(-1)!.text.includes('PASSWORD')], [true, false]);
sent.length = 0; await runReminders({ now: NOW }); eq('tes tidak mengganggu dedupe: jadwal asli tetap terkirim sekali', sent.length, 1);
mode = 'chat'; t = await act('test'); eq('tes gagal → 502 + pesan ramah + tercatat Gagal', [t.res.status, t.body.error.includes('Chat ID'), (await db.logs()).at(-1)!.status], [502, true, 'Gagal']); mode = 'ok';
await db.setTg({ enabled: true, chatId: '', sendHour: 8, offsets: [7] }); eq('tes tanpa chat ID → 400', (await act('test')).res.status, 400);
// cron + trigger
await reset(); const cron = (await import(R + 'netlify/functions/reminder-cron')).default; const cr: Response = await cron(); eq('cron handler berjalan', [cr.status, (await cr.json()).failed], [200, 0]);
eq('cron terjadwal tiap jam', (await import(R + 'netlify/functions/reminder-cron')).config.schedule, '0 * * * *');
const trig = (secret?: string, method = 'POST') => call('reminder-trigger', '/api/reminder-trigger', { method, hdr: secret ? { 'x-cron-secret': secret } : {} });
eq('trigger nonaktif tanpa CRON_SECRET → 404', (await trig('x')).res.status, 404);
process.env.CRON_SECRET = 'rahasia-cron-yang-cukup-panjang-123'; eq('rahasia salah → 401', (await trig('salah-salah-salah-salah-salah')).res.status, 401); eq('tanpa header → 401', (await trig()).res.status, 401);
await reset(); eq('rahasia benar → 200 dan menjalankan engine', [(await trig('rahasia-cron-yang-cukup-panjang-123')).res.status], [200]);
console.log(fail ? `${fail} GAGAL` : 'SEMUA LULUS');
