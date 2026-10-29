// Google Sheets palsu di memori: menegakkan batas grid seperti API asli, agar kode google.ts & syncService.ts benar-benar dijalankan.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
process.env.RJ_MEMORY_DB = '1';
process.env.DATA_ENC_KEY = randomBytes(32).toString('base64');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
process.env.GOOGLE_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'bot@proj.iam.gserviceaccount.com';
process.env.GOOGLE_SHEET_ID = 'SHEET123';
const { db } = await import('../netlify/functions/_lib/db');
const { encrypt, decrypt, isEnc } = await import('../netlify/functions/_lib/crypto');
const { runSync } = await import('../netlify/functions/_lib/syncService');
const { HEADER } = await import('../netlify/functions/_lib/sheetmap');
const { validateStored } = await import('../shared/validate');

interface Sh { id: number; rows: string[][]; rc: number; cc: number }
const sheets = new Map<string, Sh>(); let nextId = 1; let forceStatus = 0; let calls = 0;
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input)), method = init?.method ?? 'GET'; calls++;
  if (url.host === 'oauth2.googleapis.com') return String(init?.body).includes('assertion=') && String(init?.body).split('assertion=')[1].split('.').length === 3 ? j({ access_token: 'tok', expires_in: 3600 }) : j({}, 400);
  if (forceStatus) return j({ error: 'x' }, forceStatus);
  const path = decodeURIComponent(url.pathname.replace('/v4/spreadsheets/SHEET123', '')), body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (path === '' && method === 'GET') return j({ sheets: [...sheets].map(([title, s]) => ({ properties: { sheetId: s.id, title, gridProperties: { rowCount: s.rc, columnCount: s.cc } } })) });
  if (path === ':batchUpdate') {
    for (const r of body.requests) {
      if (r.addSheet) { const p = r.addSheet.properties; sheets.set(p.title, { id: nextId++, rows: [], rc: p.gridProperties.rowCount, cc: p.gridProperties.columnCount }); }
      if (r.updateSheetProperties) { const s = [...sheets.values()].find(x => x.id === r.updateSheetProperties.properties.sheetId)!; s.rc = r.updateSheetProperties.properties.gridProperties.rowCount; s.cc = r.updateSheetProperties.properties.gridProperties.columnCount; }
    } return j({});
  }
  const m = /^\/values\/'(.+)'!(.+?)(:clear|:append)?$/.exec(path); if (!m) return j({ error: 'rute tak dikenal ' + path }, 404);
  const s = sheets.get(m[1])!; if (!s) return j({}, 400);
  if (m[3] === ':clear') { s.rows = []; return j({}); }
  if (m[3] === ':append') { s.rows.push(...body.values); return j({}); }
  if (method === 'PUT') { if (body.values.length > s.rc || Math.max(...body.values.map((r: string[]) => r.length)) > s.cc) return j({ error: 'exceeds grid limits' }, 400); s.rows = body.values; return j({}); }
  return j(m[2] === 'A1:A1' ? (s.rows[0] ? { values: [[s.rows[0][0]]] } : {}) : s.rows.length ? { values: s.rows } : {});
}) as typeof fetch;

