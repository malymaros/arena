// public/client/retry.js - tlačidlo Retry na game-over obrazovke.
import { retryBtn, goOverlay } from "/client/dom.js";
import { socket, forgetSpectate } from "/client/net.js";

/* ---------- Retry ---------- */
retryBtn.addEventListener("click", () => { socket.emit("retry"); });
// „Leave the room" - opustí roomku a vráti sa na room-browser (server pošle „rooms"); divák sa po ňom
// do roomky automaticky nevracia (forgetSpectate)
document.getElementById("leave-room")?.addEventListener("click", () => {
  goOverlay.classList.add("hidden");
  forgetSpectate();
  socket.emit("leave_room");
});
// ✕ LEAVE ROOM pred zápasom (lobby hosta, čakanie na súpera / na hosta): odíde z roomky späť na room-browser.
// Odchod hosta, keď už druhý hráč čaká, ho server spraví novým hostom (nezostane čakať na nikoho).
document.querySelectorAll("[data-leave-room]").forEach(b => b.addEventListener("click", () => {
  forgetSpectate();
  socket.emit("leave_room");
}));
