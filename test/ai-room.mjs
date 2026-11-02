// test/ai-room.mjs - AI roomka cez reálny server (docs/AI_PLAN.md, fáza A4): hráč vytvorí roomku proti botovi
// (create_room { ai: true }), bot sedí ako osoba B, lobby povolí len Stone Bridge + single/bo3, hráč s botom
// odohrá celý zápas (bot vyberá postavu aj fronty vo worker vlákne). Malý rozpočet bota (AI_BUDGET_MS).
import { spawn } from "child_process";
import { io } from "socket.io-client";

const PORT = 3994;
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

try {
  server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(PORT), FORCE_FIRST_STARTER: "A", PLAYER_KEYS: "testpass", ARENA_SEED: "3", AI_BUDGET_MS: "300" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", d => { serverErr += d; });
  await wait(1200);

  const sock = io(URL, { transports: ["websocket"], auth: { name: "tester", pass: "testpass" } });
  const c = { rooms: null, slot: null, state: null, result: null, over: null, timelines: 0 };
  sock.on("rooms", (r) => { c.rooms = r; });
  sock.on("you_are", (s) => { c.slot = s.slot; });
  sock.on("state", (s) => { c.state = s; if (s.timeline) c.timelines++; });
  sock.on("game_result", (r) => { c.result = r; });
  sock.on("game_over", (r) => { c.over = r; });
  if (!await until(() => c.rooms, 20000, "zoznam roomiek")) throw new Error("server nenaštartoval");

  sock.emit("create_room", { ai: true });
  await until(() => c.state?.phase === "lobby", 10000, "lobby AI roomky");
  if (c.state?.vsAi === true) pass("snapshot nesie vsAi"); else fail("snapshot bez vsAi");

  // pokus o portal realm + turnaj → server vynúti Stone Bridge + single
  sock.emit("configure_match", { format: "tournament", arena: "portal", tilesPerRound: 1, timer: "off", tilePreview: true, colorPref: "white",
    tileWeights: { dmg: 0, heal: 100, mana: 0, ik: 0, power: 0, block: 0 }, portalWeights: { classic: 100, hp: 0, mana: 0, power: 0, nodef: 0 } });
  await until(() => c.state?.phase === "playing", 10000, "štart zápasu");
  if (c.state?.config?.format === "single" && !c.state?.config?.arena) pass("AI roomka: vynútený single na Stone Bridge");
  else fail(`AI roomka config: ${JSON.stringify(c.state?.config)}`);

  sock.emit("choose_character", "fire");
  if (await until(() => c.state?.p1?.char && c.state?.p2?.char, 15000, "bot si vybral postavu")) pass(`bot si vybral postavu: ${c.state?.[c.slot === "p1" ? "p2" : "p1"]?.char}`);

  // hráč hrá jednoduché platné fronty; bot odpovedá z workera
  const QUEUES = [
    [{ type: "recharge" }, { type: "move", dir: "up" }, { type: "shield" }],
    [{ type: "attack", dir: "right" }, { type: "move", dir: "down" }, { type: "recharge" }],
    [{ type: "special" }, { type: "recharge" }, { type: "shield" }],
  ];
  let round = 0;
  while (!c.result && round < 40) {
    const turn = c.state.turn;
    const me = c.state[c.slot];
    const stone = Math.min(3, me?.stone || 0);
    const q = QUEUES[round % QUEUES.length].map((a, i) => (i < stone ? { type: "stoned" } : a));
    const before = c.timelines;
    sock.emit("lock_in", q, turn, () => {});
    round++;
    if (!await until(() => c.timelines > before || c.result, 15000, `kolo ${round} sa vyhodnotilo`)) break;
    await wait(50);
  }
  if (c.result) pass(`zápas proti botovi dohraný za ${round} kôl (víťaz ${c.result.gameWinner})`);
  if (c.over) pass("game_over prišiel"); else fail("chýba game_over");
  if (/\[ai\]/.test(serverErr)) fail("server hlási chybu bota: " + serverErr.split("\n").find(l => l.includes("[ai]")));
  else pass("bez chýb bota na serveri");
  // odchod hráča → roomka (aj s workerom bota) zanikne hneď - bot ju nedrží nažive
  c.rooms = null;
  sock.emit("leave_room");
  if (await until(() => c.rooms && c.rooms.rooms.length === 0, 5000, "AI roomka po odchode hráča zanikla")) pass("AI roomka po odchode hráča zanikla");
  sock.close();
} catch (e) {
  fail(e.stack || String(e));
} finally {
  server?.kill();
}
console.log(fails ? `ai-room: ${fails} CHÝB` : "ai-room: OK");
process.exit(fails ? 1 : 0);
