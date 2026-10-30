// shared/balance.js - JEDINÝ zdroj čísel herného balansu (HP/mana, ceny akcií, poškodenie postáv, dlaždice,
// multiplikátory). Importuje ho engine (cez re-export v engine/constants.js) aj klient - tooltipy, cenovky
// a náhľady v public/chars/<key>.js a public/client/* sa z týchto hodnôt skladajú šablónami, takže zmena
// balansu = úprava LEN tohto súboru. Čisté konštanty, žiadne importy.
//
// Pri zmene hodnoty: npm test + npm run golden (golden sa zmení zámerne → npm run golden:update a vysvetli
// to v commite). test/balance-ui.mjs overí, že UI texty ukazujú tie isté čísla.

/* -------------------- Hráč -------------------- */
export const START_HP = 10;
export const START_MANA = 6; // vyšší štart = mind games od 1. kola (special hrozba vs golden shield counter)
export const MAX_MANA = 10;

/* -------------------- Spoločné akcie -------------------- */
export const BASIC_COST    = 1;
export const BASIC_DMG_MAX = 4; // dmg klesá so vzdialenosťou: vedľa 3, ďalej 2, najďalej 1 (vlastné políčko basic nezasahuje)
export const MELEE_COST = 4;
export const MELEE_DMG  = 8;  // úder zblízka - zasiahne len súpera na rovnakom políčku
export const DASH_COST   = 4; // presun až o 2 políčka jedným smerom
export const RECHARGE_GAIN = 4;
export const SHIELD_COST = 2; // zablokuje celý dmg najbližšej súperovej akcie
export const MIRROR_COST = 4; // odrazí celý dmg najbližšej súperovej akcie späť do útočníka
// Shield / Mirror Breaker (docs/BREAKER_PLAN.md): alternatíva obrany v jej slote, cena = cena obrany.
// Zhodnú súperovu obranu rozbije + dmg; nezhodnú obrana odrazí / zablokuje; bez obrany nič.
export const SHIELD_BREAKER_DMG = 2;
export const MIRROR_BREAKER_DMG = 4;
export const SPECIAL_COST = 5;
// vypršaný čas na ťah: každý NEVYPLNENÝ slot je PASS („THINKING") - stojí toľkoto many (max. čo hráč má)
export const PASS_MANA_COST = 2;

/* -------------------- Golden akcie, Last Stand / Last Hope, démon -------------------- */
export const GOLDEN_COST = 3;        // golden shield - extra akcia hráča, ktorý je v kole druhý
export const GOLDEN_MIRROR_COST = 5; // ten istý predťah, ale mirror (odraz) namiesto štítu
export const GOLDEN_MANA_GAIN = 6;   // golden mana refill: +6 many za HP; cena v HP rastie s každým použitím (1, 2, 3…)
export const LAST_STAND_DEAL_MUL = 2; // Last Stand buff: dáva 2× dmg (a prijíma ½)
export const LAST_HOPE_DEAL_MUL  = 4; // Last Hope ultra mód: 4× dmg do konca kola (a prijíma ½)
export const DEMON_COST = 10; // celá mana
export const DEMON_DMG  = 10; // zasiahne každé políčko OKREM toho, na ktorom kaster stojí

/* -------------------- Dlaždice -------------------- */
export const TILE_DMG = 1;         // Damage dlaždica: dmg za krok na nej
export const IK_DMG = 10;          // IK dlaždica
export const HEAL_TILE_GAIN = 1;   // Heal dlaždica: +HP (Lightning: na plné HP - kit healTile "full")
export const POWER_TILE_BONUS = 2; // Power dlaždica: flat +dmg k útoku (nenásobí sa multiplikátormi)

