// Samostatný smoke test Escanora: pride eskalácia (+1 bez obrany, −1 s obranou) + special dmg pri pride 3.
import { spawn } from "child_process";
import { io } from "socket.io-client";
const PORT = 3999, URL = `http://localhost:${PORT}`;
let fail = 0;
const check = (c, l, d = "") => { console.log((c ? "  PASS  " : "  FAIL  ") + l + (c ? "" : " — " + d)); if (!c) fail++; };

function startServer() {
  const p = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: String(PORT), FORCE_FIRST_STARTER: "A" }, stdio: "ignore" });
  return new Promise(r => setTimeout(() => r(p), 1200));
}
function connect() {
  return new Promise((resolve) => {
    const sock = io(URL, { transports: ["websocket"] });
    const ctx = { sock, slot: null, lastState: null, lastTimeline: null };
    sock.on("you_are", s => { ctx.slot = s?.slot ?? s; });
    sock.on("state", s => { ctx.lastState = s; if (s.timeline) ctx.lastTimeline = s.timeline; });
    sock.on("connect", () => setTimeout(() => resolve(ctx), 300));
  });
}
const waitTL = ctx => new Promise((res, rej) => { const t0 = Date.now(); const iv = setInterval(() => { if (ctx.lastTimeline) { clearInterval(iv); res(ctx.lastTimeline); } else if (Date.now() - t0 > 5000) { clearInterval(iv); rej(new Error("tl timeout")); } }, 40); });
async function round(c1, c2, q1, q2) { c1.lastTimeline = c2.lastTimeline = null; c1.sock.emit("lock_in", q1); c2.sock.emit("lock_in", q2); await waitTL(c1); await new Promise(r => setTimeout(r, 120)); }

const R = { type: "recharge" }, M = d => ({ type: "move", dir: d }), D = d => ({ type: "dash", dir: d }), S = { type: "shield" };
const SP = dir => ({ type: "special", dir });

(async () => {
  const srv = await startServer();
  const c1 = await connect(), c2 = await connect();
  await new Promise(r => setTimeout(r, 200));
  c1.sock.emit("configure_match", { format: "single", tilesPerRound: 1, tileWeights: { dmg: 0, heal: 0, mana: 100, ik: 0 }, timer: "off" });
  await new Promise(r => setTimeout(r, 150));
  c1.sock.emit("choose_character", "escanor");
  c2.sock.emit("choose_character", "fire");
  await new Promise(r => setTimeout(r, 250));

  check(c1.slot === "p1", "Escanor je p1 (host A)");
  check(c1.lastState?.p1?.char === "escanor", "p1 char = escanor", JSON.stringify(c1.lastState?.p1?.char));
  check((c1.lastState?.p1?.pride ?? -1) === 0, "štart pride = 0", String(c1.lastState?.p1?.pride));

  const nd1 = [R, M("up"), D("down")], nd2 = [R, M("up"), D("down")]; // bez obrany oba
  await round(c1, c2, nd1, nd2);
  check(c1.lastState?.p1?.pride === 1, "bez obrany → pride 1", String(c1.lastState?.p1?.pride));
  await round(c1, c2, [S, R, M("up")], [R, M("up"), D("down")]); // p1 shield → -1
  check(c1.lastState?.p1?.pride === 0, "shield → pride 0", String(c1.lastState?.p1?.pride));

  // vyšplhaj na pride 3 (3 kolá bez obrany)
  for (let i = 0; i < 3; i++) await round(c1, c2, [R, M(i % 2 ? "up" : "down"), D(i % 2 ? "down" : "up")], [R, M("up"), D("down")]);
  check(c1.lastState?.p1?.pride === 3, "3× bez obrany → pride 3 (clamp)", String(c1.lastState?.p1?.pride));

  const foeHpBefore = c1.lastState?.p2?.hp;
  // pride 3 = celá plocha → fire (kdekoľvek) dostane 8; p1 má manu z recharge/mana tiles
  await round(c1, c2, [SP("right"), R, M("up")], [R, M("up"), D("down")]);
  const foeHpAfter = c1.lastState?.p2?.hp;
  check(foeHpAfter === foeHpBefore - 8, `pride 3 special dá 8 dmg (${foeHpBefore}→${foeHpAfter})`, `before ${foeHpBefore} after ${foeHpAfter}`);

  srv.kill(); c1.sock.close(); c2.sock.close();
  console.log(fail ? `\n${fail} FAIL` : "\nALL PASS");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
