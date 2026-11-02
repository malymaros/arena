// public/client/bot-face.js - tvár AI bota v jeho HUD namiesto portrétu postavy (docs/AI_PLAN.md, návrh
// public/dev/bot-face.html). Pixelová hlava-monitor (32×32, zväčšená bez vyhladenia) s náladou podľa priebehu hry.
// Nálada vychádza LEN z verejných udalostí timeline (zásahy, bloky, odrazy) a stavu (HP, mana, doom) - nikdy
// z ťahu, ktorý si bot zvolil (tvár nesmie prezradiť jeho plán): počas plánovania kola bot „premýšľa".
// Okno postavy (peek.js) funguje ďalej - tvár sa kreslí do toho istého .hud-char canvasu.
import { state } from "/client/session.js";
import { playback } from "/client/playback.js";

// slot bota v AI roomke (snapshot vsAi) alebo null
export const botSlot = () => (state?.vsAi === "p1" || state?.vsAi === "p2" ? state.vsAi : null);

/* ---------- pixel art ---------- */
const SCR = { x: 5, y: 9, w: 22, h: 17 };
const EYE_L = 3, EYE_R = 14, EYE_Y = 4, MOUTH_X = 5, MOUTH_Y = 11;
const bm = (rows) => rows.map(r => [...r].map(c => (c === "#" ? 2 : c === "+" ? 1 : 0)));
const EYES = {
  dot:    bm([".....", ".###.", ".###.", ".###.", "....."]),
  happy:  bm([".....", "..#..", ".#.#.", "#...#", "....."]),
  wide:   bm([".###.", "#...#", "#.#.#", "#...#", ".###."]),
  closed: bm([".....", ".....", "#####", ".....", "....."]),
  narrow: bm([".....", ".....", "#####", ".###.", "....."]),
  half:   bm([".....", ".....", "#####", "#####", "....."]),
  down:   bm([".....", ".....", ".###.", "#####", ".###."]),
  gtL:    bm(["##...", "..##.", "....#", "..##.", "##..."]),
  ltR:    bm(["...##", ".##..", "#....", ".##..", "...##"]),
  x:      bm(["#...#", ".#.#.", "..#..", ".#.#.", "#...#"]),
  up:     bm([".###.", ".###.", ".....", ".....", "....."]),
};
const BROWS = {
  angry:   [bm(["##...", "..###"]), bm(["...##", "###.."])],
  worried: [bm(["...##", "###.."]), bm(["##...", "..###"])],
  frown:   [bm([".....", "#####"]), bm([".....", "#####"])],
  raised:  [bm([".###.", "....."]), bm([".###.", "....."])],
  smug:    [bm([".....", "....."]), bm([".###.", "#...#"])],
};
const MOUTHS = {
  flat:   bm(["............", "..########..", "............", "............"]),
  smile:  bm(["#..........#", ".#........#.", "..########..", "............"]),
  open:   bm(["############", "#++++++++++#", ".#++++++++#.", "..########.."]),
  frown:  bm(["............", "..########..", ".#........#.", "#..........#"]),
  smirk:  bm(["...........#", "..........#.", "..########..", "............"]),
  o:      bm(["....####....", "...#++++#...", "...#++++#...", "....####...."]),
  teeth:  bm(["############", "#..#..#..#.#", "############", "............"]),
  wavy:   bm(["............", ".##..##..##.", "#..##..##..#", "............"]),
  none:   bm(["............"]),
  wobble: bm(["............", "###..####..#", "...##....##.", "............"]),
};
const MOODS = {
  neutral:   { col: "#5ef2ff", led: "#3ddc84", eyes: ["dot", "dot"],       mouth: "flat" },
  thinking:  { col: "#c59bff", led: "#c59bff", eyes: ["up", "up"],         mouth: "none", fx: "think" },
  happy:     { col: "#7dff7a", led: "#3ddc84", eyes: ["happy", "happy"],   mouth: "smile", fx: "bob" },
  smug:      { col: "#c9ff5a", led: "#3ddc84", eyes: ["half", "dot"],      mouth: "smirk", brows: "smug" },
  frown:     { col: "#ffcf5e", led: "#ffb300", eyes: ["dot", "dot"],       mouth: "frown", brows: "frown" },
  angry:     { col: "#ff5a5a", led: "#ff3b3b", eyes: ["narrow", "narrow"], mouth: "teeth", brows: "angry", fx: "shake" },
  surprised: { col: "#ffe95e", led: "#ffe95e", eyes: ["wide", "wide"],     mouth: "o", brows: "raised", fx: "bang" },
  worried:   { col: "#9fc4ff", led: "#ffb300", eyes: ["dot", "dot"],       mouth: "wavy", brows: "worried", fx: "sweat" },
  sad:       { col: "#6aa8ff", led: "#6aa8ff", eyes: ["down", "down"],     mouth: "frown", brows: "worried", fx: "tear" },
  laugh:     { col: "#7dff7a", led: "#3ddc84", eyes: ["gtL", "ltR"],       mouth: "open", fx: "laugh" },
  ko:        { col: "#9aa0a8", led: "#555555", eyes: ["x", "x"],           mouth: "wobble", fx: "glitch" },
};
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const METAL = [74, 80, 92], METAL_HI = [118, 126, 140], METAL_LO = [40, 44, 52], LED_OFF = [42, 45, 51];

