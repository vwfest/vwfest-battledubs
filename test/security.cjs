// Security regression tests (local server only, memory store). Usage: node test/security.cjs
const { spawn } = require('child_process'); const WebSocket = require('ws');
const PORT = 3172, B = `http://127.0.0.1:${PORT}`, ORIGIN = 'https://vwfest.github.io';
let fails = 0; const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, RENDER: 'true', DATABASE_URL: '', USE_PGLITE: '', MAX_CONNS_PER_IP: '5', PLACE_SECS: '30' }, stdio: ['ignore', 'ignore', 'pipe'] });
srv.stderr.on('data', d => process.stderr.write(d));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wait = async () => { for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/healthz')).ok) return; } catch {} await sleep(200); } throw new Error('server did not start'); };
const open = (headers) => new Promise(res => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers }); const msgs = [];
  ws.on('message', d => { try { msgs.push(JSON.parse(d.toString())); } catch {} });
  ws.on('open', () => res({ ws, status: 101, msgs })); ws.on('unexpected-response', (rq, r) => { res({ ws, status: r.statusCode, msgs }); r.resume(); }); ws.on('error', () => {});
});
const send = (c, o) => c.ws.send(JSON.stringify(o));
const secret = () => [...Array(24)].map(() => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.random() * 36 | 0]).join('');
const until = async (c, f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(f); if (m) return m; await sleep(60); } return null; };
const nextErr = async (c, ms = 2000) => { const n = c.msgs.length; const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.slice(n).find(x => x.t === 'err'); if (m) return m; await sleep(50); } return null; };
const FLEET = [[0, 5], [1, 4], [2, 3], [3, 3], [4, 2]]; const fleet = FLEET.map(([id], row) => ({ id, x: 0, y: row * 2, dir: 'h' }));
(async () => {
  await wait();
  let c = await open({}); ok(c.status === 403, 'WebSocket without Origin refused');
  c = await open({ origin: 'https://evil.example' }); ok(c.status === 403, 'WebSocket from foreign Origin refused');
  // per-IP cap keyed on real client IP; spoofed leading X-Forwarded-For entries must not mint new buckets
  const many = []; for (let i = 0; i < 6; i++) many.push(await open({ origin: ORIGIN, 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': `10.0.${i}.1, 203.0.113.9` }));
  ok(many.slice(0, 5).every(m => m.status === 101) && many[5].status === 429, 'ws per-IP cap holds when X-Forwarded-For is rotated');
  many.forEach(m => m.ws.close && m.ws.close()); await sleep(300);
  // nicknames
  c = await open({ origin: ORIGIN, 'cf-connecting-ip': '198.51.100.20' });
  for (const n of ['Admin', 'CPU Hard', 'Battle Dubs', '<b>x</b>', "x'; DROP TABLE players;--", 'fuuuck', 'ab', 'x'.repeat(30)]) { send(c, { t: 'hello', nick: n, secret: secret(), avatar: '🐞' }); ok(!!(await nextErr(c)), 'nickname rejected: ' + n.slice(0, 20)); }
  send(c, { t: 'hello', nick: 'Okname', secret: 'short' }); ok(!!(await nextErr(c)), 'short secret rejected');
  send(c, { t: 'fire', x: 1, y: 1 }); ok(!!(await nextErr(c)), 'game actions before hello refused'); c.ws.close();
  // forged game messages in a real PvP match
  const A = await open({ origin: ORIGIN, 'cf-connecting-ip': '198.51.100.21' }), Bc = await open({ origin: ORIGIN, 'cf-connecting-ip': '198.51.100.22' });
  const sa = secret(), sb = secret();
  send(A, { t: 'hello', nick: 'Alice1', secret: sa, avatar: '🐞' }); send(Bc, { t: 'hello', nick: 'Bobby2', secret: sb, avatar: '🚐' });
  await until(A, m => m.t === 'hello_ok'); await until(Bc, m => m.t === 'hello_ok');
  const thief = await open({ origin: ORIGIN, 'cf-connecting-ip': '198.51.100.23' });
  send(thief, { t: 'hello', nick: 'alice1', secret: secret(), avatar: '🐞' }); const te = await until(thief, m => m.t === 'err' && m.code === 'taken'); ok(!!te, 'nickname cannot be taken over with a different secret'); thief.ws.close();
  send(A, { t: 'queue' }); send(Bc, { t: 'queue' });
  await until(A, m => m.t === 'match'); await until(Bc, m => m.t === 'match');
  send(A, { t: 'fire', x: 0, y: 0 }); ok((await nextErr(A))?.msg === 'No battle in progress.', 'firing during setup refused');
  send(A, { t: 'place', ships: [{ id: 0, x: 8, y: 8, dir: 'h' }] }); ok(!!(await nextErr(A)), 'incomplete fleet refused');
  send(A, { t: 'place', ships: fleet.map(s => ({ ...s, x: 9 })) }); ok(!!(await nextErr(A)), 'off-board / overlapping fleet refused');
  send(A, { t: 'place', ships: fleet.map(s => ({ ...s, x: '0' })) }); ok(!!(await nextErr(A)), 'string coordinates refused');
  send(A, { t: 'place', ships: fleet }); send(Bc, { t: 'place', ships: fleet.map(s => ({ ...s, y: s.y === 8 ? 9 : s.y, x: 5 - (s.id === 0 ? 5 : s.id === 1 ? 4 : s.id === 4 ? 2 : 3) })) });
  const bat = await until(A, m => m.t === 'battle'); ok(!!bat, 'battle starts after both placed');
  const first = bat.youFirst ? A : Bc, second = bat.youFirst ? Bc : A;
  send(second, { t: 'fire', x: 3, y: 3 }); ok((await nextErr(second))?.msg === 'Not your turn.', 'firing out of turn refused');
  for (const [x, y] of [[-1, 0], [10, 0], [0, 99], [1.5, 2], ['3', 3], [null, 1], [{}, []]]) { send(first, { t: 'fire', x, y }); ok(!!(await nextErr(first)), `bad target refused: ${JSON.stringify([x, y])}`); }
  send(first, { t: 'fire', x: 9, y: 9 }); await until(first, m => m.t === 'shot'); 
  send(second, { t: 'fire', x: 9, y: 9 }); await sleep(100);
  // fog of war: neither side ever receives the other's ship coordinates before the game is over
  const leak = (c, ownShips) => c.msgs.filter(m => m.t !== 'over').some(m => m.t === 'match' || m.t === 'ready' ? false : (m.myShips && JSON.stringify(m.myShips) !== JSON.stringify(ownShips)) || (m.reveal && m.reveal.length));
  const aShips = A.msgs.find(m => m.t === 'ready')?.myShips, bShips = Bc.msgs.find(m => m.t === 'ready')?.myShips;
  ok(!!aShips && !!bShips && JSON.stringify(aShips) !== JSON.stringify(bShips), 'each side only gets its own fleet ("ready")');
  const bCells = JSON.stringify(bShips?.map(s => s.cells)); ok(!A.msgs.some(m => m.t !== 'shot' && JSON.stringify(m).includes(bCells.slice(1, -1))), "opponent's fleet layout is not in any of the other client's messages");
  ok(!leak(A, aShips) && !leak(Bc, bShips), 'no "reveal" / foreign myShips payloads before game over');
  send(first, { t: 'leave' }); await sleep(200);
  const h2 = await fetch(B + '/healthz'); ok(h2.ok, 'server alive after forged messages');
  const top = await (await fetch(B + '/api/top')).json(); ok(top.ok && !JSON.stringify(top).match(/secret|hash/i), '/api/top leaks no secrets');
  const hh = await fetch(B + '/'); const csp = hh.headers.get('content-security-policy') || '';
  ok(!/script-src[^;]*unsafe-inline/.test(csp) && !hh.headers.get('x-powered-by'), 'CSP without inline scripts, no X-Powered-By');
  const post = await fetch(B + '/api/top', { method: 'POST' }); ok(post.status === 405, 'non-GET methods refused');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); srv.kill(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
