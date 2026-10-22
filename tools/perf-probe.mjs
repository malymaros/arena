// tools/perf-probe.mjs - meranie výkonu KLIENTA na emulovanom telefóne (docs/PERF_PLAN.md, etapa 0).
// Dvaja socket boti odohrajú SKRIPTOVANÝ zápas (Escanor vs Naruto) cez reálny server a headless Chrome/Edge ho
// sleduje ako divák v emulácii telefónu (844×390, dotyk, DPR 3) so spomaleným procesorom (--throttle, default 4×).
// Čas NIE je zrýchlený - meria sa skutočné prehrávanie. Meria sa po oknách:
//   idle         - plánovanie bežného kola (nič sa nehrá)
//   round        - prehrávanie bežného kola (pohyb, útoky, recharge)
//   summon       - kolo s vyvolaním démona (Last Stand: zabitie + oživenie, zlatý stav)
//   golden_idle  - plánovanie v zlatom stave (žiara, aura, démon za postavou)
//   demon        - finálne kolo: Last Hope + démonov útok + banish
// Pre každé okno: % hlavného vlákna, % GPU procesu, priemerné FPS a % snímok > 50 ms (z rAF v stránke), čas v Recalculate Style,
// Layout, Paint (+PrePaint) a Composite (z Tracingu). Beh sa opakuje (--reps, default 3), berie sa medián.
//
//   node tools/perf-probe.mjs                       → pracovný strom, tabuľka + tmp/perf/<label>.json
//   node tools/perf-probe.mjs --ref <commit>        → meria danú verziu (dočasný git worktree)
//   node tools/perf-probe.mjs --label po-etape-2    → názov výsledku (default "work" / ref)
//   node tools/perf-probe.mjs --base tmp/perf/pred.json → vypíše aj rozdiel oproti uloženému výsledku
//   node tools/perf-probe.mjs --ab <commit> --label etapa3 → striedavé behy <commit> a pracovného stromu (spoľahlivé A/B)
//   node tools/perf-probe.mjs --reps 1 --profile golden_idle → navyše vypíše najdrahšie JS funkcie a udalosti v okne
//   node tools/perf-probe.mjs --reps 1 --shots tmp/perf/shots → snímky na vizuálnu kontrolu (lite vs full: --perf)
//   --device tablet (1180×820, DPR 2) | --device 1720x920@1 (vlastné) · --throttle 6 · --reps 5 · --perf full|lite (URL ?perf=…, od etapy 1)
import { spawn, execSync } from "node:child_process";
import { io } from "socket.io-client";
import WebSocket from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const REF = opt("ref", null);
const LABEL = opt("label", REF || "work");
const REPS = Number(opt("reps", 3));
const THROTTLE = Number(opt("throttle", 4));
const DEVICE = opt("device", "phone");
const PERF = opt("perf", null);
const BASE = opt("base", null);
const SHOTS = opt("shots", null); // priečinok → snímky obrazovky (zlatý stav + priebeh finálneho kola); metriky sú potom skreslené
const PROFILE = opt("profile", null); // názov okna → CPU profil (top funkcie podľa vlastného času) + top udalosti tracu
const PASS = "perf";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// --device phone | tablet | ŠxV@DPR (napr. 1720x920@1 = bez zmenšenia stránky, viewport.js scale 1)
const customDev = /^(\d+)x(\d+)@([\d.]+)$/.exec(DEVICE);
const DEV = customDev ? { width: +customDev[1], height: +customDev[2], deviceScaleFactor: +customDev[3] }
  : DEVICE === "tablet" ? { width: 1180, height: 820, deviceScaleFactor: 2 } : { width: 844, height: 390, deviceScaleFactor: 3 };
const WINDOWS = ["idle", "round", "summon", "golden_idle", "demon"];

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const BROWSER = process.env.CHROME || BROWSERS.find(p => fs.existsSync(p));
if (!BROWSER) { console.error("Nenašiel sa Chrome/Edge (nastav CHROME=cesta)"); process.exit(2); }

// rAF záznam dĺžok snímok - zapína/vypína sa per okno
const FRAME_REC = `(() => {
  window.__fr = null;
  let last = 0;
  const loop = (t) => { if (window.__fr) { if (last) window.__fr.push(t - last); } last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();`;

