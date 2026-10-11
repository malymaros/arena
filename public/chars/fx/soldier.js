// public/chars/fx/soldier.js - klientská choreografia Vojaka: special = jeden silný výstrel.
// Cast frame drží MIERENIE (frame 0 Shot_2 + slabý laser sight z hlavne na zvolenú bunku), výšľah (framy 1–3)
// sa prehrá RAZ v posledných SOLDIER_FIRE_MS, potom soldier_beam = tenký červený lúč + výbuch na cieli.
// Továreň dostane C = klientský scope (client.js) a vráti háčiky choreografie (popis: public/chars/fx/index.js).
import { SPECIAL_ANIMS } from "../index.js";
import { SOLDIER_AIM_MS } from "/shared/timing.js";

// trvanie laseru (SOLDIER_AIM_MS zo shared/timing.js − FIRE = 2300 ms) musí sedieť s CSS animáciou soldier-aim
const SOLDIER_FIRE_MS  = 300;  // výšľah: 3 framy @ SOLDIER_FIRE_FPS, dohrá presne na konci mierenia
const SOLDIER_FIRE_FPS = 10;
// lúč: MUSÍ časovo sedieť so serverovým SOLDIER_BEAM_MS (frame drží let lúča, zásah padne po ňom)
const SOLDIER_BEAM_HIT_MS = 350; // kedy počas lúča štartuje výbuch na cieli
// špička hlavne pušky - zmerané z Shot_2.png (štvorcový 128px frame; vo výstrelovom frame hlaveň končí
// na sprite pixeli ~(100,78), stred framu x=64). Prepočet kopíruje geometriu positionActors + drawSprite
// (fill .95, anchorY .5, canvas centrovaný na bunku, spodok canvasu na spodku bunky), takže laser aj lúč
// vychádzajú presne zo špičky hlavne. Horizontálny offset ide v smere streľby (sprite je otočený na cieľ
// cez facingOverride); pri čisto vertikálnom cieli je 0 - hlaveň mieri hore/dole, strieľa sa z osi tela.
const SOLDIER_MUZZLE = { x: 100, y: 78, frame: 128 };
// index framu výšľahu v čase t od začiatku mierenia (0 = mieriaca póza; drawSprite clampne na posledný frame)
const fireFrame = (t) => { const fireT = t - (SOLDIER_AIM_MS - SOLDIER_FIRE_MS); return fireT <= 0 ? 0 : 1 + Math.floor(fireT / 1000 * SOLDIER_FIRE_FPS); };

