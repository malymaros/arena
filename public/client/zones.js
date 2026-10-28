// public/client/zones.js - zóny náhľadov (special, Jotaro S1, melee, Vampire charge, démon) z shared/geometry.js
import * as G from "/shared/geometry.js";
import { CHARS_BY_KEY } from "/chars/index.js";
import { board, state } from "/client/session.js";

/* ---------- Special preview (hover) ---------- */
// zóna specialu z registra postavy (specialZone - geometria zo shared/geometry.js, tá istá ako na serveri);
// dir pre smerové speciály, meState.foe pre vlkolakov charge, worldUsed/pride z meState
export function cellsForSpecialPreview(meState, dir){
  if (!meState || !meState.char) return [];
  return CHARS_BY_KEY[meState.char]?.specialZone?.({ G, board, me: meState, dir, tiles: state?.tiles, portals: state?.portals || null }) || [];
}
// Jotarov Special 1 (mirror slot): obe diagonálne bunky zvolenej strany (x±dir, y±1) - zrkadlí jotaroS1Cells
export function cellsForJotaroS1(p, dir){
  return p ? G.jotaroS1Cells(board, p, dir) : [];
}
// dosah melee - vlastné políčko; Medúza navyše 1 diagonálne na všetky strany (zrkadlí doMelee na serveri)
export function cellsForMeleePreview(p, char){
  return p ? G.meleeCells(board, p, char) : [];
}
// dráha charge Vampire/Onryō (dash slot): z pozície zvoleným smerom po prvú VIDITEĽNÚ figúru súpera
// (aj klon) alebo okraj - zrkadlí doVampCharge na serveri (skrytý súper v labyrinte má x null → beh na okraj)
export function cellsForVampChargePreview(p, dir, foe){
  const delta = G.DIR4[dir];
  if (p && delta && state?.portals) return G.runPathPortals(board, p.x, p.y, dir, foe, state.portals).path; // Portal Realm
  return p && delta ? G.runPath(board, p.x, p.y, delta, foe).path : [];
}
// dosah démon útoku - všetky políčka okrem toho, na ktorom kaster (ghost) stojí
export function cellsForDemonPreview(p){
  return p ? G.allCells(board, p) : [];
}

// 8 smerov (vlkolakov charge, smer strely) - zo shared/geometry.js
export const WOLF_DIRS_CLIENT = G.DIR8;
