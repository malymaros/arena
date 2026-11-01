// public/client/arena-thumbs.js - náhľady arén (karty v lobby, záložky ADVANCED SETTINGS, losovanie arény):
// mená a obrázok pozadia vykreslený „cover" do canvasu (rovnaké vrstvy ako hra, socket-handlers ARENAS_CLIENT).
export const ARENA_KEYS = ["bridge", "portal", "swamp"];
export const ARENA_NAMES = { bridge: "STONE BRIDGE", portal: "PORTAL REALM", swamp: "SHREK SWAMP" };
const THUMBS = {
  bridge: "/arenas/bridge/thumb.png", // hotové zložené vrstvy (tools/arena-bg/thumbs.mjs)
  portal: "/arenas/portal-realm/portal-realm-hd.webp",
  swamp: "/arenas/shrek-swamp/shrek-swamp-hd.webp",
};
const images = {};
const loadThumb = (key) => images[key] ||= new Promise((ok, fail) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = fail;
  img.src = THUMBS[key];
});

export function drawArenaThumb(cvs, key) {
  if (!THUMBS[key]) return;
  loadThumb(key).then(img => {
    const ctx = cvs.getContext("2d");
    const s = Math.max(cvs.width / img.width, cvs.height / img.height), dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (cvs.width - dw) / 2, (cvs.height - dh) / 2, dw, dh);
  }).catch(() => {});
}
