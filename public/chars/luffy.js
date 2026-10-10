// public/chars/luffy.js - klientské dáta postavy: Luffy - Gear 3 prepínanie, valivý special; viazaný na p1.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).

export default {
  key: "luffy",
  // Hidden preview postavy (zatiaľ NEHRATEĽNÉ - karta bez data-char, klik/draft ju ignorujú):
  // Luffy len P1, Jotaro len P2; Jotaro vpravo v natívnej palete (dirP2 = ten istý priečinok).
  meta: { name: "Luffy",   dir: "luffy" },
  side: "p1",
  anims: {
    // Luffy: pumpovanie pästí (Recharge2, 7f) = prepnutie base→gear3 + windup gear3 basicu; Special_3 (12f) = splasknutie
    // gear3→base. maxFrame = bez posledných 2 framov (skončí v pumpnutej póze, nie v uvoľnení späť).
    luffypump: { file: "Recharge2.png", fps: 10, loop: false, maxFrame: 4 },
    luffydeflate: { file: "Special_3.png", fps: 10, loop: false, maxFrame: 9 },
    // Gear3 basic (Giant Pistol) telové pózy: windup (päsť vzad) → úder (natiahnutá ruka) → priťiahnutie (reeluje) / minutie (stiahne)
    luffygiantrocket: { file: "L_GiantRocket.png",  fps: 8,  loop: false }, // 2f - nabratie, giant päsť vzad
    luffygiantpunch: { file: "L_GiantPunch.png",   fps: 10, loop: false }, // 3f - vystrelenie päste vpred
    luffyrocketpull: { file: "L_RocketPull.png",   fps: 12, loop: false }, // 5f - ruka sa sťahuje, ťahá súpera
    luffygiantretract: { file: "L_GiantRetract.png", fps: 12, loop: false }, // 4f - minutie: stiahnutie naprázdno
    // Luffy special roll: base = Special_7 (rozbeh→kotúľ→puf-hlava bounce); gear3 = balón (Recharge round frame)
    // + Special_2 impact (radiálne päste) na cieľovej bunke
    // base special 2 fázy: dogúľanie (run/roll f0–6) počas cesty, potom cvaknutie na cieľovej bunke (f7+).
    luffyrolltravel: { file: "Special_7.png", fps: 14, loop: false, maxFrame: 6 }, // dogúľanie k bunke
    luffychomp: { file: "Special_7.png", fps: 10, loop: false, startFrame: 7 }, // cvaknutie + zotavenie (minutie)
    luffychomphit: { file: "Special_7.png", fps: 10, loop: false, startFrame: 7, maxFrame: 9 }, // cvaknutie, zastaví (zásah)
    luffyball: { file: "Special_1.png", fps: 8, loopFrom: 7 }, // gear3: premena na guľu (transform + spin) NA štartovacej bunke
    luffyballspin: { file: "Special_1.png", fps: 12, startFrame: 7, loop: true }, // gear3: gúľajúca sa guľa počas presunu k cieľu - LOOPuje guľové framy 7–8 (nie statický frame)
    luffyimpact: { file: "Special_2.png", fps: 8,  loop: false },
  },
  portraitScale: 0.59,
  headCrop: { cx: 0.49, cy: 0.21, size: 0.33 }, // slamák + tvár z Idle.png (128² frame): figúra x38–89 y8–119, hlava/klobúk r8–44 (strieška x42–83) → stred (x62,y26)
  pairShift: 78,
  previewCast: { file: "Special_1.png",   frames: 9, fps: 6, loopFrom: 7, fill: 1.31 * 160 / 128 }, // krútený balón → škrabance, vrtuliak cyklí
  // Luffy: recharge prepína mód (base ↔ Gear 3). Zóna specialu (dáma base / veža gear3) + dmg (4/8) cyklí
  // pod mini-doskou (formCycle - ako Escanorov pride / vlkolakov moon náhľad), preto žiadny effect/stats riadok.
  abilityPreview: { caster: { x: 1, y: 1 }, dmg: null, formCycle: true, desc: "Recharge switches Gear. Pick a cell and Luffy rolls there to smash whoever stands on it. Base: nimble, a Queen's reach. Gear 3: massive, a Rook's charge." },
};
