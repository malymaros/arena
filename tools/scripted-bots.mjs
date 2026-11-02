// tools/scripted-bots.mjs - predvídateľní „exploit" súperi pre meranie AI bota (docs/AI_PLAN.md 5.3):
// každý štýl hrá stále ten istý vzor (smery k súperovi). Dobrý bot ich musí výrazne poraziť a model súpera
// (fáza A5) by ich mal trestať ešte viac. Čítajú engine.game priamo - sú to testovací súperi, nie hráči.
const DIRS = ["up", "down", "left", "right", "up_left", "up_right", "down_left", "down_right"];

export const STYLES = {
  // vždy najprv štít, potom útok
  shieldy: [["shield", "attack", "recharge"], ["shield", "recharge", "move"], ["shield", "move", "recharge"]],
  // stále útočí, special keď môže
  aggro: [["attack", "special", "melee"], ["move", "attack", "special"], ["attack", "recharge", "special"], ["attack", "recharge", "move"]],
  // len obrana a dobíjanie
  turtle: [["shield", "recharge", "mirror"], ["mirror", "recharge", "shield"], ["shield", "recharge", "move"]],
  // special vždy, keď má manu, inak dobíja
  greedy: [["special", "attack", "recharge"], ["recharge", "special", "attack"], ["recharge", "attack", "shield"], ["recharge", "move", "attack"]],
};

// smery zoradené „k súperovi" (najprv tie, ktoré skracujú vzdialenosť)
function towardDirs(me, foe) {
  const score = (d) => {
    const dx = (d.includes("left") ? -1 : d.includes("right") ? 1 : 0), dy = (d.includes("up") ? -1 : d.includes("down") ? 1 : 0);
    return Math.abs(foe.x - (me.x + dx)) + Math.abs(foe.y - (me.y + dy));
  };
  return [...DIRS].sort((a, b) => score(a) - score(b));
}

function options(type, me, foe, board) {
  const dirs = towardDirs(me, foe);
  const cells = [];
  for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) cells.push({ x, y });
  cells.sort((a, b) => (Math.abs(a.x - foe.x) + Math.abs(a.y - foe.y)) - (Math.abs(b.x - foe.x) + Math.abs(b.y - foe.y)));
  if (type === "move" || type === "dash" || type === "attack") return dirs.map(dir => ({ type, dir }));
  if (type === "special" || type === "special1") return [{ type }, ...dirs.map(dir => ({ type, dir })), ...cells.map(cell => ({ type, cell }))];
  return [{ type }];
}

// zamkni frontu podľa štýlu; vráti true, ak engine niektorú prijal
export function scriptedLock(engine, person, style) {
  const g = engine.game, slot = g.seats.p1 === person ? "p1" : "p2";
  const me = g.players[slot], foe = g.players[slot === "p1" ? "p2" : "p1"];
  const stone = Math.min(3, me.stone || 0);
  const pre = Array.from({ length: stone }, () => ({ type: "stoned" }));
  for (const tpl of STYLES[style] || []) {
    const parts = tpl.slice(0, 3 - stone).map(t => options(t, me, foe, g.board));
    // prvá platná kombinácia (preferované smery prvé), obmedzene
    const rec = (i, acc) => {
      if (i === parts.length) {
        const q = [...pre, ...acc];
        return engine.validQueue(q, slot) ? q : null;
      }
      for (const a of parts[i].slice(0, 12)) { const r = rec(i + 1, [...acc, a]); if (r) return r; }
      return null;
    };
    const q = rec(0, []);
    if (!q) continue;
    let ok = false;
    engine.lockIn(person, q, g.turn, (r) => { ok = !!r?.ok; });
    if (ok) return true;
  }
  return false;
}
