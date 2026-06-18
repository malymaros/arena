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
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || ""; // ← voliteľné heslo pre admin reset

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
const MELEE_REPEAT = 3; // švih v rovnakej kadencii ako special (beaty po SPECIAL_BEAT_MS)

const SPECIAL_COST = 5;
const RECHARGE_GAIN = 4;
const SHIELD_COST = 2; // zablokuje celý dmg najbližšej súperovej akcie
const MIRROR_COST = 4; // odrazí celý dmg najbližšej súperovej akcie späť do útočníka
const GOLDEN_COST = 3; // extra akcia hráča, ktorý je v kole druhý — štít vyhodnotený pred prvou akciou startera
const GOLDEN_MIRROR_COST = 5; // ten istý predťah, ale mirror (odraz) namiesto štítu — zlaté vizuály
const DASH_COST   = 4; // presun až o 2 políčka jedným smerom
const GOLDEN_MANA_GAIN = 6; // golden mana refill: +6 many za HP; cena v HP rastie s každým použitím (1, 2, 3…)

const ACTION_TYPES = new Set(["move", "recharge", "attack", "melee", "special", "shield", "mirror", "dash"]);
const MOVE_DIRS = new Set(["up", "down", "left", "right"]);

/* -------------------- Match / lobby config -------------------- */
// koľko vyhratých hier treba na zisk série
const MATCH_FORMATS = { single: 1, bo3: 2, bo5: 3 };
// časový limit na ťah — vyhodnocuje a auto-lockuje klient (server lock validuje ako bežný)
const TIMER_OPTIONS = new Set(["off", "10", "30", "60", "quickdraw"]);

// predvolené nastavenia (predvyplnia lobby na klientovi)
const DEFAULT_CONFIG = {
  format: "single",                              // "single" | "bo3" | "bo5"
  tilesPerRound: 1,                              // 1 | 2 | 3 — koľko tiles sa spawne na konci kola
  tileWeights: { dmg: 75, heal: 12, mana: 8, ik: 5 }, // % šanca typu, spolu 100
  timer: "30",                                   // "off" | "10" | "30" | "60" | "quickdraw"
};

// celkové spomalenie animácií kola (1 = pôvodné tempo); MUSÍ sedieť s client.js ANIM_SLOW
const ANIM_SLOW = 1.5;
const MOVE_DELAY_MS    = Math.round(800 * ANIM_SLOW); // posun postavy + malý buffer
const SMALL_DELAY_MS   = Math.round(600 * ANIM_SLOW);
const SPECIAL_REPEAT   = 3;
const SPECIAL_BEAT_MS  = Math.round(900 * ANIM_SLOW);
const CHARGE_STEP_MS   = Math.round(560 * ANIM_SLOW);
const MIRROR_BEAM_MS   = 460; // kým beam mirroru doletí k útočníkovi (CSS .mirror-beam ≈ .16+.42s); nezávisí od ANIM_SLOW

/* -------------------- Game state -------------------- */
// identita hráča je „osoba" A/B (A = prvý pripojený = host); slot p1/p2 je len ľavá/pravá rola,
// ktorá sa medzi hrami série prehadzuje (štartér danej hry vždy sedí v p1 = vľavo)
let personSockets = { A: null, B: null };
let game = null;

function newPlayer(slot) {
  const pos = START_POS[slot];
  return {
    slot,
    x: pos.x, y: pos.y,
    hp: START_HP,
    mana: START_MANA,
    char: null,        // "fire" | "lightning" | "wanderer"
    shield: false,     // zruší celý dmg najbližšej súperovej akcie
    shieldGold: false, // aktívny shield pochádza z golden shieldu (zlaté vizuály)
    mirror: false,     // odrazí celý dmg najbližšej súperovej akcie späť do útočníka
    mirrorGold: false, // aktívny mirror pochádza z golden mirroru (zlaté vizuály)
    golden: false,     // objednaný golden shield (extra akcia pred začiatkom kola)
    goldenMirror: false, // objednaný golden mirror (rovnaký predťah, ale odraz namiesto štítu)
    goldenMana: false, // objednaný golden mana refill (extra akcia po konci kola)
    manaRefills: 0,    // koľkokrát už hráč refill použil — určuje rastúcu HP cenu
    locked: false,
    queue: [],
    // priebežne posielaná rozpracovaná voľba — pri vypršaní času ju backstop zachová a doplní len chýbajúce
    draft: { queue: [], golden: false, goldenMirror: false, goldenMana: false }
  };
}

