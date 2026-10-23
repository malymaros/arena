// tools/screens.mjs - screenshoty klienta v rôznych veľkostiach obrazovky (desktop / tablet / mobil) cez headless
// Chrome/Edge (CDP emulácia zariadenia vrátane dotyku). Prehliadač je HOST (p1, súper je socket bot) a prejde všetky
// obrazovky: login, zoznam roomiek, nastavenie zápasu, čakanie, losovanie strán, výber postáv (+ Naruto, Hidden),
// hra, picker, menu, zvuk, Last Stand v zápise kola, FINAL ROUND, hlášky čakania, koniec hry. Slúži na kontrolu
// mobilného layoutu (docs/MOBILE.md).
//
//   node tools/screens.mjs                    → všetky zariadenia, PNG do tmp/screens/ (mimo gitu)
//   node tools/screens.mjs --only phone       → len zariadenia, ktorých názov obsahuje "phone"
//   node tools/screens.mjs --out <adresár>
//   node tools/screens.mjs --styles tmp/css-before.json    → navyše uloží vypočítané štýly všetkých prvkov každej snímky
//   node tools/screens.mjs --compare tmp/css-before.json   → porovná štýly s uloženými (refaktor CSS: musí byť 0 rozdielov)
// Štýly sa merajú s pozastavenými CSS animáciami (čas 0), takže porovnanie nezávisí od načasovania snímky.
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
const STYLES_OUT = opt("styles", null), COMPARE = opt("compare", null);
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

function connect(url, name) {
  return new Promise((resolve, reject) => {
    const sock = io(url, { transports: ["websocket"], auth: { name, pass: PASS } });
    const c = { sock, st: null, slot: null, rooms: null };
    sock.on("you_are", (s) => { c.slot = s?.slot ?? s; });
    sock.on("state", (s) => { c.st = s; });
    sock.on("rooms", (r) => { c.rooms = r; });
    const t = setTimeout(() => reject(new Error("connect timeout")), 15000);
    sock.on("connect", () => { clearTimeout(t); setTimeout(() => resolve(c), 300); });
  });
}

// vypočítané štýly všetkých prvkov (pozastavené CSS animácie na čase 0) - na porovnanie pred/po refaktore CSS
const STYLE_PROPS = ["display", "position", "top", "left", "right", "bottom", "width", "height", "min-width", "min-height",
  "max-width", "max-height", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right",
  "padding-bottom", "padding-left", "font-size", "font-weight", "line-height", "letter-spacing", "text-align", "color",
  "background-color", "background-image", "border-top-width", "border-top-style", "border-top-color", "border-radius",
  "box-shadow", "opacity", "visibility", "transform", "filter", "z-index", "overflow-x", "overflow-y", "gap", "row-gap",
  "column-gap", "grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-area", "align-items",
  "align-self", "align-content", "justify-content", "justify-self", "flex-direction", "flex-wrap", "order", "object-fit",
  "outline-style", "outline-width", "outline-color", "mask-image", "animation-name", "white-space", "touch-action", "pointer-events"];
