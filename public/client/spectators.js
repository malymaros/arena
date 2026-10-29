// public/client/spectators.js - diváci: oko s počtom divákov vľavo dole vedľa menu ☰ (vidia ho hráči aj diváci,
// pri 0 divákoch je skryté; na telefóne nad menu) a pruh diváka dole (SPECTATING · TAKE SEAT · LEAVE).
// Server pošle `spectators` { count, seatFree } pri každej zmene; TAKE SEAT sa ukáže len pri voľnom mieste
// (hráč odišiel / host čaká na súpera). Návrat do sledovania po reloade rieši net.js (rememberSpectate).
import { socket, forgetSpectate } from "/client/net.js";
import { setSpectator } from "/client/session.js";

// pixel-art oko 11×7 (w = bielko, g = dúhovka, k = zrenička)
const ICON = ["...wwwww...", ".wwwgggwww.", "wwwgkkkgwww", "wwggkkkggww", "wwwgkkkgwww", ".wwwgggwww.", "...wwwww..."];
const FILL = { w: "#f2e6c9", g: "#d4a017", k: "#120d09" };
const eyeSvg = `<svg viewBox="0 0 11 7" shape-rendering="crispEdges" aria-hidden="true">${
  ICON.flatMap((r, y) => [...r].map((c, x) => FILL[c] ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${FILL[c]}"/>` : "")).join("")}</svg>`;

const eye = document.createElement("div");
eye.id = "spec-eye";
eye.className = "hidden";
eye.innerHTML = `${eyeSvg}<span class="spec-n"></span>`;
document.body.appendChild(eye);
const countEl = eye.querySelector(".spec-n");

const bar = document.getElementById("spectator");
const takeBtn = document.getElementById("spec-take");
const leaveBtn = document.getElementById("spec-leave");
bar?.querySelector(".spec-ico")?.insertAdjacentHTML("afterbegin", eyeSvg);

function setCount(n) {
  eye.classList.toggle("hidden", !(n > 0));
  countEl.textContent = String(n);
  eye.title = n === 1 ? "1 spectator is watching" : `${n} spectators are watching`;
}

socket.on("spectators", (info) => {
  setCount(info?.count || 0);
  takeBtn?.classList.toggle("hidden", !info?.seatFree);
  if (takeBtn) takeBtn.disabled = false;
});
// mimo roomky (room-browser) a po odpojení oko nemá čo ukazovať; nový stav príde po návrate
socket.on("rooms", () => setCount(0));
socket.on("disconnect", () => setCount(0));
socket.on("join_denied", () => { if (takeBtn) takeBtn.disabled = false; });

takeBtn?.addEventListener("click", () => { takeBtn.disabled = true; socket.emit("take_seat"); });
leaveBtn?.addEventListener("click", () => {
  forgetSpectate();     // dobrovoľný odchod → po reloade sa do roomky nevracať
  setSpectator(false);
  bar?.classList.add("hidden");
  socket.emit("leave_room"); // server pošle „rooms" → room-browser
});
