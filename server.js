import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const GRID_W = 5;
const GRID_H = 3;
const MAX_HP = 10;
const MAX_MANA = 10;
const ATTACK_COST = 2;

const ALLOWED_CHARS = ["fire", "lightning", "wanderer"];


// arény – vrstvy od pozadia po popredie
const ARENAS = {
  bridge: ["sky-bridge.png","clouds.png","clouds-2.png","tower.png","bridge.png"],
};

const MOVE_FRAME_MS = 1000;        // dĺžka jedného kroku (chôdza)
const RECHARGE_FRAME_MS = 600;    // nabíjanie many
const DELAY_STATE_MS = 650;       // generické (ak nie je špecifikované)
const DELAY_PROJECTILE_MS = 200;  // rýchlosť „projektilu“ po bunkách


function damageByRookDistance(dist, targetMaxHp) {
  if (dist === 0) return Infinity;
  if (dist === 1) return Math.max(1, Math.floor(targetMaxHp / 2));
  if (dist === 2) return Math.max(1, Math.floor(targetMaxHp / 4));
  return Math.max(1, Math.floor(targetMaxHp / 8));
}

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

function rookDistance(a, b) {
  if (a.x === b.x) return Math.abs(a.y - b.y);
  if (a.y === b.y) return Math.abs(a.x - b.x);
  return null;
}

// vrátane cieľa; pri dist 0 -> [štart]
function lineCells(ax, ay, bx, by) {
  if (ax === bx && ay === by) return [[ax, ay]];
  const cells = [];
  if (ax === bx) {
    const step = ay < by ? 1 : -1;
    for (let y = ay + step; y !== by + step; y += step) cells.push([ax, y]);
  } else if (ay === by) {
    const step = ax < bx ? 1 : -1;
    for (let x = ax + step; x !== by + step; x += step) cells.push([x, ay]);
  }
  return cells;
}

const applyRecharge = (p) => (p.mana = clamp(p.mana + 2, 0, MAX_MANA));

/**
 * Útok:
 * - ak útočník nemá manu → nič sa nedeje (attempted=false)
 * - ak má manu → MANA SA VŽDY ODPÍŠE (attempted=true)
 *   - mimo „veže“ (dist=null) → miss: žiadny projektil, len animácia (attack_swing)
 *   - v dosahu → dmg podľa vzdialenosti + projektil línia
 */
function applyAttack(attacker, defender) {
  if (attacker.mana < ATTACK_COST) {
    return { attempted: false, hit: false, dmg: 0, path: [] };
  }
  attacker.mana -= ATTACK_COST;

  const dist = rookDistance(attacker, defender);
  if (dist === null) {
    return { attempted: true, hit: false, dmg: 0, path: [] }; // miss, len swing
  }

  const dmg = damageByRookDistance(dist, MAX_HP);
  const realDmg = dmg === Infinity ? defender.hp : dmg;
  defender.hp = clamp(defender.hp - realDmg, 0, MAX_HP);

  const path = lineCells(attacker.x, attacker.y, defender.x, defender.y);
  return { attempted: true, hit: true, dmg: realDmg, path, targetDead: defender.hp === 0 };
}

function snapshot() {
  return JSON.parse(JSON.stringify({
    turn: game.turn,
    p1: game.players.p1,
    p2: game.players.p2,
    arena: game.arena
  }));
}

function pushStateFrame(timeline, effects = [], delay = DELAY_STATE_MS) {
  timeline.push({ ...snapshot(), effects, delayMs: delay });
}
function pushProjectileFrames(timeline, path, fromSlot, targetSlot) {
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    const isLast = i === path.length - 1;
    const effects = [{ kind: "projectile", from: fromSlot, cell }];
    if (isLast) effects.push({ kind: "hit", target: targetSlot });
    timeline.push({ ...snapshot(), effects, delayMs: DELAY_PROJECTILE_MS });
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
      applyRecharge(actor);
      // ⬇️ tu bol preklep: slot -> actorSlot
      pushStateFrame(
        timeline,
        [{ kind: "recharge", actor: actorSlot, cells: [[actor.x, actor.y]] }],
        RECHARGE_FRAME_MS
      );
      return;
    }
  
    if (action?.type === "attack") {
      const res = applyAttack(actor, opp);
      if (!res.attempted) {          // nemá manu → bez zmeny stavu
        pushStateFrame(timeline);
        return;
      }
      if (res.hit) {
        pushProjectileFrames(timeline, res.path, actorSlot, oppSlot);
        if (P.p1.hp <= 0 || P.p2.hp <= 0) someoneDead = true;
      } else {
        // miss: len animácia útoku
        pushStateFrame(timeline, [{ kind: "attack_swing", from: actorSlot }], 300);
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
  game = createInitialState(); // turn=1, arena=null, ready=false
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
      const bothLocked = game.players.p1?.locked && game.players.p2?.locked;
      if (bothLocked) {
        const timeline = resolveTurn();
        broadcastState({ timeline });

        const p1dead = game.players.p1.hp <= 0;
        const p2dead = game.players.p2.hp <= 0;
        if (p1dead || p2dead) {
            const winner = p1dead && p2dead ? "draw" : (p1dead ? "p2" : "p1");
            const totalMs = (timeline || []).reduce((acc, f) => acc + (f.delayMs ?? DELAY_STATE_MS), 0);
            setTimeout(() => {
            io.to("match-1").emit("game_over", { winner });
            }, totalMs + 50); // malé buffer oneskorenie
        }
      }
    }
  });

  // Retry
  socket.on("retry", () => {
    resetGameKeepConnections();
    io.to("match-1").emit("reset");  // klienti si vyčistia lokálne premenné/UI
    broadcastState();                // pošleme čistý stav (turn=1, aréna=null, char=null)
  });

  socket.on("disconnect", () => {
    game = createInitialState();
    io.to("match-1").emit("state", game);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("http://localhost:" + PORT));
