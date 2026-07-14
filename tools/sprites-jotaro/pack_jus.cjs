// Zlozenie pasov JUS Jotara (cells_jus.json z detect_jus.cjs jotaro).
// Rovnaky princip ako pack_sp.cjs: 2x nearest-neighbor upscale, per-segment velkost
// stvorcoveho framu, kotva bottom/center. Vystup: out/jus/*.png
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const SHEETS = require("./jus_sheets.cjs");

const cfg = SHEETS.jotaro;
const cells = require("./" + cfg.cells);
const OUT = path.join(__dirname, "out", "jus");
fs.mkdirSync(OUT, { recursive: true });

const S = 2, PAD = 8;
const png = PNG.sync.read(fs.readFileSync(cfg.src));
const [BR, BG_, BB] = cfg.bg;
function isBg(si) {
  const r = png.data[si], g = png.data[si+1], b = png.data[si+2], a = png.data[si+3];
  return a < 10 || (Math.abs(r-BR) <= 6 && Math.abs(g-BG_) <= 6 && Math.abs(b-BB) <= 6);
}
function ids(row, from, to) { const r = []; for (let i = from; i <= to; i++) r.push(`${row}.${i}`); return r; }

const SEGMENTS = {
  J_Idle:      { ids: ids(0, 0, 5), anchor: "bottom" },     // postoj
  J_Run:       { ids: ids(1, 0, 7), anchor: "bottom" },     // beh
  J_Dash:      { ids: ids(1, 8, 9), anchor: "bottom" },     // spurt/vypad
  J_Guard:     { ids: ids(2, 0, 2), anchor: "bottom" },     // kryt (ruky hore)
  J_Jump:      { ids: ids(3, 0, 5), anchor: "bottom" },     // skok
  J_Hurt:      { ids: ids(4, 0, 3), anchor: "bottom" },     // zasahy
  J_Dead:      { ids: ids(4, 4, 6), anchor: "bottom" },     // pad dozadu + lezanie
  J_Getup:     { ids: ids(6, 0, 3), anchor: "bottom" },     // vstavanie
  J_Taunt:     { ids: ids(7, 0, 7), anchor: "bottom" },     // provokacne pozy
  J_Punch:     { ids: ids(8, 0, 3), anchor: "bottom" },     // priamy uder s ruzovym svistom
  J_Kick:      { ids: ids(9, 0, 4), anchor: "bottom" },     // nizky kop so svistom
  // alignCorr: horizontalne zarovnanie framov korelaciou masiek s frame 0 namiesto centrovania
  // bboxu — vlajuci plast meni bbox (aj tazisko spodnych riadkov) a telo by jitterovalo do stran;
  // korelacia maximalizuje prekryv, takze vyhra staticke telo/cizmy a plast veje okolo
  J_CoatIdle:  { ids: ids(10, 0, 5), anchor: "bottom", alignCorr: true }, // postoj s vlajucim plastom (win/intro)
  // 12.2 ma detekciou zliate dve figury -> rozdelene explicitnymi boxami
  J_Point:     { ids: ["12.0", "12.1", { x0: 91, y0: 839, x1: 138, y1: 889 }, { x0: 139, y0: 839, x1: 185, y1: 889 }], anchor: "bottom" }, // ukazanie prstom
  J_CapTip:    { ids: ids(14, 7, 10), anchor: "bottom" },   // ruka na siltovku (yare yare)
  J_Jabs:      { ids: ids(19, 0, 4), anchor: "bottom" },    // rychle jaby
  J_Hook:      { ids: ids(20, 0, 6), anchor: "bottom" },    // hak s ruzovym svistom
  J_Barrage:   { ids: ids(21, 0, 5), anchor: "bottom" },    // ora-ora salva pasti
  J_Uppercut:  { ids: ids(22, 0, 4), anchor: "bottom" },    // zdvihak s ruzovou pastou
  J_FistRaise: { ids: ids(23, 0, 4), anchor: "bottom" },    // vztycenie s pastou hore
};

for (const [name, seg] of Object.entries(SEGMENTS)) {
  const cs = seg.ids.map(id => typeof id === "object" ? { ...id, w: id.x1 - id.x0 + 1, h: id.y1 - id.y0 + 1 } : cells.find(c => c.id === id)).filter(Boolean);
  if (cs.length !== seg.ids.length) console.log(`  ! ${name}: nenajdene bunky`, seg.ids.filter(id => typeof id === "string" && !cells.find(c => c.id === id)));
  const maxDim = Math.max(...cs.map(c => Math.max(c.w, c.h)));
  const F = Math.ceil((maxDim * S + PAD * 2) / 16) * 16;
  const strip = new PNG({ width: F * cs.length, height: F });
  // alignCorr: maska bunky (x relativne k x0, y relativne k SPODKU — anchor je bottom)
  const maskOf = (c) => {
    const m = new Set();
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++)
      if (!isBg((y * png.width + x) * 4)) m.add((c.y1 - y) * 512 + (x - c.x0));
    return m;
  };
  const ref = seg.alignCorr ? maskOf(cs[0]) : null;
  cs.forEach((c, k) => {
    const ox = k * F;
    const dw = c.w * S, dh = c.h * S;
    let dx0 = ox + ((F - dw) >> 1);
    if (seg.alignCorr && k > 0) { // posun s maximalnym prekryvom oproti frame 0
      const m = maskOf(c);
      let best = 0, bestDx = 0;
      for (let dx = -12; dx <= 12; dx++) {
        let score = 0;
        for (const key of m) { const x = key % 512; if (x + dx >= 0 && ref.has(key + dx)) score++; }
        if (score > best) { best = score; bestDx = dx; }
      }
      dx0 = ox + ((F - cs[0].w * S) >> 1) + bestDx * S; // stlpec x bunky k sedi na stlpci x+dx frame 0
    }
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
