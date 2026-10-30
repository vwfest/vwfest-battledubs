// Where the game server lives. On GitHub Pages the page talks to the Render service; on Render (or locally) it talks to its own host.
export const RENDER_HOST = 'vwfest-battledubs.onrender.com';
const onPages = /\.github\.io$/.test(location.hostname);
export const WS_URL = onPages ? `wss://${RENDER_HOST}/ws` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
export const N = 10;
export const CELL = 40;   // logical px per lot cell
export const PAD = 30;    // logical px of curb / lamp / label margin
export const FAST = new URLSearchParams(location.search).has('fast');   // test hook: speeds up animations
