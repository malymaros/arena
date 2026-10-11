// public/chars/lightning.js - klientské dáta postavy: Lightning Mage - special na bunky opačnej farby šachovnice; heal dlaždica = plné HP.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";
// čísla balansu - jediný zdroj (relatívna cesta funguje v prehliadači aj v Node)
import { SPECIAL_COST, SPECIAL_ZONE_DMG } from "../../shared/balance.js";

export default {
  key: "lightning",
  meta: { name: "Lightning Mage",   dir: "lightning", dirP2: "lightning_2" },
  specialAnim: { file: "Light_charge.png", fps: SPECIAL_FPS, loop: true },
  fxOffsetX: 0.18,
  headCx: 0.44,
  headTop: 0.48,
  headCrop: { cx: 0.41, cy: 0.58, size: 0.26 },
  teleportDir: "Lightning",
  teleportCount: 10,
  teleportFx: { scale: 1.6, anchor: "feet", bottomTrim: 0.17, dy: 0.20 }, // blesk šľahá od nôh nahor
  abilityPreview: { caster: { x: 1, y: 1 }, dmg: SPECIAL_ZONE_DMG.lightning, desc: `Full hp from <span class="pix-ico mini" data-pix="heart"></span> tiles<br>Range: opposite-colour cells` },
  // tlačidlá: cena {emoji} = pixelová mini ikona (client costHtml)
  buttons: {
    special: { title: `Special (−${SPECIAL_COST} mana, ${SPECIAL_ZONE_DMG.lightning} dmg)`, cost: `−${SPECIAL_COST}{💧} ${SPECIAL_ZONE_DMG.lightning}{☠️}` },
  },
  // náhľad zóny specialu: všetky políčka opačnej „šachovej" farby než na ktorej stojí
  specialZone: ({ G, board, me }) => G.lightningCells(board, me),
};
