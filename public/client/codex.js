// public/client/codex.js - CODEX: otvorená pixel-art kniha (schválený návrh public/dev/codex.html), otvára ju zvislá
// kniha CODEX v menu (menu.js). Zatiaľ len úvodná dvojstrana: vľavo 9 základných postáv (fotky pripnuté špendlíkom,
// meno na prúžku papiera), vpravo zakázaná strana so skrytými postavami (siluety, mená normálne; hore biela strana,
// dole čierna), pravá časť listu je odtrhnutá (pod ňou runové zápisky mága) a dole symbol svetla a tmy.
// Klik na postavu otvorí jej dvojstranu (codex-pages.js), späť ↩ CONTENTS alebo Esc; listovanie medzi postavami zatiaľ
// nie je (vlastník). Obsah sa kreslí raz pri prvom otvorení (statické); stránka postavy pri otvorení.
// Kniha je 900×588 px (umelecký pixel = 3 px), na stred, zväčšená podľa voľného miesta (appSize).
import { CHAR_LIST, HEAD_CROP } from "/chars/index.js";
import { appSize } from "/client/viewport.js";
import { renderEntry } from "/client/codex-pages.js";

const SHORT = { lightning: "LIGHTNING", wanderer: "WANDERER", onre: "ONRYO" }; // dlhé mená skrátene, Onryō bez dĺžňa (pixel font)
const shortName = (c) => SHORT[c.key] || c.meta.name.toUpperCase();
const tilt = (n) => [-3, 2, -1.5, 3, -2.5, 1, 2.5, -2, 1.5, -1, 3, -3][n % 12]; // „ručne" pripnuté nakrivo

const BW = 900, BH = 588; // rozmer knihy v px
let root = null, backdrop = null, book = null, built = false;

// ---- hlavy postáv (ako HUD hlava; skryté = silueta) ----
const imgs = {};
const load = (src) => imgs[src] ||= new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
async function drawHead(cv, c) {
  const im = await load(`/assets/${c.meta.dir}/${c.headIdleFile || "Idle.png"}`); if (!im) return;
  const h = im.height, cr = HEAD_CROP[c.key] || { cx: .5, cy: .5, size: .3 }, ctx = cv.getContext("2d");
  const s = cr.size * h;
  ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(im, cr.cx * h - s / 2, cr.cy * h - s / 2, s, s, 0, 0, cv.width, cv.height);
  if (c.side) { ctx.globalCompositeOperation = "source-atop"; ctx.fillStyle = "#1a1008"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.globalCompositeOperation = "source-over"; }
}

