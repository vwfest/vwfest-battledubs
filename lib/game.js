// Pure game rules for BATTLE DUBS. No I/O. Fleet placements live only on the server.
const N = 10;
// id, kind (sprite), display name, length in lot cells
const FLEET = [
  { id: 0, kind: 'bus', name: 'Samba Bus', len: 5 },
  { id: 1, kind: 'bus', name: 'Kombi Bus', len: 4 },
  { id: 2, kind: 'ghia', name: 'Karmann Ghia', len: 3 },
  { id: 3, kind: 'beetle', name: 'Beetle', len: 3 },
  { id: 4, kind: 'beetle', name: 'Baby Bug', len: 2 },
];
const TOTAL_CELLS = FLEET.reduce((a, s) => a + s.len, 0);

const isInt = (v) => Number.isInteger(v);
const cellsOf = (x, y, len, dir) => Array.from({ length: len }, (_, i) => [dir === 'h' ? x + i : x, dir === 'v' ? y + i : y]);

// Validate a client-supplied placement. Returns normalized ships or null.
function validatePlacement(input) {
  if (!Array.isArray(input) || input.length !== FLEET.length) return null;
  const seen = new Set(), occ = new Set(), out = [];
  for (const s of input) {
    if (!s || typeof s !== 'object') return null;
    const { id, x, y, dir } = s;
    if (!isInt(id) || id < 0 || id >= FLEET.length || seen.has(id)) return null;
    if (!isInt(x) || !isInt(y) || (dir !== 'h' && dir !== 'v')) return null;
    seen.add(id);
    const f = FLEET[id], cells = cellsOf(x, y, f.len, dir);
    for (const [cx, cy] of cells) {
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) return null;
      const k = cy * N + cx; if (occ.has(k)) return null; occ.add(k);
    }
    out.push({ id, kind: f.kind, name: f.name, len: f.len, x, y, dir, cells, hits: 0 });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

function randomPlacement(rnd = Math.random) {
  for (;;) {
    const occ = new Set(), raw = [];
    let ok = true;
    for (const f of [...FLEET].sort((a, b) => b.len - a.len)) {
      let placed = false;
      for (let t = 0; t < 200 && !placed; t++) {
        const dir = rnd() < 0.5 ? 'h' : 'v';
        const x = Math.floor(rnd() * (dir === 'h' ? N - f.len + 1 : N)), y = Math.floor(rnd() * (dir === 'v' ? N - f.len + 1 : N));
        const cells = cellsOf(x, y, f.len, dir);
        if (cells.some(([cx, cy]) => occ.has(cy * N + cx))) continue;
        cells.forEach(([cx, cy]) => occ.add(cy * N + cx));
        raw.push({ id: f.id, x, y, dir }); placed = true;
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return validatePlacement(raw);
  }
}

class Fleet {
  constructor(ships) {
    this.ships = ships; this.at = new Map(); this.shots = new Map(); this.left = ships.length;
    for (const s of ships) for (const [x, y] of s.cells) this.at.set(y * N + x, s);
  }
  alreadyShot(x, y) { return this.shots.has(y * N + x); }
  // returns { res: 'miss'|'hit'|'sunk', ship?, allSunk }
  fire(x, y) {
    const k = y * N + x, s = this.at.get(k);
    if (!s) { this.shots.set(k, 'miss'); return { res: 'miss', allSunk: false }; }
    s.hits++;
    if (s.hits >= s.len) { this.left--; this.shots.set(k, 'sunk'); return { res: 'sunk', ship: s, allSunk: this.left === 0 }; }
    this.shots.set(k, 'hit'); return { res: 'hit', ship: s, allSunk: false };
  }
  alive() { return this.ships.filter((s) => s.hits < s.len); }
}
const publicShip = (s) => ({ id: s.id, kind: s.kind, name: s.name, len: s.len, x: s.x, y: s.y, dir: s.dir });

module.exports = { N, FLEET, TOTAL_CELLS, validatePlacement, randomPlacement, Fleet, publicShip, cellsOf };
