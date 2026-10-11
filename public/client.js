// public/client.js
// herná geometria (zóny specialov, dráhy striel, ghost simulácia) - ten istý modul používa server (engine)
import * as G from "/shared/geometry.js";
// časovanie timeline zdieľané so serverom (delayMs framov ↔ dĺžky klientskych animácií)
import { ANIM_SLOW, CHARGE_STEP_MS } from "/shared/timing.js";
// klientský register postáv (public/chars/<key>.js) - dáta postáv: meno/priečinky, animácie, aliasy súborov,
// výrezy hláv, odstupy, teleport, náhľady vo výbere (význam polí: public/chars/index.js)
import {
  CHAR_META, SIDE_CHARS, VAMP_CHARS, SPECIAL_ANIMS, PORTRAIT_SCALE, HEAD_CX, HEAD_TOP, PAIR_SHIFT, TELEPORT_DIR,
  TELEPORT_COUNT, TELEPORT_FX, CHAR_BUTTONS, CHAR_LIST, CHARS_BY_KEY, SIZE_LEVEL, ACTION_ANIMS, PROJECTILE,
} from "/chars/index.js";
import { SPECIAL_FPS } from "/chars/common.js";
// UI moduly klienta (public/client/*)
import { socket, hideRooms } from "/client/net.js";
import { playback } from "/client/playback.js";
import { planning, buttonUi } from "/client/planning.js";
import { CHAR_FX, initCharFx, fxAll, fxOwnsCenter, clearCharOverlays } from "/client/fx-registry.js";
import {
  gridEl, actorsEl, actorP1, actorP2, queueEl, undoBtn, lockBtn, selEl, arenaEl, hudTurn, hudBoxP1, hudBoxP2,
  hudP1Hp, hudP1Mana, hudP2Hp, hudP2Mana, hudCharP1, hudCharP2, flagP1, flagP2, goOverlay, lobbyEl, lobbyWaitEl,
  hostWaitEl, intermissionEl, crownsP1El, crownsP2El, turnTimerEl, roundBannerEl, turnStatusEl, teamWaitEl,
  moveBtn, dirPicker, attackBtn, aimPicker, dashBtn, dashPicker, specialBtn, specialPicker, cellPicker,
  wolfPicker, aimPickerDiag, mirrorBtn, s1Picker, meleeBtn, rechargeBtn, goldenBtn, goldDualBtn, gmCostEl,
  demonBtn, lastHopeBtn, connErrorEl, colorRollEl, crArrowEl, crResultEl, TILE_W, TILE_H, GAP, cellToPx,
} from "/client/dom.js";
import {
  ACTOR_W, ACTOR_H, spriteFrameIndex, CHARGE_SCALE, CHARGE_ANIM, SPECIAL_SCALE, portraitFill, charDirFor,
  usesAltColor, ANIM_DEF, VAMP_ONESHOT_KEYS, ensureSpriteMeta, drawSprite,
} from "/client/sprites.js";
import { me, isHost, isSpectator, board, state, otherSlot, setIdentity, setSpectator, setState } from "/client/session.js";
import { pixSvg, miniPix, tileSvg, hydratePix, pixelizeEmoji, LS_BADGE_IMG, LH_BADGE_IMG } from "/client/pix.js";
import { renderArenaLayers } from "/client/arena-bg.js";
import { showLobby } from "/client/lobby.js";
import { showIntermission } from "/client/intermission.js";
import { mageHeadHtml, drawMageHeadAnim } from "/client/mage-head.js";
import { spawnExplosionAt } from "/client/explosion.js";
import { renderTrapMarkers, renderThreadLines } from "/client/trap-markers.js";
import { cellsForSpecialPreview, cellsForJotaroS1, cellsForMeleePreview, cellsForVampChargePreview, cellsForDemonPreview, WOLF_DIRS_CLIENT } from "/client/zones.js";
import { ARROW_DIR, displayDir, appendActionLog, clearActionLogs } from "/client/action-log.js";
import { ghostPos, simulatedClonePos, ghostCharAt, foeMirrorImmune, MIRROR_IMMUNE_WARN, planWarnings, cellsForAimPreview, showPreviewCells, clearPreviewCells } from "/client/ghost.js";
import { actorGhost, actorSilhouettes, spawnSilhouetteFlash, cloneEls, cloneGhost } from "/client/actor-layers.js";
import { DEATH_DIR, DEATH_ANIM, DEATH_SCALE, HOPE_DIR, HOPE_ANIM, DEATH_SEQ } from "/client/demon-sprites.js";
import { abilityHoverChar, updateCharSelectHp, startCharSelectPreview, stopCharSelectPreview, syncTeamUi, charPage, resetCharSelectOpen, setCharPage, hiddenMode, HIDDEN_GLITCH_CHARS } from "/client/char-select.js";
import "/client/retry.js";
import "/client/admin.js";       // ?admin=1 → tlačidlo reset roomky
import "/client/debug-hope.js";  // ?hopedebug=1 → náhľad hope sprite

// klientský scope pre choreografiu postáv (public/chars/fx/*): lenivé gettery (moduly ich čítajú až pri
// prehrávaní, deklarácie nižšie sú vtedy už inicializované) - stav hry, rozmery, DOM vrstvy, pomocníci
const C = {
  get state() { return state; },
  get actorsEl() { return actorsEl; },
  get TILE_W() { return TILE_W; }, get TILE_H() { return TILE_H; },
  get ACTOR_W() { return ACTOR_W; }, get ACTOR_H() { return ACTOR_H; },
  get POSE_TAIL_MS() { return POSE_TAIL_MS; },
  get facingOverride() { return facingOverride; },
  get lastAttackEndAt() { return lastAttackEndAt; },
  get cellToPx() { return cellToPx; },
  get pairShift() { return pairShift; },
  get spawnExplosionAt() { return spawnExplosionAt; },
  get ensureSpriteMeta() { return ensureSpriteMeta; },
  get drawSprite() { return drawSprite; },
  get setAnim() { return setAnim; },
  get ANIM_DEF() { return ANIM_DEF; },
  get board() { return board; }, get GAP() { return GAP; },
  get MOVE_MS() { return MOVE_MS; }, get SPECIAL_SCALE() { return SPECIAL_SCALE; },
  get WOLF_DIRS_CLIENT() { return WOLF_DIRS_CLIENT; },
  get charDirFor() { return charDirFor; }, get usesAltColor() { return usesAltColor; },
  get computeFacing() { return computeFacing; },
  get hydratePix() { return hydratePix; }, get G() { return G; },
  get animState() { return animState; }, get currentFacing() { return currentFacing; },
  get spriteFrameIndex() { return spriteFrameIndex; },
  get worldCenterShown() { return worldCenter.style.display !== "none"; },
  get gridEl() { return gridEl; }, get spawnFloat() { return spawnFloat; }, get INVALID_MSG() { return INVALID_MSG; },
  get cellsForSpecialPreview() { return cellsForSpecialPreview; },
  get escPrideDisplay() { return escPrideDisplay; }, get escPrideDisplayChar() { return escPrideDisplayChar; },
  get me() { return me; }, get abilityHoverChar() { return abilityHoverChar; },
};
// inštancie choreografie postáv dostanú scope C (public/client/fx-registry.js)
initCharFx(C);

/* ---------- Overlaye Last Stand / Last Hope, YOU značka, kurzor lišty ---------- */
fxAll("init"); // figúry postáv z registra fx (Jotarov stand Star Platinum - druhý canvas vedľa Jotara)

// DEATH summon - screen-space overlay (fixed, mimo stacking contextu .stage, aby bolo vidno v každej fáze).
// Veľkosť medzi fázami riešime CSS transformom scale(); canvas má základnú „stredovú" veľkosť.
const deathCenter = document.createElement("canvas");
deathCenter.id = "death-center";
{
  const px = Math.round(TILE_H * DEATH_SCALE);
  deathCenter.width = px; deathCenter.height = px;
  deathCenter.style.width = px + "px"; deathCenter.style.height = px + "px";
  deathCenter.style.position = "fixed";
  deathCenter.style.left = "50%"; deathCenter.style.top = "50%";
  deathCenter.style.transform = "translate(-50%, -50%)";
  deathCenter.style.transformOrigin = "center";
  deathCenter.style.pointerEvents = "none";
  deathCenter.style.imageRendering = "pixelated";
  deathCenter.style.opacity = "0"; // štartuje skrytý, sekvencia ho zobrazí
  deathCenter.style.zIndex = "999999";
}
document.body.appendChild(deathCenter);

// „za postavou" - board-space canvas v #actors so z-indexom pod sprite-om postavy (.sprite-actor = 3)
const deathBehind = document.createElement("canvas");
deathBehind.id = "death-behind";
{
  // rovnaký rozmer canvasu ako postava → kreslíme identicky a prekryjeme sa presne
  deathBehind.width = ACTOR_W; deathBehind.height = ACTOR_H;
  deathBehind.style.width = ACTOR_W + "px"; deathBehind.style.height = ACTOR_H + "px";
  deathBehind.style.position = "absolute";
  deathBehind.style.zIndex = "2"; // pod postavou (z-index 3), nad gridom
  deathBehind.style.pointerEvents = "none";
  deathBehind.style.imageRendering = "pixelated";
  deathBehind.style.transformOrigin = "center"; // scale ostane centrovaný na postavu
  deathBehind.style.transition = "opacity .45s ease-out"; // plynulé stmievanie (revive 0→1, settle 1→0.25); left/top sa nehýbe transition-om (sleduje per-frame)
  deathBehind.style.opacity = "0";
}
actorsEl.appendChild(deathBehind);

// hmlový oblak za sprite-om (radiálny gradient + blur) - „zaujímavý mlžný efekt" pri zjavení
const deathFog = document.createElement("div");
deathFog.id = "death-fog";
Object.assign(deathFog.style, {
  position: "fixed", left: "50%", top: "50%", width: "560px", height: "560px",
  transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: "999998",
  borderRadius: "50%", display: "none", filter: "blur(28px)", opacity: "0",
  background: "radial-gradient(circle at center, rgba(214,190,255,.55), rgba(150,120,220,.28) 45%, rgba(120,90,200,0) 70%)",
});
document.body.appendChild(deathFog);

// Last Hope - stredový „hope" overlay (analógia k deathCenter), vlastný canvas nech sa nebije s démonom
const hopeCenter = document.createElement("canvas");
hopeCenter.id = "hope-center";
{
  // canvas v pomere framu (768×512 = 1.5:1) a poriadne veľký, nech hope postava vyplní priestor (nie letterbox)
  const ch = Math.round(TILE_H * 3.4);
  const cw = Math.round(ch * 768 / 512);
  hopeCenter.width = cw; hopeCenter.height = ch;
  hopeCenter.style.width = cw + "px"; hopeCenter.style.height = ch + "px";
  hopeCenter.style.position = "fixed";
  hopeCenter.style.left = "50%"; hopeCenter.style.top = "50%";
  hopeCenter.style.transform = "translate(-50%, -50%)";
  hopeCenter.style.transformOrigin = "center";
  hopeCenter.style.pointerEvents = "none";
  hopeCenter.style.imageRendering = "pixelated";
  hopeCenter.style.opacity = "0";
  hopeCenter.style.zIndex = "999999";
}
document.body.appendChild(hopeCenter);

// červený hmlový oblak pre Last Hope (analógia k deathFog, len červený)
const hopeFog = document.createElement("div");
hopeFog.id = "hope-fog";
Object.assign(hopeFog.style, {
  position: "fixed", left: "50%", top: "50%", width: "560px", height: "560px",
  transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: "999998",
  borderRadius: "50%", display: "none", filter: "blur(28px)", opacity: "0",
  background: "radial-gradient(circle at center, rgba(255,120,120,.55), rgba(220,60,60,.28) 45%, rgba(200,40,40,0) 70%)",
});
document.body.appendChild(hopeFog);

// „YOU" značka - poskakujúca zlatá šípka nad vlastnou postavou (kotví sa k pozícii aktéra)
const youMarker = document.createElement("div");
youMarker.className = "you-marker";
youMarker.innerHTML = `<div class="you-marker-bob"><span class="you-tag">YOU</span><span class="you-tip"></span></div>`;
youMarker.style.display = "none";
actorsEl.appendChild(youMarker);

// zelená šípka pod round-script lištou - počas animácie ukazuje na práve vykonávaný beat
const qCursor = document.createElement("div");
qCursor.className = "q-cursor";

// === Timing ===
const MOVE_MS = Math.round(700 * ANIM_SLOW); // pohyb na boarde; CSS číta --move-ms (nastavené nižšie)
// POZN.: neslučkové animácie (attack/attack2/hurt/dead) sa kvôli drawSprite(t=now) reálne neprehrávajú
// frame po frame - len držia poslednú pózu. Preto ich NEdržíme fixný čas (predtým 2400 ms = vizuálny „drag“),
// ale presne po dobu daného timeline frame-u (frame.delayMs), aby póza zmizla keď začne ďalšia akcia.
// special/melee tým ostávajú dlhé (ich beaty majú delayMs 1350 ms), basic/hurt sa skrátia na svoj frame.
const POSE_TAIL_MS = 300; // o koľko dlhšie strelec „pozerá“ v smere streľby, nech otočenie vydrží po dopad

// každá nevykonaná akcia povie PREČO - dôvod zo servera → [text floatu, CSS trieda]; default = všeobecné odmietnutie
const INVALID_MSG = {
  mana:      ["⚠️ LOW MANA",  "lowmana-float"],
  mana_full: ["✨ MANA FULL",  "golden-float"],
  hp_low:    ["🙏 LOW HP",     "lowmana-float"],
  offboard:  ["🚫 OFF-BOARD",  "lowmana-float"],
  no_demon:  ["✗ DEMON TAKEN", "dmg-float"], // druhý Last Stand v kole - démon je len jeden
  already_stone: ["🗿 ALREADY STONE", "lowmana-float"], // Medúzin special na už skamenenú postavu - bez efektu
  already_lost: ["🌀 ALREADY LOST", "lowmana-float"],   // Minotaurov special na už blúdiaceho - bez efektu
  not_alone: ["🚫 NOT ALONE", "lowmana-float"],         // Narutov summon vyžaduje bunku bez súpera
  blocked_shield: ["🛡️ SHIELD BLOCKED", "lowmana-float"], // BLOCK tile: obrana sa na ňom nedá castnúť (bez ceny)
  blocked_mirror: ["🪞 MIRROR BLOCKED", "lowmana-float"], // BLOCK tile: obrana sa na ňom nedá castnúť (bez ceny)
};
const INVALID_MSG_DEFAULT = ["🚫 NO EFFECT", "lowmana-float"];
const NEW_ROUND_MS = 1900; // „ROUND N" animácia medzi kolami (musí sedieť s CSS .round-banner.show)
document.documentElement.style.setProperty("--move-ms", MOVE_MS + "ms"); // drž CSS pohyb v sync so spomalením

// Projektil
document.documentElement.style.setProperty("--charge-ms", CHARGE_STEP_MS + "ms"); // plynulý sklz projektilu (CSS .projectile)

// počas special castu skryjeme bežný actor sprite
let castingNow = { p1:false, p2:false };
// teleport (výmena maga): postava fade-uje plynulo (WAAPI, inšpirované démonom) - ref na bežiacu fade animáciu
let _teleAnim = { p1:null, p2:null };
function fadeActor(slot, from, to, dur) {
  const el = slot === "p1" ? actorP1 : actorP2;
  if (_teleAnim[slot]) { try { _teleAnim[slot].cancel(); } catch {} }
  _teleAnim[slot] = el.animate(
    [{ opacity: from }, { opacity: to }],
    { duration: Math.max(150, dur || 600), easing: to > from ? "ease-out" : "ease-in", fill: "forwards" }
  );
}
function resetActorFade() {
  for (const slot of ["p1", "p2"]) {
    if (_teleAnim[slot]) { try { _teleAnim[slot].cancel(); } catch {} _teleAnim[slot] = null; }
    (slot === "p1" ? actorP1 : actorP2).style.opacity = "";
  }
}

let animState = { p1: { key:"idle", until:0 }, p2: { key:"idle", until:0 } };
// klonový flinch (tile zásah na klonovi) - čas štartu; klon sa strhne rovnako ako pravý Naruto pri zásahu,
// aby „nezraniteľne" nestál a neprezradil sa. Nezávislé od animState (to zdieľa s majiteľom).
let cloneFlinch = { p1: 0, p2: 0 };
// klon je „mŕtvy" (puffol) - positionActors ho drží skrytého, aby po puffe už nepreblikol späť.
// Reset pri novom summone (clone_born) a v clearActors.
let cloneDead = { p1: false, p2: false };
let actorsInitialized = false;

// --- nový game-over manažment na klientovi
let lastAttackEndAt = { p1:0, p2:0 }; // kedy (v čase performance.now) dobehne posledná animácia útoku

// od kedy je postava v HUD widgete mŕtva - Dead anim sa prehrá raz od tohto času
let hudDeadSince = { p1: 0, p2: 0 };

/* ---------- sprite helpers ---------- */

/* ---------- Teleport (výmena maga v turnaji) - dvojfázová explózia ---------- */
// framy sú JEDNOTLIVÉ číslované PNG (nie horizontálny strip ako ostatné sprity) → vlastný loader/prehrávač
const _teleFrames = {}; // char -> Promise<HTMLImageElement[]>
function ensureTeleportFrames(char) {
  if (_teleFrames[char]) return _teleFrames[char];
  const dir = TELEPORT_DIR[char], n = TELEPORT_COUNT[char] || 0;
  if (!dir || !n) return (_teleFrames[char] = Promise.resolve([]));
  const imgs = [], proms = [];
  for (let i = 1; i <= n; i++) {
    const img = new Image();
    proms.push(new Promise(res => { img.onload = res; img.onerror = res; }));
    img.src = `/assets/Teleport/${dir}/Explosion_${i}.png`;
    imgs.push(img);
  }
  return (_teleFrames[char] = Promise.all(proms).then(() => imgs));
}
const TORSO_FRAC = 0.66; // stred torza ako zlomok výšky actor boxu (0 = hore, 1 = päty)
// prehraj explóziu CENTROVANÚ na POSTAVU daného slotu (char = ktorého maga framy); durationMs = trvanie (= frame.delayMs)
// opacity: vždy 0.75 (obe fázy teleportu rovnako semi-transparentné)
function playTeleportExplosion(slot, char, durationMs, opacity, onDone) {
  const st = state?.[slot];
  if (!st) { onDone && onDone(); return; }
  const { x, y } = st;
  ensureTeleportFrames(char).then(imgs => {
    if (!imgs.length) { onDone && onDone(); return; }
    const fx = TELEPORT_FX[char] || { scale: 1.3, anchor: "torso" };
    const scale = fx.scale;
    const anchorBottom = fx.anchor === "feet";
    const boxW = Math.round(TILE_W * scale), boxH = Math.round(TILE_H * scale);
    const cvs = document.createElement("canvas");
    cvs.width = boxW; cvs.height = boxH;
    cvs.className = "teleport-fx";
    cvs.style.opacity = String(opacity ?? 1);
    // horizontálne = stred TELA postavy (sprite je vo frame mimo stredu - rovnaký HEAD_CX + flip vzor
    // ako „YOU" vlajka a anjel); vertikálne = kotvenie feet/torso + per-mág dy posun nadol
    const { left, top } = cellToPx(x, y);
    const px = left - (ACTOR_W - TILE_W) / 2;
    const py = top  - (ACTOR_H - TILE_H);
    const shift = pairShift(slot);
    const bodyDx = (computeFacing(state?.p1, state?.p2)[slot] || 1) * ACTOR_W * ((HEAD_CX[char] ?? 0.5) - 0.5);
    const cx = px + ACTOR_W / 2 + shift + bodyDx; // stred tela postavy
    cvs.style.left = Math.round(cx - boxW / 2) + "px";
    const dyPx = Math.round(TILE_H * (fx.dy || 0));
    if (anchorBottom) {
      const feetY = py + ACTOR_H;                              // päty postavy (= spodok bunky)
      cvs.style.top = Math.round(feetY - boxH + dyPx) + "px";  // spodok canvasu = päty (oheň od zeme)
    } else {
      const torsoY = py + ACTOR_H * TORSO_FRAC;                // stred torza
      cvs.style.top = Math.round(torsoY - boxH / 2 + dyPx) + "px";
    }
    // vlož NA KONIEC #actors (DOM poradie) → explózia je PRED mágom (navrchu)
    actorsEl.appendChild(cvs);
    const ctx = cvs.getContext("2d");
    const start = performance.now();
    const dur = Math.max(200, durationMs || 600);
    (function stepFx() {
      const t = performance.now() - start;
      const idx = Math.min(imgs.length - 1, Math.floor(t / dur * imgs.length));
      const img = imgs[idx];
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      ctx.imageSmoothingEnabled = false;
      if (img && img.naturalWidth) {
        const sc = Math.min(cvs.width / img.naturalWidth, cvs.height / img.naturalHeight);
        const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
        // horizontálne centrovať; vertikálne: "feet" ukotviť dole (oheň od zeme), "torso" centrovať
        // bottomTrim posunie kresbu nižšie o priehľadný spodný okraj PNG, aby viditeľný obsah sadol na päty
        const dy = anchorBottom ? (cvs.height - dh + dh * (fx.bottomTrim || 0)) : (cvs.height - dh) / 2;
        ctx.drawImage(img, (cvs.width - dw) / 2, dy, dw, dh);
      }
      if (t < dur) requestAnimationFrame(stepFx);
      else { cvs.remove(); onDone && onDone(); }
    })();
  }).catch(() => onDone && onDone());
}

/* ---------- animation state ---------- */
function setAnim(slot, key, durationMs = 0) {
  const def = ANIM_DEF[key] ?? ANIM_DEF.idle;
  animState[slot].key = key;
  animState[slot].start = performance.now(); // pre animácie s loopFrom (hrajú od frame 0, potom cyklia chvost)
  if (durationMs && durationMs > 0) {
    animState[slot].until = performance.now() + durationMs;
  } else if (!def.loop) {
    animState[slot].until = performance.now() + 600;
  } else {
    animState[slot].until = 0;
  }
}
function currentAnim(slot) {
  const now = performance.now();
  const st  = animState[slot];
  const def = ANIM_DEF[st.key] ?? ANIM_DEF.idle;
  if (st.until && now > st.until) {
    if (st.key !== "dead") {
      animState[slot].key = "idle";
      animState[slot].until = 0;
      return ANIM_DEF.idle;
    }
  }
  return def;
}

/* ---------- specials/melee v strede boardu ---------- */
// veľký centrálny overlay - pre special efektový sprite mága, pre melee zväčšená postava so sekaním
function updateSpecialCenter(casts) {
  actorsEl.querySelectorAll(".special-center").forEach(n => n.remove());
  if (!Array.isArray(casts) || casts.length === 0) return;

  // veľký sprite musí byť otočený rovnako ako malá postava na ploche (poloha voči súperovi + override streľby)
  const facing = computeFacing(state?.p1, state?.p2);

  for (const sp of casts) {
    const caster = state?.[sp.from];
    if (!caster || !caster.char) continue;

    // vlastný stredový overlay z registra fx (Jotaro: PÁR telo + stand Star Platinum)
    if (CHAR_FX[caster.char]?.spawnCenter?.(sp, facing)) continue;
    const dirKey = charDirFor(caster.char, sp.from);
    const file   = sp.file || SPECIAL_ANIMS[caster.char].file;

    const cvs = document.createElement("canvas");
    // veľkosť z registra fx (Escanorovo melee: stredová postava škáluje s Pridom)
    const fx = CHAR_FX[caster.char]?.centerScale?.(sp.from) ?? 1;
    const px  = Math.round(TILE_H * SPECIAL_SCALE * fx);
    cvs.width = px; cvs.height = px;
    cvs.className = "special-center";
    if (usesAltColor(caster.char, sp.from)) cvs.classList.add("alt-color");
    cvs.dataset.dir  = dirKey;
    cvs.dataset.file = file;
    if (sp.fps) cvs.dataset.fps = sp.fps;
    // choreografia postavy (register fx): vlastný vznik/kreslenie stredového spritu (Vojak: mierenie + výšľah)
    const cfx = CHAR_FX[caster.char];
    cfx?.centerCanvas?.(cvs, sp);
    if (cfx?.drawCenter) cvs.dataset.fxChar = caster.char;
    // one-shot stredový sprite (Countess A-sheety): hrá RAZ od vzniku canvasu (= od začiatku svojho
    // frame-u) a drží posledný frame - absolútny loop by naratívnu sekvenciu začal v strede.
    // Platí pre melee/heal casty (sp.once); jej trap cast (A5) nastaví to isté register fx (centerCanvas)
    if (sp.once) {
      cvs.dataset.once = "1";
      cvs.dataset.born = String(performance.now());
    }

    const flip = currentFacing(sp.from, facing);
    if (!cfx?.centerPlace?.(cvs, flip)) { // register fx (Escanor: rastie s Pridom → nohy fixné, rast nahor)
      cvs.style.left = "50%";
      cvs.style.top  = "50%";
      cvs.style.transform = `translate(-50%, -50%) scaleX(${flip})`;
    }

    actorsEl.appendChild(cvs);
  }
}

/* ---------- bubliny -X HP / +Y MANA ---------- */

// súbežné bubliny nad tým istým hráčom sa stackujú nad seba, aby sa neprekrývali
let floatTimes = { p1: [], p2: [] };
function floatOffsetFor(slot) {
  const now = performance.now();
  floatTimes[slot] = floatTimes[slot].filter(t => now - t < 1000); // životnosť floatu
  const off = floatTimes[slot].length * 26;
  floatTimes[slot].push(now);
  return off;
}

function spawnDamageFloat(slot, dmg) {
  const target = state?.[slot];
  if (!target || target.x == null) return; // labyrint: súper so skrytou pozíciou nemá kde floatovať
  const { left, top } = cellToPx(target.x, target.y);

  const el = document.createElement("div");
  el.className = "dmg-float";
  el.textContent = `-${dmg} HP`;
  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + 8 - floatOffsetFor(slot)) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
function spawnFloat(slot, text, className) {
  const target = state?.[slot];
  if (!target || target.x == null) return;
  const { left, top } = cellToPx(target.x, target.y);

  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + 8 - floatOffsetFor(slot)) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

function spawnManaFloat(slot, amount = 4, gold = false, dark = false) {
  const target = state?.[slot];
  if (!target || target.x == null) return;
  const { left, top } = cellToPx(target.x, target.y);

  const el = document.createElement("div");
  el.className = dark ? "mana-float dark" : gold ? "mana-float gold" : "mana-float"; // golden = zlatý, Pútnik = čierny
  el.textContent = `+${amount} MANA`;
  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + 8 - floatOffsetFor(slot)) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// Fire Wizard skonzumoval Damage dlaždicu specialom - krátky flare na bunke (dlaždica už zmizla zo state)
function spawnTileConsumeFx(cell, tile) {
  if (!Array.isArray(cell)) return;
  const { left, top } = cellToPx(cell[0], cell[1]);
  const el = document.createElement("div");
  el.className = "tile-consume-fx" + (tile === "power" ? " power" : ""); // power = zlatý odtieň flare

  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + TILE_H / 2) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 600);
}

// float na konkrétnej bunke (bez väzby na hráča) - napr. stopa na Ariadninej nití
function spawnCellFloat(cell, text, className) {
  const { left, top } = cellToPx(cell[0], cell[1]);
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + 8) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// zánik klona - poriadny oblak dymu (kage bunshin puff): niekoľko dymových gúľ vyletí do strán a nahor,
// stredové jadro sa roztiahne. Čisto kozmetické, self-remove; puffne raz (späť už nepreblikne - cloneDead).
// blood=true prefarbí dym do krvavočervenej - teleport pasce Vampire/Onryō (sýtejšia než ružový trap_break)
function spawnClonePuff(cell, blood = false) {
  if (!Array.isArray(cell)) return;
  const { left, top } = cellToPx(cell[0], cell[1]);
  const cx = left + TILE_W / 2, cy = top + TILE_H * 0.55;
  const mk = (size, z) => {
    const el = document.createElement("div");
    el.className = "clone-puff";
    el.style.position = "absolute";
    el.style.left = cx + "px"; el.style.top = cy + "px";
    el.style.width = size + "px"; el.style.height = size + "px";
    el.style.marginLeft = (-size / 2) + "px"; el.style.marginTop = (-size / 2) + "px";
    el.style.borderRadius = "50%";
    el.style.pointerEvents = "none";
    el.style.zIndex = String(z);
    el.style.background = blood
      ? "radial-gradient(circle, rgba(255,58,72,.95), rgba(150,12,28,.6) 55%, rgba(80,6,16,0) 72%)"
      : "radial-gradient(circle, rgba(240,240,245,.95), rgba(190,192,200,.6) 55%, rgba(160,162,172,0) 72%)";
    actorsEl.appendChild(el);
    return el;
  };
  // stredové jadro - rýchly veľký záblesk dymu
  const core = mk(Math.round(TILE_W * 1.15), 6);
  core.animate(
    [{ transform: "scale(.35)", opacity: .9 }, { transform: "scale(1.5)", opacity: 0 }],
    { duration: 520, easing: "ease-out", fill: "forwards" }
  );
  setTimeout(() => core.remove(), 600);
  // dymové gule do strán + nahor
  const N = 12;
  for (let i = 0; i < N; i++) {
    const size = Math.round(TILE_W * (0.34 + (i % 3) * 0.14));
    const el = mk(size, 7);
    const ang = (Math.PI * 2 * i / N) + i * 0.5;
    const dist = TILE_W * (0.32 + (i % 4) * 0.14);
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist - TILE_H * 0.22; // celkovo mierne stúpa (dym)
    const dur = 560 + (i % 5) * 60;
    el.animate(
      [{ transform: "translate(0,0) scale(.3)", opacity: .95 },
       { transform: `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px) scale(1.7)`, opacity: 0 }],
      { duration: dur, easing: "ease-out", fill: "forwards" }
    );
    setTimeout(() => el.remove(), dur + 80);
  }
}

// (Pozn.: krvavé Blood_Charge efekty k útokom už NIE sú samostatné overlay FX - sú zapečené priamo
// vo framoch A-sheetov A1–A5, generovaných v tools/sprites-countess-onre/build.cjs podľa attack guide.)

