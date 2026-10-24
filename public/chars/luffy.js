// public/chars/luffy.js - klientské dáta postavy: Luffy - zrkadlo Jotara, viazaný na p1. Diagonálny basic, slabšie
// melee, v mirror slote Special 1 (naťahovacia ruka na ľubovoľnú bunku), special = guľa raz za hru, potom Special 2.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { act, DIAG_SHOT } from "./common.js";
// čísla balansu - jediný zdroj (relatívna cesta funguje v prehliadači aj v Node)
import { MELEE_COST, SPECIAL_COST, LUFFY_MELEE_DMG, LUFFY_S1_COST, LUFFY_S1_DMG, LUFFY_BALL_DMG, LUFFY_S2_COST, LUFFY_S2_DMG } from "../../shared/balance.js";
import { MOVE_MS } from "../../shared/timing.js";

export default {
  key: "luffy",
  meta: { name: "Luffy", dir: "luffy" },
  side: "p1",
  mirrorSlot: "special1",  // mirror slot = Special 1 (naťahovacia ruka)
  special1Target: "cell",  // ... s mini mapou buniek (Jotaro má L/R šípky)
  special1Cost: LUFFY_S1_COST,
  anims: {
    // Special 1 - telo z Punch.png (L_RocketPull s odmazanou pečenou rukou, tools/sprites-luffy/punch.cjs):
    // f0 naťahovanie, f1 úder, f2 sťahovanie, f3–4 návrat do stoja. Ruku a päsť kreslí fx/luffy.js (guma).
    // armCrop 0.5 = kreslí sa len ľavá polovica framu (telo), figúra ostane vycentrovaná na bunke.
    luffypunch0: { file: "Punch.png", fps: 1, frameIndex: 0, armCrop: 0.5 },
    luffypunch1: { file: "Punch.png", fps: 1, frameIndex: 1, armCrop: 0.5 },
    luffypunch2: { file: "Punch.png", fps: 1, frameIndex: 2, armCrop: 0.5 },
    luffypunchback: { file: "Punch.png", fps: 8, loop: false, startFrame: 3, fromStart: true, armCrop: 0.5 },
    // special guľa: premena (Special_1, raz celé, potom sa točia guľové framy 7–8) → kotúľ (len f7–8) → výbuch (Special_2)
    luffyball: { file: "Special_1.png", fps: 8, loopFrom: 7, fromStart: true },
    luffyballspin: { file: "Special_1.png", fps: 12, startFrame: 7, loop: true, fromStart: true },
    luffyimpact: { file: "Special_2.png", fps: 8, loop: false, fromStart: true },
    // Special 2 - gatling (Attack_2) raz od začiatku
    luffys2: { file: "Attack_2.png", fps: 10, loop: false, fromStart: true },
    // dash - beh → kotúľ (Special_7, 12 framov) cez celý presun
    luffydash: { file: "Special_7.png", fps: Math.round(12 * 1000 / MOVE_MS), loop: false, fromStart: true },
    // recharge - jedenie mäsa (Special_3, 12 framov) cez celý recharge frame
    luffyeat: { file: "Special_3.png", fps: 11, loop: false, fromStart: true },
  },
  // melee = Attack_1 (ako basic), recharge = jedenie mäsa
  actionAnims: { melee: "attack1_loop", recharge: "luffyeat" },
  // letiaca päsť (Charge.png mieri doprava) - čistá rotácia podľa smeru, aj po odraze (ako Vampire/Onryō/Jotaro);
  // bez nej sa ľavé diagonály kreslili prehodene (scaleX + rotate)
  projectile: { orient: "rotate" },
  // výhra: Win.png na malej postave (Luffy nemá specialAnim)
  victoryAnim: { file: "Win.png", fps: 6, loop: true },
  victoryVoiceLoop: true, // smiech (voice.win.luffy) sa opakuje, kým beží víťazná animácia
  // figúra cez ~0.88 framu → pri fill 0.95 by bol „obrovský": menší fill normalizovaný na výšku Idle framu (128),
  // ukotvený na nohy a zdvihnutý o 4 px na nožnú líniu mágov (mág pri fille 0.95 sedí ~8 px nad spodkom canvasu)
  boardFit: { fill: 0.58, refH: 128, offY: 4 },
  previewIdleCaster: true, // na mini-doske výberu kreslí castera IDLE (nemá efektový sprite specialu)
  portraitScale: 0.59,
  headCrop: { cx: 0.49, cy: 0.21, size: 0.33 }, // slamák + tvár z Idle.png (128² frame): figúra x38–89 y8–119, hlava/klobúk r8–44 (strieška x42–83) → stred (x62,y26)
  pairShift: 78,
  previewCast: { file: "Special_1.png", frames: 9, fps: 6, loopFrom: 7, fill: 1.31 * 160 / 128 }, // krútený balón → škrabance, vrtuliak cyklí
  abilityPreview: { caster: { x: 1, y: 1 }, dmg: LUFFY_BALL_DMG, dir: "right", desc: "Once per game: inflate into a ball, roll one cell left or right and burst on everything around. Afterwards the special strikes the adjacent cell." },
  buttons: {
    attack: { ...DIAG_SHOT },
    melee: { ...act("MELEE", `{💧}${MELEE_COST} {☠️}${LUFFY_MELEE_DMG}`, "Hits only an opponent on your cell."), cost: `−${MELEE_COST}{💧} ${LUFFY_MELEE_DMG}{☠️}`, label: `{💧}${MELEE_COST} {☠️}${LUFFY_MELEE_DMG}` },
    // mirror slot = Special 1 (naťahovacia ruka) - fialový „???" skin + mini mapa buniek
    mirror: { skin: "luffy-s1", ...act("GOMU GOMU PISTOL", `{💧}${LUFFY_S1_COST} {☠️}${LUFFY_S1_DMG}`, "Stretches an arm to any cell except your own and hits whoever stands there."), cost: `−${LUFFY_S1_COST}{💧} ${LUFFY_S1_DMG}{☠️}`, label: `{💧}${LUFFY_S1_COST} {☠️}${LUFFY_S1_DMG}` },
    // guľa (raz za hru) → po nej natrvalo Special 2
    special: (ui) => ui.worldUsed
      ? { ...act("SPECIAL 2", `{💧}${LUFFY_S2_COST} {☠️}${LUFFY_S2_DMG}`, "Strikes the adjacent cell left or right."), cost: `−${LUFFY_S2_COST}{💧} ${LUFFY_S2_DMG}{☠️}`, label: `{💧}${LUFFY_S2_COST} {☠️}${LUFFY_S2_DMG}` }
      : { ...act("GOMU GOMU BALLOON", `{💧}${SPECIAL_COST} {☠️}${LUFFY_BALL_DMG}`, "Once per game: rolls one cell left or right and bursts on all cells around (and under) it. Rolling off the board wastes it."), cost: `−${SPECIAL_COST}{💧} ${LUFFY_BALL_DMG}{☠️}`, label: `{💧}${SPECIAL_COST} {☠️}${LUFFY_BALL_DMG}` },
  },
  specialTarget: "dir", // guľa aj Special 2 sú smerové (L/R picker)
  // guľa: 3×3 okolo dopadovej bunky (kotúľ o bunku); Special 2: jediná susedná bunka
  specialZone: ({ G, board, me, dir }) => me.worldUsed ? G.jotaroS2Cells(board, me, dir) : G.luffyBallCells(board, me, dir),
  // ⚠ pri plánovaní: guľa / Special 2 mimo plochy
  planSpecialWarn: ({ p, dir, inB, mine }) => {
    const dx = dir === "left" ? -1 : dir === "right" ? 1 : 0;
    if (!dx || inB(p.x + dx, p.y)) return null;
    return mine.worldUsed ? "Special off the board - mana is spent, no effect" : "Rolling off the board - the once-per-game ball is wasted";
  },
};