// ======================= kniha (canvas 300×196, umelecký pixel = 3 px) =======================
const W = 300, H = 196;
const OUT = "#0a0708", GOLD = "#b8862b", GHI = "#f2c14e";
const PAGE = "#b2925f", PAGE2 = "#a08050", PAGE3 = "#8c6c40", PAGE4 = "#745632", EDGE = "#c4a874", EDGE2 = "#7e6440"; // tmavý, starý pergamen
const PL = 12, PR = 288, PT = 10, PB = 184, GL = 148, GR = 152;
function drawBook(cvs, entry = null) {
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext("2d"), px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  px(0, 2, W, H - 4, OUT);
  for (let y = 3; y < H - 3; y++) for (let x = 1; x < W - 1; x++) { const v = (x * 7 + y * 13 + x * y) % 17; px(x, y, 1, 1, v < 3 ? "#1e1519" : v > 14 ? "#30242a" : "#271c21"); }
  for (let x = 4; x < W - 4; x += 4) { px(x, 5, 2, 1, "#6a2c8a"); px(x, H - 6, 2, 1, "#6a2c8a"); }
  for (let y = 6; y < H - 6; y += 4) { px(3, y, 1, 2, "#6a2c8a"); px(W - 4, y, 1, 2, "#6a2c8a"); }
  const corner = (x, y, sx, sy) => { for (let i = 0; i < 6; i++) px(sx > 0 ? x : x - (6 - i) + 1, y + sy * i, 6 - i, 1, GOLD); px(sx > 0 ? x : x - 5, y, 6, 1, GHI); };
  corner(1, 3, 1, 1); corner(W - 2, 3, -1, 1); corner(1, H - 4, 1, -1); corner(W - 2, H - 4, -1, -1);
  for (let i = 0; i < 4; i++) { px(PL - 2 + i, PB + i, GL - PL + 2 - i, 1, i % 2 ? EDGE2 : EDGE); px(GR, PB + i, PR - GR + 2 - i, 1, i % 2 ? EDGE2 : EDGE); }
  for (let i = 0; i < 3; i++) { px(PL - 3 + i, PT + 2, 1, PB - PT, i % 2 ? EDGE2 : EDGE); px(PR + 2 - i, PT + 2, 1, PB - PT, i % 2 ? EDGE2 : EDGE); }
  for (const [x0, x1] of [[PL, GL], [GR, PR]]) {
    px(x0, PT, x1 - x0, PB - PT, PAGE);
    for (let y = PT; y < PB; y++) for (let x = x0; x < x1; x++) { const v = (x * 11 + y * 7 + x * y * 3) % 23; if (v === 0) px(x, y, 1, 1, PAGE2); }
    px(x0, PT, x1 - x0, 1, EDGE); px(x0, PB - 1, x1 - x0, 1, PAGE3);
  }
  [PAGE2, PAGE2, PAGE3, PAGE3, PAGE4, "#8a7650"].forEach((c, i) => { px(GL - 6 + i, PT, 1, PB - PT, c); px(GR + 5 - i, PT, 1, PB - PT, c); });
  px(GL, PT - 1, GR - GL, PB - PT + 3, "#3a2a18"); px(GL + 1, PT - 1, 2, PB - PT + 3, "#1a1008");
  [[40, 150], [41, 150], [40, 151], [120, 30], [121, 31]].forEach(([x, y]) => px(x, y, 1, 1, "rgba(120,80,30,.35)"));
  const dark = !!entry?.side; // zápis skrytej postavy: obe strany temné ako HIDDEN strana, fialový pentagram
  grimoirePage(px, PL, GL, true, dark, !!entry);
  grimoirePage(px, GR, PR, false, !entry || dark, !!entry); // obsah: pravá strana = zakázaná (skryté postavy)
}

