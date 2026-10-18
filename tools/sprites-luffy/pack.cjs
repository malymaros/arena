// Zlozenie pasov Luffyho JUS sheetu (cells.json z detect.cjs).
// Rovnaky princip ako tools/sprites-jotaro/pack_jus.cjs: 2x nearest-neighbor upscale,
// per-segment velkost stvorcoveho framu. Kotvy: bottom (stred dole), bottomleft /
// bottomright (natahovacie utoky — postava ostava na svojom kraji, ruka sa tiahne
// na druhu stranu; sheet ma cast utokov kreslenu dolava), center (projektily/FX).
// Vystup: out/*.png
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const SHEETS = require("./sheet.cjs");

const cfg = SHEETS.luffy;
const cells = require("./" + cfg.cells);
const OUT = path.join(__dirname, "out");
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
  // --- postoje, pohyb, obrana -------------------------------------------------
  L_Idle:        { ids: ids(0, 0, 5), anchor: "bottom" },      // bojovy postoj (dychanie)
  L_Stand:       { ids: ids(0, 6, 9), anchor: "bottom" },      // vzpriameny postoj (intro/win)
  L_Guard:       { ids: ids(0, 10, 12), anchor: "bottom" },    // obrana 1 (stena pasti)
  L_Guard2:      { ids: ids(0, 13, 15), anchor: "bottom" },    // obrana 2 (kryt rukami)
  L_Run:         { ids: ids(1, 0, 7), anchor: "bottom" },      // beh
  L_Dash:        { ids: ids(1, 8, 9), anchor: "bottom" },      // spurt
  L_DashStop:    { ids: ids(1, 10, 12), anchor: "bottom" },    // dobeh/brzdenie
  L_Jump:        { ids: ids(1, 13, 21), anchor: "bottom" },    // skok (podrep-let-dopad)

  // --- zakladne udery (B combo) -----------------------------------------------
  L_Jab:         { ids: ids(2, 0, 2), anchor: "bottomleft" },  // jab s kratkym natiahnutim
  L_Jab2:        { ids: ids(2, 3, 6), anchor: "bottomleft" },  // druhy uder comba
  L_Punch:       { ids: ids(2, 7, 10), anchor: "bottomright" },// gumeny priamy uder (dlha ruka, dolava)
  L_PunchBall:   { ids: ids(2, 11, 12), anchor: "bottomleft" },// natiahnuta ruka s gulovou pastou (cela figura)

  // --- B+Forward: Rifle (tocena ruka) + rychly pistol ---------------------------
  L_Rifle:       { ids: ids(3, 0, 8), anchor: "bottomright" }, // tocena ruka -> spiralovy vystrel (dolava)
  L_Bullet:      { ids: [...ids(3, 9, 13), "3.15"], anchor: "bottomleft" }, // rychly uder s ohnivym blurom
  L_FistJet:     { ids: ["3.14"], anchor: "center" },          // oddelena blur-pesta — projektil!
  L_BulletEnd:   { ids: ids(3, 16, 17), anchor: "bottom" },    // navrat do postoja

  // --- Y: Gatling ----------------------------------------------------------------
  L_Gatling:     { ids: ids(4, 0, 9), anchor: "bottom" },      // ora-ora dymove paste 1
  L_Gatling2:    { ids: ids(4, 10, 20), anchor: "bottom" },    // gatling variant 2

  // --- Y+Up / B+Up / Y+Down: vertikalne utoky -----------------------------------
  L_RifleUp:     { ids: ids(5, 0, 12), anchor: "bottom" },     // tocena ruka sikmo hore (velke FX)
  L_UpSwipe:     { ids: ids(5, 13, 18), anchor: "bottom" },    // seknutie hore
  L_WhipUp:      { ids: ids(7, 0, 7), anchor: "bottom" },      // kopnutie s polmesiacom hore 1
  L_WhipUp2:     { ids: ids(7, 8, 17), anchor: "bottom" },     // kopnutie s polmesiacom hore 2
  L_Axe:         { ids: ids(7, 18, 27), anchor: "bottom" },    // Ono — noha vystrelena hore a sekera dole

  // --- Y+Forward: dlhy pistol + oddelene paste ----------------------------------
  L_Pistol:      { ids: ids(6, 0, 7), anchor: "bottomright" }, // dlhy natahovaci uder 1 (dolava)
  L_Pistol2:     { ids: ids(6, 8, 12), anchor: "bottomright" },// dlhy natahovaci uder 2 (dolava)
  L_Fist:        { ids: ["6.13", "6.14", "6.16"], anchor: "center" }, // letiace paste — projektil!

  // --- vzdusne utoky (Jump+B / Jump+Y) — v hre asi nevyuzitelne -------------------
  L_AirStomp:    { ids: [...ids(8, 0, 4), "9.0"], anchor: "bottom" },  // dupnutie natiahnutymi nohami
  L_AirKick:     { ids: ids(8, 5, 13), anchor: "bottom" },
  L_AirSpin:     { ids: ids(8, 14, 22), anchor: "bottom" },

  // --- B+Down: Fusen balon (idealna mirror/shield choreografia) -------------------
  L_Balloon:     { ids: ids(10, 0, 8), anchor: "bottom" },     // nafuknutie -> vyfuknutie
  L_BalloonBounce:{ ids: ids(10, 9, 20), anchor: "bottom" },   // odrazenie utoku balonom (reakcie)
  L_BalloonTwist:{ ids: ids(14, 0, 5), anchor: "bottom" },     // pokruteny balon (Bane)
  L_ScratchFX:   { ids: ["14.8"], anchor: "center" },          // cerveno-modre skrabance FX

  // --- specialne FX a salvy --------------------------------------------------------
  L_SpinWrap:    { ids: ids(11, 0, 1), anchor: "bottom" },     // zamotany vrtuliak
  L_FlashFX:     { ids: ids(11, 2, 4), anchor: "center" },     // zablesk gule + biely hit-flash
  L_FistWheel:   { ids: ids(12, 0, 2), anchor: "center" },     // koleso pasti (Hanabi)
  L_FireworkFX:  { ids: [{ x0: 354, y0: 1332, x1: 451, y1: 1426 }], anchor: "center" }, // rozsypane iskry ako 1 frame
  L_DashAttack:  { ids: ids(13, 0, 4), anchor: "bottom" },     // vypad so seknutim
  L_FistRain:    { ids: ids(15, 0, 11), anchor: "bottom" },    // dazd pasti (Storm)
  L_Cheer:       { ids: ids(15, 12, 14), anchor: "bottom" },   // vyskakovanie s rukami hore

  // --- knockdown / lezanie -----------------------------------------------------------
  L_Roll:        { ids: ids(16, 0, 6), anchor: "bottom" },     // kotul / zrazenie
  L_Lying:       { ids: ids(16, 7, 8), anchor: "bottom" },     // lezanie na zemi (Dead material)
  L_GetUp:       { ids: ["16.9"], anchor: "bottom" },          // vstavanie s rukami hore

  // --- Gear Third: obrie paste ---------------------------------------------------------
  L_GiantPistol: { ids: ids(17, 0, 8), anchor: "bottomright" },// Gigant Pistol (rastuca obria pest, dolava)
  L_GiantRocket: { ids: ids(18, 0, 1), anchor: "bottomright" },// nabeh s obrou pastou (dolava)
  L_GiantPunch:  { ids: ids(18, 2, 4), anchor: "bottomright" },// obri uder natiahnuty (dolava)
  L_GiantRetract:{ ids: ids(19, 0, 3), anchor: "bottomright" },// stiahnutie obrej paste (dolava)
  L_TwinFists:   { ids: ids(20, 0, 6), anchor: "bottom" },     // dve obrie paste pri hrudi (Bazooka nabeh)
  L_SmokeFists:  { ids: ids(20, 7, 10), anchor: "center" },    // dymove paste FX (salva)
  L_Recover20:   { ids: ids(20, 11, 14), anchor: "bottom" },   // navrat do postoja

  // --- dlhe horizontalne natiahnutia -----------------------------------------------------
  L_Whip:        { ids: ids(21, 0, 5), anchor: "bottomright" },// Muchi — natiahnuta noha (dolava)
  L_RocketPull:  { ids: ids(21, 6, 10), anchor: "bottomleft" },// Rocket — tahanie sa za rukami

  // --- visenie / pad ----------------------------------------------------------------------
  L_Hang:        { ids: ids(22, 0, 4), anchor: "bottom" },     // visenie
  L_Fall:        { ids: ids(22, 5, 9), anchor: "bottom" },     // pad

  // --- zasahy / knockback / grapple --------------------------------------------------------
  L_Hurt:        { ids: ids(23, 0, 3), anchor: "bottom" },     // zasahy (Hurt)
  L_Knockback:   { ids: ids(23, 4, 8), anchor: "bottom" },     // odhodenie dozadu
  L_Tumble:      { ids: ids(23, 9, 14), anchor: "bottom" },    // kotrmelce + dopad
  L_Grapple:     { ids: ids(23, 15, 18), anchor: "bottom" },   // Kinnikuman grapple (vtip zo sheetu)

  // --- ultimate: hostina -------------------------------------------------------------------
  L_MeatFeast:   { ids: ids(24, 0, 11), anchor: "bottom" },    // jedenie masa (recharge choreografia?)

  // --- win / lose / unused -------------------------------------------------------------------
  L_Win:         { ids: ids(25, 0, 3), anchor: "bottom" },     // vitazstvo
  L_Lose:        { ids: ids(25, 4, 7), anchor: "bottom" },     // prehra (sediaci)
  L_Unused:      { ids: ids(25, 8, 14), anchor: "bottomright" },// nevyuzite frames zo sheetu (dolava)
};

module.exports = { SEGMENTS };
if (require.main === module) for (const [name, seg] of Object.entries(SEGMENTS)) {
  const cs = seg.ids.map(id => typeof id === "object" ? { ...id, w: id.x1 - id.x0 + 1, h: id.y1 - id.y0 + 1 } : cells.find(c => c.id === id)).filter(Boolean);
  if (cs.length !== seg.ids.length) console.log(`  ! ${name}: nenajdene bunky`, seg.ids.filter(id => typeof id === "string" && !cells.find(c => c.id === id)));
  const maxDim = Math.max(...cs.map(c => Math.max(c.w, c.h)));
  const F = Math.ceil((maxDim * S + PAD * 2) / 16) * 16;
  const strip = new PNG({ width: F * cs.length, height: F });
  cs.forEach((c, k) => {
    const ox = k * F;
    const dw = c.w * S, dh = c.h * S;
    const dx0 = ox + (seg.anchor === "bottomleft" ? PAD : seg.anchor === "bottomright" ? F - PAD - dw : (F - dw) >> 1);
    const dy0 = seg.anchor === "center" ? (F - dh) >> 1 : F - PAD - dh;
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
