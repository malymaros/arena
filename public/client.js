// public/client.js
// trvalá identita prehliadača: po výpadku spojenia si vďaka nej vyžiadame späť svoj hráčsky slot
// (inak by sa vrátený hráč stal divákom a server by prestal brať jeho lock_in)
let arenaId = null;
try {
  arenaId = localStorage.getItem("arenaId");
  if (!arenaId) {
    arenaId = (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + "-" + Math.random().toString(16).slice(2));
    localStorage.setItem("arenaId", arenaId);
  }
} catch { arenaId = null; } // localStorage zakázaný (napr. privátny režim) → bez reclaimu, len bežné pripojenie
const socket = io({ auth: { id: arenaId } });

const gridEl   = document.getElementById("grid");
const actorsEl = document.getElementById("actors");
const actorP1  = document.getElementById("actor-p1");
const actorP2  = document.getElementById("actor-p2");

const queueEl  = document.getElementById("queue");
const undoBtn  = document.getElementById("undo");
const lockBtn  = document.getElementById("lock");

const selEl    = document.getElementById("char-select");
const arenaEl  = document.getElementById("arena");

const hudTurn  = document.getElementById("hud-turn");
const hudBoxP1 = document.getElementById("hud-p1");
const hudBoxP2 = document.getElementById("hud-p2");
const hudP1Hp   = document.getElementById("p1-hp");
const hudP1Mana = document.getElementById("p1-mana");
const hudP2Hp   = document.getElementById("p2-hp");
const hudP2Mana = document.getElementById("p2-mana");
const hudCharP1 = document.getElementById("hud-char-p1");
const hudCharP2 = document.getElementById("hud-char-p2");
const flagP1    = document.getElementById("flag-p1");
const flagP2    = document.getElementById("flag-p2");
const logP1     = document.getElementById("log-p1");
const logP2     = document.getElementById("log-p2");

const goOverlay= document.getElementById("gameover");
const retryBtn = document.getElementById("retry");

const lobbyEl     = document.getElementById("lobby");
const lobbyWaitEl = document.getElementById("lobby-wait");
const intermissionEl = document.getElementById("intermission");
const crownsP1El = document.getElementById("crowns-p1");
const crownsP2El = document.getElementById("crowns-p2");
const turnTimerEl    = document.getElementById("turn-timer");
const roundBannerEl  = document.getElementById("round-banner");

const cs = getComputedStyle(document.documentElement);
const TILE_W = parseInt(cs.getPropertyValue("--tile-w")) || 260;
const TILE_H = parseInt(cs.getPropertyValue("--tile-h")) || 185;
const GAP  = parseInt(getComputedStyle(gridEl).gap || "10") || 10;

// === Last Stand „démon" sprite — strip 5024×314 = 16 štvorcových framov ===
const DEATH_DIR   = "death";
const DEATH_ANIM  = { file: "spritesheet_strip.png", fps: 10, loop: true };
const LS_BADGE_IMG = '<img class="ls-badge" src="/assets/last_stand.png" alt="Last Stand">'; // ikona Last Standu (zmenšenina démona) do lišty/záznamu
const DEATH_SCALE = 2.0;  // veľkosť stredového démona (násobok výšky bunky)

// === Last Hope „hope" postava — strip (analógia k death sprite) ===
const HOPE_DIR  = "hope";
// 9216×512 = 12 framov po 768px (framy NIE sú štvorcové → frame inference háda zle, preto explicitné frames)
const HOPE_ANIM = { file: "sprite_strip.png", fps: 10, loop: true, frames: 12 };
const LH_BADGE_IMG = '<img class="lh-badge" src="/assets/last_hope.png" alt="Last Hope">'; // ikona Last Hope do lišty

// vzhľad démona „za postavou" počas golden stavu (časovanie fáz riadi server cez delayMs frame-ov)
const DEATH_SEQ = {
  behindRatio:   0.72, // veľkosť za postavou
  behindOpacity: 0.25, // priehľadnosť za postavou v ustálenom golden stave
  behindOffsetX: 0,    // doladenie pozície na postave (px)
  behindOffsetY: 80,
};

// canvasy postáv — väčšie než bunka (1.5×), v positionActors centrované na bunku
const ACTOR_SCALE = 1.875;
const ACTOR_W = Math.round(TILE_W * ACTOR_SCALE);
const ACTOR_H = Math.round(TILE_H * ACTOR_SCALE);
[actorP1, actorP2].forEach(c => {
  c.width = ACTOR_W; c.height = ACTOR_H;
  c.style.width = ACTOR_W + "px"; c.style.height = ACTOR_H + "px";
});

// ghost — poloprehľadný náhľad vlastnej pozície po naplánovaných movoch vo fronte
const actorGhost = document.createElement("canvas");
actorGhost.id = "actor-ghost";
actorGhost.className = "sprite-actor sprite-ghost";
actorGhost.width = ACTOR_W; actorGhost.height = ACTOR_H;
actorGhost.style.width = ACTOR_W + "px"; actorGhost.style.height = ACTOR_H + "px";
actorGhost.style.display = "none";
actorsEl.appendChild(actorGhost);

// obrys súpera na Ariadninej nití (labyrint) — čierna silueta na bunke posledného vstupu na niť
const actorSilhouette = document.createElement("canvas");
actorSilhouette.id = "actor-silhouette";
actorSilhouette.className = "sprite-actor sprite-silhouette";
actorSilhouette.width = ACTOR_W; actorSilhouette.height = ACTOR_H;
actorSilhouette.style.width = ACTOR_W + "px"; actorSilhouette.style.height = ACTOR_H + "px";
// necháme ho VŽDY display:block a riadime len opacity — inak by CSS fade (vynorenie/strata v hmle) z display:none neprešlo
actorSilhouette.style.display = "block";
actorSilhouette.style.opacity = "0";
actorsEl.appendChild(actorSilhouette);

// transient preblik obrysu na prejdenej niťovej bunke — lovec prechádza niťou → na KAŽDEJ bunke, kde je,
// krátko preblikne jeho čierny obrys (nie len na poslednej). Vlastný canvas, po flash animácii sa odstráni.
function spawnSilhouetteFlash(cell, oppChar, oppS) {
  if (!oppChar || !Array.isArray(cell)) return;
  const el = document.createElement("canvas");
  // preblik na cudzej bunke = VŽDY čierny obrys (brightness(0)) — žiadny alt-color, ten by paletou
  // prebil čiernu (napr. pri labyrinte cez mirror, kde je lovec nenatívna postava na p2)
  el.className = "sprite-actor sprite-silhouette silh-flash-el";
  el.width = ACTOR_W; el.height = ACTOR_H;
  el.style.width = ACTOR_W + "px"; el.style.height = ACTOR_H + "px";
  const { left, top } = cellToPx(cell[0], cell[1]);
  el.style.left = (left - (ACTOR_W - TILE_W) / 2) + "px";
  el.style.top  = (top - (ACTOR_H - TILE_H)) + "px";
  actorsEl.appendChild(el);
  ensureSpriteMeta(charDirFor(oppChar, oppS), ANIM_DEF.idle.file)
    .then(meta => drawSprite(el.getContext("2d"), meta, ANIM_DEF.idle, 0, ACTOR_W, ACTOR_H))
    .catch(() => {});
  setTimeout(() => el.remove(), 550);
}

// tieňové klony (Narutov special) — sprite klona per strana; pozíciu rieši positionActors,
// kreslí raf zo state[slot].clone (na bunke majiteľa sa klon nekreslí — vidno len jednu postavu)
const cloneEls = { p1: null, p2: null };
for (const _slot of ["p1", "p2"]) {
  const c = document.createElement("canvas");
  c.id = "actor-clone-" + _slot;
  c.className = "sprite-actor sprite-clone";
  c.width = ACTOR_W; c.height = ACTOR_H;
  c.style.width = ACTOR_W + "px"; c.style.height = ACTOR_H + "px";
  c.style.display = "none";
  actorsEl.appendChild(c);
  cloneEls[_slot] = c;
}
// ghost klona — pri plánovaní ukáže budúcu pozíciu vlastného klona (vertikálne inverznú k mojim smerom)
const cloneGhost = document.createElement("canvas");
cloneGhost.id = "actor-clone-ghost";
cloneGhost.className = "sprite-actor sprite-ghost";
cloneGhost.width = ACTOR_W; cloneGhost.height = ACTOR_H;
cloneGhost.style.width = ACTOR_W + "px"; cloneGhost.style.height = ACTOR_H + "px";
cloneGhost.style.display = "none";
actorsEl.appendChild(cloneGhost);

// DEATH summon — screen-space overlay (fixed, mimo stacking contextu .stage, aby bolo vidno v každej fáze).
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

// „za postavou" — board-space canvas v #actors so z-indexom pod sprite-om postavy (.sprite-actor = 3)
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

// hmlový oblak za sprite-om (radiálny gradient + blur) — „zaujímavý mlžný efekt" pri zjavení
const deathFog = document.createElement("div");
deathFog.id = "death-fog";
Object.assign(deathFog.style, {
  position: "fixed", left: "50%", top: "50%", width: "560px", height: "560px",
  transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: "999998",
  borderRadius: "50%", display: "none", filter: "blur(28px)", opacity: "0",
  background: "radial-gradient(circle at center, rgba(214,190,255,.55), rgba(150,120,220,.28) 45%, rgba(120,90,200,0) 70%)",
});
document.body.appendChild(deathFog);

// Last Hope — stredový „hope" overlay (analógia k deathCenter), vlastný canvas nech sa nebije s démonom
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

// „YOU" značka — poskakujúca zlatá šípka nad vlastnou postavou (kotví sa k pozícii aktéra)
const youMarker = document.createElement("div");
youMarker.className = "you-marker";
youMarker.innerHTML = `<div class="you-marker-bob"><span class="you-tag">YOU</span><span class="you-tip"></span></div>`;
youMarker.style.display = "none";
actorsEl.appendChild(youMarker);
// horizontálny stred hlavy v rámci sprite (0..1) — postavy nie sú centrované; zmerané z Idle.png,
// jemne posunuté k tvári (geom. stred zahŕňa aj vlasy vzadu, takže vlajka pôsobila „za hlavou")
const HEAD_CX = { fire: 0.43, lightning: 0.44, wanderer: 0.47, medusa: 0.47, minotaur: 0.46, naruto: 0.50 };
// vrch hlavy ako zlomok výšky actor canvasu — Medúza je vztýčená vyššie než mágovia (vrch figúry
// ~0.40 vs ~0.48 framu), fixná hodnota jej sadila šípku do vlasov; namerané z Idle.png
// Minotaur: vrch rohov ~0.29 framu (bbox y od 36/128)
const HEAD_TOP = { fire: 0.48, lightning: 0.48, wanderer: 0.48, medusa: 0.40, minotaur: 0.29, naruto: 0.51 };

// zelená šípka pod round-script lištou — počas animácie ukazuje na práve vykonávaný beat
const qCursor = document.createElement("div");
qCursor.className = "q-cursor";

// === Timing ===
// celkové spomalenie animácií kola (1 = pôvodné tempo) — MUSÍ sedieť so server.js ANIM_SLOW
const ANIM_SLOW = 1.8;
const MOVE_MS = Math.round(700 * ANIM_SLOW); // pohyb na boarde; CSS číta --move-ms (nastavené nižšie)
// POZN.: neslučkové animácie (attack/attack2/hurt/dead) sa kvôli drawSprite(t=now) reálne neprehrávajú
// frame po frame — len držia poslednú pózu. Preto ich NEdržíme fixný čas (predtým 2400 ms = vizuálny „drag“),
// ale presne po dobu daného timeline frame-u (frame.delayMs), aby póza zmizla keď začne ďalšia akcia.
// special/melee tým ostávajú dlhé (ich beaty majú delayMs 1350 ms), basic/hurt sa skrátia na svoj frame.
const POSE_TAIL_MS = 300; // o koľko dlhšie strelec „pozerá“ v smere streľby, nech otočenie vydrží po dopad

// každá nevykonaná akcia povie PREČO — dôvod zo servera → [text floatu, CSS trieda]; default = všeobecné odmietnutie
const INVALID_MSG = {
  mana:      ["⚠️ LOW MANA",  "lowmana-float"],
  mana_full: ["✨ MANA FULL",  "golden-float"],
  hp_low:    ["🙏 LOW HP",     "lowmana-float"],
  offboard:  ["🚫 OFF-BOARD",  "lowmana-float"],
  no_demon:  ["✗ DEMON TAKEN", "dmg-float"], // druhý Last Stand v kole — démon je len jeden
  already_stone: ["🗿 ALREADY STONE", "lowmana-float"], // Medúzin special na už skamenenú postavu — bez efektu
  already_lost: ["🌀 ALREADY LOST", "lowmana-float"],   // Minotaurov special na už blúdiaceho — bez efektu
  not_alone: ["🚫 NOT ALONE", "lowmana-float"],         // Narutov summon vyžaduje bunku bez súpera
};
const INVALID_MSG_DEFAULT = ["🚫 NO EFFECT", "lowmana-float"];
const NEW_ROUND_MS = 1900; // „ROUND N" animácia medzi kolami (musí sedieť s CSS .round-banner.show)
document.documentElement.style.setProperty("--move-ms", MOVE_MS + "ms"); // drž CSS pohyb v sync so spomalením

// Projektil
const CHARGE_SCALE = 1.0;
const CHARGE_ANIM  = { file: "Charge.png", fps: 8, loop: true };
const CHARGE_STEP_MS = Math.round(240 * ANIM_SLOW); // dĺžka preletu 1 bunky; MUSÍ sedieť so server.js CHARGE_STEP_MS
document.documentElement.style.setProperty("--charge-ms", CHARGE_STEP_MS + "ms"); // plynulý sklz projektilu (CSS .projectile)

// Special anim
const SPECIAL_SCALE = 4.8;
const SPECIAL_FPS   = 6;
const SPECIAL_ANIMS = {
  fire:      { file: "Flame_jet.png",    fps: SPECIAL_FPS, loop: true },
  lightning: { file: "Light_charge.png", fps: SPECIAL_FPS, loop: true },
  wanderer:  { file: "Magic_sphere.png", fps: SPECIAL_FPS, loop: true },
  medusa:    { file: "Special.png",      fps: SPECIAL_FPS, loop: true },
  minotaur:  { file: "Walk.png",         fps: SPECIAL_FPS, loop: true }, // bez vlastného fx spritu — cast = veľký kráčajúci Minotaur (blúdenie labyrintom)
  naruto:    { file: "Special.png",      fps: SPECIAL_FPS, loop: true }, // pečate rukami (summon tieňového klona)
};
// niektoré efektové sprity majú obsah mimo stredu framu — vodorovná korekcia (zlomok šírky canvasu) v náhľade
const FX_OFFSET_X = { lightning: 0.18 };

// Normalizácia veľkosti postavy v KARTÁCH výberu a HUD PORTRÉTE: mágovia vypĺňajú frame len z ~51 %
// výšky (veľa vzduchu), Medúza 59 % a Minotaur 72 % — pri rovnakom fill preto pôsobia príliš veľkí.
// Násobič ich zmenšuje na porovnateľnú výšku postavy; na BOARDE ostávajú zámerne väčší (bez násobiča).
const PORTRAIT_SCALE = { medusa: 0.85, minotaur: 0.7 };
const portraitFill = (char, base) => base * (PORTRAIT_SCALE[char] ?? 1);

const CHAR_META = {
  fire:      { name: "Fire Wizard",      dir: "fire" },
  lightning: { name: "Lightning Mage",   dir: "lightning" },
  wanderer:  { name: "Wanderer Magician",dir: "wanderer" },
  // Medúza: pravá strana (p2) má NATÍVNU tmavú paletu (Medusa2) namiesto CSS alt-color filtra;
  // Charge.png = prefarbený fire fireball (zeleno-žltý / fialový) vygenerovaný per paleta
  medusa:    { name: "Medusa",           dir: "medusa/Medusa", dirP2: "medusa/Medusa2" },
  // Minotaur: natívna p2 paleta (Minotaur_2, hnedý so sekerou); Charge.png = prefarbený fire fireball per paleta
  minotaur:  { name: "Minotaur",         dir: "minotaur/Minotaur_1", dirP2: "minotaur/Minotaur_2" },
  // Naruto: natívna p2 paleta (žltý kostým + zlatá čakra — paletový swap z kostýmov v sheete)
  naruto:    { name: "Naruto",           dir: "naruto/Naruto_1", dirP2: "naruto/Naruto_2" }
};
// sprite priečinok postavy pre daný slot — postava s natívnou p2 paletou (dirP2) nepoužíva alt-color filter
function charDirFor(char, slot) {
  const m = CHAR_META[char];
  return (slot === "p2" && m?.dirP2) ? m.dirP2 : m?.dir;
}
function usesAltColor(char, slot) { return slot === "p2" && !CHAR_META[char]?.dirP2; }
const ANIM_DEF = {
  idle:    { file: "Idle.png",     fps: 6,  loop: true  },
  run:     { file: "Run.png",      fps: 12, loop: true  },
  attack:  { file: "Attack_1.png", fps: 10, loop: false },
  attack2: { file: "Attack_2.png", fps: 10, loop: false },
  // looping variant pre melee — malá postava sa seká súbežne s veľkým sprite-om (inak by zamrzla na poslednom frame).
  // special nemá vlastný key: malá postava kreslí svoj efektový sprite (SPECIAL_ANIMS) cez key "casting" priamo v raf.
  attack2_loop: { file: "Attack_2.png", fps: 10, loop: true },
  attack1_loop: { file: "Attack_1.png", fps: 10, loop: true }, // melee Medúzy — šľah celým telom (Attack_1)
  hurt:    { file: "Hurt.png",     fps: 10, loop: false },
  // flinch = to isté PNG ako hurt, ale klon ho ZRKADLÍ (hurt/dead klon potláča na idle, aby zásah naň nič neprezradil).
  // Používa sa pri neplatnej akcii (žiadny dmg) → aj Naruto aj klon trhnú rovnako a nedá sa rozoznať pravý.
  flinch:  { file: "Hurt.png",     fps: 10, loop: false },
  dead:    { file: "Dead.png",     fps: 7,  loop: false },
  // Naruto: summon klona — po pečatiach hrá postava (aj kópie po bokoch) Special_2 (dýchanie)
  special2:{ file: "Special_2.png", fps: 6, loop: true },
  victory: { file: "Idle.png", fps: 6, loop: true } // placeholder — raf pre victory kreslí special sprite mága (SPECIAL_ANIMS)
};

let me = null;
let isHost = false;               // prvý pripojený hráč nastavuje zápas v lobby
let serverGameResult = null;      // výsledok poslednej dohranej hry (séria) — vyhodnotí sa na konci timeline
let board = { w: 4, h: 3 };
let state = { p1:null, p2:null, arena:null, turn:1, starter:"p1", phase:"lobby" };
let myQueue = [];
let goldenArmed = false;       // objednaný golden shield (extra predťah pred kolom, len keď som druhý)
let goldenMirrorArmed = false; // objednaný golden mirror — ten istý predťah, len odraz (vzájomne výlučný s golden shieldom)
let goldenManaArmed = false;   // objednaný golden mana refill (extra akcia po konci kola)
let lastStandArmed = false;    // objednaný Last Stand (duálny s golden mana, výlučný)
let lastHopeArmed = false;     // objednaný Last Hope (úvodná akcia nebuffnutého hráča vo final kole)
let chosenChar = null;
let abilityHoverChar = null;     // mág, ktorého špeciál práve vizualizujeme vo výbere (hover)
let abilityCasterCanvas = null;  // malý canvas v bunke castera mini-dosky (cyklický cast)

// počas special castu skryjeme bežný actor sprite
let castingNow = { p1:false, p2:false };
// teleport (výmena maga): postava fade-uje plynulo (WAAPI, inšpirované démonom) — ref na bežiacu fade animáciu
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
// klonový flinch (tile zásah na klonovi) — čas štartu; klon sa strhne rovnako ako pravý Naruto pri zásahu,
// aby „nezraniteľne" nestál a neprezradil sa. Nezávislé od animState (to zdieľa s majiteľom).
let cloneFlinch = { p1: 0, p2: 0 };
// klon je „mŕtvy" (puffol) — positionActors ho drží skrytého, aby po puffe už nepreblikol späť.
// Reset pri novom summone (clone_born) a v clearActors.
let cloneDead = { p1: false, p2: false };
const SPRITES = {};
let actorsInitialized = false;

// --- nový game-over manažment na klientovi
let serverWinner = null;          // koho ohlásil server
let gameOverShown = false;        // či už bolo zobrazené GO
let lastAttackEndAt = { p1:0, p2:0 }; // kedy (v čase performance.now) dobehne posledná animácia útoku
let _finalRoundActive = false;    // „FINAL ROUND" sa zobrazí hore až keď prebehne banner (nie už počas summonu)

// preview loop
let charPreviewRaf = 0;
// tournament: HP magov vlastného draftnutého tímu pre char-select; null mimo tournamentu
let charSelectHp = null;
let charSelectMana = null; // tournament: prenesená mana magov (per vlastný tím)
// turnajový draft (fáza team_select): lokálne rozpracovaný výber tímu v poradí klikov; potvrdí choose_team
let teamPick = [];
const TEAM_SIZE = 3; // musí sedieť so serverovým TEAM_SIZE

// od kedy je postava v HUD widgete mŕtva — Dead anim sa prehrá raz od tohto času
let hudDeadSince = { p1: 0, p2: 0 };

