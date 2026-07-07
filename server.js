// server.js (ESM)

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  // preži krátke výpadky spojenia: po reconnecte server prehrá klientovi zmeškané packety
  // (vrátane state+timeline) → animácie nevisia a netreba refresh ani pri blikajúcej sieti
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000, skipMiddlewares: true },
});

// no-store: prehliadač vždy načíta čerstvé statické súbory (žiadny tvrdý refresh po zmene client.js/index.html)
app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
}));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || ""; // ← voliteľné heslo pre admin reset
// biely (p1, vľavo) začína hru 1 (v sérii sa štartér hier strieda) — losuje sa, KTO z osôb A/B
// je biely (startMatch); testy si osobu na slote p1 vedia zafixovať cez env (A alebo B)
const FORCE_FIRST_STARTER = ["A", "B"].includes(process.env.FORCE_FIRST_STARTER) ? process.env.FORCE_FIRST_STARTER : null;

/* -------------------- Game constants -------------------- */
const BOARD = { w: 4, h: 3 };
const START_POS = { p1: { x: 0, y: 1 }, p2: { x: BOARD.w - 1, y: 1 } };
const START_HP = 10;
const START_MANA = 6; // vyšší štart = mind games od 1. kola (special hrozba vs golden shield counter)
const MAX_MANA = 10;

const BASIC_COST    = 1;
const BASIC_DMG_MAX = 4; // dmg klesá so vzdialenosťou: vedľa 3, ďalej 2, najďalej 1 (vlastné políčko basic nezasahuje)

const MELEE_COST = 4;
const MELEE_DMG  = 8;  // úder zblízka — zasiahne len súpera na rovnakom políčku
const MEDUSA_MELEE_DMG = 4; // Medúzin melee má širší dosah (vlastné políčko + diagonály) za nižší dmg
const MELEE_REPEAT = 3; // švih v rovnakej kadencii ako special (beaty po SPECIAL_BEAT_MS)

const SPECIAL_COST = 5;
const SOLDIER_SPECIAL_DMG = 10; // Vojakov snajperský lúč na zvolenú bunku — trafí, len ak tam súper PRÍDE (cieľ nesmie byť jeho aktuálna bunka)
// Vlkolak (werewolf): charge special — dmg podľa fázy mesiaca (index = moon level 0–3: nov/kosáčik/polmesiac/spln)
const WOLF_MOON_DMG = [2, 4, 6, 8];
// vlkolakov special má 8 smerov (aj diagonály) — kľúče nesie akcia v `dir`
const WOLF_DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], up_left: [-1, -1], up_right: [1, -1], down_left: [-1, 1], down_right: [1, 1] };
const WOLF_DIR_KEYS = Object.keys(WOLF_DIRS);
// fáza mesiaca podľa AKTUÁLNYCH HP (prepočítava sa na konci kola + pri nasadení/swape):
// 10 → 0 (nov), 9–7 → 1 (kosáčik), 6–4 → 2 (polmesiac), 3–1 → 3 (spln)
function moonLevelFor(hp) {
  if (hp >= 10) return 0;
  if (hp >= 7) return 1;
  if (hp >= 4) return 2;
  return 3;
}
const STONE_ACTIONS = 2; // Medúzin special: zasiahnutý súper preskočí najbližšie 2 základné akcie (kameň)
// Minotaurov special (labyrint) nemá číselnú konštantu — trvá, kým jeden hráč nezasiahne druhého (viď endLabyrinths)
const CLONE_DMG = 1; // Narutov klon: koľko pohltí na zdieľanej bunke (jednorazový bait), kým zvyšok strely prejde na Naruta. Útok aj odraz mirrorom dávajú PLNÝ dmg ako Naruto (viď doBasic/doMelee/applyHitOnClone)
const RECHARGE_GAIN = 4;
const SHIELD_COST = 2; // zablokuje celý dmg najbližšej súperovej akcie
const MIRROR_COST = 4; // odrazí celý dmg najbližšej súperovej akcie späť do útočníka
const GOLDEN_COST = 3; // extra akcia hráča, ktorý je v kole druhý — štít vyhodnotený pred prvou akciou startera
const GOLDEN_MIRROR_COST = 5; // ten istý predťah, ale mirror (odraz) namiesto štítu — zlaté vizuály
const DASH_COST   = 4; // presun až o 2 políčka jedným smerom
const GOLDEN_MANA_GAIN = 6; // golden mana refill: +6 many za HP; cena v HP rastie s každým použitím (1, 2, 3…)

// Démon útok — dostupný LEN buffnutému hráčovi v poslednom (Last Stand) kole; zaberá jeden z 3 akčných slotov
const DEMON_COST = 10; // celá mana
const DEMON_DMG  = 10; // zasiahne každé políčko OKREM toho, na ktorom kaster stojí (vyhodnotí sa cez shield/mirror)

const ACTION_TYPES = new Set(["move", "recharge", "attack", "melee", "special", "shield", "mirror", "dash"]);
const MOVE_DIRS = new Set(["up", "down", "left", "right"]);

/* -------------------- Match / lobby config -------------------- */
// koľko vyhratých hier treba na zisk série
// tournament = ako bo5 (first-to-3), ale s prenosom HP magov medzi hrami (3 magovia/hráč)
const MATCH_FORMATS = { single: 1, bo3: 2, tournament: 3 };
const CHARS = ["fire", "lightning", "wanderer", "medusa", "minotaur", "naruto", "escanor", "soldier", "werewolf"];
// tournament: každý hráč si pred hrou 1 naslepo draftne vlastný tím TEAM_SIZE postáv z celého poolu CHARS
// (choose_team vo fáze team_select); tím je fixný na celú sériu a určuje kľúče mageHp/mageMana danej osoby.
const TEAM_SIZE = 3;
// časový limit na ťah — vyhodnocuje a auto-lockuje klient (server lock validuje ako bežný)
const TIMER_OPTIONS = new Set(["off", "10", "30", "60", "quickdraw"]);

// predvolené nastavenia (predvyplnia lobby na klientovi)
const DEFAULT_CONFIG = {
  format: "single",                              // "single" | "bo3" | "tournament"
  tilesPerRound: 1,                              // 1 | 2 | 3 — koľko tiles sa spawne na konci kola
  tileWeights: { dmg: 75, heal: 12, mana: 8, ik: 5 }, // % šanca typu, spolu 100
  timer: "30",                                   // "off" | "10" | "30" | "60" | "quickdraw"
};

// celkové spomalenie animácií kola (1 = pôvodné tempo); MUSÍ sedieť s client.js ANIM_SLOW
const ANIM_SLOW = 1.8;
const MOVE_DELAY_MS    = Math.round(800 * ANIM_SLOW); // posun postavy + malý buffer
const SMALL_DELAY_MS   = Math.round(600 * ANIM_SLOW);
const ACTION_GAP_MS    = Math.round(350 * ANIM_SLOW); // pokojová pauza medzi jednotlivými akciami, nech sa dá sledovať každý ťah
const SPECIAL_REPEAT   = 3;
const SPECIAL_BEAT_MS  = Math.round(900 * ANIM_SLOW);
// Vojak: special = jeden silný snajperský výstrel — cast frame drží MIERENIE (veľký sprite zamrznutý
// v mieriacej póze, laser sight sa ustáli na cieli) a výšľah (framy 1–3 Shot_2) sa prehrá RAZ na jeho
// konci; až potom letí lúč. MUSÍ sedieť s klientskou choreografiou (SOLDIER_AIM_MS/FIRE v client.js).
const SOLDIER_AIM_MS   = 2600;
// po výstrele letí zo zbrane tenký červený lúč na zvolenú bunku + výbuch;
// jeden frame drží let lúča aj nábeh výbuchu, zásah (hit/block/mirror) padne až po ňom.
// MUSÍ sedieť s klientskou choreografiou spawnSoldierBeam v client.js.
const SOLDIER_BEAM_MS  = 900;
// Escanor special: server podrží zásah o dĺžku klientskej choreografie (WinSun→CruelSunHold→slnko→SunBurst),
// aby dmg dopadol AŽ po dokončení animácie. MUSÍ sedieť s klientskou choreografiou v client.js (runEscanorSpecial).
const ESC_SPECIAL_MS   = 4625;
// Vlkolak special: rozbehový cast (veľký Run+Attack v strede) → beh po doske → Attack_2 seknutie na bunke
// terča → až potom dopadne dmg. Časy musia sedieť s klientskou obsluhou wolf_charge/wolf_strike v client.js
// (seknutie = 4 framy @ 5 fps = 800 ms, hrá raz od frame 0; dmg dopadne tesne po dokončení švihu).
const WOLF_CAST_MS     = Math.round(1200 * ANIM_SLOW);
const WOLF_STRIKE_MS   = Math.round(500 * ANIM_SLOW);
const CHARGE_STEP_MS   = Math.round(240 * ANIM_SLOW); // krok strely za bunku — rýchla strela, aby ani 3-bunkový let nebol pomalší než iné akcie
const MIRROR_BEAM_MS   = 460; // kým beam mirroru doletí k útočníkovi (CSS .mirror-beam ≈ .16+.42s); nezávisí od ANIM_SLOW
// Teleport (výmena maga v turnaji) — dvojfázová animácia: (1) starý mág zmizne, (2) nový sa objaví
const TELEPORT_OUT_MS  = Math.round(650 * ANIM_SLOW);
const TELEPORT_IN_MS   = Math.round(650 * ANIM_SLOW);
// Labyrint: odhalenie PRED zásahom, ktorý ho určite ukončí — skrytý súper sa zjaví (fade ako démon/teleport)
const LAB_REVEAL_MS    = Math.round(700 * ANIM_SLOW);
// Naruto: summon klona — po pečatiach (special beaty) hrá Naruto + 2 kópie po bokoch Special_2 animáciu
const CLONE_SUMMON_MS  = Math.round(1300 * ANIM_SLOW);

// Last Stand (duálne tlačidlo s golden mana) — démon zabije hráča a oživí ho na plno; ďalšie kolo je posledné
// Last Stand sa prehráva FRAME-DRIVEN: každá fáza je samostatný frame (timeline prehrávač = jediný zdroj času),
// HP/mana sú v snapshotoch (server-autoritatívne, žiadny lokálny tween), vizuál viaže klient na efekt s trvaním = delayMs.
const LS_APPEAR_MS  = 1000; // démon sa vynorí v strede
const LS_DRAIN_MS   = 1400; // odčerpanie HP/many na 0 (rozdelené na kroky)
const LS_KILL_MS    = 700;  // smrť + démon zmizne zo stredu
const LS_REVIVE_MS  = 700;  // démon sa objaví za postavou (0→1)
const LS_RISE_MS    = 1600; // zlaté dvíhanie HP/many na 10
const LS_SETTLE_MS  = 900;  // démon → 0.25, hráč vstane
const LS_B_LEAVE_MS  = 1500; // banish: duch zosilnie a odíde z postavy
const LS_B_CENTER_MS = 1000; // banish: duch sa objaví v strede
const LS_B_DRAIN_MS  = 1400; // banish: odčerpanie HP/many na 0
const LS_B_KILL_MS   = 700;  // banish: smrť + duch zmizne

// Last Hope — úvodná akcia NEbuffnutého hráča vo final kole (vyhodnotí sa PRED golden shield/mirror).
// Červená „hope" postava: HP padne na 1, mana sa naplní na 10, hráč ide do ultra módu = 4× dmg do konca kola.
const LH_APPEAR_MS = 1000; // hope postava sa vynorí v strede
const LH_DRAIN_MS  = 1400; // HP→1, mana→10
const LH_SETTLE_MS = 900;  // postava zmizne, červený ultra mód zostáva

/* -------------------- Game state -------------------- */
// identita hráča je „osoba" A/B (A = prvý pripojený = host); slot p1/p2 je len ľavá/pravá rola,
// ktorá sa medzi hrami série prehadzuje (štartér danej hry vždy sedí v p1 = vľavo)
let personSockets = { A: null, B: null };
// trvalá identita hráča: token z klientovho localStorage → po reconnecte mu vrátime jeho slot
// (rieši „spadol mu socket, vrátil sa ako divák a server prestal brať jeho lock_in")
let personIds = { A: null, B: null };       // token klienta priradený osobe A/B
let personFreedAt = { A: 0, B: 0 };         // kedy sa slot uvoľnil (grace, počas ktorej ho cudzí klient neobsadí)
const RECLAIM_GRACE_MS = 60 * 1000;         // koľko sekúnd drží slot pre pôvodného hráča po výpadku
let game = null;

function newPlayer(slot) {
  const pos = START_POS[slot];
  return {
    slot,
    x: pos.x, y: pos.y,
    hp: START_HP,
    mana: START_MANA,
    char: null,        // "fire" | "lightning" | "wanderer" | "medusa" | "minotaur" | "naruto" | "escanor" | "soldier" | "werewolf"
    stone: 0,          // koľko najbližších základných akcií hráč preskočí skamenený (Medúzin special)
    // Escanor: „pride level" 0–3. Rozsah smerového specialu rastie s levelom (0=1 bunka, 3=celá plocha).
    // Na konci kola: použil shield/mirror (aj golden)? → −1, inak → +1 (clamp 0–3). Reset na 0 pri nasadení.
    pride: 0,
    // Vlkolak: „fáza mesiaca" 0–3 (nov → spln) = dmg jeho charge specialu (WOLF_MOON_DMG). Odvodená z HP
    // (moonLevelFor) — prepočíta sa na KONCI každého kola a pri nasadení/swape. Verejná (veľkosť postavy je tell).
    moon: 0,
    // Narutov tieňový klon: { x, y } alebo null. Kopíruje všetky základné akcie majiteľa (vertikálny pohyb
    // inverzne), spôsobuje vždy len CLONE_DMG, zmizne pri akomkoľvek zásahu (obrany zdieľa s majiteľom —
    // armujú sa aj spotrebúvajú spolu, sú to tie isté shield/mirror flagy)
    clone: null,
    labyrinth: false,  // blúdi v labyrinte (Minotaurov special) — nevidí board, kým nepadne vzájomný zásah
    mazeBuff: false,   // hráč ÚSPEŠNE zaklial súpera do labyrintu (len priamym castom, nie cez odraz) → 2× výstupný
                       // dmg, kým labyrint trvá. Cielené na toho, kto hrá Minotaura. (tile dmg/IK dostáva normálne)
    labReveal: false,  // labyrint sa v tomto ťahu isto skončí zásahom — redakcia/hmla padli už PRED animáciou akcie
    thread: [],        // Ariadnina niť: [x,y] políčka, na ktoré prekliaty vstúpil (prvé = kde stál pri zakliatí)
    threadMark: null,  // [x,y] posledného súperovho vstupu na niť — prekliaty tam vidí jeho obrys
    shield: false,     // zruší celý dmg najbližšej súperovej akcie
    shieldGold: false, // aktívny shield pochádza z golden shieldu (zlaté vizuály)
    mirror: false,     // odrazí celý dmg najbližšej súperovej akcie späť do útočníka
    mirrorGold: false, // aktívny mirror pochádza z golden mirroru (zlaté vizuály)
    golden: false,     // objednaný golden shield (extra akcia pred začiatkom kola)
    goldenMirror: false, // objednaný golden mirror (rovnaký predťah, ale odraz namiesto štítu)
    goldenMana: false, // objednaný golden mana refill (extra akcia po konci kola)
    manaRefills: 0,    // koľkokrát už hráč refill použil — určuje rastúcu HP cenu
    lastStand: false,     // objednaný last stand (trailing gold akcia, výlučná s golden_mana)
    lastStandBuff: false, // aktívne v poslednom (buffnutom) kole: 2× výstupný dmg, floor(½) prijatý dmg
    lastStandDoom: false, // v tomto poslednom kole musí vyhrať, inak na jeho konci zomrie
    down: false,          // leží „mŕtvy" počas Last Stand choreografie (smrť→oživenie) — klient kreslí dead pózu
    lastHope: false,      // objednaný Last Hope (úvodná akcia nebuffnutého hráča vo final kole)
    lastHopeBuff: false,  // aktívny Last Hope ultra mód v poslednom kole: 4× výstupný dmg, floor(½) prijatý dmg
    locked: false,
    queue: [],
    // priebežne posielaná rozpracovaná voľba — pri vypršaní času ju backstop zachová a doplní len chýbajúce
    draft: { queue: [], golden: false, goldenMirror: false, goldenMana: false, lastStand: false, lastHope: false }
  };
}

function newGame() {
  game = {
    phase: "lobby",   // "lobby" | "team_select" | "playing" | "match_over"
    config: null,     // nastaví host cez configure_match
    board: { ...BOARD },
    players: {
      p1: newPlayer("p1"),
      p2: newPlayer("p2")
    },
    arena: "bridge",
    turn: 1,
    starter: "p1", // slot, ktorý začína aktuálne kolo; hru 1 otvára p1 (biely), v sérii sa štartér hier strieda, medzi kolami sa preklápa
    tiles: [],     // { x, y, type: "dmg" | "heal" | "mana" } — pribúdajú od konca 1. kola
    iks: [],       // [{ x, y }] — insta-kill tiles; viac súčasne, každé kolo menia pozíciu, navzájom sa neprekrývajú
    // séria zápasov
    seats: { p1: "A", p2: "B" }, // kto sedí na ktorom slote — LOSUJE sa v startMatch (p1 = biely, začína); fixné na celú sériu
    seriesWins: { A: 0, B: 0 },
    series: { gameIndex: 1, needed: 1, format: "single" },
    // tournament: draftnutý tím TEAM_SIZE postáv per osoba (fáza team_select; null mimo tournamentu,
    // pole null kým daná osoba nepotvrdí) — kľúče mageHp/mageMana a poradie HUD hláv
    roster: null,     // { A: [char×3] | null, B: [char×3] | null }
    // tournament: HP a mana každého z 3 magov per osoba sa prenášajú medzi hrami (null mimo tournamentu)
    mageHp: null,
    mageMana: null,
  };
}
newGame();

function otherPerson(p) { return p === "A" ? "B" : "A"; }
function slotForPerson(person) { return game.seats.p1 === person ? "p1" : "p2"; }
function socketForSlot(slot) { return personSockets[game.seats[slot]]; }
// draftnutý tím osoby sediacej na slote (prázdny mimo turnaja / pred potvrdením)
function rosterFor(slot) { return game.roster?.[game.seats[slot]] || []; }

// séria zhrnutá pre klienta — výhry namapované na aktuálne sloty (osoba si nesie skóre na svoju stranu)
function seriesSnapshot() {
  return {
    gameIndex: game.series.gameIndex,
    needed: game.series.needed,
    format: game.series.format,
    winsP1: game.seriesWins[game.seats.p1] || 0,
    winsP2: game.seriesWins[game.seats.p2] || 0,
  };
}

// pošli každej osobe jej slot (vylosovaný v startMatch, fixný na celú sériu) + či je host (host = osoba A)
function emitYouAre() {
  for (const person of ["A", "B"]) {
    const sock = personSockets[person];
    if (sock) sock.emit("you_are", { slot: slotForPerson(person), isHost: person === "A" });
  }
}

