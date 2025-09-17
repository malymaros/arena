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

/* -------------------- Game constants -------------------- */
const BOARD = { w: 5, h: 3 };
const START_POS = { p1: { x: 0, y: 1 }, p2: { x: 4, y: 1 } };
const START_HP = 10;
const START_MANA = 2;
const MAX_MANA = 10;

const BASIC_COST = 1;
const BASIC_DMG  = 1;

const SPECIAL_COST = 5;

const MOVE_DELAY_MS    = 2000; // 2× pomalšie (bolo 1000)
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
    char: null,      // "fire" | "lightning" | "wanderer"
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
  };
}
newGame();

/* -------------------- Helpers -------------------- */
function cloneActor(a) {
  if (!a) return null;
  const { slot, x, y, hp, mana, char, locked } = a;
  return { slot, x, y, hp, mana, char, locked };
}
function snapshot() {
  return {
    board: { ...game.board },
    p1: cloneActor(game.players.p1),
    p2: cloneActor(game.players.p2),
    arena: game.arena,
    turn: game.turn,
    starter: game.starter
  };
}

function inBounds(x, y, board = game.board) {
  return x >= 0 && y >= 0 && x < board.w && y < board.h;
}

function pushStateFrame(timeline, effects = [], delayMs = SMALL_DELAY_MS) {
  const snap = snapshot();
  timeline.push({ ...snap, effects, delayMs });
}

function pushInvalid(tl, who, ms = SMALL_DELAY_MS) {
  pushStateFrame(tl, [{ kind: "invalid", target: who }], ms);
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
      return me.y === foe.y ? { dmg:4, hit:foeS } : { dmg:0, hit:null };
    case "lightning": // všetko okrem vlastného políčka
      return (me.x !== foe.x || me.y !== foe.y) ? { dmg:2, hit:foeS } : { dmg:0, hit:null };
    case "wanderer":  // len diagonála 1
      return isDiagAdjacent(me, foe) ? { dmg:8, hit:foeS } : { dmg:0, hit:null };
    default:
      return { dmg:0, hit:null };
  }
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
function doMove(slot, dir, tl) {
  const a = game.players[slot];
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir] || [0,0];
  const nx = a.x + delta[0], ny = a.y + delta[1];
  if (!inBounds(nx, ny)) { pushInvalid(tl, slot); return; }
  a.x = nx; a.y = ny;
  pushStateFrame(tl, [], MOVE_DELAY_MS);
}

function doRecharge(slot, tl) {
  const a = game.players[slot];

  // Na maxime many -> neplatné, žiadna modrá animácia/bublina
  if (a.mana >= MAX_MANA) { pushInvalid(tl, slot); return; }

  const before = a.mana;
  a.mana = Math.min(MAX_MANA, a.mana + 2);
  const gained = a.mana - before; // 1 alebo 2 (ak capne)
  if (gained > 0) {
    pushStateFrame(
      tl,
      [{ kind: "recharge", from: slot, cells: [[a.x, a.y]], amount: gained }],
      SMALL_DELAY_MS
    );
  } else {
    // teoreticky by sa sem nemalo dostať, ale keby…
    pushInvalid(tl, slot);
  }
}

function doBasic(slot, tl) {
  const me  = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];

  if (me.mana < BASIC_COST) { pushInvalid(tl, slot); return; }
  me.mana -= BASIC_COST;

  // vizuál: strela po riadku
  const dir  = (op && op.y === me.y && op.x < me.x) ? "left" : "right";
  const step = dir === "left" ? -1 : 1;
  let x = me.x;
  while (true) {
    x += step;
    if (!inBounds(x, me.y)) break;
    pushStateFrame(tl, [{ kind: "charge", from: slot, dir, cell: [x, me.y] }], CHARGE_STEP_MS);
  }

  // damage len ak súper je v rovnakom riadku
  if (op && op.y === me.y) {
    op.hp = Math.max(0, op.hp - BASIC_DMG);
    pushStateFrame(tl, [{ kind: "hit", target: opS, dmg: BASIC_DMG }], SMALL_DELAY_MS);
  }
}

function doSpecial(slot, tl) {
  const actor = game.players[slot];
  if (!actor) return;

  // Bez many -> len spätná väzba (Hurt na klientovi), žiadna special animácia
  if (actor.mana < SPECIAL_COST) {
    pushStateFrame(tl, [{ kind: "invalid", target: slot }], SMALL_DELAY_MS);
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
    game.players[hit].hp = Math.max(0, game.players[hit].hp - dmg);
    pushStateFrame(tl, [{ kind: "hit", target: hit, dmg }], SMALL_DELAY_MS);
  } else {
    pushStateFrame(tl, [], SMALL_DELAY_MS);
  }
}

function doAction(slot, action, tl) {
  if (!action) return;
  switch (action.type) {
    case "move":     return doMove(slot, action.dir, tl);
    case "recharge": return doRecharge(slot, tl);
    case "attack":   return doBasic(slot, tl);
    case "special":  return doSpecial(slot, tl);
    default: break;
  }
}

/* -------------------- Turn resolution -------------------- */
function resolveTurn() {
  const tl = [];
  // prvý „nulový“ frame pre hladký začiatok
  pushStateFrame(tl, [], 10);

  const order = game.starter === "p1" ? ["p1","p2"] : ["p2","p1"];
  let ended = false;

  outer:
  for (let i = 0; i < 3; i++) {
    for (const slot of order) {
      const act = game.players[slot].queue[i];
      doAction(slot, act, tl);

      // po každej akcii skontroluj lethal
      const w = winnerNow();
      if (w) { ended = true; break outer; }
    }
  }

  if (!ended) {
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
}

/* -------------------- IO -------------------- */
io.on("connection", (socket) => {
  let slot = null;
  if (!sockets.p1) { sockets.p1 = socket; slot = "p1"; }
  else if (!sockets.p2) { sockets.p2 = socket; slot = "p2"; }

  if (slot) socket.emit("you_are", slot);
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
    if (!Array.isArray(queue) || queue.length !== 3) return;
    const me = game.players[slot];
    me.queue = queue.map(a => ({ ...a }));
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

  socket.on("disconnect", () => {
    if (sockets.p1 === socket) sockets.p1 = null;
    if (sockets.p2 === socket) sockets.p2 = null;
  });
});

httpServer.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
