// public/client/admin.js - admin tlačidlo „Reset this room" v pravom dolnom rohu (web/desktop). Vidí ho len
// hráč prihlásený admin heslom (admin-state.js) a len v roomke - nie na logine ani v zozname roomiek
// (CSS v styles.css). Na dotykových zariadeniach je reset v menu ☰ (menu.js). Server reset bez admina odmietne.
import { socket } from "/client/net.js";

const btn = document.createElement("button");
btn.id = "admin-reset";
btn.type = "button";
btn.textContent = "Reset this room";
btn.title = "Zruší LEN túto roomku - odpojí jej hráčov aj divákov (späť na room-browser)";
btn.addEventListener("click", () => {
  if (!confirm("Zrušiť TÚTO roomku a odpojiť jej hráčov aj divákov?")) return;
  socket.emit("admin_reset_room");
});
document.body.appendChild(btn);
