// test/room-slots.mjs - room browser s pevnými dlaždicami ROOM 1…N a odchod z roomky pred zápasom (reálny server):
// create_room so zvoleným slotom / bez neho, mená v zozname, ✕ LEAVE ROOM hosta (sám → roomka zanikne; keď druhý
// hráč čaká → stane sa hostom on), nový hráč sa pripojí k novému hostovi, odchod oboch zruší roomku.
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const port = 3988, url = `http://localhost:${port}`;
const server = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: String(port), PLAYER_KEYS: "test", TELEMETRY_DIR: "" }, stdio: "ignore" });
await sleep(2500);
const cl = (name) => {
  const s = io(url, { transports: ["websocket"], auth: { name, pass: "test", id: name + "-id" } });
  s.rooms = null; s.you = null; s.st = null;
  s.on("rooms", r => { s.rooms = r; }); s.on("you_are", y => { s.you = y; }); s.on("state", x => { s.st = x; });
  return s;
};
let ok = true;
const check = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) ok = false; };
try {
  const a = cl("anna"), b = cl("boris"), w = cl("watch");
  await sleep(700);
  check(w.rooms?.slots >= 2 && w.rooms.rooms.length === 0, "zoznam nesie počet dlaždíc (slots), žiadna roomka");
  a.emit("create_room", { slot: 2 }); await sleep(500);
  check(w.rooms.rooms.length === 1 && w.rooms.rooms[0].slot === 2, "host vytvoril ROOM 2 (zvolený slot)");
  a.emit("leave_room"); await sleep(500);
  check(w.rooms.rooms.length === 0, "host sám odišiel → roomka zanikla");
  a.emit("create_room"); await sleep(500);
  check(w.rooms.rooms[0]?.slot === 1, "bez slotu → najnižší voľný (ROOM 1)");
  b.emit("join_room", { roomId: w.rooms.rooms[0].id }); await sleep(500);
  check(b.you?.isHost === false && w.rooms.rooms[0].players === 2, "druhý hráč sa pripojil ako B");
  check(JSON.stringify(w.rooms.rooms[0].names) === '["anna","boris"]', "zoznam nesie mená sediacich hráčov");
  a.emit("leave_room"); await sleep(600);
  check(b.you?.isHost === true, "host odišiel z lobby → čakajúci hráč je nový host");
  check(b.st?.phase === "lobby" && w.rooms.rooms[0]?.players === 1 && w.rooms.rooms[0].slot === 1, "roomka žije v lobby, slot sa nezmenil");
  const c = cl("cyril"); await sleep(600);
  c.emit("join_room", { roomId: c.rooms.rooms[0].id }); await sleep(500);
  check(c.you?.isHost === false && w.rooms.rooms[0].players === 2, "nový hráč sa pripojí ako B k novému hostovi");
  b.emit("leave_room"); c.emit("leave_room"); await sleep(600);
  check(w.rooms.rooms.length === 0, "obaja odišli → roomka zanikla");
  [a, b, c, w].forEach(s => s.close());
} finally { server.kill(); }
console.log(ok ? "room-slots: OK" : "room-slots: ZLYHALO");
process.exit(ok ? 0 : 1);