function newGame() {
  game = {
    phase: "lobby",   // "lobby" | "playing" | "match_over"
    config: null,     // nastaví host cez configure_match
    board: { ...BOARD },
    players: {
      p1: newPlayer("p1"),
      p2: newPlayer("p2")
    },
    arena: "bridge",
    turn: 1,
    starter: "p1", // odd -> p1, even -> p2
    tiles: [],     // { x, y, type: "dmg" | "heal" | "mana" } — pribúdajú od konca 1. kola
    iks: [],       // [{ x, y }] — insta-kill tiles; viac súčasne, každé kolo menia pozíciu, navzájom sa neprekrývajú
    // séria zápasov
    seats: { p1: "A", p2: "B" }, // ktorá osoba sedí v ktorom slote v aktuálnej hre
    seriesWins: { A: 0, B: 0 },
    series: { gameIndex: 1, needed: 1, firstStarter: "A", format: "single" },
  };
}
newGame();

function otherPerson(p) { return p === "A" ? "B" : "A"; }
function slotForPerson(person) { return game.seats.p1 === person ? "p1" : "p2"; }
function socketForSlot(slot) { return personSockets[game.seats[slot]]; }

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

// pošli každej osobe jej aktuálny slot (mení sa medzi hrami) + či je host
function emitYouAre() {
  for (const person of ["A", "B"]) {
    const sock = personSockets[person];
    if (sock) sock.emit("you_are", { slot: slotForPerson(person), isHost: person === "A" });
  }
}

/* -------------------- Helpers -------------------- */
function cloneActor(a) {
  if (!a) return null;
  const { slot, x, y, hp, mana, char, shield, shieldGold, mirror, mirrorGold, manaRefills, locked } = a;
  return { slot, x, y, hp, mana, char, shield, shieldGold, mirror, mirrorGold, manaRefills, locked };
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
    tiles: game.tiles.map(t => ({ ...t })),
    iks: game.iks.map(t => ({ ...t }))
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

// 3 akcie, každý typ max 1× za kolo, len známe typy a smery (move, attack aj dash nesú dir)
// voliteľný prefix golden_shield/golden_mirror (len hráč, ktorý v kole NEzačína) a sufix golden_mana (ktokoľvek)
function validQueue(queue, slot) {
  if (!Array.isArray(queue)) return false;
  let q = queue;
  if (q[0] && (q[0].type === "golden_shield" || q[0].type === "golden_mirror")) {
    if (slot === game.starter) return false;
    q = q.slice(1);
  }
  if (q.length && q[q.length - 1] && q[q.length - 1].type === "golden_mana") {
    q = q.slice(0, -1);
  }
  if (q.length !== 3) return false;
  const types = q.map(a => a && a.type);
  if (types.some(t => !ACTION_TYPES.has(t))) return false;
  if (new Set(types).size !== 3) return false;
  return q.every(a => (a.type !== "move" && a.type !== "attack" && a.type !== "dash") || MOVE_DIRS.has(a.dir));
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
  newGame();
  io.emit("reset");
  io.emit("state", snapshot());
}

/* -------------------- Actions -------------------- */
function doMove(slot, dir, tl) {
  const a = game.players[slot];
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir] || [0,0];
  const nx = a.x + delta[0], ny = a.y + delta[1];
  if (!inBounds(nx, ny)) { pushInvalid(tl, slot); return; }
  a.x = nx; a.y = ny;
  pushStateFrame(tl, [], MOVE_DELAY_MS);
}

function doDash(slot, dir, tl) {
  const a = game.players[slot];
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
  if (!delta) { pushInvalid(tl, slot); return; }
  if (a.mana < DASH_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }

  // posun až o 2 políčka zvoleným smerom; na okraji sa skráti na 1, bez možného pohybu je neplatný
  let nx = a.x, ny = a.y, steps = 0;
  for (let s = 0; s < 2; s++) {
    if (inBounds(nx + delta[0], ny + delta[1])) { nx += delta[0]; ny += delta[1]; steps++; }
  }
  if (!steps) { pushInvalid(tl, slot); return; }

  a.mana -= DASH_COST;
  a.x = nx; a.y = ny;
  pushStateFrame(tl, [], MOVE_DELAY_MS);
}

