// Reprodukovateľné generovanie pride-indikátora Escanora z ručne namaľovaného stripu.
// Vstup:  public/assets/pride lions.png  = 3 levy vedľa seba na čiernom pozadí
//         (biely → zlatý odspodku → celý zlatý; s domaľovaným detailom a obrysom).
// Výstup: public/assets/pride_lion_0..3.png  (frame na každý pride level, biele/čierne pozadie vykľúčené do priehľadna)
//         0 = celý biely (odvodený prefarbením plného leva), 1/2/3 = jednotlivé levy zo stripu.
// Spustenie:  node tools/pride-lion/make_lions.cjs
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const ASSETS = path.join(__dirname, "..", "..", "public", "assets");
const src = PNG.sync.read(fs.readFileSync(path.join(ASSETS, "pride lions.png")));
const W = src.width, H = src.height;
const maxc = (x, y) => { const i = (y * W + x) * 4; return Math.max(src.data[i], src.data[i + 1], src.data[i + 2]); };
const TH = 40; // prah čierne↔kresba

// 1) detekuj levy cez prázdne (čierne) stĺpce — strip nie je delený presne na tretiny, levy sú rôzne posunuté
const occ = [];
for (let x = 0; x < W; x++) { let o = false; for (let y = 0; y < H; y++) if (maxc(x, y) > TH) { o = true; break; } occ.push(o); }
const runs = []; let s = -1;
for (let x = 0; x < W; x++) { if (occ[x] && s < 0) s = x; else if (!occ[x] && s >= 0) { runs.push([s, x - 1]); s = -1; } }
if (s >= 0) runs.push([s, W - 1]);
if (runs.length !== 3) throw new Error("čakal som 3 levy, našiel " + runs.length);

// 2) y-bbox každého leva
const boxes = runs.map(([x0, x1]) => {
  let y0 = H, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = x0; x <= x1; x++) if (maxc(x, y) > TH) { if (y < y0) y0 = y; if (y > y1) y1 = y; break; }
  return { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
});
boxes.forEach((b, i) => console.log(`lev${i}: ${b.w}×${b.h} @ x${b.x0}`));

// 3) jednotná plocha = max rozmery + padding, každý lev vycentrovaný → rovnaká veľkosť a zarovnanie, žiadny bleed
const PAD = 20;
const CW = Math.max(...boxes.map(b => b.w)) + PAD * 2;
const CH = Math.max(...boxes.map(b => b.h)) + PAD * 2;
console.log("plocha framu: " + CW + "×" + CH + " (pomer " + (CW / CH).toFixed(2) + ")");

// vytiahni leva `idx` vycentrovaného na CW×CH; čierne pozadie → priehľadné; forceWhite = prefarbi na bielu (pride 0)
function frame(idx, forceWhite) {
  const b = boxes[idx];
  const offX = ((CW - b.w) >> 1) - b.x0, offY = ((CH - b.h) >> 1) - b.y0;
  const o = new PNG({ width: CW, height: CH });
  for (let sy = b.y0; sy <= b.y1; sy++) for (let sx = b.x0; sx <= b.x1; sx++) {
    const dx = sx + offX, dy = sy + offY;
    if (dx < 0 || dy < 0 || dx >= CW || dy >= CH) continue;
    const si = (sy * W + sx) * 4, di = (dy * CW + dx) * 4;
    const r = src.data[si], g = src.data[si + 1], b2 = src.data[si + 2];
    const a = Math.max(0, Math.min(1, (Math.max(r, g, b2) - 16) / (64 - 16))); // ramp: čierna→0, kresba→1 (hladké AA)
    if (forceWhite) { o.data[di] = 255; o.data[di + 1] = 255; o.data[di + 2] = 255; }
    else { o.data[di] = r; o.data[di + 1] = g; o.data[di + 2] = b2; }
    o.data[di + 3] = Math.round(a * 255);
  }
  return o;
}

fs.writeFileSync(path.join(ASSETS, "pride_lion_0.png"), PNG.sync.write(frame(2, true)));  // pride 0 = celý biely
fs.writeFileSync(path.join(ASSETS, "pride_lion_1.png"), PNG.sync.write(frame(0, false))); // pride 1 = spodok zlatý
fs.writeFileSync(path.join(ASSETS, "pride_lion_2.png"), PNG.sync.write(frame(1, false))); // pride 2 = viac zlatej
fs.writeFileSync(path.join(ASSETS, "pride_lion_3.png"), PNG.sync.write(frame(2, false))); // pride 3 = celý zlatý
console.log("OK → pride_lion_0..3.png");
