// server.js (ESM)

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { createRecordedEngine } from "./telemetry/recorder.js";
import { createJsonlStore } from "./telemetry/store.js";
import { createBotSeat } from "./engine/ai/seat.js";
import { matchConfigCustom } from "./shared/arena-defaults.js";
import { ARENA_ROLL_MS, COLOR_ROLL_MS, charRollMs } from "./shared/timing.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  // preži krátke výpadky spojenia: po reconnecte server prehrá klientovi zmeškané packety
  // (vrátane state+timeline) → animácie nevisia a netreba refresh ani pri blikajúcej sieti
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000, skipMiddlewares: true },
});

// Statika s rozumným kešovaním (predtým no-store → prehliadač sťahoval všetkých ~33 MB
// sprite sheetov pri KAŽDOM načítaní; plocha sa preto zobrazovala pomaly zakaždým):
//  - assets/ a arenas/ (sprite sheety, pozadia - menia sa zriedka): kešuj 1 h, potom revaliduj
//  - index.html, client.js/css (kód - mení sa pri deployi): vždy revaliduj cez ETag,
//    prehliadač si tak po deployi hneď vyzdvihne novú verziu, no bez zmeny dostane rýchle 304
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/[\\/](assets|arenas|sounds[\\/]lib)[\\/]/.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=3600");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));
// zoznam zvukovej knižnice pre /sound-lab.html (public/sounds/lib/<balík>/*, public/sounds/custom/*) - čítaný
// živo, aby nový súbor v knižnici netreba nikde registrovať
app.get("/sounds/lib-index.json", (req, res) => {
  const root = path.join(__dirname, "public", "sounds");
  const out = {};
  for (const dir of ["lib", "custom"]) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    const walk = (rel) => {
      for (const ent of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) walk(r);
        else if (/\.(ogg|mp3|wav)$/i.test(ent.name)) (out[dir === "custom" ? "custom" : r.split("/")[0]] ||= []).push(`${dir}/${r}`);
      }
    };
    walk("");
  }
  res.setHeader("Cache-Control", "no-cache");
  res.json(out);
});
// zdieľaná herná geometria (shared/geometry.js) - ten istý ES modul importuje engine aj client.js;
// je to kód, takže vždy revalidácia cez ETag (po deployi sa hneď natiahne nová verzia)
app.use("/shared", express.static(path.join(__dirname, "shared"), {
  etag: true,
  lastModified: true,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
}));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || ""; // ← admin heslo: kto sa ním prihlási (namiesto hesla hráča), je admin
// Heslá pre vstup do hry (rozdáva admin): čiarkou oddelený zoznam. Zatiaľ natvrdo "hamara"
// (default), prepísateľné cez env PLAYER_KEYS=heslo1,heslo2 (napr. systemd deploy/arena.service).
// POZOR: repo je verejné → tento default je viditeľný; na reálne tajné heslo nastav env a zmaž default.
const PLAYER_KEYS = new Set((process.env.PLAYER_KEYS || "hamara").split(",").map(s => s.trim()).filter(Boolean));

/* -------------------- Telemetria (zber herných dát, docs/TELEMETRY.md) -------------------- */
// TELEMETRY_DIR = adresár pre denné JSONL súbory (na VM /home/arena/arena-data); bez neho sa nič nezapisuje.
const TELEMETRY_DIR = process.env.TELEMETRY_DIR || "";
const telemetry = TELEMETRY_DIR ? createJsonlStore(path.resolve(TELEMETRY_DIR)) : null;
// verzia servera do match_start: commit (+ či bol pracovný strom čistý) a odtlačok shared/balance.js
const telemetryMeta = (() => {
  const meta = { commit: null, dirty: null, balance: null };
  try {
    meta.commit = execSync("git rev-parse --short HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    meta.dirty = execSync("git status --porcelain --untracked-files=no", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() !== "";
  } catch { /* bez gitu ostane null */ }
  try { meta.balance = crypto.createHash("sha1").update(fs.readFileSync(path.join(__dirname, "shared", "balance.js"))).digest("hex").slice(0, 12); } catch { /* */ }
  return meta;
})();
if (telemetry) {
  console.log(`telemetry: ${telemetry.dir} (commit ${telemetryMeta.commit}${telemetryMeta.dirty ? ", dirty" : ""})`);
  // pri reštarte/deployi (systemd SIGTERM) dopíš rozpracovaný buffer
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { telemetry.flush(); process.exit(0); });
}
// jednorazové tokeny na stiahnutie dát z menu ☰ (admin socket si ho vypýta; heslo tak nejde do URL)
const dataTokens = new Map(); // token → expirácia (ms)

