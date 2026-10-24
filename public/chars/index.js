// public/chars/index.js - klientský register postáv (Etapa 6 refaktoru, docs/REFACTOR_PLAN.md).
// Jeden súbor = jedna postava (public/chars/<key>.js); tento modul z nich skladá tabuľky, ktoré
// používa client.js. Nová postava = nový súbor + riadok v CHAR_LIST (poradie = poradie v tabuľkách).
//
// Polia postavy (všetky okrem key a meta sú voliteľné):
//   key            interný kľúč (= serverový char)
//   meta           { name, dir, dirP2? } - zobrazované meno, priečinok spritov v public/assets/ a natívna p2 paleta
//                  (bez dirP2 kreslí p2 cez CSS alt-color filter)
//   mirrorSlot     "special1" - akcia v mirror slote (zrkadlo enginu kit.mirrorSlot; Jotaro, Luffy: Special 1)
//   special1Target "dir" (default - L/R šípky, Jotaro) | "cell" (mini mapa buniek bez vlastnej ghost bunky, Luffy)
//   special1Cost   cena Special 1 (plánovacie varovanie o mane)
//   side           "p1" | "p2" - postava viazaná na stranu (zrkadlo serverového SIDE_CHARS); v turnaji draftovateľná,
//                  swap do/z nej zakázaný
//   vamp           1 - vamp kit (charge v dash slote, pasca, mirror-imunita) - podmnožina side (Jotaro nie)
//   specialAnim    { file, fps, loop… } - veľký stredový sprite castu specialu (aj victory/preview)
//   fxOffsetX      efektový sprite má obsah mimo stredu framu - vodorovná korekcia v náhľade (zlomok šírky canvasu)
//   anims          { key: { file, fps, loop… } } - vlastné animácie postavy (pridajú sa do ANIM_DEF); fromStart = na doske
//                  hrá RAZ od frame 0 (čas od setAnim), armCrop = zlomok šírky framu odseknutý sprava (Luffyho telo
//                  pri naťahovaní ruky), frameIndex = pevný frame, startFrame = loop/prehrávanie od tohto framu
//   spriteAlias    { "prefix priečinka": { "Očakávaný.png": "Skutočný.png" } } - chýbajúce/premapované súbory
//   portraitScale  násobič veľkosti v karte výberu a HUD portréte: mágovia vypĺňajú frame len z ~51 % výšky,
//                  Medúza 59 %, Minotaur 72 %, Luffy/Jotaro 88/78 % → zmenšenie na porovnateľnú výšku
//                  (na BOARDE ostávajú zámerne väčší, bez násobiča)
//   headCx/headTop stred hlavy (zlomok šírky, posunutý k tvári) a vrch hlavy (zlomok výšky actor canvasu) -
//                  YOU šípka nad postavou; namerané z Idle.png (postavy nie sú centrované)
//   headCrop       { cx, cy, size, cxP2?, cyP2? } - výrez hlavy pre HUD hlavy (turnaj) a značku pasce:
//                  stred výrezu (zlomok šírky/výšky framu), strana štvorca (zlomok výšky); cxP2/cyP2 = korekcia
//                  pre natívny p2 sheet, keď v ňom figúra sedí inde (ladenie: /head-cropper.html)
//   pairShift      px odstupu na zdieľanej bunke (default PAIR_SHIFT_DEFAULT)
//   teleportDir/teleportCount/teleportFx  vlastná explózia swapu v turnaji (číslované PNG v assets/Teleport);
//                  teleportFx { scale (× políčko), anchor "feet"|"torso", bottomTrim (priehľadný spodok PNG), dy (posun nadol) }
//   previewCast    hover animácia preview karty (Luffy, Jotaro)
//   abilityPreview { caster, dmg, desc… } - náhľad specialu vo výbere postáv
//   buttons        skiny akčných tlačidiel { melee, special, dash, attack, recharge, mirror }: { title, cost, skin? }
//                  alebo funkcia (ui) → { title, cost } pre premenlivý obsah (ui = { st, worldUsed, …planUi });
//                  cost = HTML s {emoji} tokenmi (pixelové mini ikony), skin = trieda tlačidla aj pickera
//                  s „???" ikonou (vamp-charge, jotaro-s1, luffy-s1); special.specialKey(ui) = kedy prekresliť
//   specialTarget  cieľ specialu: "none" (default) | "dir" (L/R) | "wolf" (8 smerov) | "cell" (vojak) |
//                  "trap" (bunka bez blokovania) - alebo funkcia (ui) → typ
//   victoryAnim    anim malej postavy pri výhre (default: slučka specialAnim)
//   headIdleFile   pás, z ktorého sa reže HUD hlava (default Idle.png; Escanor WeakIdle.png)
//   boardFit       { fill, refH, offY } - menší fill na doske normalizovaný na výšku framu (fill × fh/refH),
//                  ukotvený na nohy (anchorY 1) a zdvihnutý o offY px (default fill 0.95, stred) - aj ghost
//   previewIdleCaster  caster na mini-doske výberu hrá IDLE (nie efektový sprite specialu)
//   specialZone    ({ G, board, me, dir, tiles }) → [[x,y]…] náhľad zóny specialu (G = shared/geometry.js)
//   sizeLevel      { stat, base } - veľkosť na ploche base·1.2^level podľa verejného stavu (Escanor pride, vlkolak moon)
//   actionAnims    { melee?, shot?, recharge? } - kľúč ANIM_DEF pre malú postavu pri akcii (default attack2_loop / attack / aura)
//   projectile     { orient?: "rotate", scale?, yOff?, explodeAtEnd? } - basic strela (Charge.png): orientácia čistou
//                  rotáciou, veľkosť (× výška bunky), posun nadol (× výška bunky), výbuch na poslednej bunke letu
//   planSpecialWarn ({ p, dir, i, foe, mine, inB, G }) → text ⚠ | null - varovanie v lište pri plánovaní specialu
//                  (p = ghost pozícia, i = index akcie vo fronte)
//   planClone      special prizve klona - s ním akcia do steny nie je zbytočná (Naruto)
import fire from "./fire.js";
import lightning from "./lightning.js";
import wanderer from "./wanderer.js";
import medusa from "./medusa.js";
import minotaur from "./minotaur.js";
import naruto from "./naruto.js";
import escanor from "./escanor.js";
import soldier from "./soldier.js";
import werewolf from "./werewolf.js";
import countess from "./countess.js";
import onre from "./onre.js";
import luffy from "./luffy.js";
import jotaro from "./jotaro.js";

