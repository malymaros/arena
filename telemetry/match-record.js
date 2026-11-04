// telemetry/match-record.js - záznam zápasu pre MATCHES / ANALYZE (docs/MATCH_REVIEW_PLAN.md).
// Z timeline, ktoré engine posiela hráčom, skladá ZÁPIS KOLA pre každý pohľad (p1 = biely, p2 = čierny):
// stav na začiatku kola a stav po každej akcii - presne tak, ako ho daný hráč dostal (redactTimelineFor), bez efektov.
// Ukladajú sa výsledné stavy, nič sa nedosimulováva → záznam nezávisí od budúcej hernej logiky.
// Bez identity hráčov: mená sa zo stavov odstránia (FRAME_DROP), strany sú len p1 / p2.
import { MATCH_RECORD_VERSION, FRAME_DROP } from "../shared/match-record.js";

const ARENA_KEY = { "portal-realm": "portal", "shrek-swamp": "swamp" };
const OTHER = { p1: "p2", p2: "p1" };

// stav pre zápis: hlboká kópia bez efektov / mien / hlavičky
function strip(f) {
  const o = {};
  for (const k of Object.keys(f)) if (!FRAME_DROP.includes(k) && f[k] !== undefined) o[k] = f[k];
  return JSON.parse(JSON.stringify(o));
}
const effectsOf = (f) => f?.effects || [];
const startsBeat = (f) => effectsOf(f).some(e => e && (e.kind === "action" || e.kind === "beat_empty" || e.kind === "timestop_end"));

// framy jedného pohľadu → { start, beats[] }; beat = { from, action | empty | tsEnd, frozen?, invalid?, state }
// stav beatu = posledný frame pred začiatkom ďalšieho beatu (zahŕňa dlaždice / Shreka po kroku, koniec kola po
// poslednom golden beate)
export function roundView(frames) {
  const beats = [];
  let cur = null;
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i];
    if (startsBeat(f)) {
      const e = effectsOf(f).find(x => x.kind === "action" || x.kind === "beat_empty" || x.kind === "timestop_end");
      cur = { from: e.from ?? null };
      if (e.kind === "action") { cur.action = { ...e.action }; if (e.frozen) cur.frozen = true; }
      else if (e.kind === "beat_empty") cur.empty = e.beat;
      else cur.tsEnd = true;
      beats.push(cur);
    }
    if (cur && effectsOf(f).some(e => e.kind === "invalid" && e.target === cur.from)) cur.invalid = true;
    if (cur) cur.last = i;
  }
  return {
    start: strip(frames[0]),
    beats: beats.map(({ last, ...b }) => ({ ...b, state: strip(frames[last]) })),
  };
}

// prečo porazený zomrel - z nemaskovaných framov posledného kola (segmenty podľa frame.act)
export function endCause(frames, loser) {
  let seg = null, prev = frames[0];
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i];
    const drop = (f[loser]?.hp ?? 0) < (prev[loser]?.hp ?? 0);
    if (drop) {
      // celý segment (framy s tým istým tagom akcie, alebo súvislý úsek bez tagu)
      const key = f.act ? f.act.n : null;
      let a = i, b = i;
      while (a > 1 && (frames[a - 1].act ? frames[a - 1].act.n : null) === key) a--;
      while (b + 1 < frames.length && (frames[b + 1].act ? frames[b + 1].act.n : null) === key) b++;
      seg = { side: f.act?.slot ?? null, kinds: new Set(frames.slice(a, b + 1).flatMap(x => effectsOf(x).map(e => e.kind))) };
    }
    prev = f;
  }
  if (!seg) return "attack";
  const k = seg.kinds;
  const env = [...k].some(x => x.startsWith("shrek_") || x === "stench_proc" || x === "last_stand_kill" || x === "last_stand_banish_kill");
  if (!seg.side || env) return "arena";             // dlaždice, IK, Shrek, smrad, doom po Last Stande
  if (seg.side === loser) return k.has("mirror") || k.has("breaker") ? "mirror" : "attack"; // vlastný útok odrazený / vlastná strela cez portál, pasca
  return k.has("breaker") ? "breaker" : "attack";
}

// hlavička hry pre klienta (spoločná pre všetky stavy hry): doska, aréna, config, séria, bot
function baseOf(snap) {
  const b = { board: snap.board, arena: snap.arena, config: snap.config, series: snap.series };
  if (snap.vsAi) b.vsAi = snap.vsAi;
  if (snap.aiLevel) b.aiLevel = snap.aiLevel;
  return JSON.parse(JSON.stringify(b));
}