// bug reporty (menu ☰ → REPORT BUG, public/client/bug-report.js): záznam t:"bug" do telemetrie (bez mena hráča),
// vždy aj riadok do logu servera. Ochrana pred zahltením: 1 hlásenie / BUG_GAP_MS na socket, max BUG_DAY_MAX za deň.
const BUG_TEXT_MAX = 1000, BUG_GAP_MS = 20 * 1000, BUG_DAY_MAX = 300;
const bugDay = { date: "", count: 0 };
const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : v == null ? null : String(v).slice(0, n));
// údaje zariadenia z klienta - len známe polia, orezané
function bugClient(c = {}) {
  const d = c.device || {};
  return {
    device: {
      kind: ["mobile", "tablet", "pc"].includes(d.kind) ? d.kind : "?",
      os: clip(d.os, 30), browser: clip(d.browser, 30), app: !!d.app, screen: clip(d.screen, 30), view: clip(d.view, 30),
      dpr: Number(d.dpr) || null, orient: clip(d.orient, 20), graphics: clip(d.graphics, 10), lang: clip(d.lang, 20),
    },
    ua: clip(c.ua, 300),
    screenName: clip(c.screenName, 30),
    errors: Array.isArray(c.errors) ? c.errors.slice(-5).map(e => clip(e, 300)) : [],
  };
}
function takeDataToken(token) {
  const exp = dataTokens.get(token);
  if (!exp) return false;
  dataTokens.delete(token);
  return exp >= Date.now();
}
/* -------------------- Room registry (globálna vrstva) -------------------- */
// Viac nezávislých roomiek naraz. Každá roomka je closure z createRoom(id) s vlastným herným stavom,
// osobami A/B, časovačmi a emitmi (roomEmit). Globálne ostáva len register roomiek + room-browser.
const RECLAIM_GRACE_MS = 60 * 1000;         // koľko sekúnd drží slot pre pôvodného hráča po výpadku
const browsing = new Set();                 // sockety na room-browseri (ešte neposadené v žiadnej roomke, nie diváci)
// MAINTENANCE BREAK: hrať môže len ten, kto sa prihlásil admin heslom; ostatní vidia len hlavu bota s bublinou
// (klient public/client/maintenance.js). Zapnutie = RESET ALL ROOMS (všetkých vyhodí, klienti sa obnovia a bežní hráči
// po pripojení vidia len obrazovku údržby). Zapína/vypína admin v menu ☰;
// MAINTENANCE=1 = server štartuje v údržbe (produkcia - po každom nasadení je hra zavretá, kým ju admin neotvorí).
let maintenance = process.env.MAINTENANCE === "1";
const maintWaiting = new Set();             // sockety, ktorým sa ukazuje obrazovka údržby
const maintBlocked = (socket) => maintenance && !socket.data.isAdmin;
// socket bez roomky: room-browser, alebo počas údržby obrazovka údržby
function toBrowser(socket) {
  if (maintBlocked(socket)) { browsing.delete(socket); maintWaiting.add(socket); socket.emit("maintenance", { on: true }); return; }
  maintWaiting.delete(socket);
  browsing.add(socket);
  socket.emit("rooms", roomsSnapshot());
}
function setMaintenance(on) {
  maintenance = !!on;
  for (const s of io.sockets.sockets.values()) if (s.data.isAdmin) s.emit("session", { admin: true, maintenance });
  if (maintenance) forceResetAll(); // všetky roomky preč + force_reload → po pripojení obrazovka údržby
  else { for (const s of [...maintWaiting]) toBrowser(s); broadcastRooms(); } // čakajúci rovno do room-browsera
  console.log(`maintenance ${maintenance ? "ON" : "OFF"}`);
}
const rooms = new Map();                    // id -> Room (objekt z createRoom)
let nextRoomId = 1;                         // rastúci identifikátor roomiek
const MAX_ROOMS = 2;                        // cap: max toľko bežných roomiek naraz (stála AI roomka sa nepočíta)
// stála AI roomka (docs/AI_PLAN.md): existuje vždy, hrá v nej najviac jeden človek proti botovi; po odchode hráča
// alebo admin resete sa hneď vytvorí znova čistá. V zozname roomiek ide samostatne (rooms snapshot `aiRoom`).
const AI_ROOM_ID = "ai";
// AI bot (docs/AI_PLAN.md): čas na rozmýšľanie AI_THINK_MS (default 10 s, vlastník 2026-11-03 - 4× viac výpočtu
// = ~59 % proti 1× v duele). Bot rozmýšľa od začiatku kola (počas animácie a hráčovho plánovania), nie až po jeho
// locku. Reálny čas, nie počet simulácií: e2-micro pri dlhej záťaži spomalí (burst CPU) a pevný počet simulácií
// by trval oveľa dlhšie. AI_SIMS = pevný počet simulácií namiesto času (testy, deterministická sila).
// Všetky AI roomky počítajú v jednom worker vlákne po jednom ťahu.
const AI_SIMS = process.env.AI_SIMS ? Math.max(100, Math.min(20000, Number(process.env.AI_SIMS) || 1500)) : null;
const AI_THINK_MS = Math.max(500, Math.min(30000, Number(process.env.AI_THINK_MS) || 10000));
// CHEATER: rozhodnutie s odhalenou akciou trvá CHEAT.SPY × AI_THINK_MS (+ čakanie na rozpracovaný záložný ťah) -
// keby neprišlo do tohto času, zahrá sa záložný
const SPY_GIVE_UP_MS = AI_THINK_MS + 8000;
// THE WORLD bota: hráč čaká v zastavenom čase aspoň toľko (od chvíle, keď klient dohrá úvod THE WORLD),
// kým bot „zadá" zmrazené akcie - inak pokračovacia timeline prišla skôr, ako klient prešiel do zmrazeného
// režimu, prerušila úvod a zmrazené akcie vyzerali ako bežné akcie navyše
const AI_WORLD_WAIT_MS = 5000;

// Validácia zobrazovaného mena: 1–8 znakov anglickej abecedy, nič iné (žiadne emoji/diakritika/medzery).
function validateName(raw) {
  if (typeof raw !== "string") return null;
  const n = raw.trim();
  return /^[A-Za-z]{1,8}$/.test(n) ? n : null;
}
// Admin = hráč prihlásený admin heslom (ADMIN_KEY) namiesto hesla hráča; môže aj normálne hrať.
// Bez nastaveného ADMIN_KEY nie je adminom nikto (admin reset vypnutý). Heslo patrí do env na serveri, nie do repa.
function okAdmin(keyFromClient) {
  return !!ADMIN_KEY && ADMIN_KEY === keyFromClient;
}

