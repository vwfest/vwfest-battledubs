// Unit tests: placement validation, fire resolution, filters, AI strength (simulation).
const assert = require('assert');
const { N, FLEET, TOTAL_CELLS, validatePlacement, randomPlacement, Fleet } = require('../lib/game');
const { CpuAI } = require('../lib/ai');
const { cleanName } = require('../lib/names');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓', m); };

ok(TOTAL_CELLS === 17 && FLEET.length === 5, 'fleet is 5 dubs / 17 cells');
for (let i = 0; i < 300; i++) { const p = randomPlacement(); assert.ok(p && p.length === 5); }
ok(true, '300 random placements all valid');
const good = [{ id: 0, x: 0, y: 0, dir: 'h' }, { id: 1, x: 0, y: 1, dir: 'h' }, { id: 2, x: 0, y: 2, dir: 'h' }, { id: 3, x: 0, y: 3, dir: 'h' }, { id: 4, x: 0, y: 4, dir: 'v' }];
ok(validatePlacement(good), 'valid placement accepted');
const bad = (mut) => validatePlacement(mut(JSON.parse(JSON.stringify(good))));
ok(!bad((g) => { g[1].y = 0; return g; }), 'overlap rejected');
ok(!bad((g) => { g[0].x = 6; return g; }), 'out of bounds rejected');
ok(!bad((g) => { g[0].x = -1; return g; }), 'negative rejected');
ok(!bad((g) => { g[2].id = 1; return g; }), 'duplicate id rejected');
ok(!bad((g) => { g[2].dir = 'z'; return g; }), 'bad dir rejected');
ok(!bad((g) => { g[2].x = 1.5; return g; }), 'non-integer rejected');
ok(!bad((g) => { g.pop(); return g; }), 'missing ship rejected');
ok(!validatePlacement('x') && !validatePlacement(null) && !validatePlacement([null, 1, 2, 3, 4]), 'garbage rejected');

const f = new Fleet(validatePlacement(good));
ok(f.fire(9, 9).res === 'miss', 'miss');
ok(f.fire(0, 4).res === 'hit', 'hit');
ok(f.fire(0, 5).res === 'sunk' && f.left === 4, 'sunk baby bug');
let r; for (const s of f.ships) for (const [x, y] of s.cells) if (!f.alreadyShot(x, y)) r = f.fire(x, y);
ok(r.allSunk && f.left === 0, 'all sunk detected');

// AI simulation: how many shots to clear a random fleet
function sim(level, games) {
  let tot = 0;
  for (let g = 0; g < games; g++) {
    const fl = new Fleet(randomPlacement()), ai = new CpuAI(level); let shots = 0;
    for (;;) { const [x, y] = ai.next(); assert.ok(!fl.alreadyShot(x, y), 'AI repeated a shot'); const r = fl.fire(x, y); shots++; ai.feedback(x, y, r.res, r.ship ? r.ship.cells : null, r.ship && r.ship.len); if (r.allSunk) break; assert.ok(shots <= 100); }
    tot += shots;
  }
  return tot / games;
}
const easy = sim('easy', 300), hard = sim('hard', 300);
console.log(`  avg shots to clear: easy ${easy.toFixed(1)}, hard ${hard.toFixed(1)}`);
ok(hard < easy - 8, 'hard AI is clearly stronger than easy');
ok(hard < 60 && easy < 90, 'AI finishes games efficiently, never repeats a shot');

ok(cleanName('Rusty_Bug-67') === 'Rusty_Bug-67', 'clean nickname accepted');
for (const b of ['ab', 'x'.repeat(15), 'fuck', 'f u c k', 'sh1t', 'a<b>c', 'Admin', 'cpu easy', '  ', 'nig.ger', 'He llo!!', 'ṕ̴']) ok(cleanName(b) === null, 'rejected nickname: ' + JSON.stringify(b));
console.log(`unit: ${n} checks passed`);
