// Star Platinum z SNES sheetu (riadok 3 = 4 sprity predkloneneho trupu s pastami),
// prefarbeny do palety JUS Star Platinuma (out/sp/*) — exaktny remap 16-farebnej SNES
// palety (namerana z riadku 3) na farby namerane z JUS SP idle buniek.
// Vystup: out/sp/SP_SnesMenace.png (2x upscale ako ostatne JUS pasy).
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const SHEETS = require("./jus_sheets.cjs");

const cfg = SHEETS.snes;
const cells = require("./" + cfg.cells).filter(c => c.id.startsWith("3."));
const OUT = path.join(__dirname, "out", "sp");
fs.mkdirSync(OUT, { recursive: true });

// SNES farba -> JUS SP farba
const COLOR_MAP = {
  "8,8,8":       [16, 16, 16],     // obrys
  "24,24,24":    [51, 51, 51],     // vlasy (tmavsie nez obrys nech ostane kresba)
  "66,66,66":    [73, 73, 87],     // tmava seda -> modroseda
  "102,102,102": [122, 115, 134],  // seda -> sedofialova
  "222,148,0":   [237, 195, 19],   // zlato svetle (ramena, paste)
  "156,90,0":    [178, 146, 14],   // zlato stredne
  "115,49,0":    [119, 98, 10],    // zlato tmave
  "132,99,99":   [185, 197, 225],  // telo svetle -> perivinka
  "99,74,74":    [155, 148, 218],  // telo stredne -> levandula
  "74,49,57":    [122, 115, 134],  // telo tiene -> sedofialova
  "173,99,123":  [15, 80, 153],    // sal/pas svetla magenta -> modra
  "140,49,90":   [9, 61, 119],     // sal stredna -> tmavomodra
  "90,24,57":    [6, 45, 90],      // sal tmava
  "57,0,24":     [4, 30, 60],      // sal najtmavsia
  "222,222,222": [240, 237, 247],  // biela (oci/leskly detail)
  "156,140,123": [214, 211, 220],  // bezova -> svetla seda
};

const S = 2, PAD = 8;
const png = PNG.sync.read(fs.readFileSync(cfg.src));
const [BR, BG_, BB] = cfg.bg;
function isBg(si) {
  const r = png.data[si], g = png.data[si+1], b = png.data[si+2], a = png.data[si+3];
  return a < 10 || (Math.abs(r-BR) <= 6 && Math.abs(g-BG_) <= 6 && Math.abs(b-BB) <= 6);
}
function mapColor(r, g, b) {
  const hit = COLOR_MAP[`${r},${g},${b}`];
  if (hit) return hit;
  // poistka: najblizsia znama SNES farba (nemalo by nastat, paleta je exaktna)
  let best = null, bd = Infinity;
  for (const [k, v] of Object.entries(COLOR_MAP)) {
    const [kr, kg, kb] = k.split(",").map(Number);
    const d = (kr-r)**2 + (kg-g)**2 + (kb-b)**2;
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

function buildStrip(cs, anchor) {
  const maxDim = Math.max(...cs.map(c => Math.max(c.w, c.h)));
  const F = Math.ceil((maxDim * S + PAD * 2) / 16) * 16;
  const strip = new PNG({ width: F * cs.length, height: F });
  cs.forEach((c, k) => {
    const ox = k * F;
    const dw = c.w * S, dh = c.h * S;
    const dx0 = ox + ((F - dw) >> 1);
    const dy0 = anchor === "bottom" ? F - PAD - dh : (F - dh) >> 1;
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const sx = c.x0 + (x / S | 0), sy = c.y0 + (y / S | 0);
      const si = (sy * png.width + sx) * 4;
      if (isBg(si)) continue;
      const [r, g, b] = mapColor(png.data[si], png.data[si+1], png.data[si+2]);
      const di = ((dy0 + y) * strip.width + dx0 + x) * 4;
      strip.data[di] = r; strip.data[di+1] = g; strip.data[di+2] = b; strip.data[di+3] = 255;
    }
  });
  return { strip, F };
}

const menace = buildStrip(cells, "bottom");
fs.writeFileSync(path.join(OUT, "SP_SnesMenace.png"), PNG.sync.write(menace.strip));
console.log(`SP_SnesMenace.png — ${cells.length} framov, frame ${menace.F}px`);

// Charge projektil: oddelena ruka standu (bunka 6.3, predposledny riadok sheetu),
// rovnaky remap farieb; centrovana v stvorcovom frame -> public/assets/jotaro/Charge.png
const arm = require("./" + cfg.cells).find(c => c.id === "6.3");
const CHAR_OUT = path.join(__dirname, "..", "..", "public", "assets", "jotaro");
fs.mkdirSync(CHAR_OUT, { recursive: true });
const charge = buildStrip([arm], "center");
fs.writeFileSync(path.join(CHAR_OUT, "Charge.png"), PNG.sync.write(charge.strip));
console.log(`Charge.png — 1 frame, frame ${charge.F}px (ruka standu, bunka 6.3)`);
