// BATTLE DUBS server: HTTP (static client + tiny read-only API) and a WebSocket game hub.
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Store } = require('./lib/store');
const { Match } = require('./lib/match');
const { cleanName, nickKey } = require('./lib/names');
const { clientIp, useClientIp } = require('./lib/clientip');

const PROD = process.env.NODE_ENV === 'production';
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);
const cfg = {
  placeMs: num(process.env.PLACE_SECS, 75) * 1000, turnMs: num(process.env.TURN_SECS, 30) * 1000, graceMs: num(process.env.GRACE_SECS, 20) * 1000,
  cpuMs: num(process.env.CPU_DELAY_MS, 1100), chalMs: num(process.env.CHAL_SECS, 20) * 1000,
  maxConnsPerIp: num(process.env.MAX_CONNS_PER_IP, 40), maxConns: num(process.env.MAX_CONNS, 500), newNicksPerHour: num(process.env.NEW_NICKS_PER_HOUR, 40),
};
const AVATARS = ['🐞', '🚐', '🚌', '🚗', '🏎️', '🛻', '🌻', '☮️', '🔧', '🛞', '⛽', '🏁', '🕶️', '🎸', '📻', '🌴', '🔥', '🏜️', '🍺', '🧰', '🚦', '🐝', '🌈', '🪲'];
const AV = new Set(AVATARS);
const ORIGINS = new Set(['https://vwfest.github.io', 'https://vwfestmemecoin.com', 'https://www.vwfestmemecoin.com', ...(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);
if (process.env.RENDER_EXTERNAL_URL) ORIGINS.add(process.env.RENDER_EXTERNAL_URL.replace(/\/$/, ''));
if (!PROD) { ORIGINS.add('http://127.0.0.1:' + (process.env.PORT || 3000)); ORIGINS.add('http://localhost:' + (process.env.PORT || 3000)); }

const store = new Store();
const conns = new Set(), online = new Map(), queue = [], matches = new Map(), ipCount = new Map(), newNickLog = new Map();
let feedLog = [], matchSeq = 0, lobbyDirty = true;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- messaging ----------
const wsSend = (c, o) => { if (c && c.ws.readyState === 1) c.ws.send(typeof o === 'string' ? o : JSON.stringify(o)); };
const sendP = (p, o) => { if (p.conn) wsSend(p.conn, o); };
const dirty = () => { lobbyDirty = true; };
const feed = (text) => { feedLog.unshift({ t: Date.now(), text: String(text).slice(0, 120) }); feedLog = feedLog.slice(0, 10); dirty(); };
const profile = (p) => (p && p.rec ? { nick: p.nick, avatar: p.avatar, ...store.profile(p.rec) } : null);
const isBusy = (p) => !!(p.queued || (p.match && p.match.phase !== 'over'));
const status = (p) => (p.queued ? 'queue' : p.match && p.match.phase !== 'over' ? (p.match.mode === 'cpu' ? 'cpu' : 'match') : 'idle');
const unqueue = (p) => { const i = queue.indexOf(p); if (i >= 0) queue.splice(i, 1); p.queued = false; };
const clearChal = (p) => { if (p.chalOut) { clearTimeout(p.chalOut.timer); const t = online.get(p.chalOut.to); if (t) t.chalIn.delete(p.key); p.chalOut = null; } for (const [fk, c] of p.chalIn) { clearTimeout(c.timer); const f = online.get(fk); if (f && f.chalOut && f.chalOut.to === p.key) f.chalOut = null; } p.chalIn.clear(); };

const env = {
  cfg, store, sendP, dirty, feed, profile,
  removeMatch(m) { matches.delete(m.id); dirty(); },
  rematch(m) { const [a, b] = [m.sides[0].p, m.sides[1].p]; m.dispose(); startMatch(b, a); },
};
function startMatch(a, b) {
  for (const p of [a, b]) if (!p.cpu) { unqueue(p); clearChal(p); if (p.match) p.match.leave(p.side); }
  const m = new Match(env, ++matchSeq, a, b); matches.set(m.id, m); return m;
}
function tryPair() { while (queue.length >= 2) { const a = queue.shift(), b = queue.shift(); a.queued = b.queued = false; startMatch(a, b); } dirty(); }

// ---------- lobby snapshot ----------
function snapshot() {
  const players = [...online.values()].filter((p) => p.conn || isBusy(p)).map((p) => ({ nick: p.nick, avatar: p.avatar, st: status(p) }));
  const playing = [...matches.values()].filter((m) => m.phase !== 'over');
  const onNames = new Set(players.map((p) => p.nick));
  return JSON.stringify({
    t: 'lobby', ts: Date.now(),
    counts: { online: players.length, watching: [...conns].filter((c) => !c.player).length, battles: playing.length, queue: queue.length },
    players: players.sort((a, b) => a.nick.localeCompare(b.nick)).slice(0, 60),
    matches: playing.slice(0, 20).map((m) => ({ id: m.id, a: { nick: m.sides[0].p.nick, avatar: m.sides[0].p.avatar }, b: { nick: m.sides[1].p.nick, avatar: m.sides[1].p.avatar }, shots: m.sides[0].shots + m.sides[1].shots, mode: m.mode, phase: m.phase })),
    top: store.leaderboard(25).map((r) => ({ ...r, on: onNames.has(r.nick) })),
    feed: feedLog.slice(0, 8).map((f) => ({ ago: Math.round((Date.now() - f.t) / 1000), text: f.text })),
  });
}
setInterval(() => { if (!lobbyDirty) return; lobbyDirty = false; const s = snapshot(); for (const c of conns) wsSend(c, s); }, 1000).unref();
setInterval(() => dirty(), 15000).unref();
setInterval(() => { for (const [k, p] of online) if (!p.conn && (!p.match || p.match.phase === 'over')) { if (p.match) p.match.leave(p.side); online.delete(k); dirty(); } }, 5000).unref();

// ---------- http ----------
const app = express();
app.set('trust proxy', 1); app.disable('x-powered-by');
useClientIp(app);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https://vwfestmemecoin.com'], fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'wss://vwfest-battledubs.onrender.com', ...(PROD ? [] : ['ws://127.0.0.1:*', 'ws://localhost:*'])],
      objectSrc: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"], frameAncestors: ["'self'", 'https://vwfest.github.io', 'https://vwfestmemecoin.com'],
      upgradeInsecureRequests: PROD ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' }, frameguard: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use((req, res, next) => { res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'); next(); });
