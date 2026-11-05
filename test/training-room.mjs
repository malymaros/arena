// test/training-room.mjs - TRAINING GROUNDS cez reálny server (shared/training.js): stála miestnosť v zozname
// (rooms snapshot `trainingRoom`, 0/1), hráč vstúpi so scenárom (sedí ako A = biely, bot Baby = B), snapshot nesie
// training (scenár + odhalená fronta bota), bot zamyká až po hráčovi, výsledok training_result: predpísané riešenie =
// win, iné víťazné = creative, prehra = fail (aj keď obaja prežijú posledné kolo); TRY AGAIN / NEXT = training_play;
// druhý človek môže len sledovať; game_result / game_over sa v tréningu neposielajú; po odchode je miestnosť čistá.
import { spawn } from "child_process";
import { io } from "socket.io-client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 3992;
const URL = `http://localhost:${PORT}`;
let server = null, fails = 0, serverErr = "";
const fail = (m) => { fails++; console.log("  FAIL " + m); };
const pass = (m) => console.log("  PASS " + m);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return true; await wait(25); }
  fail("timeout: " + what);
  return false;
}
const mv = (type, dir) => (dir ? { type, dir } : { type });

// záznamy zápasov zapnuté - tréning sa do nich (ANALYZE MATCHES) zapisovať NESMIE
const MDIR = fs.mkdtempSync(path.join(os.tmpdir(), "training-matches-"));
try {
  server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(PORT), PLAYER_KEYS: "testpass", ADMIN_KEY: "testadmin", ARENA_SEED: "3", TELEMETRY_DIR: "", MATCHES_DIR: MDIR },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", d => { serverErr += d; });
  await wait(1200);

  const sock = io(URL, { transports: ["websocket"], auth: { name: "tester", pass: "testpass" } });
  const c = { rooms: null, slot: null, state: null, results: [], starts: [], gameEvents: 0, oppReadyFirst: false };
  sock.on("rooms", (r) => { c.rooms = r; });
  sock.on("you_are", (s) => { c.slot = s.slot; });
  sock.on("state", (s) => {
    c.state = s;
    if (s.phase === "playing" && s.p2?.locked && !s.p1?.locked && !s.timeline) c.oppReadyFirst = true;
  });
  sock.on("training_start", (r) => c.starts.push(r));
  sock.on("training_result", (r) => c.results.push(r));
  sock.on("game_result", () => c.gameEvents++);
  sock.on("game_over", () => c.gameEvents++);
  sock.on("match_record", () => c.gameEvents++);
  if (!await until(() => c.rooms, 20000, "zoznam roomiek")) throw new Error("server nenaštartoval");

  const t0 = c.rooms.trainingRoom;
  if (t0 && t0.players === 0 && t0.canJoin && t0.training && !c.rooms.rooms.some(r => r.training)) pass("stála TRAINING GROUNDS miestnosť v zozname: 0/1, mimo bežných roomiek");
  else fail(`zoznam roomiek: ${JSON.stringify(c.rooms)}`);

  // scenár 2 - predpísané riešenie
  sock.emit("join_room", { roomId: t0?.id, scenario: 2 });
  await until(() => c.state?.training?.n === 2 && c.starts.length === 1, 5000, "štart scenára 2");
  const s = c.state;
  if (c.slot === "p1" && s.p1.char === "fire" && s.p2.char === "fire" && s.p1.hp === 1 && s.p1.mana === 10 && s.p2.hp === 6 && s.p2.mana === 6
    && s.p1.x === 0 && s.p1.y === 1 && s.p2.x === 3 && s.p2.y === 1 && s.starter === "p1" && s.vsAi === "p2" && s.aiLevel === "baby" && s.names?.p2 === "BABY")
    pass("scenár 2: Fire vs Fire, HP / mana / pozície / štartér zo scenára, bot = Baby na p2");
  else fail(`scenár 2 stav: ${JSON.stringify({ slot: c.slot, p1: s.p1, p2: s.p2, starter: s.starter, vsAi: s.vsAi, aiLevel: s.aiLevel, names: s.names })}`);
  if (JSON.stringify(s.training?.bot) === JSON.stringify([mv("attack", "left"), mv("special"), mv("recharge")])) pass("snapshot nesie odhalenú frontu bota");
  else fail(`training.bot: ${JSON.stringify(s.training)}`);

  // druhý človek: len sledovať
  const sock2 = io(URL, { transports: ["websocket"], auth: { name: "watcher", pass: "testpass" } });
  const c2 = { rooms: null, denied: null, spectator: null, results: [] };
  sock2.on("rooms", (r) => { c2.rooms = r; });
  sock2.on("join_denied", (r) => { c2.denied = r; });
  sock2.on("spectator", (r) => { c2.spectator = r; });
  sock2.on("training_result", (r) => c2.results.push(r));
  await until(() => c2.rooms?.trainingRoom?.canJoin === false, 5000, "obsadená miestnosť");
  sock2.emit("join_room", { roomId: t0?.id, scenario: 1 });
  await until(() => c2.denied, 3000, "druhý hráč odmietnutý");
  sock2.emit("spectate_room", { roomId: t0?.id });
  if (await until(() => c2.spectator, 3000, "divák")) pass("obsadená TRAINING GROUNDS: vstup odmietnutý, sledovať sa dá");

  sock.emit("lock_in", [mv("shield"), mv("mirror"), mv("attack", "right")], 1);
  if (await until(() => c.results.length === 1, 5000, "výsledok scenára 2") && c.results[0].result === "win" && c.results[0].n === 2) pass("predpísané riešenie → win");
  else fail(`výsledok: ${JSON.stringify(c.results)}`);
  await until(() => c2.results.length === 1, 2000, "divák dostal výsledok");
  if (!c.oppReadyFirst) pass("bot nezamkol skôr ako hráč"); else fail("bot zamkol pred hráčom");

  // TRY AGAIN so zlým poradím → fail
  sock.emit("training_play", 2);
  await until(() => c.starts.length === 2 && c.state?.p1?.hp === 1 && c.state?.phase === "playing", 5000, "reštart scenára 2");
  sock.emit("lock_in", [mv("mirror"), mv("shield"), mv("attack", "right")], 1);
  if (await until(() => c.results.length === 2, 5000, "výsledok 2") && c.results[1].result === "fail") pass("obaja prežili posledné kolo → fail");
  else fail(`výsledok: ${JSON.stringify(c.results)}`);
  // po výsledku sa ďalší lock ignoruje
  sock.emit("lock_in", [mv("recharge"), mv("shield"), mv("move", "up")], 2);
  await wait(300);
  if (c.results.length === 2 && c.state?.turn === 2) pass("po konci scenára sa ďalšie kolo nehrá"); else fail(`po konci: ${JSON.stringify({ r: c.results, turn: c.state?.turn, locked: c.state?.p1?.locked })}`);

  // scenár 6 - kreatívne riešenie (IK s buffom + special), cez 2 kolá a Last Stand
  sock.emit("training_play", 6);
  await until(() => c.starts.length === 3 && c.state?.training?.n === 6, 5000, "štart scenára 6");
  if (c.state?.pending?.spawns?.[0]?.type === "mana") pass("scenár 6: náhľad dlaždíc na koniec kola zo scenára"); else fail(`pending: ${JSON.stringify(c.state?.pending)}`);
  sock.emit("lock_in", [mv("dash", "up"), mv("shield"), mv("recharge"), mv("last_stand")], 1);
  await until(() => c.state?.turn === 2 && c.state?.p1?.lastStandBuff, 8000, "2. kolo s Last Stand");
  if (JSON.stringify(c.state?.training?.bot?.[0]) === JSON.stringify(mv("golden_shield"))) pass("2. kolo: odhalená fronta bota s golden shieldom");
  else fail(`2. kolo bot: ${JSON.stringify(c.state?.training)}`);
  sock.emit("lock_in", [mv("move", "down"), mv("special"), mv("recharge")], 2);
  if (await until(() => c.results.length === 3, 8000, "výsledok scenára 6") && c.results[2].result === "creative") pass("iné víťazné riešenie → creative");
  else fail(`výsledok: ${JSON.stringify(c.results)}`);
  if (c.gameEvents === 0) pass("game_result / game_over / match_record sa v tréningu neposielajú"); else fail(`game eventy: ${c.gameEvents}`);
  // ANALYZE MATCHES: zoznam záznamov je po troch dohraných scenároch prázdny
  const rows = await new Promise(r => sock.emit("matches_list", {}, (a) => r(a?.rows)));
  if (Array.isArray(rows) && rows.length === 0) pass("tréning sa nezapisuje do ANALYZE MATCHES"); else fail(`matches_list: ${JSON.stringify(rows)}`);

  // odchod → miestnosť čistá (divák späť v room browseri)
  sock.emit("leave_room");
  if (await until(() => c.rooms?.trainingRoom?.players === 0 && c.rooms?.trainingRoom?.canJoin, 5000, "miestnosť po odchode")) pass("po odchode hráča je TRAINING GROUNDS znova voľná");
  sock.close(); sock2.close();
} catch (e) {
  fail(e.stack || String(e));
} finally {
  server?.kill();
  setTimeout(() => { try { fs.rmSync(MDIR, { recursive: true, force: true }); } catch {} }, 500);
}
if (serverErr.trim()) { console.log(serverErr); }
if (fails) { console.log(`training-room: ${fails} FAIL`); process.exit(1); }
console.log("training-room: OK");
