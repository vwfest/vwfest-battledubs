// One parking-lot board: canvas rendering, mortar shells, explosions, fire/smoke, craters, placement preview.
import { N, CELL, PAD, FAST } from './config.js';
import { sprite } from './sprites.js';
import { sfx } from './audio.js';

const SIZE = N * CELL + PAD * 2;
const LAMPS = [[PAD * 0.5, PAD * 0.5], [SIZE - PAD * 0.5, PAD * 0.5], [PAD * 0.5, SIZE - PAD * 0.5], [SIZE - PAD * 0.5, SIZE - PAD * 0.5], [SIZE - PAD * 0.5, SIZE / 2], [SIZE / 2, SIZE - PAD * 0.5]];
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const lerp = (a, b, t) => a + (b - a) * t;
export const cellName = (x, y) => String.fromCharCode(65 + y) + (x + 1);

export class Board {
  constructor(canvas, opts = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.mine = !!opts.mine; this.seed = opts.seed || 7;
    this.ships = []; this.marks = new Map(); this.parts = []; this.shells = []; this.texts = [];
    this.hover = null; this.target = null; this.mode = 'off'; this.preview = null; this.shake = 0; this.flash = 0; this.scale = 1; this.bg = null; this.t = 0; this.last = performance.now();
    this.onCell = null; this.onHover = null; this.onAlt = null; this.lastDone = null;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas);
    canvas.addEventListener('pointermove', (e) => { const c = this.cellAt(e); this.setHover(c); });
    canvas.addEventListener('pointerleave', () => this.setHover(null));
    canvas.addEventListener('pointerdown', (e) => { if (e.button === 2) return; const c = this.cellAt(e); if (this.mode === 'off') return; if (e.pointerType !== 'mouse') this.setHover(c); if (c && this.onCell) this.onCell(c.x, c.y, e.pointerType); });
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this.onAlt) this.onAlt(); });
    canvas.style.touchAction = 'manipulation';
    this.resize(); this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); }
  cellAt(e) {
    const r = this.cv.getBoundingClientRect(), lx = ((e.clientX - r.left) / r.width) * SIZE, ly = ((e.clientY - r.top) / r.height) * SIZE;
    const x = Math.floor((lx - PAD) / CELL), y = Math.floor((ly - PAD) / CELL);
    return x >= 0 && y >= 0 && x < N && y < N ? { x, y } : null;
  }
  setHover(c) { if ((c && this.hover && c.x === this.hover.x && c.y === this.hover.y) || (!c && !this.hover)) return; this.hover = c; if (this.onHover) this.onHover(c); }
  resize() {
    const w = Math.max(200, Math.round(this.cv.clientWidth)), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.cv.width = Math.round(w * dpr); this.cv.height = this.cv.width; this.scale = this.cv.width / SIZE; this.bg = this.makeBg();
  }
  // ---------- static lot ----------
  makeBg() {
    const c = document.createElement('canvas'); c.width = this.cv.width; c.height = this.cv.height; const g = c.getContext('2d'); g.scale(this.scale, this.scale);
    const r = rng(this.seed * 977 + 13);
    g.fillStyle = '#16171a'; g.fillRect(0, 0, SIZE, SIZE);
    // curb + verge
    g.fillStyle = '#23252a'; g.fillRect(4, 4, SIZE - 8, SIZE - 8);
    g.strokeStyle = '#4a4d55'; g.lineWidth = 3; g.strokeRect(PAD - 6, PAD - 6, N * CELL + 12, N * CELL + 12);
    // asphalt
    const L = PAD, S = N * CELL;
    const gr = g.createLinearGradient(L, L, L + S, L + S); gr.addColorStop(0, '#34353b'); gr.addColorStop(0.5, '#2a2b30'); gr.addColorStop(1, '#303136'); g.fillStyle = gr; g.fillRect(L, L, S, S);
    for (let i = 0; i < 2600; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.12)'; g.fillRect(L + r() * S, L + r() * S, 1 + r() * 1.5, 1 + r() * 1.5); }
    for (let i = 0; i < 9; i++) { const x = L + r() * S, y = L + r() * S; const o = g.createRadialGradient(x, y, 0, x, y, 20 + r() * 20); o.addColorStop(0, 'rgba(8,8,12,.45)'); o.addColorStop(1, 'rgba(8,8,12,0)'); g.fillStyle = o; g.fillRect(x - 45, y - 45, 90, 90); }   // oil stains
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; for (let i = 0; i < 6; i++) { let x = L + r() * S, y = L + r() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 36; y += (r() - 0.5) * 36; g.lineTo(x, y); } g.stroke(); }
    // painted stalls
    g.lineCap = 'round';
    for (let y = 0; y < N; y++) for (let x = 0; x <= N; x++) {
      g.strokeStyle = x === 0 || x === N ? 'rgba(255,214,64,.75)' : 'rgba(240,240,230,.55)'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(L + x * CELL, L + y * CELL + 5); g.lineTo(L + x * CELL, L + (y + 1) * CELL - 5); g.stroke();
    }
    g.setLineDash([7, 9]); g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1.3; for (let y = 1; y < N; y++) { g.beginPath(); g.moveTo(L + 4, L + y * CELL); g.lineTo(L + S - 4, L + y * CELL); g.stroke(); } g.setLineDash([]);
    // arrows / handicap paint for flavour
    g.fillStyle = 'rgba(80,140,255,.22)'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♿', L + 4.5 * CELL, L + 0.5 * CELL - 0.2); g.fillText('♿', L + 9.5 * CELL, L + 9.5 * CELL);
    // labels
    g.fillStyle = '#a8a590'; g.font = '700 13px Rajdhani, sans-serif';
    for (let i = 0; i < N; i++) { g.fillText(String(i + 1), L + i * CELL + CELL / 2, PAD - 12); g.fillText(String.fromCharCode(65 + i), PAD - 14, L + i * CELL + CELL / 2); }
    // lamp bases
    for (const [x, y] of LAMPS) { g.fillStyle = '#0c0c0e'; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); g.strokeStyle = '#6d6f78'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#fff2b0'; g.beginPath(); g.arc(x, y, 3.4, 0, 7); g.fill(); }
    g.strokeStyle = this.mine ? 'rgba(24,255,122,.5)' : 'rgba(255,198,26,.6)'; g.lineWidth = 2; g.strokeRect(1.5, 1.5, SIZE - 3, SIZE - 3);
    return c;
  }
  // ---------- state ----------
  clear() { this.ships = []; this.marks.clear(); this.parts = []; this.shells = []; this.texts = []; this.target = null; this.preview = null; this.shake = 0; this.flash = 0; }
  setShips(list) { this.ships = list.map((s) => ({ ...s, sunk: !!s.sunk })); }
  addRevealed(s, sunk) { this.ships = this.ships.filter((x) => x.id !== s.id); this.ships.push({ ...s, sunk: !!sunk, revealed: !sunk }); }
  setMode(m) { this.mode = m; this.cv.style.cursor = m === 'target' ? 'crosshair' : m === 'place' ? 'copy' : 'default'; if (m !== 'target') this.target = null; }
  mark(x, y, res, ship) { this.marks.set(y * N + x, { res: res === 'miss' ? 'miss' : 'hit', t0: this.t - 1, v: (x * 7 + y * 13) % 5 }); if (res === 'sunk' && ship) this.sinkShip(ship); }
  sinkShip(ship) { const s = this.ships.find((q) => q.id === ship.id); if (s) s.sunk = true; else this.ships.push({ ...ship, sunk: true }); }
  // ---------- mortar ----------
  shoot(x, y, res, ship, incoming, done) {
    const tx = PAD + x * CELL + CELL / 2, ty = PAD + y * CELL + CELL / 2;
    const sx = incoming ? lerp(SIZE * 0.15, SIZE * 0.85, Math.random()) : lerp(SIZE * 0.3, SIZE * 0.7, Math.random()), sy = incoming ? -30 : SIZE + 24;
    const dur = (incoming ? 0.95 : 1.15) * (FAST ? 0.12 : 1); sfx.launch(); setTimeout(() => sfx.whistle(dur * 0.62), dur * 380);
    this.shells.push({ sx, sy, tx, ty, t0: this.t, dur, peak: incoming ? SIZE * 0.3 : SIZE * 0.62, x, y, res, ship, done, incoming });
    // muzzle flash from the firing end
    for (let i = 0; i < 14; i++) this.emit('spark', sx, incoming ? 4 : SIZE - 4, (Math.random() - 0.5) * 90, (incoming ? 1 : -1) * Math.random() * 90, 0.35);
    for (let i = 0; i < 6; i++) this.emit('smoke', sx + (Math.random() - 0.5) * 12, incoming ? 6 : SIZE - 6, (Math.random() - 0.5) * 30, (incoming ? 1 : -1) * 20, 0.9);
  }
  land(sh) {
    const { x, y, res, ship, tx, ty } = sh;
    if (res === 'miss') {
      this.marks.set(y * N + x, { res: 'miss', t0: this.t, v: (x * 7 + y * 13) % 5 }); sfx.miss(); this.shake = Math.max(this.shake, 4);
      for (let i = 0; i < 18; i++) this.emit('dust', tx, ty, (Math.random() - 0.5) * 110, (Math.random() - 0.5) * 110, 0.8 + Math.random() * 0.5);
      for (let i = 0; i < 8; i++) this.emit('debris', tx, ty, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 0.6);
      this.say(tx, ty - 8, 'MISS', '#c7c9d1');
    } else {
      this.marks.set(y * N + x, { res: 'hit', t0: this.t, v: (x * 7 + y * 13) % 5 });
      this.flash = 1; this.shake = 11; if (res === 'sunk') { sfx.sunk(); this.shake = 20; } else sfx.hit();
      this.explosion(tx, ty, res === 'sunk' ? 2 : 1);
      this.say(tx, ty - 10, res === 'sunk' ? 'KO!' : 'HIT!', res === 'sunk' ? '#ffd23a' : '#ff6b3a');
      if (res === 'sunk' && ship) { this.sinkShip(ship); for (const [cx, cy] of ship.cells || this.cellsOfShip(ship)) this.explosion(PAD + cx * CELL + CELL / 2, PAD + cy * CELL + CELL / 2, 0.8); }
    }
    if (sh.done) sh.done();
  }
  cellsOfShip(s) { return Array.from({ length: s.len }, (_, i) => [s.dir === 'h' ? s.x + i : s.x, s.dir === 'v' ? s.y + i : s.y]); }
  explosion(x, y, k) {
    this.parts.push({ type: 'ring', x, y, vx: 0, vy: 0, life: 0.5, max: 0.5, size: 8 * k });
    for (let i = 0; i < 26 * k; i++) { const a = Math.random() * 6.28, v = 40 + Math.random() * 170 * k; this.emit('fire', x, y, Math.cos(a) * v, Math.sin(a) * v, 0.45 + Math.random() * 0.5); }
    for (let i = 0; i < 20 * k; i++) { const a = Math.random() * 6.28, v = 90 + Math.random() * 260 * k; this.emit('spark', x, y, Math.cos(a) * v, Math.sin(a) * v, 0.4 + Math.random() * 0.5); }
    for (let i = 0; i < 12 * k; i++) { const a = Math.random() * 6.28, v = 20 + Math.random() * 70; this.emit('smoke', x, y, Math.cos(a) * v, Math.sin(a) * v - 20, 1.1 + Math.random()); }
    for (let i = 0; i < 9 * k; i++) { const a = Math.random() * 6.28, v = 80 + Math.random() * 190; this.emit('debris', x, y, Math.cos(a) * v, Math.sin(a) * v, 0.7 + Math.random() * 0.4); }
  }
  emit(type, x, y, vx, vy, life) { if (this.parts.length > 520) return; this.parts.push({ type, x, y, vx, vy, life, max: life, size: type === 'smoke' ? 6 + Math.random() * 6 : type === 'fire' ? 5 + Math.random() * 6 : type === 'dust' ? 5 + Math.random() * 5 : 1.5 + Math.random() * 2, rot: Math.random() * 6 }); }
  say(x, y, text, color) { this.texts.push({ x, y, text, color, t0: this.t }); }
  // ---------- frame ----------
  frame(ts) {
    const dt = Math.min(0.05, (ts - this.last) / 1000); this.last = ts; this.t += dt;
    this.update(dt); this.draw(); this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  update(dt) {
    for (const sh of this.shells) { const p = (this.t - sh.t0) / sh.dur; sh.p = p; if (p < 1 && Math.random() < 0.8) { const [px, py] = this.shellPos(sh, p); this.emit('smoke', px, py, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, 0.5); } }
    const landed = this.shells.filter((s) => s.p >= 1); this.shells = this.shells.filter((s) => s.p < 1); landed.forEach((s) => this.land(s));
    // continuous fire & smoke on hit cells
    for (const [k, m] of this.marks) if (m.res === 'hit') {
      const cx = PAD + (k % N) * CELL + CELL / 2, cy = PAD + Math.floor(k / N) * CELL + CELL / 2, s = this.shipAt(k % N, Math.floor(k / N)), burnt = s && s.sunk;
      if (Math.random() < (burnt ? 0.28 : 0.7)) this.emit('fire', cx + (Math.random() - 0.5) * 16, cy + (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, -22 - Math.random() * 28, 0.35 + Math.random() * 0.3);
      if (Math.random() < 0.12) this.emit('smoke', cx + (Math.random() - 0.5) * 14, cy, (Math.random() - 0.5) * 12, -26, 1.3);
    }
    for (const p of this.parts) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'smoke' || p.type === 'dust') { p.vx *= 0.97; p.vy = p.vy * 0.97 - 6 * dt; p.size += dt * 7; } else if (p.type === 'fire') { p.vy -= 20 * dt; p.size *= 0.985; } else { p.vx *= 0.93; p.vy *= 0.93; }
    }
    this.parts = this.parts.filter((p) => p.life > 0); this.texts = this.texts.filter((t) => this.t - t.t0 < 1.3);
    this.shake *= Math.pow(0.001, dt); if (this.shake < 0.2) this.shake = 0; this.flash = Math.max(0, this.flash - dt * 3.2);
  }
  shipAt(x, y) { for (const s of this.ships) if (x >= s.x && y >= s.y && (s.dir === 'h' ? x < s.x + s.len && y === s.y : y < s.y + s.len && x === s.x)) return s; return null; }
  shellPos(sh, p) { return [lerp(sh.sx, sh.tx, p), lerp(sh.sy, sh.ty, p) - sh.peak * 4 * p * (1 - p)]; }
  drawShip(g, s, ghost) {
    const spr = sprite(s.kind, s.id, s.len, s.sunk ? 'burnt' : 'ok'), px = PAD + s.x * CELL, py = PAD + s.y * CELL; g.save();
    if (ghost !== undefined) g.globalAlpha = ghost;
    if (s.dir === 'v') { g.translate(px + CELL, py); g.rotate(Math.PI / 2); } else g.translate(px, py);
    g.drawImage(spr, 0, 0, s.len * CELL, CELL); g.restore();
  }
  draw() {
    const g = this.ctx, sc = this.scale; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.cv.width, this.cv.height);
    const sx = this.shake ? (Math.random() - 0.5) * this.shake * sc : 0, sy = this.shake ? (Math.random() - 0.5) * this.shake * sc : 0;
    g.setTransform(1, 0, 0, 1, sx, sy); g.drawImage(this.bg, 0, 0); g.setTransform(sc, 0, 0, sc, sx, sy);
    // craters (under cars)
    for (const [k, m] of this.marks) if (m.res === 'miss') this.drawCrater(g, PAD + (k % N) * CELL + CELL / 2, PAD + Math.floor(k / N) * CELL + CELL / 2, m);
    // cars
    for (const s of this.ships) { this.drawShip(g, s); if (s.revealed) { g.save(); g.strokeStyle = 'rgba(255,198,26,.9)'; g.setLineDash([5, 4]); g.lineWidth = 2; const w = s.dir === 'h' ? s.len : 1, h = s.dir === 'h' ? 1 : s.len; g.strokeRect(PAD + s.x * CELL + 2, PAD + s.y * CELL + 2, w * CELL - 4, h * CELL - 4); g.restore(); } }
    // scorch + dents
    for (const [k, m] of this.marks) if (m.res === 'hit') this.drawScorch(g, PAD + (k % N) * CELL + CELL / 2, PAD + Math.floor(k / N) * CELL + CELL / 2, m, !this.shipAt(k % N, Math.floor(k / N)));
    // lamps (glow)
    g.globalCompositeOperation = 'lighter';
    LAMPS.forEach(([x, y], i) => { const f = 0.12 + 0.02 * Math.sin(this.t * 3 + i * 2) + (Math.sin(this.t * 17 + i * 5) > 0.97 ? -0.04 : 0); const gr = g.createRadialGradient(x, y, 2, x, y, 125); gr.addColorStop(0, `rgba(255,236,160,${f * 0.85})`); gr.addColorStop(1, 'rgba(255,236,160,0)'); g.fillStyle = gr; g.fillRect(x - 125, y - 125, 250, 250); });
    g.globalCompositeOperation = 'source-over';
    this.drawParts(g, 'smoke'); this.drawParts(g, 'dust');
    g.globalCompositeOperation = 'lighter'; this.drawParts(g, 'fire'); this.drawParts(g, 'spark'); g.globalCompositeOperation = 'source-over';
    this.drawParts(g, 'debris'); this.drawParts(g, 'ring');
    this.drawOverlays(g);
    for (const sh of this.shells) this.drawShell(g, sh);
    for (const t of this.texts) { const a = (this.t - t.t0) / 1.3; g.save(); g.globalAlpha = 1 - a * a; g.font = "22px 'Anton', Impact, sans-serif"; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = '#000'; g.fillStyle = t.color; const yy = t.y - a * 26, sz = 1 + Math.max(0, 0.4 - a * 2); g.translate(t.x, yy); g.scale(sz, sz); g.strokeText(t.text, 0, 0); g.fillText(t.text, 0, 0); g.restore(); }
    if (this.flash > 0) { g.fillStyle = `rgba(255,230,170,${this.flash * 0.35})`; g.fillRect(0, 0, SIZE, SIZE); }
  }
  drawCrater(g, cx, cy, m) {
    const a = Math.min(1, (this.t - m.t0) / 0.25), r = 12 * (0.4 + 0.6 * a); g.save(); g.translate(cx, cy); g.rotate(m.v);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(1, 2, r + 4, r + 2, 0, 0, 7); g.fill();
    const pts = Array.from({ length: 9 }, (_, i) => { const ang = (i / 9) * 6.283, rr = r * (0.9 + 0.14 * Math.sin(i * 2.3 + m.v * 3)); return [Math.cos(ang) * rr, Math.sin(ang) * rr * 0.84]; });
    g.beginPath(); pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2; if (i === 0) g.moveTo(mx, my); const n = pts[(i + 1) % pts.length], n2 = pts[(i + 2) % pts.length]; g.quadraticCurveTo(n[0], n[1], (n[0] + n2[0]) / 2, (n[1] + n2[1]) / 2); }); g.closePath();
    const gr = g.createRadialGradient(0, 0, 1, 0, 0, r); gr.addColorStop(0, '#07070a'); gr.addColorStop(0.7, '#15161a'); gr.addColorStop(1, '#3a3b42'); g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(160,155,140,.55)'; g.lineWidth = 1.6; g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1; for (let i = 0; i < 4; i++) { const ang = i * 1.7 + m.v; g.beginPath(); g.moveTo(Math.cos(ang) * r, Math.sin(ang) * r); g.lineTo(Math.cos(ang) * (r + 8), Math.sin(ang) * (r + 8) + 2); g.stroke(); }
    g.restore();
  }
  drawScorch(g, cx, cy, m, bare) {
    const a = Math.min(1, (this.t - m.t0) / 0.3); g.save(); g.translate(cx, cy);
    const gr = g.createRadialGradient(0, 0, 1, 0, 0, 17 * a + 1); gr.addColorStop(0, 'rgba(10,6,4,.85)'); gr.addColorStop(0.6, 'rgba(25,14,8,.55)'); gr.addColorStop(1, 'rgba(25,14,8,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 17 * a + 1, 0, 7); g.fill();
    if (bare) { g.rotate(m.v); g.fillStyle = '#4b4f58'; g.strokeStyle = '#ff8a1f'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-9, -4); g.lineTo(2, -8); g.lineTo(10, -1); g.lineTo(5, 7); g.lineTo(-7, 6); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#23262b'; g.beginPath(); g.arc(-1, 0, 3.5, 0, 7); g.fill(); }
    else { g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-9, -3); g.lineTo(-3, 1); g.lineTo(-6, 5); g.moveTo(3, -7); g.lineTo(6, -1); g.lineTo(10, 2); g.stroke(); }
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 9 + m.v * 2); g.globalCompositeOperation = 'lighter'; const gg = g.createRadialGradient(0, 0, 1, 0, 0, 15); gg.addColorStop(0, `rgba(255,140,40,${0.35 + pulse * 0.2})`); gg.addColorStop(1, 'rgba(255,80,0,0)'); g.fillStyle = gg; g.beginPath(); g.arc(0, 0, 15, 0, 7); g.fill();
    g.restore();
  }
  drawParts(g, type) {
    for (const p of this.parts) { if (p.type !== type) continue; const a = Math.max(0, p.life / p.max);
      if (type === 'smoke') { g.fillStyle = `rgba(${60 + 40 * a | 0},${60 + 40 * a | 0},${66 + 40 * a | 0},${0.5 * a * a})`; g.beginPath(); g.arc(p.x, p.y, p.size, 0, 7); g.fill(); }
      else if (type === 'dust') { g.fillStyle = `rgba(150,138,120,${0.38 * a})`; g.beginPath(); g.arc(p.x, p.y, p.size, 0, 7); g.fill(); }
      else if (type === 'fire') { const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size); gr.addColorStop(0, `rgba(255,${200 * a + 40 | 0},60,${0.9 * a + 0.1})`); gr.addColorStop(1, 'rgba(255,60,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.size, 0, 7); g.fill(); }
      else if (type === 'spark') { g.fillStyle = `rgba(255,${220 * a + 30 | 0},90,${a})`; g.beginPath(); g.arc(p.x, p.y, p.size * a + 0.5, 0, 7); g.fill(); }
      else if (type === 'debris') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot + p.life * 9); g.fillStyle = `rgba(30,28,26,${a})`; g.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2); g.restore(); }
      else if (type === 'ring') { const k = 1 - a; g.strokeStyle = `rgba(255,230,170,${a * 0.8})`; g.lineWidth = 3 * a + 1; g.beginPath(); g.arc(p.x, p.y, p.size + k * 46, 0, 7); g.stroke(); }
    }
  }
  drawShell(g, sh) {
    const p = Math.min(1, sh.p), [x, y] = this.shellPos(sh, p), gx = lerp(sh.sx, sh.tx, p), gy = lerp(sh.sy, sh.ty, p), h = Math.sin(Math.PI * p);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(gx, gy, 6 - h * 2, 3.2, 0, 0, 7); g.fill();            // shadow on the asphalt
    const [x2, y2] = this.shellPos(sh, Math.min(1, p + 0.02)), ang = Math.atan2(y2 - y, x2 - x), sz = 1.0 + h * 1.1;
    g.save(); g.translate(x, y); g.rotate(ang); g.scale(sz, sz); g.fillStyle = '#30343b'; g.strokeStyle = '#ffc61a'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(9, 0); g.quadraticCurveTo(4, -5, -6, -4); g.lineTo(-6, 4); g.quadraticCurveTo(4, 5, 9, 0); g.fill(); g.stroke(); g.fillStyle = '#ff6b3a'; g.fillRect(-9, -2, 4, 4); g.restore();
    g.globalCompositeOperation = 'lighter'; const gr = g.createRadialGradient(x, y, 0, x, y, 16); gr.addColorStop(0, 'rgba(255,170,60,.7)'); gr.addColorStop(1, 'rgba(255,100,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, 16, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over';
    if (!sh.incoming || true) { g.strokeStyle = 'rgba(255,60,60,.55)'; g.lineWidth = 1.5; g.beginPath(); g.arc(sh.tx, sh.ty, 10 + 6 * Math.sin(this.t * 14), 0, 7); g.stroke(); }  // incoming target marker
  }
  drawOverlays(g) {
    const cellRect = (x, y, col, fill) => { g.fillStyle = fill; g.fillRect(PAD + x * CELL + 1, PAD + y * CELL + 1, CELL - 2, CELL - 2); g.strokeStyle = col; g.lineWidth = 2; g.strokeRect(PAD + x * CELL + 2, PAD + y * CELL + 2, CELL - 4, CELL - 4); };
    if (this.mode === 'target') {
      const h = this.target || this.hover;
      if (h && !this.marks.has(h.y * N + h.x)) {
        cellRect(h.x, h.y, '#ffc61a', 'rgba(255,198,26,.16)'); const cx = PAD + h.x * CELL + CELL / 2, cy = PAD + h.y * CELL + CELL / 2, r = 13 + 2 * Math.sin(this.t * 8);
        g.strokeStyle = '#ffc61a'; g.lineWidth = 1.8; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.moveTo(cx - r - 5, cy); g.lineTo(cx - 5, cy); g.moveTo(cx + 5, cy); g.lineTo(cx + r + 5, cy); g.moveTo(cx, cy - r - 5); g.lineTo(cx, cy - 5); g.moveTo(cx, cy + 5); g.lineTo(cx, cy + r + 5); g.stroke();
      }
    }
    if (this.preview) {
      const pv = this.preview; if (pv.ship) {
        const s = { ...pv.ship, x: pv.x, y: pv.y, dir: pv.dir, sunk: false }; this.drawShip(g, s, pv.ok ? 0.8 : 0.45);
        g.strokeStyle = pv.ok ? '#18ff7a' : '#ff3b5c'; g.lineWidth = 2.2; const w = pv.dir === 'h' ? pv.ship.len : 1, hh = pv.dir === 'h' ? 1 : pv.ship.len; g.strokeRect(PAD + pv.x * CELL + 1.5, PAD + pv.y * CELL + 1.5, w * CELL - 3, hh * CELL - 3);
        if (!pv.ok) { g.fillStyle = 'rgba(255,59,92,.22)'; g.fillRect(PAD + pv.x * CELL, PAD + pv.y * CELL, w * CELL, hh * CELL); }
      }
    }
  }
}