/* ==================== Room factory ==================== */
// Celý herný stav a logika žijú v closure jednej roomky. Funkcie referencujú `game`, `personSockets`,
// `turnTimer`… lexikálne - každá roomka má vlastnú kópiu. Globálne konštanty (HP/mana/CHARS/*_MS…) a
// pure helpery (validateName, okAdmin, rollTileType…) sa čítajú z module scope cez closure.
// ai = roomka proti AI botovi: bot sedí ako osoba B (virtuálny socket, engine/ai/seat.js)
function createRoom(id, { ai = false, slot = null } = {}) {
  const botPerson = ai ? "B" : null;
  // obťažnosť bota (docs/AI_PLAN.md, „Obťažnosť BABY"): hráč ju vyberie pri vstupe (join_room { level }) -
  // okno CHOOSE DIFFICULTY po kliknutí na hlavu bota; platí, kým roomka žije (po odchode hráča vznikne nová, normal)
  let aiLevel = "normal";
  /* -------------------- Game state (per-room) -------------------- */
  // identita hráča je „osoba" A/B (A = prvý pripojený = host); slot p1/p2 je len ľavá/pravá rola,
  // ktorá sa medzi hrami série prehadzuje (štartér danej hry vždy sedí v p1 = vľavo)
  let personSockets = { A: null, B: null };
  // trvalá identita hráča: token z klientovho localStorage → po reconnecte mu vrátime jeho slot
  let personIds = { A: null, B: null };       // token klienta priradený osobe A/B
  let personNames = { A: null, B: null };     // validované zobrazované meno osoby (A–Z, max 8) - verejné, ide do snapshotu
  let personFreedAt = { A: 0, B: 0 };         // kedy sa slot uvoľnil (grace, počas ktorej ho cudzí klient neobsadí)
  let roomDestroyTimer = null;                // po odpojení oboch: po grace roomku zruší
  let pendingMatchConfig = null;              // host stlačil START, ale 2. hráč ešte nie je → čaká sa; po jeho príchode sa spustí
  const spectators = new Set();               // diváci tejto roomky (dostávajú nemaskovaný stav cez roomEmit)

  const engine = createRecordedEngine({
    emit: (ev, payload) => { noteIntro(ev, payload); roomEmit(ev, payload); },
    emitState: (timeline) => { noteWorldPause(timeline); emitStateMasked(timeline); },
    emitYouAre: () => emitYouAre(),
    clearTurnTimer: () => clearTurnTimer(),
    beginPlanningTimer: (extraMs) => beginPlanningTimer(extraMs),
    armTurnTimer: (ms) => armTurnTimer(ms),
    timerRemainingMs: () => timerRemainingMs(),
    names: () => personNames,
    awaitingOpponent: () => pendingMatchConfig != null,
    vsAi: () => (ai ? slotForPerson(botPerson) : null), // slot bota (snapshot vsAi)
    aiLevel: () => (ai ? aiLevel : null),               // obťažnosť bota (snapshot aiLevel)
  }, { sink: telemetry ? (rec) => telemetry.append(rec) : null, meta: telemetryMeta, aiPerson: botPerson, aiLevel: () => aiLevel });
  const { snapshot, snapshotFor, redactTimelineFor, slotForPerson, startMatch, newGame, sanitizeConfig } = engine;

  // per-room emit: nahrádza io.emit - pošle len hráčom A/B a divákom TEJTO roomky (nie cudzím)
  function roomEmit(ev, payload) {
    for (const p of ["A", "B"]) { const s = personSockets[p]; if (s) { try { s.emit(ev, payload); } catch {} } }
    for (const s of spectators) { try { s.emit(ev, payload); } catch {} }
  }

// pošli každej osobe jej slot (vylosovaný v startMatch, fixný na celú sériu) + či je host (host = osoba A)
function emitYouAre() {
  for (const person of ["A", "B"]) {
    const sock = personSockets[person];
    if (sock) sock.emit("you_are", { slot: slotForPerson(person), isHost: person === "A" });
  }
}

// pošli stav (voliteľne s timeline) obom osobám, každej s vlastným maskovaním (char-select pick,
// labyrint redakcia, vlastná trojica HP magov); divákom (ostatné sockety) neutrálny plný snapshot
function emitStateMasked(timeline = null) {
  const plain = snapshot();
  // hráči A/B tejto roomky - maskovaný snapshot (labyrint/klon/pasca redakcia per osoba)
  for (const person of ["A", "B"]) {
    const sock = personSockets[person];
    if (!sock) continue;
    let payload = snapshotFor(person);
    if (timeline) payload = { ...payload, timeline: redactTimelineFor(slotForPerson(person), timeline) };
    sock.emit("state", payload);
  }
  // diváci tejto roomky - nemaskovaný stav (počas prípravy hry za oponou)
  const specPayload = spectatorView(timeline ? { ...plain, timeline } : plain);
  for (const s of spectators) { try { s.emit("state", specPayload); } catch {} }
}

/* ---- Divácka opona (docs/RANDOM_ARENA_PLAN.md §5) ---- */
// Kým sa hra pripravuje (draft tímov, výber postáv, animácie losovania arény / farieb / postáv u hráčov),
// divák nevidí plochu ani postavy - len stav oboch strán. Koniec animácií sa odvodí z tých istých udalostí,
// ktoré dostanú klienti (arena_roll / color_roll / char_roll) a z tých istých dĺžok, o ktoré engine posúva
// časovač ťahu. Čisto prezentácia servera - engine ani replay telemetrie sa to netýka.
let introEndsAt = 0;
let curtainTimer = null;
function noteIntro(ev, p) {
  const arena = p?.afterArena ? ARENA_ROLL_MS : 0, color = p?.afterColor ? COLOR_ROLL_MS : 0;
  const ms = ev === "arena_roll" ? ARENA_ROLL_MS
    : ev === "color_roll" ? (p?.animate ? arena + COLOR_ROLL_MS : arena)
    : ev === "char_roll" ? arena + color + charRollMs() : 0;
  if (!ms) return;
  introEndsAt = Math.max(introEndsAt, Date.now() + ms);
  // po dobehnutí animácií opona padne sama (ak už obaja majú postavu) - diváci dostanú čerstvý stav
  if (curtainTimer) clearTimeout(curtainTimer);
  curtainTimer = setTimeout(() => {
    curtainTimer = null;
    const view = spectatorView(snapshot());
    for (const s of spectators) { try { s.emit("state", view); } catch {} }
  }, introEndsAt - Date.now() + 50);
}
// stav strany pod oponou: drafting / choosing / drawing (náhodné postavy ešte bežia) / ready
function curtainSide(g, slot) {
  if (g.phase === "team_select") return g.roster?.[g.seats[slot]] ? "ready" : "drafting";
  if (!g.players[slot]?.char) return "choosing";
  // náhodné postavy: pridelené hneď, ale hráč ich ešte len losuje (animácia); ručný výber = hotovo
  return g.config?.randomChars && Date.now() < introEndsAt ? "drawing" : "ready";
}
function curtainUp(g) {
  if (g.phase === "team_select") return true;
  if (g.phase !== "playing") return false;
  return !g.players.p1.char || !g.players.p2.char || Date.now() < introEndsAt;
}
// snapshot pre diváka: pod oponou bez postáv a tímov (nič neprezradí skôr ako hráčom) + stav oboch strán
function spectatorView(snap) {
  const g = engine.game;
  if (!curtainUp(g)) return snap;
  const hide = (p) => p && { ...p, char: null, clone: null, trap: null };
  return { ...snap, p1: hide(snap.p1), p2: hide(snap.p2), roster: null, mageDead: null, rosterHp: null, rosterMana: null,
    curtain: { white: curtainSide(g, "p1"), black: curtainSide(g, "p2") } };
}

/* ---- Admin: tvrdý reset TEJTO roomky (odpojí oboch hráčov, zruší časovače) ---- */
// Globálny forceResetAll() (mimo factory) volá forceReset() na každej roomke a vyprázdni register.
function forceReset() {
  engine.abort("admin_reset");
  clearTurnTimer();
  // všetci v roomke (hráči aj diváci) si vynútene obnovia stránku (force_reload → location.reload) - načítajú
  // novú verziu klienta a po reloade skončia na room-browseri; odpojenie až chvíľu po správe, nech dorazí
  for (const s of [personSockets.A, personSockets.B, ...spectators]) forceReloadSocket(s);
  spectators.clear();
  personSockets.A = null;
  personSockets.B = null;
  personIds.A = null;
  personIds.B = null;
  personNames.A = null;
  personNames.B = null;
  personFreedAt.A = 0;
  personFreedAt.B = 0;
  if (roomDestroyTimer) { clearTimeout(roomDestroyTimer); roomDestroyTimer = null; }
  pendingMatchConfig = null;
}

/* -------------------- Turn timer (server-side enforcement) -------------------- */
// časovač beží na serveri (nezávisle od fokusu tabu); klient si robí len vlastný displej + skorší auto-lock.
// backstop tu garantuje, že kolo sa vyhodnotí, aj keď je niektorý tab na pozadí (throttle rAF) alebo odpojený.
const TIMER_GRACE_MS = 2500; // server strieľa o čosi neskôr než klient, nech foreground tab stihne auto-lock s rozpracovanou frontou
let turnTimer = null;
let turnDeadline = null; // Date.now() času, kedy má klient odpočítavať/auto-locknúť (bez grace); zdieľané s klientom

function timerRemainingMs() { return turnDeadline ? Math.max(0, turnDeadline - Date.now()) : null; }

function clearTurnTimer() {
  if (turnTimer) { clearTimeout(turnTimer); turnTimer = null; }
  turnDeadline = null;
  roomEmit("turn_timer", { ms: null });
}

// naplánuj backstop pre práve začínajúce kolo; extraMs = čas, kým klient dohrá timeline (počas neho neplánuje)
function beginPlanningTimer(extraMs = 0) {
  const t = engine.game.config?.timer;
  if (t === "30" || t === "60" || t === "120") {
    armTurnTimer(extraMs + parseInt(t, 10) * 1000);
  } else {
    clearTurnTimer(); // "off"/"quickdraw" -> teraz žiadny limit (quickdraw sa nasadí až po locku)
  }
}
// intendedMs = čas, ktorý klient odpočítava a po ktorom auto-lockne; server backstop strieľa o grace neskôr
function armTurnTimer(intendedMs) {
  if (turnTimer) clearTimeout(turnTimer);
  turnDeadline = Date.now() + intendedMs;
  turnTimer = setTimeout(onTurnTimeout, intendedMs + TIMER_GRACE_MS);
  roomEmit("turn_timer", { ms: intendedMs });
}

function onTurnTimeout() {
  turnTimer = null;
  turnDeadline = null;
  flushBotRound(); // AI roomka: podržaný ťah bota ide pred automatickým zamknutím (inak by ho prepísali passy)
  engine.autoLock();
}

  /* -------------------- Room lifecycle (per-room, closure) -------------------- */
  // Je osoba p „nažive" - má živý socket, alebo ešte beží jej grace okno (môže sa vrátiť reconnectom)?
  function personAlive(p) {
    return !!personSockets[p] || (!!personIds[p] && Date.now() - personFreedAt[p] <= RECLAIM_GRACE_MS);
  }
  // obaja hráči preč (ani jeden nažive) → roomka je prázdna
  function roomEmpty() { return ["A", "B"].filter(p => p !== botPerson).every(p => !personAlive(p)); } // bot sa nepočíta
  // riadok tejto roomky pre room-browser (počet hráčov, či sa dá pripojiť)
  function roomsRow() {
    if (ai) return { id, players: personAlive("A") ? 1 : 0, max: 1, canJoin: isFree("A"), phase: engine.game.phase, ai: true, level: aiLevel };
    const players = ["A", "B"].filter(personAlive).length;
    // slot = pevné miesto v room-browseri (ROOM 1…MAX_ROOMS, číslo sa nemení, kým roomka žije); mená sediacich hráčov
    // names = [host, druhý hráč] po stranách (prázdne miesto = null) - room browser ich píše vedľa štvorčekov
    const names = ["A", "B"].map(p => (personAlive(p) ? personNames[p] || null : null));
    return { id, slot, players, max: 2, canJoin: players < 2, phase: engine.game.phase, names, info: roomInfo() };
  }
  // nastavenia zápasu pre dlaždicu v room-browseri (public/client/room-tiles.js): známe, keď host stlačil START
  // (čaká na súpera - pendingMatchConfig) alebo zápas beží (game.config); kým host nastavuje, null = SETTING UP…
  // color = farba, ktorú dostane ten, kto sa pripojí (host si vybral bielu → pripájajúci čierna)
  function roomInfo() {
    const cfg = engine.game.phase === "lobby" ? pendingMatchConfig : engine.game.config;
    if (!cfg) return null;
    const color = cfg.colorPref === "white" ? "black" : cfg.colorPref === "black" ? "white" : "random";
    // custom = aréna má zmenené ADVANCED SETTINGS (hocičo, aj zákazy postáv) → oranžový štvorček na badge arény
    return { arena: cfg.arena === "random" ? "random" : cfg.arena || "bridge", color, chars: cfg.randomChars ? "random" : "manual", timer: cfg.timer ?? "off",
      ...(matchConfigCustom(cfg) ? { custom: true } : {}) };
  }
  // voľné miesto (nie je obsadené živým socketom ani grace-held tokenom)
  function isFree(p) { return !personSockets[p] && (!personIds[p] || Date.now() - personFreedAt[p] > RECLAIM_GRACE_MS); }
  // token už patrí niektorej osobe tejto roomky? → vráť "A"/"B" (reclaim po reconnecte), inak null
  function reclaimPersonFor(cid) {
    if (!cid) return null;
    if (personIds.A === cid) return "A";
    if (personIds.B === cid) return "B";
    return null;
  }
  // po odpojení naplánuj kontrolu: ak sú po grace obaja stále preč, roomku zruš
  function scheduleRoomDestroyCheck() {
    if (roomDestroyTimer) clearTimeout(roomDestroyTimer);
    roomDestroyTimer = setTimeout(() => {
      roomDestroyTimer = null;
      if (roomEmpty()) destroySelf();
    }, RECLAIM_GRACE_MS + 500);
  }
  // zruš túto roomku: vyčisti stav a časovače, odstráň z registra, diváci sa vrátia na room-browser
  function destroySelf() {
    engine.abort("abandoned");
    if (botTimer) { clearTimeout(botTimer); botTimer = null; } botPending = null; clearWorldTimer();
    if (spyTimer) { clearTimeout(spyTimer); spyTimer = null; }
    if (botPerson) personSockets[botPerson]?.disconnect?.(); // ukonči worker bota
    clearTurnTimer();
    if (roomDestroyTimer) { clearTimeout(roomDestroyTimer); roomDestroyTimer = null; }
    personSockets.A = null; personSockets.B = null;
    personIds.A = null; personIds.B = null;
    personNames.A = null; personNames.B = null;
    personFreedAt.A = 0; personFreedAt.B = 0;
    pendingMatchConfig = null;
    // prípadní diváci → späť na room-browser
    for (const s of spectators) { try { s.data.roomId = null; s.data.spectating = false; s.leave(String(id)); toBrowser(s); } catch {} }
    spectators.clear();
    rooms.delete(id);
    if (ai) ensureAiRoom(); // stála AI roomka sa hneď vytvorí znova (čistá) - broadcastne aj zoznam
    else broadcastRooms();
  }
  // ak host čaká (stlačil START pred príchodom súpera) a sú už obaja → spusti zápas (color roll)
  function maybeStartPending() {
    if (pendingMatchConfig && personAlive("A") && personAlive("B") && engine.game.phase === "lobby") {
      const cfg = pendingMatchConfig;
      pendingMatchConfig = null;
      startMatch(cfg);
    }
  }

  // posadí socket ako osobu A/B do TEJTO roomky: zapamätá token+meno, pošle mu identitu a stav
  function seat(socket, p) {
    const cid = socket.handshake.auth?.id || null;
    const old = personSockets[p];
    if (old && old !== socket) { try { old.disconnect(true); } catch {} } // odpoj starý/mŕtvy socket tej istej osoby
    personSockets[p] = socket;
    personIds[p] = cid;
    if (socket.data.pendingName) personNames[p] = socket.data.pendingName; // pri recovery pendingName prázdne → drž pôvodné
    socket.data.person = p;
    socket.data.roomId = id;
    socket.data.spectating = false;
    spectators.delete(socket);
    browsing.delete(socket);
    socket.join(String(id));
    socket.emit("you_are", { slot: slotForPerson(p), isHost: p === "A" });
    socket.emit("state", snapshotFor(p)); // počas char-selectu maskuje súperov pick
    if (p === "B") maybeStartPending(); // 2. hráč dorazil → ak host čakal, spusti zápas
    broadcastSpectators();
  }

  // oko s počtom divákov (hráči aj diváci) + či je voľné miesto (divák vidí TAKE SEAT)
  function broadcastSpectators() {
    roomEmit("spectators", { count: spectators.size, seatFree: isFree("A") || isFree("B") });
  }

  // pripoj sa do tejto roomky ako 2. hráč (osoba B; ak host odišiel a B ostal, obsadí A)
  function join(socket, level) {
    if (socket.data.person) return;
    // AI roomka: hráč si sadá k botovi → nastav obťažnosť (len pred zápasom, keď je miesto hosta voľné)
    if (ai && isFree("A") && engine.game.phase === "lobby") setAiLevel(level);
    if (isFree("B")) { seat(socket, "B"); broadcastRooms(); }
    else if (isFree("A")) { seat(socket, "A"); broadcastRooms(); }
    else socket.emit("join_denied", "full");
  }

  // sleduj túto roomku ako divák
  function spectate(socket) {
    if (socket.data.person) return;
    browsing.delete(socket);
    spectators.add(socket);
    socket.data.roomId = id;
    socket.data.spectating = true;
    socket.join(String(id));
    socket.emit("spectator", { roomId: id }); // roomId → klient sa po reloade vráti sledovať tú istú roomku
    socket.emit("state", spectatorView(snapshot()));
    broadcastSpectators();
  }

  // divák si sadne na voľné miesto (hráč odišiel / host čaká na súpera) - rovnaké pravidlá ako join z room-browsera
  function takeSeat(socket) {
    if (!spectators.has(socket)) return;
    const p = isFree("B") ? "B" : isFree("A") ? "A" : null;
    if (!p) { socket.emit("join_denied", "full"); return; }
    seat(socket, p); // vyradí ho z divákov a pošle you_are + state
    broadcastRooms();
  }

  // opusti roomku (hráč aj divák) → miesto sa uvoľní hneď, socket ide späť na room-browser
  function leave(socket) {
    const p = socket.data.person;
    if (spectators.delete(socket)) { /* divák */ }
    if (p) {
      if (personSockets[p] === socket) personSockets[p] = null;
      personIds[p] = null; personFreedAt[p] = 0; personNames[p] = null; // dobrovoľný odchod → bez grace
      socket.data.person = null;
      clearTurnTimer();
      if (p === "A" && engine.game.phase === "lobby") {
        pendingMatchConfig = null; // START hosta, ktorý odišiel, už neplatí
        // druhý hráč čakal na hosta → stane sa hostom on (inak by čakal na nikoho); zápas ešte nezačal, nič iné
        // sa na osobu neviaže
        const sb = personSockets.B;
        if (!ai && sb && personAlive("B")) {
          personSockets.A = sb; personIds.A = personIds.B; personNames.A = personNames.B; personFreedAt.A = 0;
          personSockets.B = null; personIds.B = null; personNames.B = null; personFreedAt.B = 0;
          sb.data.person = "A";
          emitYouAre();
          emitStateMasked();
        }
      }
    }
    socket.data.roomId = null;
    socket.data.spectating = false;
    socket.leave(String(id));
    toBrowser(socket); // room-browser, počas údržby obrazovka údržby
    if (roomEmpty()) destroySelf(); else { broadcastRooms(); broadcastSpectators(); } // ak ostal sám nikto → zruš; inak uprav počet
  }

  /* -------------------- Herné handlery (per-room, dispatchnuté z io.on) -------------------- */
  // úvodná obrazovka: host nastaví formát + tiles + časový limit a spustí zápas
  function onConfigure(socket, raw) {
    if (socket.data.person !== "A") return;   // konfiguruje len host
    if (engine.game.phase !== "lobby") return;        // len pred začiatkom zápasu
    // proti AI: všetky arény (aj kocka) aj všetky formáty vrátane turnaja (bot draftuje tím a swapuje - docs/AI_PLAN.md 8d)
    const config = sanitizeConfig(raw);
    if (!config) return;
    if (personAlive("B")) {
      startMatch(config);                       // súper je tu → rovno štart (color roll)
    } else {
      pendingMatchConfig = config;              // súper ešte nie je → zapamätaj config a čakaj naňho
      socket.emit("state", snapshotFor("A"));   // host uvidí „čakám na druhého hráča" (awaitingOpponent)
    }
    broadcastRooms(); // dlaždica roomky v room-browseri ukáže nastavenia zápasu (namiesto SETTING UP…)
  }

  function onChooseTeam(socket, keys) { engine.chooseTeam(socket.data.person, keys); }

  function onChooseCharacter(socket, key) { engine.chooseCharacter(socket.data.person, key); }

  function onLockIn(socket, queue, clientTurn, ack) {
    engine.lockIn(socket.data.person, queue, clientTurn, ack);
    if (!ai || socket.data.person === botPerson) return;
    if (aiLevel === "cheater") { spyOnLock(); return; } // CHEATER: bot rozhodne až s jednou hráčovou akciou
    if (botPending) releaseBotRound(); // hráč zamkol → bot „dopremýšľa"
  }

  function onTimestopActions(socket, queue, ack) { engine.timestopActions(socket.data.person, queue, ack); }

  function onDraftQueue(socket, d) { engine.draftQueue(socket.data.person, d); }

  function onRetry(socket) {
    if (!socket.data.person) return; // divák hru reštartovať nesmie
    clearTurnTimer();
    if (botTimer) { clearTimeout(botTimer); botTimer = null; } botPending = null; clearWorldTimer(); // starý podržaný ťah bota
    newGame();
    roomEmit("reset");
    roomEmit("state", snapshot());
  }

  function onDisconnect(socket) {
    if (spectators.delete(socket)) { broadcastSpectators(); return; } // divák odišiel - počet hráčov sa nezmenil
    const wasPlayer = personSockets.A === socket || personSockets.B === socket;
    // uvoľni len živý socket; personIds zámerne NEmažeme → hráč si po reconnecte (do grace) vyžiada svoj slot späť
    if (personSockets.A === socket) { personSockets.A = null; personFreedAt.A = Date.now(); }
    if (personSockets.B === socket) { personSockets.B = null; personFreedAt.B = Date.now(); }
    if (wasPlayer) {
      clearTurnTimer();            // bez hráča nemá zmysel auto-resolve; odpojenie diváka časovač neruší
      scheduleRoomDestroyCheck();  // ak sa obaja odpojili → po grace roomku zruš
      // po grace sa miesto uvoľní aj pre cudzích → diváci uvidia TAKE SEAT
      setTimeout(() => { if (rooms.get(id)) broadcastSpectators(); }, RECLAIM_GRACE_MS + 100);
    }
    broadcastRooms();              // ostatní na room-browseri vidia aktuálny počet hráčov
  }

  /* -------------------- AI bot (osoba B v AI roomke) -------------------- */
  // čiastočná timeline THE WORLD (končí timestop_wait): klient ju prehráva súčet delayMs (+ rezerva na úvod
  // kola, napr. premenu Escanora) - až potom začne zmrazený čas; od tej chvíle bot čaká AI_WORLD_WAIT_MS
  let worldReadyAt = 0, worldTimer = null;
  function noteWorldPause(timeline) {
    if (!ai || !Array.isArray(timeline) || engine.game.timestop?.mode !== "waiting") return;
    const playMs = timeline.reduce((acc, f) => acc + (f.delayMs ?? 600), 0);
    worldReadyAt = Date.now() + playMs + 1500 + AI_WORLD_WAIT_MS;
  }
  function clearWorldTimer() { if (worldTimer) { clearTimeout(worldTimer); worldTimer = null; } }
  // rozhodnutie z workera zahrá cez rovnaké príkazy enginu ako socket hráča; zastarané (iné kolo/hra) zahodí
  function onBotDecision(d) {
    const g = engine.game, person = botPerson;
    // turnajový draft (náhodný tím) - pred hernou fázou
    if (d.kind === "team") { if (person && g.phase === "team_select") engine.chooseTeam(person, d.team); return; }
    if (!person || g.phase !== "playing" || (g.series?.gameIndex ?? 1) !== d.game) return;
    // zdôvodnenie ťahu bota k zápasu (bug reporty z AI roomky: tools/bugs.mjs ho vypíše pri hlásení)
    if (d.why) telemetry?.append({ t: "bot", ts: new Date().toISOString(), commit: telemetryMeta.commit, match: engine.matchId || null,
      g: d.game, turn: d.turn, side: g.seats?.p1 === person ? "white" : "black", ...d.why });
    if (d.kind === "character") { engine.chooseCharacter(person, d.char); return; }
    if (d.kind === "timestop") {
      const wait = worldReadyAt - Date.now();
      if (wait > 0) { clearWorldTimer(); worldTimer = setTimeout(() => { worldTimer = null; playBotWorld(d); }, wait); return; }
      playBotWorld(d);
      return;
    }
    // ťah kola bot NEzamyká skôr ako hráč
    // (hráč nikdy nevidí „OPPONENT IS READY" a bot mu nespúšťa odpočet
    // quick-draw): rozhodnutie sa podrží a zahrá sa až po hráčovom zamknutí (releaseBotRound)
    botPending = d;
    // CHEATER: ťah bez odhalenej akcie je len záloha (zahrá ju flush pri vypršaní času), hrá sa až ťah so spy
    const turnKey = `${d.game}:${d.turn}`;
    if (aiLevel === "cheater" && !d.cheat && spyGaveUp !== turnKey) return;
    if (d.cheat && spyTimer) { clearTimeout(spyTimer); spyTimer = null; }
    const human = g.players[slotForPerson(person === "A" ? "B" : "A")];
    if (human.locked) releaseBotRound();
  }
  // CHEATER (docs/AI_PLAN.md 8c): hráč práve zamkol → botovi ide JEDNA náhodná akcia jeho fronty (bez golden
  // doplnkov; typ + smer / bunka). Náhoda je mimo enginu (crypto) - hru nemení, replay telemetrie ju nepotrebuje
  // (ťah bota je v logu ako jeho lock). Bot rozhodne znova a zamkne cez onBotDecision (d.cheat) + releaseBotRound.
  function spyOnLock() {
    const g = engine.game, human = g.players[slotForPerson(botPerson === "A" ? "B" : "A")];
    if (g.phase !== "playing" || !human?.locked || !human.queue?.length || g.timestop) return;
    const idx = crypto.randomInt(human.queue.length), game = g.series?.gameIndex ?? 1, turn = g.turn;
    botSock?.spy({ turn, game, idx, action: { ...human.queue[idx] } });
    // poistka: keby rozhodnutie so spy neprišlo (worker zlyhal), po čase sa zahrá záložný ťah - hra nezamrzne
    if (spyTimer) clearTimeout(spyTimer);
    spyTimer = setTimeout(() => {
      spyTimer = null;
      spyGaveUp = `${game}:${turn}`;
      if (botPending?.turn === turn && botPending?.game === game) releaseBotRound();
    }, SPY_GIVE_UP_MS);
  }
  let spyTimer = null, spyGaveUp = null;
  function playBotWorld(d) {
    const g = engine.game, person = botPerson;
    if (!person || g.phase !== "playing" || (g.series?.gameIndex ?? 1) !== d.game) return;
    if (g.timestop?.mode !== "waiting" || g.timestop.slot !== slotForPerson(person)) return;
    let ok = false;
    engine.timestopActions(person, d.queue, (r) => { ok = !!r?.ok; });
    if (!ok && g.timestop?.mode === "waiting" && g.timestop.slot === slotForPerson(person))
      engine.timestopActions(person, [{ type: "recharge" }, { type: "shield" }, { type: "move", dir: "up" }]);
  }
  // hráč zamkol: bot zamkne po krátkom náhodnom „dopremýšľaní" (0,6-1,5 s; náhodné, nezávislé od ťahu -
  // dĺžka nesmie prezrádzať, čo bot hrá)
  function releaseBotRound() {
    if (botTimer) return;
    botTimer = setTimeout(() => { botTimer = null; flushBotRound(); }, 600 + Math.random() * 900);
  }
  function flushBotRound() {
    if (botTimer) { clearTimeout(botTimer); botTimer = null; }
    const d = botPending;
    botPending = null;
    if (!d) return;
    const g = engine.game, person = botPerson;
    if (!person || g.phase !== "playing" || (g.series?.gameIndex ?? 1) !== d.game || g.turn !== d.turn) return;
    let ok = false;
    engine.lockIn(person, d.queue, d.turn, (r) => { ok = !!r?.ok; });
    const me = g.players[slotForPerson(person)];
    if (!ok && g.turn === d.turn && !me.locked) {
      // poistka (nemalo by nastať): platná fronta z kameňov + passov, nech hra nezamrzne
      console.error("[ai] engine odmietol frontu bota:", JSON.stringify(d.queue));
      const stone = Math.min(3, me.stone || 0);
      engine.lockIn(person, Array.from({ length: 3 }, (_, i) => ({ type: i < stone ? "stoned" : "pass" })), d.turn);
    }
  }
  let botPending = null, botTimer = null; // podržaný ťah kola bota (čaká na hráčovo zamknutie)
  let seatBot = null, botSock = null;
  function setAiLevel(level) {
    aiLevel = level === "baby" || level === "cheater" ? level : "normal";
    personNames[botPerson] = { baby: "BABY", cheater: "CHEATER" }[aiLevel] || "AI"; // meno bota v HUD
    botSock?.setLevel(aiLevel);
  }
  if (ai) {
    const sock = createBotSeat({ botOpts: { seed: crypto.randomInt(2 ** 31), ...(AI_SIMS ? { budgetSims: AI_SIMS, budgetMs: 1000 } : { budgetMs: AI_THINK_MS }) }, onDecision: (d) => onBotDecision(d) });
    sock.data.pendingName = "AI";
    botSock = sock;
    seatBot = () => seat(sock, botPerson);
  }

  // kontext pre bug report: zápas v telemetrii (replay), hra, kolo, fáza a strana hlásiaceho (bez identity)
  function bugContext(socket) {
    const g = engine.game;
    const person = personSockets.A === socket ? "A" : personSockets.B === socket ? "B" : null;
    const side = person ? (g.seats?.p1 === person ? "white" : g.seats?.p2 === person ? "black" : null) : (spectators.has(socket) ? "spectator" : null);
    return { room: id, match: engine.matchId || engine.lastMatchId || null, g: g.series?.gameIndex ?? null, turn: g.turn ?? null, phase: g.phase,
      arena: g.config?.arena || "bridge", side, chars: { white: g.players?.p1?.char || null, black: g.players?.p2?.char || null } };
  }

  return {
    id, ai, slot, seatBot, roomsRow, reclaimPersonFor, seat, join, spectate, takeSeat, leave, forceReset, bugContext,
    isEmpty: roomEmpty, onConfigure, onChooseTeam, onChooseCharacter, onLockIn, onTimestopActions, onDraftQueue, onRetry, onDisconnect,
  };
}
/* ==================== koniec Room factory ==================== */

