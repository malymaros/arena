// public/client/menu.js - menu v ľavom dolnom rohu, dostupné vždy (aj nad char-selectom, lobby, zoznamom roomiek
// a zaseknutými overlaymi). Tlačidlo = „živá kniha" s očami (tome.js, schválený návrh public/dev/book-menu.html,
// animácia PREBÚDZANIE): v hre 96×112, v room browseri vľavo dole 144×168 (oproti hlave bota). Okno = knihy pod
// sebou: RELOAD GAME (= obnovenie stránky; server hráča vráti na jeho miesto), celá obrazovka (kde to prehliadač vie),
// zvuk (okno zo sound-ui.js), GRAPHICS (úsporná grafika LITE ↔ FULL, perf.js; kým hráč neklikne, platí auto),
// REPORT BUG (okno z bug-report.js); vpravo zvislá kniha CODEX (zatiaľ nič nerobí). Admin (prihlásený admin heslom)
// má v hlavičke prepínač ADMIN: admin knihy (stiahnutie dát, MAINTENANCE, reset roomky / všetkých) namiesto bežných -
// menu sa tak vojde aj na telefón bez rolovania; bežný hráč prepínač nevidí. Na dotyku sa menu kreslí vo veľkosti
// displeja (--ui-k, viewport.js).
import { socket } from "/client/net.js";
import { isAdmin, onAdminChange, isMaintenance } from "/client/admin-state.js";
import { canFullscreen, toggleFullscreen } from "/client/viewport.js";
import { openSoundWindow } from "/client/sound-ui.js";
import { openBugWindow } from "/client/bug-report.js";
import { perf, setPerfMode } from "/client/perf.js";
import { menuIcon } from "/client/menu-icons.js";
import { tomeReady, bookButton, tomeWidgets } from "/client/tome.js";

const btn = document.createElement("button");
btn.id = "menu-btn";
btn.type = "button";
btn.title = "Menu";
btn.setAttribute("aria-label", "Menu");
const btnCvs = document.createElement("canvas");
btn.append(btnCvs);

const backdrop = document.createElement("div");
backdrop.className = "ui-backdrop hidden";
const panel = document.createElement("div");
panel.id = "menu-panel";
panel.className = "ui-modal tome menu hidden";
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-label", "Menu");
document.body.append(backdrop, panel, btn);

const roomsEl = document.getElementById("rooms"), loginEl = document.getElementById("login");
const inRoom = () => roomsEl?.classList.contains("hidden") !== false && loginEl?.classList.contains("hidden") !== false && socket.connected;

// v room browseri je kniha veľká (vľavo dole oproti hlave bota), inde malá
function syncBig() { btn.classList.toggle("big", !!roomsEl && !roomsEl.classList.contains("hidden")); }
if (roomsEl) new MutationObserver(syncBig).observe(roomsEl, { attributes: true, attributeFilter: ["class"] });
syncBig();

let adminOn = false; // admin: prepínač ADMIN zapnutý = admin knihy namiesto bežných

// kniha-položka: koža (ib-art), pixel ikonka (menu-icons.js), text, oko vpravo (ieye) a krv (blood)
const item = (act, icon, label, cls = "", right = '<canvas class="ieye"></canvas>') =>
  `<button type="button" class="menu-item${cls ? " " + cls : ""}" data-act="${act}"><canvas class="ib-art"></canvas>`
  + `<span class="ico-box">${menuIcon(icon)}</span><span class="menu-lbl">${label}</span>${right}<canvas class="blood"></canvas></button>`;

