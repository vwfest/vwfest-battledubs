# BATTLE DUBS

Battleship with air-cooled VWs. Two players (or you vs the CPU) hide a fleet of Beetles, Karmann Ghias and VW buses in a parking lot and take turns launching mortars. Free, **nickname only** (no sign-up), part of the [$VWFEST Arcade Room](https://vwfest.github.io/vwfest-arcade/).

* **Client** (static, `docs/`): served by GitHub Pages at https://vwfest.github.io/vwfest-battledubs/ and also by the game server itself.
* **Server** (`server.js`, Node + `ws`): matchmaking, server-authoritative rules, live leaderboard. Hosted on Render's free plan, data in Supabase Postgres (own schema `battledubs`).

## Rules
5 dubs on a 10×10 lot: Samba Bus (5), Kombi Bus (4), Karmann Ghia (3), Beetle (3), Baby Bug (2). Alternate turns, 30 s per turn (auto-fire on timeout, 3 missed turns = forfeit). Knock out all 17 cells to win.

## Modes
* **Live PvP**: quick match queue, or challenge anyone in the online list. Disconnect = 20 s to rejoin, then forfeit. Rematch button.
* **vs CPU**: easy (random + light follow-up) and hard (probability-density hunt + hit-chain targeting). Stats are tracked on the profile but **never on the leaderboard**.

## Leaderboard (live, on the front page)
Wins, losses, win rate, accuracy, dubs knocked out. Only PvP counts. Anti-farming: max 4 counted games per pair of players per 24 h, forfeits before 10 total shots award no win (the leaver still takes the loss), abandoning during setup counts for nothing.

## Security
* Fleets are only ever stored server-side. Clients receive hit/miss results and, for a sunk vehicle, that vehicle's position. The remaining fleet is revealed only in the final game-over message.
* Every client message is validated (types, integer bounds, placement rules, turn order, duplicate shots). Per-connection token bucket (flood → close 1008), 2 KB frame limit, per-IP connection cap, new-nickname rate limit.
* WebSocket `Origin` allow-list (`https://vwfest.github.io`, `https://vwfestmemecoin.com`, the Render URL). CORS on `/api/top` is limited to the same list.
* Nicknames: 3–14 chars, profanity/leet filter, reserved words blocked, unique case-insensitively. Identity = a random secret kept in the browser's localStorage (only its SHA-256 is stored), so nobody can take over your nickname without it.
* CSP: `default-src 'self'`, no inline script/style, no `unsafe-inline`. All server text is rendered with `textContent`.

## Run locally
```
npm install
USE_PGLITE=1 PGLITE_DIR=memory:// node server.js   # embedded Postgres, or set DATABASE_URL
# open http://127.0.0.1:3000
npm test                                          # unit + Playwright e2e (two-browser PvP, CPU, mobile)
```

## Deploy
1. Render → New Web Service → this repo (`render.yaml` is included). Free plan.
2. Env vars: `DATABASE_URL` (Supabase connection string), `DB_SCHEMA=battledubs`, `NODE_ENV=production`, `NODE_VERSION=20`.
3. If the Render URL differs from `vwfest-battledubs.onrender.com`, set `RENDER_HOST` in `docs/js/config.js` and add `ALLOWED_ORIGINS`.
4. GitHub Pages: Settings → Pages → branch `main`, folder `/docs`.

Env knobs: `PLACE_SECS` (75), `TURN_SECS` (30), `GRACE_SECS` (20), `PAIR_CAP` (4), `ALLOWED_ORIGINS`.
