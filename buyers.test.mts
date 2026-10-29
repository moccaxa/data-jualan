import { randomBytes } from 'node:crypto';
process.env.RJ_MEMORY_DB = '1'; process.env.DATA_ENC_KEY = randomBytes(32).toString('base64'); process.env.SESSION_SECRET = randomBytes(48).toString('base64url');
const R = new URL('../', import.meta.url).pathname;
const { hashPassword } = await import(R + 'netlify/functions/_lib/auth'); process.env.ADMIN_PASSWORD_HASH = hashPassword('rahasia-admin-123');
const B = await import(R + 'shared/buyers'); const { db } = await import(R + 'netlify/functions/_lib/db');
let fail = 0; const eq = (n: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
const TODAY = '2026-10-26', CFG = { newDays: 30, inactiveDays: 90 };
const buyer = (id: string, name: string) => ({ id, name, whatsapp: '62812' + id.replace(/\D/g, '').padEnd(8, '0'), notes: '', createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1 });
let n = 0; const t = (b: string, date: string, price = 10000, o: object = {}) => ({ id: 'T' + ++n, buyerId: b, orderDate: date, cancelled: false, sellPrice: price, costPrice: price * 0.4, quantity: 1, product: 'Zoom', plan: 'Private', ...o }) as any;

// ---------- rentang periode
eq('Bulan ini', B.rangeFor('month', TODAY), { from: '2026-10-01', to: '2026-10-31' });
eq('Bulan lalu', B.rangeFor('lastMonth', TODAY), { from: '2026-09-01', to: '2026-09-30' });
eq('3 bulan terakhir', B.rangeFor('3m', TODAY), { from: '2026-07-26', to: '2026-10-26' });
eq('Tahun ini', B.rangeFor('year', TODAY), { from: '2026-01-01', to: '2026-12-31' }); eq('Semua waktu', B.rangeFor('all', TODAY), {});
eq('Bulan lalu lintas tahun', B.rangeFor('lastMonth', '2026-01-15'), { from: '2025-12-01', to: '2025-12-31' }); eq('Bulan lalu = Februari kabisat', B.rangeFor('lastMonth', '2028-03-10'), { from: '2028-02-01', to: '2028-02-29' });
eq('rentang khusus terbalik ditukar', B.rangeFor('custom', TODAY, { from: '2026-10-10', to: '2026-10-01' }), { from: '2026-10-01', to: '2026-10-10' });
eq('batas inklusif', [B.inRange('2026-09-30', B.rangeFor('lastMonth', TODAY)), B.inRange('2026-10-01', B.rangeFor('lastMonth', TODAY)), B.inRange('2026-07-25', B.rangeFor('3m', TODAY)), B.inRange('2026-07-26', B.rangeFor('3m', TODAY))], [true, false, false, true]);

// ---------- statistik & ranking
const buyers = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((x, i) => buyer('BY-' + x, ['Ana', 'Budi', 'Citra', 'Dedi', 'Eka', 'Fani', 'Gita'][i]));
const txs = [t('BY-A', '2026-10-05'), t('BY-A', '2026-10-10'), t('BY-A', '2026-08-01'), t('BY-B', '2026-10-12', 500000, { quantity: 2 }), t('BY-C', '2026-09-15', 20000), t('BY-C', '2026-10-01', 20000), t('BY-D', '2026-05-01'),
  t('BY-F', '2026-10-02', 99999, { cancelled: true }), t('BY-G', '2026-10-03', 99999, { deletedAt: 'x' })];
txs.push({ ...txs[0] }); // objek ganda dengan ID transaksi sama
const month = B.computeStats(buyers, txs, B.rangeFor('month', TODAY), TODAY, CFG), all = B.computeStats(buyers, txs, {}, TODAY, CFG);
const get = (s: any[], id: string) => s.find(x => x.buyer.id === id);
eq('order dihitung dari ID transaksi unik (duplikat objek tidak ganda)', get(all, 'BY-A').orders, 3);
eq('batal & dihapus tidak dihitung', [get(all, 'BY-F').orders, get(all, 'BY-G').orders, get(all, 'BY-F').revenue], [0, 0, 0]);
eq('omzet/modal/untung = × kuantitas', [get(all, 'BY-B').revenue, get(all, 'BY-B').cost, get(all, 'BY-B').profit], [1000000, 400000, 600000]);
eq('tanggal pertama & terakhir (semua waktu)', [get(month, 'BY-A').firstOrder, get(month, 'BY-A').lastOrder], ['2026-08-01', '2026-10-10']);
eq('ranking order: sama → omzet tertinggi (Bulan ini)', B.rankByOrders(month).map(s => s.buyer.name), ['Ana', 'Budi', 'Citra']);
eq('ranking order semua waktu: Budi (1 order, omzet besar) di atas Dedi (1 order)', B.rankByOrders(all).map(s => s.buyer.name), ['Ana', 'Citra', 'Budi', 'Dedi']);
eq('order terbanyak ≠ omzet tertinggi', [B.rankByOrders(all)[0].buyer.name, B.rankByRevenue(all)[0].buyer.name], ['Ana', 'Budi']);
eq('ranking omzet', B.rankByRevenue(all).map(s => s.buyer.name), ['Budi', 'Citra', 'Ana', 'Dedi']);
eq('buyer tanpa order tidak masuk ranking', B.rankByOrders(all).some(s => ['Eka', 'Fani', 'Gita'].includes(s.buyer.name)), false);
eq('urutan stabil jika order & omzet sama (nama)', B.rankByOrders(B.computeStats([buyer('BY-Z', 'Zed'), buyer('BY-Y', 'Yan')], [t('BY-Z', '2026-10-01'), t('BY-Y', '2026-10-01')], {}, TODAY, CFG)).map(s => s.buyer.name), ['Yan', 'Zed']);
const an = B.analytics(month, B.rangeFor('month', TODAY));
eq('analisis Bulan ini', [an.totalBuyers, an.ordered, an.repeat, Math.round(an.repeatPct * 10) / 10, an.newBuyers, an.lapsed, an.topRevenue?.buyer.name, an.topProfit?.buyer.name], [7, 3, 1, 33.3, 1, 1, 'Budi', 'Budi']);
const aa = B.analytics(all, {}); eq('analisis Semua waktu (repeat = ≥2 transaksi valid)', [aa.repeat, aa.ordered, aa.lapsed, aa.newBuyers], [2, 4, 1, 4]);
eq('analisis Bulan lalu: hanya Citra order', [B.computeStats(buyers, txs, B.rangeFor('lastMonth', TODAY), TODAY, CFG).filter(s => s.orders).map(s => s.buyer.name)], [['Citra']]);
eq('status Baru/Aktif/Tidak Aktif', ['BY-A', 'BY-B', 'BY-C', 'BY-D', 'BY-E'].map(id => get(all, id).status), ['Aktif', 'Baru', 'Aktif', 'Tidak Aktif', 'Baru']);
eq('produk & plan terbanyak', (() => { const s = B.computeStats([buyer('BY-X', 'X')], [t('BY-X', '2026-10-01', 1, { product: 'Canva', plan: 'Sharing' }), t('BY-X', '2026-10-02', 1, { product: 'Zoom' }), t('BY-X', '2026-10-03', 1, { product: 'Zoom' })], {}, TODAY, CFG)[0]; return [s.topProduct, s.topPlan]; })(), ['Zoom', 'Private']);
// ---------- konsistensi
const leg = (id: string, name: string, wa: string) => ({ id, buyerId: '', buyerName: name, whatsapp: wa, version: 1, updatedAt: 'x', deletedAt: undefined }) as any;
let idc = 0; const gen = () => 'BY-N' + ++idc; const lk = B.ensureBuyerLinks([leg('1', 'Ana', '6281'), leg('2', 'Ana B', '6281'), leg('3', 'Budi', '6282')], [], 'now', gen);
eq('migrasi: data lama dikelompokkan per nomor', [lk.buyers.length, lk.txs[0].buyerId === lk.txs[1].buyerId, lk.txs[0].buyerId !== lk.txs[2].buyerId, lk.changed], [2, true, true, true]);
eq('migrasi idempoten', B.ensureBuyerLinks(lk.txs, lk.buyers, 'later', gen).changed, false);
const dd = B.dedupeByPhone([{ ...buyer('BY-1', 'Lama'), whatsapp: '6281', createdAt: '2026-01-01', notes: 'vip' }, { ...buyer('BY-2', 'Baru'), whatsapp: '6281', createdAt: '2026-02-01', notes: 'x' }], [{ ...leg('1', 'Baru', '6281'), buyerId: 'BY-2' }], 'now');
eq('dedupe nomor: transaksi dialihkan ke buyer tertua, duplikat ditandai terhapus, catatan digabung', [dd.txs[0].buyerId, dd.txs[0].buyerName, !!dd.buyers[1].deletedAt, dd.buyers[0].notes], ['BY-1', 'Lama', true, 'vip\nx']);
eq('buyer terhapus yang masih dipakai transaksi dihidupkan lagi', B.reviveReferenced([{ ...buyer('BY-1', 'A'), deletedAt: 'x' }], [{ ...leg('1', 'A', '6281'), buyerId: 'BY-1' }], 'now')[0].deletedAt, undefined);
eq('validateBuyer menormalkan nomor & menolak yang tidak valid', [(B.validateBuyer({ ...buyer('BY-1', 'A'), whatsapp: '0812-3456-7890' }) as any).v.whatsapp, B.validateBuyer({ ...buyer('BY-1', 'A'), whatsapp: '12' }).ok, B.validateBuyer({ ...buyer('BY-1', ' ') }).ok], ['6281234567890', false, false]);

// ---------- API
const call = async (mod: string, path: string, init: RequestInit & { cookie?: string } = {}) => {
  const h = (await import(R + 'netlify/functions/' + mod)).default;
  const res: Response = await h(new Request('https://x.test' + path, { ...init, headers: { 'content-type': 'application/json', ...(init.method && init.method !== 'GET' ? { 'x-rekap': '1' } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } })); return { res, body: await res.json() as any };
};
eq('/api/buyers tanpa login → 401', (await call('buyers', '/api/buyers')).res.status, 401);
const lg = await call('auth-login', '/api/auth-login', { method: 'POST', body: JSON.stringify({ password: 'rahasia-admin-123' }) }); const cookie = lg.res.headers.get('set-cookie')!.split(';')[0];
const bapi = (m: string, o: any = {}, q = '') => call('buyers', '/api/buyers' + q, { method: m, cookie, body: m === 'GET' || m === 'DELETE' ? undefined : JSON.stringify(o) });
const txapi = (o: any, q = '') => call('transactions', '/api/transactions' + q, { method: 'POST', cookie, body: JSON.stringify(o) });
const txs0 = () => call('transactions', '/api/transactions', { cookie }).then(r => r.body.items as any[]);
let seq = 0; const tin = (o: any = {}) => ({ id: 'TX-API' + ++seq, product: 'Zoom', plan: 'Private', variation: '', durationValue: 1, durationUnit: 'month', orderDate: '2026-10-05', startDate: '2026-10-05', expiryDate: '2026-11-05', expiryManual: false, accountEmail: '', sellPrice: 10000, costPrice: 4000, quantity: 1, supplier: '', notes: '', cancelled: false, reminderEnabled: true, reminderOffsets: [7], followedUp: false, ...o });

let r = await bapi('POST', { name: 'Ana', whatsapp: '0812-1111-0000', notes: 'pelanggan lama' }); const ana = r.body.item;
eq('tambah buyer manual (nomor dinormalisasi, ID unik)', [r.res.status, ana.whatsapp, /^BY-/.test(ana.id)], [200, '6281211110000', true]);
r = await bapi('POST', { name: 'Ana Dua', whatsapp: '+62 812 1111 0000' }); eq('nomor duplikat → 409 + info buyer yang sudah ada', [r.res.status, r.body.duplicate.id, r.body.error.includes('Ana')], [409, ana.id, true]);
eq('data tidak valid → 422', [(await bapi('POST', { name: '', whatsapp: '0812' })).res.status, (await bapi('POST', { name: 'X', whatsapp: '123' })).res.status], [422, 422]);
r = await txapi(tin({ buyerId: ana.id, buyerName: 'Ngawur', whatsapp: '6289999999999' })); eq('transaksi dengan buyerId: nama & nomor diambil dari buyer (bukan dari isian)', [r.res.status, r.body.item.buyerName, r.body.item.whatsapp, r.body.buyer], [200, 'Ana', '6281211110000', null]);
r = await txapi(tin({ buyerName: 'Ana Lagi', whatsapp: '081211110000' })); eq('pembelian berulang tanpa memilih buyer → masuk ke buyer yang sama, tanpa duplikat', [r.body.item.buyerId, r.body.buyer, (await bapi('GET')).body.items.length], [ana.id, null, 1]);
r = await txapi(tin({ buyerName: 'Budi', whatsapp: '0813-2222-0000' })); const budi = r.body.buyer; eq('nomor baru → buyer baru dibuat otomatis', [!!budi, (await bapi('GET')).body.items.length], [true, 2]);
eq('transaksi tanpa buyerId & tanpa nomor ditolak', (await txapi(tin({ buyerName: 'Tanpa Nomor' }))).res.status, 422); eq('buyerId tidak ada → 422', (await txapi(tin({ buyerId: 'BY-GAIB' }))).res.status, 422);
// rename + cascade
r = await bapi('PUT', { ...ana, name: 'Ana Baru', whatsapp: '0812-9999-0000', baseVersion: ana.version }); const ana2 = r.body.item;
const tl = (await txs0()).filter(x => x.buyerId === ana.id);
eq('ubah nama/nomor buyer → semua transaksi tetap terhubung & ikut diperbarui', [r.res.status, r.body.changed, tl.length, tl.every(x => x.buyerName === 'Ana Baru' && x.whatsapp === '6281299990000')], [200, 2, 2, true]);
eq('versi basi → 409', (await bapi('PUT', { ...ana, name: 'X', baseVersion: 1 })).res.status, 409);
eq('nomor dipakai buyer lain → 409', (await bapi('PUT', { ...ana2, whatsapp: budi.whatsapp, baseVersion: ana2.version })).res.status, 409);
// statistik dari data nyata & pembatalan/penghapusan
const stat = async () => { const bs = (await bapi('GET')).body.items, ts = await txs0(); return B.computeStats(bs, ts, {}, TODAY, CFG).find(s => s.buyer.id === ana.id)!; };
eq('statistik buyer dari transaksi API', [(await stat()).orders, (await stat()).revenue], [2, 20000]);
const t1 = (await txs0()).find(x => x.buyerId === ana.id)!; await txapi({ ...tin(), ...t1, cancelled: true, baseVersion: t1.version });
eq('transaksi dibatalkan → statistik & ranking turun', (await stat()).orders, 1);
const t2 = (await txs0()).find(x => x.buyerId === ana.id && !x.cancelled)!; await call('transactions', '/api/transactions?id=' + t2.id, { method: 'DELETE', cookie });
eq('transaksi dihapus → statistik turun', (await stat()).orders, 0);
eq('hapus buyer yang masih punya transaksi → 409', (await bapi('DELETE', {}, '?id=' + ana.id)).res.status, 409);
// gabung
r = await bapi('POST', { fromId: budi.id, intoId: ana.id }, '?action=merge'); const after = await txs0();
eq('gabung buyer: transaksi pindah, buyer asal terhapus', [r.res.status, after.filter(x => x.buyerId === ana.id).length, (await bapi('GET')).body.items.map((b: any) => b.id)], [200, after.length, [ana.id]]);
eq('gabung ke diri sendiri ditolak', (await bapi('POST', { fromId: ana.id, intoId: ana.id }, '?action=merge')).res.status, 422);
const tmp = (await bapi('POST', { name: 'Sementara', whatsapp: '0857-0000-1111' })).body.item; eq('hapus buyer tanpa transaksi', [(await bapi('DELETE', {}, '?id=' + tmp.id)).res.status, (await bapi('GET')).body.items.some((b: any) => b.id === tmp.id)], [200, false]);
r = await bapi('POST', { items: [{ name: 'Baru1', whatsapp: '0858-1000-0001' }, { name: 'Dobel', whatsapp: '0812-9999-0000' }, { name: 'Baru2', whatsapp: '0858-1000-0002' }, { name: 'Baru1 lagi', whatsapp: '6285810000001' }] }, '?action=bulk');
eq('impor buyer: duplikat nomor (di DB & dalam file) dilewati', [r.body.added, r.body.skipped], [2, 2]); eq('impor buyer baris rusak → 422', (await bapi('POST', { items: [{ name: 'X', whatsapp: '1' }] }, '?action=bulk')).res.status, 422);
// impor transaksi massal
r = await txapi({ items: [tin({ buyerId: '', buyerName: 'Rina', whatsapp: '0812-9999-0000' }), tin({ buyerName: 'Sinta', whatsapp: '0859-1234-0000' }), tin({ buyerName: 'Sinta Lagi', whatsapp: '0859-1234-0000' })] }, '?action=bulk');
eq('impor transaksi massal: nomor lama → buyer lama; nomor baru → satu buyer baru untuk dua transaksi', [r.res.status, r.body.items[0].buyerId, r.body.buyers.length, r.body.items[1].buyerId === r.body.items[2].buyerId], [200, ana.id, 1, true]);
// migrasi data lama
const old = (id: string, wa: string, name: string) => ({ ...tin({ id }), buyerName: name, whatsapp: wa, accountPasswordEnc: '', createdAt: 'x', updatedAt: 'x', version: 1 });
await db.setBuyers([]); await db.setTx([old('L1', '6281300000001', 'Lama A'), old('L2', '6281300000001', 'Lama A2'), old('L3', '6281300000002', 'Lama B')] as any);
const mig = await txs0(); const mb = (await bapi('GET')).body.items;
eq('migrasi data lama via API: tiap transaksi punya buyerId, buyer dikelompokkan per nomor', [mig.every(x => !!x.buyerId), mb.length, mig.filter(x => x.buyerId === mig[0].buyerId).length], [true, 2, 2]);
const v1 = (await txs0()).map(x => x.version).join(); eq('migrasi tidak berulang (versi tetap)', (await txs0()).map(x => x.version).join(), v1);
// backup & settings
const key = await db.backup('uji'); await db.setBuyers([]); await db.restore(key); eq('backup/restore menyertakan buyer', (await db.buyers()).length, 2);
const sp = (o: any) => call('settings', '/api/settings', { method: 'PUT', cookie, body: JSON.stringify({ monthOptions: [1], dayOptions: [1], warnDays: 7, ...o }) });
eq('pengaturan hari buyer: valid & tidak valid', [(await sp({ buyerNewDays: 14, buyerInactiveDays: 60 })).body.settings.buyerInactiveDays, (await sp({ buyerNewDays: 0 })).res.status, (await sp({ buyerInactiveDays: 3 })).res.status], [60, 422, 422]);
console.log(fail ? `${fail} GAGAL` : 'SEMUA LULUS');
