// public/chars/wanderer.js - klientské dáta postavy: Wanderer Magician - special na diagonálnych susedov; pasívna mana bez mirroru.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";

export default {
  key: "wanderer",
  // Wanderer: p2 = wanderer_2 - do pixelov zapečený bývalý alt-color filter
  // (saturate .22 + brightness 1.4), vizuálne totožné, už bez CSS filtra (tools/sprites-wanderer)
  meta: { name: "Wanderer Magician",dir: "wanderer", dirP2: "wanderer_2" },
  specialAnim: { file: "Magic_sphere.png", fps: SPECIAL_FPS, loop: true },
  headCx: 0.47,
  headTop: 0.48,
  headCrop: { cx: 0.47, cy: 0.56, size: 0.27 },
  teleportDir: "Wanderer",
  teleportCount: 10,
  teleportFx: { scale: 1.6, anchor: "torso", dy: 0.12 },
  abilityPreview: { caster: { x: 1, y: 1 }, dmg: 8, desc: `Each round he doesn't use mirror +2<span class="pix-ico mini" data-pix="drop"></span><br>Range: diagonal neighbours` },
  // tlačidlá: cena {emoji} = pixelová mini ikona (client costHtml)
  buttons: {
    special: { title: "Special (−5 mana, 8 dmg)", cost: "−5{💧} 8{☠️}" },
  },
  specialZone: ({ G, board, me }) => G.diagNeighbors(board, me),
};
