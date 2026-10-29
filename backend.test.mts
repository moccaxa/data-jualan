import { randomBytes } from 'node:crypto';
process.env.RJ_MEMORY_DB = '1';
process.env.DATA_ENC_KEY = randomBytes(32).toString('base64');
process.env.SESSION_SECRET = randomBytes(48).toString('base64url');
const R = new URL('../', import.meta.url).pathname;
const { hashPassword, makeToken, checkToken, verifyPassword } = await import(R + 'netlify/functions/_lib/auth');
process.env.ADMIN_PASSWORD_HASH = hashPassword('rahasia-admin-123');
const { encrypt, decrypt, isEnc } = await import(R + 'netlify/functions/_lib/crypto');
const { mergeSync } = await import(R + 'shared/sync');
const { validateStored } = await import(R + 'shared/validate');
const { txToRow, rowsToTx, hashTx, HEADER } = await import(R + 'netlify/functions/_lib/sheetmap');
let fail = 0; const eq = (n: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };

// --- crypto
const e = encrypt('P@ss w0rd!'); eq('enkripsi roundtrip', decrypt(e), 'P@ss w0rd!'); eq('ciphertext tidak memuat plaintext', e.includes('P@ss'), false);
eq('IV acak: dua enkripsi berbeda', encrypt('x') !== encrypt('x'), true); eq('format enc dikenali', isEnc(e), true);
const parts = e.split(':'); parts[3] = Buffer.from('rusak').toString('base64'); let tampered = false; try { decrypt(parts.join(':')); } catch { tampered = true; }
eq('data dimodifikasi ditolak (GCM)', tampered, true); eq('string kosong tetap kosong', encrypt(''), '');
// --- auth token
const tok = makeToken(); eq('token valid', checkToken(tok), true);
eq('token kadaluarsa', checkToken(tok, Date.now() + 8 * 86400_000), false);
eq('token dipalsukan', checkToken(tok.split('.')[0] + '.AAAA'), false); eq('tanpa token', checkToken(undefined), false);
// --- password admin: hash vs ADMIN_PASSWORD
{ const h = process.env.ADMIN_PASSWORD_HASH; eq('hash scrypt: benar/salah', [verifyPassword('rahasia-admin-123'), verifyPassword('salah')], [true, false]);
  delete process.env.ADMIN_PASSWORD_HASH; process.env.ADMIN_PASSWORD = 'password-polos-123';
  eq('ADMIN_PASSWORD: benar/salah', [verifyPassword('password-polos-123'), verifyPassword('password-polos-124'), verifyPassword('')], [true, false, false]);
  process.env.ADMIN_PASSWORD = 'pendek'; let thrown = false; try { verifyPassword('pendek'); } catch { thrown = true; } eq('ADMIN_PASSWORD < 12 karakter ditolak', thrown, true);
  process.env.ADMIN_PASSWORD = 'password-polos-123'; process.env.ADMIN_PASSWORD_HASH = h; eq('hash didahulukan bila keduanya ada', verifyPassword('password-polos-123'), false);
  delete process.env.ADMIN_PASSWORD; }
