// tools/sprites-book/build.mjs - knižnica (menu): zo zväčšeného obrázka knihy (KNIHA.png, pixel art zväčšený ~8.55×,
// s pozadím) spraví natívny sprite s priehľadným pozadím → public/assets/book/book.png.
// Použitie: node tools/sprites-book/build.mjs <KNIHA.png>
import fs from "node:fs";
import { PNG } from "pngjs";

const src = PNG.sync.read(fs.readFileSync(process.argv[2] || "tools/sprites-book/src/KNIHA.png"));
const { width: W, height: H, data: D } = src;
const lum = (x, y) => { const i = (y * W + x) * 4; return D[i] * .3 + D[i + 1] * .59 + D[i + 2] * .11; };

// rozostup a fáza mriežky: maximum súčtu hrán na mriežke
function grid(len, edge) {
  let best = [0, 0, 0];
  for (let P = 6; P <= 12; P += 0.01) for (let ph = 0; ph < P; ph += 0.25) {
    let v = 0, n = 0; for (let k = 0; k * P + ph < len; k++, n++) v += edge(Math.round(k * P + ph));
    if (v / n > best[0]) best = [v / n, P, ph];
  }
  return best;
}
const gx = new Float64Array(W), gy = new Float64Array(H);
for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) { gx[x] += Math.abs(lum(x, y) - lum(x - 1, y)); gy[y] += Math.abs(lum(x, y) - lum(x, y - 1)); }
const [, PX, PHX] = grid(W, (i) => gx[i] || 0), [, PY, PHY] = grid(H, (i) => gy[i] || 0);
const P = (PX + PY) / 2;
console.log(`mriežka ${PX.toFixed(2)}×${PY.toFixed(2)} fáza ${PHX}/${PHY}`);

// stred každej bunky = medián farby vnútornej časti bunky
const cols = Math.floor((W - PHX) / P), rows = Math.floor((H - PHY) / P);
const out = new PNG({ width: cols, height: rows });
const bgAt = (y) => { const t = y / (H - 1); return [50 + (34 - 50) * t, 56, 59 + (71 - 59) * t]; }; // gradient pozadia (rohy obrázka)
const cell = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const x0 = PHX + c * P, y0 = PHY + r * P, px = [];
  for (let y = Math.round(y0 + P * .3); y <= Math.round(y0 + P * .7); y++) for (let x = Math.round(x0 + P * .3); x <= Math.round(x0 + P * .7); x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = (y * W + x) * 4; px.push([D[i], D[i + 1], D[i + 2]]);
  }
  px.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  const m = px[Math.floor(px.length / 2)] || [0, 0, 0];
  const bg = bgAt(y0 + P / 2), dist = Math.hypot(m[0] - bg[0], m[1] - bg[1], m[2] - bg[2]);
  cell.push({ m, dist });
}
// pozadie = záplava od okrajov cez bunky blízke farbe pozadia (odraz pod knihou má väčšiu toleranciu)
const bgMask = new Uint8Array(cols * rows), q = [];
for (let c = 0; c < cols; c++) { q.push(c, (rows - 1) * cols + c); } for (let r = 0; r < rows; r++) { q.push(r * cols, r * cols + cols - 1); }
while (q.length) {
  const i = q.pop(); if (bgMask[i]) continue; const r = Math.floor(i / cols);
  const tol = r > rows * .85 ? 34 : 22;
  if (cell[i].dist > tol) continue;
  bgMask[i] = 1; const c = i % cols;
  if (c > 0) q.push(i - 1); if (c < cols - 1) q.push(i + 1); if (r > 0) q.push(i - cols); if (r < rows - 1) q.push(i + cols);
}
// orež na obsah
let minX = cols, minY = rows, maxX = 0, maxY = 0;
for (let i = 0; i < cols * rows; i++) if (!bgMask[i]) { const x = i % cols, y = Math.floor(i / cols); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
const ow = maxX - minX + 1, oh = maxY - minY + 1, png = new PNG({ width: ow, height: oh });
for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
  const i = (y + minY) * cols + x + minX, o = (y * ow + x) * 4;
  if (bgMask[i]) { png.data[o + 3] = 0; continue; }
  const [r, g, b] = cell[i].m; png.data[o] = r; png.data[o + 1] = g; png.data[o + 2] = b; png.data[o + 3] = 255;
}
fs.mkdirSync("public/assets/book", { recursive: true });
fs.writeFileSync("public/assets/book/book.png", PNG.sync.write(png));
console.log(`public/assets/book/book.png ${ow}×${oh}`);
