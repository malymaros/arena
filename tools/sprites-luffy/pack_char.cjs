// Zlozenie hernych akcii Luffyho z pasov definovanych v pack.cjs (SEGMENTS).
// Na rozdiel od jotarovho pack_char.cjs (kopia hotovych pasov) sa tu kombinovane
// akcie skladaju priamo z buniek sheetu do jednotnej velkosti framu — Special_1
// a Special_4 lepia viacero segmentov s roznymi F. Kotva sa preberá per-segment.
// Vystup: out/char/*.png + kopia do public/assets/luffy/ (herne nazvy;
// P1/P2 paleta sa zatial nerozlisuje).
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const SHEETS = require("./sheet.cjs");
const { SEGMENTS } = require("./pack.cjs");

const cfg = SHEETS.luffy;
const cells = require("./" + cfg.cells);
const OUT = path.join(__dirname, "out", "char");
const ASSETS = path.join(__dirname, "..", "..", "public", "assets", "luffy");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });

const S = 2, PAD = 8;
const png = PNG.sync.read(fs.readFileSync(cfg.src));
const [BR, BG_, BB] = cfg.bg;
function isBg(si) {
  const r = png.data[si], g = png.data[si+1], b = png.data[si+2], a = png.data[si+3];
  return a < 10 || (Math.abs(r-BR) <= 6 && Math.abs(g-BG_) <= 6 && Math.abs(b-BB) <= 6);
}

// Akcia = zretazene segmenty; {seg, from, to} vybera podmnozinu framov (vratane).
const ACTIONS = {
  Idle:      ["L_Stand"],                                     // vzpriameny postoj
  Run:       ["L_Run"],
  Attack_1:  ["L_Jab2"],                                      // basic attack (cast strely)
  Attack_2:  [{ seg: "L_Gatling", from: 0, to: 8 }],          // melee — gatling bez posledneho framu
  Special_1: ["L_BalloonTwist", "L_ScratchFX", "L_SpinWrap"], // pokruteny balon + skrabance + vrtuliak
  Special_2: ["L_FistWheel"],                                 // koleso pasti
  Special_3: ["L_MeatFeast"],                                 // hostina
  Special_4: ["L_GiantPistol", "L_GiantRocket", "L_GiantPunch"], // Gear Third (dolava)
  Special_5: ["L_GiantRetract"],                              // stiahnutie obrej paste (dolava)
  Special_6: ["L_Rifle"],                                     // tocena ruka (dolava)
  Special_7: ["L_BalloonBounce"],                             // odrazenie utoku balonom
  Recharge:  ["L_Balloon"],                                   // nafuknutie balona
  Recharge2: ["L_TwinFists"],                                 // obrie paste pri hrudi
  Charge:    ["L_FistJet"],                                   // letiaca blur-pesta — projektil
  Hurt:      ["L_Hurt"],
  Dead:      ["L_Lose"],                                      // sediaci porazeny
  Win:       ["L_Win"],
};

function resolveSeg(part) {
  const name = typeof part === "string" ? part : part.seg;
  const seg = SEGMENTS[name];
  if (!seg) { console.log(`  ! neznamy segment ${name}`); return []; }
  let cs = seg.ids.map(id => typeof id === "object" ? { ...id, w: id.x1 - id.x0 + 1, h: id.y1 - id.y0 + 1 } : cells.find(c => c.id === id)).filter(Boolean);
  if (typeof part === "object") cs = cs.slice(part.from ?? 0, (part.to ?? cs.length - 1) + 1);
  return cs.map(c => ({ ...c, anchor: seg.anchor }));
}

for (const [name, parts] of Object.entries(ACTIONS)) {
  const cs = parts.flatMap(resolveSeg);
  const maxDim = Math.max(...cs.map(c => Math.max(c.w, c.h)));
  const F = Math.ceil((maxDim * S + PAD * 2) / 16) * 16;
  const strip = new PNG({ width: F * cs.length, height: F });
  cs.forEach((c, k) => {
    const ox = k * F;
    const dw = c.w * S, dh = c.h * S;
    const dx0 = ox + (c.anchor === "bottomleft" ? PAD : c.anchor === "bottomright" ? F - PAD - dw : (F - dw) >> 1);
    const dy0 = c.anchor === "center" ? (F - dh) >> 1 : F - PAD - dh;
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const sx = c.x0 + (x / S | 0), sy = c.y0 + (y / S | 0);
      const si = (sy * png.width + sx) * 4;
      if (isBg(si)) continue;
      const di = ((dy0 + y) * strip.width + dx0 + x) * 4;
      strip.data[di] = png.data[si]; strip.data[di+1] = png.data[si+1];
      strip.data[di+2] = png.data[si+2]; strip.data[di+3] = 255;
    }
  });
  const buf = PNG.sync.write(strip);
  fs.writeFileSync(path.join(OUT, `${name}.png`), buf);
  fs.writeFileSync(path.join(ASSETS, `${name}.png`), buf);
  console.log(`${name}.png — ${cs.length} framov, frame ${F}px`);
}
