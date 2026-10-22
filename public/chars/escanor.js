// public/chars/escanor.js - klientské dáta postavy: Escanor - smerové slnko, rozsah podľa Pride.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";
// čísla balansu - jediný zdroj (relatívna cesta funguje v prehliadači aj v Node)
import { SPECIAL_COST, SPECIAL_ZONE_DMG } from "../../shared/balance.js";

export default {
  key: "escanor",
  // Escanor: zatiaľ LEN ukážka vo výbere (nová stránka vľavo), nedá sa zvoliť ani hrať.
  // Natívna paleta; p2 = escanor_2 (zelené oblečenie prefarbené na červené). V karte: WeakIdle, hover IntroStand.
  meta: { name: "Escanor",          dir: "escanor", dirP2: "escanor_2" },
  specialAnim: { file: "Win.png",          fps: SPECIAL_FPS, loop: true }, // ETAPA A placeholder - plná choreografia (WinSun/CruelSunHold/SunBurst) príde v etape B
  anims: {
    // Escanor: WeakIdle = slabá „denná" forma (pred premenou); Transform = premena → chytí sekeru (hrá sa RAZ pri nasadení)
    weakidle: { file: "WeakIdle.png", fps: 5,  loop: true },
    transform: { file: "Transform.png", fps: 5, loop: false, fromStart: true }, // slow-mo premena - nech si ju hráči všimnú
    cruelhold: { file: "CruelSunHold.png", fps: 11, loop: true }, // special fáza 2: malá postava nesie veľké slnko
    // Escanor special fáza 1: zdvih ruky so slnkom RAZ, potom už len ústa + preblikávajúce slnko (posledné 4 framy);
    // loopFrom potrebuje čas od štartu animácie (fromStart: drawT = now - animState.start)
    winsun: { file: "WinSunBoard.png", fps: 7, loopFrom: 4, fromStart: true },
    wintalk: { file: "WinTalk.png",     fps: 5, loop: true }, // special fáza 3 (slnko letí na cieľ): len otvára/zatvára ústa, bez slnka a bez zdvihu
  },
  // výhra = STREDOVÁ special animácia na jeho postavičke (WinSunBoard: zdvih slnka raz, potom ústa + preblik)
  victoryAnim: { file: "WinSunBoard.png", fps: 7, loopFrom: 4, fromStart: true },
  headIdleFile: "WeakIdle.png", // HUD hlava (turnaj) zo slabej formy
  headCx: 0.5,
  headTop: 0.56,
  headCrop: { cx: 0.52, cy: 0.755, size: 0.11 }, // hlava zo slabej formy (WeakIdle) - figúra je DROBNÁ (~22×63 px pri spodku 226px framu), preto malý výrez nízko; cx mierne vpravo od stredu figúry = hlava v okienku mierne vľavo
  pairShift: 80,
  // Escanor: smerový dmg (8); rozsah rastie s Pride levelom (char-select cyklí 0→3 - preview v public/chars/fx/escanor.js;
  // konkrétne zóny neukazuje text, ale cyklený náhľad + pride lev pod mini-doskou)
  abilityPreview: { caster: { x: 1, y: 1 }, dmg: SPECIAL_ZONE_DMG.escanor, dir: "right", desc: "Directional (left/right). Range depends on your Pride level - Pride rises each round you don't shield/mirror, and falls when you use them or take a hit" },
  buttons: {
    // smerový dmg (8); rozsah rastie s pride levelom (veľkosť postavy na ploche = indikátor pride)
    special: { title: `Special (−${SPECIAL_COST} mana, ${SPECIAL_ZONE_DMG.escanor} dmg) - choose a direction (left/right)`, cost: `−${SPECIAL_COST}{💧} ${SPECIAL_ZONE_DMG.escanor}{☠️}`, label: `{💧}${SPECIAL_COST} {☠️}${SPECIAL_ZONE_DMG.escanor}` },
  },
  specialTarget: "dir",
  // smerový (left/right) - rozsah podľa pride levelu (kotva mimo plochy = prázdna zóna aj pri pride 3)
  specialZone: ({ G, board, me, dir }) => G.escanorCells(board, me, dir),
  // veľkosť na ploche rastie s Pride (1.2^level od nôh) - verejný tell
  sizeLevel: { stat: "pride", base: 1 },
  // ⚠ pri plánovaní: smerový special mimo plochy (wall pravidlo - mana sa minie, nič sa nestane)
  planSpecialWarn: ({ p, dir, inB }) => {
    const dx = dir === "left" ? -1 : dir === "right" ? 1 : 0;
    return dx && !inB(p.x + dx, p.y) ? "Special off the board - mana is spent, no effect" : null;
  },
};