// --- validate
const base: any = { id: 'TX-1', buyerName: 'Budi', whatsapp: '6281234567890', product: 'Zoom', plan: 'Private', variation: '', durationValue: 1, durationUnit: 'month', orderDate: '2026-10-01', startDate: '2026-10-01', expiryDate: '2026-11-01', expiryManual: false, accountEmail: 'a@b.c', accountPasswordEnc: '', sellPrice: 10000, costPrice: 5000, quantity: 1, supplier: '', notes: '', cancelled: false, reminderEnabled: true, reminderOffsets: [1, 7, 7], followedUp: false, createdAt: 'x', updatedAt: 'x', version: 1 };
const SB: any = { ...base, buyerId: 'BY-TEST1' };
eq('validasi lolos + offset unik terurut', (validateStored(SB) as any).v.reminderOffsets, [7, 1]);
eq('tolak harga negatif', validateStored({ ...SB, sellPrice: -1 }).ok, false);
eq('tolak plan asing', validateStored({ ...SB, plan: 'Gold' }).ok, false);
eq('tolak tanggal 31 Feb', validateStored({ ...SB, orderDate: '2026-02-31' }).ok, false);
eq('tolak habis < mulai', validateStored({ ...SB, expiryDate: '2026-09-01' }).ok, false);
eq('field asing dibuang', 'hack' in (validateStored({ ...SB, hack: 1 }) as any).v, false);
// --- sheetmap
const rt = rowsToTx([HEADER, txToRow(SB)], { encrypt, isEnc, genId: () => 'TX-NEW', now: 'n' });
eq('baris Sheets roundtrip tanpa error', rt.errors, []); eq('roundtrip hash sama', hashTx(rt.items[0]), hashTx(validateStored(SB).ok ? (validateStored(SB) as any).v : null));
const row = txToRow(SB); row[HEADER.indexOf('Tanggal Habis')] = '01/12/2026'; row[HEADER.indexOf('Harga Jual')] = 'Rp 12.500'; row[HEADER.indexOf('WhatsApp')] = '81234567890';
const loose = rowsToTx([HEADER, row], { encrypt, isEnc, genId: () => 'X', now: 'n' }).items[0];
eq('format tanggal/harga/WA longgar dari Sheets', [loose.expiryDate, loose.sellPrice, loose.whatsapp], ['2026-12-01', 12500, '6281234567890']);
const pwRow = txToRow(SB); pwRow[HEADER.indexOf('Password (terenkripsi)')] = 'polos123';
const pwItem = rowsToTx([HEADER, pwRow], { encrypt, isEnc, genId: () => 'X', now: 'n' }).items[0];
eq('password polos di Sheets dienkripsi', [isEnc(pwItem.accountPasswordEnc), decrypt(pwItem.accountPasswordEnc)], [true, 'polos123']);
const noId = txToRow(SB); noId[0] = ''; eq('ID kosong diberi ID baru', rowsToTx([HEADER, noId], { encrypt, isEnc, genId: () => 'TX-NEW', now: 'n' }).items[0].id, 'TX-NEW');
const bad = txToRow(SB); bad[HEADER.indexOf('WhatsApp')] = '123';
eq('baris tidak valid dilaporkan', rowsToTx([HEADER, txToRow(SB), bad], { encrypt, isEnc, genId: () => 'X', now: 'n' }).errors.map(x => x.row), [3]);
eq('ID duplikat dilaporkan', rowsToTx([HEADER, txToRow(SB), txToRow(SB)], { encrypt, isEnc, genId: () => 'X', now: 'n' }).errors.length, 1);
// --- merge
const H = (t: any) => JSON.stringify([t.notes, t.sellPrice, t.deletedAt ?? '']);
const mk = (o: any = {}): any => ({ ...base, ...o });
const m = (web: any[], sheet: any[], b: any) => mergeSync({ web, sheet, base: b, hash: H, now: 'NOW' });
const b0 = { 'TX-1': H(mk()) };
let o = m([mk()], [mk()], b0); eq('tidak ada perubahan', o.stats, { toSheet: 0, toWeb: 0, conflicts: 0, unchanged: 1 });
o = m([mk({ notes: 'web' })], [mk()], b0); eq('web berubah → web menang', [o.merged[0].notes, o.stats.toSheet], ['web', 1]);
o = m([mk()], [mk({ notes: 'sheet' })], b0); eq('sheet berubah → sheet menang + versi naik', [o.merged[0].notes, o.merged[0].version], ['sheet', 2]);
o = m([mk({ notes: 'web' })], [mk({ notes: 'sheet' })], b0); eq('konflik → web menang, sheet dicatat', [o.merged[0].notes, o.conflicts.length, o.conflicts[0].notes], ['web', 1, 'sheet']);
o = m([], [mk({ id: 'TX-9' })], {}); eq('baris baru di Sheets → masuk web', [o.merged.length, o.stats.toWeb], [1, 1]);
o = m([mk()], [], {}); eq('transaksi baru di web → ke Sheets', [o.merged.length, o.stats.toSheet], [1, 1]);
o = m([mk()], [], b0); eq('baris dihapus di Sheets → hapus lunak di web', [o.merged[0].deletedAt, o.merged.length], ['NOW', 1]);
o = m([mk({ notes: 'web' })], [], b0); eq('dihapus di Sheets tapi web berubah → web dipertahankan', [o.merged[0].deletedAt, o.merged[0].notes], [undefined, 'web']);
o = m([mk({ deletedAt: 'D' })], [mk()], b0); eq('hapus di web → sheet ikut (deletedAt)', o.merged[0].deletedAt, 'D');
const s1 = m([mk()], [mk({ notes: 'sheet' })], b0); const s2 = m(s1.merged, s1.merged, s1.base);
eq('sinkron ulang stabil (tanpa data ganda)', [s2.merged.length, s2.stats.unchanged, s2.stats.toWeb + s2.stats.toSheet], [1, 1, 0]);