function render() {
  const fsLabel = document.fullscreenElement ? "EXIT FULL SCREEN" : "FULL SCREEN";
  const admin = isAdmin();
  if (!admin) adminOn = false;
  // admin: prepínač ADMIN v hlavičke vedľa ✕ (nie samostatný riadok)
  const head = `<div class="um-head"><span class="ttl"><canvas class="eye"></canvas>MENU</span>${
    admin ? `<button type="button" class="menu-admin${adminOn ? " on" : ""}" aria-pressed="${adminOn}"><canvas class="ib-art"></canvas><span>ADMIN</span></button>` : ""
  }<button type="button" class="um-close" aria-label="Close">✕</button></div>`;
  const main = item("reload", "reload", "RELOAD GAME")
    + (canFullscreen ? item("fullscreen", "fullscreen", fsLabel) : "")
    + item("sound", "sound", "SOUND")
    + item("graphics", "graphics", `GRAPHICS: ${perf.lite ? "LITE" : "FULL"}`)
    + item("bug", "bug", "REPORT BUG", "report");
  let body = main;
  if (admin) {
    // MAINTENANCE BREAK zap/vyp (zapnutie = RESET ALL ROOMS, ostatní vidia len obrazovku údržby); stav ON/OFF
    // v tom istom výreze ako oko na ostatných knihách
    const maint = isMaintenance();
    const adminItems = item("data", "download", "DOWNLOAD DATA", "menu-data")
      + `<button type="button" class="menu-item maint" data-act="maintenance"><canvas class="ib-art"></canvas><span class="ico-box">${menuIcon(maint ? "lock" : "unlock")}</span>`
      + `<span class="menu-lbl">MAINTENANCE</span><span class="maint-state${maint ? " on" : ""}">${maint ? "ON" : "OFF"}</span><canvas class="blood"></canvas></button>`
      + (inRoom() ? item("reset-room", "resetRoom", "RESET THIS ROOM", "danger") : "")
      + item("reset-all", "resetAll", "RESET ALL ROOMS", "danger");
    // obe strany v jednej bunke mriežky, neaktívna je neviditeľná - okno má stále rovnakú veľkosť a neskáče
    body = `<div class="menu-pages"><div class="menu-page${adminOn ? " off" : ""}">${main}</div>`
      + `<div class="menu-page adm${adminOn ? "" : " off"}">${adminItems}</div></div>`;
  }
  panel.innerHTML = `${head}<div class="tm-body"><div class="tm-items">${body}</div>`
    + `<button type="button" class="rbook" data-act="codex"><canvas class="rb-art"></canvas><canvas class="ieye"></canvas><span>CODEX</span></button></div>`
    + `<canvas class="teeth"></canvas><canvas class="tongue2"></canvas>`;
  widgets = tomeWidgets(panel);
}

// ---- animácia: kniha (tlačidlo) beží stále, kresby okna len kým je otvorené ----
let widgets = [], bookTick = null, raf = 0;
function loop(t) {
  raf = 0;
  if (bookTick && btn.offsetParent !== null) bookTick(t);
  if (!panel.classList.contains("hidden")) for (const f of widgets) f(t);
  raf = requestAnimationFrame(loop);
}
tomeReady.then(() => { bookTick = bookButton(btnCvs, btn); if (!panel.classList.contains("hidden")) render(); if (!raf) raf = requestAnimationFrame(loop); });

export function openMenu() { render(); backdrop.classList.remove("hidden"); panel.classList.remove("hidden"); }
export function closeMenu() { backdrop.classList.add("hidden"); panel.classList.add("hidden"); }

btn.addEventListener("click", () => {
  if (!panel.classList.contains("hidden")) { closeMenu(); return; }
  openMenu();
});
backdrop.addEventListener("click", closeMenu);
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeMenu(); });
document.addEventListener("fullscreenchange", () => { if (!panel.classList.contains("hidden")) render(); });
onAdminChange(() => { if (!panel.classList.contains("hidden")) render(); });

panel.addEventListener("click", (ev) => {
  if (ev.target.closest(".um-close")) { closeMenu(); return; }
  if (ev.target.closest(".menu-admin")) { adminOn = !adminOn; render(); return; }
  const act = ev.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  if (act === "codex") return; // CODEX zatiaľ nič nerobí
  if (act === "reload") { location.reload(); return; }
  if (act === "fullscreen") { toggleFullscreen(); closeMenu(); return; }
  if (act === "sound") { closeMenu(); openSoundWindow(); return; }
  if (act === "bug") { closeMenu(); openBugWindow(); return; }
  if (act === "graphics") { setPerfMode(perf.lite ? "full" : "lite"); render(); return; }
  if (act === "data") {
    // server vydá jednorazový token (heslo nejde do URL), stiahnutie potom ide obyčajným odkazom
    socket.timeout(5000).emit("admin_data_token", (err, res) => {
      if (err || !res?.token) { alert(res?.error === "off" ? "Zber dát je na serveri vypnutý (TELEMETRY_DIR)." : "Stiahnutie sa nepodarilo."); return; }
      const a = document.createElement("a");
      a.href = `/admin/data?token=${res.token}`;
      a.download = "";
      document.body.append(a);
      a.click();
      a.remove();
    });
    closeMenu(); return;
  }
  if (act === "maintenance") {
    // menu ostane otvorené - nový stav ON/OFF prekreslí onAdminChange
    const on = !isMaintenance();
    if (on && !confirm("Zapnúť MAINTENANCE BREAK? Všetky roomky sa zrušia, hráči budú vyhodení a hrať budú môcť len admini.")) return;
    socket.emit("admin_maintenance", on); return;
  }
  if (act === "reset-room") {
    if (!confirm("Zrušiť TÚTO roomku a odpojiť jej hráčov aj divákov?")) return;
    socket.emit("admin_reset_room"); closeMenu(); return;
  }
  if (act === "reset-all") {
    if (!confirm("Zrušiť VŠETKY roomky a odpojiť všetkých hráčov aj divákov?")) return;
    socket.emit("admin_reset_all"); closeMenu();
  }
});
