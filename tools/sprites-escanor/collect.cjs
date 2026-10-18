// Zberny prehliadac SCHVALENYCH animacii Escanora -> HOTOVE.html
// Pridavaj polozky do APPROVED. Kazda: zoznam source frames (band+index), poradie prehravania, fps, loop, proc pohyb.
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const src = PNG.sync.read(fs.readFileSync(path.join(__dirname, "ESCANOR.png")));
const { width: SW, data: SD } = src;
const bands = require("./bands.json");
const bandById = id => bands.find(b => b.i === id);
const BG = [163, 73, 164];
function isBg(x, y) { const i = (y * SW + x) * 4; if (SD[i + 3] < 20) return true; return Math.abs(SD[i] - BG[0]) <= 14 && Math.abs(SD[i + 1] - BG[1]) <= 14 && Math.abs(SD[i + 2] - BG[2]) <= 14; }
// odrez presaknuty popisok (tenky horny run oddeleny medzerou od tela)
function trimTop(f) {
  const LABEL_H = 16, GAP = 4; let y = f.y0;
  const rowHas = y => { for (let x = f.x0; x <= f.x1; x++) if (!isBg(x, y)) return true; return false; };
  while (y <= f.y1 && !rowHas(y)) y++; let r0 = y; while (y <= f.y1 && rowHas(y)) y++; let r1 = y - 1;
  let g = y; while (g <= f.y1 && !rowHas(g)) g++;
  if ((r1 - r0 + 1) <= LABEL_H && (g - r1 - 1) >= GAP && g <= f.y1) return g;
  return f.y0;
}

// helper na definiciu frameov
const R = (band, from, to) => { const B = bandById(band); const a = []; for (let k = from; k <= (to ?? from); k++) a.push({ band, k }); return a; };
// explicitny box (tam kde detekcia zliala susedne frames — napr. oblúk Cruel Sun)
const BX = (band, x0, y0, x1, y1) => ({ band, box: { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } });

// Charge projektil: najmenšie slnko (band 46 frame 0, 16×16) → pulzujúci + pomaly rotujúci
// idle loop v 64×64 bunke (centrovaný, ako fire/naruto Charge).
function makeCharge() {
  const b = bandById(46).frames[0]; // 16×16
  const sw = b.x1 - b.x0 + 1, sh = b.y1 - b.y0 + 1, cx = (sw - 1) / 2, cy = (sh - 1) / 2;
  const M = 10, CELL = 64, BASE = 2.6;
  const strip = new PNG({ width: CELL * M, height: CELL }); strip.data.fill(0);
  for (let k = 0; k < M; k++) {
    const ang = k * (Math.PI * 2 / M);                 // 1 otáčka za cyklus
    const sc = BASE * (1 + 0.14 * Math.sin(ang));      // dýchanie
    const bright = 1 + 0.12 * Math.sin(ang);           // jemný záblesk pri nafúknutí
    const ca = Math.cos(-ang), sa = Math.sin(-ang);
    for (let dy = 0; dy < CELL; dy++) for (let dx = 0; dx < CELL; dx++) {
      const X = dx - CELL / 2, Y = dy - CELL / 2;
      const rx = X * ca - Y * sa, ry = X * sa + Y * ca;
      const sX = Math.round(rx / sc + cx), sY = Math.round(ry / sc + cy);
      if (sX < 0 || sY < 0 || sX >= sw || sY >= sh) continue;
      const gx = b.x0 + sX, gy = b.y0 + sY; if (isBg(gx, gy)) continue;
      const si = (gy * SW + gx) * 4, di = (dy * strip.width + k * CELL + dx) * 4;
      strip.data[di] = Math.min(255, Math.round(SD[si] * bright));
      strip.data[di + 1] = Math.min(255, Math.round(SD[si + 1] * bright));
      strip.data[di + 2] = Math.min(255, Math.round(SD[si + 2] * bright));
      strip.data[di + 3] = 255;
    }
  }
  return { data: "data:image/png;base64," + PNG.sync.write(strip).toString("base64"), cw: CELL, ch: CELL, seq: [...Array(M).keys()] };
}

