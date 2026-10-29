// public/client/net.js - pripojenie: Socket.IO socket (io = globál zo /socket.io/socket.io.js), prihlásenie
// (meno + heslo, brána pred socket.connect) a room browser (create / join / spectate, admin RESET ROOMS).
// client.js registruje herné handlery na exportovaný `socket` v tom istom tasku - pripojenie je asynchrónne,
// takže žiadna udalosť neprepadne.
import { isAdmin, setAdmin } from "/client/admin-state.js";

// trvalá identita prehliadača: po výpadku spojenia si vďaka nej vyžiadame späť svoj hráčsky slot
// (inak by sa vrátený hráč stal divákom a server by prestal brať jeho lock_in)
let arenaId = null;
try {
  arenaId = localStorage.getItem("arenaId");
  if (!arenaId) {
    arenaId = (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + "-" + Math.random().toString(16).slice(2));
    localStorage.setItem("arenaId", arenaId);
  }
} catch { arenaId = null; } // localStorage zakázaný (napr. privátny režim) → bez reclaimu, len bežné pripojenie
// autoConnect:false - najprv login (meno + heslo), potom socket.connect() s auth údajmi.
// Všetky socket.on(...) handlery sa registrujú normálne aj na nepripojený socket.
export const socket = io({ auth: { id: arenaId }, autoConnect: false });
// admin = prihlásený admin heslom (server to pošle hneď po pripojení, ešte pred "rooms")
socket.on("session", (s) => setAdmin(s?.admin));

/* ---------- Prihlásenie (meno + heslo) - brána pred pripojením ---------- */
(function initLogin() {
  const NAME_RE = /^[A-Za-z]{1,8}$/;
  const loginEl = document.getElementById("login");
  const nameInp = document.getElementById("login-name");
  const passInp = document.getElementById("login-pass");
  const form    = document.getElementById("login-form");
  const errEl   = document.getElementById("login-error");
  const showErr = (m) => { if (errEl) { errEl.textContent = m; errEl.classList.remove("hidden"); } };
  const hideErr = () => errEl?.classList.add("hidden");

  // sanitizácia mena za behu: povolené len A–Z/a–z, max 8 znakov
  nameInp?.addEventListener("input", () => { nameInp.value = nameInp.value.replace(/[^A-Za-z]/g, "").slice(0, 8); });

  const connectWith = (name, pass) => { socket.auth = { id: arenaId, name, pass }; socket.connect(); };

  // tichý reconnect po refreshi (údaje z tejto session - sessionStorage, nie localStorage, kvôli heslu)
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem("arenaLogin") || "null"); } catch {}
  if (saved && NAME_RE.test(saved.name || "")) connectWith(saved.name, saved.pass || "");
  else loginEl?.classList.remove("hidden");

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = (nameInp?.value || "").trim();
    const pass = passInp?.value || "";
    if (!NAME_RE.test(name)) { showErr("Name: 1–8 letters a–z, no spaces or symbols."); return; }
    try { sessionStorage.setItem("arenaLogin", JSON.stringify({ name, pass })); } catch {}
    hideErr();
    connectWith(name, pass);
  });

  socket.on("connect", () => { hideErr(); loginEl?.classList.add("hidden"); });
  // middleware odmietnutie = fatálne (socket.io neskúša znova); dočasné sieťové chyby ignorujeme (retry beží sám)
  socket.on("connect_error", (err) => {
    const m = err && err.message;
    if (m === "bad_pass" || m === "bad_name") {
      try { sessionStorage.removeItem("arenaLogin"); } catch {}
      loginEl?.classList.remove("hidden");
      showErr(m === "bad_pass" ? "Wrong password." : "Invalid name (1–8 letters a–z).");
    }
  });
})();

