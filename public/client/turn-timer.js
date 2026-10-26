// public/client/turn-timer.js - časovač ťahu: displej podľa servera a auto-lock po vypršaní (nevyplnené sloty
// sú pass).
import { turnTimerEl, lockBtn } from "/client/dom.js";
import { state, me, isSpectator, otherSlot } from "/client/session.js";
import { playback } from "/client/playback.js";
import { uiLocked, emitLockIn, closePickers } from "/client/controls.js";
import { planning } from "/client/planning.js";
import { renderQueue } from "/client/queue.js";
import { sfx } from "/client/sound.js";
import { charRollActive } from "/client/char-roll.js";

/* ---------- Turn timer (server-riadený displej + auto-lock) ---------- */
// server posiela zostávajúci čas (event `turn_timer` aj `state.timerMs`), takže displej sedí so serverom
// a po refreshi sa zosynchronizuje; klient pri vypršaní auto-lockne (drží už rozpracovanú frontu)
let serverTimerEndsAt = 0; // performance.now()-based deadline zo servera (0 = bez limitu)

// DOČASNÁ DIAGNOSTIKA časovača - zapni cez ?tdebug=1; loguje prečo sa časovač (ne)zobrazí
const TDEBUG = new URLSearchParams(location.search).has("tdebug");
export const tlog = (...a) => { if (TDEBUG) console.log("[timer]", ...a); };
let _lastPlanning = null;
let lastTickSec = null; // posledná zobrazená sekunda (tik zaznie raz za sekundu)

export function setServerTimer(ms) {
  serverTimerEndsAt = (ms == null) ? 0 : performance.now() + ms;
  tlog("setServerTimer", ms);
}
export function stopTurnTimer() {
  serverTimerEndsAt = 0;
  turnTimerEl.classList.add("hidden");
  turnTimerEl.classList.remove("urgent", "below-status");
}
// tik (volaný z raf): odpočet zobraz počas plánovania; pri vypršaní auto-lockne. Keď som už locknutý a súper
// ešte nie, odpočet ostane - ukazuje, koľko času má ešte súper (bez tikania a bez auto-locku)
export function tickTurnTimer(now) {
  const mine = state?.[me], opp = state?.[otherSlot()];
  const active = !!serverTimerEndsAt && !playback.playing && !charRollActive() && !playback.gameOverShown && state?.phase === "playing"
    && !isSpectator && mine?.char && opp?.char;
  const planning = active && !mine.locked;
  const waitingOpp = active && mine.locked && !opp.locked;
  if (TDEBUG && planning !== _lastPlanning) {
    _lastPlanning = planning;
    tlog(`planning=${planning}`, {
      timerEndsAt: !!serverTimerEndsAt, playing: playback.playing, gameOverShown: playback.gameOverShown, phase: state?.phase,
      isSpectator, me, mineChar: mine?.char, otherChar: state?.[otherSlot()]?.char, mineLocked: mine?.locked,
    });
  }
  if (!planning && !waitingOpp) {
    turnTimerEl.classList.add("hidden");
    turnTimerEl.classList.remove("urgent", "below-status", "opp-time");
    return;
  }
  const remain = Math.max(0, serverTimerEndsAt - now);
  const secs = Math.ceil(remain / 1000);
  turnTimerEl.classList.remove("hidden");
  // quickdraw: pod hláškou „OPPONENT IS READY" / „LOCKED - WAITING FOR OPPONENT" (hud.js ju v ňom ukazuje)
  turnTimerEl.classList.toggle("below-status", state?.config?.timer === "quickdraw");
  turnTimerEl.classList.toggle("opp-time", waitingOpp);
  if (waitingOpp) {
    turnTimerEl.classList.toggle("urgent", remain <= 5000);
    turnTimerEl.innerHTML = `⏱ ${secs}<span class="tt-who">OPPONENT</span>`;
    lastTickSec = null;
    return;
  }
  if (secs !== lastTickSec && secs > 0 && secs <= 5) sfx("ui.timer_tick"); // posledných 5 s tiká
  lastTickSec = secs;
  turnTimerEl.textContent = `⏱ ${secs}`;
  turnTimerEl.classList.toggle("urgent", remain <= 5000);
  if (remain <= 0) { serverTimerEndsAt = 0; autoLockTimeout(); }
}
// vyprší čas - náhodne doplň nevyplnené z 3 základných akcií a zamkni (gold akcie sa nikdy nepridajú samé)
function autoLockTimeout() {
  if (uiLocked() || playback.playing || !me || state?.[me]?.locked) { stopTurnTimer(); return; }
  // vypršaný čas: rozpracované akcie ostanú, každý nevyplnený slot = PASS (THINKING, −2 many na serveri)
  while (planning.myQueue.length < 3) planning.myQueue.push({ type: "pass" });
  const payload = [...planning.myQueue];
  if (planning.goldenArmed) payload.unshift({ type: "golden_shield" });
  else if (planning.goldenMirrorArmed) payload.unshift({ type: "golden_mirror" });
  if (planning.lastHopeArmed) payload.unshift({ type: "last_hope" }); // úplne prvý (gold akcie sa nedopĺňajú, navolený Last Hope sa zachová)
  if (planning.goldenManaArmed) payload.push({ type: "golden_mana" });
  else if (planning.lastStandArmed) payload.push({ type: "last_stand" });
  planning.lockedIn = true;
  emitLockIn(payload); // spoľahlivé poslanie aj pri auto-locku z časovača
  closePickers();
  renderQueue();
  lockBtn.classList.add("locked"); lockBtn.classList.remove("ready");
  lockBtn.textContent = "LOCKED"; lockBtn.disabled = true;
  stopTurnTimer();
}
