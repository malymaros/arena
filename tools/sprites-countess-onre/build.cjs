// Vampire (Countess) + Onryō (Onre) — asset pipeline (reprodukovateľné):
//   1) Charge.png pre OBE postavy — spoločný tvar strely z Blood_Charge_1.png. Pozor: Blood_Charge
//      sheety majú framy 64×48 (nie štvorcové) a obsah putuje naprieč framom — klient ale odvodzuje
//      počet framov ako width/height, takže priame použitie strihalo zle a strela poskakovala.
//      Preto: každý zo 3 framov (64×48) sa oreže na bbox a VYCENTRUJE do štvorcového 48×48 framu
//      → 144×48 sheet, špic mieri doprava (klient ho rotuje podľa smeru letu, aj po odraze).
//      Vampire = natívna červená; Onryō = prízračná modro-biela (ghostly recolor).
//   2) vypíše bbox figúry z Idle.png (frame 0) oboch postáv — podklad na ladenie
//      HEAD_CX/HEAD_TOP/HEAD_CROP v client.js
//   3) A1..A5.png — 1:1 rekonštrukcia riadkov z vampire_attack_guide.png ako 128×128 strips:
//      A1 = Attack_1 (6 framov) + BC1 projektil pri ruke vo frame 6
//      A2 = Attack_2 (3 framy) + BC2 kvapka f1..f3 vpravo hore pri každom frame
//      A3 = Attack_3 (1 frame duplikovaný 2×) + BC3 tesáky f1/f2 pri ruke
//      A4 = Attack_4 (6 framov) + BC4 streak f1..f4 vo framoch 1–4 (5–6 čisté)
//      A5 = A1+A2+A3+A4 za sebou (17 framov)
//      Pozn.: Blood_Charge_*.png majú framy 64×48 (BC1/2/3 = 3, BC4 = 4) — pri 48px
//      by kvapky pretekali cez hranice. Ofsety efektov sú odmerané z guide (škála 0.83)
//      a prepočítané do native súradníc voči bboxu figúry.
// Spustenie: node tools/sprites-countess-onre/build.cjs
const fs = require("fs"), path = require("path"), { PNG } = require("pngjs");

const ASSETS = path.join(__dirname, "../../public/assets");
const SRC_CHARGE = path.join(ASSETS, "Countess_Vampire/Blood_Charge_1.png");
const ONRE = path.join(ASSETS, "Onre");

/* ---------- 1) Charge.png (Vampire červený + Onryō prízračný) — centrované 48×48 framy ---------- */
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
function buildCharges() {
  const src = PNG.sync.read(fs.readFileSync(SRC_CHARGE)); // 192×48 = 3 framy po 64×48
  const SRC_FW = 64, FW = 48, N = Math.round(src.width / SRC_FW);
  const out = new PNG({ width: N * FW, height: FW });
  for (let f = 0; f < N; f++) {
    // bbox obsahu framu → vycentruj do štvorcového 48×48 (žiadne poskakovanie počas letu)
    let mx = 1e9, Mx = -1, my = 1e9, My = -1;
    for (let y = 0; y < src.height; y++) for (let x = f * SRC_FW; x < (f + 1) * SRC_FW; x++) {
      if (src.data[(y * src.width + x) * 4 + 3] > 10) {
        const lx = x - f * SRC_FW;
        if (lx < mx) mx = lx; if (lx > Mx) Mx = lx;
        if (y < my) my = y; if (y > My) My = y;
      }
    }
    if (Mx < 0) continue;
    const w = Mx - mx + 1, h = My - my + 1;
    const dx = f * FW + Math.round((FW - w) / 2), dy = Math.round((FW - h) / 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = ((my + y) * src.width + f * SRC_FW + mx + x) * 4;
      const di = ((dy + y) * out.width + dx + x) * 4;
      for (let k = 0; k < 4; k++) out.data[di + k] = src.data[si + k];
    }
  }
  fs.writeFileSync(path.join(ASSETS, "Countess_Vampire/Charge.png"), PNG.sync.write(out));
  console.log(`Charge.png (${N}×${FW}px, centrovaný, červený) -> Countess_Vampire/`);
  // Onryō = ten istý sheet v prízračnej palete
  const ghost = new PNG({ width: out.width, height: out.height });
  out.data.copy(ghost.data);
  for (let i = 0; i < ghost.data.length; i += 4) {
    if (ghost.data[i + 3] < 10) continue;
    const [r, g, b] = ghostly(ghost.data[i], ghost.data[i + 1], ghost.data[i + 2]);
    ghost.data[i] = r; ghost.data[i + 1] = g; ghost.data[i + 2] = b;
  }
  fs.writeFileSync(path.join(ONRE, "Charge.png"), PNG.sync.write(ghost));
  console.log(`Charge.png (${N}×${FW}px, centrovaný, prízračný) -> Onre/`);
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

/* ---------- 3) A1..A5 — riadky z vampire_attack_guide.png ---------- */
const VAMP = path.join(ASSETS, "Countess_Vampire");
const readPng = (f) => PNG.sync.read(fs.readFileSync(path.join(VAMP, f)));

// source-over blend výrezu src[sx0..sx1, sy0..sy1] na dest (dx,dy)
function blit(dest, src, sx0, sy0, sx1, sy1, dx, dy) {
  for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) {
    const si = (y * src.width + x) * 4, a = src.data[si + 3];
    if (a === 0) continue;
    const di = ((dy + y - sy0) * dest.width + (dx + x - sx0)) * 4;
    const ia = 255 - a;
    for (let k = 0; k < 3; k++)
      dest.data[di + k] = Math.round((src.data[si + k] * a + dest.data[di + k] * ia) / 255);
    dest.data[di + 3] = Math.max(dest.data[di + 3], a);
  }
}