// zničenie pasce (Countess/Onre) - krvavo-fialový oblak: značka praskne a rozplynie sa.
// Vidia ho OBAJA hráči (zámer - súper sa dozvie, že riziko pasce pominulo). Čisto kozmetické, self-remove.
function spawnTrapBreak(cell) {
  if (!Array.isArray(cell)) return;
  const { left, top } = cellToPx(cell[0], cell[1]);
  const cx = left + TILE_W / 2, cy = top + TILE_H * 0.5;
  const mk = (size, z) => {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;pointer-events:none;border-radius:50%;" +
      "background:radial-gradient(circle, rgba(255,90,140,.9), rgba(160,30,90,.55) 55%, rgba(90,16,48,0) 72%)";
    el.style.left = cx + "px"; el.style.top = cy + "px";
    el.style.width = size + "px"; el.style.height = size + "px";
    el.style.marginLeft = (-size / 2) + "px"; el.style.marginTop = (-size / 2) + "px";
    el.style.zIndex = String(z);
    actorsEl.appendChild(el);
    return el;
  };
  const core = mk(Math.round(TILE_W * 0.9), 6);
  core.animate([{ transform: "scale(.3)", opacity: .95 }, { transform: "scale(1.4)", opacity: 0 }],
    { duration: 520, easing: "ease-out", fill: "forwards" });
  setTimeout(() => core.remove(), 600);
  for (let i = 0; i < 8; i++) {
    const el = mk(Math.round(TILE_W * (0.22 + (i % 3) * 0.1)), 7);
    const ang = (Math.PI * 2 * i / 8) + i * 0.4;
    const dist = TILE_W * (0.28 + (i % 3) * 0.12);
    const dur = 520 + (i % 4) * 60;
    el.animate(
      [{ transform: "translate(0,0) scale(.3)", opacity: .9 },
       { transform: `translate(${(Math.cos(ang) * dist).toFixed(0)}px, ${(Math.sin(ang) * dist - TILE_H * 0.15).toFixed(0)}px) scale(1.4)`, opacity: 0 }],
      { duration: dur, easing: "ease-out", fill: "forwards" }
    );
    setTimeout(() => el.remove(), dur + 80);
  }
  spawnCellFloat(cell, "🩸 TRAP DESTROYED", "trap-float");
}

// roztrieštenie sochy - odkamenenie (Medúzin kameň dohral): kamenné úlomky vyletia do strán a padajú
// (gravitácia) + krátky prachový záblesk v strede. Čisto kozmetické, self-remove; deterministické (bez random).
function spawnStoneShatter(slot) {
  const st = state?.[slot];
  if (!st || st.x == null) return;
  const { left, top } = cellToPx(st.x, st.y);
  const cx = left + TILE_W / 2, cy = top + TILE_H * 0.5;
  // prachový záblesk
  const dust = document.createElement("div");
  dust.style.cssText = "position:absolute;pointer-events:none;z-index:7;border-radius:50%;" +
    "background:radial-gradient(circle, rgba(205,207,214,.6), rgba(160,162,172,0) 70%)";
  const ds = Math.round(TILE_W * 0.95);
  dust.style.width = ds + "px"; dust.style.height = ds + "px";
  dust.style.left = cx + "px"; dust.style.top = cy + "px";
  dust.style.marginLeft = (-ds / 2) + "px"; dust.style.marginTop = (-ds / 2) + "px";
  actorsEl.appendChild(dust);
  dust.animate([{ transform: "scale(.4)", opacity: .8 }, { transform: "scale(1.5)", opacity: 0 }],
    { duration: 520, easing: "ease-out", fill: "forwards" });
  setTimeout(() => dust.remove(), 580);
  // kamenné úlomky - hranaté sivé kúsky, vyletia do strán a padajú s rotáciou
  const N = 14;
  for (let i = 0; i < N; i++) {
    const w = Math.round(TILE_W * (0.10 + (i % 3) * 0.06));
    const h = Math.round(w * (0.7 + (i % 2) * 0.5));
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;pointer-events:none;z-index:8;border-radius:2px;" +
      "background:linear-gradient(140deg, rgba(206,208,216,.98), rgba(140,142,152,.92) 60%, rgba(104,106,117,.88));" +
      "box-shadow:0 0 2px rgba(55,57,66,.55)";
    el.style.width = w + "px"; el.style.height = h + "px";
    el.style.left = cx + "px"; el.style.top = cy + "px";
    el.style.marginLeft = (-w / 2) + "px"; el.style.marginTop = (-h / 2) + "px";
    actorsEl.appendChild(el);
    const ang = (Math.PI * 2 * i / N) + i * 0.7;
    const dist = TILE_W * (0.26 + (i % 4) * 0.12);
    const dx = Math.cos(ang) * dist;
    const dy = -Math.abs(Math.sin(ang)) * TILE_H * 0.22 + TILE_H * 0.5; // mierne hore, potom pád nadol
    const rot = (i % 2 ? 1 : -1) * (120 + (i % 5) * 60);
    const dur = 620 + (i % 5) * 70;
    el.animate(
      [{ transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 1 },
       { transform: `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px) rotate(${rot}deg) scale(.45)`, opacity: 0 }],
      { duration: dur, easing: "cubic-bezier(.3,.55,.5,1)", fill: "forwards" }
    );
    setTimeout(() => el.remove(), dur + 80);
  }
}

// float aj nad VIDITEĽNÝM tieňovým klonom - obranné/mana hlášky nesmú prezradiť, ktorá postava je pravá
function cloneFloat(slot, text, className) {
  const o = state?.[slot];
  const c = o?.clone;
  if (!o || !c || o.x == null || (c.x === o.x && c.y === o.y)) return;
  spawnCellFloat([c.x, c.y], text, className);
}

// Naruto summon: jedna kópia na TEJ ISTEJ bunke, otočená proti Narutovi (kage bunshin moment -
// dvaja Naruti na jednom políčku tvárou v tvár); docasný canvas kreslí raf (cloneSummonFx), po dohraní framu sa odstráni
let cloneSummonFx = [];
let cloneSummonPose = { p1: null, p2: null }; // póza skutočného Naruta počas Special_2 (drží ju positionActors)
const SUMMON_CROP = 0.24; // orez prázdneho bočného okraja spritu počas Special_2 (aby sa dvaja Naruti vošli vedľa seba)
function spawnCloneSummonFx(slot, cell, durMs) {
  const st = state?.[slot];
  if (!st || !st.char || !Array.isArray(cell)) return;
  const facing = computeFacing(state?.p1, state?.p2)[slot] || 1;
  // NORMÁLNA výška (bez zmenšenia) - aby sa dvaja Naruti vošli vedľa seba, orežeme prázdny bočný okraj spritu
  // (SUMMON_CROP) a posunieme ich o štvrtinu bunky na opačné strany; kotva dole (feet), nech stoja na zemi
  const OFFSET = Math.round(TILE_W * 0.24);
  const { left, top } = cellToPx(cell[0], cell[1]);
  const baseLeft = left - (ACTOR_W - TILE_W) / 2;
  const baseTop  = top - (ACTOR_H - TILE_H);

  // pravý Naruto (skutočný actor) na jednu stranu bunky, kópia zrkadlovo na druhú → hľadia na seba, obaja v bunke.
  // Pózu skutočného actora aplikuje positionActors (inak by ju hneď prepísal); tu ju len nastavíme (scale 1 = normálna výška).
  cloneSummonPose[slot] = { off: OFFSET, until: performance.now() + Math.max(400, durMs) - 150 };
  positionActors(state); // hneď premietni pózu (bez čakania na ďalší frame)

  const el = document.createElement("canvas");
  el.className = "sprite-actor sprite-clone-summon";
  el.width = ACTOR_W; el.height = ACTOR_H;
  el.style.width = ACTOR_W + "px"; el.style.height = ACTOR_H + "px";
  el.style.left = baseLeft + "px";
  el.style.top  = baseTop + "px";
  el.style.transformOrigin = "50% 100%";
  el.style.transform = `translateX(${facing * OFFSET}px) scaleX(${-facing})`; // normálna výška, len zrkadlenie
  el.style.pointerEvents = "none";
  el.classList.toggle("alt-color", usesAltColor(st.char, slot));
  actorsEl.appendChild(el);
  el.animate(
    [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }],
    { duration: Math.max(400, durMs), easing: "linear", fill: "forwards" }
  );
  cloneSummonFx.push({ el, dir: charDirFor(st.char, slot) });
  setTimeout(() => el.remove(), Math.max(400, durMs) + 120);
}

// glow okolo postavy: obrana (pulzuje) nahrádza zlatý „YOU", inak fallback na zlatý
const YOU_GOLD_GLOW = "drop-shadow(0 0 1px #fff3b0) drop-shadow(0 0 4px #ffc107) drop-shadow(0 0 8px #ff9100)";
const GLOW_COL = { shield: "#4dd0e1", shieldGold: "#ffca28", mirror: "#ce93d8", mirrorGold: "#ffca28" }; // štít / golden štít / mirror / golden mirror
function pulseGlow(color, now) {
  const c = color, t = 0.5 + 0.5 * Math.sin(now / 240); // 0..1 pulz
  const b1 = (3 + 2 * t).toFixed(1);
  const b2 = (8 + 5 * t).toFixed(1);
  const b3 = (14 + 9 * t).toFixed(1);
  // hrubý plný obrys (viac tesných vrstiev) + pulzujúca žiara
  return `drop-shadow(0 0 1px ${c}) drop-shadow(0 0 1px ${c}) drop-shadow(0 0 2px ${c}) drop-shadow(0 0 2px ${c}) drop-shadow(0 0 ${b1}px ${c}) drop-shadow(0 0 ${b2}px ${c}) drop-shadow(0 0 ${b3}px ${c})`;
}
// filter postavy: alt-color (pravá strana p2, ak nemá natívnu paletu) + kameň (sivá socha) + glow
// isClone = true: klon NEZRKADLÍ Last Stand vizuály (zlatý death-glow) - ostáva neutrálny (rozhodnutie hráča)
function actorFilter(slot, now, isClone = false) {
  const st = state?.[slot];
  // golden recharge stav (death summon) - žiarivý zlatý pulz postavy, má prednosť pred ostatným (klon ho nemá)
  if (_deathGoldenSlot === slot && !isClone) {
    const t = 0.5 + 0.5 * Math.sin(now / 110);
    return `brightness(${(1.15 + 0.45 * t).toFixed(2)}) saturate(1.5) ` + pulseGlow("#ffd24a", now);
  }
  const alt = usesAltColor(st?.char, slot) ? "saturate(.22) brightness(1.4) " : "";
  // skamenená postava - kamenná sivá (prekryje aj alt filter, socha je socha)
  const stone = (st?.stone || 0) > 0 && (st?.hp ?? 1) > 0 ? "grayscale(.92) brightness(.82) contrast(1.12) " : "";
  let glow = "";
  if (st?.shield)      glow = pulseGlow(st.shieldGold ? GLOW_COL.shieldGold : GLOW_COL.shield, now);
  else if (st?.mirror) glow = pulseGlow(st.mirrorGold ? GLOW_COL.mirrorGold : GLOW_COL.mirror, now);
  else if (slot === me) glow = YOU_GOLD_GLOW;
  return (stone + alt + glow).trim();
}

// umiestni nabíjaciu auru na postavu podľa jej AKTUÁLNEJ (interpolovanej) pozície sprite-u,
// aby aura plynulo kĺzala s postavou počas pohybu (nie teleport na cieľové políčko)
function placeChargeAura(cont, slot) {
  const p = state?.[slot];
  if (!p || !p.char || p.x == null) return;
  const onClone = cont.dataset.anchor === "clone"; // aura klona sleduje klonov canvas
  if (onClone && (!p.clone || cloneEls[slot].style.display === "none")) { cont.remove(); return; }
  const shift = onClone ? 0 : pairShift(slot);
  // postava nie je v strede bunky - rovnaký horizontálny offset tela ako „YOU" vlajka (HEAD_CX + flip)
  const facing = computeFacing(state?.p1, state?.p2);
  const headDx = (facing[slot] || 1) * ACTOR_W * ((HEAD_CX[p.char] ?? 0.5) - 0.5);
  const actorEl = onClone ? cloneEls[slot] : (slot === "p1" ? actorP1 : actorP2);
  const aLeft = parseFloat(getComputedStyle(actorEl).left) || 0; // interpolovaná hodnota počas CSS transition
  const aTop  = parseFloat(getComputedStyle(actorEl).top)  || 0;
  const cellLeft = aLeft + (ACTOR_W - TILE_W) / 2;
  const cellTop  = aTop + (ACTOR_H - TILE_H);
  cont.style.left = (cellLeft + TILE_W / 2 + shift + headDx) + "px";
  cont.style.top  = (cellTop + TILE_H) + "px"; // päta postavy = spodok bunky
}

// ---- Plynulý projektil basic útoku ----
// Perzistentné canvasy žijú v #actors (nie v bunke, ktorú renderGrid každý frame maže cez innerHTML=""),
// takže projektil KĹŽE po bunkách cez CSS transition (left/top var(--charge-ms) linear) - rovnako ako
// pohyb postavy, bez poskakovania a bez miznutia uprostred letu. Kľúč rozlišuje strelca a jeho klonovu
// strelu (Naruto + klon = dve súbežné strely, klonova s invertovanou vertikálou).
const projectiles = new Map(); // `${from}-${clone?1:0}` -> { el, retire }
function projCenter(x, y) {
  const { left, top } = cellToPx(x, y);
  return { left: left + TILE_W / 2, top: top + TILE_H / 2 }; // stred bunky v súradniciach #actors (element má translate(-50%,-50%))
}
function projectileOrient(charKey, dir) {
  // Countess/Onre/Jotaro majú úzky diagonálny projektil (Jotaro = letiaca päsť Star Platinum).
  // Nepoužívaj scaleX+rotate kombináciu: pri ľavých diagonálach zrkadlenie mení aj znamienko
  // rotácie a špic (päsť) môže mieriť zle - preto čistá rotácia (base = doprava).
  if (PROJECTILE[charKey]?.orient === "rotate") {
    return {
      right: "rotate(0deg)", down_right: "rotate(45deg)", down: "rotate(90deg)", down_left: "rotate(135deg)",
      left: "rotate(180deg)", up_left: "rotate(-135deg)", up: "rotate(-90deg)", up_right: "rotate(-45deg)",
    }[dir] || "";
  }
  return {
    left: "scaleX(-1)", up: "rotate(-90deg)", down: "rotate(90deg)",
    up_right: "rotate(-45deg)", down_right: "rotate(45deg)",
    up_left: "scaleX(-1) rotate(45deg)", down_left: "scaleX(-1) rotate(-45deg)",
  }[dir] || "";
}
function spawnOrMoveProjectile(c, s) {
  const charKey = s?.[c.from]?.char;
  const dirKey  = charKey ? (CHAR_META[charKey].chargeDir || charDirFor(charKey, c.from)) : null;
  if (!dirKey) return;
  const key = `${c.from}-${c.clone ? 1 : 0}`;
  let entry = projectiles.get(key);
  if (entry && entry.retire) { clearTimeout(entry.retire); entry.retire = null; } // strela ešte letí ďalej
  // Vojakov granát sa kotúľa PO ZEMI (spodok bunky), nie stredom ako mágove strely
  const yOff = Math.round(TILE_H * (PROJECTILE[charKey]?.yOff || 0));
  const dst = projCenter(c.cell[0], c.cell[1]);
  if (!entry) {
    const el = document.createElement("canvas");
    // register fx projectileScale (Escanorova strela - slnko - škáluje s Pridom) alebo projectile.scale
    // (Vojakov granát je MALÝ - kotúľajúci sa projektil veľkosti ~⅓ bunky); ostatné postavy bez zmeny
    const fx = CHAR_FX[charKey]?.projectileScale?.(c.from) ?? (PROJECTILE[charKey]?.scale ?? 1);
    const px = Math.round(TILE_H * CHARGE_SCALE * fx);
    el.width = px; el.height = px;
    el.className = "projectile";
    if (usesAltColor(charKey, c.from)) el.classList.add("alt-color"); // p2 paleta (Medúza/Naruto natívne)
    el.dataset.dir = dirKey;
    el.style.width = px + "px"; el.style.height = px + "px";
    // vznikni na bunke strelca a odtiaľ plynule kĺž na prvú bunku letu (nie zlietni z rohu (0,0));
    // klonova strela štartuje z KLONOVEJ bunky, nie z Narutovej
    const st = s?.[c.from];
    const origin = c.clone ? st?.clone : st;
    const start = (origin && origin.x != null) ? projCenter(origin.x, origin.y) : dst;
    el.style.transition = "none";
    el.style.left = start.left + "px";
    el.style.top  = (start.top + yOff) + "px";
    void el.offsetHeight; // reflow → snap na štart bez sklzu, potom zapni transition
    el.style.transition = "";
    actorsEl.appendChild(el);
    entry = { el, retire: null };
    projectiles.set(key, entry);
  }
  entry.charKey = charKey;    // Vojak: na konci letu granát vybuchne (retireProjectile)
  entry.from = c.from;
  entry.lastCell = c.cell;    // posledná bunka letu = miesto výbuchu (zásah súpera/klona alebo okraj plochy)
  // sprite mieri doprava - ostatné smery flip/rotácia; nastavuje sa KAŽDÝ krok, lebo strela
  // Vampire/Onryō mení smer po odraze od steny (transform sa netranzicuje → okamžitý flip špicu);
  // diagonály = rotácia o 45° od horizontály.
  const orient = projectileOrient(charKey, c.dir);
  entry.el.style.transform = `translate(-50%, -50%) ${orient}`.trim();
  entry.el.style.left = dst.left + "px"; // nová cieľová bunka → CSS ju plynule dokĺže za --charge-ms
  entry.el.style.top  = (dst.top + yOff) + "px";
}
function retireProjectile(key) {
  const entry = projectiles.get(key);
  if (!entry || entry.retire) return;
  // nechaj dobehnúť posledný sklz na cieľovú bunku, až potom zmizni (nikdy nie uprostred letu)
  entry.retire = setTimeout(() => {
    entry.el.remove(); projectiles.delete(key);
    // Vojakov granát: výbuch na poslednej bunke letu - na súperovi/klonovi, alebo na okraji plochy v smere hodu
    if (PROJECTILE[entry.charKey]?.explodeAtEnd && Array.isArray(entry.lastCell)) spawnExplosionAt(entry.lastCell, entry.from, 1.2);
  }, CHARGE_STEP_MS);
}
// zosúlaď perzistentné projektily s charge efektmi tohto frame-u: nové/pohnuté posuň, chýbajúce stiahni
function reconcileProjectiles(charges, s) {
  // stacknutý Naruto+klon strieľajúci ROVNAKÝM smerom z jednej bunky = dve identické strely presne na sebe →
  // kresli len majiteľovu (vizuálne JEDEN projektil, dmg aj tak dopadne spojený ako „n+n"); vertikálne
  // rozdelené strely majú inú bunku/smer a ostávajú obe
  const drawn = charges.filter(c => !(c?.clone && charges.some(o => o && !o.clone && o.from === c.from
    && Array.isArray(o.cell) && Array.isArray(c.cell)
    && o.cell[0] === c.cell[0] && o.cell[1] === c.cell[1] && o.dir === c.dir)));
  const live = new Set();
  for (const c of drawn) {
    if (!c || !Array.isArray(c.cell)) continue;
    live.add(`${c.from}-${c.clone ? 1 : 0}`);
    spawnOrMoveProjectile(c, s);
  }
  for (const key of projectiles.keys()) if (!live.has(key)) retireProjectile(key);
}
function clearProjectiles() {
  for (const { el, retire } of projectiles.values()) { if (retire) clearTimeout(retire); el.remove(); }
  projectiles.clear();
}

// „Goku" nabíjacia aura pri recharge - naviazaná na postavu (sleduje ju per-frame v rafe);
// anchor "clone" ju ukotví na viditeľný tieňový klon (recharge nesmie prezradiť pravého Naruta)
function spawnChargeAura(slot, gold = false, red = false, anchor = "actor", dark = false) {
  const p = state?.[slot];
  if (anchor === "clone" && (!p?.clone || cloneEls[slot].style.display === "none")) return;
  // labyrint: skrytý súper (x null) auru vôbec nedostane - placeChargeAura by ju nemal kam ukotviť
  // a neumiestnená by svietila v rohu boardu (napr. červená Last Hope aura skrytého Minotaura)
  if (!p || p.x == null) return;
  const cont = document.createElement("div");
  // golden mana = zlatá; Last Hope ultra mód = červená; Pútnikova pasívna mana = čierna
  cont.className = dark ? "charge-aura dark" : red ? "charge-aura red" : gold ? "charge-aura gold" : "charge-aura";
  cont.dataset.slot = slot;            // raf podľa toho auru drží na interpolovanej pozícii postavy
  if (anchor === "clone") cont.dataset.anchor = "clone";
  placeChargeAura(cont, slot);
  cont.innerHTML = '<span class="ca-core"></span><span class="ca-ring"></span>';
  for (let i = 0; i < 18; i++) {
    const s = document.createElement("span");
    s.className = "ca-streak";
    s.style.left = ((Math.random() * 2 - 1) * TILE_W * 0.2).toFixed(0) + "px"; // užší rozptyl = na postave
    s.style.height = (TILE_H * (0.55 + Math.random() * 0.6)).toFixed(0) + "px";
    s.style.animationDelay = (Math.random() * 0.55).toFixed(2) + "s";
    cont.appendChild(s);
  }
  actorsEl.appendChild(cont);
  setTimeout(() => cont.remove(), 1100);
}

/* ---------- Last Stand - vizuál (démon v strede + za postavou, golden stav); riadené serverom cez timeline ---------- */
let _deathGoldenSlot = null;   // slot v golden stave (číta actorFilter pre žiaru postavy)

// základná pozícia anjela „za postavou" pre daný SLOT: stred anjela = stred TELA postavy (headDx + flip
// podľa toho-ktorého slotu, nie napevno p1), päty na spodok bunky; canvas je ACTOR-veľký, scale z transform-origin center
function computeDeathBound(slot) {
  const tgt = state?.[slot];
  if (!tgt || tgt.x == null) return { left: 0, top: 0 };
  const { left, top } = cellToPx(tgt.x, tgt.y);
  const shift = pairShift(slot);
  const facing = computeFacing(state?.p1, state?.p2);
  const headDx = (facing[slot] || 1) * ACTOR_W * ((HEAD_CX[tgt.char] ?? 0.5) - 0.5);
  const bodyCx = left + TILE_W / 2 + shift + headDx;
  return { left: bodyCx - ACTOR_W / 2, top: top - (ACTOR_H - TILE_H) };
}

// hmlový puff v strede (in = nábeh, out = reverz)
function _deathFogPuff(ms, dir) {
  deathFog.style.display = "block";
  const a = dir === "in"
    ? [{ opacity: 0, transform: "translate(-50%,-50%) scale(.35)" },
       { opacity: .85, transform: "translate(-50%,-50%) scale(1.05)", offset: .55 },
       { opacity: 0, transform: "translate(-50%,-50%) scale(1.5)" }]
    : [{ opacity: 0, transform: "translate(-50%,-50%) scale(1.5)" },
       { opacity: .85, transform: "translate(-50%,-50%) scale(1.05)", offset: .45 },
       { opacity: 0, transform: "translate(-50%,-50%) scale(.35)" }];
  deathFog.animate(a, { duration: ms, easing: dir === "in" ? "ease-out" : "ease-in" });
}

/* ---------- Last Stand - napojenie na server timeline ---------- */
// Stredový démon (hmlový nábeh/zmiznutie) ako flourish summon/banish; HP/manu riadi server cez frames.
// Trvalý golden stav (žiara + aura + démon za postavou) riadi raf podľa state[slot].lastStandBuff.
// WAAPI hygiena stredových overlayov (deathCenter/hopeCenter): fill-forwards animácia po dobehnutí
// NESMIE ostať na elemente visieť - neskorší cancel (hideDeathCenter na konci hry / ďalšia choreografia)
// by mohol odkryť staršiu fill animáciu držiacu opacity 1 a démon by sa VRÁTIL na plochu (reprodukované:
// banish smrť po démon útoku - na obrazovke porazeného ostal démon visieť v strede cez GAME OVER).
// Preto sa koncový stav po dobehnutí zapíše do inline štýlu a animácia sa hneď zruší.
function pinOnFinish(el, anim, styles) {
  anim.onfinish = () => { Object.assign(el.style, styles); anim.cancel(); };
}
let _lsRealActive = false; // beží reálny buffnutý stav (na upratanie po smrti/výhre)
let _lsAuraAt = 0;         // throttle recharge aury v rafe
let _lsBanishing = false;  // počas banishu nepripínaj démona za postavu (ide do stredu)
let _lhRealActive = false; // beží Last Hope ultra mód (na upratanie po skončení kola/hry)
let _lhAuraAt = 0;         // throttle červenej aury v rafe

function lsCenterAppear() {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  deathCenter.getAnimations().forEach(a => a.cancel());
  deathCenter.style.left = cx + "px"; deathCenter.style.top = cy + "px";
  deathFog.style.left = cx + "px"; deathFog.style.top = cy + "px";
  _deathFogPuff(1400, "in");
  const a = deathCenter.animate([
    { opacity: 0, filter: "blur(18px)", transform: "translate(-50%,-50%) scale(.55)" },
    { opacity: 1, filter: "blur(0px)",  transform: "translate(-50%,-50%) scale(1)" },
  ], { duration: 700, easing: "ease-out", fill: "forwards" });
  pinOnFinish(deathCenter, a, { opacity: "1", filter: "blur(0px)", transform: "translate(-50%,-50%) scale(1)" });
}
function lsCenterDisappear() {
  _deathFogPuff(700, "out");
  const a = deathCenter.animate([
    { opacity: 1, filter: "blur(0px)",  transform: "translate(-50%,-50%) scale(1)" },
    { opacity: 0, filter: "blur(18px)", transform: "translate(-50%,-50%) scale(.55)" },
  ], { duration: 700, easing: "ease-in", fill: "forwards" });
  pinOnFinish(deathCenter, a, { opacity: "0" });
}

// Démon útok - veľký démon v strede (100 % väčší než summon = scale 2); zvyšok kreslí raf do deathCenter
function demonCenterAppear() {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  deathCenter.getAnimations().forEach(a => a.cancel());
  deathCenter.style.left = cx + "px"; deathCenter.style.top = cy + "px";
  deathFog.style.left = cx + "px"; deathFog.style.top = cy + "px";
  _deathFogPuff(1000, "in");
  const a = deathCenter.animate([
    { opacity: 0, filter: "blur(18px)", transform: "translate(-50%,-50%) scale(1.1)" },
    { opacity: 1, filter: "blur(0px)",  transform: "translate(-50%,-50%) scale(2)" },
  ], { duration: 700, easing: "ease-out", fill: "forwards" });
  pinOnFinish(deathCenter, a, { opacity: "1", filter: "blur(0px)", transform: "translate(-50%,-50%) scale(2)" });
}
function demonCenterDisappear() {
  _deathFogPuff(700, "out");
  const a = deathCenter.animate([
    { opacity: 1, filter: "blur(0px)",  transform: "translate(-50%,-50%) scale(2)" },
    { opacity: 0, filter: "blur(18px)", transform: "translate(-50%,-50%) scale(1.4)" },
  ], { duration: 700, easing: "ease-in", fill: "forwards" });
  pinOnFinish(deathCenter, a, { opacity: "0" });
}

// Last Hope - červená „hope" postava v strede (analógia k lsCenterAppear, len červená hmla a hope sprite)
function _hopeFogPuff(ms, dir) {
  hopeFog.style.display = "block";
  const a = dir === "in"
    ? [{ opacity: 0, transform: "translate(-50%,-50%) scale(.35)" },
       { opacity: .85, transform: "translate(-50%,-50%) scale(1.05)", offset: .55 },
       { opacity: 0, transform: "translate(-50%,-50%) scale(1.5)" }]
    : [{ opacity: 0, transform: "translate(-50%,-50%) scale(1.5)" },
       { opacity: .85, transform: "translate(-50%,-50%) scale(1.05)", offset: .45 },
       { opacity: 0, transform: "translate(-50%,-50%) scale(.35)" }];
  hopeFog.animate(a, { duration: ms, easing: dir === "in" ? "ease-out" : "ease-in" });
}
function hopeCenterAppear() {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  hopeCenter.getAnimations().forEach(a => a.cancel());
  hopeCenter.style.left = cx + "px"; hopeCenter.style.top = cy + "px";
  hopeFog.style.left = cx + "px"; hopeFog.style.top = cy + "px";
  _hopeFogPuff(1400, "in");
  const a = hopeCenter.animate([
    { opacity: 0, filter: "blur(18px)", transform: "translate(-50%,-50%) scale(.55)" },
    { opacity: 1, filter: "blur(0px)",  transform: "translate(-50%,-50%) scale(1)" },
  ], { duration: 700, easing: "ease-out", fill: "forwards" });
  pinOnFinish(hopeCenter, a, { opacity: "1", filter: "blur(0px)", transform: "translate(-50%,-50%) scale(1)" });
}
function hopeCenterDisappear() {
  _hopeFogPuff(700, "out");
  const a = hopeCenter.animate([
    { opacity: 1, filter: "blur(0px)",  transform: "translate(-50%,-50%) scale(1)" },
    { opacity: 0, filter: "blur(18px)", transform: "translate(-50%,-50%) scale(.55)" },
  ], { duration: 700, easing: "ease-in", fill: "forwards" });
  pinOnFinish(hopeCenter, a, { opacity: "0" });
}
function hideHopeCenter() {
  hopeCenter.getAnimations().forEach(a => a.cancel());
  hopeFog.getAnimations().forEach(a => a.cancel());
  hopeCenter.style.opacity = "0";
  hopeFog.style.opacity = "0";
  hopeFog.style.display = "none";
}

