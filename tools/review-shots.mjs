// tools/review-shots.mjs - snímky rozboru zápasu ANALYZE (docs/MATCH_REVIEW_PLAN.md) v headless Chrome/Edge.
// Spustí server so záznamami (MATCHES_DIR), prihlási prehliadač, otvorí /?review=<id> a nafotí: začiatok kola,
// vybranú akciu, pohľad druhého hráča, ďalšie kolo, THE WORLD (ak ho záznam má). Zlyhá pri JS chybe na stránke.
//   node tools/match-record-demo.mjs            → ukážkové záznamy do tmp/matches
//   node tools/review-shots.mjs [--dir tmp/matches] [--out tmp/review-shots] [--only phone]
import { spawn } from "node:child_process";
import WebSocket from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const DIR = path.resolve(opt("dir", "tmp/matches"));
const OUT = path.resolve(opt("out", "tmp/review-shots"));
const ONLY = opt("only", null);
const PASS = "shots";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DEVICES = [
  { name: "pc-1720x920", w: 1720, h: 920, dpr: 1, mobile: false },
  { name: "pc-1920x1080", w: 1920, h: 1080, dpr: 1, mobile: false },
  { name: "phone-844x390", w: 844, h: 390, dpr: 3, mobile: true },
].filter(d => !ONLY || d.name.includes(ONLY));
const BROWSERS = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
const BROWSER = process.env.CHROME || BROWSERS.find(p => fs.existsSync(p));
if (!BROWSER) { console.error("Nenašiel sa Chrome/Edge (nastav CHROME=cesta)"); process.exit(2); }

const rows = fs.readFileSync(path.join(DIR, "index.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
if (!rows.length) { console.error("žiadne záznamy v " + DIR + " (node tools/match-record-demo.mjs)"); process.exit(2); }
const load = (id) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, `${id}.json.gz`))).toString("utf8"));
// záznam s THE WORLD (frozen beat) - ak existuje
const findWorld = () => {
  for (const r of rows) {
    const rec = load(r.id);
    for (let gi = 0; gi < rec.games.length; gi++) rec.games[gi].rounds.forEach((rd, ri) => {
      const j = rd.views.p1.beats.findIndex(b => b.frozen);
      if (j > 0 && !findWorld.hit) findWorld.hit = { id: r.id, gi, ri, j };
    });
  }
  return findWorld.hit || null;
};

