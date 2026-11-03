// engine/ai/worker.js - JEDNO worker vlákno pre všetkých AI botov servera (docs/AI_PLAN.md): výpočet neblokuje
// server a ťahy rôznych roomiek sa počítajú po jednom (šetrí CPU aj pamäť slabého servera). Každá roomka má
// vlastného bota; správy { room, ev, payload } nesú tie isté udalosti ako klientsky socket (you_are / state /
// new_game / reset) + "open" / "close". Späť ide { room, kind, char?, queue?, turn, game }. Bot rozhoduje až
// po spracovaní všetkých čakajúcich správ (setImmediate) a pre jedno kolo / hru len raz.
import { parentPort } from "node:worker_threads";
import { createBot } from "./bot.js";

const rooms = new Map(); // room → { bot, opts, decided, pending }

function decideLater(room) {
  const r = rooms.get(room);
  if (!r || r.pending) return;
  r.pending = true;
  setImmediate(() => {
    r.pending = false;
    if (rooms.get(room) !== r) return; // roomka medzitým zanikla
    const v = r.bot.belief.view;
    if (!v) return;
    const key = `${v.series?.gameIndex}:${v.turn}:${v.timestop ? "ts" : ""}:${v[r.bot.belief.mySlot]?.char ? "" : "char"}`;
    if (r.decided.has(key)) return;
    const d = r.bot.decide();
    if (!d) return;
    r.decided.add(key);
    parentPort.postMessage({ room, ...d, turn: v.turn, game: v.series?.gameIndex ?? 1 });
  });
}

parentPort.on("message", ({ room, ev, payload }) => {
  if (ev === "open") { rooms.set(room, { bot: createBot(payload), opts: payload, decided: new Set(), pending: false }); return; }
  if (ev === "close") { rooms.delete(room); return; }
  const r = rooms.get(room);
  if (!r) return;
  if (ev === "level") { r.opts = { ...r.opts, level: payload }; r.bot.setLevel(payload); }
  else if (ev === "you_are") r.bot.onYouAre(payload);
  else if (ev === "new_game") r.bot.onNewGame(payload);
  else if (ev === "reset") { r.bot = createBot(r.opts); r.decided.clear(); }
  else if (ev === "state") { r.bot.onState(payload); decideLater(room); }
});
