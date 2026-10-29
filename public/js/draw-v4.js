/* Đuổi Hình Bắt Chữ (sự kiện 22:00) - launcher độc lập: nhắc/đăng ký, chip đếm ngược, mở khung sự kiện (iframe /draw/live.html), nhận thưởng.
   Không dùng biến toàn cục của game. Chèn: <link rel="stylesheet" href="draw.css"> và <script defer src="draw.js"></script>. Khung sự kiện: draw/live.html + live.js + live.css. */
(function () {
  'use strict';
  try {
    if (window.NetcoDraw) return;
    var CFG = window.__DQ_CFG || {};
    var API = CFG.api || '/api/draw';
    var LIVE_URL = CFG.live || '/draw/live.html';
    var D = { offset: 0, st: null, dead: false, day: '', startAt: 0, pollT: null, registered: false, overlayOn: false, minimized: false, autoOpened: false, closed: false, view: 'lobby', remindMode: '', remindBusy: false, frame: null };
    var el = {};
    window.NetcoDraw = D;

    function now() { return Date.now() + D.offset; }
    function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function mmss(ms) { var s = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(s / 60); return (m < 10 ? '0' : '') + m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
    function hhmm(ts) { var d = new Date(ts); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
    function safe(fn) { return function () { try { return fn.apply(this, arguments); } catch (e) { try { console.warn('[draw]', e); } catch (_) { } } }; }

    /* ---------- DOM gốc ---------- */
    function build() {
      var r = document.createElement('div');
      r.className = 'dq-root'; r.id = 'dq-root';
      r.innerHTML = '<button type="button" class="dq-chip" id="dq-chip" aria-label="Đuổi Hình Bắt Chữ"></button>' +
        '<div class="dq-remind" id="dq-remind" role="dialog" aria-label="Đuổi Hình Bắt Chữ"></div>' +
        '<div class="dq-ev" id="dq-ev" role="dialog" aria-modal="true" aria-label="Đuổi Hình Bắt Chữ"></div>';
      document.body.appendChild(r);
      /* 22/10: game (js/ui.js syncModalFocus) đặt inert lên MỌI phần tử con của <body> mỗi khi có hộp thoại mở (sự kiện ngẫu nhiên, quà, thông báo…),
         kể cả lớp phủ này → nhìn thấy nhưng KHÔNG bấm được, mà hộp thoại nằm dưới lớp phủ nên người chơi không thấy để đóng. Gỡ inert ngay khi bị đặt. */
      try {
        var keepLive = function () { if (r.inert) r.inert = false; };
        new MutationObserver(keepLive).observe(r, { attributes: true, attributeFilter: ['inert'] });
        keepLive();
      } catch (e) { }
      el.root = r; el.chip = r.querySelector('#dq-chip'); el.remind = r.querySelector('#dq-remind'); el.ev = r.querySelector('#dq-ev');
      el.chip.addEventListener('click', safe(function () { D.minimized = false; openOverlay(); }));
      el.remind.addEventListener('click', safe(onRemindClick));
      setInterval(safe(tick), 1000);
      window.addEventListener('message', safe(onFrameMsg));
      var wake = safe(function () { if (!document.hidden) post({ drawCmd: 'wake' }); });
      document.addEventListener('visibilitychange', wake); window.addEventListener('pageshow', wake); window.addEventListener('online', wake);
    }
    /* Vào sự kiện thì tạm dừng game bên dưới (script client/event-pause.js trong bundle game); thu nhỏ/đóng thì chạy tiếp. */
    function pauseGame(on) { try { window.dispatchEvent(new CustomEvent('netco:event-pause', { detail: { on: !!on } })); } catch (e) { } }
    function post(m) { try { if (D.frame && D.frame.contentWindow) D.frame.contentWindow.postMessage(m, location.origin); } catch (e) { } }

    /* ---------- trạng thái từ API ---------- */
    function die() { D.dead = true; clearTimeout(D.pollT); hideRemind(); setChip(''); closeOverlay(true); }
    function nextDelay() {
      var slow = CFG.pollSlow || 300000, fast = CFG.pollFast || 30000;
      if (!D.startAt) return slow;
      var t = now() - D.startAt, a = 1800000, b = 1500000;
      if (t >= -a && t <= b) return fast;
      if (t < -a) return Math.max(2000, Math.min(slow, -a - t + 1000));
      return slow;
    }
    function schedulePoll(delay) { clearTimeout(D.pollT); if (D.dead) return; D.pollT = setTimeout(poll, delay == null ? nextDelay() : delay); }
    function poll() {
      if (D.dead) return;
      var done = false;
      try {
        (window.__NETCO_FETCH__||fetch)(API + '/state', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } })
          .then(function (r) { if (r.status === 403 || r.status === 404) { die(); return null; } if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
          .then(function (j) { if (j === null) return; done = true; applyState(j); })
          .catch(function () { })
          .then(function () { if (!D.dead) schedulePoll(done ? undefined : 60000); });
      } catch (e) { schedulePoll(60000); }
    }
    var applyState = safe(function (st) {
      if (!st || st.enabled === false) { die(); return; }
      if (typeof st.serverNow === 'number') D.offset = st.serverNow - Date.now();
      var nd = String(st.day || '');
      if (D.day && nd !== D.day) { closeOverlay(true); D.closed = false; D.autoOpened = false; D.view = 'lobby'; D.minimized = false; hideRemind(); }
      D.st = st; D.day = nd; D.registered = !!st.registered;
      if (st.startAt) D.startAt = st.startAt;
      if (D.day && ls('dq-done-' + D.day) === '1' && st.phase !== 'live') D.closed = true;
      refreshUI();
    });

    /* ---------- điều phối giao diện ---------- */
    function dismissKey(live) { return (live ? 'dq-dismissL-' : 'dq-dismiss-') + D.day; }
    var refreshUI = safe(function () {
      var st = D.st; if (!st || D.dead) return;
      var phase = st.phase, t = now(), started = D.startAt && t >= D.startAt;
      var live = phase === 'live' || (started && phase !== 'ended' && phase !== 'off');
      if (phase === 'ended' || phase === 'off') { if (!D.overlayOn && !D.frame) { hideRemind(); setChip(''); } return; }
      if (D.closed) { hideRemind(); setChip(''); return; }
      if (D.registered) {
        hideRemind();
        /* Dựng khung ẩn từ 90 giây trước giờ để socket nối sẵn; tự mở khi tới giờ. */
        if (D.startAt && t >= D.startAt - 90000 && !D.frame) ensureFrame();
        if (live && !D.autoOpened) { D.autoOpened = true; D.minimized = false; openOverlay(); }
        if (D.overlayOn) setChip(''); else setChip(chipText(live));
      } else if (st.eligible) {
        setChip('');
        if (live && ls(dismissKey(true)) !== '1') showRemind('live');
        else if (!live && phase === 'register' && ls(dismissKey(false)) !== '1') showRemind('reg');
        else hideRemind();
      } else { hideRemind(); setChip(''); }
    });
    function chipText(live) {
      if (live || (D.startAt && now() >= D.startAt)) return '🎨 Đuổi hình · LIVE';
      return '🎨 Đuổi hình ' + mmss(D.startAt - now());
    }
    function setChip(txt) {
      if (!el.chip) return;
      if (!txt) { el.chip.classList.remove('on'); return; }
      if (el.chip.textContent !== txt) el.chip.textContent = txt;
      el.chip.classList.add('on'); placeChip();
    }
    /* Chip nằm bên TRÁI, dưới HUD (chip Đố Vui nằm bên phải); ẩn khi HUD game chưa hiện. */
    function placeChip() {
      try {
        var c = el.chip; if (!c || !c.classList.contains('on')) return;
        var hud = document.getElementById('hud'), evs = document.getElementById('hud-events');
        if (!hud || hud.hidden || !hud.offsetHeight) { c.style.visibility = 'hidden'; return; }
        c.style.visibility = '';
        var bottom = hud.getBoundingClientRect().bottom + 7;
        if (evs && evs.offsetHeight > 0) bottom = Math.max(bottom, evs.getBoundingClientRect().bottom + 6);
        c.style.top = Math.round(bottom) + 'px';
        c.style.left = (document.body.classList.contains('portrait') ? 8 : 10) + 'px';
      } catch (e) { }
    }
    function tick() {
      if (D.dead || !D.st) return;
      if (el.chip && el.chip.classList.contains('on')) { setChip(chipText(D.startAt && now() >= D.startAt)); }
      var tk = el.remind && el.remind.querySelector('#dq-rtick');
      if (tk && D.remindMode === 'reg') tk.textContent = mmss(D.startAt - now());
      /* Không đè popup Đố Vui (cùng góc dưới): đẩy popup này lên cao hơn khi popup Đố Vui đang hiện. */
      var q = document.getElementById('qz-remind');
      el.remind.classList.toggle('dq-above', !!(q && q.classList.contains('on')));
      /* Chống bị che: nếu phần tử trên cùng ở giữa màn hình KHÔNG thuộc lớp phủ thì nâng z-index lớp phủ lên rất cao (không dời DOM vì sẽ nạp lại iframe). */
      if (D.overlayOn) {
        try {
          var top = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
          if (top && !el.ev.contains(top) && el.ev.style.zIndex !== '2147482000') { el.ev.style.zIndex = '2147482000'; try { console.warn('[draw] lớp phủ bị che bởi', top.tagName, top.className); } catch (e) { } }
        } catch (e) { }
      }
      refreshUI();
    }

    /* ---------- popup nhắc ---------- */
    function showRemind(mode) {
      if (D.remindMode !== mode) {
        D.remindMode = mode;
        var live = mode === 'live';
        el.remind.innerHTML =
          '<div class="dq-rh"><div class="dq-ic">🎨</div><div><div class="dq-nm">Đuổi Hình Bắt Chữ</div>' +
          '<div class="dq-sub">' + (live ? 'Buổi đang diễn ra' : 'Tối nay ' + esc(hhmm(D.startAt)) + ' · mọi cấp') + '</div></div>' +
          '<div class="dq-tick"><span id="dq-rtick">' + (live ? '🔴' : '--:--') + '</span><small>' + (live ? 'LIVE' : 'CÒN LẠI') + '</small></div></div>' +
          '<p>' + (live ? 'Vẫn kịp đăng ký, vào chơi ngay! Thưởng 💰 tiền, 🎟️ Coupon.' : '20 hình vẽ dần, đoán càng sớm càng nhiều điểm · thưởng 💰 tiền, 🎟️ Coupon · Top 10 có quà lớn 🏆') + '</p>' +
          '<div class="dq-err" id="dq-rerr" hidden></div>' +
          '<div class="dq-rb"><button type="button" class="dq-btn dq-gray" data-a="later">Để sau</button><button type="button" class="dq-btn dq-yellow" data-a="reg">' + (live ? 'Vào chơi' : 'Đăng ký') + '</button></div>';
      }
      el.remind.classList.add('on');
    }
    function hideRemind() { if (el.remind) { el.remind.classList.remove('on'); D.remindMode = ''; } }
    function onRemindClick(e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.a === 'later') { ls(dismissKey(D.remindMode === 'live'), '1'); hideRemind(); return; }
      if (b.dataset.a === 'reg') register(b);
    }
    function register(btn) {
      if (D.remindBusy) return; D.remindBusy = true; btn.disabled = true;
      var err = el.remind.querySelector('#dq-rerr');
      function fail(msg) { D.remindBusy = false; btn.disabled = false; if (err) { err.hidden = false; err.textContent = msg; } }
      (window.__NETCO_FETCH__||fetch)(API + '/register', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
        .then(safe(function (x) {
          if (x.r.ok && x.j && x.j.ok !== false && !x.j.error) { D.remindBusy = false; D.registered = true; if (D.st) D.st.registered = true; hideRemind(); refreshUI(); poll(); }
          else fail(x.j && x.j.error ? 'Chưa đăng ký được (' + x.j.error + '). Thử lại nhé.' : 'Chưa đăng ký được, thử lại nhé.');
        }))
        .catch(function () { fail('Mạng chập chờn, thử lại nhé.'); });
    }

    /* ---------- khung sự kiện ---------- */
    function ensureFrame() {
      if (D.frame) return D.frame;
      var f = document.createElement('iframe');
      f.className = 'dq-frame'; f.title = 'Đuổi Hình Bắt Chữ'; f.setAttribute('allow', 'autoplay');
      f.src = LIVE_URL + (LIVE_URL.indexOf('?') < 0 ? '?' : '&') + 'day=' + encodeURIComponent(D.day);
      el.ev.appendChild(f); D.frame = f; return f;
    }
    function openOverlay() {
      ensureFrame(); D.overlayOn = true; D.minimized = false;
      el.ev.classList.add('on'); document.documentElement.classList.add('dq-lock'); setChip(''); hideRemind();
      pauseGame(true); post({ drawCmd: 'wake' });
    }
    function minimizeOverlay() { D.overlayOn = false; D.minimized = true; el.ev.classList.remove('on'); document.documentElement.classList.remove('dq-lock'); pauseGame(false); refreshUI(); }
    function closeOverlay(destroy) {
      D.overlayOn = false; if (el.ev) el.ev.classList.remove('on'); document.documentElement.classList.remove('dq-lock'); pauseGame(false);
      if (destroy && D.frame) { try { D.frame.remove(); } catch (e) { } D.frame = null; }
    }
    function onFrameMsg(ev) {
      if (ev.origin !== location.origin || !D.frame || ev.source !== D.frame.contentWindow) return;
      var m = ev.data; if (!m || typeof m !== 'object' || !m.drawEvent) return;
      if (m.drawEvent === 'minimize') minimizeOverlay();
      else if (m.drawEvent === 'close') { D.closed = true; ls('dq-done-' + D.day, '1'); closeOverlay(true); hideRemind(); setChip(''); }
      else if (m.drawEvent === 'state') D.view = String(m.view || '');
    }
    document.addEventListener('keydown', function (e) { if (D.overlayOn && e.key === 'Escape') { e.stopPropagation(); } }, true);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safe(function () { build(); poll(); }));
    else { build(); poll(); }
  } catch (e) { try { console.warn('[draw] init', e); } catch (_) { } }

  /* Nhận thưởng EXP + tiền game của Đuổi Hình Bắt Chữ (máy chủ áp lười khi gọi claim). Sau 25 giây từ lúc tải trang rồi mỗi 10 phút. */
  try {
    var claimToast = function (text) {
      var d = document.createElement('div'); d.textContent = text; d.setAttribute('role', 'status');
      d.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 112px);transform:translateX(-50%);z-index:9500;background:#fff8ea;color:#2a1c1c;border:2px solid #2a1c1c;border-radius:12px;box-shadow:0 3px 0 #2a1c1c;padding:8px 14px;font:700 13px system-ui,sans-serif;max-width:90vw;text-align:center';
      document.body.appendChild(d); setTimeout(function () { try { d.remove(); } catch (e) { } }, 7000);
    };
    var doClaim = function () {
      if (document.hidden) return;
      (window.__NETCO_FETCH__||fetch)('/api/draw/claim', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (r) {
          if (!r || !r.applied) return;
          var parts = [];
          if (r.xp) parts.push('+' + Number(r.xp).toLocaleString('vi-VN') + ' EXP');
          if (r.money) parts.push('+' + Number(r.money).toLocaleString('vi-VN') + 'đ tiền game');
          if (parts.length) claimToast('🎁 Thưởng Đuổi Hình Bắt Chữ: ' + parts.join(' · '));
          /* 28/10: tiền thưởng làm cloud tăng revision + ví; báo Online nhận ví ngay, không để lần nối lại sau đó tưởng thiết bị khác ghi ("Cloud đã thay đổi" + tải lại). */
          if (r.money) try { dispatchEvent(new CustomEvent('netco-wallet-refresh')); } catch (e) {}
        }).catch(function () { });
    };
    setTimeout(doClaim, 26000); setInterval(doClaim, 600000);
  } catch (e) { }
})();
