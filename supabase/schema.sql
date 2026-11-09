-- =====================================================================
-- REPORTO — skema Supabase (pengganti Google Sheet + Drive + Apps Script)
-- Jalankan SEKALI di: Supabase Dashboard → SQL Editor → New query → Run
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- OWNER (memakai Supabase Auth; profil = nama tampilan) ----------
create table if not exists public.owner_profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  nama           text not null,
  disetujui      boolean not null default true,
  login_terakhir timestamptz,
  dibuat         timestamptz not null default now()
);
create unique index if not exists owner_profiles_nama_uq on public.owner_profiles (lower(nama));

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.owner_profiles where user_id = auth.uid() and disetujui)
$$;

-- ---------- CLIENT (akses terbuka, ID otomatis) ----------
create sequence if not exists public.client_seq;
create table if not exists public.client_access (
  id             text primary key,
  nama           text not null,
  email          text not null unique,
  telepon        text not null,
  dibuat         timestamptz not null default now(),
  login_terakhir timestamptz not null default now()
);
create table if not exists public.testimoni (
  id        bigint generated always as identity primary key,
  waktu     timestamptz not null default now(),
  client_id text not null,
  nama      text,
  email     text,
  rating    int check (rating between 1 and 5),
  teks      text not null
);
create table if not exists public.app_settings (key text primary key, value text not null);
insert into public.app_settings(key, value) values ('client_password', 'reporto')
  on conflict (key) do nothing;   -- ganti kapan saja: update app_settings set value='...' where key='client_password';
create table if not exists public.login_gagal (
  kunci text primary key, n int not null default 0, sampai timestamptz
);

