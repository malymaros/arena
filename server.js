import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const GRID_W = 5;
const GRID_H = 3;
const MAX_HP = 5;
const MAX_MANA = 10;

// === BASIC ATTACK (nové) ===
const BASIC_COST = 1;      // 1 mana
const BASIC_DMG  = 1;      // ⬅️ predpoklad: 1 dmg; zmeňte podľa potreby

const ALLOWED_CHARS = ["fire", "lightning", "wanderer"];

// arény – vrstvy
const ARENAS = {
  bridge: ["sky-bridge.png","clouds.png","clouds-2.png","tower.png","bridge.png"],
};

// tempo timeline (spomalené)
const MOVE_FRAME_MS = 1000;
const RECHARGE_FRAME_MS = 600;
const DELAY_STATE_MS = 650;
const DELAY_CHARGE_MS = 200;   // rýchlosť letiacich "Charge" frame-ov

const starterForTurn = (turn) => (turn % 2 === 1 ? "p1" : "p2");

function createInitialState() {
  return {
    turn: 1,
    players: { p1: null, p2: null },
    board: { w: GRID_W, h: GRID_H },
    ready: false,
    arena: null
  };
}
let game = createInitialState();

function newPlayerState(id, x, y) {
  return { id, x, y, hp: MAX_HP, mana: 2, actions: [], locked: false, char: null };
}
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function applyMove(p, dir) {
  const dirs = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
  const d = dirs[dir] || [0,0];
  p.x = clamp(p.x + d[0], 0, GRID_W - 1);
  p.y = clamp(p.y + d[1], 0, GRID_H - 1);
}

function slimPlayer(p) {
    if (!p) return null;
    return { id: p.id, x: p.x, y: p.y, hp: p.hp, mana: p.mana, char: p.char };
  }
  function snapshot() {
    return { turn: game.turn, p1: slimPlayer(game.players.p1), p2: slimPlayer(game.players.p2), arena: game.arena };
  }

  
function pushStateFrame(timeline, effects = [], delay = DELAY_STATE_MS) {
  timeline.push({ ...snapshot(), effects, delayMs: delay });
}

// === BASIC ATTACK – výpočet dráhy po riadku ===
function computeChargePath(attacker, defender) {
  // smer určujeme podľa relatívnej polohy na osi X (k súperovi)
  const step = defender.x > attacker.x ? 1 : (defender.x < attacker.x ? -1 : (attacker.id === "p1" ? 1 : -1));

  const path = [];
  let x = attacker.x;
  const y = attacker.y;

  // ak je súper v rovnakom riadku → letíme po ňom a trafíme
  if (attacker.y === defender.y) {
    while (true) {
      x += step;
      if (x < 0 || x >= GRID_W) break;
      path.push([x, y]);
      if (x === defender.x) {
        return { path, hit: true, dir: step > 0 ? "right" : "left" };
      }
    }
    return { path, hit: false, dir: step > 0 ? "right" : "left" }; // nemalo by nastať, ale fallback
  }

  // nie je v rovnakom riadku → vystreľ až po okraj (miss)
  while (true) {
    x += step;
    if (x < 0 || x >= GRID_W) break;
    path.push([x, y]);
  }
  return { path, hit: false, dir: step > 0 ? "right" : "left" };
}

function pushChargeFrames(timeline, path, fromSlot, targetSlot, dir, withHit) {
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    const isLast = i === path.length - 1;
    const effects = [{ kind: "charge", from: fromSlot, cell, dir }];
    if (withHit && isLast) effects.push({ kind: "hit", target: targetSlot });
    timeline.push({ ...snapshot(), effects, delayMs: DELAY_CHARGE_MS });
  }
}

function maybePickArena() {
  if (game.arena) return;
  const keys = Object.keys(ARENAS);
  game.arena = keys[Math.floor(Math.random() * keys.length)] || null;
}

