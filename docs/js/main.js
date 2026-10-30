// BATTLE DUBS client. All server-provided text goes through textContent (never innerHTML).
import { WS_URL, N, FAST } from './config.js';
import { Board, cellName } from './board.js';
import { thumb } from './sprites.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? ms / 8 : ms));
const FALLBACK_AV = ['🐞', '🚐', '🚌', '🚗', '🏎️', '🛻', '🌻', '☮️', '🔧', '🛞', '⛽', '🏁', '🕶️', '🎸', '📻', '🌴', '🔥', '🏜️', '🍺', '🧰', '🚦', '🐝', '🌈', '🪲'];
const TAUNTS = ['Nice shot! 👏', 'Missed me! 😜', 'Burn, baby, burn 🔥', 'Air-cooled forever 🌬️', 'Beep beep! 🚐', 'Good game! 🤝', 'Oops 😅', 'Hurry up! ⏱️'];

const S = {
  ws: null, open: false, avatars: FALLBACK_AV, me: null, lobby: null, view: 'lobby', queueOn: false, queueSince: 0, chalTo: null, avatar: null,
  match: null, place: null, myTurn: false, deadline: 0, turnMs: 30000, locked: false, left: { me: 5, opp: 5 }, fleet: [], over: false, rematchSent: false,
  retry: 0, dead: false, prevLb: new Map(), uiq: [], pumping: false,
};
const secret = (() => { let s = localStorage.getItem('bd_secret'); if (!s || !/^[A-Za-z0-9_-]{16,64}$/.test(s)) { const b = crypto.getRandomValues(new Uint8Array(24)); s = btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c])); localStorage.setItem('bd_secret', s); } return s; })();
const saved = () => { try { return JSON.parse(localStorage.getItem('bd_profile') || 'null'); } catch { return null; } };

// ---------- boards ----------
const bSetup = new Board($('cSetup'), { mine: true, seed: 3 });
const bEnemy = new Board($('cEnemy'), { mine: false, seed: 5 });
const bMine = new Board($('cMine'), { mine: true, seed: 9 });
window.__bd = { S, bSetup, bEnemy, bMine };   // handy for tests/debugging

// ---------- toasts ----------
function toast(text, bad) { const t = el('div', 'toast' + (bad ? ' bad' : ''), text); $('toasts').append(t); setTimeout(() => t.remove(), 3600); }

// ---------- network ----------
let wakeTimer = null;
function setConn(txt, cls) { const c = $('conn'); c.textContent = txt; c.className = 'pill ' + (cls || ''); }
function connect() {
  if (S.dead) return; setConn('connecting…', '');
  let ws; try { ws = new WebSocket(WS_URL); } catch { return retry(); }
  S.ws = ws; clearTimeout(wakeTimer); wakeTimer = setTimeout(() => { if (!S.open) setConn('waking server… (up to a minute)', ''); }, 3500);
  ws.onopen = () => { S.open = true; S.retry = 0; clearTimeout(wakeTimer); setConn('online', 'ok'); renderMe(); };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
  ws.onclose = () => { S.open = false; S.ws = null; if (!S.dead) { setConn('reconnecting…', 'bad'); retry(); } renderMe(); };
  ws.onerror = () => {};
}
function retry() { S.retry++; setTimeout(connect, Math.min(1500 * S.retry, 8000)); }
const send = (o) => { if (S.ws && S.open) S.ws.send(JSON.stringify(o)); };
setInterval(() => send({ t: 'ping' }), 25000);

