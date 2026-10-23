// public/chars/fx/jotaro.js - klientská choreografia Jotara: stand Star Platinum (druhý canvas vedľa Jotara -
// summon intro, `_P` pás podľa Jotarovej animácie, výmena pozícií pri útoku, blip pri pohybe, Dead_P pri smrti)
// a stredový PÁR (telo + stand) pri melee / Special 2. THE WORLD (pauza, menace v strede) je mechanika enginu
// a ostáva v client.js. Továreň dostane C = klientský scope (client.js), háčiky: public/chars/fx/index.js.
import jotaro from "../jotaro.js";

// Star Platinum `_P` pásy (a Jotarove telo) majú v ÚTOČNÝCH pózach figúru zámerne posunutú tak, aby BBOX
// ostal centrovaný (napr. pri údere päsť vyletí bokom a telo/nohy sú odtlačené na druhú stranu). Keby sme
// kreslili centrované na frame, NOHY by pri animácii uskakovali zľava doprava a hore-dole. Preto ukotvujeme
// figúru za NOHY: pre každý frame držíme x-offset ťažiska nôh (od stredu framu) a botGap (medzera pod nohami).
// Namerané cez pngjs (bottom ~12 riadkov figúry). x/g sú polia per frame.
const STAND_FEET = {
  "Idle_P.png": { x:[-1,1,1,1], g:[8,8,8,8] },
  "Run_P.png": { x:[-46,-45,-45,-45], g:[13,13,12,13] },
  "Attack_1_P.png": { x:[-1,1,1,1], g:[8,8,8,8] },
  "Attack_2_P.png": { x:[9,-68,-62,-70,-71,-68], g:[57,40,40,40,40,40] },
  "Special_1_P.png": { x:[22,-62,-61,-66,-71,-75], g:[32,40,40,40,34,25] },
  "Special_2_P.png": { x:[-26,-72,-72,-3,-61,-19,-20,-65,-48,-17], g:[35,43,43,40,46,37,33,46,44,37] },
  "Special_3_P.png": { x:[32,44,20,6], g:[8,8,8,8] },
  "Dead_P.png": { x:[-1,-1,-1,1,2,1], g:[8,8,8,8,8,8] },
  "Summon_P.png": { x:[1,4,-1,-1,-1], g:[8,8,8,8,8] },
  // Jotarove telo v stredovom páre
  "Attack_1.png": { x:[5,4,-10,-9,-5], g:[8,8,8,8,8] },
  "Attack_2.png": { x:[1,4,7,7,7,7], g:[8,8,8,8,8,8] },
};
// nohy daného framu (fallback pre neznámy pás = stred, botGap 8)
function standFeet(file, idx) {
  const t = STAND_FEET[file];
  if (!t) return { x: 0, g: 8 };
  const i = Math.max(0, Math.min(t.g.length - 1, idx | 0));
  return { x: t.x[i] ?? 0, g: t.g[i] ?? 8 };
}
const { fill: BOARD_FILL, refH: FRAME_REF_H } = jotaro.boardFit; // stand zdieľa Jotarovu normalizáciu veľkosti
const STAND_FLOAT_Y = -34; // stand posunutý hore (vznáša sa nad/za Jotarom) - aplikované v transforme (kvôli plynulému swapu)
const CENTER_GAP = 0.13;   // horizontálny rozostup Jotara a SP v stredovom páre (zlomok veľkosti overlayu) - dolaď podľa vzhľadu
const CENTER_FILL = 0.62;  // veľkosť figúr v stredovom páre (menšie než sólo overlay, lebo sú dve) - tunable
// stredový pár: nohy OBOCH figúr zladené na spoločnú líniu = stred canvasu + INSET·výška, per-frame
// stabilizované (kompenzácia botGap), aby SP „nelietal" nad Jotarom a nešklbal sa. INSET posúva líniu nôh NADOL.
// 0.475 = presne úroveň nôh Fire Wizarda v jeho stredovom overlayi (Attack_2/idle majú botGap 0 → nohy na spodku
// framu; fire feet = 0.95·(0.5−0)·výška). Tak Jotarove nohy sedia rovnako ako fireove. Tunable.
const CENTER_INSET = 0.475;
const SP_DEAD_MS = Math.round(6 * 1000 / 12); // Dead_P má 6 framov @ 12 fps (≈500ms) - po dohraní stand skryjeme
const STAND_OFFSET = 64;                       // horizontálny posun standu za Jotarom (na jeho chrbtovej strane) - vznáša sa ďalej
const SP_SUMMON_MS = Math.round(5 * 1000 / 6); // Summon_P má 5 framov @ 6 fps
const SP_BLIP_DEAD_MS = 500;                   // fáza 1 (Dead_P) na starej bunke
const SP_BLIP_SUMMON_MS = 650;                 // fáza 2 (Summon_P) na novej bunke (spolu < MOVE_DELAY_MS ≈ 1440)