/* ---------- prehliadač (CDP) ---------- */
async function launchBrowser(port) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-perf-"));
  const proc = spawn(BROWSER, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dataDir}`,
    "--no-first-run", "--no-default-browser-check", "--mute-audio", `--window-size=${DEV.width},${DEV.height}`, "about:blank"], { stdio: "ignore" });
  let list = null;
  for (let i = 0; i < 50 && !list; i++) {
    await sleep(200);
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch {}
  }
  const page = list?.find(t => t.type === "page");
  if (!page) throw new Error("prehliadač neodpovedá na CDP");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 1 << 30 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0;
  const pending = new Map(), listeners = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) listeners.forEach(l => l(m));
  });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.result?.value;
  return {
    send, evaluate, on: (f) => listeners.push(f),
    close: () => { try { ws.close(); } catch {} proc.kill(); setTimeout(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} }, 1500); },
  };
}

/* ---------- boti ---------- */
function connect(url, name) {
  return new Promise((resolve, reject) => {
    const sock = io(url, { transports: ["websocket"], auth: { name, pass: PASS } });
    const c = { sock, slot: null, st: null, timelines: [], rooms: null, result: null };
    sock.on("you_are", (s) => { c.slot = s?.slot ?? s; });
    sock.on("rooms", (r) => { c.rooms = r; });
    sock.on("game_result", (g) => { c.result = g; });
    sock.on("state", (s) => { c.st = s; if (s.timeline) c.timelines.push(s.timeline); });
    const t = setTimeout(() => reject(new Error("connect timeout")), 15000);
    sock.on("connect", () => { clearTimeout(t); setTimeout(() => resolve(c), 300); });
  });
}
function waitFor(cond, ms = 8000, label = "?") {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => { if (cond()) { clearInterval(iv); res(); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error("timeout: " + label)); } }, 25);
  });
}
const emitAck = (c, ev, ...a) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`${ev}: bez ack`)), 3000);
  c.sock.emit(ev, ...a, (r) => { clearTimeout(t); res(r); });
});
// skúsi fronty v poradí; prvá platná sa zamkne
async function lockFirst(c, queues, what) {
  for (const q of queues) {
    const r = await emitAck(c, "lock_in", q, c.st.turn);
    if (r?.ok) return q;
  }
  throw new Error(`${c.slot}: žiadna z front pre „${what}" nie je platná`);
}
const A = (type, dir) => (dir ? { type, dir } : { type });

/* ---------- trace → metriky ---------- */
function traceMetrics(events, winMs) {
  // hlavné vlákno renderera = CrRendererMain s najviac udalosťami
  const names = new Map();
  for (const e of events) if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args?.name);
  const counts = new Map();
  for (const e of events) if (e.ph === "X" && names.get(`${e.pid}:${e.tid}`) === "CrRendererMain") counts.set(`${e.pid}:${e.tid}`, (counts.get(`${e.pid}:${e.tid}`) || 0) + 1);
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const sum = { task: 0, style: 0, layout: 0, paint: 0, composite: 0, script: 0, gpu: 0 };
  // GPU proces (CrGpuMain): rasterizácia a filtre (drop-shadow, blur) - v headless softvérovo, ale úmerne záťaži
  for (const e of events) {
    if (e.ph === "X" && e.name === "RunTask" && names.get(`${e.pid}:${e.tid}`) === "CrGpuMain") sum.gpu += (e.dur || 0) / 1000;
  }
  for (const e of events) {
    if (e.ph !== "X" || `${e.pid}:${e.tid}` !== main) continue;
    const d = (e.dur || 0) / 1000;
    if (e.name === "RunTask") sum.task += d;
    else if (e.name === "UpdateLayoutTree") sum.style += d;
    else if (e.name === "Layout") sum.layout += d;
    else if (e.name === "Paint" || e.name === "PrePaint") sum.paint += d;
    else if (e.name === "Layerize" || e.name === "Commit" || e.name === "CompositeLayers" || e.name === "UpdateLayer") sum.composite += d;
    else if (e.name === "FunctionCall" || e.name === "FireAnimationFrame" || e.name === "TimerFire") sum.script += d;
  }
  return {
    busy: (sum.task / winMs) * 100,
    gpu: (sum.gpu / winMs) * 100,
    styleMs: sum.style, layoutMs: sum.layout, paintMs: sum.paint, compositeMs: sum.composite, scriptMs: sum.script,
  };
}
function frameMetrics(deltas, winMs) {
  if (!deltas.length) return { fps: 0, slow: 100, p95: 0 };
  const s = [...deltas].sort((a, b) => a - b);
  return {
    fps: deltas.length / (winMs / 1000),
    slow: (deltas.filter(d => d > 50).length / deltas.length) * 100,
    p95: s[Math.floor(s.length * 0.95)] || s.at(-1),
  };
}

