// engine/swamp.js - Shrek Swamp (tretia aréna, docs/SWAMP_PLAN.md): neutrálne NPC Shrek namiesto špeciálnych dlaždíc.
// Fáza 1: pred kolom ohlási 3 očíslované políčka (game.shrek.marks - tri rôzne, žiadne nie je jeho aktuálne), po k-tom
// kroku skočí na k-te a zareve: zasiahne políčko dopadu + jeho ortogonálnych susedov. Sila revu rastie s klesajúcimi HP
// (SHREK_ROAR_DMG / SHREK_RAGE_HP).
// Kto ho zasiahne, spustí reakciu: strela a melee → okamžitý rev; special zboku → PowerUp + tackle po riadku
// k útočníkovi (prvá figúra v ceste, Shrek sa vráti), special od útočníka v tom istom stĺpci → okamžitý rev. Fáza 2: pri 0 HP padne (leží, nič neblokuje) a z tela
// sa šíri smrad - kolo smrti jeho políčko, každé ďalšie kolo + ortogonálni susedia; smrad = STENCH_DMG na konci kroku.
// Shrekove útoky sú ako dlaždice: obchádzajú štít/mirror, ½ pri Last Stand/Hope platí, skamenenú postavu
// nezasiahnu, tieňový klon dostane len kozmetický zásah (nesmie prezradiť, ktorá figúra je pravá). Počas THE WORLD
// je Shrek inertný (strely ním prejdú).
// Itemy (namiesto dlaždíc): srdiečko (+1 HP) a kvapka (+1 mana) padnú na voľné políčka na štarte
// hry a na konci každého kola (config.itemsPerRound, itemWeights, max ITEM_MAX); hráč ich zoberie hneď pri vstupe
// na políčko alebo prechode cezeň (prejdené bunky akcie z actionSteps - rovnaký zber ako pri pasci). Klon ich neberie.
// Továreň dostane E = vnútorný scope enginu (createEngine v engine/game.js), ako ostatné moduly mechaník.
import {
  START_POS, SMALL_DELAY_MS, SHREK_HP, SHREK_ROAR_DMG, SHREK_RAGE_HP,
  STENCH_DMG, START_HP, MAX_MANA, ITEMS_PER_ROUND, ITEM_WEIGHTS, ITEM_HEAL_GAIN, ITEM_MANA_GAIN, ITEM_MAX, SHREK_JUMP_MS, SHREK_ROAR_MS, SHREK_HIT_MS, SHREK_HIT_SOUND_MS, SHREK_CALL_MS, SHREK_POWERUP_MS,
  SHREK_TACKLE_MS, SHREK_RETURN_MS, SHREK_DIE_MS, STENCH_PROC_MS,
} from "./constants.js";