/* ---------- Room browser (po logine): zoznam roomiek - create / join / spectate ---------- */
const roomsEl     = document.getElementById("rooms");
const roomsListEl = document.getElementById("rooms-list");
export function hideRooms() { roomsEl?.classList.add("hidden"); }
function renderRooms(info) {
  if (!roomsListEl) return;
  roomsListEl.innerHTML = "";
  // spätná kompat.: starý formát bol jeden objekt; nový je { rooms: [...], canCreate }
  const list = Array.isArray(info?.rooms) ? info.rooms : [];
  // existujúce roomky → Join (voľné miesto) alebo Spectate (plná)
  list.forEach((r, i) => {
    const card = document.createElement("div");
    card.className = "room-card";
    const label = document.createElement("div");
    label.className = "room-label";
    label.innerHTML = `ROOM ${i + 1} <span class="room-count">${r.players}/${r.max}</span>`;
    const b = document.createElement("button");
    if (r.canJoin) {
      b.className = "room-btn join";
      b.textContent = "JOIN";
      b.addEventListener("click", () => { b.disabled = true; socket.emit("join_room", { roomId: r.id }); });
    } else {
      b.className = "room-btn spectate";
      b.textContent = "SPECTATE";
      b.addEventListener("click", () => { b.disabled = true; socket.emit("spectate_room", { roomId: r.id }); });
    }
    card.appendChild(label);
    card.appendChild(b);
    roomsListEl.appendChild(card);
  });
  // vytvor novú roomku (staneš sa hostom a nastavíš parametre) - ak sa ešte dá (limit)
  if (info?.canCreate) {
    const b = document.createElement("button");
    b.className = "room-btn create";
    b.textContent = "CREATE ROOM";
    b.addEventListener("click", () => { b.disabled = true; socket.emit("create_room"); });
    roomsListEl.appendChild(b);
  }
  // admin (prihlásený admin heslom): zruš VŠETKY roomky (rovnaký typ buttonu ako CREATE ROOM)
  if (isAdmin() && list.length > 0) {
    const rb = document.createElement("button");
    rb.className = "room-btn reset";
    rb.textContent = "RESET ROOMS";
    rb.title = "Zruší VŠETKY roomky a odpojí všetkých hráčov aj divákov";
    rb.addEventListener("click", () => {
      if (!confirm("Zrušiť VŠETKY roomky a odpojiť všetkých hráčov aj divákov?")) return;
      rb.disabled = true;
      socket.emit("admin_reset_all");
    });
    roomsListEl.appendChild(rb);
  }
}
// divák: roomka, ktorú sledujem (sessionStorage) - po RELOAD GAME / výpadku spojenia sa do nej vrátim sledovať
const SPECTATE_KEY = "arenaSpectate";
let respectating = false; // čakám na „spectator" po automatickom návrate
export function rememberSpectate(roomId) { respectating = false; try { sessionStorage.setItem(SPECTATE_KEY, String(roomId)); } catch {} }
export function forgetSpectate() { try { sessionStorage.removeItem(SPECTATE_KEY); } catch {} }
function respectateFrom(info) {
  let id = null;
  try { id = sessionStorage.getItem(SPECTATE_KEY); } catch {}
  if (id == null) return false;
  forgetSpectate(); // „spectator" ho uloží znova; roomka zanikla → zoznam roomiek ako obvykle
  const room = (info?.rooms || []).find(r => String(r.id) === id);
  if (!room) return false;
  respectating = true;
  socket.emit("spectate_room", { roomId: room.id });
  return true;
}
function showRooms(info) { renderRooms(info); roomsEl?.classList.remove("hidden"); }
socket.on("rooms", (info) => {
  document.getElementById("login")?.classList.add("hidden");
  // browsing socket nedostáva state → herné obrazovky (viditeľné by default) treba schovať, nech neprebliknú spod room-browsera
  ["char-select", "lobby", "lobby-wait", "host-wait", "team-wait", "spectator", "gameover", "intermission"].forEach(id =>
    document.getElementById(id)?.classList.add("hidden"));
  if (respectating) return; // iný „rooms" (zmena cudzej roomky), kým čakám na návrat do sledovania
  if (respectateFrom(info)) {
    // zoznam roomiek neukazuj (nebliká); keby server divákovi neodpovedal, po chvíli sa zoznam aj tak ukáže
    setTimeout(() => { if (respectating) { respectating = false; showRooms(info); } }, 1500);
    return;
  }
  showRooms(info);
});
// miesto sa medzičasom zaplnilo - server pošle aj čerstvý „rooms", ktorý prekreslí na Spectate
socket.on("join_denied", () => { /* rooms event prekreslí kartu */ });