// strana grimoáru: obhorené vonkajšie okraje, kúzelný kruh s hviezdou pretiahnutý atramentom (vľavo čiernym,
// vpravo fialovým), drobné runy pri okrajoch; forbidden = temná, fialová
function grimoirePage(px, x0, x1, left, forbidden, faint = false) { // faint = stránka postavy: pentagram len slabý vodotlač
  const outer = left ? x0 : x1 - 1;
  if (forbidden) {
    for (let y = PT; y < PB; y++) for (let x = x0; x < x1; x++) {
      const v = (x * 13 + y * 7 + x * y) % 19, d = Math.min(y - PT, PB - 1 - y, Math.abs(x - outer));
      px(x, y, 1, 1, `rgba(${v < 2 ? "20,6,28" : "34,12,44"},${(.42 + Math.max(0, 6 - d) * .06 + (v < 2 ? .1 : 0)).toFixed(2)})`);
    }
  }
  for (let y = PT; y < PB; y++) for (let x = x0; x < x1; x++) {
    const d = Math.min(y - PT, PB - 1 - y, Math.abs(x - outer)); if (d > 5) continue;
    const n = (x * 31 + y * 17) % 7; px(x, y, 1, 1, `rgba(${forbidden ? "10,2,14" : "60,32,10"},${((6 - d) * .08 + (n === 0 ? .08 : 0)).toFixed(2)})`);
  }
  // kruh s päťcípou hviezdou - na oboch stranách v rovnakej výške, vycentrovaný na strednú fotku vľavo
  const cx = (x0 + x1) / 2, cy = 91, R = 46;
  const inkCol = forbidden ? "rgba(176,96,255,.62)" : faint ? "rgba(18,10,8,.1)" : "rgba(18,10,8,.5)", halo = forbidden ? "rgba(150,70,240,.16)" : faint ? "rgba(0,0,0,0)" : "rgba(18,10,8,.08)";
  const dots = new Set(), dot = (x, y) => dots.add(`${Math.round(x)},${Math.round(y)}`);
  for (let a = 0; a < 360; a += .5) { const r = a * Math.PI / 180; dot(cx + Math.cos(r) * R, cy + Math.sin(r) * R); dot(cx + Math.cos(r) * (R - 5), cy + Math.sin(r) * (R - 5)); }
  const star = [0, 2, 4, 1, 3, 0].map(k => [cx + Math.cos(-Math.PI / 2 + k * 2 * Math.PI / 5) * (R - 6), cy + Math.sin(-Math.PI / 2 + k * 2 * Math.PI / 5) * (R - 6)]);
  for (let k = 0; k < 5; k++) { const [ax, ay] = star[k], [bx, by] = star[k + 1], n = Math.ceil(Math.hypot(bx - ax, by - ay)) * 2; for (let t = 0; t <= n; t++) dot(ax + (bx - ax) * t / n, ay + (by - ay) * t / n); }
  const halos = new Set();
  for (const key of dots) { const [x, y] = key.split(",").map(Number); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const h = `${x + dx},${y + dy}`; if (!dots.has(h)) halos.add(h); } }
  for (const h of halos) { const [x, y] = h.split(",").map(Number); px(x, y, 1, 1, halo); }
  for (const key of dots) { const [x, y] = key.split(",").map(Number); px(x, y, 1, 1, inkCol); }
  for (let k = 0; k < 5; k += 2) { const [sx, sy] = star[k]; px(Math.round(sx), Math.round(sy) + 1, 1, 2, inkCol); px(Math.round(sx) + 1, Math.round(sy) + 3, 1, 1, inkCol); } // kvapky na hrotoch
  const rc = forbidden ? "rgba(170,90,255,.35)" : "rgba(60,32,10,.3)", G = [[1, 0, 1, 1, 1, 2, 0, 1, 2, 1], [0, 0, 2, 0, 1, 1, 0, 2, 2, 2], [0, 0, 1, 0, 2, 0, 1, 1, 1, 2]];
  for (let x = x0 + 10, k = 0; x < x1 - 12; x += 9, k++) for (const yy of [PT + 4, PB - 7]) { const g = G[k % 3]; for (let q = 0; q < g.length; q += 2) px(x + g[q], yy + g[q + 1], 1, 1, rc); }
}

// ---- odtrhnutá pravá časť listu (súradnice v px knihy), zubatý okraj až po spodok strany ----
const TORN_BOX = { x: 456, y: 30, w: 408, h: 522 };
const TORN_KEYS = [[748, 30], [734, 90], [740, 150], [718, 205], [722, 270], [714, 330], [736, 400], [748, 470], [742, 552]];
const pct = (x, y) => `${((x - TORN_BOX.x) / TORN_BOX.w * 100).toFixed(1)}% ${((y - TORN_BOX.y) / TORN_BOX.h * 100).toFixed(1)}%`;
function tornPolygon(seed) {
  const pts = [], jit = (k) => Math.sin(k * 2.7 + seed) * 4 + Math.cos(k * 1.3 + seed * 2) * 3;
  for (let k = 0; k < TORN_KEYS.length - 1; k++) {
    const [ax, ay] = TORN_KEYS[k], [bx, by] = TORN_KEYS[k + 1], n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 9)), vert = Math.abs(by - ay) > Math.abs(bx - ax);
    for (let t = 0; t < n; t++) { const q = k * 20 + t; pts.push(pct(ax + (bx - ax) * t / n + (vert ? jit(q) : 0), ay + (by - ay) * t / n + (vert ? 0 : jit(q)))); }
  }
  pts.push(pct(...TORN_KEYS[TORN_KEYS.length - 1]), "100% 100%", "100% 0%");
  return `polygon(${pts.join(",")})`;
}

