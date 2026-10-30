// public/client/planning.js - stav PLÁNOVANIA kola na klientovi (čo si hráč naklikal pred lock_in).
// Jeden objekt namiesto rozhádzaných globálnych príznakov v client.js; stav prehrávania je v playback.js.
import { state, me } from "/client/session.js";

export const planning = {
  // naplánované akcie kola (max 3 bežné; v turnaji aj swap) - poslané v lock_in
  myQueue: [],
  // kolo je odoslané (lock_in) - UI plánovania je zamknuté, kým nepríde timeline
  lockedIn: false,
  // objednaný golden shield (extra predťah pred kolom, len keď som druhý)
  goldenArmed: false,
  // objednaný golden mirror - ten istý predťah, len odraz (vzájomne výlučný s golden shieldom)
  goldenMirrorArmed: false,
  // objednaný golden mana refill (extra akcia po konci kola)
  goldenManaArmed: false,
  // objednaný Last Stand (duálny s golden mana, výlučný)
  lastStandArmed: false,
  // objednaný Last Hope (úvodná akcia nebuffnutého hráča vo final kole)
  lastHopeArmed: false,
  // otvorený picker: null | "move" | "attack" | "attack_diag" | "dash" | "special" | "special_cell" | "special_wolf" | "special1" | "special1_cell"
  openPicker: null,
};

// nová hra / reset: prázdna fronta, žiadne objednané golden/Last Stand/Last Hope akcie, odomknuté
// (openPicker nechávame - pickery zatvára closePickers() v client.js, ktorý zároveň skryje ich DOM)
export function resetPlanning() {
  planning.myQueue = [];
  planning.goldenArmed = false;
  planning.goldenMirrorArmed = false;
  planning.goldenManaArmed = false;
  planning.lastStandArmed = false;
  planning.lastHopeArmed = false;
  planning.lockedIn = false;
}

// kontext plánovania pre premenlivé tlačidlá (Special 2 po jednorazovom speciale - Jotaro, Luffy)
export function buttonUi() {
  const st = state?.[me];
  return { st, worldUsed: !!st?.worldUsed };
}
