apter · JS
/* Reporto — adapter Supabase.
 * Meniru google.script.run milik Apps Script supaya Index.html tidak perlu ditulis ulang.
 * Tiap fungsi di API di bawah = satu fungsi di Code.gs lama (nama & bentuk hasil sama). */
(function () {
  "use strict";
  var cfg = window.REPORTO_CONFIG || {};
  var BUCKET = cfg.BUCKET || "reporto-gambar";
  var ok = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(cfg.SUPABASE_URL || "") && cfg.SUPABASE_ANON_KEY && !/GANTI/.test(cfg.SUPABASE_ANON_KEY);
  if (!window.supabase || !ok) {
    console.error("[Reporto] config.js belum diisi (SUPABASE_URL / SUPABASE_ANON_KEY) atau supabase-js gagal dimuat.");
    window.google = { script: { run: makeRunner({}, null, null, "Konfigurasi Supabase belum diisi di config.js") } };
    return;
  }
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    // sesi owner hanya hidup selama tab terbuka (sejalan dengan sessionStorage "role" di Index.html)
    auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
 
  /* ---------- util ---------- */
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var HASH = /^[0-9a-f]{8,64}$/;
  var MAX_DATAURL = 6000000, MAX_DATA = 3000000;
  function fail(e) { return new Error((e && e.message) || String(e)); }
  function slug(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "owner";
  }
  function ownerEmail(nama) {
    nama = String(nama || "").trim();
    return nama.indexOf("@") > 0 ? nama.toLowerCase() : slug(nama) + "@" + (cfg.OWNER_EMAIL_DOMAIN || "example.com");
  }
  function parseDataUrl(t, allowGif) {
    t = String(t || "");
    var m = /^data:(image\/(?:jpeg|png|webp|gif));base64,/.exec(t.slice(0, 40));
    if (!m || t.length > MAX_DATAURL || (!allowGif && m[1] === "image/gif")) return null;
    return { mime: m[1], ext: m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : m[1] === "image/gif" ? "gif" : "jpg" };
  }
  function dataUrlToBlob(u) { return fetch(u).then(function (r) { return r.blob(); }); }
  function blobToDataUrl(b) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(b); });
  }
  function publicUrl(path) { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }
  function ambilDataUrl(path) {
    return fetch(publicUrl(path)).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); }).then(blobToDataUrl);
  }
  function rand() { return Math.random().toString(36).slice(2, 10); }
  function rpc(name, args) {
    return sb.rpc(name, args).then(function (r) { if (r.error) throw fail(r.error); return r.data; });
  }
  async function metaGet(key) {
    var r = await sb.from("site_meta").select("value").eq("key", key).maybeSingle();
    return r.data ? r.data.value : null;
  }
  async function metaSet(key, value) {
    var r = await sb.from("site_meta").upsert({ key: key, value: String(value) });
    if (r.error) throw fail(r.error);
  }
 
  /* ---------- API (nama = nama fungsi di Code.gs) ---------- */
  var API = {
    // ===== akun =====
    daftarClient: function (nama, email, telepon) { return rpc("daftar_client", { p_nama: nama, p_email: email, p_telepon: telepon }); },
    masukClient: function (id, pw) { return rpc("masuk_client", { p_id: id, p_password: pw }); },
    kirimTestimoni: function (id, rating, teks) {
      var n = Number(rating); return rpc("kirim_testimoni", { p_id: id, p_rating: n >= 1 && n <= 5 ? n : null, p_teks: teks });
    },
    masuk: async function (nama, peran, password) {
      var r = await sb.auth.signInWithPassword({ email: ownerEmail(nama), password: String(password || "") });
      if (r.error) return { ok: false, pesan: /rate|too many/i.test(r.error.message) ? "Terlalu banyak percobaan. Coba lagi beberapa menit." : "Nama atau password salah." };
      var c = await rpc("owner_cek", {});
      if (!c || !c.ok) { await sb.auth.signOut(); return { ok: false, pesan: (c && c.pesan) || "Akun tidak valid." }; }
      return { ok: true, nama: c.nama, peran: "owner" };
    },
    ubahPasswordOwner: async function (nama, lama, baru) {
      baru = String(baru || "");
      if (baru.length < 6) return { ok: false, pesan: "Password baru minimal 6 karakter." };
      var c = await API.masuk(nama, "owner", lama);
      if (!c.ok) return { ok: false, pesan: "Nama atau password lama salah." };
      var u = await sb.auth.updateUser({ password: baru });
      return u.error ? { ok: false, pesan: u.error.message } : { ok: true };
    },
 
    // ===== kurva S =====
    ambilKurva: async function () {
      var a = await sb.from("kurva_items").select("*").order("urutan"), b = await sb.from("kurva_snaps").select("*").order("tgl"),
          m = await sb.from("kurva_meta").select("mode").eq("id", 1).maybeSingle();
      if (a.error) throw fail(a.error); if (b.error) throw fail(b.error);
      var items = (a.data || []).map(function (r) {
        return { id: "k" + r.id, nama: r.nama, bobot: Number(r.bobot), mulai: r.mulai || "", selesai: r.selesai || "", progres: Number(r.progres), ruangan: r.ruangan || "" };
      });
      var snaps = (b.data || []).map(function (r) { return { id: "s" + r.id, tgl: r.tgl, persen: Number(r.persen) }; });
      return { mode: m.data && m.data.mode === "smooth" ? "smooth" : "linear", items: items, snaps: snaps, ada: items.length > 0 || snaps.length > 0 };
    },
    simpanKurva: function (k) { return rpc("simpan_kurva", { p: k }); },
 
    // ===== data ruangan (1 dokumen JSON) =====
    ambilData: async function () {
      var r = await sb.from("project_data").select("isi,versi").eq("id", 1).maybeSingle();
      if (r.error) throw fail(r.error);
      return r.data ? { ada: true, json: r.data.isi, versi: r.data.versi || "" } : { ada: false };
    },
    simpanData: async function (json, versi, tabel) {
      var t = String(json || "");
      if (!t || t.length > MAX_DATA) return { ok: false, pesan: "Data terlalu besar atau kosong." };
      try { JSON.parse(t); } catch (_) { return { ok: false, pesan: "Data bukan JSON valid." }; }
      var r = await sb.from("project_data").upsert({ id: 1, isi: t, versi: String(versi || ""), tabel: tabel || null, updated_at: new Date().toISOString() });
      if (r.error) return { ok: false, pesan: /row-level|policy|permission/i.test(r.error.message) ? "Hanya owner yang boleh menyimpan (login ulang sebagai owner)." : r.error.message };
      return { ok: true };
    },
 
    // ===== foto ruangan / material =====
    cekFoto: async function (daftar) {
      var hs = (Array.isArray(daftar) ? daftar : []).slice(0, 400).filter(function (h) { return HASH.test(String(h)); }), out = {};
      for (var i = 0; i < hs.length; i += 100) {
        var r = await sb.from("foto").select("id,h").in("h", hs.slice(i, i + 100));
        if (r.error) throw fail(r.error);
        (r.data || []).forEach(function (x) { out[x.h] = x.id; });
      }
      return out;
    },
    unggahFoto: async function (h, dataUrl, ruangan) {
      var meta = parseDataUrl(dataUrl, true);
      if (!meta || !HASH.test(String(h))) return { ok: false, pesan: "Gambar tidak valid atau terlalu besar." };
      var ada = await sb.from("foto").select("id").eq("h", h).maybeSingle();
      if (ada.data) return { ok: true, id: ada.data.id };
      var path = "foto/" + slug(ruangan || "umum") + "/" + h + "." + meta.ext;
      var up = await sb.storage.from(BUCKET).upload(path, await dataUrlToBlob(dataUrl), { contentType: meta.mime, upsert: true });
      if (up.error) return { ok: false, pesan: "Upload gagal: " + up.error.message };
      var ins = await sb.from("foto").insert({ h: h, ruangan: String(ruangan || "").slice(0, 60), path: path }).select("id").single();
      if (ins.error) {
        var lagi = await sb.from("foto").select("id").eq("h", h).maybeSingle(); // balapan dengan unggahan lain
        if (lagi.data) return { ok: true, id: lagi.data.id };
        return { ok: false, pesan: ins.error.message };
      }
      return { ok: true, id: ins.data.id };
    },
    ambilFoto: async function (ids) {
      var list = (Array.isArray(ids) ? ids : []).slice(0, 4).map(String).filter(function (x) { return UUID.test(x); }), out = {};
      if (!list.length) return out;
      var r = await sb.from("foto").select("id,path").in("id", list);
      if (r.error) throw fail(r.error);
      await Promise.all((r.data || []).map(async function (x) { try { out[x.id] = await ambilDataUrl(x.path); } catch (_) {} }));
      return out;
    },
 
    // ===== hero & denah =====
    cekGambar: async function () {
      var r = await sb.from("gambar").select("id,nama,h").not("urutan", "is", null).order("urutan");
      if (r.error) throw fail(r.error);
      var out = { hero: [], denah: [] };
      (r.data || []).forEach(function (x) { out[x.nama].push({ id: x.id, h: x.h }); });
      return out;
    },
    unggahGambar: async function (nama, h, dataUrl) {
      var meta = parseDataUrl(dataUrl, false);
      if ((nama !== "hero" && nama !== "denah") || !meta || !HASH.test(String(h))) return { ok: false, pesan: "Gambar tidak valid atau terlalu besar." };
      var path = nama + "/" + String(h).slice(0, 8) + "-" + rand() + "." + meta.ext;
      var up = await sb.storage.from(BUCKET).upload(path, await dataUrlToBlob(dataUrl), { contentType: meta.mime });
      if (up.error) return { ok: false, pesan: "Upload gagal: " + up.error.message };
      var ins = await sb.from("gambar").insert({ nama: nama, h: h, path: path, urutan: null }).select("id").single();
      return ins.error ? { ok: false, pesan: ins.error.message } : { ok: true, id: ins.data.id };
    },
    simpanDaftarGambar: async function (nama, daftar, rasio) {
      if (nama !== "hero" && nama !== "denah") return { ok: false, pesan: "Nama gambar tidak dikenal." };
      var items = (Array.isArray(daftar) ? daftar : []).slice(0, nama === "hero" ? 5 : 1).map(function (x) { return String((x && x.id) || ""); });
      if (items.some(function (id) { return !UUID.test(id); })) return { ok: false, pesan: "File gambar tidak ditemukan." };
      var all = await sb.from("gambar").select("id,path").eq("nama", nama);
      if (all.error) return { ok: false, pesan: all.error.message };
      var ada = (all.data || []).map(function (x) { return x.id; });
      if (items.some(function (id) { return ada.indexOf(id) < 0; })) return { ok: false, pesan: "File gambar tidak ditemukan." };
      for (var i = 0; i < items.length; i++) {
        var u = await sb.from("gambar").update({ urutan: i }).eq("id", items[i]);
        if (u.error) return { ok: false, pesan: u.error.message };
      }
      var buang = (all.data || []).filter(function (x) { return items.indexOf(x.id) < 0; });
      if (buang.length) {
        await sb.storage.from(BUCKET).remove(buang.map(function (x) { return x.path; }));
        await sb.from("gambar").delete().in("id", buang.map(function (x) { return x.id; }));
      }
      await metaSet("kelola_" + nama, "1");
      if (nama === "denah") await metaSet("denah_ratio", Number(rasio) || 0);
      return { ok: true };
    },
    ambilGambar: async function () {
      var r = await sb.from("gambar").select("nama,path").not("urutan", "is", null).order("urutan");
      if (r.error) throw fail(r.error);
      var rows = r.data || [];
      var baca = async function (x) { try { return await ambilDataUrl(x.path); } catch (_) { return ""; } };
      var hero = (await Promise.all(rows.filter(function (x) { return x.nama === "hero"; }).map(baca))).filter(Boolean);
      var d = rows.filter(function (x) { return x.nama === "denah"; })[0];
      var denah = d ? await baca(d) : "";
      var m = await sb.from("site_meta").select("key,value");
      var meta = {}; (m.data || []).forEach(function (x) { meta[x.key] = x.value; });
      return { hero: hero, denah: denah, denahRatio: Number(meta.denah_ratio) || 0, kelolaHero: meta.kelola_hero === "1", kelolaDenah: meta.kelola_denah === "1" };
    },
 
    // ===== komentar: fitur ini sudah dinonaktifkan di Index.html (kmPull/kmPush langsung return) =====
    ambilKomentar: function () { return Promise.resolve({ entries: [] }); },
    kirimKomentar: function () { return Promise.resolve({ ok: true, baru: 0 }); }
  };
 
  /* ---------- pengganti google.script.run ---------- */
  function makeRunner(api, onOk, onNo, bootError) {
    return new Proxy({}, {
      get: function (_, fn) {
        if (fn === "withSuccessHandler") return function (f) { return makeRunner(api, f, onNo, bootError); };
        if (fn === "withFailureHandler") return function (f) { return makeRunner(api, onOk, f, bootError); };
        return function () {
          var args = arguments, done = onOk, bad = onNo;
          Promise.resolve().then(function () {
            if (bootError) throw new Error(bootError);
            if (typeof api[fn] !== "function") throw new Error("Fungsi backend tidak dikenal: " + fn);
            return api[fn].apply(null, args);
          }).then(function (r) { if (done) done(r); }, function (e) { console.error("[Reporto] " + fn + " gagal:", e); if (bad) bad(fail(e)); });
        };
      }
    });
  }
  window.google = { script: { run: makeRunner(API, null, null) } };
 
  // Cek koneksi saat halaman dibuka: hasilnya tampil di Console (F12)
  sb.from("site_meta").select("key").limit(1).then(function (r) {
    if (!r.error) { console.log("[Reporto] Koneksi Supabase OK dan tabel sudah ada."); return; }
    var m = r.error.message || String(r.error);
    if (/relation .* does not exist|schema cache|Could not find the table/i.test(m)) console.error("[Reporto] Koneksi OK, TAPI tabel belum ada: schema.sql belum berhasil dijalankan. Detail:", m);
    else if (/api key|jwt|apikey|unauthorized|401/i.test(m + " " + (r.status || ""))) console.error("[Reporto] API key ditolak. Coba pakai kunci anon lama (eyJ...) dari tab Legacy API Keys. Detail:", m);
    else console.error("[Reporto] Koneksi gagal. Periksa SUPABASE_URL di config.js. Detail:", m, "status:", r.status);
  }, function (e) { console.error("[Reporto] Tidak bisa menjangkau Supabase. SUPABASE_URL salah ketik / tidak ada internet:", e); });
  window.REPORTO_SB = sb; // untuk debugging di console
})();
 