// (dev demo klávesy R/T odstránené - Last Stand sa hrá cez tlačidlo a riadi server)
// tvrdo schovaj stredového démona (koniec hry / nová hra / char-select - nech nevisí na ploche)
function hideDeathCenter() {
  deathCenter.getAnimations().forEach(a => a.cancel());
  deathFog.getAnimations().forEach(a => a.cancel());
  deathCenter.style.opacity = "0";
  deathFog.style.opacity = "0";
  deathFog.style.display = "none";
}
// tvrdo schovaj démona ZA postavou (koniec hry / nová hra) - bežne ho uprace fill-forwards animácia
// banishu (onfinish) a raf cleanup pri prvom stave bez buffu, ale tie majú okná (race s koncom hry);
// POZOR: nevolať počas plánovania final kola - tam démon za buffnutou postavou MÁ visieť (0.25)
function hideDeathBehind() {
  deathBehind.getAnimations().forEach(a => a.cancel());
  deathBehind.style.opacity = "0";
}
// umiestni démona za postavu (slot) podľa bunky + ladiace offsety (nemení opacity/scale)
function placeDeathBehind(slot) {
  const tgt = state?.[slot];
  if (!tgt || !tgt.char) return;
  const b = computeDeathBound(slot);
  deathBehind.style.left = (b.left + DEATH_SEQ.behindOffsetX) + "px";
  deathBehind.style.top  = (b.top  + DEATH_SEQ.behindOffsetY) + "px";
  deathBehind.style.transform = `scale(${DEATH_SEQ.behindRatio})`;
}

// efektný náraz do štítu pri úspešnom bloku - hexagonálna bariéra flashne, rázové prstence + iskry
// originCell (voliteľné): štít sa rozbije na inej bunke než na Narutovi - napr. zásah na KLONOVI cez zdieľaný
// štít, aby sa block ukázal aj na klonovej figúre (nielen na pravom Narutovi)
function spawnShieldBlock(slot, gold, originCell = null) {
  const p = state?.[slot];
  if (!p || p.x == null) return;
  const shift = Array.isArray(originCell) ? 0 : pairShift(slot);
  const facing = computeFacing(state?.p1, state?.p2);
  const headDx = (facing[slot] || 1) * ACTOR_W * ((HEAD_CX[p.char] ?? 0.5) - 0.5);
  const cell = Array.isArray(originCell) ? originCell : [p.x, p.y];
  const { left, top } = cellToPx(cell[0], cell[1]);
  const cx = left + TILE_W / 2 + shift + headDx;
  const cy = top + TILE_H * 0.5;

  const add = (cls, style) => {
    const el = document.createElement("div");
    el.className = "shield-fx " + cls + (gold ? " gold" : "");
    el.style.left = cx + "px"; el.style.top = cy + "px";
    Object.assign(el.style, style || {});
    actorsEl.appendChild(el);
    setTimeout(() => el.remove(), 1000);
    return el;
  };

  add("sb-barrier", { width: Math.round(TILE_W * 0.7) + "px", height: Math.round(TILE_H * 0.95) + "px" });
  add("sb-flash", {});
  add("sb-ring", {});
  // štít sa roztriešti - veľa veľkých úlomkov letí ďaleko na všetky strany so spinom
  const N = 24;
  for (let i = 0; i < N; i++) {
    const ang = (Math.PI * 2 * i / N) + i * 0.17;
    const dist = 95 + (i % 4) * 40 + Math.random() * 30;
    const sh = add("sb-shard", {
      width: (16 + Math.random() * 16).toFixed(0) + "px",
      height: (18 + Math.random() * 16).toFixed(0) + "px",
      animationDelay: ".08s", // najprv bariéra zaregistruje náraz, potom sa roztriešti
    });
    sh.style.setProperty("--dx", Math.round(Math.cos(ang) * dist) + "px");
    sh.style.setProperty("--dy", Math.round(Math.sin(ang) * dist) + "px");
    sh.style.setProperty("--rot", Math.round(ang * 180 / Math.PI * 2 + 60) + "deg");
  }
}

// stred bunky hráča v súradniciach actorsEl
function centerOf(slot) {
  const p = state?.[slot];
  if (!p || p.x == null) return null;
  const { left, top } = cellToPx(p.x, p.y);
  return { x: left + TILE_W / 2, y: top + TILE_H / 2 };
}

// efektná animácia odrazu: zrkadlová tabuľa flashne a praskne pri obrancovi,
// rázová vlna + sklenené úlomky, lúč vystrelí späť do útočníka, board sa otrasie
// originCell (voliteľné): odraz vychádza z inej bunky než z obrancu - napr. zásah na KLONOVI cez zdieľaný
// mirror, aby lúč nešiel z pravého Naruta (to by prezradilo, ktorý je skutočný)
function spawnMirrorReflect(defenderSlot, dmg = 1, atkKind = "basic", gold = false, originCell = null, destCell = null) {
  const d = Array.isArray(originCell)
    ? (() => { const { left, top } = cellToPx(originCell[0], originCell[1]); return { x: left + TILE_W / 2, y: top + TILE_H / 2 }; })()
    : centerOf(defenderSlot);
  if (!d) return;
  // destCell: útok vystrelil útočníkov klon → beam letí do klonovej bunky, nie do pravého útočníka (slot center)
  const a = Array.isArray(destCell)
    ? (() => { const { left, top } = cellToPx(destCell[0], destCell[1]); return { x: left + TILE_W / 2, y: top + TILE_H / 2 }; })()
    : centerOf(defenderSlot === "p1" ? "p2" : "p1");

  const add = (cls, style) => {
    const el = document.createElement("div");
    el.className = "mirror-fx " + cls + (gold ? " gold" : "");
    Object.assign(el.style, style);
    actorsEl.appendChild(el);
    setTimeout(() => el.remove(), 900);
    return el;
  };

  // 1) zrkadlová tabuľa (glassy flash) za emoji
  add("mirror-pane", {
    left: d.x + "px", top: d.y + "px",
    width: Math.round(TILE_W * 0.6) + "px",
    height: Math.round(TILE_H * 0.92) + "px",
  });

  // 1b) samotné 🪞 emoji ako zdroj lúča - pixelizované ako zvyšok UI
  const emoSize = Math.round(TILE_H * 0.6);
  const emo = add("mirror-emoji pix-ico", {
    left: d.x + "px", top: d.y + "px",
    width: emoSize + "px", height: emoSize + "px",
  });
  emo.dataset.emoji = "🪞";
  pixelizeEmoji(emo, 24);

  // 2) rázová vlna
  const ring = Math.round(TILE_H * 1.1);
  add("mirror-ring", { left: d.x + "px", top: d.y + "px", width: ring + "px", height: ring + "px" });

  // 3) sklenené úlomky letiace do strán
  for (let i = 0; i < 12; i++) {
    const ang  = (Math.PI * 2 * i / 12) + (i * 0.37);          // pseudo-náhodný rozptyl bez Math.random()
    const dist = 46 + (i % 4) * 22;
    const el = add("mirror-shard", { left: d.x + "px", top: d.y + "px" });
    el.style.setProperty("--dx", Math.round(Math.cos(ang) * dist) + "px");
    el.style.setProperty("--dy", Math.round(Math.sin(ang) * dist) + "px");
    el.style.setProperty("--rot", Math.round(ang * 180 / Math.PI * 2) + "deg");
  }

  // 4) odraz: melee - alebo special na rovnakom políčku - = hrubý drsný burst (beam nemá kam letieť);
  //    inak smerový lúč k útočníkovi
  const foeSlot = defenderSlot === "p1" ? "p2" : "p1";
  const dp = state?.[defenderSlot], ap = state?.[foeSlot];
  const sameCell = !!(dp && ap && dp.x === ap.x && dp.y === ap.y);
  const useBurst = atkKind === "melee" || (atkKind === "special" && sameCell);
  if (useBurst) {
    // burst cez skoro celé políčko; pri speciáli vo fialovom prevedení
    add("mirror-melee" + (atkKind === "special" ? " special" : ""), {
      left: d.x + "px", top: d.y + "px",
      width: Math.round(TILE_W * 0.9) + "px",
      height: Math.round(TILE_H * 0.95) + "px",
    });
  } else if (a) {
    const dist = Math.hypot(a.x - d.x, a.y - d.y);
    const ang  = Math.atan2(a.y - d.y, a.x - d.x) * 180 / Math.PI;
    // hrúbka: basic podľa dmg (1/2/3) s výraznými rozostupmi, special ako najhrubší basic, fialovo ladený
    const thick = atkKind === "special" ? 48 : ({ 1: 12, 2: 28, 3: 48 }[dmg] || 12);
    const wrap = add("mirror-beam-wrap", {
      left: d.x + "px", top: (d.y - thick / 2) + "px",
      width: dist + "px", height: thick + "px",
      transform: `rotate(${ang}deg)`,
    });
    const beam = document.createElement("div");
    beam.className = "mirror-beam" + (atkKind === "special" ? " special" : "") + (gold ? " gold" : "");
    wrap.appendChild(beam);
  }

  // 5) otras boardu - pri burste (melee/special-na-políčku) silnejší (drsnejší dojem)
  const boardEl = gridEl.parentElement;
  if (boardEl) {
    boardEl.classList.remove("fx-shake");
    void boardEl.offsetWidth;
    boardEl.classList.add("fx-shake");
    setTimeout(() => boardEl.classList.remove("fx-shake"), useBurst ? 650 : 450);
  }
}

/* ---------- HUD ---------- */
// spojitý bar s 10 zárezmi: hlavná výplň + biely „trail", ktorý sa pri strate stiahne s oneskorením
function renderBar(el, value) {
  if (!el) return;
  if (!el.querySelector(".fill")) {
    el.innerHTML = '<div class="fill-trail"></div><div class="fill"></div>';
  }
  // labyrint: server hodnotu skryl (mana súpera = null) → prázdny bar s "?" namiesto čísla
  const hidden = value == null;
  el.classList.toggle("masked", hidden);
  const v = hidden ? 0 : Math.max(0, Math.min(10, Number(value) || 0));
  const prev = el.dataset.prev === undefined ? v : Number(el.dataset.prev);
  el.dataset.prev = String(v);

  const fill  = el.querySelector(".fill");
  const trail = el.querySelector(".fill-trail");
  fill.style.height  = (v * 10) + "%";
  trail.style.height = (v * 10) + "%"; // trail má oneskorený transition - pri strate sa stiahne neskôr

  // pri zisku výplň blikne do jasu
  if (v > prev) {
    fill.classList.remove("gain");
    void fill.offsetWidth; // reflow = reštart animácie
    fill.classList.add("gain");
    fill.addEventListener("animationend", () => fill.classList.remove("gain"), { once: true });
  }

  // presná hodnota pod barom - bez počítania dielikov; skrytá hodnota (labyrint) = "?"
  const num = el.closest(".hud-stat")?.querySelector(".bar-num");
  if (num) num.textContent = hidden ? "?" : String(v);
}

// banner pod ROUND textom: ja som locknutý a čaká sa na súpera / súper je locknutý a rad je na mne
function updateTurnStatus() {
  if (!turnStatusEl) return;
  const opSlot = me === "p1" ? "p2" : me === "p2" ? "p1" : null;
  const mine = me ? state?.[me] : null;
  const opp  = opSlot ? state?.[opSlot] : null;

  const timerMode = !!state?.config?.timer && state.config.timer !== "off";
  let txt = null, cls = null;
  if (!playback.playing && !playback.gameOverShown && mine?.char && opp?.char) {
    if (mine.locked && !opp.locked) {
      // „locked - waiting" - vo fixnom časovom režime skry; v quickdraw a bezčasovom nechaj
      if (!timerMode || state.config.timer === "quickdraw") { txt = "✔ LOCKED - WAITING FOR OPPONENT…"; cls = "waiting"; }
    } else if (!mine.locked && opp.locked) {
      // „your move" - nechaj v quickdraw (spúšťa časovač) a v bezčasovom režime; vo fixnom časovom skry
      if (!timerMode || state.config.timer === "quickdraw") { txt = "⚠️ OPPONENT IS READY - YOUR MOVE! ⚠️"; cls = "your-move"; }
    }
  }

  if (!txt) { turnStatusEl.classList.add("hidden"); return; }
  turnStatusEl.textContent = txt;
  turnStatusEl.classList.remove("hidden", "waiting", "your-move");
  turnStatusEl.classList.add(cls);
}

function renderHUD() {
  if (hudTurn && !playback.gameOverShown) {
    // posledné (buffnuté) kolo po Last Stand → „FINAL ROUND"; prepne sa až s bannerom (playback.finalRoundActive)
    hudTurn.textContent = (state?.phase === "playing")
      ? (playback.finalRoundActive ? "FINAL ROUND" : `ROUND ${state.turn}`)
      : "";
  }
  updateTurnStatus();
  renderBar(hudP1Hp,   state?.p1?.hp);
  renderBar(hudP1Mana, state?.p1?.mana);
  renderBar(hudP2Hp,   state?.p2?.hp);
  renderBar(hudP2Mana, state?.p2?.mana);

  // zelená vlajka pri hráčovi, ktorý začína kolo
  flagP1.classList.toggle("on", state.starter === "p1");
  flagP2.classList.toggle("on", state.starter === "p2");

  hudBoxP1.classList.toggle("me", me === "p1");
  hudBoxP2.classList.toggle("me", me === "p2");
  hudBoxP1.classList.toggle("foe", me === "p2");
  hudBoxP2.classList.toggle("foe", me === "p1");
  // divák (me == null) nemá „svoj" box → obe strany dostanú neutrálny štítok s menom (trieda .watch)
  hudBoxP1.classList.toggle("watch", !me);
  hudBoxP2.classList.toggle("watch", !me);
  // štítok nad widgetom = meno hráča (::before content: attr(data-name)); fallback pre chýbajúce meno
  const tagName = (slot) => state?.names?.[slot] || (slot === me ? "YOU" : me ? "OPPONENT" : (slot === "p1" ? "P1" : "P2"));
  hudBoxP1.dataset.name = tagName("p1");
  hudBoxP2.dataset.name = tagName("p2");

  // tournament × labyrint: hlavy magov skryté u oboch, kým kliatba beží - renderHUD beží per frame,
  // takže skrytie/odkrytie sadne aj na labyrint začatý či ukončený uprostred prehrávania kola
  if (state?.series?.format === "tournament") {
    const labActive = !!(state?.p1?.labyrinth || state?.p2?.labyrinth);
    crownsP1El.classList.toggle("lab-hidden", labActive);
    crownsP2El.classList.toggle("lab-hidden", labActive);
  }

  // pravá strana (p2) má VŽDY alternatívne vykreslenie (postava na boarde, portrét aj ghost);
  // výnimka: postava s natívnou p2 paletou (Medúza) - triedy priebežne prepína raf podľa aktuálneho chara
  actorP2.classList.toggle("alt-color", usesAltColor(state?.p2?.char, "p2"));
  hudCharP2.classList.toggle("alt-color", usesAltColor(state?.p2?.char, "p2"));
  actorGhost.classList.toggle("alt-color", me === "p2" && usesAltColor(ghostCharAt() || state?.p2?.char, "p2"));
  // vlastné HUD prvky postáv z registra fx (Escanor pride, vlkolakov mesiac, Luffy mód) - každá postava, pri inom charaktere ich skryje
  fxAll("hud", "p1", state?.p1); fxAll("hud", "p2", state?.p2);
  syncDynamicSpecialBtn(); // dmg na special tlačidle drž v sync s HUD fázou mesiaca (aj per-frame počas kola)
  updateGoldenButton();
}

// Vlkolak: dmg na SPECIAL tlačidle musí sedieť so zobrazenou fázou mesiaca (HUD ikonou). Prepočítava sa preto
// pri každom renderHUD (aj per-frame počas prehrávania) - nie len raz pri príchode state eventu: vtedy s[me]
// nesie počiatočný frame kola (schedulePlayTimeline ho premutuje späť), takže po zmene fázy ostávalo tlačidlo
// celé plánovanie na starom dmg. Zdroj = state[me].moon, rovnaký ako HUD ikona → obe sa preklopia naraz.
// cena tlačidla z registra: {emoji} → pixelová mini ikona
function costHtml(cost) { return cost.replace(/\{(.+?)\}/gu, (_, e) => miniPix(e)); }
// title + cena special tlačidla z registra postavy (statické alebo (ui) → {...}); force = prekresli aj bez zmeny kľúča
function applySpecialSkin(char, force) {
  const def = CHAR_BUTTONS[char]?.special;
  if (!specialBtn || !def) return;
  const ui = buttonUi();
  // specialKey: premenlivý obsah (vlkolakova fáza mesiaca) - prekresli len pri zmene
  const key = CHAR_BUTTONS[char].specialKey?.(ui);
  if (key != null) {
    if (!force && specialBtn.dataset.specialKey === key) return;
    specialBtn.dataset.specialKey = key;
  }
  const v = typeof def === "function" ? def(ui) : def;
  specialBtn.title = v.title;
  const cost = specialBtn.querySelector(".cost");
  if (cost) { cost.innerHTML = costHtml(v.cost); hydratePix(cost); }
}
// per-frame (renderHUD): obsah závislý od stavu počas kola (fáza mesiaca) drž v sync - len postavy so specialKey
function syncDynamicSpecialBtn() {
  const c = ghostCharAt();
  if (c && CHAR_BUTTONS[c]?.specialKey) applySpecialSkin(c, false);
}

/* ---------- Grid (efekty + anim. objekty) ---------- */
function renderGrid(s, effects = []) {
  gridEl.style.gridTemplateColumns = `repeat(${board.w}, ${TILE_W}px)`;
  gridEl.style.gridTemplateRows    = `repeat(${board.h}, ${TILE_H}px)`;
  const boardEl = gridEl.parentElement;
  boardEl.style.width  = (board.w * TILE_W + (board.w - 1) * GAP) + "px";
  boardEl.style.height = (board.h * TILE_H + (board.h - 1) * GAP) + "px";
  gridEl.innerHTML = "";

  // labyrint (Minotaurov special): prekliaty hráč vidí len vlastnú bunku, svoju niť, obrys na nití
  // a špeciálne tiles; dáta o súperovi už rediguje server - hmla je len vizuál nad tým.
  // Aréna sa stmaví OBOM hráčom (aj Minotaurovi), nech je očividné, že hra beží v labyrinte.
  const anyLab = !!(s?.p1?.labyrinth || s?.p2?.labyrinth);
  document.body.classList.toggle("labyrinth-mode", anyLab); // stmavenie arény za boardom - obaja hráči
  const mineLab = me ? s?.[me] : null;
  // labReveal: istý zásah v tomto ťahu - hmla padá už PRED animáciou akcie (aréna ostáva stmavená do labyrinth_end)
  const fogged = !!(mineLab && mineLab.labyrinth && !mineLab.labReveal);
  boardEl.classList.toggle("labyrinth", fogged);
  const fogVisible = new Set();
  // fakľové bunky: vlastná + bunka vlastného tieňového klona (klon = druhá fakľa, osvetľuje rovnako ako hráč)
  const torchCells = new Set();
  if (fogged) {
    if (mineLab.x != null) torchCells.add(`${mineLab.x},${mineLab.y}`);
    if (mineLab.clone) torchCells.add(`${mineLab.clone.x},${mineLab.clone.y}`);
    torchCells.forEach(k => fogVisible.add(k));
    (mineLab.thread || []).forEach(([x, y]) => fogVisible.add(`${x},${y}`));
    if (mineLab.threadMark) fogVisible.add(`${mineLab.threadMark[0]},${mineLab.threadMark[1]}`);
    // špeciálne tiles svietia cez tmu - slepý hráč ich musí vidieť (heal/mana zbiera, dmg/IK sa vyhýba)
    (s?.tiles || []).forEach(t => fogVisible.add(`${t.x},${t.y}`));
    (s?.iks || []).forEach(t => fogVisible.add(`${t.x},${t.y}`));
    // preview na ďalšie kolo svieti cez tmu rovnako (server heal/mana spawny mimo fakľových buniek už zredigoval)
    (s?.pending?.spawns || []).forEach(t => fogVisible.add(`${t.x},${t.y}`));
    (s?.pending?.ikMoves || []).forEach(c => fogVisible.add(`${c.x},${c.y}`));
  }
  // Ariadnina niť - bunky s niťou (vlastná niť prekliateho; lovec vidí súperovu, server mu ju posiela)
  const threadSet = new Set();
  for (const sl of ["p1", "p2"]) (s?.[sl]?.thread || []).forEach(([x, y]) => threadSet.add(`${x},${y}`));

  castingNow.p1 = false;
  castingNow.p2 = false;

  const charges  = [];
  const specials = [];
  const meleeCasts = [];
  const procs    = [];
  const cloneHitCells = []; // klon zasiahnutý tile-om → blik jeho bunky (ako hit-blink u hráča)
  const trapFlashCells = []; // trigger pasce (Countess/Onre) - rozžiarenie bunky pre oboch
  let hitTarget  = null;

  // špeciálne políčka (dmg/heal/mana + IK overlay)
  const tileMap = new Map();
  (s?.tiles || []).forEach(t => tileMap.set(`${t.x},${t.y}`, t.type));

  // preview na začiatok ďalšieho kola (config.tilePreview): nové spawny + cieľové bunky presunu IK -
  // kreslí sa ako malý polopriehľadný ghost v rohu bunky (žiadny blik, žiadne podfarbenie - len jemný náznak)
  const pendingMap = new Map();
  (s?.pending?.spawns || []).forEach(t => pendingMap.set(`${t.x},${t.y}`, t.type));
  (s?.pending?.ikMoves || []).forEach(c => pendingMap.set(`${c.x},${c.y}`, "ik"));

  const previewSet = new Set();

  for (const e of effects) {
    if (e?.kind === "charge")    charges.push(e);
    if (e?.kind === "special")   specials.push(e);
    if (e?.kind === "special1")  specials.push(e); // Jotarov útok v mirror slote - rovnaké zvýraznenie zóny + center cast
    if (e?.kind === "timestop_start" && Array.isArray(e.cells)) e.cells.forEach(([x, y]) => previewSet.add(`${x},${y}`)); // THE WORLD cast - celoplošný blik
    if (e?.kind === "hit")       hitTarget = e.target;
    if (e?.kind === "tile_proc") procs.push(e);
    if (e?.kind === "clone_hit" && Array.isArray(e.cell)) cloneHitCells.push(e.cell);
    // melee úder - zvýrazni zasahované bunky (server ich posiela v efekte; Medúza má aj diagonály)
    // + zväčšená postava v strede so sekacou animáciou (analógia special overlay)
    if (e?.kind === "melee") {
      const caster = s?.[e.from];
      const cells = Array.isArray(e.cells) ? e.cells : (caster ? [[caster.x, caster.y]] : []);
      cells.forEach(([x, y]) => previewSet.add(`${x},${y}`));
      // stredový overlay: Medúza = Attack_1, ostatní Attack_2; vlastný stred z registra fx (Jotaro: PÁR cez centerCast)
      if (!fxOwnsCenter(caster?.char, "melee")) {
        const atk = ANIM_DEF[ACTION_ANIMS[caster?.char]?.melee || "attack2_loop"];
        meleeCasts.push({ from: e.from, file: atk.file, fps: atk.fps });
      }
    }
    // démon útok - blikajú zasahované bunky (všetky okrem kasterovej)
    if (e?.kind === "demon_attack" && Array.isArray(e.cells)) {
      e.cells.forEach(([x, y]) => previewSet.add(`${x},${y}`));
    }
    // vlkolakovo seknutie - zvýrazni bunku terča (ako melee)
    if (e?.kind === "wolf_strike" && Array.isArray(e.cell)) previewSet.add(`${e.cell[0]},${e.cell[1]}`);
    // Luffy special: cieľová bunka bliká, kam sa guľa/Luffy dogúľa a vybuchne (počas roll → explode/chomp)
    if ((e?.kind === "luffy_roll" || e?.kind === "luffy_explode" || e?.kind === "luffy_chomp") && Array.isArray(e.target)) previewSet.add(`${e.target[0]},${e.target[1]}`);
    // Countess/Onre: seknutie po charge/teleporte - zvýrazni bunku terča; trigger pasce - bunka sa rozžiari
    if (e?.kind === "vamp_strike" && Array.isArray(e.cell)) previewSet.add(`${e.cell[0]},${e.cell[1]}`);
    // efekt autora zrkadlený do veľkého stredového spritu (register fx centerCast; Countess: úder A1 a liečivé
    // beaty A2–A4 ako one-shot od začiatku svojho beatu; Onre stredový overlay nemá; Jotaro: pár pri melee/Special 2)
    const fxCast = e && CHAR_FX[s?.[e.from]?.char]?.centerCast?.(e);
    if (fxCast) meleeCasts.push(fxCast);
    if (e?.kind === "trap_trigger" && Array.isArray(e.cell)) trapFlashCells.push(e.cell);
  }

  for (const sp of specials) {
    const caster = s?.[sp.from];
    if (!caster || !caster.char) continue;
    castingNow[sp.from] = true;
    // Medúzin special posiela zasahované bunky priamo v efekte (majú smer); ostatné sa dopočítajú
    const cells = Array.isArray(sp.cells) ? sp.cells : cellsForSpecialPreview(caster, sp.dir);
    cells.forEach(([x,y]) => previewSet.add(`${x},${y}`));
  }

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;

      const key = `${x},${y}`;
      if (previewSet.has(key)) cell.classList.add("preview-red");
      if (fogged && !fogVisible.has(key)) cell.classList.add("fogged"); // labyrint: tma mimo vlastnej bunky a nite
      else if (fogged && torchCells.has(key)) cell.classList.add("torch-lit"); // vlastná + klonova bunka ožiarené fakľami
      if (threadSet.has(key)) cell.classList.add("thread-cell");

      // tile podfarbenie + ikona; IK prekrýva všetko
      const tileType = tileMap.get(key);
      const isIK = Array.isArray(s?.iks) && s.iks.some(t => t.x === x && t.y === y);
      if (isIK) {
        cell.classList.add("tile-ik");
      } else if (tileType) {
        cell.classList.add(`tile-${tileType}`);
      }
      if (isIK || tileType) {
        const m = document.createElement("span");
        m.className = "tile-marker";
        m.innerHTML = tileSvg(isIK ? "ik" : tileType);
        cell.appendChild(m);
      }

      // preview budúceho tile - malý ghost v rohu (plná centrovaná ikona = tile ktoré UŽ platí);
      // môže sa krížiť s existujúcim tile len pri cieli presunu IK (IK smie prekryť iné tiles)
      const pendType = pendingMap.get(key);
      if (pendType) {
        const pm = document.createElement("span");
        pm.className = "tile-pending";
        pm.innerHTML = tileSvg(pendType);
        cell.appendChild(pm);
      }

      // práve vyhodnocované tile - výrazný blik
      if (procs.some(pc => pc.cell?.[0] === x && pc.cell?.[1] === y)) {
        cell.classList.add("tile-proc");
      }
      // trigger pasce - rozžiarenie bunky (od tohto momentu ju vidia obaja hráči)
      if (trapFlashCells.some(c => c[0] === x && c[1] === y)) cell.classList.add("trap-flash");

      // projektil basic útoku sa NEkreslí do bunky (renderGrid maže grid každý frame → poskakoval by);
      // rieši ho perzistentný plynulý element v #actors cez reconcileProjectiles() nižšie

      // zásahový blik
      const isP1 = s?.p1 && s.p1.x === x && s.p1.y === y;
      const isP2 = s?.p2 && s.p2.x === x && s.p2.y === y;
      if (hitTarget === "p1" && isP1) cell.classList.add("hit-blink");
      if (hitTarget === "p2" && isP2) cell.classList.add("hit-blink");
      if (cloneHitCells.some(c => c[0] === x && c[1] === y)) cell.classList.add("hit-blink"); // klon na dmg dlaždici - blik bunky
      // aktívne obrany (shield/mirror) sa už nekreslia na bunku - pulzujúci glow je per-postavu (actorFilter)

      gridEl.appendChild(cell);
    }
  }

  renderTrapMarkers(s); // pasca Countess/Onre - statická hlava castera v bunke (vidí ju len on)

  reconcileProjectiles(charges, s); // plynulé projektily kĺžu v #actors (mimo mazaného gridu)

  renderThreadLines(s);
  // stred, ktorý vlastní register fx (ownCenter), sa vynechá - Escanor: vlastná necyklená choreografia slnka;
  // Jotaro: Special 2 pár cez centerCast, Special 1 ZÁMERNE bez stredu (THE WORLD má vlastný menace spawnWorldCenter)
  updateSpecialCenter(
    specials.filter(sp => !fxOwnsCenter(s?.[sp.from]?.char, sp.kind))
      .concat(meleeCasts)
  );
}

