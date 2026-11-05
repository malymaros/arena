// test/beginner.mjs - BEGINNER mód cez reálny server (shared/beginner.js): roomky oddelené podľa módu (vstup aj TAKE SEAT;
// sledovať smie každý), config beginner roomky = Stone Bridge s predvolenými pravidlami + zakázané všetko okrem Fire /
// Lightning / Wanderer (nech klient pošle čokoľvek), turnaj povolený, zakázanú postavu si vybrať nedá; AI roomka preberá
// mód od hráča; bežná roomka beginner kľúč nemá (goldeny).
import { spawn } from "child_process";
import { io } from "socket.io-client";

const PORT = 3991;
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
function client(name) {
  const s = io(URL, { transports: ["websocket"], auth: { name, pass: "testpass" } });
  const c = { s, rooms: null, state: null, denied: null, spectator: null, spect: null, slot: null };
  s.on("rooms", (r) => { c.rooms = r; });
  s.on("state", (st) => { c.state = st; });
  s.on("you_are", (y) => { c.slot = y.slot; });
  s.on("join_denied", (r) => { c.denied = r; });
  s.on("spectator", (r) => { c.spectator = r; });
  s.on("spectators", (r) => { c.spect = r; });
  return c;
}
const MAGES = ["fire", "lightning", "wanderer"];

