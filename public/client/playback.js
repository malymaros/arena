// public/client/playback.js - stav PREHRÁVANIA timeline na klientovi (jeden objekt namiesto rozhádzaných
// globálnych príznakov v client.js). Plánovanie kola (myQueue, lockedIn, golden*) sem nepatrí.
// Moduly klienta ho importujú a čítajú/zapisujú priamo (playback.playing = true …).
export const playback = {
  // generácia prehrávania - novšia timeline zruší staršiu slučku (schedulePlayTimeline)
  playGen: 0,
  // počas prehrávania neaktualizuj UI zo snapshotov a drž LOCK zamknutý
  playing: false,
  // koniec hry: koho ohlásil server a výsledok hry v sérii - overlay sa ukáže až po dohraní timeline
  serverWinner: null,
  serverGameResult: null,
  gameOverShown: false,
  // „FINAL ROUND" sa zobrazí hore až keď prebehne banner (nie už počas summonu)
  finalRoundActive: false,
  // round-script beat counts - prežijú pauzu THE WORLD: pokračovacia timeline pokračuje v číslovaní beatov
  // (kurzor tak po obnovení času skočí na správnu ĎALŠIU akciu, nie na začiatok lišty)
  roundBeatCounts: { p1: 0, p2: 0 },
  // Jotaro THE WORLD: tsPlanning = som Jotaro a plánujem 3 zmrazené akcie (UI odomknuté, lock → timestop_actions);
  // tsFrozen = som súper a čakám zmrazený (UI zamknuté, full-screen filter). Práve jeden je aktívny počas pauzy.
  tsPlanning: false,
  tsFrozen: false,
  // tsActive = beží time-stop (od timestop_start po timestop_end) - počas neho zmrazíme animácie VŠETKÝCH
  // okrem Jotara (tsJotaroSlot); tsFreezeAt = čas zmrazenia (statický drawT pre zmrazené figúry)
  tsActive: false,
  tsJotaroSlot: null,
  tsFreezeAt: 0,
  // ďalšia timeline je pokračovanie po THE WORLD → NEresetuj beat counts
  tsResumePending: false,
};
