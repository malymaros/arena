// engine/game.js - herná logika jednej roomky bez socketov (Etapa 1 refaktoru, docs/REFACTOR_PLAN.md).
// createEngine(io) vráti engine s vlastným stavom (game) a príkazmi hráčov. Všetok kontakt s vonkajším
// svetom ide cez háčiky v `io` (emit, emitState, emitYouAre, časovač, mená osôb, plánovač medzihry) -
// bez nich engine beží headless (testy/simulácie). Kód je zatiaľ presunutý 1:1 zo server.js closure.
import {
  FORCE_FIRST_STARTER, ARENA_SEED, seededRng, BOARD, START_POS, START_HP,
  START_MANA, MAX_MANA, BASIC_COST, BASIC_DMG_MAX, MELEE_COST, MELEE_DMG,
  MELEE_REPEAT, SPECIAL_COST, WOLF_DIRS, SIDE_CHARS, DIAG_DIRS, VAMP_TRAP_DMG,
  VAMP_TRAP_BONUS, WORLD_COST, JOTARO_S1_COST, JOTARO_S1_DMG, STONE_ACTIONS, CLONE_DMG,
  RECHARGE_GAIN, SHIELD_COST, MIRROR_COST, GOLDEN_COST, GOLDEN_MIRROR_COST, DASH_COST,
  GOLDEN_MANA_GAIN, POWER_TILE_BONUS, DEMON_COST, DEMON_DMG, ACTION_TYPES, MOVE_DIRS,
  MATCH_FORMATS, CHARS, TEAM_SIZE, TIMER_OPTIONS, MOVE_DELAY_MS, SMALL_DELAY_MS,
  ACTION_GAP_MS, SPECIAL_REPEAT, SPECIAL_BEAT_MS, SOLDIER_GRENADE_BLAST_MS, CHARGE_STEP_MS, MIRROR_BEAM_MS,
  TELEPORT_OUT_MS, TELEPORT_IN_MS, LAB_REVEAL_MS, VAMP_TRAP_STRIKE_MS, TIMESTOP_CAST_MS, TIMESTOP_END_MS,
  LS_APPEAR_MS, LS_DRAIN_MS, LS_KILL_MS, LS_REVIVE_MS, LS_RISE_MS, LS_SETTLE_MS,
  LS_B_LEAVE_MS, LS_B_CENTER_MS, LS_B_DRAIN_MS, LS_B_KILL_MS, LH_APPEAR_MS, LH_DRAIN_MS,
  LH_SETTLE_MS, QUICKDRAW_MS, PASS_MANA_COST,
} from "./constants.js";

import * as G from "../shared/geometry.js";
import { CHARACTERS } from "./characters/index.js";
import { vampMeleeLand } from "./characters/vampires.js";

export function createEngine(io = {}) {
  // --- háčiky na vonkajší svet (server: sockety/časovač; headless simulácia ich môže vynechať) ---
  const roomEmit = (ev, payload) => io.emit?.(ev, payload);
  const emitStateMasked = (timeline = null) => io.emitState?.(timeline);
  const emitYouAre = () => io.emitYouAre?.();
  const clearTurnTimer = () => io.clearTurnTimer?.();
  const beginPlanningTimer = (extraMs = 0) => io.beginPlanningTimer?.(extraMs);
  const armTurnTimer = (ms) => io.armTurnTimer?.(ms);
  const timerRemainingMs = () => io.timerRemainingMs?.() ?? null;
  const schedule = io.schedule || setTimeout;
  // io.seed (číslo) - seed RNG pre každý startMatch; bez neho platí env ARENA_SEED, inak Math.random

  let game = null;
  let rand = Math.random; // všetka herná náhoda (pri ARENA_SEED seedovaná v startMatch)

  // explicitný ctx pre postavy (engine/characters/*): stav hry + engine funkcie, ktoré postava smie volať
  // (framy, damage pipeline, statusy, labyrint, power tile). Funkcie sú hoistované, ctx vzniká hneď.
  const ctx = {
    get game() { return game; },
    other, inBounds,
    pushStateFrame, pushInvalid,
    powerBoost, dealMul, labyrinthMul, fireOnDmgTile,
    revealLabyrinths, strikeZone, strikeCell,
    applyPetrify, applyLabyrinth, applyStatusOnClone,
    killClone, trackSteps, doJotaroWorld, vampShotRoute,
  };

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
    // Na konci kola: použil shield/mirror (aj golden) ALEBO dostal zásah? → −1, inak → +1 (clamp 0–3).
    // Reset na 0 pri nasadení.
    pride: 0,
    // Escanor: v tomto kole mu súper zobral HP (akcia/odraz - NIE tile/IK, NIE petrify/banish).
    // Nastavuje notePrideHit() na miestach dopadu, spotrebuje a vynuluje koniec kola v resolveTurn.
    prideHit: false,
    // Vlkolak: „fáza mesiaca" 0–3 (nov → spln) = dmg jeho charge specialu (WOLF_MOON_DMG). Odvodená z HP
    // (moonLevelFor) - prepočíta sa na KONCI každého kola a pri nasadení/swape. Verejná (veľkosť postavy je tell).
    moon: 0,
    // Narutov tieňový klon: { x, y } alebo null. Kopíruje všetky základné akcie majiteľa (vertikálny pohyb
    // inverzne), spôsobuje vždy len CLONE_DMG, zmizne pri akomkoľvek zásahu (obrany zdieľa s majiteľom -
    // armujú sa aj spotrebúvajú spolu, sú to tie isté shield/mirror flagy)
    clone: null,
    // Countess/Onre: pasca { x, y } | null. Značku vidí LEN caster (súperovi sa trap aj trap_set
    // redigujú); trigger = súperov vstup/prechod PO dokončení jeho akcie (teleport castera + melee).
    trap: null,
    // Jotaro: použil už THE WORLD v TEJTO hre? Po ňom sa special button natrvalo mení na Special 2.
    // Prežíva swap (per-hra jednorazovosť), nová hra = čerstvý newPlayer = false.
    worldUsed: false,
    // Luffy: mód "base" | "gear3". Prepína ho recharge (Luffyho glitch akcia - doplní manu A prepne mód,
    // vždy, aj pri plnej mane). Gear3 = väčší na doske (tell), iný basic (naťahovacia ruka + pull súpera).
    // Prežíva medzi kolami; reset na "base" pri voľbe postavy a na štarte hry.
    form: "base",
    labyrinth: false,  // blúdi v labyrinte (Minotaurov special) - nevidí board, kým nepadne vzájomný zásah
    mazeBuff: false,   // hráč ÚSPEŠNE zaklial súpera do labyrintu (len priamym castom, nie cez odraz) → 2× výstupný
                       // dmg, kým labyrint trvá. Cielené na toho, kto hrá Minotaura. (tile dmg/IK dostáva normálne)
    labReveal: false,  // labyrint sa v tomto ťahu isto skončí zásahom - redakcia/hmla padli už PRED animáciou akcie
    thread: [],        // Ariadnina niť: [x,y] políčka, na ktoré prekliaty vstúpil (prvé = kde stál pri zakliatí)
    threadMark: null,  // [x,y] posledného súperovho vstupu na niť - prekliaty tam vidí jeho obrys
    shield: false,     // zruší celý dmg najbližšej súperovej akcie
    shieldGold: false, // aktívny shield pochádza z golden shieldu (zlaté vizuály)
    mirror: false,     // odrazí celý dmg najbližšej súperovej akcie späť do útočníka
    mirrorGold: false, // aktívny mirror pochádza z golden mirroru (zlaté vizuály)
    golden: false,     // objednaný golden shield (extra akcia pred začiatkom kola)
    goldenMirror: false, // objednaný golden mirror (rovnaký predťah, ale odraz namiesto štítu)
    goldenMana: false, // objednaný golden mana refill (extra akcia po konci kola)
    manaRefills: 0,    // koľkokrát už hráč refill použil - určuje rastúcu HP cenu
    lastStand: false,     // objednaný last stand (trailing gold akcia, výlučná s golden_mana)
    lastStandBuff: false, // aktívne v poslednom (buffnutom) kole: 2× výstupný dmg, floor(½) prijatý dmg
    lastStandDoom: false, // v tomto poslednom kole musí vyhrať, inak na jeho konci zomrie
    down: false,          // leží „mŕtvy" počas Last Stand choreografie (smrť→oživenie) - klient kreslí dead pózu
    lastHope: false,      // objednaný Last Hope (úvodná akcia nebuffnutého hráča vo final kole)
    lastHopeBuff: false,  // aktívny Last Hope ultra mód v poslednom kole: 4× výstupný dmg, floor(½) prijatý dmg
    locked: false,
    queue: [],
    // priebežne posielaná rozpracovaná voľba - pri vypršaní času ju backstop zachová a doplní len chýbajúce
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
    tiles: [],     // { x, y, type: "dmg" | "heal" | "mana" | "power" | "block" } - pribúdajú od konca 1. kola
    iks: [],       // [{ x, y }] - insta-kill tiles; viac súčasne, každé kolo menia pozíciu, navzájom sa neprekrývajú
    pending: null, // { ikMoves: [{x,y}…], spawns: [{x,y,type}…] } - VOPRED vyžrebované zmeny tiles na koniec AKTUÁLNEHO kola (preview pre hráčov)
    // séria zápasov
    seats: { p1: "A", p2: "B" }, // kto sedí na ktorom slote - LOSUJE sa v startMatch (p1 = biely, začína); fixné na celú sériu
    seriesWins: { A: 0, B: 0 },
    series: { gameIndex: 1, needed: 1, format: "single" },
    // tournament: draftnutý tím TEAM_SIZE postáv per osoba (fáza team_select; null mimo tournamentu,
    // pole null kým daná osoba nepotvrdí) - kľúče mageHp/mageMana a poradie HUD hláv
    roster: null,     // { A: [char×3] | null, B: [char×3] | null }
    // tournament: HP a mana každého z 3 magov per osoba sa prenášajú medzi hrami (null mimo tournamentu)
    mageHp: null,
    mageMana: null,
    // rezumovateľné kolo (Jotarov THE WORLD): kontext prebiehajúceho resolveTurn / stav time-stop pauzy
    roundCtx: null,
    timestop: null,
  };
}
newGame();

function otherPerson(p) { return p === "A" ? "B" : "A"; }
function slotForPerson(person) { return game.seats.p1 === person ? "p1" : "p2"; }
// draftnutý tím osoby sediacej na slote (prázdny mimo turnaja / pred potvrdením)
function rosterFor(slot) { return game.roster?.[game.seats[slot]] || []; }

// séria zhrnutá pre klienta - výhry namapované na aktuálne sloty (osoba si nesie skóre na svoju stranu)
function seriesSnapshot() {
  return {
    gameIndex: game.series.gameIndex,
    needed: game.series.needed,
    format: game.series.format,
    winsP1: game.seriesWins[game.seats.p1] || 0,
    winsP2: game.seriesWins[game.seats.p2] || 0,
  };
}

// snapshot pre konkrétnu OSOBU - počas výberu postáv skry súperovu voľbu, kým si TÁTO osoba nevyberie
// (inak rozmýšľajúci hráč vidí súperov pick a má výhodu). Po výbere oboch je stav už odhalený.
// Labyrint (Minotaurov special): prekliata osoba nedostane súperovu pozíciu/obrany ani tiles ANI V DÁTACH
// (anti-cheat - klientská hmla by sa dala obísť cez devtools).
function snapshotFor(person) {
  let base = snapshot();
  // tournament: pridaj LEN vlastnú trojicu HP a many magov (súperove hodnoty hráč nevidí)
  base.mageHp = game.mageHp ? { ...game.mageHp[person] } : null;
  base.mageMana = game.mageMana ? { ...game.mageMana[person] } : null;
  const mySlot = slotForPerson(person);
  const oppSlot = mySlot === "p1" ? "p2" : "p1";
  // slepý draft: súperov tím vidím, až keď potvrdia obaja (fáza sa vtedy prepne na playing);
  // rosterReady ostáva verejné - klient z neho ukazuje „opponent is picking / ready"
  if (game.phase === "team_select" && base.roster) {
    base = { ...base, roster: { ...base.roster, [oppSlot]: null } };
  }
  if (!game.players[mySlot]?.char && base[oppSlot]?.char) {
    base = { ...base, [oppSlot]: { ...base[oppSlot], char: null } };
  }
  // pasca (Countess/Onre): značku vidí LEN caster - zo súperovho actora ju strhni v KAŽDOM snapshote
  if (base[oppSlot]?.trap) base = { ...base, [oppSlot]: { ...base[oppSlot], trap: null } };
  if (base[mySlot]?.labyrinth && !base[mySlot].labReveal) base = redactRosterMana(oppSlot, redactSnapshotFor(mySlot, base));
  else if (base[oppSlot]?.labyrinth && !base[oppSlot].labReveal) base = redactRosterMana(oppSlot, { ...base, [oppSlot]: redactHunterActor(base[oppSlot]) });
  return base;
}

