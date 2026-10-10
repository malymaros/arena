// engine/characters - register postáv (Etapa 4 refaktoru, docs/REFACTOR_PLAN.md).
// Každá postava deklaruje kit (default { attack: "ortho", mirrorSlot: "mirror" }):
//   attack:     "ortho" (4 ortogonálne smery) | "diag" (4 diagonálne, bounce strela) | "luffy" (podľa formy)
//   mirrorSlot: "mirror" | "special1" (Jotaro - v slote mirroru má vlastnú akciu)
//   meleeDmg:   dmg vlastného melee (default MELEE_DMG)
//   healTile:   "plus1" | "full" (Lightning - heal dlaždica lieči na plné HP)
// a svoj special: { resolve, validate? }:
//   resolve(ctx, slot, tl, { dir, cell })  - vyhodnotenie (mana gate už prebehol v doSpecial); môže vrátiť
//                                            PAUSE (Jotarov THE WORLD) - engine ho prepošle hore do kola
//   validate(ctx, a, sim)                  - kontrola argumentov specialu pri lock_in (false = odmietnuť);
//                                            sim = { x, y, form, worldUsed, foe } - GHOST stav v čase specialu,
//                                            foe = viditeľný súper (null, ak je hráč v labyrinte)
// ctx = rozhranie enginu pre postavy (stav hry, framy, damage pipeline, labyrint…) - vytvára createEngine.
import { fire, lightning, wanderer } from "./simple.js";
import medusa from "./medusa.js";
import minotaur from "./minotaur.js";
import naruto from "./naruto.js";
import escanor from "./escanor.js";
import soldier from "./soldier.js";
import werewolf from "./werewolf.js";
import { countess, onre } from "./vampires.js";
import jotaro from "./jotaro.js";
import luffy from "./luffy.js";

export const CHARACTERS = Object.fromEntries(
  [fire, lightning, wanderer, medusa, minotaur, naruto, escanor, soldier, werewolf, countess, onre, jotaro, luffy]
    .map(c => [c.key, c]));