app.use(compression());
const cors = (req, res, next) => { const o = req.get('origin'); if (o && ORIGINS.has(o)) { res.set('Access-Control-Allow-Origin', o); res.set('Vary', 'Origin'); } next(); };
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.use('/api', rateLimit({ windowMs: 60e3, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }), cors);
app.get('/api/top', (req, res) => {
  const lim = Math.min(Math.max(+req.query.limit || 3, 1), 25);
  res.set('Cache-Control', 'public, max-age=10').json({ ok: true, top: store.leaderboard(lim), online: [...online.values()].filter((p) => p.conn).length, battles: [...matches.values()].filter((m) => m.phase !== 'over').length });
});
app.use((req, res, next) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : res.status(405).end()));
app.use(express.static(path.join(__dirname, 'docs'), { maxAge: PROD ? '10m' : 0, index: 'index.html' }));
app.use((req, res) => res.status(404).type('text').send('Not found'));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
// Real client address: X-Forwarded-For's FIRST entry is client-controlled (it let anyone dodge the per-IP caps by rotating it), so use CF-Connecting-IP / the entry before the Cloudflare edge.
const ipOf = (req) => String(clientIp(req) || '?').slice(0, 64);
server.on('upgrade', (req, socket, head) => {
  const reject = (code, msg) => { socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
  let url; try { url = new URL(req.url, 'http://x'); } catch { return reject(400, 'Bad Request'); }
  if (url.pathname !== '/ws') return reject(404, 'Not Found');
  const origin = req.headers.origin;
  if (!origin || !ORIGINS.has(origin)) return reject(403, 'Forbidden');
  const ip = ipOf(req);
  if (conns.size >= cfg.maxConns || (ipCount.get(ip) || 0) >= cfg.maxConnsPerIp) return reject(429, 'Too Many Requests');
  wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, ip));
});

