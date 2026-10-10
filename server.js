// server.js (ESM)

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { createEngine } from "./engine/game.js";

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
    if (/[\\/](assets|arenas)[\\/]/.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=3600");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || ""; // ← voliteľné heslo pre admin reset
// Heslá pre vstup do hry (rozdáva admin): čiarkou oddelený zoznam. Zatiaľ natvrdo "hamara"
// (default), prepísateľné cez env PLAYER_KEYS=heslo1,heslo2 (napr. systemd deploy/arena.service).
// POZOR: repo je verejné → tento default je viditeľný; na reálne tajné heslo nastav env a zmaž default.
const PLAYER_KEYS = new Set((process.env.PLAYER_KEYS || "hamara").split(",").map(s => s.trim()).filter(Boolean));
/* -------------------- Room registry (globálna vrstva) -------------------- */
// Viac nezávislých roomiek naraz. Každá roomka je closure z createRoom(id) s vlastným herným stavom,
// osobami A/B, časovačmi a emitmi (roomEmit). Globálne ostáva len register roomiek + room-browser.
const RECLAIM_GRACE_MS = 60 * 1000;         // koľko sekúnd drží slot pre pôvodného hráča po výpadku
const browsing = new Set();                 // sockety na room-browseri (ešte neposadené v žiadnej roomke, nie diváci)
const rooms = new Map();                    // id -> Room (objekt z createRoom)
let nextRoomId = 1;                         // rastúci identifikátor roomiek
const MAX_ROOMS = 2;                        // cap: max toľko roomiek naraz

// Validácia zobrazovaného mena: 1–8 znakov anglickej abecedy, nič iné (žiadne emoji/diakritika/medzery).
function validateName(raw) {
  if (typeof raw !== "string") return null;
  const n = raw.trim();
  return /^[A-Za-z]{1,8}$/.test(n) ? n : null;
}
function okAdmin(keyFromClient) {
  return !ADMIN_KEY || ADMIN_KEY === keyFromClient;
}

/* ==================== Room factory ==================== */
// Celý herný stav a logika žijú v closure jednej roomky. Funkcie referencujú `game`, `personSockets`,
// `turnTimer`… lexikálne - každá roomka má vlastnú kópiu. Globálne konštanty (HP/mana/CHARS/*_MS…) a
// pure helpery (validateName, okAdmin, rollTileType…) sa čítajú z module scope cez closure.
function createRoom(id) {
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

  const engine = createEngine({
    emit: (ev, payload) => roomEmit(ev, payload),
    emitState: (timeline) => emitStateMasked(timeline),
    emitYouAre: () => emitYouAre(),
    clearTurnTimer: () => clearTurnTimer(),
    beginPlanningTimer: (extraMs) => beginPlanningTimer(extraMs),
    armTurnTimer: (ms) => armTurnTimer(ms),
    timerRemainingMs: () => timerRemainingMs(),
    names: () => personNames,
    awaitingOpponent: () => pendingMatchConfig != null,
  });
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
  // diváci tejto roomky - nemaskovaný stav
  const specPayload = timeline ? { ...plain, timeline } : plain;
  for (const s of spectators) { try { s.emit("state", specPayload); } catch {} }
}

/* ---- Admin: tvrdý reset TEJTO roomky (odpojí oboch hráčov, zruší časovače) ---- */
// Globálny forceResetAll() (mimo factory) volá forceReset() na každej roomke a vyprázdni register.
function forceReset() {
  clearTurnTimer();
  try { if (personSockets.A) personSockets.A.disconnect(true); } catch {}
  try { if (personSockets.B) personSockets.B.disconnect(true); } catch {}
  for (const s of spectators) { try { s.disconnect(true); } catch {} } // odpoj aj divákov, nech nevisia na zrušenej roomke
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
  engine.autoLock();
}

  /* -------------------- Room lifecycle (per-room, closure) -------------------- */
  // Je osoba p „nažive" - má živý socket, alebo ešte beží jej grace okno (môže sa vrátiť reconnectom)?
  function personAlive(p) {
    return !!personSockets[p] || (!!personIds[p] && Date.now() - personFreedAt[p] <= RECLAIM_GRACE_MS);
  }
  // obaja hráči preč (ani jeden nažive) → roomka je prázdna
  function roomEmpty() { return !personAlive("A") && !personAlive("B"); }
  // riadok tejto roomky pre room-browser (počet hráčov, či sa dá pripojiť)
  function roomsRow() {
    const players = ["A", "B"].filter(personAlive).length;
    return { id, players, max: 2, canJoin: players < 2, phase: engine.game.phase };
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
    clearTurnTimer();
    if (roomDestroyTimer) { clearTimeout(roomDestroyTimer); roomDestroyTimer = null; }
    personSockets.A = null; personSockets.B = null;
    personIds.A = null; personIds.B = null;
    personNames.A = null; personNames.B = null;
    personFreedAt.A = 0; personFreedAt.B = 0;
    pendingMatchConfig = null;
    // prípadní diváci → späť na room-browser
    for (const s of spectators) { try { s.data.roomId = null; s.data.spectating = false; s.leave(String(id)); browsing.add(s); } catch {} }
    spectators.clear();
    rooms.delete(id);
    broadcastRooms();
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
  }

  // pripoj sa do tejto roomky ako 2. hráč (osoba B; ak host odišiel a B ostal, obsadí A)
  function join(socket) {
    if (socket.data.person) return;
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
    socket.emit("spectator");
    socket.emit("state", snapshot());
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
    }
    socket.data.roomId = null;
    socket.data.spectating = false;
    socket.leave(String(id));
    browsing.add(socket);
    socket.emit("rooms", roomsSnapshot());
    if (roomEmpty()) destroySelf(); else broadcastRooms(); // ak ostal sám nikto → zruš; inak uprav počet
  }

  /* -------------------- Herné handlery (per-room, dispatchnuté z io.on) -------------------- */
  // úvodná obrazovka: host nastaví formát + tiles + časový limit a spustí zápas
  function onConfigure(socket, raw) {
    if (socket.data.person !== "A") return;   // konfiguruje len host
    if (engine.game.phase !== "lobby") return;        // len pred začiatkom zápasu
    const config = sanitizeConfig(raw);
    if (!config) return;
    if (personAlive("B")) {
      startMatch(config);                       // súper je tu → rovno štart (color roll)
    } else {
      pendingMatchConfig = config;              // súper ešte nie je → zapamätaj config a čakaj naňho
      socket.emit("state", snapshotFor("A"));   // host uvidí „čakám na druhého hráča" (awaitingOpponent)
    }
  }

  function onChooseTeam(socket, keys) { engine.chooseTeam(socket.data.person, keys); }

  function onChooseCharacter(socket, key) { engine.chooseCharacter(socket.data.person, key); }

  function onLockIn(socket, queue, clientTurn, ack) { engine.lockIn(socket.data.person, queue, clientTurn, ack); }

  function onTimestopActions(socket, queue, ack) { engine.timestopActions(socket.data.person, queue, ack); }

  function onDraftQueue(socket, d) { engine.draftQueue(socket.data.person, d); }

  function onRetry(socket) {
    clearTurnTimer();
    newGame();
    roomEmit("reset");
    roomEmit("state", snapshot());
  }

  function onDisconnect(socket) {
    if (spectators.delete(socket)) return; // divák odišiel - počet hráčov sa nezmenil
    const wasPlayer = personSockets.A === socket || personSockets.B === socket;
    // uvoľni len živý socket; personIds zámerne NEmažeme → hráč si po reconnecte (do grace) vyžiada svoj slot späť
    if (personSockets.A === socket) { personSockets.A = null; personFreedAt.A = Date.now(); }
    if (personSockets.B === socket) { personSockets.B = null; personFreedAt.B = Date.now(); }
    if (wasPlayer) {
      clearTurnTimer();            // bez hráča nemá zmysel auto-resolve; odpojenie diváka časovač neruší
      scheduleRoomDestroyCheck();  // ak sa obaja odpojili → po grace roomku zruš
    }
    broadcastRooms();              // ostatní na room-browseri vidia aktuálny počet hráčov
  }

  return {
    id, roomsRow, reclaimPersonFor, seat, join, spectate, leave, forceReset,
    isEmpty: roomEmpty, onConfigure, onChooseTeam, onChooseCharacter, onLockIn, onTimestopActions, onDraftQueue, onRetry, onDisconnect,
  };
}
/* ==================== koniec Room factory ==================== */