// snapshot pre konkrétnu OSOBU — počas výberu postáv skry súperovu voľbu, kým si TÁTO osoba nevyberie
// (inak rozmýšľajúci hráč vidí súperov pick a má výhodu). Po výbere oboch je stav už odhalený.
// Labyrint (Minotaurov special): prekliata osoba nedostane súperovu pozíciu/obrany ani tiles ANI V DÁTACH
// (anti-cheat — klientská hmla by sa dala obísť cez devtools).
function snapshotFor(person) {
  let base = snapshot();
  // tournament: pridaj LEN vlastnú trojicu HP a many magov (súperove hodnoty hráč nevidí)
  base.mageHp = game.mageHp ? { ...game.mageHp[person] } : null;
  base.mageMana = game.mageMana ? { ...game.mageMana[person] } : null;
  const mySlot = slotForPerson(person);
  const oppSlot = mySlot === "p1" ? "p2" : "p1";
  // slepý draft: súperov tím vidím, až keď potvrdia obaja (fáza sa vtedy prepne na playing);
  // rosterReady ostáva verejné — klient z neho ukazuje „opponent is picking / ready"
  if (game.phase === "team_select" && base.roster) {
    base = { ...base, roster: { ...base.roster, [oppSlot]: null } };
  }
  if (!game.players[mySlot]?.char && base[oppSlot]?.char) {
    base = { ...base, [oppSlot]: { ...base[oppSlot], char: null } };
  }
  if (base[mySlot]?.labyrinth && !base[mySlot].labReveal) base = redactRosterMana(oppSlot, redactSnapshotFor(mySlot, base));
  else if (base[oppSlot]?.labyrinth && !base[oppSlot].labReveal) base = redactRosterMana(oppSlot, { ...base, [oppSlot]: redactHunterActor(base[oppSlot]) });
  return base;
}

/* ---- Labyrint: redakcia dát pre OBE strany ---- */
// prekliaty nevidí súperovu pozíciu, obrany ani MANU (nemá prehľad, kedy Minotaur dosiahne na special/melee);
// niť/obrys súpera (mirror match dvoch Minotaurov) tiež skry. HP ostáva — zásah labyrint aj tak končí.
function redactActor(a) {
  if (!a) return a;
  // clone: prekliaty nesmie vidieť ani súperovho tieňového klona (pozícia = informácia o lovcovi)
  return { ...a, x: null, y: null, mana: null, shield: false, shieldGold: false, mirror: false, mirrorGold: false, thread: [], threadMark: null, clone: null };
}
// LOVEC (Minotaur) zas nevidí Ariadninu niť ani obrys (nemôže sa jej cielene vyhýbať — šliapne na ňu
// nevedomky) a nevidí ani manu prekliateho — počas labyrintu ani jeden nemá prehľad o mane súpera
function redactHunterActor(a) {
  if (!a) return a;
  return { ...a, mana: null, thread: [], threadMark: null };
}
// prekliaty vidí len Damage dlaždice + IK (IK/`iks` sa neredigujú vôbec); heal/mana dlaždice LEN keď na
// nich priamo stojí (inak by mu prezradili, kde sú pickupy). IK vždy (sú to overlaye v `iks`, mimo `tiles`).
function redactTilesFor(mySlot, snap) {
  if (!Array.isArray(snap.tiles)) return snap;
  const me = snap[mySlot];
  const onMyCell = (t) => me && me.x != null && t.x === me.x && t.y === me.y;
  return { ...snap, tiles: snap.tiles.filter(t => t.type === "dmg" || onMyCell(t)) };
}
// lovec (alebo jeho tieňový klon) PRÁVE stojí na bunke prekliateho — nech už naň vstúpil lovec ALEBO
// prekliaty vošiel na lovca. Prekliaty ho na svojej (vždy fakľami ožiarenej) bunke uvidí OŽIARENÉHO.
// Počíta sa čerstvo z každého snapshotu/framu, takže po odchode lovca hneď zhasne (žiadny „stale" obrys).
function hunterOnCursedCell(me, opp) {
  return !!(me && opp && me.x != null &&
    ((opp.x === me.x && opp.y === me.y) || (opp.clone && opp.clone.x === me.x && opp.clone.y === me.y)));
}
function redactSnapshotFor(mySlot, snap) {
  const oppSlot = mySlot === "p1" ? "p2" : "p1";
  const me = snap[mySlot], opp = snap[oppSlot];
  const hunterHere = hunterOnCursedCell(me, opp);
  return redactTilesFor(mySlot, { ...snap, [mySlot]: { ...me, hunterHere }, [oppSlot]: redactActor(opp) });
}
// tournament × labyrint: počas kliatby nevidí ANI JEDNA strana manu súperovho tímu — roster nesie
// uložené hodnoty magov (lavička + posledný uložený stav nasadeného), rediguje sa obojsmerne ako živá mana
function redactRosterMana(oppSlot, snap) {
  if (!snap.rosterMana) return snap;
  return { ...snap, rosterMana: { ...snap.rosterMana, [oppSlot]: null } };
}
// efekt vo frame, v ktorom je príjemca prekliaty: súperove akcie sa maskujú na "unknown" (beat kvôli
// pozícii v lište), všetko ostatné od/na súpera aj cudzie tile efekty sa zahodia — úplná tma
function redactEffect(mySlot, oppSlot, e, frame) {
  if (!e) return null;
  if (e.kind === "action" && e.from === oppSlot) {
    const t = e.action?.type;
    const beat = (t === "golden_shield" || t === "golden_mirror") ? "gpre"
               : (t === "golden_mana" || t === "last_stand") ? "gmana"
               : (t === "last_hope") ? "lhope" : "act";
    return { kind: "action", from: oppSlot, action: { type: "unknown", dir: null, to: null, beat } };
  }
  if (e.from === oppSlot && e.kind !== "beat_empty") return null; // charge/special/melee/recharge/gold/demon… prezrádzajú pozíciu alebo úmysel
  if (e.target === oppSlot) return null;                          // hit/heal/invalid na súperovi (napr. tile dmg) = pozícia
  if (e.kind === "tile_proc") {
    // tiles samotné prekliaty vidí, ale PROC blik cudzej bunky = súper na nej stojí → len vlastná bunka
    const p = frame[mySlot];
    if (!p || !Array.isArray(e.cell) || e.cell[0] !== p.x || e.cell[1] !== p.y) return null;
  }
  return e;
}
// timeline pre daný slot: framy, v ktorých je príjemca v labyrinte, dostanú redigovaný snapshot aj efekty;
// framy, v ktorých je v labyrinte SÚPER, skryjú príjemcovi (lovcovi) niť/obrys/manu + thread_mark efekty.
// Frame, v ktorom labyrint končí (labyrinth=false), už redigovaný nie je → odhalenie sa prehrá prirodzene.
// labReveal (istý zásah v tomto ťahu): redakcia padá už od reveal frame-u — akcia sa odohrá odhalená.
function redactTimelineFor(mySlot, tl) {
  const oppSlot = mySlot === "p1" ? "p2" : "p1";
  return tl.map(f => {
    if (f?.[mySlot]?.labyrinth && !f[mySlot].labReveal) {
      // hunterHere sa musí počítať aj pre každý FRAME timeline (nielen root snapshot) — inak keď prekliaty
      // POČAS kola vstúpi na lovcovu bunku, frame ho nenesie a klient ukáže čierny tieň namiesto ožiareného lovca
      const hunterHere = hunterOnCursedCell(f[mySlot], f[oppSlot]);
      return redactRosterMana(oppSlot, redactTilesFor(mySlot, {
        ...f,
        [mySlot]: { ...f[mySlot], hunterHere },
        [oppSlot]: redactActor(f[oppSlot]),
        effects: (f.effects || []).map(e => redactEffect(mySlot, oppSlot, e, f)).filter(Boolean),
      }));
    }
    if (f?.[oppSlot]?.labyrinth && !f[oppSlot].labReveal) {
      return redactRosterMana(oppSlot, {
        ...f,
        [oppSlot]: redactHunterActor(f[oppSlot]),
        effects: (f.effects || []).filter(e => !(e.kind === "thread_mark" && e.target === oppSlot)),
      });
    }
    return f;
  });
}

// pošli stav (voliteľne s timeline) obom osobám, každej s vlastným maskovaním (char-select pick,
// labyrint redakcia, vlastná trojica HP magov); divákom (ostatné sockety) neutrálny plný snapshot
function emitStateMasked(timeline = null) {
  const plain = snapshot();
  for (const [, sock] of io.sockets.sockets) {
    let payload;
    if (sock === personSockets.A || sock === personSockets.B) {
      const person = sock === personSockets.A ? "A" : "B";
      payload = snapshotFor(person);
      if (timeline) payload = { ...payload, timeline: redactTimelineFor(slotForPerson(person), timeline) };
    } else {
      payload = timeline ? { ...plain, timeline } : plain;
    }
    sock.emit("state", payload);
  }
}

/* -------------------- Helpers -------------------- */
function cloneActor(a) {
  if (!a) return null;
  const { slot, x, y, hp, mana, char, stone, pride, moon, labyrinth, labReveal, shield, shieldGold, mirror, mirrorGold, manaRefills, lastStandBuff, lastHopeBuff, down, locked } = a;
  // niť treba hlboko kopírovať — server do nej pushuje, plytká referencia by menila už uložené timeline framy
  const thread = (a.thread || []).map(c => [...c]);
  const threadMark = a.threadMark ? [...a.threadMark] : null;
  const clone = a.clone ? { ...a.clone } : null; // Narutov tieňový klon (pozícia)
  return { slot, x, y, hp, mana, char, stone, pride, moon, labyrinth, labReveal, thread, threadMark, clone, shield, shieldGold, mirror, mirrorGold, manaRefills, lastStandBuff, lastHopeBuff, down, locked };
}
function snapshot() {
  return {
    phase: game.phase,
    config: game.config ? { ...game.config, tileWeights: { ...game.config.tileWeights } } : null,
    series: seriesSnapshot(),
    board: { ...game.board },
    p1: cloneActor(game.players.p1),
    p2: cloneActor(game.players.p2),
    arena: game.arena,
    turn: game.turn,
    starter: game.starter,
    timerMs: timerRemainingMs(), // zostávajúci čas na ťah (null = bez limitu) — klient sa naň synchronizuje aj po refreshi
    // duálny gold button (golden mana + last stand) je v poslednom (buffnutom) kole zamknutý pre oboch
    goldLocked: !!(game.players.p1.lastStandBuff || game.players.p2.lastStandBuff),
    tiles: game.tiles.map(t => ({ ...t })),
    iks: game.iks.map(t => ({ ...t })),
    // tournament: draftnuté tímy per slot — po skončení draftu VEREJNÉ (HUD hlavy oboch strán, poradie
    // = poradie výberu); počas fázy team_select snapshotFor súperov tím maskuje (slepý draft).
    roster: game.roster ? {
      p1: game.roster[game.seats.p1] ? [...game.roster[game.seats.p1]] : null,
      p2: game.roster[game.seats.p2] ? [...game.roster[game.seats.p2]] : null,
    } : null,
    // kto už potvrdil tím (verejné aj počas draftu — „súper vyberá / je pripravený")
    rosterReady: game.roster ? {
      p1: !!game.roster[game.seats.p1], p2: !!game.roster[game.seats.p2],
    } : null,
    // tournament: mŕtvi magovia (HP 0) per slot — pre HUD hlavy (mŕtvy = lebka); historické info (= počet prehier),
    // nie tajná voľba, preto ide obom stranám aj v bežnom snapshote
    mageDead: game.mageHp ? {
      p1: rosterFor("p1").filter(k => (game.mageHp[game.seats.p1]?.[k] ?? 1) <= 0),
      p2: rosterFor("p2").filter(k => (game.mageHp[game.seats.p2]?.[k] ?? 1) <= 0),
    } : null,
    // tournament: prenesené HP a mana všetkých 3 magov per slot — VEREJNÉ (vidí ich aj súper) pre HUD hlavy.
    // Pozn.: pre práve nasadeného maga je tu uložená (nie živá) hodnota — klient pri ňom berie živé hp/mana z p1/p2.
    rosterHp: game.mageHp ? {
      p1: { ...game.mageHp[game.seats.p1] }, p2: { ...game.mageHp[game.seats.p2] }
    } : null,
    rosterMana: game.mageMana ? {
      p1: { ...game.mageMana[game.seats.p1] }, p2: { ...game.mageMana[game.seats.p2] }
    } : null
  };
}

function inBounds(x, y, board = game.board) {
  return x >= 0 && y >= 0 && x < board.w && y < board.h;
}

function pushStateFrame(timeline, effects = [], delayMs = SMALL_DELAY_MS) {
  const snap = snapshot();
  timeline.push({ ...snap, effects, delayMs });
}

function pushInvalid(tl, who, ms = SMALL_DELAY_MS, reason = null) {
  pushStateFrame(tl, [{ kind: "invalid", target: who, reason }], ms);
}

function other(slot) { return slot === "p1" ? "p2" : "p1"; }

function isDiagAdjacent(a, b) {
  return Math.abs(a.x - b.x) === 1 && Math.abs(a.y - b.y) === 1;
}
// Medúzin special: vlastné políčko + VŠETKY políčka striktne vo zvolenom smere (left/right)
// v jej riadku a v riadkoch bezprostredne susedných (±1) — zo stredného radu tak pokryje všetky 3 riadky.
// Musí sedieť s cellsForSpecialPreview v client.js (udržiavané paralelne).
function medusaCells(me, dir) {
  const sgn = dir === "left" ? -1 : 1;
  const cells = [[me.x, me.y]];
  for (let y = me.y - 1; y <= me.y + 1; y++) {
    if (y < 0 || y >= game.board.h) continue;
    for (let x = me.x + sgn; x >= 0 && x < game.board.w; x += sgn) cells.push([x, y]);
  }
  return cells;
}
function specialDamageAndHit(players, slot) {
  const me   = players[slot];
  const foeS = slot === "p1" ? "p2" : "p1";
  const foe  = players[foeS];
  if (!me || !foe) return { dmg:0, hit:null };

  switch (me.char) {
    case "fire":      // celá lajna (riadok)
      return me.y === foe.y ? { dmg:5, hit:foeS } : { dmg:0, hit:null };
    case "lightning": // všetky políčka opačnej "šachovej" farby než na ktorej stojí
      return ((me.x + me.y) % 2) !== ((foe.x + foe.y) % 2) ? { dmg:3, hit:foeS } : { dmg:0, hit:null };
    case "wanderer":  // len diagonála 1
      return isDiagAdjacent(me, foe) ? { dmg:8, hit:foeS } : { dmg:0, hit:null };
    default:
      return { dmg:0, hit:null };
  }
}
// je pozícia [x,y] v zóne specialu daného castera? (len dmg speciály — na test zásahu KLONA;
// musí sedieť so specialDamageAndHit aj s cellsForSpecialPreview v client.js)
function specialZoneHas(me, x, y) {
  switch (me.char) {
    case "fire":      return y === me.y;
    case "lightning": return ((me.x + me.y) % 2) !== ((x + y) % 2);
    case "wanderer":  return Math.abs(me.x - x) === 1 && Math.abs(me.y - y) === 1;
    default:          return false;
  }
}
// raw dmg zóny (kvôli odrazu pri zásahu klona); soldier = snajperský lúč na jednu zvolenú bunku
// (jeho „zónu" nesie akcia — cell — preto nemá vetvu v specialZoneHas, klona testuje vlastná vetva doSpecial)
const SPECIAL_ZONE_DMG = { fire: 5, lightning: 3, wanderer: 8, escanor: 8, soldier: SOLDIER_SPECIAL_DMG };

// Escanor: zóna smerového specialu podľa pride levelu. dir = "left" | "right" (ako Medúza).
// F = bunka pred Escanorom v danom smere; 0=F, 1=F+diagonály, 2=F+3×3 okolie, 3=celá plocha.
// MUSÍ sedieť s cellsForSpecialPreview v client.js (paralelne udržiavané).
function escanorCells(me, dir) {
  const W = game.board.w, H = game.board.h;
  const inb = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  const out = [];
  const add = (x, y) => { if (inb(x, y) && !out.some(c => c[0] === x && c[1] === y)) out.push([x, y]); };
  const pride = Math.max(0, Math.min(3, me.pride || 0));
  const fx = me.x + (dir === "left" ? -1 : 1), fy = me.y;
  // kotva F mimo dosky = slnko hodené DO AUTU — žiadna zóna, ANI pri pride 3 (celý hod letí von z plochy);
  // doSpecial z prázdnej zóny robí offboard whiff (mana preč, OUT OF BOUNDS, neprečiarkuje sa — ako útok do steny)
  if (fx < 0 || fx >= W) return out;
  if (pride >= 3) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) add(x, y); return out; }
  add(fx, fy);                                                        // pride 0
  if (pride === 1) { add(fx - 1, fy - 1); add(fx + 1, fy - 1); add(fx - 1, fy + 1); add(fx + 1, fy + 1); }
  if (pride === 2) for (let yy = fy - 1; yy <= fy + 1; yy++) for (let xx = fx - 1; xx <= fx + 1; xx++) add(xx, yy);
  return out;
}

