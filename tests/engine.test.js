// Jalankan: node tests/engine.test.js
'use strict';
const E = require('../engine.js');
const assert = require('assert');

const R = { '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, T: 8, J: 9, Q: 10, K: 11, A: 12 };
const S = { s: 0, h: 1, d: 2, c: 3 };
const cs = str => str.split(' ').map(t => R[t[0]] * 4 + S[t[1]]);
const cat = str => E.handCategory(E.evaluate(cs(str)));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };

console.log('Evaluator');
test('kategori', () => {
  assert.strictEqual(cat('As Ks Qs Js Ts 2d 3c'), 8);
  assert.strictEqual(cat('5s 4s 3s 2s As Kd Kc'), 8);
  assert.strictEqual(cat('9h 9d 9s 9c 2d 3c 4h'), 7);
  assert.strictEqual(cat('9h 9d 9s 2c 2d 3c 3h'), 6);
  assert.strictEqual(cat('9h 9d 9s 2c 2d 2h 3h'), 6);
  assert.strictEqual(cat('2h 7h 9h Jh Kh Ad Ac'), 5);
  assert.strictEqual(cat('5d 4s 3h 2c As Kd Qc'), 4);
  assert.strictEqual(cat('Td 9s 8h 7c 6s 2d 2c'), 4);
  assert.strictEqual(cat('Qd Qs Qh 7c 6s 2d 3c'), 3);
  assert.strictEqual(cat('Qd Qs 7h 7c 6s 6d 3c'), 2);
  assert.strictEqual(cat('Qd Qs 7h 8c 6s 2d 3c'), 1);
  assert.strictEqual(cat('Qd Js 7h 8c 6s 2d 3c'), 0);
});
test('perbandingan kicker', () => {
  const a = E.evaluate(cs('As Ad Kc 9h 5s 3d 2c')), b = E.evaluate(cs('As Ad Qc 9h 5s 3d 2c'));
  assert(a > b);
  const w = E.evaluate(cs('5d 4s 3h 2c As 9d 9c')), s6 = E.evaluate(cs('6d 5s 4h 3c 2s 9d 9c'));
  assert(s6 > w, 'straight 6-high > wheel');
  const tp1 = E.evaluate(cs('Kd Ks 7h 7c 6s 6d Ac')), tp2 = E.evaluate(cs('Kd Ks 7h 7c 6s 6d Qc'));
  assert(tp1 > tp2, 'dua pasang kicker dari pasangan ketiga');
  assert.strictEqual(E.handName(E.evaluate(cs('As Ks Qs Js Ts 2d 3c'))), 'Royal Flush');
  assert.strictEqual(E.handName(E.evaluate(cs('9h 9d 9s 2c 2d 3c 3h'))), 'Full House 9 & 3');
});
test('bestFive', () => {
  const b = E.bestFive(cs('As Ks Qs Js Ts 2d 3c'));
  assert.deepStrictEqual(b.sort(), cs('As Ks Qs Js Ts').sort());
});
test('equity masuk akal', () => {
  const aa = E.equity(cs('As Ad'), [], 1, 3000), s72 = E.equity(cs('7s 2d'), [], 1, 3000);
  assert(aa > 0.8 && aa < 0.9, 'AA ~85%: ' + aa);
  assert(s72 > 0.28 && s72 < 0.4, '72o ~35%: ' + s72);
});

console.log('Side pot');
test('pot utama + side pot', () => {
  const g = E.createGame({ stack: 1000 });
  ['A', 'B', 'C'].forEach((n, i) => E.addPlayer(g, i, { id: n, name: n }));
  g.seats[0].total = 100; g.seats[1].total = 300; g.seats[2].total = 300;
  g.seats.forEach(s => { if (s) { s.inHand = true; s.folded = false; } });
  const pots = E.buildPots(g);
  assert.deepStrictEqual(pots, [{ amount: 300, elig: [0, 1, 2] }, { amount: 400, elig: [1, 2] }]);
  g.seats[2].folded = true; g.seats[2].total = 500;
  const p2 = E.buildPots(g);
  assert.strictEqual(p2.reduce((a, p) => a + p.amount, 0), 900);
  assert.deepStrictEqual(p2[p2.length - 1].elig, [1]);
});

