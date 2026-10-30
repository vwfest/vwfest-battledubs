// Player records + match log. Memory is the working copy (fast leaderboard); Postgres (own schema "battledubs") persists it.
// If the DB is unreachable the game keeps running from memory and logs a warning.
const path = require('path');
const SCHEMA = (process.env.DB_SCHEMA || 'battledubs').replace(/[^a-z0-9_]/gi, '');
const DDL = [
  `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.players (nick_key TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.matches (id BIGSERIAL PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, winner TEXT, reason TEXT, shots_a INT, shots_b INT, counted BOOLEAN NOT NULL DEFAULT false, at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS bd_matches_at ON ${SCHEMA}.matches (at)`,
];
const DAY = 86400e3, PAIR_CAP = +(process.env.PAIR_CAP || 4), MAX_PLAYERS = 20000, IDLE_RELEASE = 90 * DAY;

class Store {
  constructor() { this.players = new Map(); this.pairs = new Map(); this.dirty = new Set(); this.q = null; this.persistent = false; this.lbCache = null; this.timer = null; }
  async init() {
    try {
      if (process.env.DATABASE_URL) {
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 8000, ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false } });
        pool.on('error', (e) => console.error('pg pool error', e.message));
        this.q = (t, p) => pool.query(t, p); this.close = () => pool.end();
        for (const s of DDL) await pool.query(s);
      } else if (process.env.USE_PGLITE === '1') {
        const { PGlite } = require('@electric-sql/pglite');
        const db = new PGlite(process.env.PGLITE_DIR || path.join(__dirname, '..', '.localdb'));
        this.q = (t, p) => db.query(t, p); this.close = () => db.close();
        for (const s of DDL) await db.exec(s);
      } else { console.warn('[store] no DATABASE_URL: memory only (stats reset on restart)'); return; }
      const pr = await this.q(`SELECT nick_key, data FROM ${SCHEMA}.players`);
      for (const r of pr.rows) this.players.set(r.nick_key, typeof r.data === 'string' ? JSON.parse(r.data) : r.data);
      const mr = await this.q(`SELECT a, b, extract(epoch from at)*1000 AS ms FROM ${SCHEMA}.matches WHERE counted AND at > now() - interval '1 day'`);
      for (const r of mr.rows) this.pairPush(r.a, r.b, +r.ms);
      this.persistent = true; console.log(`[store] loaded ${this.players.size} players (schema ${SCHEMA})`);
    } catch (e) { console.error('[store] DB unavailable, running from memory only:', e.message); this.q = null; }
    this.timer = setInterval(() => this.flush().catch(() => {}), 5000); this.timer.unref();
  }
  startTimer() { if (!this.timer) { this.timer = setInterval(() => this.flush().catch(() => {}), 5000); this.timer.unref(); } }
  get(key) { return this.players.get(key) || null; }
  isExpired(rec) { return Date.now() - rec.lastSeen > IDLE_RELEASE && rec.games === 0; }
  create(key, nick, avatar, secretHash) {
    if (this.players.size >= MAX_PLAYERS) return null;
    const rec = { key, nick, avatar, secretHash, created: Date.now(), lastSeen: Date.now(), games: 0, wins: 0, losses: 0, shots: 0, hits: 0, kills: 0, cpuGames: 0, cpuWins: 0, cpuLosses: 0 };
    this.players.set(key, rec); this.mark(key); this.lbCache = null; return rec;
  }
  mark(key) { this.dirty.add(key); }
  touch(rec) { rec.lastSeen = Date.now(); this.mark(rec.key); }
  pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  pairPush(a, b, t) { const k = this.pairKey(a, b), arr = this.pairs.get(k) || []; arr.push(t); this.pairs.set(k, arr); }
  pairCount(a, b) { const k = this.pairKey(a, b), cut = Date.now() - DAY, arr = (this.pairs.get(k) || []).filter((t) => t > cut); this.pairs.set(k, arr); return arr.length; }
  pairOk(a, b) { return this.pairCount(a, b) < PAIR_CAP; }
  // stats: { shots, hits, kills } per side. winner is 0|1.
  recordPvp(a, b, winner, reason, sa, sb, winCounts) {
    const stat = (rec, s, won) => { rec.games++; rec.shots += s.shots; rec.hits += s.hits; rec.kills += s.kills; if (won) rec.wins++; else rec.losses++; this.touch(rec); };
    const [w, l] = winner === 0 ? [a, b] : [b, a], [ws, ls] = winner === 0 ? [sa, sb] : [sb, sa];
    if (winCounts) stat(w, ws, true); else { w.shots += ws.shots; w.hits += ws.hits; w.kills += ws.kills; this.touch(w); }
    stat(l, ls, false);
    this.pairPush(a.key, b.key, Date.now()); this.lbCache = null;
    this.log(a.key, b.key, w.key, reason, sa.shots, sb.shots, true);
  }
  recordCpu(rec, won) { rec.cpuGames++; if (won) rec.cpuWins++; else rec.cpuLosses++; this.touch(rec); }
  log(a, b, winner, reason, sa, sb, counted) {
    if (!this.q) return;
    this.q(`INSERT INTO ${SCHEMA}.matches (a,b,winner,reason,shots_a,shots_b,counted) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [a, b, winner, reason, sa, sb, counted]).catch((e) => console.error('[store] log failed', e.message));
  }
  row(r) {
    const g = r.wins + r.losses;
    return { nick: r.nick, avatar: r.avatar, wins: r.wins, losses: r.losses, rate: g ? Math.round((r.wins / g) * 100) : 0, acc: r.shots ? Math.round((r.hits / r.shots) * 100) : 0, kills: r.kills };
  }
  leaderboard(limit = 25) {
    if (!this.lbCache) {
      const rows = [...this.players.values()].filter((r) => r.wins + r.losses > 0);
      rows.sort((a, b) => b.wins - a.wins || (b.wins / (b.wins + b.losses)) - (a.wins / (a.wins + a.losses)) || (b.hits / (b.shots || 1)) - (a.hits / (a.shots || 1)) || a.nick.localeCompare(b.nick));
      this.lbCache = rows.map((r, i) => ({ rank: i + 1, ...this.row(r) }));
    }
    return this.lbCache.slice(0, limit);
  }
  rankOf(rec) { const lb = this.leaderboard(MAX_PLAYERS); const r = lb.find((x) => x.nick === rec.nick); return r ? r.rank : null; }
  profile(rec) { return { ...this.row(rec), games: rec.wins + rec.losses, cpuWins: rec.cpuWins, cpuLosses: rec.cpuLosses, rank: this.rankOf(rec) }; }
  async flush() {
    if (!this.q || !this.dirty.size) return;
    const keys = [...this.dirty]; this.dirty.clear();
    for (const k of keys) {
      const rec = this.players.get(k); if (!rec) continue;
      try { await this.q(`INSERT INTO ${SCHEMA}.players (nick_key, data, updated_at) VALUES ($1,$2::jsonb,now()) ON CONFLICT (nick_key) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [k, JSON.stringify(rec)]); }
      catch (e) { this.dirty.add(k); console.error('[store] flush failed', e.message); break; }
    }
  }
  async shutdown() { clearInterval(this.timer); try { await this.flush(); if (this.close) await this.close(); } catch {} }
}
module.exports = { Store, SCHEMA };
