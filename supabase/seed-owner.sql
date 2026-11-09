-- Jalankan SETELAH membuat user owner di Authentication → Users (centang "Auto Confirm User").
-- Ganti email dan nama sesuai akun yang kamu buat. Ulangi untuk tiap owner.
insert into public.owner_profiles (user_id, nama)
select id, 'Rio'                       -- ← nama yang diketik di kolom "Nama" saat login owner
from auth.users
where email = 'rio@domainkamu.com'     -- ← email user yang baru dibuat
on conflict (user_id) do update set nama = excluded.nama, disetujui = true;
