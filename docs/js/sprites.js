// Procedural top-down air-cooled VW sprites (Beetle, Karmann Ghia, Bus). Drawn facing +x, cached per kind/length/palette/state.
import { CELL } from './config.js';
const SC = 3;
export const PALETTE = [
  { main: '#1fb5a8', trim: '#f4f1e6' },   // 0 Samba Bus: teal over white
  { main: '#f08a24', trim: '#f4f1e6' },   // 1 Kombi Bus: orange over white
  { main: '#d9322e', trim: '#f4f1e6' },   // 2 Ghia: red
  { main: '#f2c230', trim: '#f4f1e6' },   // 3 Beetle: yellow
  { main: '#8a5ae0', trim: '#f4f1e6' },   // 4 Baby Bug: purple
];
const cache = new Map();
const rr = (g, x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
function shade(hex, amt) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, gg = (n >> 8) & 255, b = n & 255; const f = (c) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt)))); return `rgb(${f(r)},${f(gg)},${f(b)})`; }
function bodyFill(g, col, W) { const gr = g.createLinearGradient(0, 0, 0, W); gr.addColorStop(0, shade(col, 0.28)); gr.addColorStop(0.45, col); gr.addColorStop(1, shade(col, -0.35)); return gr; }
function wheels(g, xs, L, W, wl) { g.fillStyle = '#0c0c0c'; for (const x of xs) { rr(g, x - wl / 2, -W * 0.045, wl, W * 1.09, 2.5); g.fill(); } }
function lights(g, L, W, fx, hr) {
  for (const y of [W * 0.2, W * 0.8]) {
    g.fillStyle = '#fff4b0'; g.shadowColor = '#ffe680'; g.shadowBlur = 5; g.beginPath(); g.arc(fx, y, hr, 0, 7); g.fill(); g.shadowBlur = 0;
    g.fillStyle = '#e02020'; g.beginPath(); g.arc(L * 0.025, y, hr * 0.8, 0, 7); g.fill();
  }
}
const GLASS = '#162636';
function glassShine(g, x, y, w, h) { const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fill(); }