/* ---- Narutov tieňový klon ---- */
// Klon nemá HP — zmizne pri akomkoľvek zásahu od súpera (dmg aj status speciály), pri IK tile,
// pri recaste specialu, smrti/swape majiteľa a na konci hry. Zásah NA klona labyrint NEODHALÍ
// ani NEUKONČÍ (súper sa nesmie dozvedieť, že trafil klona); zásah spôsobený klonom je bežný
// action hit (ide cez applyHit) a labyrint ukončí.
function killClone(slot, tl, ms = SMALL_DELAY_MS) {
  const p = game.players[slot];
  if (!p?.clone) return;
  const at = [p.clone.x, p.clone.y];
  // die frame ešte s klonom v snapshote (klient cezeň prehrá rozplynutie), až potom zmizne zo stavu
  pushStateFrame(tl, [{ kind: "clone_die", target: slot, cell: at }], ms);
  p.clone = null;
}
// zásah (dmg akcia) na klona cez obrany MAJITEĽA (zdieľané flagy): shield BLOKUJE, mirror ODRAZÍ — a to na
// OBOCH figúrach samostatne (z ich vlastných buniek). Zdieľaný štít sa pri zásahu na klonovi rozbije/blokne
// aj na klonovej bunke (nielen na Narutovi), mirror odrazí z klona PLNÝ prijatý dmg (ako Narutov mirror).
// (quietDefense param ostáva kvôli podpisu volaní, ale už sa nepoužíva — obrana sa ukáže na oboch.)
function applyHitOnClone(ownerSlot, rawDmg, tl, kind = "basic", quietDefense = false) {
  const o = game.players[ownerSlot];
  if (!o?.clone) return;
  if (o.shield) {
    // block aj na klonovej bunke — zdieľaný štít sa rozbije na oboch figúrach
    pushStateFrame(tl, [{ kind: "block", target: ownerSlot, cell: [o.clone.x, o.clone.y], gold: !!o.shieldGold }], SMALL_DELAY_MS);
    return; // štít pokryje aj klona (bez dmg), klon prežije
  }
  if (o.mirror) {
    const atkSlot = other(ownerSlot);
    const atk = game.players[atkSlot];
    const reflectRaw = rawDmg; // klonov mirror odrazí PLNÝ prijatý dmg (rovnako ako Narutov mirror), nie flat 1
    const d = recvDmg(atkSlot, reflectRaw);
    // samostatný odraz z KLONOVEJ bunky (cell) — nie z pravého Naruta (inak prezradí skutočného)
    pushStateFrame(tl, [{ kind: "mirror", target: ownerSlot, cell: [o.clone.x, o.clone.y], dmg: reflectRaw, atk: kind, gold: !!o.mirrorGold }], MIRROR_BEAM_MS);
    atk.hp = Math.max(0, atk.hp - d);
    pushStateFrame(tl, [{ kind: "hit", target: atkSlot, dmg: d }], SMALL_DELAY_MS);
    endLabyrinths(tl); // odrazený dmg dopadol na REÁLNEHO hráča — to labyrint ukončuje
    return; // mirror ochránil klona (prežije)
  }
  killClone(ownerSlot, tl);
}
// status special (petrify/labyrint) na klona cez obrany majiteľa — analógia applyHitOnClone:
// shield blokuje, mirror odrazí STATUS na castera (ako applyPetrify/applyLabyrinth). Bez obrany:
// PETRIFY klona ZABIJE (zásah kliatby ho rozplynie ako každý iný zásah), LABYRINT nie — kliatba bludiska
// sa týka len skutočného Naruta (prekliaty si klona nesie do labyrintu so sebou).
function applyStatusOnClone(ownerSlot, tl, statusKind, quietDefense = false) {
  const o = game.players[ownerSlot];
  if (!o?.clone) return;
  if (o.shield) {
    if (!quietDefense) pushStateFrame(tl, [{ kind: "block", target: ownerSlot, cell: [o.clone.x, o.clone.y], gold: !!o.shieldGold }], SMALL_DELAY_MS);
    return;
  }
  if (o.mirror) {
    if (quietDefense) return;
    const atkSlot = other(ownerSlot);
    pushStateFrame(tl, [{ kind: "mirror", target: ownerSlot, dmg: 0, atk: "special", gold: !!o.mirrorGold }], MIRROR_BEAM_MS);
    if (statusKind === "petrify") { petrify(atkSlot, tl); endLabyrinths(tl); }
    else { endLabyrinths(tl); loseInLabyrinth(atkSlot, tl); }
    return;
  }
  // bez obrany: petrify klona rozplynie; labyrint klona nechá žiť (kliatba len na skutočného Naruta)
  if (statusKind === "petrify") killClone(ownerSlot, tl);
}
// klon kopíruje pohyb majiteľa: horizontálne rovnako, VERTIKÁLNE INVERZNE (up<->down); kroky mimo boardu prepadnú
function moveCloneSteps(slot, delta, maxSteps) {
  const p = game.players[slot];
  if (!p?.clone) return [];
  const d = [delta[0], -delta[1]];
  const path = [];
  for (let s = 0; s < maxSteps; s++) {
    if (inBounds(p.clone.x + d[0], p.clone.y + d[1])) {
      p.clone.x += d[0]; p.clone.y += d[1];
      path.push([p.clone.x, p.clone.y]);
    }
  }
  return trackCloneSteps(slot, path);
}
// klon lovca sa ráta do pretínania Ariadninej nite — vstup klona na niť prekliateho nastaví threadMark
// (prekliaty tam uvidí siluetu — nevie, že patrí klonovi; ideálny bait)
function trackCloneSteps(slot, cells) {
  const fx = [];
  const foeS = other(slot);
  const foe = game.players[foeS];
  if (foe?.labyrinth) {
    let mark = null;
    for (const [x, y] of cells) {
      if (foe.thread.some(([tx, ty]) => tx === x && ty === y)) mark = [x, y];
    }
    if (mark) {
      foe.threadMark = mark;
      fx.push({ kind: "thread_mark", cell: mark, target: foeS });
    }
  }
  return fx;
}

// 3 akcie, každý typ max 1× za kolo, len známe typy a smery (move, attack aj dash nesú dir)
// voliteľný úvod last_hope (len nebuffnutý hráč vo final kole) → potom golden_shield/golden_mirror (nestartér) → 3 akcie → sufix golden_mana
function validQueue(queue, slot) {
  if (!Array.isArray(queue)) return false;
  let q = queue;
  // úplne prvý môže byť last_hope — len pre nebuffnutého hráča v poslednom (final) kole
  if (q[0] && q[0].type === "last_hope") {
    const finalRound = !!(game.players.p1.lastStandBuff || game.players.p2.lastStandBuff);
    if (!finalRound || game.players[slot]?.lastStandBuff) return false;
    q = q.slice(1);
  }
  let goldenPre = null;
  if (q[0] && (q[0].type === "golden_shield" || q[0].type === "golden_mirror")) {
    if (slot === game.starter) return false;
    goldenPre = q[0].type;
    q = q.slice(1);
  }
  const trailing = q.length && q[q.length - 1] && q[q.length - 1].type;
  if (trailing === "golden_mana" || trailing === "last_stand") {
    // duálny gold button je v poslednom (buffnutom) kole zamknutý pre oboch hráčov
    if (game.players.p1.lastStandBuff || game.players.p2.lastStandBuff) return false;
    q = q.slice(0, -1);
  }
  if (q.length !== 3) return false;
  const types = q.map(a => a && a.type);
  // skamenený hráč: presne prvých `stone` akcií musí byť pass ("stoned"), inde sa vyskytovať nesmie
  const stone = Math.min(3, game.players[slot]?.stone || 0);
  for (let i = 0; i < q.length; i++) {
    if ((i < stone) !== (types[i] === "stoned")) return false;
  }
  // démon útok je platný typ len pre buffnutého hráča (posledné kolo) a je bez smeru
  const canDemon = !!game.players[slot]?.lastStandBuff;
  // swap (výmena maga) je platný typ len v turnaji; smie byť vo fronte až 2× (výnimka z „každý typ raz za kolo")
  const isTournament = !!game.mageHp && game.config?.format === "tournament";
  if (types.some(t => !ACTION_TYPES.has(t)
        && t !== "stoned"
        && !(t === "demon" && canDemon)
        && !(t === "swap" && isTournament))) return false;
  // každý NE-swap typ najviac 1×; swapov najviac 2 (ciele sa overia nižšie); stoned passov môže byť viac
  const nonSwap = types.filter(t => t !== "swap" && t !== "stoned");
  if (new Set(nonSwap).size !== nonSwap.length) return false;
  const swaps = q.filter(a => a.type === "swap");
  if (swaps.length > 2) return false;
  if (swaps.length) {
    if (!isTournament) return false;
    // počas aktívneho labyrintu (ktorejkoľvek strany) je výmena maga zakázaná — hlavy sú skryté,
    // swap sa odmieta už pri plánovaní (aj keby kliatba skončila zásahom uprostred kola)
    if (game.players.p1.labyrinth || game.players.p2.labyrinth) return false;
    // hráč s Last Stand paktom nesmie vo final kole swapnúť — inak by si zabankoval démonov
    // full-heal do rosteru (10/10 uložených pri swape) a doom by zabil náhradníka namiesto neho
    if (game.players[slot]?.lastStandBuff) return false;
    const person = game.seats[slot];
    const startChar = game.players[slot]?.char; // aktuálny mág na začiatku kola
    const seen = new Set();
    for (const a of swaps) {
      if (!rosterFor(slot).includes(a.to)) return false;           // mág mimo draftnutého tímu
      if (a.to === startChar) return false;                        // návrat na východiskového maga nie je dovolený
      if ((game.mageHp[person]?.[a.to] ?? 0) <= 0) return false;   // mŕtveho maga nemožno nasadiť
      if (seen.has(a.to)) return false;                            // každý cieľ najviac raz
      seen.add(a.to);
    }
  }
  // golden shield/mirror sa vzájomne vylučuje s príslušnou bežnou akciou — nemôžeš ju zahrať 2× za kolo
  if (goldenPre === "golden_shield" && types.includes("shield")) return false;
  if (goldenPre === "golden_mirror" && types.includes("mirror")) return false;
  if (!q.every(a => (a.type !== "move" && a.type !== "attack" && a.type !== "dash") || MOVE_DIRS.has(a.dir))) return false;
  // Vojak: special nesie cieľovú bunku {x,y}. Cieľ nesmie byť súperova AKTUÁLNA bunka (ani jeho tieňový
  // klon — obe figúry sú „súper", blokovanie len pravej by prezradilo, ktorá je skutočná) — zásah má
  // padnúť len keď sa súper POHNE. Vlastná bunka sa blokuje podľa GHOST pozície v čase specialu (po
  // naplánovaných move/dash — zrkadlí klientský picker/simulatedPositions; dash sa simuluje ako keby
  // mana vyšla, rovnako ako ghost). Výnimka labyrint: prekliaty vojak strieľa naslepo — súperova bunka
  // sa nekontroluje (blokovanie by mu ju prezradilo), takže stojaceho lovca trafiť SMIE (maze buff vojaka).
  {
    const meP = game.players[slot];
    const foe = game.players[other(slot)];
    let simChar = meP?.char, sx = meP?.x, sy = meP?.y;
    for (const a of q) {
      if (a.type === "swap" && a.to) simChar = a.to; // v turnaji môže special hádzať až swapnutý mág
      const d = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[a.dir];
      if (a.type === "move" && d && inBounds(sx + d[0], sy + d[1])) { sx += d[0]; sy += d[1]; }
      if (a.type === "dash" && d) for (let s = 0; s < 2; s++) if (inBounds(sx + d[0], sy + d[1])) { sx += d[0]; sy += d[1]; }
      // Vlkolakov charge hýbe kasterom — simuluj presun (stop na prvej VIDITEĽNEJ figúre súpera alebo na
      // okraji; v labyrinte je súper skrytý → beh na okraj, zrkadlí klientský ghost). Ovplyvňuje ghost
      // pozíciu neskoršieho Vojakovho specialu po turnajovom swape.
      if (a.type === "special" && simChar === "werewolf") {
        const wd = WOLF_DIRS[a.dir];
        if (wd) {
          while (inBounds(sx + wd[0], sy + wd[1])) {
            sx += wd[0]; sy += wd[1];
            if (!meP?.labyrinth && foe && ((foe.x === sx && foe.y === sy) || (foe.clone && foe.clone.x === sx && foe.clone.y === sy))) break;
          }
        }
      }
      if (a.type === "special" && simChar === "soldier") {
        const c = a.cell;
        if (!c || !Number.isInteger(c.x) || !Number.isInteger(c.y) || !inBounds(c.x, c.y)) return false;
        if (c.x === sx && c.y === sy) return false; // vlastná (ghost) bunka
        if (!meP?.labyrinth && foe) {
          if (foe.x === c.x && foe.y === c.y) return false;
          if (foe.clone && foe.clone.x === c.x && foe.clone.y === c.y) return false;
        }
      }
    }
  }
  return true;
}

function winnerNow() {
  const p1dead = game.players.p1.hp <= 0;
  const p2dead = game.players.p2.hp <= 0;
  if (p1dead && p2dead) return "draw";
  if (p1dead) return "p2";
  if (p2dead) return "p1";
  return null;
}

/* ---- Admin helpers ---- */
function okAdmin(keyFromClient) {
  return !ADMIN_KEY || ADMIN_KEY === keyFromClient;
}
function forceResetAll() {
  clearTurnTimer();
  try { if (personSockets.A) personSockets.A.disconnect(true); } catch {}
  try { if (personSockets.B) personSockets.B.disconnect(true); } catch {}
  personSockets.A = null;
  personSockets.B = null;
  personIds.A = null;
  personIds.B = null;
  personFreedAt.A = 0;
  personFreedAt.B = 0;
  newGame();
  io.emit("reset");
  io.emit("state", snapshot());
}

/* -------------------- Actions -------------------- */
// koľko políčok dokáže klon prejsť daným smerom (vertikálne inverzne) — bez mutácie stavu
function cloneMovableSteps(a, delta, maxSteps) {
  if (!a?.clone) return 0;
  const d = [delta[0], -delta[1]];
  let cx = a.clone.x, cy = a.clone.y, n = 0;
  for (let s = 0; s < maxSteps; s++) {
    if (inBounds(cx + d[0], cy + d[1])) { cx += d[0]; cy += d[1]; n++; } else break;
  }
  return n;
}

// smer klona (vertikálne inverzný) — pre náraz do steny na klonovej strane
const CLONE_DIR = { up:"down", down:"up", left:"left", right:"right" };

function doMove(slot, dir, tl) {
  const a = game.players[slot];
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir] || [0,0];
  const nx = a.x + delta[0], ny = a.y + delta[1];
  const ownCan = inBounds(nx, ny);
  // klon (Naruto) sa hýbe vertikálne inverzne s vlastným clampom
  const hasClone = !!a.clone;
  const cloneCan = hasClone && cloneMovableSteps(a, delta, 1) > 0;
  // NOVÉ PRAVIDLO: pohyb do steny sa už neprečiarkne — akcia sa „vykoná" ako náraz do steny
  // (žiadny pohyb, ale slot je spotrebovaný). Ak sa aspoň jedna figúra pohne, druhá narazí (OUT OF BOUNDS).
  const fx = [];
  if (ownCan) {
    a.x = nx; a.y = ny;
    fx.push(...trackSteps(slot, [[nx, ny]])); // labyrint: niť / obrys na nití
  } else {
    fx.push({ kind: "wall_bump", from: slot, dir }); // Naruto narazí do steny (klon beží)
  }
  if (hasClone) {
    if (cloneCan) fx.push(...moveCloneSteps(slot, delta, 1)); // klon sa hýbe (vertikálne inverzne)
    else fx.push({ kind: "wall_bump", from: slot, dir: CLONE_DIR[dir], clone: true }); // klon narazí do steny (Naruto beží)
  }
  pushStateFrame(tl, fx, MOVE_DELAY_MS);
}

function doDash(slot, dir, tl) {
  const a = game.players[slot];
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
  if (!delta) { pushInvalid(tl, slot); return; }
  if (a.mana < DASH_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }

  // posun až o 2 políčka zvoleným smerom; na okraji sa skráti na 1 (bez možného pohybu = náraz do steny nižšie)
  let nx = a.x, ny = a.y, steps = 0;
  const path = []; // aj medzibunka — labyrintná niť/obrys sa počíta na každom prejdenom políčku
  for (let s = 0; s < 2; s++) {
    if (inBounds(nx + delta[0], ny + delta[1])) { nx += delta[0]; ny += delta[1]; steps++; path.push([nx, ny]); }
  }
  // klon dashuje vertikálne inverzne s vlastným clampom — dash prebehne aj keď Naruto naráža do steny
  const hasClone = !!a.clone;
  const cloneSteps = hasClone ? cloneMovableSteps(a, delta, 2) : 0;

  // NOVÉ PRAVIDLO: dash do steny sa už neprečiarkne — máš naň manu (overené vyššie), tak sa minie
  // a akcia sa „vykoná" ako náraz do steny (žiadny pohyb). Pasívne skreč many cez dash do steny padá.
  a.mana -= DASH_COST;
  const fx = [];
  if (steps) {
    a.x = nx; a.y = ny;
    fx.push(...trackSteps(slot, path));
  } else {
    fx.push({ kind: "wall_bump", from: slot, dir }); // Naruto narazí do steny (klon dashuje)
  }
  if (hasClone) {
    if (cloneSteps) fx.push(...moveCloneSteps(slot, delta, 2)); // klon kopíruje dash (vertikálne inverzne)
    else fx.push({ kind: "wall_bump", from: slot, dir: CLONE_DIR[dir], clone: true }); // klon narazí do steny (Naruto dashuje)
  }
  pushStateFrame(tl, fx, MOVE_DELAY_MS);
}

function doRecharge(slot, tl) {
  const a = game.players[slot];

  // Na maxime many -> neplatné, žiadna modrá animácia/bublina
  if (a.mana >= MAX_MANA) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana_full"); return; }

  const before = a.mana;
  a.mana = Math.min(MAX_MANA, a.mana + RECHARGE_GAIN);
  const gained = a.mana - before; // menej ak capne na MAX_MANA
  if (gained > 0) {
    // klon hrá nabíjanie naprázdno (manu zdieľa s majiteľom) — jeho bunka ide v efekte, nech aura
    // svieti na oboch a recharge neprezradí, ktorý je pravý
    const cells = a.clone ? [[a.x, a.y], [a.clone.x, a.clone.y]] : [[a.x, a.y]];
    pushStateFrame(
      tl,
      [{ kind: "recharge", from: slot, cells, amount: gained }],
      SMALL_DELAY_MS
    );
  } else {
    pushInvalid(tl, slot);
  }
}

