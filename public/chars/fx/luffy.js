// public/chars/fx/luffy.js - klientská choreografia Luffyho (timeline): Special 1 = naťahovacia ruka na ľubovoľnú
// bunku (telo z Punch.png + procedurálna guma + malá päsť), special = guľa (stredová premena → kotúľ o bunku →
// výbuch), Special 2 = Attack_2, dash = Special_7. Továreň dostane C = klientský scope (client.js) a vráti háčiky
// choreografie (popis: public/chars/fx/index.js).

import luffyData from "../luffy.js";

// geometria ruky v zdrojových px Punch.png / L_RocketPull (MUSÍ sedieť s tools/sprites-luffy/punch.cjs):
// napojenie ruky na telo (x, stred pásov y), 4 farebné pásy po 2 px (zhora), päsť 16×16 so stredom na osi ruky
const LUFFY_ARM = { x: 104, y: 276, bands: ["#593520", "#f6dd9e", "#d18b20", "#111111"], band: 2, fist: 16 };
const BODY_FRAME = 320;     // veľkosť framu Punch.png
const BODY_CROP = 0.5;      // armCrop tela pri naťahovaní (anims luffypunch*)
// veľkosť stredového spritu: generický stred zväčšuje celý FRAME na pevný canvas, no Luffyho sheety majú pri
// rovnakej mierke postavy rôzne veľké framy → bez korekcie by bol v strede väčší než ostatní mágovia.
// Násobok = výška stojaceho mága vo frame (Fire Idle 66/128) / výška stojaceho Luffyho (112 px) vo frame sheetu.
// Special 2 (Attack_2, frame 208) vychádza ≈ 1 → bez korekcie.
const STD_BODY = 66 / 128, LUFFY_BODY_PX = 112;
const centerMul = (frame) => STD_BODY / (LUFFY_BODY_PX / frame);
const CENTER_SCALE = { "Attack_1.png": centerMul(144), "Special_1.png": centerMul(160) }; // melee, guľa
// nohy vo frame (spodok figúry / výška framu): ostatní mágovia stoja na spodku framu, takže ich zmenšený stred
// stojí na spodku štandardného canvasu. Luffyho sheety majú pod nohami voľné miesto → bez ukotvenia za nohy by
// zmenšená figúra visela vysoko nad ostatnými (melee Attack_1: nohy y135/144, Special 2 Attack_2: y199/208).
const CENTER_FEET = { "Attack_1.png": 135 / 144, "Attack_2.png": 199 / 208 };

