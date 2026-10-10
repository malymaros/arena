// public/chars/jotaro.js - klientské dáta postavy: Jotaro + Star Platinum - THE WORLD; viazaný na p2.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";

export default {
  key: "jotaro",
  meta: { name: "Jotaro",  dir: "jotaro", dirP2: "jotaro" },
  side: "p2",
  specialAnim: { file: "Special_2_P.png",  fps: SPECIAL_FPS, loop: true }, // Star Platinum úder (stred castu; F5 doladí per special1/2 + THE WORLD)
  portraitScale: 0.66,
  headCx: 0.47,
  headTop: 0.45,
  headCrop: { cx: 0.51, cy: 0.30, size: 0.31 }, // namerané z Idle.png (144² frame): figúra x38–105 y24–135, hlava pás y24–57 x52–95 → stred hlavy vysoko vo frame
  pairShift: 78,
  // Jotaro je hrateľný, ale kartu kreslíme preview štýlom (Idle + hover = Star Platinum „menace" Special_3_P,
  // správne zarovnané nohy cez PREVIEW_OFF_Y); dead-mag stav rieši drawCharSelectFrame PRED touto vetvou
  previewCast: { file: "Special_3_P.png", frames: 4, fps: 6, loopFrom: 3, fill: 1.31 * 160 / 144 },
  // Jotaro: THE WORLD (jednorazový time-stop) - bez konkrétnych čísel v texte (cost badge nesie 5).
  // Zóna náhľadu = celá doska (THE WORLD blik); effect ikona ⏱.
  abilityPreview: { caster: { x: 1, y: 1 }, dmg: null, effect: { num: "", emoji: "⏱" }, desc: "THE WORLD (once/game): stop time, take 3 free actions - all effects resolve when time restarts." },
  buttons: {
    melee: { title: "Melee (−4 mana, 4 dmg, hits only an opponent on your cell)", cost: "−4{💧} 4{☠️}" },
    // mirror slot = Special 1 (Star Platinum) - fialový „???" skin + L/R picker
    mirror: { skin: "jotaro-s1", title: "Star Platinum - a directional (left/right) strike hitting BOTH diagonal cells on that side for 4 dmg", cost: "−4{💧} 4{☠️}" },
    // klasická ✨ ikona; mení sa len cena: pred THE WORLD hodiny (⏱), po ňom (worldUsed) Special 2 = 8 dmg
    special: (ui) => ui.worldUsed
      ? { title: "Special 2 (−5 mana, 8 dmg) - a directional (left/right) strike on the adjacent cell", cost: "−5{💧} 8{☠️}" }
      : { title: "THE WORLD (−5 mana, once per game) - time stops: take 3 extra actions while the foe is frozen; their effects land all at once when time resumes", cost: "−5{💧} ⏱" },
  },
  // THE WORLD bez cieľa; po ňom Special 2 smerový (L/R picker)
  specialTarget: (ui) => ui.worldUsed ? "dir" : "none",
  // Special 2: jediná susedná bunka (x±dir, y); THE WORLD: globálny cast → bliká celá doska (nič neleakuje)
  specialZone: ({ G, board, me, dir }) => me.worldUsed ? G.jotaroS2Cells(board, me, dir) : G.allCells(board),
  // letiaca päsť Star Platinum - čistá rotácia (base = doprava)
  projectile: { orient: "rotate" },
  // ⚠ pri plánovaní: Special 2 (po THE WORLD) mimo plochy
  planSpecialWarn: (a) => a.mine.worldUsed ? (({ p, dir, inB }) => {
    const dx = dir === "left" ? -1 : dir === "right" ? 1 : 0;
    return dx && !inB(p.x + dx, p.y) ? "Special off the board - mana is spent, no effect" : null;
  })(a) : null,
};
