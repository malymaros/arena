// public/client/admin.js - admin tlačidlo „Reset this room" (len s ?admin=1[&key=…]). Server reset bez
// platného ADMIN_KEY odmietne.
import { socket } from "/client/net.js";

/* ---------- Admin reset button (zobraz len s ?admin=1) ---------- */
(function mountAdminReset(){
  const qp = new URLSearchParams(location.search);
  if (!qp.has("admin")) return; // zobraz len pre admin režim

  const key = qp.get("key") || "";
  const btn = document.createElement("button");
  btn.id = "admin-reset";
  btn.textContent = "Reset this room";
  btn.title = "Zruší LEN túto roomku - odpojí jej hráčov aj divákov (späť na room-browser)";
  btn.style.position = "fixed";
  btn.style.right = "14px";
  btn.style.bottom = "14px";
  btn.style.zIndex = "50";
  btn.style.padding = "10px 14px";
  btn.style.borderRadius = "10px";
  btn.style.border = "1px solid #5a1a1a";
  btn.style.background = "#8e0000";
  btn.style.color = "#fff";
  btn.style.fontWeight = "800";
  btn.style.cursor = "pointer";
  btn.style.boxShadow = "0 6px 18px rgba(0,0,0,.35)";

  btn.addEventListener("click", () => {
    if (!confirm("Zrušiť TÚTO roomku a odpojiť jej hráčov aj divákov?")) return;
    socket.emit("admin_reset_room", key);
  });

  document.body.appendChild(btn);
})();