function doBasic(slot, dir, tl) {
  const me  = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];

  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
  if (!delta) { pushInvalid(tl, slot); return; }
  if (me.mana < BASIC_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  // NOVÉ PRAVIDLO: útok do steny sa už neprečiarkne — máš naň manu, tak sa minie a strela sa „vypustí"
  // (hneď zhasne na okraji). Klonova strela (vertikálne zrkadlená) môže pritom letieť ďalej.
  me.mana -= BASIC_COST;
  let anyCharge = false; // aspoň jedna strela vôbec vzlietla (dostala in-board bunku) → netreba whiff

  // strely: majiteľ + prípadný klon. Klon zrkadlí smer VERTIKÁLNE (up<->down), horizontálne rovnako
  // (rovnako ako pohyb); klonova strela dáva ROVNAKÝ dmg ako Naruto (falloff + rovnaké buffy). Každá
  // strela nesie vlastný delta `d` a `dir`, aby klonova vertikála letela opačne.
  // Terče v dráhe: SÚPEROV KLON-návnada (mimo majiteľovej bunky) strelu zožerie a letí ďalej dym; keď
  // klon STOJÍ NA majiteľovej bunke, pohltí len CLONE_DMG a zvyšok prejde na Naruta.
  const cloneDir = { up:"down", down:"up", left:"left", right:"right" }[dir];
  const cloneDelta = [delta[0], -delta[1]];
  const shots = [{ x: me.x, y: me.y, dist: 0, clone: false, d: delta, dir, done: false, spent: false }];
  if (me.clone) shots.push({ x: me.clone.x, y: me.clone.y, dist: 0, clone: true, d: cloneDelta, dir: cloneDir, done: false, spent: false });

  // deterministický pre-scan: zásah REÁLNEHO hráča ktoroukoľvek strelou odhalí labyrint pred letom
  // (zásah len klona-návnady labyrint neodhaľuje; stacknutý klon strelu k Narutovi pustí → to odhalí)
  for (const sh of shots) {
    let hx = sh.x, hy = sh.y, blockedByClone = false;
    while (inBounds(hx + sh.d[0], hy + sh.d[1])) {
      hx += sh.d[0]; hy += sh.d[1];
      const cloneDecoy = op?.clone && op.clone.x === hx && op.clone.y === hy && !(op.x === hx && op.y === hy);
      if (cloneDecoy) { blockedByClone = true; break; } // klon-návnada strelu zožerie
      if (op && op.x === hx && op.y === hy) break;
    }
    if (!blockedByClone && op && op.x === hx && op.y === hy) { revealLabyrinths(tl); break; }
  }

  // paralelný let: v každom kroku sa všetky živé strely posunú o bunku (jeden frame = všetky charge efekty)
  let guard = 0;
  while (shots.some(s => !s.done) && guard++ < 16) {
    const fx = [];
    const hits = [];
    for (const s of shots) {
      if (s.done) continue;
      s.x += s.d[0]; s.y += s.d[1]; s.dist++;
      if (!inBounds(s.x, s.y)) { s.done = true; continue; }
      fx.push({ kind: "charge", from: slot, dir: s.dir, cell: [s.x, s.y], clone: s.clone });
      if (s.spent) continue; // už minutá na klona-návnadu — letí len vizuálne
      const cloneHere  = op?.clone && op.clone.x === s.x && op.clone.y === s.y;
      const playerHere = op && op.x === s.x && op.y === s.y;
      if (cloneHere && playerHere) { s.done = true; hits.push({ target: "stacked", shot: s }); }
      else if (cloneHere)         { hits.push({ target: "clone", shot: s }); }
      else if (playerHere)        { s.done = true; hits.push({ target: "player", shot: s }); }
    }
    if (fx.length) { anyCharge = true; pushStateFrame(tl, fx, CHARGE_STEP_MS); }
    // klonova strela dáva ROVNAKÝ dmg ako Naruto: falloff podľa VLASTNEJ vzdialenosti klona
    // (h.shot.dist sa počíta z klonovej bunky) × rovnaké násobiče (Last Stand ×2 / Last Hope ×4, maze ×2).
    const rawOf = (h) => Math.max(1, BASIC_DMG_MAX - h.shot.dist) * dealMul(slot) * labyrinthMul(slot);
    // súperove „player" zásahy z TOHTO kroku: stacknutý Naruto+klon strieľajúci rovnakým smerom trafí
    // z jednej bunky dvakrát → na NEKRYTÉ HP to spojíme do JEDNÉHO úderu so súčtom dmg (nie dva animačne
    // oddelené); pri obrane (štít/mirror) applyStackedHit vráti false a rieši sa každá strela zvlášť.
    const playerHits = hits.filter(h => h.target === "player");
    if (playerHits.length && !applyStackedHit(opS, playerHits.map(rawOf), tl, "basic")) {
      for (const h of playerHits) { applyHit(opS, rawOf(h), tl, "basic", h.shot.clone); if (winnerNow()) break; }
    }
    for (const h of hits) {
      if (h.target === "player" || winnerNow()) continue;
      const raw = rawOf(h);
      if (h.target === "stacked") {
        const defended = op.shield || op.mirror; // zdieľaná obrana kryje celý zásah (klon prežije)
        if (defended) {
          // obe figúry na JEDNEJ bunke → obrana zareaguje ako jedna postava v JEDNOM beate
          // (jeden block / jeden lúč + odraz oboch figúr naraz ako „n+n" hit) — nie dva zásahy za sebou
          applyHitPairDefended(opS, raw, tl, "basic", h.shot.clone);
        } else {
          // klon na majiteľovej bunke pohltí len CLONE_DMG (zomrie), zvyšok dmg prejde na Naruta
          applyHitOnClone(opS, CLONE_DMG, tl, "basic");
          if (!winnerNow()) {
            const through = Math.max(0, raw - CLONE_DMG);
            if (through > 0) applyHit(opS, through, tl, "basic", h.shot.clone);
          }
        }
      } else { // clone (návnada mimo majiteľovej bunky)
        const defended = op.shield || op.mirror; // obrana strelu zastaví (block/odraz), inak preletí cez dym
        applyHitOnClone(opS, raw, tl, "basic");
        if (defended) h.shot.done = true; else h.shot.spent = true;
      }
    }
    if (winnerNow()) break; // prvá smrť končí hru — zvyšok letu sa už nehrá
  }
  // žiadna strela nevzlietla (Naruto aj klon mieria von z plochy) — zahraj útočný švih naprázdno
  // + whiff float, nech akcia nie je „tichá" a čitateľne minula manu (namiesto starého prečiarknutia)
  if (!anyCharge) pushStateFrame(tl, [{ kind: "attack_swing", from: slot, dir, offboard: true }], SMALL_DELAY_MS);
}