function onMsg(m) {
  switch (m.t) {
    case 'hi': if (Array.isArray(m.avatars) && m.avatars.length) { S.avatars = m.avatars; buildAvatarPickers(); } { const p = saved(); if (p && !S.me) send({ t: 'hello', nick: p.nick, avatar: p.avatar, secret }); } break;
    case 'hello_ok': S.me = m.me; S.avatar = m.me.avatar; localStorage.setItem('bd_profile', JSON.stringify({ nick: m.me.nick, avatar: m.me.avatar })); $('nickErr').textContent = ''; renderMe(); break;
    case 'me': S.me = m.me; renderMe(); break;
    case 'err': onErr(m); break;
    case 'lobby': S.lobby = m; renderLobby(); break;
    case 'queue': S.queueOn = m.on; S.queueSince = Date.now(); renderMe(); break;
    case 'chal_in': addChallenge(m); break;
    case 'chal_cancel': removeChallenge(m.from); break;
    case 'chal_out': onChalOut(m); break;
    case 'match': onMatch(m); break;
    case 'opp_ready': $('setupStatus').textContent = 'Opponent is parked and ready.'; break;
    case 'ready': onReady(m); break;
    case 'opp_conn': toast(m.ok ? 'Opponent is back!' : `Opponent disconnected. They have ${Math.round(m.grace / 1000)}s to return…`, !m.ok); break;
    case 'opp_left': $('rematchBtn').disabled = true; $('rematchBtn').textContent = 'Opponent left'; break;
    case 'rematch': $('rematchBtn').textContent = '🔁 Accept rematch!'; toast(`${m.from} wants a rematch`); break;
    case 'left': showView('lobby'); break;
    case 'taunt': showTaunt(m.id); break;
    case 'battle': case 'turn': case 'shot': case 'over': S.uiq.push(m); pump(); break;
    default: break;
  }
}
function onErr(m) {
  if (m.code === 'nick' || m.code === 'taken' || m.code === 'rate' || m.code === 'secret') { $('nickErr').textContent = m.msg; $('enterBtn').disabled = false; localStorage.removeItem('bd_profile'); return; }
  if (m.code === 'replaced') { S.dead = true; setConn('signed in elsewhere', 'bad'); toast(m.msg, true); return; }
  if (m.code === 'nohello') { const p = saved(); if (p) send({ t: 'hello', nick: p.nick, avatar: p.avatar, secret }); return; }
  if (m.code === 'fire') S.locked = false;
  toast(m.msg || 'Something went wrong', true);
}

// ---------- views ----------
function showView(v) {
  S.view = v; for (const [k, id] of [['lobby', 'vLobby'], ['setup', 'vSetup'], ['battle', 'vBattle']]) $(id).hidden = k !== v;
  $('over').hidden = true; window.scrollTo({ top: 0 });
  if (v === 'lobby') { S.match = null; S.over = false; renderMe(); renderLobby(); }
}

