/* Poker 3D — kontroler permainan: mode lawan bot (lokal), online (Firebase), UI & suara. */
(() => {
  'use strict';
  const E = window.PokerEngine;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Math.round(n || 0).toLocaleString('id-ID');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } },
  };
  const BOT_NAMES = ['Rina', 'Bima', 'Joko', 'Sari', 'Dewi', 'Agus', 'Putri', 'Rudi', 'Maya', 'Hendra', 'Lina', 'Yusuf', 'Tono', 'Wati'];
  const LEVEL_NAME = ['', 'Mudah', 'Sedang', 'Sulit'];

  let myId = store.get('pk_uid', '');
  if (!myId) { myId = 'u' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); store.set('pk_uid', myId); }

  let mode = null;        // 'local' | 'online'
  let g = null;           // state otoritatif (mode lokal / host online)
  let isHost = false;
  let mySeat = -1;
  let tickTimer = null;
  let turnKey = -1, turnStart = 0, botDelay = 0, waitRetry = 0;
  let pendingSeq = -1;    // aksi sudah dikirim untuk seq ini (guest)
  let raiseSeq = -1;
  let lastView = null, lastLogKey = '', bustShown = false, overShown = false;
  let localCfg = null, watchBots = false;

  const playerName = () => (store.get('pk_name', '') || 'Pemain').slice(0, 16);
  const Net = {
    db: null, offset: 0, connected: false, code: null, ref: null, host: null, players: {},
    pub: null, priv: null, subs: [], hostSubs: [], hostGoneAt: 0, privHand: -1, hostCheck: null, playersLoaded: false, enteredAt: 0,
  };
  const now = () => Date.now() + Net.offset;

  // ---------- suara (WebAudio sintetis) ----------
  const Snd = {
    ctx: null, on: store.get('pk_snd', true),
    init() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* tanpa suara */ } } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    tone(freq, dur, type, vol, delay) {
      if (!this.on || !this.ctx) return;
      const c = this.ctx, t = c.currentTime + (delay || 0);
      const o = c.createOscillator(), gn = c.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      gn.gain.setValueAtTime(vol || 0.12, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, vol, delay, freq) {
      if (!this.on || !this.ctx) return;
      const c = this.ctx, t = c.currentTime + (delay || 0);
      const len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / len);
      const src = c.createBufferSource(), f = c.createBiquadFilter(), gn = c.createGain();
      f.type = 'bandpass'; f.frequency.value = freq || 3000; gn.gain.value = vol || 0.3;
      src.buffer = buf; src.connect(f).connect(gn).connect(c.destination); src.start(t);
    },
    card(d) { this.noise(0.07, 0.35, d, 2600); },
    chip(d) { d = d || 0; this.tone(3100, 0.05, 'triangle', 0.07, d); this.tone(2500, 0.06, 'triangle', 0.06, d + 0.04); this.tone(3400, 0.05, 'triangle', 0.05, d + 0.08); },
    knock() { this.tone(160, 0.08, 'sine', 0.25); this.tone(150, 0.08, 'sine', 0.2, 0.1); },
    fold() { this.noise(0.12, 0.2, 0, 1200); },
    ding() { this.tone(880, 0.15, 'sine', 0.12); this.tone(1320, 0.25, 'sine', 0.1, 0.12); },
    win() { [523, 659, 784, 1047].forEach((f, k) => this.tone(f, 0.3, 'triangle', 0.1, k * 0.1)); },
  };

  // ---------- util UI ----------
  let toastT = 0;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
  }
  function lobbyError(msg) { const e = $('lobbyError'); e.hidden = !msg; e.innerHTML = msg || ''; }
  function permError(err) {
    console.error(err);
    const msg = `<b>Tidak bisa mengakses database.</b><br>${esc(err && err.message ? err.message : err)}<br>
      Pastikan Realtime Database aktif, <code>databaseURL</code> di <i>firebase-config.js</i> benar,
      dan Rules mengizinkan baca/tulis node <code>poker</code> (lihat README).`;
    if (mode === 'online') toast('Gagal akses database: ' + (err && err.message ? err.message : err));
    lobbyError(msg);
  }
  function readCfg(online) {
    const sb = +$('optBlind').value;
    return { sb, bb: sb * 2, stack: +$('optStack').value, blindUp: +$('optBlindUp').value, turn: online ? +$('optTurn').value : 0 };
  }
  function showOverlay(card) {
    $('overlay').hidden = !card;
    ['menuCard', 'overCard'].forEach(id => { $(id).hidden = id !== card; });
  }

  // ---------- host / lokal: loop permainan ----------
  function authoritative() { return !!g && (mode === 'local' || isHost); }

  function hostTick() {
    if (!authoritative()) return;
    const t = now();
    let ch = false;
    if (g.phase === 'waiting' && mode === 'online' && t > waitRetry) {
      waitRetry = t + 2000;
      if (E.startHand(g)) ch = true;
    }
    if (g.await) {
      if (!g.awaitAt) {
        const fast = watchBots && mode === 'local';
        g.awaitAt = t + (g.await === 'next' ? (fast ? 2500 : 5000) : g.runout ? 1700 : 900);
        ch = true;
      } else if (t >= g.awaitAt) {
        if (g.await === 'street') E.nextStreet(g); else E.startHand(g);
        ch = true;
      }
    } else if (g.toAct >= 0) {
      const i = g.toAct, s = g.seats[i];
      if (g.seq !== turnKey) {
        turnKey = g.seq; turnStart = t;
        botDelay = (watchBots ? 250 : 650) + Math.random() * (watchBots ? 400 : 1300);
        if (!s.bot && g.cfg.turn) { g.deadline = t + g.cfg.turn * 1000; ch = true; }
      }
      if (s.bot) {
        if (t - turnStart >= botDelay) {
          const d = E.botDecide(g, i);
          E.act(g, i, d.type, d.amount);
          ch = true;
        }
      } else if ((s.away || s.leave) && t - turnStart > 1500) { autoAct(i); ch = true; }
      else if (g.deadline && t >= g.deadline) { autoAct(i); ch = true; }
    }
    if (ch) commit();
  }
  function autoAct(i) {
    const L = E.legal(g, i);
    E.act(g, i, L && L.canCheck ? 'check' : 'fold');
  }
  function commit() {
    g.v++;
    if (mode === 'online' && isHost) publish();
    render();
  }
  function startTicker() { if (!tickTimer) tickTimer = setInterval(hostTick, 150); }
  function stopTicker() { clearInterval(tickTimer); tickTimer = null; }

  function pickBotNames(n) {
    const pool = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    return pool.slice(0, n);
  }
  /** Kursi kosong dengan urutan menyebar agar pemain tidak bergerombol di satu sisi. */
  function spreadSeat(game) {
    for (const i of [0, 3, 1, 4, 2, 5]) if (!game.seats[i]) return i;
    return -1;
  }
  function botSeatLayout(n) { return { 1: [3], 2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5] }[n]; }

  // ---------- mode lokal ----------
  function startLocal(cfg, nBots, level) {
    leaveCurrent(true);
    mode = 'local'; isHost = false; watchBots = false; bustShown = false; overShown = false;
    localCfg = { cfg, nBots, level };
    g = E.createGame(cfg);
    E.addPlayer(g, 0, { id: myId, name: playerName() });
    const names = pickBotNames(nBots);
    botSeatLayout(nBots).forEach((seat, k) => {
      const lvl = level || 1 + Math.floor(Math.random() * 3);
      E.addPlayer(g, seat, { id: 'bot' + k, name: names[k], bot: lvl, style: 0.7 + Math.random() * 0.6 });
    });
    enterGameUI();
    E.startHand(g);
    commit();
    startTicker();
  }

  // ---------- online: Firebase ----------
  const R = p => Net.db.ref('poker/' + p);
  const SV = () => firebase.database.ServerValue.TIMESTAMP;

  function netInit() {
    if (Net.db) return true;
    if (!window.firebase || !window.POKER_FIREBASE_CONFIG) { permError('Firebase SDK gagal dimuat (cek koneksi internet).'); return false; }
    try {
      const app = firebase.apps.find(a => a.name === 'poker') || firebase.initializeApp(window.POKER_FIREBASE_CONFIG, 'poker');
      Net.db = app.database();
    } catch (e) { permError(e); return false; }
    Net.db.ref('.info/serverTimeOffset').on('value', s => { Net.offset = s.val() || 0; });
    Net.db.ref('.info/connected').on('value', s => {
      Net.connected = !!s.val();
      updateConn();
      if (Net.connected && Net.ref) armPresence();
    });
    return true;
  }
  function updateConn() {
    $('connDot').className = Net.connected ? 'on' : '';
    $('connText').textContent = Net.connected ? 'Terhubung ke server' : 'Menghubungkan…';
  }
  function armPresence() {
    const me = Net.ref.child('players/' + myId);
    me.child('conn').onDisconnect().set(false);
    me.update({ name: playerName(), conn: true, t: SV() }).catch(permError);
  }

  function refreshRooms() {
    if (!netInit()) return;
    const el = $('roomList');
    el.innerHTML = '<div class="muted">Memuat…</div>';
    const cutoff = now() - 3 * 3600e3;
    R('rooms').orderByChild('created').startAt(cutoff).limitToLast(20).once('value').then(s => {
      const rows = [];
      s.forEach(c => { const r = c.val(); if (r && r.host && r.status !== 'ended') rows.push([c.key, r]); });
      rows.reverse();
      el.innerHTML = rows.length ? rows.map(([k, r]) => {
        const c = r.cfg || {};
        return `<button class="roomRow" data-code="${esc(k)}"><b>${esc(k)}</b><span>${esc(r.hn || '?')}<br><small>Blind ${fmt(c.sb)}/${fmt(c.bb)} · chip ${fmt(c.stack)}</small></span>
          <small>${r.n || 0} online<br>${r.status === 'lobby' ? 'Menunggu' : 'Bermain'}</small></button>`;
      }).join('') : '<div class="muted">Belum ada room. Buat room baru!</div>';
    }).catch(permError);
    // bersihkan room lama (> 3 jam)
    R('rooms').orderByChild('created').endAt(cutoff).limitToFirst(20).once('value')
      .then(s => s.forEach(c => { c.ref.remove(); })).catch(() => {});
  }

  function genCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let k = 0; k < 5; k++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }

  async function createRoom() {
    if (!netInit()) return;
    lobbyError('');
    const cfg = readCfg(true);
    for (let k = 0; k < 6; k++) {
      const code = genCode();
      let res;
      try {
        res = await R('rooms/' + code).transaction(cur => (cur ? undefined : { created: now(), status: 'lobby', host: myId, hn: playerName(), n: 1, cfg }));
      } catch (e) { permError(e); return; }
      if (!res.committed) continue;
      leaveCurrent(true);
      g = E.createGame(cfg);
      E.addPlayer(g, 0, { id: myId, name: playerName() });
      enterRoom(code);
      return;
    }
    lobbyError('Gagal membuat room, coba lagi.');
  }

  async function joinRoom(code) {
    code = String(code || '').toUpperCase().trim();
    if (!/^[A-Z0-9]{5}$/.test(code)) { lobbyError('Kode room harus 5 karakter.'); return; }
    if (!netInit()) return;
    lobbyError('');
    let s;
    try { s = await R('rooms/' + code + '/host').once('value'); } catch (e) { permError(e); return; }
    if (!s.exists()) { lobbyError(`Room <b>${esc(code)}</b> tidak ditemukan.`); return; }
    leaveCurrent(true);
    g = null;
    enterRoom(code);
  }

  function sub(list, ref, ev, fn) {
    ref.on(ev, fn, e => permError(e));
    list.push(() => ref.off(ev, fn));
  }

  function enterRoom(code) {
    mode = 'online'; isHost = false; overShown = false;
    Object.assign(Net, { code, ref: R('rooms/' + code), pub: null, priv: null, players: {}, host: null, hostGoneAt: 0, privHand: -1, playersLoaded: false, enteredAt: Date.now() });
    try { history.replaceState(null, '', location.pathname + '?room=' + code); } catch (e) { /* file:// */ }
    armPresence();
    sub(Net.subs, Net.ref.child('host'), 'value', s => onHost(s.val()));
    sub(Net.subs, Net.ref.child('players'), 'value', s => { Net.players = s.val() || {}; Net.playersLoaded = true; onPlayers(); });
    sub(Net.subs, Net.ref.child('pub'), 'value', s => {
      const d = s.val();
      if (!d) return;
      try { Net.pub = JSON.parse(d); } catch (e) { return; }
      if (!isHost) render();
    });
    sub(Net.subs, Net.ref.child('priv/' + myId), 'value', s => { Net.priv = s.val(); if (!isHost) render(); });
    $('chatList').innerHTML = '';
    sub(Net.subs, Net.ref.child('chat').limitToLast(40), 'child_added', s => addChat(s.val()));
    Net.hostCheck = setInterval(checkHost, 2000);
    enterGameUI();
    render();
  }

  function onHost(h) {
    Net.host = h; Net.hostGoneAt = 0;
    if (h === myId && !isHost) becomeHost();
    else if (h !== myId && isHost) resignHost();
  }

  async function becomeHost() {
    isHost = true;
    if (!g) {
      try {
        const f = await Net.ref.child('full').once('value');
        if (f.val()) g = JSON.parse(f.val());
      } catch (e) { console.error(e); }
      if (!g) {
        const c = await Net.ref.child('cfg').once('value').catch(() => null);
        g = E.createGame((c && c.val()) || readCfg(true));
      }
      if (Net.pub) toast('Host terputus — kamu sekarang host room ini.');
    }
    if (!isHost || !Net.ref) return;
    const ar = Net.ref.child('act');
    const fn = s => { const a = s.val(); s.ref.remove(); handleAct(a); };
    ar.on('child_added', fn);
    Net.hostSubs.push(() => ar.off('child_added', fn));
    Net.ref.update({ hn: playerName() }).catch(() => {});
    turnKey = -1; Net.privHand = -1;
    syncPlayers(true);
    commit();
    startTicker();
  }
  function resignHost() {
    isHost = false; g = null;
    Net.hostSubs.forEach(f => f()); Net.hostSubs = [];
    stopTicker();
    render();
  }

  function handleAct(a) {
    if (!a || !authoritative()) return;
    const i = g.seats.findIndex(s => s && s.id === a.u);
    if (i < 0 || g.toAct !== i || a.q !== g.seq) return;
    if (!E.act(g, i, a.t, a.a)) commit();
  }

  function publish() {
    if (!Net.ref || !g) return;
    const upd = {
      pub: JSON.stringify(E.publicState(g)),
      full: JSON.stringify(g),
      status: g.phase === 'lobby' ? 'lobby' : 'playing',
      n: Object.values(Net.players).filter(p => p && p.conn).length || 1,
    };
    if (g.hand !== Net.privHand) {
      Net.privHand = g.hand;
      g.seats.forEach(s => { if (s && !s.bot) upd['priv/' + s.id] = { h: g.hand, c: s.cards.length ? s.cards : null }; });
    }
    Net.ref.update(upd).catch(permError);
  }

  function onPlayers() {
    if (isHost) syncPlayers();
    checkHost();
    render();
  }

  /** Host: cocokkan kursi dengan daftar pemain yang ada di room. */
  function syncPlayers(silent) {
    if (!authoritative() || !Net.playersLoaded) return;
    const ps = Net.players;
    let ch = false;
    const idle = ['lobby', 'waiting', 'over'].includes(g.phase);
    g.seats.forEach((s, i) => {
      if (!s || s.bot) return;
      if (s.id === myId) { if (s.leave || s.away) { s.leave = false; s.away = false; ch = true; } return; }
      const p = ps[s.id];
      if (!p || !p.name) {
        if (idle || !s.inHand) { g.seats[i] = null; ch = true; }
        else if (!s.leave) { s.leave = true; ch = true; }
        return;
      }
      if (s.leave) { s.leave = false; ch = true; }
      const away = !p.conn;
      if (s.away !== away) { s.away = away; ch = true; }
      if (p.name !== s.name) { s.name = String(p.name).slice(0, 16); ch = true; }
    });
    Object.keys(ps).forEach(id => {
      const p = ps[id];
      if (!p || !p.conn || !p.name) return;
      if (g.seats.some(s => s && s.id === id)) return;
      const i = spreadSeat(g);
      if (i < 0) return; // penuh → penonton
      E.addPlayer(g, i, { id, name: p.name });
      if (!silent) g.log.push(`${String(p.name).slice(0, 16)} bergabung`);
      ch = true;
    });
    if (ch && !silent) commit();
  }

  function checkHost() {
    if (mode !== 'online' || isHost || !Net.host || !Net.connected) return;
    const hp = Net.players[Net.host];
    if (hp && hp.conn) { Net.hostGoneAt = 0; return; }
    if (!Net.hostGoneAt) { Net.hostGoneAt = Date.now(); return; }
    if (Date.now() - Net.hostGoneAt < 6000) return;
    const cands = Object.keys(Net.players).filter(id => Net.players[id] && Net.players[id].conn).sort();
    if (cands[0] !== myId) return;
    const old = Net.host;
    Net.hostGoneAt = Date.now();
    Net.ref.child('host').transaction(cur => (cur === old ? myId : undefined)).catch(console.error);
  }

  function sendAction(type, amount) {
    const v = currentView();
    if (!v || mySeat < 0) return;
    if (authoritative()) {
      const err = E.act(g, mySeat, type, amount);
      if (err) toast(err); else commit();
      return;
    }
    if (pendingSeq === v.seq) return;
    pendingSeq = v.seq;
    Net.ref.child('act').push({ u: myId, q: v.seq, t: type, a: Math.round(amount || 0) }).catch(permError);
    render();
  }

  function sendChat(m) {
    m = String(m || '').trim().slice(0, 160);
    if (!m || !Net.ref) return;
    Net.ref.child('chat').push({ n: playerName(), m, t: SV() }).catch(permError);
  }
  function addChat(c) {
    if (!c || !c.m) return;
    const el = $('chatList');
    const d = document.createElement('div');
    d.innerHTML = `<b>${esc(c.n)}:</b> ${esc(c.m)}`;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
    if ($('side').hidden && Date.now() - Net.enteredAt > 3000) toast(`💬 ${c.n}: ${c.m}`);
  }

  function leaveCurrent(silent) {
    stopTicker();
    if (mode === 'online' && Net.ref) {
      const ref = Net.ref;
      if (isHost && g) {
        const i = g.seats.findIndex(s => s && s.id === myId);
        if (i >= 0) { if (['lobby', 'waiting', 'over'].includes(g.phase) || !g.seats[i].inHand) g.seats[i] = null; else g.seats[i].leave = true; }
        publish();
        const others = Object.keys(Net.players).filter(id => id !== myId && Net.players[id] && Net.players[id].conn).sort();
        if (others.length) ref.child('host').set(others[0]).catch(() => {});
        else ref.update({ status: 'ended' }).catch(() => {});
      }
      Net.subs.forEach(f => f()); Net.hostSubs.forEach(f => f());
      Net.subs = []; Net.hostSubs = [];
      ref.child('players/' + myId + '/conn').onDisconnect().cancel().catch(() => {});
      ref.child('players/' + myId).remove().catch(() => {});
      clearInterval(Net.hostCheck);
      Net.ref = null; Net.code = null; Net.pub = null; Net.priv = null; Net.host = null;
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* file:// */ }
    }
    mode = null; g = null; isHost = false; mySeat = -1; lastView = null; lastLogKey = ''; pendingSeq = -1;
    Scene3D.reset();
    if (!silent) exitGameUI();
  }

  // ---------- tampilan ----------
  function currentView() {
    if (authoritative()) return g;
    if (mode !== 'online' || !Net.pub) return null;
    const v = Net.pub;
    const i = v.seats.findIndex(s => s && s.id === myId);
    if (i >= 0 && Net.priv && Net.priv.h === v.hand && Array.isArray(Net.priv.c) && !v.seats[i].shown) v.seats[i].cards = Net.priv.c.slice();
    return v;
  }

  function enterGameUI() {
    showOverlay(null);
    $('topbar').hidden = false;
    $('chatBox').hidden = mode !== 'online';
    $('infoRoom').hidden = mode !== 'online';
    if (mode === 'online') $('infoRoom').textContent = '🔗 ' + Net.code;
    $('logList').innerHTML = '';
    $('side').hidden = window.innerWidth < 900 || !store.get('pk_side', false);
  }
  function exitGameUI() {
    ['topbar', 'actions', 'banner', 'myHand', 'side', 'lobbyPanel'].forEach(id => { $(id).hidden = true; });
    showOverlay('menuCard');
    if (activeTab === 'online') refreshRooms();
  }

  function render() {
    const v = currentView();
    if (!v) {
      if (mode === 'online') { $('lobbyPanel').hidden = true; $('actions').hidden = true; }
      return;
    }
    mySeat = v.seats.findIndex(s => s && s.id === myId);
    if (pendingSeq >= 0 && pendingSeq !== v.seq) pendingSeq = -1;
    Scene3D.update(v, mySeat);
    updateHUD(v);
    playSounds(v, lastView);
    lastView = { hand: v.hand, board: v.board.length, seq: v.seq, toAct: v.toAct, phase: v.phase, lasts: v.seats.map(s => (s ? s.last : null)) };
  }

  function legalFor(v) {
    if (mySeat < 0 || v.toAct !== mySeat || pendingSeq === v.seq) return null;
    return E.legal(v, mySeat);
  }

  function updateHUD(v) {
    $('infoHand').textContent = v.hand ? `Hand #${v.hand}` : 'Lobby';
    $('infoBlinds').textContent = `Blind ${fmt(v.sb)}/${fmt(v.bb)}`;
    $('infoPot').textContent = `Pot ${fmt(v.results ? v.results.reduce((a, r) => a + r.amount, 0) : E.potTotal(v))}`;

    // aksi
    const L = legalFor(v);
    $('actions').hidden = !L;
    if (L) {
      $('btnCall').innerHTML = L.canCheck ? 'Check <kbd>C</kbd>' : `Call ${fmt(L.toCall)}${L.toCall >= L.stack ? ' (all-in)' : ''} <kbd>C</kbd>`;
      $('btnFold').disabled = false;
      $('raiseBox').hidden = !L.canRaise;
      $('btnRaise').hidden = !L.canRaise;
      if (L.canRaise) {
        const r = $('raiseRange'), n = $('raiseNum');
        r.min = n.min = L.minTo; r.max = n.max = L.maxTo; r.step = 1;
        if (raiseSeq !== v.seq) { raiseSeq = v.seq; setRaise(L.minTo); }
        updateRaiseLabel(v, L);
      }
    }

    // info tangan sendiri
    const me = mySeat >= 0 ? v.seats[mySeat] : null;
    let hn = '';
    if (me && me.inHand && me.cards.length === 2 && me.cards[0] >= 0 && !me.folded) {
      if (v.board.length >= 3) hn = E.handName(E.evaluate(me.cards.concat(v.board)));
      else {
        const [a, b] = me.cards, ra = a >> 2, rb = b >> 2;
        hn = ra === rb ? `Pocket ${E.RANK_NAME[ra]}` : `${E.RANK_NAME[Math.max(ra, rb)]}-${E.RANK_NAME[Math.min(ra, rb)]}${(a & 3) === (b & 3) ? ' suited' : ''}`;
      }
    }
    $('myHand').hidden = !hn;
    $('myHand').textContent = hn ? '🂠 ' + hn : '';

    // banner hasil
    const ban = $('banner');
    if (v.phase === 'showdown' && v.results) {
      const lines = v.results.filter(r => !r.ret).map(r => {
        const who = r.winners.map(i => (v.seats[i] ? (i === mySeat ? 'Kamu' : v.seats[i].name) : '?')).join(' & ');
        return `${esc(who)} menang ${fmt(r.amount)}${r.hand ? ' — ' + esc(r.hand) : ''}`;
      });
      const html = lines.map(l => `<div>${l}</div>`).join('');
      if (ban.innerHTML !== html) ban.innerHTML = html;
      ban.hidden = !lines.length;
    } else if (v.phase === 'waiting') {
      ban.innerHTML = '<div>Menunggu pemain lain…</div>'; ban.hidden = false;
    } else ban.hidden = true;

    // log
    const key = v.log.length + '|' + (v.log[v.log.length - 1] || '');
    if (key !== lastLogKey) {
      lastLogKey = key;
      $('logList').innerHTML = v.log.map(l => `<div class="${l.startsWith('—') ? 'h' : ''}">${esc(l)}</div>`).join('');
      $('logList').scrollTop = 1e9;
    }

    renderLobby(v);
    renderOver(v, me);
  }

  function renderLobby(v) {
    const show = mode === 'online' && v.phase === 'lobby';
    $('lobbyPanel').hidden = !show;
    if (!show) return;
    $('lpCode').textContent = Net.code;
    const host = authoritative();
    $('lpHost').hidden = !host; $('lpWait').hidden = host;
    const seated = v.seats.filter(Boolean).length;
    $('btnStart').disabled = seated < 2;
    $('btnAddBot').disabled = seated >= 6;
    const rows = v.seats.map((s, i) => {
      if (!s) return `<div class="lpSeat empty">Kursi ${i + 1} kosong</div>`;
      const tag = s.bot ? `<small>🤖 Bot ${LEVEL_NAME[s.bot]}</small>` : s.id === Net.host ? '<small>👑 Host</small>' : s.away ? '<small>offline</small>' : '<small>👤 Pemain</small>';
      const rm = host && s.bot ? `<button data-rm="${i}">✕</button>` : '';
      return `<div class="lpSeat"><span>${esc(s.name)}${s.id === myId ? ' (kamu)' : ''}</span><span>${tag} ${rm}</span></div>`;
    }).join('');
    const spectators = Object.keys(Net.players).filter(id => Net.players[id].conn && !v.seats.some(s => s && s.id === id)).length;
    const html = rows + (spectators ? `<div class="muted" style="text-align:center;font-size:12px">${spectators} penonton</div>` : '');
    if ($('lpSeats').innerHTML !== html) $('lpSeats').innerHTML = html;
  }

  function renderOver(v, me) {
    if (v.phase === 'over') {
      if (overShown) return;
      overShown = true;
      const w = v.seats[v.winner];
      $('overTitle').textContent = w && w.id === myId ? '🏆 Kamu Juara!' : `🏆 ${w ? w.name : '?'} Juara`;
      $('overText').textContent = w && w.id === myId ? 'Semua chip di meja jadi milikmu.' : 'Permainan selesai.';
      const btns = [];
      if (mode === 'local') btns.push(['▶ Main lagi', 'primary', () => startLocal(localCfg.cfg, localCfg.nBots, localCfg.level)]);
      else if (authoritative()) btns.push(['↺ Kembali ke lobby', 'primary', () => { E.resetGame(g); overShown = false; commit(); showOverlay(null); }]);
      else btns.push(['Tutup (menunggu host)', '', () => showOverlay(null)]);
      btns.push(['Menu utama', '', () => leaveCurrent()]);
      setOverBtns(btns);
      if (w && w.id === myId) Snd.win();
      showOverlay('overCard');
      return;
    }
    if (overShown && v.phase !== 'over') { overShown = false; if (!$('overCard').hidden) showOverlay(null); }
    if (mode === 'local' && me && me.stack <= 0 && v.phase === 'showdown' && !bustShown) {
      bustShown = true;
      $('overTitle').textContent = '💸 Chip kamu habis';
      $('overText').textContent = 'Kamu tersingkir dari meja.';
      setOverBtns([
        ['▶ Main lagi', 'primary', () => startLocal(localCfg.cfg, localCfg.nBots, localCfg.level)],
        ['👀 Tonton bot sampai selesai', '', () => { watchBots = true; showOverlay(null); }],
        ['Menu utama', '', () => leaveCurrent()],
      ]);
      showOverlay('overCard');
    }
  }
  function setOverBtns(list) {
    const box = $('overBtns'); box.innerHTML = '';
    list.forEach(([label, cls, fn]) => {
      const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls + ' wide'; else b.className = 'wide';
      b.onclick = fn; box.appendChild(b);
    });
  }

  function playSounds(v, p) {
    if (!p) return;
    if (v.hand !== p.hand && v.phase === 'preflop') {
      const n = v.seats.filter(s => s && s.inHand).length * 2;
      for (let k = 0; k < n; k++) Snd.card(k * 0.1);
    } else if (v.hand === p.hand && v.board.length > p.board) {
      for (let k = 0; k < v.board.length - p.board; k++) Snd.card(k * 0.16);
    }
    if (v.hand === p.hand) {
      v.seats.forEach((s, i) => {
        if (!s || s.last === p.lasts[i] || !s.last) return;
        if (s.last === 'Check') Snd.knock();
        else if (s.last === 'Fold') Snd.fold();
        else if (!['SB', 'BB'].includes(s.last)) Snd.chip();
      });
    }
    if (v.toAct === mySeat && mySeat >= 0 && (p.toAct !== mySeat || p.seq !== v.seq)) Snd.ding();
    if (v.phase === 'showdown' && p.phase !== 'showdown' && v.results) {
      const iWon = v.results.some(r => !r.ret && r.winners.includes(mySeat));
      if (iWon) Snd.win(); else Snd.chip(0.3);
    }
  }

  // ---------- kontrol raise ----------
  function currentLegal() { const v = currentView(); return v ? legalFor(v) : null; }
  function setRaise(x) {
    const L = currentLegal(); if (!L) return;
    const v = currentView();
    x = Math.round(x);
    if (x < L.maxTo && v.bb) x = Math.round(x / v.bb) * v.bb || x;
    x = Math.max(L.minTo, Math.min(L.maxTo, x));
    $('raiseRange').value = x; $('raiseNum').value = x;
    updateRaiseLabel(v, L);
  }
  function updateRaiseLabel(v, L) {
    const x = +$('raiseNum').value || L.minTo;
    const verb = x >= L.maxTo ? 'All-in' : L.curBet === 0 ? 'Bet' : 'Raise ke';
    $('btnRaise').innerHTML = `${verb} ${fmt(x)} <kbd>R</kbd>`;
  }
  function preset(p) {
    const L = currentLegal(); if (!L) return;
    if (p === 'min') return setRaise(L.minTo);
    if (p === 'all') return setRaise(L.maxTo);
    const f = +p;
    setRaise(L.curBet + (L.pot + L.toCall) * f);
  }

  // ---------- event ----------
  let activeTab = store.get('pk_tab', 'bot');
  function setTab(t) {
    activeTab = t; store.set('pk_tab', t);
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $('tabBot').hidden = t !== 'bot'; $('tabOnline').hidden = t !== 'online';
    $('btnPlayBot').hidden = t !== 'bot'; $('btnCreate').hidden = t !== 'online';
    document.querySelectorAll('.onlineOnly').forEach(e => { e.hidden = t !== 'online'; });
    if (t === 'online') refreshRooms();
  }

  function bind() {
    $('nameIn').value = store.get('pk_name', '');
    $('nameIn').addEventListener('input', () => store.set('pk_name', $('nameIn').value.trim().slice(0, 16)));
    const saved = store.get('pk_opts', null);
    if (saved) Object.entries(saved).forEach(([id, val]) => { if ($(id)) $(id).value = val; });
    const saveOpts = () => store.set('pk_opts', Object.fromEntries(['optBots', 'optLevel', 'optStack', 'optBlind', 'optBlindUp', 'optTurn'].map(id => [id, $(id).value])));
    document.querySelectorAll('#menuCard select').forEach(s => s.addEventListener('change', saveOpts));
    document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    document.addEventListener('pointerdown', () => Snd.init(), { once: false });

    $('btnPlayBot').onclick = () => startLocal(readCfg(false), +$('optBots').value, +$('optLevel').value);
    $('btnCreate').onclick = () => createRoom();
    $('btnJoin').onclick = () => joinRoom($('joinCode').value);
    $('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom($('joinCode').value); });
    $('btnRefresh').onclick = refreshRooms;
    $('roomList').addEventListener('click', e => { const b = e.target.closest('[data-code]'); if (b) joinRoom(b.dataset.code); });

    $('btnLeave').onclick = () => {
      if (mode === 'local' && g && g.phase !== 'over' && !confirm('Keluar dari permainan?')) return;
      leaveCurrent();
    };
    $('btnLog').onclick = () => { $('side').hidden = !$('side').hidden; store.set('pk_side', !$('side').hidden); };
    $('btnSideClose').onclick = () => { $('side').hidden = true; store.set('pk_side', false); };
    const sndIcon = () => { $('btnSound').textContent = Snd.on ? '🔊' : '🔇'; };
    sndIcon();
    $('btnSound').onclick = () => { Snd.on = !Snd.on; store.set('pk_snd', Snd.on); sndIcon(); };
    const copyLink = () => {
      const url = location.origin + location.pathname + '?room=' + Net.code;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link undangan disalin!'), () => prompt('Salin link ini:', url));
    };
    $('infoRoom').onclick = copyLink;
    $('btnCopyLink').onclick = copyLink;

    $('btnFold').onclick = () => {
      const L = currentLegal();
      if (L && L.canCheck && !confirm('Kamu bisa check gratis. Tetap fold?')) return;
      sendAction('fold');
    };
    $('btnCall').onclick = () => { const L = currentLegal(); if (L) sendAction(L.canCheck ? 'check' : 'call'); };
    $('btnRaise').onclick = () => sendAction('raise', +$('raiseNum').value);
    $('raiseRange').addEventListener('input', e => setRaise(+e.target.value));
    $('raiseNum').addEventListener('change', e => setRaise(+e.target.value));
    document.querySelectorAll('.presets button').forEach(b => b.addEventListener('click', () => preset(b.dataset.p)));
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || $('actions').hidden) return;
      const k = e.key.toLowerCase();
      if (k === 'f') $('btnFold').click();
      else if (k === 'c' || k === ' ') { e.preventDefault(); $('btnCall').click(); }
      else if (k === 'r') $('btnRaise').click();
    });

    $('chatForm').addEventListener('submit', e => { e.preventDefault(); sendChat($('chatIn').value); $('chatIn').value = ''; });

    $('btnAddBot').onclick = () => {
      if (!authoritative() || g.phase !== 'lobby') return;
      const i = spreadSeat(g); if (i < 0) return;
      const used = new Set(g.seats.filter(Boolean).map(s => s.name));
      const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot ' + (i + 1);
      E.addPlayer(g, i, { id: 'bot' + Date.now().toString(36), name, bot: +$('lpBotLevel').value, style: 0.7 + Math.random() * 0.6 });
      commit();
    };
    $('lpSeats').addEventListener('click', e => {
      const b = e.target.closest('[data-rm]');
      if (!b || !authoritative() || g.phase !== 'lobby') return;
      g.seats[+b.dataset.rm] = null; commit();
    });
    $('btnStart').onclick = () => {
      if (!authoritative() || g.phase !== 'lobby') return;
      syncPlayers(true);
      g.phase = 'waiting';
      if (!E.startHand(g)) { g.phase = 'lobby'; toast('Butuh minimal 2 pemain/bot.'); }
      commit();
    };

    window.addEventListener('beforeunload', () => {
      if (mode === 'online' && isHost && Net.ref) {
        const others = Object.keys(Net.players).filter(id => id !== myId && Net.players[id] && Net.players[id].conn).sort();
        if (others.length) Net.ref.child('host').set(others[0]);
      }
    });
  }

  // ---------- start ----------
  Scene3D.init($('c'), { now, plates: $('plates') });
  bind();
  setTab(activeTab);
  showOverlay('menuCard');
  const qRoom = new URLSearchParams(location.search).get('room');
  if (qRoom) { setTab('online'); $('joinCode').value = qRoom.toUpperCase(); joinRoom(qRoom); }
})();