/* ---------- Facing + umiestnenie ---------- */
function computeFacing(p1, p2) {
  if (!p1 || !p2 || p1.x == null || p2.x == null) return { p1: 1, p2: -1 }; // skrytý súper (labyrint) → default
  if (p1.x === p2.x && p1.y === p2.y) return { p1: 1, p2: -1 };
  if (p1.x <= p2.x) return { p1: 1, p2: -1 };
  return { p1: -1, p2: 1 };
}
// horizontálny rozostup postáv na ZDIEĽANOM políčku (p1 doľava, p2 doprava) - veľké postavy (Medúza)
// potrebujú väčší, pokojne aj s presahom do susedných políčok, inak sa sprity škaredo prekrývajú
// Escanor: veľkosť rastie o 20 % za pride level; škáluje sa od nôh. FEET_FRAC = kde nohy sedia v ACTOR canvase
// (feet-anchor spritov ~0.97 výšky) - origin škálovania, aby postava ostala na zemi a nedvíhala sa medzera pod ňou.
const ESC_FEET_FRAC = 0.973;
// escPrideDisplay: dočasné podržanie STAREJ veľkosti po kole - lev sa ukáže PRED zmenou, potom sa aplikuje nové pride
let escPrideDisplay = { p1: null, p2: null };
// postava, pre ktorú je escPrideDisplay zachytené - pri SWAPE (turnaj) sa char v strede kola zmení, takže
// držaná veľkosť starej postavy (napr. vlkolakov mesiac) sa NESMIE aplikovať na novú (Escanor pride 0)
let escPrideDisplayChar = { p1: null, p2: null };
// levelová veľkosť postavy: Escanor = pride, Vlkolak = fáza mesiaca (rast 1.2^level od nôh);
// vlkolakova ZÁKLADNÁ forma (nov) je zmenšená na 0.7× a rastie z nej (spln ≈ 1.21×), Escanor od 1×.
// escPrideDisplay drží počas prehrávania kola STARÝ level pre oba prípady (nová veľkosť až po floate)
const escPrideMul = a => {
  // Luffy: veľkosť sa medzi módmi NEMENÍ (žiadny size tell) - normalizuje ju boardFit.
  const sl = SIZE_LEVEL[a?.char]; // register: sizeLevel { stat, base }
  if (!sl) return 1;
  const lvl = a[sl.stat] || 0;
  const base = sl.base;
  // držanú veľkosť aplikuj len keď patrí TEJ ISTEJ postave (swap v strede kola mení char → inak by
  // sa napr. vlkolakov mesiac 3 aplikoval na čerstvo swapnutého Escanora a nafúkol ho)
  const held = (a.slot && escPrideDisplay[a.slot] != null && escPrideDisplayChar[a.slot] === a.char) ? escPrideDisplay[a.slot] : null;
  const pr = held != null ? held : lvl;
  return base * Math.pow(1.2, Math.max(0, Math.min(3, pr)));
};
const PAIR_SHIFT_DEFAULT = 22;
// pozn. labyrint: prekliatemu klientovi server skrýva súperovu pozíciu (x null) → pairShift preňho vráti 0.
// Výnimka: keď lovec PRÁVE stojí na mojej ožiarenej bunke (server flag hunterHere - bunka je aj tak
// prezradená), vlastný sprite odstúpi presne ako pri normálnej zdieľanej bunke mimo labyrintu.
function pairShift(slot, s = state) {
  const p1 = s?.p1, p2 = s?.p2;
  if (!p1 || !p2) return 0;
  const a = s?.[slot];
  const mag = PAIR_SHIFT[a?.char] ?? PAIR_SHIFT_DEFAULT; // konštantný odsun (nezávisí od pride veľkosti)
  if (p1.x != null && p1.x === p2.x && p1.y === p2.y) return slot === "p1" ? -mag : mag;
  if (a?.labyrinth && a.x != null && (a.hunterHere || []).some(([hx, hy]) => hx === a.x && hy === a.y))
    return slot === "p1" ? -mag : mag;
  return 0;
}
// pri horizontálnom útoku sa mág otočí v smere streľby, aj keď súper stojí inde
let facingOverride = { p1: { sx: 0, until: 0 }, p2: { sx: 0, until: 0 } };
function currentFacing(slot, facing) {
  const ov = facingOverride[slot];
  if (ov && ov.sx && performance.now() < ov.until) return ov.sx;
  return facing[slot];
}
function positionActors(s, immediate = false) {
  const p1 = s.p1, p2 = s.p2;
  const same = p1 && p2 && p1.x === p2.x && p1.y === p2.y;
  const facing = computeFacing(p1, p2);

  [["p1", actorP1, p1], ["p2", actorP2, p2]].forEach(([slot, el, data]) => {
    // labyrint: súper so skrytou pozíciou (x null) sa nekreslí vôbec
    if (!data || !data.char || data.x == null) { el.style.display = "none"; return; }
    const wasHidden = el.style.display === "none";
    el.style.display = "block";
    const { left, top } = cellToPx(data.x, data.y);
    // canvas je väčší než bunka - horizontálne centrovať, vertikálne ukotviť na spodok bunky
    const px = left - (ACTOR_W - TILE_W) / 2;
    const py = top  - (ACTOR_H - TILE_H);

    // wasHidden: odhalenie po labyrinte nesmie doslidovať zo starej pozície - umiestni sa okamžite
    if (immediate || !actorsInitialized || wasHidden) {
      el.style.transition = "none";
      el.style.left = px + "px";
      el.style.top  = py + "px";
      void el.offsetHeight;
      el.style.transition = "";
    } else {
      el.style.left = px + "px";
      el.style.top  = py + "px";
    }

    const shift = pairShift(slot, s);
    const scale = currentFacing(slot, facing);
    // summon póza (Special_2): skutočný Naruto v NORMÁLNEJ výške stojí pri jednom okraji bunky, kópia zrkadlovo
    // pri druhom (orez bočného okraja spritu v raf ich zúži). positionActors sa cez summon beat volá, preto
    // pózu držíme tu (inak by ju hneď prepísal).
    // Escanor: veľkosť postavy = indikátor pride levelu (rastie o 20 % za level, od nôh nahor)
    const prideMul = escPrideMul(data);
    const pose = cloneSummonPose[slot];
    if (pose && performance.now() < pose.until) {
      el.style.transformOrigin = "50% 100%";
      el.style.transform = `translateX(${shift - (facing[slot] || 1) * pose.off}px) scaleX(${facing[slot] || 1})`;
    } else if (prideMul !== 1) {
      el.style.transformOrigin = `50% ${ESC_FEET_FRAC * 100}%`; // rast od pät (nohy ostanú na zemi, žiadna medzera)
      el.style.transform = `translateX(${shift}px) scaleX(${scale * prideMul}) scaleY(${prideMul})`;
    } else {
      el.style.transformOrigin = "";
      // posun tela z registra fx (Jotaro pri útoku cúvne DOZADU na miesto, kde stál stand)
      const backShift = CHAR_FX[data.char]?.bodyShift?.(slot, facing[slot] || 1) || 0;
      el.style.transform = `translateX(${shift + backShift}px) scaleX(${scale})`;
    }

    el.dataset.slot = slot;
    if (same) el.dataset.pair = "1"; else el.removeAttribute("data-pair");
  });

  // tieňové klony - pozícia/facing ako majiteľ; klon je VŽDY viditeľný a PLNE KRYCÍ (identická figúra ako Naruto),
  // aby bolo vidno, že Naruto má klona. Na majiteľovej bunke stojí len jemne posunutý (STACK_OFFSET px);
  // pri rozdelení sa obe figúry rozbehnú SÚBEŽNE zo spoločnej bunky (klon vždy KĹŽE - nikdy nezmizne na mieste).
  [["p1", cloneEls.p1, p1, p2], ["p2", cloneEls.p2, p2, p1]].forEach(([slot, el, data, opp]) => {
    const c = data?.clone;
    // klon už puffol (clone_die) - drž ho skrytého, aj keď ho snapshot toho istého framu ešte nesie (žiadny problik)
    if (cloneDead[slot] || !data || !data.char || data.x == null || !c) {
      el.style.display = "none";
      el._logCell = null;
      return;
    }
    const { left, top } = cellToPx(c.x, c.y);
    const px = left - (ACTOR_W - TILE_W) / 2;
    const py = top  - (ACTOR_H - TILE_H);
    const onOwner = (c.x === data.x && c.y === data.y);
    const wasHidden = el.style.display === "none";
    const STACK_OFFSET = 18; // klon na majiteľovej bunke: jemný posun, aby bolo vidno dve figúry
    // zdieľaná bunka so súperom → rozostup ako postavy (rovnaká char-aware hodnota ako pairShift majiteľa,
    // inak by sa owner a klon rozišli rôzne ďaleko a prezradili, ktorý je pravý); na majiteľovej bunke + STACK_OFFSET
    // labyrint: lovec (skrytá pozícia) na bunke MÔJHO klona = druhá fakľa (hunterHere) → rovnaký rozostup
    const foeMag = PAIR_SHIFT[data.char] ?? PAIR_SHIFT_DEFAULT;
    const hunterOnClone = !!(data.labyrinth && (data.hunterHere || []).some(([hx, hy]) => hx === c.x && hy === c.y));
    const foeShift = ((opp && opp.x === c.x && opp.y === c.y) || hunterOnClone)
      ? (slot === "p1" ? -foeMag : foeMag) : 0;
    const shift = foeShift + (onOwner ? STACK_OFFSET : 0);

    el.style.display = "block";
    el.style.opacity = "1"; // klon nie je priehľadný ani na Narutovej bunke
    if (immediate || !actorsInitialized || wasHidden) {
      // prvé zjavenie (summon) / immediate - umiestni bez slideu (nie z rohu)
      el.style.transition = "none";
      el.style.left = px + "px"; el.style.top = py + "px";
      void el.offsetHeight;
      el.style.transition = "";
    } else {
      // bežný frame - CSS transition dá súbežný slide s majiteľom (rozdelenie aj zliatie plynulo)
      el.style.left = px + "px"; el.style.top = py + "px";
    }
    el.style.transform = `translateX(${shift}px) scaleX(${currentFacing(slot, facing)})`;
    el._logCell = { x: c.x, y: c.y };
  });

  // ďalšie figúry postáv z registra fx (Jotarov stand Star Platinum - vedľa Jotara, so slideom ako actor)
  fxAll("position", { s, facing, snap: immediate || !actorsInitialized });
  // „YOU" značka nad vlastnou postavou - sleduje aktéra (rovnaké transition ako pohyb)
  const meData = me ? s[me] : null;
  if (meData && meData.char) {
    const { left, top } = cellToPx(meData.x, meData.y);
    const px = left - (ACTOR_W - TILE_W) / 2;
    const py = top  - (ACTOR_H - TILE_H);
    const shift = pairShift(me, s);
    // Escanor: sprite je zväčšený podľa pride (rast od pät, origin ESC_FEET_FRAC) → hlava je vyššie a bočný offset väčší
    const prideMul = escPrideMul(meData);
    // vertikálne: vrch hlavy per-mág (HEAD_TOP) - pri pride sa škáluje okolo pät (FEET_FRAC), nie okolo spodku canvasu;
    // značku kotvíme jej spodkom (chevron) tesne nad hlavu cez translateY(-100%)
    const headTop = HEAD_TOP[meData.char] ?? 0.48;
    const headTopScaled = ESC_FEET_FRAC + (headTop - ESC_FEET_FRAC) * prideMul; // prideMul=1 → headTop
    const headY = py + ACTOR_H * headTopScaled - 2;
    // horizontálne: postava nie je v strede rámca; stred hlavy + flip podľa smeru otočenia (offset škáluje pride)
    const headCx = HEAD_CX[meData.char] ?? 0.5;
    const headDx = facing[me] * ACTOR_W * (headCx - 0.5) * prideMul;
    const markerX = px + ACTOR_W / 2 + shift + headDx;
    youMarker.style.display = "block";
    youMarker.style.transform = "translate(-50%, -100%)";
    if (immediate || !actorsInitialized) {
      youMarker.style.transition = "none";
      youMarker.style.left = markerX + "px";
      youMarker.style.top  = headY + "px";
      void youMarker.offsetHeight;
      youMarker.style.transition = "";
    } else {
      youMarker.style.left = markerX + "px";
      youMarker.style.top  = headY + "px";
    }
  } else {
    youMarker.style.display = "none";
  }

  actorsInitialized = true;
}

/* ---------- Queue + Lock ---------- */
// ikona/farba akcie pre lištu (zdieľané: moje akcie aj odhalené súperove); ownerSlot kvôli alt-color hláv p2
function actionBadgeView(a, ownerSlot) {
  const arrow = ARROW_DIR;
  const dd = ARROW_DIR[displayDir(a, ownerSlot)] || ""; // Narutov vertikálny smer (move/dash/attack) súperovi anonymizovaný (↕)
  switch (a?.type) {
    case "move":          return { cls: "move",    text: `🚶${dd || "?"}` };
    case "dash":          return { cls: "dash", text: `🏃${dd || "?"}` };
    case "recharge":      return { cls: "mana",    text: "🙏" };
    case "attack":        return { cls: "attack",  text: `🏹${dd}` };
    case "melee":         return { cls: "melee",   text: "🗡️" };
    case "special":       return { cls: "special", text: `✨${arrow[a.dir] || ""}` }; // smer: Medúza/Escanor/Jotaro(S2); Vojakov cieľ (cell) sa neukazuje - bunku ukáže hover
    case "special1":      return { cls: "mirror",  text: "🪞" }; // Jotarov útok v mirror slote sa tvári ako mirror (analógia k charge=dash u Vampire/Onryō)
    case "shield":        return { cls: "shield",  text: "🛡️" };
    case "mirror":        return { cls: "mirror",  text: "🪞" };
    case "golden_shield": return { cls: "golden",  html: '<span class="g-ico">🛡️</span>' };
    case "golden_mirror": return { cls: "golden",  html: '<span class="g-ico mirror">🪞</span>' };
    case "golden_mana":   return { cls: "golden",  html: '<span class="g-ico">🙏</span>' };
    case "last_stand":    return { cls: "golden",   html: LS_BADGE_IMG };
    case "demon":         return { cls: "demon",    html: LS_BADGE_IMG };
    case "stoned":        return { cls: "stoned",   text: "🗿" };
    case "pass":          return { cls: "pass",     text: "💭" }; // vypršaný čas - nevyplnený slot
    case "swap":          return { cls: "swap",     html: mageHeadHtml(a.to || "", usesAltColor(a.to, ownerSlot) ? "alt-color" : "", ownerSlot) };
    case "last_hope":     return { cls: "lasthope", html: LH_BADGE_IMG };
    case "unknown":       return { cls: "unknown",  text: "❓" }; // labyrint - redigovaná akcia súpera
    default:              return { cls: "",        text: a?.type || "" };
  }
}

// hover náhľad dosahu pre moje útok/special/melee badge (z ghost pozície v danom kroku)
function attachQueueHover(el, a, idx) {
  if (a.type === "attack") {
    el.addEventListener("mouseenter", () => { const p = ghostPos(idx); if (p) showPreviewCells(cellsForAimPreview(p, a.dir, ghostCharAt(idx))); });
    el.addEventListener("mouseleave", clearPreviewCells);
  } else if (a.type === "dash") {
    // Vampire/Onryō: dash = charge - hover ukáže dráhu behu (stop na viditeľnej figúre súpera)
    el.addEventListener("mouseenter", () => {
      const p = ghostPos(idx); const char = ghostCharAt(idx);
      if (p && VAMP_CHARS[char]) showPreviewCells(cellsForVampChargePreview(p, a.dir, state?.[otherSlot()]));
    });
    el.addEventListener("mouseleave", clearPreviewCells);
  } else if (a.type === "special") {
    // pride: Escanorova zóna závisí od AKTUÁLNEHO pride levelu (rovnako ako hover na šípkach pickeru) -
    // bez neho by náhľad ukazoval vždy pride 0; pride sa mení až na konci kola, takže current je správny
    // Vojak: akcia nesie cieľovú bunku - zvýrazni presne ju (zóna sa nedá odvodiť z pozície)
    // Vlkolak: dráha charge sa zastaví na viditeľnej figúre súpera → preview potrebuje foe
    el.addEventListener("mouseenter", () => {
      if (a.cell) { showPreviewCells([[a.cell.x, a.cell.y]]); return; }
      const char = ghostCharAt(idx); const p = ghostPos(idx);
      if (char && p) showPreviewCells(cellsForSpecialPreview({ x: p.x, y: p.y, char, pride: state?.[me]?.pride, foe: state?.[otherSlot()] }, a.dir));
    });
    el.addEventListener("mouseleave", clearPreviewCells);
  } else if (a.type === "special1") {
    // Jotarov Special 1 - obe diagonálne bunky zvolenej strany z ghost pozície
    el.addEventListener("mouseenter", () => { const p = ghostPos(idx); if (p) showPreviewCells(cellsForJotaroS1(p, a.dir)); });
    el.addEventListener("mouseleave", clearPreviewCells);
  } else if (a.type === "melee") {
    el.addEventListener("mouseenter", () => {
      const p = ghostPos(idx); if (!p) return;
      showPreviewCells(cellsForMeleePreview(p, ghostCharAt(idx)));
    });
    el.addEventListener("mouseleave", clearPreviewCells);
  } else if (a.type === "demon") {
    el.addEventListener("mouseenter", () => { const p = ghostPos(idx); if (p) showPreviewCells(cellsForDemonPreview(p)); });
    el.addEventListener("mouseleave", clearPreviewCells);
  }
}

// lišta = celá interleave kostra kola v reálnom poradí vyhodnotenia:
// [golden shield] | a1(štartér) a1(nestartér) | a2 a2 | a3 a3 | golden mana(š) golden mana(n)
// moje sloty vypĺňam (zlatý lining), súperove sú "?" placeholdery (odhalia sa počas animácie)
let qBeatEls = []; // sloty podľa pozície 0..8 (pre kurzor + odhalenie súpera počas animácie)

// skamenené ťahy nového kola sú vopred zamknuté ako pass (🗿) - predvyplnia sa na začiatok fronty
// a nedajú sa odobrať (undo poistka); hráč plánuje len zvyšné sloty
function ensureStonePrefix() {
  if (!me || isSpectator || playback.playing || planning.lockedIn) return;
  const mine = state?.[me];
  if (!mine || !mine.char || mine.locked || state?.phase !== "playing") return;
  const need = Math.min(3, mine.stone || 0);
  const have = planning.myQueue.filter(a => a.type === "stoned").length;
  if (have === need && planning.myQueue.slice(0, need).every(a => a.type === "stoned")) return;
  const rest = planning.myQueue.filter(a => a.type !== "stoned");
  planning.myQueue = [...Array.from({ length: need }, () => ({ type: "stoned" })), ...rest].slice(0, 3);
}

// Jotaro THE WORLD: samostatný placeholder pre 3 zmrazené akcie - pôvodná lišta kola (queueEl) ostáva
// viditeľná ako „vykonáva sa THE WORLD", tu sa zadávajú nové akcie.
const tsQueueEl = document.createElement("div");
tsQueueEl.id = "ts-queue";
tsQueueEl.className = "ts-queue hidden";
queueEl.parentElement?.appendChild(tsQueueEl);
function renderTsQueue() {
  tsQueueEl.classList.remove("hidden");
  queueEl.classList.add("ts-executing"); // pôvodná lišta: „stojí na vykonávaní THE WORLD"
  tsQueueEl.innerHTML = "";
  const label = document.createElement("div");
  label.className = "ts-queue-label";
  label.textContent = "⏱ THE WORLD - 3 frozen actions";
  tsQueueEl.appendChild(label);
  const slots = document.createElement("div");
  slots.className = "ts-queue-slots";
  for (let i = 0; i < 3; i++) {
    const el = document.createElement("span");
    el.className = "a-badge ts-slot";
    const a = planning.myQueue[i];
    if (a) {
      const v = actionBadgeView(a, me);
      el.classList.add(v.cls);
      if (v.html) el.innerHTML = v.html; else el.textContent = v.text;
    } else { el.classList.add("empty"); el.textContent = String(i + 1); }
    slots.appendChild(el);
  }
  tsQueueEl.appendChild(slots);
}
function hideTsQueue() { tsQueueEl.classList.add("hidden"); queueEl.classList.remove("ts-executing"); }

function renderQueue() {
  // THE WORLD plánovanie: NEprestavuj pôvodnú lištu (ostáva „executing"), zadávaj do samostatného placeholdera
  if (playback.tsPlanning) { renderTsQueue(); updateActionButtons(); syncGoldenHalves(); updateGoldenButton(); updateLockButton(); return; }
  hideTsQueue();
  syncButtonBadges(ghostCharAt()); // Luffy: gear odznak na range/special reaguje aj na naplánovaný recharge
  ensureStonePrefix();
  queueEl.innerHTML = "";
  qBeatEls = [];

  const starterSlot = state?.starter || "p1";
  const otherS = starterSlot === "p1" ? "p2" : "p1";
  const lastRound = !!state?.goldLocked; // buffnuté posledné kolo - namiesto 2 gold-mana placeholderov jedna démon „end" bunka
  const buffSlot = state?.p1?.lastStandBuff ? "p1" : state?.p2?.lastStandBuff ? "p2" : null;
  const hopeSlot = buffSlot ? (buffSlot === "p1" ? "p2" : "p1") : null; // nebuffnutý hráč - vlastník Last Hope bunky
  // beaty v reálnom poradí; owner = komu beat patrí (golden shield iba nestartérovi)
  const layout = [];
  if (lastRound && hopeSlot) layout.push({ pos: 9, kind: "lasthope", owner: hopeSlot }); // úplne vľavo, len vo final kole
  layout.push(
    { pos: 0, kind: "gshield", owner: otherS },
    { pos: 1, kind: "act", idx: 0, owner: starterSlot },
    { pos: 2, kind: "act", idx: 0, owner: otherS },
    { pos: 3, kind: "act", idx: 1, owner: starterSlot },
    { pos: 4, kind: "act", idx: 1, owner: otherS },
    { pos: 5, kind: "act", idx: 2, owner: starterSlot },
    { pos: 6, kind: "act", idx: 2, owner: otherS },
  );
  if (lastRound) layout.push({ pos: 7, kind: "demon" }); // jedna zvýraznená démon bunka pre oboch (hra tu končí)
  else layout.push({ pos: 7, kind: "gmana", owner: starterSlot }, { pos: 8, kind: "gmana", owner: otherS });
  const warnings = planWarnings();

  layout.forEach((b) => {
    // predely: [last_hope] | golden shield | akcie | golden mana / démon
    if ((b.pos === 0 && lastRound && hopeSlot) || b.pos === 1 || b.pos === 7) {
      const d = document.createElement("div");
      d.className = "q-divider";
      queueEl.appendChild(d);
    }
    if (b.kind === "demon") {
      const el = document.createElement("div");
      el.dataset.pos = "7";
      el.className = "q-badge demon";
      el.innerHTML = LS_BADGE_IMG;
      el.title = "Last Stand - hra tu končí (banishment)";
      queueEl.appendChild(el);
      qBeatEls[7] = el;
      return;
    }
    if (b.kind === "lasthope") {
      const mine = b.owner === me;
      const el = document.createElement("div");
      el.dataset.pos = "9";
      el.className = "q-badge lasthope " + (mine ? "mine" : "opp");
      if (mine && planning.lastHopeArmed) {
        el.innerHTML = LH_BADGE_IMG;
        el.title = "Last Hope (navolené)";
      } else {
        el.classList.add("q-slot");
        el.innerHTML = '<span class="lh-dim">?</span>';
        el.title = mine ? "Last Hope (final round)" : "Opponent (hidden until it resolves)";
      }
      queueEl.appendChild(el);
      qBeatEls[9] = el;
      return;
    }
    const mine = !!me && b.owner === me;
    const el = document.createElement("div");
    el.dataset.pos = String(b.pos);
    // veľkosť = dôležitosť: 3 hlavné akcie "main" (veľké), golden "opt" (malé, voliteľné)
    el.className = "q-badge " + (mine ? "mine" : "opp") + " " + (b.kind === "act" ? "main" : "opt");

    let filled = null;
    if (mine) {
      if (b.kind === "gshield")    filled = planning.goldenArmed ? { type: "golden_shield" } : planning.goldenMirrorArmed ? { type: "golden_mirror" } : null;
      else if (b.kind === "gmana") filled = planning.goldenManaArmed ? { type: "golden_mana" } : planning.lastStandArmed ? { type: "last_stand" } : null;
      else                         filled = planning.myQueue[b.idx] || null;
    }

    if (filled) {
      const v = actionBadgeView(filled, me);
      if (v.cls) el.classList.add(v.cls);
      if (v.html) el.innerHTML = v.html; else el.textContent = v.text;
      if (b.kind === "act") attachQueueHover(el, filled, b.idx);
      // akcia podľa plánu nebude mať efekt → žltý ⚠ v rohu + dôvod v tooltipe
      const warn = b.kind === "act" ? warnings[b.idx]
        : (filled.type === "golden_mirror" && foeMirrorImmune()) ? MIRROR_IMMUNE_WARN : null;
      if (warn) {
        el.classList.add("q-warn");
        el.title = "⚠ " + warn;
        const w = document.createElement("span");
        w.className = "q-warn-ico";
        w.textContent = "⚠️";
        el.appendChild(w);
      }
    } else {
      el.classList.add("q-slot");
      // súperov skamenený ťah je DETERMINISTICKÝ (stun prenesený z minulého kola) - namiesto skrytého „?"
      // ukáž 🗿 na presných akciách, ktoré súper vynechá, nech kaster Medúzy vidí dokedy súper stojí
      const oppStone = (!mine && b.kind === "act") ? Math.min(3, state?.[b.owner]?.stone || 0) : 0;
      const oppStoned = oppStone > 0 && b.idx < oppStone;
      if (b.kind === "gshield")    el.innerHTML = '<span class="g-ico dim">🛡️</span>';
      else if (b.kind === "gmana") el.innerHTML = '<span class="g-ico dim">🙏</span>';
      else if (oppStoned) { el.classList.add("stoned"); el.textContent = "🗿"; }
      else el.textContent = mine ? ["①", "②", "③"][b.idx] : String(b.idx + 1); // ja kružok, súper holé cifry
      el.title = oppStoned ? "Opponent is petrified - this action is skipped (carry-over stun)"
        : mine ? "Your action (required)" : "Opponent (hidden until it resolves)";
    }

    queueEl.appendChild(el);
    qBeatEls[b.pos] = el;
  });
  qCursor.classList.remove("show"); // počas plánovania skrytá; zobrazí ju až animácia
  queueEl.appendChild(qCursor);     // zelená šípka (mimo flex flow, absolútna)

  if (state?.series?.format === "tournament") renderMageHeads(); // drž „armed" stav hláv v HUD v sync s frontou (hlavy animuje raf)
  updateActionButtons();
  syncGoldenHalves(); // drž zamknutie zlatých polovíc v sync s frontou (shield/mirror ↔ golden)
  updateGoldenButton(); // drž démon tlačidlo (armed/disabled podľa fronty) v sync aj pri úprave fronty
  updateLockButton();
  sendDraft(); // priebežne posli rozpracovanú voľbu serveru (pre backstop pri vypršaní času)
}

// počas animácie: posuň kurzor na práve vyhodnocovaný beat a odhal súperovu akciu
function highlightRoundBeat(from, action, counts, starterSlot) {
  let pos;
  // labyrint: redigovaná akcia ("unknown") nesie beat, aby padla na správny slot lišty (gold pre/post vs. bežná)
  const maskedBeat = action.type === "unknown" ? (action.beat || "act") : null;
  if (action.type === "last_hope" || maskedBeat === "lhope") pos = 9;
  else if (action.type === "golden_shield" || action.type === "golden_mirror" || maskedBeat === "gpre") pos = 0;
  else if (action.type === "golden_mana" || action.type === "last_stand" || maskedBeat === "gmana") pos = (from === starterSlot) ? 7 : 8;
  else { const k = counts[from]++; pos = (from === starterSlot) ? [1, 3, 5][k] : [2, 4, 6][k]; }
  if (pos == null) return null;
  qBeatEls.forEach(e => e && e.classList.remove("q-now"));
  const el = qBeatEls[pos];
  if (!el) return null;
  // odhal súperovu akciu (moje sú už vyplnené z plánovania)
  if (el.classList.contains("opp")) {
    const v = actionBadgeView(action, from);
    el.classList.remove("q-slot");
    el.classList.add("revealed");
    if (v.cls) el.classList.add(v.cls);
    if (v.html) el.innerHTML = v.html; else el.textContent = v.text;
    el.title = "Opponent"; // swap badge hlavu animuje raf (canvas.mage-head)
  }
  el.classList.add("q-now");
  // zelená šípka pod lištou sa presunie pod aktuálny beat
  qCursor.style.left = (el.offsetLeft + el.offsetWidth / 2) + "px";
  qCursor.classList.add("show");
  return el;
}
function clearRoundCursor() {
  qBeatEls.forEach(e => e && e.classList.remove("q-now"));
  qCursor.classList.remove("show");
}
// pošli serveru aktuálnu rozpracovanú frontu + golden flagy (server ju pri timeoute zahrá a doplní chýbajúce)
function sendDraft() {
  if (!me || state?.phase !== "playing" || planning.lockedIn || state?.[me]?.locked) return;
  socket.emit("draft_queue", { queue: planning.myQueue, golden: planning.goldenArmed, goldenMirror: planning.goldenMirrorArmed, goldenMana: planning.goldenManaArmed, lastStand: planning.lastStandArmed, lastHope: planning.lastHopeArmed });
}
// zneaktívni tlačidlá akcií, ktoré už sú v queue (každá max 1× za kolo)
function updateActionButtons() {
  document.querySelectorAll(".controls button[data-act]").forEach(btn => {
    const type = btn.dataset.act.split(":")[0];
    // mirror slot = Special 1 (register mirrorSlot - Jotaro) → „used" podľa special1 a golden mirror ho NEZAMYKÁ
    const isJotaroMirror = type === "mirror" && CHARS_BY_KEY[ghostCharAt()]?.mirrorSlot === "special1";
    const effType = isJotaroMirror ? "special1" : type;
    const used = planning.myQueue.some(a => a.type === effType);
    btn.disabled = used; // skutočne navolené v kole = sivé „použité"
    // golden predťah blokuje bežnú akciu rovnakého druhu ZÁMKOM (nie ako „použité") - klik shake-ne cez poistku v handleri
    const goldenLock = ((type === "shield" && planning.goldenArmed) || (type === "mirror" && planning.goldenMirrorArmed)) && !isJotaroMirror;
    btn.classList.toggle("locked-golden", goldenLock && !used);
  });
  const moveUsed = planning.myQueue.some(a => a.type === "move");
  moveBtn.disabled = moveUsed;
  if (moveUsed) dirPicker.classList.add("hidden");
  const attackUsed = planning.myQueue.some(a => a.type === "attack");
  attackBtn.disabled = attackUsed;
  if (attackUsed) aimPicker.classList.add("hidden");
  const dashUsed = planning.myQueue.some(a => a.type === "dash");
  dashBtn.disabled = dashUsed;
  if (dashUsed) dashPicker.classList.add("hidden");
  if (attackUsed) aimPickerDiag?.classList.add("hidden"); // diagonálny aim picker (Countess/Onre)
  const meleeUsed = planning.myQueue.some(a => a.type === "melee");
  if (meleeBtn) meleeBtn.disabled = meleeUsed;
  // special už nemá data-act (kvôli Medúzinmu pickeru) - zneaktívni ho rovnako ako move/attack/dash
  const specialUsed = planning.myQueue.some(a => a.type === "special");
  specialBtn.disabled = specialUsed;
  if (specialUsed) { specialPicker.classList.add("hidden"); cellPicker?.classList.add("hidden"); wolfPicker?.classList.add("hidden"); }
}
function updateLockButton() {
  // Jotaro THE WORLD: počas plánovania zmrazenej trojice je button „EXECUTE" (ignoruj stale state[me].locked
  // z pôvodného locku kola - inak by ho renderQueue po prvej akcii zamkol a hráč by nemohol odoslať)
  if (playback.tsPlanning) {
    lockBtn.classList.remove("locked");
    lockBtn.textContent = "EXECUTE";
    lockBtn.disabled = false;
    lockBtn.classList.toggle("ready", planning.myQueue.length === 3);
    updateUiLocks();
    return;
  }
  const locked = !!state?.[me]?.locked;
  if (locked) {
    lockBtn.classList.add("locked"); lockBtn.textContent = "LOCKED"; lockBtn.disabled = true;
  } else {
    lockBtn.classList.remove("locked"); lockBtn.textContent = "LOCK IN"; lockBtn.disabled = false;
  }
  // počas prehrávania kola sa nedá lockovať (zabráni súbežným timeline)
  if (playback.playing && !locked) {
    lockBtn.disabled = true;
    lockBtn.classList.remove("ready");
    updateUiLocks();
    return;
  }
  // pulzuj, keď je queue plná a čaká sa už len na potvrdenie
  lockBtn.classList.toggle("ready", !locked && planning.myQueue.length === 3);
  updateUiLocks();
}

