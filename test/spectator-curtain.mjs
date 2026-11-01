// test/spectator-curtain.mjs - čo vidí divák (docs/RANDOM_ARENA_PLAN.md §4–5) cez reálny server a sockety:
// v lobby čakanie bez opony, po štarte s kockou losovanie arény + opona (stav strán, bez postáv), opona drží, kým
// obaja nemajú postavu A hráčom nedobehli animácie, potom plný stav; neskorý divák dostane oponu tiež;
// pred 2. hrou série opona znova (do výberu postáv).
// Spustenie: node test/spectator-curtain.mjs  (súčasť npm test)
import { spawn } from "child_process";
import { io } from "socket.io-client";
import { ARENA_ROLL_MS } from "../shared/timing.js";

const PORT = 3994;
const URL = `http://localhost:${PORT}`;
let serverProc = null;
let failures = 0;
function check(cond, label, detail = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
const J = JSON.stringify;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function startServer() {
  const proc = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(PORT), FORCE_FIRST_STARTER: "A", PLAYER_KEYS: "testpass", ARENA_SEED: "1" },
    stdio: "ignore",
  });
  return new Promise((resolve) => setTimeout(() => resolve(proc), 1200));
}
function connect() {
  return new Promise((resolve, reject) => {
    const name = "S" + Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 5) + "x";
    const sock = io(URL, { transports: ["websocket"], auth: { name, pass: "testpass" } });
    const killer = setTimeout(() => { sock.close(); reject(new Error("connect timeout")); }, 15000);
    const ctx = { sock, rooms: null, state: null, states: [], arenaRolls: [], gameResult: null };
    sock.on("rooms", (r) => { ctx.rooms = r; });
    sock.on("state", (s) => { ctx.state = s; ctx.states.push(s); });
    sock.on("arena_roll", (r) => { ctx.arenaRolls.push(r); });
    sock.on("game_result", (g) => { ctx.gameResult = g; });
    sock.on("connect", () => { clearTimeout(killer); setTimeout(() => resolve(ctx), 300); });
  });
}
function waitFor(cond, timeoutMs = 5000, label = "condition") {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error("waitFor timeout: " + label)); }
    }, 30);
  });
}
// kolo, v ktorom sa Fire a Lightning trafia specialom aj strelou (hra skončí za pár kôl)
function lockRound(c1, c2) {
  const turn = c1.state.turn;
  c1.sock.emit("lock_in", [{ type: "special" }, { type: "recharge" }, { type: "attack", dir: "right" }], turn);
  c2.sock.emit("lock_in", [{ type: "special" }, { type: "recharge" }, { type: "attack", dir: "left" }], turn);
}

const DICE = { format: "bo3", timer: "off", colorPref: "white", arena: "random", arenas: {
  bridge: { tilesPerRound: 1, tileWeights: { dmg: 0, heal: 100, mana: 0, ik: 0, power: 0, block: 0 }, tilePreview: true },
  portal: { tilesPerRound: 1, tileWeights: { dmg: 100, ik: 0 }, tilePreview: true, portalWeights: { classic: 100, hp: 0, mana: 0, power: 0, nodef: 0 }, portalsPerRound: 1 },
  swamp: { itemsPerRound: 1, itemWeights: { heal: 100, mana: 0 }, shrekPreview: true } } };

