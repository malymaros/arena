// engine/ai/worker.js - JEDNO worker vlákno pre všetkých AI botov servera (docs/AI_PLAN.md): výpočet neblokuje
// server a ťahy rôznych roomiek sa počítajú po jednom (šetrí CPU aj pamäť slabého servera). Každá roomka má
// vlastného bota; správy { room, ev, payload } nesú tie isté udalosti ako klientsky socket (you_are / state /
// new_game / reset) + "open" / "close" + "level" + "spy" (CHEATER: jedna akcia zamknutej fronty hráča). Späť ide { room, kind, char?, queue?, turn, game }. Bot rozhoduje až
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
    const key = `${v.phase === "team_select" ? "team:" : ""}${v.series?.gameIndex}:${v.turn}:${v.timestop ? "ts" : ""}:${v[r.bot.belief.mySlot]?.char ? "" : "char"}`;
    const post = (d, extra = {}) => parentPort.postMessage({ room, ...d, ...extra, turn: v.turn, game: v.series?.gameIndex ?? 1 });
    // bežné rozhodnutie (pri CHEATEROVI aj výpočet, ktorý po odhalení len dopočíta; zahrá sa, keď vyprší čas)
    if (!r.decided.has(key)) {
      const d = r.bot.decide();
      if (!d) return;
      r.decided.add(key);
      post(d);
    }
    // CHEATER: hráč zamkol a server poslal jednu jeho akciu → dopočet kola s ňou (spy prišiel aj počas výpočtu vyššie)
    const spy = r.spy && r.spy.turn === v.turn && r.spy.game === (v.series?.gameIndex ?? 1) && !v.timestop ? r.spy : null;
    if (!spy) return;
    r.spy = null;
    if (r.decided.has(key + ":spy")) return;
    const d = r.bot.decide({ spy });
    if (!d || d.kind !== "round") return;
    r.decided.add(key + ":spy");
    post(d, { cheat: true });
  });
}

parentPort.on("message", ({ room, ev, payload }) => {
  if (ev === "open") { rooms.set(room, { bot: createBot(payload), opts: payload, decided: new Set(), pending: false }); return; }
  if (ev === "close") { rooms.delete(room); return; }
  const r = rooms.get(room);
  if (!r) return;
  if (ev === "spy") { r.spy = payload; decideLater(room); return; } // CHEATER: { turn, game, idx, action }
  if (ev === "level") { r.opts = { ...r.opts, level: payload }; r.bot.setLevel(payload); }
  else if (ev === "you_are") r.bot.onYouAre(payload);
  else if (ev === "new_game") r.bot.onNewGame(payload);
  else if (ev === "reset") { r.bot = createBot(r.opts); r.decided.clear(); }
  else if (ev === "state") { r.bot.onState(payload); decideLater(room); }
});
