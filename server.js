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
const START_MANA = 8; // vyšší štart = mind games od 1. kola (special hrozba vs golden shield counter)
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
const DASH_COST   = 4; // presun až o 2 políčka jedným smerom
const GOLDEN_MANA_GAIN = 6; // golden mana refill: +6 many za HP; cena v HP rastie s každým použitím (1, 2, 3…)

const ACTION_TYPES = new Set(["move", "recharge", "attack", "melee", "special", "shield", "mirror", "dash"]);
const MOVE_DIRS = new Set(["up", "down", "left", "right"]);

const MOVE_DELAY_MS    = 800;  // posun postavy trvá 700 ms + malý buffer
const SMALL_DELAY_MS   = 600;  // 2× pomalšie (bolo 300)
const SPECIAL_REPEAT   = 3;
const SPECIAL_BEAT_MS  = 900;  // 2× pomalšie (bolo 450)
const CHARGE_STEP_MS   = 560;  // 2× pomalšie (bolo 280)

/* -------------------- Game state -------------------- */
let sockets = { p1: null, p2: null };
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
    golden: false,     // objednaný golden shield (extra akcia pred začiatkom kola)
    goldenMana: false, // objednaný golden mana refill (extra akcia po konci kola)
    manaRefills: 0,    // koľkokrát už hráč refill použil — určuje rastúcu HP cenu
    locked: false,
    queue: []
  };
}

function newGame() {
  game = {
    board: { ...BOARD },
    players: {
      p1: newPlayer("p1"),
      p2: newPlayer("p2")
    },
    arena: "bridge",
    turn: 1,
    starter: "p1", // odd -> p1, even -> p2
    tiles: [],     // { x, y, type: "dmg" | "heal" | "mana" } — pribúdajú od konca 1. kola
    ik: null,      // { x, y } — insta-kill tile; jediný prekrýva iné políčka, každé kolo sa presúva
  };
}
newGame();