/* ---------- sprite helpers ---------- */
// Minotaur nemá Run/Attack_1/Attack_2 súbory — jeho sheet používa Walk/Attack; alias per priečinok,
// nech všetky ANIM_DEF/SPECIAL cesty fungujú bez per-char výnimiek v kóde
const SPRITE_FILE_ALIAS = {
  "minotaur/": { "Run.png": "Walk.png", "Attack_1.png": "Attack.png", "Attack_2.png": "Attack.png" },
};
function spriteFileFor(charDir, file) {
  for (const pfx in SPRITE_FILE_ALIAS) {
    if (charDir.startsWith(pfx) && SPRITE_FILE_ALIAS[pfx][file]) return SPRITE_FILE_ALIAS[pfx][file];
  }
  return file;
}
function ensureSpriteMeta(charDir, file) {
  file = spriteFileFor(charDir, file);
  SPRITES[charDir] ||= {};
  if (SPRITES[charDir][file]) return Promise.resolve(SPRITES[charDir][file]);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const frames = Math.max(1, Math.round(img.naturalWidth / img.naturalHeight));
      const fw = Math.round(img.naturalWidth / frames);
      const fh = img.naturalHeight;
      SPRITES[charDir][file] = { img, frames, fw, fh };
      resolve(SPRITES[charDir][file]);
    };
    img.onerror = reject;
    img.src = `/assets/${charDir}/${file}`;
  });
}
function drawSprite(ctx, meta, anim, t, dstW=TILE_W, dstH=TILE_H, fill=0.95, anchorY=0.5, clear=true, offsetX=0, offsetY=0, cropXFrac=0) {
  // anim.frames prepíše odhad počtu framov (keď framy nie sú štvorcové a inference zlyhá)
  const total = anim.frames || meta.frames;
  const fw = anim.frames ? Math.round(meta.img.naturalWidth / total) : meta.fw;
  const idx = anim.loop ? Math.floor((t / (1000 / anim.fps)) % total)
                        : Math.min(total - 1, Math.floor(t / (1000 / anim.fps)));
  // cropXFrac: odreže prázdny (transparentný) okraj po bokoch framu — kreslí sa len stredový pás postavy
  const cropPx = Math.round(fw * Math.max(0, Math.min(0.45, cropXFrac)));
  const sx = idx * fw + cropPx;
  const sw = fw - 2 * cropPx;
  const scale = Math.min(dstW / fw, dstH / meta.fh) * fill; // výška ostáva „normálna" (škáluje sa podľa plnej výšky/šírky framu)
  const dw = sw * scale, dh = meta.fh * scale;
  // anchorY: 0 = hore, 0.5 = stred, 1 = dole; offsetX/offsetY = posun v px (záporné offsetY dvíha hore)
  const dx = (dstW - dw) / 2 + offsetX, dy = (dstH - dh) * anchorY + offsetY;
  if (clear) ctx.clearRect(0, 0, dstW, dstH); // clear=false -> vrstvenie (efekt navrch mága)
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(meta.img, sx, 0, sw, meta.fh, dx, dy, dw, dh);
}

/* ---------- Teleport (výmena maga v turnaji) — dvojfázová explózia ---------- */
// framy sú JEDNOTLIVÉ číslované PNG (nie horizontálny strip ako ostatné sprity) → vlastný loader/prehrávač
const TELEPORT_DIR   = { fire: "Fire", lightning: "Lightning", wanderer: "Wanderer" };
const TELEPORT_COUNT = { fire: 6, lightning: 10, wanderer: 10 };
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
// per-mág: veľkosť explózie (× rozmer políčka) + kotvenie ("feet" = od nôh nahor, "torso" = na stred torza)
// bottomTrim = zlomok výšky PNG, ktorý je pod viditeľným obsahom priehľadný (obsah vo frame nesiaha po spodok)
// dy = dodatočný posun celej explózie NADOL (× výška políčka) — ručné doladenie per mág
const TELEPORT_FX = {
  fire:      { scale: 1.0, anchor: "feet" },   // oheň horí od zeme, zmestí sa do políčka
  lightning: { scale: 1.6, anchor: "feet", bottomTrim: 0.17, dy: 0.20 }, // blesk šľahá od nôh nahor
  wanderer:  { scale: 1.6, anchor: "torso", dy: 0.12 },
};
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
    // horizontálne = stred TELA postavy (sprite je vo frame mimo stredu — rovnaký HEAD_CX + flip vzor
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

/* ---------- Mage head ikona (HUD hlavy + swap badge) — ANIMOVANÝ výrez hlavy z Idle sprite ---------- */
// per-mág výrez hlavy z framu (cx,cy = stred výrezu ako zlomok šírky/výšky framu; size = strana štvorca ako zlomok výšky).
// Hodnoty vylaď cez /head-cropper.html a nahraď ich sem. cxP2 = korekcia pre natívny p2 sheet (dirP2),
// keď v ňom figúra sedí inde než v p1 sheete (Minotaur_2 je o ~0.05 šírky framu vpravo oproti Minotaur_1).
const HEAD_CROP = {
  fire:      { cx: 0.40, cy: 0.55, size: 0.26 },
  lightning: { cx: 0.41, cy: 0.58, size: 0.26 },
  wanderer:  { cx: 0.47, cy: 0.56, size: 0.27 },
  medusa:    { cx: 0.45, cy: 0.48, size: 0.30 }, // namerané z Idle.png (hlava+hady riadky ~51–73)
  minotaur:  { cx: 0.46, cy: 0.40, size: 0.30, cxP2: 0.51, cyP2: 0.43 }, // namerané z Idle.png (rohy+hlava riadky ~36–74); cxP2/cyP2 = korekcia na posunutú figúru v Minotaur_2
  naruto:    { cx: 0.50, cy: 0.58, size: 0.26 }, // bojový postoj (Stance) — figúra centrovaná, bottom-anchor
};
const mageHeadHtml = (char, cls = "", slot = "") => `<canvas class="mage-head ${cls}" data-char="${char}"${slot ? ` data-slot="${slot}"` : ""} width="52" height="52"></canvas>`;
// vykresli AKTUÁLNY idle frame maga orezaný na hlavu (volané z raf → hlava sa animuje)
function drawMageHeadAnim(cvs, char, now) {
  const dir = charDirFor(char, cvs.dataset.slot || null); // p2 hlava Medúzy = natívna tmavá paleta
  const c = HEAD_CROP[char];
  if (!dir || !c) return;
  // natívny p2 sheet môže mať figúru posunutú inde — použi jeho vlastný stred výrezu
  const isP2Sheet = dir === CHAR_META[char]?.dirP2;
  const cx = (isP2Sheet && c.cxP2 != null) ? c.cxP2 : c.cx;
  const cy = (isP2Sheet && c.cyP2 != null) ? c.cyP2 : c.cy;
  ensureSpriteMeta(dir, ANIM_DEF.idle.file).then(meta => {
    const ctx = cvs.getContext("2d");
    const fps = ANIM_DEF.idle.fps || 6;
    const idx = Math.floor((now / (1000 / fps)) % meta.frames); // aktuálny idle frame
    const fw = meta.fw, fh = meta.fh, side = fh * c.size;
    let sx = idx * fw + fw * cx - side / 2;
    let sy = fh * cy - side / 2;
    sx = Math.max(idx * fw, Math.min(idx * fw + fw - side, sx)); // udrž výrez v rámci TOHTO framu
    sy = Math.max(0, Math.min(fh - side, sy));
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(meta.img, sx, sy, side, side, 0, 0, cvs.width, cvs.height);
  }).catch(() => {});
}