// --- handler end-to-end (memori)
const call = async (mod: string, path: string, init: RequestInit & { cookie?: string } = {}) => {
  const h = (await import(R + 'netlify/functions/' + mod)).default;
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.method && init.method !== 'GET' ? { 'x-rekap': '1' } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) };
  const res: Response = await h(new Request('https://x.test' + path, { ...init, headers })); return { res, body: await res.json() as any };
};
let r = await call('transactions', '/api/transactions'); eq('tanpa login → 401', r.res.status, 401);
r = await call('auth-login', '/api/auth-login', { method: 'POST', body: JSON.stringify({ password: 'salah' }) }); eq('password salah → 401', r.res.status, 401);
r = await call('auth-login', '/api/auth-login', { method: 'POST', body: JSON.stringify({ password: 'rahasia-admin-123' }) });
const setCookie = r.res.headers.get('set-cookie')!; const cookie = setCookie.split(';')[0];
eq('login berhasil', r.res.status, 200); eq('cookie HttpOnly+Secure+Strict', ['HttpOnly', 'Secure', 'SameSite=Strict'].every(x => setCookie.includes(x)), true);
r = await call('transactions', '/api/transactions', { method: 'POST', cookie, body: JSON.stringify({ ...base, accountPassword: 'pw-rahasia' }), headers: {} });
eq('buat transaksi', r.res.status, 200); eq('respons tanpa password', ['accountPassword' in r.body.item, 'accountPasswordEnc' in r.body.item, r.body.item.hasPassword], [false, false, true]);
const noHdr = await (await import(R + 'netlify/functions/transactions')).default(new Request('https://x.test/api/transactions', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(base) }));
eq('POST tanpa header X-Rekap → 403', noHdr.status, 403);
r = await call('transactions', '/api/transactions', { cookie }); eq('daftar tidak memuat password/enc', JSON.stringify(r.body).includes('pw-rahasia') || JSON.stringify(r.body).includes('v1:'), false);
r = await call('transactions', '/api/transactions?id=TX-1', { cookie }); eq('reveal mengembalikan password asli', r.body.password, 'pw-rahasia');
const { db } = await import(R + 'netlify/functions/_lib/db'); eq('di database tersimpan terenkripsi', ((await db.tx())[0].accountPasswordEnc).includes('pw-rahasia'), false);
r = await call('transactions', '/api/transactions', { method: 'POST', cookie, body: JSON.stringify({ ...base, notes: 'edit', baseVersion: 1 }) });
eq('edit tanpa password → password lama tetap', [r.res.status, r.body.item.version, (await call('transactions', '/api/transactions?id=TX-1', { cookie })).body.password], [200, 2, 'pw-rahasia']);
r = await call('transactions', '/api/transactions', { method: 'POST', cookie, body: JSON.stringify({ ...base, notes: 'basi', baseVersion: 1 }) }); eq('versi basi → 409', r.res.status, 409);
r = await call('transactions', '/api/transactions', { method: 'POST', cookie, body: JSON.stringify({ ...base, id: 'TX-2', sellPrice: -5 }) }); eq('data tidak valid → 422', r.res.status, 422);
r = await call('transactions', '/api/transactions?action=bulk', { method: 'POST', cookie, body: JSON.stringify({ items: [{ ...base, id: 'TX-1' }, { ...base, id: 'TX-3', accountPassword: 'bulk-pw' }] }) });
eq('bulk: id bentrok diberi id baru', [r.res.status, r.body.added, r.body.items[0].id !== 'TX-1'], [200, 2, true]);
r = await call('transactions', '/api/transactions?id=TX-1', { method: 'DELETE', cookie }); eq('hapus', r.res.status, 200);
r = await call('transactions', '/api/transactions', { cookie }); eq('hapus lunak: tidak muncul di daftar', r.body.items.some((t: any) => t.id === 'TX-1'), false);
r = await call('settings', '/api/settings', { method: 'PUT', cookie, body: JSON.stringify({ monthOptions: [1, 2], dayOptions: [], warnDays: 7 }) }); eq('settings tidak valid → 422', r.res.status, 422);
r = await call('settings', '/api/settings', { method: 'PUT', cookie, body: JSON.stringify({ monthOptions: [3, 1], dayOptions: [7], warnDays: 5 }) }); eq('settings tersimpan terurut', r.body.settings.monthOptions, [1, 3]);
r = await call('reminder-logs', '/api/reminder-logs', { method: 'POST', cookie, body: JSON.stringify({ txId: 'TX-3x', offset: 7, sendDate: '2026-10-25' }) }); eq('log untuk tx tak ada → 422', r.res.status, 422);
const id3 = (await db.tx()).find(t => t.id !== 'TX-1' && !t.deletedAt)!.id;
r = await call('reminder-logs', '/api/reminder-logs', { method: 'POST', cookie, body: JSON.stringify({ txId: id3, offset: 7, sendDate: '2026-10-25' }) }); eq('tandai ditindaklanjuti', [r.res.status, r.body.item.key], [200, `${id3}|7|2026-10-25`]);
// backup/restore
const bk = await db.backup('uji'); await db.setTx([]); await db.restore(bk); eq('restore memulihkan data', (await db.tx()).length, 3);
eq('restore membuat backup pengaman', (await db.backups()).some(b => b.label === 'pre-restore'), true);
// lockout
for (let i = 0; i < 5; i++) await call('auth-login', '/api/auth-login', { method: 'POST', body: JSON.stringify({ password: 'x' }) });
r = await call('auth-login', '/api/auth-login', { method: 'POST', body: JSON.stringify({ password: 'rahasia-admin-123' }) }); eq('lockout setelah 5 gagal → 429', r.res.status, 429);
console.log(fail ? `${fail} GAGAL` : 'SEMUA LULUS');