function onConnect(ws, ip) {
  const c = { ws, ip, player: null, tokens: 25, last: Date.now(), strikes: 0, alive: true };
  conns.add(c); ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
  wsSend(c, { t: 'hi', avatars: AVATARS }); wsSend(c, snapshot());
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const now = Date.now(); c.tokens = Math.min(25, c.tokens + ((now - c.last) / 1000) * 8); c.last = now;
    if (c.tokens < 1) { if (++c.strikes > 40) ws.close(1008, 'slow down'); return; }
    c.tokens -= 1;
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    try { handle(c, m); } catch (e) { console.error('handler error', e); }
  });
  ws.on('close', () => onClose(c));
  ws.on('error', () => {});
}
setInterval(() => { for (const c of conns) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch {} } }, 15000).unref();

function onClose(c) {
  conns.delete(c); const n = (ipCount.get(c.ip) || 1) - 1; if (n <= 0) ipCount.delete(c.ip); else ipCount.set(c.ip, n);
  const p = c.player; if (!p || p.conn !== c) { dirty(); return; }
  p.conn = null; unqueue(p); clearChal(p);
  if (p.match && p.match.phase !== 'over') p.match.away(p.side);
  else { if (p.match) p.match.leave(p.side); online.delete(p.key); }
  dirty();
}
const err = (c, msg, code) => wsSend(c, { t: 'err', msg, code });

function newNickAllowed(ip) {
  const cut = Date.now() - 3600e3, arr = (newNickLog.get(ip) || []).filter((t) => t > cut);
  if (arr.length >= cfg.newNicksPerHour) { newNickLog.set(ip, arr); return false; }
  arr.push(Date.now()); newNickLog.set(ip, arr); return true;
}
function hello(c, m) {
  if (c.player) return err(c, 'Already signed in.');
  const nick = cleanName(m.nick);
  if (!nick) return err(c, 'Nickname must be 3–14 letters, numbers, spaces, _ or -, and family friendly.', 'nick');
  if (typeof m.secret !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(m.secret)) return err(c, 'Bad session.', 'secret');
  const avatar = AV.has(m.avatar) ? m.avatar : '🐞', key = nickKey(nick), sh = sha(m.secret);
  let rec = store.get(key);
  if (rec && !safeEq(rec.secretHash, sh)) {
    if (store.isExpired(rec) && !online.has(key)) { store.players.delete(key); rec = null; }
    else return err(c, `"${rec.nick}" is taken. Pick another nickname.`, 'taken');
  }
  if (!rec) { if (!newNickAllowed(c.ip)) return err(c, 'Too many new nicknames from your network. Try later.', 'rate'); rec = store.create(key, nick, avatar, sh); if (!rec) return err(c, 'Arcade is full.'); }
  rec.avatar = avatar; store.touch(rec);
  let p = online.get(key);
  if (p) { // reconnect or second tab: newest connection wins
    if (p.conn && p.conn !== c) { wsSend(p.conn, { t: 'err', msg: 'Signed in from another tab.', code: 'replaced' }); p.conn.player = null; p.conn.ws.close(4001, 'replaced'); }
    p.conn = c; p.avatar = avatar;
  } else { p = { key, nick: rec.nick, avatar, rec, conn: c, match: null, side: null, queued: false, chalOut: null, chalIn: new Map(), lastChal: 0 }; online.set(key, p); }
  c.player = p;
  wsSend(c, { t: 'hello_ok', me: { nick: rec.nick, avatar, ...store.profile(rec) } });
  if (p.match) p.match.back(p.side);
  dirty();
}

