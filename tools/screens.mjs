// tools/screens.mjs - screenshoty klienta v rôznych veľkostiach obrazovky (desktop / tablet / mobil) cez headless
// Chrome/Edge (CDP emulácia zariadenia vrátane dotyku). Prehliadač je HRÁČ (p2, host je socket bot): login,
// char-select, rozohraná hra (1 odohrané kolo). Slúži na kontrolu mobilného layoutu (docs/MOBILE.md).
//
//   node tools/screens.mjs                    → všetky zariadenia, PNG do tmp/screens/ (mimo gitu)
//   node tools/screens.mjs --only phone       → len zariadenia, ktorých názov obsahuje "phone"
//   node tools/screens.mjs --out <adresár>
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
import WebSocket from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt("out", "tmp/screens"));
const ONLY = opt("only", null);
const PASS = "shots", ADMIN_PASS = "shotsadmin"; // prehliadač sa prihlási ako admin (vidno admin sekciu menu)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// w×h v CSS px (na šírku aj na výšku), dpr, mobile = dotyk + mobilný viewport
const DEVICES = [
  { name: "desktop-1920x1080", w: 1920, h: 1080, dpr: 1, mobile: false },
  { name: "desktop-1536x864",  w: 1536, h: 864,  dpr: 1, mobile: false },
  { name: "desktop-1280x720",  w: 1280, h: 720,  dpr: 1, mobile: false },
  { name: "tablet-ipad-1180x820",  w: 1180, h: 820, dpr: 2, mobile: true },
  { name: "tablet-1024x768",       w: 1024, h: 768, dpr: 2, mobile: true },
  { name: "phone-iphone-844x390",  w: 844,  h: 390, dpr: 3, mobile: true },
  { name: "phone-android-915x412", w: 915,  h: 412, dpr: 2.6, mobile: true },
  { name: "phone-small-667x375",   w: 667,  h: 375, dpr: 2, mobile: true },
  { name: "phone-portrait-390x844", w: 390, h: 844, dpr: 3, mobile: true },
].filter(d => !ONLY || d.name.includes(ONLY));

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const BROWSER = process.env.CHROME || BROWSERS.find(p => fs.existsSync(p));
if (!BROWSER) { console.error("Nenašiel sa Chrome/Edge (nastav CHROME=cesta)"); process.exit(2); }

async function launchBrowser(port) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-shots-"));
  const proc = spawn(BROWSER, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dataDir}`,
    "--no-first-run", "--no-default-browser-check", "--mute-audio", "about:blank"], { stdio: "ignore" });
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

function connect(url, name) {
  return new Promise((resolve, reject) => {
    const sock = io(url, { transports: ["websocket"], auth: { name, pass: PASS } });
    const c = { sock, st: null, slot: null };
    sock.on("you_are", (s) => { c.slot = s?.slot ?? s; });
    sock.on("state", (s) => { c.st = s; });
    const t = setTimeout(() => reject(new Error("connect timeout")), 15000);
    sock.on("connect", () => { clearTimeout(t); setTimeout(() => resolve(c), 300); });
  });
}
const CONFIG = { format: "bo3", tilesPerRound: 2, tileWeights: { dmg: 50, heal: 10, mana: 10, ik: 10, power: 10, block: 10 }, timer: "off", tilePreview: true };

const port = 3980 + Math.floor(Math.random() * 5);
const url = `http://localhost:${port}`;
// každé zariadenie má vlastný čerstvý server (žiadne visiace roomky z predošlého behu)
let server = null;
const startServer = async () => {
  if (server) { server.kill(); await sleep(400); }
  server = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: String(port), FORCE_FIRST_STARTER: "A", PLAYER_KEYS: PASS, ADMIN_KEY: ADMIN_PASS, ARENA_SEED: "1" }, stdio: ["ignore", "ignore", "inherit"] });
  await sleep(1300);
};
fs.mkdirSync(OUT, { recursive: true });
const br = await launchBrowser(9250 + Math.floor(Math.random() * 40));
const errors = [];
br.on((m) => {
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
await br.send("Runtime.enable");
await br.send("Page.enable");

const waitPage = async (expr, ms, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await br.evaluate(`!!(${expr})`) === true) return; await sleep(100); }
  throw new Error("timeout: " + what);
};
const shot = async (dev, stage) => {
  const r = await br.send("Page.captureScreenshot", { format: "png" });
  const f = path.join(OUT, `${dev.name}--${stage}.png`);
  fs.writeFileSync(f, Buffer.from(r.result.data, "base64"));
  return f;
};
const emulate = async (dev) => {
  await br.send("Emulation.setDeviceMetricsOverride", { width: dev.w, height: dev.h, deviceScaleFactor: dev.dpr, mobile: dev.mobile,
    screenOrientation: dev.w >= dev.h ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 } });
  await br.send("Emulation.setTouchEmulationEnabled", { enabled: dev.mobile, maxTouchPoints: dev.mobile ? 5 : 1 });
  await br.send("Emulation.setEmitTouchEventsForMouse", { enabled: dev.mobile, configuration: "mobile" });
};

