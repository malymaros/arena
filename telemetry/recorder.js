// telemetry/recorder.js - zber herných dát (docs/TELEMETRY.md). Obalí engine jednej roomky a do `sink`
// zapisuje záznamy zápasu ako ploché objekty (server ich ukladá ako JSONL, viď telemetry/store.js).
//
// Zapisujú sa DVA druhy záznamov:
//  - VSTUPY (match_start so seedom a configom, team, pick, lock, ts, auto, next) - presne to, čo engine
//    dostal, v poradí, v akom to dostal. Engine je deterministický (rand() seedovaný v startMatch), takže
//    z nich telemetry/replay.js prehrá celý zápas znova (na tom istom commite).
//  - FAKTY (round, game_end, match_end) - čo sa stalo, odčítané z nemaskovanej timeline. Žiadne hodnotenia.
//
// Hráči sa neukladajú (ani mená, ani osoby A/B) - len strany: white = p1 (vľavo), black = p2 (vpravo);
// strany sú fixné na celú sériu. Engine sa nemení: recorder len obaľuje jeho príkazy a io háčiky.
// Telemetria nesmie zhodiť hru - zápis do sinku je v try/catch.
import crypto from "crypto";
import { createEngine } from "../engine/game.js";
import { ARENA_SEED, FORCE_FIRST_STARTER } from "../engine/constants.js";

export const SCHEMA = 1;
export const SIDE = { p1: "white", p2: "black" };
export const SLOT = { white: "p1", black: "p2" };

const copy = (v) => {
  if (v === undefined) return null;
  try { return JSON.parse(JSON.stringify(v)); } catch { return null; }
};

// stav maga na konci kola (len herné fakty, bez vizuálnych/plánovacích flagov)
function actorEnd(p) {
  return {
    char: p.char, pos: [p.x, p.y], hp: p.hp, mana: p.mana, stone: p.stone, pride: p.pride, moon: p.moon,
    clone: p.clone ? [p.clone.x, p.clone.y] : null, trap: p.trap ? [p.trap.x, p.trap.y] : null,
    worldUsed: p.worldUsed, labyrinth: p.labyrinth, manaRefills: p.manaRefills,
    lastStand: !!p.lastStandBuff, lastHope: !!p.lastHopeBuff,
  };
}

// timeline jedného kola → segmenty: každá akcia (framy s rovnakým neenumerovateľným tagom frame.act)
// je jeden segment; framy mimo akcií (dlaždice, koniec kola…) sa zlúčia do segmentov bez `side`.
// Segment: kto/čo (side, type, dir, to), počty efektov podľa druhu (fx), zásahy (hits) a zmena HP/many.
function segments(frames) {
  const segs = [];
  let cur = null, prev = frames[0];
  const close = () => {
    if (!cur) return;
    const fx = {}, hits = [];
    let action = null, invalid = null;
    for (const f of cur.frames) {
      for (const e of f.effects || []) {
        if (e.kind === "action") { if (!action) action = e.action; continue; }
        fx[e.kind] = (fx[e.kind] || 0) + 1;
        if (e.kind === "hit") {
          hits.push({ to: SIDE[e.target] ?? e.target, dmg: e.dmg,
            ...(e.parts ? { parts: copy(e.parts) } : {}), ...(e.bonus ? { bonus: e.bonus } : {}),
            ...(e.self ? { self: true } : {}), ...(e.portalBonus ? { portalBonus: e.portalBonus } : {}) });
        }
        if (e.kind === "invalid") invalid = e.reason || "invalid";
      }
    }
    const last = cur.frames[cur.frames.length - 1];
    const d = {};
    for (const slot of ["p1", "p2"]) {
      const hp = (last[slot]?.hp ?? 0) - (cur.before[slot]?.hp ?? 0);
      const mana = (last[slot]?.mana ?? 0) - (cur.before[slot]?.mana ?? 0);
      if (hp || mana) d[SIDE[slot]] = { ...(hp ? { hp } : {}), ...(mana ? { mana } : {}) };
    }
    const seg = {};
    if (cur.act) {
      seg.side = SIDE[cur.act.slot];
      seg.type = action?.type ?? null;
      if (action?.dir) seg.dir = action.dir;
      if (action?.to) seg.to = action.to;
    } else if (!Object.keys(fx).length && !Object.keys(d).length) { cur = null; return; } // prázdny medzikrok
    seg.fx = fx;
    if (invalid) seg.invalid = invalid;
    if (hits.length) seg.hits = hits;
    if (Object.keys(d).length) seg.d = d;
    segs.push(seg);
    cur = null;
  };
  for (const f of frames) {
    const key = f.act ? f.act.n : null;
    if (!cur || cur.key !== key) { close(); cur = { key, act: f.act || null, before: prev, frames: [] }; }
    cur.frames.push(f);
    prev = f;
  }
  close();
  return segs;
}