// strana pod trhlinou: úhľadné runové zápisky mága (Codex Runicus) čiernym atramentom na fľakatom pergamene
const RUNE_GLYPHS = [
  ["#...", "##..", "#.#.", "##..", "#.#.", "#...", "#..."], ["###.", "#..#", "#..#", "#..#", "#..#", "#..#", "#..#"],
  ["#...", "##..", "#.#.", "#.#.", "##..", "#...", "#..."], ["##..", "#.#.", "##..", "#.#.", "#..#", "#...", "#..."],
  [".#..", ".#..", "####", ".#..", ".#..", ".#..", ".#.."], [".#..", ".#..", ".#..", ".#..", ".#..", ".#..", ".#.."],
  [".#..", "##..", ".##.", ".#.#", ".#..", ".#..", ".#.."], ["..#.", ".#..", "#...", ".#..", "..#.", ".#..", "#..."],
  [".#..", "###.", "#.##", ".#..", ".#..", ".#..", ".#.."], ["#...", "##..", "#.#.", "##..", "#.#.", "##..", "#..."],
  ["#..#", "##.#", "#.##", "#..#", "#..#", "#..#", "#..#"], ["#...", "##..", "#.#.", "#...", "#...", "#...", "#..."],
  ["#.#.", "#.#.", ".#..", ".#..", ".#..", ".#..", ".#.."], [".#..", "###.", ".#..", "###.", ".#..", ".#..", ".#.."],
  ["#.#.", ".#..", "#.#.", ".#..", ".#..", ".#..", ".#.."], [".#..", ".##.", ".#.#", ".##.", ".#..", ".#..", ".#.."],
];
function drawUnderPage(cv) {
  const W = 136, H = 174; cv.width = W; cv.height = H; const x = cv.getContext("2d"), px = (a, b, w, h, c) => { x.fillStyle = c; x.fillRect(a, b, w, h); };
  const rnd = (k) => { const v = Math.sin(k * 12.9898 + 4.1) * 43758.5453; return v - Math.floor(v); }; // deterministické (vždy rovnaká strana)
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    const cl = Math.sin(xx * .07 + yy * .03) + Math.sin(xx * .023 - yy * .061 + 2) + Math.cos(yy * .045 + xx * .015), g = (xx * 11 + yy * 7 + xx * yy * 3) % 19;
    const e = Math.min(xx, yy, W - 1 - xx, H - 1 - yy), dark = Math.max(0, 8 - e) * 3;
    px(xx, yy, 1, 1, `rgb(${(182 + cl * 9 - dark - (g === 0 ? 8 : 0)) | 0},${(150 + cl * 9 - dark * 1.1 - (g === 0 ? 8 : 0)) | 0},${(98 + cl * 8 - dark * 1.3) | 0})`);
  }
  for (const [sx, sy, sr] of [[34, 120, 7], [96, 60, 5], [70, 150, 9]]) for (let yy = -sr; yy <= sr; yy++) for (let xx = -sr; xx <= sr; xx++) { const d = Math.hypot(xx, yy) / sr; if (d < 1) px(sx + xx, sy + yy, 1, 1, `rgba(120,80,30,${((1 - d) * .18).toFixed(2)})`); }
  const INK = "rgba(18,12,10,.82)", RIGHT = W - 7, gw = (g) => (g.some(rw => rw[3] === "#") ? 5 : 4);
  for (let row = 0, base = 10; base + 8 < H - 6; row++, base += 12) {
    let xx = 6, k = row * 97;
    for (;;) {
      const len = 2 + Math.floor(rnd(k++) * 4), word = [];
      for (let q = 0; q < len; q++) word.push(RUNE_GLYPHS[Math.floor(rnd(k++) * RUNE_GLYPHS.length)]);
      while (word.length && xx + word.reduce((s, g) => s + gw(g), 0) > RIGHT) word.pop(); // riadok siaha k okraju
      if (!word.length) break;
      for (const g of word) { g.forEach((rw, yy) => [...rw].forEach((c, gx) => { if (c === "#") px(xx + gx, base + yy, 1, 1, INK); })); xx += gw(g); }
      if (xx + 3 > RIGHT) break;
      px(xx, base + 2, 1, 1, INK); px(xx, base + 5, 1, 1, INK); xx += 3; // dvojbodka
    }
  }
}