/* ---------- animation state ---------- */
function setAnim(slot, key, durationMs = 0) {
  const def = ANIM_DEF[key] ?? ANIM_DEF.idle;
  animState[slot].key = key;
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
// veľký centrálny overlay — pre special efektový sprite mága, pre melee zväčšená postava so sekaním
function updateSpecialCenter(casts) {
  actorsEl.querySelectorAll(".special-center").forEach(n => n.remove());
  if (!Array.isArray(casts) || casts.length === 0) return;

  // veľký sprite musí byť otočený rovnako ako malá postava na ploche (poloha voči súperovi + override streľby)
  const facing = computeFacing(state?.p1, state?.p2);

  for (const sp of casts) {
    const caster = state?.[sp.from];
    if (!caster || !caster.char) continue;
    const dirKey = charDirFor(caster.char, sp.from);
    const file   = sp.file || SPECIAL_ANIMS[caster.char].file;

    const cvs = document.createElement("canvas");
    const px  = Math.round(TILE_H * SPECIAL_SCALE);
    cvs.width = px; cvs.height = px;
    cvs.className = "special-center";
    if (usesAltColor(caster.char, sp.from)) cvs.classList.add("alt-color");
    cvs.dataset.dir  = dirKey;
    cvs.dataset.file = file;
    if (sp.fps) cvs.dataset.fps = sp.fps;

    const flip = currentFacing(sp.from, facing);
    cvs.style.left = "50%";
    cvs.style.top  = "50%";
    cvs.style.transform = `translate(-50%, -50%) scaleX(${flip})`;

    actorsEl.appendChild(cvs);
  }
}

/* ---------- bubliny -X HP / +Y MANA ---------- */
function cellToPx(x, y) { return { left: x * (TILE_W + GAP), top: y * (TILE_H + GAP) }; }

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

function spawnManaFloat(slot, amount = 4, gold = false) {
  const target = state?.[slot];
  if (!target || target.x == null) return;
  const { left, top } = cellToPx(target.x, target.y);

  const el = document.createElement("div");
  el.className = gold ? "mana-float gold" : "mana-float"; // golden mana = ten istý efekt, len zlatý
  el.textContent = `+${amount} MANA`;
  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + 8 - floatOffsetFor(slot)) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// float na konkrétnej bunke (bez väzby na hráča) — napr. stopa na Ariadninej nití
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

// zánik klona — poriadny oblak dymu (kage bunshin puff): niekoľko dymových gúľ vyletí do strán a nahor,
// stredové jadro sa roztiahne. Čisto kozmetické, self-remove; puffne raz (späť už nepreblikne — cloneDead).
function spawnClonePuff(cell) {
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
    el.style.background = "radial-gradient(circle, rgba(240,240,245,.95), rgba(190,192,200,.6) 55%, rgba(160,162,172,0) 72%)";
    actorsEl.appendChild(el);
    return el;
  };
  // stredové jadro — rýchly veľký záblesk dymu
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

// float aj nad VIDITEĽNÝM tieňovým klonom — obranné/mana hlášky nesmú prezradiť, ktorá postava je pravá
function cloneFloat(slot, text, className) {
  const o = state?.[slot];
  const c = o?.clone;
  if (!o || !c || o.x == null || (c.x === o.x && c.y === o.y)) return;
  spawnCellFloat([c.x, c.y], text, className);
}

// Naruto summon: jedna kópia na TEJ ISTEJ bunke, otočená proti Narutovi (kage bunshin moment —
// dvaja Naruti na jednom políčku tvárou v tvár); docasný canvas kreslí raf (cloneSummonFx), po dohraní framu sa odstráni
let cloneSummonFx = [];
let cloneSummonPose = { p1: null, p2: null }; // póza skutočného Naruta počas Special_2 (drží ju positionActors)
const SUMMON_CROP = 0.24; // orez prázdneho bočného okraja spritu počas Special_2 (aby sa dvaja Naruti vošli vedľa seba)
function spawnCloneSummonFx(slot, cell, durMs) {
  const st = state?.[slot];
  if (!st || !st.char || !Array.isArray(cell)) return;
  const facing = computeFacing(state?.p1, state?.p2)[slot] || 1;
  // NORMÁLNA výška (bez zmenšenia) — aby sa dvaja Naruti vošli vedľa seba, orežeme prázdny bočný okraj spritu
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
// isClone = true: klon NEZRKADLÍ Last Stand vizuály (zlatý death-glow) — ostáva neutrálny (rozhodnutie hráča)
function actorFilter(slot, now, isClone = false) {
  const st = state?.[slot];
  // golden recharge stav (death summon) — žiarivý zlatý pulz postavy, má prednosť pred ostatným (klon ho nemá)
  if (_deathGoldenSlot === slot && !isClone) {
    const t = 0.5 + 0.5 * Math.sin(now / 110);
    return `brightness(${(1.15 + 0.45 * t).toFixed(2)}) saturate(1.5) ` + pulseGlow("#ffd24a", now);
  }
  const alt = usesAltColor(st?.char, slot) ? "saturate(.22) brightness(1.4) " : "";
  // skamenená postava — kamenná sivá (prekryje aj alt filter, socha je socha)
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
  // postava nie je v strede bunky — rovnaký horizontálny offset tela ako „YOU" vlajka (HEAD_CX + flip)
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
// takže projektil KĹŽE po bunkách cez CSS transition (left/top var(--charge-ms) linear) — rovnako ako
// pohyb postavy, bez poskakovania a bez miznutia uprostred letu. Kľúč rozlišuje strelca a jeho klonovu
// strelu (Naruto + klon = dve súbežné strely, klonova s invertovanou vertikálou).
const projectiles = new Map(); // `${from}-${clone?1:0}` -> { el, retire }
function projCenter(x, y) {
  const { left, top } = cellToPx(x, y);
  return { left: left + TILE_W / 2, top: top + TILE_H / 2 }; // stred bunky v súradniciach #actors (element má translate(-50%,-50%))
}
function spawnOrMoveProjectile(c, s) {
  const charKey = s?.[c.from]?.char;
  const dirKey  = charKey ? (CHAR_META[charKey].chargeDir || charDirFor(charKey, c.from)) : null;
  if (!dirKey) return;
  const key = `${c.from}-${c.clone ? 1 : 0}`;
  let entry = projectiles.get(key);
  if (entry && entry.retire) { clearTimeout(entry.retire); entry.retire = null; } // strela ešte letí ďalej
  const dst = projCenter(c.cell[0], c.cell[1]);
  if (!entry) {
    const el = document.createElement("canvas");
    const px = Math.round(TILE_H * CHARGE_SCALE);
    el.width = px; el.height = px;
    el.className = "projectile";
    if (usesAltColor(charKey, c.from)) el.classList.add("alt-color"); // p2 paleta (Medúza/Naruto natívne)
    el.dataset.dir = dirKey;
    el.style.width = px + "px"; el.style.height = px + "px";
    // sprite mieri doprava — ostatné smery flip/rotácia; orientácia je fixná počas letu (netranzicuje sa)
    const orient = { left: "scaleX(-1)", up: "rotate(-90deg)", down: "rotate(90deg)" }[c.dir] || "";
    el.style.transform = `translate(-50%, -50%) ${orient}`.trim();
    // vznikni na bunke strelca a odtiaľ plynule kĺž na prvú bunku letu (nie zlietni z rohu (0,0));
    // klonova strela štartuje z KLONOVEJ bunky, nie z Narutovej
    const st = s?.[c.from];
    const origin = c.clone ? st?.clone : st;
    const start = (origin && origin.x != null) ? projCenter(origin.x, origin.y) : dst;
    el.style.transition = "none";
    el.style.left = start.left + "px";
    el.style.top  = start.top + "px";
    void el.offsetHeight; // reflow → snap na štart bez sklzu, potom zapni transition
    el.style.transition = "";
    actorsEl.appendChild(el);
    entry = { el, retire: null };
    projectiles.set(key, entry);
  }
  entry.el.style.left = dst.left + "px"; // nová cieľová bunka → CSS ju plynule dokĺže za --charge-ms
  entry.el.style.top  = dst.top + "px";
}
function retireProjectile(key) {
  const entry = projectiles.get(key);
  if (!entry || entry.retire) return;
  // nechaj dobehnúť posledný sklz na cieľovú bunku, až potom zmizni (nikdy nie uprostred letu)
  entry.retire = setTimeout(() => { entry.el.remove(); projectiles.delete(key); }, CHARGE_STEP_MS);
}
// zosúlaď perzistentné projektily s charge efektmi tohto frame-u: nové/pohnuté posuň, chýbajúce stiahni
function reconcileProjectiles(charges, s) {
  const live = new Set();
  for (const c of charges) {
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

// „Goku" nabíjacia aura pri recharge — naviazaná na postavu (sleduje ju per-frame v rafe);
// anchor "clone" ju ukotví na viditeľný tieňový klon (recharge nesmie prezradiť pravého Naruta)
function spawnChargeAura(slot, gold = false, red = false, anchor = "actor") {
  const p = state?.[slot];
  if (anchor === "clone" && (!p?.clone || cloneEls[slot].style.display === "none")) return;
  // labyrint: skrytý súper (x null) auru vôbec nedostane — placeChargeAura by ju nemal kam ukotviť
  // a neumiestnená by svietila v rohu boardu (napr. červená Last Hope aura skrytého Minotaura)
  if (!p || p.x == null) return;
  const cont = document.createElement("div");
  // golden mana = rovnaká aura, len zlatá; Last Hope ultra mód = červená
  cont.className = red ? "charge-aura red" : gold ? "charge-aura gold" : "charge-aura";
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

/* ---------- Last Stand — vizuál (démon v strede + za postavou, golden stav); riadené serverom cez timeline ---------- */
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

/* ---------- Last Stand — napojenie na server timeline ---------- */
// Stredový démon (hmlový nábeh/zmiznutie) ako flourish summon/banish; HP/manu riadi server cez frames.
// Trvalý golden stav (žiara + aura + démon za postavou) riadi raf podľa state[slot].lastStandBuff.
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
  deathCenter.animate([
    { opacity: 0, filter: "blur(18px)", transform: "translate(-50%,-50%) scale(.55)" },
    { opacity: 1, filter: "blur(0px)",  transform: "translate(-50%,-50%) scale(1)" },
  ], { duration: 700, easing: "ease-out", fill: "forwards" });
}
function lsCenterDisappear() {
  _deathFogPuff(700, "out");
  const a = deathCenter.animate([
    { opacity: 1, filter: "blur(0px)",  transform: "translate(-50%,-50%) scale(1)" },
    { opacity: 0, filter: "blur(18px)", transform: "translate(-50%,-50%) scale(.55)" },
  ], { duration: 700, easing: "ease-in", fill: "forwards" });
  a.onfinish = () => { deathCenter.style.opacity = "0"; };
}

// Démon útok — veľký démon v strede (100 % väčší než summon = scale 2); zvyšok kreslí raf do deathCenter
function demonCenterAppear() {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  deathCenter.getAnimations().forEach(a => a.cancel());
  deathCenter.style.left = cx + "px"; deathCenter.style.top = cy + "px";
  deathFog.style.left = cx + "px"; deathFog.style.top = cy + "px";
  _deathFogPuff(1000, "in");
  deathCenter.animate([
    { opacity: 0, filter: "blur(18px)", transform: "translate(-50%,-50%) scale(1.1)" },
    { opacity: 1, filter: "blur(0px)",  transform: "translate(-50%,-50%) scale(2)" },
  ], { duration: 700, easing: "ease-out", fill: "forwards" });
}
function demonCenterDisappear() {
  _deathFogPuff(700, "out");
  const a = deathCenter.animate([
    { opacity: 1, filter: "blur(0px)",  transform: "translate(-50%,-50%) scale(2)" },
    { opacity: 0, filter: "blur(18px)", transform: "translate(-50%,-50%) scale(1.4)" },
  ], { duration: 700, easing: "ease-in", fill: "forwards" });
  a.onfinish = () => { deathCenter.style.opacity = "0"; };
}

// Last Hope — červená „hope" postava v strede (analógia k lsCenterAppear, len červená hmla a hope sprite)
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
  hopeCenter.animate([
    { opacity: 0, filter: "blur(18px)", transform: "translate(-50%,-50%) scale(.55)" },
    { opacity: 1, filter: "blur(0px)",  transform: "translate(-50%,-50%) scale(1)" },
  ], { duration: 700, easing: "ease-out", fill: "forwards" });
}
function hopeCenterDisappear() {
  _hopeFogPuff(700, "out");
  const a = hopeCenter.animate([
    { opacity: 1, filter: "blur(0px)",  transform: "translate(-50%,-50%) scale(1)" },
    { opacity: 0, filter: "blur(18px)", transform: "translate(-50%,-50%) scale(.55)" },
  ], { duration: 700, easing: "ease-in", fill: "forwards" });
  a.onfinish = () => { hopeCenter.style.opacity = "0"; };
}
function hideHopeCenter() {
  hopeCenter.getAnimations().forEach(a => a.cancel());
  hopeFog.getAnimations().forEach(a => a.cancel());
  hopeCenter.style.opacity = "0";
  hopeFog.style.opacity = "0";
  hopeFog.style.display = "none";
}

// (dev demo klávesy R/T odstránené — Last Stand sa hrá cez tlačidlo a riadi server)
// tvrdo schovaj stredového démona (koniec hry / nová hra / char-select — nech nevisí na ploche)
function hideDeathCenter() {
  deathCenter.getAnimations().forEach(a => a.cancel());
  deathFog.getAnimations().forEach(a => a.cancel());
  deathCenter.style.opacity = "0";
  deathFog.style.opacity = "0";
  deathFog.style.display = "none";
}
// tvrdo schovaj démona ZA postavou (koniec hry / nová hra) — bežne ho uprace fill-forwards animácia
// banishu (onfinish) a raf cleanup pri prvom stave bez buffu, ale tie majú okná (race s koncom hry);
// POZOR: nevolať počas plánovania final kola — tam démon za buffnutou postavou MÁ visieť (0.25)
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

// efektný náraz do štítu pri úspešnom bloku — hexagonálna bariéra flashne, rázové prstence + iskry
// originCell (voliteľné): štít sa rozbije na inej bunke než na Narutovi — napr. zásah na KLONOVI cez zdieľaný
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
  // štít sa roztriešti — veľa veľkých úlomkov letí ďaleko na všetky strany so spinom
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
// originCell (voliteľné): odraz vychádza z inej bunky než z obrancu — napr. zásah na KLONOVI cez zdieľaný
// mirror, aby lúč nešiel z pravého Naruta (to by prezradilo, ktorý je skutočný)
function spawnMirrorReflect(defenderSlot, dmg = 1, atkKind = "basic", gold = false, originCell = null) {
  const d = Array.isArray(originCell)
    ? (() => { const { left, top } = cellToPx(originCell[0], originCell[1]); return { x: left + TILE_W / 2, y: top + TILE_H / 2 }; })()
    : centerOf(defenderSlot);
  if (!d) return;
  const a = centerOf(defenderSlot === "p1" ? "p2" : "p1");

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

  // 1b) samotné 🪞 emoji ako zdroj lúča — pixelizované ako zvyšok UI
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

  // 4) odraz: melee — alebo special na rovnakom políčku — = hrubý drsný burst (beam nemá kam letieť);
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

  // 5) otras boardu — pri burste (melee/special-na-políčku) silnejší (drsnejší dojem)
  const boardEl = gridEl.parentElement;
  if (boardEl) {
    boardEl.classList.remove("fx-shake");
    void boardEl.offsetWidth;
    boardEl.classList.add("fx-shake");
    setTimeout(() => boardEl.classList.remove("fx-shake"), useBurst ? 650 : 450);
  }
}

/* ---------- arena ---------- */
// interné rozlíšenie pozadia — vrstvy sa zmenšia sem a CSS ich roztiahne s pixelated,
// čím vzniknú skutočné veľké pixely (menšie čísla = hrubší pixel art)
const ARENA_RES = { w: 320, h: 180 };
function renderArenaLayers(arenaKey, layerFiles) {
  arenaEl.innerHTML = "";
  if (!arenaKey || !Array.isArray(layerFiles) || !layerFiles.length) return;
  layerFiles.forEach((file, i) => {
    const cvs = document.createElement("canvas");
    cvs.className = "layer";
    cvs.width = ARENA_RES.w; cvs.height = ARENA_RES.h;
    cvs.style.zIndex = String(i);
    const img = new Image();
    img.onload = () => {
      const ctx = cvs.getContext("2d");
      // cover: vyplň celý canvas, prebytok orež — rovnaká logika ako object-fit: cover
      const s  = Math.max(ARENA_RES.w / img.width, ARENA_RES.h / img.height);
      const dw = img.width * s, dh = img.height * s;
      ctx.drawImage(img, (ARENA_RES.w - dw) / 2, (ARENA_RES.h - dh) / 2, dw, dh);
    };
    img.src = `/arenas/${arenaKey}/${file}`;
    arenaEl.appendChild(cvs);
  });
}

/* ---------- pixel-art ikony (tiles, tlačidlá, HUD) ---------- */
// 8×8 mriežka, znak = farba z palety, bodka = priehľadné; kreslí sa ako SVG rect-y (crispEdges)
const PIX = {
  flame: { pal: { a: "#ff7043", b: "#ffd54f" }, rows: [
    "....a...",
    "...aa...",
    "..aaaa..",
    "..aaaa..",
    ".aabbaa.",
    ".abbbba.",
    ".abbbba.",
    "..aaaa..",
  ]},
  heart: { pal: { a: "#e53935", b: "#ff8a80" }, rows: [
    "........",
    ".aa..aa.",
    "abaaaaaa",
    "aaaaaaaa",
    "aaaaaaaa",
    ".aaaaaa.",
    "..aaaa..",
    "...aa...",
  ]},
  drop: { pal: { a: "#1e88e5", b: "#82c4ff" }, rows: [
    "...a....",
    "...aa...",
    "..aaaa..",
    "..aaaa..",
    ".aaaaaa.",
    ".baaaaa.",
    ".baaaaa.",
    "..aaaa..",
  ]},
  skull: { pal: { a: "#e8e8e8", b: "#1a1a1a" }, rows: [
    "..aaaa..",
    ".aaaaaa.",
    ".abaaba.",
    ".abaaba.",
    ".aaaaaa.",
    "..abba..",
    "..aaaa..",
    "..a..a..",
  ]},
  boot: { pal: { a: "#e0e0e0", b: "#8d6e63" }, rows: [
    "..aaa...",
    "..aaa...",
    "..aaa...",
    "..aaa...",
    "..aaaa..",
    "..aaaaa.",
    ".bbbbbb.",
    "........",
  ]},
  chevrons: { pal: { a: "#ffffff" }, rows: [
    "aa..aa..",
    ".aa..aa.",
    "..aa..aa",
    ".aa..aa.",
    "aa..aa..",
    "........",
    "........",
    "........",
  ]},
  plus: { pal: { a: "#82c4ff" }, rows: [
    "...aa...",
    "...aa...",
    ".aaaaaa.",
    ".aaaaaa.",
    "...aa...",
    "...aa...",
    "........",
    "........",
  ]},
  shield: { pal: { a: "#00363d", b: "#b2ebf2" }, rows: [
    ".aaaaaa.",
    ".abbbba.",
    ".abbbba.",
    ".abbbba.",
    "..abba..",
    "..abba..",
    "...aa...",
    "........",
  ]},
  mirror: { pal: { a: "#d4a017", b: "#b2ebf2", c: "#ffffff" }, rows: [
    ".aaaaaa.",
    ".abbbba.",
    ".abbcba.",
    ".abcbba.",
    ".acbbba.",
    ".abbbba.",
    ".aaaaaa.",
    "........",
  ]},
  arrow: { pal: { a: "#fff3c4" }, rows: [
    "........",
    ".....a..",
    "......a.",
    "aaaaaaaa",
    "......a.",
    ".....a..",
    "........",
    "........",
  ]},
  sword: { pal: { a: "#e0e0e0", c: "#6d4c41", d: "#d4a017" }, rows: [
    "...aa...",
    "...aa...",
    "...aa...",
    "...aa...",
    ".dddddd.",
    "...cc...",
    "...cc...",
    "........",
  ]},
  star: { pal: { a: "#e1bee7", b: "#ffffff" }, rows: [
    "...aa...",
    "..aaaa..",
    ".aabbaa.",
    "aabbbbaa",
    ".aabbaa.",
    "..aaaa..",
    "...aa...",
    "........",
  ]},
  // séria — vyhratá hra: plná zlatá koruna s gemmami
  crown: { pal: { a: "#ffcf3f", b: "#c98a17", c: "#ff5a5a" }, rows: [
    ".a.aa.a.",
    ".a.aa.a.",
    ".aaaaaa.",
    ".acaaca.",
    ".abaaba.",
    ".aaaaaa.",
    "........",
    "........",
  ]},
  // séria — nezískaná hra: len obrys koruny (tlmená zlatá)
  crown_outline: { pal: { o: "#7d6526" }, rows: [
    ".o.oo.o.",
    ".o.oo.o.",
    ".oo..oo.",
    ".o....o.",
    ".o....o.",
    ".oooooo.",
    "........",
    "........",
  ]},
  // tournament — ešte neprehraná hra: len tlmený obrys lebky
  skull_outline: { pal: { o: "#5a5a5a" }, rows: [
    "..oooo..",
    ".o....o.",
    ".o.oo.o.",
    ".o.oo.o.",
    ".o....o.",
    "..oooo..",
    "..o..o..",
    "..o..o..",
  ]},
};
function pixSvg(name) {
  const def = PIX[name];
  if (!def) return "";
  let rects = "";
  def.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = def.pal[row[x]];
      if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }
  });
  return `<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
// malá inline ikonka do cost riadkov — pixelizované emoji, hydratuje hydratePix()
const miniPix = (emoji) => `<span class="pix-ico mini" data-emoji="${emoji}"></span>`;
// špeciálne políčka mapujú na ikony knižnice
const TILE_TO_PIX = { dmg: "flame", heal: "heart", mana: "drop", ik: "skull" };
function tileSvg(type) { return pixSvg(TILE_TO_PIX[type] || type); }

// jemná pixelizácia emoji: nakreslí sa do malého canvasu a CSS ho roztiahne s pixelated
function pixelizeEmoji(el, res) {
  if (el.dataset.done) return;
  el.dataset.done = "1";
  el.innerHTML = "";
  res = res || (el.classList.contains("mini") ? 10 : 20);
  const cvs = document.createElement("canvas");
  cvs.width = res; cvs.height = res;
  const ctx = cvs.getContext("2d");
  ctx.font = `${res - 3}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(el.dataset.emoji, res / 2, res / 2 + 1);
  el.appendChild(cvs);
}
function hydratePix(root = document) {
  root.querySelectorAll(".pix-ico[data-emoji]").forEach(el => pixelizeEmoji(el));
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
  trail.style.height = (v * 10) + "%"; // trail má oneskorený transition — pri strate sa stiahne neskôr

  // pri zisku výplň blikne do jasu
  if (v > prev) {
    fill.classList.remove("gain");
    void fill.offsetWidth; // reflow = reštart animácie
    fill.classList.add("gain");
    fill.addEventListener("animationend", () => fill.classList.remove("gain"), { once: true });
  }

  // presná hodnota pod barom — bez počítania dielikov; skrytá hodnota (labyrint) = "?"
  const num = el.closest(".hud-stat")?.querySelector(".bar-num");
  if (num) num.textContent = hidden ? "?" : String(v);
}

// banner pod ROUND textom: ja som locknutý a čaká sa na súpera / súper je locknutý a rad je na mne
const turnStatusEl = document.getElementById("turn-status");
function updateTurnStatus() {
  if (!turnStatusEl) return;
  const opSlot = me === "p1" ? "p2" : me === "p2" ? "p1" : null;
  const mine = me ? state?.[me] : null;
  const opp  = opSlot ? state?.[opSlot] : null;

  const timerMode = !!state?.config?.timer && state.config.timer !== "off";
  let txt = null, cls = null;
  if (!playing && !gameOverShown && mine?.char && opp?.char) {
    if (mine.locked && !opp.locked) {
      // „locked - waiting" — vo fixnom časovom režime skry; v quickdraw a bezčasovom nechaj
      if (!timerMode || state.config.timer === "quickdraw") { txt = "✔ LOCKED - WAITING FOR OPPONENT…"; cls = "waiting"; }
    } else if (!mine.locked && opp.locked) {
      // „your move" — nechaj v quickdraw (spúšťa časovač) a v bezčasovom režime; vo fixnom časovom skry
      if (!timerMode || state.config.timer === "quickdraw") { txt = "⚠️ OPPONENT IS READY - YOUR MOVE! ⚠️"; cls = "your-move"; }
    }
  }

  if (!txt) { turnStatusEl.classList.add("hidden"); return; }
  turnStatusEl.textContent = txt;
  turnStatusEl.classList.remove("hidden", "waiting", "your-move");
  turnStatusEl.classList.add(cls);
}

function renderHUD() {
  if (hudTurn && !gameOverShown) {
    // posledné (buffnuté) kolo po Last Stand → „FINAL ROUND"; prepne sa až s bannerom (_finalRoundActive)
    hudTurn.textContent = (state?.phase === "playing")
      ? (_finalRoundActive ? "FINAL ROUND" : `ROUND ${state.turn}`)
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


  // tournament × labyrint: hlavy magov skryté u oboch, kým kliatba beží — renderHUD beží per frame,
  // takže skrytie/odkrytie sadne aj na labyrint začatý či ukončený uprostred prehrávania kola
  if (state?.series?.format === "tournament") {
    const labActive = !!(state?.p1?.labyrinth || state?.p2?.labyrinth);
    crownsP1El.classList.toggle("lab-hidden", labActive);
    crownsP2El.classList.toggle("lab-hidden", labActive);
  }

  // pravá strana (p2) má VŽDY alternatívne vykreslenie (postava na boarde, portrét aj ghost);
  // výnimka: postava s natívnou p2 paletou (Medúza) — triedy priebežne prepína raf podľa aktuálneho chara
  actorP2.classList.toggle("alt-color", usesAltColor(state?.p2?.char, "p2"));
  hudCharP2.classList.toggle("alt-color", usesAltColor(state?.p2?.char, "p2"));
  actorGhost.classList.toggle("alt-color", me === "p2" && usesAltColor(ghostCharAt() || state?.p2?.char, "p2"));
  updateGoldenButton();
}

/* ---------- záznam akcií kola pod widgetom ---------- */
// Narutov vertikálny pohyb je verejne zrkadlený klonom (klon ide opačne) → smer up/down by SÚPEROVI prezradil,
// ktorá z dvoch figúr je pravý Naruto. V zázname/lište ho preto súperovi anonymizujeme na neutrálne „↕"
// (vlastný hráč vidí svoj skutočný smer). Horizontálny smer je bezpečný — klon ho kopíruje 1:1 (figúry sa nerozídu).
const ARROW_DIR = { up: "↑", down: "↓", left: "←", right: "→", vert: "↕" };
function displayDir(action, ownerSlot) {
  const dir = action?.dir;
  // Narutov klon zrkadlí vertikálu pri pohybe (move/dash) AJ pri basic útoku → smer up/down by súperovi prezradil,
  // ktorá figúra je pravá. Súperovi ho anonymizujeme na „↕" (vlastný hráč vidí skutočný smer).
  const vertMirrored = action?.type === "move" || action?.type === "dash" || action?.type === "attack";
  // anonymizuj len keď Naruto SKUTOČNE má klona — bez klona sa vertikála nerozdvojuje a smer nič neprezrádza
  if (vertMirrored && (dir === "up" || dir === "down") &&
      ownerSlot && ownerSlot !== me && state?.[ownerSlot]?.char === "naruto" && state?.[ownerSlot]?.clone) {
    return "vert";
  }
  return dir;
}
function actionIcon(action, ownerSlot) {
  const arr = (a) => ARROW_DIR[displayDir(a, ownerSlot)] || "";
  switch (action?.type) {
    case "move":     return `🚶${arr(action)}`;
    case "dash":     return `🏃${arr(action)}`;
    case "recharge": return "🙏";
    case "attack":   return `🏹${arr(action)}`;
    case "melee":    return "🗡️";
    case "shield":   return "🛡️";
    case "mirror":   return "🪞";
    case "golden_shield": return "🛡️";
    case "golden_mirror": return "🪞";
    case "golden_mana": return "🙏";
    case "last_stand": return "💀";
    case "special":  return `✨${ARROW_DIR[action.dir] || ""}`; // smer má len Medúza
    case "stoned":   return "🗿";
    case "swap":     return "🌀";
    case "unknown":  return "❓"; // labyrint — akcia súpera je pre prekliateho redigovaná
    default:         return "?";
  }
}
// skeleton záznamu kola — rovnaká fixná štruktúra ako fronta: [🛡️] | [1][2][3] | [🙏]
function buildActionLogSkeleton(log) {
  log.innerHTML = "";
  const mkSlot = (cls, inner) => {
    const el = document.createElement("span");
    el.className = `a-badge a-slot ${cls}`;
    el.innerHTML = inner;
    log.appendChild(el);
  };
  const mkDivider = () => {
    const d = document.createElement("span");
    d.className = "log-divider";
    log.appendChild(d);
  };
  mkSlot("slot-pre", '<span class="g-ico dim">🛡️</span>');
  mkDivider();
  for (let i = 0; i < 3; i++) mkSlot("slot-act", String(i + 1));
  mkDivider();
  mkSlot("slot-post", '<span class="g-ico dim">🙏</span>');
}

// akcie postupne vypĺňajú placeholder sloty (golden pre/post, bežné zľava doprava); vráti vyplnený slot
function appendActionLog(slot, action) {
  const log = slot === "p1" ? logP1 : logP2;
  if (!log) return null;
  if (!log.children.length) buildActionLogSkeleton(log);

  const maskedBeat = action?.type === "unknown" ? (action.beat || "act") : null; // labyrint — redigovaná akcia
  if (action?.type === "golden_shield" || action?.type === "golden_mirror" || maskedBeat === "gpre") {
    const el = log.querySelector(".a-slot.slot-pre");
    if (el) {
      const mirror = action.type === "golden_mirror";
      el.className = "a-badge " + (maskedBeat ? "unknown" : action.type);
      el.innerHTML = maskedBeat ? '<span class="g-ico">❓</span>' : mirror ? '<span class="g-ico mirror">🪞</span>' : '<span class="g-ico">🛡️</span>';
    }
    return el;
  }
  if (action?.type === "golden_mana" || action?.type === "last_stand" || maskedBeat === "gmana") {
    const el = log.querySelector(".a-slot.slot-post");
    if (el) {
      el.className = "a-badge " + (maskedBeat ? "unknown" : action.type);
      el.innerHTML = maskedBeat ? '<span class="g-ico">❓</span>' : action.type === "last_stand" ? LS_BADGE_IMG : '<span class="g-ico">🙏</span>';
    }
    return el;
  }
  const el = log.querySelector(".a-slot.slot-act");
  if (el) {
    el.className = `a-badge ${action?.type || ""}`;
    el.textContent = actionIcon(action, slot);
  }
  return el;
}
function clearActionLogs() {
  if (logP1) buildActionLogSkeleton(logP1);
  if (logP2) buildActionLogSkeleton(logP2);
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
  // a špeciálne tiles; dáta o súperovi už rediguje server — hmla je len vizuál nad tým.
  // Aréna sa stmaví OBOM hráčom (aj Minotaurovi), nech je očividné, že hra beží v labyrinte.
  const anyLab = !!(s?.p1?.labyrinth || s?.p2?.labyrinth);
  document.body.classList.toggle("labyrinth-mode", anyLab); // stmavenie arény za boardom — obaja hráči
  const mineLab = me ? s?.[me] : null;
  // labReveal: istý zásah v tomto ťahu — hmla padá už PRED animáciou akcie (aréna ostáva stmavená do labyrinth_end)
  const fogged = !!(mineLab && mineLab.labyrinth && !mineLab.labReveal);
  boardEl.classList.toggle("labyrinth", fogged);
  const fogVisible = new Set();
  if (fogged) {
    if (mineLab.x != null) fogVisible.add(`${mineLab.x},${mineLab.y}`);
    (mineLab.thread || []).forEach(([x, y]) => fogVisible.add(`${x},${y}`));
    if (mineLab.threadMark) fogVisible.add(`${mineLab.threadMark[0]},${mineLab.threadMark[1]}`);
    // špeciálne tiles svietia cez tmu — slepý hráč ich musí vidieť (heal/mana zbiera, dmg/IK sa vyhýba)
    (s?.tiles || []).forEach(t => fogVisible.add(`${t.x},${t.y}`));
    (s?.iks || []).forEach(t => fogVisible.add(`${t.x},${t.y}`));
  }
  // Ariadnina niť — bunky s niťou (vlastná niť prekliateho; lovec vidí súperovu, server mu ju posiela)
  const threadSet = new Set();
  for (const sl of ["p1", "p2"]) (s?.[sl]?.thread || []).forEach(([x, y]) => threadSet.add(`${x},${y}`));

  castingNow.p1 = false;
  castingNow.p2 = false;

  const charges  = [];
  const specials = [];
  const meleeCasts = [];
  const procs    = [];
  const cloneHitCells = []; // klon zasiahnutý tile-om → blik jeho bunky (ako hit-blink u hráča)
  let hitTarget  = null;

  // špeciálne políčka (dmg/heal/mana + IK overlay)
  const tileMap = new Map();
  (s?.tiles || []).forEach(t => tileMap.set(`${t.x},${t.y}`, t.type));

  const previewSet = new Set();

  for (const e of effects) {
    if (e?.kind === "charge")    charges.push(e);
    if (e?.kind === "special")   specials.push(e);
    if (e?.kind === "hit")       hitTarget = e.target;
    if (e?.kind === "tile_proc") procs.push(e);
    if (e?.kind === "clone_hit" && Array.isArray(e.cell)) cloneHitCells.push(e.cell);
    // melee úder — zvýrazni zasahované bunky (server ich posiela v efekte; Medúza má aj diagonály)
    // + zväčšená postava v strede so sekacou animáciou (analógia special overlay)
    if (e?.kind === "melee") {
      const caster = s?.[e.from];
      const cells = Array.isArray(e.cells) ? e.cells : (caster ? [[caster.x, caster.y]] : []);
      cells.forEach(([x, y]) => previewSet.add(`${x},${y}`));
      const atk = caster?.char === "medusa" ? ANIM_DEF.attack1_loop : ANIM_DEF.attack2_loop; // Medúza seká Attack_1
      meleeCasts.push({ from: e.from, file: atk.file, fps: atk.fps });
    }
    // démon útok — blikajú zasahované bunky (všetky okrem kasterovej)
    if (e?.kind === "demon_attack" && Array.isArray(e.cells)) {
      e.cells.forEach(([x, y]) => previewSet.add(`${x},${y}`));
    }
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
      else if (fogged && mineLab && x === mineLab.x && y === mineLab.y) cell.classList.add("torch-lit"); // vlastná bunka ožiarená fakľami
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

      // práve vyhodnocované tile — výrazný blik
      if (procs.some(pc => pc.cell?.[0] === x && pc.cell?.[1] === y)) {
        cell.classList.add("tile-proc");
      }

      // projektil basic útoku sa NEkreslí do bunky (renderGrid maže grid každý frame → poskakoval by);
      // rieši ho perzistentný plynulý element v #actors cez reconcileProjectiles() nižšie

      // zásahový blik
      const isP1 = s?.p1 && s.p1.x === x && s.p1.y === y;
      const isP2 = s?.p2 && s.p2.x === x && s.p2.y === y;
      if (hitTarget === "p1" && isP1) cell.classList.add("hit-blink");
      if (hitTarget === "p2" && isP2) cell.classList.add("hit-blink");
      if (cloneHitCells.some(c => c[0] === x && c[1] === y)) cell.classList.add("hit-blink"); // klon na dmg dlaždici — blik bunky
      // aktívne obrany (shield/mirror) sa už nekreslia na bunku — pulzujúci glow je per-postavu (actorFilter)

      gridEl.appendChild(cell);
    }
  }

  reconcileProjectiles(charges, s); // plynulé projektily kĺžu v #actors (mimo mazaného gridu)

  renderThreadLines(s);
  updateSpecialCenter(specials.concat(meleeCasts));
}

// Ariadnina niť ako súvislá čiara cez stredy navštívených buniek (+ uzlík na začiatku);
// kreslí sa pre oboch hráčov — komu ju server neredigoval, ten ju vidí
function renderThreadLines(s) {
  actorsEl.querySelectorAll(".thread-svg").forEach(n => n.remove());
  const W = board.w * TILE_W + (board.w - 1) * GAP;
  const H = board.h * TILE_H + (board.h - 1) * GAP;
  for (const sl of ["p1", "p2"]) {
    const th = s?.[sl]?.thread;
    if (!Array.isArray(th) || !th.length) continue;
    const pts = th.map(([x, y]) => {
      const { left, top } = cellToPx(x, y);
      return [left + TILE_W / 2, top + TILE_H / 2];
    });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "thread-svg");
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    const poly = pts.length > 1
      ? `<polyline points="${pts.map(p => p.join(",")).join(" ")}" fill="none" stroke="#e8b23c" stroke-width="5" stroke-dasharray="14 10" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>`
      : "";
    svg.innerHTML = `${poly}<circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="9" fill="#e8b23c" opacity=".9"/>`;
    actorsEl.appendChild(svg);
  }
}