try {
  let n = 0;
  for (const dev of DEVICES) {
    await startServer();
    await emulate(dev);
    const host = await connect(url, "hostbot");
    host.sock.emit("create_room");
    await br.send("Page.navigate", { url });
    await sleep(800);
    await br.evaluate(`try { localStorage.clear(); sessionStorage.clear(); } catch {}`);
    await br.send("Page.navigate", { url });
    await waitPage(`!document.getElementById("login")?.classList.contains("hidden")`, 10000, "login");
    await sleep(600);
    await shot(dev, "1-login");
    const name = "player" + "abcdefghij"[n++];
    await br.evaluate(`(() => { document.getElementById("login-name").value = "${name}"; document.getElementById("login-pass").value = "${ADMIN_PASS}";
      document.getElementById("login-form").requestSubmit(); })()`);
    await waitPage(`document.querySelector(".room-btn.join")`, 10000, "join");
    await br.evaluate(`[...document.querySelectorAll(".room-btn.join")].at(-1).click()`);
    await waitPage(`document.getElementById("rooms")?.classList.contains("hidden")`, 5000, "usadenie");
    await sleep(400);
    host.sock.emit("configure_match", CONFIG);
    await waitPage(`!document.getElementById("char-select")?.classList.contains("hidden") && document.getElementById("color-roll")?.classList.contains("hidden")`, 15000, "char-select");
    await sleep(800);
    await shot(dev, "2-charselect");
    // na dotyku prvé ťuknutie kartu len označí (touch.js) - potvrdí ju PICK; Naruto má najdlhší popis schopnosti
    await br.evaluate(`document.querySelector('.char-card[data-char="naruto"]')?.click()`);
    await sleep(500);
    await shot(dev, "2b-naruto");
    await br.evaluate(`(() => { const p = document.getElementById("touch-pick"); if (p && !p.classList.contains("hidden")) p.click(); })()`);
    host.sock.emit("choose_character", "escanor");
    await sleep(3500); // intro / transform
    await shot(dev, "3-game");
    // naplánuj 2 akcie (vidno front a ghost), nelockuj
    await br.evaluate(`(() => { const b = document.querySelector('.btn.act.attack') || document.querySelector('[data-act="attack"]'); b?.click(); })()`);
    await sleep(500);
    await shot(dev, "4-picker");
    await br.evaluate(`document.getElementById("menu-btn").click()`);
    await sleep(300);
    await shot(dev, "5-menu");
    await br.evaluate(`document.querySelector('#menu-panel [data-act="sound"]').click()`);
    await sleep(300);
    await shot(dev, "6-sound");
    console.log(`${dev.name}: ok`);
    host.sock.close();
    await br.send("Page.navigate", { url: "about:blank" });
    await sleep(300);
  }
} catch (e) {
  console.error("CHYBA:", e.message || e);
  process.exitCode = 1;
} finally {
  if (errors.length) { console.error("JS chyby v stránke:\n  " + [...new Set(errors)].join("\n  ")); process.exitCode = 1; }
  console.log("screenshoty: " + OUT);
  br.close();
  server?.kill();
  setTimeout(() => process.exit(), 1600);
}
