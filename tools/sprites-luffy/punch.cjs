// tools/sprites-luffy/punch.cjs - sprity Luffyho Special 1 (naťahovacia ruka) z pásu L_RocketPull (out/).
//   Punch.png      = L_RocketPull s ODMAZANOU pečenou rukou vo framoch 0–2 (od zdrojového x = ARM_X doprava) -
//                    ruku k ľubovoľnej bunke kreslí procedurálne public/chars/fx/luffy.js; framy 3–4 (návrat do
//                    stoja) ostávajú. V hre sa kreslí s armCrop 0.5 (ľavá polovica framu, telo ostane vycentrované).
//   PunchFist.png  = malá päsť z konca pečenej ruky (frame 0), 16×16, otočená doprava.
// Spustenie: node tools/sprites-luffy/punch.cjs
// Geometriu ruky (ARM_X, ARM_Y, FIST) MUSÍ zrkadliť LUFFY_ARM v public/chars/fx/luffy.js.
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const SRC = path.join(__dirname, "out", "L_RocketPull.png");
const DST = path.join(__dirname, "..", "..", "public", "assets", "luffy");
const ARM_X = 104;                          // prvý stĺpec ruky (napojenie na telo)
const ARM_Y = [272, 279];                   // riadky ruky (4 farebné pásy po 2 px)
const FIST = { x: 218, y: 268, size: 16 };  // päsť na konci ruky vo frame 0

const src = PNG.sync.read(fs.readFileSync(SRC));
const F = src.height;                       // štvorcové framy
const frames = Math.round(src.width / F);

// Punch.png: kópia s vymazanou rukou (celá šírka od ARM_X, len riadky ruky a päste) vo framoch 0–2
const out = new PNG({ width: src.width, height: src.height });
src.data.copy(out.data);
for (let f = 0; f < Math.min(3, frames); f++) {
  for (let y = FIST.y - 2; y < FIST.y + FIST.size + 2; y++) {
    for (let x = ARM_X; x < F; x++) out.data[((y * src.width) + f * F + x) * 4 + 3] = 0;
  }
}
fs.writeFileSync(path.join(DST, "Punch.png"), PNG.sync.write(out));

// PunchFist.png: výrez päste
const fist = new PNG({ width: FIST.size, height: FIST.size });
for (let y = 0; y < FIST.size; y++) for (let x = 0; x < FIST.size; x++) {
  const si = ((FIST.y + y) * src.width + FIST.x + x) * 4, di = (y * FIST.size + x) * 4;
  for (let k = 0; k < 4; k++) fist.data[di + k] = src.data[si + k];
}
fs.writeFileSync(path.join(DST, "PunchFist.png"), PNG.sync.write(fist));
console.log(`Punch.png (${frames} framov ${F}px), PunchFist.png ${FIST.size}px, ruka ${ARM_X}/${ARM_Y.join("-")}`);