/* ---------- Special preview (hover) ---------- */
// dir sa týka len Medúzy (left/right) — ostatné speciály smer nemajú
function cellsForSpecialPreview(meState, dir){
  if (!meState || !meState.char) return [];
  const { x, y, char } = meState;
  const cells = [];
  if (char === "medusa"){
    // vlastné políčko + všetko striktne zvoleným smerom v riadku ±1 — zrkadlí server (medusaCells)
    const sgn = dir === "left" ? -1 : 1;
    cells.push([x, y]);
    for (let cy = y - 1; cy <= y + 1; cy++){
      if (cy < 0 || cy >= board.h) continue;
      for (let cx = x + sgn; cx >= 0 && cx < board.w; cx += sgn) cells.push([cx, cy]);
    }
  } else if (char === "fire"){
    for (let cx=0; cx<board.w; cx++) cells.push([cx, y]);
  } else if (char === "lightning"){
    // všetky políčka opačnej "šachovej" farby než na ktorej stojí
    const par = (x + y) % 2;
    for (let cy=0; cy<board.h; cy++) for (let cx=0; cx<board.w; cx++){
      if ((cx + cy) % 2 !== par) cells.push([cx, cy]);
    }
  } else if (char === "wanderer"){
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([dx,dy])=>{
      const cx=x+dx, cy=y+dy;
      if (cx>=0 && cy>=0 && cx<board.w && cy<board.h) cells.push([cx,cy]);
    });
  } else if (char === "minotaur"){
    // celoplošný — zrkadlí server (labyrint zasiahne súpera kdekoľvek)
    for (let cy=0; cy<board.h; cy++) for (let cx=0; cx<board.w; cx++) cells.push([cx, cy]);
  } else if (char === "naruto"){
    // range self — summon tieňového klona na vlastnej bunke (musí na nej stáť sám)
    cells.push([x, y]);
  }
  return cells;
}
// dosah melee — vlastné políčko; Medúza navyše 1 diagonálne na všetky strany (zrkadlí doMelee na serveri)
function cellsForMeleePreview(p, char){
  if (!p) return [];
  const cells = [[p.x, p.y]];
  if (char === "medusa") [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([dx,dy])=>{
    const cx = p.x + dx, cy = p.y + dy;
    if (cx >= 0 && cy >= 0 && cx < board.w && cy < board.h) cells.push([cx, cy]);
  });
  return cells;
}
// dosah démon útoku — všetky políčka okrem toho, na ktorom kaster (ghost) stojí
function cellsForDemonPreview(p){
  if (!p) return [];
  const cells = [];
  for (let y=0; y<board.h; y++) for (let x=0; x<board.w; x++) if (!(x===p.x && y===p.y)) cells.push([x,y]);
  return cells;
}
/* ---------- Ghost — simulácia vlastnej pozície počas naplánovaného kola ---------- */
// pozícia po každej akcii vo fronte; movy mimo board pozíciu nemenia (zrkadlí server)
function simulatedPositions(){
  const mine = state?.[me];
  if (!mine) return [];
  let x = mine.x, y = mine.y;
  const out = [];
  for (const a of myQueue){
    const d = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[a.dir];
    if (a.type === "move" && d){
      const nx = x + d[0], ny = y + d[1];
      if (nx >= 0 && ny >= 0 && nx < board.w && ny < board.h){ x = nx; y = ny; }
    }
    if (a.type === "dash" && d){
      // až 2 políčka, na okraji sa skráti (zrkadlí server)
      for (let s = 0; s < 2; s++){
        const nx = x + d[0], ny = y + d[1];
        if (nx >= 0 && ny >= 0 && nx < board.w && ny < board.h){ x = nx; y = ny; }
      }
    }
    out.push({ x, y });
  }
  return out;
}
// pozícia, z ktorej sa vykoná akcia s indexom idx (= po akciách 0..idx-1);
// bez argumentu pozícia po celej fronte — odtiaľ sa vykoná novo pridávaná akcia
function ghostPos(idx = myQueue.length){
  const mine = state?.[me];
  if (!mine) return null;
  if (idx <= 0) return { x: mine.x, y: mine.y };
  const sims = simulatedPositions();
  if (!sims.length) return { x: mine.x, y: mine.y };
  return sims[Math.min(idx, sims.length) - 1];
}
// budúca pozícia VLASTNÉHO tieňového klona po fronte — kopíruje pohyb majiteľa s inverznou vertikálou
// a vlastným clampom; klon sa hýbe, len keď je majiteľov ťah platný (zrkadlí moveCloneSteps na serveri)
function simulatedClonePos(){
  const mine = state?.[me];
  const c = mine?.clone;
  if (!mine || !c) return null;
  let ox = mine.x, oy = mine.y, x = c.x, y = c.y;
  const inB = (px, py) => px >= 0 && py >= 0 && px < board.w && py < board.h;
  for (const a of myQueue){
    const d = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[a.dir];
    if (!d) continue;
    if (a.type === "move"){
      if (!inB(ox + d[0], oy + d[1])) continue; // neplatný ťah majiteľa = klon stojí tiež
      ox += d[0]; oy += d[1];
      if (inB(x + d[0], y - d[1])) { x += d[0]; y -= d[1]; }
    } else if (a.type === "dash"){
      let steps = 0;
      for (let s = 0; s < 2; s++) if (inB(ox + d[0], oy + d[1])) { ox += d[0]; oy += d[1]; steps++; }
      if (!steps) continue;
      for (let s = 0; s < 2; s++) if (inB(x + d[0], y - d[1])) { x += d[0]; y -= d[1]; }
    }
  }
  return { x, y };
}
// mág aktívny pred akciou s indexom idx — po prejdení swapov vo fronte 0..idx-1 (kvôli special/ghost náhľadu po výmene)
function ghostCharAt(idx = myQueue.length) {
  let char = state?.[me]?.char || null;
  for (let i = 0; i < Math.min(idx, myQueue.length); i++) {
    if (myQueue[i]?.type === "swap" && myQueue[i].to) char = myQueue[i].to;
  }
  return char;
}

// dráha basic útoku zvoleným smerom z danej pozície (po okraj boardu)
function cellsForAimPreview(meState, dir){
  if (!meState) return [];
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
  if (!delta) return [];
  const cells = [];
  let x = meState.x + delta[0], y = meState.y + delta[1];
  while (x >= 0 && y >= 0 && x < board.w && y < board.h){
    cells.push([x, y]);
    x += delta[0]; y += delta[1];
  }
  return cells;
}
function showPreviewCells(cells){
  const kids = gridEl.children;
  for (let i=0;i<kids.length;i++){
    const cell = kids[i];
    const cx = parseInt(cell.dataset.x,10), cy = parseInt(cell.dataset.y,10);
    if (cells.some(([x,y])=>x===cx && y===cy)) cell.classList.add("preview-red");
  }
}
function clearPreviewCells(){
  gridEl.querySelectorAll(".preview-red").forEach(el=>el.classList.remove("preview-red"));
}

/* ---------- Facing + umiestnenie ---------- */
function computeFacing(p1, p2) {
  if (!p1 || !p2 || p1.x == null || p2.x == null) return { p1: 1, p2: -1 }; // skrytý súper (labyrint) → default
  if (p1.x === p2.x && p1.y === p2.y) return { p1: 1, p2: -1 };
  if (p1.x <= p2.x) return { p1: 1, p2: -1 };
  return { p1: -1, p2: 1 };
}
// horizontálny rozostup postáv na ZDIEĽANOM políčku (p1 doľava, p2 doprava) — veľké postavy (Medúza)
// potrebujú väčší, pokojne aj s presahom do susedných políčok, inak sa sprity škaredo prekrývajú
const PAIR_SHIFT_DEFAULT = 22;
// pozn. labyrint: prekliatemu klientovi server skrýva súperovu pozíciu (x null) → pairShift preňho
// vráti 0 a jeho vlastný sprite sa NIKDY neposunie — zdieľaná bunka mu neprezradí, že Minotaur stojí na nej
const PAIR_SHIFT = { medusa: 80, minotaur: 70 };
function pairShift(slot, s = state) {
  const p1 = s?.p1, p2 = s?.p2;
  if (!p1 || !p2 || p1.x !== p2.x || p1.y !== p2.y) return 0;
  const mag = PAIR_SHIFT[s?.[slot]?.char] ?? PAIR_SHIFT_DEFAULT;
  return slot === "p1" ? -mag : mag;
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
    // canvas je väčší než bunka — horizontálne centrovať, vertikálne ukotviť na spodok bunky
    const px = left - (ACTOR_W - TILE_W) / 2;
    const py = top  - (ACTOR_H - TILE_H);

    // wasHidden: odhalenie po labyrinte nesmie doslidovať zo starej pozície — umiestni sa okamžite
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
    const pose = cloneSummonPose[slot];
    if (pose && performance.now() < pose.until) {
      el.style.transformOrigin = "50% 100%";
      el.style.transform = `translateX(${shift - (facing[slot] || 1) * pose.off}px) scaleX(${facing[slot] || 1})`;
    } else {
      el.style.transformOrigin = "";
      el.style.transform = `translateX(${shift}px) scaleX(${scale})`;
    }

    el.dataset.slot = slot;
    if (same) el.dataset.pair = "1"; else el.removeAttribute("data-pair");
  });

  // tieňové klony — pozícia/facing ako majiteľ; klon je VŽDY viditeľný a PLNE KRYCÍ (identická figúra ako Naruto),
  // aby bolo vidno, že Naruto má klona. Na majiteľovej bunke stojí len jemne posunutý (STACK_OFFSET px);
  // pri rozdelení sa obe figúry rozbehnú SÚBEŽNE zo spoločnej bunky (klon vždy KĹŽE — nikdy nezmizne na mieste).
  [["p1", cloneEls.p1, p1, p2], ["p2", cloneEls.p2, p2, p1]].forEach(([slot, el, data, opp]) => {
    const c = data?.clone;
    // klon už puffol (clone_die) — drž ho skrytého, aj keď ho snapshot toho istého framu ešte nesie (žiadny problik)
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
    // zdieľaná bunka so súperom → rozostup ako postavy (pairShift); na majiteľovej bunke pridaj STACK_OFFSET
    const foeShift = (opp && opp.x === c.x && opp.y === c.y)
      ? (slot === "p1" ? -PAIR_SHIFT_DEFAULT : PAIR_SHIFT_DEFAULT) : 0;
    const shift = foeShift + (onOwner ? STACK_OFFSET : 0);

    el.style.display = "block";
    el.style.opacity = "1"; // klon nie je priehľadný ani na Narutovej bunke
    if (immediate || !actorsInitialized || wasHidden) {
      // prvé zjavenie (summon) / immediate — umiestni bez slideu (nie z rohu)
      el.style.transition = "none";
      el.style.left = px + "px"; el.style.top = py + "px";
      void el.offsetHeight;
      el.style.transition = "";
    } else {
      // bežný frame — CSS transition dá súbežný slide s majiteľom (rozdelenie aj zliatie plynulo)
      el.style.left = px + "px"; el.style.top = py + "px";
    }
    el.style.transform = `translateX(${shift}px) scaleX(${currentFacing(slot, facing)})`;
    el._logCell = { x: c.x, y: c.y };
  });

  // „YOU" značka nad vlastnou postavou — sleduje aktéra (rovnaké transition ako pohyb)
  const meData = me ? s[me] : null;
  if (meData && meData.char) {
    const { left, top } = cellToPx(meData.x, meData.y);
    const px = left - (ACTOR_W - TILE_W) / 2;
    const py = top  - (ACTOR_H - TILE_H);
    const shift = pairShift(me, s);
    // vertikálne: vrch hlavy per-mág (HEAD_TOP; mágovia ~48 % rámu, Medúza vyššie) —
    // značku kotvíme jej spodkom (chevron) tesne nad hlavu cez translateY(-100%)
    const headY = py + ACTOR_H * (HEAD_TOP[meData.char] ?? 0.48) - 2;
    // horizontálne: postava nie je v strede rámca; stred hlavy + flip podľa smeru otočenia
    const headCx = HEAD_CX[meData.char] ?? 0.5;
    const headDx = facing[me] * ACTOR_W * (headCx - 0.5);
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
    case "dash":          return { cls: "dash",    text: `🏃${dd || "?"}` };
    case "recharge":      return { cls: "mana",    text: "🙏" };
    case "attack":        return { cls: "attack",  text: `🏹${dd}` };
    case "melee":         return { cls: "melee",   text: "🗡️" };
    case "special":       return { cls: "special", text: `✨${arrow[a.dir] || ""}` };
    case "shield":        return { cls: "shield",  text: "🛡️" };
    case "mirror":        return { cls: "mirror",  text: "🪞" };
    case "golden_shield": return { cls: "golden",  html: '<span class="g-ico">🛡️</span>' };
    case "golden_mirror": return { cls: "golden",  html: '<span class="g-ico mirror">🪞</span>' };
    case "golden_mana":   return { cls: "golden",  html: '<span class="g-ico">🙏</span>' };
    case "last_stand":    return { cls: "golden",   html: LS_BADGE_IMG };
    case "demon":         return { cls: "demon",    html: LS_BADGE_IMG };
    case "stoned":        return { cls: "stoned",   text: "🗿" };
    case "swap":          return { cls: "swap",     html: mageHeadHtml(a.to || "", usesAltColor(a.to, ownerSlot) ? "alt-color" : "", ownerSlot) };
    case "last_hope":     return { cls: "lasthope", html: LH_BADGE_IMG };
    case "unknown":       return { cls: "unknown",  text: "❓" }; // labyrint — redigovaná akcia súpera
    default:              return { cls: "",        text: a?.type || "" };
  }
}

// hover náhľad dosahu pre moje útok/special/melee badge (z ghost pozície v danom kroku)
function attachQueueHover(el, a, idx) {
  if (a.type === "attack") {
    el.addEventListener("mouseenter", () => { const p = ghostPos(idx); if (p) showPreviewCells(cellsForAimPreview(p, a.dir)); });
    el.addEventListener("mouseleave", clearPreviewCells);
  } else if (a.type === "special") {
    el.addEventListener("mouseenter", () => { const char = ghostCharAt(idx); const p = ghostPos(idx); if (char && p) showPreviewCells(cellsForSpecialPreview({ x: p.x, y: p.y, char }, a.dir)); });
    el.addEventListener("mouseleave", clearPreviewCells);
  } else if (a.type === "melee") {
    el.addEventListener("mouseenter", () => { const p = ghostPos(idx); if (p) showPreviewCells(cellsForMeleePreview(p, ghostCharAt(idx))); });
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

// skamenené ťahy nového kola sú vopred zamknuté ako pass (🗿) — predvyplnia sa na začiatok fronty
// a nedajú sa odobrať (undo poistka); hráč plánuje len zvyšné sloty
function ensureStonePrefix() {
  if (!me || isSpectator || playing || lockedIn) return;
  const mine = state?.[me];
  if (!mine || !mine.char || mine.locked || state?.phase !== "playing") return;
  const need = Math.min(3, mine.stone || 0);
  const have = myQueue.filter(a => a.type === "stoned").length;
  if (have === need && myQueue.slice(0, need).every(a => a.type === "stoned")) return;
  const rest = myQueue.filter(a => a.type !== "stoned");
  myQueue = [...Array.from({ length: need }, () => ({ type: "stoned" })), ...rest].slice(0, 3);
}

function renderQueue() {
  ensureStonePrefix();
  queueEl.innerHTML = "";
  qBeatEls = [];

  const starterSlot = state?.starter || "p1";
  const otherS = starterSlot === "p1" ? "p2" : "p1";
  const lastRound = !!state?.goldLocked; // buffnuté posledné kolo — namiesto 2 gold-mana placeholderov jedna démon „end" bunka
  const buffSlot = state?.p1?.lastStandBuff ? "p1" : state?.p2?.lastStandBuff ? "p2" : null;
  const hopeSlot = buffSlot ? (buffSlot === "p1" ? "p2" : "p1") : null; // nebuffnutý hráč — vlastník Last Hope bunky
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
      el.title = "Last Stand — hra tu končí (banishment)";
      queueEl.appendChild(el);
      qBeatEls[7] = el;
      return;
    }
    if (b.kind === "lasthope") {
      const mine = b.owner === me;
      const el = document.createElement("div");
      el.dataset.pos = "9";
      el.className = "q-badge lasthope " + (mine ? "mine" : "opp");
      if (mine && lastHopeArmed) {
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
      if (b.kind === "gshield")    filled = goldenArmed ? { type: "golden_shield" } : goldenMirrorArmed ? { type: "golden_mirror" } : null;
      else if (b.kind === "gmana") filled = goldenManaArmed ? { type: "golden_mana" } : lastStandArmed ? { type: "last_stand" } : null;
      else                         filled = myQueue[b.idx] || null;
    }

    if (filled) {
      const v = actionBadgeView(filled, me);
      if (v.cls) el.classList.add(v.cls);
      if (v.html) el.innerHTML = v.html; else el.textContent = v.text;
      if (b.kind === "act") attachQueueHover(el, filled, b.idx);
    } else {
      el.classList.add("q-slot");
      // súperov skamenený ťah je DETERMINISTICKÝ (stun prenesený z minulého kola) — namiesto skrytého „?"
      // ukáž 🗿 na presných akciách, ktoré súper vynechá, nech kaster Medúzy vidí dokedy súper stojí
      const oppStone = (!mine && b.kind === "act") ? Math.min(3, state?.[b.owner]?.stone || 0) : 0;
      const oppStoned = oppStone > 0 && b.idx < oppStone;
      if (b.kind === "gshield")    el.innerHTML = '<span class="g-ico dim">🛡️</span>';
      else if (b.kind === "gmana") el.innerHTML = '<span class="g-ico dim">🙏</span>';
      else if (oppStoned) { el.classList.add("stoned"); el.textContent = "🗿"; }
      else el.textContent = mine ? ["①", "②", "③"][b.idx] : String(b.idx + 1); // ja kružok, súper holé cifry
      el.title = oppStoned ? "Opponent is petrified — this action is skipped (carry-over stun)"
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
  if (!me || state?.phase !== "playing" || lockedIn || state?.[me]?.locked) return;
  socket.emit("draft_queue", { queue: myQueue, golden: goldenArmed, goldenMirror: goldenMirrorArmed, goldenMana: goldenManaArmed, lastStand: lastStandArmed, lastHope: lastHopeArmed });
}
// zneaktívni tlačidlá akcií, ktoré už sú v queue (každá max 1× za kolo)
function updateActionButtons() {
  document.querySelectorAll(".controls button[data-act]").forEach(btn => {
    const type = btn.dataset.act.split(":")[0];
    const used = myQueue.some(a => a.type === type);
    btn.disabled = used; // skutočne navolené v kole = sivé „použité"
    // golden predťah blokuje bežnú akciu rovnakého druhu ZÁMKOM (nie ako „použité") — klik shake-ne cez poistku v handleri
    const goldenLock = (type === "shield" && goldenArmed) || (type === "mirror" && goldenMirrorArmed);
    btn.classList.toggle("locked-golden", goldenLock && !used);
  });
  const moveUsed = myQueue.some(a => a.type === "move");
  moveBtn.disabled = moveUsed;
  if (moveUsed) dirPicker.classList.add("hidden");
  const attackUsed = myQueue.some(a => a.type === "attack");
  attackBtn.disabled = attackUsed;
  if (attackUsed) aimPicker.classList.add("hidden");
  const dashUsed = myQueue.some(a => a.type === "dash");
  dashBtn.disabled = dashUsed;
  if (dashUsed) dashPicker.classList.add("hidden");
  // special už nemá data-act (kvôli Medúzinmu pickeru) — zneaktívni ho rovnako ako move/attack/dash
  const specialUsed = myQueue.some(a => a.type === "special");
  specialBtn.disabled = specialUsed;
  if (specialUsed) specialPicker.classList.add("hidden");
}
function updateLockButton() {
  const locked = !!state?.[me]?.locked;
  if (locked) {
    lockBtn.classList.add("locked"); lockBtn.textContent = "LOCKED"; lockBtn.disabled = true;
  } else {
    lockBtn.classList.remove("locked"); lockBtn.textContent = "LOCK IN"; lockBtn.disabled = false;
  }
  // počas prehrávania kola sa nedá lockovať (zabráni súbežným timeline)
  if (playing && !locked) {
    lockBtn.disabled = true;
    lockBtn.classList.remove("ready");
    updateUiLocks();
    return;
  }
  // pulzuj, keď je queue plná a čaká sa už len na potvrdenie
  lockBtn.classList.toggle("ready", !locked && myQueue.length === 3);
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
  if (gameOverShown) return;
  gameOverShown = true;

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
      // verdikt namiesto ROUND n v hud-turn — hlavné okno nič neprekrýva
      let verdict, cls;
      if (winner === "draw")        { verdict = "TIE"; cls = "tie"; }
      else if (me && winner === me) { verdict = "WINNER!"; cls = "win"; }
      else if (me)                  { verdict = "LOSER!"; cls = "lose"; }
      else                          { verdict = `${winner.toUpperCase()} WINS`; cls = "tie"; } // divák
      // pri sérii (BO3/BO5) doplň finálne skóre
      const ser = serverGameResult?.series || state?.series;
      let scoreLine = "";
      if (ser && ser.format && ser.format !== "single") {
        // skóre drží strany (ľavá : pravá), rovnako ako koruny v HUD — nie „ja : oponent"
        scoreLine = `<span class="go-verdict tie">${ser.winsP1 ?? 0} : ${ser.winsP2 ?? 0}</span>`;
        renderSeriesCrowns(ser); // dokresli finálne koruny (server po match_over už neposiela state)
      }
      if (hudTurn) hudTurn.innerHTML = `GAME OVER<span class="go-verdict ${cls}">${verdict}</span>${scoreLine}`;
      // uprac overlay z poslednej akcie (special/melee cast) — po game over ho už renderGrid neuprace
      actorsEl.querySelectorAll(".special-center").forEach(n => n.remove());
      // víťazova postavička spamuje cast animáciu priamo na svojom políčku (žiadny extra sprite)
      if (winner === "p1" || winner === "p2") setAnim(winner, "victory");
      goOverlay.classList.remove("hidden");
    }, afterDeathWait);
  }, waitAttack);
}