/* -------------------- Postavy -------------------- */
// dmg zónových / cieľových specialov (fire riadok, lightning šachovnica, wanderer diagonály, escanor pride zóna,
// soldier lúč) - engine/characters/zone.js
export const SOLDIER_SPECIAL_DMG = 10; // Vojakov snajperský lúč na zvolenú bunku
export const SPECIAL_ZONE_DMG = { fire: 5, lightning: 3, wanderer: 8, escanor: 8, soldier: SOLDIER_SPECIAL_DMG };
export const WANDERER_MANA_REGEN = 2; // Pútnik: pasívne +N many na konci kola, ak žije a NEpoužil mirror
export const MEDUSA_MELEE_DMG = 4;    // Medúzin melee má širší dosah (vlastné políčko + diagonály) za nižší dmg
export const STONE_ACTIONS = 2;       // Medúzin special: zasiahnutý súper preskočí najbližšie 2 základné akcie
export const CLONE_DMG = 1;           // Narutov klon: koľko pohltí na zdieľanej bunke, kým zvyšok strely prejde na Naruta
export const MAZE_DEAL_MUL = 2;       // Minotaurov maze buff: kaster labyrintu dáva 2× dmg
export const WOLF_MOON_DMG = [2, 4, 6, 8]; // Vlkolak: dmg chargu podľa fázy mesiaca (nov/kosáčik/polmesiac/spln)
// Vampire / Onryō: melee len na vlastnej bunke; charge (namiesto dashu) a pasca nesú bonus (Vampire lieči
// sa, Onryō vysáva manu súpera) - padá LEN keď dmg reálne dopadne
export const VAMP_MELEE_DMG    = 8;
export const VAMP_CHARGE_DMG   = 4;
export const VAMP_CHARGE_BONUS = 4;
export const VAMP_TRAP_DMG     = 3;
export const VAMP_TRAP_BONUS   = 3;
// Jotaro: slabšie melee, Special 1 (mirror slot) na obe diagonály strany, THE WORLD raz za hru, potom Special 2
export const JOTARO_MELEE_DMG = 4;
export const JOTARO_S1_COST = 4;
export const JOTARO_S1_DMG  = 4;
export const WORLD_COST     = 5;
export const JOTARO_S2_COST = 5;
export const JOTARO_S2_DMG  = 8;
// Luffy: slabšie melee, Special 1 (mirror slot) = naťahovacia ruka na ľubovoľnú bunku okrem vlastnej,
// guľa raz za hru (kotúľ o bunku ←/→ + výbuch 3×3, cena SPECIAL_COST), potom Special 2 (susedná bunka ←/→, ako Jotaro)
export const LUFFY_MELEE_DMG = 4;
export const LUFFY_S1_COST   = 4;
export const LUFFY_S1_DMG    = 2;
export const LUFFY_BALL_DMG  = 8;
export const LUFFY_S2_COST   = 5;
export const LUFFY_S2_DMG    = 8;

/* -------------------- Portal Realm (aréna s portálmi, docs/PORTAL_PLAN.md) -------------------- */
export const PORTAL_MAX_PAIRS = 7;          // naraz najviac 7 párov (= všetkých 14 vonkajších hrán dosky 4×3)
export const PORTALS_PER_ROUND = 2;         // default lobby: koľko párov pribudne na štarte hry a na konci každého kola (1–7)
export const PORTAL_REALM_TILE_DMG = 2;     // Damage dlaždica v portal realm (2 ohníky) - bridge ostáva TILE_DMG
export const PORTAL_HP_GAIN = 1;            // HP portál (telo): +HP (Lightning: na plné HP - kit healTile "full")
export const PORTAL_POWER_BONUS = 2;        // powerup portál (útok): flat +dmg (ako power tile), sčítava sa
export const PORTAL_SHOT_RANGE = 3;         // rovná strela v portal realm: dolet 3 políčka spolu (3/2/1 cez portál)
export const PORTAL_TYPES = ["classic", "hp", "mana", "power", "nodef"]; // nodef = Def-breaker
export const PORTAL_WEIGHTS = { classic: 70, hp: 5, mana: 5, power: 10, nodef: 10 }; // default % v lobby
export const PORTAL_TILE_WEIGHTS = { dmg: 90, ik: 10 }; // v portal realm sú len Damage a Insta-kill dlaždice

/* -------------------- Shrek Swamp (aréna so Shrekom - neutrálne NPC, docs/SWAMP_PLAN.md) -------------------- */
export const SHREK_HP = 20;              // Shrekove HP (zobrazené nad hlavou); 0 = padne → fáza smradu
export const SHREK_ROAR_DMG = [1, 2, 3]; // dmg revu / tackle: HP > 10 → 1, ≤ 10 → 2, ≤ 5 → 3
export const SHREK_RAGE_HP = [10, 5];    // prahy HP pre 2. a 3. stupeň revu
export const SHREK_BARREL_MANA = 1;      // reakcia na strelu: sud späť - −1 mana (chýbajúca prejde do HP)
export const SHREK_PUNCH_MANA = 2;       // reakcia na melee: punch - −2 many (chýbajúca prejde do HP)
export const STENCH_DMG = 1;             // smrad po Shrekovej smrti: dmg na konci každého kroku (ako dmg dlaždica)
// Shrek Swamp - itemy namiesto dlaždíc: srdiečko (+HP) a kvapka (plná mana), zoberie ich hráč pri vstupe/prechode
export const ITEMS_PER_ROUND = 1;                 // default lobby: koľko itemov padne na štarte hry a na konci každého kola (1–3)
export const ITEM_WEIGHTS = { heal: 60, mana: 40 }; // default % v lobby
export const ITEM_HEAL_GAIN = 1;                  // srdiečko: +1 HP (Lightning: na plné HP - kit healTile "full")
export const ITEM_MAX = 4;                        // naraz najviac 4 itemy na ploche
