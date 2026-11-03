// test/maintenance.mjs - MAINTENANCE BREAK (reálny server): štart v údržbe (MAINTENANCE=1), bežný hráč vidí len obrazovku
// údržby a nič nevytvorí, admin hrá normálne; vypnutie pustí čakajúcich do room-browsera; zapnutie = RESET ALL ROOMS
// (force_reload všetkým) a po pripojení bežný hráč opäť len údržbu.
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const port = 3987, url = `http://localhost:${port}`;
const server = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: String(port), PLAYER_KEYS: "test", ADMIN_KEY: "adm", MAINTENANCE: "1", TELEMETRY_DIR: "" }, stdio: "ignore" });
await sleep(2500);
const cl = (name, pass) => {
  const s = io(url, { transports: ["websocket"], auth: { name, pass, id: name + "-id" } });
  s.rooms = null; s.maint = 0; s.session = null; s.reload = 0; s.you = null;
  s.on("rooms", r => { s.rooms = r; }); s.on("maintenance", () => { s.maint++; }); s.on("session", x => { s.session = x; });
  s.on("force_reload", () => { s.reload++; }); s.on("you_are", y => { s.you = y; });
  return s;
};
let ok = true;
const check = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) ok = false; };
try {
  const p = cl("hrac", "test"), a = cl("admin", "adm");
  await sleep(800);
  check(p.maint === 1 && !p.rooms, "štart v údržbe: bežný hráč dostal obrazovku údržby, nie zoznam roomiek");
  check(p.session?.maintenance === undefined, "bežný hráč stav údržby v session nedostane");
  check(!!a.rooms && a.session?.admin && a.session?.maintenance === true, "admin vidí room-browser a v session maintenance=true");
  p.emit("create_room"); p.emit("join_room", { roomId: "ai" }); await sleep(500);
  check(!p.you && (a.rooms.rooms.length === 0) && a.rooms.aiRoom?.players === 0, "bežný hráč počas údržby nič nevytvorí ani sa nepripojí");
  a.emit("create_room"); await sleep(500);
  check(a.you?.isHost === true, "admin počas údržby vytvorí roomku a hrá");
  a.emit("leave_room"); await sleep(400);
  a.emit("admin_maintenance", false); await sleep(600);
  check(!!p.rooms && a.session?.maintenance === false, "vypnutie: čakajúci hráč dostal room-browser, admin session maintenance=false");
  p.emit("create_room"); await sleep(500);
  check(p.you?.isHost === true, "po vypnutí bežný hráč vytvorí roomku");
  const r0 = a.reload;
  a.emit("admin_maintenance", true); await sleep(800);
  check(p.reload === 1 && a.reload === r0 + 1, "zapnutie = RESET ALL ROOMS: force_reload hráčovi v roomke aj adminovi");
  check(a.session?.maintenance === true, "admin session maintenance=true");
  p.close(); a.close();
  const p2 = cl("hrac", "test"); await sleep(800);
  check(p2.maint === 1 && !p2.rooms && !p2.you, "po obnovení bežný hráč opäť len údržba (roomka zrušená, bez reclaimu)");
  p2.close();
} finally { server.kill(); }
console.log(ok ? "maintenance: OK" : "maintenance: ZLYHALO");
process.exit(ok ? 0 : 1);
