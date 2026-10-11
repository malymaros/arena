// engine/constants.js - herné konštanty a čisté helpery (balans, časovanie animácií, postavy, config).
// Zdieľané serverom aj enginom; presunuté 1:1 z vrchu server.js (Etapa 1 refaktoru).
// biely (p1, vľavo) začína hru 1 (v sérii sa štartér hier strieda) - losuje sa, KTO z osôb A/B
// je biely (startMatch); testy si osobu na slote p1 vedia zafixovať cez env (A alebo B)
export const FORCE_FIRST_STARTER = ["A", "B"].includes(process.env.FORCE_FIRST_STARTER) ? process.env.FORCE_FIRST_STARTER : null;
// ARENA_SEED: deterministická náhoda (testy / golden master) - RNG roomky sa ním nanovo nasemienkuje pri každom
// startMatch, takže rovnaký priebeh zápasu (rovnaké vstupy) dá bit po bite rovnaké timeline. Bez seedu Math.random.
export const ARENA_SEED = /^\d+$/.test(process.env.ARENA_SEED || "") ? Number(process.env.ARENA_SEED) : null;
// mulberry32 - malý, rýchly seedovateľný PRNG s výstupom v [0, 1) ako Math.random
export function seededRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------- Game constants -------------------- */
export const BOARD = { w: 4, h: 3 };
export const START_POS = { p1: { x: 0, y: 1 }, p2: { x: BOARD.w - 1, y: 1 } };
export const START_HP = 10;
export const START_MANA = 6; // vyšší štart = mind games od 1. kola (special hrozba vs golden shield counter)
export const MAX_MANA = 10;
export const WANDERER_MANA_REGEN = 2; // Pútnik (wanderer): pasívne +N many na konci každého kola, ak ešte žije, je aktívny a NEpoužil mirror

export const BASIC_COST    = 1;
export const BASIC_DMG_MAX = 4; // dmg klesá so vzdialenosťou: vedľa 3, ďalej 2, najďalej 1 (vlastné políčko basic nezasahuje)

export const MELEE_COST = 4;
export const MELEE_DMG  = 8;  // úder zblízka - zasiahne len súpera na rovnakom políčku
export const MEDUSA_MELEE_DMG = 4; // Medúzin melee má širší dosah (vlastné políčko + diagonály) za nižší dmg
export const JOTARO_MELEE_DMG = 4; // Jotarov melee je slabší (balans) - 4 dmg namiesto plných 8
export const MELEE_REPEAT = 3; // švih v rovnakej kadencii ako special (beaty po SPECIAL_BEAT_MS)

