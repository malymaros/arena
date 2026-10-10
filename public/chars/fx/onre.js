// public/chars/fx/onre.js - klientská choreografia Onryō: pri triggri pasce sa zjavuje s výkrikom (Scream),
// bez behania, rovno na bunke pasce (Vampire sa zjavuje v idle - to rieši spoločný trap_tp_in v client.js).
// Továreň dostane C = klientský scope (client.js) a vráti háčiky choreografie (popis: public/chars/fx/index.js).
export default function onreFx(C) {
  return {
    effect(e, frameHold) {
      if (e.kind === "trap_tp_in" && (e.from === "p1" || e.from === "p2")) C.setAnim(e.from, "scream", frameHold);
    },
  };
}