// animácia konca hry (smrť porazeného + víťazstvo) bez finálneho overlayu — pre medzihru série
function playGameEndAnim(winner, after) {
  const loser = winner === "p1" ? "p2" : (winner === "p2" ? "p1" : null);
  const now = performance.now();
  const lastEnd = Math.max(lastAttackEndAt.p1, lastAttackEndAt.p2);
  const waitAttack = Math.max(0, lastEnd - now);
  setTimeout(() => {
    let afterDeathWait = 300;
    if (winner !== "draw" && loser) { setAnim(loser, "dead", 1200); afterDeathWait = 1300; }
    actorsEl.querySelectorAll(".special-center").forEach(n => n.remove());
    if (winner === "p1" || winner === "p2") setAnim(winner, "victory");
    setTimeout(() => { if (after) after(); }, afterDeathWait);
  }, waitAttack);
}

// medzikolová „ROUND N" animácia — round-script zostane vidieť, kým dobehne; potom callback resetuje lištu
function playNewRoundTransition(nextTurn, done) {
  if (!roundBannerEl) { setTimeout(done, NEW_ROUND_MS); return; }
  // ak ďalšie kolo je buffnuté (Last Stand) → „FINAL ROUND" + veľký démon tile (červený okraj) pod nápisom
  const final = !!state?.goldLocked;
  if (final) {
    roundBannerEl.innerHTML = 'FINAL ROUND<span class="rb-demon"><img src="/assets/last_stand.png" alt="" /></span>';
    _finalRoundActive = true; // text hore sa prepne až teraz (s bannerom)
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
let playGen = 0;      // generácia prehrávania — novšia timeline zruší staršiu slučku
let playing = false;  // počas prehrávania neaktualizuj UI zo snapshotov a drž LOCK zamknutý

function schedulePlayTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return;

  const gen = ++playGen;
  playing = true;
  hideConnError();  // kolo sa vyhodnotilo → prípadná hláška o chybe spojenia je už neaktuálna
  stopTurnTimer(); // kolo sa už vyhodnocuje (server poslal timeline) — zhasni prípadný stale časovač
  updateUiLocks(); // počas vyhodnocovania sú všetky tlačidlá zamknuté a stmavené

  clearActionLogs(); // záznam predošlého kola zmizne so začiatkom nového
  clearProjectiles(); // žiadne staré projektily nesmú prejsť do nového kola

  const first = timeline[0];
  // kurzor v lište: poradie beatov sa zhoduje so serverovým resolveTurn (štartér je prvý v dvojici)
  const playStarter = first.starter ?? state?.starter ?? "p1";
  const beatCounts = { p1: 0, p2: 0 };
  // posledná zaznamenaná akcia per slot (badge v logu + beat v lište) — keď príde "invalid", prečiarkneme ju
  const lastActed = { p1: null, p2: null };
  state.p1 = first.p1; state.p2 = first.p2; state.turn = first.turn; state.starter = (first.starter ?? state.starter);
  state.tiles = first.tiles; state.iks = first.iks;
  renderHUD();
  const NEXT_TURN = (first.turn ?? state.turn) + 1;
  const NEXT_STARTER = playStarter === "p1" ? "p2" : "p1"; // preklop (hru môže začínať aj p2)
  renderGrid(state, first.effects || []);
  positionActors(state, true);

  let i = 1;
  let prev = first;

  const step = () => {
    if (gen !== playGen) return; // medzitým začala novšia timeline — túto slučku ukonči

    if (i >= timeline.length) {
      playing = false;

      // koniec hry: ak séria pokračuje -> medzihra; ak je rozhodnutá -> game over
      const winner = serverWinner || serverGameResult?.gameWinner || computeWinnerFromState(state);
      if (winner) {
        clearRoundCursor();
        // banish/summon: démon ešte chvíľu drží, potom zmizne — stredový AJ ten za postavou
        // (koniec hry = žiadny démon na ploche, nech už jeho animácie dopadli akokoľvek)
        setTimeout(() => { hideDeathCenter(); hideDeathBehind(); }, 700);
        if (serverGameResult && !serverGameResult.matchOver) {
          playGameEndAnim(winner, () => showIntermission(winner, serverGameResult.series));
        } else {
          showGameOverSequence(winner);
        }
        return;
      }

      // bežný koniec kola: round-script (odhalení súperi + kurzor) nechaj vidieť, prehraj
      // „ROUND N" animáciu a až po nej resetuj lištu na ďalšie kolo
      const doneGen = gen;
      playNewRoundTransition(NEXT_TURN, () => {
        if (doneGen !== playGen) return; // medzitým začalo nové prehrávanie — neresetuj
        state.turn = NEXT_TURN;
        state.starter = NEXT_STARTER;
        renderHUD();
        if (state.p1) state.p1.locked = false;
        if (state.p2) state.p2.locked = false;
        renderGrid(state, []);
        myQueue = [];
        goldenArmed = false;
        goldenMirrorArmed = false;
        goldenManaArmed = false;
        lastStandArmed = false;
        lastHopeArmed = false;
        lockedIn = false; // kolo dobehlo — odomkni ovládanie
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
    state.tiles = frame.tiles; state.iks = frame.iks;
    if (frame.starter !== undefined) {
      state.starter = frame.starter;
    }
    renderHUD();

    // run aj pri pohybe KLONA (animState je zdieľaný — klon zrkadlí majiteľovu animáciu)
    const cloneMoved = (b, f) => !!(b?.clone && f?.clone && (b.clone.x !== f.clone.x || b.clone.y !== f.clone.y));
    if (beforeP1 && (beforeP1.x !== frame.p1.x || beforeP1.y !== frame.p1.y || cloneMoved(beforeP1, frame.p1))) setAnim("p1", "run", MOVE_MS);
    if (beforeP2 && (beforeP2.x !== frame.p2.x || beforeP2.y !== frame.p2.y || cloneMoved(beforeP2, frame.p2))) setAnim("p2", "run", MOVE_MS);

    const shooters = new Set(); // basic strela — jednorazová póza
    const casters  = new Set(); // special — looping, malá postava sa animuje súbežne s veľkým sprite-om
    for (const e of frame.effects || []) {
      // poistka: výnimka v JEDNOM efekte nesmie zaseknúť prehrávanie celého kola (step() beží cez setTimeout —
      // neodchytený throw by reťaz natrvalo prerušil a UI by ostalo zamknuté uprostred kola)
      try {
      if ((e.kind === "charge" || e.kind === "attack_swing") && e.from) shooters.add(e.from);
      if (e.kind === "special" && e.from) casters.add(e.from);
      // strelec sa otočí v smere horizontálnej streľby (vertikálna facing nemení)
      if (e.kind === "charge" && (e.dir === "left" || e.dir === "right") && (e.from === "p1" || e.from === "p2")) {
        facingOverride[e.from] = { sx: e.dir === "left" ? -1 : 1, until: performance.now() + frameHold + POSE_TAIL_MS };
      }
      // Medúzin special má smer — počas castu je otočená v smere pohľadu, nie na súpera
      if (e.kind === "special" && (e.dir === "left" || e.dir === "right") && (e.from === "p1" || e.from === "p2")) {
        facingOverride[e.from] = { sx: e.dir === "left" ? -1 : 1, until: performance.now() + frameHold + POSE_TAIL_MS };
      }
      if (e.kind === "melee" && (e.from === "p1" || e.from === "p2")) {
        // looping → malá postava sa seká súbežne s veľkým sprite-om (re-triggered každý beat); Medúza = Attack_1
        setAnim(e.from, state?.[e.from]?.char === "medusa" ? "attack1_loop" : "attack2_loop", frameHold);
        lastAttackEndAt[e.from] = performance.now() + frameHold;
      }
      if (e.kind === "hit" && (e.target === "p1" || e.target === "p2")) {
        setAnim(e.target, "hurt", frameHold);
        // stacknutý Naruto+klon = súbežné zásahy spojené do jedného úderu → vypíš rozpis „-3 -3 HP"
        if (Array.isArray(e.parts) && e.parts.length > 1 && e.parts.reduce((a, b) => a + b, 0) > 0) {
          spawnFloat(e.target, `-${e.parts.join(" -")} HP`, "dmg-float");
        } else if (typeof e.dmg === "number" && e.dmg > 0) {
          spawnDamageFloat(e.target, e.dmg);
        }
      }
      if (e.kind === "invalid" && (e.target === "p1" || e.target === "p2")) {
        // flinch (nie hurt) — klon ho zrkadlí, takže pri neplatnej akcii trhnú obaja Naruti rovnako
        setAnim(e.target, "flinch", frameHold);
        // nevykonaná akcia — prečiarkni práve zaznamenaný badge (log) aj beat (lišta) jemným červeným ✕
        const acted = lastActed[e.target];
        if (acted) {
          acted.logEl?.classList.add("act-invalid");
          acted.beatEl?.classList.add("act-invalid");
        }
        // vždy zobraz dôvod (aj neznámy → default), nech žiadna nevykonaná akcia nie je „tichá“
        const [msg, cls] = INVALID_MSG[e.reason] || INVALID_MSG_DEFAULT;
        spawnFloat(e.target, msg, cls);
        cloneFloat(e.target, msg, cls); // rovnaká hláška nad klonom — nesmie prezradiť, ktorý je pravý
        // nedostatok many — navyše výrazná výstraha: bliknutie mana baru v HUD
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
      // náraz do steny — figúra (Naruto ALEBO jeho klon), ktorá sa daným smerom nedá pohnúť, sa strhne
      // k stene + OUT OF BOUNDS; tá druhá sa medzitým pohla. e.clone === true → náraz je na klonovi.
      if (e.kind === "wall_bump" && (e.from === "p1" || e.from === "p2")) {
        const onClone = e.clone === true;
        const el = onClone ? cloneEls[e.from] : (e.from === "p1" ? actorP1 : actorP2);
        const d = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[e.dir] || [0,0];
        // translate sa skladá „add" na základný transform (translateX(shift) scaleX(scale)) — scaleX prevracia X,
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
        spawnManaFloat(e.from, amt);
        spawnChargeAura(e.from); // „Goku" nabíjacia aura na postave
        // klon sa „nabíja" naprázdno tiež — aura+float na oboch, nech recharge neprezradí pravého
        cloneFloat(e.from, `+${amt}`, "mana-float");
        spawnChargeAura(e.from, false, false, "clone");
      }
      // skamenený ťah — akcia sa nevykonala: prečiarkni práve zaznamenaný badge/beat + STONED float
      if (e.kind === "stoned" && (e.target === "p1" || e.target === "p2")) {
        const acted = lastActed[e.target];
        if (acted) {
          acted.logEl?.classList.add("act-invalid");
          acted.beatEl?.classList.add("act-invalid");
        }
        spawnFloat(e.target, "🗿 STONED", "stone-float");
      }
      // zásah Medúziným specialom — postava skamenie (sivú sochu kreslí raf zo state.stone)
      if (e.kind === "petrify" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, "🗿 PETRIFIED", "stone-float");
      }
      // Minotaurov special — zasiahnutý blúdi v labyrinte (hmlu/niť kreslí renderGrid zo state.labyrinth/thread)
      if (e.kind === "labyrinth" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, "🌀 LOST IN THE LABYRINTH", "maze-float");
      }
      // vzájomný zásah — labyrint končí, board sa prekliatemu odhalí (stav to už nesie, float len ohlási)
      if (e.kind === "labyrinth_end" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, "🌀 ESCAPED THE LABYRINTH", "maze-float");
      }
      // istý zásah ukončí labyrint — server odhalil všetko už PRED animáciou akcie (frame nesie plné dáta):
      // skrytý súper sa prekliatemu zjaví z tmy (fade ako démon/teleport), widget sa odkryl cez state.labReveal
      if (e.kind === "labyrinth_reveal" && (e.target === "p1" || e.target === "p2")) {
        if (me === e.target) fadeActor(otherSlot(), 0, 1, frameHold);
        spawnFloat(e.target, "🌀 REVEALED!", "maze-float");
      }
      // súper vstúpil na Ariadninu niť — perzistentný obrys kreslí raf zo state.threadMark; navyše
      // preblik obrysu na KAŽDEJ prejdenej niťovej bunke — okrem mojej vlastnej (tam lovca vidím naživo/lit,
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
        cloneFloat(e.from, "🛡️ SHIELD", "shield-float"); // klon „bráni" tiež — float nesmie prezradiť pravého
      }
      if (e.kind === "mirror_on" && (e.from === "p1" || e.from === "p2")) {
        spawnFloat(e.from, "🪞 MIRROR", "shield-float");
        cloneFloat(e.from, "🪞 MIRROR", "shield-float");
      }
      // Naruto: summon klona — postava + 1 kópia na tej istej bunke tvárou v tvár hrajú Special_2
      if (e.kind === "clone_summon" && (e.from === "p1" || e.from === "p2")) {
        setAnim(e.from, "special2", frameHold);
        lastAttackEndAt[e.from] = performance.now() + frameHold;
        spawnCloneSummonFx(e.from, e.cell, frameHold);
      }
      if (e.kind === "clone_born" && (e.from === "p1" || e.from === "p2") && Array.isArray(e.cell)) {
        cloneDead[e.from] = false; // nový klon žije — zruš „mŕtvy" príznak
        spawnCellFloat(e.cell, "👥 SHADOW CLONE", "maze-float");
      }
      // klon zasiahnutý — puffne v OBLAKU DYMU a natrvalo zmizne (žiadny problik späť)
      if (e.kind === "clone_die" && (e.target === "p1" || e.target === "p2")) {
        cloneDead[e.target] = true;           // positionActors ho odteraz drží skrytého
        const cEl = cloneEls[e.target];
        if (cEl) { cEl.getAnimations().forEach(a => a.cancel()); cEl.style.display = "none"; } // sprite hneď preč (dym ho prekryje)
        if (Array.isArray(e.cell)) spawnClonePuff(e.cell);
      }
      // kozmetický tile dmg na klonovi (dmg tile klona nezabíja) — klon sa MUSÍ strhnúť a floatnúť ako pravý,
      // inak by „nezraniteľná" figúrka prezradila, ktorý je klon. Súperovi ukáž „-N HP" (bluff = ako pravý zásah),
      // vlastnému hráčovi „-N" (pravda — je to len kozmetika, HP mu neklesá).
      if (e.kind === "clone_hit" && Array.isArray(e.cell) && (e.target === "p1" || e.target === "p2")) {
        const ownerView = me === e.target;
        spawnCellFloat(e.cell, ownerView ? `-${e.dmg ?? 1}` : `-${e.dmg ?? 1} HP`, "dmg-float");
        cloneFlinch[e.target] = performance.now();
      }
      if (e.kind === "mirror" && (e.target === "p1" || e.target === "p2")) {
        // odraz na KLONOVI (e.cell) vychádza z klonovej bunky, nie z pravého Naruta — inak by prezradil skutočného
        spawnMirrorReflect(e.target, e.dmg, e.atk, !!e.gold, Array.isArray(e.cell) ? e.cell : null);
        if (Array.isArray(e.cell)) spawnCellFloat(e.cell, "🪞 REFLECTED!", e.gold ? "mirror-reflect-text gold" : "mirror-reflect-text");
        else spawnFloat(e.target, "🪞 REFLECTED!", e.gold ? "mirror-reflect-text gold" : "mirror-reflect-text");
      }
      if (e.kind === "golden_shield" && (e.from === "p1" || e.from === "p2")) {
        // navonok je to SHIELD, len zlatý — "golden shield" je interné pomenovanie
        spawnFloat(e.from, "🛡️ SHIELD", "golden-float");
        cloneFloat(e.from, "🛡️ SHIELD", "golden-float"); // klon nesmie prezradiť pravého
      }
      if (e.kind === "golden_mirror" && (e.from === "p1" || e.from === "p2")) {
        // navonok je to MIRROR, len zlatý (predťah) — odraz padne neskôr cez mirror frame
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
      // Last Stand — FRAME-DRIVEN: každá fáza je efekt vo svojom frame; WAAPI trvanie = frameHold (= delayMs),
      // takže to v pozadí pauzne/dobehne rovnako ako timeline. HP sa hýbe zo snapshotov (drain/rise), nie lokálne.
      // Démon útok (buffnutý hráč): veľký démon v strede je jediná show — postavička stojí v idle (žiadna casting póza)
      if (e.kind === "demon_summon" && (e.from === "p1" || e.from === "p2")) {
        demonCenterAppear();
      }
      if (e.kind === "demon_center_out" && (e.from === "p1" || e.from === "p2")) {
        demonCenterDisappear();
      }
      // Teleport (výmena maga) — dvojfázovo, postava fade-uje plynulo (ako démon):
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
        // démon sa objaví ZA postavou — opacity cez CSS transition (0→1); počas revive/rise hráč LEŽÍ (st.down=true),
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
        const logEl  = appendActionLog(e.from, e.action);
        const beatEl = highlightRoundBeat(e.from, e.action, beatCounts, playStarter); // posuň kurzor + odhal súpera
        lastActed[e.from] = { logEl, beatEl }; // ak hneď príde "invalid", prečiarkneme práve tieto
      }
      // prázdny gold beat (golden shield/mirror = pos 0, golden mana = 7/8) — len posuň zelenú šípku naň
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
        // block na KLONOVI (e.cell) sa ukáže na klonovej bunke — zdieľaný štít sa rozbije na oboch figúrach
        const bcell = Array.isArray(e.cell) ? e.cell : null;
        spawnShieldBlock(e.target, !!e.gold, bcell); // efektný náraz do štítu
        const bcls = e.gold ? "golden-float" : "block-float"; // zlatý text, ak blokoval golden shield
        if (bcell) spawnCellFloat(bcell, "🛡️ BLOCKED", bcls);
        else spawnFloat(e.target, "🛡️ BLOCKED", bcls);
      }
      if (e.kind === "heal" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, `+${e.amount ?? 1} HP`, "heal-float");
      }
      } catch (err) { console.error("effect handler zlyhal", e?.kind, err); }
    }
    for (const s of ["p1", "p2"]) {
      if (casters.has(s))       { setAnim(s, "casting", frameHold); lastAttackEndAt[s] = performance.now() + frameHold; } // special: malá postava hrá svoj efektový sprite (nie úder)
      // Medúza strieľa s Attack_2 (krátky úder) — Attack_1 má vyhradený pre melee šľah
      else if (shooters.has(s)) { setAnim(s, state?.[s]?.char === "medusa" ? "attack2" : "attack", frameHold); lastAttackEndAt[s] = performance.now() + frameHold; }
    }

    renderGrid(state, frame.effects || []);
    positionActors(state);

    prev = frame;
    setTimeout(step, frame.delayMs ?? 600);
  };

  step();
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
    clearTimeout(el._hideT); clearTimeout(el._fadeT); el._logCell = null; // reset sledovania klonovej pozície
  });
  actorsEl.querySelectorAll(".sprite-clone-summon").forEach(n => n.remove());
  actorsEl.querySelectorAll(".clone-puff").forEach(n => n.remove());
  cloneSummonFx = [];
  cloneSummonPose = { p1: null, p2: null };
  cloneDead = { p1: false, p2: false };
  youMarker.style.display = "none";
  actorsInitialized = false;
}

/* ---------- Char select (preview) ---------- */
// tournament: zobraz HP a prenesenú manu každého maga vlastnej trojice + označ mŕtvych (karta dead + neklikateľná)
function updateCharSelectHp(s) {
  charSelectHp = (s && s.mageHp) ? s.mageHp : null;
  charSelectMana = (s && s.mageMana) ? s.mageMana : null;
  // tournament: char-select ukazuje LEN draftnutý tím — roster-mode zlúči obe stránky (display:contents)
  // a skryje karty mimo tímu + placeholder; kľúče mageHp = presne vlastný tím
  selEl.classList.toggle("no-paging", !!charSelectHp);
  selEl.classList.toggle("roster-mode", !!charSelectHp);
  if (charSelectHp && charPage !== 0) setCharPage(0);
  // setCharPage sa pri otvorení na stránke 0 nevolá — nadpis drž v synce s režimom aj tu
  const titleEl = document.getElementById("char-page-title");
  if (titleEl) titleEl.textContent = charSelectHp ? "Your Team" : CHAR_PAGES[charPage].title;
  selEl.querySelectorAll(".char-card").forEach((card) => {
    const key = card.dataset.char;
    if (!key) return; // placeholder "Coming soon" — žiadne HP/dead spracovanie
    card.classList.toggle("off-roster", !!charSelectHp && !(key in charSelectHp));
    const statsEl = card.querySelector(".char-stats");
    const hpEl = card.querySelector(".char-hp");
    const manaEl = card.querySelector(".char-mana");
    if (!charSelectHp) { // single / bo3 — žiadne HP/mana, žiadny dead stav
      card.classList.remove("dead");
      if (statsEl) statsEl.classList.add("hidden");
      return;
    }
    const hp = charSelectHp[key] ?? 0;
    const dead = hp <= 0;
    card.classList.toggle("dead", dead);
    if (statsEl) {
      // mŕtvy mág: žiadne staty (len démon + dead póza); živý: HP (srdiečko) + prenesená mana (kvapka)
      statsEl.classList.toggle("hidden", dead);
      if (!dead) {
        // rovnaké rozloženie ako hráčske widgety v HUD: ikona → číslo (srdiečko #, kvapka #)
        const mana = charSelectMana?.[key] ?? 0;
        if (hpEl) hpEl.innerHTML = `${pixSvg("heart")}<span>${hp}</span>`;
        if (manaEl) manaEl.innerHTML = `${pixSvg("drop")}<span>${mana}</span>`;
      }
    }
  });
}

function isMageDead(key) {
  return !!charSelectHp && (charSelectHp[key] ?? 0) <= 0;
}