/* -------------------- Helpers -------------------- */
function cloneActor(a) {
  if (!a) return null;
  const { slot, x, y, hp, mana, char, shield, shieldGold, mirror, manaRefills, locked } = a;
  return { slot, x, y, hp, mana, char, shield, shieldGold, mirror, manaRefills, locked };
}
function snapshot() {
  return {
    board: { ...game.board },
    p1: cloneActor(game.players.p1),
    p2: cloneActor(game.players.p2),
    arena: game.arena,
    turn: game.turn,
    starter: game.starter,
    tiles: game.tiles.map(t => ({ ...t })),
    ik: game.ik ? { ...game.ik } : null
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
// voliteľný prefix golden_shield (len hráč, ktorý v kole NEzačína) a sufix golden_mana (ktokoľvek)
function validQueue(queue, slot) {
  if (!Array.isArray(queue)) return false;
  let q = queue;
  if (q[0] && q[0].type === "golden_shield") {
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
  try { if (sockets.p1) sockets.p1.disconnect(true); } catch {}
  try { if (sockets.p2) sockets.p2.disconnect(true); } catch {}
  sockets.p1 = null;
  sockets.p2 = null;
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
      applyHit(opS, Math.max(1, BASIC_DMG_MAX - dist), tl);
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
    applyHit(opS, MELEE_DMG, tl);
  }
}

// aplikuje zásah cez prípadné obrany obrancu (shield blokuje celý dmg, mirror ho odrazí do útočníka)
function applyHit(targetSlot, rawDmg, tl) {
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
    pushStateFrame(tl, [{ kind: "mirror", target: targetSlot }], SMALL_DELAY_MS);
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
    applyHit(hit, dmg, tl);
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
function playerAt(x, y) {
  const { p1, p2 } = game.players;
  return (p1.x === x && p1.y === y) || (p2.x === x && p2.y === y);
}
function hasTile(x, y) {
  return game.tiles.some(t => t.x === x && t.y === y);
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
    if (game.ik && game.ik.x === p.x && game.ik.y === p.y) continue; // IK prekrýva => pickup neaktívny
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
    if (game.ik && game.ik.x === p.x && game.ik.y === p.y) { dmg = 10; tileType = "ik"; }
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

// koniec kola: presun IK + spawn nového tile (75 % dmg, zvyšok heal/mana/IK)
function endOfRoundTiles() {
  if (game.ik) {
    const c = pickCell((x, y) => !playerAt(x, y) && !(x === game.ik.x && y === game.ik.y));
    if (c) game.ik = c;
  }

  const r = Math.random();
  let type;
  if (r < 0.75) type = "dmg";
  else if (game.ik) type = r < 0.875 ? "heal" : "mana";
  else type = r < 0.8333 ? "heal" : r < 0.9166 ? "mana" : "ik";

  if (type === "ik") {
    // IK môže vzniknúť hocikde — aj pod hráčom (únik = pohyb), aj nad iným tile
    const c = pickCell(() => true);
    if (c) game.ik = c;
  } else {
    // môže byť aj pod hráčom; nie na existujúcom tile ani pod IK; bez voľného políčka sa spawn preskočí
    const c = pickCell((x, y) => !hasTile(x, y) && !(game.ik && game.ik.x === x && game.ik.y === y));
    if (c) game.tiles.push({ x: c.x, y: c.y, type });
  }
}

/* -------------------- Turn resolution -------------------- */
function resolveTurn() {
  const tl = [];
  // prvý „nulový“ frame pre hladký začiatok
  pushStateFrame(tl, [], 10);

  const order = game.starter === "p1" ? ["p1","p2"] : ["p2","p1"];
  let ended = false;

  // golden shield — extra akcia hráča, ktorý je v kole druhý, vyhodnotená pred prvou akciou startera
  const second = order[1];
  if (game.players[second].golden) {
    const gp = game.players[second];
    pushStateFrame(tl, [{ kind: "action", from: second, action: { type: "golden_shield", dir: null } }], 250);
    if (gp.mana >= GOLDEN_COST) {
      gp.mana -= GOLDEN_COST;
      gp.shield = true;
      gp.shieldGold = true;
      pushStateFrame(tl, [{ kind: "golden_shield", from: second }], SMALL_DELAY_MS);
    } else {
      pushInvalid(tl, second, SMALL_DELAY_MS, "mana");
    }
    gp.golden = false;
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
      if (foeMirrorArmed) game.players[foe].mirror = false;

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

  if (ended) {
    const w = winnerNow(); // "p1" | "p2" | "draw"
    io.emit("game_over", { winner: w });
  }

  // príprava na ďalšie plánovanie
  game.players.p1.locked = false;
  game.players.p2.locked = false;
  game.players.p1.queue = [];
  game.players.p2.queue = [];
  game.players.p1.goldenMana = false; // nevyhodnotený refill (ukončené kolo) prepadá
  game.players.p2.goldenMana = false;
}

/* -------------------- Admin endpoint -------------------- */
app.get("/admin/reset-all", (req, res) => {
  if (!okAdmin(req.query.key)) return res.status(403).send("forbidden");
  forceResetAll();
  res.send("ok");
});

/* -------------------- IO -------------------- */
io.on("connection", (socket) => {
  let slot = null;
  if (!sockets.p1) { sockets.p1 = socket; slot = "p1"; }
  else if (!sockets.p2) { sockets.p2 = socket; slot = "p2"; }

  if (slot) socket.emit("you_are", slot);
  else socket.emit("spectator"); // oba sloty obsadené — tretí a ďalší len dostanú info, že hra beží
  socket.emit("state", snapshot());

  socket.on("choose_character", (key) => {
    if (!slot) return;
    if (!["fire","lightning","wanderer"].includes(key)) return;
    const me = game.players[slot];
    me.char = key;
    io.emit("state", snapshot());
  });

  socket.on("lock_in", (queue) => {
    if (!slot) return;
    if (!validQueue(queue, slot)) return;
    const me = game.players[slot];
    let q = queue;
    me.golden = q[0]?.type === "golden_shield";
    if (me.golden) q = q.slice(1);
    me.goldenMana = q[q.length - 1]?.type === "golden_mana";
    if (me.goldenMana) q = q.slice(0, -1);
    me.queue = q.map(a => ({ ...a }));
    me.locked = true;

    if (game.players.p1.locked && game.players.p2.locked) {
      resolveTurn();
    } else {
      io.emit("state", snapshot());
    }
  });

  socket.on("retry", () => {
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
    if (sockets.p1 === socket) sockets.p1 = null;
    if (sockets.p2 === socket) sockets.p2 = null;
  });
});

httpServer.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