export default function soldierFx(C) {
  function soldierGunOrigin(fromSlot, tx) {
    const p = C.state?.[fromSlot];
    const c = C.cellToPx(p.x, p.y);
    const scale = Math.min(C.ACTOR_W, C.ACTOR_H) / SOLDIER_MUZZLE.frame * 0.95;
    const cx = c.left + C.TILE_W / 2 + C.pairShift(fromSlot);
    const sx = cx + Math.sign(tx - cx) * (SOLDIER_MUZZLE.x - SOLDIER_MUZZLE.frame / 2) * scale;
    const sy = c.top - (C.ACTOR_H - C.TILE_H) + (C.ACTOR_H - SOLDIER_MUZZLE.frame * scale) / 2 + SOLDIER_MUZZLE.y * scale;
    return { sx, sy };
  }
  // slabý „laser sight" počas mierenia: tenká červená linka z hlavne na zvolenú bunku (chvenie → lock-on)
  // + pulzujúci zameriavací terčík na cieli; zhasne v momente výstrelu (nahradí ho plný lúč soldier_beam)
  function spawnSoldierAim(fromSlot, cell, holdMs) {
    const p = C.state?.[fromSlot];
    if (!Array.isArray(cell) || !p || p.x == null) return; // skrytý strelec (labyrint) - bez laseru
    const t = C.cellToPx(cell[0], cell[1]);
    const tx = t.left + C.TILE_W / 2, ty = t.top + C.TILE_H / 2;
    const { sx, sy } = soldierGunOrigin(fromSlot, tx); // špička hlavne
    const dist = Math.hypot(tx - sx, ty - sy), ang = Math.atan2(ty - sy, tx - sx) * 180 / Math.PI;
    const wrap = document.createElement("div");
    wrap.className = "soldier-aim-wrap";
    Object.assign(wrap.style, { position: "absolute", left: sx + "px", top: (sy - 1) + "px", width: dist + "px", height: "2px", transform: `rotate(${ang}deg)`, pointerEvents: "none", zIndex: 8 });
    const line = document.createElement("div");
    line.className = "soldier-aim";
    wrap.appendChild(line);
    const dot = document.createElement("div");
    dot.className = "soldier-aim-dot";
    Object.assign(dot.style, { position: "absolute", left: tx + "px", top: ty + "px", pointerEvents: "none", zIndex: 8 });
    C.actorsEl.appendChild(wrap);
    C.actorsEl.appendChild(dot);
    setTimeout(() => { wrap.remove(); dot.remove(); }, Math.max(0, (holdMs || SOLDIER_AIM_MS) - SOLDIER_FIRE_MS));
  }
  // po výstrele: tenký červený lúč zo zbrane na zvolenú bunku (štýl mirror beamu) + výbuch na cieli po dolete
  function spawnSoldierBeam(fromSlot, cell, holdMs) {
    const p = C.state?.[fromSlot];
    if (!Array.isArray(cell)) return;
    if (!p || p.x == null) { C.spawnExplosionAt(cell, fromSlot); return; } // skrytý strelec (labyrint) - aspoň dopad
    const t = C.cellToPx(cell[0], cell[1]);
    const tx = t.left + C.TILE_W / 2, ty = t.top + C.TILE_H / 2;
    const { sx, sy } = soldierGunOrigin(fromSlot, tx); // špička hlavne - identický origin ako laser sight
    const dist = Math.hypot(tx - sx, ty - sy), ang = Math.atan2(ty - sy, tx - sx) * 180 / Math.PI;
    const wrap = document.createElement("div");
    wrap.className = "soldier-beam-wrap";
    Object.assign(wrap.style, { position: "absolute", left: sx + "px", top: (sy - 3) + "px", width: dist + "px", height: "6px", transform: `rotate(${ang}deg)`, pointerEvents: "none", zIndex: 8 });
    const beam = document.createElement("div");
    beam.className = "soldier-beam";
    wrap.appendChild(beam);
    C.actorsEl.appendChild(wrap);
    setTimeout(() => wrap.remove(), Math.min(holdMs || 900, 900));
    setTimeout(() => C.spawnExplosionAt(cell, fromSlot, 1.6), SOLDIER_BEAM_HIT_MS);
  }

  return {
    // stredový overlay castu specialu (melee sem chodí so sp.file): NECYKLÍ - drží mieriacu pózu a výšľah
    // prehrá raz na konci mierenia (čas od vzniku canvasu = od začiatku cast framu)
    centerCanvas(cvs, sp) {
      if (sp.file) return;
      cvs.dataset.soldierAim = "1";
      cvs.dataset.born = String(performance.now());
    },
    // raf stredového overlayu - mieriaca póza, výšľah + krátky biely záblesk (CSS soldier-fire)
    drawCenter(cvs, ctx, now) {
      if (!cvs.dataset.soldierAim) return false;
      const t = now - Number(cvs.dataset.born);
      if (t - (SOLDIER_AIM_MS - SOLDIER_FIRE_MS) > 0) cvs.classList.add("soldier-fire");
      const file = cvs.dataset.file;
      C.ensureSpriteMeta(cvs.dataset.dir, file)
        .then(meta => C.drawSprite(ctx, meta, { file, fps: SOLDIER_FIRE_FPS, frameIndex: fireFrame(t) }, 0, cvs.width, cvs.height))
        .catch(() => {});
      return true;
    },
    // efekty timeline: otočenie k ZVOLENEJ bunke (nie na súpera), laser sight, lúč
    effect(e, frameHold) {
      if ((e.kind === "special" || e.kind === "soldier_beam") && (e.from === "p1" || e.from === "p2")) {
        const tcell = e.kind === "soldier_beam" ? e.cell : (Array.isArray(e.cells) ? e.cells[0] : null);
        const px = C.state?.[e.from]?.x;
        if (Array.isArray(tcell) && px != null && tcell[0] !== px) {
          C.facingOverride[e.from] = { sx: tcell[0] < px ? -1 : 1, until: performance.now() + frameHold + C.POSE_TAIL_MS };
        }
      }
      if (e.kind === "special" && (e.from === "p1" || e.from === "p2")) {
        spawnSoldierAim(e.from, Array.isArray(e.cells) ? e.cells[0] : null, frameHold);
      }
      // zásah (hit/block/mirror frame) padne až po tomto frame - server drží SOLDIER_BEAM_MS
      if (e.kind === "soldier_beam" && (e.from === "p1" || e.from === "p2")) {
        spawnSoldierBeam(e.from, e.cell, frameHold);
        C.lastAttackEndAt[e.from] = performance.now() + frameHold;
      }
    },
    // malá figúra pri caste: mieriaca póza drží, výšľah raz na konci - v synchróne so stredovým overlayom
    boardAnim({ aSt, now, stoned, anim }) {
      if (aSt.key !== "casting" || stoned) return anim;
      return { file: SPECIAL_ANIMS.soldier.file, fps: SOLDIER_FIRE_FPS, frameIndex: fireFrame(now - (aSt.start || 0)) };
    },
  };
}