/* ---------- Winner helper ---------- */
function computeWinnerFromState(s) {
  const dead1 = !s?.p1 || s.p1.hp <= 0;
  const dead2 = !s?.p2 || s.p2.hp <= 0;
  if (dead1 && dead2) return "draw";
  if (dead1) return "p2";
  if (dead2) return "p1";
  return null;
}

/* ---------- GameOver sekvencia ---------- */
function showGameOverSequence(winner) {
  if (playback.gameOverShown) return;
  playback.gameOverShown = true;

  const loser = winner === "p1" ? "p2" : (winner === "p2" ? "p1" : null);

  // počkaj, kým dobehne posledná animácia útoku (ak nejaká beží)
  const now = performance.now();
  const lastEnd = Math.max(lastAttackEndAt.p1, lastAttackEndAt.p2);
  const waitAttack = Math.max(0, lastEnd - now);

  setTimeout(() => {
    // potom spusti animáciu smrti porazeného (ak nie je remíza)
    let afterDeathWait = 300;
    if (winner !== "draw" && loser) {
      setAnim(loser, "dead", 1200);
      afterDeathWait = 1300; // trvanie death + malý buffer
    }

    setTimeout(() => {
      // verdikt namiesto ROUND n v hud-turn - hlavné okno nič neprekrýva
      let verdict, cls;
      if (winner === "draw")        { verdict = "TIE"; cls = "tie"; }
      else if (me && winner === me) { verdict = "WINNER!"; cls = "win"; }
      else if (me)                  { verdict = "LOSER!"; cls = "lose"; }
      else                          { verdict = `${winner.toUpperCase()} WINS`; cls = "tie"; } // divák
      // pri sérii (BO3/BO5) doplň finálne skóre
      const ser = playback.serverGameResult?.series || state?.series;
      let scoreLine = "";
      if (ser && ser.format && ser.format !== "single") {
        // skóre drží strany (ľavá : pravá), rovnako ako koruny v HUD - nie „ja : oponent"
        scoreLine = `<span class="go-verdict tie">${ser.winsP1 ?? 0} : ${ser.winsP2 ?? 0}</span>`;
        renderSeriesCrowns(ser); // dokresli finálne koruny (server po match_over už neposiela state)
      }
      if (hudTurn) hudTurn.innerHTML = `GAME OVER<span class="go-verdict ${cls}">${verdict}</span>${scoreLine}`;
      // uprac overlay z poslednej akcie (special/melee cast) - po game over ho už renderGrid neuprace
      actorsEl.querySelectorAll(".special-center").forEach(n => n.remove());
      clearCharOverlays();
      // víťazova postavička spamuje cast animáciu priamo na svojom políčku (žiadny extra sprite)
      if (winner === "p1" || winner === "p2") setAnim(winner, "victory");
      goOverlay.classList.remove("hidden");
    }, afterDeathWait);
  }, waitAttack);
}

// animácia konca hry (smrť porazeného + víťazstvo) bez finálneho overlayu - pre medzihru série
function playGameEndAnim(winner, after) {
  const loser = winner === "p1" ? "p2" : (winner === "p2" ? "p1" : null);
  const now = performance.now();
  const lastEnd = Math.max(lastAttackEndAt.p1, lastAttackEndAt.p2);
  const waitAttack = Math.max(0, lastEnd - now);
  setTimeout(() => {
    let afterDeathWait = 300;
    if (winner !== "draw" && loser) { setAnim(loser, "dead", 1200); afterDeathWait = 1300; }
    actorsEl.querySelectorAll(".special-center").forEach(n => n.remove());
    clearCharOverlays();
    if (winner === "p1" || winner === "p2") setAnim(winner, "victory");
    setTimeout(() => { if (after) after(); }, afterDeathWait);
  }, waitAttack);
}

// medzikolová „ROUND N" animácia - round-script zostane vidieť, kým dobehne; potom callback resetuje lištu
function playNewRoundTransition(nextTurn, done) {
  if (!roundBannerEl) { setTimeout(done, NEW_ROUND_MS); return; }
  // ak ďalšie kolo je buffnuté (Last Stand) → „FINAL ROUND" + veľký démon tile (červený okraj) pod nápisom
  const final = !!state?.goldLocked;
  if (final) {
    roundBannerEl.innerHTML = 'FINAL ROUND<span class="rb-demon"><img src="/assets/last_stand.png" alt="" /></span>';
    playback.finalRoundActive = true; // text hore sa prepne až teraz (s bannerom)
  } else {
    roundBannerEl.textContent = `ROUND ${nextTurn}`;
  }
  roundBannerEl.classList.remove("hidden", "show");
  void roundBannerEl.offsetWidth; // reštart animácie
  roundBannerEl.classList.add("show");
  setTimeout(() => {
    roundBannerEl.classList.remove("show");
    roundBannerEl.classList.add("hidden");
    done();
  }, NEW_ROUND_MS);
}

/* ---------- Timeline prehrávanie ---------- */
// len na čítanie pre tools/browser-smoke.mjs (boti čakajú, kým divák dohrá timeline) - na hru bez vplyvu
Object.defineProperty(window, "__arenaPlaying", { get: () => playback.playing });

function schedulePlayTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return;

  const gen = ++playback.playGen;
  playback.playing = true;
  // Jotaro THE WORLD: nová timeline (vrátane pokračovacej po zmrazení) = pauza sa skončila; overlay + ts-queue
  // + stredový Special_3_P skry (u súpera to je moment „Jotaro klikol EXECUTE"); filter body.timestop-mode
  // nechaj - pokračovacia timeline ho zhasne až efektom timestop_end
  playback.tsPlanning = false; playback.tsFrozen = false; tsOverlaySet(false); hideTsQueue(); hideWorldCenter();
  hideConnError();  // kolo sa vyhodnotilo → prípadná hláška o chybe spojenia je už neaktuálna
  stopTurnTimer(); // kolo sa už vyhodnocuje (server poslal timeline) - zhasni prípadný stale časovač
  updateUiLocks(); // počas vyhodnocovania sú všetky tlačidlá zamknuté a stmavené

  clearActionLogs(); // záznam predošlého kola zmizne so začiatkom nového
  clearProjectiles(); // žiadne staré projektily nesmú prejsť do nového kola
  escPrideDisplay = { p1: null, p2: null }; // zruš prípadné podržanie starej veľkosti z minulého kola
  escPrideDisplayChar = { p1: null, p2: null };

  const first = timeline[0];
  // levelová veľkosť (Escanor pride / Vlkolakova fáza mesiaca) pred kolom - na konci prehrávania porovnáme
  // s novou hodnotou → float (lev ▲▼ / nová fáza mesiaca)
  const lvlOf = (a) => SIZE_LEVEL[a?.char] ? (a[SIZE_LEVEL[a.char].stat] ?? 0) : null;
  const preLvl = { p1: lvlOf(first.p1), p2: lvlOf(first.p2) };
  const preChar = { p1: first.p1?.char || null, p2: first.p2?.char || null }; // char na začiatku kola (swap ho zmení)
  // drž veľkosť podľa levelu NA ZAČIATKU kola cez celé kolo (nová veľkosť sa aplikuje až po kole, keď sa
  // ukáže float) - inak by posledný frame (s novým levelom) zmenil veľkosť ešte pred floatom
  for (const slot of ["p1", "p2"]) if (preLvl[slot] != null) { escPrideDisplay[slot] = preLvl[slot]; escPrideDisplayChar[slot] = preChar[slot]; }
  // kurzor v lište: poradie beatov sa zhoduje so serverovým resolveTurn (štartér je prvý v dvojici)
  const playStarter = first.starter ?? state?.starter ?? "p1";
  // beat counts prežijú pauzu THE WORLD: pokračovacia timeline (playback.tsResumePending) NEresetuje číslovanie,
  // takže kurzor po obnovení času skočí na akciu VPRAVO od THE WORLD (nie na začiatok lišty)
  if (!playback.tsResumePending) playback.roundBeatCounts = { p1: 0, p2: 0 };
  playback.tsResumePending = false;
  const beatCounts = playback.roundBeatCounts;
  // posledná zaznamenaná akcia per slot (badge v logu + beat v lište) - keď príde "invalid", prečiarkneme ju
  const lastActed = { p1: null, p2: null };
  state.p1 = first.p1; state.p2 = first.p2; state.turn = first.turn; state.starter = (first.starter ?? state.starter);
  state.tiles = first.tiles; state.iks = first.iks; state.pending = first.pending;
  renderHUD();
  const NEXT_TURN = (first.turn ?? state.turn) + 1;
  const NEXT_STARTER = playStarter === "p1" ? "p2" : "p1"; // preklop (hru môže začínať aj p2)
  renderGrid(state, first.effects || []);
  positionActors(state, true);

  // úvod kola z registra fx (Escanor: RAZ premena WeakIdle→Stand pred prvými akciami, zruší zvyšky slnka) -
  // timeline sa oneskorí o najdlhší úvod
  const preDelay = Math.max(0, ...fxAll("roundIntro"));

  let i = 1;
  let prev = first;

  const step = () => {
    if (gen !== playback.playGen) return; // medzitým začala novšia timeline - túto slučku ukonči

    if (i >= timeline.length) {
      playback.playing = false;

      // Escanor/Vlkolak: level sa po kole zmenil → veľkosť je stále držaná na starej (od začiatku kola);
      // ukáž float nad ním (lev ▲▼ / nová fáza mesiaca) a AŽ POTOM (po pauze) pusti na novú veľkosť
      // (plynulý prechod). Bez zmeny → hneď pusti hold. Iná postava (swap) → hold len zruš.
      for (const slot of ["p1", "p2"]) {
        const nowLvl = lvlOf(state?.[slot]);
        // swap v strede kola (char sa zmenil) → žiadny float, len pusti držanie starej postavy na novú veľkosť
        const charChanged = (state?.[slot]?.char || null) !== preChar[slot];
        if (nowLvl === null || charChanged) { escPrideDisplay[slot] = null; escPrideDisplayChar[slot] = null; continue; }
        if (preLvl[slot] != null && nowLvl !== preLvl[slot]) {
          // float z registra fx (Escanor: lev ▲▼ NAD ním, veľkosť ešte stará; vlkolak: len nová fáza mesiaca)
          CHAR_FX[state[slot].char]?.levelFloat?.(slot, nowLvl, nowLvl > preLvl[slot]);
          const sl = slot;
          setTimeout(() => { escPrideDisplay[sl] = null; positionActors(state); }, 650); // potom plynulé zväčšenie/zmenšenie
        } else {
          escPrideDisplay[slot] = null; // bez zmeny levelu - pusti hold
        }
      }

      // koniec hry: ak séria pokračuje -> medzihra; ak je rozhodnutá -> game over
      const winner = playback.serverWinner || playback.serverGameResult?.gameWinner || computeWinnerFromState(state);
      if (winner) {
        clearRoundCursor();
        // banish/summon: démon ešte chvíľu drží, potom zmizne - stredový AJ ten za postavou
        // (koniec hry = žiadny démon na ploche, nech už jeho animácie dopadli akokoľvek)
        setTimeout(() => { hideDeathCenter(); hideDeathBehind(); }, 700);
        if (playback.serverGameResult && !playback.serverGameResult.matchOver) {
          playGameEndAnim(winner, () => showIntermission(winner, playback.serverGameResult.series, me));
        } else {
          showGameOverSequence(winner);
        }
        return;
      }

      // bežný koniec kola: round-script (odhalení súperi + kurzor) nechaj vidieť, prehraj
      // „ROUND N" animáciu a až po nej resetuj lištu na ďalšie kolo
      const doneGen = gen;
      playNewRoundTransition(NEXT_TURN, () => {
        if (doneGen !== playback.playGen) return; // medzitým začalo nové prehrávanie - neresetuj
        state.turn = NEXT_TURN;
        state.starter = NEXT_STARTER;
        renderHUD();
        if (state.p1) state.p1.locked = false;
        if (state.p2) state.p2.locked = false;
        renderGrid(state, []);
        planning.myQueue = [];
        planning.goldenArmed = false;
        planning.goldenMirrorArmed = false;
        planning.goldenManaArmed = false;
        planning.lastStandArmed = false;
        planning.lastHopeArmed = false;
        planning.lockedIn = false; // kolo dobehlo - odomkni ovládanie
        resetActorFade(); // po teleporte vráť plnú viditeľnosť postáv pre ďalšie kolo
        syncGoldenHalves();
        syncGoldDualHalves();
        renderQueue(); // až teraz vyčisti round-script pre ďalšie kolo
        lockBtn.disabled = false;
        updateLockButton();
        // časovač ďalšieho kola príde zo servera (turn_timer); displej sa zapne po dohraní timeline
      });
      return;
    }

    const frame = timeline[i++];
    // pózu neslučkovej animácie držíme presne po dobu, čo je tento frame na obrazovke (žiadny presah do ďalšej akcie)
    const frameHold = frame.delayMs ?? 600;

    const beforeP1 = prev?.p1 || state.p1;
    const beforeP2 = prev?.p2 || state.p2;

    state.p1 = frame.p1; state.p2 = frame.p2;
    state.tiles = frame.tiles; state.iks = frame.iks; state.pending = frame.pending;
    if (frame.starter !== undefined) {
      state.starter = frame.starter;
    }
    renderHUD();

    // run aj pri pohybe KLONA (animState je zdieľaný - klon zrkadlí majiteľovu animáciu)
    const cloneMoved = (b, f) => !!(b?.clone && f?.clone && (b.clone.x !== f.clone.x || b.clone.y !== f.clone.y));
    // pohyb postavy pre register fx (Jotarov stand: dash = beh za Jotarom, MOVE = zmizne a zjaví sa na novej bunke)
    const noteStandLoco = (slot, before, frm) => CHAR_FX[frm?.char]?.moved?.(slot, before, frm);
    // Luffy priťiahnutie: ťahaný súper sa NEmá rozbehnúť (nech to nevyzerá, že tam sám beží) - drž ho
    // v idle, len sa sklzne k Luffymu. Ťahaný = súper toho, kto pull vyvolal (e.from).
    const pullEff = (frame.effects || []).find(e => e.kind === "luffy_pull" && (e.from === "p1" || e.from === "p2"));
    const pulledSlot = pullEff ? (pullEff.from === "p1" ? "p2" : "p1") : null;
    if (beforeP1 && (beforeP1.x !== frame.p1.x || beforeP1.y !== frame.p1.y || cloneMoved(beforeP1, frame.p1))) { setAnim("p1", pulledSlot === "p1" ? "idle" : "run", MOVE_MS); noteStandLoco("p1", beforeP1, frame.p1); }
    if (beforeP2 && (beforeP2.x !== frame.p2.x || beforeP2.y !== frame.p2.y || cloneMoved(beforeP2, frame.p2))) { setAnim("p2", pulledSlot === "p2" ? "idle" : "run", MOVE_MS); noteStandLoco("p2", beforeP2, frame.p2); }

    const shooters = new Set(); // basic strela - jednorazová póza
    const casters  = new Set(); // special - looping, malá postava sa animuje súbežne s veľkým sprite-om
    let tsWait = false;         // Jotaro THE WORLD: tento frame je koniec čiastočnej timeline → pauza
    for (const e of frame.effects || []) {
      // poistka: výnimka v JEDNOM efekte nesmie zaseknúť prehrávanie celého kola (step() beží cez setTimeout -
      // neodchytený throw by reťaz natrvalo prerušil a UI by ostalo zamknuté uprostred kola)
      try {
      if ((e.kind === "charge" || e.kind === "attack_swing") && e.from) shooters.add(e.from);
      // útok do steny (strela nemá kam letieť) - útočná póza sa zahrá cez `shooters`, sem len whiff float;
      // akcia sa NEprečiarkne (minula manu a „vykonala sa"), na rozdiel od starého OFF-BOARD invalidu
      if (e.kind === "attack_swing" && e.offboard && (e.from === "p1" || e.from === "p2")) {
        const [msg, cls] = INVALID_MSG.offboard;
        spawnFloat(e.from, msg, cls);
        cloneFloat(e.from, msg, cls);
      }
      // postava s vlastným stredom specialu (register fx ownCenter - Escanor: vlastná choreografia slnka;
      // Jotaro: figúra hrá Attack_2 a útok vizuálne vedie stand) nie je center-cast
      if (e.kind === "special" && e.from && !fxOwnsCenter(state?.[e.from]?.char, "special")) casters.add(e.from);
      // Jotaro THE WORLD: cast → menace (Special_3_P) hrá v NORMÁLNYCH farbách; čas sa zamrazí (filter +
      // zmrazenie animácií) AŽ po dohraní menace - pri timestop_wait v enterTimestopMode. wait → pauza;
      // ts_hit/ts_mirror → announce float nad zmrazeným súperom (bez zmeny HP); end → vypni filter
      if (e.kind === "timestop_start" && (e.from === "p1" || e.from === "p2")) {
        spawnWorldCenter(e.from); // veľký stredový „menace" sprite (Special_3_P) - hrá až kým nezastane
      }
      if (e.kind === "timestop_wait") tsWait = true;
      if (e.kind === "ts_hit" && (e.target === "p1" || e.target === "p2")) spawnFloat(e.target, `-${e.dmg} HP`, "ts-float");
      if (e.kind === "ts_mirror" && (e.target === "p1" || e.target === "p2")) spawnFloat(e.target, "MIRRORED", "ts-float");
      if (e.kind === "timestop_end") {
        document.body.classList.remove("timestop-mode");
        playback.tsActive = false; playback.tsJotaroSlot = null; hideWorldCenter(); // čas sa rozbehol - animácie zas bežia
      }
      // strelec sa otočí v smere horizontálnej streľby (vertikálna facing nemení; diagonály podľa
      // horizontálnej zložky - Countess/Onre strieľajú šikmo)
      if (e.kind === "charge" && typeof e.dir === "string" && (e.from === "p1" || e.from === "p2")) {
        const sx = e.dir.includes("left") ? -1 : e.dir.includes("right") ? 1 : 0;
        if (sx) facingOverride[e.from] = { sx, until: performance.now() + frameHold + POSE_TAIL_MS };
      }
      // Medúzin/Escanorov special má smer - počas castu je otočená v smere pohľadu, nie na súpera
      if (e.kind === "special" && (e.dir === "left" || e.dir === "right") && (e.from === "p1" || e.from === "p2")) {
        facingOverride[e.from] = { sx: e.dir === "left" ? -1 : 1, until: performance.now() + frameHold + POSE_TAIL_MS };
      }
      // Countess/Onre: beh melee-charge (Run) - otočenie podľa horizontálnej zložky smeru
      if (e.kind === "vamp_charge" && (e.from === "p1" || e.from === "p2")) {
        setAnim(e.from, "vamprun", frameHold);
        lastAttackEndAt[e.from] = performance.now() + frameHold;
        const sx = e.dir === "left" ? -1 : e.dir === "right" ? 1 : 0;
        if (sx) facingOverride[e.from] = { sx, until: performance.now() + frameHold + POSE_TAIL_MS };
      }
      // Countess/Onre: seknutie na bunke terča - po dobehnutí charge alebo po teleporte pasce.
      // Anim hint zo servera: Countess = va1 (A1 - krvavý bolt zapečený vo framoch, žiadne extra FX),
      // Onre trap = vattack1 (Attack_1), Onre charge = default vampstrike (alias Attack_3)
      if (e.kind === "vamp_strike" && (e.from === "p1" || e.from === "p2")) {
        const key = e.anim && ANIM_DEF[e.anim] ? e.anim : "vampstrike";
        setAnim(e.from, key, frameHold);
        lastAttackEndAt[e.from] = performance.now() + frameHold;
      }
      // Countess: liečivé beaty po dopadnutom melee/trap dmg (A2 → A3 → A4, krvavé efekty vo framoch) -
      // HP sa doplnia až po nich
      if (e.kind === "vamp_heal_cast" && (e.from === "p1" || e.from === "p2")) {
        const key = e.anim && ANIM_DEF[e.anim] ? e.anim : "va2";
        setAnim(e.from, key, frameHold);
        lastAttackEndAt[e.from] = performance.now() + frameHold;
      }
      // pasca položená - značku kreslí renderGrid zo state[slot].trap; float vidí len caster
      // (súperovi server trap_set efekt aj trap v dátach rediguje)
      if (e.kind === "trap_set" && Array.isArray(e.cell)) {
        spawnCellFloat(e.cell, "🩸 TRAP SET", "trap-float");
      }
      // trigger pasce - bunka sa rozžiari (trap-flash rieši renderGrid), float vidia OBAJA
      if (e.kind === "trap_trigger" && Array.isArray(e.cell)) {
        spawnCellFloat(e.cell, "🩸 TRAP!", "trap-float");
      }
      // zničenie pasce (vlastný vstup castera / petrifikovaný caster / rituálna smrť) - vidia OBAJA:
      // súper sa dozvedá, že riziko pasce pominulo
      if (e.kind === "trap_break" && Array.isArray(e.cell)) {
        spawnTrapBreak(e.cell);
      }
      // teleport pasce: caster zmizne na svojej bunke (OUT - pozícia sa mení až IN frame-om)…
      // oblak je krvavočervený (blood=true) - téma Vampire/Onryō, nie Narutov biely dym
      if (e.kind === "trap_tp_out" && (e.from === "p1" || e.from === "p2")) {
        const p = state?.[e.from];
        if (p && p.x != null) spawnClonePuff([p.x, p.y], true);
        fadeActor(e.from, 1, 0, frameHold);
      }
      // …a objaví sa na bunke pasce (IN) - pozíciu snapni (teleport nesmie kĺzať cez board);
      // Onre sa zjavuje s výkrikom (Scream) - bez behania, rovno na bunke pasce
      if (e.kind === "trap_tp_in" && (e.from === "p1" || e.from === "p2")) {
        positionActors(state, true);
        const p = state?.[e.from];
        if (p && p.x != null) spawnClonePuff([p.x, p.y], true);
        fadeActor(e.from, 0, 1, frameHold);
        // zjavenie bez behania v idle - zruš auto-run z posunu pozície (Onre s výkrikom: register fx, effect nižšie)
        setAnim(e.from, "idle");
      }
      // trigger bez many na útok - teleport prebehol, úder nepadol (LOW MANA float bez prečiarknutia)
      if (e.kind === "trap_no_mana" && (e.target === "p1" || e.target === "p2")) {
        const [msg, cls] = INVALID_MSG.mana;
        spawnFloat(e.target, msg, cls);
        const bar = e.target === "p1" ? hudP1Mana : hudP2Mana;
        if (bar) {
          bar.classList.remove("low-warn");
          void bar.offsetWidth;
          bar.classList.add("low-warn");
          setTimeout(() => bar.classList.remove("low-warn"), 1000);
        }
      }
      // Onre: drain many - súperovi ČERVENÝ „−N MANA" (strata), Onremu modrý „+N MANA" (prírastok);
      // rovnaké znenie ako gain float, nech je z textu aj farby jasné, komu efekt patrí. Prírastok je
      // oneskorený - po charge stoja obaja na TEJ ISTEJ bunke a floaty by sa prekryli; takto sa číta
      // sekvencia „súper stráca → Onryō získava"
      if (e.kind === "mana_drain" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, `−${e.drained ?? 0} MANA`, "drain-float");
        if (e.from && (e.gained ?? 0) > 0) setTimeout(() => spawnManaFloat(e.from, e.gained), 400);
      }
      // choreografia autora efektu (register fx: public/chars/fx/<key>.js - Vojak, Vlkolak, Luffy, …)
      CHAR_FX[state?.[e.from]?.char]?.effect?.(e, frameHold);
      if (e.kind === "melee" && (e.from === "p1" || e.from === "p2")) {
        // looping → malá postava sa seká súbežne s veľkým sprite-om (re-triggered každý beat); Medúza = Attack_1
        // (Countess sem už nechodí - jej center melee je jednotný vamp_strike s A1)
        setAnim(e.from, ACTION_ANIMS[state?.[e.from]?.char]?.melee || "attack2_loop", frameHold);
        lastAttackEndAt[e.from] = performance.now() + frameHold;
      }
      if (e.kind === "hit" && (e.target === "p1" || e.target === "p2")) {
        setAnim(e.target, "hurt", frameHold);
        // POWER tile bonus: extra dmg z tile ide ako SAMOSTATNÝ zlatý „⚡-2" float (hlavný float ukazuje
        // základ bez bonusu, HP samozrejme klesli o súčet) - bonus je v e.dmg/e.parts[0] už zarátaný
        const bonus = (typeof e.bonus === "number" && e.bonus > 0) ? e.bonus : 0;
        // stacknutý Naruto+klon = súbežné zásahy spojené do jedného úderu → vypíš rozpis „-3 -3 HP"
        if (Array.isArray(e.parts) && e.parts.length > 1 && e.parts.reduce((a, b) => a + b, 0) > 0) {
          const parts = bonus ? [Math.max(0, e.parts[0] - bonus), ...e.parts.slice(1)] : e.parts;
          spawnFloat(e.target, `-${parts.join(" -")} HP`, "dmg-float");
        } else if (typeof e.dmg === "number" && e.dmg - bonus > 0) {
          spawnDamageFloat(e.target, e.dmg - bonus);
        }
        // zlatý float mierne oneskorený, nech sa neprekryje s hlavným
        if (bonus) { const tgt = e.target; setTimeout(() => spawnFloat(tgt, `⚡ -${bonus}`, "power-float"), 280); }
      }
      if (e.kind === "invalid" && (e.target === "p1" || e.target === "p2")) {
        // flinch (nie hurt) - klon ho zrkadlí, takže pri neplatnej akcii trhnú obaja Naruti rovnako
        setAnim(e.target, "flinch", frameHold);
        // nevykonaná akcia - prečiarkni práve zaznamenaný badge (log) aj beat (lišta) jemným červeným ✕
        const acted = lastActed[e.target];
        if (acted) {
          acted.logEl?.classList.add("act-invalid");
          acted.beatEl?.classList.add("act-invalid");
        }
        // vždy zobraz dôvod (aj neznámy → default), nech žiadna nevykonaná akcia nie je „tichá“
        const [msg, cls] = INVALID_MSG[e.reason] || INVALID_MSG_DEFAULT;
        spawnFloat(e.target, msg, cls);
        cloneFloat(e.target, msg, cls); // rovnaká hláška nad klonom - nesmie prezradiť, ktorý je pravý
        // nedostatok many - navyše výrazná výstraha: bliknutie mana baru v HUD
        if (e.reason === "mana") {
          const bar = e.target === "p1" ? hudP1Mana : hudP2Mana;
          if (bar) {
            bar.classList.remove("low-warn");
            void bar.offsetWidth; // restart animácie pri opakovanej výstrahe
            bar.classList.add("low-warn");
            setTimeout(() => bar.classList.remove("low-warn"), 1000);
          }
        }
      }
      // náraz do steny - figúra (Naruto ALEBO jeho klon), ktorá sa daným smerom nedá pohnúť, sa strhne
      // k stene + OUT OF BOUNDS; tá druhá sa medzitým pohla. e.clone === true → náraz je na klonovi.
      if (e.kind === "wall_bump" && (e.from === "p1" || e.from === "p2")) {
        const onClone = e.clone === true;
        const el = onClone ? cloneEls[e.from] : (e.from === "p1" ? actorP1 : actorP2);
        // aj diagonálne smery - vlkolakov charge do steny z okrajovej bunky (wall pravidlo)
        const d = WOLF_DIRS_CLIENT[e.dir] || [0,0];
        // translate sa skladá „add" na základný transform (translateX(shift) scaleX(scale)) - scaleX prevracia X,
        // preto horizontálny náraz násobíme znamienkom facingu, aby smeroval do skutočnej steny
        const scale = computeFacing(state?.p1, state?.p2)[e.from] || 1;
        const nx = d[0] * 14 * scale, ny = d[1] * 14;
        if (el && el.style.display !== "none") {
          el.animate(
            [{ transform: "translate(0,0)" }, { transform: `translate(${nx}px,${ny}px)`, offset: 0.4 }, { transform: "translate(0,0)" }],
            { duration: Math.min(frameHold, 420), easing: "ease-out", composite: "add" }
          );
        }
        if (onClone) {
          const c = state?.[e.from]?.clone;
          if (c) spawnCellFloat([c.x, c.y], "🚫 OUT OF BOUNDS", "lowmana-float");
        } else {
          spawnFloat(e.from, "🚫 OUT OF BOUNDS", "lowmana-float");
        }
      }
      if (e.kind === "recharge" && (e.from === "p1" || e.from === "p2")) {
        const amt = (typeof e.amount === "number" ? e.amount : 4);
        const dark = !!e.dark; // Pútnikova pasívna mana = tá istá animácia, len celá v čiernej
        spawnManaFloat(e.from, amt, false, dark);
        spawnChargeAura(e.from, false, false, "actor", dark); // „Goku" nabíjacia aura na postave
        const rechAnim = ACTION_ANIMS[state?.[e.from]?.char]?.recharge; // vlastná recharge póza (Vojak)
        if (rechAnim) setAnim(e.from, rechAnim, frameHold);
        // klon sa „nabíja" naprázdno tiež - aura+float na oboch, nech recharge neprezradí pravého
        cloneFloat(e.from, `+${amt}`, dark ? "mana-float dark" : "mana-float");
        spawnChargeAura(e.from, false, false, "clone", dark);
      }
      // Fire Wizard skonzumoval Damage dlaždicu (boost zo specialu) / caster POWER tile - krátky flare na bunke
      if (e.kind === "tile_consume" && Array.isArray(e.cell)) {
        spawnTileConsumeFx(e.cell, e.tile);
      }
      // Pútnik použil mirror → nedostal pasívnu manu; float, nech hráč vie prečo
      if (e.kind === "wanderer_no_regen" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, "🪞 MIRROR USED", "wander-nomana-float");
      }
      // skamenený ťah - akcia sa nevykonala: prečiarkni práve zaznamenaný badge/beat + STONED float
      if (e.kind === "stoned" && (e.target === "p1" || e.target === "p2")) {
        const acted = lastActed[e.target];
        if (acted) {
          acted.logEl?.classList.add("act-invalid");
          acted.beatEl?.classList.add("act-invalid");
        }
        spawnFloat(e.target, "🗿 STONED", "stone-float");
      }
      // PASS (vypršaný čas, nevyplnený slot): postava „premýšľa" + úbytok many (oneskorený, nech sa floaty neprekryjú)
      if (e.kind === "pass" && (e.from === "p1" || e.from === "p2")) {
        spawnFloat(e.from, "💭 THINKING", "think-float");
        if ((e.mana ?? 0) > 0) { const who = e.from, m = e.mana; setTimeout(() => spawnFloat(who, `−${m} MANA`, "drain-float"), 400); }
      }
      // zásah Medúziným specialom - postava skamenie (sivú sochu kreslí raf zo state.stone)
      if (e.kind === "petrify" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, "🗿 PETRIFIED", "stone-float");
      }
      // odkamenenie - socha sa roztrieští (kamenné úlomky) namiesto obyčajného prebliku späť do normálu
      if (e.kind === "unpetrify" && (e.target === "p1" || e.target === "p2")) {
        spawnStoneShatter(e.target);
      }
      // Minotaurov special - zasiahnutý blúdi v labyrinte (hmlu/niť kreslí renderGrid zo state.labyrinth/thread)
      if (e.kind === "labyrinth" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, "🌀 LOST IN THE LABYRINTH", "maze-float");
      }
      // vzájomný zásah - labyrint končí, board sa prekliatemu odhalí (stav to už nesie, float len ohlási)
      if (e.kind === "labyrinth_end" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, "🌀 ESCAPED THE LABYRINTH", "maze-float");
      }
      // istý zásah ukončí labyrint - server odhalil všetko už PRED animáciou akcie (frame nesie plné dáta):
      // skrytý súper sa prekliatemu zjaví z tmy (fade ako démon/teleport), widget sa odkryl cez state.labReveal
      if (e.kind === "labyrinth_reveal" && (e.target === "p1" || e.target === "p2")) {
        if (me === e.target) fadeActor(otherSlot(), 0, 1, frameHold);
        spawnFloat(e.target, "🌀 REVEALED!", "maze-float");
      }
      // súper vstúpil na Ariadninu niť - perzistentný obrys kreslí raf zo state.threadMark; navyše
      // preblik obrysu na KAŽDEJ prejdenej niťovej bunke - okrem mojej vlastnej (tam lovca vidím naživo/lit,
      // ten sa rieši fade-om v raf, nie preblikom). Žiadne textové/emoji floaty.
      if (e.kind === "thread_mark" && Array.isArray(e.cell)) {
        if (me === e.target) {
          const oppS = otherSlot();
          const oppChar = oppS ? state?.[oppS]?.char : null;
          const mine = state?.[me];
          const onMyCell = mine && mine.x === e.cell[0] && mine.y === e.cell[1];
          if (oppChar && !onMyCell) spawnSilhouetteFlash(e.cell, oppChar, oppS);
        }
      }
      if (e.kind === "shield" && (e.from === "p1" || e.from === "p2")) {
        spawnFloat(e.from, "🛡️ SHIELD", "shield-float");
        cloneFloat(e.from, "🛡️ SHIELD", "shield-float"); // klon „bráni" tiež - float nesmie prezradiť pravého
      }
      if (e.kind === "mirror_on" && (e.from === "p1" || e.from === "p2")) {
        spawnFloat(e.from, "🪞 MIRROR", "shield-float");
        cloneFloat(e.from, "🪞 MIRROR", "shield-float");
      }
      // Naruto: summon klona - postava + 1 kópia na tej istej bunke tvárou v tvár hrajú Special_2
      if (e.kind === "clone_summon" && (e.from === "p1" || e.from === "p2")) {
        setAnim(e.from, "special2", frameHold);
        lastAttackEndAt[e.from] = performance.now() + frameHold;
        spawnCloneSummonFx(e.from, e.cell, frameHold);
      }
      if (e.kind === "clone_born" && (e.from === "p1" || e.from === "p2") && Array.isArray(e.cell)) {
        cloneDead[e.from] = false; // nový klon žije - zruš „mŕtvy" príznak
        spawnCellFloat(e.cell, "👥 SHADOW CLONE", "maze-float");
      }
      // klon zasiahnutý - puffne v OBLAKU DYMU a natrvalo zmizne (žiadny problik späť)
      if (e.kind === "clone_die" && (e.target === "p1" || e.target === "p2")) {
        cloneDead[e.target] = true;           // positionActors ho odteraz drží skrytého
        const cEl = cloneEls[e.target];
        if (cEl) { cEl.getAnimations().forEach(a => a.cancel()); cEl.style.display = "none"; } // sprite hneď preč (dym ho prekryje)
        if (Array.isArray(e.cell)) spawnClonePuff(e.cell);
      }
      // kozmetický tile dmg na klonovi (dmg tile klona nezabíja) - klon sa MUSÍ strhnúť a floatnúť ako pravý,
      // inak by „nezraniteľná" figúrka prezradila, ktorý je klon. Súperovi ukáž „-N HP" (bluff = ako pravý zásah),
      // vlastnému hráčovi „-N" (pravda - je to len kozmetika, HP mu neklesá).
      if (e.kind === "clone_hit" && Array.isArray(e.cell) && (e.target === "p1" || e.target === "p2")) {
        const ownerView = me === e.target;
        spawnCellFloat(e.cell, ownerView ? `-${e.dmg ?? 1}` : `-${e.dmg ?? 1} HP`, "dmg-float");
        cloneFlinch[e.target] = performance.now();
      }
      if (e.kind === "mirror" && (e.target === "p1" || e.target === "p2")) {
        // odraz na KLONOVI (e.cell) vychádza z klonovej bunky, nie z pravého Naruta - inak by prezradil skutočného
        // e.destCell: útok vystrelil útočníkov klon → odraz letí DO klonovej bunky (nie do pravého útočníka)
        spawnMirrorReflect(e.target, e.dmg, e.atk, !!e.gold, Array.isArray(e.cell) ? e.cell : null,
          Array.isArray(e.destCell) ? e.destCell : null);
        if (Array.isArray(e.cell)) spawnCellFloat(e.cell, "🪞 REFLECTED!", e.gold ? "mirror-reflect-text gold" : "mirror-reflect-text");
        else spawnFloat(e.target, "🪞 REFLECTED!", e.gold ? "mirror-reflect-text gold" : "mirror-reflect-text");
      }
      if (e.kind === "golden_shield" && (e.from === "p1" || e.from === "p2")) {
        // navonok je to SHIELD, len zlatý - "golden shield" je interné pomenovanie
        spawnFloat(e.from, "🛡️ SHIELD", "golden-float");
        cloneFloat(e.from, "🛡️ SHIELD", "golden-float"); // klon nesmie prezradiť pravého
      }
      if (e.kind === "golden_mirror" && (e.from === "p1" || e.from === "p2")) {
        // navonok je to MIRROR, len zlatý (predťah) - odraz padne neskôr cez mirror frame
        spawnFloat(e.from, "🪞 MIRROR", "golden-float");
        cloneFloat(e.from, "🪞 MIRROR", "golden-float");
      }
      if (e.kind === "golden_mana" && (e.from === "p1" || e.from === "p2")) {
        // rovnaký efekt ako bežná mana (recharge), len v zlatej farbe
        spawnManaFloat(e.from, e.gained ?? 6, true);
        spawnChargeAura(e.from, true);
        spawnChargeAura(e.from, true, false, "clone"); // zlatá aura aj na klonovi
        if (e.hpCost) spawnDamageFloat(e.from, e.hpCost); // HP cena golden many ostáva viditeľná
      }
      // Last Stand - FRAME-DRIVEN: každá fáza je efekt vo svojom frame; WAAPI trvanie = frameHold (= delayMs),
      // takže to v pozadí pauzne/dobehne rovnako ako timeline. HP sa hýbe zo snapshotov (drain/rise), nie lokálne.
      // Démon útok (buffnutý hráč): veľký démon v strede je jediná show - postavička stojí v idle (žiadna casting póza)
      if (e.kind === "demon_summon" && (e.from === "p1" || e.from === "p2")) {
        demonCenterAppear();
      }
      if (e.kind === "demon_center_out" && (e.from === "p1" || e.from === "p2")) {
        demonCenterDisappear();
      }
      // Teleport (výmena maga) - dvojfázovo, postava fade-uje plynulo (ako démon):
      // OUT: starý mág plynulo MIZNE (1→0), IN: nový sa plynulo OBJAVUJE (0→1).
      // Explózia je v OBOCH fázach rovnako semi-transparentná (0.75), nech pôsobí konzistentne.
      if (e.kind === "teleport_out" && (e.from === "p1" || e.from === "p2")) {
        fadeActor(e.from, 1, 0, frameHold);
        playTeleportExplosion(e.from, e.char, frameHold, 0.75);
      }
      if (e.kind === "teleport_in" && (e.from === "p1" || e.from === "p2")) {
        fadeActor(e.from, 0, 1, frameHold);
        playTeleportExplosion(e.from, e.char, frameHold, 0.75);
      }
      // Last Hope: červená „hope" postava v strede → HP→1, mana→10 (HUD zo snapshotov) → zmizne, červený ultra mód ostáva
      if (e.kind === "last_hope_summon" && (e.from === "p1" || e.from === "p2")) {
        hopeCenterAppear();
        spawnChargeAura(e.from, false, true); // červená aura hneď (HUD je už v červenom móde z lastHopeBuff)
      }
      if (e.kind === "last_hope_settle" && (e.from === "p1" || e.from === "p2")) {
        hopeCenterDisappear();
        spawnChargeAura(e.from, false, true); // ďalší červený záblesk
      }
      if (e.kind === "last_stand_summon" && (e.from === "p1" || e.from === "p2")) {
        lsCenterAppear(); // démon sa vynorí v strede
      }
      if (e.kind === "last_stand_kill" && (e.from === "p1" || e.from === "p2")) {
        lsCenterDisappear(); // stredový démon zmizne (smrť/ležanie rieši st.down v raf)
      }
      if (e.kind === "last_stand_revive" && (e.from === "p1" || e.from === "p2")) {
        // démon sa objaví ZA postavou - opacity cez CSS transition (0→1); počas revive/rise hráč LEŽÍ (st.down=true),
        // takže raf sa démona nedotýka. Settle (down=false) potom v rafe plynulo stmaví na 0.25.
        _lsBanishing = false;
        placeDeathBehind(e.from);
        deathBehind.style.filter = "drop-shadow(0 0 16px #ffd24a)";
        deathBehind.style.opacity = "1"; // CSS transition spraví plynulý nábeh z 0
      }
      if (e.kind === "last_stand_banish" && (e.from === "p1" || e.from === "p2")) {
        // zelená šípka nadíde na démon „end" bunku (krokovanie), potom prebehne banishment
        const demonEl = qBeatEls[7];
        if (demonEl) {
          qBeatEls.forEach(x => x && x.classList.remove("q-now"));
          demonEl.classList.add("q-now");
          qCursor.style.left = (demonEl.offsetLeft + demonEl.offsetWidth / 2) + "px";
          qCursor.classList.add("show");
        }
        // KROK 1: golden OFF (raf to drží cez _lsBanishing) + zhasni bežiace aury; duch zosilnie 0.25→1 a odíde
        _lsBanishing = true;
        _deathGoldenSlot = null;
        hudBoxP1.classList.remove("death-golden"); hudBoxP2.classList.remove("death-golden");
        document.querySelectorAll(".charge-aura.gold").forEach(n => n.remove());
        placeDeathBehind(e.from);
        deathBehind.getAnimations().forEach(a => a.cancel());
        const a = deathBehind.animate([
          { opacity: DEATH_SEQ.behindOpacity, transform: `scale(${DEATH_SEQ.behindRatio})` },
          { opacity: 1, transform: `scale(${DEATH_SEQ.behindRatio})`, offset: .5 },
          { opacity: 0, transform: `scale(${(DEATH_SEQ.behindRatio * 0.92).toFixed(3)})` },
        ], { duration: frameHold, easing: "ease-in", fill: "forwards" });
        a.onfinish = () => { deathBehind.style.opacity = "0"; };
      }
      if (e.kind === "last_stand_banish_center" && (e.from === "p1" || e.from === "p2")) {
        lsCenterAppear(); // duch sa objaví v strede
      }
      if (e.kind === "last_stand_banish_kill" && (e.from === "p1" || e.from === "p2")) {
        lsCenterDisappear(); // smrť/ležanie rieši st.down v raf
      }
      if (e.kind === "action" && (e.from === "p1" || e.from === "p2")) {
        // THE WORLD zmrazená akcia (frozen) - len ju animuj na boarde; round-script kurzor ostáva na THE WORLD
        // (nezaráta sa do beatCounts/logu), tracker tak počas celého time-stopu stojí na akcii THE WORLD
        if (!e.frozen) {
          const logEl  = appendActionLog(e.from, e.action);
          const beatEl = highlightRoundBeat(e.from, e.action, beatCounts, playStarter); // posuň kurzor + odhal súpera
          lastActed[e.from] = { logEl, beatEl }; // ak hneď príde "invalid", prečiarkneme práve tieto
        }
      }
      // prázdny gold beat (golden shield/mirror = pos 0, golden mana = 7/8) - len posuň zelenú šípku naň
      if (e.kind === "beat_empty" && (e.from === "p1" || e.from === "p2")) {
        const pos = e.beat === "lhope" ? 9 : e.beat === "gpre" ? 0 : (e.from === playStarter) ? 7 : 8;
        qBeatEls.forEach(x => x && x.classList.remove("q-now"));
        const el = qBeatEls[pos];
        if (el) {
          el.classList.add("q-now");
          qCursor.style.left = (el.offsetLeft + el.offsetWidth / 2) + "px";
          qCursor.classList.add("show");
        }
      }
      if (e.kind === "block" && (e.target === "p1" || e.target === "p2")) {
        // block na KLONOVI (e.cell) sa ukáže na klonovej bunke - zdieľaný štít sa rozbije na oboch figúrach
        const bcell = Array.isArray(e.cell) ? e.cell : null;
        spawnShieldBlock(e.target, !!e.gold, bcell); // efektný náraz do štítu
        const bcls = e.gold ? "golden-float" : "block-float"; // zlatý text, ak blokoval golden shield
        if (bcell) spawnCellFloat(bcell, "🛡️ BLOCKED", bcls);
        else spawnFloat(e.target, "🛡️ BLOCKED", bcls);
      }
      if (e.kind === "heal" && (e.target === "p1" || e.target === "p2")) {
        // Lightning na heal dlaždici (full-heal pasívka) - „SUPER HEAL" float
        if (e.super) spawnFloat(e.target, "SUPER HEAL", "superheal-float");
        else spawnFloat(e.target, `+${e.amount ?? 1} HP`, "heal-float");
      }
      } catch (err) { console.error("effect handler zlyhal", e?.kind, err); }
    }
    for (const s of ["p1", "p2"]) {
      if (casters.has(s))       { setAnim(s, "casting", frameHold); lastAttackEndAt[s] = performance.now() + frameHold; } // special: malá postava hrá svoj efektový sprite (nie úder)
      // Medúza strieľa s Attack_2 (krátky úder) - Attack_1 má vyhradený pre melee šľah
      else if (shooters.has(s)) { setAnim(s, ACTION_ANIMS[state?.[s]?.char]?.shot || "attack", frameHold); lastAttackEndAt[s] = performance.now() + frameHold; }
    }

    renderGrid(state, frame.effects || []);
    positionActors(state);

    prev = frame;
    // Jotaro THE WORLD: čiastočná timeline skončila na timestop_wait - NEplánuj ďalší krok a NEspusti koncovú
    // vetvu playbacku (UI sa nesmie odomknúť). Prejdi do ts-módu; pokračovacia timeline príde druhým `state`.
    if (tsWait) { playback.playing = false; playback.tsResumePending = true; enterTimestopMode(); return; } // pokračovanie zachová beat counts
    setTimeout(step, frame.delayMs ?? 600);
  };

  if (preDelay > 0) setTimeout(() => { if (gen === playback.playGen) step(); }, preDelay); // počkaj na premenu Escanora
  else step();
}