export function swampModule(E) {
const isSwamp = () => E.game.config?.arena === "swamp";
const shrek = () => (isSwamp() ? E.game.shrek : null);
const order = () => (E.game.starter === "p1" ? ["p1", "p2"] : ["p2", "p1"]);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

// živý Shrek na bunke - počas THE WORLD (zamrazený čas) je inertný: strely/údery ním prejdú bez reakcie
function shrekAt(x, y) {
  const s = shrek();
  return !!s && !s.dead && !E.frozenActive() && s.x === x && s.y === y;
}

function roarDmg() {
  const hp = E.game.shrek.hp;
  return hp <= SHREK_RAGE_HP[1] ? SHREK_ROAR_DMG[2] : hp <= SHREK_RAGE_HP[0] ? SHREK_ROAR_DMG[1] : SHREK_ROAR_DMG[0];
}

function randomCell(filter) {
  const cells = [];
  for (let y = 0; y < E.game.board.h; y++) for (let x = 0; x < E.game.board.w; x++) if (filter(x, y)) cells.push([x, y]);
  return cells[Math.floor(E.rand() * cells.length)];
}

// 3 očíslované skoky kola: tri RÔZNE políčka a žiadne nie je to, na ktorom Shrek práve stojí (hráči na cieli nevadia)
function rollMarks(from) {
  const marks = [];
  for (let k = 0; k < 3; k++) {
    const used = [from, ...marks];
    marks.push(randomCell((x, y) => !used.some(c => c[0] === x && c[1] === y)));
  }
  return marks;
}

// nová hra: Shrek mimo štartových políčok hráčov + ohlásené skoky 1. kola (mimo bažiny null)
function swampStartGame() {
  if (!isSwamp()) { E.game.shrek = null; return; }
  const start = randomCell((x, y) => !Object.values(START_POS).some(p => p.x === x && p.y === y));
  E.game.shrek = { x: start[0], y: start[1], hp: SHREK_HP, dead: false, marks: rollMarks(start), done: 0, stench: [] };
  E.game.items = [];
  spawnItems();
}

/* ---------- itemy ---------- */
// nové itemy na voľné políčka (bez itemu, hráča, klona a živého Shreka); vráti efekty pre finálny frame kola
function spawnItems() {
  const g = E.game, s = g.shrek;
  const n = Math.max(1, Math.min(3, g.config.itemsPerRound || ITEMS_PER_ROUND));
  const w = g.config.itemWeights || ITEM_WEIGHTS;
  const taken = (x, y) => g.items.some(i => i.x === x && i.y === y)
    || ["p1", "p2"].some(sl => { const p = g.players[sl]; return (p.x === x && p.y === y) || (p.clone && p.clone.x === x && p.clone.y === y); })
    || (s && !s.dead && s.x === x && s.y === y);
  const added = [];
  for (let k = 0; k < n && g.items.length < ITEM_MAX; k++) {
    const c = randomCell((x, y) => !taken(x, y));
    if (!c) break;
    const type = E.rand() * ((w.heal || 0) + (w.mana || 0)) < (w.heal || 0) ? "heal" : "mana";
    g.items.push({ x: c[0], y: c[1], type });
    added.push({ x: c[0], y: c[1], type });
  }
  return added.length ? [{ kind: "item_drop", items: added }] : [];
}

const itemsSnapshot = () => E.game.items.map(i => ({ ...i }));

// po akcii: hráč, ktorý vstúpil na políčko s itemom alebo ním prebehol (moved = actionSteps akcie), ho zoberie
// v poradí prejdených buniek. Klon itemy neberie (neodobraný item pod „postavou" prezrádza, ktorá je pravá).
function pickupItems(moved, tl) {
  if (!isSwamp() || !moved) return;
  for (const slot of order()) {
    const p = E.game.players[slot];
    for (const [x, y] of moved[slot] || []) {
      if (p.hp <= 0) break;
      const idx = E.game.items.findIndex(i => i.x === x && i.y === y);
      if (idx < 0) continue;
      const it = E.game.items[idx];
      E.game.items.splice(idx, 1);
      let amount;
      if (it.type === "heal") {
        amount = Math.min(START_HP, p.hp + ITEM_HEAL_GAIN) - p.hp; p.hp += amount;
      } else {
        amount = Math.min(MAX_MANA, p.mana + ITEM_MANA_GAIN) - p.mana; p.mana += amount;
      }
      E.pushStateFrame(tl, [{ kind: "item_pick", target: slot, cell: [x, y], type: it.type, amount }], SMALL_DELAY_MS);
    }
  }
}

// verejný stav pre snapshot (marks sú ohlásené vopred - vidia ich obaja aj prekliaty v labyrinte)
function shrekSnapshot() {
  const s = E.game.shrek;
  return s ? { x: s.x, y: s.y, hp: s.hp, dead: s.dead, marks: s.marks.map(c => [...c]), done: s.done, stench: s.stench.map(c => [...c]) } : null;
}

// zásah hráča prostredím (rev, tackle, sud/punch cez HP, smrad) - ako dlaždica: bez obrán, ½ pri Last Stand/Hope.
// Smrteľný zásah počas labyrintu prehrá rovnakú sekvenciu ako dlaždica (odhalenie pred, koniec labyrintu po).
function envHit(slot, raw, tl) {
  const p = E.game.players[slot];
  if (p.hp <= 0) return;
  const d = E.recvDmg(slot, raw);
  const lethalInLab = d >= p.hp && (E.game.players.p1.labyrinth || E.game.players.p2.labyrinth);
  if (lethalInLab) E.revealLabyrinths(tl);
  p.hp = Math.max(0, p.hp - d);
  E.pushStateFrame(tl, [{ kind: "hit", target: slot, dmg: d, shrek: true }], SMALL_DELAY_MS);
  if (lethalInLab) E.endLabyrinths(tl);
}

// kozmetický zásah klona (rovnaký float ako majiteľ - klon prostredím nezomiera, ako na dmg dlaždici)
function cloneCosmetic(slot, raw, tl) {
  const p = E.game.players[slot];
  if (!p.clone) return;
  E.pushStateFrame(tl, [{ kind: "clone_hit", target: slot, cell: [p.clone.x, p.clone.y], dmg: E.recvDmg(slot, raw) }], SMALL_DELAY_MS);
}

const stonedNow = (slot, stoned) => !!(stoned?.[slot]) || E.game.players[slot].stone > 0;

// rev: Shrekovo políčko + jeho ortogonálni susedia (kríž, na okraji/rohu menší)
function roar(tl, stoned = null) {
  const s = E.game.shrek, dmg = roarDmg();
  const inLine = (x, y) => Math.abs(x - s.x) + Math.abs(y - s.y) <= 1;
  const cells = [];
  for (let y = 0; y < E.game.board.h; y++) for (let x = 0; x < E.game.board.w; x++) if (inLine(x, y)) cells.push([x, y]);
  E.pushStateFrame(tl, [{ kind: "shrek_roar", cell: [s.x, s.y], cells, dmg }], SHREK_ROAR_MS);
  for (const slot of order()) {
    const p = E.game.players[slot];
    if (stonedNow(slot, stoned)) continue; // socha sa ráta, akoby na políčku nikto nestál (ako pri dlaždiciach)
    if (p.hp > 0 && inLine(p.x, p.y)) envHit(slot, dmg, tl);
    if (E.winnerNow()) return;
    if (p.clone && inLine(p.clone.x, p.clone.y)) cloneCosmetic(slot, dmg, tl);
  }
}

// koniec kroku k (0–2): živý Shrek skočí na k-te ohlásené políčko a zareve; mŕtvy → smrad berie HP
function shrekStepEnd(k, tl, stoned) {
  const s = shrek();
  if (!s) return;
  if (s.dead) { stenchTick(tl, stoned); return; }
  const to = s.marks[k];
  if (!to) return;
  const from = [s.x, s.y];
  // pred skokom bliká cieľové políčko ako vyhodnocovaná špeciálna dlaždica (bez výkriku - ten je len po zásahu)
  E.pushStateFrame(tl, [{ kind: "shrek_call", cell: [...to], n: k + 1 }], SHREK_CALL_MS);
  s.x = to[0]; s.y = to[1]; s.done = k + 1;
  E.pushStateFrame(tl, [{ kind: "shrek_jump", from, to: [...to], n: k + 1 }], SHREK_JUMP_MS);
  roar(tl, stoned);
}

function stenchTick(tl, stoned) {
  const s = E.game.shrek;
  const on = (x, y) => s.stench.some(c => c[0] === x && c[1] === y);
  for (const slot of order()) {
    const p = E.game.players[slot];
    if (stonedNow(slot, stoned)) continue;
    if (p.hp > 0 && on(p.x, p.y)) {
      E.pushStateFrame(tl, [{ kind: "stench_proc", cell: [p.x, p.y] }], STENCH_PROC_MS);
      envHit(slot, STENCH_DMG, tl);
      if (E.winnerNow()) return;
    }
    if (p.clone && on(p.clone.x, p.clone.y)) {
      E.pushStateFrame(tl, [{ kind: "stench_proc", cell: [p.clone.x, p.clone.y] }], STENCH_PROC_MS);
      cloneCosmetic(slot, STENCH_DMG, tl);
    }
  }
}

// koniec kola (hra pokračuje): živý Shrek ohlási nové 3 skoky, mŕtvy - smrad sa rozšíri na ortogonálnych susedov.
// Vráti efekty pre finálny frame kola (klient ich ukáže spolu s „ROUND N").
function shrekRoundEnd() {
  const s = shrek();
  if (!s) return [];
  s.done = 0;
  const drops = spawnItems();
  if (!s.dead) { s.marks = rollMarks([s.x, s.y]); return drops; }
  const added = [];
  for (const [x, y] of s.stench) {
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const c = [x + dx, y + dy];
      if (c[0] < 0 || c[1] < 0 || c[0] >= E.game.board.w || c[1] >= E.game.board.h) continue;
      if (s.stench.some(o => same(o, c)) || added.some(o => same(o, c))) continue;
      added.push(c);
    }
  }
  s.stench.push(...added);
  return [...drops, ...(added.length ? [{ kind: "stench_spread", cells: added.map(c => [...c]) }] : [])];
}