function beetle(g, L, W, p) {
  wheels(g, [L * 0.2, L * 0.74], L, W, L * 0.13);
  rr(g, 0, W * 0.03, L, W * 0.94, W * 0.46); g.fillStyle = bodyFill(g, p.main, W); g.fill(); g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
  g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(L * 0.7, W * 0.5); g.lineTo(L * 0.95, W * 0.5); g.stroke();   // hood crease
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(L * (0.07 + i * 0.04), W * 0.34); g.lineTo(L * (0.07 + i * 0.04), W * 0.66); g.stroke(); }  // engine lid louvres
  rr(g, L * 0.29, W * 0.17, L * 0.4, W * 0.66, W * 0.2); g.fillStyle = GLASS; g.fill(); glassShine(g, L * 0.29, W * 0.17, L * 0.4, W * 0.66);
  rr(g, L * 0.37, W * 0.26, L * 0.23, W * 0.48, W * 0.14); g.fillStyle = shade(p.main, 0.12); g.fill(); g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke();
  lights(g, L, W, L * 0.94, W * 0.075);
  g.strokeStyle = '#dfe6ea'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(L * 0.99, W * 0.3); g.lineTo(L * 0.99, W * 0.7); g.moveTo(L * 0.012, W * 0.3); g.lineTo(L * 0.012, W * 0.7); g.stroke();
}
function ghia(g, L, W, p) {
  wheels(g, [L * 0.19, L * 0.75], L, W, L * 0.12);
  g.beginPath(); g.moveTo(L * 0.05, W * 0.1); g.lineTo(L * 0.78, W * 0.04); g.quadraticCurveTo(L * 1.01, W * 0.16, L * 1.0, W * 0.5); g.quadraticCurveTo(L * 1.01, W * 0.84, L * 0.78, W * 0.96); g.lineTo(L * 0.05, W * 0.9); g.quadraticCurveTo(-L * 0.01, W * 0.5, L * 0.05, W * 0.1); g.closePath();
  g.fillStyle = bodyFill(g, p.main, W); g.fill(); g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
  g.strokeStyle = '#e9eef0'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(L * 0.14, W * 0.12); g.lineTo(L * 0.8, W * 0.07); g.moveTo(L * 0.14, W * 0.88); g.lineTo(L * 0.8, W * 0.93); g.stroke(); // chrome side strips
  g.strokeStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.moveTo(L * 0.78, W * 0.5); g.lineTo(L * 0.98, W * 0.5); g.stroke();
  g.beginPath(); g.moveTo(L * 0.3, W * 0.2); g.lineTo(L * 0.62, W * 0.14); g.lineTo(L * 0.7, W * 0.5); g.lineTo(L * 0.62, W * 0.86); g.lineTo(L * 0.3, W * 0.8); g.quadraticCurveTo(L * 0.24, W * 0.5, L * 0.3, W * 0.2); g.closePath();
  g.fillStyle = GLASS; g.fill(); glassShine(g, L * 0.3, W * 0.14, L * 0.4, W * 0.7);
  rr(g, L * 0.37, W * 0.27, L * 0.2, W * 0.46, W * 0.12); g.fillStyle = shade(p.main, 0.1); g.fill(); g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke();
  lights(g, L, W, L * 0.93, W * 0.07);
  g.strokeStyle = '#dfe6ea'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(L * 0.995, W * 0.36); g.lineTo(L * 0.995, W * 0.64); g.stroke();
}
function bus(g, L, W, p, samba) {
  wheels(g, [L * 0.17, L * 0.78], L, W, L * 0.1);
  rr(g, 0, 0, L, W, W * 0.17); g.fillStyle = bodyFill(g, p.main, W); g.fill(); g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
  // white roof with ribs
  rr(g, L * 0.04, W * 0.1, L * 0.73, W * 0.8, W * 0.1); const gr = g.createLinearGradient(0, 0, 0, W); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#c9c6b8'); g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(0,0,0,.4)'; g.stroke();
  g.strokeStyle = 'rgba(0,0,0,.16)'; g.lineWidth = 1; for (let i = 0; i < 9; i++) { const x = L * (0.09 + i * 0.075); g.beginPath(); g.moveTo(x, W * 0.14); g.lineTo(x, W * 0.86); g.stroke(); }
  if (samba) { rr(g, L * 0.24, W * 0.2, L * 0.34, W * 0.6, W * 0.06); g.fillStyle = '#d7c08a'; g.fill(); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.3; g.stroke(); g.strokeStyle = 'rgba(0,0,0,.25)'; for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(L * (0.24 + i * 0.0567), W * 0.2); g.lineTo(L * (0.24 + i * 0.0567), W * 0.8); g.stroke(); } }
  // split windshield + V nose
  g.fillStyle = GLASS; for (const [y0, y1] of [[0.14, 0.47], [0.53, 0.86]]) { g.beginPath(); g.moveTo(L * 0.8, W * y0); g.lineTo(L * 0.92, W * (y0 + 0.04)); g.lineTo(L * 0.92, W * (y1 - 0.04)); g.lineTo(L * 0.8, W * y1); g.closePath(); g.fill(); glassShine(g, L * 0.8, W * y0, L * 0.12, W * (y1 - y0)); }
  g.strokeStyle = shade(p.main, 0.55); g.lineWidth = 2; g.beginPath(); g.moveTo(L * 0.935, W * 0.08); g.lineTo(L * 0.985, W * 0.5); g.lineTo(L * 0.935, W * 0.92); g.stroke();
  g.fillStyle = '#f2f2e8'; g.strokeStyle = '#111'; g.lineWidth = 1; g.beginPath(); g.arc(L * 0.965, W * 0.5, W * 0.085, 0, 7); g.fill(); g.stroke();
  g.strokeStyle = '#1b5fb0'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(L * 0.953, W * 0.45); g.lineTo(L * 0.965, W * 0.56); g.lineTo(L * 0.977, W * 0.45); g.stroke();
  for (const y of [W * 0.16, W * 0.84]) { g.fillStyle = '#fff4b0'; g.shadowColor = '#ffe680'; g.shadowBlur = 5; g.beginPath(); g.arc(L * 0.985, y, W * 0.07, 0, 7); g.fill(); g.shadowBlur = 0; g.fillStyle = '#e02020'; g.beginPath(); g.arc(L * 0.02, y, W * 0.06, 0, 7); g.fill(); }
  g.fillStyle = '#111'; for (const y of [-W * 0.02, W * 1.0]) { rr(g, L * 0.8, y, L * 0.05, W * 0.04, 1); g.fill(); }   // mirrors
}
const DRAW = { beetle, ghia, bus: (g, L, W, p, id) => bus(g, L, W, p, id === 0) };

// state: 'ok' | 'burnt'
export function sprite(kind, id, len, state = 'ok') {
  const key = `${kind}${id}_${len}_${state}`; if (cache.has(key)) return cache.get(key);
  const cw = len * CELL, ch = CELL, c = document.createElement('canvas'); c.width = cw * SC; c.height = ch * SC;
  const g = c.getContext('2d'); g.scale(SC, SC);
  const L = cw - 8, W = kind === 'bus' ? ch - 6 : ch - 9;
  g.save(); g.translate((cw - L) / 2, (ch - W) / 2);
  g.fillStyle = 'rgba(0,0,0,.45)'; g.filter = 'blur(2px)'; rr(g, 2, 3, L, W, W * 0.3); g.fill(); g.filter = 'none';
  DRAW[kind](g, L, W, PALETTE[id % PALETTE.length], id);
  if (state === 'burnt') {
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(14,9,6,.74)'; g.fillRect(-4, -4, L + 8, W + 8);
    let s = 7 + id * 13; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + rnd() * 0.4})`; g.beginPath(); g.ellipse(rnd() * L, rnd() * W, 4 + rnd() * 9, 3 + rnd() * 6, rnd() * 3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(255,90,20,.35)'; g.lineWidth = 1.2; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(rnd() * L, rnd() * W); g.lineTo(rnd() * L, rnd() * W); g.stroke(); }
    g.globalCompositeOperation = 'source-over';
  }
  g.restore(); cache.set(key, c); return c;
}
// Small upright thumbnail for UI (tray, status chips).
export function thumb(kind, id, len, state, h = 26) {
  const s = sprite(kind, id, len, state), c = document.createElement('canvas'); const w = Math.round((s.width / s.height) * h); c.width = w * 2; c.height = h * 2; c.style.width = w + 'px'; c.style.height = h + 'px';
  c.getContext('2d').drawImage(s, 0, 0, c.width, c.height); return c;
}