function resolveTurn() {
  const P = game.players;
  const timeline = [];

  const starter = starterForTurn(game.turn);
  const other = starter === "p1" ? "p2" : "p1";

  pushStateFrame(timeline, [], 300);
  let someoneDead = false;

  const doAction = (actorSlot, action) => {
    const actor = P[actorSlot];
    const oppSlot = actorSlot === "p1" ? "p2" : "p1";
    const opp = P[oppSlot];
    if (!actor || !opp || someoneDead) return;

    if (action?.type === "move") {
      applyMove(actor, action.dir);
      pushStateFrame(timeline, [], MOVE_FRAME_MS);
      return;
    }

    if (action?.type === "recharge") {
      actor.mana = clamp(actor.mana + 2, 0, MAX_MANA);
      pushStateFrame(timeline, [{ kind: "recharge", actor: actorSlot, cells: [[actor.x, actor.y]] }], RECHARGE_FRAME_MS);
      return;
    }

    if (action?.type === "attack") {
      // BASIC ATTACK – ak nemá manu, nič sa nedeje
      if (actor.mana < BASIC_COST) { pushStateFrame(timeline); return; }
      actor.mana -= BASIC_COST;

      // dráha po riadku (hit len ak v rovnakom riadku)
      const { path, hit, dir } = computeChargePath(actor, opp);

      if (path.length === 0) {
        // teoreticky pri okraji a rovnakom x – sprav aspoň "swing"
        pushStateFrame(timeline, [{ kind: "attack_swing", from: actorSlot }], 300);
        return;
      }

      pushChargeFrames(timeline, path, actorSlot, oppSlot, dir, hit);

      if (hit) {
        opp.hp = clamp(opp.hp - BASIC_DMG, 0, MAX_HP);
        if (P.p1.hp <= 0 || P.p2.hp <= 0) someoneDead = true;
      }
      return;
    }

    pushStateFrame(timeline, [], 200);
  };

  // 3 kroky; vždy najprv starter, potom other
  for (let i = 0; i < 3 && !someoneDead; i++) {
    doAction(starter, P[starter].actions[i]);
    if (someoneDead) break;
    doAction(other, P[other].actions[i]);
  }

  // reset na ďalší ťah
  P.p1.actions = []; P.p2.actions = [];
  P.p1.locked = false; P.p2.locked = false;
  game.turn += 1;

  return timeline;
}

function broadcastState(extra = {}) {
  io.to("match-1").emit("state", {
    board: game.board,
    turn: game.turn,
    p1: game.players.p1,
    p2: game.players.p2,
    ready: game.ready,
    arena: game.arena,
    starter: starterForTurn(game.turn),
    ...extra
  });
}

// Reset, ktorý ponechá pripojených hráčov, ale vráti hru do úplného začiatku
function resetGameKeepConnections() {
  const hadP1 = !!game.players.p1;
  const hadP2 = !!game.players.p2;
  game = createInitialState();
  if (hadP1) game.players.p1 = newPlayerState("p1", 0, Math.floor(GRID_H/2));
  if (hadP2) game.players.p2 = newPlayerState("p2", GRID_W - 1, Math.floor(GRID_H/2));
}

io.on("connection", (socket) => {
  let mySlot = null;
  if (!game.players.p1) {
    mySlot = "p1"; game.players.p1 = newPlayerState("p1", 0, Math.floor(GRID_H/2));
  } else if (!game.players.p2) {
    mySlot = "p2"; game.players.p2 = newPlayerState("p2", GRID_W - 1, Math.floor(GRID_H/2));
  } else {
    socket.emit("error_msg", "Server je plný pre toto POC (2 hráči).");
    socket.disconnect(true); return;
  }

  socket.join("match-1");
  socket.emit("you_are", mySlot);
  broadcastState();

  socket.on("choose_character", (key) => {
    if (!ALLOWED_CHARS.includes(key)) { socket.emit("error_msg", "Neplatná postava."); return; }
    const p = game.players[mySlot]; if (!p) return;
    p.char = key;
    if (game.players.p1?.char && game.players.p2?.char) { maybePickArena(); game.ready = true; }
    broadcastState();
  });

  socket.on("lock_in", (actions) => {
    if (!Array.isArray(actions) || actions.length !== 3) {
      socket.emit("error_msg", "Musíte poslať presne 3 akcie.");
      return;
    }
    const p = game.players[mySlot]; if (!p || p.locked) return;

    p.actions = actions.map(a => {
      if (a?.type === "move" && ["up","down","left","right"].includes(a.dir)) return { type:"move", dir:a.dir };
      if (a?.type === "recharge") return { type:"recharge" };
      if (a?.type === "attack") return { type:"attack" };
      return { type:"recharge" };
    });
    p.locked = true;

    broadcastState();

    const bothLocked = game.players.p1?.locked && game.players.p2?.locked;
    if (bothLocked) {
      const timeline = resolveTurn();
      broadcastState({ timeline });

      // oneskorené game_over (po dohraní timeline) – klient má aj fallback
      const p1dead = game.players.p1.hp <= 0;
      const p2dead = game.players.p2.hp <= 0;
      if (p1dead || p2dead) {
        const winner = p1dead && p2dead ? "draw" : (p1dead ? "p2" : "p1");
        const totalMs = (timeline || []).reduce((acc, f) => acc + (f.delayMs ?? DELAY_STATE_MS), 0);
        setTimeout(() => {
          io.to("match-1").emit("game_over", { winner });
        }, totalMs + 50);
      }
    }
  });

  socket.on("retry", () => {
    resetGameKeepConnections();
    io.to("match-1").emit("reset");
    broadcastState();
  });

  socket.on("disconnect", () => {
    game = createInitialState();
    io.to("match-1").emit("state", game);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("http://localhost:" + PORT));
