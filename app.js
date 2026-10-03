'use strict';
/* Halaman siswa: login -> layar penuh -> ujian (anti copy-paste, anti pindah layar) -> kirim */
(function () {
  var API = window.HOTS_API_URL;
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    phase: 'login',            // login | exam | done
    ident: null,               // {nama, absen, kelas, tanggal}
    token: null,
    soal: [],
    jawaban: [],
    idx: 0,
    deadline: 0,
    offset: 0,                 // serverNow - Date.now()
    pelanggaran: 0,
    maks: 3,
    locked: false,
    submitting: false,
    baseW: 0,
    dirty: false,
    timerId: null,
    saveId: null,
    lastPasteLog: 0
  };

  /* ---------------- util ---------------- */
  function api(action, data, timeoutMs) {
    if (!API || API.indexOf('PASTE_') === 0) {
      return Promise.reject(new Error('Alamat server belum diatur. Guru perlu mengisi config.js.'));
    }
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, timeoutMs || 25000);
    var body = Object.assign({ action: action }, data || {});
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: ctl.signal
    }).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(t);
      if (!j || j.ok === false) throw new Error((j && j.error) || 'Terjadi kesalahan di server.');
      return j;
    }, function (e) {
      clearTimeout(t);
      throw new Error(e && e.name === 'AbortError' ? 'Koneksi terlalu lama. Periksa internet.' : 'Tidak bisa terhubung ke server. Periksa internet.');
    });
  }

  function toast(msg) {
    var el = $('toast'); el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.add('hidden'); }, 2600);
  }
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }
  function screen(name) {
    ['login', 'exam', 'done'].forEach(function (n) { $('screen-' + n).classList.toggle('active', n === name); });
    document.body.classList.toggle('exam', name === 'exam');
    window.scrollTo(0, 0);
  }
  function fmtWaktu(ms) {
    return new Date(ms).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/\./g, ':') + ' WIB';
  }
  function nowServer() { return Date.now() + S.offset; }
  function isFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function enterFs() {
    var el = document.documentElement;
    try {
      if (el.requestFullscreen) return el.requestFullscreen({ navigationUI: 'hide' });
      if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); return Promise.resolve(); }
    } catch (e) { return Promise.reject(e); }
    return Promise.reject(new Error('unsupported'));
  }
  function exitFs() {
    try {
      if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen();
      else if (document.webkitExitFullscreen && document.webkitFullscreenElement) document.webkitExitFullscreen();
    } catch (e) { /* abaikan */ }
  }
  function fsSupported() {
    var el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }

  /* ---------------- status & login ---------------- */
  function loadStatus() {
    var banner = $('status-banner'), btn = $('btn-masuk');
    api('status').then(function (r) {
      S.offset = r.now - Date.now();
      $('tanggal').value = r.tanggal;
      if (r.judul) { $('judul').textContent = r.judul; document.title = r.judul; }
      var info = r.durasi > 0 ? ' Durasi ' + r.durasi + ' menit.' : '';
      if (r.state === 'berlangsung') {
        banner.className = 'banner ok';
        banner.textContent = 'Pengerjaan dibuka sampai ' + fmtWaktu(r.selesai) + '.' + info;
        btn.disabled = false;
      } else if (r.state === 'belum') {
        banner.className = 'banner warn';
        banner.textContent = 'Pengerjaan belum dibuka. Mulai ' + fmtWaktu(r.mulai) + '.';
      } else if (r.state === 'selesai') {
        banner.className = 'banner bad';
        banner.textContent = 'Waktu pengerjaan sudah ditutup (' + fmtWaktu(r.selesai) + ').';
      } else {
        banner.className = 'banner warn';
        banner.textContent = 'Jadwal pengerjaan belum diatur oleh guru.';
      }
    }).catch(function (e) {
      banner.className = 'banner bad';
      banner.textContent = e.message;
      $('tanggal').value = new Date().toISOString().slice(0, 10);
    });
  }

  $('form-login').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var err = $('login-error'); err.textContent = '';
    var nama = $('nama').value.replace(/\s+/g, ' ').trim();
    var absen = $('absen').value.trim();
    var kelas = $('kelas').value;
    var tanggal = $('tanggal').value;
    if (nama.length < 3) { err.textContent = 'Isi nama lengkap (minimal 3 huruf).'; return; }
    if (!/^\d{1,3}$/.test(absen)) { err.textContent = 'Isi No. Absen dengan angka.'; return; }
    if (!kelas) { err.textContent = 'Pilih kelas.'; return; }
    if (!fsSupported()) {
      err.textContent = 'Browser/perangkat ini tidak mendukung layar penuh. Gunakan laptop/PC (Chrome/Edge) atau Chrome Android.';
      return;
    }
    var btn = $('btn-masuk'); btn.disabled = true; btn.textContent = 'Memeriksa...';

    // Layar penuh HARUS diminta langsung dari klik pengguna (sebelum menunggu server).
    enterFs().catch(function () { /* dicek di bawah */ }).then(function () {
      if (!isFs()) throw new Error('Izinkan layar penuh agar bisa mengerjakan. Klik tombol lagi dan pilih "Izinkan".');
      return api('login', { nama: nama, absen: absen, kelas: kelas, tanggal: tanggal });
    }).then(function (r) {
      mulaiUjian({ nama: nama, absen: absen, kelas: kelas, tanggal: tanggal }, r);
    }).catch(function (e) {
      exitFs();
      err.textContent = e.message;
      btn.disabled = false; btn.textContent = 'Masuk & Mulai';
    });
  });

  /* ---------------- ujian ---------------- */
  function draftKey() { return 'hots_draft_' + S.ident.kelas + '_' + S.ident.absen; }

  function mulaiUjian(ident, r) {
    S.ident = ident; S.token = r.token; S.soal = r.soal;
    S.offset = r.now - Date.now();
    S.deadline = r.deadline; S.pelanggaran = r.pelanggaran || 0; S.maks = r.maks || 3;
    S.jawaban = r.soal.map(function (q, i) { return (r.jawaban && r.jawaban[i]) || ''; });
    try {   // cadangan lokal bila server kosong
      var d = JSON.parse(localStorage.getItem(draftKey()) || 'null');
      if (d && Array.isArray(d)) d.forEach(function (t, i) { if (!S.jawaban[i] && t) S.jawaban[i] = String(t); });
    } catch (e) { /* abaikan */ }
    S.idx = 0; S.phase = 'exam'; S.locked = false; S.submitting = false; S.dirty = false;

    $('who-nama').textContent = ident.nama;
    $('who-info').textContent = ' · ' + ident.kelas + ' · Absen ' + ident.absen;
    buildNav(); renderSoal(); updatePel(); screen('exam');

    clearInterval(S.timerId); S.timerId = setInterval(tick, 500); tick();
    clearInterval(S.saveId); S.saveId = setInterval(simpanDraft, 40000);
    setTimeout(setBaseline, 900);
    if (S.pelanggaran >= S.maks) kirim(true, 'Batas pelanggaran tercapai');
  }

  function setBaseline() { S.baseW = window.innerWidth * (window.devicePixelRatio || 1); }

  function tick() {
    if (S.phase !== 'exam') return;
    var sisa = S.deadline - nowServer();
    if (sisa <= 0) { $('timer').textContent = '00:00'; kirim(true, 'Waktu habis'); return; }
    var m = Math.floor(sisa / 60000), s = Math.floor((sisa % 60000) / 1000);
    $('timer').textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    $('pill-timer').className = 'pill' + (sisa < 300000 ? ' warn' : '') + (sisa < 60000 ? ' bad' : '');
  }

  function updatePel() {
    var p = $('pill-pel');
    p.textContent = 'Pelanggaran: ' + S.pelanggaran + '/' + S.maks;
    p.className = 'pill' + (S.pelanggaran >= 2 ? ' bad' : S.pelanggaran === 1 ? ' warn' : ' ok');
  }

  function buildNav() {
    var nav = $('nav'); nav.innerHTML = '';
    S.soal.forEach(function (q, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = q.no; b.setAttribute('aria-label', 'Soal ' + q.no);
      b.addEventListener('click', function () { goTo(i); });
      nav.appendChild(b);
    });
    refreshNav();
  }
  function refreshNav() {
    var bs = $('nav').children;
    for (var i = 0; i < bs.length; i++) {
      bs[i].className = (i === S.idx ? 'cur' : '') + (S.jawaban[i] && S.jawaban[i].trim().length > 0 && i !== S.idx ? ' done' : '');
    }
  }

  function renderKasus(el, text) {
    el.innerHTML = '';
    String(text).split('```').forEach(function (seg, i) {
      if (!seg.trim()) return;
      if (i % 2 === 1) {
        var pre = document.createElement('pre'); pre.className = 'code'; pre.textContent = seg.replace(/^\n|\n$/g, '');
        el.appendChild(pre);
      } else {
        var sp = document.createElement('div'); sp.textContent = seg.replace(/^\n|\n$/g, '');
        el.appendChild(sp);
      }
    });
  }

  function renderSoal() {
    var q = S.soal[S.idx];
    $('q-bagian').textContent = q.bagian; $('q-level').textContent = 'Level ' + q.level;
    $('q-judul').textContent = 'Soal ' + q.no + ' dari ' + S.soal.length;
    renderKasus($('q-kasus'), q.kasus);
    $('q-tanya').textContent = q.pertanyaan;
    var ta = $('jawab'); ta.value = S.jawaban[S.idx] || '';
    ta.dataset.prev = ta.value;
    $('q-hitung').textContent = ta.value.length + ' karakter';
    $('btn-prev').disabled = S.idx === 0;
    $('btn-next').disabled = S.idx === S.soal.length - 1;
    refreshNav();
  }
  function goTo(i) { S.idx = Math.max(0, Math.min(S.soal.length - 1, i)); renderSoal(); window.scrollTo(0, 0); }
  $('btn-prev').addEventListener('click', function () { goTo(S.idx - 1); });
  $('btn-next').addEventListener('click', function () { goTo(S.idx + 1); });

  /* ---- input jawaban: tolak paste/drop ---- */
  var ta = $('jawab');
  ta.addEventListener('beforeinput', function (e) {
    var t = e.inputType || '';
    if (t === 'insertFromPaste' || t === 'insertFromDrop' || t === 'insertFromYank' || t === 'insertFromPasteAsQuotation') {
      e.preventDefault(); peringatanPaste();
    }
  });
  ta.addEventListener('input', function (e) {
    var prev = ta.dataset.prev || '';
    // heuristik: lonjakan teks besar dalam satu kali input = hampir pasti hasil tempel
    if (!e.isComposing && ta.value.length - prev.length > 25) {
      ta.value = prev; peringatanPaste(); return;
    }
    ta.dataset.prev = ta.value;
    S.jawaban[S.idx] = ta.value; S.dirty = true;
    $('q-hitung').textContent = ta.value.length + ' karakter';
    try { localStorage.setItem(draftKey(), JSON.stringify(S.jawaban)); } catch (er) { /* abaikan */ }
    refreshNav();
  });

  function peringatanPaste() {
    toast('Copy-paste dinonaktifkan. Ketik jawabanmu sendiri.');
    var n = Date.now();
    if (n - S.lastPasteLog > 10000 && S.token) {
      S.lastPasteLog = n;
      api('lapor', Object.assign({ token: S.token, jenis: 'Mencoba paste', hitung: false }, idPair())).catch(function () {});
    }
  }
  function idPair() { return { kelas: S.ident.kelas, absen: S.ident.absen }; }

  /* ---- simpan draft ke server ---- */
  function simpanDraft() {
    if (S.phase !== 'exam' || !S.dirty || S.submitting) return;
    S.dirty = false;
    api('simpan', Object.assign({ token: S.token, jawaban: S.jawaban }, idPair())).catch(function () { S.dirty = true; });
  }

  /* ---------------- penjaga: anti copy/paste ---------------- */
  ['copy', 'cut', 'paste', 'contextmenu', 'dragstart', 'drop', 'dragover'].forEach(function (t) {
    document.addEventListener(t, function (e) {
      if (S.phase !== 'exam') return;
      e.preventDefault();
      if (t === 'paste' || t === 'drop') peringatanPaste();
    }, true);
  });
  document.addEventListener('selectstart', function (e) {
    if (S.phase === 'exam' && e.target !== ta && !(e.target && e.target.closest && e.target.closest('textarea'))) e.preventDefault();
  }, true);
  document.addEventListener('keydown', function (e) {
    if (S.phase !== 'exam') return;
    var k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
    var blok = (mod && ['c', 'v', 'x', 'a', 's', 'p', 'u', 'f'].indexOf(k) >= 0) ||
      (e.shiftKey && k === 'insert') || (mod && k === 'insert') ||
      k === 'f12' || (mod && e.shiftKey && ['i', 'j', 'c'].indexOf(k) >= 0);
    if (blok) { e.preventDefault(); if (k === 'v' || k === 'insert') peringatanPaste(); }
  }, true);
  document.addEventListener('keyup', function (e) {
    if (S.phase === 'exam' && e.key === 'PrintScreen') {
      try { navigator.clipboard.writeText(''); } catch (er) { /* abaikan */ }
      toast('Screenshot tidak diperbolehkan.');
    }
  });

  /* ---------------- penjaga: layar penuh / split screen ---------------- */
  function pelanggaran(jenis) {
    if (S.phase !== 'exam' || S.locked || S.submitting) return;
    S.locked = true; S.pelanggaran++; updatePel();
    $('lock-pesan').textContent = jenis + '. Ini dicatat sebagai pelanggaran ke-' + S.pelanggaran + ' dari ' + S.maks + '.';
    show('ov-lock');
    api('lapor', Object.assign({ token: S.token, jenis: jenis }, idPair())).catch(function () {});
    if (S.pelanggaran >= S.maks) kirim(true, 'Batas pelanggaran tercapai');
  }

  document.addEventListener('fullscreenchange', function () { if (!isFs()) pelanggaran('Keluar dari layar penuh'); });
  document.addEventListener('webkitfullscreenchange', function () { if (!isFs()) pelanggaran('Keluar dari layar penuh'); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pelanggaran('Berpindah tab/aplikasi'); });
  window.addEventListener('blur', function () { setTimeout(function () { if (!document.hasFocus()) pelanggaran('Berpindah jendela/aplikasi'); }, 150); });
  window.addEventListener('resize', function () {
    if (S.phase !== 'exam' || S.locked || !S.baseW) return;
    // dibandingkan dalam piksel fisik supaya zoom browser tidak dianggap split screen
    if (window.innerWidth * (window.devicePixelRatio || 1) < S.baseW * 0.9) pelanggaran('Ukuran layar berubah (split screen)');
  });

  $('btn-resume').addEventListener('click', function () {
    enterFs().catch(function () {}).then(function () {
      setTimeout(function () {
        if (isFs()) { S.locked = false; hide('ov-lock'); setBaseline(); }
        else toast('Layar penuh belum aktif. Coba klik lagi.');
      }, 350);
    });
  });

  window.addEventListener('beforeunload', function (e) {
    if (S.phase === 'exam') { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------------- kirim ---------------- */
  $('btn-kirim').addEventListener('click', function () {
    var kosong = S.jawaban.filter(function (j) { return !j || j.trim().length < 5; }).length;
    $('konfirmasi-pesan').textContent = kosong
      ? kosong + ' soal masih kosong/sangat singkat. Setelah dikirim, jawaban tidak bisa diubah.'
      : 'Semua soal sudah terisi. Setelah dikirim, jawaban tidak bisa diubah.';
    show('ov-konfirmasi');
  });
  $('btn-batal').addEventListener('click', function () { hide('ov-konfirmasi'); });
  $('btn-yakin').addEventListener('click', function () { hide('ov-konfirmasi'); kirim(false, ''); });
  $('btn-coba').addEventListener('click', function () { S.submitting = false; kirim(S.autoKirim, S.alasanKirim); });

  function kirim(auto, alasan) {
    if (S.submitting || S.phase !== 'exam') return;
    S.submitting = true; S.autoKirim = auto; S.alasanKirim = alasan;
    hide('ov-lock');
    $('kirim-judul').textContent = auto ? (alasan || 'Jawaban dikirim otomatis') : 'Mengirim jawaban...';
    $('kirim-pesan').textContent = 'Jangan tutup halaman ini.';
    hide('btn-coba'); show('ov-kirim');
    var coba = 0;
    (function ulang() {
      coba++;
      api('simpan', Object.assign({ token: S.token, jawaban: S.jawaban, final: true, auto: !!auto, alasan: alasan || '' }, idPair()), 40000)
        .then(selesai)
        .catch(function (e) {
          if (coba < 4) { $('kirim-pesan').textContent = 'Gagal (' + e.message + '). Mencoba lagi...'; setTimeout(ulang, 3000); }
          else { $('kirim-judul').textContent = 'Pengiriman belum berhasil'; $('kirim-pesan').textContent = e.message; show('btn-coba'); }
        });
    })();
  }

  function selesai() {
    S.phase = 'done'; S.submitting = false;
    clearInterval(S.timerId); clearInterval(S.saveId);
    try { localStorage.removeItem(draftKey()); } catch (e) { /* abaikan */ }
    exitFs(); hide('ov-kirim'); hide('ov-lock'); hide('ov-konfirmasi');
    $('done-info').textContent = S.ident.nama + ' (' + S.ident.kelas + ' / absen ' + S.ident.absen + ') - dikirim ' + fmtWaktu(nowServer());
    screen('done');
  }

  /* ---------------- mulai ---------------- */
  if (!API || API.indexOf('PASTE_') === 0) {
    $('status-banner').className = 'banner bad';
    $('status-banner').textContent = 'Alamat server belum diatur. Guru perlu mengisi config.js (lihat README).';
  } else {
    loadStatus();
  }
})();
