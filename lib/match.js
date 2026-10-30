// One BATTLE DUBS match (PvP or vs CPU). Server-authoritative: fleets never leave this file except as public reveals.
const { FLEET, N, randomPlacement, validatePlacement, Fleet, publicShip } = require('./game');
const { CpuAI } = require('./ai');

class Match {
  constructor(env, id, pa, pb) {
    this.env = env; this.id = id; this.cfg = env.cfg; this.phase = 'placing'; this.turn = null; this.history = []; this.created = Date.now();
    this.mode = pb.cpu ? 'cpu' : 'pvp'; this.level = pb.cpu ? pb.level : null; this.ranked = this.mode === 'pvp';
    this.sides = [pa, pb].map((p) => ({ p, cpu: !!p.cpu, fleet: null, ready: false, shots: 0, hits: 0, kills: 0, timeouts: 0, away: false, rematch: false, left: false, lastTaunt: 0 }));
    if (pb.cpu) { const s = this.sides[1]; s.fleet = new Fleet(randomPlacement()); s.ready = true; s.ai = new CpuAI(pb.level); }
    this.timers = {}; this.deadline = 0; this.reason = null; this.winner = null; this.endedAt = 0;
    for (const s of this.sides) if (!s.cpu) { s.p.match = this; s.p.side = this.sides.indexOf(s); s.p.queued = false; }
    this.placeDeadline = Date.now() + this.cfg.placeMs;
    this.timers.place = setTimeout(() => this.placeTimeout(), this.cfg.placeMs);
    for (let i = 0; i < 2; i++) this.sendState(i);
    env.dirty();
  }
  humans() { return this.sides.map((s, i) => [s, i]).filter(([s]) => !s.cpu); }
  tell(i, msg) { const s = this.sides[i]; if (!s.cpu && !s.left) this.env.sendP(s.p, msg); }
  oppView(i) { const o = this.sides[1 - i]; return { nick: o.p.nick, avatar: o.p.avatar, cpu: o.cpu, level: o.cpu ? this.level : undefined }; }
  rel(i, h) { return { by: h.by === i ? 'me' : 'opp', x: h.x, y: h.y, res: h.res, sunk: h.ship ? publicShip(h.ship) : null, auto: h.auto || undefined }; }
  // Full state for the side (used at start and on reconnect).
  sendState(i, resume = false) {
    const s = this.sides[i];
    this.tell(i, {
      t: 'match', id: this.id, resume, mode: this.mode, level: this.level, ranked: this.ranked, phase: this.phase, opp: this.oppView(i),
      fleet: FLEET.map(({ id, kind, name, len }) => ({ id, kind, name, len })), placeDeadline: this.placeDeadline,
      myShips: s.fleet ? s.fleet.ships.map(publicShip) : null, ready: s.ready, oppReady: this.sides[1 - i].ready,
      history: this.history.map((h) => this.rel(i, h)), mine: this.turn === i, deadline: this.deadline, turnMs: this.cfg.turnMs, left: this.leftCounts(i),
    });
  }
  leftCounts(i) { return this.phase === 'placing' ? null : { me: this.sides[i].fleet.left, opp: this.sides[1 - i].fleet.left }; }

