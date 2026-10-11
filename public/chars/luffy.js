// public/chars/luffy.js - klientské dáta postavy: Luffy - Gear 3 prepínanie, valivý special; viazaný na p1.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).

// čísla balansu - jediný zdroj (relatívna cesta funguje v prehliadači aj v Node)
import { RECHARGE_GAIN, SPECIAL_COST, LUFFY_SPECIAL_DMG } from "../../shared/balance.js";
export default {
  key: "luffy",
  // Hidden preview postavy (zatiaľ NEHRATEĽNÉ - karta bez data-char, klik/draft ju ignorujú):
  // Luffy len P1, Jotaro len P2; Jotaro vpravo v natívnej palete (dirP2 = ten istý priečinok).
  meta: { name: "Luffy",   dir: "luffy" },
  side: "p1",
  anims: {
    // Luffy: pumpovanie pästí (Recharge2, 7f) = prepnutie base→gear3 + windup gear3 basicu; Special_3 (12f) = splasknutie
    // gear3→base. maxFrame = bez posledných 2 framov (skončí v pumpnutej póze, nie v uvoľnení späť).
    luffypump: { file: "Recharge2.png", fps: 10, loop: false, maxFrame: 4, fromStart: true },
    luffydeflate: { file: "Special_3.png", fps: 10, loop: false, maxFrame: 9, fromStart: true },
    // Gear3 basic (Giant Pistol) telové pózy: windup (päsť vzad) → úder (natiahnutá ruka) → priťiahnutie (reeluje) / minutie (stiahne)
    luffygiantrocket: { file: "L_GiantRocket.png",  fps: 8,  loop: false, fromStart: true }, // 2f - nabratie, giant päsť vzad
    luffygiantpunch: { file: "L_GiantPunch.png",   fps: 10, loop: false, fromStart: true, armCrop: 0.56 }, // 3f - vystrelenie päste vpred
    luffyrocketpull: { file: "L_RocketPull.png",   fps: 12, loop: false, fromStart: true, armCrop: 0.5 }, // 5f - ruka sa sťahuje, ťahá súpera
    luffygiantretract: { file: "L_GiantRetract.png", fps: 12, loop: false, fromStart: true }, // 4f - minutie: stiahnutie naprázdno
    // Luffy special roll: base = Special_7 (rozbeh→kotúľ→puf-hlava bounce); gear3 = balón (Recharge round frame)
    // + Special_2 impact (radiálne päste) na cieľovej bunke
    // base special 2 fázy: dogúľanie (run/roll f0–6) počas cesty, potom cvaknutie na cieľovej bunke (f7+).
    luffyrolltravel: { file: "Special_7.png", fps: 14, loop: false, maxFrame: 6, fromStart: true }, // dogúľanie k bunke
    luffychomp: { file: "Special_7.png", fps: 10, loop: false, startFrame: 7, fromStart: true }, // cvaknutie + zotavenie (minutie)
    luffychomphit: { file: "Special_7.png", fps: 10, loop: false, startFrame: 7, maxFrame: 9, fromStart: true }, // cvaknutie, zastaví (zásah)
    luffyball: { file: "Special_1.png", fps: 8, loopFrom: 7, fromStart: true }, // gear3: premena na guľu (transform + spin) NA štartovacej bunke
    luffyballspin: { file: "Special_1.png", fps: 12, startFrame: 7, loop: true, fromStart: true }, // gear3: gúľajúca sa guľa počas presunu k cieľu - LOOPuje guľové framy 7–8 (nie statický frame)
    luffyimpact: { file: "Special_2.png", fps: 8,  loop: false, fromStart: true },
  },
  // výhra: Win.png na malej postave (Luffy nemá specialAnim)
  victoryAnim: { file: "Win.png", fps: 6, loop: true },
  // figúra cez ~0.88 framu → pri fill 0.95 by bol „obrovský": menší fill normalizovaný na výšku Idle framu (128),
  // ukotvený na nohy a zdvihnutý o 4 px na nožnú líniu mágov (mág pri fille 0.95 sedí ~8 px nad spodkom canvasu)
  boardFit: { fill: 0.58, refH: 128, offY: 4 },
  previewIdleCaster: true, // na mini-doske výberu kreslí castera IDLE (nemá efektový sprite specialu)
  portraitScale: 0.59,
  headCrop: { cx: 0.49, cy: 0.21, size: 0.33 }, // slamák + tvár z Idle.png (128² frame): figúra x38–89 y8–119, hlava/klobúk r8–44 (strieška x42–83) → stred (x62,y26)
  pairShift: 78,
  previewCast: { file: "Special_1.png",   frames: 9, fps: 6, loopFrom: 7, fill: 1.31 * 160 / 128 }, // krútený balón → škrabance, vrtuliak cyklí
  // Luffy: recharge prepína mód (base ↔ Gear 3). Zóna specialu (dáma base / veža gear3) + dmg (4/8) cyklí
  // pod mini-doskou (náhľad preview v public/chars/fx/luffy.js - ako Escanorov pride / vlkolakov moon), preto žiadny effect/stats riadok.
  abilityPreview: { caster: { x: 1, y: 1 }, dmg: null, desc: "Recharge switches Gear. Pick a cell and Luffy rolls there to smash whoever stands on it. Base: nimble, a Queen's reach. Gear 3: massive, a Rook's charge." },
  buttons: {
    // recharge slot = prepínač módu (fialový „???" skin) - doplní manu A prepne mód (aj pri plnej mane)
    recharge: { skin: "luffy-switch", title: `Switch Gear (Base ↔ Gear 3) - also recharges mana (+${RECHARGE_GAIN}); works even at full mana`, cost: `+${RECHARGE_GAIN}{💧}<span class="luffy-swap">⇆</span>` },
    // pohyb-a-úder ako šachová figúra: base = dáma (4 dmg), gear3 = veža (8 dmg) - podľa efektívnej formy
    special: (ui) => ui.gear3
      ? { title: `Special (−${SPECIAL_COST} mana, ${LUFFY_SPECIAL_DMG.gear3} dmg) - GEAR 3: roll like a ROOK (orthogonal lines) to a chosen cell and strike whoever is on it`, cost: `−${SPECIAL_COST}{💧} ${LUFFY_SPECIAL_DMG.gear3}{☠️}` }
      : { title: `Special (−${SPECIAL_COST} mana, ${LUFFY_SPECIAL_DMG.base} dmg) - roll like a QUEEN (any line) to a chosen cell and strike whoever is on it`, cost: `−${SPECIAL_COST}{💧} ${LUFFY_SPECIAL_DMG.base}{☠️}` },
  },
  specialTarget: "reach", // mini mapa s bunkami len na platnej línii (dáma / veža)
  // dosiahne special bunku (x,y) z ghost pozície g? Zrkadlí server luffySpecialReaches (dáma base / veža gear3)
  specialReach: ({ G, board, ui, g, x, y }) => G.luffySpecialReaches(board, g.x, g.y, x, y, ui.gear3 ? "gear3" : "base"),
  // efektívny mód pri plánovaní = aktuálna forma, prepnutá, ak je v tomto kole už naplánovaný recharge
  // (ten prepína mód a vyhodnotí sa pred basicom/specialom)
  planUi: (st, queue) => {
    let f = st?.form || "base";
    if (queue.some(a => a.type === "recharge")) f = f === "gear3" ? "base" : "gear3";
    return { gear3: f === "gear3" };
  },
  // basic: base = diagonálny picker, gear3 = ortogonálny len ←/→ (Giant Pistol ruka sa zastaví na prvej figúre)
  attackPicker: (ui) => ui.gear3 ? "lr" : "diag",
  aimStopsAtFoe: (ui) => ui.gear3,
  // odznak módu (gear3.png) v rohu gear-závislých tlačidiel - len v gear3 (aj po naplánovanom rechargi)
  buttonBadge: { cls: ["luffy-gear", "luffy-gear3"], slots: ["attack", "special"], on: (ui) => ui.gear3 },
  // plánovanie: recharge prepína gear, takže nie je zbytočný ani pri plnej mane (žiadne ⚠)
  planRechargeAlwaysUseful: true,
};
