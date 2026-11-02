// engine/ai/seat.js - AI bot ako „virtuálny socket" v roomke servera (docs/AI_PLAN.md, fáza A4).
// Roomka ho posadí ako bežnú osobu (B): dostáva tie isté emity ako klient (maskované snapshoty, you_are…),
// ktoré preposiela do workera (engine/ai/worker.js). Rozhodnutia workera vracia cez onDecision - roomka ich
// zahrá cez rovnaké príkazy enginu ako hráčov socket (chooseCharacter / lockIn / timestopActions).
import { Worker } from "node:worker_threads";

const FORWARD = new Set(["you_are", "state", "new_game", "reset"]);

export function createBotSeat({ seed = 1, budgetMs = 5000, onDecision }) {
  const worker = new Worker(new URL("./worker.js", import.meta.url), { workerData: { seed, budgetMs } });
  let alive = true;
  worker.on("message", (d) => { if (alive) onDecision(d); });
  worker.on("error", (e) => { console.error("[ai] worker error:", e?.message || e); });
  return {
    isBot: true,
    data: {},
    handshake: { auth: {} },
    emit(ev, payload) { if (alive && FORWARD.has(ev)) worker.postMessage({ ev, payload }); },
    join() {}, leave() {},
    disconnect() { if (!alive) return; alive = false; worker.terminate(); },
  };
}
