// public/chars/fire.js - klientské dáta postavy: Fire Wizard - special zasiahne celý riadok (na Damage dlaždici ±1 riadok).
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";
// čísla balansu - jediný zdroj (relatívna cesta funguje v prehliadači aj v Node)
import { SPECIAL_COST, SPECIAL_ZONE_DMG } from "../../shared/balance.js";

export default {
  key: "fire",
  meta: { name: "Fire Wizard",      dir: "fire", dirP2: "fire_2" },
  specialAnim: { file: "Flame_jet.png",    fps: SPECIAL_FPS, loop: true },
  headCx: 0.43,
  headTop: 0.48,
  headCrop: { cx: 0.40, cy: 0.55, size: 0.26 },
  teleportDir: "Fire",
  teleportCount: 6,
  teleportFx: { scale: 1.0, anchor: "feet" }, // oheň horí od zeme, zmestí sa do políčka
  abilityPreview: { caster: { x: 0, y: 1 }, dmg: SPECIAL_ZONE_DMG.fire, desc: `Boost range ±1 row from <span class="pix-ico mini" data-pix="flame"></span> tiles<br>Range: whole row` },
  // tlačidlá: cena {emoji} = pixelová mini ikona (client costHtml)
  buttons: {
    special: { title: `Special (−${SPECIAL_COST} mana, ${SPECIAL_ZONE_DMG.fire} dmg)`, cost: `−${SPECIAL_COST}{💧} ${SPECIAL_ZONE_DMG.fire}{☠️}`, label: `{💧}${SPECIAL_COST} {☠️}${SPECIAL_ZONE_DMG.fire}` },
  },
  // náhľad zóny specialu: celý riadok; na Damage dlaždici riadky ±1 (server: fireOnDmgTile)
  specialZone: ({ G, board, me, tiles }) =>
    G.fireCells(board, me, (tiles || []).some(t => t.type === "dmg" && t.x === me.x && t.y === me.y)),
};