function doRecharge(slot, tl) {
  const a = game.players[slot];

  // Na maxime many -> neplatné, žiadna modrá animácia/bublina
  if (a.mana >= MAX_MANA) { pushInvalid(tl, slot); return; }

  const before = a.mana;
  a.mana = Math.min(MAX_MANA, a.mana + RECHARGE_GAIN);
  const gained = a.mana - before; // menej ak capne na MAX_MANA
  if (gained > 0) {
    pushStateFrame(
      tl,
      [{ kind: "recharge", from: slot, cells: [[a.x, a.y]], amount: gained }],
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
  me.mana -= BASIC_COST;

  // strela letí zvoleným smerom; zastaví sa na prvom súperovi v dráhe alebo na okraji boardu
  // dmg klesá so vzdialenosťou (3/2/1); vlastné políčko nezasahuje (na to je melee)
  let x = me.x, y = me.y, dist = 0;
  while (true) {
    x += delta[0]; y += delta[1]; dist++;
    if (!inBounds(x, y)) break;
    pushStateFrame(tl, [{ kind: "charge", from: slot, dir, cell: [x, y] }], CHARGE_STEP_MS);
    if (op && op.x === x && op.y === y) {
      applyHit(opS, Math.max(1, BASIC_DMG_MAX - dist), tl, "basic");
      break;
    }
  }
}

function doMelee(slot, tl) {
  const me  = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];

  if (me.mana < MELEE_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= MELEE_COST;

  // úder sa švihne vždy (mana je preč aj pri minutí), zasiahne len súpera na rovnakom políčku
  // rovnaká dramaturgia ako special: opakované švihy v beatoch, dmg padne až po nich
  for (let r = 0; r < MELEE_REPEAT; r++) {
    pushStateFrame(tl, [{ kind: "melee", from: slot }], SPECIAL_BEAT_MS);
  }
  if (op && op.x === me.x && op.y === me.y) {
    applyHit(opS, MELEE_DMG, tl, "melee");
  }
}

// aplikuje zásah cez prípadné obrany obrancu (shield blokuje celý dmg, mirror ho odrazí do útočníka)
function applyHit(targetSlot, rawDmg, tl, kind = "basic") {
  const t = game.players[targetSlot];
  if (t.shield) {
    pushStateFrame(tl, [{ kind: "block", target: targetSlot, gold: !!t.shieldGold }], SMALL_DELAY_MS);
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
    atk.hp = Math.max(0, atk.hp - rawDmg);
    pushStateFrame(tl, [{ kind: "hit", target: atkSlot, dmg: rawDmg }], SMALL_DELAY_MS);
    return;
  }
  t.hp = Math.max(0, t.hp - rawDmg);
  pushStateFrame(tl, [{ kind: "hit", target: targetSlot, dmg: rawDmg }], SMALL_DELAY_MS);
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

function doSpecial(slot, tl) {
  const actor = game.players[slot];
  if (!actor) return;

  // Bez many -> len spätná väzba (Hurt na klientovi + low mana výstraha), žiadna special animácia
  if (actor.mana < SPECIAL_COST) {
    pushInvalid(tl, slot, SMALL_DELAY_MS, "mana");
    return;
  }

  actor.mana -= SPECIAL_COST;

  // 3× „nádych“ (caster animuje špeciál; klient bliká rozsah)
  for (let r = 0; r < SPECIAL_REPEAT; r++) {
    pushStateFrame(tl, [{ kind: "special", from: slot }], SPECIAL_BEAT_MS);
  }

  // vyhodnotenie zásahu
  const { dmg, hit } = specialDamageAndHit(game.players, slot);
  if (dmg > 0 && hit) {
    applyHit(hit, dmg, tl, "special");
  } else {
    pushStateFrame(tl, [], SMALL_DELAY_MS);
  }
}

function doAction(slot, action, tl) {
  if (!action) return;
  switch (action.type) {
    case "move":     return doMove(slot, action.dir, tl);
    case "dash":     return doDash(slot, action.dir, tl);
    case "recharge": return doRecharge(slot, tl);
    case "attack":   return doBasic(slot, action.dir, tl);
    case "melee":    return doMelee(slot, tl);
    case "special":  return doSpecial(slot, tl);
    case "shield":   return doShield(slot, tl);
    case "mirror":   return doMirror(slot, tl);
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

// koniec ťahu: pickupy (heal/mana) a damage políčka (dmg/IK); štít tile damage neblokuje
function endOfStepTileEffects(tl) {
  const order = game.starter === "p1" ? ["p1", "p2"] : ["p2", "p1"];

  // heal/mana — pri oboch hráčoch na rovnakom tile berie ten, kto kolo začína
  for (const slot of order) {
    const p = game.players[slot];
    if (p.hp <= 0) continue;
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
    let dmg = 0, tileType = null;
    if (hasIK(p.x, p.y)) { dmg = 10; tileType = "ik"; }
    else if (game.tiles.some(t => t.type === "dmg" && t.x === p.x && t.y === p.y)) { dmg = 1; tileType = "dmg"; }
    if (dmg > 0) {
      // najprv zvýrazni vyhodnocované políčko, potom zásah
      pushStateFrame(tl, [{ kind: "tile_proc", tile: tileType, cell: [p.x, p.y] }], 600);
      p.hp = Math.max(0, p.hp - dmg);
      pushStateFrame(tl, [{ kind: "hit", target: slot, dmg }], SMALL_DELAY_MS);
      // prvý mŕtvy okamžite ukončuje hru — druhý tile zásah sa už nevyhodnotí (remíza nemôže nastať)
      if (winnerNow()) return;
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

// platná základná akcia? (move/attack/dash potrebujú smer)
function validBasicAction(a, used) {
  if (!a || !ACTION_TYPES.has(a.type) || used.has(a.type)) return false;
  if ((a.type === "move" || a.type === "attack" || a.type === "dash") && !MOVE_DIRS.has(a.dir)) return false;
  return true;
}
// hráč, ktorý sa nestihol locknúť: zachová svoju rozpracovanú frontu (draft) a chýbajúce do 3 doplní náhodne
function fillFromDraft(draftQueue) {
  const q = [], used = new Set();
  for (const a of (Array.isArray(draftQueue) ? draftQueue : [])) {
    if (q.length >= 3) break;
    if (!validBasicAction(a, used)) continue;
    q.push({ type: a.type, dir: a.dir || null });
    used.add(a.type);
  }
  const pool = [...ACTION_TYPES].filter(t => !used.has(t));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const dirs = [...MOVE_DIRS];
  while (q.length < 3 && pool.length) {
    const t = pool.shift();
    q.push((t === "move" || t === "attack" || t === "dash") ? { type: t, dir: dirs[Math.floor(Math.random() * dirs.length)] } : { type: t });
  }
  return q;
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
    // zahraj, čo má hráč rozpracované (draft), chýbajúce do 3 doplň náhodne; gold zachovaj len keď si ho navolil
    p.queue = fillFromDraft(p.draft?.queue);
    p.golden = !!p.draft?.golden && slot !== game.starter; // golden shield len pre nestartéra
    p.goldenMirror = !!p.draft?.goldenMirror && slot !== game.starter; // golden mirror tiež len pre nestartéra
    p.goldenMana = !!p.draft?.goldenMana;
    p.locked = true;
  }
  if (game.players.p1.locked && game.players.p2.locked) resolveTurn();
  else io.emit("state", snapshot());
}

/* -------------------- Turn resolution -------------------- */
function resolveTurn() {
  clearTurnTimer();
  const tl = [];
  // prvý „nulový“ frame pre hladký začiatok
  pushStateFrame(tl, [], 10);

  const order = game.starter === "p1" ? ["p1","p2"] : ["p2","p1"];
  let ended = false;

  // golden shield / golden mirror — extra predťah hráča, ktorý je v kole druhý, vyhodnotený pred prvou akciou startera
  const second = order[1];
  if (game.players[second].golden || game.players[second].goldenMirror) {
    const gp = game.players[second];
    const isMirror = gp.goldenMirror;
    const cost = isMirror ? GOLDEN_MIRROR_COST : GOLDEN_COST;
    const type = isMirror ? "golden_mirror" : "golden_shield";
    pushStateFrame(tl, [{ kind: "action", from: second, action: { type, dir: null } }], 250);
    if (gp.mana >= cost) {
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
  }

  outer:
  for (let i = 0; i < 3; i++) {
    for (const slot of order) {
      const foe = other(slot);
      // obrany kryjú práve túto (najbližšiu) súperovu akciu — spotrebujú sa ňou aj bez zásahu
      const foeShieldArmed = game.players[foe].shield;
      const foeMirrorArmed = game.players[foe].mirror;
      const act = game.players[slot].queue[i];
      // ohlás akciu klientovi (záznam kola pod HUD widgetom)
      if (act) pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: act.type, dir: act.dir || null } }], 250);
      doAction(slot, act, tl);
      if (foeShieldArmed) { game.players[foe].shield = false; game.players[foe].shieldGold = false; }
      if (foeMirrorArmed) { game.players[foe].mirror = false; game.players[foe].mirrorGold = false; }

      // po každej akcii skontroluj lethal
      const w = winnerNow();
      if (w) { ended = true; break outer; }
    }

    // koniec ťahu — efekty špeciálnych políčok (pickupy, dmg, IK)
    endOfStepTileEffects(tl);
    if (winnerNow()) { ended = true; break outer; }
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

    // golden mana refill — úplne posledná udalosť kola (+6 many za HP, cena rastie s každým použitím)
    for (const slot of order) {
      const p = game.players[slot];
      if (!p.goldenMana) continue;
      p.goldenMana = false;
      const cost = p.manaRefills + 1;
      pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: "golden_mana", dir: null } }], 250);
      // refill nesmie hráča zabiť a pri plnej mane je naprázdno -> neplatný
      if (p.hp > cost && p.mana < MAX_MANA) {
        p.hp -= cost;
        const gained = Math.min(GOLDEN_MANA_GAIN, MAX_MANA - p.mana);
        p.mana += gained;
        p.manaRefills++;
        pushStateFrame(tl, [{ kind: "golden_mana", from: slot, hpCost: cost, gained }], SMALL_DELAY_MS);
      } else {
        pushInvalid(tl, slot);
      }
    }

    // bežný prechod do ďalšieho kola (mini-frame posúva HUD dopredu)
    const nextTurn    = game.turn + 1;
    const nextStarter = nextTurn % 2 === 1 ? "p1" : "p2";
    tl.push({ ...snapshot(), turn: nextTurn, starter: nextStarter, effects: [], delayMs: 10 });
    game.turn    = nextTurn;
    game.starter = nextStarter;
  }

  io.emit("state", { ...snapshot(), timeline: tl });

  // príprava na ďalšie plánovanie (lokálny stav; vizuálne odomkne až klient po dohraní timeline)
  game.players.p1.locked = false;
  game.players.p2.locked = false;
  game.players.p1.queue = [];
  game.players.p2.queue = [];
  game.players.p1.goldenMana = false; // nevyhodnotený refill (ukončené kolo) prepadá
  game.players.p2.goldenMana = false;
  game.players.p1.goldenMirror = false;
  game.players.p2.goldenMirror = false;
  game.players.p1.draft = { queue: [], golden: false, goldenMirror: false, goldenMana: false };
  game.players.p2.draft = { queue: [], golden: false, goldenMirror: false, goldenMana: false };

  const dur = tl.reduce((a, f) => a + (f.delayMs || 0), 0);
  if (ended) {
    handleGameEnd(dur);
  } else {
    // ďalšie kolo: backstop začne až po čase, kým klient dohrá timeline (počas neho neplánuje)
    beginPlanningTimer(dur);
  }
}

