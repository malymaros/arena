// tools/make-icons.mjs - ikony aplikácie (PWA manifest, apple-touch-icon): písmeno A z nadpisu ARENA (glyf Press Start 2P
// 7×7 prekreslený ako pixel art - zlaté pásy, tmavočervená 3D hrana a tieň ako text-shadow nadpisu) na čiernom
// pozadí bez rámu, malé - ostáva hlboko vnútri bezpečnej zóny maskable ikony (Android ju oreže do kruhu / zaobleného štvorca).
//   node tools/make-icons.mjs   → public/icons/icon-{180,192,512}.png
import pngjs from "pngjs";
import fs from "node:fs";
import path from "node:path";
const { PNG } = pngjs;

const OUT = "public/icons";
const A = ["..XXX..", ".XX.XX.", "XX...XX", "XX...XX", "XXXXXXX", "XX...XX", "XX...XX"];
const on = (x, y) => A[y]?.[x] === "X";
const GOLD = [[255, 226, 122], [255, 194, 26], [255, 179, 0], [232, 138, 0]];
const EXT = [122, 31, 0];

function icon(size) {
  const img = new PNG({ width: size, height: size });
  const rect = (x, y, w, h, [r, g, b], a = 1) => {
    for (let yy = Math.max(0, Math.round(y)); yy < Math.min(size, Math.round(y + h)); yy++)
      for (let xx = Math.max(0, Math.round(x)); xx < Math.min(size, Math.round(x + w)); xx++) {
        const i = (yy * size + xx) * 4;
        img.data[i] = Math.round(r * a + img.data[i] * (1 - a));
        img.data[i + 1] = Math.round(g * a + img.data[i + 1] * (1 - a));
        img.data[i + 2] = Math.round(b * a + img.data[i + 2] * (1 - a));
        img.data[i + 3] = 255;
      }
  };
  rect(0, 0, size, size, [0, 0, 0]); // čierne pozadie, bez rámu
  // písmeno: bunka 26 px pri 512 (glyf ~36 % strany), stred mierne vľavo hore - 3D hrana a tieň idú doprava dole
  const k = size / 512, cell = Math.round(26 * k), x0 = Math.round(250 * k - 3.5 * cell), y0 = Math.round(248 * k - 3.5 * cell);
  const cells = [];
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (on(x, y)) cells.push([x, y]);
  const sq = ([x, y], c, a = 1, d = 0) => rect(x0 + x * cell + d, y0 + y * cell + d, cell, cell, c, a);
  // tieň: zlúčená maska (aby sa polopriehľadné bunky neprekrývali)
  const sh = Math.round(cell * 0.9), mask = new Set();
  for (const [x, y] of cells) for (let yy = 0; yy < cell; yy++) for (let xx = 0; xx < cell; xx++) mask.add((y0 + y * cell + sh + yy) * size + x0 + x * cell + sh + xx);
  for (const p of mask) rect(p % size, Math.floor(p / size), 1, 1, [0, 0, 0], 0.55);
  for (let d = 1; d <= Math.round(cell * 0.5); d++) for (const c of cells) sq(c, EXT, 1, d);
  const t = Math.max(2, Math.round(cell / 6));
  for (const [x, y] of cells) rect(x0 + x * cell - t, y0 + y * cell - t, cell + 2 * t, cell + 2 * t, [0, 0, 0]);
  for (const c of cells) sq(c, GOLD[Math.min(GOLD.length - 1, Math.floor(c[1] * GOLD.length / 7))]);
  // odlesk v hornom ľavom rohu každého segmentu
  const hl = Math.round(cell / 3);
  for (const [x, y] of cells) if (!on(x, y - 1) && !on(x - 1, y)) rect(x0 + x * cell, y0 + y * cell, hl, hl, [255, 255, 255], 0.55);
  return img;
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [180, 192, 512]) {
  const f = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(f, PNG.sync.write(icon(size)));
  console.log(f);
}