/* -------------------- Room registry (globálne) -------------------- */
// zoznam roomiek pre room-browser + či sa dá vytvoriť nová (limit MAX_ROOMS)
function roomsSnapshot() {
  const list = [];
  for (const room of rooms.values()) list.push(room.roomsRow());
  return { rooms: list, canCreate: rooms.size < MAX_ROOMS };
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
  broadcastRooms(); // browsing klienti uvidia prázdny zoznam (canCreate)
}
function roomForSocket(socket) { return rooms.get(socket.data.roomId) || null; }

/* -------------------- Admin endpoint -------------------- */
app.get("/admin/reset-all", (req, res) => {
  if (!okAdmin(req.query.key)) return res.status(403).send("forbidden");
  forceResetAll();
  res.send("ok");
});

/* -------------------- IO -------------------- */
// Brána: heslo (ak je nejaké nastavené) + platné meno. Odmietnuté spojenie klient dostane ako `connect_error`
// s message "bad_pass" / "bad_name". Pozn.: pri connectionStateRecovery sa middleware preskočí (skipMiddlewares),
// vtedy sa meno neprepisuje (guard v seat) - recovnutý socket už bol overený.
io.use((socket, next) => {
  const pass = socket.handshake.auth?.pass;
  if (PLAYER_KEYS.size && !PLAYER_KEYS.has(pass)) return next(new Error("bad_pass"));
  const name = validateName(socket.handshake.auth?.name);
  if (!name) return next(new Error("bad_name"));
  socket.data.pendingName = name;
  next();
});