// Zapisovač jedného zápasu. engine = createEngine API (redactTimelineFor, game); save(record) = hotový záznam.
export function createMatchRecorder(engine, { save, now = Date.now, newId }) {
  let rec = null;      // rozpracovaný záznam zápasu
  let held = null;     // THE WORLD: framy pozastaveného kola { raw, p1, p2 }
  let lastRaw = null;  // nemaskované framy posledného kola (príčina konca hry)
  const g = () => engine.game;

  function curGame() {
    const gi = g().series?.gameIndex ?? 1;
    let gm = rec.games[rec.games.length - 1];
    if (!gm || gm.g !== gi) {
      const gs = g();
      gm = { g: gi, chars: { p1: gs.players.p1.char, p2: gs.players.p2.char }, winner: null, cause: null, demon: [], rounds: [],
        base: baseOf(engine.snapshot()) };
      rec.games.push(gm);
    }
    return gm;
  }

  function matchStart(ai) {
    const gs = g();
    rec = { v: MATCH_RECORD_VERSION, id: newId(), ts: new Date(now()).toISOString(),
      arena: ARENA_KEY[gs.arena] || "bridge", randomArena: !!gs.config?.randomArena, format: gs.config?.format || "single",
      ai: ai || null, games: [], score: { p1: 0, p2: 0 }, finished: false };
    held = null; lastRaw = null;
  }

  function timeline(tl) {
    if (!rec || !tl?.length) return;
    // pohľady redigované v momente vyslania - presne to, čo dostali hráči
    const part = { raw: tl, p1: engine.redactTimelineFor("p1", tl), p2: engine.redactTimelineFor("p2", tl) };
    // THE WORLD: pokračovanie nesie ako frame [0] kópiu stavu - vynechaj ho
    const all = held
      ? { raw: held.raw.concat(part.raw.slice(1)), p1: held.p1.concat(part.p1.slice(1)), p2: held.p2.concat(part.p2.slice(1)) }
      : part;
    if (g().timestop?.mode === "waiting") { held = all; return; }
    held = null;
    lastRaw = all.raw;
    const gm = curGame();
    const f0 = all.raw[0];
    // kolo s démonom = FINAL ROUND (buff Last Stand platí od začiatku kola), nie kolo, v ktorom sa démon vyvolal
    const demon = !!(f0.p1?.lastStandBuff || f0.p2?.lastStandBuff);
    if (demon) gm.demon.push(f0.turn);
    // kolo, v ktorom hra skončila: zamknuté akcie oboch strán (aj tie, na ktoré už nedošlo - rozbor ich ukáže
    // zašednuté). Fronty engine nuluje až po vyslaní timeline, takže tu ešte sú.
    const last = all.raw[all.raw.length - 1];
    const ended = (last.p1?.hp ?? 1) <= 0 || (last.p2?.hp ?? 1) <= 0;
    const planned = ended ? Object.fromEntries(["p1", "p2"].map(s => {
      const p = g().players[s];
      return [s, { queue: JSON.parse(JSON.stringify(p.queue || [])), ...(p.goldenMana ? { goldenMana: true } : {}), ...(p.lastStand ? { lastStand: true } : {}) }];
    })) : null;
    // char sa v turnaji mení swapom - v hlavičke hry je postava, s ktorou hru začal
    gm.rounds.push({ turn: f0.turn, starter: f0.starter, ...(demon ? { demon: true } : {}), ...(planned ? { planned } : {}),
      views: { p1: roundView(all.p1), p2: roundView(all.p2) } });
  }

  function gameResult(payload) {
    if (!rec) return;
    const gm = curGame();
    gm.winner = payload.gameWinner || null;
    gm.cause = gm.winner && lastRaw ? endCause(lastRaw, OTHER[gm.winner]) : null;
    const gs = g();
    rec.score = { p1: gs.seriesWins?.[gs.seats.p1] || 0, p2: gs.seriesWins?.[gs.seats.p2] || 0 };
    if (gs.roster) rec.team = { p1: [...(gs.roster[gs.seats.p1] || [])], p2: [...(gs.roster[gs.seats.p2] || [])] };
    if (gs.mageHp) rec.dead = { p1: (rec.team?.p1 || []).filter(c => (gs.mageHp[gs.seats.p1]?.[c] ?? 1) <= 0), p2: (rec.team?.p2 || []).filter(c => (gs.mageHp[gs.seats.p2]?.[c] ?? 1) <= 0) };
  }

  // koniec zápasu: finished = séria rozhodnutá; inak (retry, odchod, reset) sa uloží, ak sa odohralo aspoň jedno kolo
  function end(finished) {
    if (!rec) return;
    const r = rec; rec = null; held = null;
    r.finished = !!finished;
    r.games = r.games.filter(x => x.rounds.length);
    if (!r.games.length) return;
    try { save(r); } catch { /* záznam nesmie zhodiť hru */ }
  }

  return { matchStart, timeline, gameResult, end, get active() { return !!rec; } };
}
