// public/client/actors.js - stav FIGÚR na doske (póza, otočenie, klon, levelová veľkosť) v jednom objekte
// namiesto rozhádzaných globálnych premenných v client.js. Čítajú/zapisujú ho prehrávanie timeline, raf
// a choreografia postáv (cez gettery scope C).
export const actors = {
  // aktuálna animácia figúry: { key, until, start? } (setAnim v client.js)
  animState: { p1: { key: "idle", until: 0 }, p2: { key: "idle", until: 0 } },
  // počas special castu skryjeme bežný actor sprite
  castingNow: { p1: false, p2: false },
  // pri horizontálnom útoku sa mág otočí v smere streľby, aj keď súper stojí inde
  facingOverride: { p1: { sx: 0, until: 0 }, p2: { sx: 0, until: 0 } },
  // klonový flinch (tile zásah na klonovi) - čas štartu; klon sa strhne rovnako ako pravý Naruto pri zásahu,
  // aby „nezraniteľne" nestál a neprezradil sa. Nezávislé od animState (to zdieľa s majiteľom).
  cloneFlinch: { p1: 0, p2: 0 },
  // klon je „mŕtvy" (puffol) - positionActors ho drží skrytého, aby po puffe už nepreblikol späť.
  // Reset pri novom summone (clone_born) a v clearActors.
  cloneDead: { p1: false, p2: false },
  // Naruto summon: dočasné canvasy kópie (kreslí raf) a póza skutočného Naruta počas Special_2 (drží ju positionActors)
  cloneSummonFx: [],
  cloneSummonPose: { p1: null, p2: null },
  // figúry už boli raz umiestnené (prvé umiestnenie bez CSS prechodu)
  actorsInitialized: false,
  // game-over: kedy (v čase performance.now) dobehne posledná animácia útoku
  lastAttackEndAt: { p1: 0, p2: 0 },
  // od kedy je postava v HUD widgete mŕtva - Dead anim sa prehrá raz od tohto času
  hudDeadSince: { p1: 0, p2: 0 },
  // súbežné bubliny nad tým istým hráčom sa stackujú nad seba, aby sa neprekrývali
  floatTimes: { p1: [], p2: [] },
  // escPrideDisplay: dočasné podržanie STAREJ veľkosti po kole - lev sa ukáže PRED zmenou, potom sa aplikuje nové pride.
  // escPrideDisplayChar: postava, pre ktorú je podržanie zachytené - pri SWAPE (turnaj) sa char v strede kola zmení,
  // takže držaná veľkosť starej postavy (napr. vlkolakov mesiac) sa NESMIE aplikovať na novú (Escanor pride 0)
  escPrideDisplay: { p1: null, p2: null },
  escPrideDisplayChar: { p1: null, p2: null },
};

// nová hra / reset: figúry v idle, bez castu, flinchu a otočenia po streľbe
export function resetPoses() {
  actors.animState = { p1: { key: "idle", until: 0 }, p2: { key: "idle", until: 0 } };
  actors.cloneFlinch = { p1: 0, p2: 0 };
  actors.castingNow = { p1: false, p2: false };
  actors.facingOverride = { p1: { sx: 0, until: 0 }, p2: { sx: 0, until: 0 } };
}