  place(i, ships) {
    if (this.phase !== 'placing') return 'Not in setup.';
    const s = this.sides[i]; if (s.ready) return 'Already ready.';
    const v = validatePlacement(ships); if (!v) return 'Invalid placement.';
    s.fleet = new Fleet(v); s.ready = true; this.tell(1 - i, { t: 'opp_ready' }); this.tell(i, { t: 'ready', myShips: v.map(publicShip) });
    if (this.sides[0].ready && this.sides[1].ready) this.begin();
    return null;
  }
  placeTimeout() {
    if (this.phase !== 'placing') return;
    this.sides.forEach((s, i) => { if (!s.ready && !s.cpu) { s.fleet = new Fleet(randomPlacement()); s.ready = true; this.tell(i, { t: 'ready', myShips: s.fleet.ships.map(publicShip), auto: true }); this.tell(1 - i, { t: 'opp_ready' }); } });
    this.begin();
  }
  begin() {
    if (this.phase !== 'placing') return;
    clearTimeout(this.timers.place); this.phase = 'battle'; this.turn = Math.random() < 0.5 ? 0 : 1;
    for (let i = 0; i < 2; i++) this.tell(i, { t: 'battle', youFirst: this.turn === i, left: this.leftCounts(i), turnMs: this.cfg.turnMs });
    this.startTurn(); this.env.dirty();
  }
  startTurn() {
    clearTimeout(this.timers.turn); clearTimeout(this.timers.cpu);
    this.deadline = Date.now() + this.cfg.turnMs;
    for (let i = 0; i < 2; i++) this.tell(i, { t: 'turn', mine: this.turn === i, deadline: this.deadline });
    if (this.sides[this.turn].cpu) this.timers.cpu = setTimeout(() => this.cpuMove(), this.cfg.cpuMs + Math.random() * 500);
    else this.timers.turn = setTimeout(() => this.turnTimeout(), this.cfg.turnMs + 200);
  }
  cpuMove() { if (this.phase !== 'battle') return; const s = this.sides[this.turn]; const [x, y] = s.ai.next(); this.resolve(this.turn, x, y, false); }
  turnTimeout() {
    if (this.phase !== 'battle') return;
    const i = this.turn, s = this.sides[i]; s.timeouts++;
    if (s.timeouts >= 3) return this.finish(1 - i, 'timeout');
    const o = this.sides[1 - i], free = []; for (let k = 0; k < N * N; k++) if (!o.fleet.shots.has(k)) free.push(k);
    const k = free[Math.floor(Math.random() * free.length)]; this.resolve(i, k % N, Math.floor(k / N), true);
  }
  fire(i, x, y) {
    if (this.phase !== 'battle') return 'No battle in progress.';
    if (this.turn !== i) return 'Not your turn.';
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= N || y >= N) return 'Bad target.';
    if (this.sides[1 - i].fleet.alreadyShot(x, y)) return 'Already fired there.';
    this.sides[i].timeouts = 0; this.resolve(i, x, y, false); return null;
  }
  resolve(i, x, y, auto) {
    clearTimeout(this.timers.turn); clearTimeout(this.timers.cpu);
    const s = this.sides[i], o = this.sides[1 - i];
    const r = o.fleet.fire(x, y); s.shots++; if (r.res !== 'miss') s.hits++; if (r.res === 'sunk') s.kills++;
    if (s.ai) s.ai.feedback(x, y, r.res, r.ship ? r.ship.cells : null, r.ship && r.ship.len);
    const h = { by: i, x, y, res: r.res, ship: r.res === 'sunk' ? r.ship : null, auto }; this.history.push(h);
    for (let k = 0; k < 2; k++) this.tell(k, { t: 'shot', ...this.rel(k, h), left: this.leftCounts(k) });
    if (r.res === 'sunk' && this.mode === 'pvp') this.env.feed(`${s.p.avatar} ${s.p.nick} knocked out ${o.p.nick}'s ${r.ship.name}!`);
    this.env.dirty();
    if (r.allSunk) return this.finish(i, 'sunk');
    this.turn = 1 - i; this.startTurn();
  }
  taunt(i, id) {
    const s = this.sides[i], now = Date.now(); if (now - s.lastTaunt < 2000 || !Number.isInteger(id) || id < 0 || id > 7) return;
    s.lastTaunt = now; this.tell(1 - i, { t: 'taunt', id });
  }
  // Player connection dropped: grace period, then forfeit.
  away(i) {
    const s = this.sides[i]; if (this.phase === 'over' || s.away) return; s.away = true;
    this.tell(1 - i, { t: 'opp_conn', ok: false, grace: this.cfg.graceMs });
    clearTimeout(this.timers['g' + i]);
    this.timers['g' + i] = setTimeout(() => {
      if (this.phase === 'over') return;
      if (this.mode === 'cpu') return this.abort('abandoned');
      if (this.phase === 'placing') return this.abort('abandoned');
      this.finish(1 - i, 'disconnect');
    }, this.cfg.graceMs);
  }
  back(i) {
    const s = this.sides[i]; clearTimeout(this.timers['g' + i]);
    if (s.away) { s.away = false; this.tell(1 - i, { t: 'opp_conn', ok: true }); }
    this.sendState(i, true);
    if (this.phase === 'over') this.sendOver(i);
  }
  leave(i) {
    const s = this.sides[i];
    if (this.phase === 'battle' && this.mode === 'pvp') this.finish(1 - i, 'forfeit', true);
    else if (this.phase === 'battle' || this.phase === 'placing') this.abort('abandoned', i);
    s.left = true; if (s.p.match === this) { s.p.match = null; s.p.side = null; }
    if (this.sides.every((x) => x.cpu || x.left)) this.dispose();
    else if (this.phase === 'over') this.tell(1 - i, { t: 'opp_left' });
    this.env.dirty();
  }
  abort(reason, by) {
    if (this.phase === 'over') return; this.phase = 'over'; this.reason = reason; this.endedAt = Date.now(); this.clear();
    for (let i = 0; i < 2; i++) if (i !== by) this.tell(i, { t: 'over', win: this.mode === 'pvp' ? true : false, reason, counted: false, ranked: this.ranked, reveal: [], me: this.env.profile(this.sides[i].p) });
    this.env.dirty(); this.scheduleDispose();
  }
  finish(w, reason, leaving) {
    if (this.phase === 'over') return;
    this.phase = 'over'; this.winner = w; this.reason = reason; this.endedAt = Date.now(); this.clear();
    const st = this.env.store, A = this.sides[0], B = this.sides[1]; let counted = false, note = null;
    if (this.mode === 'pvp') {
      const ra = A.p.rec, rb = B.p.rec;
      if (!st.pairOk(ra.key, rb.key)) note = 'cap';
      else {
        counted = true; const total = A.shots + B.shots, winCounts = reason === 'sunk' || total >= 10;
        const sa = { shots: A.shots, hits: A.hits, kills: A.kills }, sb = { shots: B.shots, hits: B.hits, kills: B.kills };
        st.recordPvp(ra, rb, w === 0 ? 0 : 1, reason, sa, sb, winCounts);
        if (!winCounts) note = 'short';
      }
      this.env.feed(`${this.sides[w].p.avatar} ${this.sides[w].p.nick} beat ${this.sides[1 - w].p.avatar} ${this.sides[1 - w].p.nick}${reason === 'sunk' ? '' : ' (' + reason + ')'}`);
    } else {
      const h = A.p.rec; if (h && reason !== 'abandoned') st.recordCpu(h, w === 0);
    }
    this.note = note; this.counted = counted;
    for (let i = 0; i < 2; i++) this.sendOver(i);
    this.env.dirty(); this.scheduleDispose();
  }
  sendOver(i) {
    const o = this.sides[1 - i], me = this.sides[i];
    this.tell(i, {
      t: 'over', win: this.winner === i, reason: this.reason, counted: !!this.counted, note: this.note || null, ranked: this.ranked,
      reveal: o.fleet ? o.fleet.alive().map(publicShip) : [], mine: me.fleet ? me.fleet.alive().map(publicShip) : [],
      shots: { me: me.shots, opp: o.shots, meHits: me.hits, oppHits: o.hits }, me: this.env.profile(me.p), canRematch: this.mode === 'pvp',
    });
  }
  rematch(i) {
    if (this.phase !== 'over' || this.mode !== 'pvp') return;
    const s = this.sides[i], o = this.sides[1 - i]; if (o.left || o.away || s.left) return this.tell(i, { t: 'opp_left' });
    s.rematch = true; this.tell(1 - i, { t: 'rematch', from: s.p.nick });
    if (o.rematch) { this.env.rematch(this); }
  }
  clear() { for (const k of Object.keys(this.timers)) clearTimeout(this.timers[k]); this.timers = {}; }
  scheduleDispose() { this.timers.d = setTimeout(() => this.dispose(), 5 * 60e3); this.timers.d.unref && this.timers.d.unref(); }
  dispose() {
    this.clear(); for (const s of this.sides) if (!s.cpu && s.p.match === this) { s.p.match = null; s.p.side = null; }
    this.env.removeMatch(this);
  }
}
module.exports = { Match };
