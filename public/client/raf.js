// public/client/raf.js - hlavná slučka requestAnimationFrame: kreslenie figúr (póza, otočenie, levelová veľkosť,
// labyrint - siluety a hmla), klonov, ghostov, Last Stand/Hope žiary a aury, figúr z registra fx, časovač ťahu.
// Slučka sa spustí pri načítaní modulu; prvý frame beží až po inicializácii client.js.
import { actorP1, actorP2, cellToPx, TILE_W, TILE_H, hudCharP1, hudBoxP1, hudCharP2, hudBoxP2 } from "/client/dom.js";
import { tickTurnTimer } from "/client/turn-timer.js";
import { actors } from "/client/actors.js";
import { state, me, otherSlot } from "/client/session.js";
import { positionActors, computeFacing, escPrideMul, ESC_FEET_FRAC, PAIR_SHIFT_DEFAULT, pairShift } from "/client/placement.js";
import { usesAltColor, charDirFor, ANIM_DEF, VAMP_ONESHOT_KEYS, ensureSpriteMeta, drawSprite, ACTOR_W, ACTOR_H, portraitFill, CHARGE_ANIM } from "/client/sprites.js";
import { actorFilter, SUMMON_CROP, placeChargeAura, spawnChargeAura } from "/client/board-fx.js";
import { CHARS_BY_KEY, SPECIAL_ANIMS, PAIR_SHIFT, PORTRAIT_SCALE, HEAD_CX } from "/chars/index.js";
import { SPECIAL_FPS } from "/chars/common.js";
import { currentAnim } from "/client/anim.js";
import { CHAR_FX, fxAll } from "/client/fx-registry.js";
import { playback } from "/client/playback.js";
import { cloneEls, cloneGhost, actorGhost, actorSilhouettes } from "/client/actor-layers.js";
import { simulatedClonePos, ghostPos, ghostCharAt } from "/client/ghost.js";
import { planning } from "/client/planning.js";
import { drawMageHeadAnim } from "/client/mage-head.js";
import { lastStand } from "/client/last-stand-state.js";
import { deathBehind, deathCenter, hopeCenter } from "/client/overlays.js";
import { DEATH_SEQ, DEATH_DIR, DEATH_ANIM, HOPE_DIR, HOPE_ANIM } from "/client/demon-sprites.js";
import { hideDeathCenter, hideHopeCenter } from "/client/last-stand.js";