export const SPECIAL_COST = 5;
export const SOLDIER_SPECIAL_DMG = 10; // Vojakov snajperský lúč na zvolenú bunku - trafí, len ak tam súper PRÍDE (cieľ nesmie byť jeho aktuálna bunka)
// Vlkolak (werewolf): charge special - dmg podľa fázy mesiaca (index = moon level 0–3: nov/kosáčik/polmesiac/spln)
export const WOLF_MOON_DMG = [2, 4, 6, 8];
// vlkolakov special má 8 smerov (aj diagonály) - kľúče nesie akcia v `dir`
// smery a dosah diagonálnej strely: jediný zdroj je shared/geometry.js (zdieľaný s prehliadačom)
import { DIR8 as WOLF_DIRS, DIAG_DIRS, VAMP_SHOT_RANGE } from "../shared/geometry.js";
export { WOLF_DIRS, DIAG_DIRS, VAMP_SHOT_RANGE };
export const WOLF_DIR_KEYS = Object.keys(WOLF_DIRS);
// fáza mesiaca podľa AKTUÁLNYCH HP (prepočítava sa na konci kola + pri nasadení/swape):
// 10 → 0 (nov), 9–7 → 1 (kosáčik), 6–4 → 2 (polmesiac), 3–1 → 3 (spln)
export function moonLevelFor(hp) {
  if (hp >= 10) return 0;
  if (hp >= 7) return 1;
  if (hp >= 4) return 2;
  return 3;
}
// Countess Vampire / Onre: postavy viazané na SLOT (countess len p1/biela, onre len p2/čierna) -
// nie sú v CHARS (turnajový pool). Mimo turnaja ich choose_character pustí správnej strane;
// V TURNAJI si ich hráč môže draftnúť ako jedného z 3 magov (len svoju stranu) - swap DO/Z nich je
// však zakázaný (odlišná sémantika akcií: diagonálny basic, charge, pasca), viď validQueue/doSwap.
// side-BOUND postavy (väzba na stranu + swap ban + diagonálny basic + draft len na svojej strane).
// Jotaro (JJBA, stand Star Platinum, special THE WORLD) je viazaný na p2 ako Onryō.
export const SIDE_CHARS = { countess: "p1", onre: "p2", jotaro: "p2", luffy: "p1" };
// VAMP kit (charge namiesto dashu, vlastné melee, pasca-special, mirror imunita) - PODMNOŽINA side-bound.
// Jotaro je side-bound, ale NEMÁ vamp kit: dashuje/melee normálne, special nie je pasca, nie je mirror-imúnny.
export const VAMP_CHARS = { countess: 1, onre: 1 };
// (Väzba side-postavy na slot sa overuje priamo `SIDE_CHARS[key] === slot` - viď onChooseCharacter/onChooseTeam.)
// ich basic attack strieľa DIAGONÁLNE (4 diagonálne smery namiesto ortogonálnych; falloff nezmenený -
// na 3-riadkovej ploche má diagonála max 2 kroky, takže dmg je vždy 3 alebo 2)
export const DIAG_DIR_KEYS = Object.keys(DIAG_DIRS);
// ich melee je úder na vlastnej bunke bez bonusu; charge v 4 smeroch nesie silnejší bonus.
// Vampire/Onryō kit: melee = úder LEN na vlastnej bunke (bez smeru); charge nahrádza dash - pohybové
// melee 4 smermi po prvú figúru/okraj; trap úder si drží pôvodné hodnoty. Charge/trap bonus
// (Vampire HP heal / Onryō mana drain+gain) padá LEN keď dmg reálne dopadne.
export const VAMP_MELEE_DMG    = 8;
export const VAMP_CHARGE_DMG   = 4;
export const VAMP_CHARGE_BONUS = 4;
export const VAMP_TRAP_DMG     = 3;
export const VAMP_TRAP_BONUS   = 3;
// diagonálny basic: strela sa RAZ odrazí od ktorejkoľvek steny (biliard - od bočnej letí späť),
// roh neodráža (strela končí), tvrdý limit letu = 3 bunky → dmg presne 3/2/1 podľa vzdialenosti
// Jotaro (Star Platinum): diagonálny basic používa vamp trasu (VAMP_SHOT_RANGE, dmg 3/2/1). Special 1
// (v mirror slote) = smerový útok na OBE diagonálne bunky zvolenej strany; Special 2 (po THE WORLD) =
// smerový útok na jedinú susednú bunku. THE WORLD = jednorazový per-hra time-stop (WORLD_COST).
export const WORLD_COST     = 5;
export const JOTARO_S1_COST = 4;
export const JOTARO_S1_DMG  = 4;
export const JOTARO_S2_COST = 5;
export const JOTARO_S2_DMG  = 8;
export const STONE_ACTIONS = 2; // Medúzin special: zasiahnutý súper preskočí najbližšie 2 základné akcie (kameň)
// Minotaurov special (labyrint) nemá číselnú konštantu - trvá, kým jeden hráč nezasiahne druhého (viď endLabyrinths)
export const CLONE_DMG = 1; // Narutov klon: koľko pohltí na zdieľanej bunke (jednorazový bait), kým zvyšok strely prejde na Naruta. Útok aj odraz mirrorom dávajú PLNÝ dmg ako Naruto (viď doBasic/doMelee/applyHitOnClone)
export const RECHARGE_GAIN = 4;
export const SHIELD_COST = 2; // zablokuje celý dmg najbližšej súperovej akcie
export const MIRROR_COST = 4; // odrazí celý dmg najbližšej súperovej akcie späť do útočníka
export const GOLDEN_COST = 3; // extra akcia hráča, ktorý je v kole druhý - štít vyhodnotený pred prvou akciou startera
export const GOLDEN_MIRROR_COST = 5; // ten istý predťah, ale mirror (odraz) namiesto štítu - zlaté vizuály
export const DASH_COST   = 4; // presun až o 2 políčka jedným smerom
export const GOLDEN_MANA_GAIN = 6; // golden mana refill: +6 many za HP; cena v HP rastie s každým použitím (1, 2, 3…)

