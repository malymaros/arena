// public/client/retry.js - tlačidlo Retry na game-over obrazovke.
import { retryBtn, goOverlay } from "/client/dom.js";
import { socket } from "/client/net.js";

/* ---------- Retry ---------- */
retryBtn.addEventListener("click", () => { socket.emit("retry"); });
// „Leave the room" - opustí roomku a vráti sa na room-browser (server pošle „rooms")
document.getElementById("leave-room")?.addEventListener("click", () => {
  goOverlay.classList.add("hidden");
  socket.emit("leave_room");
});
