// tools/browser-smoke.mjs - dymový test KLIENTA v reálnom prehliadači (Etapa 6 refaktoru, docs/REFACTOR_PLAN.md).
// Dvaja socket boti hrajú náhodné (seedované) zápasy cez reálny server a headless Chrome/Edge ich sleduje
// ako DIVÁK (prehráva timeline, animácie, efekty postáv). Navyše prejde výber postáv ako hráč (hover každej
// karty = náhľady specialov, preview karty) a jeden turnajový zápas (HUD hlavy, swap teleporty).
// Čas v stránke je zrýchlený (--speed, default 8×): setTimeout/setInterval z client.js, performance.now,
// Date.now, rAF timestamp a CSS animácie (CDP Animation.setPlaybackRate).
//
// Zbiera: JS výnimky a console.error, zlyhané/4xx požiadavky a MNOŽINU načítaných súborov z /assets
// (sprity) - pri refaktore klienta musí byť zhodná so starou verziou (--compare).
//
//   node tools/browser-smoke.mjs                      → beh nad pracovným stromom, súhrn + exit 1 pri chybách
//   node tools/browser-smoke.mjs --compare            → navyše ten istý beh nad HEAD (git archive) a diff assetov
//   node tools/browser-smoke.mjs --speed 6 --only fire  (len zápasy s danou postavou)
import { spawn, execSync } from "node:child_process";
import { io } from "socket.io-client";
import WebSocket from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const SPEED = Number(opt("speed", 8));
const ONLY = opt("only", null);
const COMPARE = args.includes("--compare");
const PASS = "smoke";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const BROWSER = process.env.CHROME || BROWSERS.find(p => fs.existsSync(p));
if (!BROWSER) { console.error("Nenašiel sa Chrome/Edge (nastav CHROME=cesta)"); process.exit(2); }

// zápasy: každá postava aspoň raz na každej strane, vrátane side-postáv
const MATCHES = [
  ["fire", "naruto"], ["lightning", "escanor"], ["wanderer", "soldier"], ["medusa", "werewolf"],
  ["minotaur", "onre"], ["naruto", "jotaro"], ["escanor", "minotaur"], ["soldier", "medusa"],
  ["werewolf", "lightning"], ["countess", "wanderer"], ["luffy", "fire"], ["countess", "jotaro"], ["luffy", "onre"],
].filter(m => !ONLY || m.includes(ONLY));
const TOURNEY = { A: ["fire", "lightning", "wanderer"], B: ["medusa", "naruto", "werewolf"] };
const MAX_ROUNDS = 8;
const CONFIG = { format: "single", tilesPerRound: 2, tileWeights: { dmg: 36, heal: 15, mana: 15, ik: 4, power: 15, block: 15 }, timer: "off", tilePreview: true };

/* ---------- prehliadač cez Chrome DevTools Protocol ---------- */
// zrýchlenie času LEN pre časovače z client.js (socket.io heartbeaty nechávame v reálnom čase)
const WARP = `(() => {
  const K = ${SPEED};
  const fromClient = () => /\\/client\\.js/.test(new Error().stack || "");
  const st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
  window.setTimeout = (f, d = 0, ...a) => st(f, fromClient() ? d / K : d, ...a);
  window.setInterval = (f, d = 0, ...a) => si(f, fromClient() ? d / K : d, ...a);
  const pn = performance.now.bind(performance), p0 = pn();
  performance.now = () => p0 + (pn() - p0) * K;
  const dn = Date.now, d0 = dn();
  Date.now = () => d0 + (dn() - d0) * K;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf(() => cb(performance.now()));
})();`;