/* ---------- Actors clear ---------- */
function clearActors() {
  [actorP1, actorP2, cloneEls.p1, cloneEls.p2, cloneGhost].forEach(el => {
    const ctx = el.getContext("2d");
    ctx.clearRect(0, 0, el.width, el.height);
    el.style.display = "none";
    el.style.left = "0px"; el.style.top = "0px";
    el.style.transform = "translateX(0) scaleX(1)";
    el.style.opacity = "1";
    el.style.zIndex = "";
    clearTimeout(el._hideT); clearTimeout(el._fadeT); el._logCell = null; // reset sledovania klonovej pozície
  });
  actorsEl.querySelectorAll(".sprite-clone-summon").forEach(n => n.remove());
  actorsEl.querySelectorAll(".clone-puff").forEach(n => n.remove());
  cloneSummonFx = [];
  cloneSummonPose = { p1: null, p2: null };
  cloneDead = { p1: false, p2: false };
  fxAll("resetActors"); // figúry postáv z registra fx (Jotarov stand)
  playback.tsActive = false; playback.tsJotaroSlot = null; hideWorldCenter(); // THE WORLD vizuál nesmie prežiť reset/novú hru
  youMarker.style.display = "none";
  actorsInitialized = false;
}

/* ---------- Controls ---------- */

function shakeBtn(btn) {
  btn.classList.add("shake");
  setTimeout(() => btn.classList.remove("shake"), 400);
}

// otvorený smerový picker blokuje všetky ostatné akčné tlačidlá;
// odblokuje sa opätovným klikom na to isté tlačidlo (picker sa zavrie)
const PICKERS = { move: dirPicker, attack: aimPicker, attack_diag: aimPickerDiag, dash: dashPicker, special: specialPicker, special_cell: cellPicker, special_wolf: wolfPicker, special1: s1Picker };
const PICKER_BTNS = { move: moveBtn, attack: attackBtn, attack_diag: attackBtn, dash: dashBtn, special: specialBtn, special_cell: specialBtn, special_wolf: specialBtn, special1: mirrorBtn };

// Vampire/Onryō: dash slot = CHARGE - tlačidlo dostane fialový „Hidden" skin s preblikávaním a ???
// namiesto bežca (tajomná akcia v štýle skrytej stránky); pre ostatných mágov sa vráti bežný dash.
// Attack tooltip navyše vysvetlí odraz strely. Volané zo state handlera pri každom snapshote.
// bežný vzhľad tlačidiel, ktoré postava môže preskinovať (buttons.<slot> v registri)
const BTN_BASE = {
  dash:     { emoji: "🏃", title: "Dash - move up to 2 cells in a direction (−4 mana)", cost: "−4{💧}" },
  recharge: { emoji: "🙏", title: "Recharge (+4 mana)", cost: "+4{💧}" },
  mirror:   { emoji: "🪞", title: "Mirror (−4 mana, reflects all damage of the opponent's next action back at them)", cost: "−4{💧}" },
  melee:    { title: "Melee (−4 mana, 8 dmg, hits only an opponent on your cell)", cost: "−4{💧} 8{☠️}" },
};
const ATTACK_TITLE_DEFAULT = "Range Attack - choose a direction (−1 mana, damage by distance: 3/2/1, can't hit your own cell)";
// skin tlačidla podľa postavy: def.skin = trieda tlačidla aj jeho pickera + fialová „???" ikona
// (Vampire/Onryō charge, Jotarov Special 1, Luffyho prepínač gearu); bez skinu bežná ikona/cena/tooltip
function applyBtnSkin(slot, btn, picker, char) {
  if (!btn) return;
  const base = BTN_BASE[slot], def = CHAR_BUTTONS[char]?.[slot];
  // všetky skiny tohto slotu v registri - aktívny len ten postavin
  for (const sk of new Set(Object.values(CHAR_BUTTONS).map(b => b[slot]?.skin).filter(Boolean))) {
    btn.classList.toggle(sk, def?.skin === sk);
    picker?.classList.toggle(sk, def?.skin === sk);
  }
  const ico = btn.querySelector(".pix-ico");
  const cost = btn.querySelector(".cost");
  if (!ico) return;
  if (def?.skin) {
    delete ico.dataset.emoji;
    delete ico.dataset.done;
    ico.classList.add("charge-mark");
    ico.textContent = "???";
  } else {
    ico.classList.remove("charge-mark");
    if (ico.dataset.emoji !== base.emoji) {
      ico.dataset.emoji = base.emoji;
      ico.innerHTML = "";
      delete ico.dataset.done;
      pixelizeEmoji(ico);
    } else if (!ico.dataset.done) {
      pixelizeEmoji(ico);
    }
  }
  if (cost) { cost.innerHTML = costHtml(def?.cost ?? base.cost); hydratePix(cost); }
  btn.title = def?.title ?? base.title;
}
function syncDashBtn(char) {
  applyBtnSkin("dash", dashBtn, dashPicker, char);
  attackBtn.title = CHAR_BUTTONS[char]?.attack?.title ?? ATTACK_TITLE_DEFAULT;
}

// Luffy: recharge slot = prepínač módu (base↔Gear3) - fialový ❔ „Hidden" skin ako vamp charge.
// Doplní manu A prepne mód (aj pri plnej mane). Pre ostatných mágov vráti bežný recharge.
function syncRechargeBtn(char) { applyBtnSkin("recharge", rechargeBtn, null, char); }

// odznak stavu postavy na tlačidlách z registra (buttonBadge - Luffy: gear3.png na range attack + special,
// aj keď je v tomto kole naplánovaný recharge, aby hráč videl, že basic/special budú v gear3)
function syncButtonBadges(char) {
  const btns = { attack: attackBtn, special: specialBtn };
  for (const c of CHAR_LIST) {
    const bb = c.buttonBadge; if (!bb) continue;
    const on = c.key === char && !!bb.on(buttonUi());
    for (const sl of bb.slots) { const b = btns[sl]; if (b) bb.cls.forEach(k => b.classList.toggle(k, on)); }
  }
}

// Jotaro nemá mirror - tento slot je Special 1 (Star Platinum): fialový ❔ skin, cost 4, L/R picker.
// Pre ostatné postavy vráti bežný mirror. Volané zo state handlera pri každom snapshote.
function syncMirrorBtn(char) { applyBtnSkin("mirror", mirrorBtn, s1Picker, char); }

// po LOCK IN aj počas prehrávania kola sú všetky tlačidlá zamknuté a stmavené
function uiLocked() {
  if (playback.tsPlanning) return false; // Jotaro počas THE WORLD plánuje zmrazené akcie - ovládanie odomknuté
  return planning.lockedIn || playback.playing || playback.tsFrozen || !!state?.[me]?.locked;
}

// vizuálne zámky: otvorený picker zamyká ostatné akčné tlačidlá, LOCK IN zamyká všetky
function actionButtonsAll() {
  const generic = [...document.querySelectorAll(".controls .actions button[data-act]")]
    .filter(b => !b.closest(".dir-picker"));
  return [
    moveBtn, attackBtn, dashBtn, meleeBtn, specialBtn,
    document.getElementById("golden-btn"),
    document.getElementById("gold-dual-btn"),
    document.getElementById("demon-btn"),
    document.getElementById("last-hope-btn"),
    ...generic
  ].filter(Boolean);
}
function updateUiLocks() {
  const openBtn = planning.openPicker ? PICKER_BTNS[planning.openPicker] : null;
  const locked = uiLocked();
  actionButtonsAll().forEach(b => {
    let bl = locked || (!!planning.openPicker && b !== openBtn);
    // počas THE WORLD plánovania (playback.tsPlanning): special (THE WORLD práve beží) + golden/gold-dual/démon/last-hope
    // sú v zmrazenej trojici zakázané → zamkni ich (special1 v mirror slote a základné akcie ostávajú)
    if (playback.tsPlanning && (b === specialBtn || b.id === "golden-btn" || b.id === "gold-dual-btn" || b.id === "demon-btn" || b.id === "last-hope-btn")) bl = true;
    b.classList.toggle("locked-ui", bl);
  });
  undoBtn.classList.toggle("locked-ui", locked && !playback.tsPlanning);
}

function closePickers() {
  Object.values(PICKERS).forEach(p => p.classList.add("hidden"));
  planning.openPicker = null;
  clearPreviewCells();
  updateUiLocks();
}
function togglePicker(kind, btn, usedType) {
  if (uiLocked()) return;
  if (planning.openPicker === kind) { closePickers(); return; } // opätovný klik = zavrieť
  if (planning.openPicker) { shakeBtn(btn); return; }           // iný picker je otvorený -> blokované
  if (planning.myQueue.length >= 3 || planning.myQueue.some(a => a.type === usedType)) {
    shakeBtn(btn);
    return;
  }
  PICKERS[kind].classList.remove("hidden");
  planning.openPicker = kind;
  updateUiLocks();
}

// Move / Attack / Dash: najprv výber smeru v mini-popupe
moveBtn.addEventListener("click",   () => togglePicker("move", moveBtn, "move"));
// Countess/Onre strieľajú diagonálne - attack otvára diagonálny picker namiesto ortogonálneho
attackBtn.addEventListener("click", () => {
  const c = ghostCharAt();
  // typ pickera z registra (attackPicker - Luffy: base diag, gear3 len ←/→); inak side-postavy diagonálne
  const ap = CHARS_BY_KEY[c]?.attackPicker;
  const pk = (typeof ap === "function" ? ap(buttonUi()) : ap) || (SIDE_CHARS[c] ? "diag" : "ortho");
  const kind = pk === "diag" ? "attack_diag" : "attack";
  aimPicker.classList.toggle("lr-only", pk === "lr"); // lr = ortogonálny picker bez ↑/↓
  togglePicker(kind, attackBtn, "attack");
});
dashBtn.addEventListener("click",   () => togglePicker("dash", dashBtn, "dash"));
// Melee: priama akcia bez pickera (Vampire/Onryō sekajú tiež len na vlastnej bunke)
meleeBtn?.addEventListener("click", () => {
  if (uiLocked()) return;
  if (planning.openPicker) { shakeBtn(meleeBtn); return; }
  if (planning.myQueue.length >= 3 || planning.myQueue.some(a => a.type === "melee")) { shakeBtn(meleeBtn); return; }
  planning.myQueue.push({ type: "melee" });
  renderQueue();
});
// Vojak: mini mapa plochy pod special tlačidlom - klik vyberie cieľovú bunku lúča. Blokované:
// vlastná GHOST pozícia (kde budem v čase specialu po naplánovaných move/dash) a súperova aktuálna
// bunka + jeho tieňový klon (obe figúry - blokovanie len pravej by prezradilo, ktorá je skutočná).
// V labyrinte má súper x=null (server rediguje) → neblokuje sa nič okrem vlastnej bunky (streľba naslepo).
// reach (register specialReach - Luffy): len bunky, kam special z ghost pozície dosiahne
function buildCellPicker(freeAll = false, reach = null) {
  if (!cellPicker) return;
  cellPicker.innerHTML = "";
  cellPicker.style.gridTemplateColumns = `repeat(${board.w}, auto)`;
  const gp = ghostPos(); // pozícia, z ktorej sa special vykoná (po akciách už vo fronte)
  const opp = state?.[otherSlot()];
  const myTrap = state?.[me]?.trap || null; // Countess/Onre: kde už leží moja pasca (recast ju nahradí)
  for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn mini-target";
    // reach (Luffy): cieľ musí ležať na platnej línii (dáma/veža) z ghost pozície; ostatné bunky zamknuté.
    // Vlastná aj súperova bunka SÚ platné ciele (dogúľa sa naň a udrie, kto tam stojí).
    if (reach) {
      // len rozlíšenie platná línia vs mimo - ŽIADNE značky mojej/súperovej pozície
      // (tie dávajú zmysel u Soldiera, nie tu - Luffy sa smie dogúľať aj na vlastnú aj na súperovu bunku).
      const ok = !!(gp && reach({ G, board, ui: buttonUi(), g: gp, x, y }));
      if (!ok) { b.disabled = true; b.classList.add("off-line"); }
      b.addEventListener("mouseenter", () => showPreviewCells([[x, y]]));
      b.addEventListener("mouseleave", clearPreviewCells);
      b.addEventListener("click", () => {
        if (uiLocked() || b.disabled) return;
        if (planning.myQueue.length >= 3 || planning.myQueue.some(a => a.type === "special")) return;
        planning.myQueue.push({ type: "special", cell: { x, y } });
        closePickers();
        renderQueue();
      });
      cellPicker.appendChild(b);
      continue;
    }
    // freeAll (pasca Countess/Onre): ŽIADNE blokované bunky - aj súperova aktuálna, aj vlastná
    const isMe  = !freeAll && !!(gp && gp.x === x && gp.y === y);
    const isFoe = !freeAll && (!!(opp && opp.x === x && opp.y === y) || !!(opp?.clone && opp.clone.x === x && opp.clone.y === y));
    if (isMe)       { b.disabled = true; b.classList.add("own"); b.textContent = "▲"; b.title = "Your position at that point of the queue"; }
    else if (isFoe) { b.disabled = true; b.classList.add("foe"); b.textContent = "✕"; b.title = "Opponent's current cell - they're hit only if they move"; }
    else if (freeAll && myTrap && myTrap.x === x && myTrap.y === y) { b.classList.add("trap-here"); b.textContent = "◆"; b.title = "Your current trap - recasting replaces it"; }
    b.addEventListener("mouseenter", () => showPreviewCells([[x, y]]));
    b.addEventListener("mouseleave", clearPreviewCells);
    b.addEventListener("click", () => {
      if (uiLocked() || b.disabled) return;
      if (planning.myQueue.length >= 3 || planning.myQueue.some(a => a.type === "special")) return;
      planning.myQueue.push({ type: "special", cell: { x, y } });
      closePickers();
      renderQueue();
    });
    cellPicker.appendChild(b);
  }
}
// Special: Medúza/Escanor si najprv vyberú smer pohľadu (←/→), Vlkolak jeden z 8 smerov charge,
// Vojak cieľovú bunku; ostatní pridajú akciu priamo
// typ cieľa specialu z registra (specialTarget, prípadne podľa stavu - Jotaro po THE WORLD smerový)
function specialTargetOf(char) {
  const t = CHARS_BY_KEY[char]?.specialTarget;
  return (typeof t === "function" ? t(buttonUi()) : t) || "none";
}
specialBtn.addEventListener("click", () => {
  const target = specialTargetOf(ghostCharAt());
  if (target === "dir") { togglePicker("special", specialBtn, "special"); return; } // smerový special (left/right)
  if (target === "wolf") { togglePicker("special_wolf", specialBtn, "special"); return; } // charge - 8 smerov
  if (target === "cell") {
    if (planning.openPicker !== "special_cell") buildCellPicker(); // obsah podľa aktuálnych pozícií + ghost fronty
    togglePicker("special_cell", specialBtn, "special");
    return;
  }
  if (target === "reach") {
    // mini mapa s bunkami len tam, kam special dosiahne (Luffy: pohyb-a-úder ako dáma base / veža gear3)
    if (planning.openPicker !== "special_cell") buildCellPicker(false, CHARS_BY_KEY[ghostCharAt()].specialReach);
    togglePicker("special_cell", specialBtn, "special");
    return;
  }
  if (target === "trap") {
    // pasca: rovnaká mini mapa ako Vojak, ale BEZ blokovaných buniek (aj súperova aktuálna, aj vlastná)
    if (planning.openPicker !== "special_cell") buildCellPicker(true);
    togglePicker("special_cell", specialBtn, "special");
    return;
  }
  if (uiLocked()) return;
  if (planning.openPicker) { shakeBtn(specialBtn); return; }
  if (planning.myQueue.length >= 3 || planning.myQueue.some(a => a.type === "special")) { shakeBtn(specialBtn); return; }
  planning.myQueue.push({ type: "special" });
  renderQueue();
});

