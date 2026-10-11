// public/client/lobby.js - lobby hosta: formát, tiles (počet + váhy, súčet 100 %), časovač, náhľad tiles,
// farba → configure_match. Server konfiguráciu validuje/sanitizuje sám.
import { socket } from "/client/net.js";

const lobbyEl = document.getElementById("lobby");

/* ---------- Lobby (host nastavuje zápas) ---------- */
let lobbyBuilt = false;
export function showLobby() {
  lobbyEl.classList.remove("hidden");
  if (lobbyBuilt) return;
  lobbyBuilt = true;

  // segmentové prepínače: klik nastaví .active v rámci skupiny
  lobbyEl.querySelectorAll(".opt-row").forEach(row => {
    row.addEventListener("click", (e) => {
      const btn = e.target.closest(".opt");
      if (!btn) return;
      row.querySelectorAll(".opt").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  const sumEl = document.getElementById("lobby-weights-sum");
  const startBtn = document.getElementById("lobby-start");
  const inputs = [...lobbyEl.querySelectorAll("#lobby-weights input")];
  const refreshSum = () => {
    const sum = inputs.reduce((a, i) => a + (parseInt(i.value, 10) || 0), 0);
    sumEl.textContent = `Total: ${sum}%`;
    const ok = sum === 100;
    sumEl.classList.toggle("bad", !ok);
    startBtn.disabled = !ok;
  };
  inputs.forEach(i => i.addEventListener("input", refreshSum));
  refreshSum();

  startBtn.addEventListener("click", () => {
    const pick = (id) => lobbyEl.querySelector(`#${id} .opt.active`)?.dataset.val;
    const weights = {};
    inputs.forEach(i => { weights[i.dataset.key] = parseInt(i.value, 10) || 0; });
    const config = {
      format: pick("lobby-format") || "single",
      tilesPerRound: parseInt(pick("lobby-tiles-count") || "1", 10),
      tileWeights: weights,
      timer: pick("lobby-timer") || "off",
      tilePreview: (pick("lobby-preview") || "on") === "on",
      colorPref: pick("lobby-color") || "random",
    };
    if (Object.values(weights).reduce((a, b) => a + b, 0) !== 100) return;
    socket.emit("configure_match", config);
  });
}