export default function luffyFx(C) {
  /* ---------- Special 1: naťahovacia ruka ---------- */
  // jedna súvislá ruka cez fázy reach (naťahuje sa) → hit (drží, záblesk) → back (sťahuje sa); canvas cez celú
  // dosku vo vrstve figúr (nad postavami). Napojenie počíta pozíciu tela rovnako ako positionActors + drawSprite.
  let arm = null;
  let fistImg = null;
  function armRemove() { if (arm) { arm.dead = true; arm.cv.remove(); arm = null; } }
  function cellCenter(c) { const p = C.cellToPx(c[0], c[1]); return [p.left + C.TILE_W / 2, p.top + C.TILE_H / 2]; }
  // bod ramena (napojenie gumy) v súradniciach dosky: actor canvas (bunka + pairShift, zrkadlený podľa facingu)
  function shoulder(slot, origin) {
    const fit = luffyData.boardFit;
    const fill = fit.fill * (BODY_FRAME / fit.refH);
    const scale = Math.min(C.ACTOR_W / BODY_FRAME, C.ACTOR_H / BODY_FRAME) * fill;
    const sw = BODY_FRAME - Math.round(BODY_FRAME * BODY_CROP);
    const dx = (C.ACTOR_W - sw * scale) / 2, dy = C.ACTOR_H - BODY_FRAME * scale + (fit.offY || 0);
    const cx = dx + LUFFY_ARM.x * scale, cy = dy + LUFFY_ARM.y * scale;
    const facing = C.currentFacing(slot, C.computeFacing(C.state?.p1, C.state?.p2)) || 1;
    const { left, top } = C.cellToPx(origin[0], origin[1]);
    const canvasLeft = left - (C.ACTOR_W - C.TILE_W) / 2 + C.pairShift(slot, C.state);
    return { x: canvasLeft + C.ACTOR_W / 2 + facing * (cx - C.ACTOR_W / 2), y: top - (C.ACTOR_H - C.TILE_H) + cy, scale };
  }
  function armStart(slot, origin, target, dur) {
    armRemove();
    const W = C.board.w * C.TILE_W + (C.board.w - 1) * C.GAP, H = C.board.h * C.TILE_H + (C.board.h - 1) * C.GAP;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    Object.assign(cv.style, { position: "absolute", left: "0", top: "0", width: W + "px", height: H + "px", pointerEvents: "none", zIndex: 200, imageRendering: "pixelated" });
    C.figuresEl.appendChild(cv);
    arm = { cv, ctx: cv.getContext("2d"), W, H, slot, origin, target, phase: "reach", t0: performance.now(), dur: Math.max(1, dur), dead: false };
    if (!fistImg) C.ensureSpriteMeta(C.charDirFor("luffy", slot), "PunchFist.png").then(m => { fistImg = m.img; }).catch(() => {});
    requestAnimationFrame(armFrame);
  }
  function armPhase(phase, dur) {
    if (!arm) return;
    arm.phase = phase; arm.t0 = performance.now(); arm.dur = Math.max(1, dur);
  }
  function armFrame(now) {
    const a = arm;
    if (!a || a.dead || !a.cv.isConnected) return;
    const p = Math.min(1, (now - a.t0) / a.dur);
    const ez = q => 1 - Math.pow(1 - q, 3);
    let k = 1, flash = 0;
    if (a.phase === "reach") k = ez(p);
    else if (a.phase === "hit") flash = 1 - p;
    else if (a.phase === "back") { k = 1 - ez(p); if (p >= 1) { armRemove(); return; } }
    const O = shoulder(a.slot, a.origin), s = O.scale;
    const T = cellCenter(a.target);
    const ex = O.x + (T[0] - O.x) * k, ey = O.y + (T[1] - O.y) * k;
    const len = Math.hypot(ex - O.x, ey - O.y), ang = Math.atan2(ey - O.y, ex - O.x);
    const ctx = a.ctx;
    ctx.clearRect(0, 0, a.W, a.H);
    ctx.save();
    ctx.translate(O.x, O.y); ctx.rotate(ang);
    // guma: 4 pásy v pôvodných farbách ruky zo sheetu; končí pod päsťou
    const bw = LUFFY_ARM.band * s, half = LUFFY_ARM.bands.length * bw / 2, fs = LUFFY_ARM.fist * s;
    const rub = Math.max(0, len - fs * 0.4);
    LUFFY_ARM.bands.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(0, -half + i * bw, rub, bw + 0.5); });
    if (flash > 0) { // záblesk úderu pod päsťou
      ctx.globalAlpha = 0.85 * flash; ctx.fillStyle = "#fff2a8";
      ctx.beginPath(); ctx.arc(len, 0, C.TILE_H * 0.22 * (1.3 - 0.6 * flash), 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
    if (fistImg && len > fs / 2) { ctx.imageSmoothingEnabled = false; ctx.drawImage(fistImg, len - fs / 2, -fs / 2, fs, fs); }
    ctx.restore();
    requestAnimationFrame(armFrame);
  }

  /* ---------- special: stredová premena na guľu ---------- */
  let centerEl = null;
  function centerRemove() { if (centerEl) { centerEl.dead = true; centerEl.remove(); centerEl = null; } }
  function spawnBallCenter(slot, flip) {
    centerRemove();
    const dir = C.charDirFor("luffy", slot);
    const anim = { file: "Special_1.png", fps: 8, loopFrom: 7 };
    const px = Math.round(C.TILE_H * C.SPECIAL_SCALE * CENTER_SCALE["Special_1.png"]);
    const cvs = document.createElement("canvas");
    cvs.width = px; cvs.height = px;
    cvs.className = "luffy-center"; // VLASTNÁ trieda - NIE .special-center (updateSpecialCenter ju maže každý frame)
    if (C.usesAltColor("luffy", slot)) cvs.classList.add("alt-color");
    Object.assign(cvs.style, { position: "absolute", left: "50%", top: "50%", transform: `translate(-50%, -50%) scaleX(${flip || 1})`, zIndex: 8, pointerEvents: "none", imageRendering: "pixelated" });
    C.actorsEl.appendChild(cvs);
    centerEl = cvs;
    const ctx = cvs.getContext("2d");
    const t0 = performance.now();
    C.ensureSpriteMeta(dir, anim.file).then(m => {
      (function step(now) {
        if (!cvs.isConnected || cvs.dead) return;
        C.drawSprite(ctx, m, anim, now - t0, px, px);
        requestAnimationFrame(step);
      })(performance.now());
    }).catch(() => {});
  }

  const faceTo = (slot, sx, ms) => { if (sx) C.facingOverride[slot] = { sx, until: performance.now() + ms + C.POSE_TAIL_MS }; };
  const dirSx = (dir) => dir === "left" ? -1 : dir === "right" ? 1 : 0;
  const curAction = { p1: null, p2: null }; // typ práve vyhodnocovanej akcie (dash → Special_7 namiesto behu)

  return {
    // Special 2 a guľa: malá postava hrá vlastnú pózu (žiadny generický `casting`); Special 2 má stredový Attack_2
    ownCenter: ["special"],
    centerCast(e) {
      if (e.kind === "special" && e.cells) return { from: e.from, file: "Attack_2.png", fps: 10, once: true };
      return null;
    },
    clearOverlays() { centerRemove(); armRemove(); },
    // generický stred (melee Attack_1, Special 2 Attack_2) v štandardnej veľkosti mága
    centerScale: (slot, sp) => CENTER_SCALE[sp?.file] ?? 1,
    // ... ukotvený za nohy na nožnú líniu štandardného stredového mága (spodok canvasu bez korekcie)
    centerPlace(cvs, flip) {
      const feet = CENTER_FEET[cvs.dataset.file];
      if (!feet) return false;
      const basePx = Math.round(C.TILE_H * C.SPECIAL_SCALE);
      cvs.style.left = "50%";
      cvs.style.top = `calc(50% + ${Math.round(basePx / 2)}px)`;
      cvs.style.transform = `translate(-50%, -${(feet * 100).toFixed(2)}%) scaleX(${flip})`;
      return true;
    },
    // dash: beh (setAnim "run" z prehrávača) nahradí kotúľ Special_7 od začiatku presunu
    boardAnim({ slot, st, aSt, anim }) {
      if (st?.char === "luffy" && aSt?.key === "run" && curAction[slot] === "dash") return C.ANIM_DEF.luffydash;
      return anim;
    },
    effect(e, frameHold) {
      if (e.from !== "p1" && e.from !== "p2") return;
      if (e.kind === "action") curAction[e.from] = e.action?.type || null;
      // Special 1: telo f0 (naťahuje) → f1 (úder) → f2 (sťahuje) → f3–4 návrat; ruka je jedna súvislá guma
      // (efekty luffy_punch → luffy_punch_hold → [zásah] → luffy_punch_back)
      if (e.kind.startsWith("luffy_punch") && Array.isArray(e.origin) && Array.isArray(e.target)) {
        if (e.kind === "luffy_punch") {
          faceTo(e.from, Math.sign(e.target[0] - e.origin[0]), frameHold * 3);
          C.setAnim(e.from, "luffypunch0", frameHold);
          armStart(e.from, e.origin, e.target, frameHold);
        } else if (e.kind === "luffy_punch_hold") {
          // póza úderu drží aj cez frame zásahu (hit/block/odraz) - prepne ju až luffy_punch_back
          C.setAnim(e.from, "luffypunch1", frameHold + 4000);
          armPhase("hit", frameHold);
        } else if (e.kind === "luffy_punch_back") {
          const retract = Math.round(frameHold * 0.6);
          C.setAnim(e.from, "luffypunch2", retract);
          armPhase("back", retract);
          const slot = e.from;
          setTimeout(() => C.setAnim(slot, "luffypunchback", frameHold - retract), retract);
        }
        C.lastAttackEndAt[e.from] = performance.now() + frameHold;
      }
      // special guľa: stredová premena + malá figúra sa nafukuje na štartovej bunke
      if (e.kind === "luffy_ball_form") {
        faceTo(e.from, dirSx(e.dir), frameHold * 2);
        C.setAnim(e.from, "luffyball", frameHold);
        spawnBallCenter(e.from, dirSx(e.dir));
      }
      // kotúľ o bunku (pohyb cez snapshot) - stredová guľa zmizne, na doske sa guľa gúľa; pri stene len narazí
      if (e.kind === "luffy_roll") {
        centerRemove();
        faceTo(e.from, dirSx(e.dir), frameHold);
        // Portal Realm: za kotúľom cez portál engine vloží frame-y zatvorenia portálu (+ HP/mana portálu) pred výbuchom -
        // guľa sa musí gúľať až do luffy_explode (ten pózu prepne), inak by z portálu na chvíľu vyšiel Luffy
        C.setAnim(e.from, "luffyballspin", e.portal ? frameHold + 3000 : frameHold);
      }
      // výbuch na dopadovej bunke (Special_2 raz, potom idle) - zásah rieši hit frame po ňom
      if (e.kind === "luffy_explode") {
        centerRemove();
        C.setAnim(e.from, "luffyimpact", frameHold);
      }
      // Special 2 (po guli): gatling Attack_2 smerom útoku
      if (e.kind === "special" && e.cells) {
        faceTo(e.from, dirSx(e.dir), frameHold);
        C.setAnim(e.from, "luffys2", frameHold);
        C.lastAttackEndAt[e.from] = performance.now() + frameHold;
      }
    },
  };
}