function drawCharSelectFrame(now) {
  const canvases = selEl.querySelectorAll("canvas.char-canvas");
  canvases.forEach((cvs) => {
    const key = cvs.dataset.char;
    const dir = charDirFor(key, me); // hráč vpravo vidí Medúzu v natívnej tmavej palete (Medusa2)
    if (!dir) return;
    const ctx = cvs.getContext("2d");
    // mŕtvy mág (tournament): dead póza mága + death démon prekrytý cez okno karty
    if (isMageDead(key)) {
      ensureSpriteMeta(dir, ANIM_DEF.dead.file)
        .then(meta => {
          drawSprite(ctx, meta, ANIM_DEF.dead, now, cvs.width, cvs.height, 1.31, 0.98, true, 0, -52);
          return ensureSpriteMeta(DEATH_DIR, DEATH_ANIM.file);
        })
        .then(meta => {
          if (!meta) return;
          ctx.save();
          ctx.globalAlpha = 0.5; // semi-transparentný démon — dead póza mága ostáva dobre vidno pod ním
          drawSprite(ctx, meta, DEATH_ANIM, now, cvs.width, cvs.height, 1.15, 0.5, false, 0, 0);
          ctx.restore();
        })
        .catch(() => { ctx.clearRect(0, 0, cvs.width, cvs.height); });
      return;
    }
    // mág, ktorého abilitku pozeráme: cyklicky prehráva animáciu SPECIÁLU (efektový sprite, rovnako ako v hre),
    // v rovnakej veľkosti ako idle (centrovaný, nie zoomnutý)
    const fx = (key === abilityHoverChar) && SPECIAL_ANIMS[key];
    const anim = fx ? { file: SPECIAL_ANIMS[key].file, fps: SPECIAL_FPS, loop: true } : ANIM_DEF.idle;
    // lightning efekt má obsah posunutý vľavo vo frame -> dorovnaj doprava
    const offX = fx ? (FX_OFFSET_X[key] || 0) * cvs.width : 0;
    // canvas vypĺňa celú kartu; sprite väčší, mierne zdvihnutý hore (offsetY), orez je až na ráme karty;
    // Medúza/Minotaur normalizovaní na výšku mágov (PORTRAIT_SCALE)
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, now, cvs.width, cvs.height, portraitFill(key, 1.31), 0.98, true, offX, -52))
      .catch(() => { ctx.clearRect(0, 0, cvs.width, cvs.height); });
  });

  // malý castiaci mág v bunke castera mini-dosky — tiež animácia špeciálu (efektový sprite)
  if (abilityHoverChar && abilityCasterCanvas && SPECIAL_ANIMS[abilityHoverChar]) {
    const dir = charDirFor(abilityHoverChar, me);
    const fxAnim = { file: SPECIAL_ANIMS[abilityHoverChar].file, fps: SPECIAL_FPS, loop: true };
    const offX = (FX_OFFSET_X[abilityHoverChar] || 0) * abilityCasterCanvas.width;
    if (dir) ensureSpriteMeta(dir, fxAnim.file)
      .then(meta => drawSprite(abilityCasterCanvas.getContext("2d"), meta, fxAnim, now, abilityCasterCanvas.width, abilityCasterCanvas.height, 1.1, 0.5, true, offX))
      .catch(() => {});
  }

  if (!selEl.classList.contains("hidden")) {
    charPreviewRaf = requestAnimationFrame(drawCharSelectFrame);
  } else {
    charPreviewRaf = 0;
  }
}
function startCharSelectPreview() {
  abilityHoverChar = null; abilityCasterCanvas = null; // bez hoveru žiadny cast; náhľad sa zobrazí až po nadídení
  document.getElementById("char-ability")?.classList.add("hidden");
  if (charPreviewRaf) cancelAnimationFrame(charPreviewRaf);
  charPreviewRaf = requestAnimationFrame(drawCharSelectFrame);
}
function stopCharSelectPreview() {
  if (charPreviewRaf) cancelAnimationFrame(charPreviewRaf);
  charPreviewRaf = 0;
}

selEl.addEventListener("click", (e) => {
  const card = e.target.closest(".char-card");
  if (!card) return;
  const key = card.dataset.char;
  if (!key) return; // placeholder "Coming soon" nie je voliteľný
  if (selEl.classList.contains("team-mode")) { toggleTeamPick(key); return; } // draft: klik = toggle výberu
  if (isMageDead(key)) return; // mŕtveho maga (tournament) sa nedá zvoliť
  chosenChar = key;
  socket.emit("choose_character", key);
});

/* ---------- Turnajový draft (fáza team_select) ---------- */
// char-select v team-mode: klik na kartu prepína výber (max TEAM_SIZE), potvrdí sa tlačidlom;
// server odhalí súperov tím, až keď potvrdia obaja (dovtedy „TEAM LOCKED" čakačka #team-wait)
const teamConfirmBtn = document.getElementById("team-confirm");
const teamWaitEl = document.getElementById("team-wait");
function toggleTeamPick(key) {
  const i = teamPick.indexOf(key);
  if (i >= 0) teamPick.splice(i, 1);
  else if (teamPick.length < TEAM_SIZE) teamPick.push(key);
  syncTeamUi();
}
function syncTeamUi() {
  selEl.querySelectorAll(".char-card").forEach(card => {
    const key = card.dataset.char;
    const idx = key ? teamPick.indexOf(key) : -1;
    card.classList.toggle("picked", idx >= 0);
    card.querySelector(".pick-badge")?.remove();
    if (idx >= 0) { // poradové číslo výberu v rohu karty
      const b = document.createElement("div");
      b.className = "pick-badge";
      b.textContent = String(idx + 1);
      card.appendChild(b);
    }
  });
  if (teamConfirmBtn) {
    teamConfirmBtn.disabled = teamPick.length !== TEAM_SIZE;
    teamConfirmBtn.textContent = teamPick.length === TEAM_SIZE
      ? "CONFIRM TEAM" : `PICK YOUR TEAM (${teamPick.length}/${TEAM_SIZE})`;
  }
}
teamConfirmBtn?.addEventListener("click", () => {
  if (teamPick.length !== TEAM_SIZE) return;
  socket.emit("choose_team", [...teamPick]);
  teamConfirmBtn.disabled = true; // čakačku prepne až state so serverovým rosterReady
});

/* ---------- Náhľad špeciálu mága (hover vo výbere) ---------- */
const charAbilityEl = document.getElementById("char-ability");
// reprezentatívna pozícia castera, ktorá najlepšie ukáže tvar zásahu daného mága + cena many špeciálu
const SPECIAL_MANA = 5;
const ABILITY_PREVIEW = {
  fire:      { caster: { x: 0, y: 1 }, dmg: 5, desc: "Whole row" },
  lightning: { caster: { x: 1, y: 1 }, dmg: 3, desc: "Opposite-colour cells" },
  wanderer:  { caster: { x: 1, y: 1 }, dmg: 8, desc: "Diagonal neighbours" },
  // dmg: null = bez dmg — stats ukážu efekt (effect.num/emoji); zóna Medúzy sa kreslí pre smer doprava
  medusa:    { caster: { x: 1, y: 1 }, dmg: null, dir: "right", effect: { num: "2×", emoji: "🗿" }, desc: "Own cell + everything one way (row ±1). No damage - petrifies: target skips 2 actions" },
  minotaur:  { caster: { x: 1, y: 1 }, dmg: null, effect: { num: "", emoji: "🌀" }, desc: "Whole board, no dmg - banishes the foe into the labyrinth until any hit lands. Their steps weave a thread; stepping on it reveals your silhouette" },
  naruto:    { caster: { x: 1, y: 1 }, dmg: null, effect: { num: "", emoji: "👥" }, desc: "Self (must stand alone) - summons a shadow clone that copies his moves (up/down inverted), deals the same dmg as Naruto (double when stacked on his cell) and vanishes on any hit" },
};
function renderAbilityPreview(char) {
  const def = ABILITY_PREVIEW[char];
  if (!def || !charAbilityEl) return;
  abilityHoverChar = char; // preview loop prepne tohto mága na cyklický cast špeciálu
  const w = board.w || 4, h = board.h || 3;
  // hráč vpravo (p2): náhľad zrkadlovo — caster pri pravom okraji, smerový special (Medúza) mieri doľava
  const mirror = me === "p2";
  const caster = mirror ? { x: w - 1 - def.caster.x, y: def.caster.y } : def.caster;
  const dir = (mirror && def.dir) ? (def.dir === "right" ? "left" : "right") : def.dir;
  const hit = new Set(cellsForSpecialPreview({ x: caster.x, y: caster.y, char }, dir).map(([x, y]) => `${x},${y}`));
  const grid = document.getElementById("ca-grid");
  grid.style.gridTemplateColumns = `repeat(${w}, auto)`;
  grid.innerHTML = "";
  abilityCasterCanvas = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = document.createElement("div");
    c.className = "mini-cell";
    if (caster.x === x && caster.y === y) {
      c.classList.add("caster");
      // malý castiaci mág priamo v bunke castera (rAF ho cyklicky kreslí)
      const mini = document.createElement("canvas");
      mini.className = "mini-caster";
      mini.width = 48; mini.height = 34;
      c.appendChild(mini);
      abilityCasterCanvas = mini;
    } else if (hit.has(`${x},${y}`)) {
      c.classList.add("hit");
    }
    grid.appendChild(c);
  }
  document.getElementById("ca-title").textContent = "SPECIAL ATTACK";
  document.getElementById("ca-text").textContent = def.desc;
  const stats = document.getElementById("ca-stats");
  stats.innerHTML = def.dmg != null
    ? `<span class="ca-dmg"><span class="ca-num">${def.dmg}</span><span class="pix-ico" data-emoji="☠️"></span></span>`
    : `<span class="ca-dmg"><span class="ca-num">${def.effect?.num ?? ""}</span><span class="pix-ico" data-emoji="${def.effect?.emoji ?? "✨"}"></span></span>`; // bez dmg — ikona efektu (kameň/labyrint)
  hydratePix(stats);
  charAbilityEl.classList.remove("hidden");
}
function clearAbilityPreview() {
  abilityHoverChar = null;
  abilityCasterCanvas = null;
  charAbilityEl?.classList.add("hidden");
}
selEl.querySelectorAll(".char-card[data-char]").forEach(card => {
  card.addEventListener("mouseenter", () => {
    if (isMageDead(card.dataset.char)) return; // mŕtvy mág nemá náhľad špeciálu
    renderAbilityPreview(card.dataset.char);
  });
});
selEl.querySelectorAll(".char-cards").forEach(el => el.addEventListener("mouseleave", clearAbilityPreview));

/* ---------- Stránkovanie výberu postáv ---------- */
// str. 0 = základní magovia (Mages), str. 1 = experimentálne postavy (Experimental)
const CHAR_PAGES = [{ title: "Mages" }, { title: "Experimental" }];
let charPage = 0;
const charPrevBtn = document.getElementById("char-page-prev");
const charNextBtn = document.getElementById("char-page-next");
const charPageTitle = document.getElementById("char-page-title");
function setCharPage(p) {
  if (selEl.classList.contains("no-paging")) p = 0; // tournament — roster-mode zlúči karty, stránkovanie je vypnuté
  charPage = Math.max(0, Math.min(CHAR_PAGES.length - 1, p));
  selEl.querySelectorAll(".char-cards").forEach(el =>
    el.classList.toggle("hidden", Number(el.dataset.page) !== charPage));
  // tournament (roster-mode): stránky sú zlúčené na vlastný tím — nadpis "Your Team" namiesto názvu stránky
  if (charPageTitle) charPageTitle.textContent = selEl.classList.contains("roster-mode") ? "Your Team" : CHAR_PAGES[charPage].title;
  // krajné šípky sú neviditeľné (visibility) — layout kariet sa pri prepnutí nehýbe
  charPrevBtn?.classList.toggle("off", charPage === 0);
  charNextBtn?.classList.toggle("off", charPage === CHAR_PAGES.length - 1);
  clearAbilityPreview(); // náhľad špeciálu patrí karte z predošlej stránky
}
charPrevBtn?.addEventListener("click", () => setCharPage(charPage - 1));
charNextBtn?.addEventListener("click", () => setCharPage(charPage + 1));

/* ---------- Controls ---------- */
const moveBtn    = document.getElementById("move-btn");
const dirPicker  = document.getElementById("dir-picker");
const attackBtn  = document.getElementById("attack-btn");
const aimPicker  = document.getElementById("aim-picker");
const dashBtn    = document.getElementById("dash-btn");
const dashPicker = document.getElementById("dash-picker");
const specialBtn    = document.getElementById("special-btn");
const specialPicker = document.getElementById("special-picker"); // smer pohľadu — používa len Medúza

function shakeBtn(btn) {
  btn.classList.add("shake");
  setTimeout(() => btn.classList.remove("shake"), 400);
}

// otvorený smerový picker blokuje všetky ostatné akčné tlačidlá;
// odblokuje sa opätovným klikom na to isté tlačidlo (picker sa zavrie)
let openPicker = null; // null | "move" | "attack" | "dash" | "special"
const PICKERS = { move: dirPicker, attack: aimPicker, dash: dashPicker, special: specialPicker };
const PICKER_BTNS = { move: moveBtn, attack: attackBtn, dash: dashBtn, special: specialBtn };

// po LOCK IN aj počas prehrávania kola sú všetky tlačidlá zamknuté a stmavené
let lockedIn = false;
function uiLocked() {
  return lockedIn || playing || !!state?.[me]?.locked;
}

// vizuálne zámky: otvorený picker zamyká ostatné akčné tlačidlá, LOCK IN zamyká všetky
function actionButtonsAll() {
  const generic = [...document.querySelectorAll(".controls .actions button[data-act]")]
    .filter(b => !b.closest(".dir-picker"));
  return [
    moveBtn, attackBtn, dashBtn, specialBtn,
    document.getElementById("golden-btn"),
    document.getElementById("gold-dual-btn"),
    document.getElementById("demon-btn"),
    document.getElementById("last-hope-btn"),
    ...generic
  ].filter(Boolean);
}
function updateUiLocks() {
  const openBtn = openPicker ? PICKER_BTNS[openPicker] : null;
  const locked = uiLocked();
  actionButtonsAll().forEach(b => {
    b.classList.toggle("locked-ui", locked || (!!openPicker && b !== openBtn));
  });
  undoBtn.classList.toggle("locked-ui", locked);
}

function closePickers() {
  Object.values(PICKERS).forEach(p => p.classList.add("hidden"));
  openPicker = null;
  clearPreviewCells();
  updateUiLocks();
}
function togglePicker(kind, btn, usedType) {
  if (uiLocked()) return;
  if (openPicker === kind) { closePickers(); return; } // opätovný klik = zavrieť
  if (openPicker) { shakeBtn(btn); return; }           // iný picker je otvorený -> blokované
  if (myQueue.length >= 3 || myQueue.some(a => a.type === usedType)) {
    shakeBtn(btn);
    return;
  }
  PICKERS[kind].classList.remove("hidden");
  openPicker = kind;
  updateUiLocks();
}

// Move / Attack / Dash: najprv výber smeru v mini-popupe
moveBtn.addEventListener("click",   () => togglePicker("move", moveBtn, "move"));
attackBtn.addEventListener("click", () => togglePicker("attack", attackBtn, "attack"));
dashBtn.addEventListener("click",   () => togglePicker("dash", dashBtn, "dash"));
// Special: Medúza si najprv vyberie smer pohľadu (←/→), ostatní mágovia pridajú akciu priamo
specialBtn.addEventListener("click", () => {
  if (ghostCharAt() === "medusa") { togglePicker("special", specialBtn, "special"); return; }
  if (uiLocked()) return;
  if (openPicker) { shakeBtn(specialBtn); return; }
  if (myQueue.length >= 3 || myQueue.some(a => a.type === "special")) { shakeBtn(specialBtn); return; }
  myQueue.push({ type: "special" });
  renderQueue();
});

// Golden predťah: jedno tlačidlo predelené na 2 rovnako široké polovice — ŠTÍT (−3) | MIRROR (−5).
// Vzájomne výlučné; rozsvieti sa vždy len zvolená polovica. Starterovi zamknuté (vizuálny zámok).
const goldenBtn = document.getElementById("golden-btn");
const goldenShieldHalf = goldenBtn.querySelector(".shield-half");
const goldenMirrorHalf = goldenBtn.querySelector(".mirror-half");

// rozsvietenie polovíc podľa armed flagov
function syncGoldenHalves() {
  goldenShieldHalf?.classList.toggle("armed", goldenArmed);
  goldenMirrorHalf?.classList.toggle("armed", goldenMirrorArmed);
  // bežný štít/mirror vo fronte zamkne príslušnú zlatú polovicu (vzájomné vylúčenie)
  goldenShieldHalf?.classList.toggle("locked", !goldenArmed && myQueue.some(a => a.type === "shield"));
  goldenMirrorHalf?.classList.toggle("locked", !goldenMirrorArmed && myQueue.some(a => a.type === "mirror"));
}

function toggleGoldenHalf(mode) {
  if (uiLocked()) return;
  if (openPicker) { shakeBtn(goldenBtn); return; }
  if (!me || state?.starter === me) { shakeBtn(goldenBtn); return; }
  // golden shield/mirror sa vzájomne vylučuje s bežnou akciou rovnakého druhu vo fronte (zamknuté, kým ju nezrušíš)
  if (mode === "shield") {
    if (!goldenArmed && myQueue.some(a => a.type === "shield")) { shakeBtn(goldenBtn); return; }
    goldenArmed = !goldenArmed; goldenMirrorArmed = false;
  } else {
    if (!goldenMirrorArmed && myQueue.some(a => a.type === "mirror")) { shakeBtn(goldenBtn); return; }
    goldenMirrorArmed = !goldenMirrorArmed; goldenArmed = false;
  }
  syncGoldenHalves();
  renderQueue();
}
goldenShieldHalf?.addEventListener("click", () => toggleGoldenHalf("shield"));
goldenMirrorHalf?.addEventListener("click", () => toggleGoldenHalf("mirror"));

// Golden Mana | Last Stand — duálne tlačidlo (2 polovice, vzájomne výlučné, ako golden shield/mirror).
// Vykoná sa po konci kola; dostupné obom hráčom; v poslednom (buffnutom) kole zamknuté pre oboch.
const goldDualBtn = document.getElementById("gold-dual-btn");
const gmHalf = goldDualBtn.querySelector(".gm-half");
const lsHalf = goldDualBtn.querySelector(".ls-half");
const gmCostEl = document.getElementById("gm-cost");

function syncGoldDualHalves() {
  gmHalf?.classList.toggle("armed", goldenManaArmed);
  lsHalf?.classList.toggle("armed", lastStandArmed);
}
function toggleGoldDual(mode) {
  if (uiLocked()) return;
  if (openPicker) { shakeBtn(goldDualBtn); return; }
  if (!me || !state?.[me]?.char) return;
  if (state?.goldLocked) { shakeBtn(goldDualBtn); return; } // posledné kolo — zamknuté
  if (mode === "mana") { goldenManaArmed = !goldenManaArmed; lastStandArmed = false; }
  else                 { lastStandArmed  = !lastStandArmed;  goldenManaArmed = false; }
  syncGoldDualHalves();
  renderQueue();
}
gmHalf?.addEventListener("click", () => toggleGoldDual("mana"));
lsHalf?.addEventListener("click", () => toggleGoldDual("laststand"));

// Démon útok — tlačidlo dostupné len buffnutému hráčovi v poslednom kole (namiesto zamknutého gold dual buttonu).
// Správa sa ako bežná akcia: pridá/odoberie {type:"demon"} do/z myQueue (max 3, raz za kolo).
const demonBtn = document.getElementById("demon-btn");
demonBtn?.addEventListener("click", () => {
  if (uiLocked()) return;
  if (openPicker) { shakeBtn(demonBtn); return; }
  if (!me || !state?.[me]?.char || !state?.[me]?.lastStandBuff) return;
  const idx = myQueue.findIndex(a => a.type === "demon");
  if (idx >= 0) { myQueue.splice(idx, 1); } // opätovný klik = odober z fronty
  else {
    if (myQueue.length >= 3) { shakeBtn(demonBtn); return; }
    myQueue.push({ type: "demon" });
  }
  renderQueue();
});
demonBtn?.addEventListener("mouseenter", () => {
  if (!me || !state?.[me]?.lastStandBuff) return;
  const p = ghostPos();
  if (p) showPreviewCells(cellsForDemonPreview(p));
});
demonBtn?.addEventListener("mouseleave", clearPreviewCells);

// Last Hope — len nebuffnutý hráč vo final kole; toggle úvodnej akcie (ako armed flag, nie do myQueue)
const lastHopeBtn = document.getElementById("last-hope-btn");
function canPlayLastHope() {
  return !!me && !!state?.[me]?.char && !!state?.goldLocked && !state?.[me]?.lastStandBuff;
}
lastHopeBtn?.addEventListener("click", () => {
  if (uiLocked()) return;
  if (openPicker) { shakeBtn(lastHopeBtn); return; }
  if (!canPlayLastHope()) { shakeBtn(lastHopeBtn); return; }
  lastHopeArmed = !lastHopeArmed;
  renderQueue();
});

