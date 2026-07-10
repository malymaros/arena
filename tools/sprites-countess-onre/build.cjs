// Countess Vampire + Onre — asset pipeline (reprodukovateľné):
//   1) Onre/Charge.png — Onre nemá vlastný projektil: prefarbená kópia Countessinho krvavého
//      Blood_Charge_1.png (4×48px framy) do prízračnej modro-bielej (onryō duch). Countess vlastný
//      Charge.png nepotrebuje — SPRITE_FILE_ALIAS v client.js mapuje Charge.png → Blood_Charge_1.png.
//   2) vypíše bbox figúry z Idle.png (frame 0) oboch postáv — podklad na ladenie
//      HEAD_CX/HEAD_TOP/HEAD_CROP v client.js
// Spustenie: node tools/sprites-countess-onre/build.cjs
const fs = require("fs"), path = require("path"), { PNG } = require("pngjs");

const ASSETS = path.join(__dirname, "../../public/assets");
const SRC_CHARGE = path.join(ASSETS, "Countess_Vampire/Blood_Charge_1.png");
const ONRE = path.join(ASSETS, "Onre");

/* ---------- 1) Onre/Charge.png — recolor krvavej strely na prízračnú ---------- */
// krv je sýto červená; kanálové mapovanie zachová tieňovanie kvapiek: červená → studená
// modro-biela (duchovské svetlo), tmavé okraje ostanú tmavomodré
function ghostly(r, g, b) {
  const lum = Math.max(r, g, b); // jas kvapky (červený kanál nesie tvar)
  return [
    Math.round(lum * 0.55 + 40),            // R — potlačené, nech nič nie je ružové
    Math.round(lum * 0.75 + 55),            // G — stredná (cyan nádych)
    Math.min(255, Math.round(lum * 0.95 + 80)), // B — dominantná (prízračná modrá)
  ];
}
function buildOnreCharge() {
  const png = PNG.sync.read(fs.readFileSync(SRC_CHARGE));
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 10) continue;
    const [r, g, b] = ghostly(d[i], d[i + 1], d[i + 2]);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  fs.writeFileSync(path.join(ONRE, "Charge.png"), PNG.sync.write(png));
  console.log("Charge.png (ghostly) -> Onre/");
}

/* ---------- 2) bbox figúry z Idle.png frame 0 — na ladenie hláv ---------- */
function bbox(dir) {
  const png = PNG.sync.read(fs.readFileSync(path.join(ASSETS, dir, "Idle.png")));
  const fw = png.height; // štvorcové framy
  let minX = fw, maxX = 0, minY = png.height, maxY = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < fw; x++) {
    const a = png.data[(y * png.width + x) * 4 + 3];
    if (a < 10) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  console.log(`${dir}: frame ${fw}x${png.height}, bbox x ${minX}-${maxX}, y ${minY}-${maxY}` +
    ` | cx=${(((minX + maxX) / 2) / fw).toFixed(3)} top=${(minY / png.height).toFixed(3)}`);
}

buildOnreCharge();
bbox("Countess_Vampire");
bbox("Onre");