async function launchBrowser(port) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-smoke-"));
  const proc = spawn(BROWSER, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dataDir}`,
    "--no-first-run", "--no-default-browser-check", "--mute-audio", "--window-size=1600,1000", "about:blank"], { stdio: "ignore" });
  let list = null;
  for (let i = 0; i < 50 && !list; i++) {
    await sleep(200);
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch {}
  }
  const page = list?.find(t => t.type === "page");
  if (!page) throw new Error("prehliadač neodpovedá na CDP");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
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
function seededRng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const TYPES = ["move", "dash", "recharge", "attack", "melee", "special", "shield", "mirror", "special1", "demon"];
const TS_TYPES = ["move", "dash", "recharge", "attack", "melee", "shield", "special1"];
const DIRS = ["up", "down", "left", "right", "up_left", "up_right", "down_left", "down_right"];

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
function candidate(rng, me, starter, roster) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const q = Array.from({ length: Math.min(3, me?.stone || 0) }, () => ({ type: "stoned" }));
  const pool = [...TYPES];
  while (q.length < 3) {
    if (roster && rng() < 0.12) { q.push({ type: "swap", to: pick(roster) }); continue; }
    const a = { type: pool.splice(Math.floor(rng() * pool.length), 1)[0] };
    if (rng() < 0.75) a.dir = pick(DIRS);
    if (rng() < 0.3) a.cell = { x: Math.floor(rng() * 4), y: Math.floor(rng() * 3) };
    q.push(a);
  }
  if (!starter && rng() < 0.2) q.unshift({ type: rng() < 0.5 ? "golden_shield" : "golden_mirror" });
  if (rng() < 0.12) q.push({ type: rng() < 0.85 ? "golden_mana" : "last_stand" });
  return q;
}
async function lock(c, rng, roster) {
  for (let i = 0; i < 3000; i++) {
    const st = c.st;
    const r = await emitAck(c, "lock_in", candidate(rng, st[c.slot], st.starter === c.slot, roster), st.turn);
    if (r?.ok) return;
  }
  throw new Error(c.slot + ": žiadna platná fronta");
}
async function timestop(c, rng) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  for (let i = 0; i < 3000; i++) {
    const pool = [...TS_TYPES], q = [];
    while (q.length < 3) { const a = { type: pool.splice(Math.floor(rng() * pool.length), 1)[0] }; if (rng() < 0.75) a.dir = pick(DIRS); q.push(a); }
    if ((await emitAck(c, "timestop_actions", q))?.ok) return;
  }
  throw new Error("timestop: žiadna platná fronta");
}
const tlMs = (tl) => (tl || []).reduce((s, f) => s + (f.delayMs || 0), 0);
const lastHas = (tl, k) => (tl?.[tl.length - 1]?.effects || []).some(e => e.kind === k);

// odohrá rozbehnutú hru (chars už vybrané); po každom kole počká, kým divák dohrá timeline
async function playGame(c1, c2, rngs, rosters) {
  for (let r = 0; r < MAX_ROUNDS; r++) {
    if (c1.st.phase !== "playing" || c1.result) return;
    const n = [c1.timelines.length, c2.timelines.length];
    await lock(c1, rngs.p1, rosters?.[c1.slot]);
    await lock(c2, rngs.p2, rosters?.[c2.slot]);
    await waitFor(() => c1.timelines.length > n[0] && c2.timelines.length > n[1], 10000, "timeline");
    let ms = tlMs(c1.timelines.at(-1));
    while (lastHas(c1.timelines.at(-1), "timestop_wait")) {
      await sleep(ms / SPEED + 400); // divák dohrá časť pred pauzou
      const jo = c1.st.timestop?.slot === c1.slot ? c1 : c2;
      const k = c1.timelines.length;
      await timestop(jo, jo === c1 ? rngs.p1 : rngs.p2);
      await waitFor(() => c1.timelines.length > k, 10000, "timestop pokračovanie");
      ms = tlMs(c1.timelines.at(-1));
    }
    await sleep(ms / SPEED + 600);
  }
}

/* ---------- jeden kompletný beh nad danou verziou kódu ---------- */
async function runAgainst(root, label) {
  const port = 3990 + Math.floor(Math.random() * 3);
  const url = `http://localhost:${port}`;
  const server = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(port), FORCE_FIRST_STARTER: "A", PLAYER_KEYS: PASS, ARENA_SEED: "1" }, stdio: ["ignore", "ignore", "pipe"] });
  let serverErr = "";
  server.stderr.on("data", d => { serverErr += d; });
  await sleep(1300);
  const br = await launchBrowser(9300 + Math.floor(Math.random() * 50));
  const errors = [], failed = [], assets = new Set();
  br.on((m) => {
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      errors.push(`výnimka: ${d.exception?.description || d.text} @ ${d.url || ""}:${d.lineNumber}`);
    } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push("console.error: " + m.params.args.map(a => a.value ?? a.description ?? "").join(" "));
    } else if (m.method === "Network.responseReceived") {
      const u = new URL(m.params.response.url);
      if (m.params.response.status >= 400) failed.push(`${m.params.response.status} ${u.pathname}`);
      else if (u.pathname.startsWith("/assets/")) assets.add(decodeURIComponent(u.pathname));
    } else if (m.method === "Network.loadingFailed" && !m.params.canceled) {
      failed.push(`zlyhalo: ${m.params.errorText} (${m.params.requestId})`);
    }
  });
  await br.send("Runtime.enable");
  await br.send("Network.enable");
  await br.send("Network.setCacheDisabled", { cacheDisabled: true });
  await br.send("Page.enable");
  await br.send("Animation.enable");
  await br.send("Animation.setPlaybackRate", { playbackRate: SPEED });
  await br.send("Page.addScriptToEvaluateOnNewDocument", { source: WARP });
  // nová identita (arenaId v storage by inak prevzala miesto z predošlej roomky)
  const login = async (name) => {
    await br.evaluate(`try { localStorage.clear(); sessionStorage.clear(); } catch {}`);
    await br.send("Page.navigate", { url });
    await sleep(1500);
    await br.evaluate(`(() => { document.getElementById("login-name").value = "${name}"; document.getElementById("login-pass").value = "${PASS}";
      document.getElementById("login-form").requestSubmit(); })()`);
    await sleep(800);
  };
  const log = (s) => console.log(`[${label}] ${s}`);

  try {
    // 1) výber postáv ako hráč B: hover každej karty (náhľad specialu, preview karty, Hidden stránka)
    {
      const host = await connect(url, "hostbot");
      host.sock.emit("create_room");
      await login("viewer");
      await br.evaluate(`document.querySelector(".room-btn.join")?.click()`);
      await sleep(600);
      host.sock.emit("configure_match", CONFIG);
      await sleep(1500 / SPEED + 2500); // farebné koleso
      const cards = await br.evaluate(`(async () => {
        const cards = [...document.querySelectorAll("#char-select [data-char], #char-select .char-card")];
        for (const c of cards) {
          c.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          c.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          await new Promise(r => setTimeout(r, 2500 / ${SPEED}));
          c.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
          c.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
        }
        return cards.length;
      })()`);
      log(`výber postáv: hover ${cards} kariet`);
      host.sock.close();
      await sleep(500);
    }
    // 2) zápasy so sledovaním ako divák
    const c1 = await connect(url, "alpha"), c2 = await connect(url, "beta");
    c1.sock.emit("create_room");
    // najnovšia roomka (z kroku 1 môže ešte visieť roomka výberu postáv)
    const newest = () => (c2.rooms?.rooms || []).filter(r => r.canJoin && r.phase === "lobby").sort((x, y) => y.id - x.id)[0];
    await waitFor(() => newest(), 5000, "room");
    c2.sock.emit("join_room", { roomId: newest().id });
    await waitFor(() => c1.slot && c2.slot, 5000, "seats");
    await login("watcher");
    await br.evaluate(`document.querySelector(".room-btn.spectate")?.click()`);
    await sleep(800);
    let idx = 0;
    for (const [a, b] of MATCHES) {
      c1.result = c2.result = null;
      c1.sock.emit("retry");
      await sleep(200);
      c1.sock.emit("configure_match", CONFIG);
      await waitFor(() => c1.st?.phase === "playing", 5000, `playing (fáza ${c1.st?.phase}, sloty ${c1.slot}/${c2.slot}, roomky ${JSON.stringify(c1.rooms)})`);
      await sleep(2500 / SPEED + 1500);
      c1.sock.emit("choose_character", a);
      c2.sock.emit("choose_character", b);
      await waitFor(() => c1.st?.p1?.char === a && c1.st?.p2?.char === b, 5000, "chars");
      await sleep(4000 / SPEED + 500); // Escanor premena / Jotaro summon
      await playGame(c1, c2, { p1: seededRng(500 + idx * 2), p2: seededRng(501 + idx * 2) });
      log(`${a} vs ${b}: ${c1.result ? "dohrané" : MAX_ROUNDS + " kôl"} (chyby zatiaľ: ${errors.length})`);
      await sleep(5000 / SPEED + 1000); // koniec hry / overlay
      idx++;
    }
    // 3) turnaj - HUD hlavy, swap teleporty, prenos HP
    if (!ONLY) {
      c1.result = c2.result = null;
      c1.sock.emit("retry");
      await sleep(200);
      c1.sock.emit("configure_match", { ...CONFIG, format: "tournament" });
      await waitFor(() => c1.st?.phase === "team_select", 5000, "team_select");
      c1.sock.emit("choose_team", TOURNEY.A);
      c2.sock.emit("choose_team", TOURNEY.B);
      await waitFor(() => c1.st?.phase === "playing", 5000, "tournament playing");
      for (let g = 0; g < 2 && c1.st.phase === "playing"; g++) {
        c1.result = c2.result = null;
        await sleep(2500 / SPEED + 1500);
        const alive = (c, team) => team.find(k => (c.st.mageHp?.[k] ?? 1) > 0);
        c1.sock.emit("choose_character", alive(c1, TOURNEY.A));
        c2.sock.emit("choose_character", alive(c2, TOURNEY.B));
        await waitFor(() => c1.st?.p1?.char && c1.st?.p2?.char, 5000, "tournament chars");
        await sleep(1500);
        const rosters = { [c1.slot]: TOURNEY.A, [c2.slot]: TOURNEY.B };
        await playGame(c1, c2, { p1: seededRng(900 + g), p2: seededRng(950 + g) }, rosters);
        log(`turnaj hra ${g + 1} (chyby zatiaľ: ${errors.length})`);
        await sleep(8000 / SPEED + 1500);
      }
    }
    c1.sock.close(); c2.sock.close();
  } catch (e) {
    errors.push("beh testu: " + e.message);
  } finally {
    br.close();
    server.kill();
  }
  if (serverErr.trim()) errors.push("stderr servera: " + serverErr.trim().slice(0, 500));
  return { errors, failed, assets };
}