// zásah Shreka hráčom; vráti true, ak Shrek padol (reakcia sa potom nekoná)
function damageShrek(atkSlot, raw, tl) {
  const s = E.game.shrek;
  s.hp = Math.max(0, s.hp - raw);
  // lethal: smrteľný zásah - klient nekričí (bez zvuku hitu), pád hrá zvuk smrti ako pri hráčovi
  E.pushStateFrame(tl, [{ kind: "shrek_hit", from: atkSlot, cell: [s.x, s.y], dmg: raw, ...(s.hp <= 0 ? { lethal: true } : {}) }], SHREK_HIT_MS);
  if (s.hp > 0) {
    // výkrik po zásahu (zvuk hitu dohrá celý), Shrekovo políčko bliká - až potom reakcia (rev / tackle)
    E.pushStateFrame(tl, [{ kind: "shrek_scream", cell: [s.x, s.y] }], SHREK_HIT_SOUND_MS - SHREK_HIT_MS);
    return false;
  }
  s.dead = true;
  s.marks = [];
  s.stench = [[s.x, s.y]];
  E.pushStateFrame(tl, [{ kind: "shrek_die", cell: [s.x, s.y] }], SHREK_DIE_MS);
  return true;
}

// basic strela zastavená Shrekom (doBasic; aj strela Narutovho klona) → okamžitý rev
function shrekShot(slot, raw, tl) {
  if (damageShrek(slot, raw, tl)) return;
  roar(tl);
}

