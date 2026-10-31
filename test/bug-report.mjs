// test/bug-report.mjs - bug report z menu ☰ (socket `bug_report`): server na :3993 s TELEMETRY_DIR v dočasnom
// adresári; hráč v roomke pošle hlásenie → záznam t:"bug" v dennom JSONL (zariadenie, roomka, bez mena hráča),
// prázdny text a druhé hlásenie hneď za prvým server odmietne.
// Spustenie: node test/bug-report.mjs  (súčasť npm test)
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { io } from "socket.io-client";

const PORT = 3993, URL = `http://localhost:${PORT}`;
let failures = 0;
function check(cond, label, detail = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-bugs-"));
const srv = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: String(PORT), PLAYER_KEYS: "testpass", TELEMETRY_DIR: dir, ARENA_SEED: "1" }, stdio: "ignore",
});
try {
  await wait(1200);
  const sock = io(URL, { transports: ["websocket"], auth: { name: "bugger", pass: "testpass" } });
  await new Promise((res, rej) => { sock.on("connect", res); setTimeout(() => rej(new Error("connect timeout")), 10000); });
  sock.emit("create_room");
  await wait(400);
  const send = (payload) => new Promise(res => sock.timeout(5000).emit("bug_report", payload, (err, r) => res(err ? { error: "timeout" } : r)));
  const client = { device: { kind: "mobile", os: "Android", browser: "Chrome", app: true, screen: "412×915", orient: "landscape", graphics: "lite" },
    ua: "test-ua", screenName: "lobby", errors: ["x @ a.js:1"] };

  check((await send({ text: "   ", client })).error === "empty", "B1: prázdny text sa odmietne");
  check((await send({ text: "Shrek ostal visieť", client })).ok === true, "B2: hlásenie sa prijme");
  check((await send({ text: "druhé hneď", client })).error === "wait", "B3: druhé hlásenie hneď za prvým sa odmietne (wait)");

  await wait(2600); // store zapisuje v dávkach každé 2 s
  const lines = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl")).flatMap(f => fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean)).map(l => JSON.parse(l));
  const bugs = lines.filter(r => r.t === "bug");
  const b = bugs[0];
  check(bugs.length === 1, "B4: v dátach je práve jedno hlásenie", String(bugs.length));
  check(b?.text === "Shrek ostal visieť" && b.device.kind === "mobile" && b.device.os === "Android" && b.device.app === true,
    "B5: text a zariadenie (MOBILE, Android, appka)", JSON.stringify(b?.device));
  check(b?.room != null && b.screenName === "lobby" && b.errors.length === 1 && b.ts, "B6: roomka, obrazovka, JS chyby, čas", JSON.stringify(b));
  check(!JSON.stringify(b).includes("bugger") && !("m" in (b || {})), "B7: bez mena hráča a bez poľa m (replay hlásenie ignoruje)");
  sock.close();
} finally {
  srv.kill();
  await wait(200);
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} FAIL` : "\nBUG REPORT TESTY PREŠLI");
process.exit(failures ? 1 : 0);
