// public/client/turn-timer.js - časovač ťahu: displej podľa servera a auto-lock po vypršaní (nevyplnené sloty
// sú pass).
import { turnTimerEl, lockBtn } from "/client/dom.js";
import { state, me, isSpectator, otherSlot } from "/client/session.js";
import { playback } from "/client/playback.js";
import { uiLocked, emitLockIn, closePickers } from "/client/controls.js";
import { planning } from "/client/planning.js";
import { renderQueue } from "/client/queue.js";

/* ---------- Turn timer (server-riadený displej + auto-lock) ---------- */
// server posiela zostávajúci čas (event `turn_timer` aj `state.timerMs`), takže displej sedí so serverom
// a po refreshi sa zosynchronizuje; klient pri vypršaní auto-lockne (drží už rozpracovanú frontu)
let serverTimerEndsAt = 0; // performance.now()-based deadline zo servera (0 = bez limitu)

// DOČASNÁ DIAGNOSTIKA časovača - zapni cez ?tdebug=1; loguje prečo sa časovač (ne)zobrazí
const TDEBUG = new URLSearchParams(location.search).has("tdebug");
export const tlog = (...a) => { if (TDEBUG) console.log("[timer]", ...a); };
let _lastPlanning = null;

export function setServerTimer(ms) {
  serverTimerEndsAt = (ms == null) ? 0 : performance.now() + ms;
  tlog("setServerTimer", ms);
}
export function stopTurnTimer() {
  serverTimerEndsAt = 0;
  turnTimerEl.classList.add("hidden");
  turnTimerEl.classList.remove("urgent", "below-status");
}
// tik (volaný z raf): odpočet zobraz len počas plánovania; pri vypršaní auto-lockne
export function tickTurnTimer(now) {
  const mine = state?.[me];
  const planning = !!serverTimerEndsAt && !playback.playing && !playback.gameOverShown && state?.phase === "playing"
    && !isSpectator && mine?.char && state?.[otherSlot()]?.char && !mine.locked;
  if (TDEBUG && planning !== _lastPlanning) {
    _lastPlanning = planning;
    tlog(`planning=${planning}`, {
      timerEndsAt: !!serverTimerEndsAt, playing: playback.playing, gameOverShown: playback.gameOverShown, phase: state?.phase,
      isSpectator, me, mineChar: mine?.char, otherChar: state?.[otherSlot()]?.char, mineLocked: mine?.locked,
    });
  }
  if (!planning) {
    turnTimerEl.classList.add("hidden");
    turnTimerEl.classList.remove("urgent", "below-status");
    return;
  }
  const remain = Math.max(0, serverTimerEndsAt - now);
  turnTimerEl.classList.remove("hidden");
  turnTimerEl.classList.toggle("below-status", state?.config?.timer === "quickdraw"); // pod „OPPONENT IS READY"
  turnTimerEl.textContent = `⏱ ${Math.ceil(remain / 1000)}`;
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
