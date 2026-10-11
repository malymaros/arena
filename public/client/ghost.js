// public/client/ghost.js - ghost: simulácia vlastnej pozície (a klona) počas plánovania kola - tá istá simulácia
// fronty (shared/geometry.js simulateQueue), akou server validuje ciele.
import * as G from "/shared/geometry.js";
import { state, me, board, otherSlot } from "/client/session.js";
import { planning, buttonUi } from "/client/planning.js";
import { VAMP_CHARS, CHARS_BY_KEY, SIDE_CHARS } from "/chars/index.js";
import { WOLF_DIRS_CLIENT } from "/client/zones.js";
import { gridEl } from "/client/dom.js";

/* ---------- Ghost - simulácia vlastnej pozície počas naplánovaného kola ---------- */
// pozícia po každej akcii vo fronte; movy mimo board pozíciu nemenia (zrkadlí server)
function simulatedPositions(){
  const mine = state?.[me];
  if (!mine) return [];
  // skrytý súper v labyrinte má x null → charge beží na okraj (shared figureAt ho ignoruje)
  const sim = G.simulateQueue(board, { x: mine.x, y: mine.y, char: mine.char, form: mine.form || "base" },
    planning.myQueue, state?.[otherSlot()], VAMP_CHARS);
  return sim.slice(1).map(({ x, y }) => ({ x, y }));
}
// pozícia, z ktorej sa vykoná akcia s indexom idx (= po akciách 0..idx-1);
// bez argumentu pozícia po celej fronte - odtiaľ sa vykoná novo pridávaná akcia
export function ghostPos(idx = planning.myQueue.length){
  const mine = state?.[me];
  if (!mine) return null;
  if (idx <= 0) return { x: mine.x, y: mine.y };
  const sims = simulatedPositions();
  if (!sims.length) return { x: mine.x, y: mine.y };
  return sims[Math.min(idx, sims.length) - 1];
}
// budúca pozícia VLASTNÉHO tieňového klona po fronte - kopíruje move/dash majiteľa s inverznou vertikálou
// a vlastným clampom; hýbe sa aj keď majiteľ narazí do steny (ako na serveri doMove/doDash)
export function simulatedClonePos(){
  const mine = state?.[me];
  if (!mine?.clone) return null;
  return G.simulateClone(board, mine.clone, planning.myQueue);
}
// mág aktívny pred akciou s indexom idx - po prejdení swapov vo fronte 0..idx-1 (kvôli special/ghost náhľadu po výmene)
export function ghostCharAt(idx = planning.myQueue.length) {
  let char = state?.[me]?.char || null;
  for (let i = 0; i < Math.min(idx, planning.myQueue.length); i++) {
    if (planning.myQueue[i]?.type === "swap" && planning.myQueue[i].to) char = planning.myQueue[i].to;
  }
  return char;
}

