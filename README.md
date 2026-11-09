# Reporto — Supabase + GitHub Pages

Frontend statis (GitHub Pages) + database/login/penyimpanan foto di Supabase.
Pengganti Google Sheet + Drive + Apps Script (`Code.gs`).

```
index.html                 halaman utama (Index + Denah + Render sudah digabung)
config.js                  URL & anon key Supabase  ← WAJIB diisi
js/supabase-adapter.js     pengganti google.script.run → Supabase
supabase/schema.sql        tabel, RLS, fungsi, storage bucket
supabase/seed-owner.sql    mendaftarkan akun owner
```

## 1. Supabase
1. Buat project di supabase.com.
2. **SQL Editor → New query** → tempel isi `supabase/schema.sql` → **Run**.
3. **Authentication → Users → Add user** → isi email + password owner, centang **Auto Confirm User**.
   Email harus berbentuk `<nama>@<domainmu>`. Contoh: nama login `Rio` → `rio@domainkamu.com`.
4. Buka `supabase/seed-owner.sql`, sesuaikan email & nama, jalankan di SQL Editor.
5. **Project Settings → API**: salin *Project URL* dan *anon public key*.
   Jangan pakai `service_role` key di mana pun di repo ini.

## 2. config.js
Isi `SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `OWNER_EMAIL_DOMAIN` (domain di langkah 1.3).

## 3. GitHub Pages
```bash
git init && git add . && git commit -m "Reporto di Supabase"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```
Repo → **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)`.

## 4. Domain sendiri
Di **Settings → Pages → Custom domain** isi domainmu (GitHub otomatis membuat file `CNAME`), lalu di DNS:
- Subdomain (mis. `laporan.domainmu.com`): record **CNAME** → `<user>.github.io`
- Domain utama (apex): 4 record **A** → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`

Tunggu DNS aktif, lalu centang **Enforce HTTPS**.

## 5. Memindahkan data lama
- **Data ruangan, progress, material, foto**: di versi lama buka halaman Denah → **Backup .json**.
  Di versi baru login owner → **Impor .json**. Data otomatis tersinkron ke Supabase.
  (Foto lama yang hanya berupa rujukan `drive:<id>` tidak ikut terbawa kalau backup-nya tidak memuat gambarnya; unggah ulang.)
- **Kurva S**: bisa diisi ulang dari halaman Kurva S, atau impor CSV di Table Editor ke `kurva_items` / `kurva_snaps`.
- **Akses Client / Testimoni**: ekspor sheet ke CSV → impor ke tabel `client_access` / `testimoni`.
  Jalankan `select setval('client_seq', <nomor ID terbesar>);` supaya ID berikutnya tidak bentrok.

## Pengaturan
- Password client (dulu `PASSWORD_CLIENT`): `update app_settings set value='baru' where key='client_password';`
- Melihat pendaftar & testimoni: Table Editor → `client_access`, `testimoni`.

## Keamanan singkat
- Semua tabel memakai Row Level Security. Pengunjung hanya bisa **membaca** data tampilan dan memanggil fungsi daftar/masuk client/testimoni.
- Menulis data, foto, dan kurva hanya untuk user yang ada di `owner_profiles` (login Supabase Auth, password di-hash oleh Supabase).
- Data client (nama, email, telepon) tidak bisa dibaca publik, hanya owner.
- Bucket foto bersifat publik-baca: siapa pun yang punya URL file bisa membukanya.