-- ---------- DATA PROYEK (ruangan, progress, material = 1 dokumen JSON) ----------
create table if not exists public.project_data (
  id         int primary key default 1 check (id = 1),
  isi        text not null,
  versi      text,
  tabel      jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- KURVA S ----------
create table if not exists public.kurva_items (
  id      bigint generated always as identity primary key,
  urutan  int not null default 0,
  nama    text not null,
  bobot   numeric not null default 0,
  mulai   date,
  selesai date,
  progres numeric not null default 0,
  ruangan text not null default ''
);
create table if not exists public.kurva_snaps (
  id     bigint generated always as identity primary key,
  tgl    date not null,
  persen numeric not null default 0
);
create table if not exists public.kurva_meta (
  id   int primary key default 1 check (id = 1),
  mode text not null default 'linear'
);
insert into public.kurva_meta(id, mode) values (1, 'linear') on conflict (id) do nothing;

-- ---------- GAMBAR (hero, denah, foto ruangan) — file ada di Storage ----------
create table if not exists public.gambar (
  id      uuid primary key default gen_random_uuid(),
  nama    text not null check (nama in ('hero', 'denah')),
  h       text not null,
  path    text not null,
  urutan  int,
  dibuat  timestamptz not null default now()
);
create table if not exists public.foto (
  id      uuid primary key default gen_random_uuid(),
  h       text not null unique,
  ruangan text,
  path    text not null,
  dibuat  timestamptz not null default now()
);
create table if not exists public.site_meta (key text primary key, value text);

-- ---------- ROW LEVEL SECURITY ----------
alter table public.owner_profiles enable row level security;
alter table public.client_access  enable row level security;
alter table public.testimoni      enable row level security;
alter table public.app_settings   enable row level security;
alter table public.login_gagal    enable row level security;
alter table public.project_data   enable row level security;
alter table public.kurva_items    enable row level security;
alter table public.kurva_snaps    enable row level security;
alter table public.kurva_meta     enable row level security;
alter table public.gambar         enable row level security;
alter table public.foto           enable row level security;
alter table public.site_meta      enable row level security;

drop policy if exists owner_baca_profil on public.owner_profiles;
create policy owner_baca_profil on public.owner_profiles for select to authenticated using (user_id = auth.uid());

drop policy if exists owner_baca_client on public.client_access;
create policy owner_baca_client on public.client_access for select to authenticated using (public.is_owner());
drop policy if exists owner_baca_testi on public.testimoni;
create policy owner_baca_testi on public.testimoni for select to authenticated using (public.is_owner());

-- data tampilan: boleh dibaca siapa saja, hanya owner yang boleh menulis
do $$
declare t text;
begin
  foreach t in array array['project_data','gambar','foto','site_meta'] loop
    execute format('drop policy if exists baca_publik on public.%I', t);
    execute format('create policy baca_publik on public.%I for select to anon, authenticated using (true)', t);
    execute format('drop policy if exists tulis_owner_i on public.%I', t);
    execute format('create policy tulis_owner_i on public.%I for insert to authenticated with check (public.is_owner())', t);
    execute format('drop policy if exists tulis_owner_u on public.%I', t);
    execute format('create policy tulis_owner_u on public.%I for update to authenticated using (public.is_owner()) with check (public.is_owner())', t);
    execute format('drop policy if exists tulis_owner_d on public.%I', t);
    execute format('create policy tulis_owner_d on public.%I for delete to authenticated using (public.is_owner())', t);
  end loop;
  foreach t in array array['kurva_items','kurva_snaps','kurva_meta'] loop   -- tulis lewat fungsi simpan_kurva
    execute format('drop policy if exists baca_publik on public.%I', t);
    execute format('create policy baca_publik on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- ---------- FUNGSI (security definer) ----------
create or replace function public.owner_cek()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.owner_profiles;
begin
  select * into r from public.owner_profiles where user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'pesan', 'Akun ini belum terdaftar sebagai owner.'); end if;
  if not r.disetujui then return jsonb_build_object('ok', false, 'pesan', 'Akun kamu belum disetujui owner.'); end if;
  update public.owner_profiles set login_terakhir = now() where user_id = r.user_id;
  return jsonb_build_object('ok', true, 'nama', r.nama);
end $$;

create or replace function public.daftar_client(p_nama text, p_email text, p_telepon text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nama text; v_email text; v_hp text; v_id text; v_pw text;
begin
  v_nama  := regexp_replace(regexp_replace(btrim(coalesce(p_nama, '')), '\s+', ' ', 'g'), '^[=+\-@]+', '');
  v_email := lower(btrim(coalesce(p_email, '')));
  v_hp    := regexp_replace(btrim(coalesce(p_telepon, '')), '[\s().-]', '', 'g');

  if char_length(v_nama) < 2  then return jsonb_build_object('ok', false, 'pesan', 'Nama minimal 2 huruf.'); end if;
  if char_length(v_nama) > 80 then return jsonb_build_object('ok', false, 'pesan', 'Nama terlalu panjang.'); end if;
  if char_length(v_email) > 120 or v_email ~ '^[=+\-@]'
     or v_email !~ '^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$' then
    return jsonb_build_object('ok', false, 'pesan', 'Email tidak valid. Contoh: nama@email.com');
  end if;
  if v_hp !~ '^\+?[0-9]{9,15}$' then
    return jsonb_build_object('ok', false, 'pesan', 'Nomor telepon tidak valid. Contoh: 081234567890 atau +6281234567890');
  end if;

  perform pg_advisory_xact_lock(hashtext('reporto_daftar_client'));
  if (select count(*) from public.client_access where dibuat > now() - interval '1 minute') >= 20 then
    return jsonb_build_object('ok', false, 'pesan', 'Terlalu banyak pendaftaran sekaligus. Coba lagi sebentar.');
  end if;
  if exists (select 1 from public.client_access where email = v_email) then
    return jsonb_build_object('ok', false, 'pesan',
      'Email ini sudah terdaftar. Masuk dengan ID dan password yang kamu terima saat mendaftar (pilih "Sudah punya ID?").');
  end if;

  v_id := 'C' || lpad(nextval('public.client_seq')::text, 3, '0');
  select value into v_pw from public.app_settings where key = 'client_password';
  insert into public.client_access(id, nama, email, telepon) values (v_id, v_nama, v_email, v_hp);
  return jsonb_build_object('ok', true, 'id', v_id, 'password', v_pw, 'nama', v_nama);
end $$;

create or replace function public.masuk_client(p_id text, p_password text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text := upper(btrim(coalesce(p_id, ''))); v_pw text; v_kunci text; g public.login_gagal; c public.client_access;
begin
  v_kunci := 'c:' || v_id;
  select * into g from public.login_gagal where kunci = v_kunci;
  if found and g.n >= 5 and g.sampai > now() then
    return jsonb_build_object('ok', false, 'pesan', 'Terlalu banyak percobaan salah. Coba lagi sekitar 10 menit.');
  end if;
  select value into v_pw from public.app_settings where key = 'client_password';
  select * into c from public.client_access where id = v_id;
  if not found or lower(btrim(coalesce(p_password, ''))) <> lower(v_pw) then
    insert into public.login_gagal(kunci, n, sampai) values (v_kunci, 1, now() + interval '10 minutes')
      on conflict (kunci) do update
      set n = case when public.login_gagal.sampai > now() then public.login_gagal.n + 1 else 1 end,
          sampai = now() + interval '10 minutes';
    return jsonb_build_object('ok', false, 'pesan', 'ID atau password salah.');
  end if;
  delete from public.login_gagal where kunci = v_kunci;
  update public.client_access set login_terakhir = now() where id = v_id;
  return jsonb_build_object('ok', true, 'id', c.id, 'nama', c.nama);
end $$;

create or replace function public.kirim_testimoni(p_id text, p_rating numeric, p_teks text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text := upper(btrim(coalesce(p_id, ''))); v_teks text := btrim(coalesce(p_teks, '')); v_r int; c public.client_access;
begin
  if char_length(v_teks) < 3 then return jsonb_build_object('ok', false, 'pesan', 'Tulis testimoni minimal 3 huruf.'); end if;
  v_r := case when p_rating between 1 and 5 then round(p_rating)::int else null end;
  select * into c from public.client_access where id = v_id;
  if not found then return jsonb_build_object('ok', false, 'pesan', 'ID tidak dikenali.'); end if;
  if exists (select 1 from public.testimoni where client_id = v_id and waktu > now() - interval '30 seconds') then
    return jsonb_build_object('ok', false, 'pesan', 'Testimoni kamu baru saja terkirim. Terima kasih!');
  end if;
  insert into public.testimoni(client_id, nama, email, rating, teks) values (v_id, c.nama, c.email, v_r, left(v_teks, 600));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.simpan_kurva(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it jsonb; sn jsonb; i int := 0;
begin
  if not public.is_owner() then return jsonb_build_object('ok', false, 'pesan', 'Hanya owner yang boleh menyimpan.'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'pesan', 'Data tidak valid.'); end if;
  delete from public.kurva_items where true;
  delete from public.kurva_snaps where true;
  for it in select value from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) limit 200 loop
    i := i + 1;
    insert into public.kurva_items(urutan, nama, bobot, mulai, selesai, progres, ruangan) values (
      i, left(coalesce(it->>'nama', ''), 120),
      coalesce(nullif(it->>'bobot', '')::numeric, 0),
      case when it->>'mulai'   ~ '^\d{4}-\d{2}-\d{2}$' then (it->>'mulai')::date end,
      case when it->>'selesai' ~ '^\d{4}-\d{2}-\d{2}$' then (it->>'selesai')::date end,
      coalesce(nullif(it->>'progres', '')::numeric, 0),
      left(coalesce(it->>'ruangan', ''), 80));
  end loop;
  for sn in select value from jsonb_array_elements(coalesce(p->'snaps', '[]'::jsonb)) limit 500 loop
    if sn->>'tgl' ~ '^\d{4}-\d{2}-\d{2}$' then
      insert into public.kurva_snaps(tgl, persen) values ((sn->>'tgl')::date, coalesce(nullif(sn->>'persen', '')::numeric, 0));
    end if;
  end loop;
  update public.kurva_meta set mode = case when p->>'mode' = 'smooth' then 'smooth' else 'linear' end where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- hak eksekusi
revoke all on function public.owner_cek(), public.daftar_client(text,text,text), public.masuk_client(text,text),
  public.kirim_testimoni(text,numeric,text), public.simpan_kurva(jsonb) from public;
grant execute on function public.is_owner() to anon, authenticated;
grant execute on function public.owner_cek(), public.simpan_kurva(jsonb) to authenticated;
grant execute on function public.daftar_client(text,text,text), public.masuk_client(text,text),
  public.kirim_testimoni(text,numeric,text) to anon, authenticated;

-- ---------- STORAGE ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reporto-gambar', 'reporto-gambar', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 10485760;

drop policy if exists "reporto owner upload" on storage.objects;
create policy "reporto owner upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'reporto-gambar' and public.is_owner());
drop policy if exists "reporto owner update" on storage.objects;
create policy "reporto owner update" on storage.objects for update to authenticated
  using (bucket_id = 'reporto-gambar' and public.is_owner());
drop policy if exists "reporto owner delete" on storage.objects;
create policy "reporto owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'reporto-gambar' and public.is_owner());
