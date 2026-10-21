// public/client/mobile-ui.js - drobnosti len pre dotykové zariadenia (docs/MOBILE.md):
// tlačidlo celej obrazovky vedľa 🔊 (len kde to prehliadač vie) a výzva otočiť zariadenie na šírku.
import { isTouch, canFullscreen, toggleFullscreen } from "/client/viewport.js";

// výzva na otočenie - viditeľnosť rieši CSS (.touch + orientation: portrait), JS ju len vloží
const rotate = document.createElement("div");
rotate.id = "rotate-hint";
rotate.innerHTML = `<div class="rh-phone"></div><div class="rh-text">ROTATE YOUR DEVICE</div>
  <div class="rh-sub">Arena is played in landscape</div>`;
document.body.appendChild(rotate);

// pixel-art ikona celej obrazovky 12×12: štyri rohy (b); po zapnutí rohy dovnútra
const ICON_ENTER = ["bbbb....bbbb", "b..........b", "b..........b", "b..........b", "............", "............",
                    "............", "............", "b..........b", "b..........b", "b..........b", "bbbb....bbbb"];
const ICON_EXIT  = ["...b....b...", "...b....b...", "...b....b...", "bbbb....bbbb", "............", "............",
                    "............", "............", "bbbb....bbbb", "...b....b...", "...b....b...", "...b....b..."];
const svg = (rows) => `<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">${
  rows.flatMap((r, y) => [...r].map((c, x) => c === "b" ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : "")).join("")}</svg>`;

if (isTouch && canFullscreen) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "fs-btn";
  btn.title = "Full screen";
  btn.setAttribute("aria-label", "Full screen");
  const sync = () => { btn.innerHTML = svg(document.fullscreenElement ? ICON_EXIT : ICON_ENTER); };
  sync();
  btn.addEventListener("click", () => { toggleFullscreen(); });
  document.addEventListener("fullscreenchange", sync);
  document.body.appendChild(btn);
}