/* ---------- hlavný beh ---------- */
// výsledok behu nad pracovným stromom sa ukladá; --reuse ho načíta (napr. keď treba zopakovať len HEAD)
const CACHE = path.join(os.tmpdir(), "arena-smoke-current.json");
let cur;
if (args.includes("--reuse") && fs.existsSync(CACHE)) {
  const c = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  cur = { ...c, assets: new Set(c.assets) };
  console.log("(pracovný strom: výsledok z predošlého behu)");
} else {
  cur = await runAgainst(process.cwd(), "pracovný strom");
  fs.writeFileSync(CACHE, JSON.stringify({ ...cur, assets: [...cur.assets] }));
}
let bad = cur.errors.length + cur.failed.length;
if (args.includes("--list")) [...cur.assets].sort().forEach(a => console.log("  · " + a));
console.log(`\n=== pracovný strom: ${cur.errors.length} chýb, ${cur.failed.length} zlyhaných požiadaviek, ${cur.assets.size} assetov`);
[...new Set(cur.errors)].slice(0, 30).forEach(e => console.log("  " + e));
[...new Set(cur.failed)].slice(0, 30).forEach(e => console.log("  " + e));
if (COMPARE) {
  // HEAD ako dočasný git worktree (node_modules cez junction/symlink)
  const dir = path.join(os.tmpdir(), `arena-head-${Date.now()}`);
  execSync(`git worktree add --detach "${dir}" HEAD`, { stdio: "ignore" });
  const linkedModules = !fs.existsSync(path.join(dir, "node_modules")); // node_modules je v repe verziované
  if (linkedModules) fs.symlinkSync(path.resolve("node_modules"), path.join(dir, "node_modules"), "junction");
  const old = await runAgainst(dir, "HEAD");
  console.log(`\n=== HEAD: ${old.errors.length} chýb, ${old.failed.length} zlyhaných požiadaviek, ${old.assets.size} assetov`);
  const onlyOld = [...old.assets].filter(a => !cur.assets.has(a)).sort();
  const onlyNew = [...cur.assets].filter(a => !old.assets.has(a)).sort();
  console.log(`assety len v HEAD: ${onlyOld.length}`); onlyOld.forEach(a => console.log("  - " + a));
  console.log(`assety len v pracovnom strome: ${onlyNew.length}`); onlyNew.forEach(a => console.log("  + " + a));
  if (linkedModules) try { fs.unlinkSync(path.join(dir, "node_modules")); } catch {}
  try { execSync(`git worktree remove --force "${dir}"`, { stdio: "ignore" }); } catch {}
  bad += onlyOld.length + onlyNew.length;
}
console.log(bad ? "\nDYMOVÝ TEST: PROBLÉMY" : "\nDYMOVÝ TEST OK");
process.exit(bad ? 1 : 0);
