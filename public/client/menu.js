// public/client/menu.js - menu ☰ v ľavom dolnom rohu, dostupné vždy (aj nad char-selectom, lobby, zoznamom
// roomiek a zaseknutými overlaymi): RELOAD GAME (= obnovenie stránky; server hráča vráti na jeho miesto),
// celá obrazovka (kde to prehliadač vie), zvuk (okno zo sound-ui.js) a pre admina (prihlásený admin heslom)
// reset tejto roomky / všetkých roomiek a stiahnutie zozbieraných herných dát (docs/TELEMETRY.md). GRAPHICS prepína úspornú grafiku LITE ↔ FULL (perf.js; kým hráč neklikne, platí auto). Na dotyku sa menu kreslí vo veľkosti displeja (--ui-k, viewport.js).
import { socket } from "/client/net.js";
import { isAdmin, onAdminChange } from "/client/admin-state.js";
import { canFullscreen, toggleFullscreen } from "/client/viewport.js";
import { openSoundWindow } from "/client/sound-ui.js";
import { perf, setPerfMode } from "/client/perf.js";

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

function render() {
  const fsLabel = document.fullscreenElement ? "EXIT FULL SCREEN" : "FULL SCREEN";
  panel.innerHTML = `
    <div class="um-head"><span>MENU</span><button type="button" class="um-close" aria-label="Close">✕</button></div>
    <button type="button" class="menu-item" data-act="reload">⟳ RELOAD GAME</button>
    ${canFullscreen ? `<button type="button" class="menu-item" data-act="fullscreen">⛶ ${fsLabel}</button>` : ""}
    <button type="button" class="menu-item" data-act="sound">♪ SOUND</button>
    <button type="button" class="menu-item" data-act="graphics">◐ GRAPHICS: ${perf.lite ? "LITE" : "FULL"}</button>
    ${isAdmin() ? `
      <div class="menu-sep">ADMIN</div>
      ${inRoom() ? `<button type="button" class="menu-item danger" data-act="reset-room">✖ RESET THIS ROOM</button>` : ""}
      <button type="button" class="menu-item menu-data" data-act="data">⬇ DOWNLOAD DATA</button>
      <button type="button" class="menu-item danger" data-act="reset-all">✖ RESET ALL ROOMS</button>` : ""}`;
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
  const act = ev.target.closest(".menu-item")?.dataset.act;
  if (!act) return;
  if (act === "reload") { location.reload(); return; }
  if (act === "fullscreen") { toggleFullscreen(); closeMenu(); return; }
  if (act === "sound") { closeMenu(); openSoundWindow(); return; }
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
