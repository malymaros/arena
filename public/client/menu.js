// public/client/menu.js - menu ☰ v ľavom dolnom rohu, dostupné vždy (aj nad char-selectom, lobby, zoznamom
// roomiek a zaseknutými overlaymi): RELOAD GAME (= obnovenie stránky; server hráča vráti na jeho miesto),
// celá obrazovka (kde to prehliadač vie), zvuk (okno zo sound-ui.js), REPORT BUG (okno z bug-report.js) a pre admina (prihlásený admin heslom)
// stiahnutie zozbieraných herných dát (docs/TELEMETRY.md) a reset tejto roomky / všetkých roomiek - admin má hore
// prepínač ADMIN (zapnutý = červený, admin položky namiesto bežných - menu sa tak vojde aj na telefón bez rolovania;
// bežný hráč prepínač nevidí). Položky majú pixel ikonky (menu-icons.js); REPORT BUG je žltý, DOWNLOAD DATA zelený. GRAPHICS prepína úspornú grafiku LITE ↔ FULL (perf.js; kým hráč neklikne, platí auto). Na dotyku sa menu kreslí vo veľkosti displeja (--ui-k, viewport.js).
import { socket } from "/client/net.js";
import { isAdmin, onAdminChange } from "/client/admin-state.js";
import { canFullscreen, toggleFullscreen } from "/client/viewport.js";
import { openSoundWindow } from "/client/sound-ui.js";
import { openBugWindow } from "/client/bug-report.js";
import { perf, setPerfMode } from "/client/perf.js";
import { menuIcon } from "/client/menu-icons.js";

// pixel-art ☰ 12×12
const ICON = ["............", "............", ".bbbbbbbbbb.", ".bbbbbbbbbb.", "............", ".bbbbbbbbbb.",
              ".bbbbbbbbbb.", "............", ".bbbbbbbbbb.", ".bbbbbbbbbb.", "............", "............"];
const iconSvg = `<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">${
  ICON.flatMap((r, y) => [...r].map((c, x) => c === "b" ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : "")).join("")}</svg>`;

const btn = document.createElement("button");
btn.id = "menu-btn";
btn.type = "button";
btn.title = "Menu";
btn.setAttribute("aria-label", "Menu");
btn.innerHTML = iconSvg;

const backdrop = document.createElement("div");
backdrop.className = "ui-backdrop hidden";
const panel = document.createElement("div");
panel.id = "menu-panel";
panel.className = "ui-modal hidden";
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-label", "Menu");
document.body.append(backdrop, panel, btn);

const inRoom = () => document.getElementById("rooms")?.classList.contains("hidden") !== false
  && document.getElementById("login")?.classList.contains("hidden") !== false && socket.connected;

let adminOn = false; // admin: prepínač ADMIN zapnutý = admin položky namiesto bežného menu

// položka = pixel ikonka (menu-icons.js) + text
const item = (act, icon, label, cls = "") =>
  `<button type="button" class="menu-item${cls ? " " + cls : ""}" data-act="${act}"><span class="ico-box">${menuIcon(icon)}</span><span class="menu-lbl">${label}</span></button>`;

function render() {
  const fsLabel = document.fullscreenElement ? "EXIT FULL SCREEN" : "FULL SCREEN";
  const admin = isAdmin();
  if (!admin) adminOn = false;
  // admin: prepínač ADMIN v hlavičke vedľa ✕ (nie samostatný riadok)
  const head = `<div class="um-head"><span>MENU</span>${
    admin ? `<button type="button" class="menu-admin${adminOn ? " on" : ""}" aria-pressed="${adminOn}">ADMIN</button>` : ""
  }<button type="button" class="um-close" aria-label="Close">✕</button></div>`;
  const main = item("reload", "reload", "RELOAD GAME")
    + (canFullscreen ? item("fullscreen", "fullscreen", fsLabel) : "")
    + item("sound", "sound", "SOUND")
    + item("graphics", "graphics", `GRAPHICS: ${perf.lite ? "LITE" : "FULL"}`)
    + item("bug", "bug", "REPORT BUG", "report");
  if (!admin) { panel.innerHTML = head + main; return; }
  // admin: obe strany v jednej bunke mriežky, neaktívna je neviditeľná - okno má stále rovnakú veľkosť a neskáče
  const adminItems = item("data", "download", "DOWNLOAD DATA", "menu-data")
    + (inRoom() ? item("reset-room", "resetRoom", "RESET THIS ROOM", "danger") : "")
    + item("reset-all", "resetAll", "RESET ALL ROOMS", "danger");
  panel.innerHTML = `${head}<div class="menu-pages">
    <div class="menu-page${adminOn ? " off" : ""}">${main}</div>
    <div class="menu-page${adminOn ? "" : " off"}">${adminItems}</div></div>`;
}
export function openMenu() { render(); backdrop.classList.remove("hidden"); panel.classList.remove("hidden"); }
export function closeMenu() { backdrop.classList.add("hidden"); panel.classList.add("hidden"); }

btn.addEventListener("click", () => (panel.classList.contains("hidden") ? openMenu() : closeMenu()));
backdrop.addEventListener("click", closeMenu);
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeMenu(); });
document.addEventListener("fullscreenchange", () => { if (!panel.classList.contains("hidden")) render(); });
onAdminChange(() => { if (!panel.classList.contains("hidden")) render(); });

panel.addEventListener("click", (ev) => {
  if (ev.target.closest(".um-close")) { closeMenu(); return; }
  if (ev.target.closest(".menu-admin")) { adminOn = !adminOn; render(); return; }
  const act = ev.target.closest(".menu-item")?.dataset.act;
  if (!act) return;
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
  if (act === "reset-room") {
    if (!confirm("Zrušiť TÚTO roomku a odpojiť jej hráčov aj divákov?")) return;
    socket.emit("admin_reset_room"); closeMenu(); return;
  }
  if (act === "reset-all") {
    if (!confirm("Zrušiť VŠETKY roomky a odpojiť všetkých hráčov aj divákov?")) return;
    socket.emit("admin_reset_all"); closeMenu();
  }
});