// symbol svetla a tmy na spodku zakázanej strany: jin-jang (lúče / hviezdy), biela sviečka a čierna sviečka -
// nakreslený na stred celej strany, odtrhnutý list z neho vzal pravú časť
function drawBalance(cv) {
  const W = 136, H = 76; cv.width = W; cv.height = H; const x = cv.getContext("2d"), px = (a, b, w, h, c) => { x.fillStyle = c; x.fillRect(a, b, w, h); };
  const INK = "#1a120c", cx = 68, cy = 38, R = 24;
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    const d = Math.hypot(xx - cx, yy - cy); if (d < R || d > R + 14) continue; const a = (1 - (d - R) / 14) * .35;
    px(xx, yy, 1, 1, xx < cx ? `rgba(255,236,170,${a.toFixed(2)})` : `rgba(60,20,90,${a.toFixed(2)})`);
  }
  for (let k = 0; k < 9; k++) { const ang = Math.PI / 2 + k * Math.PI / 8, l = k % 2 ? 6 : 9; for (let t = 2; t < l; t++) px(Math.round(cx + Math.cos(ang) * (R + t)), Math.round(cy + Math.sin(ang) * (R + t)), 1, 1, "#d8a83a"); }
  [[cx + 30, cy - 18], [cx + 34, cy + 4], [cx + 26, cy + 22], [cx + 38, cy - 6]].forEach(([sx, sy], k) => { px(sx, sy, 1, 1, "#c9a0ff"); if (k % 2 === 0) { px(sx - 1, sy, 3, 1, "rgba(201,160,255,.6)"); px(sx, sy - 1, 1, 3, "rgba(201,160,255,.6)"); } });
  for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
    const d = Math.hypot(xx, yy); if (d > R) continue;
    let light = xx < 0;
    if (Math.hypot(xx, yy + R / 2) < R / 2) light = false; else if (Math.hypot(xx, yy - R / 2) < R / 2) light = true;
    if (Math.hypot(xx, yy + R / 2) < 3.2) light = true;
    if (Math.hypot(xx, yy - R / 2) < 3.2) light = false;
    const n = ((xx + 40) * 7 + (yy + 40) * 13) % 11;
    px(cx + xx, cy + yy, 1, 1, d > R - 1.3 ? INK : light ? (n === 0 ? "#f0dca0" : "#fbf0c8") : (n === 0 ? "#3a2450" : "#120c18"));
  }
  const candle = (sx, light) => {
    const body = light ? "#f4ecd8" : "#18121c", side = light ? "#c9bea0" : "#000", top = H - 30;
    px(sx - 4, H - 6, 9, 3, INK); px(sx - 3, H - 7, 7, 1, light ? "#b8862b" : "#5a4a60");
    px(sx - 2, top, 5, H - 7 - top, body); px(sx + 2, top, 1, H - 7 - top, side); px(sx - 2, top, 1, H - 7 - top, light ? "#fff" : "#2a2230");
    px(sx - 2, top, 2, 3, body); px(sx - 3, top + 2, 1, 2, body);
    px(sx, top - 2, 1, 2, INK);
    const f1 = light ? "#ffd36b" : "#c9a0ff", f2 = light ? "#fff1a8" : "#efe0ff", glow = light ? "rgba(255,210,110,.25)" : "rgba(160,80,255,.3)";
    for (let yy = -7; yy <= 7; yy++) for (let xx = -7; xx <= 7; xx++) if (Math.hypot(xx, yy) < 7) px(sx + xx, top - 6 + yy, 1, 1, glow);
    px(sx - 1, top - 5, 3, 3, f1); px(sx, top - 7, 1, 2, f1); px(sx, top - 4, 1, 2, f2);
  };
  candle(cx - 39, true); candle(cx + 39, false);
}