console.log('Alur permainan');
test('heads-up: dealer = SB dan bertindak pertama preflop', () => {
  const g = E.createGame({ sb: 10, bb: 20, stack: 1000 });
  E.addPlayer(g, 0, { id: 'a', name: 'A' }); E.addPlayer(g, 3, { id: 'b', name: 'B' });
  E.startHand(g);
  assert.strictEqual(g.sbSeat, g.dealer);
  assert.strictEqual(g.toAct, g.dealer);
  assert.strictEqual(E.act(g, g.toAct, 'call'), null);
  assert.strictEqual(g.toAct, g.bbSeat, 'BB dapat opsi');
  assert.strictEqual(E.act(g, g.toAct, 'check'), null);
  assert.strictEqual(g.await, 'street');
  E.nextStreet(g);
  assert.strictEqual(g.board.length, 3);
  assert.strictEqual(g.toAct, g.bbSeat, 'postflop non-dealer duluan');
});
test('semua fold ke BB', () => {
  const g = E.createGame({ sb: 10, bb: 20, stack: 1000 });
  for (let i = 0; i < 4; i++) E.addPlayer(g, i, { id: 'p' + i, name: 'P' + i });
  E.startHand(g);
  while (g.toAct >= 0) E.act(g, g.toAct, 'fold');
  assert.strictEqual(g.phase, 'showdown');
  assert.strictEqual(g.results[0].winners[0], g.bbSeat);
  assert.strictEqual(g.seats[g.bbSeat].stack, 1010);
});
test('all-in runout menutup ke showdown', () => {
  const g = E.createGame({ sb: 10, bb: 20, stack: 1000 });
  for (let i = 0; i < 3; i++) E.addPlayer(g, i, { id: 'p' + i, name: 'P' + i });
  E.startHand(g);
  while (g.toAct >= 0) E.act(g, g.toAct, 'allin');
  let guard = 0;
  while (g.await === 'street' && guard++ < 10) E.nextStreet(g);
  assert.strictEqual(g.phase, 'showdown');
  assert.strictEqual(g.board.length, 5);
  assert.strictEqual(g.seats.reduce((a, s) => a + (s ? s.stack : 0), 0), 3000);
});
test('raise minimum & reopen action', () => {
  const g = E.createGame({ sb: 10, bb: 20, stack: 1000 });
  for (let i = 0; i < 3; i++) E.addPlayer(g, i, { id: 'p' + i, name: 'P' + i });
  E.startHand(g);
  const first = g.toAct;
  E.act(g, first, 'raise', 30); // di-clamp ke minimum 40
  assert.strictEqual(g.curBet, 40);
  assert.strictEqual(g.minRaise, 20);
  E.act(g, g.toAct, 'raise', 100);
  assert.strictEqual(g.minRaise, 60);
  E.act(g, g.toAct, 'call');
  assert.strictEqual(g.toAct, first, 'pemain awal harus merespons raise');
});

console.log('Simulasi bot');
test('40 game antar bot sampai selesai: chip tetap, tanpa macet', () => {
  let totalHands = 0;
  for (let game = 0; game < 40; game++) {
    const n = 2 + (game % 5);
    const g = E.createGame({ sb: 5, bb: 10, stack: 500, blindUp: 8 });
    for (let i = 0; i < n; i++) E.addPlayer(g, i, { id: 'b' + i, name: 'Bot' + i, bot: 1 + (i % 3), style: 0.7 + (i % 4) * 0.2 });
    const chips = n * 500;
    let steps = 0;
    while (g.phase !== 'over' && totalHands < 2000 * (game + 1) / 40 + 200) {
      if (!E.startHand(g)) break;
      totalHands++;
      while (g.phase !== 'showdown') {
        if (++steps > 1e6) throw new Error('macet');
        if (g.await === 'street') { E.nextStreet(g); continue; }
        const d = E.botDecide(g, g.toAct);
        const err = E.act(g, g.toAct, d.type, d.amount);
        assert.strictEqual(err, null, err);
      }
      const sum = g.seats.reduce((a, s) => a + (s ? s.stack : 0), 0);
      assert.strictEqual(sum, chips, 'chip bocor di hand ' + g.hand);
      g.seats.forEach(s => s && assert(s.stack >= 0));
    }
  }
  console.log('    (' + totalHands + ' hand)');
});
test('publicState menyembunyikan kartu', () => {
  const g = E.createGame({});
  E.addPlayer(g, 0, { id: 'a', name: 'A' }); E.addPlayer(g, 1, { id: 'b', name: 'B' });
  E.startHand(g);
  const p = E.publicState(g);
  assert.deepStrictEqual(p.seats[0].cards, [-1, -1]);
  assert.strictEqual(p.used, undefined);
});

console.log(`\n${passed} test lulus.`);