// Win + rastúce slnko: Escanor v víťaznej póze drží pozdvihnuté rastúce slnko.
// Vyšší rám; Escanor zarovnaný na zemnú líniu, slnko kotvené SPODKOM na hlavicu sekery → rastie nahor.
function makeWinSun() {
  const WB = bandById(44), win = [0, 1, 2, 3].map(k => WB.frames[k]), winBase = WB.y1;
  const S46 = bandById(46);
  const sun = [
    S46.frames[0], { x0: 60, y0: 4508, x1: 91, y1: 4537 }, { x0: 92, y0: 4494, x1: 149, y1: 4551 },
    S46.frames[2], S46.frames[3], S46.frames[4], S46.frames[5], S46.frames[6],
  ];
  const CW = 226, CH = 300, BASE = 292, SUN_CX = CW / 2, SUN_OVERLAP = -30, SUN_SCALE = 1.2; // slnko vyššie + o 20% väčšie
  const winMap = [0, 1, 2, 3, 2, 3, 2, 3], sunMap = [0, 1, 2, 3, 4, 5, 6, 7], N = winMap.length; // v loope (4→7) Escanor strieda svoje 2 loop framy
  const feetX = f => { const k = Math.min(14, f.y1 - f.y0 + 1); let mn = 1e9, mx = -1e9; for (let y = f.y1 - k + 1; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (!isBg(x, y)) { if (x < mn) mn = x; if (x > mx) mx = x; } return mx < 0 ? (f.x0 + f.x1) / 2 : (mn + mx) / 2; };
  const strip = new PNG({ width: CW * N, height: CH }); strip.data.fill(0);
  const blit = (f, dx0, dy0, k) => { for (let yy = f.y0; yy <= f.y1; yy++) for (let xx = f.x0; xx <= f.x1; xx++) { if (isBg(xx, yy)) continue; const si = (yy * SW + xx) * 4; const dx = dx0 + (xx - f.x0), dy = dy0 + (yy - f.y0); if (dx < 0 || dy < 0 || dx >= CW || dy >= CH) continue; const di = (dy * strip.width + k * CW + dx) * 4; strip.data[di] = SD[si]; strip.data[di + 1] = SD[si + 1]; strip.data[di + 2] = SD[si + 2]; strip.data[di + 3] = SD[si + 3] || 255; } };
  // slnko: škálovaný nearest-neighbor blit, centrovaný na cx, kotvený spodkom na bottomY
  const blitSun = (f, cx, bottomY, sc, k) => { const sw = f.x1 - f.x0 + 1, sh = f.y1 - f.y0 + 1, dw = Math.round(sw * sc), dh = Math.round(sh * sc), dx0 = Math.round(cx - dw / 2), dy0 = bottomY - dh; for (let dyy = 0; dyy < dh; dyy++) for (let dxx = 0; dxx < dw; dxx++) { const sx = f.x0 + Math.min(sw - 1, Math.floor(dxx / sc)), sy = f.y0 + Math.min(sh - 1, Math.floor(dyy / sc)); if (isBg(sx, sy)) continue; const si = (sy * SW + sx) * 4; const dx = dx0 + dxx, dy = dy0 + dyy; if (dx < 0 || dy < 0 || dx >= CW || dy >= CH) continue; const di = (dy * strip.width + k * CW + dx) * 4; strip.data[di] = SD[si]; strip.data[di + 1] = SD[si + 1]; strip.data[di + 2] = SD[si + 2]; strip.data[di + 3] = SD[si + 3] || 255; } };
  for (let k = 0; k < N; k++) {
    const wf = win[winMap[k]], fx = feetX(wf);
    const axeTop = BASE - (winBase - wf.y0);          // riadok hlavice sekery
    blit(wf, Math.round(SUN_CX - (fx - wf.x0)), BASE - (winBase - wf.y0), k); // Escanor
    blitSun(sun[sunMap[k]], SUN_CX, axeTop + SUN_OVERLAP, SUN_SCALE, k);      // slnko (väčšie) nad sekerou
  }
  return { data: "data:image/png;base64," + PNG.sync.write(strip).toString("base64"), cw: CW, ch: CH, seq: [...Array(N).keys()] };
}

// CruelSun1 + najväčšie slnko nad Escanorom (animované) — vyzerá, že ho nesie nad sebou.
function makeCruelSunHold(SUN_OFFSET = 15, SUN_SCALE = 1.3) {
  const B35 = bandById(35), B36 = bandById(36), B46 = bandById(46);
  const base = [
    ...[0, 1, 2, 3, 4, 5].map(k => ({ f: B35.frames[k], baseY: B35.y1 })),
    { f: { x0: 670, y0: 3323, x1: 773, y1: 3421 }, baseY: B35.y1 },
    { f: { x0: 774, y0: 3324, x1: 885, y1: 3421 }, baseY: B35.y1 },
    { f: { x0: 886, y0: 3323, x1: 992, y1: 3421 }, baseY: B35.y1 },
    ...[0, 1, 2, 3].map(k => ({ f: B36.frames[k], baseY: B36.y1 })),
  ];
  const bigSuns = [B46.frames[3], B46.frames[4], B46.frames[5], B46.frames[6]]; // najväčšie slnká (shimmer)
  const CW = 260, CH = 330, BASE = 322, SUN_CX = CW / 2, N = base.length;
  const feetX = f => { const k = Math.min(14, f.y1 - f.y0 + 1); let mn = 1e9, mx = -1e9; for (let y = f.y1 - k + 1; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (!isBg(x, y)) { if (x < mn) mn = x; if (x > mx) mx = x; } return mx < 0 ? (f.x0 + f.x1) / 2 : (mn + mx) / 2; };
  const strip = new PNG({ width: CW * N, height: CH }); strip.data.fill(0);
  const blit = (f, dx0, dy0, k) => { for (let yy = f.y0; yy <= f.y1; yy++) for (let xx = f.x0; xx <= f.x1; xx++) { if (isBg(xx, yy)) continue; const si = (yy * SW + xx) * 4; const dx = dx0 + (xx - f.x0), dy = dy0 + (yy - f.y0); if (dx < 0 || dy < 0 || dx >= CW || dy >= CH) continue; const di = (dy * strip.width + k * CW + dx) * 4; strip.data[di] = SD[si]; strip.data[di + 1] = SD[si + 1]; strip.data[di + 2] = SD[si + 2]; strip.data[di + 3] = SD[si + 3] || 255; } };
  const blitSun = (f, cx, bottomY, sc, k) => { const sw = f.x1 - f.x0 + 1, sh = f.y1 - f.y0 + 1, dw = Math.round(sw * sc), dh = Math.round(sh * sc), dx0 = Math.round(cx - dw / 2), dy0 = bottomY - dh; for (let dyy = 0; dyy < dh; dyy++) for (let dxx = 0; dxx < dw; dxx++) { const sx = f.x0 + Math.min(sw - 1, Math.floor(dxx / sc)), sy = f.y0 + Math.min(sh - 1, Math.floor(dyy / sc)); if (isBg(sx, sy)) continue; const si = (sy * SW + sx) * 4; const dx = dx0 + dxx, dy = dy0 + dyy; if (dx < 0 || dy < 0 || dx >= CW || dy >= CH) continue; const di = (dy * strip.width + k * CW + dx) * 4; strip.data[di] = SD[si]; strip.data[di + 1] = SD[si + 1]; strip.data[di + 2] = SD[si + 2]; strip.data[di + 3] = SD[si + 3] || 255; } };
  base.forEach((o, k) => {
    const { f, baseY } = o, fx = feetX(f), escTop = BASE - (baseY - f.y0);
    blit(f, Math.round(SUN_CX - (fx - f.x0)), BASE - (baseY - f.y0), k);       // Escanor
    blitSun(bigSuns[k % bigSuns.length], SUN_CX, escTop + SUN_OFFSET, SUN_SCALE, k); // slnko nad ním, mihoce
  });
  return { data: "data:image/png;base64," + PNG.sync.write(strip).toString("base64"), cw: CW, ch: CH, seq: [...Array(N).keys()] };
}

const APPROVED = [
  {
    name: "WeakIdle",
    note: "Escanor pred premenou — pokojný idle (3 reálne frames, ping-pong) + jemný bob",
    frames: R(42, 0, 2),
    order: [0, 1, 2, 1],
    fps: 5, loop: true, proc: { bob: true, sway: false },
  },
  {
    name: "Intro",
    note: "Zložené intro: premena (Intro2 0→7) → stoj → chytí sekeru Rhitta (Intro 0→8)",
    frames: [...R(42, 0, 7), ...R(40, 0, 8)],
    order: null, // = po poradí
    fps: 9, loop: false,
  },
  {
    name: "Walk",
    note: "Chôdza (z viewer) — band 3, frames 0→7",
    frames: R(3, 0, 7),
    order: null,
    fps: 10, loop: true,
  },
  {
    name: "Stand",
    note: "Postoj po premene (idle) — band 1, frames 0→4, popisok odstránený",
    frames: R(1, 0, 4),
    order: null,
    fps: 7, loop: true,
  },
  {
    name: "IntroStand",
    note: "Intro prebehne raz → potom loopuje Stand (intro 17 frames, potom idle)",
    frames: [...R(42, 0, 7), ...R(40, 0, 8), ...R(1, 0, 4)],
    order: null,
    fps: 9, loop: true, loopFrom: 17, // po 17 intro frameoch loopuje zvyšok (Stand)
  },
  {
    name: "Attack1",
    note: "Útok 1 (z viewer) — band 9",
    frames: R(9, 0, bandById(9).frames.length - 1),
    order: null,
    fps: 12, loop: false,
  },
  {
    name: "Attack5",
    note: "Útok 5 (z viewer) — band 17",
    frames: R(17, 0, bandById(17).frames.length - 1),
    order: null,
    fps: 12, loop: false,
  },
  {
    name: "Charge",
    note: "Projektil — najmenšie slnko (band 46 f0) ako pulzujúci/rotujúci idle (64×64)",
    kind: "fx", prebuilt: makeCharge(),
    order: null,
    fps: 12, loop: true,
  },
  {
    name: "Hurt",
    note: "Inkasovaný zásah — prvé 3 frames Damage (band 38, 0→2)",
    frames: R(38, 0, 2),
    order: null,
    fps: 10, loop: false,
  },
  {
    name: "Dead",
    note: "Smrť — všetkých 6 frames Damage (band 38, 0→5)",
    frames: R(38, 0, 5),
    order: null,
    fps: 9, loop: false,
  },
  {
    name: "SunGrow",
    note: "Slnko rastie (8 fáz), potom loopuje posledné 4 framy ako idle",
    kind: "fx",
    frames: [
      ...R(46, 0, 0),                    // drobná iskra
      BX(46, 60, 4508, 91, 4537),        // malé žlté slnko (zliaty frame1 rozdelený)
      BX(46, 92, 4494, 149, 4551),       // oranžová guľa
      ...R(46, 2, 6),                    // rast do plného slnka
    ],
    order: null,
    fps: 9, loop: true, loopFrom: 4, // rast aj loop posledných 4 na 9fps
  },
  {
    name: "Win",
    note: "Víťazstvo (band 44) — prehrá sa raz, potom loopuje posledné 2 framy (2↔3)",
    frames: R(44, 0, 3),
    order: null,
    fps: 8, loop: true, loopFrom: 2,
  },
  {
    name: "WinSun",
    note: "Víťazstvo + rastúce slnko — Escanor drží nad sekerou rastúce slnko, potom loop",
    kind: "fx", prebuilt: makeWinSun(),
    order: null,
    fps: 8, loop: true, loopFrom: 4,
  },
  {
    name: "SunBurst",
    note: "Slnečný výbuch / prstence (band 47) — loop",
    kind: "fx", frames: R(47, 0, 5),
    order: null,
    fps: 10, loop: true,
  },
  {
    name: "SunFade",
    note: "Dohasínajúce prstence (band 48) — loop",
    kind: "fx", frames: R(48, 0, 2),
    order: null,
    fps: 8, loop: true,
  },
  {
    name: "CruelSunHold",
    note: "CruelSun1 + najväčšie slnko nad Escanorom (mihoce) — nesie ho nad sebou",
    kind: "fx", prebuilt: makeCruelSunHold(-25, 1.3),
    order: null,
    fps: 11, loop: false,
  },
  {
    name: "CruelSun1",
    note: "Cruel Sun — band 35 (0→5 + 3 rozdelené z oblúka) + prvé 4 frames z ďalšieho riadku (band 36 0→3)",
    frames: [
      ...R(35, 0, 5),
      BX(35, 670, 3323, 773, 3421), // oblúk: póza 1 (rez v prázdnych stĺpcoch, sekera necelená)
      BX(35, 774, 3324, 885, 3421), // oblúk: póza 2
      BX(35, 886, 3323, 992, 3421), // oblúk: póza 3
      ...R(36, 0, 3),               // pokračovanie z ďalšieho riadku
    ],
    order: null,
    fps: 11, loop: false,
  },
];

// horizontalna kotva = stred nôh (spodných ~14 riadkov obsahu) — meč/oblúk trčí von, telo drží stred
function feetX(f) {
  const k = Math.min(14, f.y1 - f.y0 + 1); let mn = 1e9, mx = -1e9;
  for (let y = f.y1 - k + 1; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (!isBg(x, y)) { if (x < mn) mn = x; if (x > mx) mx = x; }
  return mx < 0 ? (f.x0 + f.x1) / 2 : (mn + mx) / 2;
}

// 1. prechod: nazbieraj vsetky frames + kotvy, zmeraj globalne rozmery
APPROVED.forEach(a => {
  if (a.kind === "fx") { a.items = []; return; } // projektily/efekty nejdu cez feet-anchor
  a.items = a.frames.map(s => {
    const B = bandById(s.band); const f0 = s.box ? s.box : B.frames[s.k]; const f = { ...f0, y0: trimTop(f0) };
    const fx = feetX(f);
    return { f, baseY: B.y1, fx, left: fx - f.x0, right: f.x1 - fx, above: B.y1 - f.y0, below: f.y1 - B.y1 };
  });
});
const allItems = APPROVED.flatMap(a => a.items);
const PAD = 8;
const halfW = Math.max(...allItems.map(o => Math.max(o.left, o.right)));
const maxAbove = Math.max(...allItems.map(o => o.above));
const maxBelow = Math.max(0, ...allItems.map(o => o.below));
const S = Math.ceil(Math.max(2 * halfW, maxAbove + maxBelow) + 2 * PAD); // spolocna stvorcova bunka
const BASE = S - PAD - maxBelow; // riadok zemnej linie v bunke
console.log(`normalizacia: bunka ${S}x${S}px, baseline row ${BASE} (halfW ${halfW.toFixed(0)}, above ${maxAbove}, below ${maxBelow})`);

// 2. prechod: vykresli do spolocnej bunky S×S, nohy na stred+baseline
function build(a) {
  if (a.kind === "fx") {
    if (a.prebuilt) { a.data = a.prebuilt.data; a.cw = a.prebuilt.cw; a.ch = a.prebuilt.ch; a.N = a.prebuilt.seq.length; a.seq = a.order || a.prebuilt.seq; a.fx = true; return; }
    // centrovany strip z band-frameov (efekty rastu/výbuchu) — bez feet-anchor
    const fr = a.frames.map(s => { const B = bandById(s.band); return s.box ? s.box : B.frames[s.k]; });
    const maxW = Math.max(...fr.map(f => f.x1 - f.x0 + 1)), maxH = Math.max(...fr.map(f => f.y1 - f.y0 + 1));
    const CELL = Math.max(maxW, maxH) + 6, N = fr.length;
    const strip = new PNG({ width: CELL * N, height: CELL }); strip.data.fill(0);
    fr.forEach((f, k) => {
      const w = f.x1 - f.x0 + 1, h = f.y1 - f.y0 + 1, dx0 = k * CELL + Math.round((CELL - w) / 2), dy0 = Math.round((CELL - h) / 2);
      for (let yy = f.y0; yy <= f.y1; yy++) for (let xx = f.x0; xx <= f.x1; xx++) {
        if (isBg(xx, yy)) continue; const si = (yy * SW + xx) * 4; const dx = dx0 + (xx - f.x0), dy = dy0 + (yy - f.y0); const di = (dy * strip.width + dx) * 4;
        strip.data[di] = SD[si]; strip.data[di + 1] = SD[si + 1]; strip.data[di + 2] = SD[si + 2]; strip.data[di + 3] = SD[si + 3] || 255;
      }
    });
    a.data = "data:image/png;base64," + PNG.sync.write(strip).toString("base64");
    a.cw = CELL; a.ch = CELL; a.N = N; a.seq = a.order || fr.map((_, i) => i); a.fx = true;
    return;
  }
  const N = a.items.length;
  const strip = new PNG({ width: S * N, height: S }); strip.data.fill(0);
  a.items.forEach((o, k) => {
    const { f, baseY, fx } = o;
    const dx0 = k * S + Math.round(S / 2 - (fx - f.x0));
    const dy0 = BASE - (baseY - f.y0);
    for (let yy = f.y0; yy <= f.y1; yy++) for (let xx = f.x0; xx <= f.x1; xx++) {
      if (isBg(xx, yy)) continue; const si = (yy * SW + xx) * 4; const dx = dx0 + (xx - f.x0), dy = dy0 + (yy - f.y0);
      if (dx < 0 || dy < 0 || dx >= strip.width || dy >= S) continue; const di = (dy * strip.width + dx) * 4;
      strip.data[di] = SD[si]; strip.data[di + 1] = SD[si + 1]; strip.data[di + 2] = SD[si + 2]; strip.data[di + 3] = SD[si + 3] || 255;
    }
  });
  a.data = "data:image/png;base64," + PNG.sync.write(strip).toString("base64");
  a.cw = S; a.ch = S; a.N = N;
  a.seq = a.order || a.items.map((_, i) => i);
}
APPROVED.forEach(build);

const cards = APPROVED.map(a => {
  const disp = Math.min(a.cw * 3.5, 300);
  const H = a.fx ? a.ch : a.ch + 8;                 // fx: bez baseline headroomu
  const procRow = a.proc ? `
      <div class="proc">
        <button class="pb" data-k="bob" ${a.proc.bob ? "" : ""}>+ bob</button>
        <button class="pb" data-k="sway">+ sway</button>
      </div>` : "";
  const replayRow = a.loopFrom != null ? `
      <div class="proc"><button class="replay">↻ Prehrať znova (úvod + loop)</button></div>` : "";
  return `
    <figure class="card" data-name="${a.name}">
      <div class="stage${a.fx ? " fxstage" : ""}"><canvas width="${a.cw}" height="${H}" style="width:${Math.round(disp)}px;height:${Math.round(H / a.cw * disp)}px"></canvas></div>
      <figcaption>
        <div class="row"><span class="name">${a.name}</span><span class="mode ${a.loop ? "loop" : "once"}">${a.loop ? "loop" : "1×"}</span></div>
        <div class="meta">${a.N} frames · ${a.seq.length} v cykle · ${a.fps} fps</div>
        <div class="note">${a.note}</div>${procRow}${replayRow}
      </figcaption>
    </figure>`;
}).join("");

const html = `<title>Escanor — HOTOVÉ (schválené animácie)</title>
<style>
 :root{--bg:#14120d;--panel:#211d15;--panel2:#2b261b;--line:#3a3324;--ink:#f0e9d6;--mut:#a8977a;--acc:#f0a828;--blue:#e8c15f}
 html{background:var(--bg)}body{font:15px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--ink);margin:0;padding:28px 20px 60px}
 .wrap{max-width:1000px;margin:0 auto}
 header{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 18px}
 h1{font-size:22px;margin:0}h1 b{color:var(--acc);font-weight:600}.sub{color:var(--mut);font-size:13px}
 .controls{display:flex;gap:10px;align-items:center;margin:16px 0 26px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 14px;position:sticky;top:10px;z-index:5;box-shadow:0 4px 18px rgba(0,0,0,.5)}
 .lbl{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.09em;margin-right:6px}
 button{font:13px Consolas,monospace;color:var(--ink);background:var(--panel2);border:1px solid var(--line);border-radius:7px;padding:5px 12px;cursor:pointer}
 button:hover{border-color:var(--acc)}button.on{background:var(--acc);border-color:var(--acc);color:#181205;font-weight:700}
 .sep{width:1px;height:22px;background:var(--line)}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
 .card{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
 .stage{display:flex;justify-content:center;align-items:flex-end;min-height:240px;background:repeating-conic-gradient(#1a1710 0 25%,#151109 0 50%) 50%/22px 22px;border-bottom:1px solid var(--line);padding:18px 0 0}
 .stage.fxstage{align-items:center;padding:18px 0}
 .stage canvas{image-rendering:pixelated}
 figcaption{padding:12px 14px 14px}
 .row{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
 .name{font:600 15px Consolas,monospace}
 .mode{font:11px Consolas,monospace;padding:1px 8px;border-radius:99px}
 .mode.loop{color:var(--blue);border:1px solid color-mix(in srgb,var(--blue) 45%,transparent)}
 .mode.once{color:var(--acc);border:1px solid color-mix(in srgb,var(--acc) 45%,transparent)}
 .meta{font:12px Consolas,monospace;color:var(--mut);margin-top:3px}
 .note{font-size:12.5px;color:var(--mut);margin-top:6px}
 .proc{margin-top:10px;display:flex;gap:8px}.proc .pb{font-size:12px;padding:4px 10px}
</style>
<div class="wrap">
 <header>
  <h1>Escanor — <b>HOTOVÉ</b></h1>
  <span class="sub">schválené animácie · pridávame priebežne · ${APPROVED.length} zatiaľ</span>
 </header>
 <div class="controls">
  <span class="lbl">Rýchlosť</span>
  <button data-speed="0.25">0.25×</button><button data-speed="0.5">0.5×</button><button data-speed="1" class="on">1×</button><button data-speed="2">2×</button>
  <div class="sep"></div><button id="pause">⏸ Pauza</button>
 </div>
 <div class="grid">${cards}</div>
</div>
<script>
const ANIMS=${JSON.stringify(APPROVED.map(({ name, data, cw, ch, fps, loop, seq, proc, loopFrom, loopFps, fx }) => ({ name, data, cw, ch, fps, loop, seq, proc: proc || null, loopFrom: loopFrom ?? null, loopFps: loopFps ?? null, fx: !!fx })))};
let speed=1,paused=false;const HOLD_MS=700;
const players=[];
for(const a of ANIMS){
 const card=document.querySelector('.card[data-name="'+a.name+'"]');
 const ctx=card.querySelector("canvas").getContext("2d");ctx.imageSmoothingEnabled=false;
 const img=new Image();img.src=a.data;
 const p={a,ctx,img,t:0,last:performance.now(),bob:!!(a.proc&&a.proc.bob),sway:!!(a.proc&&a.proc.sway)};
 players.push(p);
 card.querySelectorAll(".pb").forEach(b=>{if(p[b.dataset.k])b.classList.add("on");b.addEventListener("click",()=>{p[b.dataset.k]=!p[b.dataset.k];b.classList.toggle("on",p[b.dataset.k]);});});
 const rb=card.querySelector(".replay");if(rb)rb.addEventListener("click",()=>{p.t=0;p.last=performance.now();p.drawn=false;});
}
function tick(now){
 for(const p of players){
  const dt=(now-p.last)*speed;p.last=now;if(!paused)p.t+=dt;
  const{cw,ch,fps,loop,seq,loopFrom,fx}=p.a;const H=fx?ch:ch+8;let si=0;
  if(seq.length>1){
   if(loopFrom!=null){const fi=Math.floor(p.t/1000*fps);if(fi<seq.length)si=fi;else{const lfps=p.a.loopFps||fps;const tL=p.t/1000-seq.length/fps;const ll=seq.length-loopFrom;si=loopFrom+(Math.floor(tL*lfps)%ll);}}
   else if(loop)si=Math.floor(p.t/1000*fps)%seq.length;
   else{const dur=seq.length*1000/fps;const cyc=p.t%(dur+HOLD_MS);si=Math.min(seq.length-1,Math.floor(cyc/1000*fps));}
  }
  const f=seq[si];
  let dx=0,dy=fx?0:8;
  if(!fx&&p.bob)dy+=Math.round(Math.sin(p.t/1000*Math.PI*2*(fps/4))*1.5)+1;
  if(!fx&&p.sway)dx+=Math.round(Math.sin(p.t/1000*Math.PI)*1.5);
  if(p.img.complete&&p.img.naturalWidth){p.ctx.clearRect(0,0,cw,H);p.ctx.drawImage(p.img,f*cw,0,cw,ch,dx,fx?0:dy-8,cw,ch);}
 }
 requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
document.querySelectorAll("[data-speed]").forEach(b=>b.addEventListener("click",()=>{speed=+b.dataset.speed;document.querySelectorAll("[data-speed]").forEach(x=>x.classList.toggle("on",x===b));}));
const pb=document.getElementById("pause");pb.addEventListener("click",()=>{paused=!paused;pb.textContent=paused?"▶ Spusti":"⏸ Pauza";pb.classList.toggle("on",paused);});
</script>`;
fs.writeFileSync(path.join(__dirname, "HOTOVE.html"), html);
console.log("HOTOVE.html  " + APPROVED.length + " animacii: " + APPROVED.map(a => a.name).join(", "));
