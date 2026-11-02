// engine/ai/worker.js - AI bot vo vlastnom vlákne (worker_threads), aby výpočet (sekundy) neblokoval server.
// Dostáva tie isté udalosti ako klientsky socket (you_are / state / new_game / reset) a posiela späť rozhodnutia
// { kind: "character" | "round" | "timestop", char?, queue?, turn, game }. Rozhoduje až po spracovaní všetkých
// čakajúcich správ (setImmediate) a pre jedno kolo / hru len raz.
import { parentPort, workerData } from "node:worker_threads";
import { createBot } from "./bot.js";

const make = () => createBot({ seed: workerData?.seed ?? 1, budgetMs: workerData?.budgetMs ?? 5000 });
let bot = make();
let pending = false;
const decided = new Set();

function decideLater() {
  if (pending) return;
  pending = true;
  setImmediate(() => {
    pending = false;
    const v = bot.belief.view;
    if (!v) return;
    const key = `${v.series?.gameIndex}:${v.turn}:${v.timestop ? "ts" : ""}:${v[bot.belief.mySlot]?.char ? "" : "char"}`;
    if (decided.has(key)) return;
    const d = bot.decide();
    if (!d) return;
    decided.add(key);
    parentPort.postMessage({ ...d, turn: v.turn, game: v.series?.gameIndex ?? 1 });
  });
}

parentPort.on("message", ({ ev, payload }) => {
  if (ev === "you_are") bot.onYouAre(payload);
  else if (ev === "new_game") bot.onNewGame(payload);
  else if (ev === "reset") { bot = make(); decided.clear(); }
  else if (ev === "state") { bot.onState(payload); decideLater(); }
});
