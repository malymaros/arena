// engine/ai/model.js - model súpera (docs/AI_PLAN.md 3.5, fáza A5): z odhalených front súpera (belief.history)
// odhadne, ako pravdepodobne zahrá ktorú frontu. Pozičné frekvencie typov akcií (1./2./3. akcia) zvlášť pri
// mane ≥ 5 a < 5, Laplaceovo vyhladenie. Bot podľa neho posunie predpokladanú súperovu zmes od Nasha
// a zahrá najlepšiu odpoveď - o toľko, o koľko je model istý: počet pozorovaní × predvídateľnosť súpera
// (ako často na danej pozícii hrá ten istý typ), nikdy úplne (zvyšok ostáva rovnováha - bezpečnosť).
const EXTRA = new Set(["golden_shield", "golden_mirror", "golden_mana", "last_stand", "last_hope", "stoned", "unknown"]);
const TYPES = ["move", "dash", "recharge", "attack", "melee", "special", "shield", "mirror", "special1", "shield_breaker", "mirror_breaker", "demon", "pass"];
const ctxOf = (mana) => (mana >= 5 ? "hi" : "lo");
export const MAX_WEIGHT = 0.8;

export function createOpponentModel(history) {
  const counts = { hi: [{}, {}, {}], lo: [{}, {}, {}] }, n = { hi: 0, lo: 0 };
  const patterns = new Map(); // postupnosť typov („shield attack recharge") → počet
  for (const h of history) {
    const base = (h.actions || []).filter(a => a && !EXTRA.has(a.type));
    if (base.length !== 3 || h.mana === null || h.mana === undefined) continue;
    const c = ctxOf(h.mana);
    n[c]++;
    base.forEach((a, i) => { counts[c][i][a.type] = (counts[c][i][a.type] || 0) + 1; });
    const key = base.map(a => a.type).join(" ");
    patterns.set(key, (patterns.get(key) || 0) + 1);
  }
  const total = n.hi + n.lo;
  // predvídateľnosť: priemerný podiel najčastejšieho typu na pozícii (1 = vždy to isté, ~0.1 = náhodne)
  let conc = 0, cnt = 0;
  for (const c of ["hi", "lo"]) {
    if (!n[c]) continue;
    for (const pos of counts[c]) { conc += n[c] * Math.max(...Object.values(pos)) / n[c]; cnt += n[c]; }
  }
  const predictability = cnt ? conc / cnt : 0;
  return {
    observations: total,
    predictability,
    weight: Math.min(MAX_WEIGHT, total / (total + 3)) * predictability,
    // relatívna pravdepodobnosť fronty (len základné 3 akcie) pri súperovej mane
    score(queue, mana) {
      const c = n[ctxOf(mana)] >= 2 ? ctxOf(mana) : (n.hi >= n.lo ? "hi" : "lo");
      const base = queue.filter(a => !EXTRA.has(a.type));
      let s = 1;
      base.forEach((a, i) => {
        const cnt = counts[c][Math.min(i, 2)];
        s *= ((cnt[a.type] || 0) + 0.5) / (n[c] + 0.5 * TYPES.length);
      });
      return s;
    },
    // opakované vzory typov (aspoň 2×) - bot do matice doplní konkrétne fronty s týmito typmi
    patterns(limit = 3) {
      return [...patterns.entries()].filter(([, k]) => k >= 2).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([p]) => p);
    },
  };
}
