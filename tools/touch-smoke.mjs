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
let fails = 0;
const check = (ok, label, extra = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && extra ? "  [" + extra + "]" : ""}`); if (!ok) fails++; };
const queue = () => ev(`[...document.querySelectorAll("#queue .q-badge.mine.main")].map(b => [...b.classList].filter(c => !["q-badge","mine","main","q-warn","q-slot"].includes(c)).join(".") || "-")`);
const preview = () => ev(`document.querySelectorAll("#grid .preview-red").length`);
const info = () => ev(`(() => { const e = document.getElementById("touch-info"); return e && !e.classList.contains("hidden") ? e.textContent : ""; })()`);
// telefón: štítok cena + účinok nad tlačidlom (namiesto popisu v info riadku); tablet ostáva pri info riadku
const PHONE = !process.env.TOUCH_DEVICE;
const label = () => ev(`(() => { const e = document.getElementById("touch-label"); return e && !e.classList.contains("hidden") ? e.textContent : ""; })()`);
const labelRed = () => ev(`!!document.querySelector("#touch-label.no-mana:not(.hidden)")`);

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
  if (!process.env.TOUCH_DEVICE) {
    // telefón: jeden cyklický pás postáv (char-strip.js) namiesto stránok so šípkami
    const armedChar = () => ev(`document.querySelector(".char-card.touch-armed")?.dataset.char || null`);
    const pr = await ev(`(() => { const r = document.querySelector(".char-pager").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
    const step = pr.w / 980 * 272; // jedna karta pásu v px displeja
    const swipe = async (cards) => {
      await sendT("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pr.x, y: pr.y }] });
      for (let i = 1; i <= 16; i++) { await sendT("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pr.x - step * cards * i / 16, y: pr.y }] }); await sleep(16); }
      await sendT("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(1200);
    };
    check(await ev(`document.getElementById("char-select").classList.contains("strip-mode") && getComputedStyle(document.getElementById("char-page-next")).display === "none"`), "telefón: postavy sú v páse, šípky nie sú");
    await swipe(1);
    check(await armedChar() === "lightning", "potiahnutie o kartu doľava označí ďalšiu postavu", String(await armedChar()));
    for (let i = 0; i < 9; i++) await swipe(1);
    check(await armedChar() === "lightning", "pás je cyklický (9 kariet dookola = späť na tej istej)", String(await armedChar()));
    await swipe(-1);
    check(await armedChar() === "fire", "potiahnutie doprava vráti predošlú postavu", String(await armedChar()));
    await sendT("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pr.x - step, y: pr.y }] });
    await sendT("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(1200);
    const mid = await ev(`(() => { const a = document.querySelector(".char-card.touch-armed").getBoundingClientRect(), p = document.querySelector(".char-pager").getBoundingClientRect(); return Math.abs(Math.round((a.left + a.width / 2) - (p.left + p.width / 2))); })()`);
    check(await armedChar() === "werewolf" && Math.abs(mid) < 3, "ťuk na bočnú kartu ju označí a dotočí do stredu", `${await armedChar()} ${mid}px`);
    await tap("#hidden-rune"); await sleep(900);
    check(await ev(`document.getElementById("char-select").classList.contains("hidden-mode")`), "runa otvorí Hidden stránku");
    // PICK skrytej postavy zatvorí výber - svietiaca runa musí zhasnúť hneď, nie až po ďalšom ťuknutí
    await ev(`document.getElementById("char-select").classList.add("hidden")`); await sleep(100);
    const runeAfter = await ev(`(() => { const r = document.getElementById("hidden-rune"); return r.style.opacity + "|" + r.classList.contains("near"); })()`);
    check(runeAfter === "0|false", "zatvorenie výberu z Hidden stránky zhasne runu", runeAfter);
    await ev(`(() => { document.getElementById("char-select").classList.remove("hidden"); const r = document.getElementById("hidden-rune"); r.style.opacity = ".6"; r.classList.add("near"); })()`);
    await tap("#hidden-rune"); await sleep(1300);
    check(await ev(`document.getElementById("char-select").classList.contains("strip-mode")`) && await armedChar() === "werewolf", "runa na Hidden stránke vráti hráča do pásu na to isté miesto", String(await armedChar()));
    await swipe(-1); // werewolf → soldier
    check(await armedChar() === "soldier", "dotočenie na Soldiera", String(await armedChar()));
  } else {
    // prepínanie kariet nesmie nič posunúť: na každej stránke ťukni na každú kartu a porovnaj polohy
    const layoutOf = () => ev(`JSON.stringify([...document.querySelectorAll("#char-page-title, #char-ability, #touch-pick, .char-cards:not(.hidden) .char-card")]
      .map(e => { const r = e.getBoundingClientRect(); return e.classList.contains("touch-armed") ? [Math.round(r.left), Math.round(r.top + 0)] : [Math.round(r.left), Math.round(r.top), Math.round(r.height)]; })
      .map(a => a.slice(0, 2)))`);
    const jumps = [];
    for (let pg = 0; pg < 3; pg++) {
      let ref = null;
      const keys = await ev(`[...document.querySelectorAll(".char-cards:not(.hidden) .char-card[data-char]")].map(c => c.dataset.char)`);
      for (const k of keys) {
        await tap(`.char-card[data-char="${k}"]`);
        // označená karta je zámerne o 6 px vyššie (transform) - porovnávame bez nej
        const l = await ev(`JSON.stringify([...document.querySelectorAll("#char-page-title, #char-ability, #touch-pick, .char-cards:not(.hidden) .char-card:not(.touch-armed)")].map(e => { const r = e.getBoundingClientRect(); return [e.id || e.dataset.char, Math.round(r.left), Math.round(r.top)]; }))`);
        const pos = JSON.parse(l).filter(x => x[0] !== k);
        const keyed = Object.fromEntries(pos.map(x => [x[0], x.slice(1).join(",")]));
        if (ref) for (const [id, v] of Object.entries(keyed)) if (ref[id] && ref[id] !== v) jumps.push(`${k}: ${id} ${ref[id]} → ${v}`);
        ref = { ...(ref || {}), ...keyed };
      }
      if (pg < 2) await tap("#char-page-next");
    }
    check(jumps.length === 0, "prepínanie kariet nič neposúva (nadpis, karty, náhľad, PICK)", jumps.slice(0, 4).join(" | "));
    for (let i = 0; i < 3 && await ev(`document.getElementById("char-page-prev") && !document.getElementById("char-page-prev").classList.contains("off")`); i++) await tap("#char-page-prev");
    void layoutOf;
    // Soldier je na inej stránke výberu - prelistuj šípkou (jedno ťuknutie, nie je to výber)
    const page = Number(await ev(`document.querySelector('.char-card[data-char="soldier"]').closest(".char-cards").dataset.page`));
    for (let i = 0; i < 3 && await ev(`document.querySelector('.char-card[data-char="soldier"]').closest(".char-cards").classList.contains("hidden")`); i++)
      await tap(page < 1 ? "#char-page-prev" : "#char-page-next");
    check(await ev(`!document.querySelector('.char-card[data-char="soldier"]').closest(".char-cards").classList.contains("hidden")`), "listovanie stránok výberu ťuknutím na šípku");
  }
  await tap('.char-card[data-char="soldier"]');
  check(await ev(`!document.getElementById("touch-pick").classList.contains("hidden")`), "ťuk na kartu ukáže PICK");
  check((await ev(`document.getElementById("touch-pick").textContent`)) === "PICK SOLDIER", "PICK nesie meno postavy", await ev(`document.getElementById("touch-pick").textContent`));
  check(await ev(`!document.getElementById("char-ability").classList.contains("hidden")`), "ťuk na kartu ukáže náhľad schopnosti");
  check(hst?.p2?.char == null, "prvé ťuknutie postavu ešte nevybralo");
  await tap('.char-card[data-char="soldier"]'); await tap('.char-card[data-char="soldier"]');
  check(await ev(`!document.getElementById("char-select").classList.contains("hidden")`), "opakované ťuknutie na kartu postavu nevyberie (len PICK)");
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
  const center = await ev(`(() => { const p = document.getElementById("aim-picker").getBoundingClientRect(), c = document.getElementById("touch-layer").getBoundingClientRect(); return { dx: Math.round((p.left + p.width / 2) - (c.left + c.width / 2)), dy: Math.round((p.top + p.height / 2) - (c.top + c.height / 2)) }; })()`);
  check(Math.abs(center.dx) < 3 && Math.abs(center.dy) < 3, "picker je pevne v strede boardu", JSON.stringify(center));
  const arrow = await tap("#aim-picker .arrow.left");
  check(arrow.w >= 40 && arrow.h >= 40, "šípka má aspoň 40×40 px na displeji", `${Math.round(arrow.w)}×${Math.round(arrow.h)}`);
  check((await queue()).filter(x => x !== "-").length === 0, "prvý ťuk na šípku útoku nezaradil akciu", JSON.stringify(await queue()));
  check((await preview()) > 0, "prvý ťuk na šípku ukázal zónu na boarde");
  check(await ev(`(() => { const t = document.getElementById("touch-confirm"); return !!t && !t.classList.contains("hidden"); })()`), "nad šípkou je štítok TAP AGAIN");
  const desc = PHONE ? label : info;
  const infoBefore = await desc();
  if (PHONE) {
    check(infoBefore === "1 3/2/1", "telefón: nad tlačidlom útoku je štítok cena + dmg (bez popisu)", infoBefore);
    check(await info() === "", "telefón: textový popis sa neukazuje", await info());
    check(await ev(`getComputedStyle(document.querySelector("#attack-btn .cost")).display === "none"`), "telefón: tlačidlo nesie len piktogram");
  } else check(infoBefore.length > 0, "info riadok ukazuje popis", infoBefore);
  if (PHONE) {
    // zablokovaná akcia (otvorený výber) = veľký zámok v strede tlačidla, nie v rohu
    const lk = await ev(`(() => { const b = document.getElementById("melee-btn"), a = getComputedStyle(b, "::after"), r = b.getBoundingClientRect();
      return { locked: b.classList.contains("locked-ui"), content: a.content, cx: Math.round(parseFloat(a.left) - r.width / 2 / (r.width / b.offsetWidth)), t: a.transform }; })()`);
    check(lk.locked && lk.content.includes("🔒") && Math.abs(lk.cx) < 2 && lk.t !== "none", "telefón: zablokovaná akcia má zámok v strede", JSON.stringify(lk));
    check(await ev(`["lock", "undo"].every(id => { const b = document.getElementById(id); return b.classList.contains("touch-locked") && getComputedStyle(b, "::after").content.includes("🔒"); })`), "telefón: pri výbere smeru majú zámok aj LOCK IN a ↩");
    const digits = await ev(`[...document.querySelectorAll("#queue .q-badge.main.q-slot")].map(b => b.textContent).join("")`);
    check(/^[123]+$/.test(digits), "telefón: lišta kola má holé čísla (bez krúžkov)", digits);
  }
  await shot("attack-armed");
  // otvorený výber zamyká ostatné akcie: ťuk na iné tlačidlá nič nezmení (popis, náhľad, označenie, picker)
  await tap("#melee-btn"); await tap("#special-btn"); await tap(".controls-row .btn.act.shield");
  check(await desc() === infoBefore, "pri otvorenom výbere smeru iné tlačidlá nemenia popis", await desc());
  check(await ev(`!!document.querySelector("#aim-picker .arrow.left.touch-armed") && !document.getElementById("aim-picker").classList.contains("hidden")`), "pri otvorenom výbere smeru ostáva označená šípka a picker otvorený");
  check((await preview()) > 0, "náhľad zóny útoku ostal");
  await tap("#aim-picker .arrow.left");
  check((await queue())[0] === "attack", "druhý ťuk na šípku zaradil útok", JSON.stringify(await queue()));
  if (PHONE) {
    const bt = await ev(`document.querySelector("#queue .q-badge.mine.main.attack")?.textContent || ""`);
    check(bt === "🏹", "telefón: lišta kola ukazuje len piktogram akcie (bez šípky smeru)", bt);
    const lg = await ev(`(async () => { const m = await import("/client/action-log.js"); const s = await import("/client/session.js");
      m.appendActionLog(s.me, { type: "move", dir: "left" }); const t = document.getElementById("log-" + s.me).textContent; m.clearActionLogs(); return t; })()`);
    check(lg.includes("🚶") && !/[←→↑↓↕]/.test(lg), "telefón: zápis kola v karte hráča bez šípok smeru", lg);
  }
  check(await ev(`document.getElementById("aim-picker").classList.contains("hidden")`), "picker sa po zaradení zavrel");

  await tap("#melee-btn");
  check((await queue())[1] === "-", "prvý ťuk na melee nezaradil", JSON.stringify(await queue()));
  check((await preview()) > 0, "prvý ťuk na melee ukázal zasiahnuté políčko");
  if (PHONE) check(await label() === "4 8TAP AGAIN", "telefón: nad označenou akciou je štítok cena + dmg + TAP AGAIN", await label());
  else check(await ev(`(() => { const t = document.getElementById("touch-confirm"); return !!t && !t.classList.contains("hidden") && t.textContent === "TAP AGAIN"; })()`), "nad označenou akciou je štítok TAP AGAIN");
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
  check((await queue()).filter(x => x !== "-").length === 0, "prvý ťuk na políčko nezaradil", JSON.stringify(await queue()));
  await tap("#cell-picker .mini-target:nth-child(2)");
  check((await queue())[0] === "special", "druhý ťuk na políčko zaradil special", JSON.stringify(await queue()));

  if (PHONE) {
    console.log("málo many (telefón)");
    // mana 6: special (5) → ostane 1; melee (4) aj ďalší special sa nedajú zaplatiť
    await sleep(500);
    check(await ev(`document.getElementById("melee-btn").classList.contains("no-mana") && !document.querySelector(".controls-row .btn.act.mana").classList.contains("no-mana")`), "tlačidlo bez many je sivé, recharge nie");
    await tap("#melee-btn");
    check(await labelRed(), "ťuk na melee bez many: červený štítok", await label());
    check((await label()).includes("TAP AGAIN"), "červený štítok aj tak ponúka TAP AGAIN (akcia sa dá zaradiť)", await label());
    check(await ev(`!!document.querySelector(".mana-bar.no-mana-flash")`), "mana bar bliká červeným obrysom");
    await shot("no-mana");
    await tap("#melee-btn");
    check((await queue())[1] === "melee", "druhý ťuk na melee bez many ho zaradí (server ho preškrtne)", JSON.stringify(await queue()));
    check(await ev(`(() => { const b = document.getElementById("melee-btn"); return b.disabled && getComputedStyle(b, "::after").content.includes("🔒"); })()`), "zaradená akcia má zámok v strede");
    await shot("used-lock");
    await tap("#undo"); await tap("#undo"); await sleep(300);
    check(!(await labelRed()) && !(await ev(`!!document.querySelector(".mana-bar.no-mana-flash")`)), "po zrušení výberu červený štítok aj obrys zmiznú");
    check(await ev(`!document.getElementById("melee-btn").classList.contains("no-mana")`), "po undo je melee znova zaplatiteľné");
    // varovanie: obrana ako posledná akcia kola (bot hostbot = p1 začína → tapper je nestartér)
    await tap(".controls-row .btn.act.mana"); await tap(".controls-row .btn.act.mana");
    await tap("#melee-btn"); await tap("#melee-btn");
    await tap(".controls-row .btn.act.shield");
    const sl = await label();
    check(sl.includes("BLOCK") && (sl.includes("EXPIRES UNUSED") || sl.includes("TAP AGAIN")), "štítok štítu: BLOCK (+ varovanie na poslednom mieste kola)", sl);
    await shot("shield-label");
    await tap("#undo"); await tap("#undo"); await tap("#undo");
  }
} catch (e) {
  console.error("CHYBA:", e.message); fails++;
} finally {
  if (errors.length) { console.error("JS chyby v stránke:\n  " + [...new Set(errors)].join("\n  ")); fails += errors.length; }
  console.log(fails ? `\nZLYHANÍ: ${fails}` : "\nDOTYKOVÝ TEST OK");
  host.close(); ws.close(); proc.kill(); server.kill();
  setTimeout(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} process.exit(fails ? 1 : 0); }, 1200);
}
