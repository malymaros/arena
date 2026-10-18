// Zlozi animacne pasy pre hru z NARUTO.png podla cells.json:
// vyber buniek podla y-pasma (center-y) + x filtra, zoradene podla x, alebo explicitne boxy (kde detekcia zliala susedov).
// Vystup: stvorcove frames v horizontalnom pase (format enginu), magenta/seda -> priehladne.
// Kotva: bottom-center (postavy) / center (projektily a efekty). Velkost framu: postavy 128, efekty podla obsahu.
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const SRC = PNG.sync.read(fs.readFileSync(path.join(__dirname, "NARUTO.png")));
const CELLS = JSON.parse(fs.readFileSync(path.join(__dirname, "cells.json"), "utf8"));
const OUTDIR = path.join(__dirname, "out");
fs.mkdirSync(OUTDIR, { recursive: true });

function isMagenta(r, g, b) { return r > 180 && b > 180 && g < 80; }
function isGray(r, g, b) { return Math.abs(r - 206) <= 4 && Math.abs(g - 213) <= 4 && Math.abs(b - 223) <= 4; }

// vyber buniek: center-y v [y0,y1], volitelne x0 v [xMin,xMax], zoradene podla x
function band(y0, y1, xMin = 0, xMax = 99999) {
  return CELLS
    .filter(c => { const cy = (c.y0 + c.y1) / 2; return cy >= y0 && cy <= y1 && c.x0 >= xMin && c.x0 <= xMax; })
    .sort((a, b) => a.x0 - b.x0);
}
const pick = (cells, idxs) => idxs.map(i => cells[i]).filter(Boolean);
const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 });
const cell = id => { const c = CELLS.find(k => k.id === id); if (!c) throw new Error("chyba bunka " + id); return c; };

const hurtRow = band(550, 628);
const ANIMS = {
  /* ---------- pouzivane v hre (ANIM_DEF) ---------- */
  "Idle.png":     { cells: band(88, 182, 0, 560), anchor: "bottom" },   // 6f dychanie
  "Run.png":      { cells: band(295, 365), anchor: "bottom" },          // 6f ninja beh
  "Attack_1.png": { cells: band(1530, 1610), anchor: "bottom" },        // 5f silny uder pastou
  "Attack_2.png": { cells: band(950, 1040), anchor: "bottom" },         // 5f kick combo
  "Hurt.png":     { cells: pick(hurtRow, [0, 1, 2]), anchor: "bottom" },
  "Dead.png":     { cells: [...pick(hurtRow, [3, 5, 7]), ...pick(band(640, 715), [0])], anchor: "bottom" }, // pad dozadu -> lezanie
  // projektil: 3 cakrove spiraly â€” explicitne boxy (prvej treba odstrihnut prilepenu kocku pod nou); 64px frame ako fire Charge
  "Charge.png":   { cells: [box(616, 18, 647, 65), box(661, 17, 691, 65), box(702, 16, 736, 68)], anchor: "center", size: 64 },

  /* ---------- kandidati na special ---------- */
  "Seals.png":    { cells: band(1450, 1530), anchor: "bottom" },        // 4f pecate rukami
  "Clones.png":   { cells: band(2310, 2395), anchor: "bottom" },        // 6f trojity tienovy klon
  "CloneDuo.png": { cells: band(1915, 2000), anchor: "bottom" },        // 6f dvojity klon (Rasengan charge s klonom)
  "Victory.png":  { cells: band(455, 545), anchor: "bottom" },          // 3f vitazna poza
  "Dash.png":     { cells: band(368, 455), anchor: "bottom" },          // 6f sprint + blur

  /* ---------- dalsie akcie postavy ---------- */
  "Costumes.png":   { cells: band(10, 95, 0, 350), anchor: "bottom" },  // 4 staticke farebne varianty (x<350: bez "Ripped By" textu)
  "Stance.png":     { cells: band(200, 275, 0, 400), anchor: "bottom" },// 4f bojovy postoj so stuhami
  "GetUp.png":      { cells: pick(band(640, 715), [1, 2, 3, 4, 5]), anchor: "bottom" }, // 5f vstavanie/kotul zo zeme
  // uder pastou â€” 3. frame bol detekciou zliaty s plamenom uppercutu pod nim, preto explicitny box
  "Punch.png":      { cells: [cell("9.0"), cell("9.1"), box(231, 726, 306, 785), cell("9.2"), cell("9.3"), cell("9.4")], anchor: "bottom" },
  "Uppercut.png":   { cells: [cell("10.0"), cell("10.1"), box(231, 790, 306, 867)], anchor: "bottom" }, // 3f vyskok s plamenom
  "Jump.png":       { cells: band(870, 952), anchor: "bottom" },        // 4f skok/salto
  "Combo.png":      { cells: band(1040, 1116), anchor: "bottom" },      // 3f kombo prechody
  "KunaiSlash.png": { cells: band(1116, 1200), anchor: "bottom" },      // 4f skok + sek kunaiom (oranzovy obluk)
  "Jabs.png":       { cells: band(1205, 1280), anchor: "bottom" },      // 3f rychle jaby
  "Lunge.png":      { cells: band(1290, 1360), anchor: "bottom" },      // 3f vypad/tackle
  "Dodge.png":      { cells: band(1370, 1445), anchor: "bottom" },      // 4f postoj -> uhyb -> start sprintu
  "Leap.png":       { cells: band(1640, 1706), anchor: "bottom" },      // 3f dlhy skok
  "PalmJump.png":   { cells: band(1732, 1802), anchor: "bottom" },      // 4f skok s uderom dlanou
  "PalmDash.png":   { cells: band(1834, 1902), anchor: "bottom" },      // 4f dash s vystrcenou dlanou
  "Dive.png":       { cells: band(2028, 2098), anchor: "bottom" },      // 3f strmhlavy let
  "FlyKick.png":    { cells: band(2119, 2196), anchor: "bottom" },      // 3f letiaci kop nahor
  "ChakraDash.png": { cells: band(2224, 2295), anchor: "bottom" },      // 5f beh s horiacimi rukami (cakrove pazury)

  /* ---------- Kyubi mod + zaba ---------- */
  // kyubi cloak: posledny box detekcia zliala 2 dash frames do jedneho -> explicitny split
  "KyubiCloak.png": { cells: [cell("28.0"), cell("28.1"), cell("28.2"), box(392, 2423, 518, 2482), box(522, 2423, 649, 2482)], anchor: "bottom", size: 160 },
  "KyubiSpin.png":  { cells: band(2510, 2588), anchor: "bottom" },      // 4f rotacia v cakrovej guli + vyskok
  // kyubi beast: frame1 zliaty so zabou pod nim, posledny box = 2 frames -> explicitne boxy
  "KyubiBeast.png": { cells: [box(22, 2607, 231, 2683), cell("30.1"), cell("30.4"), cell("30.7"), box(652, 2600, 780, 2683), box(785, 2600, 906, 2683)], anchor: "bottom", size: 256 },
  // zaba (gag premena): 2 frames zliate s beastom -> explicitne, zvysok bunky
  "Frog.png":       { cells: [box(22, 2696, 95, 2750), box(100, 2696, 231, 2750), cell("30.2"), cell("30.3"), cell("30.5"), cell("30.6"), cell("30.8"), cell("30.10"), cell("30.11"), cell("30.12")], anchor: "bottom" },

  /* ---------- efekty / projektily ---------- */
  "Rasengan.png":  { cells: [cell("3.5")], anchor: "center" },                       // velky modry cakrovy prstenec (128x128)
  "Kunai.png":     { cells: [box(590, 241, 618, 273)], anchor: "center", size: 64 }, // vrhacia ihla
  "WindSlash.png": { cells: [box(620, 241, 724, 273)], anchor: "center" },           // sivy veterny sek
  "Blood.png":     { cells: [cell("2.7")], anchor: "center" },                       // krvavy strek
  "Debris.png":    { cells: [cell("2.6"), cell("2.8"), cell("2.9")], anchor: "center" }, // 3f kamenna sut
  "SwirlBits.png": { cells: [cell("1.7")], anchor: "center" },                       // drobne cakrove viry (klaster)
  "Waves.png":     { cells: [cell("2.10")], anchor: "center" },                      // vodne vlny (klaster)
};