// ---- postavy: fotka pripnutá špendlíkom + meno na prúžku; skryté = silueta (biele svetlé, čierne tmavé) ----
function card(c, n, side = "") {
  const cls = `cx-card${side ? " " + side : ""}${!c ? " soon" : c.side ? " sealed" : ""}`;
  const ph = c ? `<canvas width="48" height="48" data-k="${c.key}"></canvas>` : `<span class="cx-q">?</span>`;
  return `<div class="${cls}"${c ? ` data-k="${c.key}"` : ""} style="--r:${tilt(n)}deg"><span class="cx-ph"><span class="cx-pin"></span>${ph}</span><span class="cx-nm">${c ? shortName(c) : "COMING SOON"}</span></div>`;
}

function build() {
  backdrop = document.createElement("div");
  backdrop.className = "ui-backdrop codex-bd hidden";
  root = document.createElement("div");
  root.className = "codex-wrap hidden";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Codex");
  root.innerHTML = `<div class="codex-book"><canvas class="cx-book"></canvas><button type="button" class="cx-back">↩ CONTENTS</button><button type="button" class="cx-x" aria-label="Close">✕</button>
    <div class="cx-pg l"></div><div class="cx-pg r"></div><canvas class="cx-balance"></canvas>
    <div class="cx-torn"><div class="cx-fiber"></div><canvas class="cx-under"></canvas></div></div>`;
  document.body.append(backdrop, root);
  book = root.querySelector(".codex-book");
  backdrop.addEventListener("click", closeCodex);
  root.addEventListener("click", (e) => {
    if (e.target === root || e.target.closest(".cx-x")) { closeCodex(); return; }
    if (e.target.closest(".cx-back")) { showContents(); return; }
    const k = !book.classList.contains("entry") && e.target.closest(".cx-card[data-k]")?.dataset.k;
    if (k) openEntry(k);
  });
  // Esc: zo stránky postavy späť na obsah, z obsahu zavrieť
  document.addEventListener("keydown", (e) => { if (e.key !== "Escape" || !isOpen()) return; if (book.classList.contains("entry")) showContents(); else closeCodex(); });
  window.addEventListener("resize", () => { if (isOpen()) fit(); });
}

function contents() {
  const main = CHAR_LIST.filter(c => !c.side), white = CHAR_LIST.filter(c => c.side === "p1"), black = CHAR_LIST.filter(c => c.side === "p2");
  const row = (arr, off, side) => [...arr, null, null, null].slice(0, 3).map((c, k) => card(c, off + k, side)).join("");
  book.querySelector(".cx-pg.l").innerHTML = `<div class="cx-cards">${main.map((c, n) => card(c, n)).join("")}</div>`;
  book.querySelector(".cx-pg.r").innerHTML = `<div class="cx-cards">${row(white, 9, "w")}${row(black, 12, "b")}</div>`;
  book.querySelectorAll("canvas[data-k]").forEach(cv => drawHead(cv, CHAR_LIST.find(c => c.key === cv.dataset.k)));
}
function showContents() {
  book.classList.remove("entry", "dark-page");
  contents();
  drawBook(book.querySelector(".cx-book"));
}
function openEntry(key) {
  const c = CHAR_LIST.find(x => x.key === key); if (!c) return;
  book.classList.add("entry");
  renderEntry(book, c);
  drawBook(book.querySelector(".cx-book"), c);
}
function draw() {
  showContents();
  drawBalance(book.querySelector(".cx-balance"));
  drawUnderPage(book.querySelector(".cx-under"));
  book.querySelector(".cx-torn").style.setProperty("--tp", tornPolygon(3));
  built = true;
}

// kniha na stred, čo najväčšia, čo sa zmestí (min. pôvodná veľkosť)
function fit() {
  const { w, h } = appSize();
  const k = Math.max(.5, Math.min(1.6, (w - 60) / (BW + 28), (h - 50) / (BH + 28)));
  book.style.setProperty("--cx-k", k.toFixed(3));
}

const isOpen = () => !!root && !root.classList.contains("hidden");
export function openCodex() {
  if (!root) build();
  if (!built) draw(); else showContents(); // vždy od obsahu
  fit();
  backdrop.classList.remove("hidden");
  root.classList.remove("hidden");
}
export function closeCodex() {
  if (!root) return;
  backdrop.classList.add("hidden");
  root.classList.add("hidden");
}
