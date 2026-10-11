// public/client/the-world.js - Jotaro THE WORLD na klientovi: overlay zmrazeného súpera, stredový sprite menace,
// ts-mód (Jotaro plánuje 3 zmrazené akcie, súper čaká). Elementy tsOverlay/worldCenter pripája client.js.
import { TILE_H, gridEl, lockBtn } from "/client/dom.js";
import { charDirFor, ensureSpriteMeta, drawSprite } from "/client/sprites.js";
import { state, isSpectator, me } from "/client/session.js";
import { playback } from "/client/playback.js";
import { planning } from "/client/planning.js";
import { closePickers, syncGoldenHalves, syncGoldDualHalves, updateUiLocks, uiLocked, emitLockIn } from "/client/controls.js";
import { renderQueue } from "/client/queue.js";
import { socket } from "/client/net.js";
import { stopTurnTimer } from "/client/turn-timer.js";

/* ---------- Jotaro THE WORLD - klientská pauza / ts-mód ---------- */
// full-screen overlay pre zmrazeného súpera (text „⏱ TIME HAS STOPPED…"); filter rieši body.timestop-mode
export const tsOverlay = document.createElement("div");
tsOverlay.id = "timestop-overlay";
tsOverlay.className = "hidden";
tsOverlay.innerHTML = `<div class="ts-overlay-text">⏱ THE WORLD! - TIME HAS STOPPED…</div>`;
export function tsOverlaySet(on) { tsOverlay.classList.toggle("hidden", !on); }

// veľký stredový sprite THE WORLD castu - Star Platinum „menace" (Special_3_P); hrá RAZ a ZAMRZNE na
// poslednom frame (rovnako ako náhľad karty pri výbere). Drží sa počas celého time-stopu, mizne pri konci.
let worldCenterRaf = 0;
export const worldCenter = document.createElement("canvas");
worldCenter.id = "world-center";
{
  const px = Math.round(TILE_H * 2.4);
  worldCenter.width = px; worldCenter.height = px;
  worldCenter.style.width = px + "px"; worldCenter.style.height = px + "px";
  worldCenter.style.display = "none";
}
export function spawnWorldCenter(slot) {
  const dir = charDirFor("jotaro", slot);
  worldCenter.style.display = "block";
  const start = performance.now();
  let blinkCleared = false;
  cancelAnimationFrame(worldCenterRaf);
  const draw = () => {
    const ctx = worldCenter.getContext("2d");
    ensureSpriteMeta(dir, "Special_3_P.png").then(m => {
      const fps = 6, total = m.frames;
      const fi = Math.floor((performance.now() - start) / 1000 * fps);
      const idx = Math.min(total - 1, fi); // RAZ 0..N-1, potom drží posledný frame (zamrzne ako v náhľade)
      drawSprite(ctx, m, { file: "Special_3_P.png", frames: total, frameIndex: idx }, 0, worldCenter.width, worldCenter.height, 1, 0.5, true);
      // celoplošné blikanie tiles trvá LEN po zastavenie stredovej SP animácie (keď menace zamrzne na poslednom frame)
      if (!blinkCleared && fi >= total - 1) {
        blinkCleared = true;
        gridEl.querySelectorAll(".cell.preview-red").forEach(c => c.classList.remove("preview-red"));
      }
    }).catch(() => {});
    worldCenterRaf = requestAnimationFrame(draw);
  };
  draw();
}
export function hideWorldCenter() {
  cancelAnimationFrame(worldCenterRaf); worldCenterRaf = 0;
  worldCenter.style.display = "none";
  const c = worldCenter.getContext("2d"); c.clearRect(0, 0, worldCenter.width, worldCenter.height);
}