/* ---------- --profile: najdrahšie funkcie / udalosti ---------- */
function printProfile(prof) {
  const dt = new Map(); // id uzla → vlastný čas (ms) zo samplov
  prof.samples.forEach((id, i) => dt.set(id, (dt.get(id) || 0) + (prof.timeDeltas[i] || 0) / 1000));
  const by = new Map();
  for (const n of prof.nodes) {
    const cf = n.callFrame;
    const k = `${cf.functionName || "(anon)"} ${(cf.url || "").replace(/^https?:\/\/[^/]+/, "")}:${cf.lineNumber + 1}`;
    by.set(k, (by.get(k) || 0) + (dt.get(n.id) || 0));
  }
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  console.log(`
  CPU profil (${total.toFixed(0)} ms) - top vlastný čas:`);
  [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(`    ${v.toFixed(0).padStart(6)} ms  ${k}`));
}
function printTraceTop(events) {
  const names = new Map();
  for (const e of events) if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args?.name);
  const by = new Map();
  for (const e of events) {
    if (e.ph !== "X") continue;
    const th = names.get(`${e.pid}:${e.tid}`) || "?";
    const k = `${th} · ${e.name}`;
    by.set(k, (by.get(k) || 0) + (e.dur || 0) / 1000);
  }
  console.log("  trace - top udalosti (vrátane vnorených):");
  [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log(`    ${v.toFixed(0).padStart(6)} ms  ${k}`));
}

