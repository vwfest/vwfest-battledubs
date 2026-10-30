// CPU opponent. easy: mostly random with a little follow-up. hard: probability-density hunt + hit-chain targeting.
const { N, FLEET } = require('./game');
const U = 0, MISS = 1, HIT = 2, SUNK = 3;

class CpuAI {
  constructor(level = 'easy', rnd = Math.random) {
    this.level = level === 'hard' ? 'hard' : 'easy'; this.rnd = rnd;
    this.g = new Array(N * N).fill(U);
    this.remaining = FLEET.map((f) => f.len);
    this.last = null;
  }
  unknown() { const a = []; for (let i = 0; i < N * N; i++) if (this.g[i] === U) a.push(i); return a; }
  pick(list) { return list[Math.floor(this.rnd() * list.length)]; }
  next() {
    const unk = this.unknown(); let k;
    const hits = []; for (let i = 0; i < N * N; i++) if (this.g[i] === HIT) hits.push(i);
    if (this.level === 'easy') {
      const adj = [];
      if (hits.length && this.rnd() < 0.55) for (const h of hits) for (const n of this.nb(h)) if (this.g[n] === U) adj.push(n);
      k = adj.length ? this.pick(adj) : this.pick(unk);
    } else k = this.hard(unk, hits);
    return [k % N, Math.floor(k / N)];
  }
  nb(k) { const x = k % N, y = Math.floor(k / N), r = []; if (x > 0) r.push(k - 1); if (x < N - 1) r.push(k + 1); if (y > 0) r.push(k - N); if (y < N - 1) r.push(k + N); return r; }
  hard(unk, hits) {
    const w = new Array(N * N).fill(0);
    for (const len of this.remaining) {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (const dir of ['h', 'v']) {
        if (dir === 'h' ? x + len > N : y + len > N) continue;
        let ok = true, cover = 0; const cs = [];
        for (let i = 0; i < len; i++) {
          const k = (dir === 'h' ? y * N + x + i : (y + i) * N + x), s = this.g[k];
          if (s === MISS || s === SUNK) { ok = false; break; }
          if (s === HIT) cover++;
          cs.push(k);
        }
        if (!ok) continue;
        if (hits.length && cover === 0) continue;               // targeting mode: only placements explaining open hits
        const wt = hits.length ? Math.pow(8, cover) : 1;
        for (const k of cs) if (this.g[k] === U) w[k] += wt;
      }
    }
    let best = -1, bl = [];
    for (const k of unk) { if (w[k] > best) { best = w[k]; bl = [k]; } else if (w[k] === best) bl.push(k); }
    if (best <= 0) return this.pick(unk);
    if (!hits.length) { // hunt: prefer checkerboard parity among near-best
      const near = unk.filter((k) => w[k] >= best * 0.92 && ((k % N) + Math.floor(k / N)) % 2 === 0);
      if (near.length) return this.pick(near);
    }
    return this.pick(bl);
  }
  // result: 'miss' | 'hit' | 'sunk'; sunkCells = cells of the sunk ship
  feedback(x, y, res, sunkCells, len) {
    const k = y * N + x;
    if (res === 'miss') this.g[k] = MISS;
    else if (res === 'hit') this.g[k] = HIT;
    else {
      for (const [cx, cy] of sunkCells) this.g[cy * N + cx] = SUNK;
      const i = this.remaining.indexOf(len); if (i >= 0) this.remaining.splice(i, 1);
    }
  }
}
module.exports = { CpuAI };
