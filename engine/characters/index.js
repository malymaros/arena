// engine/characters - register postáv (Etapa 4 refaktoru, docs/REFACTOR_PLAN.md).
// Každá postava deklaruje kit (default { attack: "ortho", mirrorSlot: "mirror" }):
//   attack:     "ortho" (4 ortogonálne smery) | "diag" (4 diagonálne, bounce strela)
//   mirrorSlot: "mirror" | "special1" (Jotaro, Luffy - v slote mirroru majú vlastnú akciu, viď special1)
//   meleeDmg:   dmg vlastného melee (default MELEE_DMG)
//   healTile:   "plus1" | "full" (Lightning - heal dlaždica lieči na plné HP)
// a svoj special: { resolve, validate? }:
//   resolve(ctx, slot, tl, { dir, cell })  - vyhodnotenie (mana gate už prebehol v doSpecial); môže vrátiť
//                                            PAUSE (Jotarov THE WORLD) - engine ho prepošle hore do kola
//   validate(ctx, a, sim)                  - kontrola argumentov specialu pri lock_in (false = odmietnuť);
//                                            sim = { x, y, worldUsed, foe } - GHOST stav v čase specialu,
//                                            foe = viditeľný súper (null, ak je hráč v labyrinte)
// a ak má kit.mirrorSlot "special1", aj special1: { args, resolve, validate? }:
//   args: "dir" (left/right - Jotaro) | "cell" (bunka na ploche - Luffy) - tvar argumentu akcie
//   resolve(ctx, slot, tl, { dir, cell })  - vyhodnotenie VRÁTANE mana gate-u (cena sa líši per postava)
//   validate(ctx, a, sim)                  - ako pri speciale (sim = ghost stav v čase akcie)
// Háčiky on: { … } (všetky voliteľné; p = hráč, info = výsledok roundStart, ak postava nebola v kole vymenená):
//   deploy(ctx, p)                     - nasadenie (voľba postavy / swap), po spoločnom resete stavu postáv
//   hitTaken(ctx, p)                   - súper spôsobil hráčovi stratu HP (zásah aj odraz; nie tiles/statusy)
//   roundStart(ctx, p) → info          - snímka na začiatku kola (napr. čo je vo fronte)
//   afterActions(ctx, p, info)         - po všetkých akciách kola, pred zánikom obrán
//   roundEnd(ctx, p, slot, info, tl)   - koniec kola (hra pokračuje), stav bez framov - pre oboch pred roundEndFx
//   roundEndFx(ctx, p, slot, info, tl) - koniec kola, môže pridať framy (pasívna regenerácia)
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