// ---------- lobby ----------
function buildAvatarPickers() {
  const make = (root, cur, onPick) => { root.replaceChildren(); for (const a of S.avatars) { const b = el('button', a === cur ? 'sel' : '', a); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', 'Avatar ' + a); b.addEventListener('click', () => { onPick(a); [...root.children].forEach((c) => c.classList.toggle('sel', c === b)); sfx.click(); }); root.append(b); } };
  make($('avatars'), S.avatar || (saved() && saved().avatar) || S.avatars[0], (a) => { S.avatar = a; });
  make($('avPick'), S.me && S.me.avatar, (a) => { S.avatar = a; send({ t: 'avatar', avatar: a }); if (S.me) S.me.avatar = a; $('avPick').hidden = true; renderMe(); });
  if (!S.avatar) S.avatar = (saved() && saved().avatar) || S.avatars[0];
}
const statBox = (v, l) => { const d = el('div'); d.append(el('b', '', String(v)), el('i', '', l)); return d; };
function renderMe() {
  const me = S.me, on = !!me;
  $('guestForm').hidden = on; $('meBox').hidden = !on;
  const idle = on && S.open && !S.match;
  $('quickBtn').disabled = !idle; $('cpuEasy').disabled = !idle || S.queueOn; $('cpuHard').disabled = !idle || S.queueOn;
  $('quickBtn').textContent = S.queueOn ? '✖ Cancel search' : '⚡ Quick match';
  const qn = $('queueNote'); qn.hidden = !S.queueOn; if (S.queueOn) qn.textContent = 'Searching for an opponent… (' + Math.max(0, Math.round((Date.now() - S.queueSince) / 1000)) + 's) Nobody yet? Challenge someone below or try the CPU.';
  if (!on) { $('enterBtn').disabled = !S.open; return; }
  $('meAv').textContent = me.avatar; $('meNick').textContent = me.nick; $('meRank').textContent = me.rank ? `Rank #${me.rank}` : 'Unranked: win a live match to get on the board';
  const st = $('meStats'); st.replaceChildren(statBox(me.wins || 0, 'WINS'), statBox(me.losses || 0, 'LOSSES'), statBox((me.rate || 0) + '%', 'WIN RATE'), statBox((me.acc || 0) + '%', 'ACCURACY'), statBox(me.kills || 0, 'DUBS KO’D'));
  $('meCpu').textContent = `vs CPU (practice, not ranked): ${me.cpuWins || 0} W · ${me.cpuLosses || 0} L`;
}
setInterval(() => { if (S.queueOn) renderMe(); }, 1000);
function renderLobby() {
  const L = S.lobby; if (!L) return;
  $('cOnline').textContent = L.counts.online; $('cBattles').textContent = L.counts.battles; $('cQueue').textContent = L.counts.queue; $('onlineN').textContent = L.counts.online;
  // leaderboard (flash rows whose numbers changed)
  const tb = $('lb').tBodies[0]; tb.replaceChildren();
  if (!L.top.length) { const tr = el('tr'), td = el('td', 'empty', 'No ranked games yet. Win a live match and take the #1 spot.'); td.colSpan = 7; tr.append(td); tb.append(tr); }
  const next = new Map();
  for (const r of L.top) {
    const sig = `${r.wins}-${r.losses}-${r.acc}-${r.kills}`; next.set(r.nick, sig);
    const tr = el('tr', (S.me && S.me.nick === r.nick ? 'me ' : '') + (S.prevLb.size && S.prevLb.get(r.nick) !== sig ? 'flash' : ''));
    const name = el('td'); name.append(el('span', 'av', r.avatar), document.createTextNode(r.nick)); name.append(el('span', 'dot' + (r.on ? ' on' : ''))); name.lastChild.title = r.on ? 'online' : 'offline';
    tr.append(el('td', '', r.rank), name, el('td', '', r.wins), el('td', '', r.losses), el('td', '', r.rate + '%'), el('td', '', r.acc + '%'), el('td', '', r.kills)); tb.append(tr);
  }
  S.prevLb = next;
  // players online
  const ol = $('onlineList'); ol.replaceChildren(); if (!L.players.length) ol.append(el('li', 'muted', 'Nobody here yet. Be the first!'));
  const myIdle = S.me && !S.match && !S.queueOn;
  for (const p of L.players) {
    const li = el('li'), isMe = S.me && p.nick === S.me.nick; li.append(el('span', 'av', p.avatar), el('span', 'n', p.nick + (isMe ? ' (you)' : '')));
    const sp = el('span', 'sp'); const lab = { idle: 'in lobby', queue: 'searching', match: 'in battle', cpu: 'vs CPU' }[p.st] || '';
    sp.append(el('span', 'pill' + (p.st === 'idle' ? ' ok' : ''), lab));
    if (!isMe && p.st === 'idle' && myIdle) { const b = el('button', 'btn small', S.chalTo === p.nick ? 'Sent…' : 'Challenge'); b.type = 'button'; b.disabled = S.chalTo === p.nick; b.addEventListener('click', () => { sfx.click(); send({ t: 'challenge', nick: p.nick }); }); sp.append(b); }
    li.append(sp); ol.append(li);
  }
  const ll = $('liveList'); ll.replaceChildren(); if (!L.matches.length) ll.append(el('li', 'muted', 'No battles right now. Start one!'));
  for (const m of L.matches) { const li = el('li'); li.append(el('span', 'av', m.a.avatar), el('span', 'n', m.a.nick), el('span', '', 'vs'), el('span', 'av', m.b.avatar), el('span', 'n', m.b.nick)); const sp = el('span', 'sp'); sp.append(el('span', 'pill live', m.phase === 'placing' ? 'parking…' : m.shots + ' shots'), el('span', 'pill', m.mode === 'cpu' ? 'CPU' : 'LIVE PvP')); li.append(sp); ll.append(li); }
  const fl = $('feedList'); fl.replaceChildren(); if (!L.feed.length) fl.append(el('li', 'muted', 'Quiet in the lot…'));
  for (const f of L.feed) { const li = el('li'); li.append(el('span', 'n', f.text)); li.append(el('span', 'sp tiny', f.ago < 90 ? f.ago + 's ago' : Math.round(f.ago / 60) + 'm ago')); fl.append(li); }
}
$('enterBtn').addEventListener('click', () => { sfx.unlock(); const nick = $('nick').value.trim(); if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,12}[A-Za-z0-9]$/.test(nick)) { $('nickErr').textContent = 'Nickname must be 3–14 letters, numbers, spaces, _ or -.'; return; } $('nickErr').textContent = ''; $('enterBtn').disabled = true; send({ t: 'hello', nick, avatar: S.avatar, secret }); setTimeout(() => { $('enterBtn').disabled = !S.open; }, 2500); });
$('nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('enterBtn').click(); });
$('avBtn').addEventListener('click', () => { $('avPick').hidden = !$('avPick').hidden; buildAvatarPickers(); });
$('quickBtn').addEventListener('click', () => { sfx.unlock(); sfx.click(); send({ t: 'queue', on: !S.queueOn }); });
$('cpuEasy').addEventListener('click', () => { sfx.unlock(); sfx.click(); send({ t: 'cpu', level: 'easy' }); });
$('cpuHard').addEventListener('click', () => { sfx.unlock(); sfx.click(); send({ t: 'cpu', level: 'hard' }); });
$('muteBtn').addEventListener('click', () => { sfx.setMuted(!sfx.muted); $('muteBtn').textContent = sfx.muted ? '🔇' : '🔊'; sfx.unlock(); });
$('muteBtn').textContent = sfx.muted ? '🔇' : '🔊';
document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

// challenges
function addChallenge(m) {
  removeChallenge(m.from.nick); const box = el('div', 'chal'); box.dataset.nick = m.from.nick; box.append(el('span', 'bigav', m.from.avatar), el('span', '', `${m.from.nick} challenges you!`));
  const sp = el('span', 'sp'), a = el('button', 'btn small', 'Fight'), d = el('button', 'btn small ghost', 'No'); a.type = d.type = 'button';
  a.addEventListener('click', () => { send({ t: 'chal_reply', nick: m.from.nick, accept: true }); box.remove(); }); d.addEventListener('click', () => { send({ t: 'chal_reply', nick: m.from.nick, accept: false }); box.remove(); });
  sp.append(a, d); box.append(sp); $('chals').append(box); sfx.turn(); setTimeout(() => box.remove(), m.ttl || 20000);
}
function removeChallenge(nick) { for (const c of [...$('chals').children]) if (c.dataset.nick === nick) c.remove(); }
function onChalOut(m) {
  S.chalTo = m.status === 'sent' ? m.to : null;
  const msg = { sent: `Challenge sent to ${m.to}. Waiting…`, declined: `${m.to} declined.`, expired: `${m.to} didn't answer.`, busy: `${m.to} is busy right now.`, gone: 'That player left.', cancelled: 'Challenge cancelled.' }[m.status];
  if (msg) toast(msg, m.status !== 'sent'); renderLobby();
}

// ---------- match start / setup ----------
function onMatch(m) {
  S.match = m; S.fleet = m.fleet; S.over = false; S.uiq = []; S.locked = false; S.rematchSent = false; S.queueOn = false; S.chalTo = null; $('chals').replaceChildren();
  S.left = m.left || { me: 5, opp: 5 };
  const ma = S.me.avatar, mn = S.me.nick, oa = m.opp.avatar, on = m.opp.nick;
  for (const [id, v] of [['sMeAv', ma], ['sMeNick', mn], ['sOppAv', oa], ['sOppNick', on], ['hMeAv', ma], ['hMeNick', mn], ['hOppAv', oa], ['hOppNick', on]]) $(id).textContent = v;
  bSetup.clear(); bEnemy.clear(); bMine.clear();
  if (m.phase === 'placing') { if (!m.resume) sfx.match(); enterSetup(m); } else enterBattle(m);
}
function jsRandomPlacement() {
  for (;;) {
    const occ = new Set(), out = []; let ok = true;
    for (const f of [...S.fleet].sort((a, b) => b.len - a.len)) {
      let placed = false;
      for (let t = 0; t < 200 && !placed; t++) {
        const dir = Math.random() < 0.5 ? 'h' : 'v', x = Math.floor(Math.random() * (dir === 'h' ? N - f.len + 1 : N)), y = Math.floor(Math.random() * (dir === 'v' ? N - f.len + 1 : N));
        const cells = Array.from({ length: f.len }, (_, i) => (dir === 'h' ? y * N + x + i : (y + i) * N + x)); if (cells.some((c) => occ.has(c))) continue;
        cells.forEach((c) => occ.add(c)); out.push({ id: f.id, x, y, dir }); placed = true;
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return out;
  }
}
function enterSetup(m) {
  showView('setup'); S.place = { ships: new Map(), sel: S.fleet[0] ? S.fleet[0].id : null, dir: 'h', locked: false, deadline: m.placeDeadline };
  bSetup.setMode('place'); $('setupStatus').textContent = m.oppReady ? 'Opponent is parked and ready.' : (m.opp.cpu ? '' : 'Waiting on your opponent…'); $('readyBtn').disabled = true; $('readyBtn').textContent = 'READY';
  if (m.ready && m.myShips) { onReady({ myShips: m.myShips }); } else renderSetup();
}
const shipDef = (id) => S.fleet.find((f) => f.id === id);
function renderSetup() {
  const P = S.place; if (!P) return;
  bSetup.setShips([...P.ships].map(([id, p]) => ({ ...shipDef(id), ...p })));
  const tl = $('trayList'); tl.replaceChildren();
  for (const f of S.fleet) {
    const placed = P.ships.has(f.id), b = el('button', 'trayItem' + (P.sel === f.id ? ' sel' : '') + (placed ? ' done' : '')); b.type = 'button'; b.disabled = P.locked;
    b.append(thumb(f.kind, f.id, f.len, 'ok', 24), el('span', '', f.name), el('span', 'sp', placed ? '✓ parked' : f.len + ' cells'));
    b.addEventListener('click', () => { sfx.click(); if (placed) { P.ships.delete(f.id); } P.sel = f.id; renderSetup(); updatePreview(); }); tl.append(b);
  }
  $('readyBtn').disabled = P.locked || P.ships.size !== S.fleet.length;
  for (const id of ['rotBtn', 'randBtn', 'clrBtn']) $(id).disabled = P.locked;
}
function anchor(f, x, y, dir) { return { x: dir === 'h' ? Math.min(x, N - f.len) : x, y: dir === 'v' ? Math.min(y, N - f.len) : y }; }
function fits(f, x, y, dir, ignoreId) {
  const occ = new Set(); for (const [id, p] of S.place.ships) { if (id === ignoreId) continue; const d = shipDef(id); for (let i = 0; i < d.len; i++) occ.add(p.dir === 'h' ? p.y * N + p.x + i : (p.y + i) * N + p.x); }
  for (let i = 0; i < f.len; i++) if (occ.has(dir === 'h' ? y * N + x + i : (y + i) * N + x)) return false; return true;
}
let lastHover = null;
function updatePreview() {
  const P = S.place; if (!P || P.locked || P.sel === null || !lastHover) { bSetup.preview = null; return; }
  const f = shipDef(P.sel), a = anchor(f, lastHover.x, lastHover.y, P.dir); bSetup.preview = { ship: f, x: a.x, y: a.y, dir: P.dir, ok: fits(f, a.x, a.y, P.dir) };
}
bSetup.onHover = (c) => { lastHover = c; updatePreview(); };
bSetup.onCell = (cx, cy) => {
  const P = S.place; if (!P || P.locked) return; lastHover = { x: cx, y: cy };
  if (P.sel === null) { const s = bSetup.shipAt(cx, cy); if (s) { P.ships.delete(s.id); P.sel = s.id; P.dir = s.dir; sfx.click(); renderSetup(); updatePreview(); } return; }
  const f = shipDef(P.sel), a = anchor(f, cx, cy, P.dir);
  if (!fits(f, a.x, a.y, P.dir)) { sfx.tick(); toast('Something is already parked there', true); return; }
  P.ships.set(f.id, { x: a.x, y: a.y, dir: P.dir }); sfx.place();
  const nxt = S.fleet.find((q) => !P.ships.has(q.id)); P.sel = nxt ? nxt.id : null; renderSetup(); updatePreview();
};
const rotate = () => { const P = S.place; if (!P || P.locked) return; P.dir = P.dir === 'h' ? 'v' : 'h'; sfx.click(); updatePreview(); };
bSetup.onAlt = rotate; $('rotBtn').addEventListener('click', rotate);
document.addEventListener('keydown', (e) => { if ((e.key === 'r' || e.key === 'R') && S.view === 'setup' && !(e.target instanceof HTMLInputElement)) rotate(); });
$('randBtn').addEventListener('click', () => { const P = S.place; if (!P || P.locked) return; P.ships.clear(); for (const s of jsRandomPlacement()) P.ships.set(s.id, { x: s.x, y: s.y, dir: s.dir }); P.sel = null; sfx.place(); renderSetup(); updatePreview(); });
$('clrBtn').addEventListener('click', () => { const P = S.place; if (!P || P.locked) return; P.ships.clear(); P.sel = S.fleet[0].id; renderSetup(); updatePreview(); });
$('readyBtn').addEventListener('click', () => { const P = S.place; if (!P || P.locked || P.ships.size !== S.fleet.length) return; P.locked = true; sfx.match(); send({ t: 'place', ships: [...P.ships].map(([id, p]) => ({ id, x: p.x, y: p.y, dir: p.dir })) }); $('readyBtn').disabled = true; $('readyBtn').textContent = 'Locked in…'; $('setupStatus').textContent = 'Waiting for the opponent…'; renderSetup(); });
$('leaveSetup').addEventListener('click', () => { send({ t: 'leave' }); });
function onReady(m) {
  if (!S.place) S.place = { ships: new Map(), sel: null, dir: 'h', locked: true };
  S.place.locked = true; S.place.ships = new Map(m.myShips.map((s) => [s.id, { x: s.x, y: s.y, dir: s.dir }])); S.place.sel = null; bSetup.preview = null; renderSetup();
  $('readyBtn').textContent = 'Locked in'; $('readyBtn').disabled = true; $('setupStatus').textContent = m.auto ? 'Time! Your fleet was parked for you. Waiting for the opponent…' : 'Waiting for the opponent…';
}
setInterval(() => { const P = S.place; if (S.view !== 'setup' || !P || !P.deadline) return; const s = Math.max(0, Math.round((P.deadline - Date.now()) / 1000)); $('setupTimer').textContent = s + 's'; $('setupTimer').className = 'pill' + (s <= 10 ? ' bad' : ''); }, 250);

// ---------- battle ----------
function pips(root, n) { root.replaceChildren(); for (let i = 0; i < S.fleet.length; i++) root.append(el('i', i < n ? '' : 'dead')); }
function chips(root, sunkIds) { root.replaceChildren(); for (const f of S.fleet) { const c = el('span', 'chip' + (sunkIds.has(f.id) ? ' dead' : '')); c.append(thumb(f.kind, f.id, f.len, sunkIds.has(f.id) ? 'burnt' : 'ok', 18), document.createTextNode(f.name)); root.append(c); } }
function refreshFleetUi() {
  pips($('hMePips'), S.left.me); pips($('hOppPips'), S.left.opp);
  chips($('enemyFleet'), new Set(bEnemy.ships.filter((s) => s.sunk).map((s) => s.id))); chips($('myFleet'), new Set(bMine.ships.filter((s) => s.sunk).map((s) => s.id)));
}
function enterBattle(m) {
  showView('battle'); $('log').replaceChildren(); S.over = false; S.myTurn = false; S.locked = true;
  const mine = (m.myShips || []).map((s) => ({ ...s })); bMine.setShips(mine);
  for (const h of m.history || []) {
    if (h.by === 'opp') bMine.mark(h.x, h.y, h.res, h.sunk); else { bEnemy.mark(h.x, h.y, h.res, h.sunk); if (h.sunk) bEnemy.addRevealed(h.sunk, true); }
  }
  bEnemy.setMode('off'); refreshFleetUi(); buildTaunts(); $('turnTxt').textContent = 'Battle!'; $('turnTxt').className = 'turnTxt';
  if (m.deadline) { S.deadline = m.deadline; S.myTurn = !!m.mine; S.locked = false; setTurnUi(); }
  if (m.mode === 'cpu') $('taunts').hidden = true; else $('taunts').hidden = false;
}
const logLine = (html, cls) => { const li = el('li', cls); for (const part of html) { if (typeof part === 'string') li.append(document.createTextNode(part)); else li.append(el('b', part.c, part.t)); } const lg = $('log'); lg.prepend(li); while (lg.children.length > 6) lg.lastChild.remove(); };
function setTurnUi() {
  const t = $('turnTxt'); t.textContent = S.myTurn ? 'YOUR SHOT — FIRE!' : 'Opponent is aiming…'; t.className = 'turnTxt ' + (S.myTurn ? 'mine' : 'opp');
  bEnemy.setMode(S.myTurn && !S.locked && !S.over ? 'target' : 'off'); $('fireBtn').disabled = true; $('enemyHint').textContent = S.myTurn ? 'tap a square to aim, tap again to fire' : 'wait for your turn';
  if (!matchMedia('(pointer:coarse)').matches) $('enemyHint').textContent = S.myTurn ? 'click a square to fire' : 'wait for your turn';
  $('fireBtn').hidden = !matchMedia('(pointer:coarse)').matches;
}
setInterval(() => {
  if (S.view !== 'battle' || S.over || !S.deadline) return; const left = Math.max(0, S.deadline - Date.now()), f = Math.min(1, left / S.turnMs);
  $('tbar').style.transform = `scaleX(${f})`; $('tbar').parentElement.classList.toggle('low', left < 8000); $('turnSub').textContent = Math.ceil(left / 1000) + 's';
  if (S.myTurn && left > 0 && left < 5200 && Math.ceil(left / 1000) !== S.lastTick) { S.lastTick = Math.ceil(left / 1000); sfx.tick(); }
}, 200);
async function pump() {
  if (S.pumping) return; S.pumping = true;
  try { while (S.uiq.length) { const m = S.uiq.shift(); await handleBattleMsg(m); } } finally { S.pumping = false; }
}
async function handleBattleMsg(m) {
  if (m.t === 'battle') { S.turnMs = m.turnMs || 30000; S.left = m.left || S.left; showView('battle'); enterBattle({ ...S.match, history: [], myShips: [...S.place.ships].map(([id, p]) => ({ ...shipDef(id), ...p })), mode: S.match.mode }); refreshFleetUi(); toast(m.youFirst ? 'You fire first!' : 'Opponent fires first'); sfx.turn(); bEnemy.setMode('off'); await sleep(300); return; }
  if (m.t === 'turn') { S.myTurn = m.mine; S.deadline = m.deadline; S.locked = false; setTurnUi(); if (m.mine && S.view === 'battle') sfx.turn(); return; }
  if (m.t === 'shot') {
    S.left = m.left || S.left; const mineShot = m.by === 'me', board = mineShot ? bEnemy : bMine; bEnemy.setMode('off'); $('fireBtn').disabled = true;
    await new Promise((res) => board.shoot(m.x, m.y, m.res, m.sunk, !mineShot, res));
    const who = mineShot ? 'You' : 'Opponent', cn = cellName(m.x, m.y);
    if (m.res === 'sunk') { if (mineShot && m.sunk) bEnemy.addRevealed(m.sunk, true); showBanner(mineShot ? 'DUB KNOCKED OUT!' : 'YOUR DUB IS OUT!', m.sunk ? m.sunk.name : '', mineShot ? bEnemy : bMine); }
    logLine([`${who} fired at ${cn}: `, m.res === 'miss' ? { c: 'm', t: 'MISS' } : m.res === 'hit' ? { c: 'h', t: 'DIRECT HIT!' } : { c: 'k', t: 'KNOCKED OUT ' + (m.sunk ? m.sunk.name : '') + '!' }, m.auto ? ' (auto-fired, out of time)' : ''], mineShot ? 'me' : '');
    refreshFleetUi(); await sleep(m.res === 'sunk' ? 1300 : 350); return;
  }
  if (m.t === 'over') { await sleep(250); showOver(m); }
}
let bannerT = 0;
function showBanner(text, sub, board) { const b = $('banner'); b.replaceChildren(document.createTextNode(text)); if (sub) b.append(el('small', '', sub)); b.hidden = false; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; clearTimeout(bannerT); bannerT = setTimeout(() => { b.hidden = true; }, 1500); b.style.top = board === bMine ? '34%' : '34%'; }
bEnemy.onCell = (x, y, pt) => {
  if (!S.myTurn || S.locked || S.over) return; if (bEnemy.marks.has(y * N + x)) { sfx.tick(); return; }
  if (pt === 'mouse') return doFire(x, y);
  if (bEnemy.target && bEnemy.target.x === x && bEnemy.target.y === y) return doFire(x, y);
  bEnemy.target = { x, y }; $('fireBtn').disabled = false; sfx.click(); $('enemyHint').textContent = 'aimed at ' + cellName(x, y) + ': tap FIRE';
};
$('fireBtn').addEventListener('click', () => { const t = bEnemy.target; if (t && S.myTurn && !S.locked) doFire(t.x, t.y); });
function doFire(x, y) { S.locked = true; bEnemy.target = null; bEnemy.setMode('off'); $('fireBtn').disabled = true; send({ t: 'fire', x, y }); }
function buildTaunts() { const r = $('taunts'); r.replaceChildren(); TAUNTS.forEach((t, i) => { const b = el('button', '', t); b.type = 'button'; b.addEventListener('click', () => { send({ t: 'taunt', id: i }); sfx.chat(); toast('You: ' + t); }); r.append(b); }); }
function showTaunt(id) { const t = TAUNTS[id]; if (!t) return; const b = $('bubble'); b.textContent = t; b.hidden = false; sfx.chat(); clearTimeout(showTaunt.t); showTaunt.t = setTimeout(() => { b.hidden = true; }, 3200); }
let fgT = 0;
$('forfeitBtn').addEventListener('click', () => { if (S.over) return; if (!$('forfeitBtn').dataset.arm) { $('forfeitBtn').dataset.arm = '1'; $('forfeitBtn').textContent = 'Tap again to forfeit'; fgT = setTimeout(() => { delete $('forfeitBtn').dataset.arm; $('forfeitBtn').textContent = '🏳️ Forfeit'; }, 3000); return; } clearTimeout(fgT); delete $('forfeitBtn').dataset.arm; $('forfeitBtn').textContent = '🏳️ Forfeit'; send({ t: 'leave' }); });

// ---------- game over ----------
const REASONS = { sunk: 'Every dub knocked out', forfeit: 'forfeited', timeout: 'ran out of time (3 missed turns)', disconnect: 'left the lot', abandoned: 'Match was abandoned' };
function showOver(m) {
  S.over = true; S.myTurn = false; bEnemy.setMode('off'); if (m.me) { S.me = { ...S.me, ...m.me }; renderMe(); }
  for (const s of m.reveal || []) bEnemy.addRevealed(s, false);
  const o = $('over'); o.hidden = false; const win = m.win;
  $('overTitle').textContent = m.reason === 'abandoned' ? 'OPPONENT LEFT' : win ? 'VICTORY!' : 'DEFEATED'; $('overTitle').className = 'overTitle' + (win ? '' : ' lose');
  let sub = ''; const opp = S.match ? S.match.opp.nick : 'Opponent';
  if (m.reason === 'sunk') sub = win ? `You knocked out all of ${opp}'s dubs!` : `${opp} knocked out your whole fleet.`;
  else if (m.reason === 'abandoned') sub = `${opp} left before the battle started.`;
  else sub = win ? `${opp} ${REASONS[m.reason] || 'left'}. You win!` : `You ${REASONS[m.reason] || 'lost'}.`;
  $('overSub').textContent = sub; if (m.reason !== 'abandoned') (win ? sfx.win : sfx.lose)();
  const st = $('overStats'); st.replaceChildren();
  if (m.shots) { const acc = m.shots.me ? Math.round((m.shots.meHits / m.shots.me) * 100) : 0; st.append(statBox(m.shots.me, 'SHOTS'), statBox(m.shots.meHits, 'HITS'), statBox(acc + '%', 'ACCURACY')); }
  const note = $('overNote'); const ranked = m.ranked;
  note.textContent = !ranked ? 'Practice game vs the CPU: not on the leaderboard.' : m.counted ? (m.note === 'short' ? 'Game was too short to award a win.' : 'Counted on the live leaderboard.') : m.note === 'cap' ? 'Friendly game: you two have played a lot today, so it did not count.' : 'Not counted.';
  const pvp = S.match && S.match.mode === 'pvp' && m.canRematch; $('rematchBtn').hidden = !pvp; $('rematchBtn').disabled = false; $('rematchBtn').textContent = '🔁 Rematch'; $('againBtn').hidden = !!pvp && false;
  $('againBtn').textContent = S.match && S.match.mode === 'cpu' ? '🔁 Play again' : '🤖 Play CPU';
  $('againBtn').dataset.level = S.match && S.match.level ? S.match.level : 'easy';
}
$('rematchBtn').addEventListener('click', () => { send({ t: 'rematch' }); $('rematchBtn').textContent = 'Waiting for opponent…'; $('rematchBtn').disabled = true; });
$('againBtn').addEventListener('click', () => { send({ t: 'cpu', level: $('againBtn').dataset.level || 'easy' }); });
$('lobbyBtn').addEventListener('click', () => { send({ t: 'leave' }); showView('lobby'); });

{ const p = saved(); if (p) $('nick').value = p.nick; }
buildAvatarPickers(); renderMe(); connect();