/* ---- Labyrint: redakcia dát pre OBE strany ---- */
// prekliaty nevidí súperovu pozíciu, obrany ani MANU (nemá prehľad, kedy Minotaur dosiahne na special/melee);
// niť/obrys súpera (mirror match dvoch Minotaurov) tiež skry. HP ostáva - zásah labyrint aj tak končí.
function redactActor(a) {
  if (!a) return a;
  // clone: prekliaty nesmie vidieť ani súperovho tieňového klona (pozícia = informácia o lovcovi)
  return { ...a, x: null, y: null, mana: null, shield: false, shieldGold: false, mirror: false, mirrorGold: false, thread: [], threadMark: null, clone: null };
}
// LOVEC (Minotaur) zas nevidí Ariadninu niť ani obrys (nemôže sa jej cielene vyhýbať - šliapne na ňu
// nevedomky) a nevidí ani manu prekliateho - počas labyrintu ani jeden nemá prehľad o mane súpera
function redactHunterActor(a) {
  if (!a) return a;
  return { ...a, mana: null, thread: [], threadMark: null };
}
// prekliaty vidí len Damage a Block dlaždice + IK (IK/`iks` sa neredigujú vôbec) - hazardy, ktoré sa ho
// priamo týkajú; heal/mana/POWER dlaždice (výhody-pickupy) LEN keď na nich priamo stojí ALEBO na nich stojí
// jeho tieňový klon - klon je druhá fakľa a osvetľuje svoju bunku rovnako ako hráč (inak by mu prezradili,
// kde sú pickupy). IK vždy (sú to overlaye v `iks`, mimo `tiles`).
function redactTilesFor(mySlot, snap) {
  if (!Array.isArray(snap.tiles)) return snap;
  const me = snap[mySlot];
  const onTorchCell = (t) => me && ((me.x != null && t.x === me.x && t.y === me.y)
    || (me.clone && t.x === me.clone.x && t.y === me.clone.y));
  const alwaysVisible = (type) => type === "dmg" || type === "block";
  const out = { ...snap, tiles: snap.tiles.filter(t => alwaysVisible(t.type) || onTorchCell(t)) };
  // preview (config.tilePreview) sa rediguje ROVNAKO ako existujúce tiles: dmg/block/IK spawny a ciele presunu IK
  // prekliaty vidí vždy, heal/mana/power spawn len keď na tej bunke priamo stojí on alebo jeho tieňový klon
  if (out.pending) {
    out.pending = { ...out.pending, spawns: out.pending.spawns.filter(s => alwaysVisible(s.type) || s.type === "ik" || onTorchCell(s)) };
  }
  return out;
}
// lovec (alebo jeho tieňový klon) PRÁVE stojí na niektorej „fakľovej" bunke prekliateho - na jeho vlastnej
// ALEBO na bunke jeho tieňového klona (klon = druhá fakľa; lovec nevie, ktorá figúra je pravá, takže obe
// bunky sa správajú identicky). Vracia zoznam buniek lovcových figúr stojacich na fakľových bunkách
// ([[x,y],…], max 2 - lovec + jeho klon; duplicitná bunka = obe lovcove figúry na tej istej bunke), inak null.
// Počíta sa čerstvo z každého snapshotu/framu, takže po odchode lovca hneď zhasne (žiadny „stale" obrys).
function hunterLitCells(me, opp) {
  if (!me || !opp || me.x == null) return null;
  const torch = [[me.x, me.y]];
  if (me.clone) torch.push([me.clone.x, me.clone.y]);
  const onTorch = (x, y) => x != null && torch.some(([tx, ty]) => tx === x && ty === y);
  const out = [];
  if (onTorch(opp.x, opp.y)) out.push([opp.x, opp.y]);
  if (opp.clone && onTorch(opp.clone.x, opp.clone.y)) out.push([opp.clone.x, opp.clone.y]);
  return out.length ? out : null;
}
function redactSnapshotFor(mySlot, snap) {
  const oppSlot = mySlot === "p1" ? "p2" : "p1";
  const me = snap[mySlot], opp = snap[oppSlot];
  const hunterHere = hunterLitCells(me, opp);
  return redactTilesFor(mySlot, { ...snap, [mySlot]: { ...me, hunterHere }, [oppSlot]: redactActor(opp) });
}
// tournament × labyrint: počas kliatby nevidí ANI JEDNA strana manu súperovho tímu - roster nesie
// uložené hodnoty magov (lavička + posledný uložený stav nasadeného), rediguje sa obojsmerne ako živá mana
function redactRosterMana(oppSlot, snap) {
  if (!snap.rosterMana) return snap;
  return { ...snap, rosterMana: { ...snap.rosterMana, [oppSlot]: null } };
}
// efekt vo frame, v ktorom je príjemca prekliaty: súperove akcie sa maskujú na "unknown" (beat kvôli
// pozícii v lište), všetko ostatné od/na súpera aj cudzie tile efekty sa zahodia - úplná tma
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
// labReveal (istý zásah v tomto ťahu): redakcia padá už od reveal frame-u - akcia sa odohrá odhalená.
// pasca (Countess/Onre) v timeline framoch: súperov trap + jeho trap_set efekt sa príjemcovi maskujú
// VŽDY (nielen v labyrinte) - trigger/deštrukcia (trap_trigger/trap_break) ostávajú viditeľné obom
function maskTrapFrame(oppSlot, f) {
  let out = f;
  if (out?.[oppSlot]?.trap) out = { ...out, [oppSlot]: { ...out[oppSlot], trap: null } };
  if ((out.effects || []).some(e => e?.kind === "trap_set" && e.from === oppSlot)) {
    out = { ...out, effects: out.effects.filter(e => !(e?.kind === "trap_set" && e.from === oppSlot)) };
  }
  return out;
}
function redactTimelineFor(mySlot, tl) {
  const oppSlot = mySlot === "p1" ? "p2" : "p1";
  return tl.map(f0 => {
    const f = maskTrapFrame(oppSlot, f0);
    if (f?.[mySlot]?.labyrinth && !f[mySlot].labReveal) {
      // hunterHere sa musí počítať aj pre každý FRAME timeline (nielen root snapshot) - inak keď prekliaty
      // POČAS kola vstúpi na lovcovu bunku, frame ho nenesie a klient ukáže čierny tieň namiesto ožiareného lovca
      const hunterHere = hunterLitCells(f[mySlot], f[oppSlot]);
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

/* -------------------- Helpers -------------------- */
function cloneActor(a) {
  if (!a) return null;
  const { slot, x, y, hp, mana, char, stone, pride, moon, worldUsed, form, labyrinth, labReveal, shield, shieldGold, mirror, mirrorGold, manaRefills, lastStandBuff, lastHopeBuff, down, locked } = a;
  // niť treba hlboko kopírovať - server do nej pushuje, plytká referencia by menila už uložené timeline framy
  const thread = (a.thread || []).map(c => [...c]);
  const threadMark = a.threadMark ? [...a.threadMark] : null;
  const clone = a.clone ? { ...a.clone } : null; // Narutov tieňový klon (pozícia)
  const trap = a.trap ? { ...a.trap } : null;    // pasca Countess/Onre (súperovi ju maskuje snapshotFor/redactTimelineFor)
  return { slot, x, y, hp, mana, char, stone, pride, moon, worldUsed, form, labyrinth, labReveal, thread, threadMark, clone, trap, shield, shieldGold, mirror, mirrorGold, manaRefills, lastStandBuff, lastHopeBuff, down, locked };
}
function snapshot() {
  return {
    phase: game.phase,
    config: game.config ? { ...game.config, tileWeights: { ...game.config.tileWeights } } : null,
    series: seriesSnapshot(),
    // zobrazované mená hráčov per slot (verejné - netreba redigovať; labyrint mená nemaskuje)
    names: { p1: io.names?.()?.[game.seats.p1] || null, p2: io.names?.()?.[game.seats.p2] || null },
    // host stlačil START, no 2. hráč ešte nie je → klient hosta ukáže „čakám na druhého hráča"
    awaitingOpponent: !!io.awaitingOpponent?.(),
    // Jotaro THE WORLD: kým čaká na 3 zmrazené akcie, klient (obaja) vie prepnúť UI mód (neutrálne - len slot)
    timestop: (game.timestop && game.timestop.mode === "waiting") ? { slot: game.timestop.slot } : null,
    board: { ...game.board },
    p1: cloneActor(game.players.p1),
    p2: cloneActor(game.players.p2),
    arena: game.arena,
    turn: game.turn,
    starter: game.starter,
    timerMs: timerRemainingMs(), // zostávajúci čas na ťah (null = bez limitu) - klient sa naň synchronizuje aj po refreshi
    // duálny gold button (golden mana + last stand) je v poslednom (buffnutom) kole zamknutý pre oboch
    goldLocked: !!(game.players.p1.lastStandBuff || game.players.p2.lastStandBuff),
    tiles: game.tiles.map(t => ({ ...t })),
    iks: game.iks.map(t => ({ ...t })),
    // preview zmien tiles na konci kola (len ak je zapnutý config.tilePreview) - verejná, symetrická informácia;
    // heal/mana spawny počas labyrintu rediguje redactTilesFor rovnako ako existujúce tiles
    pending: (game.config?.tilePreview && game.pending) ? {
      ikMoves: game.pending.ikMoves.map(c => ({ ...c })),
      spawns: game.pending.spawns.map(s => ({ ...s })),
    } : null,
    // tournament: draftnuté tímy per slot - po skončení draftu VEREJNÉ (HUD hlavy oboch strán, poradie
    // = poradie výberu); počas fázy team_select snapshotFor súperov tím maskuje (slepý draft).
    roster: game.roster ? {
      p1: game.roster[game.seats.p1] ? [...game.roster[game.seats.p1]] : null,
      p2: game.roster[game.seats.p2] ? [...game.roster[game.seats.p2]] : null,
    } : null,
    // kto už potvrdil tím (verejné aj počas draftu - „súper vyberá / je pripravený")
    rosterReady: game.roster ? {
      p1: !!game.roster[game.seats.p1], p2: !!game.roster[game.seats.p2],
    } : null,
    // tournament: mŕtvi magovia (HP 0) per slot - pre HUD hlavy (mŕtvy = lebka); historické info (= počet prehier),
    // nie tajná voľba, preto ide obom stranám aj v bežnom snapshote
    // pre PRÁVE NASADENÉHO maga ber ŽIVÉ hp z game.players (do game.mageHp sa zapíše až v handleGameEnd,
    // ktorý beží AŽ PO emite finálneho stavu) - inak by mág padnutý v poslednom kole série nemal lebku
    // (turnaj by skončil s 2 lebkami namiesto 3)
    mageDead: game.mageHp ? {
      p1: rosterFor("p1").filter(k => (game.players.p1?.char === k ? game.players.p1.hp : (game.mageHp[game.seats.p1]?.[k] ?? 1)) <= 0),
      p2: rosterFor("p2").filter(k => (game.players.p2?.char === k ? game.players.p2.hp : (game.mageHp[game.seats.p2]?.[k] ?? 1)) <= 0),
    } : null,
    // tournament: prenesené HP a mana všetkých 3 magov per slot - VEREJNÉ (vidí ich aj súper) pre HUD hlavy.
    // Pozn.: pre práve nasadeného maga je tu uložená (nie živá) hodnota - klient pri ňom berie živé hp/mana z p1/p2.
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


// Fire Wizard stojí na Damage dlaždici? Vtedy sa jeho special rozšíri o riadky ±1
// (dlaždice sú trvalé a vznikli v predošlých kolách, takže existujú v čase resolveTurn).
function fireOnDmgTile(me) {
  return !!me && me.char === "fire" &&
    game.tiles.some(t => t.type === "dmg" && t.x === me.x && t.y === me.y);
}


// Jotaro Special 1 (v mirror slote): smerový (left/right) - OBE diagonálne bunky zvolenej strany
// (x±1, y−1) a (x±1, y+1). Rovná bunka (x±1, y) NIE. Na kraji dosky len bunky v ploche (môže byť prázdna).
// Jotaro Special 2 (po THE WORLD): jediná susedná bunka (x±1, y). Obe MUSIA sedieť s cellsForSpecialPreview.
function jotaroS1Cells(me, dir) { return G.jotaroS1Cells(game.board, me, dir); }

/* ---- Narutov tieňový klon ---- */
// Klon nemá HP - zmizne pri akomkoľvek zásahu od súpera (dmg aj status speciály), pri IK tile,
// pri recaste specialu, smrti/swape majiteľa a na konci hry. Zásah NA klona labyrint NEODHALÍ
// ani NEUKONČÍ (súper sa nesmie dozvedieť, že trafil klona); zásah spôsobený klonom je bežný
// action hit (ide cez resolveStrike) a labyrint ukončí.
function killClone(slot, tl, ms = SMALL_DELAY_MS) {
  const p = game.players[slot];
  if (!p?.clone) return;
  const at = [p.clone.x, p.clone.y];
  // die frame ešte s klonom v snapshote (klient cezeň prehrá rozplynutie), až potom zmizne zo stavu
  pushStateFrame(tl, [{ kind: "clone_die", target: slot, cell: at }], ms);
  p.clone = null;
}
// status special (petrify/labyrint) na klona cez obrany majiteľa - analógia zásahu klona v resolveStrike:
// shield blokuje, mirror odrazí STATUS na castera (ako applyPetrify/applyLabyrinth). Bez obrany:
// PETRIFY klona ZABIJE (zásah kliatby ho rozplynie ako každý iný zásah), LABYRINT nie - kliatba bludiska
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
  const path = G.cloneSteps(game.board, p.clone, delta, maxSteps);
  if (path.length) { p.clone.x = path[path.length - 1][0]; p.clone.y = path[path.length - 1][1]; }
  return trackCloneSteps(slot, path);
}
// klon lovca sa ráta do pretínania Ariadninej nite - vstup klona na niť prekliateho nastaví threadMark
// (prekliaty tam uvidí siluetu - nevie, že patrí klonovi; ideálny bait)
function trackCloneSteps(slot, cells) {
  // pasca (Countess/Onre): aj klon lovca triggeruje pascu - zbieraj bunky prejdené klonom počas akcie
  if (actionSteps) actionSteps[slot + "c"].push(...cells.map(c => [...c]));
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
// postavy, ktorých dash slot je charge (prepísaný dash - Vampire/Onryō): ghost simulácia beží po prvú figúru
const DASH_IS_CHARGE = Object.fromEntries(Object.values(CHARACTERS).filter(c => c.dash).map(c => [c.key, true]));
// kit postavy z registra (engine/characters): tvar basicu a obsah mirror slotu
function kitOf(char) { return { attack: "ortho", mirrorSlot: "mirror", meleeDmg: MELEE_DMG, healTile: "plus1", ...(CHARACTERS[char]?.kit || {}) }; }
// platný smer basicu pre postavu? form = Luffyho mód v čase basicu (base = diagonálny, gear3 = len ←/→);
// anyForm = draft/auto-fill, kde forma v čase basicu ešte nie je istá (Luffy: diag aj ortogonálny)
function attackDirOk(char, dir, form, anyForm = false) {
  const k = kitOf(char).attack;
  if (k === "diag") return !!DIAG_DIRS[dir];
  if (k === "luffy") {
    if (anyForm) return !!(DIAG_DIRS[dir] || MOVE_DIRS.has(dir));
    return form === "gear3" ? (dir === "left" || dir === "right") : !!DIAG_DIRS[dir];
  }
  return MOVE_DIRS.has(dir);
}

function validQueue(queue, slot) {
  if (!Array.isArray(queue)) return false;
  let q = queue;
  // úplne prvý môže byť last_hope - len pre nebuffnutého hráča v poslednom (final) kole
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
        && t !== "stoned" && t !== "pass"
        && !(t === "demon" && canDemon)
        && !(t === "swap" && isTournament))) return false;
  // každý NE-swap typ najviac 1×; swapov najviac 2 (ciele sa overia nižšie); stoned a pass sa môžu opakovať
  const nonSwap = types.filter(t => t !== "swap" && t !== "stoned" && t !== "pass");
  if (new Set(nonSwap).size !== nonSwap.length) return false;
  const swaps = q.filter(a => a.type === "swap");
  if (swaps.length > 2) return false;
  if (swaps.length) {
    if (!isTournament) return false;
    // počas aktívneho labyrintu (ktorejkoľvek strany) je výmena maga zakázaná - hlavy sú skryté,
    // swap sa odmieta už pri plánovaní (aj keby kliatba skončila zásahom uprostred kola)
    if (game.players.p1.labyrinth || game.players.p2.labyrinth) return false;
    // hráč s Last Stand paktom nesmie vo final kole swapnúť - inak by si zabankoval démonov
    // full-heal do rosteru (10/10 uložených pri swape) a doom by zabil náhradníka namiesto neho
    if (game.players[slot]?.lastStandBuff) return false;
    const person = game.seats[slot];
    const startChar = game.players[slot]?.char; // aktuálny mág na začiatku kola
    // Side-postavy (Countess/Onre) sa nedajú swapnúť ANI odsvapnúť - majú odlišnú sémantiku akcií
    // (diagonálny basic, charge namiesto dashu, pasca), takže mid-round výmena je nekoherentná
    if (SIDE_CHARS[startChar]) return false;                        // z nej sa nedá odísť
    const seen = new Set();
    for (const a of swaps) {
      if (SIDE_CHARS[a.to]) return false;                          // k nej sa nedá prísť
      if (!rosterFor(slot).includes(a.to)) return false;           // mág mimo draftnutého tímu
      if (a.to === startChar) return false;                        // návrat na východiskového maga nie je dovolený
      if ((game.mageHp[person]?.[a.to] ?? 0) <= 0) return false;   // mŕtveho maga nemožno nasadiť
      if (seen.has(a.to)) return false;                            // každý cieľ najviac raz
      seen.add(a.to);
    }
  }
  // golden shield/mirror sa vzájomne vylučuje s príslušnou bežnou akciou - nemôžeš ju zahrať 2× za kolo
  if (goldenPre === "golden_shield" && types.includes("shield")) return false;
  if (goldenPre === "golden_mirror" && types.includes("mirror")) return false;
  {
    // tvar basicu a mirror slot podľa kitu postavy (Vampire/Onryō/Jotaro diagonálne, Jotaro má special1
    // namiesto mirroru, Luffy podľa formy)
    const meChar = game.players[slot]?.char;
    const special1Slot = kitOf(meChar).mirrorSlot === "special1";
    // Luffy: basic je DIAGONÁLNY v base, ORTOGONÁLNY v gear3. Recharge prepína mód → simuluj formu
    // cez frontu (recharge PRED basicom zmení, na aký smer sa basic validuje).
    let simForm = game.players[slot]?.form;
    for (const a of q) {
      if (a.type === "recharge" && meChar === "luffy") simForm = simForm === "gear3" ? "base" : "gear3";
      if (a.type === "mirror" && special1Slot) return false;   // postava nemá mirror akciu (Jotaro)
      if (a.type === "special1" && !special1Slot) return false; // special1 len ak ho má v mirror slote
      if (a.type === "special1" && a.dir !== "left" && a.dir !== "right") return false;
      if ((a.type === "move" || a.type === "dash") && !MOVE_DIRS.has(a.dir)) return false;
      if (a.type === "attack" && !attackDirOk(meChar, a.dir, simForm)) return false;
    }
  }
  // Vojak: special nesie cieľovú bunku {x,y}. Cieľ nesmie byť súperova AKTUÁLNA bunka (ani jeho tieňový
  // klon - obe figúry sú „súper", blokovanie len pravej by prezradilo, ktorá je skutočná) - zásah má
  // padnúť len keď sa súper POHNE. Vlastná bunka sa blokuje podľa GHOST pozície v čase specialu (po
  // naplánovaných move/dash - zrkadlí klientský picker/simulatedPositions; dash sa simuluje ako keby
  // mana vyšla, rovnako ako ghost). Výnimka labyrint: prekliaty vojak strieľa naslepo - súperova bunka
  // sa nekontroluje (blokovanie by mu ju prezradilo), takže stojaceho lovca trafiť SMIE (maze buff vojaka).
  {
    const meP = game.players[slot];
    const foe = game.players[other(slot)];
    // ghost simulácia fronty (move/dash/charge/vlkolak/Luffy special, swap, Luffyho mód) - tá istá funkcia ako
    // klientský ghost; v labyrinte je súper skrytý → charge beží na okraj (prekliaty ho nevidí)
    const sim = G.simulateQueue(game.board, { x: meP?.x, y: meP?.y, char: meP?.char, form: meP?.form },
      q, meP?.labyrinth ? null : foe, DASH_IS_CHARGE);
    for (let i = 0; i < q.length; i++) {
      const a = q[i];
      const { x: sx, y: sy, char: simChar, form: simForm2 } = sim[i]; // stav PRED akciou i
      // argumenty specialu (cieľová bunka Vojaka/Luffyho/pasce, smer Jotarovho Special 2) overí postava;
      // v labyrinte je súper skrytý → foe null (prekliaty Vojak smie trafiť stojaceho lovca)
      if (a.type === "special") {
        const validate = CHARACTERS[simChar]?.special.validate;
        if (validate && !validate(ctx, a, { x: sx, y: sy, form: simForm2, worldUsed: !!meP?.worldUsed, foe: meP?.labyrinth ? null : foe })) return false;
      }
    }
  }
  return true;
}

// Jotaro THE WORLD: 3 nové zmrazené akcie (kvázi nové kolo, všetky typy nanovo). Povolené:
// move|dash|recharge|attack|melee|shield|special1. Zakázané: special (THE WORLD beží / Special 2 ešte
// nie je), golden akcie, swap, stoned. Mana sa NEvaliduje tvrdo (nedostatok = invalid pri vykonaní).
function validTimestopQueue(queue, slot) {
  if (!Array.isArray(queue) || queue.length !== 3) return false;
  const allowed = new Set(["move", "dash", "recharge", "attack", "melee", "shield", "special1"]);
  const types = queue.map(a => a && a.type);
  if (types.some(t => !allowed.has(t))) return false;
  if (new Set(types).size !== types.length) return false; // každý typ max 1×
  const char = game.players[slot]?.char; // tvar basicu podľa kitu (Jotaro strieľa diagonálne)
  for (const a of queue) {
    if ((a.type === "move" || a.type === "dash") && !MOVE_DIRS.has(a.dir)) return false;
    if (a.type === "attack" && !attackDirOk(char, a.dir, game.players[slot]?.form)) return false;
    if (a.type === "special1" && a.dir !== "left" && a.dir !== "right") return false;
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

/* -------------------- Actions -------------------- */
// koľko políčok dokáže klon prejsť daným smerom (vertikálne inverzne) - bez mutácie stavu
function cloneMovableSteps(a, delta, maxSteps) {
  return a?.clone ? G.cloneSteps(game.board, a.clone, delta, maxSteps).length : 0;
}

// smer klona (vertikálne inverzný) - pre náraz do steny na klonovej strane (diagonály kvôli úplnosti;
// klona má len Naruto, ktorý strieľa ortogonálne)
const CLONE_DIR = { up:"down", down:"up", left:"left", right:"right", up_left:"down_left", up_right:"down_right", down_left:"up_left", down_right:"up_right" };

function doMove(slot, dir, tl) {
  const a = game.players[slot];
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir] || [0,0];
  const nx = a.x + delta[0], ny = a.y + delta[1];
  const ownCan = inBounds(nx, ny);
  // klon (Naruto) sa hýbe vertikálne inverzne s vlastným clampom
  const hasClone = !!a.clone;
  const cloneCan = hasClone && cloneMovableSteps(a, delta, 1) > 0;
  // NOVÉ PRAVIDLO: pohyb do steny sa už neprečiarkne - akcia sa „vykoná" ako náraz do steny
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
  // postava môže dash slot prepísať (Vampire/Onryō: charge - pohybové melee)
  const dashOverride = CHARACTERS[a.char]?.dash;
  if (dashOverride) return dashOverride(ctx, slot, dir, tl);
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
  if (!delta) { pushInvalid(tl, slot); return; }
  if (a.mana < DASH_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }

  // posun až o 2 políčka zvoleným smerom; na okraji sa skráti na 1 (bez možného pohybu = náraz do steny nižšie)
  let nx = a.x, ny = a.y, steps = 0;
  const path = []; // aj medzibunka - labyrintná niť/obrys sa počíta na každom prejdenom políčku
  for (let s = 0; s < 2; s++) {
    if (inBounds(nx + delta[0], ny + delta[1])) { nx += delta[0]; ny += delta[1]; steps++; path.push([nx, ny]); }
  }
  // klon dashuje vertikálne inverzne s vlastným clampom - dash prebehne aj keď Naruto naráža do steny
  const hasClone = !!a.clone;
  const cloneSteps = hasClone ? cloneMovableSteps(a, delta, 2) : 0;

  // NOVÉ PRAVIDLO: dash do steny sa už neprečiarkne - máš naň manu (overené vyššie), tak sa minie
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

  // postava môže recharge prepísať (Luffy: doplní manu a prepne formu) - true = vyriešené
  if (CHARACTERS[a.char]?.recharge?.(ctx, slot, tl)) return;

  // Na maxime many -> neplatné, žiadna modrá animácia/bublina
  if (a.mana >= MAX_MANA) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana_full"); return; }

  const before = a.mana;
  a.mana = Math.min(MAX_MANA, a.mana + RECHARGE_GAIN);
  const gained = a.mana - before; // menej ak capne na MAX_MANA
  if (gained > 0) {
    // klon hrá nabíjanie naprázdno (manu zdieľa s majiteľom) - jeho bunka ide v efekte, nech aura
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

// Vampire/Onryō: lomená dráha diagonálnej strely - RAZ sa odrazí od ktorejkoľvek steny (biliard,
// od bočnej letí späť ku kasterovi), roh neodráža (let končí), tvrdý limit VAMP_SHOT_RANGE buniek.
// Výstrel do priľahlej steny sa odrazí OKAMŽITE (spotrebuje svoj jediný odraz); do rohu = prázdna
// dráha → wall-rule whiff. Každý krok nesie aj dir (klient podľa neho otáča špic strely po odraze).
// MUSÍ sedieť s klientským cellsForAttackPreview (vampShotRoute v client.js).
function vampShotRoute(x, y, dir) { return G.vampShotRoute(game.board, x, y, dir); }

function doBasic(slot, dir, tl) {
  const me  = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];

  // Luffy GEAR 3: basic = Giant Pistol (naťahovacia ruka + priťiahnutie súpera) - vlastná vetva
  // postava môže basic prepísať (Luffy Gear 3: Giant Pistol) - true = vyriešené
  if (CHARACTERS[me.char]?.basic?.(ctx, slot, dir, tl)) return;

  // ortogonálne + diagonálne smery (Vampire/Onryō strieľajú diagonálne - validQueue gate-uje per postava)
  const delta = WOLF_DIRS[dir];
  if (!delta) { pushInvalid(tl, slot); return; }
  if (me.mana < BASIC_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  // NOVÉ PRAVIDLO: útok do steny sa už neprečiarkne - máš naň manu, tak sa minie a strela sa „vypustí"
  // (hneď zhasne na okraji). Klonova strela (vertikálne zrkadlená) môže pritom letieť ďalej.
  me.mana -= BASIC_COST;
  // POWER tile: +2 k MAJITEĽOVÝM strelám (klonova strela boost nemá); spotreba hneď pri použití útoku
  const pBonus = powerBoost(slot, tl);
  let anyCharge = false; // aspoň jedna strela vôbec vzlietla (dostala in-board bunku) → netreba whiff

  // strely: majiteľ + prípadný klon. Klon zrkadlí smer VERTIKÁLNE (up<->down), horizontálne rovnako
  // (rovnako ako pohyb); klonova strela dáva ROVNAKÝ dmg ako Naruto (falloff + rovnaké buffy). Každá
  // strela nesie vlastný delta `d` a `dir`, aby klonova vertikála letela opačne.
  // Terče v dráhe: SÚPEROV KLON-návnada (mimo majiteľovej bunky) strelu zožerie a letí ďalej dym; keď
  // klon STOJÍ NA majiteľovej bunke, pohltí len CLONE_DMG a zvyšok prejde na Naruta.
  const cloneDir = CLONE_DIR[dir];
  const cloneDelta = [delta[0], -delta[1]];
  // Vampire/Onryō/Luffy(base): strela letí po lomenej diagonálnej dráhe (route) s odrazom; ostatní priamo.
  // (Luffy gear3 sem nedôjde - má vlastnú vetvu doLuffyGear3Basic vyššie.)
  const route = kitOf(me.char).attack !== "ortho" ? vampShotRoute(me.x, me.y, dir) : null; // diagonálna bounce strela (kit)
  const shots = [{ x: me.x, y: me.y, dist: 0, clone: false, d: delta, dir, done: false, spent: false, route }];
  if (me.clone) shots.push({ x: me.clone.x, y: me.clone.y, dist: 0, clone: true, d: cloneDelta, dir: cloneDir, done: false, spent: false, route: null });

  // bunky, ktorými strela preletí (route = lomená dráha; inak priamo po okraj)
  const shotScanCells = (sh) => {
    if (sh.route) return sh.route.map(st => [st.x, st.y]);
    const cs = []; let hx = sh.x, hy = sh.y;
    while (inBounds(hx + sh.d[0], hy + sh.d[1])) { hx += sh.d[0]; hy += sh.d[1]; cs.push([hx, hy]); }
    return cs;
  };
  // deterministický pre-scan: zásah REÁLNEHO hráča ktoroukoľvek strelou odhalí labyrint pred letom
  // (zásah len klona-návnady labyrint neodhaľuje; stacknutý klon strelu k Narutovi pustí → to odhalí)
  outer: for (const sh of shots) {
    for (const [hx, hy] of shotScanCells(sh)) {
      const cloneDecoy = op?.clone && op.clone.x === hx && op.clone.y === hy && !(op.x === hx && op.y === hy);
      if (cloneDecoy) break; // klon-návnada strelu zožerie - ďalej nedoletí
      if (op && op.x === hx && op.y === hy) { revealLabyrinths(tl); break outer; }
    }
  }

  // paralelný let: v každom kroku sa všetky živé strely posunú o bunku (jeden frame = všetky charge efekty)
  let guard = 0;
  while (shots.some(s => !s.done) && guard++ < 16) {
    const fx = [];
    const hits = [];
    for (const s of shots) {
      if (s.done) continue;
      if (s.route) {
        // lomená dráha (Vampire/Onryō): krok podľa route; dir sa mení po odraze (klient otáča špic)
        const st = s.route[s.dist];
        if (!st) { s.done = true; continue; }
        s.x = st.x; s.y = st.y; s.dir = st.dir; s.dist++;
      } else {
        s.x += s.d[0]; s.y += s.d[1]; s.dist++;
        if (!inBounds(s.x, s.y)) { s.done = true; continue; }
      }
      fx.push({ kind: "charge", from: slot, dir: s.dir, cell: [s.x, s.y], clone: s.clone });
      if (s.spent) continue; // už minutá na klona-návnadu - letí len vizuálne
      const cloneHere  = op?.clone && op.clone.x === s.x && op.clone.y === s.y;
      const playerHere = op && op.x === s.x && op.y === s.y;
      if (cloneHere && playerHere) { s.done = true; hits.push({ target: "stacked", shot: s }); }
      else if (cloneHere)         { hits.push({ target: "clone", shot: s }); }
      else if (playerHere)        { s.done = true; hits.push({ target: "player", shot: s }); }
    }
    if (fx.length) { anyCharge = true; pushStateFrame(tl, fx, CHARGE_STEP_MS); }
    // Vojak: granát nezasiahne v momente doletu, ale až keď na cieľovej bunke VYBUCHNE a výbuch je vidieť.
    // Keď let končí zásahom súpera (player/stacked), vlož prázdny frame: ten na klientovi stiahne granát
    // (spustí odpočet výbuchu - výbuch nabehne CHARGE_STEP_MS po ňom) a jeho delayMs = CHARGE_STEP_MS +
    // SOLDIER_GRENADE_BLAST_MS posunie hit frame tak, aby červené políčko a „-HP" padli AŽ po nábehu výbuchu.
    // Netýka sa preletu cez klona-návnadu (granát letí ďalej).
    if (me.char === "soldier" && hits.some(h => h.target === "player" || h.target === "stacked")) {
      pushStateFrame(tl, [], CHARGE_STEP_MS + SOLDIER_GRENADE_BLAST_MS);
    }
    // klonova strela dáva ROVNAKÝ dmg ako Naruto: falloff podľa VLASTNEJ vzdialenosti klona
    // (h.shot.dist sa počíta z klonovej bunky) × rovnaké násobiče (Last Stand ×2 / Last Hope ×4, maze ×2).
    // POWER bonus je flat a LEN na majiteľovej strele (klon z power tile neprofituje).
    const rawOf = (h) => Math.max(1, BASIC_DMG_MAX - h.shot.dist) * dealMul(slot) * labyrinthMul(slot) + (h.shot.clone ? 0 : pBonus);
    // súperove „player" zásahy z TOHTO kroku: stacknutý Naruto+klon strieľajúci rovnakým smerom trafí
    // z jednej bunky dvakrát → na NEKRYTÉ HP to spojíme do JEDNÉHO úderu so súčtom dmg (nie dva animačne
    // oddelené); pri obrane (štít/mirror) strikeOwnerMulti vráti false a rieši sa každá strela zvlášť.
    const playerHits = hits.filter(h => h.target === "player");
    const ownerBonus = playerHits.some(h => !h.shot.clone) ? pBonus : 0; // bonus nesie len majiteľova strela
    if (playerHits.length && !strikeOwnerMulti(opS, playerHits.map(rawOf), tl, "basic", ownerBonus)) {
      for (const h of playerHits) { strikeCell(opS, "player", rawOf(h), tl, { kind: "basic", fromClone: h.shot.clone, bonus: pBonus }); if (winnerNow()) break; }
    }
    for (const h of hits) {
      if (h.target === "player" || winnerNow()) continue;
      const raw = rawOf(h);
      if (h.target === "stacked") {
        // stacknutý pár: obrana kryje pár ako jednu postavu; bez nej klon pohltí CLONE_DMG a zvyšok prejde na Naruta
        strikeCell(opS, "stacked", raw, tl, { kind: "basic", fromClone: h.shot.clone, bonus: pBonus });
      } else { // clone (návnada mimo majiteľovej bunky)
        const defended = op.shield || op.mirror; // obrana strelu zastaví (block/odraz), inak preletí cez dym
        strikeCell(opS, "clone", raw, tl, { kind: "basic", fromClone: h.shot.clone });
        if (defended) h.shot.done = true; else h.shot.spent = true;
      }
    }
    if (winnerNow()) break; // prvá smrť končí hru - zvyšok letu sa už nehrá
  }
  // žiadna strela nevzlietla (Naruto aj klon mieria von z plochy) - zahraj útočný švih naprázdno
  // + whiff float, nech akcia nie je „tichá" a čitateľne minula manu (namiesto starého prečiarknutia)
  if (!anyCharge) pushStateFrame(tl, [{ kind: "attack_swing", from: slot, dir, offboard: true }], SMALL_DELAY_MS);
}

function doMelee(slot, tl) {
  const me  = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];

  // postava môže melee prepísať (Vampire/Onryō: úder na vlastnej bunke)
  const meleeOverride = CHARACTERS[me.char]?.melee;
  if (meleeOverride) return meleeOverride(ctx, slot, tl);

  if (me.mana < MELEE_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= MELEE_COST;
  // POWER tile: +2 k MAJITEĽOVMU úderu (klonov sek boost nemá); spotreba pri použití - aj pri minutí
  const pBonus = powerBoost(slot, tl);

  // úder sa švihne vždy (mana je preč aj pri minutí); bežne zasiahne len súpera na rovnakom políčku,
  // Medúza šľahá chvostom širšie - vlastné políčko + 1 diagonálne na všetky strany, za nižší dmg.
  // Zasahované bunky idú v efekte (klient ich zvýrazní a nemusí zrkadliť logiku).
  const myMeleeDmg = kitOf(me.char).meleeDmg; // Medúza/Jotaro slabší melee (kit postavy)
  const cells = G.meleeCells(game.board, me, me.char);
  // vlastný klon seká paralelne na SVOJEJ bunke (rovnaký dmg ako Naruto)
  const cloneCells = me.clone ? [[me.clone.x, me.clone.y]] : [];
  const atCells = (cs, px, py) => cs.some(([x, y]) => x === px && y === py);
  // terče: súperov klon-NÁVNADA (mimo majiteľovej bunky) absorbuje úder na svojej bunke celý;
  // klon STACKNUTÝ na majiteľovej bunke pohltí len CLONE_DMG a zvyšok úderu prejde na majiteľa
  // (rovnaké pravidlo ako pri prestrelenom stacknutom páre v doBasic - nie plný bait);
  // súper na inej zasahovanej bunke (Medúza) dostane úder tiež - zóna, nie jeden terč
  const stacked = !!(op?.clone && op.clone.x === op.x && op.clone.y === op.y);
  const hitFoeByMe    = !!(op && atCells(cells, op.x, op.y) && !stacked);
  const hitFoeByClone = !!(op && atCells(cloneCells, op.x, op.y) && !stacked);
  const hitStackedByMe    = stacked && atCells(cells, op.x, op.y);
  const hitStackedByClone = stacked && atCells(cloneCells, op.x, op.y);
  const hitFoeCloneByMe    = !!(op?.clone && !stacked && atCells(cells, op.clone.x, op.clone.y));
  const hitFoeCloneByClone = !!(op?.clone && !stacked && atCells(cloneCells, op.clone.x, op.clone.y));
  // zásah je istý už pred švihmi (pozície sa nemenia) - REÁLNY zásah odhalí labyrint PRED animáciou
  // (zásah len klona-návnady nie - súper sa nesmie dozvedieť, že trafil; zásah stacknutého páru
  // prejde aj na REÁLNEHO majiteľa, takže odhaľuje)
  if (hitFoeByMe || hitFoeByClone || hitStackedByMe || hitStackedByClone) revealLabyrinths(tl);
  // rovnaká dramaturgia ako special: opakované švihy v beatoch, dmg padne až po nich
  for (let r = 0; r < MELEE_REPEAT; r++) {
    pushStateFrame(tl, [{ kind: "melee", from: slot, cells: cells.concat(cloneCells) }], SPECIAL_BEAT_MS);
  }
  const meleeRaw = myMeleeDmg * dealMul(slot) * labyrinthMul(slot) + pBonus; // maze buff: 2× počas labyrintu; POWER flat +2
  const cloneMeleeRaw = MELEE_DMG * dealMul(slot) * labyrinthMul(slot); // klon (vždy Narutov) seká za plný MELEE_DMG, bez POWER bonusu
  // stacknutý pár Naruto+klon na súperovej bunke seká dvakrát → na nekryté HP JEDEN úder so súčtom
  // (klient vypíše „8+8" a zanimuje ako jeden zásah); pri obrane sa rieši každý sek zvlášť
  if (!(hitFoeByMe && hitFoeByClone && strikeOwnerMulti(opS, [meleeRaw, cloneMeleeRaw], tl, "melee", pBonus))) {
    if (hitFoeByMe) strikeCell(opS, "player", meleeRaw, tl, { kind: "melee", bonus: pBonus });
    if (hitFoeByClone && !winnerNow()) strikeCell(opS, "player", cloneMeleeRaw, tl, { kind: "melee", fromClone: true });
  }
  // stacknutý pár Naruto+klon: obrana kryje pár ako JEDNA postava v jednom beate, bez obrany klon
  // pohltí CLONE_DMG (zomrie) a ZVYŠOK úderu prejde na majiteľa - ako pri streľbe
  if (hitStackedByMe) strikeCell(opS, "stacked", meleeRaw, tl, { kind: "melee", bonus: pBonus });
  if (hitStackedByClone && !winnerNow()) strikeCell(opS, "stacked", cloneMeleeRaw, tl, { kind: "melee", fromClone: true });
  if ((hitFoeCloneByMe || hitFoeCloneByClone) && !winnerNow()) {
    // obrana sa už prípadne „ukázala" na zásahu hráča tou istou akciou → bez duplicitných frame-ov
    // (majiteľov sek na klona nesie aj POWER bonus - mirror z klona ho odrazí ako súčasť plného dmg)
    // plný dmg ako pri zásahu hráča (vrátane maze 2× a pri klonovom seku plného MELEE_DMG) - prejaví sa na sile odrazu
    strikeCell(opS, "clone", hitFoeCloneByMe ? meleeRaw : cloneMeleeRaw, tl, { kind: "melee", fromClone: !hitFoeCloneByMe });
  }
}

/* ---- Vampire / Onryō: melee + charge + pasca ---- */






// Countess/Onre sú IMÚNNE voči mirroru: súperov mirror sa voči ich dmg správa ako obyčajný štít
// (bloklne celý dmg, nič neodráža; spotrebuje sa bežne ako obrana krytej akcie)
function mirrorImmune(atkSlot) {
  return !!kitOf(game.players[atkSlot]?.char).mirrorImmune;
}

/* ---- Pasca (Countess/Onre special) ---- */
// zber buniek, ktorými figúry prešli počas PRÁVE vykonávanej akcie (napĺňajú trackSteps/trackCloneSteps);
// null mimo vyhodnocovania akcie - pasca sa triggeruje až PO úplnom dokončení súperovej akcie
let actionSteps = null;

/* ---- Jotaro THE WORLD (time-stop) ---- */
// sentinel z doAction hore do runRoundLoop: kolo sa pozastaví a čaká na klientove timestop_actions
const PAUSE = Symbol("timestop_pause");
// beží zamrazená trojica Jotarových akcií? (súper zmrznutý, jeho zásahy sa len OHLASujú a kumulujú)
function frozenActive() { return game.timestop?.mode === "frozen"; }
// zmrazený zásah na súpera - NEmeň HP, len ohlás label (ts_hit / ts_mirror ak je nabitý mirror) a zaeviduj raw;
// dmg dopadne kumulatívne (jeden hit s parts) pri obnovení času (applyTimestopResume). raw už obsahuje dealMul (D11).
function noteFrozenHit(tl, targetSlot, raw, kind) {
  const ts = game.timestop;
  if (!ts) return;
  ts.hits.push({ raw, kind });
  pushStateFrame(tl, [{ kind: ts.foeMirror ? "ts_mirror" : "ts_hit", target: targetSlot, dmg: raw, atk: kind }], SMALL_DELAY_MS);
}
// zmrazený zásah na súperovho tieňového klona - odlož clone_die na obnovenie času (žiadny okamžitý poof)
function noteFrozenClone(ownerSlot) {
  const ts = game.timestop; const o = game.players[ownerSlot];
  if (ts && o?.clone) ts.cloneEvents.push({ ownerSlot, cell: [o.clone.x, o.clone.y] });
}


// zánik pasce s viditeľnou deštrukciou - vidia ju OBAJA hráči (zámer: súper sa dozvie, že riziko pominulo)
function breakTrap(slot, tl) {
  const p = game.players[slot];
  if (!p?.trap) return;
  pushStateFrame(tl, [{ kind: "trap_break", from: slot, cell: [p.trap.x, p.trap.y] }], SMALL_DELAY_MS);
  p.trap = null;
}

// po dokončení akcie: (a) vlastný vstup/prechod majiteľa cez vlastnú pascu ju ZNIČÍ,
// (b) súperov vstup/prechod (aj jeho tieňovým klonom) ju TRIGGERNE. Teleport triggera je ďalší pohyb →
// môže reťazovo spustiť pascu druhej strany (Countess vs Onre); každá pasca sa triggerom spotrebuje,
// takže reťaz je konečná.
function resolveTrapsAfterAction(tl) {
  let guard = 0;
  while (actionSteps && guard++ < 4) {
    const steps = actionSteps;
    actionSteps = { p1: [], p2: [], p1c: [], p2c: [] }; // pohyby triggera (teleport) sa zbierajú nanovo
    let any = false;
    for (const moverSlot of ["p1", "p2"]) {
      const moved = steps[moverSlot] || [];
      const movedClone = steps[moverSlot + "c"] || [];
      if (!moved.length && !movedClone.length) continue;
      const onCell = (t) => ([x, y]) => x === t.x && y === t.y;
      const p = game.players[moverSlot];
      if (p.trap && moved.some(onCell(p.trap))) breakTrap(moverSlot, tl);
      const ownerSlot = other(moverSlot);
      const o = game.players[ownerSlot];
      if (o.trap && (moved.some(onCell(o.trap)) || movedClone.some(onCell(o.trap)))) {
        if (triggerTrap(ownerSlot, tl)) any = true;
        if (winnerNow()) return;
      }
    }
    if (!any) break;
  }
}

// spustenie pasce: VŽDY ju spotrebuje a caster sa na bunku VŽDY teleportne; triggerovaný
// melee úder (3 dmg + bonus) už nestojí ďalšiu manu. Súper, čo bunkou len prebehol, dostane
// úder naprázdno. Petrifikovaný caster netriggeruje -
// súperov prechod pascu ZNIČÍ (rovnaká deštrukcia ako vlastný vstup). Vracia true, ak prebehol teleport.
function triggerTrap(ownerSlot, tl) {
  const o = game.players[ownerSlot];
  const foeS = other(ownerSlot);
  const foe = game.players[foeS];
  const cell = o.trap;
  o.trap = null; // trigger pascu vždy spotrebuje
  if (o.stone > 0 || o.hp <= 0) {
    pushStateFrame(tl, [{ kind: "trap_break", from: ownerSlot, cell: [cell.x, cell.y] }], SMALL_DELAY_MS);
    return false;
  }
  // istý zásah reálneho hráča (aj stacknutého páru s klonom, aj do štítu/mirror-bloku) odhalí prípadný
  // labyrint PRED animáciou triggera; whiff naprázdno ani zabitý klon-návnada labyrint neodhaľujú/nekončia
  if (foe && foe.x === cell.x && foe.y === cell.y) revealLabyrinths(tl);
  // pasca sa rozžiari - od tohto momentu ju vidia OBAJA (súper sa dozvedá, kde bola)
  pushStateFrame(tl, [{ kind: "trap_trigger", from: ownerSlot, cell: [cell.x, cell.y] }], SMALL_DELAY_MS);
  // teleport VŽDY: out na pôvodnej bunke → in na bunke pasce (thread labyrintu ráta aj teleport bunku)
  pushStateFrame(tl, [{ kind: "trap_tp_out", from: ownerSlot }], TELEPORT_OUT_MS);
  o.x = cell.x; o.y = cell.y;
  pushStateFrame(tl, [{ kind: "trap_tp_in", from: ownerSlot }, ...trackSteps(ownerSlot, [[cell.x, cell.y]])], TELEPORT_IN_MS);
  // trigger úder: Countess = A1 (jednotná choreografia s melee), Onre = Attack_1 - jeho zjavenie
  // s výkrikom (Scream) hrá klient už počas trap_tp_in framu; dmg dopadne až po údere
  pushStateFrame(tl, [{ kind: "vamp_strike", from: ownerSlot, cell: [cell.x, cell.y],
    anim: o.char === "countess" ? "va1" : "vattack1" }], VAMP_TRAP_STRIKE_MS);
  const raw = VAMP_TRAP_DMG * dealMul(ownerSlot) * labyrinthMul(ownerSlot);
  // trap-melee je akcia castera mimo resolveTurn slučky → zásah si spotrebuje súperovu obranu sám
  // (consumeDefense). Heal beaty A2→A3→A4 + doplnenie HP / mana drain rieši vampBonus vnútri helpera;
  // stacknutý pár Naruto+klon: klon pohltí CLONE_DMG, zvyšok prejde na Naruta a bonus je z toho zvyšku.
  const hitSomething = vampMeleeLand(ctx, ownerSlot, raw, VAMP_TRAP_BONUS, tl, true);
  if (!hitSomething) pushStateFrame(tl, [], SMALL_DELAY_MS); // súper bunkou len prebehol - úder naprázdno
  return true;
}

// Výstupný násobič dmg: Last Hope ultra mód = 4×, Last Stand buff = 2×, inak 1×.
// Prijatý dmg sa zaokrúhľuje na floor(½) pri Last Stand aj Last Hope (½ chráni 1-HP Last Hope hráča pred dmg tile).
function dealMul(slot)      { const p = game.players[slot]; return p.lastHopeBuff ? 4 : p.lastStandBuff ? 2 : 1; }
function recvDmg(slot, dmg) { const p = game.players[slot]; return (p.lastStandBuff || p.lastHopeBuff) ? Math.floor(dmg / 2) : dmg; }
// 2× VÝSTUPNÝ dmg pre hráča s maze buffom (ten, čo úspešne priamym castom zaklial súpera do labyrintu).
// Aplikuje sa na raw pred zásahom (resolveStrike) → ak je Minotaurov útok odrazený, doubled dmg sa vráti späť naňho.
// mazeBuff nezíska mirror-lovec (labyrint cez odraz) ani prekliaty Minotaur → presne cielené na hráča Minotaura.
function labyrinthMul(slot) { return game.players[slot]?.mazeBuff ? 2 : 1; }

// akýkoľvek zásah AKCIOU medzi hráčmi ukončí labyrint (oboch pri mirror matchi) - počíta sa aj
// zablokovaný/odrazený zásah (resolveStrike/applyPetrify/applyLabyrinth sa volajú len keď akcia trafila);
// tile damage ide mimo resolveStrike, takže labyrint neukončuje. Volá sa až PO zásahových frame-och
// (block/odraz/hit + úbytok HP) - ESCAPED a rozsvietenie arény prídu po dohratí zásahu; odhalenie
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

// Ak akcia labyrint ISTO ukončí (zásah padne - počíta sa aj do štítu/zrkadla), odhalenie prebehne
// ešte PRED jej animáciou: labReveal zruší redakciu aj hmlu (klient zjaví skrytého súpera fade-om
// a odkryje jeho widget - HP/mana sú opäť viditeľné), samotný labyrinth flag ale beží ďalej,
// takže aréna ostáva stmavená až po labyrinth_end. Niť a obrys zanikajú už pri odhalení,
// aby ich lovec nevidel ani na okamih. Zásah je deterministický - pozície sa počas animácie nemenia.
function revealLabyrinths(tl) {
  if (frozenActive()) return; // THE WORLD (bod 8): počas zamrazenia sa labyrint neodhaľuje - odklad na obnovenie času
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
// labyrint končí až PO dohratí zásahovej animácie (block/odraz/hit + úbytok HP) - odhalenie súpera
// už predtým zabezpečil revealLabyrinths (labReveal), takže tieto framy sa hrajú neredigované.
// fromClone: zásah pochádza od tieňového klona útočníka - mirror odraz vtedy zničí KLONA
// (nie HP majiteľa); Narutova a klonova strela sú jedna paralelná akcia, obrana neguje obe.
// Escanor pride: poznač „dostal zásah od súpera" - volá sa VŠADE, kde hráčovi klesá HP kvôli súperovi
// (priamy dopad, stacknutý pár, zóna/démon aj odraz vlastného útoku od mirroru). Tile/IK dmg a statusy
// (petrify/banish) sa NEpočítajú. Vyhodnotí sa na konci kola v resolveTurn (−1 pride), flag sa tam nuluje.
function notePrideHit(slot) {
  const p = game.players[slot];
  CHARACTERS[p.char]?.on?.hitTaken?.(ctx, p);
}
// háčik postavy (engine/characters) pre hráča na slote
function charHook(slot, name, ...args) {
  const p = game.players[slot];
  return CHARACTERS[p.char]?.on?.[name]?.(ctx, p, ...args);
}
// snímka roundStart z kola - len ak je na slote STÁLE tá istá postava (swap uprostred kola ju zahodí)
function roundInfo(slot) {
  const ci = game.roundCtx?.charInfo?.[slot];
  return ci && ci.char === game.players[slot].char ? ci.data : undefined;
}
// spoločný reset stavu postáv pri nasadení (voľba postavy / swap) + háčik deploy novej postavy
function deployReset(slot) {
  const p = game.players[slot];
  p.pride = 0;        // Escanor: nasadenie začína na pride 0
  p.prideHit = false; // zásahy predchodcu sa na nového maga neprenášajú
  p.form = "base";    // Luffy: začína v base móde
  p.moon = 0;         // Vlkolak: fázu nastaví jeho deploy háčik podľa (preneseného) HP
  charHook(slot, "deploy");
}

/* ==================== Damage pipeline ==================== */
// KAŽDÝ dmg zásah akciou ide cez resolveStrike - jedno miesto pre všetky prierezové pravidlá:
//   intercept (THE WORLD) → obrana (štít / mirror-imunita / mirror; zdieľaná pre Naruta aj klona)
//   → soak (klon stacknutý na majiteľovej bunke pohltí CLONE_DMG) → dopad (HP, rozplynutie klona,
//   JEDEN hit frame s parts) → udalosti (Escanor pride, koniec labyrintu).
// Akcie ho volajú cez vstupy podľa tvaru zásahu: strikeCell (jedna bunka), strikeZone (zóna specialu),
// strikeOwnerMulti (stacknutý útočník zasiahne hráča viackrát naraz).
//
// figs = zasiahnuté figúry obrancu v JEDNOM beate: [{ fig: "owner" | "clone", raw }]
//   pair:      stacknutý pár s obranou reaguje ako JEDNA postava (jeden blok/lúč bez bunky)
//   soak:      klon stacknutý na majiteľovej bunke pohltí CLONE_DMG zo zásahu majiteľa (zóny/démon)
//   fromClone: akciu vykonal útočníkov klon - klon útočí aj odraz dostáva ako normálny hráč: KAŽDÝ odraz
//              (z hráča, z návnady aj z páru) sa vráti strelcovi = útočníkovmu klonovi a ten sa rozplynie
//              (klon zasiahnutý akýmkoľvek dmg zaniká); HP skutočného útočníka sa nemení
//   bonus:     POWER tile prídavok obsiahnutý v raw - na nekrytom zásahu sa pripne na hit frame (klient
//              ho vypíše ako samostatný zlatý „-2" float); pri bloku/odraze sa rozpis nepripína
// Labyrint končí, keď zásah zasiahol REÁLNEHO hráča (aj blok/odraz) alebo odraz dopadol na útočníka;
// zásah len klona-návnady ho nekončí (súper sa nesmie dozvedieť, že trafil klona). Volá sa až PO
// zásahových frame-och - odhalenie (revealLabyrinths) zabezpečila akcia ešte pred svojou animáciou.
function resolveStrike(defSlot, figs, tl, { kind = "basic", bonus = 0, fromClone = false, pair = false, soak = false } = {}) {
  const o = game.players[defSlot];
  const atkSlot = other(defSlot);
  const atk = game.players[atkSlot];
  const ownerFigs = figs.filter(f => f.fig === "owner");
  const hasOwner = ownerFigs.length > 0;
  const cloneFig = o.clone ? figs.find(f => f.fig === "clone") || null : null;
  if (!hasOwner && !cloneFig) return;
  const cloneCell = cloneFig ? [o.clone.x, o.clone.y] : null;
  const stacked = !!(cloneFig && o.clone.x === o.x && o.clone.y === o.y);
  const soakAmt = soak && stacked ? CLONE_DMG : 0;

  // --- intercept: THE WORLD - zmrazený zásah sa len ohlási a kumuluje (dopadne pri obnovení času);
  //     zásah klona sa odloží (clone_die až pri obnovení). Obranu vyhodnotí applyTimestopResume.
  if (frozenActive() && (!hasOwner || (defSlot === game.timestop.foeSlot && !fromClone))) {
    for (const f of ownerFigs) noteFrozenHit(tl, defSlot, Math.max(0, f.raw - soakAmt), kind);
    if (cloneFig) noteFrozenClone(defSlot);
    return;
  }

  // --- obrana: štít (alebo mirror voči imúnnej Countess/Onre = obyčajný štít) - blok na každej figúre v JEDNOM beate
  if (o.shield || (o.mirror && mirrorImmune(atkSlot))) {
    const gold = o.shield ? !!o.shieldGold : !!o.mirrorGold;
    const fx = [];
    if (pair) fx.push({ kind: "block", target: defSlot, gold });
    else {
      if (hasOwner) fx.push({ kind: "block", target: defSlot, gold });
      if (cloneFig) fx.push({ kind: "block", target: defSlot, cell: cloneCell, gold });
    }
    pushStateFrame(tl, fx, SMALL_DELAY_MS);
    if (hasOwner) endLabyrinths(tl);
    return;
  }
  // --- obrana: mirror - lúče zo všetkých figúr naraz, odrazy dopadnú na útočníka ako JEDEN úder (parts).
  //     Odrazený dmg ide „surovo" (útočníkove obrany ho neblokujú, nedá sa znova odraziť).
  if (o.mirror) {
    const gold = !!o.mirrorGold;
    // odraz klonovej akcie letí DO útočníkovho klona (inak by lúč aj prezradil, ktorý Naruto je pravý)
    const dest = fromClone && atk.clone ? { destCell: [atk.clone.x, atk.clone.y] } : {};
    const beams = [];
    if (pair) beams.push({ kind: "mirror", target: defSlot, dmg: figs[0].raw, atk: kind, gold, ...dest });
    else {
      if (hasOwner) beams.push({ kind: "mirror", target: defSlot, dmg: ownerFigs[0].raw, atk: kind, gold, ...dest });
      if (cloneFig) beams.push({ kind: "mirror", target: defSlot, cell: cloneCell, dmg: cloneFig.raw, atk: kind, gold, ...dest });
    }
    pushStateFrame(tl, beams, MIRROR_BEAM_MS);
    if (fromClone) { // všetky odrazy dopadnú na útočníkovho klona - rozplynie sa, HP nikomu neklesá
      killClone(atkSlot, tl);
      endLabyrinths(tl);
      return;
    }
    const parts = [];
    if (hasOwner) parts.push(recvDmg(atkSlot, ownerFigs[0].raw)); // ½ ak má útočník Last Stand/Hope
    if (cloneFig) parts.push(recvDmg(atkSlot, cloneFig.raw));     // klonov mirror odráža PLNÝ dmg (ako hráčov)
    const total = parts.reduce((a, b) => a + b, 0);
    atk.hp = Math.max(0, atk.hp - total);
    notePrideHit(atkSlot); // odraz od mirroru je tiež zásah od súpera
    pushStateFrame(tl, [parts.length > 1 && total > 0
      ? { kind: "hit", target: atkSlot, dmg: total, parts }
      : { kind: "hit", target: atkSlot, dmg: total }], SMALL_DELAY_MS);
    endLabyrinths(tl);
    return;
  }

  // --- bez obrany: klon-návnada sám sa rozplynie (labyrint nekončí)
  if (!hasOwner) { killClone(defSlot, tl); return; }
  // soak + dopad: viac zásahov majiteľa jednou akciou = JEDEN úder so súčtom (parts); stacknutý klon
  // pohltí CLONE_DMG (soak) a rozplynie sa v tom istom beate
  const raws = ownerFigs.map(f => f.raw);
  if (soakAmt) raws[0] = Math.max(0, raws[0] - soakAmt);
  const parts = raws.map(r => recvDmg(defSlot, r)); // ½ ak má obranca Last Stand/Hope (2× maze je už v raw)
  const d = parts.reduce((a, b) => a + b, 0);
  o.hp = Math.max(0, o.hp - d);
  if (d > 0) notePrideHit(defSlot);
  const fx = [];
  if (d > 0 || !cloneFig) {
    const hitFx = parts.length > 1 ? { kind: "hit", target: defSlot, dmg: d, parts } : { kind: "hit", target: defSlot, dmg: d };
    // POWER bonus rozpis len keď ho ½ prijímanie / soak neskreslí (bonus je vnútri PRVEJ - majiteľovej - časti)
    if (bonus > 0 && d === raws.reduce((a, b) => a + b, 0) && parts[0] >= bonus) hitFx.bonus = bonus;
    fx.push(hitFx);
  }
  if (cloneFig) { fx.push({ kind: "clone_die", target: defSlot, cell: cloneCell }); o.clone = null; }
  pushStateFrame(tl, fx, SMALL_DELAY_MS);
  endLabyrinths(tl);
}

// jedna akcia zasiahne súperovu BUNKU (strela, sek, charge, pasca, Luffy). who = G.figureAt na bunke:
//   "player"  → zásah hráča
//   "clone"   → klon-návnada zožerie zásah celý
//   "stacked" → s obranou pár reaguje ako JEDNA postava; bez obrany klon pohltí CLONE_DMG a ZVYŠOK prejde
//               na majiteľa - poof klona aj zásah v JEDNOM beate (rovnako ako zóna)
function strikeCell(defSlot, who, raw, tl, { kind = "basic", bonus = 0, fromClone = false } = {}) {
  const o = game.players[defSlot];
  if (fromClone) bonus = 0; // POWER bonus nesie len majiteľova akcia (klon z power tile neprofituje)
  if (who === "player") return resolveStrike(defSlot, [{ fig: "owner", raw }], tl, { kind, bonus, fromClone });
  if (who === "clone") return resolveStrike(defSlot, [{ fig: "clone", raw }], tl, { kind, fromClone });
  if (who !== "stacked") return;
  if (o.shield || o.mirror) return resolveStrike(defSlot, [{ fig: "owner", raw }, { fig: "clone", raw }], tl, { kind, fromClone, pair: true });
  resolveStrike(defSlot, [{ fig: "owner", raw }, { fig: "clone", raw }], tl, { kind, bonus, fromClone, soak: true });
}

// zóna specialu (aj démon) zasiahne hráča a/alebo jeho klona - Naruto a klon sú tá istá postava so
// zdieľanou obranou, ich reakcie idú NARAZ v jednom beate (blok / lúče / hit + poof). Klon stacknutý na
// majiteľovi s obranou = pár ako JEDNA postava (jeden blok/lúč), rovnako ako pri zásahu bunky.
function strikeZone(defSlot, playerIn, cloneIn, raw, tl, { kind = "special", bonus = 0 } = {}) {
  const o = game.players[defSlot];
  if (playerIn) {
    const figs = [{ fig: "owner", raw }];
    if (cloneIn && o.clone) figs.push({ fig: "clone", raw });
    const pair = figs.length > 1 && o.clone.x === o.x && o.clone.y === o.y && (o.shield || o.mirror);
    resolveStrike(defSlot, figs, tl, { kind, bonus, soak: true, pair });
  } else if (cloneIn) resolveStrike(defSlot, [{ fig: "clone", raw }], tl, { kind });
}

// stacknutý útočník (Naruto + klon z jednej bunky) zasiahne hráča viackrát JEDNOU akciou: na nekryté HP
// jeden úder so súčtom (parts). S obranou (alebo jediný zásah) vráti false - volajúci rieši každý zásah
// zvlášť cez strikeCell (obrana reaguje na každý osobitne). THE WORLD: každý zásah sa ohlási samostatne.
function strikeOwnerMulti(defSlot, raws, tl, kind, bonus = 0) {
  const t = game.players[defSlot];
  if (frozenActive() && defSlot === game.timestop.foeSlot) { for (const r of raws) noteFrozenHit(tl, defSlot, r, kind); return true; }
  if (raws.length < 2 || t.shield || t.mirror) return false;
  resolveStrike(defSlot, raws.map(raw => ({ fig: "owner", raw })), tl, { kind, bonus });
  return true;
}




// skamenenie cez obrany obrancu - zrkadlí obranu v resolveStrike: shield ho zablokuje (a spotrebuje sa),
// mirror ho odrazí na Medúzu (surovo - odrazený kameň sa už nedá blokovať ani znova odraziť)
function applyPetrify(targetSlot, tl) {
  const t = game.players[targetSlot];
  if (t.shield) {
    pushStateFrame(tl, [{ kind: "block", target: targetSlot, gold: !!t.shieldGold }], SMALL_DELAY_MS);
    endLabyrinths(tl); // zasahujúci (hoci zablokovaný) petrify je tiež zásah - labyrint končí po block animácii
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

// labyrint cez obrany obrancu - zrkadlí applyPetrify: shield ho zablokuje (a spotrebuje sa),
// mirror ho odrazí na Minotaura (v labyrinte skončí sám kaster - oslepne a niť ťahá on)
function applyLabyrinth(targetSlot, tl) {
  const t = game.players[targetSlot];
  if (t.shield) {
    pushStateFrame(tl, [{ kind: "block", target: targetSlot, gold: !!t.shieldGold }], SMALL_DELAY_MS);
    endLabyrinths(tl); // zasahujúci (hoci zablokovaný) labyrint je tiež zásah - prípadný bežiaci labyrint kastera končí
    return;
  }
  // starý labyrint musí skončiť PRED novým zakliatím (nikdy nebežia dva naraz) - až po prípadnej odrazovej animácii
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
// threadMark = POSLEDNÉ políčko, kde sa niť a Minotaur stretli - vznikne oboma smermi:
// (a) Minotaur vstúpi na niť (aj prebehnutím dashom), (b) prekliaty dorastie niťou na bunku,
// kde Minotaur práve stojí. Prekliaty tam vidí jeho obrys. Vracia efekty k pohybovému frame-u.
function trackSteps(slot, cells) {
  // pasca (Countess/Onre): zbieraj bunky, ktorými figúra počas akcie prešla (vrátane teleportu triggera) -
  // resolveTrapsAfterAction z nich po dokončení akcie vyhodnotí vstup/prechod cez pascu
  if (actionSteps) actionSteps[slot].push(...cells.map(c => [...c]));
  const fx = [];
  const p = game.players[slot];
  const foeS = other(slot);
  const foe = game.players[foeS];
  if (p.labyrinth) {
    let mark = null;
    for (const [x, y] of cells) {
      if (!p.thread.some(([tx, ty]) => tx === x && ty === y)) p.thread.push([x, y]);
      if (foe && !foe.labyrinth && foe.x === x && foe.y === y) mark = [x, y]; // niť dorástla na Minotaurovu bunku
      // lovcov tieňový klon sa ráta tiež - prekliaty na jeho bunke uvidí siluetu (nevie, že je to klon)
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
  // BLOCK tile: obrana sa na ňom nedá castnúť - prečiarknutie BEZ ceny (mana ostáva).
  // THE WORLD (D3): počas zamrazenia sú dlaždice inertné → shield sa armne aj z block tile.
  if (defenseBlockedBy(a) && !frozenActive()) { pushInvalid(tl, slot, SMALL_DELAY_MS, "blocked_shield"); return; }
  if (a.mana < SHIELD_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  a.mana -= SHIELD_COST;
  a.shield = true;
  a.shieldGold = false;
  pushStateFrame(tl, [{ kind: "shield", from: slot }], SMALL_DELAY_MS);
}

function doMirror(slot, tl) {
  const a = game.players[slot];
  // BLOCK tile: obrana sa na ňom nedá castnúť - prečiarknutie BEZ ceny (mana ostáva)
  if (defenseBlockedBy(a)) { pushInvalid(tl, slot, SMALL_DELAY_MS, "blocked_mirror"); return; }
  if (a.mana < MIRROR_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  a.mana -= MIRROR_COST;
  a.mirror = true;
  a.mirrorGold = false;
  pushStateFrame(tl, [{ kind: "mirror_on", from: slot }], SMALL_DELAY_MS);
}

// Jotaro Special 1 (v mirror slote): 4 many, smerový (left/right), 4 dmg na OBE diagonálne bunky strany.
// Cez obrany ako každý dmg special (shield blokuje, mirror odrazí 4). Zóna zasiahne súpera aj jeho klona
// (strikeZone). Prázdna zóna (útok z krajného stĺpca von) = wall-rule whiff (mana preč, choreografia, bez dmg).
function doJotaroS1(slot, dir, tl) {
  const actor = game.players[slot];
  if (!actor) return;
  if (dir !== "left" && dir !== "right") { pushInvalid(tl, slot); return; }
  if (actor.mana < JOTARO_S1_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  actor.mana -= JOTARO_S1_COST;
  const pBonus = powerBoost(slot, tl); // POWER tile: +2; spotreba pri použití (aj whiff/block/odraz)
  const cells = jotaroS1Cells(actor, dir);
  if (!cells.length) { // celá zóna mimo plochy → útok do steny (vykoná sa, mana preč, neprečiarkuje sa)
    pushStateFrame(tl, [{ kind: "special1", from: slot, dir, cells: [], offboard: true }], SPECIAL_BEAT_MS);
    return;
  }
  const foeS = other(slot);
  const foe  = game.players[foeS];
  const inZone = !!(foe && cells.some(([x, y]) => x === foe.x && y === foe.y));
  const cloneStruck = !!(foe?.clone && cells.some(([x, y]) => x === foe.clone.x && y === foe.clone.y));
  if (inZone) revealLabyrinths(tl); // istý zásah odhalí prípadný labyrint pred animáciou
  pushStateFrame(tl, [{ kind: "special1", from: slot, dir, cells }], SPECIAL_BEAT_MS);
  const dmg = JOTARO_S1_DMG * dealMul(slot) + pBonus;
  if (inZone || cloneStruck) strikeZone(foeS, inZone, cloneStruck, dmg, tl, { kind: "special", bonus: pBonus });
  else pushStateFrame(tl, [], SMALL_DELAY_MS);
}

// THE WORLD (Jotarov special pred prvým použitím) - jednorazový time-stop. Cast + zachytenie súperovej
// nabitej obrany, potom PAUZA (runRoundLoop pošle čiastočnú timeline a čaká na klientove timestop_actions).
// Mana gate (5) overil doSpecial. Vracia PAUSE sentinel.
function doJotaroWorld(slot, tl) {
  const actor = game.players[slot];
  const foeS = other(slot);
  const foe = game.players[foeS];
  actor.mana -= WORLD_COST;
  actor.worldUsed = true; // po THE WORLD sa special button natrvalo mení na Special 2 (prežíva swap)
  // cast: Star Platinum „menace" + celoplošný blik (ako Minotaur) + invert flash (globálny - vidia obaja);
  // nedá sa blokovať/odraziť. Po tomto frame plocha prestane blikať a čas sa zastaví (timestop_wait).
  const castCells = [];
  for (let y = 0; y < game.board.h; y++) for (let x = 0; x < game.board.w; x++) castCells.push([x, y]);
  pushStateFrame(tl, [{ kind: "timestop_start", from: slot, cells: castCells }], TIMESTOP_CAST_MS);
  // zachyť súperovu NABITÚ obranu (armed PRED castom) - NEspotrebuje sa castom (runRoundLoop preskočí
  // consumption), platí cez celé zamrazenie a vyhodnotí sa kumulatívne pri obnovení času (applyTimestopResume)
  game.timestop = {
    slot, foeSlot: foeS,
    foeShield: !!foe?.shield, foeShieldGold: !!foe?.shieldGold,
    foeMirror: !!foe?.mirror, foeMirrorGold: !!foe?.mirrorGold,
    hits: [], cloneEvents: [], mode: "waiting",
  };
  return PAUSE;
}

// zmrazené vykonanie 3 nových Jotarových akcií (frozen mode), potom obnovenie času a kumulatívna aplikácia
function runTimestopActions(queue) {
  const ts = game.timestop, ctx = game.roundCtx, tl = ctx.tl;
  ts.mode = "frozen";
  const slot = ts.slot;
  // actionSteps zámerne null (D4): pasce sa počas zamrazenia netriggerujú a prejdené bunky sa nezbierajú;
  // trackSteps ale niť labyrintu pletie ďalej (D5 - je to Jotarov reálny pohyb)
  actionSteps = null;
  for (const act of queue) {
    // frozen:true - klient túto akciu NEzaráta do round-scriptu (kurzor ostáva na THE WORLD), len ju animuje
    pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: act.type, dir: act.dir || null }, frozen: true }], 250);
    doAction(slot, act, tl); // frozen: zásah na súpera sa cez guardy v apply* len ohlási (ts_hit/ts_mirror)
    pushStateFrame(tl, [], ACTION_GAP_MS);
  }
  applyTimestopResume();
  // resume mohol niekoho zabiť (kumulatívny zásah / mirror odraz na Jotara) - prvá smrť končí hru
  if (winnerNow()) { ctx.ended = true; return finishRound(); }
  runRoundLoop(); // pokračuj zvyškom kola od uloženej pozície (ctx.i / ctx.slotIdx)
}

// obnovenie času: reveal (ak zásah + labyrint), timestop_end, potom JEDEN kumulatívny beat
// (block / mirror odraz / hit s parts / nič) podľa súperovej nabitej obrany a súčtu zmrazených zásahov.
function applyTimestopResume() {
  const ts = game.timestop, ctx = game.roundCtx, tl = ctx.tl;
  ts.mode = "applying"; // vypni frozen (frozenActive() false) - reveal/endLabyrinths a kumulatívny zásah bežia naživo
  const jslot = ts.slot, foeS = ts.foeSlot;
  const jo = game.players[jslot], foe = game.players[foeS];
  const anyEvent = ts.hits.length > 0 || ts.cloneEvents.length > 0;
  // istý zásah počas zamrazenia + beží labyrint → reveal PRED aplikačnými frame-ami (hra nesmie skončiť v hmle)
  if (anyEvent) revealLabyrinths(tl);
  pushStateFrame(tl, [{ kind: "timestop_end", from: jslot }], TIMESTOP_END_MS);

  // odložené klonové úmrtia (decoy/absorb) - poof pri obnovení
  for (const ev of ts.cloneEvents) {
    const o = game.players[ev.ownerSlot];
    if (o?.clone) { pushStateFrame(tl, [{ kind: "clone_die", target: ev.ownerSlot, cell: [o.clone.x, o.clone.y] }], SMALL_DELAY_MS); o.clone = null; }
  }

  if (ts.hits.length === 0) {
    // žiadny zásah na hráča (nanajvýš zomrel decoy klon) → nabitá obrana OSTÁVA (D1), labyrint (ak decoy) NEkončí
    game.timestop = null;
    return;
  }
  const parts = ts.hits.map(h => recvDmg(ts.foeShield ? foeS : (ts.foeMirror ? jslot : foeS), h.raw));
  const total = parts.reduce((a, b) => a + b, 0);
  const rawTotal = ts.hits.reduce((a, h) => a + h.raw, 0);

  if (ts.foeShield) {
    // shield platil cez celé zamrazenie: jeden block, 0 dmg, spotrebuj
    pushStateFrame(tl, [{ kind: "block", target: foeS, gold: ts.foeShieldGold }], SMALL_DELAY_MS);
    foe.shield = false; foe.shieldGold = false;
  } else if (ts.foeMirror) {
    // mirror: foe nezraniteľný + JEDEN kumulatívny odraz celého súčtu späť na Jotara
    pushStateFrame(tl, [{ kind: "mirror", target: foeS, dmg: rawTotal, atk: "special", gold: ts.foeMirrorGold }], MIRROR_BEAM_MS);
    foe.mirror = false; foe.mirrorGold = false;
    if (jo.shield) {
      // Jotaro si počas zamrazenia nabil štít → odraz mu ho ZNIČÍ namiesto zásahu (jeden block, 0 dmg)
      pushStateFrame(tl, [{ kind: "block", target: jslot, gold: jo.shieldGold }], SMALL_DELAY_MS);
      jo.shield = false; jo.shieldGold = false;
    } else {
      jo.hp = Math.max(0, jo.hp - total);
      notePrideHit(jslot);
      pushStateFrame(tl, [{ kind: "hit", target: jslot, dmg: total, ...(parts.length > 1 ? { parts } : {}) }], SMALL_DELAY_MS);
    }
  } else {
    // bez obrany: jeden kombinovaný hit s parts (súčet naraz, jeden hurt)
    foe.hp = Math.max(0, foe.hp - total);
    notePrideHit(foeS);
    pushStateFrame(tl, [{ kind: "hit", target: foeS, dmg: total, ...(parts.length > 1 ? { parts } : {}) }], SMALL_DELAY_MS);
  }
  endLabyrinths(tl); // aspoň jeden zásah/blok/odraz dopadol → labyrint končí (aj blokovaný/odrazený)
  game.timestop = null;
}

// special: spoločný mana gate, samotné vyhodnotenie deklaruje postava (engine/characters/<postava>.js).
// Návratová hodnota (PAUSE pri Jotarovom THE WORLD) sa prepošle hore do kola.
function doSpecial(slot, tl, dir = null, cell = null) {
  const actor = game.players[slot];
  if (!actor) return;
  // Bez many -> len spätná väzba (Hurt na klientovi + low mana výstraha), žiadna special animácia
  if (actor.mana < SPECIAL_COST) {
    pushInvalid(tl, slot, SMALL_DELAY_MS, "mana");
    return;
  }
  return CHARACTERS[actor.char]?.special.resolve(ctx, slot, tl, { dir, cell });
}

// Démon útok (len buffnutý hráč v poslednom kole): veľký démon v strede sa animuje ako special,
// blikajú cieľové bunky (všetky okrem kasterovej) a potom dá 10 dmg súperovi, ak na niektorej stojí.
function doDemon(slot, tl) {
  const me  = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];

  if (me.mana < DEMON_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= DEMON_COST;
  // POWER tile: aj démon je akcia s okamžitým dmg → +2 (10 → 12); spotreba pri použití
  const pBonus = powerBoost(slot, tl);

  // dosah = všetky políčka okrem toho, na ktorom kaster stojí (jediná „bezpečná" bunka pre súpera)
  const cells = G.allCells(game.board, me);

  // zásah: súper dostane dmg, ak NESTOJÍ na kasterovej bunke; cez shield/mirror (resolveStrike) - bez 2× buffu (10 = istá smrť)
  const inRange = op && !(op.x === me.x && op.y === me.y);
  // istý zásah - prípadný labyrint sa odhalí ešte pred vynorením démona
  if (inRange) revealLabyrinths(tl);

  // démon sa vynorí veľký v strede + bliká cieľové bunky v rovnakej kadencii ako special (ultimatka)
  pushStateFrame(tl, [{ kind: "demon_summon", from: slot }], LS_APPEAR_MS);
  for (let r = 0; r < SPECIAL_REPEAT; r++) {
    pushStateFrame(tl, [{ kind: "demon_attack", from: slot, cells }], SPECIAL_BEAT_MS);
  }

  // ak súper bráni (shield alebo mirror), démon nech najprv zmizne zo stredu, nech je block/odraz animácia viditeľná
  const defended = inRange && (op.shield || op.mirror);
  if (defended) pushStateFrame(tl, [{ kind: "demon_center_out", from: slot }], SMALL_DELAY_MS);
  // súperov tieňový klon v zóne (všade okrem kasterovej bunky) - zomiera/bráni SPOLU so súperom v jednom beate
  const cloneInRange = !!(op?.clone && !(op.clone.x === me.x && op.clone.y === me.y));
  if (inRange || cloneInRange) {
    strikeZone(opS, inRange, cloneInRange, DEMON_DMG + pBonus, tl, { kind: "demon", bonus: pBonus });
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
  // poistka k validQueue: side-postavu nemožno swapnúť ani odswapnúť (odlišná sémantika akcií)
  if (SIDE_CHARS[from] || SIDE_CHARS[to]) { pushInvalid(tl, slot, SMALL_DELAY_MS); return; }
  if ((game.mageHp[person]?.[to] ?? 0) <= 0) { pushInvalid(tl, slot, SMALL_DELAY_MS); return; }
  // labyrint mohol padnúť v tomto kole PO naplánovaní swapu (Minotaurov special skôr v poradí) -
  // počas kliatby je výmena zakázaná pre obe strany, naplánovaný swap prepadne ako invalid
  if (game.players.p1.labyrinth || game.players.p2.labyrinth) { pushInvalid(tl, slot, SMALL_DELAY_MS); return; }
  // poistka k validQueue: hráč s Last Stand buffom vo final kole nesmie swapnúť (buff sa zapína
  // až na konci aktivačného kola, takže mid-round race nehrozí - guard drží pravidlo aj do budúcna)
  if (me.lastStandBuff) { pushInvalid(tl, slot, SMALL_DELAY_MS); return; }
  // tieňový klon odchádza s Narutom (nesmie prežiť výmenu maga); pasca zaniká swapom tiež
  killClone(slot, tl);
  breakTrap(slot, tl);
  // ulož živý stav odchádzajúceho maga (nesie sa do ďalších kôl / char-selectu ďalšej hry)
  game.mageHp[person][from] = Math.max(0, me.hp);
  game.mageMana[person][from] = Math.max(0, Math.min(MAX_MANA, me.mana));
  // (1) starý mág zmizne
  pushStateFrame(tl, [{ kind: "teleport_out", from: slot, char: from }], TELEPORT_OUT_MS);
  // prepni identitu + nasaď HP/manu nového maga
  me.char = to;
  me.hp = game.mageHp[person][to];
  me.mana = game.mageMana[person][to];
  deployReset(slot); // pride/forma/mesiac nového maga (vlkolak: fáza HNEĎ podľa preneseného HP)
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
    case "special":  return doSpecial(slot, tl, action.dir, action.cell || null); // dir: Medúza/Escanor/Jotaro(S2); cell: Vojak (cieľová bunka)
    case "special1": return doJotaroS1(slot, action.dir, tl); // Jotarov útok v mirror slote (smer left/right)
    case "shield":   return doShield(slot, tl);
    case "mirror":   return doMirror(slot, tl);
    case "demon":    return doDemon(slot, tl);
    case "pass":     return doPass(slot, tl);
    default: break;
  }
}

// PASS - nevyplnený slot pri vypršaní času: hráč „premýšľa" (THINKING nad postavou) a stratí PASS_MANA_COST
// many (najviac toľko, koľko má). Je to bežná akcia - súperovu nachystanú obranu spotrebuje.
function doPass(slot, tl) {
  const p = game.players[slot];
  const lost = Math.min(PASS_MANA_COST, Math.max(0, p.mana));
  p.mana -= lost;
  pushStateFrame(tl, [{ kind: "pass", from: slot, mana: lost }], SMALL_DELAY_MS);
}

/* -------------------- Special tiles -------------------- */
function hasTile(x, y) {
  return game.tiles.some(t => t.x === x && t.y === y);
}
function hasIK(x, y) {
  return game.iks.some(t => t.x === x && t.y === y);
}
// BLOCK tile: figúra na ňom nemôže armovať shield/mirror. Kontroluje majiteľa AJ jeho tieňového klona -
// zdieľaná obrana sa armuje na oboch figúrach naraz, takže klon stojaci na block tile cast tiež zmarí.
// Kontrola je až pri VYKONANÍ (nie vo validQueue) - vlastná pozícia v momente vyhodnotenia nie je pri
// plánovaní istá (charge sa zastavuje o súperovu figúru, trap teleportuje).
function defenseBlockedBy(a) {
  const onBlock = (x, y) => game.tiles.some(t => t.type === "block" && t.x === x && t.y === y);
  return !!a && (onBlock(a.x, a.y) || (!!a.clone && onBlock(a.clone.x, a.clone.y)));
}
// POWER tile: caster stojí na ňom v momente vyhodnotenia dmg akcie → vráti +POWER_TILE_BONUS k útoku
// a tile SPOTREBUJE (tile_consume flare). Volá sa hneď po odpočte many - spotreba platí za POUŽITIE útoku,
// aj keď skončí whiffom do steny / blokom / odrazom (rovnaká filozofia ako Fireova konzumácia dmg tile).
// Bonus je flat (NEnásobí sa dealMul/labyrinthMul - klient ho vypisuje ako samostatný „-2" float) a mirror
// ho odráža ako súčasť plného dmg. Narutov klon boost nemá ani tile nespotrebúva (ráta sa LEN majiteľova bunka).
function powerBoost(slot, tl) {
  if (frozenActive()) return 0; // THE WORLD (D2): dlaždice sa počas zamrazenia nevyhodnocujú - power inertný, nespotrebuje sa
  const me = game.players[slot];
  const idx = game.tiles.findIndex(t => t.type === "power" && t.x === me.x && t.y === me.y);
  if (idx < 0) return 0;
  game.tiles.splice(idx, 1);
  pushStateFrame(tl, [{ kind: "tile_consume", from: slot, cell: [me.x, me.y], tile: "power" }], SMALL_DELAY_MS);
  return POWER_TILE_BONUS;
}
function pickCell(filterFn) {
  const cells = [];
  for (let y = 0; y < game.board.h; y++)
    for (let x = 0; x < game.board.w; x++)
      if (filterFn(x, y)) cells.push({ x, y });
  return cells.length ? cells[Math.floor(rand() * cells.length)] : null;
}

// koniec ťahu: pickupy (heal/mana) a damage políčka (dmg/IK); štít tile damage neblokuje.
// stonedStep = kto bol skamenený na začiatku kroku - skamenená postava sa berie, akoby na políčku nikto nestál
// (žiadny pickup, žiadny dmg/IK), a to aj v kroku, v ktorom jej kameň práve skončil
function endOfStepTileEffects(tl, stonedStep = { p1: false, p2: false }) {
  const order = game.starter === "p1" ? ["p1", "p2"] : ["p2", "p1"];
  const stoned = (slot) => stonedStep[slot] || game.players[slot].stone > 0;

  // heal/mana - pri oboch hráčoch na rovnakom tile berie ten, kto kolo začína
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
      // heal dlaždica: +1 HP; postava s kitom healTile "full" (Lightning) sa vylieči na plné HP
      const superHeal = kitOf(p.char).healTile === "full";
      const healAmount = superHeal ? START_HP : p.hp + 1;
      const healed = Math.min(START_HP, healAmount) - p.hp;
      p.hp += healed;
      if (healed > 0) {
        // Lightning full-heal pasívka: klient ukáže „SUPER HEAL" float namiesto obyčajného +N HP
        pushStateFrame(tl, [{ kind: "heal", target: slot, amount: healed, super: superHeal }], SMALL_DELAY_MS);
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
    // (kaster labyrintu dostáva tile dmg/IK normálne ako mimo labyrintu - mazeBuff už nedáva imunitu na dlaždice)
    let dmg = 0, tileType = null;
    if (hasIK(p.x, p.y)) { dmg = 10; tileType = "ik"; }
    else if (game.tiles.some(t => t.type === "dmg" && t.x === p.x && t.y === p.y)) {
      // Fire Wizard už NIE je imunný voči Damage dlaždiciam - dostane bežný 1 dmg;
      // výmenou mu státie na ohnivom políčku rozšíri special o riadky ±1 (viď fireOnDmgTile).
      dmg = 1; tileType = "dmg";
    }
    if (dmg > 0) {
      const d = recvDmg(slot, dmg);
      // tile dmg labyrint bežne NEkončí - výnimka je smrteľný zásah: pred finálnym dmg sa prehrá
      // rovnaká postupnosť ako pri akciovom zásahu (reveal PRED animáciou, koniec labyrintu po hite),
      // aby smrť nepadla v hmle a hra neskončila s aktívnou redakciou
      const lethalInLab = d >= p.hp && (game.players.p1.labyrinth || game.players.p2.labyrinth);
      if (lethalInLab) revealLabyrinths(tl);
      // najprv zvýrazni vyhodnocované políčko, potom zásah (½ ak má hráč last stand buff - platí aj na tile/IK)
      pushStateFrame(tl, [{ kind: "tile_proc", tile: tileType, cell: [p.x, p.y] }], 600);
      p.hp = Math.max(0, p.hp - d);
      pushStateFrame(tl, [{ kind: "hit", target: slot, dmg: d }], SMALL_DELAY_MS);
      if (lethalInLab) endLabyrinths(tl);
      // prvý mŕtvy okamžite ukončuje hru - druhý tile zásah sa už nevyhodnotí (remíza nemôže nastať)
      if (winnerNow()) return;
    }
  }

  // tieňové klony: heal/mana IGNORUJÚ (neberú - nespotrebovaný pickup pod „postavou" klona prezrádza),
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
      // až POTOM kozmetický zásah na klonovi - inak sa blik políčka „stratí" v spoločnom frame
      pushStateFrame(tl, [{ kind: "tile_proc", tile: "dmg", cell: [x, y] }], 600);
      pushStateFrame(tl, [{ kind: "clone_hit", target: slot, cell: [x, y], dmg: 1 }], SMALL_DELAY_MS);
    }
  }
}

// vyber typ tile podľa percentuálnych váh (dmg/heal/mana/ik/power/block, spolu ~100); null ak sú všetky 0
function rollTileType(weights) {
  const order = ["dmg", "heal", "mana", "ik", "power", "block"];
  const total = order.reduce((a, k) => a + Math.max(0, weights?.[k] || 0), 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const k of order) {
    r -= Math.max(0, weights?.[k] || 0);
    if (r < 0) return k;
  }
  return order[order.length - 1];
}

// koniec kola: zmaterializuj VOPRED ohlásené zmeny (game.pending - hráči ich celé kolo videli ako preview)
// a hneď vyžrebuj novú sadu na koniec ďalšieho kola. Náhoda sa tak hádže o kolo skôr než dopadne.
function endOfRoundTiles() {
  if (!game.config) return;
  commitPendingTiles();
  rollPendingTiles();
}

// vykonaj ohlásené zmeny: presuň každý IK na jeho ohlásený cieľ + spawni ohlásené nové tiles.
// Constraints sa NEprehodnocujú - vyhodnotili sa už pri žrebe (rollPendingTiles) proti budúcemu stavu
// a tiles môžu počas kola už len MIZNÚŤ (pickup, Fireova konzumácia), takže ohlásená bunka ostáva legálna.
function commitPendingTiles() {
  const p = game.pending;
  if (!p) return;
  game.iks = game.iks.map((ik, i) => p.ikMoves[i] ? { ...p.ikMoves[i] } : ik); // pole je paralelné s game.iks
  for (const s of p.spawns) {
    if (s.type === "ik") game.iks.push({ x: s.x, y: s.y });
    else game.tiles.push({ x: s.x, y: s.y, type: s.type });
  }
  game.pending = null;
}

// vyžrebuj zmeny, ktoré dopadnú na konci NASLEDUJÚCEHO kola: cieľ presunu každého IK (dva IK nesmú skončiť
// na rovnakom políčku; ostatné tiles a hráči nevadia) + tilesPerRound nových spawnov podľa percentuálnych váh.
// Všetky constraints sa vyhodnocujú proti BUDÚCEMU stavu dosky (ohlásené IK ciele + ohlásené spawny).
function rollPendingTiles() {
  if (!game.config) return;
  const ikMoves = [];
  for (const ik of game.iks) {
    const c = pickCell((x, y) => !ikMoves.some(m => m.x === x && m.y === y));
    ikMoves.push(c ? { x: c.x, y: c.y } : { x: ik.x, y: ik.y }); // bez voľného políčka ostane na mieste
  }
  const spawns = [];
  const futureIK = (x, y) => ikMoves.some(m => m.x === x && m.y === y)
    || spawns.some(s => s.type === "ik" && s.x === x && s.y === y);
  const futureTile = (x, y) => hasTile(x, y) || spawns.some(s => s.type !== "ik" && s.x === x && s.y === y);
  const n = Math.max(1, Math.min(3, game.config.tilesPerRound || 1));
  for (let k = 0; k < n; k++) {
    const type = rollTileType(game.config.tileWeights);
    if (!type) break;
    if (type === "ik") {
      // IK môže vzniknúť hocikde (aj pod hráčom, aj nad iným tile); len nie na budúcej pozícii iného IK
      const c = pickCell((x, y) => !futureIK(x, y));
      if (c) spawns.push({ x: c.x, y: c.y, type: "ik" });
    } else {
      // môže byť aj pod hráčom; nie na existujúcom/ohlásenom tile ani pod budúcim IK
      const c = pickCell((x, y) => !futureTile(x, y) && !futureIK(x, y));
      if (c) spawns.push({ x: c.x, y: c.y, type });
      else {
        // doska je plná special tiles (žiadna bunka pre dmg/heal/mana) → namiesto preskočenia spawnu
        // padne IK BEZ OHĽADU na váhy (IK smie prekryť tiles) - late-game poistka, nech sa hra nezasekne
        const ik = pickCell((x, y) => !futureIK(x, y));
        if (ik) spawns.push({ x: ik.x, y: ik.y, type: "ik" });
      }
    }
  }
  game.pending = { ikMoves, spawns };
}

// platná základná akcia? (move/attack/dash potrebujú smer); allowDemon = buffnutý hráč smie navoliť aj démon útok;
// char kvôli Vampire/Onryō (diagonálny attack; dash = charge s rovnakými smermi, melee bez smeru)
function validBasicAction(a, used, allowDemon = false, char = null) {
  if (!a) return false;
  const known = ACTION_TYPES.has(a.type) || (allowDemon && a.type === "demon");
  if (!known || used.has(a.type)) return false;
  const special1Slot = kitOf(char).mirrorSlot === "special1";
  if (a.type === "mirror" && special1Slot) return false;   // postava nemá mirror (Jotaro - v tom slote special1)
  if (a.type === "special1" && !special1Slot) return false;
  if (a.type === "special1" && a.dir !== "left" && a.dir !== "right") return false;
  if ((a.type === "move" || a.type === "dash") && !MOVE_DIRS.has(a.dir)) return false;
  // Luffy: forma v čase basicu tu (draft/auto-fill) nie je istá - akceptuj oboje, presnú formu vynúti validQueue
  if (a.type === "attack" && !attackDirOk(char, a.dir, null, true)) return false;
  return true;
}
// vypršaný čas: zahraj, čo má hráč rozpracované (draft - len platné akcie), a každý zvyšný slot do limitu
// vyplň PASS-om (THINKING, −PASS_MANA_COST many) - žiadne náhodné akcie
function fillFromDraft(draftQueue, exclude = new Set(), allowDemon = false, limit = 3, char = null) {
  const q = [], used = new Set(exclude);
  for (const a of (Array.isArray(draftQueue) ? draftQueue : [])) {
    if (q.length >= limit) break;
    if (!validBasicAction(a, used, allowDemon, char)) continue;
    q.push({ type: a.type, dir: a.dir || null, cell: a.cell || null }); // cell = cieľ Vojakovho/Countess/Onre specialu
    used.add(a.type);
  }
  while (q.length < limit) q.push({ type: "pass" });
  return q;
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
  breakTrap(slot, tl);                                                           // pasca zaniká smrťou castera (aj touto rituálnou - deštrukciu vidia obaja)
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
// resolveTurn je REZUMOVATEĽNÝ (kvôli Jotarovmu THE WORLD, ktorý kolo uprostred pozastaví a čaká na
// klienta): init kontextu + Last Hope/golden pre-fáza tu, hlavný interleave loop v runRoundLoop() (číta/
// zapisuje game.roundCtx a vie skončiť buď finishRound(), alebo PAUZOU), koncová fáza vo finishRound().
function resolveTurn() {
  clearTurnTimer();
  const tl = [];
  // prvý „nulový“ frame pre hladký začiatok
  pushStateFrame(tl, [], 10);

  const order = game.starter === "p1" ? ["p1","p2"] : ["p2","p1"];
  // Escanor pride: zachyť PRED spracovaním, či daný Escanor v tomto kole použil shield/mirror/golden shield/mirror
  // (fronta aj golden flagy sa počas kola menia/miznú). Na konci kola: použil obranu ALEBO dostal zásah
  // (p.prideHit z notePrideHit) → −1, inak → +1. Číta sa FRONTA, nie výsledok - obrana zmarená BLOCK tile
  // (blocked_shield/mirror) teda pride uberá tiež (skúsil sa brániť) - zámer.
  // háčik roundStart postáv: snímka PRED spracovaním kola (fronta aj golden flagy sa počas kola menia/miznú) -
  // Escanor (použil obranu → pride), Pútnik (použil mirror → bez regenu). Ukladá sa do roundCtx (THE WORLD resume).
  const charInfo = {};
  for (const slot of ["p1", "p2"]) charInfo[slot] = { char: game.players[slot].char, data: charHook(slot, "roundStart") };
  // Pútnik (wanderer): ak v tomto kole použil mirror (obyčajný ALEBO golden), pasívna +many na konci kola NEpríde.
  // Zachyť PRED spracovaním kola - golden flag aj fronta (golden predťah) sa počas kola menia/miznú (ako pri Escanorovi).
  // Číta sa FRONTA, nie výsledok - mirror zmarený BLOCK tile regen tiež ruší (zámer, hoci mana ostala).
  // doom: zachyť na začiatku kola - true len v buffnutom (poslednom) kole, NIE v aktivačnom (vtedy sa nastaví až v gold fáze)
  const doomSlot = game.players.p1.lastStandDoom ? "p1" : game.players.p2.lastStandDoom ? "p2" : null;

  // Last Hope - úvodná akcia NEbuffnutého hráča vo final kole, vyhodnotená PRED golden shield/mirror.
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

  // golden shield / golden mirror - extra predťah hráča, ktorý je v kole druhý, vyhodnotený pred prvou akciou startera
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
    } else if (defenseBlockedBy(gp)) {
      // BLOCK tile: ani zlatý predťah sa na ňom nedá castnúť - prečiarknutie BEZ ceny
      pushInvalid(tl, second, SMALL_DELAY_MS, isMirror ? "blocked_mirror" : "blocked_shield");
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
    // prázdny golden shield/mirror beat - zelená šípka cezeň prekrokuje (rovnako ako prázdny golden mana)
    pushStateFrame(tl, [{ kind: "beat_empty", from: second, beat: "gpre" }], ACTION_GAP_MS);
  }

  // ulož kontext rezumovateľného kola a spusti hlavný interleave loop
  game.roundCtx = {
    tl, order, i: 0, slotIdx: 0, ended: false,
    stonedStep: null, tookStoned: null,
    charInfo, doomSlot,
    second, emittedUpTo: 0,
  };
  runRoundLoop();
}

// hlavný interleave loop kola - číta/zapisuje game.roundCtx, takže sa dá po THE WORLD pauze rezumovať
// od uloženej pozície (ctx.i = číslo akcie 0–2, ctx.slotIdx = ktorý slot v order je na rade).
function runRoundLoop() {
  const ctx = game.roundCtx;
  const { tl, order } = ctx;
  while (ctx.i < 3) {
    // skamenenie chráni pred tile efektmi počas CELÉHO kroku, v ktorom padol aj posledný skamenený ťah
    // (odkamenenie je „na konci ťahu" - tiles sa začnú vyhodnocovať až od nasledujúceho kroku).
    // Zachyť ho pri VSTUPE do kroku (slotIdx 0), aby pauza uprostred kroku nestratila hodnotu.
    if (ctx.slotIdx === 0) {
      ctx.stonedStep = { p1: game.players.p1.stone > 0, p2: game.players.p2.stone > 0 };
      ctx.tookStoned = { p1: false, p2: false }; // kto v tomto kroku odohral skamenený pass
    }
    while (ctx.slotIdx < order.length) {
      const slot = order[ctx.slotIdx];
      const meP = game.players[slot];
      if (meP.stone > 0) {
        // skamenený ťah: akcia sa preskočí (bez many) a NEspotrebuje súperovu obranu.
        // Kameň sa NEuberá teraz - až na KONCI kroku (nižšie), aby socha vizuálne vydržala celý tento krok
        // vrátane vyhodnotenia jeho dlaždíc; odkamenenie sa tak prejaví až na začiatku NASLEDUJÚCEJ akcie
        // (predtým socha zmizla už pri „STONED" float 2. akcie, hoci dlaždica pod hráčom sa ešte netriggerovala).
        ctx.tookStoned[slot] = true;
        pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: "stoned", dir: null, to: null } }], 250);
        pushStateFrame(tl, [{ kind: "stoned", target: slot }], SMALL_DELAY_MS);
        pushStateFrame(tl, [], ACTION_GAP_MS);
        ctx.slotIdx++;
        continue;
      }
      const foe = other(slot);
      // obrany kryjú práve túto (najbližšiu) súperovu akciu - spotrebujú sa ňou aj bez zásahu
      const foeShieldArmed = game.players[foe].shield;
      const foeMirrorArmed = game.players[foe].mirror;
      const act = meP.queue[ctx.i];
      // ohlás akciu klientovi (záznam kola pod HUD widgetom)
      if (act) pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: act.type, dir: act.dir || null, to: act.to || null } }], 250);
      // pasca (Countess/Onre): zbieraj bunky prejdené počas akcie; trigger sa vyhodnotí AŽ PO jej dokončení
      actionSteps = { p1: [], p2: [], p1c: [], p2c: [] };
      const res = doAction(slot, act, tl);
      // Jotaro THE WORLD: kolo sa POZASTAVÍ - pošli čiastočnú timeline (končí timestop_wait) a čakaj na
      // timestop_actions. Súperovu obranu NEspotrebuj (ostáva armed cez zamrazenie), pasce nevyhodnocuj (čas stojí).
      if (res === PAUSE) {
        actionSteps = null;
        ctx.slotIdx++; // resume pokračuje NASLEDUJÚCOU akciou pôvodnej queue
        pushStateFrame(tl, [{ kind: "timestop_wait", from: slot }], SMALL_DELAY_MS);
        ctx.emittedUpTo = tl.length;
        emitStateMasked(tl); // partial emit; časovač kola sa NEspúšťa
        return;
      }
      if (foeShieldArmed) { game.players[foe].shield = false; game.players[foe].shieldGold = false; }
      if (foeMirrorArmed) { game.players[foe].mirror = false; game.players[foe].mirrorGold = false; }
      resolveTrapsAfterAction(tl);
      actionSteps = null;

      // po každej akcii skontroluj lethal
      const w = winnerNow();
      if (w) { ctx.ended = true; return finishRound(); }
      // krátka pokojová pauza medzi akciami, nech oko stihne zaregistrovať každý ťah
      pushStateFrame(tl, [], ACTION_GAP_MS);
      ctx.slotIdx++;
    }

    // koniec ťahu - efekty špeciálnych políčok (pickupy, dmg, IK)
    endOfStepTileEffects(tl, ctx.stonedStep);
    // až TERAZ ubudni kameň za skamenené passy tohto kroku - socha (kreslená zo state.stone) tak zmizne
    // až v ďalšom kroku, čiže vizuálne na začiatku nasledujúcej akcie, keď sa dlaždice pod hráčom spustia
    for (const slot of order) {
      if (!ctx.tookStoned[slot] || game.players[slot].stone <= 0) continue;
      game.players[slot].stone--;
      // posledný kameň odišiel → socha sa roztrieští (klient vykreslí kamenné úlomky, nie len preblik)
      if (game.players[slot].stone === 0) pushStateFrame(tl, [{ kind: "unpetrify", target: slot }], SMALL_DELAY_MS);
    }
    if (winnerNow()) { ctx.ended = true; return finishRound(); }
    ctx.i++;
    ctx.slotIdx = 0;
  }
  finishRound();
}

// koncová fáza kola (po dohraní všetkých akcií alebo po lethal) - pride/moon, obrany, gold fáza, doom,
// tiles, emit timeline, reset a naplánovanie ďalšieho kola. Číta game.roundCtx a na konci ho vynuluje.
function finishRound() {
  const ctx = game.roundCtx;
  const { tl, order, doomSlot } = ctx;
  let ended = ctx.ended;

  // koniec hry: tieňové klony miznú (aj pri výhre majiteľa) - poof po dohraní smrteľného zásahu;
  // pasce zanikajú ticho (smrť castera / koniec hry - nová hra aj tak resetuje hráčov)
  if (ended) {
    killClone("p1", tl); killClone("p2", tl);
    game.players.p1.trap = null; game.players.p2.trap = null;
  }

  // Escanor pride: koniec kola - použil obranu ALEBO dostal zásah od súpera → −1, inak → +1 (clamp 0–3;
  // stále len ±1 za kolo, podmienky sa nesčítavajú). Prejaví sa v nasledujúcom kole.
  for (const slot of ["p1", "p2"]) charHook(slot, "afterActions", roundInfo(slot));
  // flag zásahu žije len jedno kolo (nuluj bez ohľadu na char - mág sa mohol vymeniť swapom)
  game.players.p1.prideHit = false;
  game.players.p2.prideHit = false;

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
    // post-round gold fáza: golden mana + last stand. Démon je len JEDEN - ak ho navolia obaja,
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
        // prázdny golden-mana beat - zelená šípka cezeň prekrokuje s prázdnym počkaním (nie preskočenie).
        // V buffnutom poslednom kole (doomSlot) to nerobíme - tam je démon „end" bunka + banish.
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
    // Banish je istá smrť = koniec hry - ak beží labyrint, prehraj rovnakú sekvenciu ako pri istom zásahu:
    // odhalenie PRED banish animáciou, koniec labyrintu (ESCAPED + rozsvietenie) po smrti - hra nesmie
    // skončiť v hmle/redakcii (rovnaké pravidlo ako smrteľný tile/IK zásah)
    if (doomSlot && !winnerNow()) {
      const labActive = game.players.p1.labyrinth || game.players.p2.labyrinth;
      if (labActive) revealLabyrinths(tl);
      resolveLastStandBanish(doomSlot, tl);
      if (labActive) endLabyrinths(tl);
      ended = true;
      game.players.p1.trap = null; game.players.p2.trap = null; // koniec hry - pasce ticho zanikajú
    }
  }

  if (!ended) {
    // Vlkolak: fáza mesiaca sa prepočíta na KONCI kola z aktuálnych HP (po tiles, golden mane aj Last Stand
    // full-heale) - nesie ju až finálny frame; klient porovná prvý/posledný frame a ukáže float s novou fázou.
    for (const slot of ["p1", "p2"]) charHook(slot, "roundEnd", slot, roundInfo(slot), tl);

    // háčik roundEndFx (môže pridať framy) - Pútnikova pasívna mana
    for (const slot of ["p1", "p2"]) charHook(slot, "roundEndFx", slot, roundInfo(slot), tl);

    // prechod do ďalšieho kola: až TU dopadnú zmeny tiles - commit ohláseného preview + žreb nového
    // na ďalšie kolo. Oboje nesie až finálny mini-frame, takže klient ukáže nové tiles AJ čerstvý preview
    // spolu s „ROUND N / FINAL ROUND" animáciou na začiatku nasledujúceho kola, nie uprostred dohrávania akcií.
    endOfRoundTiles();
    const nextTurn    = game.turn + 1;
    const nextStarter = game.starter === "p1" ? "p2" : "p1"; // preklop (hru mohol začínať aj p2)
    tl.push({ ...snapshot(), turn: nextTurn, starter: nextStarter, effects: [], delayMs: 10 });
    game.turn    = nextTurn;
    game.starter = nextStarter;
  }

  // emit: normálne celá timeline; po THE WORLD pauze (emittedUpTo>0) len POKRAČOVANIE (už odohrané frame-y
  // sa neposielajú dvakrát) so seed frame-om súčasného stavu - klient aplikuje timeline[0] a animuje od [1]
  let emitTl = tl;
  if (ctx.emittedUpTo > 0) {
    const seed = { ...tl[ctx.emittedUpTo - 1], effects: [], delayMs: 10 };
    emitTl = [seed, ...tl.slice(ctx.emittedUpTo)];
  }
  emitStateMasked(emitTl); // per-osoba: labyrintová redakcia snapshotu AJ timeline (roster HP/mana je verejné)

  // príprava na ďalšie plánovanie (lokálny stav; vizuálne odomkne až klient po dohraní timeline)
  game.players.p1.locked = false;
  game.players.p2.locked = false;
  game.players.p1.queue = [];
  game.players.p2.queue = [];
  game.players.p1.goldenMana = false; // nevyhodnotený refill (ukončené kolo) prepadá
  game.players.p2.goldenMana = false;
  game.players.p1.goldenMirror = false;
  game.players.p2.goldenMirror = false;
  game.players.p1.lastStand = false; // nevyhodnotený last stand prepadá (buff/doom NEresetujeme - nesú sa do posledného kola)
  game.players.p2.lastStand = false;
  game.players.p1.lastHope = false; // nevyhodnotený last hope prepadá (buff platí len v rozohranom final kole, hra ním aj tak končí)
  game.players.p2.lastHope = false;
  game.players.p1.draft = { queue: [], golden: false, goldenMirror: false, goldenMana: false, lastStand: false, lastHope: false };
  game.players.p2.draft = { queue: [], golden: false, goldenMirror: false, goldenMana: false, lastStand: false, lastHope: false };

  const dur = emitTl.reduce((a, f) => a + (f.delayMs || 0), 0);
  game.roundCtx = null; // kolo dohrané - kontext už netreba (ďalšie kolo si vytvorí nový)
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

  // game_result dostanú obaja - klient ho vyhodnotí až na konci prehrávania timeline
  roomEmit("game_result", { gameWinner: w, series: seriesSnapshot(), matchOver });

  if (matchOver) {
    game.phase = "match_over";
    roomEmit("game_over", { winner: w, series: seriesSnapshot() }); // séria skončila
  } else {
    // medzihra: počkaj, kým klient dohrá timeline + animáciu smrti + zobrazí skóre, potom ďalšia hra.
    // Guard na identitu hry: retry/admin reset medzitým vytvorí NOVÝ game objekt - stale časovač
    // z opustenej série sa vtedy zahodí (inak by o desiatky sekúnd resetol postavy a startera
    // úplne inej rozbehnutej hry).
    const forGame = game;
    schedule(() => {
      if (game !== forGame) return;
      roomEmit("new_game", { series: seriesSnapshot() });
      startGame(game.series.gameIndex + 1);
    }, (timelineDurationMs || 0) + 6500);
  }
}

/* -------------------- Match / game start -------------------- */
function startMatch(config) {
  // deterministický priebeh zápasu: seed z háčika (headless simulácia) má prednosť pred env ARENA_SEED (testy)
  const seed = io.seed ?? ARENA_SEED;
  if (seed !== null) rand = seededRng(seed);
  game.config = config;
  // BIELY (p1, vľavo) začína hru 1 - náhodné je, KTO je biely: osoby A/B sa vylosujú na sloty
  // ešte PRED animáciou ruletky na klientovi (color_roll nižšie je už len divadlo s hotovým výsledkom).
  // FORCE_FIRST_STARTER=A|B pripne osobu na p1/bieleho (testy). Sloty sú fixné na celú sériu;
  // v sérii (bo3/tournament) sa štartér jednotlivých hier strieda (viď startGame).
  // Host (osoba A) si mohol farbu zvoliť: white → A=p1(biely), black → A=p2(čierny), random → losuje sa.
  // Priorita: FORCE_FIRST_STARTER (testy) > voľba hosta > náhoda.
  let white;
  if (FORCE_FIRST_STARTER) white = FORCE_FIRST_STARTER;
  else if (config.colorPref === "white") white = "A";
  else if (config.colorPref === "black") white = "B";
  else white = rand() < 0.5 ? "A" : "B";
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
  // PORADIE emitov je kritické: ruleta farieb (nepriehľadný celoobrazovkový overlay) musí dôjsť klientovi
  // PRED prvým stavom, ktorý farbu prezradí (p2 má zrkadlený char-select + alt-color HUD). Na pomalom
  // pripojení inak klient stihne vykresliť odkrytú plochu skôr, než ju overlay prekryje.
  //  1) you_are - sloty sa práve prelosovali, klient potrebuje aktuálny slot pre `me` (join-time you_are
  //     ešte mal default sloty a mohol byť nesprávny); color_roll ho číta.
  //  2) color_roll - overlay sa zapne (zakryje predošlú obrazovku).
  //  3) state - char-select/plocha sa vykreslí UŽ POD overlayom.
  emitYouAre();
  // ruleta jin-yang beží len keď farbu naozaj losujeme (random); pri pevnej voľbe hosta ju preskočíme
  roomEmit("color_roll", { animate: config.colorPref === "random" });
  if (config.format === "tournament") {
    // slepý draft tímov: pred hrou 1 si každý vyberie TEAM_SIZE postáv z celého poolu (choose_team);
    // mageHp/mageMana vzniknú až po potvrdení oboch (finishTeamSelect → startGame(1))
    game.roster = { A: null, B: null };
    game.phase = "team_select";
    emitStateMasked();
  } else {
    startGame(1); // emitne ešte raz you_are (neškodná duplicita) + state - oboje už po color_roll
  }
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
// Hru 1 začína VŽDY biely (p1); v sérii (bo3/tournament) sa štartér hier strieda - hru 2 otvára čierny (p2).
// Resetne hráčov a vyčistí postavy (char-select pred každou hrou).
function startGame(gameIndex) {
  clearTurnTimer();
  game.series.gameIndex = gameIndex;

  game.players.p1 = newPlayer("p1");
  game.players.p2 = newPlayer("p2");
  game.roundCtx = null;  // rozpracované/pozastavené kolo z predošlej hry nesmie prežiť
  game.timestop = null;  // ani Jotarova time-stop pauza
  game.turn = 1;
  game.starter = (gameIndex % 2 === 1) ? "p1" : "p2"; // nepárne hry otvára biely, párne čierny; v rámci hry sa štartér kola preklápa
  game.tiles = [];
  game.iks = [];
  game.pending = null;
  rollPendingTiles(); // preview spawnov na koniec 1. kola - hráči ho vidia už pri plánovaní prvých akcií
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
  for (const k of ["dmg", "heal", "mana", "ik", "power", "block"]) {
    const v = Math.max(0, Math.round(Number(w[k]) || 0));
    weights[k] = v; sum += v;
  }
  if (sum !== 100) return null; // percentá musia dať presne 100
  // farba hosta (osoby A): white/black si host vyberie pevne, random = losuje sa (default)
  const colorPref = ["white", "black"].includes(raw.colorPref) ? raw.colorPref : "random";
  return { format, tilesPerRound: perRound, tileWeights: weights, timer, tilePreview: !!raw.tilePreview, colorPref };
}

// vypršal čas na ťah: kto nie je locknutý, zahrá rozpracovaný draft doplnený náhodne; potom vyhodnoť kolo
function autoLock() {
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
    // Last Hope - len nebuffnutý hráč vo final kole; nikdy sa nedopĺňa náhodne, len ak ho hráč navolil
    p.lastHope   = goldLocked && !p.lastStandBuff && !!p.draft?.lastHope;
    // zahraj, čo má hráč rozpracované (draft), chýbajúce do 3 doplň náhodne - bez akcie, ktorú už pokrýva golden
    const exclude = new Set();
    if (p.golden) exclude.add("shield");
    if (p.goldenMirror) exclude.add("mirror");
    // skamenené sloty na začiatku kola sú pevné pass ťahy - dopĺňa sa len zvyšok
    const stone = Math.min(3, p.stone || 0);
    p.queue = [
      ...Array.from({ length: stone }, () => ({ type: "stoned" })),
      ...fillFromDraft(p.draft?.queue, exclude, !!p.lastStandBuff, 3 - stone, p.char),
    ];
    p.locked = true;
  }
  if (game.players.p1.locked && game.players.p2.locked) resolveTurn();
  else emitStateMasked(); // labyrint: prekliaty nesmie dostať súperovu pozíciu ani tu
}

/* -------------------- Herné príkazy hráčov (z socket handlerov servera) -------------------- */
  // turnajový draft: hráč naslepo potvrdí tím TEAM_SIZE unikátnych postáv z poolu CHARS (raz za zápas)
  function chooseTeam(person, keys) {
    if (!person) return;
    if (game.phase !== "team_select") return;
    if (!game.roster || game.roster[person]) return; // tím sa potvrdzuje raz
    if (!Array.isArray(keys) || keys.length !== TEAM_SIZE) return;
    const team = keys.map(String);
    if (new Set(team).size !== TEAM_SIZE) return;    // bez duplicít v tíme
    // len známe postavy z poolu + PRÍPADNE vlastná side-postava (p1 → countess; p2 → onre|jotaro)
    const slot = slotForPerson(person);
    if (!team.every(k => CHARS.includes(k) || SIDE_CHARS[k] === slot)) return;
    game.roster[person] = team;
    if (game.roster.A && game.roster.B) finishTeamSelect();
    else emitStateMasked(); // súper uvidí rosterReady („opponent is ready"), nie samotný tím
  }

  function chooseCharacter(person, key) {
    if (!person) return;
    if (game.phase !== "playing") return;       // postava sa volí len v hernej fáze (pred kolami)
    const slot = slotForPerson(person);
    // Countess/Onre: viazané na STRANU (countess len p1/biela, onre len p2/čierna). Mimo turnaja hocikedy
    // pre svoju stranu; v turnaji len ak si ich hráč draftol do svojho rosteru (mageHp existuje len v turnaji)
    const sideOk = SIDE_CHARS[key] === slot && (!game.mageHp || rosterFor(slot).includes(key));
    if (!CHARS.includes(key) && !sideOk) return;
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
    deployReset(slot); // pride/forma/mesiac - každá hra začína čisto (vlkolak: fáza podľa preneseného HP)
    // obaja vybrali -> začína 1. kolo, naštartuj časovač pred emitom (snapshot nesie timerMs pre refresh-sync)
    if (game.players.p1.char && game.players.p2.char) beginPlanningTimer(0);
    emitStateMasked(); // súperov pick sa odhalí až keď si vyberie aj druhý hráč (žiadna výhoda pre rozmýšľajúceho)
  }

  function lockIn(person, queue, clientTurn, ack) {
    // spätná kompat.: starší klient/test volá lock_in(queue) alebo lock_in(queue, ack) bez čísla kola
    if (typeof clientTurn === "function") { ack = clientTurn; clientTurn = undefined; }
    if (!person) return;
    if (game.phase !== "playing") return;
    const slot = slotForPerson(person);
    if (!game.players.p1.char || !game.players.p2.char) return; // ešte sa vyberajú postavy
    // počas Jotarovho THE WORLD čakania je bežný lock_in neplatný (rieši sa cez timestop_actions)
    if (game.timestop?.mode === "waiting") { if (typeof ack === "function") ack({ ok: false, reason: "timestop" }); return; }
    const me = game.players[slot];
    // zopakovaný lock_in (stratený ack) pre už vyriešené kolo → zahoď, nech sa stará voľba nevloží do nového kola
    if (clientTurn !== undefined && clientTurn !== game.turn) { if (typeof ack === "function") ack({ ok: true }); return; }
    // idempotencia: v tomto kole už som locknutý (stratil sa len ack) → len potvrď, nereparsuj voľbu
    if (me.locked) { if (typeof ack === "function") ack({ ok: true }); return; }
    if (!validQueue(queue, slot)) { if (typeof ack === "function") ack({ ok: false }); return; }
    let q = queue;
    me.lastHope = q[0]?.type === "last_hope"; // úvodná akcia (pred golden) - validQueue už overil, že smie
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
  }

  // Jotaro THE WORLD: 3 zmrazené akcie od hráča Jotara počas pauzy kola. Po nich runTimestopActions
  // dohrá zvyšok kola a pošle POKRAČOVACIU timeline (finishRound cez ctx.emittedUpTo).
  function timestopActions(person, queue, ack) {
    if (!person) return;
    if (game.phase !== "playing") { if (typeof ack === "function") ack({ ok: false }); return; }
    const ts = game.timestop;
    if (!ts || ts.mode !== "waiting" || !game.roundCtx) { if (typeof ack === "function") ack({ ok: false, reason: "no_timestop" }); return; }
    const slot = slotForPerson(person);
    if (slot !== ts.slot) { if (typeof ack === "function") ack({ ok: false, reason: "not_yours" }); return; }
    if (!validTimestopQueue(queue, slot)) { if (typeof ack === "function") ack({ ok: false }); return; }
    if (typeof ack === "function") ack({ ok: true });
    runTimestopActions(queue.map(a => ({ type: a.type, dir: a.dir || null })));
  }

  // priebežne posielaná rozpracovaná voľba - backstop ju pri timeoute zahrá (a doplní len chýbajúce do 3)
  function draftQueue(person, d) {
    if (!person || game.phase !== "playing") return;
    const slot = slotForPerson(person);
    const me = game.players[slot];
    if (me.locked) return;
    const inQ = Array.isArray(d?.queue) ? d.queue : [];
    const out = [], used = new Set();
    const allowDemon = !!me.lastStandBuff;
    for (const a of inQ) {
      if (out.length >= 3) break;
      if (!validBasicAction(a, used, allowDemon, me.char)) continue;
      out.push({ type: a.type, dir: a.dir || null, cell: a.cell || null }); // cell = cieľ Vojakovho/Countess/Onre specialu
      used.add(a.type);
    }
    me.draft = { queue: out, golden: !!d?.golden, goldenMirror: !!d?.goldenMirror, goldenMana: !!d?.goldenMana, lastStand: !!d?.lastStand, lastHope: !!d?.lastHope };
  }


  return {
    get game() { return game; },
    newGame, snapshot, snapshotFor, redactTimelineFor, slotForPerson, otherPerson, seriesSnapshot,
    sanitizeConfig, startMatch, autoLock, resolveTurn, validQueue, fillFromDraft,
    chooseTeam, chooseCharacter, lockIn, timestopActions, draftQueue,
  };
}