let fail = 0; const eq = (n: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
const mk = (id: string, o: object = {}) => { const r = validateStored({ id, buyerId: 'BY-T1', buyerName: 'Buyer Uji', whatsapp: '6281234567890', product: 'Zoom', plan: 'Private', variation: '', durationValue: 1, durationUnit: 'month', orderDate: '2026-10-01', startDate: '2026-10-01', expiryDate: '2026-11-01', expiryManual: false, accountEmail: '', accountPasswordEnc: encrypt('pw-' + id), sellPrice: 10000, costPrice: 5000, quantity: 1, supplier: '', notes: '', cancelled: false, reminderEnabled: true, reminderOffsets: [7, 1], followedUp: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', version: 1, ...o }); if (!r.ok) throw new Error(r.error); return r.v; };
const col = (l: string) => HEADER.indexOf(l);
const txRows = () => sheets.get('Transaksi')!.rows;
const rowOf = (id: string) => txRows().find(r => r[0] === id)!;

await db.setBuyers([{ id: 'BY-T1', name: 'Buyer Uji', whatsapp: '6281234567890', notes: '', createdAt: 'x', updatedAt: 'x', version: 1 }]);
await db.setTx([mk('TX-A'), mk('TX-B')]);
let meta = await runSync('connect');
eq('connect membuat 5 sheet', [...sheets.keys()].sort(), ['Buyers', 'Konflik', 'Pengaturan', 'Riwayat Reminder', 'Transaksi']); eq('header Transaksi tertulis', txRows()[0], HEADER);
meta = await runSync('sync'); eq('sync pertama: 2 transaksi + 1 buyer ke Sheets', [meta.lastStatus, txRows().length, meta.stats?.toSheet], ['ok', 3, 3]);
eq('Sheets tidak memuat password polos', JSON.stringify(txRows()).includes('pw-TX'), false);
eq('Sheets memuat password terenkripsi', isEnc(rowOf('TX-A')[col('Password (terenkripsi)')]), true);
// edit di Sheets
rowOf('TX-A')[col('Catatan')] = 'diedit di sheets';
meta = await runSync('sync'); let web = await db.tx();
eq('edit di Sheets masuk ke website', [web.find(t => t.id === 'TX-A')!.notes, web.find(t => t.id === 'TX-A')!.version], ['diedit di sheets', 2]);
eq('backup otomatis dibuat sebelum mengubah website', (await db.backups()).some(b => b.label === 'auto-sebelum-sync'), true);
// edit di web
await db.setTx(web.map(t => (t.id === 'TX-B' ? { ...t, notes: 'diedit di web', version: t.version + 1 } : t)));
await runSync('sync'); eq('edit di website masuk ke Sheets', rowOf('TX-B')[col('Catatan')], 'diedit di web');
// konflik
rowOf('TX-A')[col('Catatan')] = 'versi sheets'; web = await db.tx();
await db.setTx(web.map(t => (t.id === 'TX-A' ? { ...t, notes: 'versi web', version: t.version + 1 } : t)));
meta = await runSync('sync'); web = await db.tx();
eq('konflik: web menang', [web.find(t => t.id === 'TX-A')!.notes, rowOf('TX-A')[col('Catatan')], meta.stats?.conflicts], ['versi web', 'versi web', 1]);
eq('konflik tercatat di sheet Konflik (tanpa password)', [sheets.get('Konflik')!.rows.length, JSON.stringify(sheets.get('Konflik')!.rows).includes('versi sheets'), JSON.stringify(sheets.get('Konflik')!.rows).includes('v1:')], [2, true, false]);
// baris baru manual + password polos
const nr = txRows()[1].map(() => ''); nr[col('Nama Buyer')] = 'Manual'; nr[col('WhatsApp')] = '081355550000'; nr[col('Produk')] = 'Canva'; nr[col('Plan')] = 'sharing';
nr[col('Tanggal Order')] = '2026-10-05'; nr[col('Durasi (angka)')] = '30'; nr[col('Satuan Durasi')] = 'hari'; nr[col('Tanggal Habis')] = '2026-11-04'; nr[col('Harga Jual')] = '20000'; nr[col('Password (terenkripsi)')] = 'ketik-polos';
txRows().push(nr); await runSync('sync'); web = await db.tx(); const man = web.find(t => t.buyerName === 'Manual')!;
eq('baris manual masuk website dengan ID baru & plan dinormalisasi', [!!man?.id, man?.plan, man?.whatsapp], [true, 'Sharing', '6281355550000']);
eq('password polos dienkripsi & dapat dibuka', decrypt(man.accountPasswordEnc), 'ketik-polos');
eq('Sheets diperbarui: ID terisi, password tidak polos', [rowOf(man.id) !== undefined, JSON.stringify(txRows()).includes('ketik-polos')], [true, false]);
const before = (await db.tx()).length; await runSync('sync'); eq('sinkron ulang tidak membuat data ganda', (await db.tx()).length, before);
// baris tidak valid
const goodRows = txRows().length; txRows()[1][col('WhatsApp')] = '12';
let err = ''; try { await runSync('sync'); } catch (e) { err = (e as Error).message; }
eq('baris tidak valid → sinkron dibatalkan, pesan menyebut baris', [err.includes('baris 2'), (await db.tx()).length], [true, before]);
eq('meta mencatat error', (await db.meta()).lastStatus, 'error'); txRows()[1][col('WhatsApp')] = '6281234567890';
// hapus baris di Sheets
const victim = txRows()[2][0]; sheets.get('Transaksi')!.rows = txRows().filter(r => r[0] !== victim);
await runSync('sync'); eq('baris dihapus di Sheets → dihapus lunak di website', !!(await db.tx()).find(t => t.id === victim)?.deletedAt, true);
eq('baris terhapus tetap ada di Sheets dengan kolom Dihapus', !!rowOf(victim)?.[col('Dihapus')], true);

// ================= BUYERS di Google Sheets =================
const { BUYER_HEADER } = await import('../netlify/functions/_lib/sheetmap');
const bcol = (l: string) => BUYER_HEADER.indexOf(l);
const buyerRows = () => sheets.get('Buyers')!.rows; const brow = (id: string) => buyerRows().find(r => r[0] === id)!;
const mkB = (id: string, name: string, phone: string) => ({ id, name, whatsapp: phone, notes: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', version: 1 });
const mkT = (id: string, buyer: any, o: object = {}) => mk(id, { buyerId: buyer.id, buyerName: buyer.name, whatsapp: buyer.whatsapp, ...o });
await db.setBuyers([mkB('BY-1', 'Ana', '6281200000001'), mkB('BY-2', 'Budi', '6281200000002')]);
await db.setTx([mkT('TX-S1', mkB('BY-1', 'Ana', '6281200000001'), { sellPrice: 10000, costPrice: 4000, quantity: 2, orderDate: '2026-10-01' }), mkT('TX-S2', mkB('BY-1', 'Ana', '6281200000001'), { orderDate: '2026-10-10' }),
  mkT('TX-S3', mkB('BY-1', 'Ana', '6281200000001'), { cancelled: true }), mkT('TX-S4', mkB('BY-2', 'Budi', '6281200000002'), { orderDate: '2026-09-05' })]);
meta = await runSync('push');
eq('sheet Buyers: header sesuai spesifikasi', buyerRows()[0].slice(0, 10), ['ID Buyer', 'Nama Buyer', 'Nomor WhatsApp', 'Tanggal Pertama Order', 'Tanggal Terakhir Order', 'Total Order', 'Total Omzet', 'Total Modal', 'Total Keuntungan', 'Catatan']);
eq('statistik buyer dihitung dari transaksi valid (batal tidak dihitung, qty × harga)', [brow('BY-1')[bcol('Total Order')], brow('BY-1')[bcol('Total Omzet')], brow('BY-1')[bcol('Total Modal')], brow('BY-1')[bcol('Total Keuntungan')], brow('BY-1')[bcol('Tanggal Pertama Order')], brow('BY-1')[bcol('Tanggal Terakhir Order')]], ['2', '30000', '13000', '17000', '2026-10-01', '2026-10-10']);
meta = await runSync('sync'); eq('sync setelah push: tidak ada perubahan', [meta.stats?.toWeb, meta.stats?.toSheet, meta.stats?.conflicts], [0, 0, 0]);
// ubah nama buyer di sheet Buyers → cascade
brow('BY-1')[bcol('Nama Buyer')] = 'Ana Baru'; meta = await runSync('sync');
eq('rename di sheet Buyers → buyer & semua transaksinya ikut (ID tetap)', [(await db.buyers()).find(b => b.id === 'BY-1')!.name, (await db.tx()).filter(t => t.buyerId === 'BY-1').map(t => t.buyerName).join()], ['Ana Baru', 'Ana Baru,Ana Baru,Ana Baru']);
eq('baris transaksi di Sheets ikut berubah', rowOf('TX-S1')[col('Nama Buyer')], 'Ana Baru');
// buyer di web diubah → sheet
await db.setBuyers((await db.buyers()).map(b => (b.id === 'BY-2' ? { ...b, name: 'Budi Web', version: 2 } : b))); await db.setTx((await db.tx()).map(t => (t.buyerId === 'BY-2' ? { ...t, buyerName: 'Budi Web', version: t.version + 1 } : t)));
await runSync('sync'); eq('rename di web → sheet Buyers', brow('BY-2')[bcol('Nama Buyer')], 'Budi Web');
// buyer baru di sheet dengan nomor yang SAMA dengan buyer yang ada → tidak membuat duplikat
const dupRow = BUYER_HEADER.map(() => ''); dupRow[bcol('ID Buyer')] = 'BY-DUP'; dupRow[bcol('Nama Buyer')] = 'Ana Kembar'; dupRow[bcol('Nomor WhatsApp')] = '081200000001'; buyerRows().push(dupRow);
await runSync('sync'); const live = (await db.buyers()).filter(b => !b.deletedAt);
eq('nomor sama di sheet → tidak ada buyer ganda', [live.length, live.filter(b => b.whatsapp === '6281200000001').length], [2, 1]);
// transaksi baru di sheet tanpa ID Buyer, nomor sudah ada → terhubung ke buyer lama; nomor baru → 1 buyer baru
const nt = (phone: string, name: string) => { const r = txRows()[1].map(() => ''); r[col('Nama Buyer')] = name; r[col('WhatsApp')] = phone; r[col('Produk')] = 'Canva'; r[col('Plan')] = 'Private'; r[col('Tanggal Order')] = '2026-10-20'; r[col('Durasi (angka)')] = '1'; r[col('Satuan Durasi')] = 'bulan'; r[col('Tanggal Habis')] = '2026-11-20'; r[col('Harga Jual')] = '5000'; return r; };
txRows().push(nt('081200000002', 'Nama Lain'), nt('081299999999', 'Orang Baru')); await runSync('sync');
let tx = await db.tx(), bs = (await db.buyers()).filter(b => !b.deletedAt);
eq('transaksi sheet bernomor lama → ke buyer yang sama; nomor baru → buyer baru', [tx.find(t => t.product === 'Canva' && t.whatsapp === '6281200000002')?.buyerId, bs.length, bs.some(b => b.name === 'Orang Baru')], ['BY-2', 3, true]);
eq('nama di transaksi mengikuti buyer, bukan teks sheet', tx.find(t => t.buyerId === 'BY-2' && t.product === 'Canva')!.buyerName, 'Budi Web');
// hapus baris buyer yang masih punya transaksi → buyer tetap ada
sheets.get('Buyers')!.rows = buyerRows().filter(r => r[0] !== 'BY-2'); await runSync('sync');
eq('buyer dihapus dari sheet tetapi masih punya transaksi → tetap ada', (await db.buyers()).find(b => b.id === 'BY-2')?.deletedAt, undefined);
// sheet Transaksi versi lama (tanpa kolom ID Buyer)
const ci = col('ID Buyer'); sheets.get('Transaksi')!.rows = txRows().map(r => r.filter((_, i) => i !== ci)); const nb0 = (await db.buyers()).length, nt0 = (await db.tx()).length;
meta = await runSync('sync'); eq('sheet lama tanpa kolom ID Buyer: sinkron berhasil, tidak ada duplikat', [meta.lastStatus, (await db.buyers()).length, (await db.tx()).length, (await db.tx()).every(t => !!t.buyerId)], ['ok', nb0, nt0, true]);
const b1 = (await db.buyers()).length, t1 = (await db.tx()).length; await runSync('sync'); await runSync('sync'); eq('sinkron berulang stabil (buyer & transaksi tidak bertambah)', [(await db.buyers()).length, (await db.tx()).length], [b1, t1]);
// baris Buyers tidak valid → batal
brow('BY-1')[bcol('Nomor WhatsApp')] = '12'; err = ''; try { await runSync('sync'); } catch (e) { err = (e as Error).message; } eq('baris Buyers tidak valid → batal & menyebut sheet', [err.includes('Buyers baris'), (await db.buyers()).find(b => b.id === 'BY-1')!.whatsapp], [true, '6281200000001']); brow('BY-1')[bcol('Nomor WhatsApp')] = '6281200000001';

// restore + push besar
await db.setTx(Array.from({ length: 1500 }, (_, i) => mk('TX-BIG' + i))); meta = await runSync('push');
eq('push 1500 baris (grid diperluas otomatis)', [meta.lastStatus, txRows().length], ['ok', 1501]);
// pull
sheets.get('Transaksi')!.rows = [HEADER, rowOf('TX-BIG1'), rowOf('TX-BIG2')]; await runSync('pull'); eq('pull mengganti data website dengan isi Sheets', (await db.tx()).length, 2);
// error ramah
forceStatus = 403; err = ''; try { await runSync('sync'); } catch (e) { err = (e as Error).message; }
eq('403 → pesan menyebut email service account', err.includes('bot@proj.iam.gserviceaccount.com'), true); forceStatus = 404; err = ''; try { await runSync('sync'); } catch (e) { err = (e as Error).message; }
eq('404 → pesan GOOGLE_SHEET_ID', err.includes('GOOGLE_SHEET_ID'), true); forceStatus = 429; err = ''; try { await runSync('sync'); } catch (e) { err = (e as Error).message; } eq('429 → pesan kuota', err.includes('Kuota'), true);
forceStatus = 0; delete process.env.GOOGLE_SHEET_ID; err = ''; try { await runSync('sync'); } catch (e) { err = (e as Error).message; } eq('tanpa konfigurasi → pesan jelas', err.includes('belum dikonfigurasi'), true);
console.log(fail ? `${fail} GAGAL` : 'SEMUA LULUS');
