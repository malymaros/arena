// telemetry/replay.js - znova prehrá zapísaný zápas zo vstupov v logu (seed, config, výbery, ťahy) cez
// headless engine. Funguje len na tom istom commite, na ktorom sa zápas hral (match_start.commit) -
// iná verzia hernej logiky dá z rovnakých ťahov iný priebeh.
import { createRecordedEngine, SLOT } from "./recorder.js";
import { FORCE_FIRST_STARTER } from "../engine/constants.js";

// záznamy (v poradí zo súboru) → Map id zápasu → jeho záznamy
export function splitMatches(records) {
  const out = new Map();
  for (const r of records) {
    if (!r?.m) continue;
    if (!out.has(r.m)) out.set(r.m, []);
    out.get(r.m).push(r);
  }
  return out;
}

// prehrá jeden zápas; vracia { engine, records } - engine na konci zápasu a znova odvodené záznamy
// (rovnaký formát ako log). onInput(rec, engine) sa volá po každom prehranom vstupe (napr. výpis priebehu).
export function replayMatch(recs, { onInput = null } = {}) {
  const start = recs.find(r => r.t === "match_start");
  if (!start) throw new Error("zápas nemá match_start");
  if ((start.forceFirst || null) !== (FORCE_FIRST_STARTER || null)) {
    throw new Error(`zápas sa hral s FORCE_FIRST_STARTER=${start.forceFirst || "(nič)"} - spusti replay s rovnakým env`);
  }
  const out = [];
  const pending = []; // naplánované spustenie ďalšej hry série - beží až na zázname „next“
  const engine = createRecordedEngine({ schedule: (fn) => { pending.push(fn); } }, {
    sink: (r) => out.push(r), now: () => 0, newId: () => start.m, seed: () => start.seed,
  });
  const person = (side) => engine.game.seats[SLOT[side]];
  const noop = () => {};
  for (const r of recs) {
    switch (r.t) {
      case "match_start": engine.startMatch(r.config); break;
      case "team": if (!r.random) engine.chooseTeam(person(r.side), r.team); break;
      case "pick": if (!r.random) engine.chooseCharacter(person(r.side), r.char); break;
      case "lock": engine.lockIn(person(r.side), r.q, r.turn, noop); break;
      case "ts": engine.timestopActions(person(r.side), r.q, noop); break;
      case "auto":
        for (const [side, draft] of Object.entries(r.drafts || {})) {
          engine.game.players[SLOT[side]].draft = draft === null ? undefined : structuredClone(draft);
        }
        engine.autoLock();
        break;
      case "next": pending.shift()?.(); break;
      case "match_end": if (r.reason !== "finished") engine.abort(r.reason); break;
      default: continue; // fakty (round, game_end) sa neprehrávajú - replay ich odvodí sám
    }
    onInput?.(r, engine);
  }
  return { engine, records: out };
}

// záznam bez polí, ktoré sa pri replayi legitímne líšia (čas, verzia servera)
export function normalize(r) {
  const { at, ts, commit, dirty, balance, ...rest } = r;
  void at; void ts; void commit; void dirty; void balance;
  return rest;
}

// porovná log so znova odvodenými záznamami - vracia prvý rozdiel alebo null
export function diffReplay(recs, replayed) {
  const a = recs.map(r => JSON.stringify(normalize(r)));
  const b = replayed.map(r => JSON.stringify(normalize(r)));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return { index: i, logged: a[i] ?? null, replayed: b[i] ?? null };
  }
  return null;
}