function doMelee(slot, tl) {
  const me  = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];

  if (me.mana < MELEE_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= MELEE_COST;

  // úder sa švihne vždy (mana je preč aj pri minutí); bežne zasiahne len súpera na rovnakom políčku,
  // Medúza šľahá chvostom širšie — vlastné políčko + 1 diagonálne na všetky strany, za nižší dmg.
  // Zasahované bunky idú v efekte (klient ich zvýrazní a nemusí zrkadliť logiku).
  const medusa = me.char === "medusa";
  const cells = [[me.x, me.y]];
  if (medusa) {
    for (const [dx, dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
      if (inBounds(me.x + dx, me.y + dy)) cells.push([me.x + dx, me.y + dy]);
    }
  }
  // vlastný klon seká paralelne na SVOJEJ bunke (rovnaký dmg ako Naruto)
  const cloneCells = me.clone ? [[me.clone.x, me.clone.y]] : [];
  const atCells = (cs, px, py) => cs.some(([x, y]) => x === px && y === py);
  // terče: súperov klon absorbuje úder na svojej bunke skôr než súper (bait na zdieľanej bunke);
  // súper na inej zasahovanej bunke (Medúza) dostane úder tiež — zóna, nie jeden terč
  const foeCloneAt = (px, py) => !!(op?.clone && op.clone.x === px && op.clone.y === py);
  const hitFoeByMe    = !!(op && atCells(cells, op.x, op.y) && !foeCloneAt(op.x, op.y));
  const hitFoeByClone = !!(op && atCells(cloneCells, op.x, op.y) && !foeCloneAt(op.x, op.y));
  const hitFoeCloneByMe    = !!(op?.clone && atCells(cells, op.clone.x, op.clone.y));
  const hitFoeCloneByClone = !!(op?.clone && atCells(cloneCells, op.clone.x, op.clone.y));
  // zásah je istý už pred švihmi (pozície sa nemenia) — REÁLNY zásah odhalí labyrint PRED animáciou
  // (zásah len klona nie — súper sa nesmie dozvedieť, že trafil)
  if (hitFoeByMe || hitFoeByClone) revealLabyrinths(tl);
  // rovnaká dramaturgia ako special: opakované švihy v beatoch, dmg padne až po nich
  for (let r = 0; r < MELEE_REPEAT; r++) {
    pushStateFrame(tl, [{ kind: "melee", from: slot, cells: cells.concat(cloneCells) }], SPECIAL_BEAT_MS);
  }
  const meleeRaw = (medusa ? MEDUSA_MELEE_DMG : MELEE_DMG) * dealMul(slot) * labyrinthMul(slot); // maze buff: 2× počas labyrintu
  const cloneMeleeRaw = MELEE_DMG * dealMul(slot) * labyrinthMul(slot); // klon (vždy Narutov) seká za plný MELEE_DMG
  // stacknutý pár Naruto+klon na súperovej bunke seká dvakrát → na nekryté HP JEDEN úder so súčtom
  // (klient vypíše „8+8" a zanimuje ako jeden zásah); pri obrane sa rieši každý sek zvlášť
  if (!(hitFoeByMe && hitFoeByClone && applyStackedHit(opS, [meleeRaw, cloneMeleeRaw], tl, "melee"))) {
    if (hitFoeByMe) applyHit(opS, meleeRaw, tl, "melee");
    if (hitFoeByClone && !winnerNow()) applyHit(opS, cloneMeleeRaw, tl, "melee", true);
  }
  if ((hitFoeCloneByMe || hitFoeCloneByClone) && !winnerNow()) {
    // obrana sa už prípadne „ukázala" na zásahu hráča tou istou akciou → bez duplicitných frame-ov
    applyHitOnClone(opS, hitFoeCloneByMe ? (medusa ? MEDUSA_MELEE_DMG : MELEE_DMG) * dealMul(slot) : CLONE_DMG * dealMul(slot),
      tl, "melee", hitFoeByMe || hitFoeByClone);
  }
}

// Výstupný násobič dmg: Last Hope ultra mód = 4×, Last Stand buff = 2×, inak 1×.
// Prijatý dmg sa zaokrúhľuje na floor(½) pri Last Stand aj Last Hope (½ chráni 1-HP Last Hope hráča pred dmg tile).
function dealMul(slot)      { const p = game.players[slot]; return p.lastHopeBuff ? 4 : p.lastStandBuff ? 2 : 1; }
function recvDmg(slot, dmg) { const p = game.players[slot]; return (p.lastStandBuff || p.lastHopeBuff) ? Math.floor(dmg / 2) : dmg; }
// 2× VÝSTUPNÝ dmg pre hráča s maze buffom (ten, čo úspešne priamym castom zaklial súpera do labyrintu).
// Aplikuje sa na raw pred applyHit → ak je Minotaurov útok odrazený, doubled dmg sa vráti späť naňho.
// mazeBuff nezíska mirror-lovec (labyrint cez odraz) ani prekliaty Minotaur → presne cielené na hráča Minotaura.
function labyrinthMul(slot) { return game.players[slot]?.mazeBuff ? 2 : 1; }

// akýkoľvek zásah AKCIOU medzi hráčmi ukončí labyrint (oboch pri mirror matchi) — počíta sa aj
// zablokovaný/odrazený zásah (applyHit/applyPetrify/applyLabyrinth sa volajú len keď akcia trafila);
// tile damage ide mimo applyHit, takže labyrint neukončuje. Volá sa až PO zásahových frame-och
// (block/odraz/hit + úbytok HP) — ESCAPED a rozsvietenie arény prídu po dohratí zásahu; odhalenie
// súpera prebehlo už pred animáciou akcie (revealLabyrinths), vtedy zanikla aj niť s obrysom.
function endLabyrinths(tl) {
  for (const slot of ["p1", "p2"]) {
    const p = game.players[slot];
    if (!p.labyrinth) continue;
    p.labyrinth = false;
    p.labReveal = false;
    p.thread = [];
    p.threadMark = null;
    game.players[other(slot)].mazeBuff = false; // labyrint skončil → kaster stráca 2× dmg
    pushStateFrame(tl, [{ kind: "labyrinth_end", target: slot }], SMALL_DELAY_MS);
  }
}

// Ak akcia labyrint ISTO ukončí (zásah padne — počíta sa aj do štítu/zrkadla), odhalenie prebehne
// ešte PRED jej animáciou: labReveal zruší redakciu aj hmlu (klient zjaví skrytého súpera fade-om
// a odkryje jeho widget — HP/mana sú opäť viditeľné), samotný labyrinth flag ale beží ďalej,
// takže aréna ostáva stmavená až po labyrinth_end. Niť a obrys zanikajú už pri odhalení,
// aby ich lovec nevidel ani na okamih. Zásah je deterministický — pozície sa počas animácie nemenia.
function revealLabyrinths(tl) {
  for (const slot of ["p1", "p2"]) {
    const p = game.players[slot];
    if (!p.labyrinth || p.labReveal) continue;
    p.labReveal = true;
    p.thread = [];
    p.threadMark = null;
    pushStateFrame(tl, [{ kind: "labyrinth_reveal", target: slot }], LAB_REVEAL_MS);
  }
}

// aplikuje zásah cez prípadné obrany obrancu (shield blokuje celý dmg, mirror ho odrazí do útočníka)
// labyrint končí až PO dohratí zásahovej animácie (block/odraz/hit + úbytok HP) — odhalenie súpera
// už predtým zabezpečil revealLabyrinths (labReveal), takže tieto framy sa hrajú neredigované.
// fromClone: zásah pochádza od tieňového klona útočníka — mirror odraz vtedy zničí KLONA
// (nie HP majiteľa); Narutova a klonova strela sú jedna paralelná akcia, obrana neguje obe.
function applyHit(targetSlot, rawDmg, tl, kind = "basic", fromClone = false) {
  const t = game.players[targetSlot];
  if (t.shield) {
    pushStateFrame(tl, [{ kind: "block", target: targetSlot, gold: !!t.shieldGold }], SMALL_DELAY_MS);
    endLabyrinths(tl); // aj zablokovaný zásah ukončuje labyrint
    return;
  }
  if (t.mirror) {
    // odrazený dmg ide „surovo" — neaplikuje sa cez útočníkove obrany a nedá sa znova odraziť
    // poradie: najprv mirror frame (HP ešte nezmenené), až potom hit frame s poklesom HP útočníka
    const atkSlot = other(targetSlot);
    const atk = game.players[atkSlot];
    // delay = čas dopadu beamu (nie SMALL_DELAY_MS), aby dmg padol hneď ako beam zasiahne — bez medzery;
    // atk/dmg riadia hrúbku a štýl beamu na klientovi (basic podľa dmg, melee hrubý, special fialovo prepletený)
    pushStateFrame(tl, [{ kind: "mirror", target: targetSlot, dmg: rawDmg, atk: kind, gold: !!t.mirrorGold }], MIRROR_BEAM_MS);
    if (fromClone) {
      // odraz klonovej akcie letí do klona a rozplynie ho — akcia však na obrancu dopadla, labyrint končí
      killClone(atkSlot, tl);
      endLabyrinths(tl);
      return;
    }
    const d = recvDmg(atkSlot, rawDmg); // ½ ak má útočník (príjemca odrazu) last stand buff
    atk.hp = Math.max(0, atk.hp - d);
    pushStateFrame(tl, [{ kind: "hit", target: atkSlot, dmg: d }], SMALL_DELAY_MS);
    endLabyrinths(tl); // odrazený zásah ukončuje labyrint — až po dopade odrazu
    return;
  }
  const d = recvDmg(targetSlot, rawDmg); // ½ ak má obranca last stand buff (2× maze buff je už v rawDmg)
  t.hp = Math.max(0, t.hp - d);
  pushStateFrame(tl, [{ kind: "hit", target: targetSlot, dmg: d }], SMALL_DELAY_MS);
  endLabyrinths(tl); // labyrint končí až po dopade zásahu a úbytku HP
}

// Viac SÚBEŽNÝCH zásahov jednou akciou (stacknutý Naruto+klon strieľa/seká rovnakým smerom z jednej
// bunky) na NEKRYTÉ HP súpera = JEDEN úder so súčtom dmg — klient ho podľa `parts` vypíše ako „2+2"
// a zanimuje ako jeden zásah (nie dva za sebou). Pri obrane (štít/mirror) vráti false → volajúci
// nechá každú strelu prejsť applyHit-om zvlášť (obrana rieši každú osobitne). Vráti true ak spracoval.
function applyStackedHit(targetSlot, raws, tl, kind = "basic") {
  const t = game.players[targetSlot];
  if (raws.length < 2 || t.shield || t.mirror) return false; // jediný zásah / obrana → rieši applyHit
  const parts = raws.map(r => recvDmg(targetSlot, r)); // ½ pri Last Stand/Hope (2× maze je už v raw)
  const total = parts.reduce((a, b) => a + b, 0);
  t.hp = Math.max(0, t.hp - total);
  pushStateFrame(tl, [{ kind: "hit", target: targetSlot, dmg: total, parts }], SMALL_DELAY_MS);
  endLabyrinths(tl); // súbežný zásah tiež ukončuje labyrint (odhalenie prebehlo pred letom)
  return true;
}

// Zásah JEDNEJ akcie do STACKNUTÉHO páru Naruto+klon so zdieľanou obranou (obe figúry na jednej bunke).
// Obrana zareaguje ako JEDNA postava v JEDNOM beate: shield = jeden block frame; mirror = JEDEN lúč z bunky
// páru a útočník dostane odraz OBOCH figúr NARAZ — jeden hit frame s parts [n, n] (klient vypíše rozpis
// v jednom floate a HP klesne naraz). fromClone (strela pochádza od útočníkovho klona): odraz z páru
// rozplynie útočníkovho klona a HP zásah nesie len jednu časť — zachováva pôvodnú kombináciu
// applyHitOnClone (odraz do HP) + applyHit (fromClone → killClone), len v jednom spoločnom beate.
// Volať LEN keď je obrana armed (o.shield || o.mirror) a klon stojí na majiteľovej bunke.
function applyHitPairDefended(ownerSlot, rawDmg, tl, kind = "basic", fromClone = false) {
  const o = game.players[ownerSlot];
  const atkSlot = other(ownerSlot);
  const atk = game.players[atkSlot];
  if (o.shield) {
    pushStateFrame(tl, [{ kind: "block", target: ownerSlot, gold: !!o.shieldGold }], SMALL_DELAY_MS);
    endLabyrinths(tl);
    return;
  }
  pushStateFrame(tl, [{ kind: "mirror", target: ownerSlot, dmg: rawDmg, atk: kind, gold: !!o.mirrorGold }], MIRROR_BEAM_MS);
  if (fromClone) {
    const d = recvDmg(atkSlot, rawDmg);
    atk.hp = Math.max(0, atk.hp - d);
    const fx = [{ kind: "hit", target: atkSlot, dmg: d }];
    if (atk.clone) { fx.push({ kind: "clone_die", target: atkSlot, cell: [atk.clone.x, atk.clone.y] }); atk.clone = null; }
    pushStateFrame(tl, fx, SMALL_DELAY_MS);
    endLabyrinths(tl);
    return;
  }
  const parts = [recvDmg(atkSlot, rawDmg), recvDmg(atkSlot, rawDmg)];
  const total = parts[0] + parts[1];
  atk.hp = Math.max(0, atk.hp - total);
  pushStateFrame(tl, [{ kind: "hit", target: atkSlot, dmg: total, parts }], SMALL_DELAY_MS);
  endLabyrinths(tl);
}

// Jedna akcia zasiahne obrancu (ownerSlot) a VOLITEĽNE aj jeho tieňového klona (includeClone) — keďže Naruto
// a klon sú „tá istá postava" so zdieľanou obranou, ich reakcie idú do SPOLOČNÝCH beatov (blok / mirror-lúč /
// hit sa prehrajú NARAZ, nie sekvenčne). ownerDmg = dmg na Naruta; klon vždy „stojí za" flat CLONE_DMG×buff.
function applyHitBoth(ownerSlot, ownerDmg, tl, kind, includeClone) {
  const o = game.players[ownerSlot];
  const withClone = !!(includeClone && o.clone);
  const cloneCell = withClone ? [o.clone.x, o.clone.y] : null;
  const atkSlot = other(ownerSlot);
  const atk = game.players[atkSlot];

  if (o.shield) {
    // block na Narutovi AJ na klonovej bunke v jednom beate → štít praskne na oboch naraz
    const fx = [{ kind: "block", target: ownerSlot, gold: !!o.shieldGold }];
    if (withClone) fx.push({ kind: "block", target: ownerSlot, cell: cloneCell, gold: !!o.shieldGold });
    pushStateFrame(tl, fx, SMALL_DELAY_MS);
    endLabyrinths(tl);
    return;
  }
  if (o.mirror) {
    const cloneRaw = ownerDmg; // klon dostal tú istú akciu ako Naruto → jeho mirror odrazí PLNÝ dmg (nie flat 1)
    // lúče oboch naraz (jeden beat), potom oba dopady na útočníka naraz (jeden beat)
    const beams = [{ kind: "mirror", target: ownerSlot, dmg: ownerDmg, atk: kind, gold: !!o.mirrorGold }];
    if (withClone) beams.push({ kind: "mirror", target: ownerSlot, cell: cloneCell, dmg: cloneRaw, atk: kind, gold: !!o.mirrorGold });
    pushStateFrame(tl, beams, MIRROR_BEAM_MS);
    const dO = recvDmg(atkSlot, ownerDmg);
    const dC = withClone ? recvDmg(atkSlot, cloneRaw) : 0;
    atk.hp = Math.max(0, atk.hp - dO - dC);
    // oba odrazy dopadnú na útočníka ako JEDEN úder so súčtom a rozpisom (klient: jeden float „-n -n HP"),
    // nie dva samostatné floaty — HP klesne naraz
    const hits = dC > 0
      ? [{ kind: "hit", target: atkSlot, dmg: dO + dC, parts: [dO, dC] }]
      : [{ kind: "hit", target: atkSlot, dmg: dO }];
    pushStateFrame(tl, hits, SMALL_DELAY_MS);
    endLabyrinths(tl);
    return;
  }
  // bez obrany: Naruto berie plný ownerDmg a klon (ak zasiahnutý) zaniká — VŠETKO v jednom beate
  const d = recvDmg(ownerSlot, ownerDmg);
  o.hp = Math.max(0, o.hp - d);
  const fx = [];
  if (d > 0) fx.push({ kind: "hit", target: ownerSlot, dmg: d });
  if (withClone) { fx.push({ kind: "clone_die", target: ownerSlot, cell: cloneCell }); o.clone = null; }
  if (!fx.length) fx.push({ kind: "hit", target: ownerSlot, dmg: 0 }); // poistka: beat nesmie byť prázdny
  pushStateFrame(tl, fx, SMALL_DELAY_MS);
  endLabyrinths(tl);
}

// skamenenie cez obrany obrancu — zrkadlí applyHit: shield ho zablokuje (a spotrebuje sa),
// mirror ho odrazí na Medúzu (surovo — odrazený kameň sa už nedá blokovať ani znova odraziť)
function applyPetrify(targetSlot, tl) {
  const t = game.players[targetSlot];
  if (t.shield) {
    pushStateFrame(tl, [{ kind: "block", target: targetSlot, gold: !!t.shieldGold }], SMALL_DELAY_MS);
    endLabyrinths(tl); // zasahujúci (hoci zablokovaný) petrify je tiež zásah — labyrint končí po block animácii
    return;
  }
  if (t.mirror) {
    const atkSlot = other(targetSlot);
    pushStateFrame(tl, [{ kind: "mirror", target: targetSlot, dmg: 0, atk: "special", gold: !!t.mirrorGold }], MIRROR_BEAM_MS);
    petrify(atkSlot, tl);
    endLabyrinths(tl); // labyrint končí až po dopade odrazeného skamenenia
    return;
  }
  petrify(targetSlot, tl);
  endLabyrinths(tl); // labyrint končí až po dohratí skamenenia
}
function petrify(slot, tl) {
  game.players[slot].stone = STONE_ACTIONS;
  pushStateFrame(tl, [{ kind: "petrify", target: slot }], SMALL_DELAY_MS);
}

// labyrint cez obrany obrancu — zrkadlí applyPetrify: shield ho zablokuje (a spotrebuje sa),
// mirror ho odrazí na Minotaura (v labyrinte skončí sám kaster — oslepne a niť ťahá on)
function applyLabyrinth(targetSlot, tl) {
  const t = game.players[targetSlot];
  if (t.shield) {
    pushStateFrame(tl, [{ kind: "block", target: targetSlot, gold: !!t.shieldGold }], SMALL_DELAY_MS);
    endLabyrinths(tl); // zasahujúci (hoci zablokovaný) labyrint je tiež zásah — prípadný bežiaci labyrint kastera končí
    return;
  }
  // starý labyrint musí skončiť PRED novým zakliatím (nikdy nebežia dva naraz) — až po prípadnej odrazovej animácii
  if (t.mirror) {
    const atkSlot = other(targetSlot);
    pushStateFrame(tl, [{ kind: "mirror", target: targetSlot, dmg: 0, atk: "special", gold: !!t.mirrorGold }], MIRROR_BEAM_MS);
    endLabyrinths(tl);
    loseInLabyrinth(atkSlot, tl);
    return;
  }
  endLabyrinths(tl);
  loseInLabyrinth(targetSlot, tl);
  // priamy (neodrazený) cast → KASTER (ten, čo hrá Minotaura) získa maze buff: 2× dmg + imunita na Damage/IK
  // dlaždice, kým labyrint trvá. Pri odraze/štíte sa sem nedostaneme, takže mirror-lovec buff nezíska.
  game.players[other(targetSlot)].mazeBuff = true;
}
function loseInLabyrinth(slot, tl) {
  const p = game.players[slot];
  p.labyrinth = true;
  p.thread = [[p.x, p.y]]; // niť začína tam, kde postava stála pri zakliatí
  p.threadMark = null;
  pushStateFrame(tl, [{ kind: "labyrinth", target: slot }], SMALL_DELAY_MS);
}

// labyrint: prekliaty necháva niť na každom políčku, na ktoré vstúpi (dash aj cez medzibunku).
// threadMark = POSLEDNÉ políčko, kde sa niť a Minotaur stretli — vznikne oboma smermi:
// (a) Minotaur vstúpi na niť (aj prebehnutím dashom), (b) prekliaty dorastie niťou na bunku,
// kde Minotaur práve stojí. Prekliaty tam vidí jeho obrys. Vracia efekty k pohybovému frame-u.
function trackSteps(slot, cells) {
  const fx = [];
  const p = game.players[slot];
  const foeS = other(slot);
  const foe = game.players[foeS];
  if (p.labyrinth) {
    let mark = null;
    for (const [x, y] of cells) {
      if (!p.thread.some(([tx, ty]) => tx === x && ty === y)) p.thread.push([x, y]);
      if (foe && !foe.labyrinth && foe.x === x && foe.y === y) mark = [x, y]; // niť dorástla na Minotaurovu bunku
      // lovcov tieňový klon sa ráta tiež — prekliaty na jeho bunke uvidí siluetu (nevie, že je to klon)
      if (foe && !foe.labyrinth && foe.clone && foe.clone.x === x && foe.clone.y === y) mark = [x, y];
    }
    if (mark) {
      p.threadMark = mark;
      fx.push({ kind: "thread_mark", cell: mark, target: slot });
    }
  }
  if (foe?.labyrinth) {
    // lovec prechádza niťou → preblik na KAŽDEJ prejdenej niťovej bunke (nie len na poslednej);
    // threadMark ostane posledná bunka (tam silueta natrvalo ostane)
    for (const [x, y] of cells) {
      if (foe.thread.some(([tx, ty]) => tx === x && ty === y)) {
        foe.threadMark = [x, y];
        fx.push({ kind: "thread_mark", cell: [x, y], target: foeS }); // target = kto obrys uvidí
      }
    }
  }
  return fx;
}

function doShield(slot, tl) {
  const a = game.players[slot];
  if (a.mana < SHIELD_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  a.mana -= SHIELD_COST;
  a.shield = true;
  a.shieldGold = false;
  pushStateFrame(tl, [{ kind: "shield", from: slot }], SMALL_DELAY_MS);
}

function doMirror(slot, tl) {
  const a = game.players[slot];
  if (a.mana < MIRROR_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  a.mana -= MIRROR_COST;
  a.mirror = true;
  a.mirrorGold = false;
  pushStateFrame(tl, [{ kind: "mirror_on", from: slot }], SMALL_DELAY_MS);
}

function doSpecial(slot, tl, dir = null, cell = null) {
  const actor = game.players[slot];
  if (!actor) return;

  // Bez many -> len spätná väzba (Hurt na klientovi + low mana výstraha), žiadna special animácia
  if (actor.mana < SPECIAL_COST) {
    pushInvalid(tl, slot, SMALL_DELAY_MS, "mana");
    return;
  }

  // Medúza: special nedáva dmg — súpera v zóne SKAMENÍ (preskočí najbližšie 2 základné akcie).
  // Zóna má smer (left/right); zásah ide cez obrany (shield blokuje, mirror odrazí kameň na Medúzu).
  if (actor.char === "medusa") {
    if (dir !== "left" && dir !== "right") { pushInvalid(tl, slot); return; }
    actor.mana -= SPECIAL_COST;
    const cells = medusaCells(actor, dir);
    const foeS = other(slot);
    const foe  = game.players[foeS];
    const inZone = !!(foe && cells.some(([x, y]) => x === foe.x && y === foe.y));
    // súperov tieňový klon v zóne skamenenie nezvládne — zmizne (zóna zasahuje hráča aj klona naraz)
    const cloneInZone = !!(foe?.clone && cells.some(([x, y]) => x === foe.clone.x && y === foe.clone.y));
    // istý zásah (aj do štítu/zrkadla) — prípadný labyrint sa odhalí ešte PRED nádychmi
    if (inZone && !(foe.stone > 0)) revealLabyrinths(tl);
    for (let r = 0; r < SPECIAL_REPEAT; r++) {
      pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells }], SPECIAL_BEAT_MS);
    }
    if (!inZone && !cloneInZone) {
      pushStateFrame(tl, [], SMALL_DELAY_MS);
      return;
    }
    const foeStruck = inZone && !(foe.stone > 0);
    if (inZone) {
      // už skamenený súper: útok bez efektu, žiadny refresh countera
      if (foe.stone > 0) pushInvalid(tl, slot, SMALL_DELAY_MS, "already_stone");
      else applyPetrify(foeS, tl);
    }
    if (cloneInZone) applyStatusOnClone(foeS, tl, "petrify", foeStruck);
    return;
  }

  // Minotaur: special nedáva dmg — CELOPLOŠNÝ (zasiahne súpera vždy), prenesie ho do LABYRINTU:
  // súper nevidí board (len vlastnú bunku + svoju niť), kým jeden hráč nezasiahne druhého.
  // Ide cez obrany ako petrify (shield blokuje, mirror odrazí — v labyrinte skončí sám Minotaur).
  if (actor.char === "minotaur") {
    actor.mana -= SPECIAL_COST;
    const cells = [];
    for (let y = 0; y < game.board.h; y++)
      for (let x = 0; x < game.board.w; x++) cells.push([x, y]);
    const foeS = other(slot);
    const foe  = game.players[foeS];
    // istý zásah — kasterov prípadný VLASTNÝ labyrint (mirror match) sa odhalí ešte pred nádychmi
    if (foe && !foe.labyrinth) revealLabyrinths(tl);
    for (let r = 0; r < SPECIAL_REPEAT; r++) {
      pushStateFrame(tl, [{ kind: "special", from: slot, cells }], SPECIAL_BEAT_MS);
    }
    if (!foe) { pushStateFrame(tl, [], SMALL_DELAY_MS); return; }
    // súper už blúdi v labyrinte: útok bez efektu, niť sa neresetuje
    if (foe.labyrinth) { pushInvalid(tl, slot, SMALL_DELAY_MS, "already_lost"); return; }
    applyLabyrinth(foeS, tl);
    // celoplošný special zasiahne aj súperovho tieňového klona (obrana ho kryje — už sa ukázala vyššie)
    applyStatusOnClone(foeS, tl, "labyrinth", true);
    return;
  }

  // Naruto: special nedáva dmg — TIEŇOVÝ KLON. Range self: nedá sa blokovať ani odraziť,
  // ale Naruto musí stáť na bunke SÁM (bez súpera; vlastný klon nevadí). Recast s aktívnym
  // klonom: starý klon najprv zmizne ako po zásahu, potom beží bežný summon. Klon vzniká na
  // Narutovej bunke (kým zdieľajú bunku, kreslí sa len jeden — a stojaci klon absorbuje
  // najbližší jednoterčový zásah namiesto Naruta).
  if (actor.char === "naruto") {
    const foeS = other(slot);
    const foe  = game.players[foeS];
    // summon vyžaduje bunku bez súpera — súper stojaci na Narutovej bunke je JEDINÝ spôsob, ako special
    // zablokovať. NOVÉ PRAVIDLO: máš naň manu → minie sa aj tak. Starý klon zaniká VŽDY (recast aj blok)
    // ešte PRED animáciou pečatí — Naruto sa naň nakoncentruje bez ohľadu na to, či nový vznikne.
    actor.mana -= SPECIAL_COST;
    killClone(slot, tl);
    if (foe && foe.x === actor.x && foe.y === actor.y) {
      for (let r = 0; r < SPECIAL_REPEAT; r++)
        pushStateFrame(tl, [{ kind: "special", from: slot, cells: [[actor.x, actor.y]] }], SPECIAL_BEAT_MS);
      pushInvalid(tl, slot, SMALL_DELAY_MS, "not_alone");
      return;
    }
    // pečate (Special.png) v rovnakej kadencii ako ostatné speciály; zóna = vlastná bunka
    for (let r = 0; r < SPECIAL_REPEAT; r++) {
      pushStateFrame(tl, [{ kind: "special", from: slot, cells: [[actor.x, actor.y]] }], SPECIAL_BEAT_MS);
    }
    // summon choreografia: Naruto + kópia na tej istej bunke tvárou v tvár hrajú Special_2, potom klon vznikne na jeho bunke
    pushStateFrame(tl, [{ kind: "clone_summon", from: slot, cell: [actor.x, actor.y] }], CLONE_SUMMON_MS);
    actor.clone = { x: actor.x, y: actor.y };
    pushStateFrame(tl, [{ kind: "clone_born", from: slot, cell: [actor.x, actor.y] }], SMALL_DELAY_MS);
    return;
  }

  // Vojak: snajperský lúč na ZVOLENÚ bunku (akcia nesie cell — validQueue overil hranice, súperovu
  // aktuálnu bunku aj vlastnú ghost pozíciu; v labyrinte prekliateho vojaka sa súperova bunka neblokuje).
  // 10 dmg tomu, kto na bunke STOJÍ v momente výstrelu — súper je zraniteľný, len keď sa pohne (alebo
  // stojaci lovec, keď strieľa prekliaty vojak). Ide cez obrany ako každý dmg special (shield blokuje,
  // mirror odrazí 10); samotného vojaka lúč nikdy nezraní (vlastnú bunku ani nejde zvoliť).
  if (actor.char === "soldier") {
    if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !inBounds(cell.x, cell.y)) { pushInvalid(tl, slot); return; }
    actor.mana -= SPECIAL_COST;
    const cells = [[cell.x, cell.y]];
    const foeS = other(slot);
    const foe  = game.players[foeS];
    const inZone = !!(foe && foe.x === cell.x && foe.y === cell.y);
    const cloneStruck = !!(foe?.clone && foe.clone.x === cell.x && foe.clone.y === cell.y);
    // istý zásah reálneho hráča (aj do štítu/zrkadla) odhalí prípadný labyrint ešte pred animáciou
    if (inZone) revealLabyrinths(tl);
    // mierenie: JEDEN dlhý cast frame (nie opakované beaty — sniperka nestrieľa dávkou) — veľký sprite
    // drží mieriacu pózu, laser sight sa ustáli na cieli a výšľah vyjde raz tesne pred lúčom
    pushStateFrame(tl, [{ kind: "special", from: slot, cells }], SOLDIER_AIM_MS);
    // lúč zo zbrane + výbuch na cieľovej bunke — zásah (hit/block/odraz) padne až po dolete
    pushStateFrame(tl, [{ kind: "soldier_beam", from: slot, cell: [cell.x, cell.y] }], SOLDIER_BEAM_MS);
    const dmg = SPECIAL_ZONE_DMG.soldier * dealMul(slot);
    if (inZone) applyHitBoth(foeS, dmg, tl, "special", cloneStruck);
    else if (cloneStruck) applyHitOnClone(foeS, dmg, tl, "special", false); // klon-návnada na cieli — zomiera (obrana kryje/odráža)
    else pushStateFrame(tl, [], SMALL_DELAY_MS);
    return;
  }

  // Vlkolak (werewolf): „moon charge" — rozbehne sa jedným z 8 smerov (aj diagonály) a zastane na PRVEJ
  // figúre súpera v dráhe (klon-návnada absorbuje úder skôr než súper — ako pri melee) alebo na okraji
  // plochy. Vlastnú bunku nezasahuje (súper na vlkolakovej bunke = beh na okraj bez hitu, ako basic).
  // Zásah = WOLF_MOON_DMG[moon] (bez falloffu podľa vzdialenosti) cez obrany ako každý dmg special
  // (shield blokuje, mirror odrazí plný moon dmg) — vlkolak ale na bunke terča OSTÁVA STÁŤ aj pri
  // bloku/odraze (hit je hit). Bez terča je akcia len presun na poslednú bunku smeru; charge z okrajovej
  // bunky von z plochy sa VYKONÁ podľa wall pravidla (mana preč, wall_bump, neprečiarkuje sa).
  if (actor.char === "werewolf") {
    const delta = WOLF_DIRS[dir];
    if (!delta) { pushInvalid(tl, slot); return; }
    actor.mana -= SPECIAL_COST;
    const foeS = other(slot);
    const foe  = game.players[foeS];
    // dráha: krok za krokom po okraj; stop na prvej figúre (klon pred súperom — bait pravidlo ako melee)
    let x = actor.x, y = actor.y, target = null; // null | "clone" | "player"
    const path = [];
    while (inBounds(x + delta[0], y + delta[1])) {
      x += delta[0]; y += delta[1];
      path.push([x, y]);
      const cloneHere  = !!(foe?.clone && foe.clone.x === x && foe.clone.y === y);
      const playerHere = !!(foe && foe.x === x && foe.y === y);
      if (cloneHere) { target = "clone"; break; }
      if (playerHere) { target = "player"; break; }
    }
    // charge do steny z okrajovej bunky — akcia sa vykoná na mieste: rozbehová póza + náraz (OUT OF BOUNDS)
    if (!path.length) {
      pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells: [] }], WOLF_CAST_MS);
      pushStateFrame(tl, [{ kind: "wall_bump", from: slot, dir }], SMALL_DELAY_MS);
      return;
    }
    const raw = WOLF_MOON_DMG[Math.max(0, Math.min(3, actor.moon || 0))] * dealMul(slot) * labyrinthMul(slot);
    // istý zásah REÁLNEHO hráča (aj do štítu/zrkadla) odhalí prípadný labyrint pred animáciou;
    // zásah klona-návnady labyrint neodhaľuje (kill klona ho nekončí — súper sa nesmie dozvedieť, že trafil klona)
    if (target === "player") revealLabyrinths(tl);
    // rozbehový cast: veľký Run+Attack v strede, malá postava tiež (casting), dráha bliká
    pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells: path.map(c => [...c]) }], WOLF_CAST_MS);
    // samotný beh: presun na cieľovú bunku jedným sklzom (ako dash); niť labyrintu ráta všetky prejdené bunky
    actor.x = path[path.length - 1][0];
    actor.y = path[path.length - 1][1];
    pushStateFrame(tl, [{ kind: "wolf_charge", from: slot, dir }, ...trackSteps(slot, path)], MOVE_DELAY_MS);
    if (!target) return; // dobehol na okraj bez terča — len presun
    // seknutie (Attack_2) na bunke terča; dmg/block/odraz dopadne až po ňom
    pushStateFrame(tl, [{ kind: "wolf_strike", from: slot, cell: [actor.x, actor.y] }], WOLF_STRIKE_MS);
    if (target === "player") applyHit(foeS, raw, tl, "special");
    else applyHitOnClone(foeS, raw, tl, "special");
    return;
  }

  // Escanor: smerový (left/right) dmg special; rozsah zóny podľa pride levelu (8 dmg). Cez obrany ako
  // ostatné dmg speciály (shield blokuje, mirror odrazí 8 na Escanora). Zóna = escanorCells (pride).
  if (actor.char === "escanor") {
    if (dir !== "left" && dir !== "right") { pushInvalid(tl, slot); return; }
    actor.mana -= SPECIAL_COST;
    const cells = escanorCells(actor, dir);
    // hod slnka MIMO plochy (kotva F von z dosky → prázdna zóna, aj pri pride 3): akcia sa VYKONÁ ako útok
    // do steny — mana je preč, choreografia prebehne (slnko odletí do autu), klient ukáže OUT OF BOUNDS,
    // akcia sa NEprečiarkuje; žiadny dmg ani zásah klona
    if (!cells.length) {
      pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells, offboard: true }], ESC_SPECIAL_MS);
      return;
    }
    const foeS = other(slot);
    const foe  = game.players[foeS];
    const inZone = !!(foe && cells.some(([x, y]) => x === foe.x && y === foe.y));
    const cloneStruck = !!(foe?.clone && cells.some(([x, y]) => x === foe.clone.x && y === foe.clone.y));
    if (inZone) revealLabyrinths(tl); // istý zásah odhalí prípadný labyrint pred animáciou
    // 1 special frame drží celú choreografiu (klient ju spustí); zásah dopadne až po nej (ESC_SPECIAL_MS)
    pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells }], ESC_SPECIAL_MS);
    const dmg = SPECIAL_ZONE_DMG.escanor; // 8
    if (inZone) applyHitBoth(foeS, dmg * dealMul(slot), tl, "special", cloneStruck);
    else if (cloneStruck) applyHitOnClone(foeS, dmg * dealMul(slot), tl, "special", false);
    else pushStateFrame(tl, [], SMALL_DELAY_MS);
    return;
  }

  actor.mana -= SPECIAL_COST;

  // vyhodnotenie zásahu je deterministické už pred nádychmi (pozície sa počas nich nemenia) —
  // istý zásah odhalí prípadný labyrint ešte PRED animáciou špeciálu
  const { dmg, hit } = specialDamageAndHit(game.players, slot);
  // súperov tieňový klon v zóne — zomiera spolu so zásahom hráča (zóna zasahuje oboch naraz)
  const zFoeS = other(slot);
  const zFoe  = game.players[zFoeS];
  const cloneStruck = !!(zFoe?.clone && specialZoneHas(actor, zFoe.clone.x, zFoe.clone.y));
  if (dmg > 0 && hit) revealLabyrinths(tl);

  // 3× „nádych“ (caster animuje špeciál; klient bliká rozsah)
  for (let r = 0; r < SPECIAL_REPEAT; r++) {
    pushStateFrame(tl, [{ kind: "special", from: slot }], SPECIAL_BEAT_MS);
  }

  // Naruto + jeho klon = tá istá postava so zdieľanou obranou → ak zóna zasiahne oboch, block/odraz/hit idú NARAZ
  const ownerHit = !!(dmg > 0 && hit); // hit === zFoeS (súper bol v zóne)
  if (ownerHit) {
    applyHitBoth(zFoeS, dmg * dealMul(slot), tl, "special", cloneStruck);
  } else if (cloneStruck) {
    // zóna minula súpera, ale trafila jeho klona → klon reaguje sám
    applyHitOnClone(zFoeS, (SPECIAL_ZONE_DMG[actor.char] || 0) * dealMul(slot), tl, "special", false);
  } else {
    pushStateFrame(tl, [], SMALL_DELAY_MS);
  }
}