function extractCell(c) {
  // RGBA vyrez bunky s odkodovanym pozadim + tesny bbox realnych pixelov
  const w = c.w, h = c.h;
  const buf = Buffer.alloc(w * h * 4);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = ((c.y0 + y) * SRC.width + (c.x0 + x)) * 4;
    const r = SRC.data[si], g = SRC.data[si + 1], b = SRC.data[si + 2];
    if (isMagenta(r, g, b) || isGray(r, g, b)) continue;
    const di = (y * w + x) * 4;
    buf[di] = r; buf[di + 1] = g; buf[di + 2] = b; buf[di + 3] = 255;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { buf, w, h, x0, y0, x1, y1 };
}

const report = [];
for (const [file, spec] of Object.entries(ANIMS)) {
  const FS = spec.size || 128;
  const frames = spec.cells.map(extractCell).filter(f => f.x1 >= 0);
  if (!frames.length) { report.push(`${file}: ZIADNE FRAMES!`); continue; }
  const over = frames.filter(f => f.x1 - f.x0 + 1 > FS || f.y1 - f.y0 + 1 > FS);
  if (over.length) report.push(`${file}: POZOR â€” ${over.length} frame(s) presahuje ${FS}px!`);
  const strip = new PNG({ width: FS * frames.length, height: FS });
  frames.forEach((f, i) => {
    const cw = f.x1 - f.x0 + 1, ch = f.y1 - f.y0 + 1;
    const dx = Math.round(FS / 2 - cw / 2) - f.x0 + i * FS;
    const dy = (spec.anchor === "center" ? Math.round(FS / 2 - ch / 2) : FS - ch) - f.y0;
    for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) {
      const si = (y * f.w + x) * 4;
      if (!f.buf[si + 3]) continue;
      const ox = x + dx, oy = y + dy;
      if (ox < i * FS || ox >= (i + 1) * FS || oy < 0 || oy >= FS) continue;
      const di = (oy * strip.width + ox) * 4;
      f.buf.copy(strip.data, di, si, si + 4);
    }
  });
  fs.writeFileSync(path.join(OUTDIR, file), PNG.sync.write(strip));
  report.push(`${file}: ${frames.length} frames @${FS}px`);
}
console.log(report.join("\n"));