export const CHAR_LIST = [fire, lightning, wanderer, medusa, minotaur, naruto, escanor, soldier, werewolf, countess, onre, luffy, jotaro];
export const CHARS_BY_KEY = Object.fromEntries(CHAR_LIST.map(c => [c.key, c]));

// { key: c[field] } pre postavy, ktoré pole majú
const collect = (field) => Object.fromEntries(CHAR_LIST.filter(c => c[field] !== undefined).map(c => [c.key, c[field]]));
// zlúčené pod-mapy všetkých postáv (animácie, aliasy súborov)
const merge = (field) => Object.assign({}, ...CHAR_LIST.map(c => c[field] || {}));

export const CHAR_META = collect("meta");
export const SIDE_CHARS = collect("side");
export const VAMP_CHARS = collect("vamp");
export const SPECIAL_ANIMS = collect("specialAnim");
export const FX_OFFSET_X = collect("fxOffsetX");
export const CHAR_ANIMS = merge("anims");
export const SPRITE_FILE_ALIAS = merge("spriteAlias");
export const PORTRAIT_SCALE = collect("portraitScale");
export const HEAD_CX = collect("headCx");
export const HEAD_TOP = collect("headTop");
export const HEAD_CROP = collect("headCrop");
export const PAIR_SHIFT = collect("pairShift");
export const TELEPORT_DIR = collect("teleportDir");
export const TELEPORT_COUNT = collect("teleportCount");
export const TELEPORT_FX = collect("teleportFx");
export const PREVIEW_CAST = collect("previewCast");
export const ABILITY_PREVIEW = collect("abilityPreview");
export const CHAR_BUTTONS = collect("buttons");
export const SIZE_LEVEL = collect("sizeLevel");
export const ACTION_ANIMS = collect("actionAnims");
export const PROJECTILE = collect("projectile");