try {
  server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(PORT), PLAYER_KEYS: "testpass", ARENA_SEED: "1", FORCE_FIRST_STARTER: "A", TELEMETRY_DIR: "", AI_SIMS: "200" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", d => { serverErr += d; });
  await wait(1200);

  const a = client("begina"), b = client("normalb"), c = client("beginc"), d = client("watchd");
  if (!await until(() => a.rooms && b.rooms && c.rooms && d.rooms, 20000, "room browser")) throw new Error("server nenaštartoval");

  // beginner A vytvorí roomku
  a.s.emit("create_room", { slot: 1, beginner: true });
  await until(() => b.rooms?.rooms?.[0]?.players === 1, 5000, "roomka v zozname");
  const row = b.rooms.rooms[0];
  if (row.beginner === true) pass("roomka beginnera má v zozname beginner: true"); else fail(`riadok: ${JSON.stringify(row)}`);

  // bežný hráč B sa nepripojí, beginner C áno
  b.s.emit("join_room", { roomId: row.id });
  await until(() => b.denied, 3000, "B odmietnutý");
  if (b.denied === "mode") pass("hráč bez beginner módu sa do beginner roomky nepripojí"); else fail(`B denied: ${b.denied}`);
  // divák D (bez módu) sledovať smie, TAKE SEAT nevidí
  d.s.emit("spectate_room", { roomId: row.id });
  if (await until(() => d.spectator, 3000, "D sleduje")) pass("roomku iného módu sa dá sledovať");
  await until(() => d.spect, 3000, "spectators pre D");
  if (d.spect?.seatFree === false) pass("divák iného módu nevidí TAKE SEAT"); else fail(`spectators D: ${JSON.stringify(d.spect)}`);
  d.denied = null;
  d.s.emit("take_seat", {});
  await until(() => d.denied, 3000, "TAKE SEAT odmietnutý");
  if (d.denied === "mode") pass("TAKE SEAT v roomke iného módu server odmietne"); else fail(`D take_seat: ${d.denied}`);

  c.s.emit("join_room", { roomId: row.id, beginner: true });
  await until(() => c.slot, 5000, "C sedí");
  if (c.slot && !c.denied) pass("beginner sa do beginner roomky pripojí"); else fail(`C: ${c.denied}`);

  // host pošle portal realm + turnaj bez zákazov → server vynúti bridge, predvolené pravidlá a zákazy; turnaj ostane
  a.s.emit("configure_match", { format: "tournament", arena: "portal", tilesPerRound: 3, timer: "off", colorPref: "white",
    tileWeights: { dmg: 100, heal: 0, mana: 0, ik: 0, power: 0, block: 0 }, portalWeights: { classic: 100, hp: 0, mana: 0, power: 0, nodef: 0 } });
  await until(() => a.state?.config, 5000, "config");
  const cfg = a.state.config;
  const freeP1 = ["fire", "lightning", "wanderer", "medusa", "minotaur", "naruto", "escanor", "soldier", "werewolf", "countess", "luffy"].filter(k => !cfg.bans?.p1?.includes(k));
  if (cfg.beginner === true && !cfg.arena && cfg.format === "tournament" && cfg.tilesPerRound === 1 && cfg.tileWeights.dmg === 75
    && JSON.stringify(freeP1.sort()) === JSON.stringify([...MAGES].sort())) pass("config beginnera: Stone Bridge, predvolené pravidlá, len traja mágovia, turnaj");
  else fail(`config: ${JSON.stringify(cfg)}`);
  // turnaj: draft len z troch mágov
  a.s.emit("choose_team", ["fire", "lightning", "medusa"]);
  await wait(300);
  if (!a.state?.rosterReady?.A && !a.state?.roster?.[a.slot]) pass("tím so zakázanou postavou server neprijme");
  a.s.emit("choose_team", MAGES);
  c.s.emit("choose_team", MAGES);
  if (await until(() => a.state?.phase === "playing", 5000, "turnaj začal")) pass("tím z troch mágov sa dá vyskladať (draft)");

  // bežná roomka: beginner sa nepripojí, bežný áno; config bez kľúča beginner
  b.s.emit("create_room", { slot: 2 });
  await wait(400);
  const e = client("begine"), f = client("normalf");
  await until(() => e.rooms && f.rooms, 5000, "E/F room browser");
  const row2 = e.rooms.rooms.find(r => r.slot === 2);
  if (row2 && !row2.beginner) pass("bežná roomka nemá beginner"); else fail(`riadok 2: ${JSON.stringify(row2)}`);
  e.s.emit("join_room", { roomId: row2?.id, beginner: true });
  await until(() => e.denied, 3000, "E odmietnutý");
  if (e.denied === "mode") pass("beginner sa do bežnej roomky nepripojí"); else fail(`E: ${e.denied}`);
  f.s.emit("join_room", { roomId: row2?.id });
  await until(() => f.slot, 5000, "F sedí");
  b.s.emit("configure_match", { format: "single", tilesPerRound: 1, timer: "off", colorPref: "white", beginner: true,
    tileWeights: { dmg: 100, heal: 0, mana: 0, ik: 0, power: 0, block: 0 } });
  await until(() => b.state?.config, 5000, "config 2");
  if (b.state.config && !("beginner" in b.state.config) && !b.state.config.bans) pass("bežná roomka: beginner od klienta sa ignoruje (bez zákazov)");
  else fail(`config 2: ${JSON.stringify(b.state.config)}`);

  // AI roomka: mód od hráča
  const g = client("beging");
  await until(() => g.rooms?.aiRoom?.canJoin, 5000, "AI roomka voľná");
  g.s.emit("join_room", { roomId: g.rooms.aiRoom.id, level: "baby", beginner: true });
  await until(() => g.state?.phase === "lobby", 5000, "AI lobby");
  g.s.emit("configure_match", { format: "single", arena: "swamp", tilesPerRound: 1, timer: "off", colorPref: "white",
    tileWeights: { dmg: 100, heal: 0, mana: 0, ik: 0, power: 0, block: 0 } });
  await until(() => g.state?.config, 5000, "AI config");
  if (g.state.config?.beginner === true && !g.state.config.arena) pass("AI roomka preberá beginner mód od hráča (Stone Bridge)");
  else fail(`AI config: ${JSON.stringify(g.state.config)}`);
  g.s.emit("choose_character", "medusa");
  await wait(300);
  const gp = g.state?.[g.slot]?.char;
  g.s.emit("choose_character", "wanderer");
  await until(() => g.state?.[g.slot]?.char, 3000, "postava");
  if (!gp && g.state?.[g.slot]?.char === "wanderer") pass("zakázanú postavu si vybrať nedá, mága áno");
  else fail(`výber: pred ${gp}, po ${g.state?.[g.slot]?.char}`);
  const bot = g.state?.[g.slot === "p1" ? "p2" : "p1"]?.char;
  if (await until(() => MAGES.includes(g.state?.[g.slot === "p1" ? "p2" : "p1"]?.char), 15000, "bot si vybral")) pass(`bot hrá len mága (${g.state[g.slot === "p1" ? "p2" : "p1"].char})`);
  else fail(`bot: ${bot}`);

  for (const x of [a, b, c, d, e, f, g]) x.s.close();
} catch (e) {
  fail(e.stack || String(e));
} finally {
  server?.kill();
}
if (serverErr.trim()) console.log(serverErr);
if (fails) { console.log(`beginner: ${fails} FAIL`); process.exit(1); }
console.log("beginner: OK");
