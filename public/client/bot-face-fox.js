// public/client/bot-face-fox.js - tvár CHEATER bota (obťažnosť CHEATER, docs/AI_PLAN.md 8c; schválený návrh
// public/dev/cheater-face.html, 2026-11-03): monitor-hlava NORMAL bota s líščími prvkami - uši namiesto anténky,
// zúžená brada s čumákom, prefíkané šikmé oči, líščia oranžová obrazovka (zlosť červená, K.O. sivé). Dostane dmg =
// zúri (frown / angry), dá dmg = posmieva sa (happy / mock2 = 5+ dmg), prehráva na HP (sad) = zlostne fučí,
// výhra (laugh) = tanček s HA / EZ. Nálady (kľúče ako paintFace v bot-face.js) určuje bot-face.js.
// Kreslí do vlastného 32×32 bufferu (foxBuffer); paintFox vráti false, keď sa obrázok od minula nezmenil.
const S = 32;
let off = null, octx = null, img = null;
function ensureBuf() {
  if (off) return;
  off = document.createElement("canvas"); off.width = off.height = S;
  octx = off.getContext("2d"); img = octx.createImageData(S, S);
}
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function put(x, y, rgb) {
  if (!rgb || x < 0 || y < 0 || x > 31 || y > 31) return;
  const i = (y * 32 + x) * 4;
  img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
}
const bm = (rows) => rows.map(r => [...r]);
// znaky: # = farba obrazovky, + = tlmená, w = biela (tesáky), t / T = jazyk (svetlý / tmavý)
function stamp(b, ox, oy, col, dim, flip = false) {
  const TONGUE = [255, 111, 143], TONGUE_D = [194, 58, 90], WHITE = [240, 244, 248];
  b.forEach((row, y) => row.forEach((ch, x) => {
    const c = ch === "#" ? col : ch === "+" ? dim : ch === "w" ? WHITE : ch === "t" ? TONGUE : ch === "T" ? TONGUE_D : null;
    if (c) put(ox + (flip ? row.length - 1 - x : x), oy + y, c);
  }));
}
// ľavé oko (pravé = zrkadlo): šikmé = vnútorný kútik nižšie
const EYES = {
  sly:    bm([".....", "##...", "+###.", ".####", "..##."]),
  dot:    bm([".....", ".###.", ".###.", ".###.", "....."]),
  wink:   bm([".....", ".....", "#...#", ".###.", "....."]),
  happy:  bm([".....", "..#..", ".#.#.", "#...#", "....."]),
  wide:   bm([".###.", "#...#", "#.#.#", "#...#", ".###."]),
  closed: bm([".....", ".....", "#####", ".....", "....."]),
  up:     bm(["##...", ".###.", ".###.", ".....", "....."]),
  down:   bm([".....", ".....", ".###.", "#####", ".###."]),
  rage:   bm(["#....", ".##..", "..###", ".####", "....."]),
  gtL:    bm(["##...", "..##.", "....#", "..##.", "##..."]),
  ltR:    bm(["...##", ".##..", "#....", ".##..", "...##"]),
  x:      bm(["#...#", ".#.#.", "..#..", ".#.#.", "#...#"]),
};
const BROWS = {
  evil:    bm(["##...", "..###"]),
  steep:   bm(["#....", ".###."]),
  worried: bm(["...##", "###.."]),
  raised:  bm([".###.", "#...#"]),
};
const MOUTHS = {
  smirk:   bm(["...........#", "#.........#.", ".#########.."]),
  tongue:  bm(["############", "#w++++++++w#", ".#++++++++#.", "..##tttt##..", "....tTTt....", "....tTTt....", ".....tt....."]),
  tongue2: bm(["############", "#w++++++++w#", ".#++++++++#.", "..##tttt##..", ".....tTTt...", ".....tTTt...", "......tt...."]),
  laughO:  bm(["############", "#w++++++++w#", "#++++++++++#", ".#+++tt+++#.", "..########.."]),
  laughC:  bm(["............", "############", "#w........w#", ".##########."]),
  snarl:   bm(["############", "#w#++++++#w#", "#ww++++++ww#", "#+w+w++w+w+#", ".##########."]),
  gnash:   bm(["............", "############", "#w#w#w#w#w#w", "############", "............"]),
  scream:  bm(["############", "#w++++++++w#", "#++++++++++#", "#+++tttt+++#", "#+w+w++w+w+#", ".##########."]),
  o:       bm(["....####....", "...#++++#...", "...#++++#...", "....####...."]),
  wavy:    bm(["............", ".##..##..##.", "#..##..##..#", "............"]),
  sulk:    bm(["............", "..########..", ".#........#.", "#..........#"]),
  limp:    bm(["............", "###..####..#", "...##.t..##.", "......tt...."]),
};
// nálady = tie isté kľúče ako NORMAL (bot-face.js) + mock2 (dal 5+ dmg); ears: up / quiver (zúri) / low (prehráva, K.O.)
// jedna líščia oranžová pre všetky nálady (obrazovka aj LED), zlosť červená; K.O. sivé
const FOX_COL = "#ff8c1a", FOX_RAGE = "#ff3a2a"; // zlosť (dostal dmg, prehráva na HP) = červená
const MOODS = {
  neutral:   { col: FOX_COL, led: FOX_COL, eyes: ["sly", "sly"], brows: "evil", mouth: "smirk" },
  thinking:  { col: FOX_COL, led: FOX_COL, eyes: ["up", "up"], brows: "evil", mouth: "smirk", fx: "think" },
  happy:     { col: FOX_COL, led: FOX_COL, eyes: ["sly", "sly"], brows: "evil", mouth: "tongue", fx: "mock" },
  mock2:     { col: FOX_COL, led: FOX_COL, eyes: ["sly", "sly"], brows: "evil", mouth: "laughO", fx: "mock2" },
  smug:      { col: FOX_COL, led: FOX_COL, eyes: ["sly", "dot"], brows: "raisedR", mouth: "smirk", fx: "smug" },
  frown:     { col: FOX_RAGE, led: FOX_RAGE, eyes: ["rage", "rage"], brows: "steep", mouth: "snarl", ears: "quiver", fx: "rage" },
  angry:     { col: FOX_RAGE, led: FOX_RAGE, eyes: ["rage", "rage"], brows: "steep", mouth: "scream", ears: "quiver", fx: "rage2" },
  surprised: { col: FOX_COL, led: FOX_COL, eyes: ["sly", "sly"], brows: "raised", mouth: "o", fx: "bang" },
  worried:   { col: FOX_COL, led: FOX_COL, eyes: ["sly", "sly"], brows: "worried", mouth: "wavy", fx: "sweat" },
  sad:       { col: FOX_RAGE, led: FOX_RAGE, eyes: ["sly", "sly"], brows: "steep", mouth: "snarl", ears: "low", fx: "grumble" }, // prehráva = hnevá sa (zaťaté zuby, občas zafučí)
  laugh:     { col: FOX_COL, led: FOX_COL, eyes: ["sly", "sly"], brows: "evil", mouth: "tongue", fx: "win" },
  ko:        { col: "#9aa0a8", led: "#555555", eyes: ["x", "x"], mouth: "limp", ears: "low", fx: "glitch" },
};
const METAL = [74, 80, 92], METAL_HI = [118, 126, 140], METAL_LO = [40, 44, 52], LED_OFF = [42, 45, 51];
const EAR_IN = [232, 120, 52], EAR_TIP = [22, 24, 30], NOSE = [16, 17, 20];
const HA = hexRgb("#ffe95e"), STEAM = [[226, 230, 236], [160, 168, 180]], VEIN = hexRgb("#ff2a2a"), TEAR = [120, 180, 255], TEAR_HI = [200, 232, 255];
const FONT = { H: ["#.#", "#.#", "###", "#.#", "#.#"], A: [".#.", "#.#", "###", "#.#", "#.#"], "!": ["#", "#", "#", ".", "#"], "#": ["#.#", "###", "#.#", "###", "#.#"], "?": ["##.", "..#", ".#.", "...", ".#."], E: ["###", "#..", "##.", "#..", "###"], Z: ["###", "..#", ".#.", "#..", "###"] };
function text(str, x, y, col) { for (const ch of str) { const g = FONT[ch]; g.forEach((r, yy) => [...r].forEach((c, xx) => { if (c === "#") put(x + xx, y + yy, col); })); x += g[0].length + 1; } }
const inTri = (px, py, a, b, c) => {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = s([px, py], a, b), d2 = s([px, py], b, c), d3 = s([px, py], c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
// šírka hlavy po riadkoch (líščia brada sa zužuje k čumáku)
// hlava je o HY nižšie ako NORMAL - nad ňou je miesto na líščie uši
const HY = 2;
const ROW = (y) => (y <= 23 ? [2, 29] : y === 24 ? [3, 28] : y === 25 ? [4, 27] : y === 26 ? [6, 25] : y === 27 ? [8, 23] : y === 28 ? [10, 21] : y === 29 ? [12, 19] : null);
const inHead = (x, y) => { y -= HY; const r = y >= 6 && ROW(y); return !!r && x >= r[0] && x <= r[1] && !((x === 2 || x === 29) && y === 6); };
const SCR = { x: 5, y: 9 + HY, w: 22, h: 15 }, EYE_L = 3, EYE_R = 14, EYE_Y = 4, MOUTH_X = 5, MOUTH_Y = 10;

function paint(f, want, now) {
  if (want !== f.mood) { f.mood = want; f.since = now; f.flashUntil = now + (want === "surprised" || want === "angry" ? 220 : 90); }
  const m = MOODS[f.mood] || MOODS.neutral, age = now - f.since;
  if (now > f.nextBlink) { f.blinkUntil = now + 120; f.nextBlink = now + 2000 + Math.random() * 3000; }
  if (now > f.nextTwitch) { f.twitchUntil = now + 170; f.twitchSide = Math.random() < 0.5 ? 0 : 1; f.nextTwitch = now + 2200 + Math.random() * 2600; }
  const blink = now < f.blinkUntil && !["ko", "laugh", "mock2", "happy", "angry", "frown"].includes(f.mood);
  img.data.fill(0);
  const rage2 = m.fx === "rage2";
  let C = hexRgb(m.col);
  if (m.fx === "win" && Math.floor(now / 300) % 2) C = hexRgb("#ffd34a"); // víťazstvo: obrazovka strieda oranžovú a zlatú
  if (rage2 && Math.floor(now / 110) % 3 === 0) C = [255, 220, 210]; // záchvat: obrazovka bliká
  const DIM = mix(C, [8, 14, 20], 0.65), BG = mix(C, [6, 10, 14], 0.9);
  let jx = 0, jy = 0;
  if (m.fx === "rage" && age < 1100) jx = Math.round(Math.sin(now / 25));
  const huff = m.fx === "grumble" && now % 1800 < 260; // zlostné zafučanie každých ~1,8 s
  if (huff) jx = Math.round(Math.sin(now / 25));
  if (rage2) { jx = Math.round(Math.sin(now / 16) * 1.4); jy = Math.floor(now / 80) % 2 ? -1 : 0; }
  if (m.fx === "mock2") jy = Math.floor(now / 140) % 2 ? -1 : 0;
  if (m.fx === "win") { jx = Math.round(Math.sin(now / 240)); jy = Math.floor(now / 120) % 2 ? -1 : 0; } // víťazný tanček
  if (m.fx === "mock") jy = Math.floor(now / 300) % 2 ? -1 : 0;
  if (m.fx === "smug") jy = Math.floor(now / 700) % 2 ? -1 : 0;
  const hot = rage2 ? 0.25 + 0.15 * Math.sin(now / 60) : m.fx === "rage" ? 0.12 : 0;
  const MT = mix(METAL, [200, 40, 30], hot), MH = mix(METAL_HI, [255, 90, 70], hot), ML = mix(METAL_LO, [90, 20, 16], hot);
  // uši (namiesto anténky): hore / trasú sa (zúri) / zvesené (prehráva, K.O.); občas mykne jedným uchom
  const tw = (s) => now < f.twitchUntil && f.twitchSide === s && !m.ears && !["surprised"].includes(f.mood);
  const EARS = {
    up:    [[[5, 1], [1, 12], [14, 9]], [[26, 1], [30, 12], [17, 9]]],
    quiver: [[[5, 1], [1, 12], [14, 9]], [[26, 1], [30, 12], [17, 9]]],
    low:    [[[2, 4], [1, 12], [14, 9]], [[29, 4], [30, 12], [17, 9]]],
  };
  let ears = EARS[m.ears || "up"].map((t, s) => (tw(s) ? [[t[0][0] + (s ? 1 : -1), t[0][1] + 1], t[1], t[2]] : t));
  // zúri: uši sa trasú; víťazstvo: uši striedavo podskakujú
  if (m.ears === "quiver") ears = ears.map((t, s) => [[t[0][0] + ((Math.floor(now / 60) + s) % 2 ? 1 : -1), t[0][1]], t[1], t[2]]);
  if (m.fx === "win") ears = ears.map((t, s) => [[t[0][0], t[0][1] + ((Math.floor(now / 150) + s) % 2 ? 2 : 0)], t[1], t[2]]);
  for (let s = 0; s < 2; s++) {
    const [a, b, c] = ears[s];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (!inTri(x, y, a, b, c)) continue;
      const edge = !inTri(x - 1, y, a, b, c) || !inTri(x + 1, y, a, b, c) || !inTri(x, y - 1, a, b, c);
      const tip = Math.hypot(x - a[0], y - a[1]) < 1.9;
      const g = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3], sh = (p) => [g[0] + (p[0] - g[0]) * 0.68, g[1] + (p[1] - g[1]) * 0.68];
      const inner = inTri(x, y, sh(a), sh(b), sh(c));
      put(x + jx, y + jy, tip ? EAR_TIP : edge ? ML : inner ? EAR_IN : MT);
    }
  }
  // hlava (kov ako NORMAL) so zúženou bradou a chlpatými lícami
  for (let y = 6 + HY; y <= 29 + HY; y++) for (let x = 0; x < S; x++) {
    if (!inHead(x, y)) continue;
    const edge = !inHead(x - 1, y) || !inHead(x + 1, y) || !inHead(x, y - 1) || !inHead(x, y + 1);
    put(x + jx, y + jy, edge ? ML : y === 7 + HY ? MH : y >= 26 + HY ? ML : MT);
  }
  [[1, 19], [0, 20], [1, 21], [0, 22], [1, 23], [2, 24]].forEach(([x, y]) => { put(x + jx, y + HY + jy, ML); put(31 - x + jx, y + HY + jy, ML); });
  [[4, 8], [27, 8]].forEach(([x, y]) => put(x + jx, y + HY + jy, MH));
  // čumák na špičke brady
  put(15 + jx, 28 + HY + jy, NOSE); put(16 + jx, 28 + HY + jy, NOSE); put(14 + jx, 27 + HY + jy, NOSE); put(17 + jx, 27 + HY + jy, NOSE);
  put(15 + jx, 27 + HY + jy, NOSE); put(16 + jx, 27 + HY + jy, [90, 96, 110]);
  // LED na čele
  const ledOn = ["think", "rage", "rage2"].includes(m.fx) ? Math.floor(now / (rage2 ? 110 : 220)) % 2 === 0 : true;
  const L = ledOn ? hexRgb(m.led) : LED_OFF;
  put(15 + jx, 7 + HY + jy, L); put(16 + jx, 7 + HY + jy, L);
  // obrazovka
  const sx = SCR.x + jx, sy = SCR.y + jy, flash = now < f.flashUntil;
  for (let y = 0; y < SCR.h; y++) for (let x = 0; x < SCR.w; x++) {
    if ((x === 0 || x === SCR.w - 1) && (y === 0 || y === SCR.h - 1)) continue;
    put(sx + x, sy + y, flash ? mix(BG, C, 0.35) : BG.map(v => Math.round(v * (y % 2 ? 0.82 : 1))));
  }
  // oči: v pokoji prefíkane pokukuje do strán, pri plánovaní krúti očami
  let ex = 0;
  if (m.fx === "think") ex = [-1, 0, 1, 0][Math.floor(now / 700) % 4];
  if (f.mood === "neutral") ex = [0, 0, 1, 0, -1, 0][Math.floor(now / 1300) % 6];
  const [eL, eR] = m.eyes;
  const eyDy = m.fx === "think" ? 1 : 0; // pri plánovaní pozerá hore, ale oči trochu nižšie
  stamp(EYES[blink ? "closed" : eL], sx + EYE_L + ex, sy + EYE_Y + eyDy, C, DIM);
  stamp(EYES[blink ? "closed" : eR], sx + EYE_R + ex, sy + EYE_Y + eyDy, C, DIM, true);
  if (m.brows) {
    const bl = BROWS[m.brows === "raisedR" ? "evil" : m.brows], br = BROWS[m.brows === "raisedR" ? "raised" : m.brows];
    stamp(bl, sx + EYE_L, sy + EYE_Y - 3, C, DIM); stamp(br, sx + EYE_R, sy + EYE_Y - 3, C, DIM, m.brows !== "raisedR");
  }
  // ústa
  let mouth = MOUTHS[m.mouth];
  if (m.fx === "mock" || m.fx === "win") mouth = Math.floor(now / 180) % 2 ? MOUTHS.tongue2 : MOUTHS.tongue;          // jazyk sa kýve
  if (m.fx === "mock2") mouth = Math.floor(now / 140) % 2 ? MOUTHS.laughC : MOUTHS.laughO;
  if (m.fx === "rage" || m.fx === "grumble") mouth = Math.floor(now / 120) % 2 ? MOUTHS.gnash : MOUTHS.snarl;              // škrípe zubami
  stamp(mouth, sx + MOUTH_X, sy + MOUTH_Y, C, DIM);
  // efekty
  if (m.fx === "sweat") { const dy = Math.floor(age / 180) % 6; put(sx + 20, sy + 1 + dy, TEAR_HI); put(sx + 20, sy + 2 + dy, TEAR); }
  if (huff) { const ph = Math.floor((now % 1800) / 65); [[3, 6 - ph], [4, 5 - ph], [28, 6 - ph], [27, 5 - ph]].forEach(([x, y]) => put(x, y, STEAM[0])); }
  if (m.fx === "mock2") { // slzy od smiechu (len pri 5+ dmg, nie pri výhre)
    const dy = Math.floor(age / 110) % 6; put(sx + 1, sy + 7 + dy, TEAR); put(sx + 20, sy + 7 + dy, TEAR);
  }
  if (m.fx === "glitch" || rage2) {
    const r = Math.floor(now / (rage2 ? 70 : 90));
    for (let k = 0; k < (rage2 ? 2 : 3); k++) {
      const yy = sy + ((r * 7 + k * 5) % SCR.h), len = 4 + ((r + k) % 9), x0 = sx + ((r * 3 + k * 11) % (SCR.w - len));
      for (let x = 0; x < len; x++) put(x0 + x, yy, mix(BG, C, 0.5));
    }
  }
  // efekty mimo hlavy (nehýbu sa s ňou)
  if (m.fx === "rage" || rage2) {
    for (let k = 0; k < (rage2 ? 3 : 2); k++) {
      const ph = (now / (rage2 ? 80 : 130) + k * 2.5) % 6, y = 6 - Math.floor(ph), c = STEAM[k % 2];
      put(3 - (k % 2), y, c); put(4, y - 1, c); put(28 + (k % 2), y, c); put(27, y - 1, c);
    }
    if (rage2 || Math.floor(now / 220) % 2) [[0, 0], [1, 0], [3, 0], [4, 0], [0, 1], [4, 1], [0, 3], [4, 3], [0, 4], [1, 4], [3, 4], [4, 4]].forEach(([x, y]) => put(21 + x, 1 + y, VEIN));
    if (rage2) text(["#!", "!#", "?!"][Math.floor(now / 260) % 3], Math.floor(now / 520) % 2 ? 0 : 1, Math.floor(now / 260) % 2, Math.floor(now / 130) % 2 ? VEIN : HA);
  }
  if (m.fx === "mock") { if (Math.floor(now / 400) % 2) text("HA", 24, 0, HA); else text("HA", 0, 1, HA); }
  if (m.fx === "mock2") { const a = Math.floor(now / 280) % 2; text("HA", a ? 0 : 1, a ? 0 : 1, HA); text("HA", a ? 24 : 23, a ? 1 : 0, HA); }
  // víťazstvo: striedavo HA / EZ v troch miestach + zlaté iskry okolo hlavy
  if (m.fx === "win") {
    const k = Math.floor(now / 300) % 3, w = ["HA", "EZ", "HA"][k];
    text(w, [0, 12, 24][k], k === 1 ? 0 : 1, k === 1 ? [255, 179, 71] : HA);
    const SP = [[1, 14], [30, 16], [0, 26], [31, 24], [3, 30], [28, 30]];
    SP.forEach(([x, y], i) => { const ph = (Math.floor(now / 110) + i * 2) % 6; if (ph < 3) { put(x, y - ph, HA); if (ph === 1) { put(x - 1, y - ph, [255, 255, 255]); put(x + 1, y - ph, [255, 255, 255]); } } });
  }
  if (m.fx === "bang" && age < 1400) { for (let y = 0; y < 4; y++) put(29, y, HA); put(29, 5, HA); put(30, 0, HA); put(30, 1, HA); }
  octx.putImageData(img, 0, 0);
}
// f = stav tváre (bot-face.js: nálada, žmurkanie, záblesk); salt rozlišuje plátna (vlastný cache kľúč)
export function paintFox(f, want, now, salt) {
  ensureBuf();
  if (f.nextTwitch === undefined) { f.nextTwitch = now + 1000 + Math.random() * 2000; f.twitchUntil = 0; f.twitchSide = 0; }
  const key = `fox:${want}:${Math.floor(now / 66)}:${salt}`; // ~15 fps - pixel art viac nepotrebuje
  if (key === f.lastKey) return false;
  f.lastKey = key;
  paint(f, want, now);
  return true;
}
export const foxBuffer = () => { ensureBuf(); return off; };