// Golden predťah: jedno tlačidlo predelené na 2 rovnako široké polovice - ŠTÍT (−3) | MIRROR (−5).
// Vzájomne výlučné; rozsvieti sa vždy len zvolená polovica. Starterovi zamknuté (vizuálny zámok).
const goldenShieldHalf = goldenBtn.querySelector(".shield-half");
const goldenMirrorHalf = goldenBtn.querySelector(".mirror-half");

// rozsvietenie polovíc podľa armed flagov
function syncGoldenHalves() {
  goldenShieldHalf?.classList.toggle("armed", planning.goldenArmed);
  goldenMirrorHalf?.classList.toggle("armed", planning.goldenMirrorArmed);
  // bežný štít/mirror vo fronte zamkne príslušnú zlatú polovicu (vzájomné vylúčenie)
  goldenShieldHalf?.classList.toggle("locked", !planning.goldenArmed && planning.myQueue.some(a => a.type === "shield"));
  goldenMirrorHalf?.classList.toggle("locked", !planning.goldenMirrorArmed && planning.myQueue.some(a => a.type === "mirror"));
}

function toggleGoldenHalf(mode) {
  if (uiLocked()) return;
  if (planning.openPicker) { shakeBtn(goldenBtn); return; }
  if (!me || state?.starter === me || isStonedNow()) { shakeBtn(goldenBtn); return; }
  // golden shield/mirror sa vzájomne vylučuje s bežnou akciou rovnakého druhu vo fronte (zamknuté, kým ju nezrušíš)
  if (mode === "shield") {
    if (!planning.goldenArmed && planning.myQueue.some(a => a.type === "shield")) { shakeBtn(goldenBtn); return; }
    planning.goldenArmed = !planning.goldenArmed; planning.goldenMirrorArmed = false;
  } else {
    if (!planning.goldenMirrorArmed && planning.myQueue.some(a => a.type === "mirror")) { shakeBtn(goldenBtn); return; }
    planning.goldenMirrorArmed = !planning.goldenMirrorArmed; planning.goldenArmed = false;
  }
  syncGoldenHalves();
  renderQueue();
}
goldenShieldHalf?.addEventListener("click", () => toggleGoldenHalf("shield"));
goldenMirrorHalf?.addEventListener("click", () => toggleGoldenHalf("mirror"));

// Golden Mana | Last Stand - duálne tlačidlo (2 polovice, vzájomne výlučné, ako golden shield/mirror).
// Vykoná sa po konci kola; dostupné obom hráčom; v poslednom (buffnutom) kole zamknuté pre oboch.
const gmHalf = goldDualBtn.querySelector(".gm-half");
const lsHalf = goldDualBtn.querySelector(".ls-half");

function syncGoldDualHalves() {
  gmHalf?.classList.toggle("armed", planning.goldenManaArmed);
  lsHalf?.classList.toggle("armed", planning.lastStandArmed);
}
function toggleGoldDual(mode) {
  if (uiLocked()) return;
  if (planning.openPicker) { shakeBtn(goldDualBtn); return; }
  if (!me || !state?.[me]?.char) return;
  if (state?.goldLocked) { shakeBtn(goldDualBtn); return; } // posledné kolo - zamknuté
  if (mode === "mana") { planning.goldenManaArmed = !planning.goldenManaArmed; planning.lastStandArmed = false; }
  else                 { planning.lastStandArmed  = !planning.lastStandArmed;  planning.goldenManaArmed = false; }
  syncGoldDualHalves();
  renderQueue();
}
gmHalf?.addEventListener("click", () => toggleGoldDual("mana"));
lsHalf?.addEventListener("click", () => toggleGoldDual("laststand"));

// Démon útok - tlačidlo dostupné len buffnutému hráčovi v poslednom kole (namiesto zamknutého gold dual buttonu).
// Správa sa ako bežná akcia: pridá/odoberie {type:"demon"} do/z planning.myQueue (max 3, raz za kolo).
demonBtn?.addEventListener("click", () => {
  if (uiLocked()) return;
  if (planning.openPicker) { shakeBtn(demonBtn); return; }
  if (!me || !state?.[me]?.char || !state?.[me]?.lastStandBuff) return;
  const idx = planning.myQueue.findIndex(a => a.type === "demon");
  if (idx >= 0) { planning.myQueue.splice(idx, 1); } // opätovný klik = odober z fronty
  else {
    if (planning.myQueue.length >= 3) { shakeBtn(demonBtn); return; }
    planning.myQueue.push({ type: "demon" });
  }
  renderQueue();
});
demonBtn?.addEventListener("mouseenter", () => {
  if (!me || !state?.[me]?.lastStandBuff) return;
  const p = ghostPos();
  if (p) showPreviewCells(cellsForDemonPreview(p));
});
demonBtn?.addEventListener("mouseleave", clearPreviewCells);

// Last Hope - len nebuffnutý hráč vo final kole; toggle úvodnej akcie (ako armed flag, nie do planning.myQueue)
// skamenený na začiatku kola → úvodné zlaté akcie (Last Hope, golden shield/mirror) sa na serveri nevykonajú
// (vyhodnocujú sa pred prvou akciou, kým kameň ešte trvá) - tlačidlá sú preto zamknuté, nie len varované
function isStonedNow() {
  return (state?.[me]?.stone || 0) > 0;
}
function canPlayLastHope() {
  return !!me && !!state?.[me]?.char && !!state?.goldLocked && !state?.[me]?.lastStandBuff;
}
lastHopeBtn?.addEventListener("click", () => {
  if (uiLocked()) return;
  if (planning.openPicker) { shakeBtn(lastHopeBtn); return; }
  if (!canPlayLastHope() || isStonedNow()) { shakeBtn(lastHopeBtn); return; }
  planning.lastHopeArmed = !planning.lastHopeArmed;
  renderQueue();
});

function updateGoldenButton() {
  if (goldenBtn) {
    // viditeľný obom hráčom; starterovi zamknutý (zámok + neaktívny vzhľad)
    const inGame = !!me && !!state?.[me]?.char;
    goldenBtn.classList.toggle("hidden", !inGame);
    const isStarter = !!me && state?.starter === me;
    const goldLocked = isStarter || isStonedNow(); // skamenený: zlatý predťah by sa nevykonal
    goldenBtn.classList.toggle("locked-perm", goldLocked);
    if (goldLocked && (planning.goldenArmed || planning.goldenMirrorArmed)) {
      planning.goldenArmed = false;
      planning.goldenMirrorArmed = false;
    }
    syncGoldenHalves();
  }
  if (goldDualBtn) {
    const available = !!me && !!state?.[me]?.char;
    const locked = !!state?.goldLocked; // posledné (buffnuté) kolo - duálny button zamknutý pre oboch
    goldDualBtn.classList.toggle("hidden", !available);
    goldDualBtn.classList.toggle("locked-perm", locked); // rovnaký zámok (🔒 + sivé) ako golden shield/mirror pre startera
    if (locked) { planning.goldenManaArmed = false; planning.lastStandArmed = false; }
    // cena golden many v HP (srdiečka) rastie s každým použitím (1, 2, 3…); +6 mana je nad ňou (statické)
    const cost = (state?.[me]?.manaRefills ?? 0) + 1;
    if (gmCostEl) { gmCostEl.innerHTML = `−${cost}${miniPix("❤️")}`; hydratePix(gmCostEl); }
    syncGoldDualHalves();
  }
  // démon útok - v poslednom (FINAL) kole pre buffnutého hráča; nahrádza inak zamknutý gold dual button
  if (demonBtn) {
    const buffed = !!me && !!state?.[me]?.lastStandBuff;
    const showDemon = !!me && !!state?.[me]?.char && !!state?.goldLocked && buffed;
    demonBtn.classList.toggle("hidden", !showDemon);
    if (showDemon) {
      if (goldDualBtn) goldDualBtn.classList.add("hidden"); // duálny button je aj tak zamknutý - schovaj ho
      const used = planning.myQueue.some(a => a.type === "demon");
      demonBtn.classList.toggle("armed", used);
      demonBtn.disabled = !used && planning.myQueue.length >= 3; // plná fronta a démon nie je v nej → nedá sa pridať
    } else {
      demonBtn.disabled = false;
      demonBtn.classList.remove("armed");
    }
  }
  // Last Hope tlačidlo - len nebuffnutý hráč vo final kole (naľavo od golden shield/mirror)
  if (lastHopeBtn) {
    const showHope = canPlayLastHope();
    lastHopeBtn.classList.toggle("hidden", !showHope);
    const hopeStoned = showHope && isStonedNow();
    lastHopeBtn.classList.toggle("locked-perm", hopeStoned);
    if (lastHopeBtn.dataset.baseTitle === undefined) lastHopeBtn.dataset.baseTitle = lastHopeBtn.title;
    lastHopeBtn.title = hopeStoned ? "Last Hope - locked: you are petrified, it would have no effect" : lastHopeBtn.dataset.baseTitle;
    if (hopeStoned && planning.lastHopeArmed) planning.lastHopeArmed = false;
    if (showHope) {
      lastHopeBtn.classList.toggle("armed", planning.lastHopeArmed);
    } else {
      if (planning.lastHopeArmed) planning.lastHopeArmed = false; // mimo final kola nesmie ostať navolené
      lastHopeBtn.classList.remove("armed");
    }
  }
}

document.querySelectorAll(".controls button[data-act]").forEach(btn => {
  btn.addEventListener("click", () => {
    const [type, arg] = btn.dataset.act.split(":");

    // mirror slot je Special 1 (register mirrorSlot - Jotaro) → klik TOGGLUJE L/R picker (togglePicker rieši
    // open→close aj „iný picker otvorený"); musí byť PRED guardom otvoreného pickera, inak by re-klik len shakoval
    if (type === "mirror" && CHARS_BY_KEY[ghostCharAt()]?.mirrorSlot === "special1") {
      togglePicker("special1", mirrorBtn, "special1");
      return;
    }

    if (uiLocked()) return;
    if (planning.myQueue.length >= 3) return;

    // pri otvorenom pickeri sú klikateľné len jeho šípky - ostatné tlačidlá sú blokované
    const isPickerArrow = !!btn.closest(".dir-picker");
    if (planning.openPicker && !isPickerArrow) { shakeBtn(btn); return; }

    // každá akcia max 1× za kolo
    if (planning.myQueue.some(a => a.type === type)) {
      shakeBtn(btn);
      return;
    }
    // vzájomné vylúčenie s golden predťahom: golden shield zamyká štít, golden mirror zamyká mirror
    if ((type === "shield" && planning.goldenArmed) || (type === "mirror" && planning.goldenMirrorArmed)) {
      shakeBtn(btn);
      return;
    }

    if (type === "move")      planning.myQueue.push({ type: "move", dir: arg });
    if (type === "dash")      planning.myQueue.push({ type: "dash", dir: arg });
    if (type === "recharge")  planning.myQueue.push({ type: "recharge" });
    if (type === "attack")    planning.myQueue.push({ type: "attack", dir: arg });
    if (type === "melee")     planning.myQueue.push({ type: "melee" });
    if (type === "special")   planning.myQueue.push(arg ? { type: "special", dir: arg } : { type: "special" }); // smer (←/→): Medúza/Escanor/Jotaro(S2)
    if (type === "special1")  planning.myQueue.push({ type: "special1", dir: arg }); // Jotarov útok v mirror slote
    if (type === "shield")    planning.myQueue.push({ type: "shield" });
    if (type === "mirror")    planning.myQueue.push({ type: "mirror" });

    if (isPickerArrow) closePickers();
    renderQueue();
  });
});
undoBtn.addEventListener("click", () => {
  if (uiLocked()) return;
  if (planning.myQueue[planning.myQueue.length - 1]?.type === "stoned") return; // skamenený pass sa nedá odobrať
  planning.myQueue.pop();
  renderQueue();
});
// hláška o chybe spojenia (server nepotvrdil prijatie ťahu)
function showConnError() { connErrorEl?.classList.remove("hidden"); }
function hideConnError() { connErrorEl?.classList.add("hidden"); }
connErrorEl?.addEventListener("click", hideConnError); // klikom sa dá zavrieť

// server nepotvrdil ťah ani po opakovaniach → odomkni ovládanie a nechaj usera potvrdiť znova
function unlockAfterConnError() {
  planning.lockedIn = false;
  lockBtn.classList.remove("locked");
  lockBtn.classList.remove("ready");
  lockBtn.textContent = "LOCK IN";
  lockBtn.disabled = false;
  updateUiLocks();
  updateLockButton();
  showConnError();
}

// pošli lock_in spoľahlivo: čakaj na ack od servera a pri strate packetu (timeout) zopakuj.
// rieši „dal som LOCKED, ale súper/server ťah nezaznamenal" pri blikajúcej sieti.
// ak ani po MAX_TRIES nepríde potvrdenie → odblokuj tlačidlá a oznám userovi chybu spojenia.
function emitLockIn(payload) {
  let tries = 0;
  const MAX_TRIES = 6; // ~9 s pokusov (6 × 1,5 s), potom to vyhlásime za chybu spojenia
  const forTurn = state?.turn; // kolo, pre ktoré táto voľba platí - server zahodí zopakovanie, ak sa už posunulo
  const send = () => {
    tries++;
    socket.timeout(1500).emit("lock_in", payload, forTurn, (err) => {
      if (!err) { hideConnError(); return; }   // server POTVRDIL prijatie ťahu → hotovo
      if (!planning.lockedIn || playback.playing) return;         // kolo sa medzitým vyriešilo/odomklo → nič nerob
      if (tries < MAX_TRIES) { send(); return; } // stratený packet → skús znova
      unlockAfterConnError();                    // vyčerpané pokusy → odomkni + oznám chybu
    });
  };
  send();
}
/* ---------- Jotaro THE WORLD - klientská pauza / ts-mód ---------- */
// full-screen overlay pre zmrazeného súpera (text „⏱ TIME HAS STOPPED…"); filter rieši body.timestop-mode
const tsOverlay = document.createElement("div");
tsOverlay.id = "timestop-overlay";
tsOverlay.className = "hidden";
tsOverlay.innerHTML = `<div class="ts-overlay-text">⏱ THE WORLD! - TIME HAS STOPPED…</div>`;
document.body.appendChild(tsOverlay);
function tsOverlaySet(on) { tsOverlay.classList.toggle("hidden", !on); }

// veľký stredový sprite THE WORLD castu - Star Platinum „menace" (Special_3_P); hrá RAZ a ZAMRZNE na
// poslednom frame (rovnako ako náhľad karty pri výbere). Drží sa počas celého time-stopu, mizne pri konci.
let worldCenterRaf = 0;
const worldCenter = document.createElement("canvas");
worldCenter.id = "world-center";
{
  const px = Math.round(TILE_H * 2.4);
  worldCenter.width = px; worldCenter.height = px;
  worldCenter.style.width = px + "px"; worldCenter.style.height = px + "px";
  worldCenter.style.display = "none";
}
document.body.appendChild(worldCenter);
function spawnWorldCenter(slot) {
  const dir = charDirFor("jotaro", slot);
  worldCenter.style.display = "block";
  const start = performance.now();
  let blinkCleared = false;
  cancelAnimationFrame(worldCenterRaf);
  const draw = () => {
    const ctx = worldCenter.getContext("2d");
    ensureSpriteMeta(dir, "Special_3_P.png").then(m => {
      const fps = 6, total = m.frames;
      const fi = Math.floor((performance.now() - start) / 1000 * fps);
      const idx = Math.min(total - 1, fi); // RAZ 0..N-1, potom drží posledný frame (zamrzne ako v náhľade)
      drawSprite(ctx, m, { file: "Special_3_P.png", frames: total, frameIndex: idx }, 0, worldCenter.width, worldCenter.height, 1, 0.5, true);
      // celoplošné blikanie tiles trvá LEN po zastavenie stredovej SP animácie (keď menace zamrzne na poslednom frame)
      if (!blinkCleared && fi >= total - 1) {
        blinkCleared = true;
        gridEl.querySelectorAll(".cell.preview-red").forEach(c => c.classList.remove("preview-red"));
      }
    }).catch(() => {});
    worldCenterRaf = requestAnimationFrame(draw);
  };
  draw();
}
function hideWorldCenter() {
  cancelAnimationFrame(worldCenterRaf); worldCenterRaf = 0;
  worldCenter.style.display = "none";
  const c = worldCenter.getContext("2d"); c.clearRect(0, 0, worldCenter.width, worldCenter.height);
}

// vstup do ts-módu (po timestop_wait alebo po reload/reclaim): Jotaro plánuje 3 zmrazené akcie,
// súper čaká zamrznutý s full-screen filtrom a zamknutým UI.
function enterTimestopMode() {
  const tsSlot = state?.timestop?.slot;
  if (!tsSlot || isSpectator) { playback.tsPlanning = false; playback.tsFrozen = false; tsOverlaySet(false); return; }
  // TERAZ (menace dohral) zamrazíme čas: zmrazenie animácií board figúr (okrem Jotara) + filter (rieši sa nižšie).
  // Pri reloade/reclaime sem prídeme bez predošlého timestop_start → dospawnujeme menace, nech je vidno.
  playback.tsActive = true; playback.tsJotaroSlot = tsSlot; playback.tsFreezeAt = performance.now();
  if (worldCenter.style.display === "none") spawnWorldCenter(tsSlot);
  if (me === tsSlot) {
    // Jotarov hráč - plánovanie 3 zmrazených akcií (kvázi nové kolo, všetky typy nanovo)
    playback.tsPlanning = true; playback.tsFrozen = false;
    planning.lockedIn = false;
    planning.myQueue = [];
    planning.goldenArmed = planning.goldenMirrorArmed = planning.goldenManaArmed = planning.lastStandArmed = planning.lastHopeArmed = false;
    // filter time-stopu aj overlay „THE WORLD! - TIME HAS STOPPED…" vidia OBAJA. Overlay je pointer-events:none
    // a hore na obrazovke, takže Jotarovi neprekáža v plánovaní zmrazenej trojice.
    document.body.classList.add("timestop-mode");
    tsOverlaySet(true);
    lockBtn.classList.remove("locked", "ready"); lockBtn.disabled = false; lockBtn.textContent = "EXECUTE";
    closePickers(); renderQueue(); syncGoldenHalves(); syncGoldDualHalves(); updateUiLocks();
  } else {
    // súper - zmrazený, UI zamknuté, full-screen filter + overlay. Stredový Special_3_P vidí PO CELÚ dobu
    // (kým Jotaro nezadá všetky zmrazené akcie) - center ostáva, mizne až pri obnovení času (timestop_end).
    playback.tsFrozen = true; playback.tsPlanning = false;
    document.body.classList.add("timestop-mode");
    tsOverlaySet(true);
    updateUiLocks();
  }
}

// Jotaro potvrdil 3 zmrazené akcie → pošli timestop_actions (server dohrá zvyšok kola a pošle pokračovaciu timeline)
function submitTimestopActions() {
  if (planning.myQueue.length !== 3) { lockBtn.classList.add("shake"); setTimeout(() => lockBtn.classList.remove("shake"), 400); return; }
  const payload = [...planning.myQueue];
  playback.tsPlanning = false;
  planning.lockedIn = true; // drž zamknuté, kým nepríde pokračovacia timeline (playback.playing ju prevezme)
  hideWorldCenter(); // klik na EXECUTE → stredový Special_3_P zmizne (u Jotara hneď; u súpera pri pokračovaní)
  closePickers();
  lockBtn.classList.add("locked"); lockBtn.classList.remove("ready"); lockBtn.textContent = "LOCKED"; lockBtn.disabled = true;
  updateUiLocks();
  socket.emit("timestop_actions", payload, (res) => {
    if (res && res.ok === false) { // server odmietol (nemalo by nastať - validácia zrkadlí klienta) → vráť plánovanie
      playback.tsPlanning = true; planning.lockedIn = false;
      lockBtn.classList.remove("locked"); lockBtn.disabled = false; lockBtn.textContent = "EXECUTE";
      updateUiLocks();
    }
  });
}

lockBtn.addEventListener("click", () => {
  if (playback.tsPlanning) { submitTimestopActions(); return; } // THE WORLD: lock button = EXECUTE zmrazenej trojice
  if (playback.playing) return; // počas prehrávania kola nelockuj
  if (uiLocked()) return;
  if (planning.myQueue.length !== 3) {
    lockBtn.classList.add("shake");
    setTimeout(() => lockBtn.classList.remove("shake"), 400);
    return;
  }
  const payload = [...planning.myQueue];
  if (planning.goldenArmed) payload.unshift({ type: "golden_shield" });
  else if (planning.goldenMirrorArmed) payload.unshift({ type: "golden_mirror" });
  if (planning.lastHopeArmed) payload.unshift({ type: "last_hope" }); // úplne prvý, ešte pred golden shield/mirror
  if (planning.goldenManaArmed) payload.push({ type: "golden_mana" });
  else if (planning.lastStandArmed) payload.push({ type: "last_stand" });
  planning.lockedIn = true; // všetky tlačidlá idú do locked stavu až do konca kola
  emitLockIn(payload); // (až po nastavení planning.lockedIn - helper podľa neho rozhoduje o opakovaní)
  closePickers();
  lockBtn.classList.add("locked");
  lockBtn.classList.remove("ready");
  lockBtn.textContent = "LOCKED";
  lockBtn.disabled = true;
  stopTurnTimer();
});

/* ---------- Phase UI (lobby / waiting / char-select) ---------- */

function applyPhaseUI(s) {
  const phase = s?.phase || "playing";
  const controls = document.querySelector(".controls-row");

  // lobby: host vidí nastavenia; po START ak súper nie je → „čakám na druhého hráča"; druhý hráč čaká na hosta
  if (phase === "lobby" && !isSpectator) {
    if (isHost) {
      if (s?.awaitingOpponent) { lobbyEl.classList.add("hidden"); hostWaitEl?.classList.remove("hidden"); }
      else { showLobby(s); hostWaitEl?.classList.add("hidden"); }
      lobbyWaitEl.classList.add("hidden");
    } else {
      lobbyEl.classList.add("hidden"); lobbyWaitEl.classList.remove("hidden"); hostWaitEl?.classList.add("hidden");
    }
  } else {
    lobbyEl.classList.add("hidden");
    lobbyWaitEl.classList.add("hidden");
    hostWaitEl?.classList.add("hidden");
  }

  // turnajový draft: kým nepotvrdím tím, char-select beží v team-mode (toggle výber + confirm);
  // po potvrdení „TEAM LOCKED" čakačka, kým tím nepotvrdí aj súper (server vtedy prepne na playback.playing)
  const teamPhase = phase === "team_select" && !isSpectator && me;
  const needTeam = teamPhase && !s?.rosterReady?.[me];
  teamWaitEl?.classList.toggle("hidden", !(teamPhase && !needTeam));
  selEl.classList.toggle("team-mode", needTeam);

  // char-select v hernej fáze (kým nemám zvolenú postavu) alebo draft tímu (team-mode)
  const needChar = phase === "playing" && !isSpectator && me && !s?.[me]?.char;
  if (needChar || needTeam) {
    updateCharSelectHp(s); // tournament: HP magov + mŕtvi (musí byť pred preview loopom); v drafte null → bez statov
    selEl.classList.toggle("p2-side", me === "p2"); // hráč vpravo vidí svojich magov v alternatívnom vykreslení
    if (selEl.classList.contains("hidden")) resetCharSelectOpen(); // nové otvorenie - od stránky Mages (str. 1), čistý draft, bez easter-egg stránky
    if (!hiddenMode) setCharPage(charPage); // sync stránky/šípok/nadpisu - aj po Ctrl+F5; state update nesmie zhodiť otvorenú Hidden stránku
    if (needTeam) syncTeamUi();
    else selEl.querySelectorAll(".char-card.picked").forEach(c => { c.classList.remove("picked"); c.querySelector(".pick-badge")?.remove(); });
    hideDeathCenter(); selEl.classList.remove("hidden"); startCharSelectPreview(); // démon nesmie visieť cez výber
  } else if (!selEl.classList.contains("hidden")) { selEl.classList.add("hidden"); stopCharSelectPreview(); }

  if (controls && !isSpectator) controls.style.display = (phase === "playing") ? "" : "none";
}

// séria: v HUD boxe každého hráča rad placeholderov - BO3 = koruny za výhry,
// tournament = hlavy 3 magov (mŕtvy = lebka, aktuálny = zvýraznený, živí ostatní = klikateľní na výmenu)
function renderSeriesCrowns(ser) {
  const single = !ser || !ser.format || ser.format === "single";
  if (single) {
    crownsP1El.classList.add("hidden"); crownsP2El.classList.add("hidden");
    crownsP1El.innerHTML = ""; crownsP2El.innerHTML = "";
    return;
  }
  if (ser.format === "tournament") { renderMageHeads(); return; }
  const needed = ser.needed || 1;
  const tournament = false;
  const onIcon  = tournament ? "skull" : "crown";
  const offIcon = tournament ? "skull_outline" : "crown_outline";
  // neobsadený slot -> obrys; obsadený -> plná pixel-art ikona
  const build = (filled) => Array.from({ length: needed },
    (_, i) => `<span class="crown${tournament ? " skull" : ""}${i < filled ? " won" : ""}">${pixSvg(i < filled ? onIcon : offIcon)}</span>`).join("");
  // koruny = výhry daného slotu; lebky = prehry daného slotu (= výhry súpera)
  const fillP1 = tournament ? (ser.winsP2 || 0) : (ser.winsP1 || 0);
  const fillP2 = tournament ? (ser.winsP1 || 0) : (ser.winsP2 || 0);
  crownsP1El.innerHTML = build(fillP1);
  crownsP2El.innerHTML = build(fillP2);
  crownsP1El.classList.remove("hidden"); crownsP2El.classList.remove("hidden");
}
function updateMatchScore(s) {
  renderSeriesCrowns(s?.phase === "lobby" ? null : s?.series);
}