// Démon útok (len buffnutý hráč v poslednom kole): veľký démon v strede sa animuje ako special,
// blikajú cieľové bunky (všetky okrem kasterovej) a potom dá 10 dmg súperovi, ak na niektorej stojí.
function doDemon(slot, tl) {
  const me  = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];

  if (me.mana < DEMON_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= DEMON_COST;

  // dosah = všetky políčka okrem toho, na ktorom kaster stojí (jediná „bezpečná" bunka pre súpera)
  const cells = [];
  for (let y = 0; y < game.board.h; y++)
    for (let x = 0; x < game.board.w; x++)
      if (!(x === me.x && y === me.y)) cells.push([x, y]);

  // zásah: súper dostane dmg, ak NESTOJÍ na kasterovej bunke; cez shield/mirror (applyHit) — bez 2× buffu (10 = istá smrť)
  const inRange = op && !(op.x === me.x && op.y === me.y);
  // istý zásah — prípadný labyrint sa odhalí ešte pred vynorením démona
  if (inRange) revealLabyrinths(tl);

  // démon sa vynorí veľký v strede + bliká cieľové bunky v rovnakej kadencii ako special (ultimatka)
  pushStateFrame(tl, [{ kind: "demon_summon", from: slot }], LS_APPEAR_MS);
  for (let r = 0; r < SPECIAL_REPEAT; r++) {
    pushStateFrame(tl, [{ kind: "demon_attack", from: slot, cells }], SPECIAL_BEAT_MS);
  }

  // ak súper bráni (shield alebo mirror), démon nech najprv zmizne zo stredu, nech je block/odraz animácia viditeľná
  const defended = inRange && (op.shield || op.mirror);
  if (defended) pushStateFrame(tl, [{ kind: "demon_center_out", from: slot }], SMALL_DELAY_MS);
  // súperov tieňový klon v zóne (všade okrem kasterovej bunky) — zomiera/bráni SPOLU so súperom v jednom beate
  const cloneInRange = !!(op?.clone && !(op.clone.x === me.x && op.clone.y === me.y));
  if (inRange) {
    applyHitBoth(opS, DEMON_DMG, tl, "demon", cloneInRange);
  } else if (cloneInRange) {
    applyHitOnClone(opS, DEMON_DMG, tl, "demon", false);
  } else {
    pushStateFrame(tl, [], SMALL_DELAY_MS);
  }
  if (!defended) pushStateFrame(tl, [{ kind: "demon_center_out", from: slot }], SMALL_DELAY_MS); // inak démon zmizne až po zásahu
}

// Výmena maga (len turnaj): na svojom kroku uloží živý stav odchádzajúceho maga, prehrá dvojfázový teleport
// (starý mág zmizne → nový sa objaví) a nasadí nového maga s jeho prenesenými HP/manou. Pozícia (x,y) ostáva.
// Nasledujúce akcie v tom istom kole už vykonáva nový mág (číta sa game.players[slot]).
function doSwap(slot, to, tl) {
  const me = game.players[slot];
  const person = game.seats[slot];
  const from = me.char;
  if (!game.mageHp || !rosterFor(slot).includes(to) || to === from) { pushInvalid(tl, slot, SMALL_DELAY_MS); return; }
  if ((game.mageHp[person]?.[to] ?? 0) <= 0) { pushInvalid(tl, slot, SMALL_DELAY_MS); return; }
  // labyrint mohol padnúť v tomto kole PO naplánovaní swapu (Minotaurov special skôr v poradí) —
  // počas kliatby je výmena zakázaná pre obe strany, naplánovaný swap prepadne ako invalid
  if (game.players.p1.labyrinth || game.players.p2.labyrinth) { pushInvalid(tl, slot, SMALL_DELAY_MS); return; }
  // poistka k validQueue: hráč s Last Stand buffom vo final kole nesmie swapnúť (buff sa zapína
  // až na konci aktivačného kola, takže mid-round race nehrozí — guard drží pravidlo aj do budúcna)
  if (me.lastStandBuff) { pushInvalid(tl, slot, SMALL_DELAY_MS); return; }
  // tieňový klon odchádza s Narutom (nesmie prežiť výmenu maga)
  killClone(slot, tl);
  // ulož živý stav odchádzajúceho maga (nesie sa do ďalších kôl / char-selectu ďalšej hry)
  game.mageHp[person][from] = Math.max(0, me.hp);
  game.mageMana[person][from] = Math.max(0, Math.min(MAX_MANA, me.mana));
  // (1) starý mág zmizne
  pushStateFrame(tl, [{ kind: "teleport_out", from: slot, char: from }], TELEPORT_OUT_MS);
  // prepni identitu + nasaď HP/manu nového maga
  me.char = to;
  me.pride = 0; // Escanor: nasadenie swapom začína na pride 0
  me.hp = game.mageHp[person][to];
  me.mana = game.mageMana[person][to];
  me.moon = to === "werewolf" ? moonLevelFor(me.hp) : 0; // Vlkolak: fáza HNEĎ podľa preneseného HP
  // (2) nový mág sa objaví
  pushStateFrame(tl, [{ kind: "teleport_in", from: slot, char: to }], TELEPORT_IN_MS);
}

function doAction(slot, action, tl) {
  if (!action) return;
  switch (action.type) {
    case "swap":     return doSwap(slot, action.to, tl);
    case "move":     return doMove(slot, action.dir, tl);
    case "dash":     return doDash(slot, action.dir, tl);
    case "recharge": return doRecharge(slot, tl);
    case "attack":   return doBasic(slot, action.dir, tl);
    case "melee":    return doMelee(slot, tl);
    case "special":  return doSpecial(slot, tl, action.dir, action.cell || null); // dir: Medúza/Escanor; cell: Vojak (cieľová bunka)
    case "shield":   return doShield(slot, tl);
    case "mirror":   return doMirror(slot, tl);
    case "demon":    return doDemon(slot, tl);
    default: break;
  }
}

/* -------------------- Special tiles -------------------- */
function hasTile(x, y) {
  return game.tiles.some(t => t.x === x && t.y === y);
}
function hasIK(x, y) {
  return game.iks.some(t => t.x === x && t.y === y);
}
function pickCell(filterFn) {
  const cells = [];
  for (let y = 0; y < game.board.h; y++)
    for (let x = 0; x < game.board.w; x++)
      if (filterFn(x, y)) cells.push({ x, y });
  return cells.length ? cells[Math.floor(Math.random() * cells.length)] : null;
}

// koniec ťahu: pickupy (heal/mana) a damage políčka (dmg/IK); štít tile damage neblokuje.
// stonedStep = kto bol skamenený na začiatku kroku — skamenená postava sa berie, akoby na políčku nikto nestál
// (žiadny pickup, žiadny dmg/IK), a to aj v kroku, v ktorom jej kameň práve skončil
function endOfStepTileEffects(tl, stonedStep = { p1: false, p2: false }) {
  const order = game.starter === "p1" ? ["p1", "p2"] : ["p2", "p1"];
  const stoned = (slot) => stonedStep[slot] || game.players[slot].stone > 0;

  // heal/mana — pri oboch hráčoch na rovnakom tile berie ten, kto kolo začína
  for (const slot of order) {
    const p = game.players[slot];
    if (p.hp <= 0) continue;
    if (stoned(slot)) continue;    // skamenený nezbiera
    if (hasIK(p.x, p.y)) continue; // IK prekrýva => pickup neaktívny
    const idx = game.tiles.findIndex(t => (t.type === "heal" || t.type === "mana") && t.x === p.x && t.y === p.y);
    if (idx === -1) continue;
    const tile = game.tiles[idx];
    // najprv zvýrazni vyhodnocované políčko, potom aplikuj efekt
    pushStateFrame(tl, [{ kind: "tile_proc", tile: tile.type, cell: [p.x, p.y] }], 600);
    game.tiles.splice(idx, 1); // jediné spotrebovateľné políčka
    if (tile.type === "heal") {
      const healed = Math.min(START_HP, p.hp + 1) - p.hp;
      p.hp += healed;
      if (healed > 0) {
        pushStateFrame(tl, [{ kind: "heal", target: slot, amount: healed }], SMALL_DELAY_MS);
      } else {
        pushStateFrame(tl, [], SMALL_DELAY_MS); // pri plnom HP sa spotrebuje naprázdno
      }
    } else {
      const gained = MAX_MANA - p.mana;
      p.mana = MAX_MANA;
      if (gained > 0) {
        pushStateFrame(tl, [{ kind: "recharge", from: slot, cells: [[p.x, p.y]], amount: gained }], SMALL_DELAY_MS);
      } else {
        pushStateFrame(tl, [], SMALL_DELAY_MS); // pri plnej mane sa spotrebuje naprázdno
      }
    }
  }

  // dmg / IK
  for (const slot of order) {
    const p = game.players[slot];
    if (p.hp <= 0) continue;
    if (stoned(slot)) continue; // na skamenenú postavu sa tile dmg/IK nevyhodnocuje
    // (kaster labyrintu dostáva tile dmg/IK normálne ako mimo labyrintu — mazeBuff už nedáva imunitu na dlaždice)
    let dmg = 0, tileType = null;
    if (hasIK(p.x, p.y)) { dmg = 10; tileType = "ik"; }
    else if (game.tiles.some(t => t.type === "dmg" && t.x === p.x && t.y === p.y)) { dmg = 1; tileType = "dmg"; }
    if (dmg > 0) {
      const d = recvDmg(slot, dmg);
      // tile dmg labyrint bežne NEkončí — výnimka je smrteľný zásah: pred finálnym dmg sa prehrá
      // rovnaká postupnosť ako pri akciovom zásahu (reveal PRED animáciou, koniec labyrintu po hite),
      // aby smrť nepadla v hmle a hra neskončila s aktívnou redakciou
      const lethalInLab = d >= p.hp && (game.players.p1.labyrinth || game.players.p2.labyrinth);
      if (lethalInLab) revealLabyrinths(tl);
      // najprv zvýrazni vyhodnocované políčko, potom zásah (½ ak má hráč last stand buff — platí aj na tile/IK)
      pushStateFrame(tl, [{ kind: "tile_proc", tile: tileType, cell: [p.x, p.y] }], 600);
      p.hp = Math.max(0, p.hp - d);
      pushStateFrame(tl, [{ kind: "hit", target: slot, dmg: d }], SMALL_DELAY_MS);
      if (lethalInLab) endLabyrinths(tl);
      // prvý mŕtvy okamžite ukončuje hru — druhý tile zásah sa už nevyhodnotí (remíza nemôže nastať)
      if (winnerNow()) return;
    }
  }

  // tieňové klony: heal/mana IGNORUJÚ (neberú — nespotrebovaný pickup pod „postavou" klona prezrádza),
  // dmg tile ukáže kozmetický -1 (klona nezabíja), IK tile klona ZNIČÍ (tile dmg labyrint nekončí)
  for (const slot of order) {
    const p = game.players[slot];
    if (!p.clone) continue;
    const { x, y } = p.clone;
    if (hasIK(x, y)) {
      pushStateFrame(tl, [{ kind: "tile_proc", tile: "ik", cell: [x, y] }], 600);
      killClone(slot, tl);
    } else if (game.tiles.some(t => t.type === "dmg" && t.x === x && t.y === y)) {
      // rovnaká dramaturgia ako pri hráčovom tile zásahu: NAJPRV rozsvieť políčko (vlastný frame),
      // až POTOM kozmetický zásah na klonovi — inak sa blik políčka „stratí" v spoločnom frame
      pushStateFrame(tl, [{ kind: "tile_proc", tile: "dmg", cell: [x, y] }], 600);
      pushStateFrame(tl, [{ kind: "clone_hit", target: slot, cell: [x, y], dmg: 1 }], SMALL_DELAY_MS);
    }
  }
}

// vyber typ tile podľa percentuálnych váh (dmg/heal/mana/ik, spolu ~100); null ak sú všetky 0
function rollTileType(weights) {
  const order = ["dmg", "heal", "mana", "ik"];
  const total = order.reduce((a, k) => a + Math.max(0, weights?.[k] || 0), 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const k of order) {
    r -= Math.max(0, weights?.[k] || 0);
    if (r < 0) return k;
  }
  return order[order.length - 1];
}

// presunie každý existujúci IK na nové políčko; dva IK nesmú skončiť na rovnakom (ostatné tiles a hráči nevadia)
function relocateIKs() {
  const placed = [];
  for (const ik of game.iks) {
    const c = pickCell((x, y) => !placed.some(p => p.x === x && p.y === y));
    placed.push(c || ik); // bez voľného políčka ostane na mieste
  }
  game.iks = placed;
}

// koniec kola: presun IK + spawn tilesPerRound nových tiles podľa percentuálnych váh
function endOfRoundTiles() {
  if (!game.config) return;
  relocateIKs();

  const n = Math.max(1, Math.min(3, game.config.tilesPerRound || 1));
  for (let k = 0; k < n; k++) {
    const type = rollTileType(game.config.tileWeights);
    if (!type) break;
    if (type === "ik") {
      // IK môže vzniknúť hocikde (aj pod hráčom, aj nad iným tile); len nie na inom IK
      const c = pickCell((x, y) => !hasIK(x, y));
      if (c) game.iks.push(c);
    } else {
      // môže byť aj pod hráčom; nie na existujúcom tile ani pod IK; bez voľného políčka sa spawn preskočí
      const c = pickCell((x, y) => !hasTile(x, y) && !hasIK(x, y));
      if (c) game.tiles.push({ x: c.x, y: c.y, type });
    }
  }
}

/* -------------------- Turn timer (server-side enforcement) -------------------- */
// časovač beží na serveri (nezávisle od fokusu tabu); klient si robí len vlastný displej + skorší auto-lock.
// backstop tu garantuje, že kolo sa vyhodnotí, aj keď je niektorý tab na pozadí (throttle rAF) alebo odpojený.
const QUICKDRAW_MS = 10000;
const TIMER_GRACE_MS = 2500; // server strieľa o čosi neskôr než klient, nech foreground tab stihne auto-lock s rozpracovanou frontou
let turnTimer = null;
let turnDeadline = null; // Date.now() času, kedy má klient odpočítavať/auto-locknúť (bez grace); zdieľané s klientom

function timerRemainingMs() { return turnDeadline ? Math.max(0, turnDeadline - Date.now()) : null; }

function clearTurnTimer() {
  if (turnTimer) { clearTimeout(turnTimer); turnTimer = null; }
  turnDeadline = null;
  io.emit("turn_timer", { ms: null });
}

