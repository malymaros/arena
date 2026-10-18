// Wanderer Magician - reproducible P2 palette.
// P2 nema rucny recolor: zapeka do pixelov PRESNE ten isty vzhlad, aky mal
// doterajsi CSS filter `saturate(.22) brightness(1.4)` (alt-color "albino"),
// takze v hre uz filter nie je treba a vysledok je totozny.
// Matematika kopiruje Filter Effects spec: saturate = feColorMatrix
// type="saturate" (vahy 0.213/0.715/0.072, non-premultiplied sRGB),
// brightness = nasobenie kanalov s clampom; alfa sa nemeni.
// Run: node tools/sprites-wanderer/build.cjs
const fs = require("fs"), path = require("path"), { PNG } = require("pngjs");

const SRC = path.join(__dirname, "../../public/assets/wanderer");
const OUT = path.join(__dirname, "../../public/assets/wanderer_2");
fs.mkdirSync(OUT, { recursive: true });

const SAT = 0.22, BRIGHT = 1.4;

// feColorMatrix type="saturate" (s = SAT)
const M = [
  0.213 + 0.787 * SAT, 0.715 - 0.715 * SAT, 0.072 - 0.072 * SAT,
  0.213 - 0.213 * SAT, 0.715 + 0.285 * SAT, 0.072 - 0.072 * SAT,
  0.213 - 0.213 * SAT, 0.715 - 0.715 * SAT, 0.072 + 0.928 * SAT,
];

const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));

function bakeFilter(png) {
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i]     = clamp255((M[0] * r + M[1] * g + M[2] * b) * BRIGHT);
    d[i + 1] = clamp255((M[3] * r + M[4] * g + M[5] * b) * BRIGHT);
    d[i + 2] = clamp255((M[6] * r + M[7] * g + M[8] * b) * BRIGHT);
  }
}

// Vsetky sheety vratane Charge.png a Magic_sphere.png — filter sa doteraz
// aplikoval aj na projektil (.projectile.alt-color) a stredovy cast
// (.special-center.alt-color), takze P2 verziu dostavaju vsetky subory.
for (const file of fs.readdirSync(SRC).filter(f => f.endsWith(".png"))) {
  const png = PNG.sync.read(fs.readFileSync(path.join(SRC, file)));
  bakeFilter(png);
  fs.writeFileSync(path.join(OUT, file), PNG.sync.write(png));
}

console.log("P2 wanderer bake (saturate .22 + brightness 1.4) -> assets/wanderer_2/");
