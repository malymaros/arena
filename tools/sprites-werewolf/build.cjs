// Werewolf — asset pipeline (reprodukovateľné):
//   1) Charge.png — prefarbený fire fireball per paleta: Werewolf_1 = mesačná modro-strieborná,
//      Werewolf_2 = krvavá červená (P2 tell, rovnaký vzor ako medusa/minotaur per-paleta projektily)
//   2) public/assets/moon_0..3.png — 4 fázy mesiaca (nov / kosáčik / polmesiac / spln) pre HUD badge
//      a float nad postavou pri zmene levelu; pixel-art 32×32 (CSS pixelated to roztiahne)
//   3) vypíše bbox figúry z Idle.png (frame 0) — podklad na ladenie HEAD_CX/HEAD_TOP/HEAD_CROP v client.js
// Spustenie: node tools/sprites-werewolf/build.cjs
const fs = require("fs"), path = require("path"), { PNG } = require("pngjs");

const ASSETS = path.join(__dirname, "../../public/assets");
const FIRE_CHARGE = path.join(ASSETS, "fire/Charge.png");
const W1 = path.join(ASSETS, "Werewolf_1");
const W2 = path.join(ASSETS, "Werewolf_2");

/* ---------- 1) Charge.png — recolor fire fireballu per paleta ---------- */
// fire fireball je oranžovo-žltý; kanálové mapovanie zachová tieňovanie/tvar plameňa
// moonblue: oranžová → ľadovo modro-biela (mesačné svetlo); blood: oranžová → sýta červená
const RECOLOR = {
  moonblue: (r, g, b) => [Math.round(b * 0.75 + 40), Math.round(g * 0.85 + 20), Math.min(255, Math.round(r * 1.0 + 30))],
  blood:    (r, g, b) => [Math.min(255, Math.round(r * 1.05)), Math.round(g * 0.30), Math.round(b * 0.35 + 20)],
};
function buildCharge(outDir, mode) {
  const png = PNG.sync.read(fs.readFileSync(FIRE_CHARGE));
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 10) continue;
    const [r, g, b] = RECOLOR[mode](d[i], d[i + 1], d[i + 2]);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  fs.writeFileSync(path.join(outDir, "Charge.png"), PNG.sync.write(png));
  console.log(`Charge.png (${mode}) -> ${path.basename(outDir)}/`);
}

/* ---------- 2) moon_0..3.png — fázy mesiaca ---------- */
// 32×32 pixel-art disk r=13: tmavý „nov" podklad + osvetlená časť podľa fázy; spln má jemný glow prstenec.
// Fáza = osvetlené pixely: 0 nič, 1 kosáčik (mimo posunutého kruhu), 2 pravá polovica, 3 celý disk.
const MOON = {
  dark:  [38, 44, 64],    // neosvetlená strana
  darkE: [66, 74, 102],   // obrys neosvetlenej strany (nech je nov viditeľný na tmavom HUD-e)
  lit:   [242, 238, 200], // mesačné svetlo
  litSh: [210, 202, 156], // krátery/tieň na osvetlenej strane
  glow:  [255, 246, 180], // glow prstenec splnu
};
// deterministické „krátery" (bez Math.random) — pozície v súradniciach disku
const CRATERS = [[19, 12], [22, 18], [17, 21], [24, 13]];
function buildMoon(level) {
  const S = 32, C = 15.5, R = 13;
  const png = new PNG({ width: S, height: S });
  const put = (x, y, c, a = 255) => { const i = (y * S + x) * 4; png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = a; };
  const inDisc = (x, y, cx = C, cy = C, r = R) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!inDisc(x, y)) {
      // spln: jemný glow prstenec tesne za okrajom disku
      if (level === 3 && inDisc(x, y, C, C, R + 2)) put(x, y, MOON.glow, 70);
      continue;
    }
    let lit = false;
    if (level === 3) lit = true;
    else if (level === 2) lit = x + 0.5 >= C;                    // polmesiac — pravá polovica
    else if (level === 1) lit = !inDisc(x, y, C - 7, C, R);      // kosáčik — mimo doľava posunutého kruhu
    if (lit) {
      const crater = CRATERS.some(([kx, ky]) => Math.abs(kx - x) <= 1 && Math.abs(ky - y) <= 1);
      put(x, y, crater ? MOON.litSh : MOON.lit);
    } else {
      const edge = !inDisc(x, y, C, C, R - 1.2);
      put(x, y, edge ? MOON.darkE : MOON.dark);
    }
  }
  fs.writeFileSync(path.join(ASSETS, `moon_${level}.png`), PNG.sync.write(png));
  console.log(`moon_${level}.png -> assets/`);
}

/* ---------- 2b) recenter Werewolf_1 — figúra je v frame posunutá doprava (~9px hluchého
   priestoru za chrbtom navyše oproti Werewolf_2, ktorý je centrovaný). Posuň obsah každého framu
   doľava o dx = min(9, ľavý okraj súboru) — Run/Run+Attack majú okraj 0–2 px, tie sa posunú menej
   (clamp), aby sa nič neorezalo. Charge.png (projektil) sa neposúva. Krok je idempotentný:
   po posune je ľavý okraj 0 → ďalší beh posunie o 0. ---------- */
function leftMargin(png, fw) {
  const frames = png.width / fw;
  let min = fw;
  for (let fr = 0; fr < frames; fr++) {
    let m = fw;
    for (let y = 0; y < png.height; y++) for (let x = 0; x < fw; x++) {
      if (png.data[(y * png.width + fr * fw + x) * 4 + 3] > 20 && x < m) m = x;
    }
    if (m < min) min = m;
  }
  return min;
}
function recenterW1() {
  for (const file of fs.readdirSync(W1).filter(f => f.endsWith(".png") && f !== "Charge.png")) {
    const png = PNG.sync.read(fs.readFileSync(path.join(W1, file)));
    const fw = png.height;
    const dx = Math.min(9, leftMargin(png, fw));
    if (dx <= 0) { console.log(`recenter ${file}: dx=0 (bez posunu)`); continue; }
    const frames = png.width / fw;
    for (let fr = 0; fr < frames; fr++) {
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < fw; x++) {
          const src = x + dx < fw ? (y * png.width + fr * fw + x + dx) * 4 : -1;
          const dst = (y * png.width + fr * fw + x) * 4;
          for (let k = 0; k < 4; k++) png.data[dst + k] = src >= 0 ? png.data[src + k] : 0;
        }
      }
    }
    fs.writeFileSync(path.join(W1, file), PNG.sync.write(png));
    console.log(`recenter ${file}: posun doľava o ${dx}px`);
  }
}

/* ---------- 3) bbox figúry z Idle.png (frame 0) — ladenie HEAD_CX/HEAD_TOP ---------- */
function measureIdle(dir) {
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, "Idle.png")));
  const fh = png.height, fw = fh; // štvorcové framy
  let minX = fw, maxX = -1, minY = fh, maxY = -1;
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    if (png.data[(y * png.width + x) * 4 + 3] > 20) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  console.log(`${path.basename(dir)}/Idle.png frame0 bbox: x ${minX}-${maxX} (${((minX + maxX) / 2 / fw).toFixed(2)} cx), y ${minY}-${maxY} (top ${(minY / fh).toFixed(2)}, feet ${(maxY / fh).toFixed(2)}) z ${fw}px framu`);
}

buildCharge(W1, "moonblue");
buildCharge(W2, "blood");
recenterW1();
for (let l = 0; l <= 3; l++) buildMoon(l);
measureIdle(W1);
measureIdle(W2);