/* ---------- jeden beh scenára ---------- */
async function runOnce(root, rep) {
  const port = 3980 + Math.floor(Math.random() * 8);
  const url = `http://localhost:${port}`;
  const server = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(port), FORCE_FIRST_STARTER: "A", PLAYER_KEYS: PASS, ARENA_SEED: "1" }, stdio: ["ignore", "ignore", "pipe"] });
  let serverErr = "";
  server.stderr.on("data", d => { serverErr += d; });
  await sleep(1300);
  const br = await launchBrowser(9400 + Math.floor(Math.random() * 50));
  const errors = [];
  let traceEvents = null, traceDone = null;
  br.on((m) => {
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === "Tracing.dataCollected") traceEvents?.push(...m.params.value);
    else if (m.method === "Tracing.tracingComplete") traceDone?.();
  });
  const out = {};
  try {
    await br.send("Runtime.enable");
    await br.send("Page.enable");
    await br.send("Emulation.setDeviceMetricsOverride", { ...DEV, mobile: true });
    await br.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await br.send("Page.addScriptToEvaluateOnNewDocument", { source: FRAME_REC });
    const waitPage = async (expr, ms, what) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await br.evaluate(`!!(${expr})`) === true) return; await sleep(100); }
      throw new Error("timeout: " + what);
    };
    // roomku obsadia boti ešte pred prihlásením diváka - room browser ju hneď ukáže ako plnú (SPECTATE)
    const c1 = await connect(url, "alpha"), c2 = await connect(url, "beta");
    c1.sock.emit("create_room");
    await waitFor(() => (c2.rooms?.rooms || []).some(r => r.canJoin), 5000, "room");
    c2.sock.emit("join_room", { roomId: c2.rooms.rooms.find(r => r.canJoin).id });
    await waitFor(() => c1.slot && c2.slot, 5000, "seats");
    const at = url + (PERF ? `/?perf=${PERF}` : "/");
    await br.send("Page.navigate", { url: at });
    await sleep(1000);
    await br.evaluate(`try { localStorage.clear(); sessionStorage.clear(); } catch {}`);
    await br.send("Page.navigate", { url: at });
    await waitPage(`!document.getElementById("login")?.classList.contains("hidden")`, 15000, "login");
    await br.evaluate(`(() => { document.getElementById("login-name").value = "watcher"; document.getElementById("login-pass").value = "${PASS}";
      document.getElementById("login-form").requestSubmit(); })()`);
    await waitPage(`!document.getElementById("rooms")?.classList.contains("hidden")`, 15000, "room browser");
    await waitPage(`document.querySelector(".room-btn.spectate")`, 8000, "spectate");
    await br.evaluate(`document.querySelector(".room-btn.spectate").click()`);
    await sleep(800);
    c1.sock.emit("configure_match", { format: "single", tilesPerRound: 2, tileWeights: { dmg: 50, heal: 10, mana: 10, ik: 10, power: 10, block: 10 }, timer: "off", tilePreview: true });
    await waitFor(() => c1.st?.phase === "playing", 5000, "playing");
    await sleep(4000);
    // FORCE_FIRST_STARTER=A → alpha (c1) je p1 a začína
    const P1 = c1.slot === "p1" ? c1 : c2, P2 = P1 === c1 ? c2 : c1;
    P1.sock.emit("choose_character", "escanor");
    P2.sock.emit("choose_character", "naruto");
    await waitFor(() => c1.st?.p1?.char && c1.st?.p2?.char, 5000, "chars");
    await sleep(3000); // úvod (Escanor premena až pri prvom kole)
    await br.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });

    const playing = () => br.evaluate(`window.__arenaPlaying === true`);
    const measure = async (name, body) => {
      traceEvents = [];
      const done = new Promise(r => { traceDone = r; });
      await br.send("Tracing.start", { categories: "toplevel,devtools.timeline,disabled-by-default-devtools.timeline,__metadata", transferMode: "ReportEvents" });
      if (PROFILE === name) { await br.send("Profiler.enable"); await br.send("Profiler.setSamplingInterval", { interval: 200 }); await br.send("Profiler.start"); }
      await br.evaluate(`window.__fr = []`);
      const t0 = Date.now();
      await body();
      const winMs = Date.now() - t0;
      const deltas = await br.evaluate(`(() => { const f = window.__fr || []; window.__fr = null; return f; })()`);
      if (PROFILE === name) printProfile((await br.send("Profiler.stop")).result.profile);
      await br.send("Tracing.end");
      await done;
      if (PROFILE === name) printTraceTop(traceEvents);
      out[name] = { ms: winMs, ...frameMetrics(deltas, winMs), ...traceMetrics(traceEvents, winMs) };
      traceEvents = null;
    };
    const playRound = async (q1, q2, what) => {
      const n = c1.timelines.length;
      await lockFirst(P1, q1, what);
      await lockFirst(P2, q2, what);
      await waitFor(() => c1.timelines.length > n, 10000, "timeline " + what);
      await sleep(300);
      const t0 = Date.now();
      let k = 0;
      while (await playing() && Date.now() - t0 < 60000) {
        if (SHOTS && Date.now() - t0 > k * 1500) await shot(`${what.replace(/\W+/g, "_")}-${String(k++).padStart(2, "0")}`);
        await sleep(100);
      }
      await sleep(400);
    };
    const shot = async (name) => {
      if (!SHOTS) return;
      fs.mkdirSync(SHOTS, { recursive: true });
      const r = await br.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(SHOTS, `${LABEL}-${name}.png`), Buffer.from(r.result.data, "base64"));
    };

    await measure("idle", () => sleep(4000));
    // kolo 1 (štartér p1): bežné akcie
    await measure("round", () => playRound(
      [[A("move", "right"), A("attack", "right"), A("recharge")], [A("recharge"), A("move", "up"), A("attack", "right")]],
      [[A("move", "left"), A("attack", "left"), A("shield")], [A("recharge"), A("move", "down"), A("attack", "left")]], "kolo 1"));
    // kolo 2: p1 si vyvolá démona (last_stand na konci fronty)
    await measure("summon", () => playRound(
      [[A("recharge"), A("shield"), A("move", "up"), A("last_stand")], [A("recharge"), A("shield"), A("move", "down"), A("last_stand")],
       [A("recharge"), A("move", "left"), A("shield"), A("last_stand")]],
      [[A("recharge"), A("move", "down"), A("attack", "left")], [A("recharge"), A("move", "up"), A("attack", "left")]], "summon"));
    if (!c1.st.p1?.lastStandBuff) throw new Error("démon sa nevyvolal (lastStandBuff chýba)");
    await measure("golden_idle", () => sleep(4000));
    await shot("golden_idle");
    // kolo 3 (final): p2 Last Hope, p1 démonov útok
    await measure("demon", () => playRound(
      [[A("demon"), A("recharge"), A("move", "left")], [A("recharge"), A("demon"), A("move", "right")], [A("demon"), A("move", "up"), A("recharge")],
       [A("demon"), A("move", "down"), A("recharge")]],
      [[A("last_hope"), A("recharge"), A("move", "up"), A("attack", "left")], [A("last_hope"), A("recharge"), A("move", "down"), A("attack", "left")],
       [A("recharge"), A("move", "up"), A("attack", "left")]], "final"));
    c1.sock.close(); c2.sock.close();
  } catch (e) {
    errors.push("beh: " + e.message);
  } finally {
    br.close();
    server.kill();
  }
  if (serverErr.trim()) errors.push("stderr servera: " + serverErr.trim().slice(0, 300));
  console.log(`  beh ${rep + 1}/${REPS}: ${errors.length ? "CHYBY " + errors.slice(0, 3).join(" | ") : "ok"}`);
  return { windows: out, errors };
}