function updateGoldenButton() {
  if (goldenBtn) {
    // viditeľný obom hráčom; starterovi zamknutý (zámok + neaktívny vzhľad)
    const inGame = !!me && !!state?.[me]?.char;
    goldenBtn.classList.toggle("hidden", !inGame);
    const isStarter = !!me && state?.starter === me;
    goldenBtn.classList.toggle("locked-perm", isStarter);
    if (isStarter && (goldenArmed || goldenMirrorArmed)) {
      goldenArmed = false;
      goldenMirrorArmed = false;
    }
    syncGoldenHalves();
  }
  if (goldDualBtn) {
    const available = !!me && !!state?.[me]?.char;
    const locked = !!state?.goldLocked; // posledné (buffnuté) kolo — duálny button zamknutý pre oboch
    goldDualBtn.classList.toggle("hidden", !available);
    goldDualBtn.classList.toggle("locked-perm", locked); // rovnaký zámok (🔒 + sivé) ako golden shield/mirror pre startera
    if (locked) { goldenManaArmed = false; lastStandArmed = false; }
    // cena golden many v HP (srdiečka) rastie s každým použitím (1, 2, 3…); +6 mana je nad ňou (statické)
    const cost = (state?.[me]?.manaRefills ?? 0) + 1;
    if (gmCostEl) { gmCostEl.innerHTML = `−${cost}${miniPix("❤️")}`; hydratePix(gmCostEl); }
    syncGoldDualHalves();
  }
  // démon útok — v poslednom (FINAL) kole pre buffnutého hráča; nahrádza inak zamknutý gold dual button
  if (demonBtn) {
    const buffed = !!me && !!state?.[me]?.lastStandBuff;
    const showDemon = !!me && !!state?.[me]?.char && !!state?.goldLocked && buffed;
    demonBtn.classList.toggle("hidden", !showDemon);
    if (showDemon) {
      if (goldDualBtn) goldDualBtn.classList.add("hidden"); // duálny button je aj tak zamknutý — schovaj ho
      const used = myQueue.some(a => a.type === "demon");
      demonBtn.classList.toggle("armed", used);
      demonBtn.disabled = !used && myQueue.length >= 3; // plná fronta a démon nie je v nej → nedá sa pridať
    } else {
      demonBtn.disabled = false;
      demonBtn.classList.remove("armed");
    }
  }
  // Last Hope tlačidlo — len nebuffnutý hráč vo final kole (naľavo od golden shield/mirror)
  if (lastHopeBtn) {
    const showHope = canPlayLastHope();
    lastHopeBtn.classList.toggle("hidden", !showHope);
    if (showHope) {
      lastHopeBtn.classList.toggle("armed", lastHopeArmed);
    } else {
      if (lastHopeArmed) lastHopeArmed = false; // mimo final kola nesmie ostať navolené
      lastHopeBtn.classList.remove("armed");
    }
  }
}

document.querySelectorAll(".controls button[data-act]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (uiLocked()) return;
    if (myQueue.length >= 3) return;

    // pri otvorenom pickeri sú klikateľné len jeho šípky — ostatné tlačidlá sú blokované
    const isPickerArrow = !!btn.closest(".dir-picker");
    if (openPicker && !isPickerArrow) { shakeBtn(btn); return; }

    const [type, arg] = btn.dataset.act.split(":");

    // každá akcia max 1× za kolo
    if (myQueue.some(a => a.type === type)) {
      shakeBtn(btn);
      return;
    }
    // vzájomné vylúčenie s golden predťahom: golden shield zamyká štít, golden mirror zamyká mirror
    if ((type === "shield" && goldenArmed) || (type === "mirror" && goldenMirrorArmed)) {
      shakeBtn(btn);
      return;
    }

    if (type === "move")      myQueue.push({ type: "move", dir: arg });
    if (type === "dash")      myQueue.push({ type: "dash", dir: arg });
    if (type === "recharge")  myQueue.push({ type: "recharge" });
    if (type === "attack")    myQueue.push({ type: "attack", dir: arg });
    if (type === "melee")     myQueue.push({ type: "melee" });
    if (type === "special")   myQueue.push(arg ? { type: "special", dir: arg } : { type: "special" }); // smer (←/→) volí len Medúza
    if (type === "shield")    myQueue.push({ type: "shield" });
    if (type === "mirror")    myQueue.push({ type: "mirror" });

    if (isPickerArrow) closePickers();
    renderQueue();
  });
});
undoBtn.addEventListener("click", () => {
  if (uiLocked()) return;
  if (myQueue[myQueue.length - 1]?.type === "stoned") return; // skamenený pass sa nedá odobrať
  myQueue.pop();
  renderQueue();
});
// hláška o chybe spojenia (server nepotvrdil prijatie ťahu)
const connErrorEl = document.getElementById("conn-error");
function showConnError() { connErrorEl?.classList.remove("hidden"); }
function hideConnError() { connErrorEl?.classList.add("hidden"); }
connErrorEl?.addEventListener("click", hideConnError); // klikom sa dá zavrieť

// server nepotvrdil ťah ani po opakovaniach → odomkni ovládanie a nechaj usera potvrdiť znova
function unlockAfterConnError() {
  lockedIn = false;
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
  const forTurn = state?.turn; // kolo, pre ktoré táto voľba platí — server zahodí zopakovanie, ak sa už posunulo
  const send = () => {
    tries++;
    socket.timeout(1500).emit("lock_in", payload, forTurn, (err) => {
      if (!err) { hideConnError(); return; }   // server POTVRDIL prijatie ťahu → hotovo
      if (!lockedIn || playing) return;         // kolo sa medzitým vyriešilo/odomklo → nič nerob
      if (tries < MAX_TRIES) { send(); return; } // stratený packet → skús znova
      unlockAfterConnError();                    // vyčerpané pokusy → odomkni + oznám chybu
    });
  };
  send();
}
lockBtn.addEventListener("click", () => {
  if (playing) return; // počas prehrávania kola nelockuj
  if (uiLocked()) return;
  if (myQueue.length !== 3) {
    lockBtn.classList.add("shake");
    setTimeout(() => lockBtn.classList.remove("shake"), 400);
    return;
  }
  const payload = [...myQueue];
  if (goldenArmed) payload.unshift({ type: "golden_shield" });
  else if (goldenMirrorArmed) payload.unshift({ type: "golden_mirror" });
  if (lastHopeArmed) payload.unshift({ type: "last_hope" }); // úplne prvý, ešte pred golden shield/mirror
  if (goldenManaArmed) payload.push({ type: "golden_mana" });
  else if (lastStandArmed) payload.push({ type: "last_stand" });
  lockedIn = true; // všetky tlačidlá idú do locked stavu až do konca kola
  emitLockIn(payload); // (až po nastavení lockedIn — helper podľa neho rozhoduje o opakovaní)
  closePickers();
  lockBtn.classList.add("locked");
  lockBtn.classList.remove("ready");
  lockBtn.textContent = "LOCKED";
  lockBtn.disabled = true;
  stopTurnTimer();
});

/* ---------- Retry ---------- */
retryBtn.addEventListener("click", () => { socket.emit("retry"); });

/* ---------- Phase UI (lobby / waiting / char-select) ---------- */
const otherSlot = () => (me === "p1" ? "p2" : me === "p2" ? "p1" : null);

function applyPhaseUI(s) {
  const phase = s?.phase || "playing";
  const controls = document.querySelector(".controls-row");

  // lobby: host vidí nastavenia, druhý hráč čaká
  if (phase === "lobby" && !isSpectator) {
    if (isHost) { showLobby(s); lobbyWaitEl.classList.add("hidden"); }
    else { lobbyEl.classList.add("hidden"); lobbyWaitEl.classList.remove("hidden"); }
  } else {
    lobbyEl.classList.add("hidden");
    lobbyWaitEl.classList.add("hidden");
  }

  // turnajový draft: kým nepotvrdím tím, char-select beží v team-mode (toggle výber + confirm);
  // po potvrdení „TEAM LOCKED" čakačka, kým tím nepotvrdí aj súper (server vtedy prepne na playing)
  const teamPhase = phase === "team_select" && !isSpectator && me;
  const needTeam = teamPhase && !s?.rosterReady?.[me];
  teamWaitEl?.classList.toggle("hidden", !(teamPhase && !needTeam));
  selEl.classList.toggle("team-mode", needTeam);

  // char-select v hernej fáze (kým nemám zvolenú postavu) alebo draft tímu (team-mode)
  const needChar = phase === "playing" && !isSpectator && me && !s?.[me]?.char;
  if (needChar || needTeam) {
    updateCharSelectHp(s); // tournament: HP magov + mŕtvi (musí byť pred preview loopom); v drafte null → bez statov
    selEl.classList.toggle("p2-side", me === "p2"); // hráč vpravo vidí svojich magov v alternatívnom vykreslení
    if (selEl.classList.contains("hidden")) { teamPick = []; setCharPage(0); } // nové otvorenie — od stránky Mages, čistý draft
    if (needTeam) syncTeamUi();
    else selEl.querySelectorAll(".char-card.picked").forEach(c => { c.classList.remove("picked"); c.querySelector(".pick-badge")?.remove(); });
    hideDeathCenter(); selEl.classList.remove("hidden"); startCharSelectPreview(); // démon nesmie visieť cez výber
  } else if (!selEl.classList.contains("hidden")) { selEl.classList.add("hidden"); stopCharSelectPreview(); }

  if (controls && !isSpectator) controls.style.display = (phase === "playing") ? "" : "none";
}

// séria: v HUD boxe každého hráča rad placeholderov — BO3 = koruny za výhry,
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
// (fáza team_select — súperov roster je maskovaný), strana nemá žiadne hlavy
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
  // labyrint: hlavy (swap buttony) sú počas kliatby skryté u OBOCH hráčov — objavia sa až s labyrinth_end
  // (flag labyrinth padá až vtedy, reveal ho drží); visibility drží layout HUD boxu bez skoku
  const labActive = !!(state?.p1?.labyrinth || state?.p2?.labyrinth);
  crownsP1El.classList.toggle("lab-hidden", labActive);
  crownsP2El.classList.toggle("lab-hidden", labActive);
  const buildSide = (slot) => {
    const dead = state?.mageDead?.[slot] || [];
    const cur = state?.[slot]?.char || null;
    const mineSlot = slot === me;
    return mageOrderFor(slot).map(char => {
      const isDead = dead.includes(char);
      const isCurrent = cur === char;
      const armed = mineSlot && myQueue.some(a => a.type === "swap" && a.to === char);
      // Last Stand pakt: buffnutý hráč vo final kole nestrieda — jeho lavička nie je klikateľná
      const clickable = mineSlot && !!cur && !isDead && !isCurrent && !uiLocked() && !state?.[slot]?.lastStandBuff;
      let cls = "mhead";
      if (isDead) cls += " dead";
      if (isCurrent) cls += " current";
      if (armed) cls += " armed";
      if (clickable) cls += " clickable";
      // HP/mana nad hlavou (mŕtvy mág ich nemá; súperova lavička je skrytá → prázdny riadok pre zarovnanie)
      const st = isDead ? null : headStats(slot, char, isCurrent);
      const statsHtml = st
        ? `<span class="mh-stats"><span class="mh-hp">${pixSvg("heart")}${st.hp ?? "?"}</span><span class="mh-mana">${pixSvg("drop")}${st.mana ?? "?"}</span></span>`
        : `<span class="mh-stats empty"></span>`;
      const face = isDead ? pixSvg("skull") : mageHeadHtml(char, "mh-canvas" + (usesAltColor(char, slot) ? " alt-color" : ""), slot);
      return `<span class="${cls}" data-slot="${slot}" data-char="${char}" title="${CHAR_META[char]?.name || char}">${statsHtml}<span class="mh-face">${face}</span></span>`;
    }).join("");
  };
  crownsP1El.innerHTML = buildSide("p1");
  crownsP2El.innerHTML = buildSide("p2");
  crownsP1El.classList.remove("hidden"); crownsP2El.classList.remove("hidden");
  crownsP1El.classList.add("mage-heads"); crownsP2El.classList.add("mage-heads");
  // hlavy (canvas.mage-head) animuje raf
}

