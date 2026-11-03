// engine/ai/seat.js - AI bot ako „virtuálny socket" v roomke servera (docs/AI_PLAN.md, fáza A4).
// Roomka ho posadí ako bežnú osobu (B): dostáva tie isté emity ako klient (maskované snapshoty, you_are…),
// ktoré preposiela do spoločného workera (engine/ai/worker.js - jedno vlákno pre všetky AI roomky, ťahy sa
// počítajú po jednom). Rozhodnutia vracia cez onDecision - roomka ich zahrá cez rovnaké príkazy enginu ako
// socket hráča (chooseCharacter / lockIn / timestopActions).
import { Worker } from "node:worker_threads";

const FORWARD = new Set(["you_are", "state", "new_game", "reset"]);
let worker = null;
const handlers = new Map(); // room → onDecision
let nextRoom = 1;

function shared() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.js", import.meta.url));
  worker.on("message", (d) => handlers.get(d.room)?.(d));
  worker.on("error", (e) => { console.error("[ai] worker error:", e?.message || e); });
  worker.on("exit", () => { worker = null; });
  worker.unref(); // nebráni ukončeniu procesu servera
  return worker;
}

// botOpts = parametre createBot (seed, budgetSims, budgetMs…)
export function createBotSeat({ botOpts, onDecision }) {
  const room = nextRoom++;
  let alive = true;
  handlers.set(room, onDecision);
  shared().postMessage({ room, ev: "open", payload: botOpts });
  return {
    isBot: true,
    data: {},
    handshake: { auth: {} },
    emit(ev, payload) { if (alive && FORWARD.has(ev)) shared().postMessage({ room, ev, payload }); },
    join() {}, leave() {},
    // obťažnosť bota ("normal" / "baby" / "cheater") - zmena pred zápasom (hráč si ju vybral pri vstupe do AI roomky)
    setLevel(level) { if (alive) shared().postMessage({ room, ev: "level", payload: level }); },
    // CHEATER: jedna akcia hráčovej zamknutej fronty { turn, game, idx, action } (server ju vyberie po lock_in)
    spy(payload) { if (alive) shared().postMessage({ room, ev: "spy", payload }); },
    disconnect() {
      if (!alive) return;
      alive = false;
      handlers.delete(room);
      worker?.postMessage({ room, ev: "close" });
    },
  };
}
