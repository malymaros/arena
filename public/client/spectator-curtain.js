// public/client/spectator-curtain.js - čo vidí divák mimo samotnej hry (docs/RANDOM_ARENA_PLAN.md §4–5):
// v lobby tú istú čakaciu obrazovku ako hráč B, počas prípravy hry (draft, výber / losovanie postáv, animácie
// u hráčov) oponu GET READY so stavom oboch strán. Opona sa riadi poľom `curtain` v divákovom snapshote - server
// ho posiela, kým obaja hráči nemajú postavu a nedobehli im animácie, a dovtedy z neho vynecháva postavy.
// Losovanie arény (arena-roll.js) leží nad oponou - divák ho vidí spolu s hráčmi.
import { isSpectator } from "/client/session.js";

const STATUS = { drafting: "DRAFTING TEAM…", choosing: "CHOOSING…", drawing: "DRAWING…", ready: "✓ READY" };
let curtainEl = null;

function build() {
  if (curtainEl) return;
  curtainEl = document.createElement("div");
  curtainEl.id = "spec-curtain";
  curtainEl.className = "spec-curtain hidden";
  curtainEl.innerHTML = `<div class="cr-title">GET READY</div><div class="sc-rows">
    <div class="sc-row" data-side="white"><span class="sc-side">⚪ WHITE</span><span class="sc-name"></span><span class="sc-state"></span></div>
    <div class="sc-row" data-side="black"><span class="sc-side">⚫ BLACK</span><span class="sc-name"></span><span class="sc-state"></span></div>
  </div>`;
  document.body.appendChild(curtainEl);
}

// volá sa z každého state (phase-ui) - zobrazí / skryje oponu a zdvihne lištu diváka nad čakacie obrazovky
export function syncSpectatorScreens(s, lobbyWaitShown) {
  const curtain = isSpectator ? s?.curtain : null;
  if (curtain) {
    build();
    for (const [side, slot] of [["white", "p1"], ["black", "p2"]]) {
      const row = curtainEl.querySelector(`.sc-row[data-side="${side}"]`);
      row.querySelector(".sc-name").textContent = s?.names?.[slot] || "";
      row.querySelector(".sc-state").textContent = STATUS[curtain[side]] || "";
      row.classList.toggle("ready", curtain[side] === "ready");
    }
  }
  curtainEl?.classList.toggle("hidden", !curtain);
  // SPECTATING · TAKE SEAT · LEAVE musí ostať dostupné aj nad oponou / čakaním na hosta
  document.getElementById("spectator")?.classList.toggle("over-screens", !!(isSpectator && (curtain || lobbyWaitShown)));
}