// klik na hlavu (moja strana, živý ne-aktuálny mág) = toggle swap akcie vo fronte — presne ako démon button
function toggleSwap(char) {
  if (uiLocked()) return;
  if (openPicker) return;
  if (!me || state?.phase !== "playing" || !state?.[me]?.char) return;
  if (state?.series?.format !== "tournament") return;
  if (state?.p1?.labyrinth || state?.p2?.labyrinth) return;  // počas labyrintu je výmena zakázaná (hlavy sú skryté)
  if (state?.[me]?.lastStandBuff) return;                    // Last Stand pakt: vo final kole sa nestrieda
  if ((state?.mageDead?.[me] || []).includes(char)) return; // mŕtveho maga nemožno nasadiť
  if (state?.[me]?.char === char) return;                    // aktuálneho maga nemožno vymeniť za seba
  const idx = myQueue.findIndex(a => a.type === "swap" && a.to === char);
  if (idx >= 0) { myQueue.splice(idx, 1); }                  // opätovný klik = odober z fronty
  else {
    if (myQueue.length >= 3) return;                         // plná fronta
    if (myQueue.filter(a => a.type === "swap").length >= 2) return; // max 2 výmeny za kolo
    myQueue.push({ type: "swap", to: char });
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
const TIMER_DIRS = ["up", "down", "left", "right"];
let serverTimerEndsAt = 0; // performance.now()-based deadline zo servera (0 = bez limitu)

// DOČASNÁ DIAGNOSTIKA časovača — zapni cez ?tdebug=1; loguje prečo sa časovač (ne)zobrazí
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
  const planning = !!serverTimerEndsAt && !playing && !gameOverShown && state?.phase === "playing"
    && !isSpectator && mine?.char && state?.[otherSlot()]?.char && !mine.locked;
  if (TDEBUG && planning !== _lastPlanning) {
    _lastPlanning = planning;
    tlog(`planning=${planning}`, {
      timerEndsAt: !!serverTimerEndsAt, playing, gameOverShown, phase: state?.phase,
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
// vyprší čas — náhodne doplň nevyplnené z 3 základných akcií a zamkni (gold akcie sa nikdy nepridajú samé)
function autoLockTimeout() {
  if (uiLocked() || playing || !me || state?.[me]?.locked) { stopTurnTimer(); return; }
  const used = new Set(myQueue.map(a => a.type));
  // golden predťah už pokrýva štít/mirror — nedopĺňaj ich (inak by sa akcia zahrala 2× a server lock odmietol)
  if (goldenArmed) used.add("shield");
  if (goldenMirrorArmed) used.add("mirror");
  const pool = ["recharge", "shield", "mirror", "melee", "special", "move", "dash", "attack"].filter(t => !used.has(t));
  while (myQueue.length < 3 && pool.length) {
    const t = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    if (t === "move" || t === "attack" || t === "dash") myQueue.push({ type: t, dir: TIMER_DIRS[Math.floor(Math.random() * 4)] });
    else if (t === "special" && ghostCharAt() === "medusa") myQueue.push({ type: t, dir: Math.random() < 0.5 ? "left" : "right" }); // Medúzin special potrebuje smer
    else myQueue.push({ type: t });
  }
  const payload = [...myQueue];
  if (goldenArmed) payload.unshift({ type: "golden_shield" });
  else if (goldenMirrorArmed) payload.unshift({ type: "golden_mirror" });
  if (lastHopeArmed) payload.unshift({ type: "last_hope" }); // úplne prvý (gold akcie sa nedopĺňajú, navolený Last Hope sa zachová)
  if (goldenManaArmed) payload.push({ type: "golden_mana" });
  else if (lastStandArmed) payload.push({ type: "last_stand" });
  lockedIn = true;
  emitLockIn(payload); // spoľahlivé poslanie aj pri auto-locku z časovača
  closePickers();
  renderQueue();
  lockBtn.classList.add("locked"); lockBtn.classList.remove("ready");
  lockBtn.textContent = "LOCKED"; lockBtn.disabled = true;
  stopTurnTimer();
}

/* ---------- Lobby (host nastavuje zápas) ---------- */
let lobbyBuilt = false;
function showLobby() {
  lobbyEl.classList.remove("hidden");
  if (lobbyBuilt) return;
  lobbyBuilt = true;

  // segmentové prepínače: klik nastaví .active v rámci skupiny
  lobbyEl.querySelectorAll(".opt-row").forEach(row => {
    row.addEventListener("click", (e) => {
      const btn = e.target.closest(".opt");
      if (!btn) return;
      row.querySelectorAll(".opt").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  const sumEl = document.getElementById("lobby-weights-sum");
  const startBtn = document.getElementById("lobby-start");
  const inputs = [...lobbyEl.querySelectorAll("#lobby-weights input")];
  const refreshSum = () => {
    const sum = inputs.reduce((a, i) => a + (parseInt(i.value, 10) || 0), 0);
    sumEl.textContent = `Total: ${sum}%`;
    const ok = sum === 100;
    sumEl.classList.toggle("bad", !ok);
    startBtn.disabled = !ok;
  };
  inputs.forEach(i => i.addEventListener("input", refreshSum));
  refreshSum();

  startBtn.addEventListener("click", () => {
    const pick = (id) => lobbyEl.querySelector(`#${id} .opt.active`)?.dataset.val;
    const weights = {};
    inputs.forEach(i => { weights[i.dataset.key] = parseInt(i.value, 10) || 0; });
    const config = {
      format: pick("lobby-format") || "single",
      tilesPerRound: parseInt(pick("lobby-tiles-count") || "1", 10),
      tileWeights: weights,
      timer: pick("lobby-timer") || "off",
    };
    if (Object.values(weights).reduce((a, b) => a + b, 0) !== 100) return;
    socket.emit("configure_match", config);
  });
}

/* ---------- Intermission (medzi hrami série) ---------- */
function showIntermission(gameWinner, series) {
  const mineWon = me && gameWinner === me;
  document.getElementById("im-title").textContent =
    gameWinner === "draw" ? "TIE" : (mineWon ? "YOU WON THIS GAME!" : "YOU LOST THIS GAME");

  const needed = series?.needed || 1;
  // placeholdery + ikony pre obe strany; práve pridaná koruna víťazovi sa animuje
  // (aj v tournamente koruny víťazovi — lebky mŕtvych magov nesie HUD v hre, nie tento prechod)
  const renderSide = (filled, isMarkSide) => Array.from({ length: needed }, (_, i) => {
    const isOn = i < (filled || 0);
    const isNew = isMarkSide && i === (filled || 0) - 1;
    return `<span class="crown${isNew ? " new" : ""}">${pixSvg(isOn ? "crown" : "crown_outline")}</span>`;
  }).join("");
  const fillL = series?.winsP1;
  const fillR = series?.winsP2;
  const markL = gameWinner === "p1";
  const markR = gameWinner === "p2";
  document.getElementById("im-crowns-l").innerHTML = renderSide(fillL, markL);
  document.getElementById("im-crowns-r").innerHTML = renderSide(fillR, markR);

  // popisky strán — kde som ja (sloty sú fixné na celú sériu), drží strany ako koruny v HUD
  const whoL = document.getElementById("im-who-l");
  const whoR = document.getElementById("im-who-r");
  whoL.textContent = me === "p1" ? "YOU" : "OPPONENT";
  whoR.textContent = me === "p2" ? "YOU" : "OPPONENT";
  whoL.className = "im-who " + (me === "p1" ? "you" : "opp");
  whoR.className = "im-who " + (me === "p2" ? "you" : "opp");

  document.getElementById("im-next").textContent = "Next game starting…";
  intermissionEl.classList.remove("hidden");
}

/* ---------- Sockets ---------- */
// you_are nesie slot (ľavá/pravá rola, fixná na celú sériu: host=p1) aj či som host
socket.on("you_are", (info) => {
  if (info && typeof info === "object") { me = info.slot; isHost = !!info.isHost; }
  else { me = info; } // spätná kompat.
});

/* ---------- Losovanie farieb (po configure_match) ---------- */
// Server už osoby vylosoval na sloty (p1 = BIELY vľavo a začína každú hru, p2 = ČIERNY vpravo)
// a poslal you_are — tu sa výsledok len ZINSCENUJE: strelka na yin-yang kruhu sa roztočí
// a dobehne na polovici hráčovej farby (biela vľavo 270°, čierna vpravo 90°). Overlay leží
// NAD char-selectom, takže výber postavy čaká, kým ruleta dobehne.
const colorRollEl = document.getElementById("color-roll");
const crArrowEl   = document.getElementById("cr-arrow");
const crResultEl  = document.getElementById("cr-result");
socket.on("color_roll", () => {
  if (!colorRollEl || (me !== "p1" && me !== "p2")) return; // divák ruletu nepotrebuje
  const white = me === "p1";
  colorRollEl.classList.remove("hidden");
  colorRollEl.style.opacity = "";
  crResultEl.classList.add("hidden");
  crResultEl.innerHTML = "";
  // 4 celé otáčky + dobeh na cieľovú farbu ± rozptyl (len vizuálny — výsledok je daný)
  const target = (white ? 270 : 90) + (Math.random() * 40 - 20);
  crArrowEl.getAnimations().forEach(a => a.cancel());
  const spin = crArrowEl.animate(
    [{ transform: "rotate(0deg)" }, { transform: `rotate(${4 * 360 + target}deg)` }],
    { duration: 3400, easing: "cubic-bezier(.12,.68,.18,1)", fill: "forwards" }
  );
  spin.onfinish = () => {
    crResultEl.innerHTML = white
      ? `YOU PLAY <span class="cr-white">⚪ WHITE</span> — YOU GO FIRST!`
      : `YOU PLAY <span class="cr-black">⚫ BLACK</span> — YOU GO SECOND`;
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

// hra je plná — divák hru sleduje, ale nemá výber postavy ani ovládanie (box s hláškou dole)
let isSpectator = false;
socket.on("spectator", () => {
  isSpectator = true;
  document.getElementById("spectator")?.classList.remove("hidden");
  selEl.classList.add("hidden");
  stopCharSelectPreview();
  const controls = document.querySelector(".controls-row");
  if (controls) controls.style.display = "none";
});

socket.on("reset", () => {
  playGen++;        // zruš prípadné bežiace prehrávanie
  playing = false;
  hideConnError();
  resetActorFade();
  clearProjectiles(); // žiadny letiaci projektil nesmie prežiť reset

  // reset game-over stavov ešte pred renderHUD — inak by guard nechal visieť GAME OVER text
  serverWinner = null;
  serverGameResult = null;
  gameOverShown = false;
  lastAttackEndAt = { p1:0, p2:0 };
  stopTurnTimer();
  intermissionEl.classList.add("hidden");

  goOverlay.classList.add("hidden");
  chosenChar = null;
  dirPicker.classList.add("hidden");
  aimPicker.classList.add("hidden");
  clearActionLogs();
  myQueue = [];
  goldenArmed = false;
  goldenMirrorArmed = false;
  goldenManaArmed = false;
  lastStandArmed = false;
  lastHopeArmed = false;
  lockedIn = false;
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
  tlog("recv state", { phase: s.phase, timerMs: s.timerMs, timeline: !!s.timeline, p1c: s.p1?.char, p2c: s.p2?.char, playing });
  state = s; board = s.board || board;
  // FINAL ROUND hore podľa plánovacieho/refresh stavu (stavy s timeline = summon nechávame, prepne ho až banner)
  if (!s.timeline) _finalRoundActive = !!s.goldLocked;

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
    // finálny stav (vrátane nových tiles) nevykresľuj hneď — ukáže ho až posledný frame timeline
    schedulePlayTimeline(s.timeline);
  } else if (!playing) {
    // čerstvý stav mimo prehrávania → stredový démon nemá čo visieť (objaví sa len počas timeline);
    // toto ho po reconnecte/refreshi spoľahlivo schová bez nutnosti F5
    hideDeathCenter();
    renderGrid(s);
    renderHUD();
    positionActors(s, true);
    renderQueue(); // prekresli round-script lištu (zlatý skeleton mojich slotov hneď, bez interakcie)
  }
  // počas prehrávania snapshot bez timeline nevykresľuj — framy bežiacej timeline majú prednosť

  // label melee podľa mága — Medúza má širší dosah (diagonály) za nižší dmg
  const mineMelee = s[me];
  if (mineMelee?.char && meleeBtn) {
    const mCost = meleeBtn.querySelector(".cost");
    if (mineMelee.char === "medusa") {
      meleeBtn.title = "Melee (−4 mana, 4 dmg, hits your cell + all diagonal neighbours)";
      if (mCost) { mCost.innerHTML = `−4${miniPix("💧")} 4${miniPix("☠️")}`; hydratePix(mCost); }
    } else {
      meleeBtn.title = "Melee (−4 mana, 8 dmg, hits only an opponent on your cell)";
      if (mCost) { mCost.innerHTML = `−4${miniPix("💧")} 8${miniPix("☠️")}`; hydratePix(mCost); }
    }
  }
  // label special podľa mága — v turnaji po naplánovanom swape platí nový mág (ghostCharAt), nie ten na štarte kola
  const specChar = ghostCharAt();
  if (specChar && specialBtn) {
    const cost = specialBtn.querySelector(".cost");
    if (specChar === "medusa") {
      // Medúza: žiadny dmg — skamenenie na 2 akcie (smer sa volí v pickeri)
      specialBtn.title = "Special (−5 mana) — petrifying gaze: choose a direction; a hit opponent skips their next 2 actions";
      if (cost) { cost.innerHTML = `−5${miniPix("💧")} 2×🗿`; hydratePix(cost); }
    } else if (specChar === "minotaur") {
      // Minotaur: žiadny dmg — celoplošný labyrint (trvá do vzájomného zásahu)
      specialBtn.title = "Special (−5 mana) — hits the whole board: banishes the opponent into the labyrinth (they see only their own cell) until either of you lands a hit";
      if (cost) { cost.innerHTML = `−5${miniPix("💧")} 🌀`; hydratePix(cost); }
    } else if (specChar === "naruto") {
      // Naruto: žiadny priamy dmg — musí stáť sám, prizve tieňového klona (kópia s 1 dmg)
      specialBtn.title = "Special (−5 mana) — must stand alone: summons a shadow clone that copies his moves (up/down inverted), deals the same dmg as Naruto (double when stacked on his cell) and vanishes on any hit";
      if (cost) { cost.innerHTML = `−5${miniPix("💧")} 👥`; hydratePix(cost); }
    } else {
      const dmg = { fire:5, lightning:3, wanderer:8 }[specChar];
      if (dmg != null) {
        specialBtn.title = `Special (−5 mana, ${dmg} dmg)`;
        if (cost) { cost.innerHTML = `−5${miniPix("💧")} ${dmg}${miniPix("☠️")}`; hydratePix(cost); }
      }
    }
  }

  setServerTimer(s.timerMs ?? null); // synchronizuj odpočet so serverom (drží aj po refreshi)
});

// server posiela zostávajúci čas na ťah — klient sa naň synchronizuje (displej + auto-lock)
socket.on("turn_timer", ({ ms }) => { tlog("recv turn_timer", ms); setServerTimer(ms); });

// Server stále posiela "game_over" – len si zapamätáme, nezobrazíme hneď overlay.
// Overlay zobrazíme až po dobehnutí útoku a animácii smrti.
socket.on("game_over", ({ winner }) => {
  serverWinner = winner;
});

// výsledok jednej hry série — vyhodnotí sa až na konci prehrávania timeline
socket.on("game_result", (r) => { serverGameResult = r; });

// medzi hrami série: resetuj UI kola (skóre ostáva), char-select pre ďalšiu hru riadi nasledujúci state
socket.on("new_game", () => {
  tlog("recv new_game");
  playGen++; playing = false;
  serverWinner = null; serverGameResult = null; gameOverShown = false;
  lastAttackEndAt = { p1:0, p2:0 };
  hideDeathCenter(); // démon zo summon/banish nesmie prejsť do ďalšej hry
  hideDeathBehind(); // ani ten za postavou (banish ho mohol nechať visieť pri race s koncom hry)
  resetActorFade();  // teleport fade nesmie prejsť do ďalšej hry
  clearProjectiles(); // ani letiaci projektil
  stopTurnTimer();
  intermissionEl.classList.add("hidden");
  goOverlay.classList.add("hidden");
  chosenChar = null;
  dirPicker.classList.add("hidden"); aimPicker.classList.add("hidden");
  clearActionLogs();
  myQueue = []; goldenArmed = false; goldenMirrorArmed = false; goldenManaArmed = false; lastStandArmed = false; lastHopeArmed = false; lockedIn = false;
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

  // po vypršaní facing override (streľba do strany) otoč postavu späť k súperovi —
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
    const anim = stoned
      ? ANIM_DEF.idle
      : (aSt.key === "victory" || aSt.key === "casting")
        ? { file: SPECIAL_ANIMS[st.char].file, fps: SPECIAL_FPS, loop: true }
        : currentAnim(slot);
    // počas Special_2 summon pózy orežeme prázdny bočný okraj (rovnako ako kópiu), nech sa obaja zmestia do bunky
    const poseCrop = (cloneSummonPose[slot] && performance.now() < cloneSummonPose[slot].until) ? SUMMON_CROP : 0;
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, stoned ? 0 : now, ACTOR_W, ACTOR_H, 0.95, 0.5, true, 0, 0, poseCrop))
      .catch(() => ensureSpriteMeta(dir, ANIM_DEF.idle.file)
        .then(metaIdle => drawSprite(ctx, metaIdle, ANIM_DEF.idle, now, ACTOR_W, ACTOR_H))
        .catch(()=>{}));
  });

  // tieňové klony — zrkadlia animáciu majiteľa (identický vzhľad, rovnaký glow obrán = nerozoznateľné);
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
    let anim, animT = stoned ? 0 : now;
    if (stoned) anim = ANIM_DEF.idle;
    // Hurt hrá od ZAČIATKU zásahu (animT = now - flAt), nie zamrznutý na poslednom frame — inak by strhnutie
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

  // summon kópia (Narutov clone_summon) — dočasný canvas na tej istej bunke hrá Special_2 tvárou v tvár
  cloneSummonFx = cloneSummonFx.filter(f => f.el.isConnected);
  for (const f of cloneSummonFx) {
    const ctx = f.el.getContext("2d");
    ensureSpriteMeta(f.dir, ANIM_DEF.special2.file)
      .then(meta => drawSprite(ctx, meta, ANIM_DEF.special2, now, ACTOR_W, ACTOR_H, 0.95, 0.5, true, 0, 0, SUMMON_CROP))
      .catch(() => {});
  }

  // ghost KLONA — budúca pozícia vlastného klona po naplánovaných movoch (inverzná vertikála)
  {
    const ctx = cloneGhost.getContext("2d");
    const mine = state?.[me];
    const cg = simulatedClonePos();
    const show = mine && mine.char && mine.clone && !mine.locked && !playing && cg &&
                 myQueue.some(a => a.type === "move" || a.type === "dash") &&
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
    const show = mine && mine.char && !mine.locked && !playing && gp &&
                 myQueue.some(a => a.type === "move" || a.type === "dash") &&
                 (gp.x !== mine.x || gp.y !== mine.y);
    if (!show) {
      ctx.clearRect(0, 0, actorGhost.width, actorGhost.height);
      actorGhost.style.display = "none";
    } else {
      actorGhost.style.display = "block";
      const { left, top } = cellToPx(gp.x, gp.y);
      actorGhost.style.left = (left - (ACTOR_W - TILE_W) / 2) + "px";
      actorGhost.style.top  = (top - (ACTOR_H - TILE_H)) + "px";
      // rovnaký flip ako hráčov sprite — postava je vo frame mimo stredu, bez flipu vyzerá posunutá
      actorGhost.style.transform = `scaleX(${computeFacing(state.p1, state.p2)[me]})`;
      const ghostChar = ghostCharAt() || mine.char;
      actorGhost.classList.toggle("alt-color", usesAltColor(ghostChar, me));
      const dir = charDirFor(ghostChar, me);
      ensureSpriteMeta(dir, ANIM_DEF.idle.file)
        .then(meta => drawSprite(ctx, meta, ANIM_DEF.idle, now, ACTOR_W, ACTOR_H))
        .catch(() => {});
    }
  }

  // labyrint: obrys súpera. Keď lovec PRÁVE stojí na mojej (fakľami ožiarenej) bunke (server flag
  // hunterHere), ukáž ho tam OŽIARENÉHO (nie čierny tieň) — vidím ho ako mimo labyrintu. Inak čierna
  // silueta na bunke posledného stretnutia s niťou (threadMark), ako doteraz.
  {
    const ctx = actorSilhouette.getContext("2d");
    const mine = me ? state?.[me] : null;
    const oppS = otherSlot();
    const oppChar = oppS ? state?.[oppS]?.char : null;
    const inLab = !!mine?.labyrinth;
    const hunterHere = !!(inLab && mine?.hunterHere && mine.x != null); // lovec je práve na mojej bunke
    const mark = inLab ? (hunterHere ? [mine.x, mine.y] : mine.threadMark) : null;
    // lit = lovec na mojej bunke → CSS zruší brightness(0); p2 albino paleta cez alt-color (natívne palety to ignorujú)
    actorSilhouette.classList.toggle("lit", hunterHere);
    actorSilhouette.classList.toggle("alt-color", hunterHere && !!oppChar && usesAltColor(oppChar, oppS));
    if (!mark || !oppChar) {
      // decentne sa STRATÍ v hmle (opacity fade-out cez CSS transition); display necháme block, nech fade dobehne
      actorSilhouette.style.opacity = "0";
      ctx.clearRect(0, 0, actorSilhouette.width, actorSilhouette.height);
    } else {
      actorSilhouette.style.display = "block";
      actorSilhouette.style.opacity = "1"; // vynorí sa/ostane (fade-in + lit↔čierny cez CSS transition)
      const { left, top } = cellToPx(mark[0], mark[1]);
      // obrys na MOJEJ bunke (prekliaty vošiel na Minotaura / Minotaur na mňa) — uhni nabok ako pairShift
      const onMe = mine.x === mark[0] && mine.y === mark[1];
      const dodge = onMe ? (me === "p1" ? 70 : -70) : 0;
      actorSilhouette.style.left = (left - (ACTOR_W - TILE_W) / 2 + dodge) + "px";
      actorSilhouette.style.top  = (top - (ACTOR_H - TILE_H)) + "px";
      const dir = charDirFor(oppChar, oppS);
      // lovec na mojej bunke (lit) → animuj NORMÁLNE (idle loop, t=now); čierny breadcrumb = statická póza (t=0)
      const t = hunterHere ? now : 0;
      ensureSpriteMeta(dir, ANIM_DEF.idle.file)
        .then(meta => drawSprite(ctx, meta, ANIM_DEF.idle, t, ACTOR_W, ACTOR_H))
        .catch(() => {});
    }
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
    // labyrint: CELÝ súperov widget prekrýva bludisko (assets/minotaur/labyrint.png cez CSS .in-maze) —
    // blúdiaci (labyrinth) aj skrytý Minotaur (x null): obaja si navzájom vidia len bludisko.
    // labReveal (istý zásah v tomto ťahu) widget odkryje ešte pred animáciou akcie — HP/mana sú späť.
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
    let anim = ANIM_DEF.idle, t = stonedHud ? 0 : now;
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

  // HUD hlavy magov + swap badge hlavy — animovaný výrez hlavy z idle spritu
  document.querySelectorAll("canvas.mage-head[data-char]").forEach(cvs => drawMageHeadAnim(cvs, cvs.dataset.char, now));

  // specials v strede
  document.querySelectorAll("canvas.special-center").forEach(cvs => {
    const ctx  = cvs.getContext("2d");
    const dir  = cvs.dataset.dir;
    const file = cvs.dataset.file;
    const anim = { file, fps: Number(cvs.dataset.fps) || SPECIAL_FPS, loop: true };
    ensureSpriteMeta(dir, file)
      .then(meta => drawSprite(ctx, meta, anim, performance.now(), cvs.width, cvs.height))
      .catch(()=>{});
  });

  // nabíjacie aury (golden Last Stand / červená Last Hope / bežný recharge) plynulo sledujú postavu počas pohybu
  document.querySelectorAll(".charge-aura[data-slot]").forEach(cont => placeChargeAura(cont, cont.dataset.slot));

  // Last Stand — trvalý golden stav riadený serverom (state[slot].lastStandBuff):
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
      // démon sa drží za postavou na 0.25 — naviazaný na ŽIVÚ (interpolovanú) pozíciu sprite-u postavy,
      // takže sa kĺže spolu s ňou (nie teleport). Drží sa keď postava STOJÍ (server flag !st.down) — počas
      // summon/banish prechodov (st.down=true, resp. _lsBanishing) ho riadia efekty. State-driven = robustné.
      const tgt = state[buffSlot];
      // labyrint: skrytý buffnutý hráč (x null) — priehľadný démon za postavou sa skryje,
      // nemá ho kam sledovať (inak by ostal svietiť na starej/rohovej pozícii a prezradil buff)
      if (tgt && tgt.x == null) {
        deathBehind.style.opacity = "0";
      } else if (_lsBanishing && tgt && tgt.down) {
        // po banish kille hráč leží mŕtvy — démon za postavou nemá za kým visieť; stavová poistka
        // drží nulu každý tick (fill-forwards animácia banishu mohla racenúť so state updatom).
        // Summon choreografiu (down=true, _lsBanishing=false) sa toto nedotýka — revive riadi efekt.
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
      // koniec buffnutého stavu (smrť/výhra) — uprac
      _lsRealActive = false; _lsBanishing = false; _deathGoldenSlot = null;
      hudBoxP1.classList.remove("death-golden");
      hudBoxP2.classList.remove("death-golden");
      deathBehind.getAnimations().forEach(a => a.cancel());
      deathBehind.style.opacity = "0";
      hideDeathCenter();
    }
  }

  // DEATH summon — framy do oboch canvasov: stredový overlay (fill 1.0) + „za postavou" (ako postava: ACTOR rozmer)
  ensureSpriteMeta(DEATH_DIR, DEATH_ANIM.file).then(meta => {
    drawSprite(deathCenter.getContext("2d"), meta, DEATH_ANIM, now, deathCenter.width, deathCenter.height, 1.0);
    drawSprite(deathBehind.getContext("2d"), meta, DEATH_ANIM, now, ACTOR_W, ACTOR_H);
  }).catch(()=>{});

  // Last Hope — trvalý červený ultra mód (state[slot].lastHopeBuff): pulzujúci červený mana bar + periodická červená aura
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

  // Last Hope summon — hope sprite do stredového overlay (viditeľnosť riadi opacity cez hopeCenterAppear/Disappear)
  ensureSpriteMeta(HOPE_DIR, HOPE_ANIM.file).then(meta => {
    drawSprite(hopeCenter.getContext("2d"), meta, HOPE_ANIM, now, hopeCenter.width, hopeCenter.height, 1.0);
  }).catch(()=>{});

  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

/* ---------- Initial ---------- */
// hydratácia pixel ikon — [data-emoji] dostanú pixelizovaný emoji canvas,
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
  // preview z ghost pozície — special by sa vykonal po už naplánovaných akciách
  specialBtn.addEventListener("mouseenter", ()=>{
    const char = ghostCharAt();   // po prípadnom swape vo fronte = nový mág
    const p = ghostPos();
    if (!char || !p) return;
    if (char === "medusa") return; // Medúza potrebuje smer — preview ukazujú až šípky pickeru
    showPreviewCells(cellsForSpecialPreview({ x: p.x, y: p.y, char }));
  });
  specialBtn.addEventListener("mouseleave", clearPreviewCells);
}
// hover preview zóny Medúzinho specialu na šípkach pickeru (←/→) — z ghost pozície
specialPicker?.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => {
    const char = ghostCharAt();
    const p = ghostPos();
    if (char === "medusa" && p) showPreviewCells(cellsForSpecialPreview({ x: p.x, y: p.y, char }, dir));
  });
  btn.addEventListener("mouseleave", clearPreviewCells);
});

// hover preview zásahovej bunky melee — vlastná bunka z ghost pozície po naplánovaných akciách
const meleeBtn = document.querySelector('.controls button[data-act="melee"]');
if (meleeBtn) {
  meleeBtn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    if (p) showPreviewCells(cellsForMeleePreview(p, ghostCharAt()));
  });
  meleeBtn.addEventListener("mouseleave", clearPreviewCells);
}

// hover preview dráhy strely na šípkach aim pickeru — z ghost pozície po naplánovaných akciách
aimPicker.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    if (!p) return;
    showPreviewCells(cellsForAimPreview(p, dir));
  });
  btn.addEventListener("mouseleave", clearPreviewCells);
});

/* ---------- Admin reset button (zobraz len s ?admin=1) ---------- */
(function mountAdminReset(){
  const qp = new URLSearchParams(location.search);
  if (!qp.has("admin")) return; // zobraz len pre admin režim

  const key = qp.get("key") || "";
  const btn = document.createElement("button");
  btn.id = "admin-reset";
  btn.textContent = "Reset session";
  btn.title = "Disconnects all players and restarts the game";
  btn.style.position = "fixed";
  btn.style.right = "14px";
  btn.style.bottom = "14px";
  btn.style.zIndex = "50";
  btn.style.padding = "10px 14px";
  btn.style.borderRadius = "10px";
  btn.style.border = "1px solid #5a1a1a";
  btn.style.background = "#8e0000";
  btn.style.color = "#fff";
  btn.style.fontWeight = "800";
  btn.style.cursor = "pointer";
  btn.style.boxShadow = "0 6px 18px rgba(0,0,0,.35)";

  btn.addEventListener("click", () => {
    if (!confirm("Really reset the game and disconnect all players?")) return;
    socket.emit("admin_reset_all", key);
    fetch(`/admin/reset-all${key ? `?key=${encodeURIComponent(key)}` : ""}`).catch(()=>{});
  });

  document.body.appendChild(btn);
})();

/* ---------- DEBUG: hope sprite animácia (?hopedebug=1) ----------
   Samostatný náhľad — nájdi správny počet framov v sprite_strip.png (frame inference predpokladá štvorec).
   [ / ]  počet framov   |   - / =  fps   |   ←/→  ručný krok   |   medzerník  pauza   |   0  auto */
(function hopeDebug() {
  const params = new URLSearchParams(location.search);
  if (!params.has("hopedebug")) return;

  const ov = document.createElement("div");
  Object.assign(ov.style, {
    position: "fixed", inset: "0", zIndex: "2000000", background: "#101012",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px",
  });
  const info = document.createElement("div");
  Object.assign(info.style, { color: "#fff", font: "15px monospace", textAlign: "center", whiteSpace: "pre", lineHeight: "1.5" });
  const cv = document.createElement("canvas");
  cv.width = 512; cv.height = 512;
  Object.assign(cv.style, { width: "512px", height: "512px", imageRendering: "pixelated", background: "#1c1c20", border: "1px solid #444" });
  ov.appendChild(info); ov.appendChild(cv);
  document.body.appendChild(ov);

  const ctx = cv.getContext("2d");
  let frames = Number(params.get("frames")) || 18; // štart = inference (9216/512)
  let fps = 10, manual = -1, paused = false;

  const img = new Image();
  img.src = "/assets/hope/sprite_strip.png";

  function draw(t) {
    if (img.complete && img.naturalWidth) {
      const fw = img.naturalWidth / frames, fh = img.naturalHeight;
      const idx = manual >= 0 ? manual : (paused ? 0 : Math.floor((t / (1000 / fps)) % frames));
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.imageSmoothingEnabled = false;
      const scale = Math.min(cv.width / fw, cv.height / fh);
      const dw = fw * scale, dh = fh * scale;
      ctx.drawImage(img, Math.round(idx * fw), 0, Math.round(fw), fh, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
      info.textContent =
        `hope sprite ${img.naturalWidth}×${img.naturalHeight}\n` +
        `frames=${frames}  frameW=${(img.naturalWidth / frames).toFixed(1)}  fps=${fps}  frame=${idx}${manual >= 0 ? " [MANUAL]" : paused ? " [PAUSE]" : ""}\n` +
        `[ / ] frames     - / = fps     ←/→ krok     medzerník pauza     0 auto`;
    } else {
      info.textContent = "načítavam /assets/hope/sprite_strip.png …";
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  window.addEventListener("keydown", (e) => {
    if (e.key === "[") frames = Math.max(1, frames - 1);
    else if (e.key === "]") frames = Math.min(64, frames + 1);
    else if (e.key === "-" || e.key === "_") fps = Math.max(1, fps - 1);
    else if (e.key === "=" || e.key === "+") fps = Math.min(30, fps + 1);
    else if (e.key === "ArrowLeft")  manual = ((manual < 0 ? 0 : manual - 1) + frames) % frames;
    else if (e.key === "ArrowRight") manual = ((manual < 0 ? 0 : manual + 1)) % frames;
    else if (e.key === " ") { manual = -1; paused = !paused; e.preventDefault(); }
    else if (e.key === "0") { manual = -1; paused = false; }
  });
})();





