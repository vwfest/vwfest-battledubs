// Web Audio synthesized sound effects (no files). Starts on first user gesture.
let ctx = null, master = null, muted = localStorage.getItem('bd_mute') === '1', noiseBuf = null;
function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = muted ? 0 : 0.7; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}
const t0 = () => ctx.currentTime;
function env(g, t, a, peak, d) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function tone(type, f0, f1, dur, vol = 0.3, when = 0) {
  if (!ensure()) return; const t = t0() + when, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, 0.01, vol, dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, vol, f0, f1, when = 0, type = 'lowpass') {
  if (!ensure()) return; const t = t0() + when, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; fl.type = type; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, 0.005, vol, dur); s.connect(fl); fl.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
export const sfx = {
  unlock: () => ensure(),
  click: () => tone('square', 660, 880, 0.06, 0.08),
  place: () => { tone('triangle', 220, 110, 0.12, 0.25); noise(0.08, 0.2, 1200, 300); },
  launch: () => { tone('sine', 140, 40, 0.35, 0.5); noise(0.3, 0.45, 2400, 200); },
  whistle: (dur = 0.7) => tone('sine', 1900, 520, dur, 0.12),
  boom: () => { tone('sine', 120, 30, 0.7, 0.7); noise(0.9, 0.7, 1800, 90); },
  hit: () => { sfx.boom(); tone('square', 310, 140, 0.3, 0.15, 0.04); tone('square', 470, 230, 0.25, 0.1, 0.06); },
  miss: () => { noise(0.35, 0.4, 900, 120); tone('sine', 90, 40, 0.3, 0.35); },
  sunk: () => { sfx.hit(); [0, 0.12, 0.24, 0.36].forEach((w, i) => tone('sawtooth', [392, 494, 587, 784][i], [392, 494, 587, 784][i], 0.25, 0.14, 0.3 + w)); sfx.horn(0.9); },
  horn: (when = 0.5) => { tone('square', 440, 440, 0.14, 0.12, when); tone('square', 554, 554, 0.14, 0.1, when); tone('square', 440, 440, 0.2, 0.12, when + 0.2); tone('square', 554, 554, 0.2, 0.1, when + 0.2); },
  turn: () => { tone('triangle', 740, 740, 0.1, 0.18); tone('triangle', 988, 988, 0.14, 0.18, 0.1); },
  tick: () => tone('square', 1200, 1200, 0.04, 0.07),
  match: () => [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.16, 0.14, i * 0.08)),
  win: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone('square', f, f, 0.22, 0.16, i * 0.11)),
  lose: () => [392, 349, 311, 262].forEach((f, i) => tone('sawtooth', f, f * 0.97, 0.3, 0.14, i * 0.2)),
  chat: () => tone('triangle', 880, 1175, 0.08, 0.15),
  setMuted(v) { muted = v; localStorage.setItem('bd_mute', v ? '1' : '0'); if (master) master.gain.value = v ? 0 : 0.7; },
  get muted() { return muted; },
};
