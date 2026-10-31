// public/client/sound-map.js - napojenie zvuku na hru: timeline frame → udalosti (čistá logika v
// public/sounds/events.js) → prehratie v sound.js; fáza hry → hudba.
import { sfx, setMusic } from "/client/sound.js";
import { state, board } from "/client/session.js";
import { eventsForFrame, newTracker, resetTracker } from "/sounds/events.js";
import { charRollActive, onCharRollEnd } from "/client/char-roll.js";

const tracker = newTracker();

// začiatok novej timeline (nové kolo / pokračovanie po THE WORLD)
export function soundTimelineStart() { resetTracker(tracker); }

// frame timeline[i]; `before` = sloty pred frame-om (pohyb sa odvodí z rozdielu pozícií)
export function soundForFrame(timeline, i, before) {
  for (const ev of eventsForFrame(timeline, i, before, tracker, { board, fallback: state })) {
    const play = () => sfx(ev.key, { char: ev.char, pan: ev.pan, windowMs: ev.windowMs });
    if (ev.atMs > 0) setTimeout(play, ev.atMs); // prechod portálom uprostred framu
    else play();
  }
}

// hudba podľa fázy hry: lobby / výber / draft → menu, hra → battle (FINAL ROUND → final, ak má súbor)
export function syncMusic(s, finalRound = false) {
  const phase = s?.phase;
  if (!phase) return;
  if (phase === "match_over") return; // hudbu stíši až game-over sekvencia (po dohraní poslednej timeline)
  // náhodný výber postáv: postavy sú pridelené hneď, ale bojová hudba hrá až po rulete farieb a losovaní,
  // keď sa ukáže hracia plocha (onCharRollEnd nižšie)
  const inGame = phase === "playing" && s.p1?.char && s.p2?.char && !charRollActive();
  if (!inGame) setMusic("music.menu");
  else if (finalRound) setMusic("music.final", "music.battle");
  // Portal Realm má vlastnú bojovú hudbu (bez nej hrá bežná music.battle)
  else if (s.config?.arena === "portal") setMusic("music.battle.portal", "music.battle");
  // Shrek Swamp: vlastná hudba bažiny (vo FINAL ROUND hrá finálna hudba ako všade)
  else if (s.config?.arena === "swamp") setMusic("music.battle.swamp", "music.battle");
  else setMusic("music.battle");
}
onCharRollEnd(() => syncMusic(state));
