// Zlozenie pasov Star Platinuma z JUS sheetu (cells_sp.json z detect_sp.cjs).
// Jednotny 2x nearest-neighbor upscale (JUS sprity su ~polovicne oproti CPS3 Jotarovi).
// Per-segment velkost stvorcoveho framu (salvy s FX su sirsie ako 128) a kotva:
// "bottom" (postoj, summon — dym na zemi) alebo "center" (lietajuce paste).
// Vystup: out/sp/*.png
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const SRC = "C:/Users/maly/Desktop/Jotaro/star_platinum_ova_sprite_jus_by_ryudara323_deaxfn3.png";
const cells = require("./cells_sp.json");
const OUT = path.join(__dirname, "out", "sp");
fs.mkdirSync(OUT, { recursive: true });

const S = 2;      // upscale
const PAD = 8;    // okraj vo frame

const png = PNG.sync.read(fs.readFileSync(SRC));
function isBg(si) {
  const r = png.data[si], g = png.data[si+1], b = png.data[si+2], a = png.data[si+3];
  return a < 10 || (Math.abs(r-63) <= 6 && Math.abs(g-63) <= 6 && Math.abs(b-63) <= 6);
}

function row(r) { return cells.filter(c => c.id.startsWith(r + ".")).map(c => c.id); }

const SEGMENTS = {
  SP_Idle:       { ids: ["0.0", "0.1", "0.2", "0.3"], anchor: "bottom" },        // vznasajuci sa postoj
  SP_Punch:      { ids: row(11), anchor: "center" },                             // tazky priamy uder so svistom
  SP_Barrage:    { ids: row(16), anchor: "center" },                             // ora-ora salva vpred
  SP_BarrageUp:  { ids: row(17), anchor: "center" },                             // salva sikmo nahor
  SP_BarrageAir: { ids: row(18).slice(0, 10), anchor: "center" },                // vzdusna salva (velke FX)
  SP_Summon:     { ids: ["19.0", "19.1", "19.2", "19.3", "19.4"], anchor: "bottom" }, // dym -> silueta -> stand
  SP_Unsummon:   { ids: ["20.0", "20.1", "20.2", "20.3", "20.4", "20.5"], anchor: "bottom" }, // stand -> silueta -> dym
  SP_Jabs:       { ids: row(1), anchor: "center" },                              // rychle jednotlive udery
  SP_Uppercut:   { ids: row(4), anchor: "center" },                              // zdvihak s polmesiacovym svistom
};

for (const [name, seg] of Object.entries(SEGMENTS)) {
  const cs = seg.ids.map(id => cells.find(c => c.id === id)).filter(Boolean);
  if (cs.length !== seg.ids.length) console.log(`  ! ${name}: nenajdene bunky`, seg.ids.filter(id => !cells.find(c => c.id === id)));
  const maxDim = Math.max(...cs.map(c => Math.max(c.w, c.h)));
  const F = Math.ceil((maxDim * S + PAD * 2) / 16) * 16; // zaokruhli na nasobok 16
  const strip = new PNG({ width: F * cs.length, height: F });
  cs.forEach((c, k) => {
    const ox = k * F;
    // kotva: stred x; y = spodok framu - PAD (bottom) alebo stred (center)
    const dw = c.w * S, dh = c.h * S;
    const dx0 = ox + ((F - dw) >> 1);
    const dy0 = seg.anchor === "bottom" ? F - PAD - dh : (F - dh) >> 1;
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const sx = c.x0 + (x / S | 0), sy = c.y0 + (y / S | 0);
      const si = (sy * png.width + sx) * 4;
      if (isBg(si)) continue;
      const di = ((dy0 + y) * strip.width + dx0 + x) * 4;
      strip.data[di] = png.data[si]; strip.data[di+1] = png.data[si+1];
      strip.data[di+2] = png.data[si+2]; strip.data[di+3] = 255;
    }
  });
  fs.writeFileSync(path.join(OUT, `${name}.png`), PNG.sync.write(strip));
  console.log(`${name}.png — ${cs.length} framov, frame ${F}px`);
}
