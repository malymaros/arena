// public/chars/fx/luffy.js - klientská choreografia Luffyho (timeline): prepnutie formy pri rechargi,
// GEAR 3 Giant Pistol (jedna súvislá naťahovacia ruka cez celú choreografiu) a special (guľa / kotúľ
// so stredovým hero-shotom). Továreň dostane C = klientský scope (client.js) a vráti háčiky choreografie
// (popis: public/chars/fx/index.js).
import { LUFFY_SPECIAL_DMG } from "/shared/balance.js";

// Giant Pistol gumená ruka - geometria naladená v public/luffy-tune.html.
// Body v ZLOMKOCH dlaždice v „smerovom" rámci (x = dopredu k súperovi, y = výška, hore = záporné):
//   O = napojenie gumy na Luffym (referencia = Luffyho bunka)
//   T = koniec gumy | P = stred obrovskej päste (referencia oboch = cieľová bunka)
// reach = natiahnutie (giant päsť), pull = priťiahnutie (grip päsť). thick = hrúbka gumy (px), size = päsť × TILE_H.
const LUFFY_ARM = {
  reach: { O: { x: 0.42, y: 0.07 }, T: { x: -0.50, y: 0.08 }, P: { x: -0.20, y: 0.00, size: 0.95 }, thick: 13 },
  pull:  { O: { x: -0.08, y: 0.03 }, T: { x: -0.29, y: 0.03 }, P: { x: -0.06, y: 0.02, size: 0.96 }, thick: 18 },
};
const LUFFY_GIANT_FIST = { sx: 182, sy: 186, s: 134 }; // výrez okrúhlej päste z L_GiantPunch (frame 0)

