// tools/touch-smoke.mjs - test dotykového ovládania (client/touch.js, docs/MOBILE.md krok 2) v headless Chrome
// s emuláciou telefónu: skutočné ťuknutia prstom (Input.synthesizeTapGesture), nie kliky myšou. Prehliadač je hráč (p2),
// host je socket bot. Overí: výber postavy cez PICK, ťuk = výber + náhľad / druhý ťuk = zaradenie, pickery
// smeru na boarde pri postave, pohyb jedným ťuknutím, výber políčka cez board (Soldier).
//   node tools/touch-smoke.mjs [--shots <adresár>]   (exit 1 pri zlyhaní)
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
import WebSocket from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const SHOTS = args.includes("--shots") ? path.resolve(args[args.indexOf("--shots") + 1]) : null;
const PASS = "touch";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const BROWSER = process.env.CHROME || BROWSERS.find(p => fs.existsSync(p));
if (!BROWSER) { console.error("Nenašiel sa Chrome/Edge (nastav CHROME=cesta)"); process.exit(2); }

const port = 3950 + Math.floor(Math.random() * 5);
const url = `http://localhost:${port}`;
const server = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: String(port), FORCE_FIRST_STARTER: "A", PLAYER_KEYS: PASS, ARENA_SEED: "1" }, stdio: "ignore" });
await sleep(1300);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-touch-"));
const cdpPort = 9360 + Math.floor(Math.random() * 30);
const proc = spawn(BROWSER, ["--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${dataDir}`, "--mute-audio", "about:blank"], { stdio: "ignore" });
let list = null;
for (let i = 0; i < 50 && !list; i++) { await sleep(200); try { list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json(); } catch {} }
const ws = new WebSocket(list.find(t => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise(r => ws.once("open", r));
let id = 0; const pend = new Map(); const errors = [];
ws.on("message", raw => {
  const m = JSON.parse(raw);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sendT = (method, params, ms = 4000) => Promise.race([send(method, params), sleep(ms).then(() => "timeout")]);
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
await send("Runtime.enable"); await send("Page.enable");
// TOUCH_DEVICE=tablet → 1180×820 (iPad), inak telefón 844×390
const DEV = process.env.TOUCH_DEVICE === "tablet" ? { width: 1180, height: 820, deviceScaleFactor: 2 } : { width: 844, height: 390, deviceScaleFactor: 3 };
await send("Emulation.setDeviceMetricsOverride", { ...DEV, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

let shotN = 0;
const shot = async (name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, `${String(++shotN).padStart(2, "0")}-${name}.png`), Buffer.from(r.result.data, "base64"));
};
// ťuk prstom do stredu prvku (súradnice displeja z getBoundingClientRect)
const tap = async (sel) => {
  if (process.env.DBG) console.log("  tap", sel);
  const c = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
  if (!c) throw new Error("nenašiel sa prvok " + sel);
  if (process.env.DBG) console.log("    at", JSON.stringify(c));
  // (Input.synthesizeTapGesture v headless nedoručí click - preto touchStart/touchEnd)
  // touchEnd hneď po touchStart (pauza medzi nimi v headless Chrome zasekne odpoveď na touchEnd)
  const t1 = await sendT("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.x, y: c.y }] });
  const t2 = await sendT("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  if (t1 === "timeout" || t2 === "timeout") throw new Error("dotyk bez odpovede: " + sel);
  await sleep(350);
  return c;
};
const waitPage = async (expr, ms, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(`!!(${expr})`) === true) return; await sleep(100); }
  throw new Error("timeout: " + what);
};
const CHAR_SELECT_READY = `!document.getElementById("char-select").classList.contains("hidden") && document.getElementById("color-roll").classList.contains("hidden")`;
// stlačenie: prst dole → callback (napr. kontrola náhľadu počas držania) → prst hore
const press = async (sel, during) => {
  const c = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
  await sendT("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.x, y: c.y }] });
  await sleep(150);
  await during?.();
  await sendT("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(350);
  return c;
};
let fails = 0;
const check = (ok, label, extra = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && extra ? "  [" + extra + "]" : ""}`); if (!ok) fails++; };
const queue = () => ev(`[...document.querySelectorAll("#queue .q-badge.mine.main")].map(b => [...b.classList].filter(c => !["q-badge","mine","main","q-warn","q-slot"].includes(c)).join(".") || "-")`);
const preview = () => ev(`document.querySelectorAll("#grid .preview-red").length`);
const info = () => ev(`(() => { const e = document.getElementById("touch-info"); return e && !e.classList.contains("hidden") ? e.textContent : ""; })()`);

const host = io(url, { transports: ["websocket"], auth: { name: "hostbot", pass: PASS } });
let hst = null; host.on("state", s => { hst = s; });
try {
  await sleep(400);
  host.emit("create_room");
  await send("Page.navigate", { url }); await sleep(2000);
  await ev(`(() => { document.getElementById("login-name").value = "tapper"; /* meno nesmie obsahovať heslo - Chrome by otvoril správcu hesiel a ten zje touchEnd */ document.getElementById("login-pass").value = "${PASS}"; document.getElementById("login-form").requestSubmit(); })()`);
  await sleep(2500);
  await waitPage(`document.querySelector(".room-btn.join")`, 10000, "room browser");
  await tap(".room-btn.join"); await sleep(400);
  host.emit("configure_match", { format: "bo3", tilesPerRound: 1, tileWeights: { dmg: 0, heal: 100, mana: 0, ik: 0, power: 0, block: 0 }, timer: "off", tilePreview: false });
  await waitPage(CHAR_SELECT_READY, 15000, "char-select");
  await sleep(500);

  console.log("výber postavy");
  if (!process.env.TOUCH_DEVICE) {
    check(await ev(`!document.getElementById("touch-pick").classList.contains("hidden") && !document.getElementById("char-ability").classList.contains("hidden")`), "telefón: prvá karta je predvybraná (náhľad + PICK hneď)");
    check((await ev(`document.getElementById("touch-pick").textContent`)) === "PICK FIRE WIZARD", "telefón: predvybraný je Fire Wizard", await ev(`document.getElementById("touch-pick").textContent`));
  }
  // Soldier je na inej stránke výberu - prelistuj šípkou (jedno ťuknutie, nie je to výber)
  const page = Number(await ev(`document.querySelector('.char-card[data-char="soldier"]').closest(".char-cards").dataset.page`));
  for (let i = 0; i < 3 && await ev(`document.querySelector('.char-card[data-char="soldier"]').closest(".char-cards").classList.contains("hidden")`); i++)
    await tap(page < 1 ? "#char-page-prev" : "#char-page-next");
  check(await ev(`!document.querySelector('.char-card[data-char="soldier"]').closest(".char-cards").classList.contains("hidden")`), "listovanie stránok výberu ťuknutím na šípku");
  await tap('.char-card[data-char="soldier"]');
  check(await ev(`!document.getElementById("touch-pick").classList.contains("hidden")`), "ťuk na kartu ukáže PICK");
  check((await ev(`document.getElementById("touch-pick").textContent`)) === "PICK SOLDIER", "PICK nesie meno postavy", await ev(`document.getElementById("touch-pick").textContent`));
  check(await ev(`!document.getElementById("char-ability").classList.contains("hidden")`), "ťuk na kartu ukáže náhľad schopnosti");
  check(hst?.p2?.char == null, "prvé ťuknutie postavu ešte nevybralo");
  await shot("charselect-armed");
  await tap("#touch-pick"); await sleep(600);
  host.emit("choose_character", "naruto");
  await waitPage(`document.getElementById("char-select").classList.contains("hidden") && !!document.querySelector("#queue .q-badge.mine")`, 10000, "hra");
  await sleep(2500);
  check(hst?.p2?.char === "soldier", "PICK vybral postavu", String(hst?.p2?.char)); // výber je naslepo - vidno až keď vyberú obaja

  console.log("akcie");
  // soldier stojí na (3,1) (p2); attack → picker na boarde pri postave
  await tap("#attack-btn");
  const aim = await ev(`(() => { const p = document.getElementById("aim-picker"); return { open: !p.classList.contains("hidden"), inLayer: !!p.closest("#touch-layer") }; })()`);
  check(aim.open && aim.inLayer, "attack otvorí picker na boarde jedným ťuknutím", JSON.stringify(aim));
  const center = await ev(`(() => { const p = document.getElementById("aim-picker").getBoundingClientRect(), c = document.querySelector('#grid .cell[data-x="3"][data-y="1"]').getBoundingClientRect(); return { dx: Math.round((p.left + p.width / 2) - (c.left + c.width / 2)), dy: Math.round((p.top + p.height / 2) - (c.top + c.height / 2)) }; })()`);
  check(Math.abs(center.dx) < 3 && Math.abs(center.dy) < 3, "picker je vycentrovaný na políčku postavy", JSON.stringify(center));
  // otvorený výber zamyká ostatné akcie: ťuk na melee nič neoznačí ani nezaradí, picker ostane otvorený
  await tap("#melee-btn");
  check(await ev(`!document.querySelector(".touch-armed") && !document.getElementById("aim-picker").classList.contains("hidden")`), "pri otvorenom výbere smeru sa iná akcia nedá označiť");
  const arrow = await press("#aim-picker .arrow.left", async () => {
    check((await preview()) > 0, "držanie šípky ukazuje zónu na boarde");
    check((await info()).length > 0, "info riadok ukazuje popis", await info());
    await shot("attack-press");
  });
  check(arrow.w >= 40 && arrow.h >= 40, "šípka má aspoň 40×40 px na displeji", `${Math.round(arrow.w)}×${Math.round(arrow.h)}`);
  check((await queue())[0] === "attack", "jedno ťuknutie na šípku zaradilo útok", JSON.stringify(await queue()));
  check(await ev(`document.getElementById("aim-picker").classList.contains("hidden")`), "picker sa po zaradení zavrel");

  await tap("#melee-btn");
  check((await queue())[1] === "-", "prvý ťuk na melee nezaradil", JSON.stringify(await queue()));
  check((await preview()) > 0, "prvý ťuk na melee ukázal zasiahnuté políčko");
  check(await ev(`(() => { const t = document.getElementById("touch-confirm"); return !!t && !t.classList.contains("hidden") && t.textContent === "TAP AGAIN"; })()`), "nad označenou akciou je štítok TAP AGAIN");
  await shot("melee-armed");
  await tap("#melee-btn");
  check((await queue())[1] === "melee", "druhý ťuk na melee zaradil", JSON.stringify(await queue()));

  await tap("#move-btn");
  await shot("move-picker");
  await tap("#dir-picker .arrow.up");
  check((await queue())[2] === "move", "pohyb sa zaradí jedným ťuknutím na šípku", JSON.stringify(await queue()));
  check(await ev(`!!document.querySelector(".sprite-ghost, #actor-ghost") && getComputedStyle(document.querySelector("#actor-ghost") || document.querySelector(".sprite-ghost")).display !== "none"`), "ghost ukazuje cieľ pohybu");
  await shot("queue-full");

  // ťuk mimo → nič označené
  await tap("#undo"); await tap("#undo"); await tap("#undo");
  check((await queue()).filter(x => x !== "-").length === 0, "undo vyprázdnil front", JSON.stringify(await queue()));

  console.log("výber políčka (Soldier)");
  await tap("#special-btn");
  const cp = await ev(`(() => { const p = document.getElementById("cell-picker"); const t = p.querySelectorAll(".mini-target"); const c = document.querySelector('#grid .cell[data-x="1"][data-y="0"]').getBoundingClientRect(); const b = t[1].getBoundingClientRect(); return { open: !p.classList.contains("hidden"), n: t.length, dx: Math.round(b.left - c.left), dy: Math.round(b.top - c.top), dw: Math.round(b.width - c.width) }; })()`);
  check(cp.open && cp.n === 12, "special Soldiera otvorí výber políčka cez board", JSON.stringify(cp));
  check(Math.abs(cp.dx) < 3 && Math.abs(cp.dy) < 3 && Math.abs(cp.dw) < 3, "políčka výberu ležia presne na políčkach boardu", JSON.stringify(cp));
  await shot("cell-picker");
  await tap("#cell-picker .mini-target:nth-child(2)");
  check((await queue())[0] === "special", "jedno ťuknutie na políčko zaradilo special", JSON.stringify(await queue()));
} catch (e) {
  console.error("CHYBA:", e.message); fails++;
} finally {
  if (errors.length) { console.error("JS chyby v stránke:\n  " + [...new Set(errors)].join("\n  ")); fails += errors.length; }
  console.log(fails ? `\nZLYHANÍ: ${fails}` : "\nDOTYKOVÝ TEST OK");
  host.close(); ws.close(); proc.kill(); server.kill();
  setTimeout(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} process.exit(fails ? 1 : 0); }, 1200);
}