// io = háčiky enginu (ako pre createEngine). opts:
//   sink(record)  - kam ísť so záznamom; bez sinku sa nič nezapisuje (len seed per zápas)
//   now()         - hodiny (ms) pre `at` = ms od začiatku zápasu
//   newId()       - id zápasu
//   seed()        - seed RNG pre nový zápas (default ARENA_SEED, inak náhodný)
//   meta          - pridá sa do match_start (commit, verzia balansu…)
// Vracia objekt s rovnakým API ako engine (game, startMatch, lockIn…) + abort(reason).
export function createRecordedEngine(io = {}, opts = {}) {
  const {
    sink = null, now = Date.now, newId = () => crypto.randomBytes(6).toString("hex"),
    seed: seedFn = () => ARENA_SEED ?? crypto.randomInt(2 ** 32), meta = {},
  } = opts;
  let m = null;        // id práve zapisovaného zápasu (null = nič sa nezapisuje)
  let seed = null;     // seed aktuálneho zápasu - engine si ho prečíta v startMatch (io.seed)
  let t0 = 0;
  let held = null;     // framy kola pozastaveného THE WORLD (čaká na pokračovanie)
  let lastSegs = null; // segmenty posledného kola (posledný zásah pred koncom hry)
  let gameStarter = null;

  const write = (rec) => {
    if (!sink || !m) return;
    try { sink({ t: rec.t, m, ...rec }); } catch { /* telemetria nesmie zhodiť hru */ }
  };
  const at = () => now() - t0;

  const engine = createEngine({
    ...io,
    get seed() { return seed; },
    emit: (ev, payload) => { onEmit(ev, payload); io.emit?.(ev, payload); },
    emitState: (tl) => { if (tl) onTimeline(tl); io.emitState?.(tl); },
    // ďalšia hra série sa spúšťa časovačom - jeho výstrel je vstup (replay ho musí spustiť v rovnakom poradí)
    schedule: (fn, ms) => {
      const mm = m;
      return (io.schedule || setTimeout)(() => { if (mm && mm === m) write({ t: "next", at: at() }); fn(); }, ms);
    },
  });
  const game = () => engine.game;
  const sideOf = (person) => game().seats.p1 === person ? "white" : game().seats.p2 === person ? "black" : null;
  const gi = () => game().series?.gameIndex ?? null;

  function safe(fn) { try { fn(); } catch { /* telemetria nesmie zhodiť hru */ } }

  function onTimeline(tl) {
    safe(() => {
      // THE WORLD: najprv príde čiastočná timeline (pauza), potom pokračovanie, ktorého frame [0] je kópia stavu
      const frames = held ? held.concat(tl.slice(1)) : tl.slice();
      if (game().timestop?.mode === "waiting") { held = frames; return; }
      held = null;
      const f0 = frames[0];
      if (f0.turn === 1) gameStarter = SIDE[f0.starter];
      lastSegs = segments(frames);
      write({ t: "round", at: at(), g: f0.series?.gameIndex ?? gi(), turn: f0.turn, starter: SIDE[f0.starter],
        segs: lastSegs, end: { white: actorEnd(game().players.p1), black: actorEnd(game().players.p2) } });
    });
  }

  function onEmit(ev, payload) {
    safe(() => {
      const g = game();
      if (ev === "char_roll") {
        // náhodné postavy: vylosoval ich server (turnaj: celé tímy)
        for (const slot of ["p1", "p2"]) {
          const picks = payload.picks?.[slot] || [];
          if (payload.team) write({ t: "team", at: at(), side: SIDE[slot], team: [...picks], random: true });
          else write({ t: "pick", at: at(), g: gi(), side: SIDE[slot], char: picks[0], random: true });
        }
      } else if (ev === "game_result") {
        const w = payload.gameWinner;
        const loser = w === "p1" ? "black" : w === "p2" ? "white" : null;
        let lastHit = null;
        for (let i = (lastSegs?.length || 0) - 1; i >= 0 && loser; i--) {
          const s = lastSegs[i];
          if ((s.d?.[loser]?.hp || 0) < 0) {
            lastHit = s.side ? { side: s.side, type: s.type } : { side: null, fx: Object.keys(s.fx) };
            break;
          }
        }
        write({ t: "game_end", at: at(), g: gi(), winner: SIDE[w] ?? w, rounds: g.turn, starter: gameStarter,
          chars: { white: g.players.p1.char, black: g.players.p2.char },
          random: !!(g.config?.randomChars && g.config.format !== "tournament"),
          final: { white: { hp: g.players.p1.hp, mana: g.players.p1.mana }, black: { hp: g.players.p2.hp, mana: g.players.p2.mana } },
          lastHit,
          ...(g.mageHp ? { roster: {
            white: { hp: { ...g.mageHp[g.seats.p1] }, mana: { ...g.mageMana[g.seats.p1] } },
            black: { hp: { ...g.mageHp[g.seats.p2] }, mana: { ...g.mageMana[g.seats.p2] } } } } : {}) });
      } else if (ev === "game_over") {
        write({ t: "match_end", at: at(), reason: "finished", winner: SIDE[payload.winner] ?? payload.winner, score: score() });
        m = null;
      }
    });
  }

  function score() {
    const g = game();
    return { white: g.seriesWins?.[g.seats.p1] || 0, black: g.seriesWins?.[g.seats.p2] || 0 };
  }

  // nedohraný zápas (retry, admin reset, roomka zanikla)
  function abort(reason) {
    if (!m) return;
    safe(() => write({ t: "match_end", at: at(), reason, score: score() }));
    m = null;
    held = null;
  }

  function startMatch(config) {
    abort("restart");
    seed = seedFn();
    t0 = now();
    held = null; lastSegs = null; gameStarter = null;
    m = sink ? newId() : null;
    write({ t: "match_start", v: SCHEMA, ts: new Date(t0).toISOString(), ...meta, seed,
      forceFirst: FORCE_FIRST_STARTER || null, config: copy(config) });
    engine.startMatch(config);
  }

  function chooseTeam(person, keys) {
    const had = !!game().roster?.[person];
    const s = sideOf(person);
    const team = copy(keys);
    engine.chooseTeam(person, keys);
    if (!had && game().roster?.[person]) write({ t: "team", at: at(), side: s, team, random: false });
  }

  function chooseCharacter(person, key) {
    const s = sideOf(person);
    const slot = SLOT[s];
    const before = slot ? game().players[slot]?.char : null;
    const g = gi();
    engine.chooseCharacter(person, key);
    const after = slot ? game().players[slot]?.char : null;
    if (!before && after) write({ t: "pick", at: at(), g, side: s, char: after, random: false });
  }

  function lockIn(person, queue, clientTurn, ack) {
    if (typeof clientTurn === "function") { ack = clientTurn; clientTurn = undefined; }
    const g = game(), s = sideOf(person), slot = SLOT[s];
    const turn = g.turn, gIdx = gi();
    // nový (nie zopakovaný) ťah - zopakovaný lock_in engine potvrdí, ale nič nezmení
    const fresh = !!slot && g.phase === "playing" && !g.players[slot].locked
      && (clientTurn === undefined || clientTurn === turn);
    const q = copy(queue);
    engine.lockIn(person, queue, clientTurn, (r) => {
      if (fresh && r?.ok) write({ t: "lock", at: at(), g: gIdx, turn, side: s, q });
      if (typeof ack === "function") ack(r);
    });
  }

  function timestopActions(person, queue, ack) {
    const g = game(), s = sideOf(person);
    const fresh = g.timestop?.mode === "waiting" && SLOT[s] === g.timestop.slot;
    const turn = g.turn, gIdx = gi();
    const q = copy(queue);
    engine.timestopActions(person, queue, (r) => {
      if (fresh && r?.ok) write({ t: "ts", at: at(), g: gIdx, turn, side: s, q });
      if (typeof ack === "function") ack(r);
    });
  }

  // vypršal čas na ťah: zapíš rozpracované drafty nezamknutých strán - engine z nich doplní frontu
  function autoLock() {
    const g = game();
    if (g.phase === "playing" && g.players.p1.char && g.players.p2.char) {
      const drafts = {};
      for (const slot of ["p1", "p2"]) if (!g.players[slot].locked) drafts[SIDE[slot]] = copy(g.players[slot].draft);
      write({ t: "auto", at: at(), g: gi(), turn: g.turn, drafts });
    }
    engine.autoLock();
  }

  function newGame() {
    abort("retry");
    engine.newGame();
  }

  const api = Object.assign(Object.create(engine), {
    startMatch, chooseTeam, chooseCharacter, lockIn, timestopActions, autoLock, newGame, abort,
  });
  // id práve zapisovaného zápasu (bug report naň odkáže; null = nič sa nezapisuje) - getter, Object.assign by ho zmrazil
  Object.defineProperty(api, "matchId", { get: () => m });
  return api;
}