export default function luffyFx(C) {
  // (along,perp) v smerovom rámci → [dx,dy] px offset (zrkadlí rot() v luffy-tune.html)
  const luffyRot = (d, a, b) =>
    d[0] > 0 ? [a * C.TILE_W, b * C.TILE_H] :
    d[0] < 0 ? [-a * C.TILE_W, b * C.TILE_H] :
    d[1] > 0 ? [b * C.TILE_W, a * C.TILE_H] :
               [b * C.TILE_W, -a * C.TILE_H];

  // pri rechargi (prepnutie módu) float s odznakom NOVEJ formy nad postavou (base = slamák, gear3 = päsť)
  function spawnLuffyModeFloat(slot, form) {
    const p = C.state?.[slot]; if (!p || p.x == null) return;
    const gear3 = form === "gear3";
    const { left, top } = C.cellToPx(p.x, p.y);
    const el = document.createElement("div");
    el.className = "luffy-mode-float" + (gear3 ? " gear3" : "");
    el.innerHTML = `<img src="/assets/luffy/${gear3 ? "gear3" : "base"}.png" alt="" />`;
    el.style.left = (left + C.TILE_W / 2) + "px";
    el.style.top = (top - 24) + "px";
    C.actorsEl.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  // GEAR 3 Giant Pistol - JEDNA súvislá naťahovacia ruka cez celú choreografiu (nie viac krátkodobých
  // canvasov). Fázy: "stretch" (giant päsť sa naťahuje origin→cieľ) → "hold" (úchop + záblesk, ruka drží
  // natiahnutá) → "pull" (grip päsť L_Fist ťahá súpera, špička sleduje jeho sklz) alebo "retract" (giant
  // päsť sa stiahne pri minutí/obrane). Prepínajú ich timeline handlery (reach/pull/retract). Perzistentný
  // canvas nad doskou; kreslí sa 1:1 podľa luffy-anim.html DEMO (guma + výrez päste, orientácia podľa smeru).
  let luffyArm = null; // aktívna Giant Pistol ruka
  function luffyArmRemove() {
    if (luffyArm) { luffyArm.dead = true; luffyArm.cv.remove(); luffyArm = null; }
  }
  const luffyCellCenter = c => { const p = C.cellToPx(c[0], c[1]); return [p.left + C.TILE_W / 2, p.top + C.TILE_H / 2]; };
  function luffyGiantReach(originCell, targetCell, dir, dur) {
    luffyArmRemove();
    if (!Array.isArray(originCell) || !Array.isArray(targetCell)) return;
    const W = C.board.w * C.TILE_W + (C.board.w - 1) * C.GAP, H = C.board.h * C.TILE_H + (C.board.h - 1) * C.GAP;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    Object.assign(cv.style, { position: "absolute", left: "0", top: "0", width: W + "px", height: H + "px", pointerEvents: "none", zIndex: 9, imageRendering: "pixelated" });
    C.actorsEl.appendChild(cv);
    const arm = {
      cv, ctx: cv.getContext("2d"), W, H, dir, dead: false,
      originCell, targetCell, fromCell: null, toCell: null,
      cfg: LUFFY_ARM.reach, fist: "giant", flash: 0,
      phase: "stretch", t0: performance.now(), dur: Math.max(1, dur), holdT0: 0,
      giantM: null, fistM: null,
    };
    C.ensureSpriteMeta("luffy", "L_GiantPunch.png").then(m => { if (!arm.dead) arm.giantM = m; }).catch(() => {});
    C.ensureSpriteMeta("luffy", "L_Fist.png").then(m => { if (!arm.dead) arm.fistM = m; }).catch(() => {});
    luffyArm = arm;
    requestAnimationFrame(luffyArmFrame);
  }
  // priťiahnutie: giant päsť sa prehodí na úchop (L_Fist) a špička sleduje súpera z jeho pôvodnej bunky na
  // cieľovú (LINEÁRNE - sync s CSS sklzom súpera cez --move-ms)
  function luffyGiantPull(fromCell, toCell, dir, dur) {
    const arm = luffyArm;
    if (!arm || !Array.isArray(fromCell) || !Array.isArray(toCell)) return;
    arm.fist = "grip"; arm.dir = dir; arm.cfg = LUFFY_ARM.pull;
    arm.fromCell = fromCell; arm.toCell = toCell;
    arm.phase = "pull"; arm.t0 = performance.now(); arm.dur = Math.max(1, dur);
  }
  // minutie/obrana: natiahnutá giant päsť sa stiahne späť k Luffymu
  function luffyGiantRetract(dir, dur) {
    const arm = luffyArm;
    if (!arm) return;
    arm.dir = dir; arm.fist = "giant"; arm.cfg = LUFFY_ARM.reach; arm.flash = 0;
    arm.phase = "retract"; arm.t0 = performance.now(); arm.dur = Math.max(1, dur);
  }
  function luffyArmFrame(now) {
    const arm = luffyArm;
    if (!arm || arm.dead || !arm.cv.isConnected) return;
    const { ctx, W, H, dir, cfg } = arm;
    const ez = q => 1 - Math.pow(1 - q, 3);
    const p = Math.min(1, (now - arm.t0) / arm.dur);
    let armP = 1, flash = arm.flash;
    let targetCell = arm.targetCell; // pri pull sa cieľ sklzuje z fromCell na toCell
    if (arm.phase === "stretch") {
      armP = ez(p); // guma + päsť dorastajú od O k cieľu, armP interpoluje dĺžku
      if (p >= 1) { arm.phase = "hold"; arm.t0 = now; arm.dur = 1; arm.flash = 1; arm.holdT0 = now; } // úchop + záblesk
    } else if (arm.phase === "hold") {
      armP = 1;
      arm.flash = flash = Math.max(0, arm.flash - 0.06); // záblesk úderu doznieva; ruka drží natiahnutá
      if (now - arm.holdT0 > 3200) { luffyArmRemove(); return; } // poistka: pull/retract by mal prísť skôr
    } else if (arm.phase === "pull") {
      armP = 1;
      targetCell = [arm.fromCell[0] + (arm.toCell[0] - arm.fromCell[0]) * p,
                    arm.fromCell[1] + (arm.toCell[1] - arm.fromCell[1]) * p];
      arm.flash = flash = Math.max(0, arm.flash - 0.06);
      if (p >= 1) { luffyArmRemove(); return; }
    } else if (arm.phase === "retract") {
      armP = 1 - ez(p); flash = 0;
      if (p >= 1) { luffyArmRemove(); return; }
    }
    // 3 body v px (O = napojenie na tele, Tt = koniec gumy, Pp = stred päste pri plnom natiahnutí)
    const [oxc, oyc] = luffyCellCenter(arm.originCell);
    const [txc, tyc] = luffyCellCenter(targetCell);
    const oOff = luffyRot(dir, cfg.O.x, cfg.O.y);
    const tOff = luffyRot(dir, cfg.T.x, cfg.T.y);
    const pOff = luffyRot(dir, cfg.P.x, cfg.P.y);
    const O = [oxc + oOff[0], oyc + oOff[1]];
    const Tt = [txc + tOff[0], tyc + tOff[1]];
    const Pp = [txc + pOff[0], tyc + pOff[1]];
    const Tc = [O[0] + (Tt[0] - O[0]) * armP, O[1] + (Tt[1] - O[1]) * armP]; // aktuálny koniec gumy
    const Pc = [O[0] + (Pp[0] - O[0]) * armP, O[1] + (Pp[1] - O[1]) * armP]; // aktuálny stred päste
    ctx.clearRect(0, 0, W, H);
    // záblesk úchopu POD päsťou (ako demo)
    if (flash > 0) {
      ctx.save(); ctx.globalAlpha = flash * 0.8; ctx.fillStyle = "#fff2a8";
      const r = C.TILE_H * 0.5 * (1.1 - flash * 0.3);
      ctx.beginPath(); ctx.arc(Pc[0], Pc[1], r, 0, 7); ctx.fill(); ctx.restore();
    }
    if (armP > 0) {
      const thick = cfg.thick;
      ctx.save(); ctx.lineCap = "round";
      ctx.strokeStyle = "#d9a765"; ctx.lineWidth = thick;        ctx.beginPath(); ctx.moveTo(O[0], O[1]); ctx.lineTo(Tc[0], Tc[1]); ctx.stroke();
      ctx.strokeStyle = "#f2cf9b"; ctx.lineWidth = thick * 0.45; ctx.beginPath(); ctx.moveTo(O[0], O[1]); ctx.lineTo(Tc[0], Tc[1]); ctx.stroke();
      ctx.restore();
      const orient = (rec, sx, sy, sw, sh, size) => {
        if (!rec) return;
        ctx.save(); ctx.imageSmoothingEnabled = false; ctx.translate(Pc[0], Pc[1]);
        if (dir[0] < 0) ctx.scale(-1, 1); else if (dir[1] > 0) ctx.rotate(Math.PI / 2); else if (dir[1] < 0) ctx.rotate(-Math.PI / 2);
        ctx.drawImage(rec.img, sx, sy, sw, sh, -size / 2, -size / 2, size, size); ctx.restore();
      };
      if (arm.fist === "giant") orient(arm.giantM, LUFFY_GIANT_FIST.sx, LUFFY_GIANT_FIST.sy, LUFFY_GIANT_FIST.s, LUFFY_GIANT_FIST.s, C.TILE_H * cfg.P.size);
      else if (arm.fistM) orient(arm.fistM, 1 * arm.fistM.fw, 0, arm.fistM.fw, arm.fistM.fh, C.TILE_H * cfg.P.size);
    }
    requestAnimationFrame(luffyArmFrame);
  }

  // special STREDOVÁ animácia (veľký sprite v strede arény ako pri iných specialoch):
  //   gear3 = premena na guľu + rotácia (Special_1: f0–6 premena, potom loop od f7 = „gúľajúca sa guľa",
  //           presne ako v náhľade výberu postavy). Zmizne, keď sa guľa na doske rozgúľa (luffy_roll ju odstráni),
  //           až potom sa guľa presunie na cieľ a vybuchne.
  //   base  = Special_7 (rozbeh→kotúľ→cvaknutie) - hero-shot sprevádzajúci dogúľanie k bunke.
  let luffyCenterEl = null;
  const rollFromX = { p1: null, p2: null };
  function luffyCenterRemove() {
    if (luffyCenterEl) { luffyCenterEl.dead = true; luffyCenterEl.remove(); luffyCenterEl = null; }
  }
  function spawnLuffyCenter(slot, form, flipDir = 0) {
    luffyCenterRemove();
    const dir  = C.charDirFor("luffy", slot);
    const file = form === "gear3" ? "Special_1.png" : "Special_7.png";
    const anim = form === "gear3" ? { file, fps: 8, loopFrom: 7 } : { file, fps: 12, loop: true };
    const px = Math.round(C.TILE_H * C.SPECIAL_SCALE);
    const cvs = document.createElement("canvas");
    cvs.width = px; cvs.height = px;
    cvs.className = "luffy-center"; // VLASTNÁ trieda - NIE .special-center (updateSpecialCenter ju maže každý frame)
    if (C.usesAltColor("luffy", slot)) cvs.classList.add("alt-color");
    const flip = flipDir || C.currentFacing(slot, C.computeFacing(C.state?.p1, C.state?.p2)) || 1; // smer gúľania, inak k súperovi
    Object.assign(cvs.style, { position: "absolute", left: "50%", top: "50%", transform: `translate(-50%, -50%) scaleX(${flip})`, zIndex: 8, pointerEvents: "none", imageRendering: "pixelated" });
    C.actorsEl.appendChild(cvs);
    luffyCenterEl = cvs;
    const ctx = cvs.getContext("2d");
    const t0 = performance.now();
    C.ensureSpriteMeta(dir, file).then(m => {
      (function step(now) {
        if (!cvs.isConnected || cvs.dead) return;
        C.drawSprite(ctx, m, anim, now - t0, px, px);
        requestAnimationFrame(step);
      })(performance.now());
    }).catch(() => {});
  }

  // HUD: odznak aktuálneho módu (BASE / GEAR 3) vľavo v HUD widgete (na mieste mesiaca). Gear 3 = zlatý pulz.
  const badge = { p1: document.getElementById("luffy-p1"), p2: document.getElementById("luffy-p2") };
  const info = { p1: document.getElementById("luffy-info-p1"), p2: document.getElementById("luffy-info-p2") };
  function hud(slot, p) {
    const el = badge[slot], inf = info[slot];
    if (!el) return;
    if (!p || p.char !== "luffy") { el.classList.add("hidden"); if (inf) inf.classList.add("hidden"); return; }
    const gear3 = p.form === "gear3";
    el.classList.toggle("gear3", gear3);
    const img = el.querySelector("img");
    const src = gear3 ? "/assets/luffy/gear3.png" : "/assets/luffy/base.png";
    if (img && !img.getAttribute("src").endsWith(src)) img.src = src;
    el.classList.remove("hidden");
    // info: basic = diagonálny (base) / ortogonálny (gear3); special = dáma (base, diag+orto) / veža (gear3, orto) + dmg
    if (inf) {
      const s = inf.querySelector(".li-spec"), d = inf.querySelector(".li-dmg");
      // special šípka z moves.png: dáma 8-smerov (base) / veža orto (gear3)
      const specSrc = gear3 ? "/assets/luffy/moves_ortho.png" : "/assets/luffy/moves_all.png";
      if (s && !s.getAttribute("src")?.endsWith(specSrc)) s.src = specSrc;
      const dmg = gear3 ? "8" : "4";
      if (d && d.dataset.dmg !== dmg) { d.dataset.dmg = dmg; d.innerHTML = `${dmg}<span class="pix-ico mini" data-emoji="☠️"></span>`; C.hydratePix(d); }
      inf.classList.remove("hidden");
    }
  }

  // výber postáv: cyklenie módu base↔gear3 - zóna dogúľania (dáma/veža) + badge (base.png/gear3.png) + dmg (4/8)
  // pod mini-doskou (tempo ako pride/moon náhľad)
  const caEl = () => document.getElementById("ca-luffy");
  function syncCa(form) {
    const el = caEl(); if (!el) return;
    const gear3 = form === "gear3";
    const img = el.querySelector("img");
    const src = gear3 ? "/assets/luffy/gear3.png" : "/assets/luffy/base.png";
    if (img && !img.getAttribute("src").endsWith(src)) img.src = src;
    el.classList.toggle("gear3-max", gear3);
    const dmgEl = el.querySelector(".ca-luffy-dmg");
    if (dmgEl) { dmgEl.innerHTML = `${LUFFY_SPECIAL_DMG[gear3 ? "gear3" : "base"]}<span class="pix-ico mini" data-emoji="☠️"></span>`; C.hydratePix(dmgEl); }
  }
  function preview({ grid, caster }) {
    const s = { form: "base", last: 0 };
    const hitSet = () => {
      const set = new Set(), w = C.board.w || 4, h = C.board.h || 3;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
        if (!(x === caster.x && y === caster.y) && C.G.luffySpecialReaches(C.board, caster.x, caster.y, x, y, s.form)) set.add(`${x},${y}`);
      return set;
    };
    const frame = (now) => {
      if (!s.last) s.last = now;
      if (now - s.last >= 1500) { s.last = now; s.form = s.form === "base" ? "gear3" : "base"; syncCa(s.form); }
      const hit = hitSet();
      grid.querySelectorAll(".mini-cell").forEach(c => {
        if (c.classList.contains("caster")) return;
        const on = hit.has(`${c.dataset.gx},${c.dataset.gy}`);
        if (on && !c.classList.contains("hit")) { c.style.animationDelay = -(now % 1000) + "ms"; c.classList.add("hit"); }
        else if (!on) c.classList.remove("hit");
      });
    };
    caEl()?.classList.remove("hidden");
    syncCa("base");
    frame(performance.now()); // zóna base hneď (nie až v ďalšom raf)
    return { frame, close: () => caEl()?.classList.add("hidden") };
  }

  return {
    hud,
    preview,
    previewZone: true, // zónu náhľadu kreslí preview (cyklí s módom)
    // koniec hry/medzihra: stredový hero-shot po game over už renderGrid neuprace
    clearOverlays: luffyCenterRemove,
    // štartová bunka posledného presunu (special roll: smer gúľania = cieľ − štart)
    moved(slot, before) { rollFromX[slot] = before?.x; },
    effect(e, frameHold) {
      if (e.from !== "p1" && e.from !== "p2") return;
      // recharge PREPÍNA mód → prepínacia póza (base→gear3 = pumpovanie pästí, gear3→base = splasknutie)
      // a nad ním float s odznakom NOVEJ formy (na ktorú sa práve prepol)
      if (e.kind === "recharge") {
        C.setAnim(e.from, e.luffyForm === "gear3" ? "luffypump" : "luffydeflate", frameHold);
        if (e.luffyForm === "base" || e.luffyForm === "gear3") spawnLuffyModeFloat(e.from, e.luffyForm);
      }
      // GEAR 3 Giant Pistol: telové pózy L_GiantRocket → L_GiantPunch → L_RocketPull + JEDNA súvislá
      // naťahovacia ruka (canvas dosiahne REÁLNU bunku súpera aj na 2–3 bunky).
      // windup = nabratie (päsť vzad); reach = úder (vystrelenie vpred) + spusti ruku; retract = minutie (stiahne sa).
      // Pull rieši samostatný efekt "luffy_pull" nižšie.
      if (e.kind === "luffy_gp") {
        const d = C.WOLF_DIRS_CLIENT[e.dir] || [1, 0];
        if (e.phase === "reach" && Array.isArray(e.origin) && Array.isArray(e.target)) {
          // úderovú pózu drž cez natiahnutie + úchop + priťiahnutie (nech sa nevráti do idle uprostred)
          C.setAnim(e.from, "luffygiantpunch", frameHold + 1800);
          luffyGiantReach(e.origin, e.target, d, e.ms || 320);
        } else if (e.phase === "retract") {
          C.setAnim(e.from, "luffygiantretract", frameHold);
          luffyGiantRetract(d, Math.min(frameHold, 460));
        } else {
          C.setAnim(e.from, "luffygiantrocket", frameHold); // windup
        }
      }
      // special roll: dogúľa sa na cieľovú bunku (pohyb cez snapshot). Base = Special_7 roll-bounce, gear3 = balón.
      // gear3 special: STREDOVÁ premena na guľu + rotácia (Luffy ešte nehýbe na štartovacej bunke)
      if (e.kind === "luffy_ball_form") {
        C.setAnim(e.from, "luffyball", frameHold);
        spawnLuffyCenter(e.from, "gear3"); // veľká guľa v strede sa gúľa ako v náhľade výberu
      }
      if (e.kind === "luffy_roll") {
        // gear3: stredová guľa ZMIZNE → guľa na doske sa rozgúľa k cieľu; base: stredový hero-shot (Special_7)
        // sprevádza dogúľanie. Cieľová bunka bliká (rieši renderGrid cez e.target).
        // otočenie na smer gúľania (cieľ vľavo/vpravo od Luffyho), nie k súperovi
        const fromX = rollFromX[e.from]; // snapshot roll frame-u už nesie cieľovú bunku → štart z hooku moved
        const sx = Array.isArray(e.target) && fromX != null ? Math.sign(e.target[0] - fromX) : 0;
        if (sx) C.facingOverride[e.from] = { sx, until: performance.now() + frameHold + C.POSE_TAIL_MS };
        if (e.form === "gear3") luffyCenterRemove(); else spawnLuffyCenter(e.from, "base", sx);
        C.setAnim(e.from, e.form === "gear3" ? "luffyballspin" : "luffyrolltravel", frameHold);
      }
      // gear3 special: dogúľal sa na bunku → guľa sa „rozbalí" cez Special_2 (radiálne päste) a HNEĎ potom
      // je tam už len idle Luffy (impact 3f @ 8fps ≈ 375 ms, potom setAnim revertne na idle). dmg rieši applyHit.
      if (e.kind === "luffy_explode") {
        luffyCenterRemove(); // poistka - stredový sprite je preč pred výbuchom
        C.setAnim(e.from, "luffyimpact", 380); // guľa prehrá Special_2 raz, hneď potom idle
      }
      // base special cvaknutie NA cieľovej bunke: zásah → zastaví na cvaknutí (luffychomphit),
      // minutie → dohrá aj zotavenie (luffychomp). „Zásah" = na bunke bol hráč/klon (aj so štítom/mirrorom).
      if (e.kind === "luffy_chomp") {
        C.setAnim(e.from, e.hit ? "luffychomphit" : "luffychomp", frameHold);
        luffyCenterRemove(); // base: stredový hero-shot zmizne pri cvaknutí NA bunke
      }
      // priťiahnutie: rovnaká ruka sa prehodí na úchop (L_Fist) a špička sleduje súpera z jeho pôvodnej
      // bunky na novú (súper sa prisunie cez snapshot - CSS sklz cez --move-ms = MOVE_MS)
      if (e.kind === "luffy_pull") {
        C.setAnim(e.from, "luffyrocketpull", frameHold); // telo: ruka reeluje späť a ťahá súpera k Luffymu
        const d = C.WOLF_DIRS_CLIENT[e.dir] || [1, 0];
        if (Array.isArray(e.fromCell) && Array.isArray(e.toCell))
          luffyGiantPull(e.fromCell, e.toCell, d, C.MOVE_MS);
      }
    },
  };
}
