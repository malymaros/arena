// tools/random-bot.mjs - náhodný hráč pre headless simulácie (tools/simulate.mjs, tools/difftest.mjs).
// Seedovaný generátor skúša náhodné fronty cez engine.lockIn, kým ich engine neprijme (neplatné odmietne
// validQueue) - deterministický pri rovnakom seede. Zámerne nepozná pravidlá postáv: o platnosti
// rozhoduje engine, takže bot automaticky pokrýva aj nové postavy a akcie.

// mulberry32 - rovnaký PRNG ako server
export function seededRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = ["move", "dash", "recharge", "attack", "melee", "special", "shield", "mirror", "special1", "demon", "shield_breaker", "mirror_breaker"];
const TS_TYPES = ["move", "dash", "recharge", "attack", "melee", "shield", "special1", "shield_breaker"];
const DIRS = ["up", "down", "left", "right", "up_left", "up_right", "down_left", "down_right"];

function candidate(rng, board, stone, isStarter) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const q = Array.from({ length: Math.min(3, stone || 0) }, () => ({ type: "stoned" }));
  const pool = [...TYPES];
  while (q.length < 3) {
    const a = { type: pool.splice(Math.floor(rng() * pool.length), 1)[0] };
    if (rng() < 0.75) a.dir = pick(DIRS);
    if (rng() < 0.3) a.cell = { x: Math.floor(rng() * board.w), y: Math.floor(rng() * board.h) };
    q.push(a);
  }
  if (!isStarter && rng() < 0.2) q.unshift({ type: rng() < 0.5 ? "golden_shield" : "golden_mirror" });
  if (rng() < 0.15) q.push({ type: rng() < 0.85 ? "golden_mana" : "last_stand" });
  if (rng() < 0.05) q.unshift({ type: "last_hope" });
  return q;
}

// zahrá kolo za osobu (A/B): prvú prijatú náhodnú frontu. Vracia frontu alebo null (nič neprijaté).
export function botLock(engine, person, rng, tries = 2000) {
  const g = engine.game;
  const slot = g.seats.p1 === person ? "p1" : "p2";
  for (let i = 0; i < tries; i++) {
    const q = candidate(rng, g.board, g.players[slot].stone, g.starter === slot);
    let ok = false;
    engine.lockIn(person, q, g.turn, (r) => { ok = !!r?.ok; });
    if (ok) return q;
  }
  return null;
}

// THE WORLD: Jotaro pošle 3 náhodné zmrazené akcie (prvé prijaté)
export function botTimestop(engine, person, rng, tries = 2000) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  for (let i = 0; i < tries; i++) {
    const pool = [...TS_TYPES], q = [];
    while (q.length < 3) {
      const a = { type: pool.splice(Math.floor(rng() * pool.length), 1)[0] };
      if (rng() < 0.75) a.dir = pick(DIRS);
      q.push(a);
    }
    let ok = false;
    engine.timestopActions(person, q, (r) => { ok = !!r?.ok; });
    if (ok) return q;
  }
  return null;
}

// odohrá zápas dvoch náhodných botov, kým isOver() nevráti true (game_result zachytáva volajúci cez io.emit)
export function playBotMatch(engine, seed, isOver, maxRounds = 60) {
  const rng = { A: seededRng(seed * 2 + 1), B: seededRng(seed * 2 + 2) };
  let rounds = 0;
  while (!isOver() && rounds < maxRounds) {
    const g = engine.game;
    if (g.timestop?.mode === "waiting") {
      const person = g.seats[g.timestop.slot];
      if (!botTimestop(engine, person, rng[person])) break;
      continue;
    }
    rounds++;
    if (!botLock(engine, "A", rng.A) || !botLock(engine, "B", rng.B)) break;
  }
  return rounds;
}