const DUMP = `(() => {
  const anims = document.getAnimations().filter(a => a.playState === "running");
  anims.forEach(a => { try { a.pause(); a.currentTime = 0; } catch {} });
  // vlastnosti, ktoré práve mení animácia/prechod (fáza závisí od času, napr. posunutý pulz) - neporovnávajú sa
  const kebab = (p) => p.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
  const animated = new Map();
  for (const an of anims) {
    const el = an.effect?.target; if (!el) continue;
    const set = animated.get(el) || new Set();
    if (an.transitionProperty) set.add(an.transitionProperty);
    else for (const k of an.effect.getKeyframes()) for (const p of Object.keys(k)) if (!["offset", "easing", "composite", "computedOffset"].includes(p)) set.add(kebab(p));
    animated.set(el, set);
  }
  const GEOM = ["top", "left", "right", "bottom", "width", "height", "transform", "margin-top", "margin-left"];
  // náhodne generované prvky (lúče aury) - poloha sa losuje pri každom zobrazení
  const RANDOM = ".ca-streak";
  const P = ${JSON.stringify(STYLE_PROPS)};
  const pathOf = (el) => { const p = []; for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const s = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0; p.unshift(e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + ":" + s); } return p.join(">"); };
  const out = {};
  for (const el of [document.body, ...document.body.querySelectorAll("*")]) { // hlavička (link, meta…) sa nevykresľuje
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    if (el.matches(RANDOM)) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const an = animated.get(el) || new Set();
    const row = { cls: el.getAttribute("class") || "", rect: GEOM.some(g => an.has(g)) ? "~anim" : [r.left, r.top, r.width, r.height].map(v => Math.round(v * 10) / 10).join(",") };
    // hodnota zapísaná z JS do inline štýlu (napr. pulz žiary v raf) od CSS nezávisí - neporovnáva sa
    // visibility sa dedí - aj od predka s inline hodnotou (karty pásu postáv, char-strip.js)
    const inl = (k) => el.style.getPropertyValue(k) || (k === "visibility" && el.parentElement?.closest('[style*="visibility"]'));
    for (const k of P) row[k] = an.has(k) ? "~anim" : inl(k) ? "~inline" : cs.getPropertyValue(k);
    out[pathOf(el)] = row;
  }
  out["<html>"] = { cls: document.documentElement.className };
  anims.forEach(a => { try { a.play(); } catch {} });
  return JSON.stringify(out);
})()`;
const styles = {};

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
  fs.writeFileSync(path.join(OUT, `${dev.name}--${stage}.png`), Buffer.from(r.result.data, "base64"));
  if (STYLES_OUT || COMPARE) styles[`${dev.name}--${stage}`] = JSON.parse(await br.evaluate(DUMP));
};
const emulate = async (dev) => {
  await br.send("Emulation.setDeviceMetricsOverride", { width: dev.w, height: dev.h, deviceScaleFactor: dev.dpr, mobile: dev.mobile,
    screenOrientation: dev.w >= dev.h ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 } });
  await br.send("Emulation.setTouchEmulationEnabled", { enabled: dev.mobile, maxTouchPoints: dev.mobile ? 5 : 1 });
  await br.send("Emulation.setEmitTouchEventsForMouse", { enabled: dev.mobile, configuration: "mobile" });
};
// zobrazí len jeden z prekryvov (hlášky čakania, koniec hry) - vynútené triedou, nech sa dajú odfotiť bez celého scenára
const only = (id) => br.evaluate(`(() => { for (const x of ["gameover", "lobby-wait", "team-wait"]) document.getElementById(x)?.classList.toggle("hidden", x !== ${JSON.stringify(id)}); })()`);
const visible = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.classList.contains("hidden"); })()`;

try {
  for (const dev of DEVICES) {
    await startServer();
    await emulate(dev);
    await br.send("Page.navigate", { url });
    await sleep(800);
    await br.evaluate(`try { localStorage.clear(); sessionStorage.clear(); } catch {}`);
    // desktop: pevne plná grafika - inak strážca FPS v pomalom headless prehliadači náhodne zapne úspornú (perf.js)
    await br.send("Page.navigate", { url: dev.mobile ? url : url + "/?perf=full" });
    await waitPage(visible("#login"), 10000, "login");
    await sleep(600);
    await shot(dev, "01-login");
    await br.evaluate(`(() => { document.getElementById("login-name").value = "playera"; document.getElementById("login-pass").value = "${ADMIN_PASS}";
      document.getElementById("login-form").requestSubmit(); })()`);
    await waitPage(`document.querySelector(".room-btn.create")`, 10000, "rooms");
    await sleep(400);
    await shot(dev, "02-rooms");
    await br.evaluate(`document.querySelector(".room-btn.create").click()`);
    await waitPage(visible("#lobby"), 8000, "lobby");
    await sleep(500);
    await shot(dev, "03-lobby");
    await br.evaluate(`document.getElementById("lobby-start").click()`);
    await waitPage(visible("#host-wait"), 8000, "host-wait");
    await sleep(300);
    await shot(dev, "04-hostwait");
    const bot = await connect(url, "botb");
    for (let i = 0; i < 50 && !bot.rooms?.rooms?.length; i++) await sleep(100);
    bot.sock.emit("join_room", { roomId: bot.rooms.rooms[0].id });
    await waitPage(visible("#color-roll"), 8000, "color-roll");
    await sleep(900);
    await shot(dev, "05-colorroll");
    await waitPage(`${visible("#char-select")} && document.getElementById("color-roll").classList.contains("hidden")`, 15000, "char-select");
    await sleep(800);
    await shot(dev, "06-charselect");
    // Naruto má najdlhší popis schopnosti; na dotyku ťuk kartu len označí (pás ju dotočí do stredu)
    if (dev.mobile) {
      await br.evaluate(`document.querySelector('.char-card[data-char="naruto"]')?.click()`);
      await sleep(1200);
      await shot(dev, "07-naruto");
      await br.evaluate(`document.getElementById("hidden-rune").click()`);
      await sleep(1200);
      await shot(dev, "08-hidden");
      // späť na Naruta: telefón cez runu, tablet šípkou (Hidden → str. 0) a potom na str. 2
      if (await br.evaluate(`document.documentElement.classList.contains("phone")`)) await br.evaluate(`document.getElementById("hidden-rune").click()`);
      else await br.evaluate(`(() => { const n = document.getElementById("char-page-next"); n.click(); n.click(); n.click(); })()`);
      await sleep(1200);
      await br.evaluate(`(() => { const c = document.querySelector('.char-card[data-char="naruto"]'); c?.click(); const p = document.getElementById("touch-pick"); if (p && !p.classList.contains("hidden")) p.click(); })()`);
    } else {
      await br.evaluate(`(() => { const n = document.getElementById("char-page-next"); n.click(); document.querySelector('.char-card[data-char="naruto"]').click(); })()`);
    }
    bot.sock.emit("choose_character", "escanor");
    await waitPage(`document.getElementById("char-select").classList.contains("hidden")`, 8000, "hra");
    await sleep(3500); // intro / premena Escanora
    await shot(dev, "09-game");
    await br.evaluate(`document.querySelector('.btn.act.attack')?.click()`);
    await sleep(500);
    await shot(dev, "10-picker");
    await br.evaluate(`document.getElementById("menu-btn").click()`);
    await sleep(300);
    await shot(dev, "11-menu");
    await br.evaluate(`document.querySelector('#menu-panel [data-act="sound"]').click()`);
    await sleep(300);
    await shot(dev, "12-sound");
    await br.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await br.evaluate(`document.querySelectorAll(".ui-modal").forEach(m => m.classList.add("hidden")); document.querySelectorAll(".ui-backdrop").forEach(m => m.classList.add("hidden"))`);
    // Last Stand v zápise kola (zlatá bunka), potom kolo s paktom → FINAL ROUND
    await br.evaluate(`(() => { const b = document.querySelector('#gold-dual-btn .ls-half'); b?.click(); b?.click(); })()`);
    await sleep(500);
    await shot(dev, "13-laststand");
    await br.evaluate(`(async () => { const { socket } = await import("/client/net.js"); socket.emit("lock_in", [{ type: "recharge" }, { type: "move", dir: "up" }, { type: "shield" }, { type: "last_stand" }], ${bot.st?.turn ?? 1}); })()`);
    bot.sock.emit("lock_in", [{ type: "recharge" }, { type: "move", dir: "down" }, { type: "shield" }], bot.st?.turn ?? 1);
    await waitPage(`window.__arenaPlaying === true`, 8000, "prehrávanie");
    await waitPage(`window.__arenaPlaying !== true`, 60000, "koniec prehrávania");
    await sleep(2500);
    await shot(dev, "14-finalround");
    await br.evaluate(`(() => { const t = document.getElementById("turn-status"); t.textContent = "⚠️ OPPONENT IS READY - YOUR MOVE! ⚠️"; t.className = "turn-status your-move"; })()`);
    await sleep(200);
    await shot(dev, "15-turnstatus");
    await br.evaluate(`document.getElementById("turn-status").classList.add("hidden")`);
    for (const [id, stage] of [["gameover", "16-gameover"], ["lobby-wait", "17-lobbywait"], ["team-wait", "18-teamwait"]]) {
      await only(id);
      await sleep(250);
      await shot(dev, stage);
    }
    // medzihra série (najväčší prípad = turnaj, 3 koruny na stranu)
    await only("none");
    await br.evaluate(`(async () => { const { showIntermission } = await import("/client/intermission.js"); showIntermission("p1", { needed: 3, winsP1: 2, winsP2: 1 }, "p1"); })()`);
    await sleep(1000);
    await shot(dev, "19-intermission");
    await br.evaluate(`document.getElementById("intermission").classList.add("hidden")`);
    console.log(`${dev.name}: ok`);
    bot.sock.close();
    await br.send("Page.navigate", { url: "about:blank" });
    await sleep(300);
  }
} catch (e) {
  console.error("CHYBA:", e.message || e);
  process.exitCode = 1;
} finally {
  if (errors.length) { console.error("JS chyby v stránke:\n  " + [...new Set(errors)].join("\n  ")); process.exitCode = 1; }
  if (STYLES_OUT) { fs.mkdirSync(path.dirname(path.resolve(STYLES_OUT)), { recursive: true }); fs.writeFileSync(STYLES_OUT, JSON.stringify(styles)); console.log("štýly: " + STYLES_OUT); }
  if (COMPARE) {
    const base = JSON.parse(fs.readFileSync(COMPARE, "utf8"));
    let n = 0;
    for (const [shotName, els] of Object.entries(styles)) {
      const b = base[shotName];
      if (b) for (const k of Object.keys(b)) if (!k.startsWith("body") && k !== "<html>") delete b[k]; // len telo stránky
      if (!b) { console.log(`  ${shotName}: v porovnaní chýba`); continue; }
      for (const [p, v] of Object.entries(els)) for (const [k, x] of Object.entries(v)) {
        const wild = (v) => v === "~anim" || v === "~inline"; // časovo závislé / z JS - porovnáva sa len zvyšok
        if (b[p]?.[k] !== x && !wild(x) && !wild(b[p]?.[k])) { if (n++ < 40) console.log(`  ${shotName}  ${p.split(">").slice(-3).join(">")}  ${k}: ${b[p]?.[k]} → ${x}`); }
      }
      for (const p of Object.keys(b)) if (!els[p]) { if (n++ < 40) console.log(`  ${shotName}  chýba prvok ${p.split(">").slice(-3).join(">")}`); }
    }
    console.log(n ? `ROZDIELY ŠTÝLOV: ${n}` : "štýly sa zhodujú s " + COMPARE);
    if (n) process.exitCode = 1;
  }
  console.log("screenshoty: " + OUT);
  br.close();
  server?.kill();
  setTimeout(() => process.exit(), 1600);
}