/* -------------------- Room registry (globálne) -------------------- */
// zoznam roomiek pre room-browser + či sa dá vytvoriť nová (limit MAX_ROOMS)
function roomsSnapshot() {
  const list = [];
  for (const room of rooms.values()) if (!room.ai) list.push(room.roomsRow());
  list.sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
  return { rooms: list, slots: MAX_ROOMS, canCreate: list.length < MAX_ROOMS, aiRoom: rooms.get(AI_ROOM_ID)?.roomsRow() || null };
}
// stála AI roomka: vytvor, ak chýba (štart servera, odchod hráča, admin reset); bot si v nej hneď sadne (osoba B)
function ensureAiRoom() {
  if (rooms.has(AI_ROOM_ID)) return;
  const room = createRoom(AI_ROOM_ID, { ai: true });
  rooms.set(room.id, room);
  room.seatBot();
  broadcastRooms();
}
// pošli aktuálny zoznam roomiek všetkým na room-browseri (nie posadeným hráčom ani divákom)
function broadcastRooms() {
  const snap = roomsSnapshot();
  for (const s of browsing) { try { s.emit("rooms", snap); } catch {} }
}
// admin: tvrdý reset VŠETKÝCH roomiek (odpojí hráčov, vyprázdni register)
function forceResetAll() {
  for (const room of rooms.values()) room.forceReset();
  rooms.clear();
  ensureAiRoom();
  for (const s of browsing) { try { s.emit("force_reload"); } catch {} } // reload aj pre ľudí na room-browseri
}
// admin reset: klient obnoví stránku; socket sa odpojí o chvíľu (emit musí odísť skôr než zatvorenie spojenia)
function forceReloadSocket(s) {
  if (!s) return;
  try { s.emit("force_reload"); } catch {}
  setTimeout(() => { try { s.disconnect(true); } catch {} }, 300);
}
function roomForSocket(socket) { return rooms.get(socket.data.roomId) || null; }