/* ---------- hlavný beh ---------- */
const METRICS = [["busy", "hl.vlákno %"], ["gpu", "GPU %"], ["fps", "FPS"], ["slow", "snímky>50ms %"], ["p95", "p95 snímka ms"],
  ["styleMs", "style ms"], ["layoutMs", "layout ms"], ["paintMs", "paint ms"], ["compositeMs", "composite ms"], ["scriptMs", "script ms"]];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };

// dočasný git worktree pre danú verziu (node_modules cez junction)
const worktrees = [];
function checkout(ref) {
  const dir = path.join(os.tmpdir(), `arena-perf-${Date.now()}-${worktrees.length}`);
  execSync(`git worktree add --detach "${dir}" ${ref}`, { stdio: "ignore" });
  if (!fs.existsSync(path.join(dir, "node_modules"))) fs.symlinkSync(path.resolve("node_modules"), path.join(dir, "node_modules"), "junction");
  worktrees.push(dir);
  return dir;
}
function aggregate(runs, label) {
  const good = runs.filter(r => !r.errors.length);
  const result = { label, device: DEVICE, throttle: THROTTLE, perf: PERF, reps: good.length, date: new Date().toISOString(), windows: {} };
  for (const w of WINDOWS) {
    result.windows[w] = {};
    for (const [k] of METRICS) result.windows[w][k] = median(good.map(r => r.windows[w]?.[k]).filter(v => v != null));
  }
  return result;
}
const f = (v) => (v == null || Number.isNaN(v) ? "-" : v >= 100 ? v.toFixed(0) : v.toFixed(1));
function printTable(result, base) {
  console.log(`
${"okno".padEnd(12)}` + METRICS.map(([, n]) => n.padStart(15)).join(""));
  for (const w of WINDOWS) {
    console.log(w.padEnd(12) + METRICS.map(([k]) => {
      const v = result.windows[w][k], b = base?.windows?.[w]?.[k];
      return (f(v) + (b != null ? ` (${f(b)})` : "")).padStart(15);
    }).join(""));
  }
  if (base) console.log(`(v zátvorke: ${base.label})`);
}
function save(result) {
  fs.mkdirSync("tmp/perf", { recursive: true });
  const file = path.join("tmp/perf", `${result.label.replace(/[^\w.@-]+/g, "_")}${DEVICE !== "phone" ? "-" + DEVICE.replace(/[^\w.]+/g, "_") : ""}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`uložené: ${file}`);
}

// --ab <ref>: striedavé behy verzie <ref> a pracovného stromu (A, B, A, B…) - obe verzie zažijú rovnakú záťaž
// počítača, porovnanie je preto spoľahlivejšie než dva samostatné behy po sebe
const AB = opt("ab", null);
const sides = AB ? [{ label: `${LABEL}@${AB}`, root: null, ref: AB }, { label: LABEL, root: process.cwd() }]
                 : [{ label: LABEL, root: REF ? null : process.cwd(), ref: REF }];
console.log(`perf-probe: ${sides.map(x => x.label).join(" vs ")} · ${DEVICE} ${DEV.width}×${DEV.height} · CPU ${THROTTLE}× · ${REPS} behov${PERF ? " · perf=" + PERF : ""}`);
const runs = sides.map(() => []);
try {
  for (const sd of sides) if (!sd.root) sd.root = checkout(sd.ref);
  for (let r = 0; r < REPS; r++) {
    for (let k = 0; k < sides.length; k++) {
      if (sides.length > 1) process.stdout.write(`[${sides[k].label}] `);
      runs[k].push(await runOnce(sides[k].root, r));
    }
  }
} finally {
  for (const dir of worktrees) {
    try { fs.unlinkSync(path.join(dir, "node_modules")); } catch {}
    try { execSync(`git worktree remove --force "${dir}"`, { stdio: "ignore" }); } catch {}
  }
}
const results = sides.map((sd, k) => aggregate(runs[k], sd.label));
if (results.some(r => !r.reps)) { console.log("Niektorá verzia nemá ani jeden úspešný beh."); process.exit(1); }
const base = AB ? results[0] : (BASE && fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, "utf8")) : null);
printTable(results.at(-1), base);
console.log("");
results.forEach(save);
process.exit(runs.flat().some(r => r.errors.length) ? 1 : 0);
