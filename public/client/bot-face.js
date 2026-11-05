// public/client/bot-face.js - tvár AI bota v jeho HUD namiesto portrétu postavy (docs/AI_PLAN.md, návrh
// public/dev/bot-face.html). Pixelová hlava-monitor (32×32, zväčšená bez vyhladenia) s náladou podľa priebehu hry.
// Nálada vychádza LEN z verejných udalostí timeline (zásahy, bloky, odrazy) a stavu (HP, mana, doom) - nikdy
// z ťahu, ktorý si bot zvolil (tvár nesmie prezradiť jeho plán): počas plánovania kola bot „premýšľa".
// Okno postavy (peek.js) funguje ďalej - tvár sa kreslí do toho istého .hud-char canvasu.
import { state } from "/client/session.js";
import { playback } from "/client/playback.js";
import { paintFox, foxBuffer } from "/client/bot-face-fox.js";
import { sfx } from "/client/sound.js";
import { review } from "/client/review-state.js";

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
const PRIO = { angry: 5, surprised: 4, frown: 3, smug: 2, mock2: 1.5, happy: 1 };
function pulse(mood, ms, now = performance.now()) {
  if (face.transient && now < face.until && PRIO[face.transient] > PRIO[mood]) return; // silnejšia emócia z toho istého beatu
  face.transient = mood; face.until = now + ms;
}
// jeden frame prehrávanej timeline (volá timeline.js) - reakcie na verejné efekty
// zvuk nálady (bot.<nálada>.<úroveň>, docs/SOUNDS.md); mock2 (rehot CHEATERA) má zvuk happy
function moodSound(mood) { sfx(`bot.${mood === "mock2" ? "happy" : mood}`, { char: botLevel() }); }
export function botFaceFrame(frame) {
  const b = botSlot();
  if (!b) return;
  const h = b === "p1" ? "p2" : "p1";
  const until0 = face.until;
  playFrame(frame, b, h);
  // jeden zvuk za beat - len víťazná (najsilnejšia) reakcia frame-u
  if (face.until !== until0 && face.transient) moodSound(face.transient);
}
function playFrame(frame, b, h) {
  for (const e of frame?.effects || []) {
    if (e.kind === "hit" && e.dmg > 0) {
      // CHEATER sa pri 5+ dmg rehoce (mock2), NORMAL / BABY majú len happy
      if (e.target === h) pulse(e.dmg >= 5 && botLevel() === "cheater" ? "mock2" : "happy", e.dmg >= 5 ? 3000 : 2000);
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
// overlay losovania (arena-roll.js / ruleta farieb / char-roll.js) je hore - bez importu char-select.js,
// lebo bot-face.js načítavajú aj dev stránky samostatne
const introOverlay = () => ["arena-roll", "color-roll", "char-roll"].some(id => { const el = document.getElementById(id); return !!el && !el.classList.contains("hidden"); });
function baseline() {
  const b = botSlot(), me = state?.[b], foe = state?.[b === "p1" ? "p2" : "p1"];
  if (face.end && face.end.game === (state?.series?.gameIndex ?? 1) && (me?.hp <= 0 || foe?.hp <= 0)) return face.end.mood;
  face.end = null;
  if (!me || !foe) return "neutral";
  // losovanie arény / farieb / postáv ešte beží (overlay) - bot „nepremýšľa" nahlas skôr, než hráč vidí dosku
  if (introOverlay()) return "neutral";
  // plánovanie kola: bot počíta, kým nezamkne (po zamknutí len nálada zo stavu - nie z ťahu)
  if (state.phase === "playing" && !playback.playing && !me.locked && !state.timestop) return "thinking";
  if (me.lastStandBuff || me.hp <= 3) return "worried";
  if (foe.hp - me.hp >= 4) return "sad";
  return "neutral";
}

// stavové nálady so zvukom pri vstupe do stavu (premýšľa nad kolom, ≤ 3 HP / Last Stand, prehráva, koniec hry)
const STATE_SOUND = new Set(["thinking", "worried", "sad", "laugh", "ko"]);
let lastBase; // undefined = ešte nič (prvé vyhodnotenie po načítaní stránky nehrá)

// HUD canvas medzitým kreslil portrét postavy (rozbor zápasu prepína medzi zápasmi s botom a bez neho) → tvár
// nakresli znova, aj keď sa jej nálada / snímok nezmenili
export function invalidateBotFace() { face.lastKey = ""; }

/* ---------- kreslenie do HUD canvasu ---------- */
export function drawBotFace(cvs, now) {
  // rozbor zápasu (ANALYZE): statická hlava bota v pokojnej nálade, bez zvukov nálad
  const base = review.active ? "neutral" : baseline();
  if (review.active) lastBase = undefined;
  else if (base !== lastBase) {
    if (lastBase !== undefined && STATE_SOUND.has(base)) moodSound(base);
    lastBase = base;
  }
  const want = !review.active && face.transient && now < face.until ? face.transient : base;
  const lv = botLevel();
  if (!(lv === "cheater" ? paintFox : lv === "baby" ? paintBaby : paintFace)(face, want, now, cvs.width)) return;
  // buffer až PO kreslení - pri úplne prvom kreslení (rovno do hry, napr. TRAINING GROUNDS) ešte neexistoval
  const src = lv === "cheater" ? foxBuffer() : off;
  const ctx = cvs.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  // .hud-char má hornú tretinu orezanú (clip-path v styles.css - prázdny vzduch nad postavou): tvár ide do
  // viditeľnej spodnej časti, v celočíselnom zväčšení (rovnaké pixely)
  const k = Math.max(1, Math.floor((cvs.height * 2 / 3 - 4) / 32)), s = 32 * k;
  ctx.drawImage(src, 0, 0, 32, 32, Math.round((cvs.width - s) / 2), cvs.height - s - 2, s, s);
}

// nakreslí hlavu (32×32) v nálade `want` do bufferu `off`; f = stav tváre (nálada, žmurkanie, záblesk).
// Vráti false, keď sa obrázok od minula nezmenil (netreba prekresľovať).
function paintFace(f, want, now, salt) {
  ensureBuf();
  if (want !== f.mood) {
    f.mood = want; f.since = now; f.flashUntil = now + (want === "surprised" ? 220 : 90);
  }
  const m = MOODS[f.mood], age = now - f.since;
  const tick = Math.floor(now / 66); // ~15 fps - pixel art viac nepotrebuje
  if (now > f.nextBlink) { f.blinkUntil = now + 120; f.nextBlink = now + 2000 + Math.random() * 3000; }
  const blink = now < f.blinkUntil && !["ko", "laugh", "happy"].includes(f.mood);
  const key = `${f.mood}:${tick}:${blink}:${salt}`;
  if (key === f.lastKey) return false; // ten istý obrázok - nekresli znova
  f.lastKey = key;

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
  const flash = now < f.flashUntil;
  for (let y = 0; y < SCR.h; y++) for (let x = 0; x < SCR.w; x++) {
    put(sx + x, sy + y, flash ? mix(BG, C, 0.35) : BG.map(v => Math.round(v * (y % 2 ? 0.82 : 1))));
  }
  let ex = 0;
  if (m.fx === "think") ex = [-1, 0, 1, 0][Math.floor(now / 700) % 4];
  if (f.mood === "neutral") ex = Math.floor(now / 2600) % 3 === 1 ? 1 : 0;
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
  return true;
}

/* ---------- BABY bot (obťažnosť BABY, návrh public/dev/ai-difficulty.html - variant D · BIB + cumlík FRONT RING) ----------
   Okrúhla pastelová hlava, srdiečko na anténke, podbradník, ružové líčka a cumlík, ktorý stále dudle. Nálady
   (rovnaké spúšťače ako NORMAL) mení LEN očami (+ slzy / pot / poskočenie); cumlík ostáva v ústach aj pri K.O. */
const bb = (rows) => rows.map(r => [...r].map(c => (c === "#" ? 2 : c === "+" ? 1 : c === "o" ? 3 : 0)));
const B_EYES = {
  dot:    bb([".###.", "#o###", "#####", "#####", ".###."]),
  happy:  bb([".....", ".###.", "#...#", "#...#", "....."]),
  wide:   bb([".###.", "#...#", "#.#.#", "#...#", ".###."]),
  closed: bb([".....", ".....", "#####", ".....", "....."]),
  up:     bb([".###.", "#o###", "#####", ".....", "....."]),
  down:   bb([".....", ".....", "#####", "#o###", ".###."]),
  half:   bb([".....", ".....", "#####", "#####", "....."]),
  gtL:    bb(["#....", ".##..", "...#.", ".##..", "#...."]),
  ltR:    bb(["....#", "..##.", ".#...", "..##.", "....#"]),
  x:      bb(["#...#", ".#.#.", "..#..", ".#.#.", "#...#"]),
};
const B_BROWS = {
  worried: [bb(["...##", "###.."]), bb(["##...", "..###"])],
  pout:    [bb(["##...", "..###"]), bb(["...##", "###.."])],
  raised:  [bb([".###.", "....."]), bb([".###.", "....."])],
};
const B_MOODS = {
  neutral:   { col: "#8ff0ff", eyes: ["dot", "dot"] },
  thinking:  { col: "#d7b8ff", eyes: ["up", "up"], fx: "think" },
  happy:     { col: "#9dff9a", eyes: ["happy", "happy"], fx: "bob" },
  smug:      { col: "#d9ff8a", eyes: ["half", "dot"] },
  frown:     { col: "#ffd88a", eyes: ["down", "down"], brows: "worried", fx: "sniff" },
  angry:     { col: "#ff9a9a", eyes: ["down", "down"], brows: "pout", fx: "cry" }, // trafený silno → plače
  surprised: { col: "#fff07a", eyes: ["wide", "wide"], brows: "raised", fx: "bang" },
  worried:   { col: "#b5d0ff", eyes: ["dot", "dot"], brows: "worried", fx: "sweat" },
  sad:       { col: "#8fbaff", eyes: ["down", "down"], brows: "worried", fx: "tear" },
  laugh:     { col: "#9dff9a", eyes: ["gtL", "ltR"], fx: "laugh" },
  ko:        { col: "#a7adb5", eyes: ["x", "x"], fx: "ko" },
};
const B_BODY = [178, 204, 232], B_HI = [222, 236, 250], B_LO = [112, 134, 176];
const B_PINK = [255, 140, 192], B_PINK_LO = [196, 70, 130];
const B_PACI = { P: [255, 140, 192], p: [196, 70, 130], w: [255, 214, 232], r: [255, 190, 90], k: [255, 190, 90] };
// cumlík FRONT RING: motýlí štít + krúžok spredu (vrstvy { rows, dx })
const B_SHIELD = [".ppp...ppp.", "pPwPp.pPPPp", "pPPPPpPPPPp", "pPPPp.pPPPp", ".ppp...ppp."];
const B_RING = [".rrr.", "r...r", "r.k.r", "r...r", ".rrr."];
const B_SCR = { x: 6, y: 10, w: 20, h: 16 };
const inRound = (x, y, x0, y0, x1, y1, r) => {
  const dx = Math.max(x0 + r - x, 0, x - (x1 - r)), dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && dx * dx + dy * dy <= r * r + 1;
};
const inHead = (x, y) => inRound(x, y, 2, 7, 29, 30, 5);
const TEAR = [130, 190, 255], TEAR_HI = [200, 232, 255];

function paintBaby(f, want, now, salt) {
  ensureBuf();
  if (want !== f.mood) { f.mood = want; f.since = now; f.flashUntil = 0; }
  const m = B_MOODS[f.mood] || B_MOODS.neutral, age = now - f.since;
  const tick = Math.floor(now / 66);
  if (now > f.nextBlink) { f.blinkUntil = now + 130; f.nextBlink = now + 1800 + Math.random() * 2800; }
  const blink = now < f.blinkUntil && !["ko", "laugh", "happy", "angry"].includes(f.mood);
  const key = `b:${f.mood}:${tick}:${blink}:${salt}`;
  if (key === f.lastKey) return false;
  f.lastKey = key;

  img.data.fill(0);
  const C = hexRgb(m.col), DIM = mix(C, [10, 16, 24], 0.6), BG = mix(C, [8, 12, 18], 0.9);
  let jx = 0, jy = 0;
  if (m.fx === "bob") jy = Math.floor(now / 420) % 2 ? -1 : 0;
  if (m.fx === "laugh") jy = Math.floor(now / 160) % 2 ? -1 : 0;
  if (m.fx === "cry" && age < 1200) jx = Math.round(Math.sin(now / 30));
  // anténka so srdiečkom (pri premýšľaní bliká)
  for (let y = 4; y <= 6; y++) put(15 + jx, y + jy, B_LO);
  const H = f.mood === "ko" ? [120, 120, 128] : (m.fx === "think" && Math.floor(now / 260) % 2) ? B_PINK_LO : B_PINK;
  // srdiečko siaha po horný okraj 32×32 bufferu - pri poskočení (jy = −1) by sa orezalo, ostane preto na mieste
  // a skráti sa len stonka (anténka „pruží")
  stamp(bb(["##.##", "#####", ".###.", "..#.."]), 13 + jx, Math.max(0, jy), H, H);
  // okrúhla hlava
  for (let y = 6; y <= 30; y++) for (let x = 1; x <= 30; x++) {
    if (!inHead(x, y)) continue;
    const edge = !inHead(x - 1, y) || !inHead(x + 1, y) || !inHead(x, y - 1) || !inHead(x, y + 1);
    put(x + jx, y + jy, edge ? B_LO : y <= 9 ? B_HI : y >= 28 ? B_LO : B_BODY);
  }
  // podbradník so srdiečkom
  const half = [9, 9, 8, 7, 5];
  for (let k = 0; k < 5; k++) for (let x = 16 - half[k]; x <= 15 + half[k]; x++) {
    const edge = k === 4 || x === 16 - half[k] || x === 15 + half[k];
    put(x + jx, 27 + k + jy, edge ? B_PINK : [248, 248, 252]);
  }
  stamp(bb(["#.#", "###", ".#."]), 14 + jx, 28 + jy, [255, 120, 170], [255, 120, 170]);
  // uši-reproduktory
  for (let y = 15; y <= 20; y++) { put(jx, y + jy, B_LO); put(1 + jx, y + jy, B_HI); put(31 + jx, y + jy, B_LO); put(30 + jx, y + jy, B_HI); }
  // obrazovka
  const sx = B_SCR.x + jx, sy = B_SCR.y + jy;
  for (let y = 0; y < B_SCR.h; y++) for (let x = 0; x < B_SCR.w; x++) {
    if (inRound(x, y, 0, 0, B_SCR.w - 1, B_SCR.h - 1, 3)) put(sx + x, sy + y, BG.map(v => Math.round(v * (y % 2 ? 0.84 : 1))));
  }
  // oči (+ obočie)
  const ex = m.fx === "think" ? [-1, 0, 1, 0][Math.floor(now / 700) % 4] : 0;
  const [eL, eR] = m.eyes;
  stamp(B_EYES[blink ? "closed" : eL], sx + 2 + ex, sy + 3, C, DIM);
  stamp(B_EYES[blink ? "closed" : eR], sx + 13 + ex, sy + 3, C, DIM);
  if (m.brows) { const [bl, br] = B_BROWS[m.brows]; stamp(bl, sx + 2, sy, C, DIM); stamp(br, sx + 13, sy, C, DIM); }
  // líčka
  if (f.mood !== "ko") { const bl = f.mood === "angry" ? [255, 90, 110] : [255, 120, 170]; put(sx + 1, sy + 9, bl); put(sx + 2, sy + 9, bl); put(sx + 17, sy + 9, bl); put(sx + 18, sy + 9, bl); }
  // cumlík: v každej nálade na mieste a v rovnakej farbe, len dudle (rytmicky ho vtiahne o pixel)
  const px = sx + 4, py = sy + 9 + (Math.floor(now / 260) % 3 === 1 ? -1 : 0);
  B_SHIELD.forEach((row, y) => [...row].forEach((ch, x) => { if (B_PACI[ch]) put(px + x, py + y, B_PACI[ch]); }));
  B_RING.forEach((row, y) => [...row].forEach((ch, x) => { if (B_PACI[ch]) put(px + 3 + x, py + y, B_PACI[ch]); }));
  // efekty
  if (m.fx === "tear" || m.fx === "cry") {
    const sp = m.fx === "cry" ? 90 : 150;
    for (const ox of m.fx === "cry" ? [3, 14] : [3]) { const dy = Math.floor(age / sp) % 8; put(sx + ox, sy + 8 + dy, TEAR_HI); put(sx + ox, sy + 9 + dy, TEAR); }
    if (m.fx === "cry") { const dy = Math.floor((age + 300) / 90) % 8; put(sx + 1, sy + 8 + dy, TEAR); put(sx + 18, sy + 8 + dy, TEAR); }
  }
  if (m.fx === "sniff") { const dy = Math.floor(age / 220) % 5; put(sx + 3, sy + 8 + dy, TEAR); }
  if (m.fx === "sweat") { const dy = Math.floor(age / 180) % 6; put(sx + 19, sy + 1 + dy, TEAR_HI); put(sx + 19, sy + 2 + dy, TEAR); }
  if (m.fx === "bang" && age < 1400) { const c = hexRgb("#fff07a"); for (let y = 0; y < 4; y++) put(29, y, c); put(29, 5, c); put(30, 0, c); put(30, 1, c); }
  if (m.fx === "ko") { const s = [[2, 2], [3, 1], [4, 2], [3, 3]][Math.floor(now / 300) % 4]; put(sx + s[0] + 16, sy - 6 + s[1], [255, 230, 120]); }
  octx.putImageData(img, 0, 0);
  return true;
}
// obťažnosť bota v AI roomke (snapshot aiLevel)
export const botLevel = () => state?.aiLevel || "normal";
export const botIsBaby = () => botLevel() === "baby";

/* ---------- hlava bota v room browseri (klik = hra proti AI, lobby-bot.js) ---------- */
// plátno 32×34 umeleckých pixelov: len hlava (tá istá ako v HUD), pokojne sa vznáša; hop = poskakuje (hover)
export const FIGURE_W = 32, FIGURE_H = 34;
// baby = hlava Baby bota (obťažnosť BABY); level = "baby" / "cheater" / "normal" (prednosť pred baby)
export function drawBotFigure(cvs, mood, now, { hop = false, baby = false, level = null } = {}) {
  const lv = level || (baby ? "baby" : "normal");
  const k = Math.max(1, Math.floor(cvs.width / FIGURE_W));
  const y = hop ? [2, 1, 0, 1][Math.floor(now / 120) % 4] : 1 + (Math.floor(now / 900) % 2);
  // stav tváre per plátno (dev/rooms.html kreslí viac hláv naraz)
  const fc = cvs._botFace || (cvs._botFace = { mood: "neutral", since: 0, flashUntil: 0, blinkUntil: 0, nextBlink: 1500 + Math.random() * 2000, lastKey: "", figKey: "" });
  // paintFace kreslí do zdieľaného bufferu - pri viacerých plátnach ho treba prekresliť vždy, keď sa kreslí sem
  fc.lastKey = "";
  (lv === "cheater" ? paintFox : lv === "baby" ? paintBaby : paintFace)(fc, mood, now, "fig");
  const key = fc.lastKey + ":" + y + ":" + cvs.width;
  if (key === fc.figKey) return;
  fc.figKey = key;
  const ctx = cvs.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  ctx.drawImage(lv === "cheater" ? foxBuffer() : off, 0, 0, 32, 32, 0, y * k, 32 * k, 32 * k);
}