// platná základná akcia? (move/attack/dash potrebujú smer); allowDemon = buffnutý hráč smie navoliť aj démon útok
function validBasicAction(a, used, allowDemon = false) {
  if (!a) return false;
  const known = ACTION_TYPES.has(a.type) || (allowDemon && a.type === "demon");
  if (!known || used.has(a.type)) return false;
  if ((a.type === "move" || a.type === "attack" || a.type === "dash") && !MOVE_DIRS.has(a.dir)) return false;
  return true;
}
// hráč, ktorý sa nestihol locknúť: zachová svoju rozpracovanú frontu (draft) a chýbajúce do 3 doplní náhodne
// exclude = typy, ktoré už pokrýva golden predťah (shield pri golden_shield, mirror pri golden_mirror) —
// nesmú sa pridať ani z draftu, ani z náhodného doplnenia (inak by sa akcia zahrala 2× za kolo)
function fillFromDraft(draftQueue, exclude = new Set(), allowDemon = false, limit = 3, char = null, slot = null) {
  const q = [], used = new Set(exclude);
  for (const a of (Array.isArray(draftQueue) ? draftQueue : [])) {
    if (q.length >= limit) break;
    if (!validBasicAction(a, used, allowDemon)) continue;
    q.push({ type: a.type, dir: a.dir || null, cell: a.cell || null }); // cell = cieľ Vojakovho specialu
    used.add(a.type);
  }
  const pool = [...ACTION_TYPES].filter(t => !used.has(t));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const dirs = [...MOVE_DIRS];
  while (q.length < limit && pool.length) {
    const t = pool.shift();
    if (t === "move" || t === "attack" || t === "dash") q.push({ type: t, dir: dirs[Math.floor(Math.random() * dirs.length)] });
    else if (t === "special" && (char === "medusa" || char === "escanor")) q.push({ type: t, dir: Math.random() < 0.5 ? "left" : "right" }); // Medúzin/Escanorov special potrebuje smer
    else if (t === "special" && char === "werewolf") q.push({ type: t, dir: WOLF_DIR_KEYS[Math.floor(Math.random() * WOLF_DIR_KEYS.length)] }); // Vlkolakov charge — náhodný z 8 smerov
    else if (t === "special" && char === "soldier") q.push({ type: t, cell: randomSoldierTarget(slot) }); // Vojakov special potrebuje cieľovú bunku
    else q.push({ type: t });
  }
  return q;
}

// náhodná platná cieľová bunka Vojakovho specialu (timeout auto-fill) — rovnaké pravidlá ako validQueue:
// nie vlastná bunka, nie súperova figúra ani jeho klon (v labyrinte prekliateho sa súper neblokuje)
function randomSoldierTarget(slot) {
  const meP = slot ? game.players[slot] : null;
  const foe = slot ? game.players[other(slot)] : null;
  const c = pickCell((x, y) => {
    if (meP && meP.x === x && meP.y === y) return false;
    if (meP && !meP.labyrinth && foe) {
      if (foe.x === x && foe.y === y) return false;
      if (foe.clone && foe.clone.x === x && foe.clone.y === y) return false;
    }
    return true;
  });
  return c ? { x: c.x, y: c.y } : null;
}

// naplánuj backstop pre práve začínajúce kolo; extraMs = čas, kým klient dohrá timeline (počas neho neplánuje)
function beginPlanningTimer(extraMs = 0) {
  const t = game.config?.timer;
  if (t === "10" || t === "30" || t === "60") {
    armTurnTimer(extraMs + parseInt(t, 10) * 1000);
  } else {
    clearTurnTimer(); // "off"/"quickdraw" -> teraz žiadny limit (quickdraw sa nasadí až po locku)
  }
}
// intendedMs = čas, ktorý klient odpočítava a po ktorom auto-lockne; server backstop strieľa o grace neskôr
function armTurnTimer(intendedMs) {
  if (turnTimer) clearTimeout(turnTimer);
  turnDeadline = Date.now() + intendedMs;
  turnTimer = setTimeout(onTurnTimeout, intendedMs + TIMER_GRACE_MS);
  io.emit("turn_timer", { ms: intendedMs });
}

function onTurnTimeout() {
  turnTimer = null;
  turnDeadline = null;
  if (game.phase !== "playing") return;
  if (!game.players.p1.char || !game.players.p2.char) return;
  for (const slot of ["p1", "p2"]) {
    const p = game.players[slot];
    if (p.locked) continue;
    // gold zachovaj len keď si ho navolil; vyhodnoť pred frontou, nech vieš, čo z nej vylúčiť
    p.golden = !!p.draft?.golden && slot !== game.starter; // golden shield len pre nestartéra
    p.goldenMirror = !!p.draft?.goldenMirror && slot !== game.starter; // golden mirror tiež len pre nestartéra
    // duálny gold button (mana/last stand) je v poslednom buffnutom kole zamknutý pre oboch
    const goldLocked = game.players.p1.lastStandBuff || game.players.p2.lastStandBuff;
    p.goldenMana = !goldLocked && !!p.draft?.goldenMana;
    p.lastStand  = !goldLocked && !!p.draft?.lastStand && !p.goldenMana; // výlučné s golden mana
    // Last Hope — len nebuffnutý hráč vo final kole; nikdy sa nedopĺňa náhodne, len ak ho hráč navolil
    p.lastHope   = goldLocked && !p.lastStandBuff && !!p.draft?.lastHope;
    // zahraj, čo má hráč rozpracované (draft), chýbajúce do 3 doplň náhodne — bez akcie, ktorú už pokrýva golden
    const exclude = new Set();
    if (p.golden) exclude.add("shield");
    if (p.goldenMirror) exclude.add("mirror");
    // skamenené sloty na začiatku kola sú pevné pass ťahy — dopĺňa sa len zvyšok
    const stone = Math.min(3, p.stone || 0);
    p.queue = [
      ...Array.from({ length: stone }, () => ({ type: "stoned" })),
      ...fillFromDraft(p.draft?.queue, exclude, !!p.lastStandBuff, 3 - stone, p.char, slot),
    ];
    p.locked = true;
  }
  if (game.players.p1.locked && game.players.p2.locked) resolveTurn();
  else emitStateMasked(); // labyrint: prekliaty nesmie dostať súperovu pozíciu ani tu
}

/* -------------------- Last Stand (frame-driven) -------------------- */
// pomocné: plynulé prepísanie HP+many cez zopár frame-ov (HUD sa hýbe zo snapshotov)
function lsTweenFrames(slot, toHp, toMana, totalMs, kind, tl) {
  const p = game.players[slot];
  const fromHp = p.hp, fromMana = p.mana, steps = 4;
  for (let s = 1; s <= steps; s++) {
    p.hp   = Math.round(fromHp   + (toHp   - fromHp)   * (s / steps));
    p.mana = Math.round(fromMana + (toMana - fromMana) * (s / steps));
    pushStateFrame(tl, [{ kind, target: slot }], Math.round(totalMs / steps));
  }
  p.hp = toHp; p.mana = toMana;
}

// summon: démon v strede → odčerpá HP/manu na 0 → smrť → objaví sa za postavou → zlaté dvíhanie na 10 → usadenie.
// buff+doom (a tým golden stav na klientovi) sa zapnú až vo fáze „revive" (po smrti), nie počas umierania.
function resolveLastStandSummon(slot, tl) {
  const p = game.players[slot];
  pushStateFrame(tl, [{ kind: "last_stand_summon", from: slot }], LS_APPEAR_MS); // démon v strede (HP ešte plné)
  lsTweenFrames(slot, 0, 0, LS_DRAIN_MS, "last_stand_drain", tl);                 // HP+mana → 0
  p.down = true;                                                                  // hráč padá mŕtvy (leží až do settle)
  pushStateFrame(tl, [{ kind: "last_stand_kill", from: slot }], LS_KILL_MS);     // smrť + démon zmizne zo stredu
  killClone(slot, tl);                                                           // Naruto zomrel → klon zaniká HNEĎ pri smrti (pred vzkriesením)
  p.lastStandBuff = true; p.lastStandDoom = true;                                 // od TERAZ golden stav + buff/doom
  pushStateFrame(tl, [{ kind: "last_stand_revive", from: slot }], LS_REVIVE_MS); // démon sa objaví za postavou (0→1)
  lsTweenFrames(slot, START_HP, MAX_MANA, LS_RISE_MS, "last_stand_rise", tl);     // HP+mana 0 → 10 (zlaté), hráč stále leží
  p.down = false;                                                                 // pri 10/10 hráč vstane
  pushStateFrame(tl, [{ kind: "last_stand_settle", from: slot }], LS_SETTLE_MS); // démon → 0.25, hráč vstane
}

// Last Hope summon: červená „hope" postava v strede → HP padne na 1, mana sa naplní na 10 → postava zmizne, ultra mód (4×) ostáva.
function resolveLastHopeSummon(slot, tl) {
  const p = game.players[slot];
  p.lastHopeBuff = true;                                                          // ultra mód HNEĎ → mana začne pulzovať červeno ešte pred doplnením
  pushStateFrame(tl, [{ kind: "last_hope_summon", from: slot }], LH_APPEAR_MS); // hope postava v strede (mana už červená)
  lsTweenFrames(slot, 1, MAX_MANA, LH_DRAIN_MS, "last_hope_drain", tl);          // až POTOM HP→1, mana→10 (pulzuje červeno počas dopĺňania)
  pushStateFrame(tl, [{ kind: "last_hope_settle", from: slot }], LH_SETTLE_MS);  // postava zmizne, červený mód zostáva
}

// banish: golden OFF → duch zosilnie a odíde z postavy → objaví sa v strede → odčerpá HP/manu na 0 → smrť.
function resolveLastStandBanish(slot, tl) {
  const p = game.players[slot];
  pushStateFrame(tl, [{ kind: "last_stand_banish", from: slot }], LS_B_LEAVE_MS);         // golden off + duch odíde
  pushStateFrame(tl, [{ kind: "last_stand_banish_center", from: slot }], LS_B_CENTER_MS); // duch v strede
  lsTweenFrames(slot, 0, 0, LS_B_DRAIN_MS, "last_stand_drain", tl);                        // HP+mana → 0 (smrť; bez záverečného „hit" → žiadne červené bliknutie/−10 HP)
  p.down = true;                                                                           // hráč padá mŕtvy
  killClone(slot, tl);                                                                     // Naruto zomrel (doom) → klon zaniká
  pushStateFrame(tl, [{ kind: "last_stand_banish_kill", from: slot }], LS_B_KILL_MS);     // démon zmizne, hráč leží mŕtvy
}

/* -------------------- Turn resolution -------------------- */
function resolveTurn() {
  clearTurnTimer();
  const tl = [];
  // prvý „nulový“ frame pre hladký začiatok
  pushStateFrame(tl, [], 10);

  const order = game.starter === "p1" ? ["p1","p2"] : ["p2","p1"];
  let ended = false;
  // Escanor pride: zachyť PRED spracovaním, či daný Escanor v tomto kole použil shield/mirror/golden shield/mirror
  // (fronta aj golden flagy sa počas kola menia/miznú). Na konci kola: použil → −1, inak → +1.
  const escUsedDefense = {};
  for (const slot of ["p1", "p2"]) {
    const p = game.players[slot];
    if (p.char !== "escanor") continue;
    escUsedDefense[slot] = !!p.golden || !!p.goldenMirror ||
      (p.queue || []).some(a => a && (a.type === "shield" || a.type === "mirror"));
  }
  // doom: zachyť na začiatku kola — true len v buffnutom (poslednom) kole, NIE v aktivačnom (vtedy sa nastaví až v gold fáze)
  const doomSlot = game.players.p1.lastStandDoom ? "p1" : game.players.p2.lastStandDoom ? "p2" : null;

  // Last Hope — úvodná akcia NEbuffnutého hráča vo final kole, vyhodnotená PRED golden shield/mirror.
  // Týka sa len final kola (niekto má lastStandBuff); pre nebuffnutého buď zahranie, alebo prázdny beat (kurzor cezeň prejde).
  if (game.players.p1.lastStandBuff || game.players.p2.lastStandBuff) {
    for (const slot of order) {
      const p = game.players[slot];
      if (p.lastStandBuff) continue; // buffnutý hráč Last Hope nemá (má démon útok)
      if (p.lastHope) {
        p.lastHope = false;
        pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: "last_hope", dir: null } }], 250);
        // skamenený hráč: zlaté akcie sa nevykonajú (bez ceny) a kameň NEuberajú
        if (p.stone > 0) { pushStateFrame(tl, [{ kind: "stoned", target: slot }], SMALL_DELAY_MS); continue; }
        resolveLastHopeSummon(slot, tl);
      } else {
        pushStateFrame(tl, [{ kind: "beat_empty", from: slot, beat: "lhope" }], ACTION_GAP_MS);
      }
    }
  }

  // golden shield / golden mirror — extra predťah hráča, ktorý je v kole druhý, vyhodnotený pred prvou akciou startera
  const second = order[1];
  if (game.players[second].golden || game.players[second].goldenMirror) {
    const gp = game.players[second];
    const isMirror = gp.goldenMirror;
    const cost = isMirror ? GOLDEN_MIRROR_COST : GOLDEN_COST;
    const type = isMirror ? "golden_mirror" : "golden_shield";
    pushStateFrame(tl, [{ kind: "action", from: second, action: { type, dir: null } }], 250);
    if (gp.stone > 0) {
      // skamenený hráč: zlatý predťah sa nevykoná (mana ostáva) a kameň NEuberá
      pushStateFrame(tl, [{ kind: "stoned", target: second }], SMALL_DELAY_MS);
    } else if (gp.mana >= cost) {
      gp.mana -= cost;
      if (isMirror) {
        gp.mirror = true;
        gp.mirrorGold = true;
        pushStateFrame(tl, [{ kind: "golden_mirror", from: second }], SMALL_DELAY_MS);
      } else {
        gp.shield = true;
        gp.shieldGold = true;
        pushStateFrame(tl, [{ kind: "golden_shield", from: second }], SMALL_DELAY_MS);
      }
    } else {
      pushInvalid(tl, second, SMALL_DELAY_MS, "mana");
    }
    gp.golden = false;
    gp.goldenMirror = false;
    pushStateFrame(tl, [], ACTION_GAP_MS); // oddeľ predťah od prvej akcie startera
  } else {
    // prázdny golden shield/mirror beat — zelená šípka cezeň prekrokuje (rovnako ako prázdny golden mana)
    pushStateFrame(tl, [{ kind: "beat_empty", from: second, beat: "gpre" }], ACTION_GAP_MS);
  }

  outer:
  for (let i = 0; i < 3; i++) {
    // skamenenie chráni pred tile efektmi počas CELÉHO kroku, v ktorom padol aj posledný skamenený ťah
    // (odkamenenie je „na konci ťahu" — tiles sa začnú vyhodnocovať až od nasledujúceho kroku)
    const stonedStep = { p1: game.players.p1.stone > 0, p2: game.players.p2.stone > 0 };
    const tookStoned = { p1: false, p2: false }; // kto v tomto kroku odohral skamenený pass
    for (const slot of order) {
      const meP = game.players[slot];
      if (meP.stone > 0) {
        // skamenený ťah: akcia sa preskočí (bez many) a NEspotrebuje súperovu obranu.
        // Kameň sa NEuberá teraz — až na KONCI kroku (nižšie), aby socha vizuálne vydržala celý tento krok
        // vrátane vyhodnotenia jeho dlaždíc; odkamenenie sa tak prejaví až na začiatku NASLEDUJÚCEJ akcie
        // (predtým socha zmizla už pri „STONED" float 2. akcie, hoci dlaždica pod hráčom sa ešte netriggerovala).
        tookStoned[slot] = true;
        pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: "stoned", dir: null, to: null } }], 250);
        pushStateFrame(tl, [{ kind: "stoned", target: slot }], SMALL_DELAY_MS);
        pushStateFrame(tl, [], ACTION_GAP_MS);
        continue;
      }
      const foe = other(slot);
      // obrany kryjú práve túto (najbližšiu) súperovu akciu — spotrebujú sa ňou aj bez zásahu
      const foeShieldArmed = game.players[foe].shield;
      const foeMirrorArmed = game.players[foe].mirror;
      const act = meP.queue[i];
      // ohlás akciu klientovi (záznam kola pod HUD widgetom)
      if (act) pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: act.type, dir: act.dir || null, to: act.to || null } }], 250);
      doAction(slot, act, tl);
      if (foeShieldArmed) { game.players[foe].shield = false; game.players[foe].shieldGold = false; }
      if (foeMirrorArmed) { game.players[foe].mirror = false; game.players[foe].mirrorGold = false; }

      // po každej akcii skontroluj lethal
      const w = winnerNow();
      if (w) { ended = true; break outer; }
      // krátka pokojová pauza medzi akciami, nech oko stihne zaregistrovať každý ťah
      pushStateFrame(tl, [], ACTION_GAP_MS);
    }

    // koniec ťahu — efekty špeciálnych políčok (pickupy, dmg, IK)
    endOfStepTileEffects(tl, stonedStep);
    // až TERAZ ubudni kameň za skamenené passy tohto kroku — socha (kreslená zo state.stone) tak zmizne
    // až v ďalšom kroku, čiže vizuálne na začiatku nasledujúcej akcie, keď sa dlaždice pod hráčom spustia
    for (const slot of order) {
      if (!tookStoned[slot] || game.players[slot].stone <= 0) continue;
      game.players[slot].stone--;
      // posledný kameň odišiel → socha sa roztrieští (klient vykreslí kamenné úlomky, nie len preblik)
      if (game.players[slot].stone === 0) pushStateFrame(tl, [{ kind: "unpetrify", target: slot }], SMALL_DELAY_MS);
    }
    if (winnerNow()) { ended = true; break outer; }
  }

  // koniec hry: tieňové klony miznú (aj pri výhre majiteľa) — poof po dohraní smrteľného zásahu
  if (ended) { killClone("p1", tl); killClone("p2", tl); }

  // Escanor pride: koniec kola — použil obranu → −1, inak → +1 (clamp 0–3). Prejaví sa v nasledujúcom kole.
  for (const slot of ["p1", "p2"]) {
    const p = game.players[slot];
    if (p.char !== "escanor" || !(slot in escUsedDefense)) continue;
    p.pride = Math.max(0, Math.min(3, (p.pride || 0) + (escUsedDefense[slot] ? -1 : 1)));
  }

  // nevyužité obrany zanikajú s koncom kola
  game.players.p1.shield = false;
  game.players.p2.shield = false;
  game.players.p1.shieldGold = false;
  game.players.p2.shieldGold = false;
  game.players.p1.mirror = false;
  game.players.p2.mirror = false;
  game.players.p1.mirrorGold = false;
  game.players.p2.mirrorGold = false;

  if (!ended) {
    // koniec kola — presun IK a spawn nového tile (vidno ich vo finálnom frame)
    endOfRoundTiles();

    // post-round gold fáza: golden mana + last stand. Démon je len JEDEN — ak ho navolia obaja,
    // vyhodnotí sa len tomu, koho akcia príde na rad prvá (starter), druhému červený ✗.
    let demonUsed = false;
    for (const slot of order) {
      const p = game.players[slot];
      if (p.lastStand) {
        p.lastStand = false;
        pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: "last_stand", dir: null } }], 250);
        // skamenený hráč: zlatá akcia sa nevykoná (bez ceny) a kameň NEuberá
        if (p.stone > 0) { pushStateFrame(tl, [{ kind: "stoned", target: slot }], SMALL_DELAY_MS); continue; }
        if (demonUsed) { pushInvalid(tl, slot, SMALL_DELAY_MS, "no_demon"); continue; }
        demonUsed = true;
        resolveLastStandSummon(slot, tl); // démon zabije + oživí na plno, nastaví buff + doom na ďalšie kolo
        continue;
      }
      if (!p.goldenMana) {
        // prázdny golden-mana beat — zelená šípka cezeň prekrokuje s prázdnym počkaním (nie preskočenie).
        // V buffnutom poslednom kole (doomSlot) to nerobíme — tam je démon „end" bunka + banish.
        if (!doomSlot) pushStateFrame(tl, [{ kind: "beat_empty", from: slot, beat: "gmana" }], ACTION_GAP_MS);
        continue;
      }
      p.goldenMana = false;
      const cost = p.manaRefills + 1;
      pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: "golden_mana", dir: null } }], 250);
      // skamenený hráč: zlatá akcia sa nevykoná (bez ceny) a kameň NEuberá
      if (p.stone > 0) { pushStateFrame(tl, [{ kind: "stoned", target: slot }], SMALL_DELAY_MS); continue; }
      // refill nesmie hráča zabiť a pri plnej mane je naprázdno -> neplatný
      if (p.hp > cost && p.mana < MAX_MANA) {
        p.hp -= cost;
        const gained = Math.min(GOLDEN_MANA_GAIN, MAX_MANA - p.mana);
        p.mana += gained;
        p.manaRefills++;
        pushStateFrame(tl, [{ kind: "golden_mana", from: slot, hpCost: cost, gained }], SMALL_DELAY_MS);
      } else {
        // odmietnutý refill: plná mana (naprázdno) alebo by bol smrteľný
        pushInvalid(tl, slot, SMALL_DELAY_MS, p.mana >= MAX_MANA ? "mana_full" : "hp_low");
      }
    }

    // DOOM: ak je toto buffnuté (posledné) kolo a obaja stále žijú → démon Last Stand hráča opustí a zabije ho.
    // Banish je istá smrť = koniec hry — ak beží labyrint, prehraj rovnakú sekvenciu ako pri istom zásahu:
    // odhalenie PRED banish animáciou, koniec labyrintu (ESCAPED + rozsvietenie) po smrti — hra nesmie
    // skončiť v hmle/redakcii (rovnaké pravidlo ako smrteľný tile/IK zásah)
    if (doomSlot && !winnerNow()) {
      const labActive = game.players.p1.labyrinth || game.players.p2.labyrinth;
      if (labActive) revealLabyrinths(tl);
      resolveLastStandBanish(doomSlot, tl);
      if (labActive) endLabyrinths(tl);
      ended = true;
    }
  }

  if (!ended) {
    // Vlkolak: fáza mesiaca sa prepočíta na KONCI kola z aktuálnych HP (po tiles, golden mane aj Last Stand
    // full-heale) — nesie ju až finálny frame; klient porovná prvý/posledný frame a ukáže float s novou fázou.
    for (const slot of ["p1", "p2"]) {
      const p = game.players[slot];
      if (p.char === "werewolf") p.moon = moonLevelFor(p.hp);
    }

    // bežný prechod do ďalšieho kola (mini-frame posúva HUD dopredu)
    const nextTurn    = game.turn + 1;
    const nextStarter = game.starter === "p1" ? "p2" : "p1"; // preklop (hru mohol začínať aj p2)
    tl.push({ ...snapshot(), turn: nextTurn, starter: nextStarter, effects: [], delayMs: 10 });
    game.turn    = nextTurn;
    game.starter = nextStarter;
  }

  emitStateMasked(tl); // per-osoba: labyrintová redakcia snapshotu AJ timeline (roster HP/mana je verejné)

  // príprava na ďalšie plánovanie (lokálny stav; vizuálne odomkne až klient po dohraní timeline)
  game.players.p1.locked = false;
  game.players.p2.locked = false;
  game.players.p1.queue = [];
  game.players.p2.queue = [];
  game.players.p1.goldenMana = false; // nevyhodnotený refill (ukončené kolo) prepadá
  game.players.p2.goldenMana = false;
  game.players.p1.goldenMirror = false;
  game.players.p2.goldenMirror = false;
  game.players.p1.lastStand = false; // nevyhodnotený last stand prepadá (buff/doom NEresetujeme — nesú sa do posledného kola)
  game.players.p2.lastStand = false;
  game.players.p1.lastHope = false; // nevyhodnotený last hope prepadá (buff platí len v rozohranom final kole, hra ním aj tak končí)
  game.players.p2.lastHope = false;
  game.players.p1.draft = { queue: [], golden: false, goldenMirror: false, goldenMana: false, lastStand: false, lastHope: false };
  game.players.p2.draft = { queue: [], golden: false, goldenMirror: false, goldenMana: false, lastStand: false, lastHope: false };

  const dur = tl.reduce((a, f) => a + (f.delayMs || 0), 0);
  if (ended) {
    handleGameEnd(dur);
  } else {
    // ďalšie kolo: backstop začne až po čase, kým klient dohrá timeline (počas neho neplánuje)
    beginPlanningTimer(dur);
  }
}

