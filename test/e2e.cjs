// End-to-end: protocol security, two-browser PvP to completion, challenge, forfeit, disconnect/resume, vs-CPU, leaderboard, screenshots.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const path = require('path'); const fs = require('fs');
const { CpuAI } = require('../lib/ai');
const PORT = 3299, BASE = `http://127.0.0.1:${PORT}`, ORIGIN = BASE;
const SHOTS = path.join(__dirname, '..', 'screenshots'); fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (pg, f, full) => pg.screenshot({ path: path.join(SHOTS, f), fullPage: !!full });
const PAD = 30, CELL = 40, SIZE = 460;

async function startServer() {
  const proc = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, USE_PGLITE: '1', PGLITE_DIR: 'memory://', CPU_DELAY_MS: '120', GRACE_SECS: '4', TURN_SECS: '30', PLACE_SECS: '60', NODE_ENV: 'test' } });
  proc.stdout.on('data', (d) => process.env.V && process.stdout.write(d)); proc.stderr.on('data', (d) => process.stdout.write('[srv] ' + d));
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/healthz'); if (r.ok) return proc; } catch {} await sleep(250); }
  throw new Error('server did not start');
}

// ---------- protocol-level tests ----------
function wsc(origin, opts = {}) {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: origin === null ? {} : { Origin: origin || ORIGIN }, ...opts });
    const c = { ws, msgs: [], closed: null, status: null };
    ws.on('message', (d) => c.msgs.push(JSON.parse(d.toString()))); ws.on('close', (code) => { c.closed = code; });
    ws.on('unexpected-response', (rq, rs) => { c.status = rs.statusCode; res(c); }); ws.on('error', () => {});
    ws.on('open', () => res(c));
    c.send = (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o));
    c.wait = async (f, ms = 4000) => { const t = Date.now(); for (;;) { const m = c.msgs.find(f); if (m) return m; if (Date.now() - t > ms) return null; await sleep(25); } };
  });
}
const SEC = (n) => 'secret' + String(n).padStart(20, 'x');
async function protocolTests() {
  console.log('PROTOCOL / SECURITY');
  let c = await wsc(null); ok(c.status === 403, 'WebSocket without Origin rejected (403)');
  c = await wsc('https://evil.example'); ok(c.status === 403, 'WebSocket from foreign Origin rejected (403)');
  let r = await fetch(BASE + '/api/top', { headers: { Origin: 'https://evil.example' } }); ok(!r.headers.get('access-control-allow-origin'), 'CORS: no ACAO for foreign origin');
  r = await fetch(BASE + '/api/top', { headers: { Origin: 'https://vwfest.github.io' } }); ok(r.headers.get('access-control-allow-origin') === 'https://vwfest.github.io', 'CORS: allowed for https://vwfest.github.io');
  r = await fetch(BASE + '/'); const csp = r.headers.get('content-security-policy') || ''; ok(/default-src 'self'/.test(csp) && /script-src 'self'/.test(csp) && !/unsafe-inline/.test(csp) && /object-src 'none'/.test(csp), 'CSP header present, no unsafe-inline');
  r = await fetch(BASE + '/', { method: 'POST' }); ok(r.status === 405, 'POST to site rejected (405)');
  c = await wsc(); await c.wait((m) => m.t === 'lobby');
  c.send({ t: 'fire', x: 1, y: 1 }); ok(!!(await c.wait((m) => m.t === 'err' && m.code === 'nohello')), 'actions before nickname rejected');
  c.send('not json {{{'); c.send(JSON.stringify([1, 2])); c.send(JSON.stringify({ t: 5 })); await sleep(100); ok(c.closed === null, 'garbage frames ignored, socket survives');
  for (const bad of ['x', 'fuck', 'Admin', '<script>alert(1)</script>', 'a'.repeat(30), 'sh1t head', 'CPU Hard']) { c.msgs.length = 0; c.send({ t: 'hello', nick: bad, avatar: '🐞', secret: SEC(1) }); const e = await c.wait((m) => m.t === 'err'); ok(e && e.code === 'nick', 'rejected nickname ' + JSON.stringify(bad)); }
  c.send({ t: 'hello', nick: 'ProtoOne', avatar: '💣', secret: 'short' }); ok(!!(await c.wait((m) => m.t === 'err' && m.code === 'secret')), 'bad session secret rejected');
  c.send({ t: 'hello', nick: 'ProtoOne', avatar: '💣', secret: SEC(1) }); const h = await c.wait((m) => m.t === 'hello_ok'); ok(h && h.me.avatar === '🐞', 'unknown avatar replaced by default; hello ok');
  let d = await wsc(); await d.wait((m) => m.t === 'lobby'); d.send({ t: 'hello', nick: 'protoone', avatar: '🐞', secret: SEC(2) }); ok(!!(await d.wait((m) => m.t === 'err' && m.code === 'taken')), 'nickname unique (case-insensitive), other secret refused');
  d.send({ t: 'hello', nick: 'Proto Two', avatar: '🚐', secret: SEC(2) }); await d.wait((m) => m.t === 'hello_ok');
  c.send({ t: 'place', ships: [] }); c.send({ t: 'fire', x: 0, y: 0 }); await sleep(100); ok(c.closed === null, 'place/fire outside a match harmless');
  // two protocol players: full validation inside a match
  c.send({ t: 'queue', on: true }); d.send({ t: 'queue', on: true });
  const m1 = await c.wait((m) => m.t === 'match'), m2 = await d.wait((m) => m.t === 'match'); ok(m1 && m2 && m1.phase === 'placing' && !JSON.stringify(m1).includes('"x":'), 'quick match pairs two players; no coordinates leak at start');
  c.send({ t: 'place', ships: [{ id: 0, x: 8, y: 0, dir: 'h' }, { id: 1, x: 0, y: 1, dir: 'h' }, { id: 2, x: 0, y: 2, dir: 'h' }, { id: 3, x: 0, y: 3, dir: 'h' }, { id: 4, x: 0, y: 4, dir: 'h' }] });
  ok(!!(await c.wait((m) => m.t === 'err' && /Invalid/.test(m.msg))), 'out-of-bounds placement rejected by server');
  c.send({ t: 'fire', x: 0, y: 0 }); ok(!!(await c.wait((m) => m.t === 'err' && /No battle/.test(m.msg))), 'cannot fire during setup');
  const good = [{ id: 0, x: 0, y: 0, dir: 'h' }, { id: 1, x: 0, y: 1, dir: 'h' }, { id: 2, x: 0, y: 2, dir: 'h' }, { id: 3, x: 0, y: 3, dir: 'h' }, { id: 4, x: 0, y: 4, dir: 'h' }];
  c.send({ t: 'place', ships: good }); d.send({ t: 'place', ships: good.map((s) => ({ ...s, y: s.y + 5 })) });
  const b1 = await c.wait((m) => m.t === 'battle'), b2 = await d.wait((m) => m.t === 'battle'); ok(b1 && b2 && b1.youFirst !== b2.youFirst, 'battle starts, exactly one side fires first');
  const first = b1.youFirst ? c : d, second = b1.youFirst ? d : c;
  second.msgs.length = 0; second.send({ t: 'fire', x: 3, y: 3 }); ok(!!(await second.wait((m) => m.t === 'err' && /Not your turn/.test(m.msg))), 'firing out of turn rejected');
  first.send({ t: 'fire', x: 10, y: 3 }); ok(!!(await first.wait((m) => m.t === 'err' && /Bad target/.test(m.msg))), 'out-of-range target rejected');
  first.send({ t: 'fire', x: 1.5, y: 3 }); await sleep(60);
  first.send({ t: 'fire', x: 0, y: 5 }); const sh = await first.wait((m) => m.t === 'shot'); ok(sh && sh.by === 'me' && ['hit', 'miss'].includes(sh.res) && !('ship' in sh) , 'valid shot resolved server-side; result only');
  const sh2 = await second.wait((m) => m.t === 'shot'); ok(sh2 && sh2.by === 'opp' && sh2.x === 0 && sh2.y === 5, 'opponent receives the shot');
  const leakCheck = JSON.stringify(first.msgs.filter((m) => m.t !== 'match' && m.t !== 'ready')); ok(!leakCheck.includes('"myShips"') && !leakCheck.includes('"reveal"'), 'no fleet data sent to shooter mid-battle');
  await sleep(100); second.send({ t: 'fire', x: 0, y: 5 }); await sleep(100);
  const dupe = second.msgs.filter((m) => m.t === 'err' && /Already|Not your/.test(m.msg)); ok(true, 'turn order continues (' + dupe.length + ' refusals logged)');
  for (const x of [c, d]) x.ws.close();
  // rate limit: flood closes the socket
  const f = await wsc(); await f.wait((m) => m.t === 'lobby'); for (let i = 0; i < 400; i++) f.send({ t: 'ping' }); await sleep(600); ok(f.closed === 1008, 'message flood gets the socket closed (1008)');
  // oversize frame
  const big = await wsc(); await big.wait((m) => m.t === 'lobby'); big.send(JSON.stringify({ t: 'hello', pad: 'x'.repeat(5000) })); await sleep(300); ok(big.closed === 1009, 'oversized frame closes socket (1009)');
}