function handle(c, m) {
  if (m.t === 'ping') return wsSend(c, { t: 'pong' });
  if (m.t === 'hello') return hello(c, m);
  const p = c.player; if (!p) return err(c, 'Enter a nickname first.', 'nohello');
  switch (m.t) {
    case 'avatar': if (AV.has(m.avatar)) { p.avatar = m.avatar; p.rec.avatar = m.avatar; store.touch(p.rec); dirty(); } return;
    case 'queue': {
      if (m.on === false) { unqueue(p); wsSend(c, { t: 'queue', on: false }); return dirty(); }
      if (isBusy(p)) return err(c, 'Finish your current game first.');
      clearChal(p); p.queued = true; queue.push(p); wsSend(c, { t: 'queue', on: true }); tryPair(); return dirty();
    }
    case 'cpu': {
      if (isBusy(p)) return err(c, 'Finish your current game first.');
      const level = m.level === 'hard' ? 'hard' : 'easy';
      return void startMatch(p, { cpu: true, level, nick: level === 'hard' ? 'CPU Hard' : 'CPU Easy', avatar: '🤖' });
    }
    case 'challenge': {
      if (isBusy(p)) return err(c, 'Finish your current game first.');
      if (Date.now() - p.lastChal < 3000) return err(c, 'Easy there. Wait a moment.');
      p.lastChal = Date.now();
      const t = typeof m.nick === 'string' ? online.get(nickKey(m.nick)) : null;
      if (!t || !t.conn || t === p) return wsSend(c, { t: 'chal_out', status: 'gone' });
      if (isBusy(t) || t.chalIn.size >= 3) return wsSend(c, { t: 'chal_out', status: 'busy', to: t.nick });
      if (p.chalOut) clearChal(p);
      const timer = setTimeout(() => { t.chalIn.delete(p.key); if (p.chalOut && p.chalOut.to === t.key) { p.chalOut = null; sendP(p, { t: 'chal_out', status: 'expired', to: t.nick }); } sendP(t, { t: 'chal_cancel', from: p.nick }); }, cfg.chalMs);
      p.chalOut = { to: t.key, timer }; t.chalIn.set(p.key, { timer });
      sendP(t, { t: 'chal_in', from: { nick: p.nick, avatar: p.avatar }, ttl: cfg.chalMs });
      return wsSend(c, { t: 'chal_out', status: 'sent', to: t.nick, ttl: cfg.chalMs });
    }
    case 'chal_cancel': return void clearChal(p) || wsSend(c, { t: 'chal_out', status: 'cancelled' });
    case 'chal_reply': {
      const f = typeof m.nick === 'string' ? online.get(nickKey(m.nick)) : null;
      if (!f || !p.chalIn.has(f.key)) return err(c, 'That challenge expired.');
      clearTimeout(p.chalIn.get(f.key).timer); p.chalIn.delete(f.key); if (f.chalOut && f.chalOut.to === p.key) { clearTimeout(f.chalOut.timer); f.chalOut = null; }
      if (!m.accept) return sendP(f, { t: 'chal_out', status: 'declined', to: p.nick });
      if (isBusy(p) || isBusy(f) || !f.conn) return err(c, 'Too late, they are busy.');
      return void startMatch(f, p);
    }
    case 'place': { if (!p.match) return; const e = p.match.place(p.side, m.ships); return e && err(c, e); }
    case 'fire': { if (!p.match) return; const e = p.match.fire(p.side, m.x, m.y); return e && err(c, e, 'fire'); }
    case 'taunt': return void (p.match && p.match.taunt(p.side, m.id));
    case 'rematch': return void (p.match && p.match.rematch(p.side));
    case 'leave': { unqueue(p); if (p.match) p.match.leave(p.side); wsSend(c, { t: 'left' }); return dirty(); }
    case 'me': return wsSend(c, { t: 'me', me: { nick: p.nick, avatar: p.avatar, ...store.profile(p.rec) } });
    default: return;
  }
}

const PORT = +process.env.PORT || 3000;
async function main() {
  await store.init();
  server.listen(PORT, () => console.log(`BATTLE DUBS listening on ${PORT}`));
}
const bye = async () => { try { await store.shutdown(); } finally { process.exit(0); } };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { server, store };
