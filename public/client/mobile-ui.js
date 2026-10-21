// public/client/mobile-ui.js - drobnosti len pre dotykové zariadenia (docs/MOBILE.md): výzva otočiť zariadenie
// na šírku. (Celá obrazovka je v menu ☰ - client/menu.js.)

// výzva na otočenie - viditeľnosť rieši CSS (.touch + orientation: portrait), JS ju len vloží
const rotate = document.createElement("div");
rotate.id = "rotate-hint";
rotate.innerHTML = `<div class="rh-phone"></div><div class="rh-text">ROTATE YOUR DEVICE</div>
  <div class="rh-sub">Arena is played in landscape</div>`;
document.body.appendChild(rotate);
