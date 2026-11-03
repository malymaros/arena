// test/ai-room.mjs - stála AI roomka cez reálny server (docs/AI_PLAN.md): v zozname je vždy (rooms snapshot
// `aiRoom`, 0/1), hráč sa do nej pripojí ako host (bot sedí ako osoba B), druhý človek ju môže len sledovať,
// lobby povolí všetky arény + single/bo3 (turnaj nie), hráč s botom odohrá celý zápas a po jeho odchode je roomka
// znova čistá 0/1. Malý rozpočet bota (AI_SIMS).
import { spawn } from "child_process";
import { io } from "socket.io-client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

const TDIR = fs.mkdtempSync(path.join(os.tmpdir(), "ai-room-"));
try {
  server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(PORT), FORCE_FIRST_STARTER: "A", PLAYER_KEYS: "testpass", ADMIN_KEY: "testadmin", ARENA_SEED: "3", AI_SIMS: "400", TELEMETRY_DIR: TDIR },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", d => { serverErr += d; });
  await wait(1200);

  const sock = io(URL, { transports: ["websocket"], auth: { name: "tester", pass: "testpass" } });
  const c = { rooms: null, slot: null, state: null, result: null, over: null, timelines: 0 };
  sock.on("rooms", (r) => { c.rooms = r; });
  sock.on("you_are", (s) => { c.slot = s.slot; });
  sock.on("state", (s) => {
    c.state = s; if (s.timeline) c.timelines++;
    // bot nesmie zamknúť skôr ako hráč (hráč nikdy nevidí „OPPONENT IS READY")
    const opp = c.slot === "p1" ? "p2" : "p1";
    if (s.phase === "playing" && c.slot && s[opp]?.locked && !s[c.slot]?.locked && !s.timeline) c.oppReadyFirst = true;
  });
  sock.on("game_result", (r) => { c.result = r; });
  sock.on("game_over", (r) => { c.over = r; });
  if (!await until(() => c.rooms, 20000, "zoznam roomiek")) throw new Error("server nenaštartoval");

  const ai0 = c.rooms.aiRoom;
  if (ai0 && ai0.players === 0 && ai0.max === 1 && ai0.canJoin && c.rooms.rooms.length === 0) pass("stála AI roomka v zozname: 0/1, bežné roomky prázdne");
  else fail(`zoznam roomiek: ${JSON.stringify(c.rooms)}`);
  sock.emit("join_room", { roomId: ai0?.id });
  await until(() => c.state?.phase === "lobby", 10000, "lobby AI roomky");
  // druhý človek: AI roomka je obsadená (1/1) - pripojiť sa nedá, sledovať áno
  const sock2 = io(URL, { transports: ["websocket"], auth: { name: "watcher", pass: "testpass" } });
  const c2 = { rooms: null, denied: null, spectator: null };
  sock2.on("rooms", (r) => { c2.rooms = r; });
  sock2.on("join_denied", (r) => { c2.denied = r; });
  sock2.on("spectator", (r) => { c2.spectator = r; });
  await until(() => c2.rooms?.aiRoom?.players === 1, 5000, "AI roomka obsadená 1/1");
  if (c2.rooms?.aiRoom?.canJoin === false) pass("obsadená AI roomka: canJoin=false");
  sock2.emit("join_room", { roomId: ai0?.id });
  await until(() => c2.denied, 3000, "druhý hráč odmietnutý");
  if (c2.denied) pass("druhý človek sa do AI roomky nepripojí");
  sock2.emit("spectate_room", { roomId: ai0?.id });
  if (await until(() => c2.spectator, 3000, "divák AI roomky")) pass("AI roomku sa dá sledovať");
  if (c.state?.vsAi === (c.slot === "p1" ? "p2" : "p1")) pass("snapshot nesie vsAi = slot bota"); else fail(`snapshot vsAi: ${c.state?.vsAi}`);

  // portal realm + turnaj → server vynúti single, aréna ostane (bot hrá všetky arény, turnaj zatiaľ nie)
  sock.emit("configure_match", { format: "tournament", arena: "portal", tilesPerRound: 1, timer: "off", tilePreview: true, colorPref: "white",
    tileWeights: { dmg: 100, heal: 0, mana: 0, ik: 0, power: 0, block: 0 }, portalWeights: { classic: 100, hp: 0, mana: 0, power: 0, nodef: 0 } });
  await until(() => c.state?.phase === "playing", 10000, "štart zápasu");
  if (c.state?.config?.format === "single" && c.state?.config?.arena === "portal") pass("AI roomka: vynútený single, Portal Realm ostal");
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
  while (!c.result && round < 80) {
    const turn = c.state.turn;
    const me = c.state[c.slot];
    const stone = Math.min(3, me?.stone || 0);
    const q = QUEUES[round % QUEUES.length].map((a, i) => (i < stone ? { type: "stoned" } : a));
    const before = c.timelines;
    // kolá 2-4: hráč chvíľu „plánuje" - bot musí rozhodnúť už počas toho (nie až po hráčovom locku)
    if (round >= 1 && round <= 3) await wait(1500);
    sock.emit("lock_in", q, turn, () => {});
    round++;
    if (!await until(() => c.timelines > before || c.result, 15000, `kolo ${round} sa vyhodnotilo`)) break;
    await wait(50);
  }
  if (c.result) pass(`zápas proti botovi dohraný za ${round} kôl (víťaz ${c.result.gameWinner})`);
  if (c.over) pass("game_over prišiel"); else fail("chýba game_over");
  if (c.oppReadyFirst) fail("bot zamkol skôr ako hráč (OPPONENT IS READY)"); else pass("bot nikdy nezamkol skôr ako hráč");
  // telemetria (flush každé 2 s): rozhodnutie bota v kolách 2-4 prišlo PRED hráčovým lockom
  await wait(2600);
  const recs = fs.readdirSync(TDIR).filter(f => f.endsWith(".jsonl")).flatMap(f => fs.readFileSync(path.join(TDIR, f), "utf8").split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)));
  const ms = recs.find(r => r.t === "match_start"), botSide = recs.find(r => r.t === "ai")?.side;
  // len kolá 2-4, ktoré sa naozaj odohrali (bot s náhodným seedom občas vyhrá už v 2. kole)
  const early = [2, 3, 4].filter(t => t <= round).map(t => {
    const lk = recs.find(r => r.t === "lock" && r.turn === t && r.side !== botSide), b = recs.find(r => r.t === "bot" && r.turn === t);
    return lk && b && ms ? Date.parse(b.ts) < Date.parse(ms.ts) + lk.at : null;
  });
  if (early.length && early.every(e => e === true)) pass("bot rozmýšľa od začiatku kola (rozhodnutie pred hráčovým lockom)");
  else fail("bot rozhodol až po hráčovom locku / chýba záznam: " + JSON.stringify(early));
  if (/\[ai\]/.test(serverErr)) fail("server hlási chybu bota: " + serverErr.split("\n").find(l => l.includes("[ai]")));
  else pass("bez chýb bota na serveri");
  // odchod hráča → AI roomka sa hneď vytvorí znova čistá (0/1, lobby)
  c.rooms = null;
  sock.emit("leave_room");
  if (await until(() => c.rooms?.aiRoom?.players === 0 && c.rooms.aiRoom.canJoin && c.rooms.aiRoom.phase === "lobby", 5000, "AI roomka po odchode hráča znova 0/1"))
    pass("AI roomka po odchode hráča znova čistá 0/1");
  // obťažnosť: bez level = normal (meno AI); join_room { level: "baby" } → snapshot aiLevel, meno BABY v HUD,
  // room browser ukáže hlavu Baby bota (aiRoom.level); po odchode je nová roomka znova normal
  const botOf = (s) => s?.names?.[c.slot === "p1" ? "p2" : "p1"];
  if (ms && recs.find(r => r.t === "ai")?.level === "normal") pass("telemetria: zápas proti NORMAL botovi (ai.level)"); else fail("telemetria ai.level chýba");
  c.state = null;
  sock.emit("join_room", { roomId: c.rooms.aiRoom.id, level: "baby" });
  await until(() => c.state?.phase === "lobby", 5000, "lobby AI roomky (baby)");
  if (c.state?.aiLevel === "baby" && botOf(c.state) === "BABY") pass("BABY: snapshot aiLevel=baby, bot sa v HUD volá BABY");
  else fail(`BABY snapshot: aiLevel=${c.state?.aiLevel} meno=${botOf(c.state)}`);
  const sw = io(URL, { transports: ["websocket"], auth: { name: "browse", pass: "testpass" } });
  const cw = { rooms: null };
  sw.on("rooms", (r) => { cw.rooms = r; });
  if (await until(() => cw.rooms, 5000, "zoznam roomiek (baby)") && cw.rooms.aiRoom?.level === "baby" && !cw.rooms.aiRoom.canJoin)
    pass("room browser: obsadená AI roomka nesie level=baby (hlava Baby bota)");
  else fail(`aiRoom: ${JSON.stringify(cw.rooms?.aiRoom)}`);
  sw.close();
  c.rooms = null;
  sock.emit("leave_room");
  await until(() => c.rooms?.aiRoom?.players === 0, 5000, "AI roomka po odchode (baby)");
  c.state = null;
  sock.emit("join_room", { roomId: c.rooms.aiRoom.id });
  await until(() => c.state?.phase === "lobby", 5000, "lobby AI roomky (normal)");
  if (c.state?.aiLevel === "normal" && botOf(c.state) === "AI") pass("po odchode z BABY je nová AI roomka NORMAL (meno AI)");
  else fail(`NORMAL snapshot: aiLevel=${c.state?.aiLevel} meno=${botOf(c.state)}`);
  c.rooms = null;
  sock.emit("leave_room");
  await until(() => c.rooms?.aiRoom?.players === 0, 5000, "AI roomka po odchode (normal)");
  // CHEATER (docs/AI_PLAN.md 8c): meno CHEATER, bot zamyká až po hráčovi a jeho rozhodnutie nesie odhalenú akciu
  // (telemetria bot.spy = slot + akcia z hráčovej fronty)
  c.state = null; c.result = null; c.over = null; c.oppReadyFirst = false;
  sock.emit("join_room", { roomId: c.rooms.aiRoom.id, level: "cheater" });
  await until(() => c.state?.phase === "lobby", 5000, "lobby AI roomky (cheater)");
  if (c.state?.aiLevel === "cheater" && botOf(c.state) === "CHEATER") pass("CHEATER: snapshot aiLevel=cheater, bot sa v HUD volá CHEATER");
  else fail(`CHEATER snapshot: aiLevel=${c.state?.aiLevel} meno=${botOf(c.state)}`);
  sock.emit("configure_match", { format: "single", tilesPerRound: 1, timer: "off", tilePreview: true, colorPref: "white",
    tileWeights: { dmg: 100, heal: 0, mana: 0, ik: 0, power: 0, block: 0 } });
  await until(() => c.state?.phase === "playing", 10000, "štart zápasu (cheater)");
  sock.emit("choose_character", "fire");
  await until(() => c.state?.p1?.char && c.state?.p2?.char, 15000, "cheater si vybral postavu");
  const cheatQ = [];
  for (let r = 0; r < 3 && !c.result; r++) {
    const turn = c.state.turn, stone = Math.min(3, c.state[c.slot]?.stone || 0);
    const q = QUEUES[r % QUEUES.length].map((a, i) => (i < stone ? { type: "stoned" } : a));
    cheatQ.push({ turn, q });
    const before = c.timelines;
    sock.emit("lock_in", q, turn, () => {});
    if (!await until(() => c.timelines > before || c.result, 15000, `kolo ${r + 1} proti CHEATEROVI`)) break;
    await wait(50);
  }
  if (c.oppReadyFirst) fail("CHEATER zamkol skôr ako hráč"); else pass("CHEATER zamyká až po hráčovi");
  await wait(2600);
  const recs2 = fs.readdirSync(TDIR).filter(f => f.endsWith(".jsonl")).flatMap(f => fs.readFileSync(path.join(TDIR, f), "utf8").split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)));
  const key = (a) => a.type + (a.dir ? ":" + a.dir : "") + (a.cell ? `@${a.cell.x},${a.cell.y}` : "");
  const lastMatch = [...recs2].reverse().find(r => r.t === "match_start")?.m;
  const spies = recs2.filter(r => r.t === "bot" && r.spy && r.match === lastMatch);
  const okSpy = spies.length > 0 && spies.every(b => { const q = cheatQ.find(x => x.turn === b.turn)?.q; return q && key(q[b.spy.slot - 1]) === b.spy.a; });
  if (okSpy) pass(`CHEATER videl v každom kole jednu akciu hráča (${spies.map(b => `${b.turn}: ${b.spy.slot}. ${b.spy.a}`).join(", ")})`);
  else fail("CHEATER spy v telemetrii: " + JSON.stringify(spies.map(b => ({ turn: b.turn, spy: b.spy }))));
  c.rooms = null;
  sock.emit("leave_room");
  await until(() => c.rooms?.aiRoom?.players === 0, 5000, "AI roomka po odchode (cheater)");
  // admin: reset AI roomky (ako hocijakej inej) → zanikne a hneď je znova čistá 0/1; globálny reset ju tiež nechá
  const adm = io(URL, { transports: ["websocket"], auth: { name: "admin", pass: "testadmin" } });
  const ca = { rooms: null, reload: false };
  adm.on("rooms", (r) => { ca.rooms = r; });
  adm.on("force_reload", () => { ca.reload = true; });
  await until(() => ca.rooms?.aiRoom, 5000, "admin vidí AI roomku");
  const aiId = ca.rooms.aiRoom.id;
  adm.emit("join_room", { roomId: aiId });
  await wait(400);
  c2.rooms = null;
  adm.emit("admin_reset_room");
  if (await until(() => ca.reload, 3000, "admin reset AI roomky (force_reload)")) pass("admin resetol AI roomku (force_reload)");
  if (await until(() => c2.rooms?.aiRoom?.players === 0 && c2.rooms.aiRoom.canJoin, 5000, "AI roomka po admin resete znova 0/1")) pass("AI roomka po admin resete znova čistá 0/1");
  adm.close();
  const adm2 = io(URL, { transports: ["websocket"], auth: { name: "admin", pass: "testadmin" } });
  const cb = { rooms: null };
  adm2.on("rooms", (r) => { cb.rooms = r; });
  await until(() => cb.rooms, 5000, "admin2 zoznam");
  adm2.emit("admin_reset_all");
  await wait(600);
  const sock3 = io(URL, { transports: ["websocket"], auth: { name: "after", pass: "testpass" } });
  const c3 = { rooms: null };
  sock3.on("rooms", (r) => { c3.rooms = r; });
  if (await until(() => c3.rooms?.aiRoom?.players === 0, 5000, "AI roomka po globálnom resete")) pass("globálny admin reset nechal stálu AI roomku (0/1)");
  adm2.close(); sock3.close();
  sock.close(); sock2.close();
} catch (e) {
  fail(e.stack || String(e));
} finally {
  server?.kill();
  try { fs.rmSync(TDIR, { recursive: true, force: true }); } catch { /* */ }
}
console.log(fails ? `ai-room: ${fails} CHÝB` : "ai-room: OK");
process.exit(fails ? 1 : 0);