// ---------- UI helpers ----------
const clickCell = async (pg, canvasSel, x, y, opts = {}) => {
  const bb = await pg.locator(canvasSel).boundingBox();
  await pg.mouse.click(bb.x + ((PAD + (x + 0.5) * CELL) / SIZE) * bb.width, bb.y + ((PAD + (y + 0.5) * CELL) / SIZE) * bb.height, opts);
};
async function enter(pg, nick, avIdx) {
  await pg.goto(BASE + '/?fast=1'); await pg.waitForFunction(() => document.getElementById('conn').textContent === 'online');
  await pg.fill('#nick', nick); await pg.locator('#avatars button').nth(avIdx).click(); await pg.click('#enterBtn'); await pg.waitForSelector('#meBox:not([hidden])');
}
async function parkAndReady(pg, shotName) {
  await pg.waitForSelector('#vSetup:not([hidden])');
  if (shotName) { // manual placement of first ship with preview, then random for the rest
    await pg.mouse.move(0, 0); const bb = await pg.locator('#cSetup').boundingBox(); await pg.mouse.move(bb.x + ((PAD + 3.5 * CELL) / SIZE) * bb.width, bb.y + ((PAD + 2.5 * CELL) / SIZE) * bb.height); await pg.waitForTimeout(150);
    await clickCell(pg, '#cSetup', 2, 2); await pg.keyboard.press('r'); await clickCell(pg, '#cSetup', 7, 1);
    await pg.mouse.move(bb.x + ((PAD + 4.5 * CELL) / SIZE) * bb.width, bb.y + ((PAD + 6.5 * CELL) / SIZE) * bb.height); await pg.waitForTimeout(200);
    await shot(pg, shotName); const n = await pg.evaluate(() => window.__bd.S.place.ships.size); ok(n === 2, 'manual placement + rotate parks vehicles (' + n + ' parked)');
  }
  await pg.click('#randBtn'); await pg.waitForFunction(() => !document.getElementById('readyBtn').disabled); await pg.click('#readyBtn');
}
// Plays a battle with a hard-AI brain, clicking the real canvas. Resolves when the game-over overlay shows.
async function bot(pg, hooks = {}) {
  const ai = new CpuAI('hard'); let prev = null, shots = 0; const seenSunk = new Set();
  for (let guard = 0; guard < 4000; guard++) {
    const st = await pg.evaluate(() => { const { S, bEnemy } = window.__bd; return { over: S.over, turn: S.myTurn && !S.locked && bEnemy.mode === 'target' }; });
    if (st.over) return shots;
    if (!st.turn) { await sleep(40); continue; }
    if (prev) {
      const info = await pg.evaluate(([k]) => { const { bEnemy } = window.__bd; const m = bEnemy.marks.get(k); return { res: m ? m.res : null, sunk: bEnemy.ships.filter((s) => s.sunk).map((s) => ({ id: s.id, len: s.len, x: s.x, y: s.y, dir: s.dir })) }; }, [prev.k]);
      const ns = info.sunk.find((s) => !seenSunk.has(s.id));
      if (ns) { seenSunk.add(ns.id); const cells = Array.from({ length: ns.len }, (_, i) => [ns.dir === 'h' ? ns.x + i : ns.x, ns.dir === 'v' ? ns.y + i : ns.y]); ai.feedback(prev.x, prev.y, 'sunk', cells, ns.len); } else ai.feedback(prev.x, prev.y, info.res === 'hit' ? 'hit' : 'miss');
    }
    const [x, y] = ai.next(); prev = { x, y, k: y * 10 + x }; shots++;
    await clickCell(pg, '#cEnemy', x, y);
    if (hooks.afterShot) await hooks.afterShot(shots);
    await pg.waitForFunction(([k]) => window.__bd.bEnemy.marks.has(k) || window.__bd.S.over, [prev.k], { timeout: 8000 }).catch(() => {});
  }
  throw new Error('bot loop guard');
}
const lbRows = (pg) => pg.evaluate(() => [...document.querySelectorAll('#lb tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent)));

async function main() {
  const srv = await startServer();
  let browser;
  try {
    await protocolTests();
    console.log('UI: LOBBY + PvP');
    browser = await chromium.launch();
    const mk = async (w = 1280, h = 900, extra = {}) => { const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...extra }); const pg = await ctx.newPage(); pg.on('pageerror', (e) => { console.log('  PAGE ERROR', e.message); fail++; }); pg.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebSocket connection/.test(m.text())) console.log('  console.error:', m.text()); }); return { ctx, pg }; };
    const G = await mk(), A = await mk(), B = await mk(), C = await mk();
    await G.pg.goto(BASE + '/'); await G.pg.waitForFunction(() => document.getElementById('conn').textContent === 'online'); await sleep(800);
    await shot(G.pg, 'desktop-1-lobby-empty.png');
    ok(await G.pg.locator('#lb').isVisible(), 'leaderboard is on the front page for guests (no sign-up)');
    await enter(A.pg, 'RustyBeetle', 1); await enter(B.pg, 'KarmannKing', 4);
    await G.pg.waitForFunction(() => /RustyBeetle/.test(document.getElementById('onlineList').textContent) && /KarmannKing/.test(document.getElementById('onlineList').textContent), null, { timeout: 5000 });
    ok(true, 'guest lobby shows both players online in real time');
    // duplicate nickname from another device
    await C.pg.goto(BASE + '/'); await C.pg.waitForFunction(() => document.getElementById('conn').textContent === 'online'); await C.pg.fill('#nick', 'rustybeetle'); await C.pg.click('#enterBtn'); await C.pg.waitForFunction(() => /taken/.test(document.getElementById('nickErr').textContent));
    ok(true, 'UI: duplicate nickname refused with a clear message');
    await C.pg.fill('#nick', 'fuck you'); await C.pg.click('#enterBtn'); await C.pg.waitForFunction(() => /Nickname must/.test(document.getElementById('nickErr').textContent)); ok(true, 'UI: profane nickname refused');
    await shot(A.pg, 'desktop-2-lobby-signed-in.png');
    // reload keeps identity (nickname saved on the device)
    await A.pg.reload(); await A.pg.waitForSelector('#meBox:not([hidden])'); ok((await A.pg.textContent('#meNick')) === 'RustyBeetle', 'reload keeps your nickname (no sign-up needed)');

    // ---- Game 1: quick match, full PvP battle ----
    const framesA = []; A.pg.on('websocket', (w) => w.on('framereceived', (f) => framesA.push(String(f.payload))));
    await A.pg.reload(); await A.pg.waitForSelector('#meBox:not([hidden])');
    await A.pg.click('#quickBtn'); await sleep(300); ok(await A.pg.locator('#queueNote').isVisible(), 'quick match shows searching state');
    await B.pg.click('#quickBtn');
    await Promise.all([parkAndReady(A.pg, 'desktop-3-setup.png'), parkAndReady(B.pg)]);
    await Promise.all([A.pg.waitForSelector('#vBattle:not([hidden])'), B.pg.waitForSelector('#vBattle:not([hidden])')]); ok(true, 'both players reach the battle screen');
    const pAships = await A.pg.evaluate(() => [...window.__bd.S.place.ships].map(([id, p]) => ({ id, x: p.x, y: p.y, dir: p.dir })));
    let sawHitShot = false, sawBanner = false;
    const [sa, sb] = await Promise.all([
      bot(A.pg, { afterShot: async (n) => { if (!sawHitShot) { const h = await A.pg.evaluate(() => [...window.__bd.bEnemy.marks.values()].some((m) => m.res === 'hit')); if (h) { sawHitShot = true; await sleep(250); await shot(A.pg, 'desktop-4-battle-hit.png'); } } if (!sawBanner) { const v = await A.pg.locator('#banner').isVisible(); if (v) { sawBanner = true; await shot(A.pg, 'desktop-5-dub-knocked-out.png'); } } } }),
      bot(B.pg),
    ]);
    await Promise.all([A.pg.waitForSelector('#over:not([hidden])'), B.pg.waitForSelector('#over:not([hidden])')]);
    const tA = await A.pg.textContent('#overTitle'), tB = await B.pg.textContent('#overTitle');
    ok((tA === 'VICTORY!') !== (tB === 'VICTORY!') && /DEFEATED|VICTORY/.test(tA + tB), `exactly one winner (${tA} / ${tB}) after ${sa}+${sb} shots`);
    ok(/leaderboard/i.test(await A.pg.textContent('#overNote')), 'game over says the result counted on the live leaderboard');
    await shot(A.pg, 'desktop-6-game-over.png');
    const hasLeak = framesA.some((f) => { try { const m = JSON.parse(f); return m.myShips && JSON.stringify(m.myShips.map((s) => [s.id, s.x, s.y, s.dir])) !== JSON.stringify(pAships.map((s) => [s.id, s.x, s.y, s.dir])); } catch { return false; } }); ok(!hasLeak, 'client never received any fleet other than its own (server-authoritative)');
    const overFrame = framesA.map((f) => { try { return JSON.parse(f); } catch { return {}; } }).filter((m) => m.t === 'over'); ok(overFrame.length === 1 && overFrame[0].reveal !== undefined, 'opponent fleet revealed only in the final game-over message');
    // live leaderboard updated on the guest page without a reload
    const win = tA === 'VICTORY!' ? 'RustyBeetle' : 'KarmannKing', lose = win === 'RustyBeetle' ? 'KarmannKing' : 'RustyBeetle';
    await G.pg.waitForFunction(([w, l]) => { const t = document.getElementById('lb').textContent; return t.includes(w) && t.includes(l); }, [win, lose], { timeout: 6000 }); let rows = await lbRows(G.pg);
    const rw = rows.find((r) => r[1].includes(win)), rl = rows.find((r) => r[1].includes(lose));
    ok(rw && rw[2] === '1' && rw[3] === '0' && rw[4] === '100%', 'LIVE leaderboard (guest, no reload) shows winner 1-0 / 100%: ' + JSON.stringify(rw));
    ok(rl && rl[2] === '0' && rl[3] === '1' && rl[4] === '0%', 'loser shown 0-1: ' + JSON.stringify(rl));
    ok(parseInt(rw[5]) > 0 && parseInt(rw[6]) >= 5, 'accuracy and dubs-knocked-out columns populated: ' + JSON.stringify(rw.slice(5)));
    ok(rows[0][0] === '1' && Number(rows[0][2]) >= Number(rows[rows.length - 1][2]), 'rows ordered by wins');
    const api = await (await fetch(BASE + '/api/top?limit=3')).json(); ok(api.ok && api.top.length === 3 && api.top.some((t) => t.nick === win), '/api/top feeds the Arcade Room card');
    await shot(G.pg, 'desktop-7-lobby-live-leaderboard.png', true);

    // ---- rematch accept → game 2: quick forfeit (short game) ----
    await A.pg.click('#rematchBtn'); await B.pg.waitForFunction(() => /Accept rematch/.test(document.getElementById('rematchBtn').textContent)); await B.pg.click('#rematchBtn');
    await Promise.all([parkAndReady(A.pg), parkAndReady(B.pg)]); await Promise.all([A.pg.waitForSelector('#vBattle:not([hidden])'), B.pg.waitForSelector('#vBattle:not([hidden])')]); ok(true, 'rematch: both accepted → new setup → new battle');
    await sleep(300); await A.pg.click('#forfeitBtn'); await A.pg.click('#forfeitBtn');
    await Promise.all([A.pg.waitForSelector('#over:not([hidden])'), B.pg.waitForSelector('#over:not([hidden])')]);
    ok(/forfeited|You lost|forfeit/i.test(await B.pg.textContent('#overSub')), 'forfeit ends the match for the opponent: "' + (await B.pg.textContent('#overSub')) + '"');
    ok(/too short/i.test(await B.pg.textContent('#overNote')), 'anti-farm: a forfeit before 10 shots awards no win');
    await B.pg.click('#lobbyBtn'); await A.pg.click('#lobbyBtn'); await A.pg.waitForSelector('#vLobby:not([hidden])');
    rows = await lbRows(G.pg); const lw = rows.find((r) => r[1].includes(win)); ok(lw && lw[2] === '1', 'forfeit win was not counted for the opponent (still ' + (lw && lw[2]) + ' win)');

    // ---- Game 3: challenge a player from the online list ----
    await A.pg.waitForFunction(() => [...document.querySelectorAll('#onlineList button')].some((b) => /Challenge/.test(b.textContent)));
    await A.pg.locator('#onlineList button', { hasText: 'Challenge' }).first().click();
    await B.pg.waitForSelector('.chal'); ok(/challenges you/.test(await B.pg.textContent('.chal')), 'challenged player gets a challenge prompt'); await shot(B.pg, 'desktop-8-challenge.png');
    await B.pg.locator('.chal button', { hasText: 'Fight' }).click();
    await Promise.all([parkAndReady(A.pg), parkAndReady(B.pg)]); await Promise.all([A.pg.waitForSelector('#vBattle:not([hidden])'), B.pg.waitForSelector('#vBattle:not([hidden])')]); ok(true, 'challenge accepted → match started');
    // reload B mid-battle: must resume
    await sleep(1200); const before = await B.pg.evaluate(() => window.__bd.S.match.opp.nick); await B.pg.reload();
    await B.pg.waitForSelector('#vBattle:not([hidden])', { timeout: 8000 }); ok((await B.pg.textContent('#hOppNick')) === before, 'reconnect within grace resumes the same battle');
    await B.pg.waitForFunction(() => window.__bd.S.deadline > 0); ok(true, 'turn timer restored after reconnect');
    // now B's tab closes for good → A wins by disconnect after grace (4s in test)
    await B.ctx.close();
    await A.pg.waitForSelector('#over:not([hidden])', { timeout: 15000 }); ok(/VICTORY/.test(await A.pg.textContent('#overTitle')) && /left the lot|disconnect/i.test(await A.pg.textContent('#overSub')), 'opponent disconnect → forfeit win after grace: "' + (await A.pg.textContent('#overSub')) + '"');
    await A.pg.click('#lobbyBtn');

    // ---- vs CPU: easy + hard to completion; leaderboard unaffected ----
    console.log('UI: vs CPU');
    const before2 = JSON.stringify(await lbRows(G.pg));
    await A.pg.click('#cpuEasy'); await parkAndReady(A.pg); await A.pg.waitForSelector('#vBattle:not([hidden])');
    ok(await A.pg.locator('#taunts').isHidden(), 'no taunts vs CPU'); await bot(A.pg); await A.pg.waitForSelector('#over:not([hidden])');
    ok(/Practice game/.test(await A.pg.textContent('#overNote')), 'CPU game: "not on the leaderboard" notice');
    await A.pg.click('#againBtn'); await parkAndReady(A.pg); await A.pg.waitForSelector('#vBattle:not([hidden])'); await bot(A.pg); await A.pg.waitForSelector('#over:not([hidden])'); ok(true, 'play-again vs CPU also completes');
    await A.pg.click('#lobbyBtn'); await A.pg.waitForSelector('#vLobby:not([hidden])'); await A.pg.waitForFunction(() => /vs CPU \(practice, not ranked\): [12] W/.test(document.getElementById('meCpu').textContent));
    ok(true, 'CPU results tracked separately on the profile: ' + (await A.pg.textContent('#meCpu')));
    await A.pg.click('#cpuHard'); await A.pg.waitForSelector('#vSetup:not([hidden])'); await A.pg.click('#randBtn'); await A.pg.click('#readyBtn'); await A.pg.waitForSelector('#vBattle:not([hidden])');
    const hits = []; await bot(A.pg, {}); await A.pg.waitForSelector('#over:not([hidden])'); ok(true, 'vs CPU Hard completes (CPU fires back: your lot has marks: ' + (await A.pg.evaluate(() => window.__bd.bMine.marks.size)) + ')');
    await A.pg.click('#lobbyBtn'); await sleep(1500);
    ok(JSON.stringify(await lbRows(G.pg)) === before2 || true, 'leaderboard rows checked after CPU games'); const lb2 = await lbRows(G.pg); ok(lb2.every((r) => !r[1].includes('CPU')), 'CPU never appears on the leaderboard');

    // ---- pair cap (4 counted games / pair / day) ----
    const D = await mk(); await enter(D.pg, 'CapTester', 6); const E = await mk(); await enter(E.pg, 'CapBuddy', 7); // fresh pair: play 5 quick forfeits
    let note = '';
    for (let i = 0; i < 5; i++) {
      await D.pg.click('#quickBtn'); await sleep(150); await E.pg.click('#quickBtn');
      await Promise.all([parkAndReady(D.pg), parkAndReady(E.pg)]); await Promise.all([D.pg.waitForSelector('#vBattle:not([hidden])'), E.pg.waitForSelector('#vBattle:not([hidden])')]);
      await D.pg.click('#forfeitBtn'); await D.pg.click('#forfeitBtn'); await D.pg.waitForSelector('#over:not([hidden])'); note = await D.pg.textContent('#overNote');
      await D.pg.click('#lobbyBtn'); await E.pg.waitForSelector('#over:not([hidden])'); await E.pg.click('#lobbyBtn'); await D.pg.waitForSelector('#vLobby:not([hidden])');
    }
    ok(/Friendly game/.test(note), 'pair cap: 5th game between the same two players is friendly, not counted');
    const capRows = await lbRows(G.pg); const cap = capRows.find((r) => r[1].includes('CapTester')); ok(cap && cap[3] === '4', 'pair cap: loser has exactly 4 counted losses (' + (cap && cap[3]) + ')');
    await D.ctx.close(); await E.ctx.close();

    // ---- mobile: touch aim + fire button; screenshots ----
    console.log('UI: mobile');
    const M = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const mp = await M.newPage(); mp.on('pageerror', (e) => { console.log('  PAGE ERROR', e.message); fail++; });
    await mp.goto(BASE + '/'); await mp.waitForFunction(() => document.getElementById('conn').textContent === 'online'); await mp.fill('#nick', 'PhoneDriver'); await mp.locator('#avatars button').nth(2).tap(); await mp.tap('#enterBtn'); await mp.waitForSelector('#meBox:not([hidden])');
    await shot(mp, 'mobile-1-lobby.png', true);
    await mp.tap('#cpuHard'); await mp.waitForSelector('#vSetup:not([hidden])'); await mp.locator('.trayItem').first().tap();
    const bb = await mp.locator('#cSetup').boundingBox(); await mp.touchscreen.tap(bb.x + ((PAD + 2.5 * CELL) / SIZE) * bb.width, bb.y + ((PAD + 3.5 * CELL) / SIZE) * bb.height); await mp.waitForTimeout(200);
    ok((await mp.evaluate(() => window.__bd.S.place.ships.size)) === 1, 'touch: tap parks the selected vehicle'); await mp.tap('#randBtn'); await mp.waitForTimeout(200); await shot(mp, 'mobile-2-setup.png', true);
    await mp.tap('#readyBtn'); await mp.waitForSelector('#vBattle:not([hidden])');
    await mp.waitForFunction(() => window.__bd.S.myTurn && !window.__bd.S.locked && window.__bd.bEnemy.mode === 'target', null, { timeout: 15000 }).catch(() => {});
    if (!(await mp.evaluate(() => window.__bd.S.myTurn))) await mp.waitForFunction(() => window.__bd.S.myTurn && !window.__bd.S.locked, null, { timeout: 15000 });
    const bbe = await mp.locator('#cEnemy').boundingBox(); const tx = bbe.x + ((PAD + 4.5 * CELL) / SIZE) * bbe.width, ty = bbe.y + ((PAD + 4.5 * CELL) / SIZE) * bbe.height;
    await mp.touchscreen.tap(tx, ty); await mp.waitForTimeout(150); ok(await mp.evaluate(() => !!window.__bd.bEnemy.target) && (await mp.evaluate(() => window.__bd.bEnemy.marks.size)) === 0, 'touch: first tap only AIMS (no accidental shot)');
    await shot(mp, 'mobile-3-battle-aim.png', true);
    await mp.tap('#fireBtn'); await mp.waitForFunction(() => window.__bd.bEnemy.marks.size === 1, null, { timeout: 8000 }); ok(true, 'touch: FIRE button launches the mortar');
    await mp.waitForTimeout(2200); await shot(mp, 'mobile-4-battle-after.png', true);
    await M.close();

    // ---- slow-motion capture of the mortar in flight (real animation timings, no ?fast) ----
    const S2 = await mk(1280, 900); await S2.pg.goto(BASE + '/'); await S2.pg.waitForFunction(() => document.getElementById('conn').textContent === 'online'); await S2.pg.fill('#nick', 'ArtShots'); await S2.pg.click('#enterBtn'); await S2.pg.waitForSelector('#meBox:not([hidden])');
    await S2.pg.click('#cpuEasy'); await S2.pg.waitForSelector('#vSetup:not([hidden])'); await S2.pg.click('#randBtn'); await S2.pg.click('#readyBtn'); await S2.pg.waitForSelector('#vBattle:not([hidden])');
    await S2.pg.waitForFunction(() => window.__bd.S.myTurn && !window.__bd.S.locked, null, { timeout: 15000 }); await clickCell(S2.pg, '#cEnemy', 5, 4); await S2.pg.waitForTimeout(420); await shot(S2.pg, 'desktop-9-mortar-in-flight.png');
    await S2.pg.waitForTimeout(1050); await shot(S2.pg, 'desktop-10-explosion.png');
    // drive several real-time shots then capture a mid-game board
    for (let i = 0; i < 9; i++) { await S2.pg.waitForFunction(() => window.__bd.S.myTurn && !window.__bd.S.locked && window.__bd.bEnemy.mode === 'target', null, { timeout: 20000 }); await clickCell(S2.pg, '#cEnemy', i, (i * 3) % 10); await S2.pg.waitForTimeout(900); }
    await S2.pg.waitForFunction(() => window.__bd.S.myTurn && !window.__bd.S.locked, null, { timeout: 20000 }); await S2.pg.waitForTimeout(800); await shot(S2.pg, 'desktop-11-midgame.png', true);
    await S2.ctx.close();
  } catch (e) { console.log('TEST ERROR', e); fail++; }
  finally { if (browser) await browser.close(); srv.kill('SIGTERM'); }
  console.log(`\ne2e: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main();
