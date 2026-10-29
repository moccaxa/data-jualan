import { importCSV, parseCSV, toCSV } from '../src/lib/csv';
import { reminderSchedule, dedupeKey } from '../shared/reminders';
import { calcExpiry } from '../shared/dates';
let fail = 0; const eq = (n: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
const H = 'ID,Nama Buyer,WhatsApp,Produk,Plan,Variasi,Durasi,Kuantitas,Tanggal Order,Tanggal Habis,Email Akun,Harga Jual,Harga Modal,FH,Catatan,Status';
const csv = [H,
 'TX-A1,Budi,081234567890,Zoom Premium,Private,Pro,1 bulan,1,2026-10-01,,budi@x.com,10000,5000,FH1,"catatan, dengan koma",Aktif',
 ',Sari,+6281355550000,Canva,Designer,,30 hari,2,15/10/2026,,,"Rp 20.000",8000,FH2,=HYPERLINK(""x""),Aktif',
 'TX-A1,Budi,081234567890,Zoom Premium,Private,Pro,1 bulan,1,2026-10-01,,budi@x.com,10000,5000,FH1,dup id,Aktif',
 ',Budi,081234567890,Zoom Premium,Private,Pro,1 bulan,1,2026-10-01,,budi@x.com,10000,5000,FH1,dup fingerprint,Aktif',
 ',Tono,12345,Canva,Private,,1 bulan,1,2026-10-01,,,1000,500,,,',
 ',Rina,081200001111,Canva,Gold,,1 bulan,1,2026-10-01,,,1000,500,,,',
 ',Dewi,081200002222,Canva,Sharing,,1 minggu,1,2026-10-01,,,1000,500,,,',
 ',Eko,081200003333,Canva,Sharing,,1 bulan,1,2026-02-31,,,1000,500,,,Dibatalkan'].join('\n');
const r = importCSV(csv, []);
eq('jumlah siap impor', r.add.length, 2);
eq('duplikat dilewati (id + fingerprint)', r.dupes, 2);
eq('baris error', r.errors.map(e => e.row), [6, 7, 8, 9]);
eq('tanggal habis otomatis bulan', r.add[0].expiryDate, '2026-11-01');
eq('tanggal DD/MM/YYYY + 30 hari', [r.add[1].orderDate, r.add[1].expiryDate], ['2026-10-15', '2026-11-14']);
eq('harga "Rp 20.000"', r.add[1].sellPrice, 20000);
eq('WA +62 dinormalisasi', r.add[1].whatsapp, '6281355550000');
eq('id dipertahankan', r.add[0].id, 'TX-A1');
eq('koma dalam kutip', r.add[0].notes, 'catatan, dengan koma');
const again = importCSV(csv, r.add);
eq('impor ulang: tidak ada tambahan', again.add.length, 0);
const out = toCSV(r.add, '2026-10-24');
eq('ekspor default tanpa password', out.includes('Password Akun'), false);
eq('ekspor tidak pernah memuat kolom password', toCSV(r.add, '2026-10-24').includes('Password'), false);
const evil = { ...r.add[0], notes: '=cmd|calc', accountPassword: 'rahasia123' };
eq('anti formula injection', toCSV([evil], '2026-10-24').includes(",'=cmd|calc,"), true);
eq('password tidak bocor di ekspor default', toCSV([evil], '2026-10-24').includes('rahasia123'), false);
const rt = importCSV(toCSV(r.add, '2026-10-24'), []);
eq('roundtrip ekspor→impor', rt.add.length, 2);
eq('delimiter titik koma', parseCSV('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
eq('multiline dalam kutip', parseCSV('a,b\n"x\ny",2')[1][0], 'x\ny');
eq('kolom wajib hilang', !!importCSV('Nama Buyer,Produk\nA,B', []).fatal, true);
// jadwal reminder ikut tanggal habis
const t = { expiryDate: '2026-11-30', reminderOffsets: [7, 14, 0, 7] };
eq('jadwal (unik, urut)', reminderSchedule(t).map(x => x.date), ['2026-11-16', '2026-11-23', '2026-11-30']);
const t2 = { ...t, expiryDate: calcExpiry('2026-12-15', 0, 'day') };
eq('tanggal habis diubah → jadwal bergeser', reminderSchedule(t2).map(x => x.date), ['2026-12-01', '2026-12-08', '2026-12-15']);
eq('kunci anti-duplikat stabil', dedupeKey('TX-1', 7, '2026-11-23'), 'TX-1|7|2026-11-23');
console.log(fail ? `${fail} GAGAL` : 'SEMUA LULUS');
