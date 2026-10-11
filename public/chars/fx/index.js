// public/chars/fx/index.js - klientská CHOREOGRAFIA postáv (Etapa 6c refaktoru, docs/REFACTOR_PLAN.md).
// Dáta postavy sú v public/chars/<key>.js (importovateľné aj v Node); tu je kód, ktorý kreslí/animuje.
// Každý modul je továreň (C) → háčiky, kde C = klientský scope z client.js (stav hry, rozmery dosky,
// DOM vrstvy, pomocníci spawn/draw - zoznam v client.js pri `const C`). Všetky háčiky sú voliteľné:
//
//   effect(e, frameHold)          efekt timeline, ktorého autor (e.from) je táto postava - volá sa v prehrávači
//                                 (step) na mieste pôvodných vetiev; frameHold = trvanie frame-u
//   boardAnim({ slot, st, aSt, now, stoned, lyingDead, anim }) → anim
//                                 póza malej figúry na doske v raf (aSt = animState slotu); vráť anim bez zmeny,
//                                 ak sa postavy netýka; anim.fromStart = hrá RAZ od frame 0 (čas od setAnim)
//   centerCanvas(cvs, sp)         vznik veľkého stredového spritu castu (sp = cast záznam: from, file?, fps?…)
//   drawCenter(cvs, ctx, now) → true  raf stredového spritu - true = nakreslené (inak bežný loop)
//   centerCast(e) → sp | null     efekt autora zrkadlený do stredového spritu (renderGrid; sp ako melee cast)
//   clearOverlays()               koniec hry/medzihra - zmaž vlastné overlaye, ktoré renderGrid nemaže
//   hud(slot, p)                  renderHUD (per frame) pre každý slot a KAŽDÚ postavu - vlastné HUD prvky; ak p?.char
//                                 nie je táto postava, skry ich
//   preview({ grid, caster, dir }) → { frame(now), close() }
//                                 náhľad specialu vo výbere postáv (hover karty): grid = mini-doska (.mini-cell
//                                 s data-gx/gy), caster = bunka castera; frame volá raf, close pri odchode/inej karte
import soldier from "./soldier.js";
import werewolf from "./werewolf.js";
import countess from "./countess.js";
import onre from "./onre.js";
import luffy from "./luffy.js";

export const CHAR_FX_FACTORIES = { soldier, werewolf, countess, onre, luffy };