// vstup do ts-módu (po timestop_wait alebo po reload/reclaim): Jotaro plánuje 3 zmrazené akcie,
// súper čaká zamrznutý s full-screen filtrom a zamknutým UI.
export function enterTimestopMode() {
  const tsSlot = state?.timestop?.slot;
  if (!tsSlot || isSpectator) { playback.tsPlanning = false; playback.tsFrozen = false; tsOverlaySet(false); return; }
  // TERAZ (menace dohral) zamrazíme čas: zmrazenie animácií board figúr (okrem Jotara) + filter (rieši sa nižšie).
  // Pri reloade/reclaime sem prídeme bez predošlého timestop_start → dospawnujeme menace, nech je vidno.
  playback.tsActive = true; playback.tsJotaroSlot = tsSlot; playback.tsFreezeAt = performance.now();
  if (worldCenter.style.display === "none") spawnWorldCenter(tsSlot);
  if (me === tsSlot) {
    // Jotarov hráč - plánovanie 3 zmrazených akcií (kvázi nové kolo, všetky typy nanovo)
    playback.tsPlanning = true; playback.tsFrozen = false;
    planning.lockedIn = false;
    planning.myQueue = [];
    planning.goldenArmed = planning.goldenMirrorArmed = planning.goldenManaArmed = planning.lastStandArmed = planning.lastHopeArmed = false;
    // filter time-stopu aj overlay „THE WORLD! - TIME HAS STOPPED…" vidia OBAJA. Overlay je pointer-events:none
    // a hore na obrazovke, takže Jotarovi neprekáža v plánovaní zmrazenej trojice.
    document.body.classList.add("timestop-mode");
    tsOverlaySet(true);
    lockBtn.classList.remove("locked", "ready"); lockBtn.disabled = false; lockBtn.textContent = "EXECUTE";
    closePickers(); renderQueue(); syncGoldenHalves(); syncGoldDualHalves(); updateUiLocks();
  } else {
    // súper - zmrazený, UI zamknuté, full-screen filter + overlay. Stredový Special_3_P vidí PO CELÚ dobu
    // (kým Jotaro nezadá všetky zmrazené akcie) - center ostáva, mizne až pri obnovení času (timestop_end).
    playback.tsFrozen = true; playback.tsPlanning = false;
    document.body.classList.add("timestop-mode");
    tsOverlaySet(true);
    updateUiLocks();
  }
}

// Jotaro potvrdil 3 zmrazené akcie → pošli timestop_actions (server dohrá zvyšok kola a pošle pokračovaciu timeline)
function submitTimestopActions() {
  if (planning.myQueue.length !== 3) { lockBtn.classList.add("shake"); setTimeout(() => lockBtn.classList.remove("shake"), 400); return; }
  const payload = [...planning.myQueue];
  playback.tsPlanning = false;
  planning.lockedIn = true; // drž zamknuté, kým nepríde pokračovacia timeline (playback.playing ju prevezme)
  hideWorldCenter(); // klik na EXECUTE → stredový Special_3_P zmizne (u Jotara hneď; u súpera pri pokračovaní)
  closePickers();
  lockBtn.classList.add("locked"); lockBtn.classList.remove("ready"); lockBtn.textContent = "LOCKED"; lockBtn.disabled = true;
  updateUiLocks();
  socket.emit("timestop_actions", payload, (res) => {
    if (res && res.ok === false) { // server odmietol (nemalo by nastať - validácia zrkadlí klienta) → vráť plánovanie
      playback.tsPlanning = true; planning.lockedIn = false;
      lockBtn.classList.remove("locked"); lockBtn.disabled = false; lockBtn.textContent = "EXECUTE";
      updateUiLocks();
    }
  });
}

lockBtn.addEventListener("click", () => {
  if (playback.tsPlanning) { submitTimestopActions(); return; } // THE WORLD: lock button = EXECUTE zmrazenej trojice
  if (playback.playing) return; // počas prehrávania kola nelockuj
  if (uiLocked()) return;
  if (planning.myQueue.length !== 3) {
    lockBtn.classList.add("shake");
    setTimeout(() => lockBtn.classList.remove("shake"), 400);
    return;
  }
  const payload = [...planning.myQueue];
  if (planning.goldenArmed) payload.unshift({ type: "golden_shield" });
  else if (planning.goldenMirrorArmed) payload.unshift({ type: "golden_mirror" });
  if (planning.lastHopeArmed) payload.unshift({ type: "last_hope" }); // úplne prvý, ešte pred golden shield/mirror
  if (planning.goldenManaArmed) payload.push({ type: "golden_mana" });
  else if (planning.lastStandArmed) payload.push({ type: "last_stand" });
  planning.lockedIn = true; // všetky tlačidlá idú do locked stavu až do konca kola
  emitLockIn(payload); // (až po nastavení planning.lockedIn - helper podľa neho rozhoduje o opakovaní)
  closePickers();
  lockBtn.classList.add("locked");
  lockBtn.classList.remove("ready");
  lockBtn.textContent = "LOCKED";
  lockBtn.disabled = true;
  stopTurnTimer();
});