// melee (doMelee / Vampire-Onryō vlastná bunka): Shrek na niektorej zasahovanej bunke majiteľa alebo jeho klona → okamžitý rev
function shrekMelee(slot, cells, cloneCells, raw, cloneRaw, tl) {
  const s = shrek();
  if (!s || E.winnerNow()) return;
  const has = (cs) => cs.some(([x, y]) => shrekAt(x, y));
  const byMe = has(cells), byClone = has(cloneCells);
  if (!byMe && !byClone) return;
  if (damageShrek(slot, (byMe ? raw : 0) + (byClone ? cloneRaw : 0), tl)) return;
  roar(tl); // melee → okamžitý rev (útočník stojí na jeho políčku, takže ho rev zasiahne)
}

// dmg special / Special 1 (zóna cells): Shrek v zóne → útočník v tom istom stĺpci = okamžitý rev, inak tackle k nemu
function shrekZone(slot, cells, raw, tl) {
  const s = shrek();
  if (!s || E.winnerNow()) return;
  if (!cells.some(([x, y]) => shrekAt(x, y))) return;
  if (damageShrek(slot, raw, tl)) return;
  const a = E.game.players[slot];
  if (a.x === s.x) roar(tl);
  else tackle(a.x > s.x ? 1 : -1, tl);
}

// PowerUp + beh po vlastnom riadku po prvú figúru (hráč aj klon; na spoločnom políčku všetci) alebo po okraj, späť
function tackle(dx, tl) {
  const s = E.game.shrek, y = s.y, dir = dx > 0 ? "right" : "left";
  E.pushStateFrame(tl, [{ kind: "shrek_powerup", cell: [s.x, y], dir }], SHREK_POWERUP_MS);
  let stop = dx > 0 ? E.game.board.w - 1 : 0, victims = [];
  for (let x = s.x + dx; x >= 0 && x < E.game.board.w; x += dx) {
    for (const slot of order()) {
      const p = E.game.players[slot];
      if (p.hp > 0 && p.x === x && p.y === y) victims.push({ slot, clone: false });
      if (p.clone && p.clone.x === x && p.clone.y === y) victims.push({ slot, clone: true });
    }
    if (victims.length) { stop = x; break; }
  }
  // target = majiteľ prvej zasiahnutej figúry - prekliatemu v labyrinte sa beh k skrytému lovcovi rediguje
  E.pushStateFrame(tl, [{ kind: "shrek_tackle", from: [s.x, y], to: [stop, y], dir, ...(victims.length ? { target: victims[0].slot } : {}) }], SHREK_TACKLE_MS);
  const dmg = roarDmg();
  for (const v of victims) {
    if (v.clone) cloneCosmetic(v.slot, dmg, tl);
    else if (!stonedNow(v.slot)) envHit(v.slot, dmg, tl);
    if (E.winnerNow()) return;
  }
  E.pushStateFrame(tl, [{ kind: "shrek_return", from: [stop, y], to: [s.x, y], dir, ...(victims.length ? { target: victims[0].slot } : {}) }], SHREK_RETURN_MS);
}

return { isSwamp, shrekAt, swampStartGame, shrekSnapshot, itemsSnapshot, pickupItems, shrekStepEnd, shrekRoundEnd, shrekShot, shrekMelee, shrekZone };
}