// koniec jednej hry: zapíš výhru do série; ak je séria rozhodnutá -> match_over,
// inak po dohraní timeline (na klientovi) spusti ďalšiu hru (strany ostávajú fixné, nový char-select)
function handleGameEnd(timelineDurationMs) {
  clearTurnTimer();
  const w = winnerNow(); // "p1" | "p2" | "draw"
  // tournament: ulož aktuálne HP a manu oboch nasadených magov (porazeného mág padne na 0 = trvalo mŕtvy)
  if (game.mageHp) {
    for (const slot of ["p1", "p2"]) {
      const p = game.players[slot];
      const person = game.seats[slot];
      if (p?.char && game.mageHp[person]) {
        game.mageHp[person][p.char] = Math.max(0, p.hp);
        if (game.mageMana[person]) game.mageMana[person][p.char] = Math.max(0, Math.min(MAX_MANA, p.mana));
      }
    }
  }
  let winnerPerson = null;
  if (w === "p1" || w === "p2") {
    winnerPerson = game.seats[w];
    game.seriesWins[winnerPerson] = (game.seriesWins[winnerPerson] || 0) + 1;
  }
  const matchOver = !!winnerPerson && game.seriesWins[winnerPerson] >= game.series.needed;

  // game_result dostanú obaja — klient ho vyhodnotí až na konci prehrávania timeline
  io.emit("game_result", { gameWinner: w, series: seriesSnapshot(), matchOver });

  if (matchOver) {
    game.phase = "match_over";
    io.emit("game_over", { winner: w, series: seriesSnapshot() }); // séria skončila
  } else {
    // medzihra: počkaj, kým klient dohrá timeline + animáciu smrti + zobrazí skóre, potom ďalšia hra.
    // Guard na identitu hry: retry/admin reset medzitým vytvorí NOVÝ game objekt — stale časovač
    // z opustenej série sa vtedy zahodí (inak by o desiatky sekúnd resetol postavy a startera
    // úplne inej rozbehnutej hry).
    const forGame = game;
    setTimeout(() => {
      if (game !== forGame) return;
      io.emit("new_game", { series: seriesSnapshot() });
      startGame(game.series.gameIndex + 1);
    }, (timelineDurationMs || 0) + 6500);
  }
}

/* -------------------- Match / game start -------------------- */
function startMatch(config) {
  game.config = config;
  // BIELY (p1, vľavo) začína hru 1 — náhodné je, KTO je biely: osoby A/B sa vylosujú na sloty
  // ešte PRED animáciou ruletky na klientovi (color_roll nižšie je už len divadlo s hotovým výsledkom).
  // FORCE_FIRST_STARTER=A|B pripne osobu na p1/bieleho (testy). Sloty sú fixné na celú sériu;
  // v sérii (bo3/tournament) sa štartér jednotlivých hier strieda (viď startGame).
  const white = FORCE_FIRST_STARTER || (Math.random() < 0.5 ? "A" : "B");
  game.seats = { p1: white, p2: otherPerson(white) };
  game.series = {
    gameIndex: 0,
    needed: MATCH_FORMATS[config.format] || 1,
    format: config.format,
  };
  game.seriesWins = { A: 0, B: 0 };
  game.roster = null;
  game.mageHp = null;
  game.mageMana = null;
  if (config.format === "tournament") {
    // slepý draft tímov: pred hrou 1 si každý vyberie TEAM_SIZE postáv z celého poolu (choose_team);
    // mageHp/mageMana vzniknú až po potvrdení oboch (finishTeamSelect → startGame(1))
    game.roster = { A: null, B: null };
    game.phase = "team_select";
    emitYouAre();
    emitStateMasked();
  } else {
    startGame(1);
  }
  // ruleta farieb: pridelenie slotov je hotové (you_are už odišlo) — klient len prehrá točiacu sa
  // strelku na yin-yang kruhu, ktorá skončí na farbe hráča (p1 = biely, p2 = čierny); v turnaji
  // sa točí NAD team-selectom (draft čaká pod ňou, kým dobehne)
  io.emit("color_roll", {});
}

// oba tímy potvrdené → HP a mana každého draftnutého maga štartujú na plno / na START_MANA
// a prenášajú sa medzi hrami série
function finishTeamSelect() {
  game.mageHp = { A: fullMage(START_HP, game.roster.A), B: fullMage(START_HP, game.roster.B) };
  game.mageMana = { A: fullMage(START_MANA, game.roster.A), B: fullMage(START_MANA, game.roster.B) };
  startGame(1);
}

function fullMage(value, roster) {
  const m = {};
  for (const k of roster) m[k] = value;
  return m;
}

// pripraví novú hru v sérii: strany sú FIXNÉ na celú sériu (vylosované v startMatch; p1 = biely vľavo).
// Hru 1 začína VŽDY biely (p1); v sérii (bo3/tournament) sa štartér hier strieda — hru 2 otvára čierny (p2).
// Resetne hráčov a vyčistí postavy (char-select pred každou hrou).
function startGame(gameIndex) {
  clearTurnTimer();
  game.series.gameIndex = gameIndex;

  game.players.p1 = newPlayer("p1");
  game.players.p2 = newPlayer("p2");
  game.turn = 1;
  game.starter = (gameIndex % 2 === 1) ? "p1" : "p2"; // nepárne hry otvára biely, párne čierny; v rámci hry sa štartér kola preklápa
  game.tiles = [];
  game.iks = [];
  game.phase = "playing";

  emitYouAre();
  emitStateMasked(); // char-select potrebuje per-osoba mageHp (tournament)
}

// očisti a zvaliduj nastavenia z lobby; pri nezmysle vráti null
function sanitizeConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  const format = MATCH_FORMATS[raw.format] ? raw.format : null;
  if (!format) return null;
  const timer = TIMER_OPTIONS.has(String(raw.timer)) ? String(raw.timer) : "off";
  const perRound = Math.max(1, Math.min(3, Math.round(Number(raw.tilesPerRound) || 1)));
  const w = raw.tileWeights || {};
  const weights = {};
  let sum = 0;
  for (const k of ["dmg", "heal", "mana", "ik"]) {
    const v = Math.max(0, Math.round(Number(w[k]) || 0));
    weights[k] = v; sum += v;
  }
  if (sum !== 100) return null; // percentá musia dať presne 100
  return { format, tilesPerRound: perRound, tileWeights: weights, timer };
}

/* -------------------- Admin endpoint -------------------- */
app.get("/admin/reset-all", (req, res) => {
  if (!okAdmin(req.query.key)) return res.status(403).send("forbidden");
  forceResetAll();
  res.send("ok");
});

/* -------------------- IO -------------------- */
io.on("connection", (socket) => {
  // identita = osoba A/B (A = host); slot je fixný na celú sériu (A=p1, B=p2)
  const cid = socket.handshake.auth?.id || null; // trvalý token klienta (localStorage)
  let person = null;
  // 1) reclaim: tento token už patrí hráčovi → vráť mu jeho slot (aj keď ho ešte drží mŕtvy socket / beží grace)
  if (cid && personIds.A === cid) person = "A";
  else if (cid && personIds.B === cid) person = "B";
  // 2) inak obsaď voľný slot — voľný = bez živého socketu A po uplynutí grace pôvodného hráča
  if (!person) {
    const now = Date.now();
    const isFree = (p) => !personSockets[p] && (!personIds[p] || now - personFreedAt[p] > RECLAIM_GRACE_MS);
    if (isFree("A")) person = "A";
    else if (isFree("B")) person = "B";
  }
  if (person) {
    const old = personSockets[person];
    if (old && old !== socket) { try { old.disconnect(true); } catch {} } // odpoj mŕtvy/starý socket toho istého hráča
    personSockets[person] = socket;
    personIds[person] = cid; // zapamätaj token (pri reclaime ten istý, pri novom hráčovi nový)
  }
  socket.data.person = person;

  if (person) socket.emit("you_are", { slot: slotForPerson(person), isHost: person === "A" });
  else socket.emit("spectator"); // obe osoby obsadené — tretí a ďalší len dostanú info, že hra beží
  socket.emit("state", person ? snapshotFor(person) : snapshot()); // pri pripojení počas char-selectu maskuj súperov pick

  // úvodná obrazovka: host nastaví formát + tiles + časový limit a spustí zápas
  socket.on("configure_match", (raw) => {
    if (person !== "A") return;          // konfiguruje len host
    if (game.phase !== "lobby") return;  // len pred začiatkom zápasu
    const config = sanitizeConfig(raw);
    if (!config) return;
    startMatch(config);
  });

  // turnajový draft: hráč naslepo potvrdí tím TEAM_SIZE unikátnych postáv z poolu CHARS (raz za zápas);
  // súperov výber je maskovaný v snapshotFor, kým nepotvrdia obaja — potom finishTeamSelect → hra 1
  socket.on("choose_team", (keys) => {
    if (!person) return;
    if (game.phase !== "team_select") return;
    if (!game.roster || game.roster[person]) return; // tím sa potvrdzuje raz
    if (!Array.isArray(keys) || keys.length !== TEAM_SIZE) return;
    const team = keys.map(String);
    if (new Set(team).size !== TEAM_SIZE) return;    // bez duplicít v tíme
    if (!team.every(k => CHARS.includes(k))) return; // len známe postavy
    game.roster[person] = team;
    if (game.roster.A && game.roster.B) finishTeamSelect();
    else emitStateMasked(); // súper uvidí rosterReady („opponent is ready"), nie samotný tím
  });

  socket.on("choose_character", (key) => {
    if (!person) return;
    if (game.phase !== "playing") return;       // postava sa volí len v hernej fáze (pred kolami)
    if (!CHARS.includes(key)) return;
    const slot = slotForPerson(person);
    const me = game.players[slot];
    if (me.char) return;                          // postava sa pre danú hru volí raz
    // tournament: mŕtveho maga (HP 0) sa nedá zvoliť; HP aj mana sa prenášajú z predošlej hry
    if (game.mageHp) {
      const hp = game.mageHp[person]?.[key] ?? 0;
      if (hp <= 0) return;
      me.hp = hp;
      me.mana = game.mageMana[person]?.[key] ?? START_MANA;
    }
    me.char = key;
    me.pride = 0; // Escanor: každá nová hra začína na pride 0
    me.moon = key === "werewolf" ? moonLevelFor(me.hp) : 0; // Vlkolak: fáza HNEĎ podľa (preneseného) HP
    // obaja vybrali -> začína 1. kolo, naštartuj časovač pred emitom (snapshot nesie timerMs pre refresh-sync)
    if (game.players.p1.char && game.players.p2.char) beginPlanningTimer(0);
    emitStateMasked(); // súperov pick sa odhalí až keď si vyberie aj druhý hráč (žiadna výhoda pre rozmýšľajúceho)
  });

  socket.on("lock_in", (queue, clientTurn, ack) => {
    // spätná kompat.: starší klient/test volá lock_in(queue) alebo lock_in(queue, ack) bez čísla kola
    if (typeof clientTurn === "function") { ack = clientTurn; clientTurn = undefined; }
    if (!person) return;
    if (game.phase !== "playing") return;
    const slot = slotForPerson(person);
    if (!game.players.p1.char || !game.players.p2.char) return; // ešte sa vyberajú postavy
    const me = game.players[slot];
    // zopakovaný lock_in (stratený ack) pre už vyriešené kolo → zahoď, nech sa stará voľba nevloží do nového kola
    if (clientTurn !== undefined && clientTurn !== game.turn) { if (typeof ack === "function") ack({ ok: true }); return; }
    // idempotencia: v tomto kole už som locknutý (stratil sa len ack) → len potvrď, nereparsuj voľbu
    if (me.locked) { if (typeof ack === "function") ack({ ok: true }); return; }
    if (!validQueue(queue, slot)) { if (typeof ack === "function") ack({ ok: false }); return; }
    let q = queue;
    me.lastHope = q[0]?.type === "last_hope"; // úvodná akcia (pred golden) — validQueue už overil, že smie
    if (me.lastHope) q = q.slice(1);
    me.golden = q[0]?.type === "golden_shield";
    me.goldenMirror = q[0]?.type === "golden_mirror";
    if (me.golden || me.goldenMirror) q = q.slice(1);
    const trailing = q[q.length - 1]?.type;
    me.goldenMana = trailing === "golden_mana";
    me.lastStand  = trailing === "last_stand";
    if (me.goldenMana || me.lastStand) q = q.slice(0, -1);
    me.queue = q.map(a => ({ ...a }));
    me.locked = true;
    if (typeof ack === "function") ack({ ok: true }); // potvrď klientovi prijatie ťahu (klient inak opakuje)

    if (game.players.p1.locked && game.players.p2.locked) {
      resolveTurn();
    } else {
      // quick-draw: hneď ako sa jeden locklne, druhý má QUICKDRAW_MS na ťah
      if (game.config?.timer === "quickdraw") armTurnTimer(QUICKDRAW_MS);
      emitStateMasked(); // labyrint: prekliaty nesmie dostať súperovu pozíciu ani tu
    }
  });

  // priebežne posielaná rozpracovaná voľba — backstop ju pri timeoute zahrá (a doplní len chýbajúce do 3)
  socket.on("draft_queue", (d) => {
    if (!person || game.phase !== "playing") return;
    const slot = slotForPerson(person);
    const me = game.players[slot];
    if (me.locked) return;
    const inQ = Array.isArray(d?.queue) ? d.queue : [];
    const out = [], used = new Set();
    const allowDemon = !!me.lastStandBuff;
    for (const a of inQ) {
      if (out.length >= 3) break;
      if (!validBasicAction(a, used, allowDemon)) continue;
      out.push({ type: a.type, dir: a.dir || null, cell: a.cell || null }); // cell = cieľ Vojakovho specialu
      used.add(a.type);
    }
    me.draft = { queue: out, golden: !!d?.golden, goldenMirror: !!d?.goldenMirror, goldenMana: !!d?.goldenMana, lastStand: !!d?.lastStand, lastHope: !!d?.lastHope };
  });

  socket.on("retry", () => {
    clearTurnTimer();
    newGame();
    io.emit("reset");
    io.emit("state", snapshot());
  });

  // --- admin reset cez socket (napr. z klienta s ?admin=1)
  socket.on("admin_reset_all", (key) => {
    if (!okAdmin(key)) return;
    forceResetAll();
  });

  socket.on("disconnect", () => {
    const wasPlayer = personSockets.A === socket || personSockets.B === socket;
    // uvoľni len živý socket; personIds zámerne NEmažeme → hráč si po reconnecte (do grace) vyžiada svoj slot späť
    if (personSockets.A === socket) { personSockets.A = null; personFreedAt.A = Date.now(); }
    if (personSockets.B === socket) { personSockets.B = null; personFreedAt.B = Date.now(); }
    if (wasPlayer) clearTurnTimer(); // bez hráča nemá zmysel auto-resolve; odpojenie diváka časovač neruší
  });
});

httpServer.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