// upozornenie „táto akcia nebude mať efekt" pre vlastnú frontu (žltý ⚠ v lište). Simuluje LEN vlastný
// stav a vlastné naplánované akcie - súperove akcie (drain many Onryō, presun, zásah…) sa NEzarátavajú.
// Ceny a wall pravidlo MUSIA sedieť so serverovými do* funkciami. Vracia pole dôvodov (null = ok) podľa planning.myQueue.
const PLAN_MAX_MANA = 10;
const PLAN_RECHARGE = 4;
const PLAN_COST = { attack: 1, melee: 4, dash: 4, special: 5, special1: 4, shield: 2, mirror: 4, demon: 10 };
// súper Vampire/Onryō je mirror-imúnny: mirror (aj golden) sa voči jeho dmg správa len ako štít
// (súper v turnaji nemôže z/do side-postavy swapnúť, takže jeho postava platí celé kolo)
export function foeMirrorImmune() {
  return !!VAMP_CHARS[state?.[me === "p1" ? "p2" : "p1"]?.char];
}
export const MIRROR_IMMUNE_WARN = "Opponent is immune to mirrors - it only blocks like a shield (no reflect)";
export function planWarnings() {
  const out = planning.myQueue.map(() => null);
  const mine = state?.[me];
  if (!mine) return out;
  const foe = state?.[me === "p1" ? "p2" : "p1"];
  const inB = (x, y) => x >= 0 && y >= 0 && x < board.w && y < board.h;
  const D4 = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  let mana = mine.mana ?? 0;
  // golden predťah (len nestartér) sa platí pred prvou akciou startera
  if (planning.goldenArmed && mana >= 3) mana -= 3;
  else if (planning.goldenMirrorArmed && mana >= 5) mana -= 5;
  let hasClone = !!mine.clone;      // Naruto: klon sa môže pohnúť/strieľať aj keď Naruto narazí do steny
  for (let i = 0; i < planning.myQueue.length; i++) {
    const a = planning.myQueue[i];
    if (!a || a.type === "stoned" || a.type === "swap") continue;
    const char = ghostCharAt(i);
    const def = CHARS_BY_KEY[char];
    const p = ghostPos(i);
    const cost = PLAN_COST[a.type] || 0;
    if (cost > mana) { out[i] = `Not enough mana (planned ${mana}, needs ${cost}) - this action will fail`; continue; }
    mana -= cost;
    if (a.type === "recharge") {
      if (!def?.planRechargeAlwaysUseful && mana >= PLAN_MAX_MANA) out[i] = "Mana will already be full - recharge has no effect";
      mana = Math.min(PLAN_MAX_MANA, mana + PLAN_RECHARGE);
      continue;
    }
    if (a.type === "mirror" && foeMirrorImmune()) { out[i] = MIRROR_IMMUNE_WARN; continue; }
    if (a.type === "special" && def?.planClone) { hasClone = true; continue; }
    if (!p) continue;
    const wallSafe = !!def?.planClone && hasClone; // klonova figúra môže akciu vykonať aj tak
    const d = D4[a.dir];
    if (!wallSafe && (a.type === "move" || a.type === "dash") && d && !inB(p.x + d[0], p.y + d[1])) {
      out[i] = "Off the board - this action has no effect";
    } else if (!wallSafe && a.type === "attack" && !cellsForAimPreview(p, a.dir, char).length) {
      out[i] = "Attack off the board - mana is spent, no effect";
    } else if (a.type === "special") {
      // varovanie specialu podľa postavy (register: planSpecialWarn - petrify na sochu, special/charge mimo plochy)
      const w = def?.planSpecialWarn?.({ p, dir: a.dir, i, foe, mine, inB, G });
      if (w) out[i] = w;
    }
  }
  return out;
}

// lomená dráha diagonálnej strely (1 odraz, roh neodráža, max 3 bunky) - shared/geometry, tá istá ako server
function vampShotRoute(x, y, dir){
  return G.vampShotRoute(board, x, y, dir).map(c => [c.x, c.y]);
}
// dráha basic útoku zvoleným smerom z danej pozície (po okraj boardu); Vampire/Onryō diagonály
// idú po lomenej bounce dráhe (char sa dodáva kvôli nej)
export function cellsForAimPreview(meState, dir, char){
  if (!meState) return [];
  const delta = WOLF_DIRS_CLIENT[dir];
  if (!delta) return [];
  // diagonálny smer u side-postavy → lomená bounce dráha; ortogonálny (Luffy gear3) → priama strela.
  // (Riadime sa smerom, nie formou - picker ponúka diag v base, ortogonálne v gear3.)
  const isDiag = delta[0] !== 0 && delta[1] !== 0;
  if (SIDE_CHARS[char] && isDiag) return vampShotRoute(meState.x, meState.y, dir);
  // register aimStopsAtFoe (Luffy GEAR 3 basic = naťahovacia ruka) - dráha sa ZASTAVÍ na prvej figúre súpera
  const stopAtFoe = !!CHARS_BY_KEY[char]?.aimStopsAtFoe?.(buttonUi());
  const foe = stopAtFoe ? state?.[me === "p1" ? "p2" : "p1"] : null;
  return G.runPath(board, meState.x, meState.y, delta, foe).path;
}
export function showPreviewCells(cells){
  const kids = gridEl.children;
  for (let i=0;i<kids.length;i++){
    const cell = kids[i];
    const cx = parseInt(cell.dataset.x,10), cy = parseInt(cell.dataset.y,10);
    if (cells.some(([x,y])=>x===cx && y===cy)) cell.classList.add("preview-red");
  }
}
export function clearPreviewCells(){
  gridEl.querySelectorAll(".preview-red").forEach(el=>el.classList.remove("preview-red"));
}