// Nové special tiles: POWER (spotrebný) - caster stojaci na ňom v momente vyhodnotenia dmg akcie dostane
// flat +POWER_TILE_BONUS k útoku a tile sa použitím SPOTREBUJE (aj whiff/block - použitie, nie zásah);
// bonus sa NEnásobí Last Stand/maze multiplikátormi (klient ho ukazuje ako samostatný „-2" float).
// BLOCK (permanentný) - figúra na ňom nemôže castnúť shield/mirror: akcia sa prečiarkne BEZ ceny
// (vedomá výnimka z wall pravidla - hráč si na block tile vie „pass-núť" slot zadarmo, platí pozíciou).
export const POWER_TILE_BONUS = 2;

// Démon útok - dostupný LEN buffnutému hráčovi v poslednom (Last Stand) kole; zaberá jeden z 3 akčných slotov
export const DEMON_COST = 10; // celá mana
export const DEMON_DMG  = 10; // zasiahne každé políčko OKREM toho, na ktorom kaster stojí (vyhodnotí sa cez shield/mirror)

// special1 = Jotarov útok v mirror slote (len Jotaro; ostatné postavy ho vo validQueue/fillFromDraft odmietnu)
export const ACTION_TYPES = new Set(["move", "recharge", "attack", "melee", "special", "shield", "mirror", "dash", "special1"]);
export const MOVE_DIRS = new Set(["up", "down", "left", "right"]);

/* -------------------- Match / lobby config -------------------- */
// koľko vyhratých hier treba na zisk série
// tournament = ako bo5 (first-to-3), ale s prenosom HP magov medzi hrami (3 magovia/hráč)
export const MATCH_FORMATS = { single: 1, bo3: 2, tournament: 3 };
export const CHARS = ["fire", "lightning", "wanderer", "medusa", "minotaur", "naruto", "escanor", "soldier", "werewolf"];
// tournament: každý hráč si pred hrou 1 naslepo draftne vlastný tím TEAM_SIZE postáv z celého poolu CHARS
// (choose_team vo fáze team_select); tím je fixný na celú sériu a určuje kľúče mageHp/mageMana danej osoby.
export const TEAM_SIZE = 3;
// časový limit na ťah - vyhodnocuje a auto-lockuje klient (server lock validuje ako bežný)
export const TIMER_OPTIONS = new Set(["off", "30", "60", "120", "quickdraw"]);
export const QUICKDRAW_MS = 60000; // quick-draw: po locku prvého hráča má druhý toľkoto na ťah
// vypršaný čas na ťah: každý NEVYPLNENÝ slot je PASS („THINKING") - stojí toľkoto many (max. čo hráč má)
export const PASS_MANA_COST = 2;

// predvolené nastavenia (predvyplnia lobby na klientovi)
export const DEFAULT_CONFIG = {
  format: "single",                              // "single" | "bo3" | "tournament"
  tilesPerRound: 1,                              // 1 | 2 | 3 - koľko tiles sa spawne na konci kola
  tileWeights: { dmg: 75, heal: 5, mana: 5, ik: 5, power: 5, block: 5 }, // % šanca typu, spolu 100
  timer: "30",                                   // "off" | "30" | "60" | "120" | "quickdraw"
  tilePreview: true,                             // ukazovať hráčom vopred, kde na konci kola pribudnú tiles / kam sa presunú IK
};

// časovanie timeline (delayMs framov) žije v shared/timing.js - ten istý modul importuje klient
export * from "../shared/timing.js";

