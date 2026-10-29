# Uji UI end-to-end (Chromium headless)

Prasyarat (tidak dimasukkan ke package.json agar build Netlify tetap ringan):

    npm i --no-save puppeteer-core @sparticuz/chromium
    npm run test:e2e

Skrip menjalankan `tests/e2e/server.mts` (menyajikan `dist/` dan memetakan `/api/*` ke handler Netlify Function yang sama dengan produksi,
dengan database memori dan Telegram palsu, serta CSP dari netlify.toml), lalu mengemudikan browser: login, tambah/edit/hapus transaksi,
dashboard, reminder, Telegram, CSV impor/ekspor, tampilan HP 390px, dan logout. Tangkapan layar tersimpan di /tmp/shots.
