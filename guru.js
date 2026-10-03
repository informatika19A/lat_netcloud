'use strict';
/* Dashboard guru: ringkasan, hasil siswa + penilaian, pengaturan waktu */
(function () {
  var API = window.HOTS_API_URL;
  var $ = function (id) { return document.getElementById(id); };
  var G = { pass: '', data: null, tab: 'ringkasan', detailKey: null, timer: null, formDiisi: false };

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    var el = $('toast'); el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.add('hidden'); }, 2600);
  }
  function api(action, data) {
    if (!API || API.indexOf('PASTE_') === 0) return Promise.reject(new Error('config.js belum diisi URL Web App.'));
    var body = Object.assign({ action: action, password: G.pass }, data || {});
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j || j.ok === false) throw new Error((j && j.error) || 'Kesalahan server.'); return j; },
        function () { throw new Error('Tidak bisa terhubung ke server.'); });
  }
  function fmt(ms) {
    if (!ms) return '-';
    return new Date(ms).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(/\./g, ':');
  }
  function fmtLengkap(ms) {
    if (!ms) return '-';
    return new Date(ms).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/\./g, ':') + ' WIB';
  }
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function selesai(h) { return String(h.status).indexOf('Selesai') === 0; }

  /* ---------- login ---------- */
  $('g-form').addEventListener('submit', function (e) {
    e.preventDefault();
    G.pass = $('g-pass').value;
    $('g-err').textContent = 'Memeriksa...';
    muat().then(function () {
      try { sessionStorage.setItem('hots_guru_pw', G.pass); } catch (er) { /* abaikan */ }
      $('g-login').classList.remove('active'); $('g-app').classList.add('active');
      $('g-err').textContent = '';
    }).catch(function (er) { $('g-err').textContent = er.message; });
  });
  $('g-keluar').addEventListener('click', function () {
    try { sessionStorage.removeItem('hots_guru_pw'); } catch (er) { /* abaikan */ }
    location.reload();
  });

  /* ---------- muat data ---------- */
  function muat() {
    return api('gHasil').then(function (d) {
      G.data = d; render();
    });
  }
  $('g-refresh').addEventListener('click', function () { muat().then(function () { toast('Data diperbarui'); }).catch(function (e) { toast(e.message); }); });
  function aturAuto() {
    clearInterval(G.timer);
    if ($('g-auto').checked) G.timer = setInterval(function () {
      if (!$('g-modal').classList.contains('hidden')) return;   // jangan ganggu saat menilai
      muat().catch(function () {});
    }, 30000);
  }
  $('g-auto').addEventListener('change', aturAuto);

  /* ---------- tab ---------- */
  $('g-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    G.tab = b.dataset.tab;
    Array.prototype.forEach.call($('g-tabs').children, function (x) { x.classList.toggle('on', x === b); });
    ['ringkasan', 'hasil', 'atur'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== G.tab); });
  });

  /* ---------- render ---------- */
  function render() {
    var d = G.data, p = d.pengaturan;
    $('g-judul').textContent = p.judul || 'Dashboard Guru';
    $('g-sub').textContent = 'Jadwal: ' + (p.mulai ? fmtLengkap(p.mulai) + ' s/d ' + fmtLengkap(p.selesai) : 'belum diatur');
    var st = { berlangsung: ['ok', 'Sedang dibuka'], belum: ['warn', 'Belum dibuka'], selesai: ['bad', 'Sudah ditutup'], belum_diatur: ['warn', 'Jadwal belum diatur'] }[p.state] || ['info', p.state];
    $('g-state').className = 'badge ' + st[0]; $('g-state').textContent = st[1];

    renderRingkasan(); renderFilter(); renderHasil();
    if (!G.formDiisi) { isiForm(); G.formDiisi = true; }
  }

  function renderRingkasan() {
    var d = G.data, h = d.hasil, sel = h.filter(selesai);
    var nilai = sel.map(function (x) { return x.nilai || 0; });
    var pel = h.filter(function (x) { return x.pelanggaran > 0; }).length;
    $('g-stats').innerHTML = [
      [h.length, 'Peserta masuk'],
      [sel.length, 'Sudah selesai'],
      [h.length - sel.length, 'Sedang mengerjakan'],
      [nilai.length ? r1(avg(nilai)) : '-', 'Rata-rata nilai'],
      [nilai.length ? Math.max.apply(null, nilai) : '-', 'Nilai tertinggi'],
      [nilai.length ? Math.min.apply(null, nilai) : '-', 'Nilai terendah'],
      [pel, 'Siswa ada pelanggaran']
    ].map(function (s) { return '<div class="stat"><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>'; }).join('');

    $('g-kelas').innerHTML = d.kelas.map(function (k) {
      var n = sel.filter(function (x) { return x.kelas === k; }).map(function (x) { return x.nilai || 0; });
      var a = avg(n);
      return '<div class="bar-row"><span>' + esc(k) + '</span><div class="bar"><i style="width:' + Math.min(100, a) + '%"></i></div><span>' + (n.length ? r1(a) : '-') + ' <span class="muted small">(' + n.length + ')</span></span></div>';
    }).join('');

    $('g-soal').innerHTML = d.soal.map(function (q, i) {
      var v = sel.map(function (x) { return Number(x.skor[i]) || 0; });
      var a = avg(v);
      return '<div class="bar-row"><span>Soal ' + q.no + '</span><div class="bar"><i style="width:' + (a / d.skorMaks * 100) + '%"></i></div><span>' + (v.length ? r1(a) : '-') + '</span></div>';
    }).join('') + '<p class="small muted" style="margin:6px 0 0">Batang pendek = soal yang paling sulit bagi siswa.</p>';
  }

  function renderFilter() {
    var sel = $('f-kelas'), cur = sel.value;
    sel.innerHTML = '<option value="">Semua kelas</option>' + G.data.kelas.map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('');
    sel.value = cur;
  }

  function filtered() {
    var k = $('f-kelas').value, s = $('f-status').value, q = $('f-cari').value.trim().toLowerCase();
    return G.data.hasil.filter(function (h) {
      if (k && h.kelas !== k) return false;
      if (s === 'Mengerjakan' && selesai(h)) return false;
      if (s === 'Selesai' && !selesai(h)) return false;
      if (q && h.nama.toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      return a.kelas.localeCompare(b.kelas) || (Number(a.absen) - Number(b.absen));
    });
  }

  function renderHasil() {
    var rows = filtered();
    $('g-rows').innerHTML = rows.length ? rows.map(function (h) {
      var sBadge = selesai(h) ? (h.status === 'Selesai' ? 'ok' : 'warn') : 'info';
      var pBadge = h.pelanggaran >= 3 ? 'bad' : h.pelanggaran > 0 ? 'warn' : 'ok';
      return '<tr>' +
        '<td>' + esc(h.kelas) + '</td><td>' + esc(h.absen) + '</td><td>' + esc(h.nama) + '</td>' +
        '<td>' + esc(h.tanggal) + '</td><td>' + fmt(h.mulai) + '</td><td>' + fmt(h.selesai) + '</td>' +
        '<td><span class="badge ' + sBadge + '">' + esc(h.status) + '</span></td>' +
        '<td><span class="badge ' + pBadge + '">' + h.pelanggaran + '</span></td>' +
        '<td><b>' + (h.nilai == null ? '-' : h.nilai) + '</b></td>' +
        '<td>' + esc(h.penilai || '-') + '</td>' +
        '<td><button class="btn ghost sm" data-aksi="detail" data-key="' + esc(h.key) + '">Detail</button> ' +
        '<button class="btn danger sm" data-aksi="reset" data-key="' + esc(h.key) + '">Reset</button></td></tr>';
    }).join('') : '<tr><td colspan="11" class="muted" style="text-align:center; padding:22px">Belum ada data.</td></tr>';
  }
  ['f-kelas', 'f-status'].forEach(function (id) { $(id).addEventListener('change', renderHasil); });
  $('f-cari').addEventListener('input', renderHasil);

  $('g-rows').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var key = b.dataset.key;
    if (b.dataset.aksi === 'detail') bukaDetail(key);
    if (b.dataset.aksi === 'reset') {
      var h = G.data.hasil.filter(function (x) { return x.key === key; })[0];
      if (!h) return;
      if (confirm('Reset pengerjaan ' + h.nama + ' (' + h.kelas + ' / absen ' + h.absen + ')?\nSeluruh jawaban siswa ini akan DIHAPUS dan siswa bisa mengerjakan ulang.')) {
        api('gReset', { key: key }).then(muat).then(function () { toast('Data siswa direset'); }).catch(function (er) { toast(er.message); });
      }
    }
  });

  /* ---------- hitung ulang & CSV ---------- */
  $('g-hitung').addEventListener('click', function () {
    if (!confirm('Hitung ulang skor otomatis untuk semua siswa yang belum dinilai manual?\n(Skor yang sudah Anda ubah tidak ikut berubah.)')) return;
    api('gHitungUlang').then(function (r) { return muat().then(function () { toast(r.jumlah + ' data dihitung ulang'); }); })
      .catch(function (e) { toast(e.message); });
  });

  $('g-csv').addEventListener('click', function () {
    var d = G.data, head = ['Kelas', 'Absen', 'Nama', 'Tanggal', 'Mulai', 'Selesai', 'Status', 'Pelanggaran'];
    d.soal.forEach(function (q) { head.push('Skor ' + q.no); });
    head.push('Nilai', 'Penilai');
    var lines = [head];
    filtered().forEach(function (h) {
      var row = [h.kelas, h.absen, h.nama, h.tanggal, h.mulai ? fmt(h.mulai) : '', h.selesai ? fmt(h.selesai) : '', h.status, h.pelanggaran];
      d.soal.forEach(function (q, i) { row.push(h.skor[i] === '' ? '' : h.skor[i]); });
      row.push(h.nilai == null ? '' : h.nilai, h.penilai);
      lines.push(row);
    });
    var csv = lines.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c);
        if (/^[=+\-@]/.test(s)) s = "'" + s;           // cegah rumus saat dibuka di Excel
        return '"' + s.replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'nilai-hots-informatika-xii.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });

  /* ---------- detail & penilaian ---------- */
  function bukaDetail(key) {
    var h = G.data.hasil.filter(function (x) { return x.key === key; })[0]; if (!h) return;
    G.detailKey = key;
    $('m-nama').textContent = h.nama;
    $('m-info').textContent = h.kelas + ' · Absen ' + h.absen + ' · ' + h.status + ' · Mulai ' + fmt(h.mulai) + ' · Selesai ' + fmt(h.selesai);
    var lg = $('m-log');
    if (h.log) { lg.textContent = 'Pelanggaran (' + h.pelanggaran + '): ' + h.log; lg.classList.remove('hidden'); } else lg.classList.add('hidden');

    $('m-body').innerHTML = G.data.soal.map(function (q, i) {
      var j = h.jawaban[i] || '';
      return '<div class="q-block">' +
        '<div><span class="tag">' + esc(q.bagian) + '</span><span class="tag">' + esc(q.level) + '</span></div>' +
        '<h3 style="margin-top:8px">Soal ' + q.no + '</h3>' +
        '<details><summary>Lihat kasus &amp; pertanyaan</summary><div class="pre">' + esc(q.kasus.replace(/```/g, '')) + '\n\n' + esc(q.pertanyaan) + '</div></details>' +
        '<div class="answer">' + (j.trim() ? esc(j) : '<span class="muted">(tidak dijawab)</span>') + '</div>' +
        '<details><summary>Pedoman jawaban</summary><div class="pre">' + esc(q.pedoman) + '</div></details>' +
        '<div style="margin-top:10px"><label style="display:inline; margin-right:8px">Skor (0&ndash;' + G.data.skorMaks + ')</label>' +
        '<input class="score-in" type="number" min="0" max="' + G.data.skorMaks + '" step="0.5" data-i="' + i + '" value="' + (h.skor[i] === '' ? 0 : h.skor[i]) + '"></div>' +
        '</div>';
    }).join('');
    $('m-msg').textContent = ''; hitungTotal();
    $('g-modal').classList.remove('hidden');
  }
  function hitungTotal() {
    var t = 0;
    Array.prototype.forEach.call(document.querySelectorAll('.score-in'), function (el) {
      var n = parseFloat(el.value); if (!isNaN(n)) t += Math.max(0, Math.min(G.data.skorMaks, n));
    });
    $('m-total').textContent = r1(t);
  }
  $('m-body').addEventListener('input', function (e) { if (e.target.classList.contains('score-in')) hitungTotal(); });
  $('m-tutup').addEventListener('click', function () { $('g-modal').classList.add('hidden'); });
  $('m-simpan').addEventListener('click', function () {
    var skor = Array.prototype.map.call(document.querySelectorAll('.score-in'), function (el) { return parseFloat(el.value) || 0; });
    $('m-msg').textContent = 'Menyimpan...';
    api('gNilai', { key: G.detailKey, skor: skor }).then(muat).then(function () {
      $('m-msg').textContent = 'Tersimpan.';
      toast('Skor disimpan');
    }).catch(function (e) { $('m-msg').textContent = e.message; });
  });

  /* ---------- pengaturan ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toInput(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function isiForm() {
    var p = G.data.pengaturan;
    $('s-judul').value = p.judul || '';
    $('s-mulai').value = toInput(p.mulai); $('s-selesai').value = toInput(p.selesai);
    $('s-durasi').value = p.durasi || 0;
  }
  function msDari(id) { var v = $(id).value; return v ? new Date(v).getTime() : 0; }
  function simpanPengaturan(data, pesan) {
    var m = $('s-msg'); m.className = 'small'; m.textContent = 'Menyimpan...';
    return api('gPengaturan', { data: data }).then(function () {
      if (data.passwordBaru) { G.pass = data.passwordBaru; try { sessionStorage.setItem('hots_guru_pw', G.pass); } catch (e) { /* abaikan */ } $('s-pass').value = ''; }
      G.formDiisi = false;
      return muat();
    }).then(function () {
      m.className = 'small banner ok'; m.textContent = pesan || 'Pengaturan tersimpan.';
    }).catch(function (e) { m.className = 'small banner bad'; m.textContent = e.message; });
  }
  $('s-simpan').addEventListener('click', function () {
    simpanPengaturan({
      judul: $('s-judul').value, mulai: msDari('s-mulai'), selesai: msDari('s-selesai'),
      durasi: Number($('s-durasi').value) || 0, passwordBaru: $('s-pass').value
    });
  });
  $('s-sekarang').addEventListener('click', function () {
    var dur = Number($('s-durasi').value) || 90, now = Date.now();
    $('s-mulai').value = toInput(now); $('s-selesai').value = toInput(now + (dur + 15) * 60000);
    toast('Waktu diisi. Klik "Simpan pengaturan" untuk menerapkan.');
  });
  $('s-tutup').addEventListener('click', function () {
    if (!confirm('Tutup pengerjaan sekarang? Siswa yang belum login tidak bisa masuk lagi.')) return;
    var p = G.data.pengaturan, now = Date.now();
    simpanPengaturan({ judul: p.judul, mulai: p.mulai || now - 60000, selesai: now, durasi: p.durasi }, 'Pengerjaan ditutup.');
  });

  /* ---------- auto-login dari sesi ---------- */
  try {
    var pw = sessionStorage.getItem('hots_guru_pw');
    if (pw && API && API.indexOf('PASTE_') !== 0) {
      G.pass = pw;
      muat().then(function () { $('g-login').classList.remove('active'); $('g-app').classList.add('active'); aturAuto(); })
        .catch(function () { G.pass = ''; });
    }
  } catch (e) { /* abaikan */ }
  $('g-form').addEventListener('submit', aturAuto);
})();