async function launchBrowser(port) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-review-"));
  const proc = spawn(BROWSER, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dataDir}`,
    "--no-first-run", "--no-default-browser-check", "--mute-audio", "about:blank"], { stdio: "ignore" });
  let list = null;
  for (let i = 0; i < 50 && !list; i++) { await sleep(200); try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch {} }
  const page = list?.find(t => t.type === "page");
  if (!page) throw new Error("prehliadač neodpovedá na CDP");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 1 << 30 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0;
  const pending = new Map(), listeners = [];
  ws.on("message", (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) listeners.forEach(l => l(m)); });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.result?.value;
  return { send, evaluate, on: (f) => listeners.push(f), close: () => { try { ws.close(); } catch {} proc.kill(); } };
}

const port = 3970 + Math.floor(Math.random() * 5);
const server = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: String(port), PLAYER_KEYS: PASS, MATCHES_DIR: DIR, TELEMETRY_DIR: "" }, stdio: ["ignore", "ignore", "inherit"] });
for (let i = 0; i < 50; i++) { await sleep(200); try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} }
fs.mkdirSync(OUT, { recursive: true });
const errors = [];
const br = await launchBrowser(9330 + Math.floor(Math.random() * 50));
br.on((m) => {
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/favicon/.test(m.params.entry.url || "")) errors.push(m.params.entry.text + " " + (m.params.entry.url || ""));
});
await br.send("Runtime.enable"); await br.send("Log.enable"); await br.send("Page.enable");
const shot = async (dev, name) => {
  await sleep(500);
  const r = await br.send("Page.captureScreenshot", { format: "png" });
  const f = path.join(OUT, `${dev.name}-${name}.png`);
  fs.writeFileSync(f, Buffer.from(r.result.data, "base64"));
  console.log("  " + path.relative(process.cwd(), f));
};
const waitFor = async (expr, ms = 10000, what = expr) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await br.evaluate(expr)) return; await sleep(150); } throw new Error("čakanie zlyhalo: " + what); };
const click = (sel) => br.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; })()`);
const key = (k) => br.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true }))`);

try {
  const world = findWorld();
  const first = rows[rows.length - 1].id;
  for (const dev of DEVICES) {
    console.log(dev.name);
    await br.send("Emulation.setDeviceMetricsOverride", { width: dev.w, height: dev.h, deviceScaleFactor: dev.dpr, mobile: dev.mobile });
    await br.send("Emulation.setTouchEmulationEnabled", { enabled: dev.mobile });
    await br.send("Page.navigate", { url: `http://localhost:${port}/` });
    await waitFor(`!document.getElementById("login").classList.contains("hidden") || !document.getElementById("rooms").classList.contains("hidden")`, 10000, "login");
    if (await br.evaluate(`!document.getElementById("login").classList.contains("hidden")`)) await br.evaluate(`(() => { document.getElementById("login-name").value = "review"; document.getElementById("login-pass").value = "${PASS}"; document.getElementById("login-form").requestSubmit(); })()`);
    await waitFor(`!document.getElementById("rooms").classList.contains("hidden")`, 10000, "room browser");
    await shot(dev, "00-rooms");
    // MATCHES: zoznam → rozbaľ sériu → ANALYZE → Esc späť do zoznamu
    await click("#matches-open");
    await waitFor(`document.querySelectorAll("#matches .ml-row").length > 0`, 10000, "matches list");
    await br.evaluate(`[...document.querySelectorAll("#matches .ml-row")].find(r => r.querySelectorAll(".ml-cause").length > 1)?.dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
    await shot(dev, "0-matches");
    await click("#matches .ml-analyze");
    await waitFor(`document.body.classList.contains("review-mode")`, 10000, "review from matches");
    await key("Escape");
    await waitFor(`!document.body.classList.contains("review-mode") && !document.getElementById("matches").classList.contains("hidden")`, 5000, "back to matches");
    // rozbor: ten istý vstup ako dev odkaz /?review=<id> (login ostáva v sessionStorage)
    await br.send("Page.navigate", { url: `http://localhost:${port}/?review=${first}` });
    await waitFor(`document.body.classList.contains("review-mode")`, 15000, "review mode");
    await sleep(800);
    await shot(dev, "1-round-start");
    // PLAY: po ~2,3 s je kurzor o 2 akcie ďalej, pauza ho zastaví
    const beatNow = () => br.evaluate(`+(document.querySelector("#queue .q-now")?.dataset.beat ?? -1)`);
    const b0 = await beatNow();
    await click(".rv-play"); await sleep(2300); await click(".rv-play");
    const b1 = await beatNow(); await sleep(1200);
    if (b1 - b0 !== 2 || (await beatNow()) !== b1) errors.push(`PLAY: beat ${b0} → ${b1} (čakané +2 a stop)`);
    await key("Home");
    // REVIEW_PROF=1: čas prepnutia akcie [ms obsluhy klávesu, ms do 2. snímky] - má byť pár ms
    if (process.env.REVIEW_PROF) console.log("  PROF", await br.evaluate(`(async () => { const t = []; for (let i = 0; i < 20; i++) { const a = performance.now(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); const b = performance.now(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); t.push([Math.round(b - a), Math.round(performance.now() - a)]); } return JSON.stringify(t); })()`));
    console.log("  rects", await br.evaluate(`JSON.stringify(Object.fromEntries(["#hud-p1","#hud-p2",".board","#grid","#queue",".rv-nav","#hud-turn",".stage",".game"].map(s => { const r = document.querySelector(s)?.getBoundingClientRect(); return [s, r ? [r.left, r.top, r.right, r.bottom].map(Math.round).join(",") : null]; })))`));
    await key("ArrowRight"); await key("ArrowRight"); await key("ArrowRight");
    await shot(dev, "2-third-action");
    await click("#hud-p2");
    await shot(dev, "3-black-view");
    await key("ArrowDown"); await key("ArrowDown"); await key("ArrowRight");
    await shot(dev, "4-round-3");
    // posledné kolo hry: zamknuté akcie, na ktoré nedošlo (zašednuté)
    for (let i = 0; i < 40; i++) await key("ArrowDown");
    await key("End");
    await shot(dev, "4b-final-round");
    if (world) {
      await br.send("Page.navigate", { url: `http://localhost:${port}/?review=${world.id}` });
      await waitFor(`document.body.classList.contains("review-mode")`, 15000, "review mode (THE WORLD)");
      for (let g = 0; g < world.gi; g++) await click(`.rv-game[data-g="${world.gi}"]`);
      for (let r = 0; r < world.ri; r++) await key("ArrowDown");
      for (let b = 0; b < world.j + 1; b++) await key("ArrowRight");
      await shot(dev, "5-the-world");
    }
    const ai = [...rows].reverse().find(r => r.ai); // najnovší zápas s botom
    if (ai) { // zápas proti botovi: hlava bota v HUD
      await br.send("Page.navigate", { url: `http://localhost:${port}/?review=${ai.id}` });
      await waitFor(`document.body.classList.contains("review-mode")`, 15000, "review mode (AI)");
      await key("ArrowRight"); await key("ArrowRight");
      await shot(dev, "6-vs-ai");
    }
    await key("Escape");
    await sleep(300);
    if (await br.evaluate(`document.body.classList.contains("review-mode")`)) errors.push("Esc nezavrel rozbor");
  }
} catch (err) {
  errors.push(String(err?.message || err));
} finally {
  br.close(); server.kill();
}
if (errors.length) { console.error("CHYBY:\n" + [...new Set(errors)].join("\n")); process.exit(1); }
console.log("ok");
