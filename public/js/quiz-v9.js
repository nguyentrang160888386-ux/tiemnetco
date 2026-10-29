/* Đố Vui Chủ Quán - client độc lập. Không dùng biến toàn cục của game.
   Chèn: <link rel="stylesheet" href="quiz.css"> và <script defer src="quiz.js"></script> */
(function () {
  'use strict';
  try {
    if (window.NetcoQuiz) return;
    var CFG = window.__QZ_CFG || {};
    var API = CFG.api || '/api/quiz';
    var FACES = ['🐱', '🐶', '🦊', '🐼', '🐷', '🐸', '🐯', '🐰', '🦁', '🐨'];
    var MEDAL = ['🥇', '🥈', '🥉'];
    var LET = 'ABCD';
    var CLIENT_VERSION = 7;          /* gửi kèm mọi diag để biết máy nào còn chạy bản cũ */
    var ZOMBIE_MS = 12000;           /* socket OPEN nhưng im > 12 giây trong lúc thi => coi như chết */
    var TIME_TOL = 1200;             /* dung sai (ms) khi khoá nút hết giờ theo đồng hồ máy */
    var Z_TOP = 2147482000;          /* z-index "cứu hộ" của lớp phủ (thanh an toàn app là 2147483000 nhưng pointer-events:none) */
    var EMO = ['😂', '😭', '🤡', '💀', '👏'];
    var EMO_MAX_FLY = 24, EMO_PER_TYPE = 5, EMO_GAP = 300;
    var D = {
      offset: 0, st: null, dead: false, day: '', startAt: 0, pollT: null, tickT: null,
      ws: null, wsT: null, pingT: null, backoff: 1000, wsEverOpen: false,
      registered: false, overlayOn: false, minimized: false, autoOpened: false, closed: false,
      view: 'lobby', count: 0, total: 0, q: null, qMax: {}, picked: {}, locked: false, timeUp: false,
      rev: null, lastTop: null, me: { rank: 0, score: 0, streak: 0 }, fin: null,
      reconnecting: false, late: false, seenQ: false, lateN: 0, toast: '', mcMsg: '',
      remindMode: '', remindBusy: false, remindErr: '', debug: false,
      emo: { n: 0, s: [0, 0, 0, 0, 0] }, emoOwn: [0, 0, 0, 0, 0], emoAt: 0, hold: false, renderPending: false, acked: {}, diagN: 0, jsErrN: 0, wsAt: 0, lastMsgAt: 0
    };
    var el = {};

    function now() { return Date.now() + D.offset; }
    function syncFrom(m) { if (m && typeof m.serverNow === 'number') D.offset = m.serverNow - Date.now(); }
    function ls(k, v) {
      try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
    }
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function fmt(n) { n = Math.round(+n || 0); try { return n.toLocaleString('vi-VN'); } catch (e) { return String(n); } }
    function mmss(ms) {
      var s = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(s / 60);
      return (m < 10 ? '0' : '') + m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
    }
    function hhmm(ts) { var d = new Date(ts); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
    function face(name) {
      var h = 0, s = String(name || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return FACES[h % FACES.length];
    }
    function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
    function safe(fn) {
      return function () {
        try { return fn.apply(this, arguments); } catch (e) {
          try { console.warn('[quiz]', e); } catch (_) { }
          try { if (D.jsErrN++ < 2) diag('js-err', { err: String(e && e.message || e).slice(0, 70), at: String(e && e.stack || '').split('\n')[1] || '' }); } catch (_) { }
        }
      };
    }
    function reducedMotion() { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }

    /* ---------- DOM gốc ---------- */
    function build() {
      var r = document.createElement('div');
      r.className = 'qz-root'; r.id = 'qz-root';
      r.innerHTML = '<button type="button" class="qz-chip" id="qz-chip" aria-label="Đố vui chủ quán"></button>' +
        '<div class="qz-remind qz-panel" id="qz-remind" role="dialog" aria-label="Đố Vui Chủ Quán"></div>' +
        '<div class="qz-ev" id="qz-ev" role="dialog" aria-modal="true" aria-label="Đố Vui Chủ Quán"></div>' +
        '<div class="qz-emofly" id="qz-emofly" aria-hidden="true"></div>';
      document.body.appendChild(r);
      /* 22/10: game (js/ui.js syncModalFocus) đặt inert lên MỌI phần tử con của <body> mỗi khi có hộp thoại mở (sự kiện ngẫu nhiên, quà, thông báo…),
         kể cả lớp phủ này → nhìn thấy nhưng KHÔNG bấm được, mà hộp thoại nằm dưới lớp phủ nên người chơi không thấy để đóng. Gỡ inert ngay khi bị đặt. */
      try {
        var keepLive = function () {
          if (r.inert) r.inert = false;
          var l = r.querySelectorAll('[inert]'); for (var i = 0; i < l.length; i++) l[i].inert = false;
        };
        new MutationObserver(keepLive).observe(r, { attributes: true, attributeFilter: ['inert'], subtree: true });
        keepLive();
      } catch (e) { }
      el.root = r; el.chip = r.querySelector('#qz-chip'); el.remind = r.querySelector('#qz-remind'); el.ev = r.querySelector('#qz-ev'); el.fly = r.querySelector('#qz-emofly');
      setInterval(safe(watchdog), 1500);
      el.chip.addEventListener('click', safe(function () { D.minimized = false; openOverlay(); }));
      setInterval(function () { placeChip(); }, 800);
      window.addEventListener('resize', function () { placeChip(); });
      el.remind.addEventListener('click', safe(onRemindClick));
      el.ev.addEventListener('click', safe(onEvClick));
      /* Dự phòng cảm ứng: một số máy (PWA/iOS) làm rơi sự kiện click; nhận luôn khi nhấc tay nếu không kéo. */
      var pd = null;
      /* Đang giữ ngón trên một nút: KHÔNG thay innerHTML (cú chạm sẽ mất vì nút bị thay giữa pointerdown và pointerup); dựng lại sau khi nhả. */
      el.ev.addEventListener('pointerdown', safe(function (e) {
        pd = { x: e.clientX, y: e.clientY };
        if (e.target && e.target.closest && e.target.closest('button')) holdOn();
      }), true);
      document.addEventListener('pointerup', safe(holdOff), true);
      document.addEventListener('pointercancel', safe(holdOff), true);
      el.ev.addEventListener('pointerup', safe(function (e) {
        var d = pd; pd = null; if (!d) return;
        if (Math.abs(e.clientX - d.x) > 10 || Math.abs(e.clientY - d.y) > 10) return;
        var a0 = e.target && e.target.closest ? e.target.closest('.qz-ans') : null;
        if (a0 && !a0.disabled && D.view === 'q' && D.q && D.picked[D.q.n] == null) {   /* chạm mà sau 500ms vẫn chưa khoá => báo chẩn đoán */
          var nn = D.q.n, ii = +a0.dataset.i;
          setTimeout(function () { if (D.view === 'q' && D.q && D.q.n === nn && D.picked[nn] == null && !D.timeUp) diag('tap-no-lock', { i: ii, pt: e.pointerType }); }, 500);
        }
        if (e.pointerType === 'mouse') return;
        var a = a0;
        if (a && !a.disabled) { onAnsTap(a); return; }
        var eb = e.target && e.target.closest ? e.target.closest('.qz-emb') : null;
        if (eb) { sendEmo(+eb.dataset.e, eb); return; }
        if (D.view === 'q' && D.q && D.picked[D.q.n] == null) {
          var box = el.ev.querySelector('.qz-answers'), r = box && box.getBoundingClientRect();
          if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) diag('tap-on-disabled');
        }
      }), true);
      /* Canh chừng kết nối: nối lại khi mất, đóng socket im lặng > 30 giây, nối ngay khi mở lại app. */
      var wake = safe(function () {
        if (document.hidden || !D.registered || D.closed || D.dead || D.replaced || D.view === 'final') return;
        var t = now(); if (!D.startAt || t < D.startAt - 60000 || t > D.startAt + 25 * 60000) return;
        if (!D.ws && !D.wsT) { D.backoff = 1000; connectWS(); }
        else if (D.ws && D.ws.readyState === 1 && D.lastMsgAt && Date.now() - D.lastMsgAt > 30000) recycleWS('idle30');
      });
      setInterval(wake, 5000);
      setInterval(safe(zombieCheck), 2000);
      /* Tab/app ẩn rồi hiện: socket có thể đã chết im lặng (iOS PWA). Gửi ping ngay, 2,5s sau không có gì thì nối lại; dựng lại màn nếu đang chờ. */
      var onShow = safe(function () {
        wake();
        if (document.hidden) return;
        if (D.ws && D.ws.readyState === 1 && examOn()) {
          try { D.ws.send('{"t":"ping"}'); } catch (e) { }
          var mark = D.lastMsgAt; clearTimeout(D.verifyT);
          D.verifyT = setTimeout(function () { if (D.ws && D.lastMsgAt === mark && Date.now() - D.lastMsgAt > 2000) recycleWS('wake'); }, 2500);
        }
        if (D.overlayOn) { if (D.renderPending) { D.hold = false; D.renderPending = false; renderEv(); } else tickEv(); }
        watchdog();
      });
      document.addEventListener('visibilitychange', onShow);
      window.addEventListener('pageshow', onShow);
      window.addEventListener('online', wake);
      document.addEventListener('keydown', safe(function (e) {
        if (!D.overlayOn || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key >= '1' && e.key <= '4') {
          e.preventDefault(); e.stopPropagation();
          if (D.view === 'q') choose(+e.key - 1);
        }
      }), true);
    }

    /* ---------- trạng thái từ API ---------- */
    function die() {
      D.dead = true; clearTimeout(D.pollT); closeWS(true);
      hideRemind(); setChip(''); if (el.ev) { el.ev.classList.remove('on'); D.overlayOn = false; }
    }
    function nextDelay() {
      var slow = CFG.pollSlow || 300000, fast = CFG.pollFast || 30000;
      if (!D.startAt) return slow;
      var t = now() - D.startAt, a = CFG.winBefore || 1800000, b = CFG.winAfter || 1500000;
      if (t >= -a && t <= b) return fast;
      if (t < -a) return Math.max(2000, Math.min(slow, -a - t + 1000));
      return slow;
    }
    function schedulePoll(delay) {
      clearTimeout(D.pollT);
      if (D.dead) return;
      D.pollT = setTimeout(poll, delay == null ? nextDelay() : delay);
    }
    function poll() {
      if (D.dead) return;
      var done = false;
      try {
        (window.__NETCO_FETCH__||fetch)(API + '/state', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } })
          .then(function (r) {
            if (r.status === 403 || r.status === 404) {
              /* Đang thi mà 403/404 thoáng qua (cookie/biên) thì KHÔNG tắt hẳn client: coi như lỗi mạng, thử lại. */
              if (D.overlayOn && (D.view === 'q' || D.view === 'reveal')) throw new Error('http ' + r.status);
              die(); return null;
            }
            if (!r.ok) throw new Error('http ' + r.status);
            return r.json();
          })
          .then(function (j) { if (j === null) return; done = true; applyState(j); })
          .catch(function () { })
          .then(function () { if (!D.dead) schedulePoll(done ? undefined : (CFG.pollRetry || 60000)); });
      } catch (e) { schedulePoll(60000); }
    }
    var applyState = safe(function (st) {
      if (!st || st.enabled === false) { die(); return; }
      syncFrom(st);
      var nd = String(st.day || '');
      if (D.day && nd !== D.day) {
        closeWS(true); D.closed = false; D.autoOpened = false; D.fin = null; D.view = 'lobby'; D.q = null; D.rev = null; D.lastTop = null;
        D.picked = {}; D.qMax = {}; D.locked = false; D.timeUp = false; D.late = false; D.seenQ = false; D.me = { rank: 0, score: 0, streak: 0 };
        D.overlayOn = false; D.minimized = false; if (el.ev) { el.ev.classList.remove('on'); el.ev.innerHTML = ''; } hideRemind();
      }
      D.st = st; D.day = nd; D.registered = !!st.registered;
      if (st.startAt) D.startAt = st.startAt;
      if (D.day && ls('qz-done-' + D.day) === '1' && st.phase !== 'live') D.closed = true;
      refreshUI();
    });

    /* ---------- điều phối giao diện ---------- */
    function dismissKey(live) { return (live ? 'qz-dismissL-' : 'qz-dismiss-') + D.day; }
    var refreshUI = safe(function () {
      var st = D.st; if (!st || D.dead || D.debug) return;
      var phase = st.phase, t = now();
      var started = D.startAt && t >= D.startAt;
      var live = phase === 'live' || (started && phase !== 'ended' && phase !== 'off');
      if (phase === 'ended' || phase === 'off') {
        if (!D.fin) {
          /* Đang ở giữa câu cuối mà state báo 'ended' trước khi tin 'final' kịp tới: giữ/nối lại socket để nhận bảng kết quả, đừng đóng. */
          if (D.overlayOn && D.registered && !D.closed && (D.view === 'q' || D.view === 'reveal')) { if (!D.ws && !D.wsT) connectWS(); }
          else closeWS(true);
        }
        if (!D.overlayOn) { hideRemind(); setChip(''); }
        return;
      }
      if (D.closed) { hideRemind(); setChip(''); return; }
      if (D.registered) {
        hideRemind();
        if (D.startAt && t >= D.startAt - 60000 && !D.ws && !D.wsT && D.view !== 'final') connectWS();
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
      if (live || (D.startAt && now() >= D.startAt)) return '❓ Đố vui' + (D.q ? ' · Câu ' + D.q.n : ' · LIVE');
      return '❓ Đố vui ' + mmss(D.startAt - now());
    }
    function setChip(txt) {
      if (!el.chip) return;
      if (!txt) { el.chip.classList.remove('on'); return; }
      if (el.chip.textContent !== txt) el.chip.textContent = txt;
      el.chip.classList.add('on');
      placeChip();
    }
    /* Chip nằm DƯỚI khối thẻ sự kiện/hiệu ứng của HUD (#hud-events), không đè các ô chỉ số; ẩn khi HUD game chưa hiện. */
    function placeChip() {
      try {
        var c = el.chip; if (!c || !c.classList.contains('on')) return;
        var hud = document.getElementById('hud'), evs = document.getElementById('hud-events');
        if (!hud || hud.hidden || !hud.offsetHeight) { c.style.visibility = 'hidden'; return; }
        c.style.visibility = '';
        var bottom = hud.getBoundingClientRect().bottom + 7;
        if (evs && evs.offsetHeight > 0) bottom = Math.max(bottom, evs.getBoundingClientRect().bottom + 6);
        c.style.top = Math.round(bottom) + 'px';
        c.style.right = (document.body.classList.contains('portrait') ? 8 : 10) + 'px';
      } catch (e) {}
    }

    /* ---------- popup nhắc ---------- */
    function showRemind(mode) {
      if (D.remindMode !== mode) {
        D.remindMode = mode; D.remindErr = '';
        var live = mode === 'live';
        el.remind.innerHTML =
          '<div class="qz-rh"><div class="qz-ic">❓</div><div><div class="qz-nm">Đố Vui Chủ Quán</div>' +
          '<div class="qz-sub">' + (live ? 'Buổi đang diễn ra' : 'Tối nay ' + esc(hhmm(D.startAt)) + ' · cấp ' + esc((D.st && D.st.minLevel) || 30) + ' trở lên') + '</div></div>' +
          '<div class="qz-tick qz-num"><span id="qz-rtick">' + (live ? '🔴' : '--:--') + '</span><small>' + (live ? 'LIVE' : 'CÒN LẠI') + '</small></div></div>' +
          '<p>' + (live ? 'Vẫn kịp đăng ký, vào thi ngay! Thưởng 💰 tiền, 🎟️ Coupon.' : '20 câu vui · thưởng 💰 tiền, 🎟️ Coupon · Top 10 có quà lớn 🏆') + '</p>' +
          '<p class="qz-err" id="qz-rerr" hidden></p>' +
          '<div class="qz-rb"><button type="button" class="qz-btn" data-a="reg">' + (live ? 'Đăng ký &amp; vào thi ngay' : 'Đăng ký ngay!') + '</button>' +
          '<button type="button" class="qz-btn qz-gray" data-a="later">Để sau</button></div>';
      }
      el.remind.classList.add('on');
    }
    function hideRemind() { if (el.remind) { el.remind.classList.remove('on'); D.remindMode = ''; } }
    function onRemindClick(e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.a === 'later') {
        ls(dismissKey(D.remindMode === 'live'), '1'); hideRemind(); return;
      }
      if (b.dataset.a === 'reg') register(b);
    }
    function register(btn) {
      if (D.remindBusy) return; D.remindBusy = true; btn.disabled = true;
      var err = el.remind.querySelector('#qz-rerr');
      function fail(msg) {
        D.remindBusy = false; btn.disabled = false;
        if (err) { err.hidden = false; err.textContent = msg; }
      }
      (window.__NETCO_FETCH__||fetch)(API + '/register', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
        .then(safe(function (x) {
          if (x.r.ok && x.j && x.j.ok !== false && !x.j.error) {
            D.remindBusy = false; D.registered = true; if (D.st) D.st.registered = true;
            hideRemind(); refreshUI(); poll();
          } else fail(x.j && x.j.error ? 'Chưa đăng ký được (' + x.j.error + '). Thử lại nhé.' : 'Chưa đăng ký được, thử lại nhé.');
        }))
        .catch(function () { fail('Mạng chập chờn, thử lại nhé.'); });
    }

    /* ---------- WebSocket ---------- */
    function wsUrl() {
      return CFG.ws || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + API + '/socket');
    }
    function connectWS() {
      if (D.dead || D.ws || D.replaced || D.view === 'final' || D.closed) return;
      clearTimeout(D.wsT); D.wsT = null;
      var w;
      try { w = new (window.__NETCO_WS__||WebSocket)(wsUrl()); } catch (e) { scheduleReconnect(); return; }
      D.ws = w; D.wsAt = Date.now();
      w.onopen = safe(function () {
        D.backoff = 1000; D.wsEverOpen = true; D.lastMsgAt = Date.now();
        if (D.reconnecting) { D.reconnecting = false; softRender(); }
        clearInterval(D.pingT);
        /* ping 5s/lần khi đang thi (để phát hiện socket chết trong 12s), 10s/lần lúc khác */
        var pn = 0;
        D.pingT = setInterval(function () { try { pn++; if (w.readyState === 1 && (pn % 2 === 0 || examOn())) w.send('{"t":"ping"}'); } catch (e) { } }, 5000);
      });
      w.onmessage = safe(function (ev) {
        D.lastMsgAt = Date.now();
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m && m.t) onMsg(m);
      });
      w.onclose = safe(function (ev) {
        if (D.ws !== w) return;
        D.ws = null; clearInterval(D.pingT);
        if (D.dead || D.view === 'final' || D.closed) return;
        /* 4001: máy chủ thay socket vì cùng tài khoản mở ở tab/thiết bị khác. KHÔNG tự nối lại (hai bên sẽ đá nhau mãi, nút đáp án bị khoá). */
        if (ev && ev.code === 4001) { D.replaced = true; D.reconnecting = false; if (D.overlayOn) renderEv(); return; }
        if (D.st && D.st.phase === 'ended' && !D.overlayOn) return;
        D.reconnecting = true; softRender();
        scheduleReconnect();
      });
      w.onerror = function () { };
    }
    function scheduleReconnect() {
      clearTimeout(D.wsT);
      var d = D.backoff; D.backoff = Math.min(D.backoff * 2, CFG.maxBackoff || 15000);
      D.wsT = setTimeout(function () { D.wsT = null; connectWS(); }, d);
    }
    /* Đang trong cuộc thi (lớp phủ mở ở màn câu hỏi/công bố) */
    function examOn() { return !!(D.overlayOn && (D.view === 'q' || D.view === 'reveal')); }
    /* Đóng socket "chết" ngay (không chờ onclose, thứ có thể không bao giờ tới) rồi nối lại + gọi HTTP để chắc máy chủ còn sống. */
    function recycleWS(why) {
      var w = D.ws; if (!w) return;
      D.ws = null; clearInterval(D.pingT);
      try { w.onclose = null; w.onmessage = null; w.close(); } catch (e) { }
      if (D.dead || D.view === 'final' || D.closed || D.replaced) return;
      if (examOn()) diag('ws-recycle', { why: why, age: Math.round((Date.now() - (D.lastMsgAt || 0)) / 1000) });
      D.reconnecting = true; softRender();
      D.backoff = 1000; clearTimeout(D.wsT); D.wsT = null; connectWS();
      poll();
    }
    function zombieCheck() {
      var w = D.ws; if (!w || D.dead || D.replaced) return;
      if (w.readyState === 0 && D.wsAt && Date.now() - D.wsAt > 9000) { recycleWS('connecting'); return; }
      if (w.readyState === 1 && examOn() && !document.hidden && D.lastMsgAt && Date.now() - D.lastMsgAt > ZOMBIE_MS) recycleWS('zombie');
    }
    function closeWS(final) {
      clearTimeout(D.wsT); D.wsT = null; clearInterval(D.pingT);
      var w = D.ws; D.ws = null;
      if (w) { try { w.onclose = null; w.close(); } catch (e) { } }
      if (final) D.reconnecting = false;
    }

    /* ---------- tin từ máy chủ ---------- */
    var onMsg = safe(function (m) {
      syncFrom(m);
      switch (m.t) {
        case 'hello':
          if (m.startAt) D.startAt = m.startAt;
          if (typeof m.count === 'number') D.count = m.count;
          if (m.total && typeof m.total === 'number' && m.total > 20) D.total = m.total;
          D.helloN = m.n || 0;
          if (D.view === 'lobby') renderEv();
          break;
        case 'lobby':
          if (m.startAt) D.startAt = m.startAt;
          if (typeof m.count === 'number') D.count = m.count;
          if (D.view === 'lobby') renderEv();
          break;
        case 'picked':
          if (typeof m.n === 'number' && typeof m.choice === 'number') {
            D.picked[m.n] = m.choice; D.acked[m.n] = true;
            if (D.q && D.q.n === m.n && !D.locked) { D.locked = true; if (D.view === 'q') renderEv(); }
          }
          break;
        case 'q': onQ(m); break;
        case 'reveal': onReveal(m); break;
        case 'emo': onEmo(m); break;
        case 'final': onFinal(m); break;
        case 'err':
          D.toast = String(m.msg || 'Có lỗi, thử lại nhé'); renderEv();
          clearTimeout(onMsg._t); onMsg._t = setTimeout(function () { D.toast = ''; renderEv(); }, 4000);
          break;
      }
    });
    function onQ(m) {
      var first = !D.seenQ;
      if (first && m.n > 1 && !(m.score > 0)) { D.late = true; D.lateN = m.n - 1; }
      D.seenQ = true;
      var changed = !D.q || D.q.n !== m.n;
      var rem = (m.deadline || 0) - now();
      D.qMax[m.n] = Math.max(D.qMax[m.n] || 0, rem, 1000);
      D.q = m; D.total = D.total || 0;
      D.me = { rank: m.rank || D.me.rank, score: m.score || 0, streak: m.streak || 0 };
      D.view = 'q'; D.rev = null;
      if (typeof m.picked === 'number' && m.picked >= 0) { D.picked[m.n] = m.picked; D.acked[m.n] = true; }   /* nối lại giữa câu: máy chủ cho biết đã chốt gì */
      if (changed) { D.timeUp = false; D.mcMsg = ''; D.mc = null; D.emo = { n: m.n, s: [0, 0, 0, 0, 0] }; D.emoOwn = [0, 0, 0, 0, 0]; }
      else if (D.timeUp && rem > -TIME_TOL) D.timeUp = false;   /* nhận lại tin q cùng câu còn hạn: mở lại (đồng hồ máy từng lệch) */
      D.locked = typeof D.picked[m.n] === 'number';             /* luôn tính lại từ sự thật, không để 'locked' kẹt từ màn công bố */
      hideRemind(); renderEv();
    }
    function onReveal(m) {
      var q = D.q && D.q.n === m.n ? D.q : D.q;
      var prevRank = D.me.rank;
      var pk = (typeof m.picked === 'number' && m.picked >= 0) ? m.picked : (typeof D.picked[m.n] === 'number' ? D.picked[m.n] : -1);
      var correct = -1, right = false;
      if (typeof m.ok === 'number') { correct = m.ok; right = pk === correct; }
      else { right = !!m.ok; correct = right ? pk : -1; }
      var delta = (prevRank > 0 && m.rank > 0) ? prevRank - m.rank : (+m.delta || 0);
      D.rev = { m: m, q: q, pk: pk, correct: correct, right: right, delta: delta, prevStreak: D.me.streak };
      D.me = { rank: m.rank || D.me.rank, score: m.score || 0, streak: m.streak || 0 };
      if (typeof m.total === 'number' && m.total > 0) D.total = m.total;
      if (m.top && m.top.length) D.lastTop = m.top;
      D.view = 'reveal'; D.locked = true;
      if (D.overlayOn) renderEv();
    }
    function onFinal(m) {
      D.fin = m; D.view = 'final';
      if (typeof m.total === 'number') D.total = m.total;
      if (D.ws) { closeWS(false); }
      D.minimized = false; openOverlay();
    }

    /* ---------- lớp phủ ---------- */
    function openOverlay() {
      if (D.dead) return;
      D.overlayOn = true; D.minimized = false; el.ev.classList.add('on'); setChip('');
      hideRemind();
      if (!D.ws && !D.debug && D.view !== 'final') connectWS();
      renderEv();
    }
    function minimize() { D.overlayOn = false; D.minimized = true; clearFly(); el.ev.classList.remove('on'); refreshUI(); if (D.debug) setChip(chipText(true)); }
    function closeFinal() {
      D.closed = true; D.overlayOn = false; clearFly(); el.ev.classList.remove('on'); el.ev.innerHTML = '';
      if (D.day) ls('qz-done-' + D.day, '1');
      closeWS(true); setChip(''); hideRemind();
    }
    function onEvClick(e) {
      var a = e.target.closest('.qz-ans');
      if (a) { onAnsTap(a); return; }
      var b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('qz-emb')) { sendEmo(+b.dataset.e, b); return; }
      if (b.dataset.a === 'takeover') { D.replaced = false; connectWS(); renderEv(); return; }
      if (b.dataset.a === 'min') minimize();
      else if (b.dataset.a === 'close') closeFinal();
    }
    /* Nút bấm thuộc câu cũ (DOM chưa kịp thay) thì bỏ, tránh chốt nhầm sang câu mới */
    function onAnsTap(a) {
      if (a.dataset.n && D.q && +a.dataset.n !== D.q.n) return;
      choose(+a.dataset.i);
    }
    function choose(i) {
      var q = D.q; if (!q || D.view !== 'q' || D.locked || D.timeUp) return;
      if (!(i >= 0 && i < 4)) return;
      D.picked[q.n] = i; D.locked = true;
      var sent = false, fresh = D.lastMsgAt && Date.now() - D.lastMsgAt < ZOMBIE_MS;
      if (D.ws && D.ws.readyState === 1) { try { D.ws.send(JSON.stringify({ t: 'ans', n: q.n, choice: i })); sent = true; } catch (e) { sent = false; } }
      if (!sent || !fresh) httpAnswer(q.n, i, 0);   /* socket chập chờn/im lặng: gửi bằng HTTP, thử lại tới hết giờ */
      else {
        /* gửi qua WS nhưng 1,5s sau chưa thấy máy chủ báo 'picked' => gửi thêm bằng HTTP (máy chủ chỉ nhận đáp án đầu tiên) */
        var nq = q.n;
        setTimeout(function () { if (!D.acked[nq] && D.q && D.q.n === nq && !D.timeUp) httpAnswer(nq, i, 0); }, 1500);
      }
      lockButtons();
      setHint('Đã chốt đáp án ' + LET[i] + ' · không đổi được', 'ok');
      var mc = el.ev.querySelector('.qz-mc'), say = el.ev.querySelector('.qz-say');
      if (mc) mc.textContent = '🤞'; if (say) say.textContent = 'Đã chốt! Cầu nguyện đi…';
      D.mc = '🤞'; D.mcMsg = 'Đã chốt! Cầu nguyện đi…';
    }
    function httpAnswer(n, choice, tries) {
      try {
        (window.__NETCO_FETCH__||fetch)(API + '/answer', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ n: n, choice: choice }) })
          .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
          .then(safe(function (j) {
            if (j && j.ok === false && j.msg && !/đã trả lời/.test(j.msg)) { D.toast = String(j.msg); if (D.overlayOn) renderEv(); }
          }))
          .catch(function () {
            if (tries < 4 && D.q && D.q.n === n && !D.timeUp) setTimeout(function () { httpAnswer(n, choice, tries + 1); }, 600);
            else diag('answer-http-fail');
          });
      } catch (e) { diag('answer-http-throw'); }
    }
    /* Báo cáo chẩn đoán (tối đa 3 lần/phiên) để biết vì sao nút không bấm được ở máy thật. */
    function diag(reason, extra) {
      try {
        /* tối đa 6 lần/phiên, mỗi lý do tối đa 2 lần (máy chủ cắt log ở 400 ký tự nên đặt khoá quan trọng lên đầu) */
        D.diagR = D.diagR || {}; D.diagR[reason] = (D.diagR[reason] || 0) + 1;
        if (D.diagR[reason] > 2 || D.diagN >= 6) return;
        D.diagN++;
        var b = { r: reason, v: CLIENT_VERSION };
        if (extra) for (var k in extra) b[k] = extra[k];
        var more = { ws: D.ws ? D.ws.readyState : -1, age: D.lastMsgAt ? Math.round((Date.now() - D.lastMsgAt) / 1000) : -1, rec: !!D.reconnecting, rep: !!D.replaced, lock: !!D.locked, tu: !!D.timeUp, view: D.view, n: D.q ? D.q.n : 0, off: Math.round(D.offset),
          vis: document.hidden ? 0 : 1, sa: !!(window.navigator && window.navigator.standalone) || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches), w: window.innerWidth, h: window.innerHeight,
          ua: String(navigator.userAgent || '').slice(0, 70) };
        for (var k2 in more) if (!(k2 in b)) b[k2] = more[k2];
        (window.__NETCO_FETCH__||fetch)(API + '/diag', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).catch(function () { });
      } catch (e) { }
    }
    /* Khi mạng đổi trạng thái: không dựng lại cả màn (làm mất cú chạm đang dở); chỉ đổi dòng gợi ý. */
    function softRender() {
      if (!D.overlayOn) return;
      if (D.view === 'q' && el.ev && el.ev.querySelector('.qz-answers')) {
        var pk = D.q ? D.picked[D.q.n] : undefined;
        if (D.reconnecting) setHint('Đang nối lại… bạn vẫn chọn đáp án được', 'bad');
        else if (typeof pk === 'number') setHint('Đã chốt đáp án ' + LET[pk] + ' · không đổi được', 'ok');
        else setHint('Chạm hoặc bấm phím 1–4 để chọn', '');
      } else renderEv();
    }
    function lockButtons() {
      var q = D.q; if (!q) return;
      el.ev.querySelectorAll('.qz-ans').forEach(function (b) {
        b.disabled = true; if (+b.dataset.i === D.picked[q.n]) b.classList.add('qz-picked');
      });
    }
    function setHint(t, cls) {
      var h = el.ev.querySelector('.qz-hint'); if (!h) return;
      h.textContent = t; h.className = 'qz-hint' + (cls ? ' ' + cls : '');
    }

    /* ---------- giữ ngón: hoãn dựng lại màn ---------- */
    function holdOn() { D.hold = true; clearTimeout(D.holdT); D.holdT = setTimeout(function () { holdOff(); }, 1500); }
    function holdOff() {
      if (!D.hold) return;
      clearTimeout(D.holdT);
      /* chờ 80ms để 'click' kịp tới nút cũ rồi mới dựng lại */
      setTimeout(function () { D.hold = false; if (D.renderPending) { D.renderPending = false; safe(renderEv)(); } }, 80);
    }

    /* ---------- thả cảm xúc ---------- */
    function kfmt(n) {
      n = Math.max(0, Math.floor(+n || 0));
      if (n < 1000) return String(n);
      if (n < 10000) return (Math.floor(n / 100) / 10).toFixed(1).replace('.', ',') + 'k';
      return Math.floor(n / 1000) + 'k';
    }
    function emoBar() {
      var h = '<div class="qz-emo" role="group" aria-label="Thả cảm xúc">';
      for (var i = 0; i < 5; i++) {
        var c = D.emo.s[i] || 0;
        h += '<button type="button" class="qz-emb" data-e="' + i + '" aria-label="Thả ' + EMO[i] + '"><span class="qz-eme">' + EMO[i] + '</span><span class="qz-emn' + (c ? '' : ' z') + '">' + kfmt(c) + '</span></button>';
      }
      return h + '</div>';
    }
    function paintEmo() {
      if (!el.ev) return;
      var ns = el.ev.querySelectorAll('.qz-emb');
      for (var i = 0; i < ns.length; i++) {
        var k = +ns[i].dataset.e, c = D.emo.s[k] || 0, sp = ns[i].querySelector('.qz-emn'); if (!sp) continue;
        var t = kfmt(c); if (sp.textContent !== t) sp.textContent = t;
        sp.classList.toggle('z', !c);
      }
    }
    function flyEmo(e, x, y) {
      var L = el.fly; if (!L || !D.overlayOn || reducedMotion() || document.hidden) return;
      if (L.childElementCount >= EMO_MAX_FLY) return;
      var f = document.createElement('i'); f.className = 'qz-fl'; f.textContent = EMO[e];
      f.style.left = Math.round(x) + 'px'; f.style.top = Math.round(y) + 'px';
      f.style.setProperty('--dx', Math.round((Math.random() - 0.5) * 90) + 'px');
      f.style.setProperty('--dy', '-' + Math.round(170 + Math.random() * 150) + 'px');
      f.style.setProperty('--dur', (1.3 + Math.random() * 0.7).toFixed(2) + 's');
      var done = function () { try { f.remove(); } catch (_) { } };
      f.addEventListener('animationend', done);
      setTimeout(done, 2400);
      L.appendChild(f);
    }
    function emoViews() { return D.overlayOn && (D.view === 'q' || D.view === 'reveal'); }
    function sendEmo(e, btn) {
      if (!(e >= 0 && e < 5) || !emoViews()) return;
      var t = Date.now(); if (t - D.emoAt < EMO_GAP) return;       /* tự giới hạn ~300ms/lần */
      if (!D.ws || D.ws.readyState !== 1) return;                  /* socket chưa mở thì không gửi */
      D.emoAt = t;
      try { D.ws.send('{"t":"emo","e":' + e + '}'); } catch (x) { return; }
      D.emoOwn[e]++;
      var r = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : null;
      flyEmo(e, r ? r.left + r.width / 2 : window.innerWidth / 2, r ? r.top + 4 : window.innerHeight - 60);
    }
    function onEmo(m) {
      if (m.s && m.s.length >= 5) { for (var i = 0; i < 5; i++) D.emo.s[i] = Math.max(0, +m.s[i] || 0); paintEmo(); }
      if (!emoViews() || reducedMotion() || !m.d) return;
      for (var e = 0; e < 5; e++) {
        var d = Math.max(0, Math.floor(+m.d[e] || 0)), mine = Math.min(d, D.emoOwn[e]);
        D.emoOwn[e] -= mine; d -= mine;                              /* phần của chính mình đã bay tại chỗ rồi */
        for (var k = 0; k < Math.min(EMO_PER_TYPE, d); k++) {
          flyEmo(e, 20 + Math.random() * Math.max(10, window.innerWidth - 40), window.innerHeight - 60 - Math.random() * 70);
        }
      }
    }
    function clearFly() { if (el.fly) el.fly.innerHTML = ''; }

    /* ---------- WATCHDOG: nút đáp án bị phủ/inert thì tự gỡ ---------- */
    function descEl(n) {
      var d = '';
      try {
        var cs = getComputedStyle(n), cl = typeof n.className === 'string' ? n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        d = n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (cl ? '.' + cl : '') + ' z' + cs.zIndex + ' ' + cs.position;
        if (cs.position !== 'fixed' && cs.position !== 'absolute') {                       /* tìm tổ tiên định vị gây ra phủ */
          for (var p = n.parentElement, k = 0; p && k < 5; p = p.parentElement, k++) {
            var pc = getComputedStyle(p);
            if (pc.position === 'fixed' || pc.position === 'absolute') { d += ' <' + p.tagName.toLowerCase() + (p.id ? '#' + p.id : '') + ' z' + pc.zIndex + ' ' + pc.position; break; }
          }
        }
      } catch (e) { }
      return d.slice(0, 110);
    }
    function raiseOverlay() {
      try {
        el.root.inert = false; el.ev.inert = false;
        if (document.body.lastElementChild !== el.root) document.body.appendChild(el.root);
        el.root.style.setProperty('--qz-z', String(Z_TOP));
      } catch (e) { }
    }
    function watchdog() {
      if (!el.root || D.dead) return;
      if (!document.body.contains(el.root)) { document.body.appendChild(el.root); diag('detached'); }
      if (!D.overlayOn || document.hidden || !el.ev) return;
      if (!el.ev.classList.contains('on')) el.ev.classList.add('on');
      var t = el.ev.querySelector(D.view === 'q' ? '.qz-a0' : 'button[data-a]'); if (!t) return;
      var r = t.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
      if (!r.width || !r.height) return;
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) return;                 /* nút đang cuộn ngoài khung nhìn */
      x = Math.min(W - 1, Math.max(1, x)); y = Math.min(H - 1, Math.max(1, y));
      var top = document.elementFromPoint(x, y);
      var inert = !!(el.root.inert || el.ev.inert || (el.ev.closest && el.ev.closest('[inert]')));
      if (!top || el.ev.contains(top)) { if (!inert) return; }
      var info = { el: top ? descEl(top) : 'null', inert: !!el.root.inert, anc: inert };
      diag('covered', info);
      /* tự xử lý: gỡ inert (root + tổ tiên bị đặt), đưa root xuống cuối body, z-index rất cao */
      for (var a = el.ev.parentElement; a && a !== document.documentElement; a = a.parentElement) { if (a.inert) { try { a.inert = false; } catch (e) { } } }
      raiseOverlay();
      var again = document.elementFromPoint(x, y);
      if (again && !el.ev.contains(again)) diag('covered-persist', { el: descEl(again) });
    }

    /* ---------- dựng HTML từng màn ---------- */
    function minBtn() { return '<button type="button" class="qz-minb" data-a="min" aria-label="Thu nhỏ">▾ Thu nhỏ</button>'; }
    function topbar(label, streak, timerHtml) {
      return '<div class="qz-top"><span class="qz-qn">' + label + '</span>' +
        (streak > 1 ? '<span class="qz-streak">🔥 ×' + streak + '</span>' : '') + '<span class="qz-sp"></span>' +
        (timerHtml || '') + minBtn() + '</div>';
    }
    function mcRow(f, t) { return '<div class="qz-mcrow"><div class="qz-mc">' + f + '</div><div class="qz-say">' + t + '</div></div>'; }
    function qbox(q) {
      return '<div class="qz-panel qz-qbox"><span class="qz-qcat">' + esc(q.cat || 'Đố vui') + '</span><span class="qz-qtext">' + esc(q.text) + '</span></div>';
    }
    function confetti(n) {
      var c = ['#ffcf33', '#e53935', '#1e88e5', '#43a047', '#b07be8', '#fff'], h = '<div class="qz-cf" aria-hidden="true">';
      for (var i = 0; i < n; i++) h += '<i style="left:' + ((i * 37) % 100) + '%;background:' + c[i % 6] + ';--dx:' + (((i * 53) % 80) - 40) + 'px;animation-delay:' + (-(i % 9) * 0.3) + 's;animation-duration:' + (2.2 + (i % 5) * 0.3) + 's"></i>';
      return h + '</div>';
    }
    function lbHtml(top, me, delta, title) {
      var rows = '', inList = false, list = (top || []).slice(0, 5);
      list.forEach(function (r, i) {
        var isMe = me.rank > 0 && r.rank === me.rank;
        if (isMe) inList = true;
        rows += '<div class="qz-row' + (isMe ? ' qz-me' : '') + (i >= 3 ? ' qz-xp' : '') + '"><span class="qz-rk qz-num">' + (MEDAL[r.rank - 1] || r.rank) + '</span><span class="qz-av">' + (isMe ? '😎' : face(r.name)) + '</span><span class="qz-rn">' + esc(isMe ? 'Bạn' : r.name) + (isMe ? deltaHtml(delta) : '') + '</span><span class="qz-num">' + fmt(isMe ? me.score : r.score) + '</span></div>';
      });
      if (!inList && me.rank > 0) {
        if (rows) rows += '<div class="qz-lsep">⋮</div>';
        rows += '<div class="qz-row qz-me"><span class="qz-rk qz-num">' + me.rank + '</span><span class="qz-av">😎</span><span class="qz-rn">Bạn' + deltaHtml(delta) + '</span><span class="qz-num">' + fmt(me.score) + '</span></div>';
      }
      return '<div class="qz-dark qz-lb"><h4><span>' + (title || '🏆 Bảng điểm') + '</span><small>' + (D.total ? fmt(D.total) + ' người' : '') + '</small></h4>' + rows + '</div>';
    }
    function deltaHtml(d) { return d > 0 ? ' <span class="qz-up">▲' + d + '</span>' : d < 0 ? ' <span class="qz-dn">▼' + (-d) + '</span>' : ''; }
    function footHtml(rank, score, d) {
      return '<div class="qz-foot qz-pfoot"><span>Hạng <b>' + (rank || '-') + (D.total ? '/' + fmt(D.total) : '') + '</b>' + deltaHtml(d) + '</span><span style="margin-left:auto"><b>' + fmt(score) + '</b> điểm</span></div>';
    }
    function slot(i, t, sub, cls) { return '<div class="qz-slot ' + (cls || '') + '"><i>' + i + '</i>' + t + '<small>' + sub + '</small></div>'; }

    /* Màn dự phòng cực đơn giản: nếu viewQ/viewReveal/... ném lỗi thì vẫn có nút bấm được, KHÔNG để màn kẹt ở màn cũ. */
    function fallbackHtml() {
      var h = '', close = '<button type="button" class="qz-btn qz-yellow qz-big" data-a="close">Đóng</button>';
      try {
        if (D.view === 'q' && D.q) {
          var lk = D.locked || D.timeUp || D.replaced, pk = D.picked[D.q.n], ans = '';
          (D.q.options || []).slice(0, 4).forEach(function (t, i) {
            ans += '<button type="button" class="qz-ans qz-a' + i + (pk === i ? ' qz-picked' : '') + '" data-i="' + i + '" data-n="' + D.q.n + '"' + (lk ? ' disabled' : '') + '><b class="qz-k">' + LET[i] + '</b><span>' + esc(t) + '</span></button>';
          });
          h = '<div class="qz-in"><div class="qz-top"><span class="qz-qn">Câu ' + esc(D.q.n) + '</span><span class="qz-sp"></span><span class="qz-tm qz-num" id="qz-tm">--</span>' + minBtn() + '</div>' +
            '<div class="qz-panel qz-qbox"><span class="qz-qtext">' + esc(D.q.text) + '</span></div><div class="qz-answers">' + ans + '</div>' +
            '<div class="qz-hint">' + (typeof pk === 'number' ? 'Đã chốt đáp án ' + LET[pk] : 'Chạm hoặc bấm phím 1–4 để chọn') + '</div></div>';
        } else if (D.view === 'reveal' && D.rev) {
          h = '<div class="qz-in"><div class="qz-top"><span class="qz-qn">Câu ' + esc(D.rev.m.n) + '</span><span class="qz-sp"></span>' + minBtn() + '</div>' +
            '<div class="qz-note">' + (D.rev.right ? 'Đúng rồi! ' : 'Kết quả câu này: ') + '+' + fmt(D.rev.m.gain) + ' điểm · Hạng ' + esc(D.rev.m.rank || '-') + ' · ' + fmt(D.rev.m.score) + ' điểm</div></div>';
        } else if (D.view === 'final') {
          var me = (D.fin && D.fin.me) || {};
          h = '<div class="qz-in"><div class="qz-top"><span class="qz-qn">Kết thúc</span></div><div class="qz-ribbon">HẠNG ' + esc(me.rank || '-') + '<small>' + fmt(me.score) + ' điểm</small></div>' + close + '</div>';
        }
      } catch (e) { h = ''; }
      if (!h) h = '<div class="qz-in"><div class="qz-top"><span class="qz-qn">Đố vui</span><span class="qz-sp"></span>' + (D.view === 'final' ? '' : minBtn()) + '</div><div class="qz-note">Đang cập nhật…</div>' + (D.view === 'final' ? close : '') + '</div>';
      return h;
    }
    function renderEv() {
      if (!D.overlayOn || !el.ev) return;
      if (D.hold) { D.renderPending = true; return; }          /* đang giữ ngón trên nút: dựng lại sau khi nhả */
      D.renderPending = false;
      var h;
      try {
        if (D.view === 'q') h = viewQ(); else if (D.view === 'reveal') h = viewReveal(); else if (D.view === 'final') h = viewFinal(); else h = viewLobby();
      } catch (e) {
        try { console.warn('[quiz] render', e); } catch (_) { }
        diag('render-fail', { err: String(e && e.message || e).slice(0, 70), vw: D.view });
        h = fallbackHtml();
      }
      try { el.ev.innerHTML = h; } catch (e) { diag('render-set-fail'); }
      try { tickEv(); } catch (e) { try { console.warn('[quiz] tick', e); } catch (_) { } }
    }
    function viewLobby() {
      var t = D.startAt ? D.startAt - now() : 0, started = D.startAt && t <= 0;
      var crowd = ''; for (var i = 0; i < Math.min(24, Math.max(6, D.count || 0)); i++) crowd += FACES[i % FACES.length];
      return '<div class="qz-in">' + topbar('Sảnh chờ', 0, '') +
        '<div class="qz-cols"><div class="qz-main"><div class="qz-hero"><div class="qz-bigem">😺</div><div class="qz-t1">Đố Vui Chủ Quán</div>' +
        '<div class="qz-cd qz-num" id="qz-lcd">' + (started ? '…' : mmss(t)) + '</div><div class="qz-hsub" id="qz-lsub">' + (started ? 'Câu đầu tiên sắp lên sóng!' : 'Câu đầu tiên sắp bắt đầu!') + '</div></div>' +
        mcRow('😺', 'Uống miếng nước đi! Tối nay ' + (D.count ? '<b>' + fmt(D.count) + '</b> chủ quán' : 'các chủ quán') + ' cùng tranh ngôi <b>thông minh nhất</b> 👑') +
        '<div class="qz-slots">' + slot('💰', 'Tiền', 'theo cấp') + slot('🎟️', 'Coupon', 'Top 1 tới 5.000') + '</div></div>' +
        '<div class="qz-side"><div class="qz-crowd" aria-hidden="true">' + crowd + '</div></div></div>' +
        '<div class="qz-foot"><span><b>' + fmt(D.count) + '</b> người đang chờ</span><span style="margin-left:auto">Bạn đã đăng ký ✔</span></div>' +
        statusLine() + '</div>';
    }
    function takeoverHtml() {
      return '<div class="qz-hint bad">Đố Vui đang mở ở tab/thiết bị khác. <button type="button" class="qz-takeover" data-a="takeover">Chơi ở máy này</button></div>';
    }
    function statusLine() {
      return (D.replaced ? takeoverHtml() : '') + (D.reconnecting ? '<div class="qz-hint bad"><span class="qz-spin">⟳</span> Đang nối lại…</div>' : '') +
        (D.toast ? '<div class="qz-note">' + esc(D.toast) + '</div>' : '');
    }
    function viewQ() {
      var q = D.q, pk = D.picked[q.n], lock = D.locked || D.timeUp || D.replaced;   /* mất kết nối KHÔNG khoá nút: đáp án gửi bằng HTTP dự phòng */
      var emo = D.reconnecting ? '📡' : (D.mc || '😺');
      var say = D.reconnecting ? 'Mạng chập chờn… đang nối lại' : (D.mcMsg || 'Câu này <b>ăn điểm</b> đó, nghĩ nhanh nào meo!');
      var ans = '';
      (q.options || []).slice(0, 4).forEach(function (t, i) {
        ans += '<button type="button" class="qz-ans qz-a' + i + (pk === i ? ' qz-picked' : '') + '" data-i="' + i + '" data-n="' + q.n + '"' + (lock ? ' disabled' : '') + '><b class="qz-k">' + LET[i] + '</b><span>' + esc(t) + '</span></button>';
      });
      var hint = D.replaced ? takeoverHtml() : D.reconnecting ? '<div class="qz-hint bad"><span class="qz-spin">⟳</span> Đang nối lại… bạn vẫn chọn đáp án được</div>' :
        (typeof pk === 'number' ? '<div class="qz-hint ok">Đã chốt đáp án ' + LET[pk] + ' · không đổi được</div>' :
          '<div class="qz-hint">Chạm hoặc bấm phím 1–4 để chọn</div>');
      var me = { rank: D.me.rank, score: D.me.score };
      return '<div class="qz-in">' + topbar('Câu ' + q.n + '/' + (q.total || 20), D.me.streak, '<span class="qz-tm qz-num" id="qz-tm">--</span>') +
        '<div class="qz-timebar" id="qz-tb"><i style="width:100%"></i></div>' +
        '<div class="qz-cols"><div class="qz-main">' +
        (D.late && q.n <= (D.lateN + 3) ? '<div class="qz-banner">Bạn vào muộn: ' + D.lateN + ' câu đầu tính 0 điểm, vẫn thi tiếp được!</div>' : '') +
        mcRow(emo, say) + qbox(q) + '<div class="qz-answers">' + ans + '</div>' + hint + (D.toast ? '<div class="qz-note">' + esc(D.toast) + '</div>' : '') +
        '</div><div class="qz-side">' + emoBar() + lbHtml(D.lastTop, me, 0) + '</div></div>' + footHtml(D.me.rank, D.me.score, 0) + '</div>';
    }
    function viewReveal() {
      var R = D.rev, m = R.m, q = R.q || {}, pk = R.pk, right = R.right, none = pk < 0;
      var icon = right ? '✔' : none ? '⏰' : '✖';
      var emo = right ? '😻' : none ? '😴' : '😿';
      var say = right ? 'Chuẩn luôn! <b>Đỉnh quá</b> chủ quán ơi 🎉' : none ? 'Ngủ gật hả chủ quán? Zzz…' : 'Tiếc quá! Câu sau <b>gỡ</b> nhé 💪';
      var pct = (m.pct || []).slice(0, 4), mx = Math.max.apply(null, pct.concat([0]));
      if (mx > 0 && mx <= 1) pct = pct.map(function (p) { return p * 100; });
      var ans = '';
      (q.options || []).slice(0, 4).forEach(function (t, i) {
        var isR = i === R.correct, wp = i === pk && !isR, dim = !isR && !wp, p = Math.round(pct[i] || 0);
        ans += '<button type="button" class="qz-ans qz-a' + i + (isR ? ' qz-right' : '') + (wp ? ' qz-wrongpick' : '') + (dim ? ' qz-dim' : '') + '" data-i="' + i + '" disabled><i class="qz-pct" style="width:' + p + '%"></i><b class="qz-k">' + (isR ? '✔' : wp ? '✖' : LET[i]) + '</b><span>' + esc(t) + '</span><b class="qz-pt">' + p + '%</b></button>';
      });
      var gain = +m.gain || 0, small = right ? (m.streak > 1 ? 'CHUỖI ×' + m.streak : 'ĐÚNG RỒI') : none ? 'HẾT GIỜ' : (R.prevStreak > 1 ? 'MẤT CHUỖI' : 'SAI RỒI');
      return (right ? confetti(28) : '') + '<div class="qz-in">' + topbar('Câu ' + m.n + '/' + (q.total || 20), m.streak, '<span class="qz-tm qz-num">' + icon + '</span>') +
        '<div class="qz-timebar"><i style="width:0"></i></div>' +
        '<div class="qz-cols"><div class="qz-main">' + mcRow(emo, say) + (q.text ? qbox(q) : '') + '<div class="qz-answers">' + ans + '</div>' +
        '<div class="qz-res"><div class="qz-gain qz-num' + (gain > 0 ? '' : ' zero') + '">+' + fmt(gain) + '<small>' + small + '</small></div>' +
        (m.why ? '<div class="qz-why">💬 ' + esc(m.why) + '</div>' : '') + '</div></div>' +
        '<div class="qz-side">' + emoBar() + lbHtml(m.top && m.top.length ? m.top : D.lastTop, { rank: m.rank, score: m.score }, R.delta) + '</div></div>' +
        footHtml(m.rank, m.score, R.delta) + statusLine() + '</div>';
    }
    function viewFinal() {
      var f = D.fin, me = f.me || {}, top = f.top || [], champ = !!me.champion, total = f.total || D.total;
      function pod(i) {
        var r = top[i]; if (!r) return '<div class="qz-pod qz-p' + (i + 1) + '"><div class="qz-st">' + (i + 1) + '</div></div>';
        var isMe = me.rank === r.rank;
        return '<div class="qz-pod qz-p' + (i + 1) + '">' + (i === 0 ? '<div class="qz-crown">👑</div>' : '') + '<div class="qz-face">' + (isMe ? '😎' : face(r.name)) + '</div><span class="qz-pn">' + esc(isMe ? 'BẠN' : r.name) + '</span><span class="qz-sc">' + fmt(r.score) + '</span><div class="qz-st">' + (i + 1) + '</div></div>';
      }
      var more = '';
      top.slice(3, 10).forEach(function (r) {
        var isMe = me.rank === r.rank;
        more += '<div class="qz-row' + (isMe ? ' qz-me' : '') + '"><span class="qz-rk qz-num">' + r.rank + '</span><span class="qz-rn">' + esc(isMe ? 'Bạn' : r.name) + '</span><span class="qz-num">' + fmt(r.score) + '</span></div>';
      });
      var ribbon = champ ? '<div class="qz-ribbon">👑 CHỦ QUÁN THÔNG MINH NHẤT<small>Chúc mừng! Bạn đứng đầu ' + (total ? fmt(total) + ' người chơi' : 'buổi đố vui') + '</small></div>' :
        '<div class="qz-ribbon">HẠNG ' + (me.rank || '-') + (total ? '/' + fmt(total) : '') + '<small>' + (me.correct != null ? me.correct + '/' + (me.total || 20) + ' câu đúng · ' : '') + fmt(me.score) + ' điểm</small></div>';
      return confetti(champ ? 60 : 18) + '<div class="qz-in">' + topbar('Kết thúc', 0, '') +
        '<div class="qz-cols"><div class="qz-main"><div class="qz-podium">' + pod(1) + pod(0) + pod(2) + '</div>' + ribbon +
        '<div class="qz-slots one">' + slot('🎟️', '+' + fmt(me.coupon) + ' Coupon', 'Coupon sẽ vào túi ở lần đồng bộ kế tiếp', 'new') + '</div>' +
        '<button type="button" class="qz-btn qz-yellow qz-big" data-a="close">Đóng</button></div>' +
        '<div class="qz-side"><div class="qz-dark qz-lb"><h4><span>Top 4–10</span></h4><div class="qz-more">' + (more || '<div class="qz-note">Chưa có dữ liệu</div>') + '</div></div></div></div></div>';
    }

    /* ---------- nhịp 250ms: đếm ngược ---------- */
    function tickEv() {
      if (!D.overlayOn) return;
      if (D.view === 'q' && D.q) {
        var rem = D.q.deadline - now(), max = D.qMax[D.q.n] || 20000, sec = Math.max(0, Math.ceil(rem / 1000));
        var tm = el.ev.querySelector('#qz-tm'), tb = el.ev.querySelector('#qz-tb');
        if (tm) { tm.textContent = sec; tm.classList.toggle('low', sec <= 5); }
        if (tb) {
          tb.className = 'qz-timebar' + (sec <= 5 ? ' low' : sec <= 10 ? ' mid' : '');
          tb.firstChild.style.width = Math.max(0, Math.min(100, rem / max * 100)) + '%';
        }
        /* Khoá nút hết giờ chỉ khi quá hạn + dung sai (đồng hồ máy có thể lệch); lệch ngược lại thì mở lại. Máy chủ mới là bên quyết định. */
        if (rem <= -TIME_TOL && !D.timeUp && !D.locked) {
          D.timeUp = true; el.ev.querySelectorAll('.qz-ans').forEach(function (b) { b.disabled = true; });
          setHint('Hết giờ — chờ kết quả…', 'bad');
        } else if (D.timeUp && !D.locked && rem > 0 && typeof D.picked[D.q.n] !== 'number') {
          D.timeUp = false; el.ev.querySelectorAll('.qz-ans').forEach(function (b) { b.disabled = false; });
          setHint('Chạm hoặc bấm phím 1–4 để chọn', '');
        }
      } else if (D.view === 'lobby') {
        var t = D.startAt - now(), cd = el.ev.querySelector('#qz-lcd'), sb = el.ev.querySelector('#qz-lsub');
        if (cd) cd.textContent = t > 0 ? mmss(t) : '…';
        if (sb) sb.textContent = t > 0 ? 'Câu đầu tiên sắp bắt đầu!' : 'Câu đầu tiên sắp lên sóng!';
      }
    }
    function tick() {
      try {
        if (D.dead) return;
        if (el.remind && D.remindMode === 'reg') {
          var rt = el.remind.querySelector('#qz-rtick'); if (rt) rt.textContent = mmss(D.startAt - now());
        }
        if (D.overlayOn) tickEv();
        else if (el.chip && el.chip.classList.contains('on') && D.registered) setChip(chipText(D.st && D.st.phase === 'live'));
        refreshUI();
      } catch (e) { }
    }

    /* ---------- khởi động ---------- */
    function start() {
      build();
      D.tickT = setInterval(tick, 250);
      D.pollT = setTimeout(poll, CFG.firstDelay != null ? CFG.firstDelay : 20000);
    }

    /* chỉ để kiểm thử */
    var api = {
      version: String(CLIENT_VERSION),
      debugShow: safe(function (s) {
        s = s || {}; D.debug = true; if (!el.root) build();
        if (s.hide) { D.overlayOn = false; el.ev.classList.remove('on'); hideRemind(); setChip(''); return; }
        if (s.startAt) D.startAt = s.startAt;
        if (s.day) D.day = s.day;
        D.st = D.st || { phase: 'register', eligible: true, registered: false, minLevel: 30 };
        if (s.remind) { showRemind(s.remind); return; }
        if (s.chip) { D.registered = true; setChip(typeof s.chip === 'string' ? s.chip : '❓ Đố vui 12:30'); return; }
        if (s.reset) { D.view = 'lobby'; D.q = null; D.picked = {}; D.fin = null; D.late = false; D.seenQ = false; D.locked = false; D.timeUp = false; D.rev = null; }
        D.registered = true; if (s.count != null) D.count = s.count; if (s.total != null) D.total = s.total;
        openOverlay();
        (s.msgs || []).forEach(function (m) { onMsg(m); });
        if (s.picked != null && D.q) { D.picked[D.q.n] = s.picked; D.locked = true; renderEv(); }
        if (s.reconnecting != null) { D.reconnecting = !!s.reconnecting; renderEv(); }
      })
    };
    window.NetcoQuiz = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safe(start)); else safe(start)();
  } catch (e) { try { console.warn('[quiz] init lỗi', e); } catch (_) { } }

  /* 21/10: dòng thông báo admin (actor bắt đầu bằng 📢) hiện nhãn THÔNG BÁO thay vì JACKPOT (client cũ chỉ có nhãn trúng thưởng) */
  try {
    var relabel = function () {
      var l = document.querySelector('.server-notice-label'), n = document.querySelector('.server-notice-line strong');
      if (l && n && n.textContent.indexOf('📢') === 0 && l.textContent !== 'THÔNG BÁO') l.textContent = 'THÔNG BÁO';
    };
    new MutationObserver(relabel).observe(document.body, { childList: true, subtree: true });
  } catch (e) {}

  /* 21/10: nhận thưởng EXP + tiền game của Đố Vui (máy chủ áp lười khi người chơi gọi claim). Sau 25 giây từ lúc tải trang rồi mỗi 10 phút. */
  try {
    var claimToast = function (text) {
      var d = document.createElement('div');
      d.textContent = text;
      d.setAttribute('role', 'status');
      d.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 64px);transform:translateX(-50%);z-index:9500;background:#fff8ea;color:#2a1c1c;border:2px solid #2a1c1c;border-radius:12px;box-shadow:0 3px 0 #2a1c1c;padding:8px 14px;font:700 14px/1.3 "Baloo 2","Be Vietnam Pro",system-ui,sans-serif;max-width:92vw;text-align:center';
      document.body.appendChild(d);
      setTimeout(function () { try { d.remove(); } catch (e) {} }, 7000);
    };
    var doClaim = function () {
      if (document.hidden) return;
      (window.__NETCO_FETCH__||fetch)('/api/quiz/claim', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (r) {
          if (!r || !r.applied) return;
          var parts = [];
          if (r.xp) parts.push('+' + Number(r.xp).toLocaleString('vi-VN') + ' EXP');
          if (r.money) parts.push('+' + Number(r.money).toLocaleString('vi-VN') + 'đ tiền game');
          if (parts.length) claimToast('🎁 Thưởng Đố Vui Chủ Quán: ' + parts.join(' · '));
          /* 28/10: tiền thưởng làm cloud tăng revision + ví; báo Online nhận ví ngay, không để lần nối lại sau đó tưởng thiết bị khác ghi ("Cloud đã thay đổi" + tải lại). */
          if (r.money) try { dispatchEvent(new CustomEvent('netco-wallet-refresh')); } catch (e) {}
        })
        .catch(function () {});
    };
    setTimeout(doClaim, 25000);
    setInterval(doClaim, 600000);
  } catch (e) {}
})();
