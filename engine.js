/* Poker 3D — mesin Texas Hold'em No-Limit (logika murni, tanpa DOM).
   Dipakai di browser (window.PokerEngine) dan di test Node (module.exports). */
(function (root) {
  'use strict';

  const MAX_SEATS = 6;
  const RANK_NAME = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const SUIT_SYM = ['♠', '♥', '♦', '♣'];
  const BLIND_MULT = [1, 2, 3, 4, 6, 8, 10, 15, 20, 30, 40, 60, 80, 100, 150, 200, 300, 500];
  const C5 = 1048576, C4 = 65536, C3 = 4096; // 16^5, 16^4, 16^3

  // kartu = int 0..51 → rank = c >> 2 (0 = '2' … 12 = 'A'), suit = c & 3
  const cardName = c => RANK_NAME[c >> 2] + SUIT_SYM[c & 3];
  const fmt = n => Math.round(n).toLocaleString('id-ID');

  function randInt(n) {
    const cr = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
    if (cr) { const a = new Uint32Array(1); cr.getRandomValues(a); return a[0] % n; }
    return Math.floor(Math.random() * n);
  }

  // ---------- evaluasi tangan ----------
  function straightTop(mask) {
    const ext = (mask << 1) | ((mask >> 12) & 1); // As juga dihitung sebagai kartu terendah
    for (let hi = 13; hi >= 4; hi--) if (((ext >> (hi - 4)) & 31) === 31) return hi - 1;
    return -1;
  }
  function topBits(mask, n) {
    const out = [];
    for (let r = 12; r >= 0 && out.length < n; r--) if ((mask >> r) & 1) out.push(r);
    return out;
  }
  function score(cat, ks) {
    let s = cat;
    for (let i = 0; i < 5; i++) s = s * 16 + ((ks[i] === undefined ? -1 : ks[i]) + 1);
    return s;
  }

  /** Skor 5–7 kartu; makin besar makin kuat. */
  function evaluate(cards) {
    const cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const sm = [0, 0, 0, 0], sc = [0, 0, 0, 0];
    let mask = 0;
    for (const c of cards) { const r = c >> 2, s = c & 3; cnt[r]++; sm[s] |= 1 << r; sc[s]++; mask |= 1 << r; }
    let fs = -1;
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) fs = s;
    if (fs >= 0) { const t = straightTop(sm[fs]); if (t >= 0) return score(8, [t]); }
    const quads = [], trips = [], pairs = [];
    for (let r = 12; r >= 0; r--) {
      if (cnt[r] === 4) quads.push(r); else if (cnt[r] === 3) trips.push(r); else if (cnt[r] === 2) pairs.push(r);
    }
    if (quads.length) return score(7, [quads[0], topBits(mask & ~(1 << quads[0]), 1)[0]]);
    if (trips.length && (trips.length > 1 || pairs.length)) {
      const p = Math.max(trips.length > 1 ? trips[1] : -1, pairs.length ? pairs[0] : -1);
      return score(6, [trips[0], p]);
    }
    if (fs >= 0) return score(5, topBits(sm[fs], 5));
    const st = straightTop(mask);
    if (st >= 0) return score(4, [st]);
    if (trips.length) return score(3, [trips[0]].concat(topBits(mask & ~(1 << trips[0]), 2)));
    if (pairs.length >= 2) {
      const a = pairs[0], b = pairs[1];
      return score(2, [a, b].concat(topBits(mask & ~(1 << a) & ~(1 << b), 1)));
    }
    if (pairs.length) return score(1, [pairs[0]].concat(topBits(mask & ~(1 << pairs[0]), 3)));
    return score(0, topBits(mask, 5));
  }
  const handCategory = s => Math.floor(s / C5);

  function handName(s) {
    const cat = handCategory(s);
    const k1 = RANK_NAME[Math.floor(s / C4) % 16 - 1], k2 = RANK_NAME[Math.floor(s / C3) % 16 - 1];
    switch (cat) {
      case 8: return k1 === 'A' ? 'Royal Flush' : `Straight Flush (${k1} tinggi)`;
      case 7: return `Four of a Kind ${k1}`;
      case 6: return `Full House ${k1} & ${k2}`;
      case 5: return `Flush (${k1} tinggi)`;
      case 4: return `Straight (${k1} tinggi)`;
      case 3: return `Three of a Kind ${k1}`;
      case 2: return `Dua Pasang ${k1} & ${k2}`;
      case 1: return `Sepasang ${k1}`;
      default: return `Kartu Tinggi ${k1}`;
    }
  }

  /** 5 kartu terbaik dari 5–7 kartu (untuk highlight di showdown). */
  function bestFive(cards) {
    if (cards.length <= 5) return cards.slice();
    let best = -1, pick = null;
    const n = cards.length;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const five = cards.filter((_, i) => i !== a && i !== b);
      if (n === 7) { const s = evaluate(five); if (s > best) { best = s; pick = five; } continue; }
      for (let x = 0; x < five.length; x++) {
        const f = five.filter((_, i) => i !== x);
        const s = evaluate(f); if (s > best) { best = s; pick = f; }
      }
    }
    return pick;
  }

  /** Estimasi equity Monte Carlo melawan nOpp tangan acak. */
  function equity(hole, board, nOpp, iters, rand) {
    rand = rand || Math.random;
    const used = new Set(hole.concat(board));
    const deck = [];
    for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
    const need = 5 - board.length;
    nOpp = Math.max(1, Math.min(nOpp, Math.floor((deck.length - need) / 2)));
    const take = need + nOpp * 2;
    let won = 0;
    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < take; k++) {
        const j = k + Math.floor(rand() * (deck.length - k));
        const t = deck[k]; deck[k] = deck[j]; deck[j] = t;
      }
      const b = board.concat(deck.slice(0, need));
      const my = evaluate(hole.concat(b));
      let ties = 0, lose = false;
      for (let o = 0; o < nOpp; o++) {
        const sc = evaluate([deck[need + o * 2], deck[need + o * 2 + 1]].concat(b));
        if (sc > my) { lose = true; break; }
        if (sc === my) ties++;
      }
      if (!lose) won += 1 / (ties + 1);
    }
    return won / iters;
  }

  // ---------- state permainan ----------
  function createGame(cfg) {
    cfg = cfg || {};
    const c = {
      sb: cfg.sb || 10, bb: cfg.bb || 20, stack: cfg.stack || 2000,
      turn: cfg.turn || 0, blindUp: cfg.blindUp || 0,
    };
    return {
      v: 0, seq: 0, cfg: c, seats: new Array(MAX_SEATS).fill(null),
      hand: 0, phase: 'lobby', level: 0, sb: c.sb, bb: c.bb,
      dealer: -1, sbSeat: -1, bbSeat: -1, toAct: -1, curBet: 0, minRaise: 0, raises: 0,
      board: [], used: [], results: null, await: null, awaitAt: 0, deadline: 0, runout: false,
      winner: -1, log: [],
    };
  }

  function freshSeat(s) {
    Object.assign(s, {
      bet: 0, total: 0, folded: true, inHand: false, allIn: false, acted: false,
      cards: [], last: '', shown: false, win: 0, hand: '',
    });
    return s;
  }
  function addPlayer(g, i, p) {
    g.seats[i] = freshSeat({
      id: p.id, name: String(p.name || 'Pemain').slice(0, 16), bot: p.bot || 0, style: p.style || 1,
      stack: g.cfg.stack, away: false, leave: false, out: false,
    });
    return g.seats[i];
  }
  const freeSeat = g => g.seats.findIndex(s => !s);

  function log(g, m) {
    g.log.push(m);
    if (g.log.length > 80) g.log.splice(0, g.log.length - 80);
  }

  const isLive = s => !!(s && s.inHand && !s.folded);
  const canAct = s => isLive(s) && !s.allIn;
  function liveIdx(g) { const r = []; g.seats.forEach((s, i) => { if (isLive(s)) r.push(i); }); return r; }
  function nextIdx(g, from, pred) {
    for (let k = 1; k <= MAX_SEATS; k++) {
      const i = (((from + k) % MAX_SEATS) + MAX_SEATS) % MAX_SEATS;
      if (g.seats[i] && pred(g.seats[i], i)) return i;
    }
    return -1;
  }
  const potTotal = g => g.seats.reduce((a, s) => a + (s ? s.total : 0), 0);
  const potCollected = g => g.seats.reduce((a, s) => a + (s ? s.total - s.bet : 0), 0);

  function drawCard(g) {
    // tidak ada urutan dek tersimpan: kartu diambil acak dari sisa kartu saat dibagikan,
    // jadi state yang tersimpan tidak pernah membocorkan kartu board berikutnya.
    const used = new Set(g.used);
    const free = [];
    for (let c = 0; c < 52; c++) if (!used.has(c)) free.push(c);
    const c = free[randInt(free.length)];
    g.used.push(c);
    return c;
  }
  function put(s, x) {
    x = Math.max(0, Math.min(x, s.stack));
    s.stack -= x; s.bet += x; s.total += x;
    if (s.stack === 0) s.allIn = true;
  }

  function startHand(g) {
    g.seats.forEach((s, i) => { if (s && s.leave) g.seats[i] = null; });
    const alive = [];
    g.seats.forEach((s, i) => { if (s && s.stack > 0) alive.push(i); });
    g.seq++;
    if (alive.length < 2) {
      g.await = null; g.toAct = -1; g.results = null;
      if (g.hand > 0 && alive.length === 1) {
        g.phase = 'over'; g.winner = alive[0];
        log(g, `🏆 ${g.seats[alive[0]].name} memenangkan permainan!`);
      } else g.phase = 'waiting';
      return false;
    }
    g.hand++;
    if (g.cfg.blindUp > 0) {
      const lvl = Math.min(BLIND_MULT.length - 1, Math.floor((g.hand - 1) / g.cfg.blindUp));
      if (lvl !== g.level) { g.level = lvl; log(g, `⬆ Blind naik ke ${fmt(g.cfg.sb * BLIND_MULT[lvl])}/${fmt(g.cfg.bb * BLIND_MULT[lvl])}`); }
    }
    g.sb = g.cfg.sb * BLIND_MULT[g.level];
    g.bb = g.cfg.bb * BLIND_MULT[g.level];
    g.seats.forEach(s => {
      if (!s) return;
      freshSeat(s);
      s.inHand = s.stack > 0; s.folded = !s.inHand; s.out = !s.inHand;
    });
    g.board = []; g.used = []; g.results = null; g.raises = 0; g.await = null; g.awaitAt = 0; g.runout = false;
    g.phase = 'preflop';
    const inH = s => s.inHand;
    g.dealer = nextIdx(g, g.dealer, inH);
    const hu = alive.length === 2;
    g.sbSeat = hu ? g.dealer : nextIdx(g, g.dealer, inH);
    g.bbSeat = nextIdx(g, g.sbSeat, inH);
    log(g, `— Hand #${g.hand} · dealer ${g.seats[g.dealer].name} —`);
    const sbS = g.seats[g.sbSeat], bbS = g.seats[g.bbSeat];
    put(sbS, g.sb); sbS.last = sbS.allIn ? 'All-in' : 'SB';
    put(bbS, g.bb); bbS.last = bbS.allIn ? 'All-in' : 'BB';
    g.curBet = g.bb; g.minRaise = g.bb;
    for (let r = 0; r < 2; r++) {
      let i = g.sbSeat;
      for (let k = 0; k < alive.length; k++) { g.seats[i].cards.push(drawCard(g)); i = nextIdx(g, i, inH); }
    }
    setTurn(g, g.bbSeat);
    return true;
  }

  function setTurn(g, from) {
    const live = liveIdx(g);
    if (live.length === 1) return winUncontested(g, live[0]);
    const actors = g.seats.filter(canAct);
    let n = -1;
    if (actors.length > 1 || (actors.length === 1 && actors[0].bet < g.curBet)) {
      n = nextIdx(g, from, s => canAct(s) && (!s.acted || s.bet < g.curBet));
    }
    g.deadline = 0;
    if (n >= 0) { g.toAct = n; g.await = null; return; }
    g.toAct = -1; g.await = 'street'; g.awaitAt = 0;
    if (actors.length <= 1 && g.phase !== 'river') {
      // semua all-in: buka kartu lalu jalankan board sampai habis
      live.forEach(j => { g.seats[j].shown = true; });
      g.runout = true;
    }
  }

  function legal(g, i) {
    const s = g.seats[i];
    if (!s || g.toAct !== i || g.await || !['preflop', 'flop', 'turn', 'river'].includes(g.phase)) return null;
    const toCall = Math.min(g.curBet - s.bet, s.stack);
    const maxTo = s.bet + s.stack;
    const others = g.seats.filter((o, j) => j !== i && canAct(o)).length;
    return {
      toCall, canCheck: g.curBet <= s.bet, canRaise: maxTo > g.curBet && others > 0,
      minTo: Math.min(g.curBet + g.minRaise, maxTo), maxTo, pot: potTotal(g), curBet: g.curBet, bet: s.bet, stack: s.stack,
    };
  }

  /** Jalankan aksi; return null jika sukses, atau pesan error. amount = total taruhan (raise ke). */
  function act(g, i, type, amount) {
    const L = legal(g, i);
    if (!L) return 'Bukan giliranmu';
    const s = g.seats[i];
    if (type === 'allin') {
      if (L.canRaise) { type = 'raise'; amount = L.maxTo; } else type = L.canCheck ? 'check' : 'call';
    }
    if (type === 'call' && L.toCall <= 0) type = 'check';
    if (type === 'raise' && !L.canRaise) type = L.canCheck ? 'check' : 'call';
    switch (type) {
      case 'fold':
        s.folded = true; s.last = 'Fold'; log(g, `${s.name} fold`);
        break;
      case 'check':
        if (!L.canCheck) return 'Tidak bisa check';
        s.last = 'Check'; log(g, `${s.name} check`);
        break;
      case 'call':
        put(s, L.toCall); s.last = s.allIn ? 'All-in' : 'Call';
        log(g, `${s.name} call ${fmt(L.toCall)}${s.allIn ? ' (all-in)' : ''}`);
        break;
      case 'raise': {
        let to = Math.floor(Number(amount) || 0);
        to = Math.max(L.minTo, Math.min(L.maxTo, to));
        if (to <= g.curBet) { put(s, L.toCall); s.last = s.allIn ? 'All-in' : 'Call'; log(g, `${s.name} call ${fmt(L.toCall)}`); break; }
        const inc = to - g.curBet, wasBet = g.curBet === 0;
        put(s, to - s.bet);
        if (inc >= g.minRaise) {
          g.minRaise = inc;
          g.seats.forEach((o, j) => { if (o && j !== i) o.acted = false; });
        }
        g.curBet = to; g.raises++;
        s.last = s.allIn ? 'All-in' : wasBet ? 'Bet' : 'Raise';
        log(g, `${s.name} ${s.allIn ? 'all-in' : wasBet ? 'bet' : 'raise ke'} ${fmt(to)}`);
        break;
      }
      default: return 'Aksi tidak dikenal';
    }
    s.acted = true;
    g.seq++;
    setTurn(g, i);
    return null;
  }

  function nextStreet(g) {
    if (g.await !== 'street') return;
    g.seats.forEach(s => { if (!s) return; s.bet = 0; s.acted = false; if (canAct(s)) s.last = ''; });
    g.curBet = 0; g.minRaise = g.bb; g.raises = 0; g.seq++;
    if (g.phase === 'river') return showdown(g);
    const n = g.phase === 'preflop' ? 3 : 1;
    for (let k = 0; k < n; k++) g.board.push(drawCard(g));
    g.phase = g.phase === 'preflop' ? 'flop' : g.phase === 'flop' ? 'turn' : 'river';
    const label = { flop: 'Flop', turn: 'Turn', river: 'River' }[g.phase];
    log(g, `${label}: ${g.board.map(cardName).join(' ')}`);
    setTurn(g, g.dealer);
  }

  function buildPots(g) {
    const xs = [];
    g.seats.forEach((s, i) => { if (s && s.total > 0) xs.push({ i, t: s.total, live: isLive(s) }); });
    const levels = [...new Set(xs.map(x => x.t))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const lv of levels) {
      let amount = 0; const elig = [];
      xs.forEach(x => { amount += Math.min(x.t, lv) - Math.min(x.t, prev); if (x.live && x.t >= lv) elig.push(x.i); });
      prev = lv;
      if (!amount) continue;
      const last = pots[pots.length - 1];
      if (last && (!elig.length || last.elig.join() === elig.join())) last.amount += amount;
      else pots.push({ amount, elig });
    }
    return pots;
  }

  function finishHand(g) {
    g.phase = 'showdown'; g.toAct = -1; g.await = 'next'; g.awaitAt = 0; g.deadline = 0; g.runout = false; g.seq++;
    g.seats.forEach(s => { if (s) s.bet = 0; });
  }

  function winUncontested(g, i) {
    const s = g.seats[i], amount = potTotal(g);
    s.stack += amount; s.win = amount;
    g.results = [{ amount, winners: [i], hand: '', best: [] }];
    log(g, `${s.name} memenangkan pot ${fmt(amount)}`);
    finishHand(g);
  }

  function showdown(g) {
    const live = liveIdx(g), sc = {};
    live.forEach(i => {
      const s = g.seats[i];
      sc[i] = evaluate(s.cards.concat(g.board));
      s.shown = true; s.hand = handName(sc[i]);
    });
    const pots = buildPots(g), results = [];
    const order = i => (i - g.dealer - 1 + MAX_SEATS * 2) % MAX_SEATS;
    pots.forEach(p => {
      let best = -1, winners = [];
      p.elig.forEach(i => { if (sc[i] > best) { best = sc[i]; winners = [i]; } else if (sc[i] === best) winners.push(i); });
      winners.sort((a, b) => order(a) - order(b));
      const share = Math.floor(p.amount / winners.length);
      let rem = p.amount - share * winners.length;
      winners.forEach(i => {
        const w = share + (rem > 0 ? 1 : 0); if (rem > 0) rem--;
        g.seats[i].stack += w; g.seats[i].win += w;
      });
      const ret = p.elig.length === 1 && pots.length > 1; // taruhan tak ter-call dikembalikan
      results.push({ amount: p.amount, winners, hand: ret ? '' : handName(best), best: ret ? [] : bestFive(g.seats[winners[0]].cards.concat(g.board)), ret });
      if (ret) log(g, `${fmt(p.amount)} dikembalikan ke ${g.seats[winners[0]].name}`);
      else log(g, `${winners.map(i => g.seats[i].name).join(' & ')} menang ${fmt(p.amount)} — ${handName(best)}`);
    });
    g.results = results;
    finishHand(g);
  }

  function resetGame(g) {
    g.seats.forEach((s, i) => {
      if (!s) return;
      if (s.leave) { g.seats[i] = null; return; }
      freshSeat(s); s.stack = g.cfg.stack; s.out = false;
    });
    Object.assign(g, {
      hand: 0, level: 0, sb: g.cfg.sb, bb: g.cfg.bb, phase: 'lobby', dealer: -1, sbSeat: -1, bbSeat: -1,
      toAct: -1, curBet: 0, board: [], used: [], results: null, await: null, winner: -1, runout: false,
    });
    g.seq++;
  }

  /** State untuk dipublikasikan: kartu tertutup diganti -1, daftar kartu terpakai dihapus. */
  function publicState(g) {
    const p = JSON.parse(JSON.stringify(g));
    delete p.used;
    p.seats.forEach(s => { if (s && !s.shown) s.cards = s.cards.map(() => -1); });
    return p;
  }

  // ---------- AI bot ----------
  function botDecide(g, i, rand) {
    rand = rand || Math.random;
    const s = g.seats[i], L = legal(g, i);
    if (!L) return null;
    const lvl = s.bot || 2, aggr = s.style || 1;
    const opp = Math.max(1, liveIdx(g).length - 1);
    let eq = equity(s.cards, g.board, opp, [0, 220, 450, 900][lvl], rand);
    eq = Math.max(0, Math.min(1, eq + (rand() - 0.5) * 2 * [0, 0.12, 0.06, 0.025][lvl]));
    const pot = L.pot, toCall = L.toCall, bb = g.bb;
    const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
    const str = eq * (opp + 1); // 1 = rata-rata terhadap jumlah lawan
    const raiseTo = f => {
      const add = Math.max(g.minRaise, Math.round(((pot + toCall) * f) / bb) * bb);
      return Math.max(L.minTo, Math.min(L.maxTo, g.curBet + add));
    };
    const r = rand();
    const canR = L.canRaise && g.raises < (lvl === 1 ? 2 : 4);

    if (canR && (eq > 0.8 || str > 2.3)) {
      if (lvl === 3 && toCall === 0 && g.phase !== 'preflop' && g.phase !== 'river' && r < 0.2) return { type: 'check' }; // slowplay
      if (eq > 0.88 && g.phase !== 'preflop' && r < 0.25) return { type: 'raise', amount: L.maxTo };
      return { type: 'raise', amount: raiseTo(0.55 + rand() * 0.5) };
    }
    if (canR && str > 1.5 && r < 0.5 * aggr) return { type: 'raise', amount: raiseTo(0.4 + rand() * 0.4) };
    if (toCall === 0) {
      if (canR && lvl >= 2 && g.phase !== 'preflop' && opp <= 2 && r < 0.12 * aggr) return { type: 'raise', amount: raiseTo(0.5) };
      return { type: 'check' };
    }
    let need = potOdds + [0, -0.07, 0.02, 0.04][lvl];
    if (lvl >= 2 && toCall > s.stack * 0.4) need += 0.08; // taruhan besar butuh tangan lebih kuat
    if (eq >= need) return { type: 'call' };
    if (canR && lvl >= 2 && r < 0.035 * aggr && toCall <= pot * 0.35) return { type: 'raise', amount: raiseTo(0.75) }; // bluff
    return { type: 'fold' };
  }

  const api = {
    MAX_SEATS, RANK_NAME, SUIT_SYM, BLIND_MULT, cardName,
    evaluate, handName, handCategory, bestFive, equity,
    createGame, addPlayer, freeSeat, startHand, legal, act, nextStreet, buildPots, resetGame,
    publicState, botDecide, potTotal, potCollected, isLive,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokerEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
