// public/chars/fx/index.js - klientská CHOREOGRAFIA postáv (Etapa 6c refaktoru, docs/REFACTOR_PLAN.md).
// Dáta postavy sú v public/chars/<key>.js (importovateľné aj v Node); tu je kód, ktorý kreslí/animuje.
// Každý modul je továreň (C) → háčiky, kde C = klientský scope z client.js (stav hry, rozmery dosky,
// DOM vrstvy, pomocníci spawn/draw - zoznam v client.js pri `const C`). Všetky háčiky sú voliteľné:
//
//   effect(e, frameHold)          efekt timeline, ktorého autor (e.from) je táto postava - volá sa v prehrávači
//                                 (step) na mieste pôvodných vetiev; frameHold = trvanie frame-u
//   boardAnim({ slot, st, aSt, now, stoned, lyingDead, anim }) → anim
//                                 póza malej figúry na doske v raf (aSt = animState slotu); vráť anim bez zmeny,
//                                 ak sa postavy netýka
//   centerCanvas(cvs, sp)         vznik veľkého stredového spritu castu (sp = cast záznam: from, file?, fps?…)
//   drawCenter(cvs, ctx, now) → true  raf stredového spritu - true = nakreslené (inak bežný loop)
import soldier from "./soldier.js";
import werewolf from "./werewolf.js";

export const CHAR_FX_FACTORIES = { soldier, werewolf };
