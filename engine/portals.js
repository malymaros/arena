// engine/portals.js - Portal Realm: portály na hranách dosky (docs/PORTAL_PLAN.md). Spawn párov (štart hry + koniec
// kola), prechod tela (move/dash - majiteľ s klonom v lockstepe), efekty typov na telo (HP/mana), zatváranie párov
// a odklad počas THE WORLD. Strely, charge, Escanor a Luffy volajú tieto funkcie zo svojich vyhodnotení.
// Továreň dostane E = vnútorný scope enginu (createEngine v engine/game.js). Mimo portal realm je všetko inertné
// (žiadne portály, žiadne framy, žiadny rand) - bridge timeline ostávajú bit-identické.
import {
  START_HP, MAX_MANA, PORTAL_MAX_PAIRS, PORTAL_HP_GAIN, PORTAL_TYPES, TILE_DMG, PORTAL_REALM_TILE_DMG,
  SMALL_DELAY_MS, MOVE_DELAY_MS,
} from "./constants.js";
import * as G from "../shared/geometry.js";

// smer Narutovho klona (vertikálne inverzný) - zrkadlí CLONE_DIR v engine/game.js
const CLONE_DIR4 = { up: "down", down: "up", left: "left", right: "right" };

export function portalsModule(E) {
const isPortalRealm = () => E.game.config?.arena === "portal";
// portály dostupné pre geometriu (mimo portal realm null = všetky hrany sú stena)
const portalList = () => (isPortalRealm() ? E.game.portals : null);
// dmg Damage dlaždice: v portal realm 2 (2 ohníky), inak 1
const tileDmg = () => (isPortalRealm() ? PORTAL_REALM_TILE_DMG : TILE_DMG);

// typ nového páru podľa percentuálnych váh lobby (classic/hp/mana/power/nodef)
function rollPortalType(weights) {
  const total = PORTAL_TYPES.reduce((a, k) => a + Math.max(0, weights?.[k] || 0), 0);
  if (total <= 0) return "classic";
  let r = E.rand() * total;
  for (const k of PORTAL_TYPES) { r -= Math.max(0, weights?.[k] || 0); if (r < 0) return k; }
  return PORTAL_TYPES[PORTAL_TYPES.length - 1];
}

// nový pár na dve náhodné VOĽNÉ hrany (aj tá istá strana, aj obe hrany jedného rohu); písmeno = prvé voľné A–G.
// Pri plnej doske (menej ako 2 voľné hrany alebo 7 párov) sa nič nevygeneruje. Vracia pár alebo null.
function spawnPortalPair() {
  if (!isPortalRealm()) return null;
  const g = E.game;
  if (g.portals.length >= PORTAL_MAX_PAIRS) return null;
  const taken = (e) => g.portals.some(p => p.ends.some(q => q.x === e.x && q.y === e.y && q.side === e.side));
  const free = G.boardEdges(g.board).filter(e => !taken(e));
  if (free.length < 2) return null;
  const id = "ABCDEFG".split("").find(l => !g.portals.some(p => p.id === l));
  const type = rollPortalType(g.config.portalWeights);
  const a = free.splice(Math.floor(E.rand() * free.length), 1)[0];
  const b = free[Math.floor(E.rand() * free.length)];
  const pair = { id, type, ends: [{ ...a }, { ...b }] };
  g.portals.push(pair);
  return pair;
}

// zatvorenie použitých párov - zmiznú zo stavu (frame `portal_close` vidia obaja, aj prekliaty v labyrinte).
// THE WORLD: počas zamrazenia portál ostáva (dá sa ním prechádzať aj opakovane), zatvorí sa až pri obnovení času.
function closePortals(ids, tl) {
  const uniq = [...new Set(ids)].filter(id => E.game.portals.some(p => p.id === id));
  if (!uniq.length) return;
  if (E.frozenActive()) {
    const ts = E.game.timestop;
    ts.portalClose = [...new Set([...(ts.portalClose || []), ...uniq])];
    return;
  }
  E.game.portals = E.game.portals.filter(p => !uniq.includes(p.id));
  E.pushStateFrame(tl, [{ kind: "portal_close", ids: uniq }], SMALL_DELAY_MS);
}

// efekt typu na TELO hráča (nie na klona): HP +1 (Lightning plné HP), mana na maximum. Ostatné typy telo len spáli.
// THE WORLD: efekt sa zaeviduje (každý pár raz) a pripíše až pri obnovení času.
function bodyEffect(slot, pass, tl) {
  if (pass.type !== "hp" && pass.type !== "mana") return;
  if (E.frozenActive()) {
    const ts = E.game.timestop;
    ts.portalBody = ts.portalBody || [];
    if (!ts.portalBody.some(b => b.id === pass.id)) ts.portalBody.push({ id: pass.id, type: pass.type, slot });
    return;
  }
  applyBody(slot, pass.type, tl);
}
function applyBody(slot, type, tl) {
  const p = E.game.players[slot];
  if (!p || p.hp <= 0) return;
  if (type === "hp") {
    const full = E.kitOf(p.char).healTile === "full";
    const healed = Math.min(START_HP, full ? START_HP : p.hp + PORTAL_HP_GAIN) - p.hp;
    if (healed > 0) { p.hp += healed; E.pushStateFrame(tl, [{ kind: "heal", target: slot, amount: healed, super: full, portal: true }], SMALL_DELAY_MS); }
  } else if (type === "mana") {
    const gained = MAX_MANA - p.mana;
    if (gained > 0) { p.mana = MAX_MANA; E.pushStateFrame(tl, [{ kind: "recharge", from: slot, cells: [[p.x, p.y]], amount: gained, portal: true }], SMALL_DELAY_MS); }
  }
}
// THE WORLD obnovenie času: odložené efekty na telo (každý pár raz) + zatvorenie všetkých použitých párov
function resumeFrozenPortals(tl) {
  const ts = E.game.timestop;
  if (!ts) return;
  for (const b of ts.portalBody || []) applyBody(b.slot, b.type, tl);
  const ids = ts.portalClose || [];
  ts.portalBody = []; ts.portalClose = [];
  closePortals(ids, tl); // frozenActive() je už false (mode "applying")
}

// labyrint: prekliaty prešiel portálom → CELÁ niť (aj silueta stretnutia) zmizne, nové klbko začína na výstupe
function threadCut(slot, exit, fx) {
  const p = E.game.players[slot];
  if (!p?.labyrinth) return;
  p.thread = [[exit[0], exit[1]]];
  p.threadMark = null;
  fx.push({ kind: "thread_cut", target: slot, cell: [exit[0], exit[1]] });
}
// trackSteps cez dráhu s prechodmi: úseky pred/po portáli normálne, na prechode prekliateho niť zmizne.
// passes[].at = index výstupnej bunky v path
function trackPath(slot, path, passes, fx) {
  let from = 0;
  for (const ps of passes) {
    if (ps.at > from) fx.push(...E.trackSteps(slot, path.slice(from, ps.at)));
    threadCut(slot, path[ps.at], fx);
    from = ps.at;
  }
  fx.push(...E.trackSteps(slot, path.slice(from)));
}

// move/dash v portal realm: majiteľ (a Narutov klon - vertikálne inverzne) idú krok za krokom NARAZ; krok k
// oboch figúr používa portály otvorené na začiatku kroku (simultánny prechod tým istým párom - aj z opačných
// koncov - prejde obom), použité páry sa zatvoria až po kroku. THE WORLD: páry sa nezatvárajú (opakovaný prechod).
// Vráti { owner, clone } s dráhou { path, passes, x, y } a zoznam použitých párov.
function walk(slot, dir, maxSteps) {
  const a = E.game.players[slot];
  const figs = [{ clone: false, x: a.x, y: a.y, dir, path: [], passes: [], blocked: false }];
  if (a.clone) figs.push({ clone: true, x: a.clone.x, y: a.clone.y, dir: CLONE_DIR4[dir], path: [], passes: [], blocked: false });
  const closed = new Set(), used = [];
  for (let s = 0; s < maxSteps; s++) {
    const stepUsed = [];
    for (const f of figs) {
      if (f.blocked) continue;
      const st = G.portalStep(E.game.board, E.game.portals, f.x, f.y, f.dir, closed);
      if (!st) { f.blocked = true; continue; }
      f.x = st.x; f.y = st.y; f.dir = st.dir;
      f.path.push([st.x, st.y]);
      if (st.portal) { f.passes.push({ at: f.path.length - 1, ...st.portal }); stepUsed.push(st.portal.id); }
    }
    used.push(...stepUsed);
    if (!E.frozenActive()) stepUsed.forEach(id => closed.add(id));
  }
  return { owner: figs[0], clone: figs[1] || null, used };
}

// move (1 krok) / dash (2 kroky) v portal realm - tvar framu ako doMove/doDash (jeden pohybový frame), navyše
// efekt portal_walk per figúru, ktorá prešla portálom (klient z neho animuje cestu cez trhlinu). Potom efekty na
// telo majiteľa a zatvorenie párov. Figúra, ktorá sa nepohla, narazí do steny (wall_bump) ako doteraz.
function walkAction(slot, dir, maxSteps, tl) {
  const a = E.game.players[slot];
  const { owner, clone, used } = walk(slot, dir, maxSteps);
  const fx = [];
  if (owner.path.length) {
    a.x = owner.x; a.y = owner.y;
    trackPath(slot, owner.path, owner.passes, fx);
    if (owner.passes.length) fx.push({ kind: "portal_walk", from: slot, clone: false, dir, path: owner.path, passes: owner.passes });
  } else fx.push({ kind: "wall_bump", from: slot, dir });
  if (clone) {
    if (clone.path.length) {
      a.clone.x = clone.x; a.clone.y = clone.y;
      fx.push(...E.trackCloneSteps(slot, clone.path));
      if (clone.passes.length) fx.push({ kind: "portal_walk", from: slot, clone: true, dir: CLONE_DIR4[dir], path: clone.path, passes: clone.passes });
    } else fx.push({ kind: "wall_bump", from: slot, dir: CLONE_DIR4[dir], clone: true });
  }
  E.pushStateFrame(tl, fx, MOVE_DELAY_MS);
  for (const ps of owner.passes) bodyEffect(slot, ps, tl); // klon HP/manu nedostane, portál len spáli
  closePortals(used, tl);
}

return { isPortalRealm, portalList, tileDmg, spawnPortalPair, closePortals, bodyEffect, resumeFrozenPortals, threadCut, trackPath, walkAction };
}