// tournament: 3 hlavy magov v HUD boxe každého hráča na mieste placeholderov (predtým lebky).
// mŕtvy mág = lebka (nesie info o prehrách), aktuálny = zvýraznený, ostatní živí = klikateľní (len moja strana) na výmenu.
// poradie hláv = draftnutý tím daného slotu (state.roster, poradie výberu); kým tím nie je známy
// (fáza team_select - súperov roster je maskovaný), strana nemá žiadne hlavy
function mageOrderFor(slot) {
  return state?.roster?.[slot]
    || (state?.rosterHp?.[slot] ? Object.keys(state.rosterHp[slot]) : []);
}
// aktuálne HP/mana maga pre daný slot (VEREJNÉ pre oba sloty): nasadený mág = živý stav z boardu (p1/p2),
// lavička = prenesené hodnoty z verejného rosteru (rosterHp/rosterMana)
function headStats(slot, char, isCurrent) {
  const st = state?.[slot];
  if (isCurrent) return { hp: st?.hp, mana: st?.mana };
  const rh = state?.rosterHp?.[slot], rm = state?.rosterMana?.[slot];
  if (rh) return { hp: rh[char], mana: rm?.[char] };
  return null;
}
function renderMageHeads() {
  // labyrint: hlavy (swap buttony) sú počas kliatby skryté u OBOCH hráčov - objavia sa až s labyrinth_end
  // (flag labyrinth padá až vtedy, reveal ho drží); visibility drží layout HUD boxu bez skoku
  const labActive = !!(state?.p1?.labyrinth || state?.p2?.labyrinth);
  crownsP1El.classList.toggle("lab-hidden", labActive);
  crownsP2El.classList.toggle("lab-hidden", labActive);
  const buildSide = (slot) => {
    const dead = state?.mageDead?.[slot] || [];
    const cur = state?.[slot]?.char || null;
    const mineSlot = slot === me;
    // side-postavy (Countess/Onre/Jotaro) v rostri tejto strany a či je práve nasadená niektorá z nich -
    // swap DO/Z side-postavy je zakázaný, čo reprezentuje GLITCH: (a) je nasadená → celá zvyšná lavička
    // glitchuje (nedá sa od nej odísť), (b) je na lavičke → jej hlava glitchuje (nedá sa k nej prísť).
    // Pozor: p2 môže mať v rostri viac side-postáv naraz (napr. Jotaro + Onryō) - glitchovať musia OBE.
    const curIsSide = !!cur && !!SIDE_CHARS[cur];
    return mageOrderFor(slot).map(char => {
      const isDead = dead.includes(char);
      const isCurrent = cur === char;
      // corrupt = táto hlava je „zamknutá" side-postavou (glitch); mŕtvy mág glitch nemá (má lebku)
      const corrupt = !isDead && (curIsSide ? !isCurrent : !!SIDE_CHARS[char]);
      const armed = mineSlot && planning.myQueue.some(a => a.type === "swap" && a.to === char);
      // Last Stand pakt: buffnutý hráč vo final kole nestrieda - jeho lavička nie je klikateľná;
      // glitchujúca (corrupt) hlava tiež nie je klikateľná (nedá sa swapnúť do/zo side-postavy)
      const clickable = mineSlot && !!cur && !isDead && !isCurrent && !corrupt && !uiLocked() && !state?.[slot]?.lastStandBuff;
      let cls = "mhead";
      if (isDead) cls += " dead";
      if (isCurrent) cls += " current";
      if (corrupt) cls += " corrupt";
      if (armed) cls += " armed";
      if (clickable) cls += " clickable";
      // HP/mana nad hlavou (mŕtvy mág ich nemá; súperova lavička je skrytá → prázdny riadok pre zarovnanie)
      const st = isDead ? null : headStats(slot, char, isCurrent);
      // corrupt hlava: HP/mana prepísané glitch znakmi (ticker ich potom mutuje) - data-* drží ikonu
      const statsHtml = st
        ? (corrupt
            ? `<span class="mh-stats"><span class="mh-hp">${pixSvg("heart")}<span class="mh-glitch">##</span></span><span class="mh-mana">${pixSvg("drop")}<span class="mh-glitch">##</span></span></span>`
            : `<span class="mh-stats"><span class="mh-hp">${pixSvg("heart")}${st.hp ?? "?"}</span><span class="mh-mana">${pixSvg("drop")}${st.mana ?? "?"}</span></span>`)
        : `<span class="mh-stats empty"></span>`;
      const face = isDead ? pixSvg("skull") : mageHeadHtml(char, "mh-canvas" + (usesAltColor(char, slot) ? " alt-color" : ""), slot);
      return `<span class="${cls}" data-slot="${slot}" data-char="${char}" title="${CHAR_META[char]?.name || char}">${statsHtml}<span class="mh-face">${face}</span></span>`;
    }).join("");
  };
  crownsP1El.innerHTML = buildSide("p1");
  crownsP2El.innerHTML = buildSide("p2");
  crownsP1El.classList.remove("hidden"); crownsP2El.classList.remove("hidden");
  crownsP1El.classList.add("mage-heads"); crownsP2El.classList.add("mage-heads");
  syncMageGlitch(); // spusti/zastav glitch ticker podľa toho, či nejaká hlava je corrupt
  // hlavy (canvas.mage-head) animuje raf
}
// glitch ticker pre corrupt hlavy (zamknuté side-postavou): kým existuje .mhead.corrupt, mutuje ich
// HP/mana text náhodnými znakmi a občas prebliká celé hlavy - v štýle Hidden stránky
let mageGlitchTimer = 0;
function syncMageGlitch() {
  const any = document.querySelector(".series-crowns .mhead.corrupt");
  if (any && !mageGlitchTimer) {
    mageGlitchTimer = setInterval(() => {
      const nodes = document.querySelectorAll(".series-crowns .mhead.corrupt .mh-glitch");
      if (!nodes.length) { clearInterval(mageGlitchTimer); mageGlitchTimer = 0; return; }
      nodes.forEach(el => {
        let out = "";
        for (let i = 0; i < 2; i++) out += HIDDEN_GLITCH_CHARS[Math.floor(Math.random() * HIDDEN_GLITCH_CHARS.length)];
        el.textContent = out;
      });
      // občasný silnejší preblik celej hlavy (fialový glitch flash)
      document.querySelectorAll(".series-crowns .mhead.corrupt").forEach(h => {
        h.classList.toggle("flash", Math.random() < 0.22);
      });
    }, 120);
  } else if (!any && mageGlitchTimer) {
    clearInterval(mageGlitchTimer); mageGlitchTimer = 0;
  }
}

// klik na hlavu (moja strana, živý ne-aktuálny mág) = toggle swap akcie vo fronte - presne ako démon button
function toggleSwap(char) {
  if (uiLocked()) return;
  if (planning.openPicker) return;
  if (!me || state?.phase !== "playing" || !state?.[me]?.char) return;
  if (state?.series?.format !== "tournament") return;
  if (state?.p1?.labyrinth || state?.p2?.labyrinth) return;  // počas labyrintu je výmena zakázaná (hlavy sú skryté)
  if (state?.[me]?.lastStandBuff) return;                    // Last Stand pakt: vo final kole sa nestrieda
  if ((state?.mageDead?.[me] || []).includes(char)) return; // mŕtveho maga nemožno nasadiť
  if (state?.[me]?.char === char) return;                    // aktuálneho maga nemožno vymeniť za seba
  if (SIDE_CHARS[char] || SIDE_CHARS[state?.[me]?.char]) return; // side-postavu nemožno swapnúť ani odswapnúť (glitch)
  const idx = planning.myQueue.findIndex(a => a.type === "swap" && a.to === char);
  if (idx >= 0) { planning.myQueue.splice(idx, 1); }                  // opätovný klik = odober z fronty
  else {
    if (planning.myQueue.length >= 3) return;                         // plná fronta
    if (planning.myQueue.filter(a => a.type === "swap").length >= 2) return; // max 2 výmeny za kolo
    planning.myQueue.push({ type: "swap", to: char });
  }
  renderQueue();
}
[crownsP1El, crownsP2El].forEach(el => el.addEventListener("click", (ev) => {
  const span = ev.target.closest(".mhead.clickable");
  if (span) toggleSwap(span.dataset.char);
}));

/* ---------- Turn timer (server-riadený displej + auto-lock) ---------- */
// server posiela zostávajúci čas (event `turn_timer` aj `state.timerMs`), takže displej sedí so serverom
// a po refreshi sa zosynchronizuje; klient pri vypršaní auto-lockne (drží už rozpracovanú frontu)
let serverTimerEndsAt = 0; // performance.now()-based deadline zo servera (0 = bez limitu)

// DOČASNÁ DIAGNOSTIKA časovača - zapni cez ?tdebug=1; loguje prečo sa časovač (ne)zobrazí
const TDEBUG = new URLSearchParams(location.search).has("tdebug");
const tlog = (...a) => { if (TDEBUG) console.log("[timer]", ...a); };
let _lastPlanning = null;

function setServerTimer(ms) {
  serverTimerEndsAt = (ms == null) ? 0 : performance.now() + ms;
  tlog("setServerTimer", ms);
}
function stopTurnTimer() {
  serverTimerEndsAt = 0;
  turnTimerEl.classList.add("hidden");
  turnTimerEl.classList.remove("urgent", "below-status");
}
// tik (volaný z raf): odpočet zobraz len počas plánovania; pri vypršaní auto-lockne
function tickTurnTimer(now) {
  const mine = state?.[me];
  const planning = !!serverTimerEndsAt && !playback.playing && !playback.gameOverShown && state?.phase === "playing"
    && !isSpectator && mine?.char && state?.[otherSlot()]?.char && !mine.locked;
  if (TDEBUG && planning !== _lastPlanning) {
    _lastPlanning = planning;
    tlog(`planning=${planning}`, {
      timerEndsAt: !!serverTimerEndsAt, playing: playback.playing, gameOverShown: playback.gameOverShown, phase: state?.phase,
      isSpectator, me, mineChar: mine?.char, otherChar: state?.[otherSlot()]?.char, mineLocked: mine?.locked,
    });
  }
  if (!planning) {
    turnTimerEl.classList.add("hidden");
    turnTimerEl.classList.remove("urgent", "below-status");
    return;
  }
  const remain = Math.max(0, serverTimerEndsAt - now);
  turnTimerEl.classList.remove("hidden");
  turnTimerEl.classList.toggle("below-status", state?.config?.timer === "quickdraw"); // pod „OPPONENT IS READY"
  turnTimerEl.textContent = `⏱ ${Math.ceil(remain / 1000)}`;
  turnTimerEl.classList.toggle("urgent", remain <= 5000);
  if (remain <= 0) { serverTimerEndsAt = 0; autoLockTimeout(); }
}
// vyprší čas - náhodne doplň nevyplnené z 3 základných akcií a zamkni (gold akcie sa nikdy nepridajú samé)
function autoLockTimeout() {
  if (uiLocked() || playback.playing || !me || state?.[me]?.locked) { stopTurnTimer(); return; }
  // vypršaný čas: rozpracované akcie ostanú, každý nevyplnený slot = PASS (THINKING, −2 many na serveri)
  while (planning.myQueue.length < 3) planning.myQueue.push({ type: "pass" });
  const payload = [...planning.myQueue];
  if (planning.goldenArmed) payload.unshift({ type: "golden_shield" });
  else if (planning.goldenMirrorArmed) payload.unshift({ type: "golden_mirror" });
  if (planning.lastHopeArmed) payload.unshift({ type: "last_hope" }); // úplne prvý (gold akcie sa nedopĺňajú, navolený Last Hope sa zachová)
  if (planning.goldenManaArmed) payload.push({ type: "golden_mana" });
  else if (planning.lastStandArmed) payload.push({ type: "last_stand" });
  planning.lockedIn = true;
  emitLockIn(payload); // spoľahlivé poslanie aj pri auto-locku z časovača
  closePickers();
  renderQueue();
  lockBtn.classList.add("locked"); lockBtn.classList.remove("ready");
  lockBtn.textContent = "LOCKED"; lockBtn.disabled = true;
  stopTurnTimer();
}

/* ---------- Sockets ---------- */
// you_are nesie slot (ľavá/pravá rola, fixná na celú sériu: host=p1) aj či som host
socket.on("you_are", (info) => {
  if (info && typeof info === "object") setIdentity(info.slot, !!info.isHost);
  else setIdentity(info); // spätná kompat.
  hideRooms(); // posadený hráč (join/create alebo reclaim) → preč z room-browsera
});

/* ---------- Losovanie farieb (po configure_match) ---------- */
// Server už osoby vylosoval na sloty (p1 = BIELY vľavo a začína každú hru, p2 = ČIERNY vpravo)
// a poslal you_are - tu sa výsledok len ZINSCENUJE: strelka na yin-yang kruhu sa roztočí
// a dobehne na polovici hráčovej farby (biela vľavo 270°, čierna vpravo 90°). Overlay leží
// NAD char-selectom, takže výber postavy čaká, kým ruleta dobehne.
socket.on("color_roll", (info) => {
  if (!colorRollEl || (me !== "p1" && me !== "p2")) return; // divák ruletu nepotrebuje
  // host si zvolil pevnú farbu → žiadna ruleta, char-select sa ukáže rovno (netreba nič skrývať)
  if (info && info.animate === false) { colorRollEl.classList.add("hidden"); return; }
  const white = me === "p1";
  colorRollEl.classList.remove("hidden");
  colorRollEl.style.opacity = "";
  crResultEl.classList.add("hidden");
  crResultEl.innerHTML = "";
  // 4 celé otáčky + dobeh na cieľovú farbu ± rozptyl (len vizuálny - výsledok je daný)
  const target = (white ? 270 : 90) + (Math.random() * 40 - 20);
  crArrowEl.getAnimations().forEach(a => a.cancel());
  const spin = crArrowEl.animate(
    [{ transform: "rotate(0deg)" }, { transform: `rotate(${4 * 360 + target}deg)` }],
    { duration: 3400, easing: "cubic-bezier(.12,.68,.18,1)", fill: "forwards" }
  );
  spin.onfinish = () => {
    crResultEl.innerHTML = white
      ? `YOU PLAY <span class="cr-white">⚪ WHITE</span> - YOU GO FIRST!`
      : `YOU PLAY <span class="cr-black">⚫ BLACK</span> - YOU GO SECOND`;
    crResultEl.classList.remove("hidden");
    setTimeout(() => {
      const fade = colorRollEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: "ease-in", fill: "forwards" });
      fade.onfinish = () => {
        colorRollEl.classList.add("hidden");
        fade.cancel(); // fill:forwards by inak držal opacity 0 aj pri ďalšom zápase
      };
    }, 1700);
  };
});

// hra je plná - divák hru sleduje, ale nemá výber postavy ani ovládanie (box s hláškou dole)
socket.on("spectator", () => {
  setSpectator();
  hideRooms();
  document.getElementById("spectator")?.classList.remove("hidden");
  selEl.classList.add("hidden");
  stopCharSelectPreview();
  const controls = document.querySelector(".controls-row");
  if (controls) controls.style.display = "none";
});

socket.on("reset", () => {
  playback.playGen++;        // zruš prípadné bežiace prehrávanie
  playback.playing = false;
  hideConnError();
  resetActorFade();
  clearProjectiles(); // žiadny letiaci projektil nesmie prežiť reset

  // reset game-over stavov ešte pred renderHUD - inak by guard nechal visieť GAME OVER text
  playback.serverWinner = null;
  playback.serverGameResult = null;
  playback.gameOverShown = false;
  lastAttackEndAt = { p1:0, p2:0 };
  stopTurnTimer();
  intermissionEl.classList.add("hidden");

  goOverlay.classList.add("hidden");
  dirPicker.classList.add("hidden");
  aimPicker.classList.add("hidden");
  clearActionLogs();
  planning.myQueue = [];
  planning.goldenArmed = false;
  planning.goldenMirrorArmed = false;
  planning.goldenManaArmed = false;
  planning.lastStandArmed = false;
  planning.lastHopeArmed = false;
  planning.lockedIn = false;
  syncGoldenHalves();
  syncGoldDualHalves();
  closePickers();
  renderQueue();
  animState = { p1:{key:"idle", until:0}, p2:{key:"idle", until:0} };
  cloneFlinch = { p1: 0, p2: 0 };
  castingNow = { p1:false, p2:false };
  facingOverride = { p1: { sx: 0, until: 0 }, p2: { sx: 0, until: 0 } };
  clearActors();
  lockBtn.classList.remove("locked");
  lockBtn.disabled = false;
  lockBtn.textContent = "LOCK IN";
  if (hudTurn) hudTurn.textContent = "";
  // char-select / lobby riadi applyPhaseUI z nasledujúceho state eventu
  renderGrid({}, []);
  renderHUD();
});

socket.on("state", (s) => {
  tlog("recv state", { phase: s.phase, timerMs: s.timerMs, timeline: !!s.timeline, p1c: s.p1?.char, p2c: s.p2?.char, playing: playback.playing });
  setState(s);
  for (const slot of ["p1", "p2"]) {
    const c = s?.[slot]?.char || null;
    // register fx: postava sa na slote (znova) objavila - Escanor: reset premeny (nasadenie / turnajový swap),
    // Jotaro: summon intro standu znova
    fxAll("stateChar", slot, c, s);
  }
  // FINAL ROUND hore podľa plánovacieho/refresh stavu (stavy s timeline = summon nechávame, prepne ho až banner)
  if (!s.timeline) playback.finalRoundActive = !!s.goldLocked;

  // arena
  if (s.arena && s.arena !== arenaEl.dataset.key) {
    arenaEl.dataset.key = s.arena;
    const ARENAS_CLIENT = { bridge: ["sky-bridge.png","clouds.png","clouds-2.png","tower.png","bridge.png"] };
    renderArenaLayers(s.arena, ARENAS_CLIENT[s.arena] || []);
  }

  // lobby / čakanie / char-select podľa fázy hry
  applyPhaseUI(s);
  updateMatchScore(s);

  if (s.timeline) {
    // finálny stav (vrátane nových tiles) nevykresľuj hneď - ukáže ho až posledný frame timeline
    schedulePlayTimeline(s.timeline);
  } else if (!playback.playing) {
    // čerstvý stav mimo prehrávania → stredový démon nemá čo visieť (objaví sa len počas timeline);
    // toto ho po reconnecte/refreshi spoľahlivo schová bez nutnosti F5
    hideDeathCenter();
    renderGrid(s);
    renderHUD();
    positionActors(s, true);
    renderQueue(); // prekresli round-script lištu (zlatý skeleton mojich slotov hneď, bez interakcie)
  }
  // počas prehrávania snapshot bez timeline nevykresľuj - framy bežiacej timeline majú prednosť

  // Jotaro THE WORLD: reload/reclaim počas čakania → snapshot nesie timestop (bez timeline) → obnov ts-mód;
  // ak timestop zmizol (kolo pokračuje inou cestou) → vypni prípadný zaseknutý filter/overlay
  if (s.timestop && !s.timeline) enterTimestopMode();
  else if (!s.timestop && !s.timeline && (playback.tsPlanning || playback.tsFrozen)) {
    playback.tsPlanning = false; playback.tsFrozen = false; tsOverlaySet(false); document.body.classList.remove("timestop-mode"); updateUiLocks();
  }

  // dash/attack tlačidlá podľa mága - Vampire/Onryō: dash = fialový charge, attack = strela s odrazom
  syncDashBtn(s[me]?.char);
  // mirror slot podľa mága - Jotaro tu má Special 1 (fialový ❔ skin + L/R picker)
  syncMirrorBtn(s[me]?.char);
  // recharge slot podľa mága - Luffy tu má prepínač módu (fialový ❔ skin)
  syncRechargeBtn(s[me]?.char);
  // odznak stavu na tlačidlách (Luffy: mód na range attack + special)
  syncButtonBadges(s[me]?.char);
  // label melee podľa mága - Medúza má širší dosah (diagonály) za nižší dmg; Vampire/Onryō majú center strike bez bonusu
  const mineMelee = s[me];
  if (mineMelee?.char && meleeBtn) {
    const def = CHAR_BUTTONS[mineMelee.char]?.melee ?? BTN_BASE.melee;
    meleeBtn.title = def.title;
    const mCost = meleeBtn.querySelector(".cost");
    if (mCost) { mCost.innerHTML = costHtml(def.cost); hydratePix(mCost); }
  }
  // label special podľa mága - v turnaji po naplánovanom swape platí nový mág (ghostCharAt), nie ten na štarte kola
  const specChar = ghostCharAt();
  if (specChar && specialBtn) {
    specialBtn.classList.remove("hidden-question");
    const specIco = specialBtn.querySelector(".pix-ico:not(.mini)");
    specialBtn.classList.remove("vamp-charge");
    if (specIco) {
      specIco.classList.remove("charge-mark");
      if (specIco.dataset.emoji !== "✨") {
        specIco.dataset.emoji = "✨";
        specIco.innerHTML = "";
        delete specIco.dataset.done;
        pixelizeEmoji(specIco);
      } else if (!specIco.dataset.done) {
        pixelizeEmoji(specIco);
      }
    }
    // title + cena podľa postavy (register: buttons.special; vlkolak per-frame cez syncDynamicSpecialBtn)
    applySpecialSkin(specChar, true);
  }

  setServerTimer(s.timerMs ?? null); // synchronizuj odpočet so serverom (drží aj po refreshi)
});

// server posiela zostávajúci čas na ťah - klient sa naň synchronizuje (displej + auto-lock)
socket.on("turn_timer", ({ ms }) => { tlog("recv turn_timer", ms); setServerTimer(ms); });

// Server stále posiela "game_over" – len si zapamätáme, nezobrazíme hneď overlay.
// Overlay zobrazíme až po dobehnutí útoku a animácii smrti.
socket.on("game_over", ({ winner }) => {
  playback.serverWinner = winner;
});

// výsledok jednej hry série - vyhodnotí sa až na konci prehrávania timeline
socket.on("game_result", (r) => { playback.serverGameResult = r; });

// medzi hrami série: resetuj UI kola (skóre ostáva), char-select pre ďalšiu hru riadi nasledujúci state
socket.on("new_game", () => {
  tlog("recv new_game");
  playback.playGen++; playback.playing = false;
  playback.serverWinner = null; playback.serverGameResult = null; playback.gameOverShown = false;
  lastAttackEndAt = { p1:0, p2:0 };
  hideDeathCenter(); // démon zo summon/banish nesmie prejsť do ďalšej hry
  hideDeathBehind(); // ani ten za postavou (banish ho mohol nechať visieť pri race s koncom hry)
  resetActorFade();  // teleport fade nesmie prejsť do ďalšej hry
  clearProjectiles(); // ani letiaci projektil
  stopTurnTimer();
  intermissionEl.classList.add("hidden");
  goOverlay.classList.add("hidden");
  dirPicker.classList.add("hidden"); aimPicker.classList.add("hidden");
  clearActionLogs();
  planning.myQueue = []; planning.goldenArmed = false; planning.goldenMirrorArmed = false; planning.goldenManaArmed = false; planning.lastStandArmed = false; planning.lastHopeArmed = false; planning.lockedIn = false;
  syncGoldenHalves();
  syncGoldDualHalves();
  closePickers(); renderQueue();
  animState = { p1:{key:"idle", until:0}, p2:{key:"idle", until:0} };
  cloneFlinch = { p1: 0, p2: 0 };
  castingNow = { p1:false, p2:false };
  facingOverride = { p1: { sx: 0, until: 0 }, p2: { sx: 0, until: 0 } };
  clearActors();
  lockBtn.classList.remove("locked"); lockBtn.disabled = false; lockBtn.textContent = "LOCK IN";
  if (hudTurn) hudTurn.textContent = "";
});

/* ---------- RAF: actors + FX ---------- */
function raf() {
  const now = performance.now();
  const map = { p1: actorP1, p2: actorP2 };

  tickTurnTimer(now); // odpočet času na ťah (auto-lock pri vypršaní)

  // po vypršaní facing override (streľba do strany) otoč postavu späť k súperovi -
  // positionActors sa inak volá len pri timeline frame-och, takže posledná akcia kola by ostala "visieť"
  for (const slot of ["p1", "p2"]) {
    const ov = facingOverride[slot];
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
    const aSt = animState[slot];
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
    const poseCrop = (cloneSummonPose[slot] && performance.now() < cloneSummonPose[slot].until) ? SUMMON_CROP : 0;
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
    const aSt = animState[slot];
    const stoned = (st.stone || 0) > 0;
    const flAt = cloneFlinch[slot] || 0;
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
      if (animState[slot].key === "hurt" || animState[slot].key === "dead") anim = ANIM_DEF.idle;
    }
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, animT, ACTOR_W, ACTOR_H))
      .catch(() => {});
  });

  // ďalšie figúry postáv z registra fx (Jotarov stand Star Platinum: `_P` pás podľa Jotarovej animácie)
  fxAll("drawBoard", now);
  // summon kópia (Narutov clone_summon) - dočasný canvas na tej istej bunke hrá Special_2 tvárou v tvár
  cloneSummonFx = cloneSummonFx.filter(f => f.el.isConnected);
  for (const f of cloneSummonFx) {
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
      if (!hudDeadSince[slot]) hudDeadSince[slot] = now;
      anim = ANIM_DEF.dead;
      t = now - hudDeadSince[slot];
    } else {
      hudDeadSince[slot] = 0;
    }
    // Medúza/Minotaur normalizovaní na výšku mágov (PORTRAIT_SCALE) + ukotvení k spodku,
    // aby stáli na rovnakej línii ako mágovia (centrovanie by menšiu postavu nechalo plávať)
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, t, cvs.width, cvs.height,
        portraitFill(st.char, 0.95), PORTRAIT_SCALE[st.char] ? 0.92 : 0.5))
      .catch(() => {});
  });

  // projectiles (plynulé perzistentné elementy v #actors)
  document.querySelectorAll("canvas.projectile").forEach(cvs => {
    const ctx = cvs.getContext("2d");
    const dir = cvs.dataset.dir;
    ensureSpriteMeta(dir, CHARGE_ANIM.file)
      .then(meta => drawSprite(ctx, meta, CHARGE_ANIM, now, cvs.width, cvs.height))
      .catch(() => {});
  });

  // HUD hlavy magov + swap badge hlavy - animovaný výrez hlavy z idle spritu
  document.querySelectorAll("canvas.mage-head[data-char]").forEach(cvs => drawMageHeadAnim(cvs, cvs.dataset.char, now));

  // specials v strede
  document.querySelectorAll("canvas.special-center").forEach(cvs => {
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
  document.querySelectorAll(".charge-aura[data-slot]").forEach(cont => placeChargeAura(cont, cont.dataset.slot));

  // Last Stand - trvalý golden stav riadený serverom (state[slot].lastStandBuff):
  // žiara postavy (actorFilter) + zlatý HUD + recharge aura + priehľadný démon za postavou
  {
    const buffSlot = state?.p1?.lastStandBuff ? "p1" : state?.p2?.lastStandBuff ? "p2" : null;
    if (buffSlot) {
      _lsRealActive = true;
      // zlatý stav: buff zo servera sa zapne presne vo fáze „revive" (po smrti); počas banishu VYPNUTÝ
      const goldOn = !_lsBanishing;
      _deathGoldenSlot = goldOn ? buffSlot : null;
      hudBoxP1.classList.toggle("death-golden", goldOn && buffSlot === "p1");
      hudBoxP2.classList.toggle("death-golden", goldOn && buffSlot === "p2");
      if (goldOn && now - _lsAuraAt > 950) { spawnChargeAura(buffSlot, true); _lsAuraAt = now; } // permanentná golden recharge
      // démon sa drží za postavou na 0.25 - naviazaný na ŽIVÚ (interpolovanú) pozíciu sprite-u postavy,
      // takže sa kĺže spolu s ňou (nie teleport). Drží sa keď postava STOJÍ (server flag !st.down) - počas
      // summon/banish prechodov (st.down=true, resp. _lsBanishing) ho riadia efekty. State-driven = robustné.
      const tgt = state[buffSlot];
      // labyrint: skrytý buffnutý hráč (x null) - priehľadný démon za postavou sa skryje,
      // nemá ho kam sledovať (inak by ostal svietiť na starej/rohovej pozícii a prezradil buff)
      if (tgt && tgt.x == null) {
        deathBehind.style.opacity = "0";
      } else if (_lsBanishing && tgt && tgt.down) {
        // po banish kille hráč leží mŕtvy - démon za postavou nemá za kým visieť; stavová poistka
        // drží nulu každý tick (fill-forwards animácia banishu mohla racenúť so state updatom).
        // Summon choreografiu (down=true, _lsBanishing=false) sa toto nedotýka - revive riadi efekt.
        deathBehind.style.opacity = "0";
      } else if (!_lsBanishing && tgt && tgt.char && !tgt.down) {
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
    } else if (_lsRealActive) {
      // koniec buffnutého stavu (smrť/výhra) - uprac
      _lsRealActive = false; _lsBanishing = false; _deathGoldenSlot = null;
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
      _lhRealActive = true;
      const tgt = state[hopeSlot];
      if (tgt && tgt.char && !tgt.down && now - _lhAuraAt > 950) { spawnChargeAura(hopeSlot, false, true); _lhAuraAt = now; }
    } else if (_lhRealActive) {
      _lhRealActive = false;
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

/* ---------- Initial ---------- */
// hydratácia pixel ikon - [data-emoji] dostanú pixelizovaný emoji canvas,
// [data-pix] ručne kreslené SVG z PIX knižnice (HP/mana v HUD)
hydratePix();
document.querySelectorAll(".pix-ico[data-pix]").forEach(el => { el.innerHTML = pixSvg(el.dataset.pix); });

gridEl.style.gridTemplateColumns = `repeat(${board.w}, ${TILE_W}px)`;
gridEl.style.gridTemplateRows = `repeat(${board.h}, ${TILE_H}px)`;
renderGrid({}, []);
renderHUD();
renderQueue();
clearActionLogs(); // skeleton placeholderov v zázname kola od začiatku

// hover preview pre special (const specialBtn je deklarovaný pri controls)
if (specialBtn){
  // preview z ghost pozície - special by sa vykonal po už naplánovaných akciách
  specialBtn.addEventListener("mouseenter", ()=>{
    const char = ghostCharAt();   // po prípadnom swape vo fronte = nový mág
    const p = ghostPos();
    if (!char || !p) return;
    const target = specialTargetOf(char);
    if (target === "dir" || target === "wolf") return; // smerový special - preview ukazujú až šípky pickeru
    showPreviewCells(cellsForSpecialPreview({ x: p.x, y: p.y, char, worldUsed: state?.[me]?.worldUsed }));
  });
  specialBtn.addEventListener("mouseleave", clearPreviewCells);
}
// hover preview zóny Medúzinho specialu na šípkach pickeru (←/→) - z ghost pozície
specialPicker?.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => {
    const char = ghostCharAt();
    const p = ghostPos();
    if (specialTargetOf(char) === "dir" && p)
      showPreviewCells(cellsForSpecialPreview({ x: p.x, y: p.y, char, pride: state?.[me]?.pride, worldUsed: state?.[me]?.worldUsed }, dir));
  });
  btn.addEventListener("mouseleave", clearPreviewCells);
});
// hover preview Jotarovho Special 1 na šípkach s1-pickera (←/→) - obe diagonály strany z ghost pozície
s1Picker?.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => { const p = ghostPos(); if (p) showPreviewCells(cellsForJotaroS1(p, dir)); });
  btn.addEventListener("mouseleave", clearPreviewCells);
});
// hover preview dráhy vlkolakovho charge na šípkach 8-smerového pickera - z ghost pozície,
// stop na viditeľnej figúre súpera (foe); skrytý súper v labyrinte → dráha až na okraj
wolfPicker?.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    const char = ghostCharAt();
    if (specialTargetOf(char) === "wolf" && p)
      showPreviewCells(cellsForSpecialPreview({ x: p.x, y: p.y, char, foe: state?.[otherSlot()] }, dir));
  });
  btn.addEventListener("mouseleave", clearPreviewCells);
});

// hover preview zásahovej bunky melee - vlastná bunka z ghost pozície po naplánovaných akciách
// (meleeBtn je deklarovaný pri controls; Countess/Onre dráhy ukazujú až šípky vamp pickera)
if (meleeBtn) {
  meleeBtn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    if (p) showPreviewCells(cellsForMeleePreview(p, ghostCharAt()));
  });
  meleeBtn.addEventListener("mouseleave", clearPreviewCells);
}
// hover preview dráhy charge Vampire/Onryō na šípkach dash pickera (dash = charge; stop na
// viditeľnej figúre súpera) - pre ostatné postavy dash hover nič neukazuje (čistý pohyb)
dashPicker?.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    const char = ghostCharAt();
    if (VAMP_CHARS[char] && p) // dash = charge
      showPreviewCells(cellsForVampChargePreview(p, dir, state?.[otherSlot()]));
  });
  btn.addEventListener("mouseleave", clearPreviewCells);
});
// hover preview lomenej dráhy diagonálnej strely (Vampire/Onryō) na šípkach diag aim pickera
aimPickerDiag?.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    if (p) showPreviewCells(cellsForAimPreview(p, dir, ghostCharAt()));
  });
  btn.addEventListener("mouseleave", clearPreviewCells);
});

// hover preview dráhy strely na šípkach aim pickeru - z ghost pozície po naplánovaných akciách
aimPicker.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    if (!p) return;
    showPreviewCells(cellsForAimPreview(p, dir, ghostCharAt())); // char kvôli Luffy gear3 (zastav na súperovi)
  });
  btn.addEventListener("mouseleave", clearPreviewCells);
});