// koniec jednej hry: zapíš výhru do série; ak je séria rozhodnutá -> match_over,
// inak po dohraní timeline (na klientovi) spusti ďalšiu hru (swap strán + nový char-select)
function handleGameEnd(timelineDurationMs) {
  clearTurnTimer();
  const w = winnerNow(); // "p1" | "p2" | "draw"
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
    // medzihra: počkaj, kým klient dohrá timeline + animáciu smrti + zobrazí skóre, potom ďalšia hra
    setTimeout(() => {
      io.emit("new_game", { series: seriesSnapshot() });
      startGame(game.series.gameIndex + 1);
    }, (timelineDurationMs || 0) + 6500);
  }
}

/* -------------------- Match / game start -------------------- */
function startMatch(config) {
  game.config = config;
  game.series = {
    gameIndex: 0,
    needed: MATCH_FORMATS[config.format] || 1,
    firstStarter: "A", // hru 1 začína host (osoba A); v BO3/BO5 sa štartér strieda
    format: config.format,
  };
  game.seriesWins = { A: 0, B: 0 };
  startGame(1);
}

// pripraví novú hru v sérii: prehodí štartéra na ľavú stranu (slot p1), resetne hráčov,
// vyčistí postavy (char-select pred každou hrou) a re-emitne sloty (osoba mohla zmeniť stranu)
function startGame(gameIndex) {
  clearTurnTimer();
  const starterPerson = (gameIndex % 2 === 1)
    ? game.series.firstStarter
    : otherPerson(game.series.firstStarter);
  game.series.gameIndex = gameIndex;
  game.seats = { p1: starterPerson, p2: otherPerson(starterPerson) };

  game.players.p1 = newPlayer("p1");
  game.players.p2 = newPlayer("p2");
  game.turn = 1;
  game.starter = "p1"; // štartér hry sedí v p1 a začína 1. kolo
  game.tiles = [];
  game.iks = [];
  game.phase = "playing";

  emitYouAre();
  io.emit("state", snapshot());
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
  // identita = osoba A/B (A = host); slot sa odvodí z aktuálnych seats a mení sa medzi hrami
  let person = null;
  if (!personSockets.A) { personSockets.A = socket; person = "A"; }
  else if (!personSockets.B) { personSockets.B = socket; person = "B"; }
  socket.data.person = person;

  if (person) socket.emit("you_are", { slot: slotForPerson(person), isHost: person === "A" });
  else socket.emit("spectator"); // obe osoby obsadené — tretí a ďalší len dostanú info, že hra beží
  socket.emit("state", snapshot());

  // úvodná obrazovka: host nastaví formát + tiles + časový limit a spustí zápas
  socket.on("configure_match", (raw) => {
    if (person !== "A") return;          // konfiguruje len host
    if (game.phase !== "lobby") return;  // len pred začiatkom zápasu
    const config = sanitizeConfig(raw);
    if (!config) return;
    startMatch(config);
  });

  socket.on("choose_character", (key) => {
    if (!person) return;
    if (game.phase !== "playing") return;       // postava sa volí len v hernej fáze (pred kolami)
    if (!["fire","lightning","wanderer"].includes(key)) return;
    const slot = slotForPerson(person);
    const me = game.players[slot];
    if (me.char) return;                          // postava sa pre danú hru volí raz
    me.char = key;
    // obaja vybrali -> začína 1. kolo, naštartuj časovač pred emitom (snapshot nesie timerMs pre refresh-sync)
    if (game.players.p1.char && game.players.p2.char) beginPlanningTimer(0);
    io.emit("state", snapshot());
  });

  socket.on("lock_in", (queue) => {
    if (!person) return;
    if (game.phase !== "playing") return;
    const slot = slotForPerson(person);
    if (!game.players.p1.char || !game.players.p2.char) return; // ešte sa vyberajú postavy
    if (!validQueue(queue, slot)) return;
    const me = game.players[slot];
    let q = queue;
    me.golden = q[0]?.type === "golden_shield";
    me.goldenMirror = q[0]?.type === "golden_mirror";
    if (me.golden || me.goldenMirror) q = q.slice(1);
    me.goldenMana = q[q.length - 1]?.type === "golden_mana";
    if (me.goldenMana) q = q.slice(0, -1);
    me.queue = q.map(a => ({ ...a }));
    me.locked = true;

    if (game.players.p1.locked && game.players.p2.locked) {
      resolveTurn();
    } else {
      // quick-draw: hneď ako sa jeden locklne, druhý má QUICKDRAW_MS na ťah
      if (game.config?.timer === "quickdraw") armTurnTimer(QUICKDRAW_MS);
      io.emit("state", snapshot());
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
    for (const a of inQ) {
      if (out.length >= 3) break;
      if (!validBasicAction(a, used)) continue;
      out.push({ type: a.type, dir: a.dir || null });
      used.add(a.type);
    }
    me.draft = { queue: out, golden: !!d?.golden, goldenMirror: !!d?.goldenMirror, goldenMana: !!d?.goldenMana };
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
    if (personSockets.A === socket) personSockets.A = null;
    if (personSockets.B === socket) personSockets.B = null;
    if (wasPlayer) clearTurnTimer(); // bez hráča nemá zmysel auto-resolve; odpojenie diváka časovač neruší
  });
});

httpServer.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