let off = null, octx = null, img = null;
function ensureBuf() {
  if (off) return;
  off = document.createElement("canvas"); off.width = 32; off.height = 32;
  octx = off.getContext("2d");
  img = octx.createImageData(32, 32);
}
function put(x, y, rgb) {
  if (x < 0 || y < 0 || x > 31 || y > 31) return;
  const i = (y * 32 + x) * 4;
  img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
}
function stamp(b, ox, oy, col, dim) { b.forEach((row, y) => row.forEach((v, x) => { if (v) put(ox + x, oy + y, v === 2 ? col : dim); })); }

/* ---------- nálada ---------- */
const face = { mood: "neutral", since: 0, flashUntil: 0, blinkUntil: 0, nextBlink: 2000, transient: null, until: 0, end: null, lastKey: "" };
const PRIO = { angry: 5, surprised: 4, frown: 3, smug: 2, happy: 1 };
function pulse(mood, ms, now = performance.now()) {
  if (face.transient && now < face.until && PRIO[face.transient] > PRIO[mood]) return; // silnejšia emócia z toho istého beatu
  face.transient = mood; face.until = now + ms;
}
// jeden frame prehrávanej timeline (volá timeline.js) - reakcie na verejné efekty
export function botFaceFrame(frame) {
  const b = botSlot();
  if (!b) return;
  const h = b === "p1" ? "p2" : "p1";
  for (const e of frame?.effects || []) {
    if (e.kind === "hit" && e.dmg > 0) {
      if (e.target === h) pulse("happy", 2000);
      else if (e.target === b) pulse(e.dmg >= 5 ? "angry" : "frown", 2200);
    } else if ((e.kind === "block" || e.kind === "mirror") && e.target === b) pulse("smug", 2000);
    else if (e.kind === "mirror" && e.target === h) pulse("surprised", 1500);
    else if (e.kind === "breaker" && e.target === b && e.result === "break") pulse("surprised", 1500);
  }
}
// koniec hry (volá timeline.js): smiech / K.O. drží, kým nezačne ďalšia hra
export function botFaceGameEnd(winner) {
  const b = botSlot();
  if (b && (winner === "p1" || winner === "p2")) face.end = { mood: winner === b ? "laugh" : "ko", game: state?.series?.gameIndex ?? 1 };
}
function baseline() {
  const b = botSlot(), me = state?.[b], foe = state?.[b === "p1" ? "p2" : "p1"];
  if (face.end && face.end.game === (state?.series?.gameIndex ?? 1) && (me?.hp <= 0 || foe?.hp <= 0)) return face.end.mood;
  face.end = null;
  if (!me || !foe) return "neutral";
  // plánovanie kola: bot počíta, kým nezamkne (po zamknutí len nálada zo stavu - nie z ťahu)
  if (state.phase === "playing" && !playback.playing && !me.locked && !state.timestop) return "thinking";
  if (me.lastStandBuff || me.hp <= 3) return "worried";
  if (foe.hp - me.hp >= 4) return "sad";
  return "neutral";
}