export default function jotaroFx(C) {
  // Konštantná škála na obraze (px na obraze / px zdroja) po normalizácii fill × fh/REF - nezávislá od framu.
  let SCALE = 1;

  // stand - druhý canvas vedľa Jotara (vzor cloneEls); kreslí `_P` pás zodpovedajúci aktuálnej animácii Jotara.
  // Stály (viditeľný pri Jotarovi), summon intro pri nasadení, Dead_P pri smrti. Vzniká v init (rozmery actora).
  const standEls = { p1: null, p2: null };
  function init() {
    SCALE = Math.min(C.ACTOR_W, C.ACTOR_H) / FRAME_REF_H * BOARD_FILL;
    for (const slot of ["p1", "p2"]) {
      const c = document.createElement("canvas");
      c.id = "actor-stand-" + slot;
      c.className = "sprite-actor sprite-stand";
      c.width = C.ACTOR_W; c.height = C.ACTOR_H;
      c.style.width = C.ACTOR_W + "px"; c.style.height = C.ACTOR_H + "px";
      c.style.display = "none";
      C.actorsEl.appendChild(c);
      standEls[slot] = c;
    }
  }
  let standSummoned, standHiddenByWorld, standSummonStart, standDeadStart, standPrevChar, standAttack, standBlip, curAction;
  function resetState() {
    standSummoned = { p1: false, p2: false };      // stand už odohral summon intro (Summon_P) pri tomto nasadení
    standHiddenByWorld = { p1: false, p2: false }; // board-standa skryla veľká THE WORLD menace → raf ho po jej zmiznutí vráti
    standSummonStart = { p1: 0, p2: 0 };           // čas štartu summonu (Summon_P sa kreslí relatívnym časom, RAZ)
    standDeadStart = { p1: 0, p2: 0 };             // čas štartu smrti (Dead_P sa prehrá RAZ, potom stand zmizne - nie loop)
    standPrevChar = { p1: null, p2: null };        // detekcia (re)nasadenia Jotara → reset summonu
    // útočná choreografia: pri melee / Special 1 / Special 2 stand hrá svoj útočný `_P` pás a s Jotarom si
    // VYMENIA pozície - stand zíde dole na Jotarovu úroveň (zo vznášania) a dopredu, Jotaro cúvne dozadu na
    // miesto, kde stál stand (obaja na zemi). Aktívne, kým `now < until`.
    standAttack = { p1: null, p2: null };          // { file, until } - útočný pás standu + výmena pozícií
    // lokomócia standu: dash = beh za Jotarom (Run_P), move = zmizne (Dead_P) a zjaví sa (Summon_P) na novej bunke
    standBlip = { p1: null, p2: null };            // { start, ox, oy } - prebiehajúci „zmizni→zjav sa" pri MOVE
    curAction = { p1: null, p2: null };            // aktuálne ohlásená akcia (z `action` efektu) - rozlíši move/dash
  }
  resetState();
  const standSwapActive = (slot) => !!(standAttack[slot] && performance.now() < standAttack[slot].until);
  // herná animácia Jotara (animState.key) → zodpovedajúci `_P` pás standu (mimo útoku/blipu - tie rieši raf)
  function standFileFor(slot) {
    const st = C.state?.[slot];
    if ((st?.hp ?? 1) <= 0 || st?.down) return "Dead_P.png"; // smrť → unsummon póza
    // POZN.: stand pri Jotarovi sa počas THE WORLD NEmení (menace Special_3_P je len v strede plochy)
    switch (C.animState[slot]?.key) {
      case "run":     return "Run_P.png";       // dash = beh za Jotarom (move rieši blip mimo tejto funkcie)
      case "attack":  return "Attack_1_P.png";  // basic strela
      case "victory": return "Special_2_P.png"; // výhra: Jotaro idle, stand hrá Special 2 (odomknutý po THE WORLD)
      default:        return "Idle_P.png";      // idle/hurt (Hurt_P neexistuje)/stoned
    }
  }
  // figúra hrá Attack_2, stand svoj útočný pás, VYMENIA si pozície (swap)
  function standStrike(slot, file, frameHold) {
    standAttack[slot] = { file, until: performance.now() + frameHold + C.POSE_TAIL_MS };
  }

  // stredový PÁR: telo (Attack_2) + stand (spFile), rozmiestnené ako na doske (SP dopredu k súperovi,
  // Jotaro dozadu), nohy zarovnané. Totálne analogicky k jednosprite overlayu iných postáv.
  function spawnCenter(sp, facing) {
    const dirKey = C.charDirFor("jotaro", sp.from);
    const flip = C.currentFacing(sp.from, facing);
    const px = Math.round(C.TILE_H * C.SPECIAL_SCALE);
    const gap = Math.round(px * CENTER_GAP);
    const fc = flip; // smer útoku (Special 2 aj dozadu od súpera) - stand ide dopredu v smere úderu
    const mk = (file, jfig, dx, z) => {
      const cvs = document.createElement("canvas");
      // canvas ŠIROKÝ (2×), aby sa pri ukotvení na nohy vešla vyletená päsť bez orezania (výška určuje škálu = min)
      cvs.width = px * 2; cvs.height = px;
      cvs.className = "special-center";
      cvs.dataset.dir = dirKey; cvs.dataset.file = file; cvs.dataset.fps = "8"; cvs.dataset.jfig = jfig;
      cvs.dataset.fxChar = "jotaro";
      cvs.style.left = `calc(50% + ${dx}px)`;
      cvs.style.top  = "50%";
      cvs.style.zIndex = String(z);
      cvs.style.transform = `translate(-50%, -50%) scaleX(${flip})`; // centrované ROVNAKO ako overlaye iných postáv
      C.actorsEl.appendChild(cvs);
    };
    mk("Attack_2.png", "body", -fc * gap, 6);       // Jotaro dozadu (opačne než smeruje)
    mk(sp.spFile, "stand", fc * gap, 7);            // Star Platinum dopredu (k súperovi), nad telom
    return true;
  }
  // pár (telo/stand): normalizovaný fill (fh/REF) + nohy ukotvené so zarovnaním cez botGap - nohy oboch
  // figúr sedia na tej istej základni (rovnako ako na doske)
  function drawCenter(cvs, ctx) {
    if (!cvs.dataset.jfig) return false;
    const file = cvs.dataset.file;
    const anim = { file, fps: Number(cvs.dataset.fps) || 8, loop: true };
    const t = performance.now();
    C.ensureSpriteMeta(cvs.dataset.dir, file)
      .then(meta => {
        const fill = CENTER_FILL * (meta.fh / FRAME_REF_H);
        const scale = Math.min(cvs.width, cvs.height) / meta.fh * fill; // px na obraze / px zdroja (výška určuje škálu)
        const idx = C.spriteFrameIndex(anim, t, meta.frames);
        const { x: fxo, g: botGap } = standFeet(file, idx);
        // nohy oboch figúr zladené na spoločnú líniu (canvas-stred + INSET), per-frame stabilizované cez botGap
        // (SP už „nelieta" nad Jotarom a nešklbe sa); horizontálne staticky (offX = -feetX), nech sa pri
        // vyletení päste figúra nešmýka zľava-doprava. anchorY 0.5.
        const offX = -fxo * scale;
        const offY = cvs.height * CENTER_INSET - (meta.fh / 2 - botGap) * scale;
        C.drawSprite(ctx, meta, anim, t, cvs.width, cvs.height, fill, 0.5, true, offX, offY);
      })
      .catch(()=>{});
    return true;
  }

  return {
    init,
    // stredový overlay melee / specialu / Special 1 rieši tento modul (Special 1 ZÁMERNE bez stredu;
    // THE WORLD má vlastný menace) - generický stred ani `casting` póza sa nepoužijú
    ownCenter: ["melee", "special", "special1"],
    centerCast(e) {
      if (e.kind === "melee") return { from: e.from, pair: true, spFile: "Attack_2_P.png" };
      // Special 2 (po THE WORLD); THE WORLD sám je timestop_start (menace), nie special
      if (e.kind === "special") return { from: e.from, pair: true, spFile: "Special_2_P.png" };
      return null;
    },
    spawnCenter: (sp, facing) => sp.pair ? spawnCenter(sp, facing) : false,
    drawCenter,

    effect(e, frameHold) {
      if (e.from !== "p1" && e.from !== "p2") return;
      // zapamätaj typ akcie (stand rozlišuje move → blip vs dash → beh za Jotarom)
      if (e.kind === "action") curAction[e.from] = e.action?.type || null;
      // Special 2 (po THE WORLD): figúra hrá Attack_2, stand Special_2_P, VYMENIA si pozície (swap)
      if (e.kind === "special") {
        C.setAnim(e.from, "attack2_loop", frameHold);
        standStrike(e.from, "Special_2_P.png", frameHold);
        C.lastAttackEndAt[e.from] = performance.now() + frameHold;
      }
      // Special 1 (mirror slot): figúra hrá Attack_2, stand Special_1_P, VYMENIA si pozície; otočenie podľa smeru
      if (e.kind === "special1") {
        C.setAnim(e.from, "attack2_loop", frameHold);
        standStrike(e.from, "Special_1_P.png", frameHold);
        C.lastAttackEndAt[e.from] = performance.now() + frameHold;
        if (e.dir === "left" || e.dir === "right") C.facingOverride[e.from] = { sx: e.dir === "left" ? -1 : 1, until: performance.now() + frameHold + C.POSE_TAIL_MS };
      }
      // melee: figúra hrá Attack_2 (generická melee póza), stand Attack_2_P, VYMENIA si pozície (swap)
      if (e.kind === "melee") standStrike(e.from, "Attack_2_P.png", frameHold);
    },

    // stand pri pohybe: dash = beh za Jotarom (Run_P), MOVE = zmizne (Dead_P) na starej bunke a zjaví sa
    // (Summon_P) na novej. Blip len pri skutočnom posune (nie klon).
    moved(slot, before, frm) {
      if (before?.x == null) return;
      if (curAction[slot] === "dash") { standBlip[slot] = null; return; } // dash → Run_P (rieši standFileFor)
      if (before.x !== frm.x || before.y !== frm.y) standBlip[slot] = { start: performance.now(), ox: before.x, oy: before.y };
    },

    // Jotaro pri útoku (melee/S1/S2): cúvne DOZADU na miesto, kde stál stand (o STAND_OFFSET opačne než smeruje)
    bodyShift: (slot, fc) => standSwapActive(slot) ? -fc * STAND_OFFSET : 0,

    // stand - vždy vedľa Jotara (na jeho chrbtovej strane, o STAND_OFFSET), zrkadlený podľa facingu;
    // pozíciu drží so slideom ako actor. Kreslenie (aktuálny `_P` pás / summon / dead) rieši drawBoard.
    position({ s, facing, snap }) {
      for (const slot of ["p1", "p2"]) {
        const el = standEls[slot], data = s?.[slot];
        if (!data || data.char !== "jotaro" || data.x == null) { el.style.display = "none"; continue; }
        const wasHidden = el.style.display === "none";
        el.style.display = "block";
        // MOVE-blip: pozíciu aj pás standu (snap starú→novú bunku + Dead_P→Summon_P) plne riadi raf - sem nezasahuj
        if (standBlip[slot]) continue;
        const { left, top } = C.cellToPx(data.x, data.y);
        const px = left - (C.ACTOR_W - C.TILE_W) / 2;
        const py = top  - (C.ACTOR_H - C.TILE_H);
        if (snap || wasHidden) {
          el.style.transition = "none"; el.style.left = px + "px"; el.style.top = py + "px";
          void el.offsetHeight; el.style.transition = "";
        } else { el.style.left = px + "px"; el.style.top = py + "px"; }
        const fc = C.currentFacing(slot, facing) || 1; // pri útoku do strany smer úderu, inak k súperovi
        // Útok (melee/S1/S2): stand príde DOPREDU k Jotarovi a DOLE na zem (floatY 0), nad Jotara (z-index).
        // Inak: za Jotarom (o STAND_OFFSET) a vznáša sa hore (STAND_FLOAT_Y). Float aj swap sú v transforme,
        // aby prechod plynulo animovala CSS transition (transform 150ms).
        const swap = standSwapActive(slot);
        const shift  = C.pairShift(slot, s) - (swap ? 0 : fc * STAND_OFFSET);
        const floatY = swap ? 0 : STAND_FLOAT_Y;
        el.style.zIndex = swap ? "4" : "";
        el.style.transform = `translateX(${shift}px) translateY(${floatY}px) scaleX(${fc})`;
      }
    },

    // stand kreslí `_P` pás podľa aktuálnej animácie Jotara; summon intro RAZ pri nasadení (Summon_P,
    // relatívny čas), Dead_P pri smrti. Vždy viditeľný pri žijúcom Jotarovi.
    drawBoard(now) {
      const state = C.state;
      for (const slot of ["p1", "p2"]) {
        const el = standEls[slot];
        const st = state?.[slot];
        if (st?.char !== "jotaro" || st.x == null) continue; // nie jotaro / neprítomný → skryl ho position
        // počas THE WORLD (svieti veľká stredová menace) je Star Platinum LEN v strede → board-standa skry;
        // po EXECUTE (menace zmizne) sa znova zjaví pri Jotarovi cez summon intro (reset standSummoned).
        if (C.worldCenterShown) {
          if (el.style.display !== "none") { el.style.display = "none"; standSummoned[slot] = false; standSummonStart[slot] = 0; standHiddenByWorld[slot] = true; }
          continue;
        }
        // menace zmizla (EXECUTE / obnovenie času) → vráť standa hneď pri Jotarovi (pozícia z posledného
        // position = Jotarova bunka), znova sa prehrá summon intro (standSummoned bol resetnutý).
        // Len keď ho skryl THE WORLD; iné skrytie (deploy pred position) prenechaj position.
        if (el.style.display === "none") {
          if (standHiddenByWorld[slot]) { el.style.display = "block"; standHiddenByWorld[slot] = false; }
          else continue;
        }
        const ctx = el.getContext("2d");
        el.classList.toggle("alt-color", C.usesAltColor("jotaro", slot)); // jotaro má dirP2=jotaro → natívne, bez filtra
        const dir = C.charDirFor("jotaro", slot);
        const dead = (st.hp ?? 1) <= 0 || st.down;
        let file = null, drawT = now, loop = true, fps = 8;

        // smrť: stand sa „odsummonuje" - Dead_P sa prehrá RAZ a potom stand ZMIZNE (predtým loopoval → prebliakval).
        if (dead) {
          if (!standDeadStart[slot]) standDeadStart[slot] = now;
          const t = now - standDeadStart[slot];
          if (t >= SP_DEAD_MS) { el.style.display = "none"; continue; } // Dead_P dohral → stand je preč
          file = "Dead_P.png"; drawT = t; loop = false; fps = 12;
        } else {
          standDeadStart[slot] = 0; // Jotaro žije (napr. nová hra) → priprav sviežu smrť
        }

        // MOVE-blip: stand zmizne (Dead_P) na starej bunke a zjaví sa (Summon_P) na novej - snap (bez sklzu).
        // Pozíciu tu riadi RAF (transition none); position sa medzitým standu nedotýka (skip pri standBlip).
        const blip = standBlip[slot];
        if (!dead && blip) {
          const t = now - blip.start;
          if (t >= SP_BLIP_DEAD_MS + SP_BLIP_SUMMON_MS) {
            standBlip[slot] = null; el.style.transition = ""; // koniec blipu - pozíciu zas preberá position
          } else {
            const phase2 = t >= SP_BLIP_DEAD_MS;
            const cx = phase2 ? st.x : blip.ox, cy = phase2 ? st.y : blip.oy;
            const { left, top } = C.cellToPx(cx, cy);
            const fc = C.computeFacing(state.p1, state.p2)[slot] || 1;
            const sh = C.pairShift(slot, state) - fc * STAND_OFFSET; // pri pohybe je stand ZA Jotarom, vznáša sa
            el.style.transition = "none";
            el.style.left = (left - (C.ACTOR_W - C.TILE_W) / 2) + "px";
            el.style.top  = (top - (C.ACTOR_H - C.TILE_H)) + "px";
            el.style.zIndex = "";
            el.style.transform = `translateX(${sh}px) translateY(${STAND_FLOAT_Y}px) scaleX(${fc})`;
            file = phase2 ? "Summon_P.png" : "Dead_P.png";
            drawT = phase2 ? (t - SP_BLIP_DEAD_MS) : t;
            loop = false;
            fps = phase2 ? 8 : 12; // Summon_P 5f/650ms, Dead_P 6f/500ms - dohrajú sa RAZ v rámci svojej fázy
          }
        }
        if (!file && !dead && !standSummoned[slot]) { // summon intro (Summon_P) RAZ od nasadenia
          if (!standSummonStart[slot]) standSummonStart[slot] = now;
          const t = now - standSummonStart[slot];
          if (t >= SP_SUMMON_MS) standSummoned[slot] = true;
          else { file = "Summon_P.png"; drawT = t; loop = false; fps = 6; }
        }
        if (!file) {
          // melee/S1/S2: stand hrá svoj útočný pás (loop v rámci beatu); inak podľa animácie Jotara
          if (!dead && standSwapActive(slot)) file = standAttack[slot].file;
          else file = standFileFor(slot);
        }
        // ukotvené za NOHY (anchorY 1 + per-frame feet x/botGap) - nohy ostanú STATICKÉ počas celej animácie
        // (nešklbú sa zľava-doprava ani hore-dole, aj keď päsť vyletí bokom); fill normalizovaný podľa výšky framu.
        // vertikálny float / swap-na-zem je v CSS transforme (position / blip vyššie).
        const anim = { file, fps, loop };
        C.ensureSpriteMeta(dir, file)
          .then(meta => {
            const idx = C.spriteFrameIndex(anim, drawT, meta.frames);
            const { x: fxo, g: botGap } = standFeet(file, idx);
            const offX = -fxo * SCALE;              // vodorovné ukotvenie na nohy (nie na stred bboxu)
            const offY = 4 + (botGap - 8) * SCALE;  // zvislé ukotvenie nôh na Jotarovu základňu
            C.drawSprite(ctx, meta, anim, drawT, C.ACTOR_W, C.ACTOR_H, BOARD_FILL * (meta.fh / FRAME_REF_H), 1, true, offX, offY);
          })
          .catch(() => {});
      }
    },

    // keď sa Jotaro na slote (re)objaví (nasadenie/swap-in - nie mid-hra), prehraj summon intro standu znova
    stateChar(slot, c) {
      if (c === "jotaro" && standPrevChar[slot] !== "jotaro") { standSummoned[slot] = false; standSummonStart[slot] = 0; }
      standPrevChar[slot] = c;
    },

    resetActors() {
      for (const el of Object.values(standEls)) {
        el.getContext("2d").clearRect(0, 0, el.width, el.height);
        el.style.display = "none";
        el.style.left = "0px"; el.style.top = "0px";
        el.style.transform = "translateX(0) scaleX(1)";
        el.style.opacity = "1";
        el.style.zIndex = ""; // stand mohol byť pri swape zdvihnutý nad Jotara
        clearTimeout(el._hideT); clearTimeout(el._fadeT); el._logCell = null;
      }
      resetState();
    },
  };
}