// A_n: base sheet (frameMap = index framu v zdroji pre každý cieľový frame)
// + efekty: { fx: cieľový frame, src, bbox [x0,y0,x1,y1] globálne v BC sheete, at [x,y] vo frame }
function buildA(name, baseFile, frameMap, effects) {
  const base = readPng(baseFile), fw = base.height;
  const out = new PNG({ width: frameMap.length * fw, height: fw });
  frameMap.forEach((srcF, i) => blit(out, base, srcF * fw, 0, (srcF + 1) * fw - 1, fw - 1, i * fw, 0));
  for (const e of effects) {
    const bc = readPng(e.src);
    blit(out, bc, e.bbox[0], e.bbox[1], e.bbox[2], e.bbox[3], e.fx * fw + e.at[0], e.at[1]);
  }
  fs.writeFileSync(path.join(VAMP, name + ".png"), PNG.sync.write(out));
  console.log(`${name}.png (${frameMap.length} framov) -> Countess_Vampire/`);
  return out;
}

function buildAttackGuideSheets() {
  const BC1 = "Blood_Charge_1.png", BC2 = "Blood_Charge_2.png",
        BC3 = "Blood_Charge_3.png", BC4 = "Blood_Charge_4.png";
  const a1 = buildA("A1", "Attack_1.png", [0, 1, 2, 3, 4, 5], [
    { fx: 5, src: BC1, bbox: [6, 19, 31, 28], at: [96, 69] },
  ]);
  const a2 = buildA("A2", "Attack_2.png", [0, 1, 2], [
    { fx: 0, src: BC2, bbox: [29, 18, 35, 36], at: [103, 62] },
    { fx: 1, src: BC2, bbox: [92, 18, 99, 35], at: [102, 62] },
    { fx: 2, src: BC2, bbox: [156, 18, 162, 35], at: [102, 62] },
  ]);
  const a3 = buildA("A3", "Attack_3.png", [0, 0], [
    { fx: 0, src: BC3, bbox: [28, 16, 36, 32], at: [101, 61] },
    { fx: 1, src: BC3, bbox: [91, 16, 100, 32], at: [101, 63] },
  ]);
  const a4 = buildA("A4", "Attack_4.png", [0, 1, 2, 3, 4, 5], [
    { fx: 0, src: BC4, bbox: [22, 20, 40, 27], at: [101, 70] },
    { fx: 1, src: BC4, bbox: [75, 20, 104, 26], at: [89, 71] },
    { fx: 2, src: BC4, bbox: [145, 20, 168, 26], at: [86, 71] },
    { fx: 3, src: BC4, bbox: [207, 20, 232, 26], at: [85, 71] },
  ]);
  // A5 = všetky za sebou
  const parts = [a1, a2, a3, a4];
  const out = new PNG({ width: parts.reduce((s, p) => s + p.width, 0), height: 128 });
  let dx = 0;
  for (const p of parts) { blit(out, p, 0, 0, p.width - 1, p.height - 1, dx, 0); dx += p.width; }
  fs.writeFileSync(path.join(VAMP, "A5.png"), PNG.sync.write(out));
  console.log(`A5.png (${out.width / 128} framov) -> Countess_Vampire/`);
}

buildCharges();
bbox("Countess_Vampire");
bbox("Onre");
buildAttackGuideSheets();