/* -------------------- Admin endpoint -------------------- */
app.get("/admin/reset-all", (req, res) => {
  if (!okAdmin(req.query.key)) return res.status(403).send("forbidden");
  forceResetAll();
  res.send("ok");
});

// stiahnutie zozbieraných dát: všetky denné JSONL súbory spojené a zbalené (gzip). Prístup admin heslom
// (?key=, pre skripty) alebo jednorazovým tokenom z menu ☰ (?token=); voliteľne ?from=YYYY-MM-DD.
app.get("/admin/data", (req, res) => {
  if (!okAdmin(req.query.key) && !takeDataToken(String(req.query.token || ""))) return res.status(403).send("forbidden");
  if (!telemetry) return res.status(404).send("telemetry off (TELEMETRY_DIR not set)");
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "") ? req.query.from : null;
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="arena-data-${new Date().toISOString().slice(0, 10)}.jsonl.gz"`);
  res.setHeader("Cache-Control", "no-store");
  telemetry.pipeGzip(res, from);
});

/* -------------------- IO -------------------- */
// Brána: heslo (ak je nejaké nastavené) + platné meno. Odmietnuté spojenie klient dostane ako `connect_error`
// s message "bad_pass" / "bad_name". Pozn.: pri connectionStateRecovery sa middleware preskočí (skipMiddlewares),
// vtedy sa meno neprepisuje (guard v seat) - recovnutý socket už bol overený.
io.use((socket, next) => {
  const pass = socket.handshake.auth?.pass;
  // admin heslo platí aj ako vstupné heslo (admin môže normálne hrať)
  if (!okAdmin(pass) && PLAYER_KEYS.size && !PLAYER_KEYS.has(pass)) return next(new Error("bad_pass"));
  const name = validateName(socket.handshake.auth?.name);
  if (!name) return next(new Error("bad_name"));
  socket.data.pendingName = name;
  next();
});

io.on("connection", (socket) => {
  const cid = socket.handshake.auth?.id || null; // trvalý token klienta (localStorage)
  socket.data.person = null;
  socket.data.roomId = null;
  // admin = prihlásený admin heslom; počíta sa z handshake pri každom pripojení (aj pri connectionStateRecovery,
  // kde sa middleware preskočí) a klient podľa toho ukáže admin sekciu menu / reset tlačidlá
  socket.data.isAdmin = okAdmin(socket.handshake.auth?.pass);
  socket.emit("session", { admin: socket.data.isAdmin, ...(socket.data.isAdmin ? { maintenance } : {}) });

  // reclaim naprieč roomkami: token už patrí hráčovi v niektorej žijúcej roomke → vráť ho rovno na miesto
  let placed = false;
  if (cid) {
    for (const room of rooms.values()) {
      const p = room.reclaimPersonFor(cid);
      if (p) { room.seat(socket, p); placed = true; break; }
    }
  }
  // nový príchod → room-browser (create/join/spectate), počas údržby (bežný hráč) obrazovka údržby
  if (!placed) toBrowser(socket);
  broadcastRooms();

  // --- Room lifecycle (globálny routing) ---
  // arg.slot (voliteľné) = klik na prázdnu dlaždicu ROOM n; obsadený/neplatný slot → najnižší voľný
  socket.on("create_room", (arg) => {
    if (socket.data.person || socket.data.roomId) return; // už niekde je
    if (maintBlocked(socket)) return;                    // údržba: nové roomky len admin
    if (!roomsSnapshot().canCreate) return;               // limit počtu (bežných) roomiek
    const used = new Set([...rooms.values()].filter(r => !r.ai).map(r => r.slot));
    const free = Array.from({ length: MAX_ROOMS }, (_, i) => i + 1).filter(n => !used.has(n));
    const slot = free.includes(arg?.slot) ? arg.slot : free[0];
    const room = createRoom(nextRoomId++, { slot });
    rooms.set(room.id, room);
    room.seat(socket, "A"); // tvorca = host (osoba A) a nastaví parametre zápasu
    broadcastRooms();
  });
  socket.on("join_room", (arg) => {
    if (socket.data.person || socket.data.roomId) return;
    if (maintBlocked(socket)) return;
    const room = rooms.get(arg?.roomId);
    if (!room) return;
    room.join(socket, arg?.level);
  });
  socket.on("spectate_room", (arg) => {
    if (socket.data.person || socket.data.roomId) return;
    if (maintBlocked(socket)) return;
    const room = rooms.get(arg?.roomId);
    if (!room) return;
    room.spectate(socket);
  });
  socket.on("take_seat", () => { if (socket.data.spectating && !maintBlocked(socket)) roomForSocket(socket)?.takeSeat(socket); });
  socket.on("leave_room", () => { roomForSocket(socket)?.leave(socket); });

  // --- Herné eventy (dispatch do roomky socketu) ---
  socket.on("configure_match", (raw) => roomForSocket(socket)?.onConfigure(socket, raw));
  socket.on("choose_team", (keys) => roomForSocket(socket)?.onChooseTeam(socket, keys));
  socket.on("choose_character", (key) => roomForSocket(socket)?.onChooseCharacter(socket, key));
  socket.on("lock_in", (queue, clientTurn, ack) => roomForSocket(socket)?.onLockIn(socket, queue, clientTurn, ack));
  socket.on("timestop_actions", (queue, ack) => roomForSocket(socket)?.onTimestopActions(socket, queue, ack));
  socket.on("draft_queue", (d) => roomForSocket(socket)?.onDraftQueue(socket, d));
  socket.on("retry", () => roomForSocket(socket)?.onRetry(socket));

  // --- admin reset cez socket - len socket prihlásený admin heslom; globálny (všetky roomky)
  socket.on("admin_reset_all", () => { if (socket.data.isAdmin) forceResetAll(); });
  // admin: MAINTENANCE BREAK zap/vyp (menu ☰ → ADMIN)
  socket.on("admin_maintenance", (on) => { if (socket.data.isAdmin) setMaintenance(on); });

  // admin: jednorazový token na stiahnutie dát (/admin/data?token=…), platí 60 s
  socket.on("admin_data_token", (ack) => {
    if (typeof ack !== "function" || !socket.data.isAdmin) return;
    if (!telemetry) { ack({ error: "off" }); return; }
    for (const [t, exp] of dataTokens) if (exp < Date.now()) dataTokens.delete(t);
    const token = crypto.randomBytes(16).toString("hex");
    dataTokens.set(token, Date.now() + 60 * 1000);
    ack({ token });
  });

  // bug report z menu ☰ - ack { ok } / { error: "empty" | "wait" | "limit" }
  socket.on("bug_report", (arg, ack) => {
    if (typeof ack !== "function") ack = () => {};
    const text = clip(arg?.text, BUG_TEXT_MAX)?.trim();
    if (!text) { ack({ error: "empty" }); return; }
    const now = Date.now();
    if (now - (socket.data.lastBug || 0) < BUG_GAP_MS) { ack({ error: "wait" }); return; }
    const date = new Date(now).toISOString().slice(0, 10);
    if (bugDay.date !== date) { bugDay.date = date; bugDay.count = 0; }
    if (bugDay.count >= BUG_DAY_MAX) { ack({ error: "limit" }); return; }
    socket.data.lastBug = now;
    bugDay.count++;
    const rec = { t: "bug", ts: new Date(now).toISOString(), commit: telemetryMeta.commit,
      ...(roomForSocket(socket)?.bugContext(socket) || { room: null, match: null }), text, ...bugClient(arg?.client) };
    telemetry?.append(rec);
    console.log(`bug report [${rec.device.kind} ${rec.device.os}/${rec.device.browser}] room ${rec.room ?? "-"}: ${text.slice(0, 160).replace(/s+/g, " ")}`);
    ack({ ok: true });
  });

  // --- admin reset LEN tejto roomky (rohový button / menu): odpojí jej hráčov aj divákov a roomku zruší
  socket.on("admin_reset_room", () => {
    if (!socket.data.isAdmin) return;
    const room = roomForSocket(socket);
    if (!room) return;
    room.forceReset();         // odpojí hráčov + divákov, zruší časovače
    rooms.delete(room.id);     // vyradí roomku z registra
    ensureAiRoom();            // stála AI roomka sa vytvorí znova čistá
    broadcastRooms();          // ostatní na room-browseri uvidia aktuálny zoznam
  });

  socket.on("disconnect", () => {
    browsing.delete(socket);
    maintWaiting.delete(socket);
    roomForSocket(socket)?.onDisconnect(socket);
  });
});

ensureAiRoom();
httpServer.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
