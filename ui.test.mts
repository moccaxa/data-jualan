// Uji UI sungguhan di Chromium (desktop + HP). Prasyarat: npm run build; npm i --no-save puppeteer-core @sparticuz/chromium
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import chromium from '@sparticuz/chromium';
import puppeteer, { type ElementHandle, type Page } from 'puppeteer-core';
import { addDays, calcExpiry, todayJakarta } from '../../shared/dates';

const PORT = 8899, BASE = `http://localhost:${PORT}`, SHOTS = '/tmp/shots', DL = '/tmp/dl';
mkdirSync(SHOTS, { recursive: true }); rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
const server = spawn('npx', ['tsx', 'tests/e2e/server.mts'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
await new Promise<void>((ok, bad) => { server.stdout.on('data', d => String(d).includes('READY') && ok()); setTimeout(() => bad(new Error('server tidak siap')), 30000); });
const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });

let fail = 0; const eq = (n: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
const ok = (n: string, c: boolean, info = '') => eq(n + (c ? '' : ' ' + info), c, true);
const text = (p: Page) => p.evaluate(() => document.body.innerText.replace(/\u00a0/g, ' '));
const waitText = (p: Page, t: string) => p.waitForFunction(x => document.body.innerText.replace(/\u00a0/g, ' ').includes(x), { timeout: 8000 }, t).catch(async () => { throw new Error(`Teks "${t}" tidak muncul. Halaman: ${(await text(p)).slice(0, 300)}`); });
const waitRow = (p: Page, t: string) => p.waitForFunction(x => [...document.querySelectorAll('tbody tr')].some(r => r.textContent!.includes(x)), { timeout: 8000 }, t);
const go = async (p: Page, path: string) => { await p.goto(BASE + path, { waitUntil: 'networkidle0' }); };
const clickText = async (p: Page, tag: string, t: string) => { const h = await p.evaluateHandle((tag, t) => [...(document.querySelector('.fixed.inset-0') ?? document).querySelectorAll(tag)].find(e => e.textContent!.trim().includes(t) && (e as HTMLElement).offsetParent !== null), tag, t); const el = h.asElement() as ElementHandle<Element> | null; if (!el) throw new Error(`Tidak ada <${tag}> "${t}"`); await el.click(); };
const clickVisible = async (p: Page, sel: string) => { for (let i = 0; i < 20; i++) { const h = await p.evaluateHandle(sel => [...document.querySelectorAll(sel)].find(e => (e as HTMLElement).offsetParent !== null), sel); const el = h.asElement() as ElementHandle<Element> | null; if (el) return el.click(); await new Promise(r => setTimeout(r, 200)); } throw new Error('Tidak ada ' + sel); };
const set = (el: ElementHandle<Element>, v: string) => el.evaluate((e, v) => { const proto = e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
const field = async (p: Page, label: string) => { const h = await p.evaluateHandle(t => { for (const l of (document.querySelector('.fixed.inset-0') ?? document).querySelectorAll('label')) { const sp = l.querySelector('span'); if (sp && sp.textContent!.trim().startsWith(t)) return l.querySelector('input,select,textarea'); } return null; }, label); const el = h.asElement() as ElementHandle<Element> | null; if (!el) throw new Error('Field tidak ada: ' + label); return el; };
const fill = async (p: Page, label: string, v: string) => set(await field(p, label), v);
const cardValue = (p: Page, label: string) => p.evaluate(l => { const d = [...document.querySelectorAll('.card')].find(c => c.firstElementChild?.textContent?.trim() === l); return d?.children[1]?.textContent ?? null; }, label);
const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');
const tglApp = (s: string) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(s + 'T00:00:00Z'));

const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 });
const problems: string[] = []; const hook = (p: Page) => { p.on('pageerror', e => problems.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); }); };
hook(page); await page.evaluateOnNewDocument(() => { (window as any).__csp = []; document.addEventListener('securitypolicyviolation', e => (window as any).__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
const client = await page.createCDPSession(); await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
const today = todayJakarta();

try {
  // ---- login
  const first = await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  ok('CSP & header keamanan terpasang pada halaman', !!first!.headers()['content-security-policy']?.includes("frame-ancestors 'none'") && first!.headers()['x-frame-options'] === 'DENY');
  ok('belum login → hanya form login, tanpa data', (await text(page)).includes('Password admin') && !(await text(page)).includes('Dashboard'));
  eq('API tanpa login → 401', await page.evaluate(() => fetch('/api/transactions').then(r => r.status)), 401);
  await set(await field(page, 'Password admin'), 'salah-banget'); await clickText(page, 'button', 'Masuk'); await waitText(page, 'Password salah');
  await set(await field(page, 'Password admin'), 'e2e-password-123'); await clickText(page, 'button', 'Masuk'); await waitText(page, 'Total omzet');
  ok('login berhasil → dashboard', (await text(page)).includes('Dashboard'));
  eq('dashboard kosong: total transaksi 0', await cardValue(page, 'Total transaksi'), '0');
  await page.screenshot({ path: SHOTS + '/1-dashboard-desktop-kosong.png' });

  // ---- tambah transaksi
  await clickText(page, 'a', 'Tambah Penjualan'); await waitText(page, 'Buyer *');
  await clickText(page, 'button', 'Buyer baru'); await fill(page, 'Nama Buyer', 'Budi Santoso'); await fill(page, 'Nomor WhatsApp', '123'); await clickText(page, 'button', 'Simpan'); await waitText(page, 'Nomor WhatsApp tidak valid');
  ok('WhatsApp tidak valid ditolak saat menambah buyer dari form', true); await fill(page, 'Nomor WhatsApp', '0812-3456-7890'); await waitText(page, 'Tersimpan sebagai 6281234567890'); await clickText(page, 'button', 'Simpan'); await page.waitForSelector('[data-testid=buyer-selected]');
  ok('modal buyer tidak men-submit form transaksi (masih di halaman form)', page.url().endsWith('/tambah'));
  await fill(page, 'Nama Produk', 'Zoom Premium'); await fill(page, 'Plan', 'Sharing'); await fill(page, 'Variasi Produk', 'Pro 100 peserta'); await fill(page, 'FH / Beli di Siapa', 'FH Satu');
  await fill(page, 'Durasi', 'month:3'); const exp3 = calcExpiry(today, 3, 'month');
  eq('tanggal habis otomatis (3 bulan kalender)', await (await field(page, 'Tanggal Habis')).evaluate(e => (e as HTMLInputElement).value), exp3);
  await fill(page, 'Email Akun', 'akun@mail.com'); await fill(page, 'Password Akun', 'rahasia123'); await fill(page, 'Harga Jual', '10000'); await fill(page, 'Harga Modal', '5000'); await fill(page, 'Catatan', 'catatan uji');
  await waitText(page, 'Margin 50.0%'); ok('keuntungan & margin dihitung langsung di form', /Keuntungan:\s*Rp\s?5\.000/.test(await text(page)));
  await fill(page, 'Kuantitas', '2'); await waitText(page, 'Omzet: Rp'); ok('kuantitas 2 → untung Rp10.000', /Keuntungan:\s*Rp\s?10\.000/.test(await text(page))); await fill(page, 'Kuantitas', '1');
  await page.screenshot({ path: SHOTS + '/2-form-desktop.png', fullPage: true });
  ok('buyer terpilih tampil di form dengan nama & nomor otomatis', (await text(page)).includes('Budi Santoso') && (await text(page)).includes('6281234567890'));
  await clickText(page, 'button', 'Simpan'); await page.waitForFunction(() => location.pathname === '/penjualan'); await waitRow(page, 'Budi Santoso');
  ok('transaksi muncul di tabel (jual, modal, untung)', /Rp\s?10\.000/.test(await text(page)) && /Rp\s?5\.000/.test(await text(page)));
  eq('password tersembunyi di tabel', (await text(page)).includes('rahasia123'), false);
  await clickVisible(page, 'td button.flex'); await waitText(page, 'rahasia123'); ok('tombol tampilkan → password terdekripsi dari server', true);

  // ---- dashboard
  await clickText(page, 'a', 'Dashboard'); await waitText(page, 'Total omzet');
  eq('dashboard: transaksi = 1', await cardValue(page, 'Total transaksi'), '1'); eq('dashboard: omzet', digits(await cardValue(page, 'Total omzet')), '10000'); eq('dashboard: modal', digits(await cardValue(page, 'Total modal')), '5000'); eq('dashboard: keuntungan', digits(await cardValue(page, 'Total keuntungan')), '5000');
  eq('dashboard: transaksi aktif & bulan ini', [await cardValue(page, 'Transaksi aktif'), await cardValue(page, 'Transaksi bulan ini')], ['1', '1']);
  await page.waitForSelector('svg.recharts-surface'); ok('grafik tampil', true); await page.screenshot({ path: SHOTS + '/3-dashboard-desktop.png', fullPage: true });
  ok('CSP tidak dilanggar oleh halaman (grafik, gaya)', (await page.evaluate(() => (window as any).__csp)).length === 0, JSON.stringify(await page.evaluate(() => (window as any).__csp)));

  // ---- edit: modal berubah, tanggal habis manual, password tidak berubah
  await go(page, '/penjualan'); await clickVisible(page, 'a[title="Edit"]'); await waitText(page, 'Edit TX-');
  ok('edit: password tersimpan ditandai, bukan ditampilkan', (await (await field(page, 'Password Akun')).evaluate(e => (e as HTMLInputElement).placeholder)).includes('tersimpan'));
  await fill(page, 'Harga Modal', '4000'); await waitText(page, 'Rp 6.000');
  const manual = addDays(today, 20); await fill(page, 'Tanggal Habis', manual); await waitText(page, 'Tanggal Habis (manual)');
  await clickText(page, 'button', 'Simpan'); await page.waitForFunction(() => location.pathname === '/penjualan'); await waitText(page, tglApp(manual));
  ok('edit tersimpan: untung baru & tanggal habis manual', /Rp\s?6\.000/.test(await text(page)));
  await clickVisible(page, 'td button.flex'); await waitText(page, 'rahasia123'); ok('password lama tetap setelah edit tanpa mengisi password', true);

  // ---- reminder ikut tanggal habis manual
  await clickText(page, 'a', 'Reminder'); await waitText(page, 'Riwayat reminder'); await clickText(page, 'button', 'Semua');
  await waitText(page, tglApp(addDays(manual, -7))); ok('jadwal reminder bergeser mengikuti tanggal habis manual (H-14,H-7,…)', (await text(page)).includes(tglApp(addDays(manual, -14))) && (await text(page)).includes(tglApp(manual)));
  await clickVisible(page, 'button[title="Atur jadwal"]'); await waitText(page, 'Jadwal reminder'); await clickText(page, 'button', 'Batal');
  await clickVisible(page, 'button[title="Tandai ditindaklanjuti"]'); await waitText(page, 'Ditandai ditindaklanjuti'); await waitText(page, 'Ditindaklanjuti');

  // ---- telegram
  await clickText(page, 'a', 'Telegram'); await waitText(page, 'Pengaturan reminder');
  const chat = await page.$('input[placeholder^="mis. 123456789"]'); await set(chat!, '12345678'); await clickText(page, 'label', 'Aktifkan pengiriman'); await (await page.$('input[type=checkbox]'))!.evaluate(e => (e as HTMLInputElement).checked);
  const en = await field(page, 'Aktifkan').catch(() => null); void en;
  await page.evaluate(() => { const c = [...document.querySelectorAll('label')].find(l => l.textContent!.includes('Aktifkan pengiriman'))!.querySelector('input')!; if (!c.checked) c.click(); });
  await clickText(page, 'button', 'Simpan pengaturan'); await waitText(page, 'Pengaturan disimpan');
  await clickText(page, 'button', 'Hubungkan Telegram'); await waitText(page, '@e2e_bot');
  await clickText(page, 'button', 'Kirim pesan tes'); await waitText(page, 'Pesan tes terkirim'); await waitText(page, 'Pesan tes koneksi'); ok('tes koneksi masuk riwayat', true);
  await clickText(page, 'a', 'Reminder'); await waitText(page, 'Riwayat reminder'); await clickText(page, 'button', 'Semua'); await clickVisible(page, 'button[title="Kirim pesan tes ke Telegram"]'); await waitText(page, 'Pesan tes terkirim ke Telegram');
  const sent: string[] = JSON.parse(await page.evaluate(() => fetch('/__sent').then(r => r.text())));
  ok('pesan Telegram berformat reminder & berawalan TES', sent.at(-1)!.startsWith('🧪 TES') && sent.at(-1)!.includes('Buyer: Budi Santoso') && sent.at(-1)!.includes('Plan: Sharing'));
  ok('pesan Telegram TIDAK memuat password/email', !sent.join('\n').includes('rahasia123') && !sent.join('\n').includes('akun@mail.com'));
  eq('token Telegram tidak ada di halaman', (await text(page)).includes('E2E-TOKEN'), false);

  // ---- tambah transaksi ke-2, cari & filter
  await go(page, '/tambah'); await waitText(page, 'Buyer *'); await clickText(page, 'button', 'Buyer baru'); await fill(page, 'Nama Buyer', 'Sari Dewi'); await fill(page, 'Nomor WhatsApp', '+62 813 5555 0000'); await clickText(page, 'button', 'Simpan'); await page.waitForSelector('[data-testid=buyer-selected]'); await fill(page, 'Nama Produk', 'Canva Pro'); await fill(page, 'Plan', 'Designer'); await fill(page, 'Durasi', 'day:7');
  await fill(page, 'Harga Jual', '20000'); await fill(page, 'Harga Modal', '8000'); await clickText(page, 'button', 'Simpan'); await page.waitForFunction(() => location.pathname === '/penjualan'); await waitRow(page, 'Sari Dewi');
  eq('durasi harian 7 hari dihitung kalender', await text(page).then(t => t.includes(tglApp(addDays(today, 7)))), true);
  const rows = () => page.evaluate(() => [...document.querySelectorAll('tbody tr')].length);
  eq('2 baris tampil', await rows(), 2);
  await set((await page.$('input[placeholder^="Cari"]'))!, '08123'); await new Promise(r => setTimeout(r, 200)); eq('pencarian nomor WA (0812… cocok 62812…)', await rows(), 0);
  await set((await page.$('input[placeholder^="Cari"]'))!, 'canva'); await new Promise(r => setTimeout(r, 200)); eq('pencarian produk', await rows(), 1);
  await set((await page.$('input[placeholder^="Cari"]'))!, 'akun@mail'); await new Promise(r => setTimeout(r, 200)); eq('pencarian email akun', await rows(), 1);
  await set((await page.$('input[placeholder^="Cari"]'))!, ''); await new Promise(r => setTimeout(r, 200));
  const sel = (await page.$$('select')); await set(sel[1], 'Designer'); await new Promise(r => setTimeout(r, 200)); eq('filter plan', await rows(), 1); await set(sel[1], '');
  await set(sel[2], 'Akan Habis'); await new Promise(r => setTimeout(r, 200)); eq('filter status "Akan Habis" (habis 7 hari lagi)', await rows(), 1); await set(sel[2], '');

  // ---- CSV
  await clickText(page, 'button', 'Ekspor CSV'); await clickText(page, 'button', 'Unduh'); await new Promise(r => setTimeout(r, 800));
  const f = readdirSync(DL).find(x => x.endsWith('.csv'))!; const csv = readFileSync(`${DL}/${f}`, 'utf8');
  ok('CSV berisi data & tanpa kolom/isi password', csv.includes('Budi Santoso') && csv.includes('Sari Dewi') && !csv.includes('Password') && !csv.includes('rahasia123'));
  const imp = async (content: string) => { writeFileSync(DL + '/in.csv', content); const input = await page.$('input[type=file]'); await input!.uploadFile(DL + '/in.csv'); await waitText(page, 'Hasil validasi impor'); };
  await imp(csv); ok('impor ulang file yang sama: semua duplikat, tidak ada tombol impor', /Duplikat dilewati:\s*2/.test(await text(page)) && !(await text(page)).includes('Impor 1 transaksi')); await clickText(page, 'button', 'Tutup');
  const head = csv.replace('\uFEFF', '').split('\r\n')[0]; const newRow = (id: string) => `${id},,Rina Baru,081200003333,Netflix,Private,,1 bulan,1,${today},${today},${addDays(today, 30)},rina@mail.com,30000,15000,15000,FH,,Aktif`;
  await imp([head, newRow('TX-IMPORT1'), newRow('TX-IMPORT1').replace('Rina Baru', 'Dobel').replace('081200003333', '081200004444'), 'x,,,12,,,,,,,,,,,,,,,'].join('\r\n'));
  ok('impor: 1 valid, duplikat ID dilewati, baris rusak dilaporkan', /Siap diimpor:\s*1/.test(await text(page)) && /Duplikat dilewati:\s*1/.test(await text(page)) && /Baris bermasalah:\s*1/.test(await text(page)));
  await clickText(page, 'button', 'Impor 1 transaksi'); await waitText(page, 'Rina Baru'); eq('3 baris setelah impor', await rows(), 3);

  // ---- hapus
  await set((await page.$('input[placeholder^="Cari"]'))!, 'Rina'); await new Promise(r => setTimeout(r, 200));
  await clickVisible(page, 'button[title="Hapus"]'); await waitText(page, 'Hapus transaksi?'); await clickText(page, 'button', 'Batal'); eq('batal hapus: data tetap', await rows(), 1);
  await clickVisible(page, 'button[title="Hapus"]'); await clickText(page, 'button', 'Hapus'); await waitText(page, 'Transaksi dihapus'); await new Promise(r => setTimeout(r, 200)); eq('hapus dengan konfirmasi', await rows(), 0);


  // ================= BUYER =================
  const goBuyer = async () => { await go(page, '/buyer'); await waitText(page, 'Database buyer'); };
  const names = (id: string) => page.$$eval(`[data-testid=${id}] tbody tr`, rs => rs.map(r => r.querySelector('a')?.textContent));
  const pick = async (label: string, v: string) => { await set((await page.$(`select[aria-label="${label}"]`))!, v); await new Promise(r => setTimeout(r, 250)); };
  await goBuyer(); eq('Data Buyer: total buyer (Budi, Sari, Rina dari impor)', await cardValue(page, 'Total buyer terdaftar'), '3');
  // pembelian berulang → buyer yang sama
  await go(page, '/tambah'); await waitText(page, 'Buyer *'); await set((await page.$('input[aria-label="Cari buyer"]'))!, 'budi'); await clickText(page, 'button', 'Budi Santoso'); await page.waitForSelector('[data-testid=buyer-selected]');
  await fill(page, 'Nama Produk', 'Zoom Premium'); await fill(page, 'Harga Jual', '10000'); await fill(page, 'Harga Modal', '4000'); await clickText(page, 'button', 'Simpan'); await page.waitForFunction(() => location.pathname === '/penjualan');
  await goBuyer(); eq('pembelian berulang: tidak ada buyer ganda', await cardValue(page, 'Total buyer terdaftar'), '3');
  eq('Top Buyer: Budi (2 order) peringkat 1, Sari (1 order) peringkat 2; buyer tanpa order tidak tampil', [await names('top-buyer'), await page.$eval('[data-testid=top-buyer] tbody tr td', e => e.textContent)], [['Budi Santoso', 'Sari Dewi'], '1']);
  // peringatan duplikat
  await clickText(page, 'button', 'Tambah buyer'); await fill(page, 'Nama Buyer', 'Budi Kembar'); await fill(page, 'Nomor WhatsApp', '+62 812 3456 7890'); await waitText(page, 'sudah terdaftar atas nama Budi Santoso');
  eq('nomor duplikat: peringatan + tombol Simpan diblokir', await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Simpan')!.disabled), true);
  await fill(page, 'Nomor WhatsApp', '0857 1111 2222'); await fill(page, 'Nama Buyer', 'Sari Dewi'); await waitText(page, 'Sudah ada buyer bernama'); ok('nama sama (nomor beda): peringatan', true);
  await fill(page, 'Nama Buyer', 'Tono Manual'); await clickText(page, 'button', 'Simpan'); await waitText(page, 'Buyer ditambahkan');
  ok('buyer manual muncul dengan status Baru', await page.$$eval('[data-testid=buyer-table] tbody tr', rs => rs.some(r => r.textContent!.includes('Tono Manual') && r.textContent!.includes('Baru'))));
  // transaksi untuk buyer dari halaman detail
  await clickText(page, 'a', 'Tono Manual'); await waitText(page, 'Tambah transaksi'); await clickText(page, 'a', 'Tambah transaksi'); await page.waitForSelector('[data-testid=buyer-selected]');
  ok('"Tambah transaksi" dari detail buyer memilih buyer otomatis', (await page.$eval('[data-testid=buyer-selected]', e => e.textContent))!.includes('Tono Manual'));
  await fill(page, 'Nama Produk', 'Netflix'); await fill(page, 'Harga Jual', '500000'); await fill(page, 'Harga Modal', '100000'); await clickText(page, 'button', 'Simpan'); await page.waitForFunction(() => location.pathname === '/penjualan');
  await goBuyer();
  eq('order terbanyak ≠ omzet tertinggi', [(await names('top-buyer'))[0], (await names('top-omzet'))[0], await names('top-omzet')], ['Budi Santoso', 'Tono Manual', ['Tono Manual', 'Budi Santoso', 'Sari Dewi']]);
  eq('kartu: repeat, persentase, omzet & untung tertinggi', [await cardValue(page, 'Buyer repeat order'), await cardValue(page, 'Persentase repeat order'), digits(await cardValue(page, 'Omzet tertinggi')), digits(await cardValue(page, 'Keuntungan tertinggi'))], ['1', '33.3%', '500000', '400000']);
  eq('badge peringkat 1, 2, 3 pada Top Buyer', await page.$$eval('[data-testid=top-buyer] [aria-label^="Peringkat"]', e => e.map(x => x.textContent)), ['1', '2', '3']);
  await page.waitForSelector('[data-testid=buyer-cards]'); await page.screenshot({ path: SHOTS + '/5-buyer-desktop.png', fullPage: true });
  // filter periode
  await pick('Periode', 'lastMonth'); eq('Bulan lalu: tidak ada order → tabel & ranking kosong, kartu mengikuti', [(await text(page)).includes('Tidak ada buyer yang cocok'), (await names('top-buyer')).length, await cardValue(page, 'Buyer repeat order')], [true, 0, '0']);
  await pick('Periode', 'month'); eq('Bulan ini: data kembali', (await names('top-buyer'))[0], 'Budi Santoso'); await pick('Periode', 'all');
  await set((await page.$('input[aria-label="Cari buyer"]'))!, '0857 1111'); await new Promise(r => setTimeout(r, 250)); eq('cari buyer via nomor WhatsApp (0857… ↔ 62857…)', await page.$$eval('[data-testid=buyer-table] tbody tr', rs => rs.length), 1);
  await set((await page.$('input[aria-label="Cari buyer"]'))!, 'sari'); await new Promise(r => setTimeout(r, 250)); eq('cari buyer via nama', await page.$$eval('[data-testid=buyer-table] tbody tr', rs => rs.length), 1); await set((await page.$('input[aria-label="Cari buyer"]'))!, '');
  ok('CSP tidak dilanggar di halaman Data Buyer (grafik)', (await page.evaluate(() => (window as any).__csp)).length === 0);
  // dashboard: bagian Analisis Buyer
  await go(page, '/'); await waitText(page, 'Analisis Buyer'); ok('Dashboard memuat Top Buyer & statistik buyer', (await text(page)).includes('Top Buyer') && (await page.$('[data-testid=buyer-section] [data-testid=top-buyer]')) !== null);
  // ubah nama buyer → semua transaksi tetap terhubung
  await goBuyer(); await page.evaluate(() => { const tr = [...document.querySelectorAll('[data-testid=buyer-table] tbody tr')].find(r => r.textContent!.includes('Budi Santoso'))!; (tr.querySelector('button[title="Edit buyer"]') as HTMLElement).click(); });
  await fill(page, 'Nama Buyer', 'Budi S. Baru'); await clickText(page, 'button', 'Simpan'); await waitText(page, 'Buyer diperbarui');
  await go(page, '/penjualan'); await waitText(page, 'Budi S. Baru');
  eq('rename buyer: kedua transaksinya ikut berganti nama', [await page.$$eval('tbody tr', rs => rs.filter(r => r.textContent!.includes('Budi S. Baru')).length), (await text(page)).includes('Budi Santoso')], [2, false]);
  // detail buyer
  await goBuyer(); await clickText(page, 'a', 'Budi S. Baru'); await waitText(page, 'Riwayat transaksi');
  eq('detail buyer: total order, produk terbanyak, riwayat, transaksi berjalan', [await cardValue(page, 'Total order'), await cardValue(page, 'Produk paling sering dibeli'), (await text(page)).includes('Riwayat transaksi (2)'), await page.$$eval('[data-testid=running] li', l => l.length)], ['2', 'Zoom Premium', true, 2]);
  eq('detail buyer: omzet/modal/untung dari transaksi', [digits(await cardValue(page, 'Total omzet')), digits(await cardValue(page, 'Total modal')), digits(await cardValue(page, 'Total keuntungan'))], ['20000', '8000', '12000']);
  await pick('Periode', 'lastMonth'); eq('detail buyer mengikuti filter periode', [await cardValue(page, 'Total order'), (await text(page)).includes('Tidak ada transaksi pada periode ini')], ['0', true]); await pick('Periode', 'all');
  // batalkan → ranking turun; hapus buyer
  await go(page, '/penjualan'); await set((await page.$('input[placeholder^="Cari"]'))!, 'Tono'); await new Promise(r => setTimeout(r, 250)); await clickVisible(page, 'a[title="Edit"]'); await waitText(page, 'Edit TX-');
  await clickText(page, 'label', 'Transaksi dibatalkan'); await clickText(page, 'button', 'Simpan'); await page.waitForFunction(() => location.pathname === '/penjualan');
  await goBuyer(); eq('transaksi dibatalkan → keluar dari ranking omzet & order', [(await names('top-omzet')).includes('Tono Manual'), (await names('top-buyer')).includes('Tono Manual')], [false, false]);
  await page.evaluate(() => { const tr = [...document.querySelectorAll('[data-testid=buyer-table] tbody tr')].find(r => r.textContent!.includes('Tono Manual'))!; (tr.querySelector('button[title="Hapus buyer"]') as HTMLElement).click(); });
  await clickText(page, 'button', 'Hapus'); await waitText(page, 'masih memiliki 1 transaksi'); ok('hapus buyer yang masih punya transaksi ditolak', true);
  await go(page, '/penjualan'); await set((await page.$('input[placeholder^="Cari"]'))!, 'Tono'); await new Promise(r => setTimeout(r, 250)); await clickVisible(page, 'button[title="Hapus"]'); await clickText(page, 'button', 'Hapus'); await waitText(page, 'Transaksi dihapus');
  await goBuyer(); await page.evaluate(() => { const tr = [...document.querySelectorAll('[data-testid=buyer-table] tbody tr')].find(r => r.textContent!.includes('Tono Manual'))!; (tr.querySelector('button[title="Hapus buyer"]') as HTMLElement).click(); });
  await clickText(page, 'button', 'Hapus'); await waitText(page, 'Buyer dihapus'); await new Promise(r => setTimeout(r, 250)); eq('buyer tanpa transaksi bisa dihapus', await page.$$eval('[data-testid=buyer-table] tbody tr', rs => rs.some(r => r.textContent!.includes('Tono Manual'))), false);
  // CSV buyer
  await clickText(page, 'button', 'Ekspor CSV'); await new Promise(r => setTimeout(r, 800));
  const bf = readdirSync(DL).find(x => x.startsWith('data-buyer-'))!; const bcsv = readFileSync(`${DL}/${bf}`, 'utf8');
  ok('CSV buyer: kolom sesuai spesifikasi, statistik terhitung', bcsv.includes('ID Buyer,Nama Buyer,Nomor WhatsApp,Tanggal Pertama Order,Tanggal Terakhir Order,Total Order,Total Omzet,Total Modal,Total Keuntungan') && /Budi S\. Baru,6281234567890,[\d-]+,[\d-]+,2,20000,8000,12000/.test(bcsv));
  writeFileSync(DL + '/buyers-in.csv', 'Nama Buyer,Nomor WhatsApp,Catatan\r\nImpor Baru,0899 1234 5678,vip\r\nBudi Lagi,081234567890,\r\n,0812,\r\n');
  await (await page.$('input[type=file]'))!.uploadFile(DL + '/buyers-in.csv'); await waitText(page, 'Hasil validasi impor buyer');
  ok('impor buyer: 1 baru, nomor terdaftar dilewati, baris rusak dilaporkan', /Siap diimpor:\s*1/.test(await text(page)) && /dilewati\):\s*1/.test(await text(page)) && /bermasalah:\s*1/.test(await text(page)));
  await clickText(page, 'button', 'Impor 1 buyer'); await waitText(page, 'buyer diimpor'); await set((await page.$('input[aria-label="Cari buyer"]'))!, 'Impor'); await new Promise(r => setTimeout(r, 250));
  eq('buyer hasil impor tampil', await page.$$eval('[data-testid=buyer-table] tbody tr', rs => rs.length), 1);

  // ---- pengaturan
  await clickText(page, 'a', 'Pengaturan'); await waitText(page, 'Pemeriksaan konfigurasi server'); await waitText(page, 'Password admin (ADMIN_PASSWORD_HASH');
  ok('pemeriksaan konfigurasi: wajib hijau, tidak menampilkan nilai rahasia', !(await text(page)).includes('E2E-TOKEN') && (await page.$$('svg.text-red-600')).length === 0);
  await page.screenshot({ path: SHOTS + '/4-pengaturan-desktop.png' });

  // ---- HP (390x844)
  const m = await browser.newPage(); hook(m); await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  for (const [path, name] of [['/', 'dashboard'], ['/penjualan', 'penjualan'], ['/buyer', 'buyer'], ['/tambah', 'tambah'], ['/reminder', 'reminder'], ['/telegram', 'telegram'], ['/produk', 'produk'], ['/sheets', 'sheets'], ['/pengaturan', 'pengaturan']] as const) {
    await go(m, path); await new Promise(r => setTimeout(r, 400));
    const w = await m.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); ok(`HP ${name}: tanpa scroll horizontal halaman`, w[0] <= w[1], JSON.stringify(w));
    await m.screenshot({ path: `${SHOTS}/m-${name}.png`, fullPage: path === '/penjualan' || path === '/tambah' });
  }
  await go(m, '/penjualan'); await m.waitForSelector('tbody'); ok('HP: judul Data Penjualan tidak terhimpit tombol', (await m.$eval('h1', e => e.getBoundingClientRect().height)) < 40); const vis = await m.evaluate(() => ({ table: getComputedStyle(document.querySelector('table')!).display, cards: [...document.querySelectorAll('.md\\:hidden .space-y-2')].length }));
  eq('HP: tabel disembunyikan, tampil kartu', [vis.table, vis.cards >= 2], ['none', true]);
  await go(m, '/buyer'); const href = await m.$eval('a[href^="/buyer/"]', e => e.getAttribute('href')!); await go(m, href); await waitText(m, 'Riwayat transaksi'); await new Promise(r => setTimeout(r, 300));
  const wd = await m.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); ok('HP detail buyer: tanpa scroll horizontal', wd[0] <= wd[1], JSON.stringify(wd)); await m.screenshot({ path: SHOTS + '/m-buyer-detail.png', fullPage: true });
  await go(m, '/tambah'); await waitText(m, 'Buyer *'); const wf = await m.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); ok('HP form dengan picker buyer: tanpa scroll horizontal', wf[0] <= wf[1]);
  await m.close();

  // ---- logout
  await clickText(page, 'button', 'Keluar'); await page.waitForSelector('input[type=password]'); eq('keluar → API kembali 401', await page.evaluate(() => fetch('/api/transactions').then(r => r.status)), 401);
  ok('tidak ada error JS/console selama seluruh uji', problems.filter(p => !p.includes('401') && !p.includes('Failed to load resource')).length === 0, problems.join(' | '));
} catch (e) { fail++; console.log('FAIL (exception)', (e as Error).message); await page.screenshot({ path: SHOTS + '/error.png' }).catch(() => {}); }
await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))]); try { process.kill(-server.pid!, 'SIGKILL'); } catch { /* sudah berhenti */ }
console.log(fail ? `${fail} GAGAL` : 'SEMUA LULUS'); process.exit(fail ? 1 : 0);