async function main() {
  serverProc = await startServer();
  const c1 = await connect(), c2 = await connect(), cS = await connect();
  await waitFor(() => c1.rooms, 5000, "c1 rooms");
  c1.sock.emit("create_room");
  await waitFor(() => c2.rooms?.rooms?.length, 5000, "c2 vidí roomku");
  const roomId = c2.rooms.rooms[0].id;
  c2.sock.emit("join_room", { roomId });
  await waitFor(() => c2.state, 5000, "c2 state");
  cS.sock.emit("spectate_room", { roomId });
  await waitFor(() => cS.state, 5000, "divák state");

  /* ---- lobby ---- */
  check(cS.state.phase === "lobby" && !cS.state.curtain, "L1: divák v lobby - čakanie na hosta, bez opony", J({ phase: cS.state.phase, curtain: cS.state.curtain }));

  /* ---- štart s kockou: losovanie arény + opona ---- */
  const t0 = Date.now();
  c1.sock.emit("configure_match", DICE);
  await waitFor(() => cS.arenaRolls.length && cS.state.phase === "playing", 5000, "divák: arena_roll + playing");
  const arena = cS.arenaRolls[0].arena;
  check(["bridge", "portal", "swamp"].includes(arena) && c1.arenaRolls[0]?.arena === arena, "A1: divák aj hráči dostali losovanie arény", arena);
  check(J(cS.state.curtain) === J({ white: "choosing", black: "choosing" }) && !cS.state.p1.char && !cS.state.p2.char,
    "A2: opona - obaja vyberajú, bez postáv", J(cS.state.curtain));

  c1.sock.emit("choose_character", "fire");
  await waitFor(() => cS.state.curtain?.white === "ready", 3000, "white ready");
  check(cS.state.curtain.black === "choosing" && cS.state.p1.char === null, "A3: biely vybral - ✓ READY, ale postava sa divákovi neprezradí", J(cS.state.p1.char));
  c2.sock.emit("choose_character", "lightning");
  await waitFor(() => c1.state.p2?.char === "lightning", 3000, "hráči majú obe postavy");
  await sleep(150);
  check(Date.now() - t0 < ARENA_ROLL_MS - 300 && cS.state.curtain && J(cS.state.curtain) === J({ white: "ready", black: "ready" }) && !cS.state.p2.char,
    "A4: obaja vybrali, ale hráčom ešte beží losovanie arény - opona drží", J({ ms: Date.now() - t0, curtain: cS.state.curtain }));
  const late = await connect();
  late.sock.emit("spectate_room", { roomId });
  await waitFor(() => late.state, 3000, "neskorý divák");
  check(!!late.state.curtain && !late.state.p1.char, "A5: divák, ktorý príde počas prípravy, dostane oponu tiež");

  await waitFor(() => !cS.state.curtain, ARENA_ROLL_MS + 3000, "opona padne");
  const lifted = Date.now() - t0;
  check(lifted >= ARENA_ROLL_MS - 200 && cS.state.p1.char === "fire" && cS.state.p2.char === "lightning",
    "A6: po dobehnutí animácií opona padne a divák vidí postavy", J({ ms: lifted, p1: cS.state.p1.char, p2: cS.state.p2.char }));
  check(cS.state.arena === c1.state.arena, "A7: divák aj hráči na tej istej (vylosovanej) aréne", cS.state.arena);

  /* ---- 2. hra série: opona do výberu postáv ---- */
  for (let r = 0; r < 12 && !c1.gameResult; r++) {
    const before = c1.states.length;
    lockRound(c1, c2);
    await waitFor(() => c1.states.length > before && c1.state.timeline, 5000, "kolo");
  }
  check(c1.gameResult && !c1.gameResult.matchOver, "S1: hra 1 dohraná, séria pokračuje", J(c1.gameResult));
  await waitFor(() => cS.state.phase === "playing" && cS.state.curtain, 30000, "2. hra - opona");
  check(J(cS.state.curtain) === J({ white: "choosing", black: "choosing" }) && cS.arenaRolls.length === 1,
    "S2: pred 2. hrou opona znova (bez nového losovania arény)", J({ curtain: cS.state.curtain, rolls: cS.arenaRolls.length }));
  c1.sock.emit("choose_character", "lightning");
  c2.sock.emit("choose_character", "fire");
  await waitFor(() => !cS.state.curtain, 3000, "opona po výbere v hre 2");
  check(cS.state.p1.char === "lightning" && cS.state.arena === c1.state.arena, "S3: po výbere oboch (bez animácií) opona padne hneď, aréna ostáva");

  for (const c of [c1, c2, cS, late]) c.sock.close();
  serverProc.kill();
  console.log(failures === 0 ? "\nDIVÁCKA OPONA OK" : `\nZLYHANÍ: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); try { serverProc?.kill(); } catch {} process.exit(2); });