io.on("connection", (socket) => {
  const cid = socket.handshake.auth?.id || null; // trvalý token klienta (localStorage)
  socket.data.person = null;
  socket.data.roomId = null;

  // reclaim naprieč roomkami: token už patrí hráčovi v niektorej žijúcej roomke → vráť ho rovno na miesto
  let placed = false;
  if (cid) {
    for (const room of rooms.values()) {
      const p = room.reclaimPersonFor(cid);
      if (p) { room.seat(socket, p); placed = true; break; }
    }
  }
  if (!placed) {
    // nový príchod → room-browser (create/join/spectate); miesto sa pridelí až explicitne
    browsing.add(socket);
    socket.emit("rooms", roomsSnapshot());
  }
  broadcastRooms();

  // --- Room lifecycle (globálny routing) ---
  socket.on("create_room", () => {
    if (socket.data.person || socket.data.roomId) return; // už niekde je
    if (rooms.size >= MAX_ROOMS) return;                  // limit počtu roomiek
    const room = createRoom(nextRoomId++);
    rooms.set(room.id, room);
    room.seat(socket, "A"); // tvorca = host (osoba A) a nastaví parametre zápasu
    broadcastRooms();
  });
  socket.on("join_room", (arg) => {
    if (socket.data.person || socket.data.roomId) return;
    const room = rooms.get(arg?.roomId);
    if (!room) return;
    room.join(socket);
  });
  socket.on("spectate_room", (arg) => {
    if (socket.data.person || socket.data.roomId) return;
    const room = rooms.get(arg?.roomId);
    if (!room) return;
    room.spectate(socket);
  });
  socket.on("leave_room", () => { roomForSocket(socket)?.leave(socket); });

  // --- Herné eventy (dispatch do roomky socketu) ---
  socket.on("configure_match", (raw) => roomForSocket(socket)?.onConfigure(socket, raw));
  socket.on("choose_team", (keys) => roomForSocket(socket)?.onChooseTeam(socket, keys));
  socket.on("choose_character", (key) => roomForSocket(socket)?.onChooseCharacter(socket, key));
  socket.on("lock_in", (queue, clientTurn, ack) => roomForSocket(socket)?.onLockIn(socket, queue, clientTurn, ack));
  socket.on("timestop_actions", (queue, ack) => roomForSocket(socket)?.onTimestopActions(socket, queue, ack));
  socket.on("draft_queue", (d) => roomForSocket(socket)?.onDraftQueue(socket, d));
  socket.on("retry", () => roomForSocket(socket)?.onRetry(socket));

  // --- admin reset cez socket (napr. z klienta s ?admin=1) - globálny (všetky roomky)
  socket.on("admin_reset_all", (key) => { if (okAdmin(key)) forceResetAll(); });

  // --- admin reset LEN tejto roomky (rohový button v hre): odpojí jej hráčov aj divákov a roomku zruší
  socket.on("admin_reset_room", (key) => {
    if (!okAdmin(key)) return;
    const room = roomForSocket(socket);
    if (!room) return;
    room.forceReset();         // odpojí hráčov + divákov, zruší časovače
    rooms.delete(room.id);     // vyradí roomku z registra
    broadcastRooms();          // ostatní na room-browseri uvidia aktuálny zoznam
  });

  socket.on("disconnect", () => {
    browsing.delete(socket);
    roomForSocket(socket)?.onDisconnect(socket);
  });
});

httpServer.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