/* ---------- kreslenie do HUD canvasu ---------- */
export function drawBotFace(cvs, now) {
  ensureBuf();
  const want = face.transient && now < face.until ? face.transient : baseline();
  if (want !== face.mood) {
    face.mood = want; face.since = now; face.flashUntil = now + (want === "surprised" ? 220 : 90);
  }
  const m = MOODS[face.mood], age = now - face.since;
  const tick = Math.floor(now / 66); // ~15 fps - pixel art viac nepotrebuje
  if (now > face.nextBlink) { face.blinkUntil = now + 120; face.nextBlink = now + 2000 + Math.random() * 3000; }
  const blink = now < face.blinkUntil && !["ko", "laugh", "happy"].includes(face.mood);
  const key = `${face.mood}:${tick}:${blink}:${cvs.width}`;
  if (key === face.lastKey) return; // ten istý obrázok - nekresli znova
  face.lastKey = key;

  img.data.fill(0);
  const C = hexRgb(m.col), DIM = mix(C, [8, 14, 20], 0.65), BG = mix(C, [6, 10, 14], 0.9);
  let jx = 0, jy = 0;
  if (m.fx === "shake" && age < 900) jx = Math.round(Math.sin(now / 25));
  if (m.fx === "laugh") jy = Math.floor(now / 160) % 2 ? -1 : 0;
  if (m.fx === "bob") jy = Math.floor(now / 450) % 2 ? -1 : 0;
  for (let y = 3; y <= 6; y++) put(15 + jx, y + jy, METAL);
  const ledOn = (m.fx === "shake" || m.fx === "think") ? Math.floor(now / 220) % 2 === 0 : true;
  const L = ledOn ? hexRgb(m.led) : LED_OFF;
  put(14 + jx, 1 + jy, L); put(15 + jx, 1 + jy, L); put(14 + jx, 2 + jy, L); put(15 + jx, 2 + jy, L);
  for (let y = 6; y <= 29; y++) for (let x = 2; x <= 29; x++) {
    if ((x === 2 || x === 29) && (y === 6 || y === 29)) continue;
    const edge = x === 2 || x === 29 || y === 6 || y === 29;
    put(x + jx, y + jy, edge ? METAL_LO : y === 7 ? METAL_HI : y >= 27 ? METAL_LO : METAL);
  }
  [[4, 8], [27, 8], [4, 27], [27, 27]].forEach(([x, y]) => put(x + jx, y + jy, METAL_HI));
  const sx = SCR.x + jx, sy = SCR.y + jy;
  const flash = now < face.flashUntil;
  for (let y = 0; y < SCR.h; y++) for (let x = 0; x < SCR.w; x++) {
    put(sx + x, sy + y, flash ? mix(BG, C, 0.35) : BG.map(v => Math.round(v * (y % 2 ? 0.82 : 1))));
  }
  let ex = 0;
  if (m.fx === "think") ex = [-1, 0, 1, 0][Math.floor(now / 700) % 4];
  if (face.mood === "neutral") ex = Math.floor(now / 2600) % 3 === 1 ? 1 : 0;
  const [eL, eR] = m.eyes;
  stamp(EYES[blink ? "closed" : eL], sx + EYE_L + ex, sy + EYE_Y, C, DIM);
  stamp(EYES[blink ? "closed" : eR], sx + EYE_R + ex, sy + EYE_Y, C, DIM);
  if (m.brows) { const [bl, br] = BROWS[m.brows]; stamp(bl, sx + EYE_L, sy + EYE_Y - 3, C, DIM); stamp(br, sx + EYE_R, sy + EYE_Y - 3, C, DIM); }
  stamp(m.fx === "laugh" && Math.floor(now / 160) % 2 ? MOUTHS.smile : MOUTHS[m.mouth], sx + MOUTH_X, sy + MOUTH_Y, C, DIM);
  if (m.fx === "think") { const n = Math.floor(now / 350) % 4; for (let k = 0; k < n; k++) { put(sx + 7 + k * 3, sy + 13, C); put(sx + 8 + k * 3, sy + 13, C); } }
  if (m.fx === "sweat") { const dy = Math.floor(age / 180) % 6; put(sx + 20, sy + 1 + dy, [140, 200, 255]); put(sx + 20, sy + 2 + dy, [90, 160, 255]); }
  if (m.fx === "tear") { const dy = Math.floor(age / 150) % 7; put(sx + EYE_L + 1, sy + EYE_Y + 5 + dy, [120, 180, 255]); }
  if (m.fx === "bang" && age < 1400) { const c = hexRgb("#ffe95e"); for (let y = 0; y < 4; y++) put(29, y, c); put(29, 5, c); put(30, 0, c); put(30, 1, c); }
  if (m.fx === "glitch") {
    const r = Math.floor(now / 90);
    for (let k = 0; k < 3; k++) {
      const yy = sy + ((r * 7 + k * 5) % SCR.h), len = 4 + ((r + k) % 9), x0 = sx + ((r * 3 + k * 11) % (SCR.w - len));
      for (let x = 0; x < len; x++) put(x0 + x, yy, mix(BG, C, 0.5));
    }
  }
  octx.putImageData(img, 0, 0);
  const ctx = cvs.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  // .hud-char má hornú tretinu orezanú (clip-path v styles.css - prázdny vzduch nad postavou): tvár ide do
  // viditeľnej spodnej časti, v celočíselnom zväčšení (rovnaké pixely)
  const k = Math.max(1, Math.floor((cvs.height * 2 / 3 - 4) / 32)), s = 32 * k;
  ctx.drawImage(off, 0, 0, 32, 32, Math.round((cvs.width - s) / 2), cvs.height - s - 2, s, s);
}