/* ---------- RAF: actors + FX ---------- */
// živé zoznamy podľa triedy namiesto querySelectorAll v každom frame (lacné; kópia [...] pred iteráciou,
// lebo kreslenie môže prvky odobrať)
const PROJECTILES = document.getElementsByClassName("projectile");
const MAGE_HEADS = document.getElementsByClassName("mage-head");
const SPECIAL_CENTERS = document.getElementsByClassName("special-center");
const CHARGE_AURAS = document.getElementsByClassName("charge-aura");
export function raf() {
  const now = performance.now();
  const map = { p1: actorP1, p2: actorP2 };

  tickTurnTimer(now); // odpočet času na ťah (auto-lock pri vypršaní)

  // po vypršaní facing override (streľba do strany) otoč postavu späť k súperovi -
  // positionActors sa inak volá len pri timeline frame-och, takže posledná akcia kola by ostala "visieť"
  for (const slot of ["p1", "p2"]) {
    const ov = actors.facingOverride[slot];
    if (ov.sx && now >= ov.until) {
      ov.sx = 0;
      if (state?.p1 && state?.p2) positionActors(state);
    }
  }

  ["p1","p2"].forEach(slot => {
    const cvs = map[slot];
    const st  = state?.[slot];
    const ctx = cvs.getContext("2d");

    if (!st || !st.char || st.x == null) { // labyrint: skrytý súper sa nekreslí
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      cvs.style.display = "none";
      return;
    }
    cvs.style.display = "block";
    cvs.classList.toggle("alt-color", usesAltColor(st.char, slot)); // Medúza p2 = natívna paleta, bez filtra
    cvs.style.filter = actorFilter(slot, now); // glow: obrana (pulz) > zlatý „YOU", + alt-color

    const dir  = charDirFor(st.char, slot);
    // victory aj casting (special) = slučka efektového sprite daného mága priamo na malej postave (nie úderový švih)
    const aSt = actors.animState[slot];
    if (aSt.key === "casting" && aSt.until && now > aSt.until) { aSt.key = "idle"; aSt.until = 0; } // special dohral → späť do idle
    // „leží mŕtvy" = HP na 0 (bežná smrť) ALEBO server-flag st.down (Last Stand choreografia smrť→oživenie).
    // State-driven = robustné voči frame timingu aj pauznutiu tabu; board sprite tak hrá smrť rovnako ako HUD portrét.
    const lyingDead = (st.hp ?? 1) <= 0 || st.down;
    if (lyingDead && aSt.key !== "dead") { aSt.key = "dead"; aSt.until = 0; }
    else if (!lyingDead && aSt.key === "dead") { aSt.key = "idle"; aSt.until = 0; }
    // skamenená postava = zamrznutá socha (fixný idle frame; sivý nádych rieši actorFilter); smrť má prednosť
    const stoned = (st.stone || 0) > 0 && !lyingDead;
    // Jotaro: pri výhre ostáva IDLE (special na výhru vedie stand Star Platinum, nie jeho telo);
    // casting preňho ani nenastáva (útoky hrá cez attack2_loop) - teda nikdy nekreslí special sprite na tele
    let anim = stoned
      ? ANIM_DEF.idle
      : (aSt.key === "victory" && CHARS_BY_KEY[st.char]?.victoryAnim)
        ? CHARS_BY_KEY[st.char].victoryAnim // register (Luffy Win.png - nemá SPECIAL_ANIMS; Jotaro idle)
      : (aSt.key === "victory" || aSt.key === "casting")
        ? { file: SPECIAL_ANIMS[st.char].file, fps: SPECIAL_FPS, loop: true }
        : currentAnim(slot);
    // póza podľa choreografie postavy (register fx; Vojak: mieriaca póza + výšľah v synchróne so stredovým overlayom;
    // Countess: A5 cast pasce RAZ od frame 0) - anim.fromStart = relatívny čas od setAnim (drawT nižšie)
    anim = CHAR_FX[st.char]?.boardAnim?.({ slot, st, aSt, now, stoned, lyingDead, anim }) ?? anim;
    // počas Special_2 summon pózy orežeme prázdny bočný okraj (rovnako ako kópiu), nech sa obaja zmestia do bunky
    const poseCrop = (actors.cloneSummonPose[slot] && performance.now() < actors.cloneSummonPose[slot].until) ? SUMMON_CROP : 0;
    // anim.armCrop (Luffy Gear3 basic): odrež zapečenú natiahnutú ruku+päsť z tela (dosah kreslí procedurálna guma)
    const armCrop = anim.armCrop || 0;
    // THE WORLD: čas stojí → všetci OKREM Jotara majú zmrazený drawT (statický frame, žiadne cyklenie idle)
    const tsFrozenActor = playback.tsActive && slot !== playback.tsJotaroSlot;
    const drawT = tsFrozenActor ? playback.tsFreezeAt
                : (VAMP_ONESHOT_KEYS.has(aSt.key) || anim.fromStart) ? (now - (aSt.start || 0)) // one-shot (strike/scream/heal beaty, A5 cast, Escanorova premena a WinSunBoard, Luffyho pózy) hrá RAZ od frame 0
                : (stoned ? 0 : now);
    // register boardFit (Jotaro, Luffy - figúra cez väčšinu framu, pri fill 0.95/anchorY 0.5 „obrovská" a nohy
    // vysoko): menší fill normalizovaný na výšku framu (fh/refH, nech rôzne pásy nevyjdú rôzne veľké),
    // ukotvený na nohy (anchorY 1) na nožnú líniu mágov
    const fit = CHARS_BY_KEY[st.char]?.boardFit;
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, drawT, ACTOR_W, ACTOR_H,
        fit ? fit.fill * (meta.fh / fit.refH) : 0.95, fit ? 1 : 0.5, true, 0, fit ? fit.offY : 0, poseCrop, armCrop))
      .catch(() => ensureSpriteMeta(dir, ANIM_DEF.idle.file)
        .then(metaIdle => drawSprite(ctx, metaIdle, ANIM_DEF.idle, now, ACTOR_W, ACTOR_H))
        .catch(()=>{}));
  });

  // tieňové klony - zrkadlia animáciu majiteľa (identický vzhľad, rovnaký glow obrán = nerozoznateľné);
  // hurt/dead majiteľa klon nehrá (zásah naň ho rovno rozplynie), viditeľnosť rieši positionActors
  ["p1", "p2"].forEach(slot => {
    const el = cloneEls[slot];
    const st = state?.[slot];
    if (el.style.display === "none" || !st?.clone || !st.char) return;
    const ctx = el.getContext("2d");
    el.classList.toggle("alt-color", usesAltColor(st.char, slot));
    el.style.filter = actorFilter(slot, now, true); // klon: bez Last Stand zlatého glow
    const dir = charDirFor(st.char, slot);
    const aSt = actors.animState[slot];
    const stoned = (st.stone || 0) > 0;
    const flAt = actors.cloneFlinch[slot] || 0;
    const flinching = !stoned && flAt && (now - flAt) < 700; // tile zásah na klonovi → strhnutie (Hurt.png) ako pravý
    // THE WORLD: zmraz aj súperovho klona (všetko okrem Jotara stojí)
    let anim, animT = (playback.tsActive && slot !== playback.tsJotaroSlot) ? playback.tsFreezeAt : (stoned ? 0 : now);
    if (stoned) anim = ANIM_DEF.idle;
    // Hurt hrá od ZAČIATKU zásahu (animT = now - flAt), nie zamrznutý na poslednom frame - inak by strhnutie
    // nebolo vidno (neloopová animácia kreslená globálnym `now` uviazne na poslednom frame)
    else if (flinching) { anim = ANIM_DEF.flinch; animT = now - flAt; }
    else if (aSt.key === "victory" || aSt.key === "casting") anim = { file: SPECIAL_ANIMS[st.char].file, fps: SPECIAL_FPS, loop: true };
    else {
      anim = currentAnim(slot);
      if (actors.animState[slot].key === "hurt" || actors.animState[slot].key === "dead") anim = ANIM_DEF.idle;
    }
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, animT, ACTOR_W, ACTOR_H))
      .catch(() => {});
  });

  // ďalšie figúry postáv z registra fx (Jotarov stand Star Platinum: `_P` pás podľa Jotarovej animácie)
  fxAll("drawBoard", now);
  // summon kópia (Narutov clone_summon) - dočasný canvas na tej istej bunke hrá Special_2 tvárou v tvár
  actors.cloneSummonFx = actors.cloneSummonFx.filter(f => f.el.isConnected);
  for (const f of actors.cloneSummonFx) {
    const ctx = f.el.getContext("2d");
    ensureSpriteMeta(f.dir, ANIM_DEF.special2.file)
      .then(meta => drawSprite(ctx, meta, ANIM_DEF.special2, now, ACTOR_W, ACTOR_H, 0.95, 0.5, true, 0, 0, SUMMON_CROP))
      .catch(() => {});
  }

  // ghost KLONA - budúca pozícia vlastného klona po naplánovaných movoch (inverzná vertikála)
  {
    const ctx = cloneGhost.getContext("2d");
    const mine = state?.[me];
    const cg = simulatedClonePos();
    const show = mine && mine.char && mine.clone && !mine.locked && !playback.playing && cg &&
                 planning.myQueue.some(a => a.type === "move" || a.type === "dash") &&
                 (cg.x !== mine.clone.x || cg.y !== mine.clone.y);
    if (!show) {
      ctx.clearRect(0, 0, cloneGhost.width, cloneGhost.height);
      cloneGhost.style.display = "none";
    } else {
      cloneGhost.style.display = "block";
      const { left, top } = cellToPx(cg.x, cg.y);
      cloneGhost.style.left = (left - (ACTOR_W - TILE_W) / 2) + "px";
      cloneGhost.style.top  = (top - (ACTOR_H - TILE_H)) + "px";
      cloneGhost.style.transform = `scaleX(${computeFacing(state.p1, state.p2)[me]})`;
      cloneGhost.classList.toggle("alt-color", usesAltColor(mine.char, me));
      const dir = charDirFor(mine.char, me);
      ensureSpriteMeta(dir, ANIM_DEF.idle.file)
        .then(meta => drawSprite(ctx, meta, ANIM_DEF.idle, now, ACTOR_W, ACTOR_H))
        .catch(() => {});
    }
  }

  // ghost vlastnej pozície po naplánovaných movoch (len počas plánovania)
  {
    const ctx = actorGhost.getContext("2d");
    const mine = state?.[me];
    const gp = ghostPos();
    const show = mine && mine.char && !mine.locked && !playback.playing && gp &&
                 planning.myQueue.some(a => a.type === "move" || a.type === "dash" || a.type === "special") && // special: vlkolakov charge; dash: aj charge Vampire/Onryō
                 (gp.x !== mine.x || gp.y !== mine.y);
    if (!show) {
      ctx.clearRect(0, 0, actorGhost.width, actorGhost.height);
      actorGhost.style.display = "none";
    } else {
      actorGhost.style.display = "block";
      const { left, top } = cellToPx(gp.x, gp.y);
      actorGhost.style.left = (left - (ACTOR_W - TILE_W) / 2) + "px";
      actorGhost.style.top  = (top - (ACTOR_H - TILE_H)) + "px";
      const ghostChar = ghostCharAt() || mine.char;
      // rovnaký flip ako hráčov sprite; Escanor sa škáluje podľa pride (od pät) rovnako ako živá postava
      const gFace = computeFacing(state.p1, state.p2)[me];
      const gPride = escPrideMul({ char: ghostChar, pride: mine.pride, moon: mine.moon });
      if (gPride !== 1) { actorGhost.style.transformOrigin = `50% ${ESC_FEET_FRAC * 100}%`; actorGhost.style.transform = `scaleX(${gFace * gPride}) scaleY(${gPride})`; }
      else { actorGhost.style.transformOrigin = ""; actorGhost.style.transform = `scaleX(${gFace})`; }
      actorGhost.classList.toggle("alt-color", usesAltColor(ghostChar, me));
      const dir = charDirFor(ghostChar, me);
      // boardFit ghost (Jotaro/Luffy) menší + ukotvený na nohy ako na boarde (rovnaká normalizácia veľkosti)
      const gFit = CHARS_BY_KEY[ghostChar]?.boardFit;
      ensureSpriteMeta(dir, ANIM_DEF.idle.file)
        .then(meta => drawSprite(ctx, meta, ANIM_DEF.idle, now, ACTOR_W, ACTOR_H,
          gFit ? gFit.fill * (meta.fh / gFit.refH) : 0.95, gFit ? 1 : 0.5, true, 0, gFit ? gFit.offY : 0))
        .catch(() => {});
    }
  }

  // labyrint: obrys súpera. Keď lovec (alebo jeho tieňový klon) PRÁVE stojí na niektorej mojej fakľovej
  // bunke (server pole hunterHere - moja bunka + bunka môjho klona), ukáž tam každú jeho figúru OŽIARENÚ
  // a správajúcu sa ako mimo labyrintu: normálny pairShift rozostup, tvárou ku mne, živý idle. Inak čierna
  // statická silueta na bunke posledného stretnutia s niťou (threadMark), ako doteraz.
  {
    const mine = me ? state?.[me] : null;
    const oppS = otherSlot();
    const oppA = oppS ? state?.[oppS] : null;
    const oppChar = oppA?.char || null;
    const inLab = !!mine?.labyrinth;
    const litCells = (inLab && oppChar && Array.isArray(mine.hunterHere)) ? mine.hunterHere : [];
    // figúry na vykreslenie: ožiarení lovci (lit) majú prednosť; bez nich breadcrumb (čierny tieň) na threadMark
    const figs = litCells.length ? litCells.map(c => ({ cell: c, lit: true }))
      : (inLab && oppChar && mine.threadMark ? [{ cell: mine.threadMark, lit: false }] : []);
    const oppMag = PAIR_SHIFT[oppChar] ?? PAIR_SHIFT_DEFAULT;
    const prideMul = escPrideMul(oppA); // Escanorovo pride / vlkolakov mesiac sú verejné aj v labyrinte
    actorSilhouettes.forEach((el, i) => {
      const ctx = el.getContext("2d");
      const fig = figs[i];
      // lit = lovec na fakľovej bunke → CSS zruší brightness(0); p2 albino paleta cez alt-color (natívne palety to ignorujú)
      el.classList.toggle("lit", !!(fig && fig.lit));
      el.classList.toggle("alt-color", !!(fig && fig.lit) && !!oppChar && usesAltColor(oppChar, oppS));
      if (!fig) {
        // decentne sa STRATÍ v hmle (opacity fade-out cez CSS transition); display necháme block, nech fade dobehne
        el.style.opacity = "0";
        ctx.clearRect(0, 0, el.width, el.height);
        return;
      }
      el.style.opacity = "1"; // vynorí sa/ostane (fade-in + lit↔čierny cez CSS transition)
      const { left, top } = cellToPx(fig.cell[0], fig.cell[1]);
      el.style.left = (left - (ACTOR_W - TILE_W) / 2) + "px";
      el.style.top  = (top - (ACTOR_H - TILE_H)) + "px";
      // zdieľa bunku s mojou figúrou → odstúp na súperovu stranu ako pairShift (moja figúra odstúpi cez
      // pairShift/foeShift sama); druhá lovcova figúra na TEJ ISTEJ bunke = jeho klon stacknutý na
      // majiteľovi → + STACK_OFFSET posun ako klon v positionActors
      const onMine = (mine.x === fig.cell[0] && mine.y === fig.cell[1])
        || (mine.clone && mine.clone.x === fig.cell[0] && mine.clone.y === fig.cell[1]);
      let shift = onMine ? (oppS === "p1" ? -oppMag : oppMag) : 0;
      if (i === 1 && figs[0] && figs[0].cell[0] === fig.cell[0] && figs[0].cell[1] === fig.cell[1]) shift += 18;
      if (fig.lit) {
        // ožiarený lovec = plnohodnotná figúra: facing ako na zdieľanej bunke (p1 doprava, p2 doľava) + level veľkosť
        el.style.transformOrigin = prideMul !== 1 ? `50% ${ESC_FEET_FRAC * 100}%` : "";
        el.style.transform = `translateX(${shift}px) scaleX(${(oppS === "p2" ? -1 : 1) * prideMul}) scaleY(${prideMul})`;
      } else {
        el.style.transformOrigin = "";
        el.style.transform = shift ? `translateX(${shift}px)` : "";
      }
      // lit → animuj NORMÁLNE (idle loop, t=now); čierny breadcrumb = statická póza (t=0)
      const t = fig.lit ? now : 0;
      ensureSpriteMeta(charDirFor(oppChar, oppS), ANIM_DEF.idle.file)
        .then(meta => drawSprite(ctx, meta, ANIM_DEF.idle, t, ACTOR_W, ACTOR_H))
        .catch(() => {});
    });
  }

  // HUD náhľady vybraných postáv + degradácia portrétu podľa HP (Doom-style)
  [["p1", hudCharP1, hudBoxP1], ["p2", hudCharP2, hudBoxP2]].forEach(([slot, cvs, box]) => {
    const st  = state?.[slot];
    const ctx = cvs.getContext("2d");
    if (!st || !st.char) {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      cvs.classList.remove("wounded", "critical", "dead");
      box.classList.remove("in-maze");
      return;
    }
    // labyrint: CELÝ súperov widget prekrýva bludisko (assets/minotaur/labyrint.png cez CSS .in-maze) -
    // blúdiaci (labyrinth) aj skrytý Minotaur (x null): obaja si navzájom vidia len bludisko.
    // labReveal (istý zásah v tomto ťahu) widget odkryje ešte pred animáciou akcie - HP/mana sú späť.
    const inMaze = slot !== me && ((st.labyrinth && !st.labReveal) || st.x == null);
    box.classList.toggle("in-maze", inMaze);
    if (inMaze) {
      cvs.classList.remove("wounded", "critical", "dead", "stoned", "alt-color");
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      return;
    }
    const hp = st.hp ?? 10;
    cvs.classList.toggle("wounded",  hp > 3 && hp <= 6);
    cvs.classList.toggle("critical", hp > 0 && hp <= 3);
    cvs.classList.toggle("dead",     hp <= 0);
    cvs.classList.toggle("alt-color", usesAltColor(st.char, slot)); // Medúza p2 = natívna paleta
    // skamenený: portrét zamrzne na fixnom idle frame + sivý filter (CSS .stoned)
    const stonedHud = (st.stone || 0) > 0 && hp > 0;
    cvs.classList.toggle("stoned", stonedHud);

    // mŕtvy: prehraj Dead raz od momentu úmrtia a zamrzni na poslednom frame
    const dir = charDirFor(st.char, slot);
    // THE WORLD: zmraz aj súperov HUD portrét (čas stojí - všetko okrem Jotara zamrzne)
    const tsFrozenHud = playback.tsActive && slot !== playback.tsJotaroSlot;
    let anim = ANIM_DEF.idle, t = tsFrozenHud ? playback.tsFreezeAt : (stonedHud ? 0 : now);
    if (hp <= 0) {
      if (!actors.hudDeadSince[slot]) actors.hudDeadSince[slot] = now;
      anim = ANIM_DEF.dead;
      t = now - actors.hudDeadSince[slot];
    } else {
      actors.hudDeadSince[slot] = 0;
    }
    // Medúza/Minotaur normalizovaní na výšku mágov (PORTRAIT_SCALE) + ukotvení k spodku,
    // aby stáli na rovnakej línii ako mágovia (centrovanie by menšiu postavu nechalo plávať)
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, t, cvs.width, cvs.height,
        portraitFill(st.char, 0.95), PORTRAIT_SCALE[st.char] ? 0.92 : 0.5))
      .catch(() => {});
  });

  // projectiles (plynulé perzistentné elementy v #actors)
  [...PROJECTILES].forEach(cvs => {
    if (cvs.tagName !== "CANVAS") return;
    const ctx = cvs.getContext("2d");
    const dir = cvs.dataset.dir;
    ensureSpriteMeta(dir, CHARGE_ANIM.file)
      .then(meta => drawSprite(ctx, meta, CHARGE_ANIM, now, cvs.width, cvs.height))
      .catch(() => {});
  });

  // HUD hlavy magov + swap badge hlavy - animovaný výrez hlavy z idle spritu
  [...MAGE_HEADS].forEach(cvs => { if (cvs.tagName === "CANVAS" && cvs.dataset.char) drawMageHeadAnim(cvs, cvs.dataset.char, now); });

  // specials v strede
  [...SPECIAL_CENTERS].forEach(cvs => {
    if (cvs.tagName !== "CANVAS") return;
    const ctx  = cvs.getContext("2d");
    const dir  = cvs.dataset.dir;
    const file = cvs.dataset.file;
    // choreografia postavy (register fx) - napr. Vojakova mieriaca póza + výšľah
    if (CHAR_FX[cvs.dataset.fxChar]?.drawCenter?.(cvs, ctx, now)) return;
    // one-shot (Countess A-sheety): frame index od vzniku canvasu, drawSprite clampne na posledný frame
    if (cvs.dataset.once) {
      const fps = Number(cvs.dataset.fps) || SPECIAL_FPS;
      const idx = Math.floor((now - Number(cvs.dataset.born)) / 1000 * fps);
      ensureSpriteMeta(dir, file)
        .then(meta => drawSprite(ctx, meta, { file, fps, frameIndex: idx }, 0, cvs.width, cvs.height))
        .catch(()=>{});
      return;
    }
    const anim = { file, fps: Number(cvs.dataset.fps) || SPECIAL_FPS, loop: true };
    ensureSpriteMeta(dir, file)
      .then(meta => drawSprite(ctx, meta, anim, performance.now(), cvs.width, cvs.height))
      .catch(()=>{});
  });

  // nabíjacie aury (golden Last Stand / červená Last Hope / bežný recharge) plynulo sledujú postavu počas pohybu
  [...CHARGE_AURAS].forEach(cont => { if (cont.dataset.slot) placeChargeAura(cont, cont.dataset.slot); });

  // Last Stand - trvalý golden stav riadený serverom (state[slot].lastStandBuff):
  // žiara postavy (actorFilter) + zlatý HUD + recharge aura + priehľadný démon za postavou
  {
    const buffSlot = state?.p1?.lastStandBuff ? "p1" : state?.p2?.lastStandBuff ? "p2" : null;
    if (buffSlot) {
      lastStand.realActive = true;
      // zlatý stav: buff zo servera sa zapne presne vo fáze „revive" (po smrti); počas banishu VYPNUTÝ
      const goldOn = !lastStand.banishing;
      lastStand.goldenSlot = goldOn ? buffSlot : null;
      hudBoxP1.classList.toggle("death-golden", goldOn && buffSlot === "p1");
      hudBoxP2.classList.toggle("death-golden", goldOn && buffSlot === "p2");
      if (goldOn && now - lastStand.auraAt > 950) { spawnChargeAura(buffSlot, true); lastStand.auraAt = now; } // permanentná golden recharge
      // démon sa drží za postavou na 0.25 - naviazaný na ŽIVÚ (interpolovanú) pozíciu sprite-u postavy,
      // takže sa kĺže spolu s ňou (nie teleport). Drží sa keď postava STOJÍ (server flag !st.down) - počas
      // summon/banish prechodov (st.down=true, resp. lastStand.banishing) ho riadia efekty. State-driven = robustné.
      const tgt = state[buffSlot];
      // labyrint: skrytý buffnutý hráč (x null) - priehľadný démon za postavou sa skryje,
      // nemá ho kam sledovať (inak by ostal svietiť na starej/rohovej pozícii a prezradil buff)
      if (tgt && tgt.x == null) {
        deathBehind.style.opacity = "0";
      } else if (lastStand.banishing && tgt && tgt.down) {
        // po banish kille hráč leží mŕtvy - démon za postavou nemá za kým visieť; stavová poistka
        // drží nulu každý tick (fill-forwards animácia banishu mohla racenúť so state updatom).
        // Summon choreografiu (down=true, lastStand.banishing=false) sa toto nedotýka - revive riadi efekt.
        deathBehind.style.opacity = "0";
      } else if (!lastStand.banishing && tgt && tgt.char && !tgt.down) {
        // pozícia sleduje postavu per-frame (bez transition); opacity 0.25 dotiahne CSS transition plynulo (z 1 po settle)
        const actorEl = buffSlot === "p1" ? actorP1 : actorP2;
        const aLeft = parseFloat(getComputedStyle(actorEl).left) || 0; // počas pohybu = interpolovaná hodnota (CSS transition)
        const aTop  = parseFloat(getComputedStyle(actorEl).top)  || 0;
        const facing = computeFacing(state.p1, state.p2);
        const headDx = (facing[buffSlot] || 1) * ACTOR_W * ((HEAD_CX[tgt.char] ?? 0.5) - 0.5);
        const shift = pairShift(buffSlot); // aktér nesie shift v transforme, nie v left
        deathBehind.style.left = (aLeft + shift + headDx + DEATH_SEQ.behindOffsetX) + "px";
        deathBehind.style.top  = (aTop + DEATH_SEQ.behindOffsetY) + "px";
        deathBehind.style.transform = `scale(${DEATH_SEQ.behindRatio})`;
        deathBehind.style.opacity = String(DEATH_SEQ.behindOpacity);
      }
    } else if (lastStand.realActive) {
      // koniec buffnutého stavu (smrť/výhra) - uprac
      lastStand.realActive = false; lastStand.banishing = false; lastStand.goldenSlot = null;
      hudBoxP1.classList.remove("death-golden");
      hudBoxP2.classList.remove("death-golden");
      deathBehind.getAnimations().forEach(a => a.cancel());
      deathBehind.style.opacity = "0";
      hideDeathCenter();
    }
  }

  // DEATH summon - framy do oboch canvasov: stredový overlay (fill 1.0) + „za postavou" (ako postava: ACTOR rozmer)
  ensureSpriteMeta(DEATH_DIR, DEATH_ANIM.file).then(meta => {
    drawSprite(deathCenter.getContext("2d"), meta, DEATH_ANIM, now, deathCenter.width, deathCenter.height, 1.0);
    drawSprite(deathBehind.getContext("2d"), meta, DEATH_ANIM, now, ACTOR_W, ACTOR_H);
  }).catch(()=>{});

  // Last Hope - trvalý červený ultra mód (state[slot].lastHopeBuff): pulzujúci červený mana bar + periodická červená aura
  {
    const hopeSlot = state?.p1?.lastHopeBuff ? "p1" : state?.p2?.lastHopeBuff ? "p2" : null;
    hudBoxP1.classList.toggle("hope-red", hopeSlot === "p1");
    hudBoxP2.classList.toggle("hope-red", hopeSlot === "p2");
    if (hopeSlot) {
      lastStand.hopeActive = true;
      const tgt = state[hopeSlot];
      if (tgt && tgt.char && !tgt.down && now - lastStand.hopeAuraAt > 950) { spawnChargeAura(hopeSlot, false, true); lastStand.hopeAuraAt = now; }
    } else if (lastStand.hopeActive) {
      lastStand.hopeActive = false;
      hudBoxP1.classList.remove("hope-red");
      hudBoxP2.classList.remove("hope-red");
      hideHopeCenter();
    }
  }

  // Last Hope summon - hope sprite do stredového overlay (viditeľnosť riadi opacity cez hopeCenterAppear/Disappear)
  ensureSpriteMeta(HOPE_DIR, HOPE_ANIM.file).then(meta => {
    drawSprite(hopeCenter.getContext("2d"), meta, HOPE_ANIM, now, hopeCenter.width, hopeCenter.height, 1.0);
  }).catch(()=>{});

  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);
