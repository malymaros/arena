// server.js (ESM)

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  // preži krátke výpadky spojenia: po reconnecte server prehrá klientovi zmeškané packety
  // (vrátane state+timeline) → animácie nevisia a netreba refresh ani pri blikajúcej sieti
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000, skipMiddlewares: true },
});

// Statika s rozumným kešovaním (predtým no-store → prehliadač sťahoval všetkých ~33 MB
// sprite sheetov pri KAŽDOM načítaní; plocha sa preto zobrazovala pomaly zakaždým):
//  - assets/ a arenas/ (sprite sheety, pozadia — menia sa zriedka): kešuj 1 h, potom revaliduj
//  - index.html, client.js/css (kód — mení sa pri deployi): vždy revaliduj cez ETag,
//    prehliadač si tak po deployi hneď vyzdvihne novú verziu, no bez zmeny dostane rýchle 304
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/[\\/](assets|arenas)[\\/]/.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=3600");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || ""; // ← voliteľné heslo pre admin reset
// Heslá pre vstup do hry (rozdáva admin): čiarkou oddelený zoznam. Zatiaľ natvrdo "hamara"
// (default), prepísateľné cez env PLAYER_KEYS=heslo1,heslo2 (napr. systemd deploy/arena.service).
// POZOR: repo je verejné → tento default je viditeľný; na reálne tajné heslo nastav env a zmaž default.
const PLAYER_KEYS = new Set((process.env.PLAYER_KEYS || "hamara").split(",").map(s => s.trim()).filter(Boolean));
// biely (p1, vľavo) začína hru 1 (v sérii sa štartér hier strieda) — losuje sa, KTO z osôb A/B
// je biely (startMatch); testy si osobu na slote p1 vedia zafixovať cez env (A alebo B)
const FORCE_FIRST_STARTER = ["A", "B"].includes(process.env.FORCE_FIRST_STARTER) ? process.env.FORCE_FIRST_STARTER : null;

/* -------------------- Game constants -------------------- */
const BOARD = { w: 4, h: 3 };
const START_POS = { p1: { x: 0, y: 1 }, p2: { x: BOARD.w - 1, y: 1 } };
const START_HP = 10;
const START_MANA = 6; // vyšší štart = mind games od 1. kola (special hrozba vs golden shield counter)
const MAX_MANA = 10;
const WANDERER_MANA_REGEN = 2; // Pútnik (wanderer): pasívne +N many na konci každého kola, ak ešte žije, je aktívny a NEpoužil mirror

const BASIC_COST    = 1;
const BASIC_DMG_MAX = 4; // dmg klesá so vzdialenosťou: vedľa 3, ďalej 2, najďalej 1 (vlastné políčko basic nezasahuje)

const MELEE_COST = 4;
const MELEE_DMG  = 8;  // úder zblízka — zasiahne len súpera na rovnakom políčku
const MEDUSA_MELEE_DMG = 4; // Medúzin melee má širší dosah (vlastné políčko + diagonály) za nižší dmg
const JOTARO_MELEE_DMG = 4; // Jotarov melee je slabší (balans) — 4 dmg namiesto plných 8
const MELEE_REPEAT = 3; // švih v rovnakej kadencii ako special (beaty po SPECIAL_BEAT_MS)

const SPECIAL_COST = 5;
const SOLDIER_SPECIAL_DMG = 10; // Vojakov snajperský lúč na zvolenú bunku — trafí, len ak tam súper PRÍDE (cieľ nesmie byť jeho aktuálna bunka)
// Vlkolak (werewolf): charge special — dmg podľa fázy mesiaca (index = moon level 0–3: nov/kosáčik/polmesiac/spln)
const WOLF_MOON_DMG = [2, 4, 6, 8];
// vlkolakov special má 8 smerov (aj diagonály) — kľúče nesie akcia v `dir`
const WOLF_DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], up_left: [-1, -1], up_right: [1, -1], down_left: [-1, 1], down_right: [1, 1] };
const WOLF_DIR_KEYS = Object.keys(WOLF_DIRS);
// fáza mesiaca podľa AKTUÁLNYCH HP (prepočítava sa na konci kola + pri nasadení/swape):
// 10 → 0 (nov), 9–7 → 1 (kosáčik), 6–4 → 2 (polmesiac), 3–1 → 3 (spln)
function moonLevelFor(hp) {
  if (hp >= 10) return 0;
  if (hp >= 7) return 1;
  if (hp >= 4) return 2;
  return 3;
}
// Countess Vampire / Onre: postavy viazané na SLOT (countess len p1/biela, onre len p2/čierna) —
// nie sú v CHARS (turnajový pool). Mimo turnaja ich choose_character pustí správnej strane;
// V TURNAJI si ich hráč môže draftnúť ako jedného z 3 magov (len svoju stranu) — swap DO/Z nich je
// však zakázaný (odlišná sémantika akcií: diagonálny basic, charge, pasca), viď validQueue/doSwap.
// side-BOUND postavy (väzba na stranu + swap ban + diagonálny basic + draft len na svojej strane).
// Jotaro (JJBA, stand Star Platinum, special THE WORLD) je viazaný na p2 ako Onryō.
const SIDE_CHARS = { countess: "p1", onre: "p2", jotaro: "p2", luffy: "p1" };
// VAMP kit (charge namiesto dashu, vlastné melee, pasca-special, mirror imunita) — PODMNOŽINA side-bound.
// Jotaro je side-bound, ale NEMÁ vamp kit: dashuje/melee normálne, special nie je pasca, nie je mirror-imúnny.
const VAMP_CHARS = { countess: 1, onre: 1 };
// (Väzba side-postavy na slot sa overuje priamo `SIDE_CHARS[key] === slot` — viď onChooseCharacter/onChooseTeam.)
// ich basic attack strieľa DIAGONÁLNE (4 diagonálne smery namiesto ortogonálnych; falloff nezmenený —
// na 3-riadkovej ploche má diagonála max 2 kroky, takže dmg je vždy 3 alebo 2)
const DIAG_DIRS = { up_left: [-1, -1], up_right: [1, -1], down_left: [-1, 1], down_right: [1, 1] };
const DIAG_DIR_KEYS = Object.keys(DIAG_DIRS);
// ich melee je úder na vlastnej bunke bez bonusu; charge v 4 smeroch nesie silnejší bonus.
// Vampire/Onryō kit: melee = úder LEN na vlastnej bunke (bez smeru); charge nahrádza dash — pohybové
// melee 4 smermi po prvú figúru/okraj; trap úder si drží pôvodné hodnoty. Charge/trap bonus
// (Vampire HP heal / Onryō mana drain+gain) padá LEN keď dmg reálne dopadne.
const VAMP_MELEE_DMG    = 8;
const VAMP_CHARGE_DMG   = 4;
const VAMP_CHARGE_BONUS = 4;
const VAMP_TRAP_DMG     = 3;
const VAMP_TRAP_BONUS   = 3;
// diagonálny basic: strela sa RAZ odrazí od ktorejkoľvek steny (biliard — od bočnej letí späť),
// roh neodráža (strela končí), tvrdý limit letu = 3 bunky → dmg presne 3/2/1 podľa vzdialenosti
const VAMP_SHOT_RANGE = 3;
// Jotaro (Star Platinum): diagonálny basic používa vamp trasu (VAMP_SHOT_RANGE, dmg 3/2/1). Special 1
// (v mirror slote) = smerový útok na OBE diagonálne bunky zvolenej strany; Special 2 (po THE WORLD) =
// smerový útok na jedinú susednú bunku. THE WORLD = jednorazový per-hra time-stop (WORLD_COST).
const WORLD_COST     = 5;
const JOTARO_S1_COST = 4;
const JOTARO_S1_DMG  = 4;
const JOTARO_S2_COST = 5;
const JOTARO_S2_DMG  = 8;
const STONE_ACTIONS = 2; // Medúzin special: zasiahnutý súper preskočí najbližšie 2 základné akcie (kameň)
// Minotaurov special (labyrint) nemá číselnú konštantu — trvá, kým jeden hráč nezasiahne druhého (viď endLabyrinths)
const CLONE_DMG = 1; // Narutov klon: koľko pohltí na zdieľanej bunke (jednorazový bait), kým zvyšok strely prejde na Naruta. Útok aj odraz mirrorom dávajú PLNÝ dmg ako Naruto (viď doBasic/doMelee/applyHitOnClone)
const RECHARGE_GAIN = 4;
const SHIELD_COST = 2; // zablokuje celý dmg najbližšej súperovej akcie
const MIRROR_COST = 4; // odrazí celý dmg najbližšej súperovej akcie späť do útočníka
const GOLDEN_COST = 3; // extra akcia hráča, ktorý je v kole druhý — štít vyhodnotený pred prvou akciou startera
const GOLDEN_MIRROR_COST = 5; // ten istý predťah, ale mirror (odraz) namiesto štítu — zlaté vizuály
const DASH_COST   = 4; // presun až o 2 políčka jedným smerom
const GOLDEN_MANA_GAIN = 6; // golden mana refill: +6 many za HP; cena v HP rastie s každým použitím (1, 2, 3…)

// Nové special tiles: POWER (spotrebný) — caster stojaci na ňom v momente vyhodnotenia dmg akcie dostane
// flat +POWER_TILE_BONUS k útoku a tile sa použitím SPOTREBUJE (aj whiff/block — použitie, nie zásah);
// bonus sa NEnásobí Last Stand/maze multiplikátormi (klient ho ukazuje ako samostatný „-2" float).
// BLOCK (permanentný) — figúra na ňom nemôže castnúť shield/mirror: akcia sa prečiarkne BEZ ceny
// (vedomá výnimka z wall pravidla — hráč si na block tile vie „pass-núť" slot zadarmo, platí pozíciou).
const POWER_TILE_BONUS = 2;

// Démon útok — dostupný LEN buffnutému hráčovi v poslednom (Last Stand) kole; zaberá jeden z 3 akčných slotov
const DEMON_COST = 10; // celá mana
const DEMON_DMG  = 10; // zasiahne každé políčko OKREM toho, na ktorom kaster stojí (vyhodnotí sa cez shield/mirror)

// special1 = Jotarov útok v mirror slote (len Jotaro; ostatné postavy ho vo validQueue/fillFromDraft odmietnu)
const ACTION_TYPES = new Set(["move", "recharge", "attack", "melee", "special", "shield", "mirror", "dash", "special1"]);
const MOVE_DIRS = new Set(["up", "down", "left", "right"]);

/* -------------------- Match / lobby config -------------------- */
// koľko vyhratých hier treba na zisk série
// tournament = ako bo5 (first-to-3), ale s prenosom HP magov medzi hrami (3 magovia/hráč)
const MATCH_FORMATS = { single: 1, bo3: 2, tournament: 3 };
const CHARS = ["fire", "lightning", "wanderer", "medusa", "minotaur", "naruto", "escanor", "soldier", "werewolf"];
// tournament: každý hráč si pred hrou 1 naslepo draftne vlastný tím TEAM_SIZE postáv z celého poolu CHARS
// (choose_team vo fáze team_select); tím je fixný na celú sériu a určuje kľúče mageHp/mageMana danej osoby.
const TEAM_SIZE = 3;
// časový limit na ťah — vyhodnocuje a auto-lockuje klient (server lock validuje ako bežný)
const TIMER_OPTIONS = new Set(["off", "30", "60", "120", "quickdraw"]);

// predvolené nastavenia (predvyplnia lobby na klientovi)
const DEFAULT_CONFIG = {
  format: "single",                              // "single" | "bo3" | "tournament"
  tilesPerRound: 1,                              // 1 | 2 | 3 — koľko tiles sa spawne na konci kola
  tileWeights: { dmg: 75, heal: 5, mana: 5, ik: 5, power: 5, block: 5 }, // % šanca typu, spolu 100
  timer: "30",                                   // "off" | "30" | "60" | "120" | "quickdraw"
  tilePreview: true,                             // ukazovať hráčom vopred, kde na konci kola pribudnú tiles / kam sa presunú IK
};

// celkové spomalenie animácií kola (1 = pôvodné tempo); MUSÍ sedieť s client.js ANIM_SLOW
const ANIM_SLOW = 1.8;
const MOVE_DELAY_MS    = Math.round(800 * ANIM_SLOW); // posun postavy + malý buffer
const SMALL_DELAY_MS   = Math.round(600 * ANIM_SLOW);
const ACTION_GAP_MS    = Math.round(350 * ANIM_SLOW); // pokojová pauza medzi jednotlivými akciami, nech sa dá sledovať každý ťah
const SPECIAL_REPEAT   = 3;
const SPECIAL_BEAT_MS  = Math.round(900 * ANIM_SLOW);
// Vojak: special = jeden silný snajperský výstrel — cast frame drží MIERENIE (veľký sprite zamrznutý
// v mieriacej póze, laser sight sa ustáli na cieli) a výšľah (framy 1–3 Shot_2) sa prehrá RAZ na jeho
// konci; až potom letí lúč. MUSÍ sedieť s klientskou choreografiou (SOLDIER_AIM_MS/FIRE v client.js).
const SOLDIER_AIM_MS   = 2600;
// po výstrele letí zo zbrane tenký červený lúč na zvolenú bunku + výbuch;
// jeden frame drží let lúča aj nábeh výbuchu, zásah (hit/block/mirror) padne až po ňom.
// MUSÍ sedieť s klientskou choreografiou spawnSoldierBeam v client.js.
const SOLDIER_BEAM_MS  = 900;
// Vojakov basic granát: zásah (červené políčko + „-HP" float) NEMÁ padnúť pri dolete granátu, ale až keď
// na cieľovej bunke VYBUCHNE a výbuch je vidieť. Klient kreslí výbuch CHARGE_STEP_MS po stiahnutí granátu;
// tento konštantný odklad navyše posunie hit frame tak, aby padol AŽ po nábehu výbuchu (Explosion.png má
// 9 framov @ 12 fps = 750 ms, guľa kulminuje ~⅓ dnu). Reálne ms — výbuchová FX nie je škálovaná ANIM_SLOW.
const SOLDIER_GRENADE_BLAST_MS = 360;
// Escanor special: server podrží zásah o dĺžku klientskej choreografie (WinSun→CruelSunHold→slnko→SunBurst),
// aby dmg dopadol AŽ po dokončení animácie. MUSÍ sedieť s klientskou choreografiou v client.js (runEscanorSpecial).
const ESC_SPECIAL_MS   = 4625;
// Vlkolak special: rozbehový cast (veľký Run+Attack v strede) → beh po doske → Attack_2 seknutie na bunke
// terča → až potom dopadne dmg. Časy musia sedieť s klientskou obsluhou wolf_charge/wolf_strike v client.js
// (seknutie = 4 framy @ 5 fps = 800 ms, hrá raz od frame 0; dmg dopadne tesne po dokončení švihu).
const WOLF_CAST_MS     = Math.round(1200 * ANIM_SLOW);
const WOLF_STRIKE_MS   = Math.round(500 * ANIM_SLOW);
const CHARGE_STEP_MS   = Math.round(240 * ANIM_SLOW); // krok strely za bunku — rýchla strela, aby ani 3-bunkový let nebol pomalší než iné akcie
const MIRROR_BEAM_MS   = 460; // kým beam mirroru doletí k útočníkovi (CSS .mirror-beam ≈ .16+.42s); nezávisí od ANIM_SLOW
// Teleport (výmena maga v turnaji) — dvojfázová animácia: (1) starý mág zmizne, (2) nový sa objaví
const TELEPORT_OUT_MS  = Math.round(650 * ANIM_SLOW);
const TELEPORT_IN_MS   = Math.round(650 * ANIM_SLOW);
// Labyrint: odhalenie PRED zásahom, ktorý ho určite ukončí — skrytý súper sa zjaví (fade ako démon/teleport)
const LAB_REVEAL_MS    = Math.round(700 * ANIM_SLOW);
// Countess melee/pasca choreografia (podľa vampire_attack_guide, A-sheety s krvavými efektmi zapečenými
// vo framoch): úder = A1 (dmg dopadne až po ňom), potom liečivé beaty A2→A3→A4 a až po nich +3 HP —
// jednotné pre charge melee, center melee aj trigger pasce. Onre má pôvodnú choreografiu (Attack_1/vampstrike,
// drain hneď po zásahu). Časy musia pokryť klientske A-animácie (A1 6f @7fps ~857 ms, A4 6f @8fps ~750 ms).
const VAMP_TRAP_STRIKE_MS = Math.round(500 * ANIM_SLOW);
const VAMP_HEAL_BEAT_MS   = Math.round(450 * ANIM_SLOW);
// Countess kladenie pasce: JEDEN dlhý cast frame (nie beaty) — stredová aj malá postava hrajú celé A5
// (17 framov) RAZ od frame 0; dĺžka = 17f @ SPECIAL_FPS 6 v client.js (musí sedieť, inak sa A5 usekne)
const VAMP_CAST_MS = Math.round(17 * 1000 / 6);
// Naruto: summon klona — po pečatiach (special beaty) hrá Naruto + 2 kópie po bokoch Special_2 animáciu
const CLONE_SUMMON_MS  = Math.round(1300 * ANIM_SLOW);
// Jotaro THE WORLD: cast = kým dohrá stredová „menace" animácia Star Platinum (Special_3_P: 4 framy @ 6 fps
// ≈ 667 ms na klientovi) — AŽ POTOM sa zamrazí čas a Jotaro si vyberá (viď enterTimestopMode). MUSÍ byť
// ≥ trvanie klientskej menace (preto fixné, nie škálované ANIM_SLOW). Koniec (obnovenie času) pred aplikáciou.
const TIMESTOP_CAST_MS = 900;
const TIMESTOP_END_MS  = Math.round(900 * ANIM_SLOW);

// Last Stand (duálne tlačidlo s golden mana) — démon zabije hráča a oživí ho na plno; ďalšie kolo je posledné
// Last Stand sa prehráva FRAME-DRIVEN: každá fáza je samostatný frame (timeline prehrávač = jediný zdroj času),
// HP/mana sú v snapshotoch (server-autoritatívne, žiadny lokálny tween), vizuál viaže klient na efekt s trvaním = delayMs.
const LS_APPEAR_MS  = 1000; // démon sa vynorí v strede
const LS_DRAIN_MS   = 1400; // odčerpanie HP/many na 0 (rozdelené na kroky)
const LS_KILL_MS    = 700;  // smrť + démon zmizne zo stredu
const LS_REVIVE_MS  = 700;  // démon sa objaví za postavou (0→1)
const LS_RISE_MS    = 1600; // zlaté dvíhanie HP/many na 10
const LS_SETTLE_MS  = 900;  // démon → 0.25, hráč vstane
const LS_B_LEAVE_MS  = 1500; // banish: duch zosilnie a odíde z postavy
const LS_B_CENTER_MS = 1000; // banish: duch sa objaví v strede
const LS_B_DRAIN_MS  = 1400; // banish: odčerpanie HP/many na 0
const LS_B_KILL_MS   = 700;  // banish: smrť + duch zmizne

// Last Hope — úvodná akcia NEbuffnutého hráča vo final kole (vyhodnotí sa PRED golden shield/mirror).
// Červená „hope" postava: HP padne na 1, mana sa naplní na 10, hráč ide do ultra módu = 4× dmg do konca kola.
const LH_APPEAR_MS = 1000; // hope postava sa vynorí v strede
const LH_DRAIN_MS  = 1400; // HP→1, mana→10
const LH_SETTLE_MS = 900;  // postava zmizne, červený ultra mód zostáva

/* -------------------- Room registry (globálna vrstva) -------------------- */
// Viac nezávislých roomiek naraz. Každá roomka je closure z createRoom(id) s vlastným herným stavom,
// osobami A/B, časovačmi a emitmi (roomEmit). Globálne ostáva len register roomiek + room-browser.
const RECLAIM_GRACE_MS = 60 * 1000;         // koľko sekúnd drží slot pre pôvodného hráča po výpadku
const browsing = new Set();                 // sockety na room-browseri (ešte neposadené v žiadnej roomke, nie diváci)
const rooms = new Map();                    // id -> Room (objekt z createRoom)
let nextRoomId = 1;                         // rastúci identifikátor roomiek
const MAX_ROOMS = 2;                        // cap: max toľko roomiek naraz

// Validácia zobrazovaného mena: 1–8 znakov anglickej abecedy, nič iné (žiadne emoji/diakritika/medzery).
function validateName(raw) {
  if (typeof raw !== "string") return null;
  const n = raw.trim();
  return /^[A-Za-z]{1,8}$/.test(n) ? n : null;
}
function okAdmin(keyFromClient) {
  return !ADMIN_KEY || ADMIN_KEY === keyFromClient;
}

/* ==================== Room factory ==================== */
// Celý herný stav a logika žijú v closure jednej roomky. Funkcie referencujú `game`, `personSockets`,
// `turnTimer`… lexikálne — každá roomka má vlastnú kópiu. Globálne konštanty (HP/mana/CHARS/*_MS…) a
// pure helpery (validateName, okAdmin, rollTileType…) sa čítajú z module scope cez closure.
function createRoom(id) {
  /* -------------------- Game state (per-room) -------------------- */
  // identita hráča je „osoba" A/B (A = prvý pripojený = host); slot p1/p2 je len ľavá/pravá rola,
  // ktorá sa medzi hrami série prehadzuje (štartér danej hry vždy sedí v p1 = vľavo)
  let personSockets = { A: null, B: null };
  // trvalá identita hráča: token z klientovho localStorage → po reconnecte mu vrátime jeho slot
  let personIds = { A: null, B: null };       // token klienta priradený osobe A/B
  let personNames = { A: null, B: null };     // validované zobrazované meno osoby (A–Z, max 8) — verejné, ide do snapshotu
  let personFreedAt = { A: 0, B: 0 };         // kedy sa slot uvoľnil (grace, počas ktorej ho cudzí klient neobsadí)
  let roomDestroyTimer = null;                // po odpojení oboch: po grace roomku zruší
  let pendingMatchConfig = null;              // host stlačil START, ale 2. hráč ešte nie je → čaká sa; po jeho príchode sa spustí
  let game = null;
  const spectators = new Set();               // diváci tejto roomky (dostávajú nemaskovaný stav cez roomEmit)

  // per-room emit: nahrádza io.emit — pošle len hráčom A/B a divákom TEJTO roomky (nie cudzím)
  function roomEmit(ev, payload) {
    for (const p of ["A", "B"]) { const s = personSockets[p]; if (s) { try { s.emit(ev, payload); } catch {} } }
    for (const s of spectators) { try { s.emit(ev, payload); } catch {} }
  }

function newPlayer(slot) {
  const pos = START_POS[slot];
  return {
    slot,
    x: pos.x, y: pos.y,
    hp: START_HP,
    mana: START_MANA,
    char: null,        // "fire" | "lightning" | "wanderer" | "medusa" | "minotaur" | "naruto" | "escanor" | "soldier" | "werewolf"
    stone: 0,          // koľko najbližších základných akcií hráč preskočí skamenený (Medúzin special)
    // Escanor: „pride level" 0–3. Rozsah smerového specialu rastie s levelom (0=1 bunka, 3=celá plocha).
    // Na konci kola: použil shield/mirror (aj golden) ALEBO dostal zásah? → −1, inak → +1 (clamp 0–3).
    // Reset na 0 pri nasadení.
    pride: 0,
    // Escanor: v tomto kole mu súper zobral HP (akcia/odraz — NIE tile/IK, NIE petrify/banish).
    // Nastavuje notePrideHit() na miestach dopadu, spotrebuje a vynuluje koniec kola v resolveTurn.
    prideHit: false,
    // Vlkolak: „fáza mesiaca" 0–3 (nov → spln) = dmg jeho charge specialu (WOLF_MOON_DMG). Odvodená z HP
    // (moonLevelFor) — prepočíta sa na KONCI každého kola a pri nasadení/swape. Verejná (veľkosť postavy je tell).
    moon: 0,
    // Narutov tieňový klon: { x, y } alebo null. Kopíruje všetky základné akcie majiteľa (vertikálny pohyb
    // inverzne), spôsobuje vždy len CLONE_DMG, zmizne pri akomkoľvek zásahu (obrany zdieľa s majiteľom —
    // armujú sa aj spotrebúvajú spolu, sú to tie isté shield/mirror flagy)
    clone: null,
    // Countess/Onre: pasca { x, y } | null. Značku vidí LEN caster (súperovi sa trap aj trap_set
    // redigujú); trigger = súperov vstup/prechod PO dokončení jeho akcie (teleport castera + melee).
    trap: null,
    // Jotaro: použil už THE WORLD v TEJTO hre? Po ňom sa special button natrvalo mení na Special 2.
    // Prežíva swap (per-hra jednorazovosť), nová hra = čerstvý newPlayer = false.
    worldUsed: false,
    // Luffy: mód "base" | "gear3". Prepína ho recharge (Luffyho glitch akcia — doplní manu A prepne mód,
    // vždy, aj pri plnej mane). Gear3 = väčší na doske (tell), iný basic (naťahovacia ruka + pull súpera).
    // Prežíva medzi kolami; reset na "base" pri voľbe postavy a na štarte hry.
    form: "base",
    labyrinth: false,  // blúdi v labyrinte (Minotaurov special) — nevidí board, kým nepadne vzájomný zásah
    mazeBuff: false,   // hráč ÚSPEŠNE zaklial súpera do labyrintu (len priamym castom, nie cez odraz) → 2× výstupný
                       // dmg, kým labyrint trvá. Cielené na toho, kto hrá Minotaura. (tile dmg/IK dostáva normálne)
    labReveal: false,  // labyrint sa v tomto ťahu isto skončí zásahom — redakcia/hmla padli už PRED animáciou akcie
    thread: [],        // Ariadnina niť: [x,y] políčka, na ktoré prekliaty vstúpil (prvé = kde stál pri zakliatí)
    threadMark: null,  // [x,y] posledného súperovho vstupu na niť — prekliaty tam vidí jeho obrys
    shield: false,     // zruší celý dmg najbližšej súperovej akcie
    shieldGold: false, // aktívny shield pochádza z golden shieldu (zlaté vizuály)
    mirror: false,     // odrazí celý dmg najbližšej súperovej akcie späť do útočníka
    mirrorGold: false, // aktívny mirror pochádza z golden mirroru (zlaté vizuály)
    golden: false,     // objednaný golden shield (extra akcia pred začiatkom kola)
    goldenMirror: false, // objednaný golden mirror (rovnaký predťah, ale odraz namiesto štítu)
    goldenMana: false, // objednaný golden mana refill (extra akcia po konci kola)
    manaRefills: 0,    // koľkokrát už hráč refill použil — určuje rastúcu HP cenu
    lastStand: false,     // objednaný last stand (trailing gold akcia, výlučná s golden_mana)
    lastStandBuff: false, // aktívne v poslednom (buffnutom) kole: 2× výstupný dmg, floor(½) prijatý dmg
    lastStandDoom: false, // v tomto poslednom kole musí vyhrať, inak na jeho konci zomrie
    down: false,          // leží „mŕtvy" počas Last Stand choreografie (smrť→oživenie) — klient kreslí dead pózu
    lastHope: false,      // objednaný Last Hope (úvodná akcia nebuffnutého hráča vo final kole)
    lastHopeBuff: false,  // aktívny Last Hope ultra mód v poslednom kole: 4× výstupný dmg, floor(½) prijatý dmg
    locked: false,
    queue: [],
    // priebežne posielaná rozpracovaná voľba — pri vypršaní času ju backstop zachová a doplní len chýbajúce
    draft: { queue: [], golden: false, goldenMirror: false, goldenMana: false, lastStand: false, lastHope: false }
  };
}

function newGame() {
  game = {
    phase: "lobby",   // "lobby" | "team_select" | "playing" | "match_over"
    config: null,     // nastaví host cez configure_match
    board: { ...BOARD },
    players: {
      p1: newPlayer("p1"),
      p2: newPlayer("p2")
    },
    arena: "bridge",
    turn: 1,
    starter: "p1", // slot, ktorý začína aktuálne kolo; hru 1 otvára p1 (biely), v sérii sa štartér hier strieda, medzi kolami sa preklápa
    tiles: [],     // { x, y, type: "dmg" | "heal" | "mana" | "power" | "block" } — pribúdajú od konca 1. kola
    iks: [],       // [{ x, y }] — insta-kill tiles; viac súčasne, každé kolo menia pozíciu, navzájom sa neprekrývajú
    pending: null, // { ikMoves: [{x,y}…], spawns: [{x,y,type}…] } — VOPRED vyžrebované zmeny tiles na koniec AKTUÁLNEHO kola (preview pre hráčov)
    // séria zápasov
    seats: { p1: "A", p2: "B" }, // kto sedí na ktorom slote — LOSUJE sa v startMatch (p1 = biely, začína); fixné na celú sériu
    seriesWins: { A: 0, B: 0 },
    series: { gameIndex: 1, needed: 1, format: "single" },
    // tournament: draftnutý tím TEAM_SIZE postáv per osoba (fáza team_select; null mimo tournamentu,
    // pole null kým daná osoba nepotvrdí) — kľúče mageHp/mageMana a poradie HUD hláv
    roster: null,     // { A: [char×3] | null, B: [char×3] | null }
    // tournament: HP a mana každého z 3 magov per osoba sa prenášajú medzi hrami (null mimo tournamentu)
    mageHp: null,
    mageMana: null,
    // rezumovateľné kolo (Jotarov THE WORLD): kontext prebiehajúceho resolveTurn / stav time-stop pauzy
    roundCtx: null,
    timestop: null,
  };
}
newGame();

function otherPerson(p) { return p === "A" ? "B" : "A"; }
function slotForPerson(person) { return game.seats.p1 === person ? "p1" : "p2"; }
function socketForSlot(slot) { return personSockets[game.seats[slot]]; }
// draftnutý tím osoby sediacej na slote (prázdny mimo turnaja / pred potvrdením)
function rosterFor(slot) { return game.roster?.[game.seats[slot]] || []; }

// séria zhrnutá pre klienta — výhry namapované na aktuálne sloty (osoba si nesie skóre na svoju stranu)
function seriesSnapshot() {
  return {
    gameIndex: game.series.gameIndex,
    needed: game.series.needed,
    format: game.series.format,
    winsP1: game.seriesWins[game.seats.p1] || 0,
    winsP2: game.seriesWins[game.seats.p2] || 0,
  };
}

// pošli každej osobe jej slot (vylosovaný v startMatch, fixný na celú sériu) + či je host (host = osoba A)
function emitYouAre() {
  for (const person of ["A", "B"]) {
    const sock = personSockets[person];
    if (sock) sock.emit("you_are", { slot: slotForPerson(person), isHost: person === "A" });
  }
}

// snapshot pre konkrétnu OSOBU — počas výberu postáv skry súperovu voľbu, kým si TÁTO osoba nevyberie
// (inak rozmýšľajúci hráč vidí súperov pick a má výhodu). Po výbere oboch je stav už odhalený.
// Labyrint (Minotaurov special): prekliata osoba nedostane súperovu pozíciu/obrany ani tiles ANI V DÁTACH
// (anti-cheat — klientská hmla by sa dala obísť cez devtools).
function snapshotFor(person) {
  let base = snapshot();
  // tournament: pridaj LEN vlastnú trojicu HP a many magov (súperove hodnoty hráč nevidí)
  base.mageHp = game.mageHp ? { ...game.mageHp[person] } : null;
  base.mageMana = game.mageMana ? { ...game.mageMana[person] } : null;
  const mySlot = slotForPerson(person);
  const oppSlot = mySlot === "p1" ? "p2" : "p1";
  // slepý draft: súperov tím vidím, až keď potvrdia obaja (fáza sa vtedy prepne na playing);
  // rosterReady ostáva verejné — klient z neho ukazuje „opponent is picking / ready"
  if (game.phase === "team_select" && base.roster) {
    base = { ...base, roster: { ...base.roster, [oppSlot]: null } };
  }
  if (!game.players[mySlot]?.char && base[oppSlot]?.char) {
    base = { ...base, [oppSlot]: { ...base[oppSlot], char: null } };
  }
  // pasca (Countess/Onre): značku vidí LEN caster — zo súperovho actora ju strhni v KAŽDOM snapshote
  if (base[oppSlot]?.trap) base = { ...base, [oppSlot]: { ...base[oppSlot], trap: null } };
  if (base[mySlot]?.labyrinth && !base[mySlot].labReveal) base = redactRosterMana(oppSlot, redactSnapshotFor(mySlot, base));
  else if (base[oppSlot]?.labyrinth && !base[oppSlot].labReveal) base = redactRosterMana(oppSlot, { ...base, [oppSlot]: redactHunterActor(base[oppSlot]) });
  return base;
}

/* ---- Labyrint: redakcia dát pre OBE strany ---- */
// prekliaty nevidí súperovu pozíciu, obrany ani MANU (nemá prehľad, kedy Minotaur dosiahne na special/melee);
// niť/obrys súpera (mirror match dvoch Minotaurov) tiež skry. HP ostáva — zásah labyrint aj tak končí.
function redactActor(a) {
  if (!a) return a;
  // clone: prekliaty nesmie vidieť ani súperovho tieňového klona (pozícia = informácia o lovcovi)
  return { ...a, x: null, y: null, mana: null, shield: false, shieldGold: false, mirror: false, mirrorGold: false, thread: [], threadMark: null, clone: null };
}
// LOVEC (Minotaur) zas nevidí Ariadninu niť ani obrys (nemôže sa jej cielene vyhýbať — šliapne na ňu
// nevedomky) a nevidí ani manu prekliateho — počas labyrintu ani jeden nemá prehľad o mane súpera
function redactHunterActor(a) {
  if (!a) return a;
  return { ...a, mana: null, thread: [], threadMark: null };
}
// prekliaty vidí len Damage a Block dlaždice + IK (IK/`iks` sa neredigujú vôbec) — hazardy, ktoré sa ho
// priamo týkajú; heal/mana/POWER dlaždice (výhody-pickupy) LEN keď na nich priamo stojí ALEBO na nich stojí
// jeho tieňový klon — klon je druhá fakľa a osvetľuje svoju bunku rovnako ako hráč (inak by mu prezradili,
// kde sú pickupy). IK vždy (sú to overlaye v `iks`, mimo `tiles`).
function redactTilesFor(mySlot, snap) {
  if (!Array.isArray(snap.tiles)) return snap;
  const me = snap[mySlot];
  const onTorchCell = (t) => me && ((me.x != null && t.x === me.x && t.y === me.y)
    || (me.clone && t.x === me.clone.x && t.y === me.clone.y));
  const alwaysVisible = (type) => type === "dmg" || type === "block";
  const out = { ...snap, tiles: snap.tiles.filter(t => alwaysVisible(t.type) || onTorchCell(t)) };
  // preview (config.tilePreview) sa rediguje ROVNAKO ako existujúce tiles: dmg/block/IK spawny a ciele presunu IK
  // prekliaty vidí vždy, heal/mana/power spawn len keď na tej bunke priamo stojí on alebo jeho tieňový klon
  if (out.pending) {
    out.pending = { ...out.pending, spawns: out.pending.spawns.filter(s => alwaysVisible(s.type) || s.type === "ik" || onTorchCell(s)) };
  }
  return out;
}
// lovec (alebo jeho tieňový klon) PRÁVE stojí na niektorej „fakľovej" bunke prekliateho — na jeho vlastnej
// ALEBO na bunke jeho tieňového klona (klon = druhá fakľa; lovec nevie, ktorá figúra je pravá, takže obe
// bunky sa správajú identicky). Vracia zoznam buniek lovcových figúr stojacich na fakľových bunkách
// ([[x,y],…], max 2 — lovec + jeho klon; duplicitná bunka = obe lovcove figúry na tej istej bunke), inak null.
// Počíta sa čerstvo z každého snapshotu/framu, takže po odchode lovca hneď zhasne (žiadny „stale" obrys).
function hunterLitCells(me, opp) {
  if (!me || !opp || me.x == null) return null;
  const torch = [[me.x, me.y]];
  if (me.clone) torch.push([me.clone.x, me.clone.y]);
  const onTorch = (x, y) => x != null && torch.some(([tx, ty]) => tx === x && ty === y);
  const out = [];
  if (onTorch(opp.x, opp.y)) out.push([opp.x, opp.y]);
  if (opp.clone && onTorch(opp.clone.x, opp.clone.y)) out.push([opp.clone.x, opp.clone.y]);
  return out.length ? out : null;
}
function redactSnapshotFor(mySlot, snap) {
  const oppSlot = mySlot === "p1" ? "p2" : "p1";
  const me = snap[mySlot], opp = snap[oppSlot];
  const hunterHere = hunterLitCells(me, opp);
  return redactTilesFor(mySlot, { ...snap, [mySlot]: { ...me, hunterHere }, [oppSlot]: redactActor(opp) });
}
// tournament × labyrint: počas kliatby nevidí ANI JEDNA strana manu súperovho tímu — roster nesie
// uložené hodnoty magov (lavička + posledný uložený stav nasadeného), rediguje sa obojsmerne ako živá mana
function redactRosterMana(oppSlot, snap) {
  if (!snap.rosterMana) return snap;
  return { ...snap, rosterMana: { ...snap.rosterMana, [oppSlot]: null } };
}
// efekt vo frame, v ktorom je príjemca prekliaty: súperove akcie sa maskujú na "unknown" (beat kvôli
// pozícii v lište), všetko ostatné od/na súpera aj cudzie tile efekty sa zahodia — úplná tma
function redactEffect(mySlot, oppSlot, e, frame) {
  if (!e) return null;
  if (e.kind === "action" && e.from === oppSlot) {
    const t = e.action?.type;
    const beat = (t === "golden_shield" || t === "golden_mirror") ? "gpre"
               : (t === "golden_mana" || t === "last_stand") ? "gmana"
               : (t === "last_hope") ? "lhope" : "act";
    return { kind: "action", from: oppSlot, action: { type: "unknown", dir: null, to: null, beat } };
  }
  if (e.from === oppSlot && e.kind !== "beat_empty") return null; // charge/special/melee/recharge/gold/demon… prezrádzajú pozíciu alebo úmysel
  if (e.target === oppSlot) return null;                          // hit/heal/invalid na súperovi (napr. tile dmg) = pozícia
  if (e.kind === "tile_proc") {
    // tiles samotné prekliaty vidí, ale PROC blik cudzej bunky = súper na nej stojí → len vlastná bunka
    const p = frame[mySlot];
    if (!p || !Array.isArray(e.cell) || e.cell[0] !== p.x || e.cell[1] !== p.y) return null;
  }
  return e;
}
// timeline pre daný slot: framy, v ktorých je príjemca v labyrinte, dostanú redigovaný snapshot aj efekty;
// framy, v ktorých je v labyrinte SÚPER, skryjú príjemcovi (lovcovi) niť/obrys/manu + thread_mark efekty.
// Frame, v ktorom labyrint končí (labyrinth=false), už redigovaný nie je → odhalenie sa prehrá prirodzene.
// labReveal (istý zásah v tomto ťahu): redakcia padá už od reveal frame-u — akcia sa odohrá odhalená.
// pasca (Countess/Onre) v timeline framoch: súperov trap + jeho trap_set efekt sa príjemcovi maskujú
// VŽDY (nielen v labyrinte) — trigger/deštrukcia (trap_trigger/trap_break) ostávajú viditeľné obom
function maskTrapFrame(oppSlot, f) {
  let out = f;
  if (out?.[oppSlot]?.trap) out = { ...out, [oppSlot]: { ...out[oppSlot], trap: null } };
  if ((out.effects || []).some(e => e?.kind === "trap_set" && e.from === oppSlot)) {
    out = { ...out, effects: out.effects.filter(e => !(e?.kind === "trap_set" && e.from === oppSlot)) };
  }
  return out;
}
function redactTimelineFor(mySlot, tl) {
  const oppSlot = mySlot === "p1" ? "p2" : "p1";
  return tl.map(f0 => {
    const f = maskTrapFrame(oppSlot, f0);
    if (f?.[mySlot]?.labyrinth && !f[mySlot].labReveal) {
      // hunterHere sa musí počítať aj pre každý FRAME timeline (nielen root snapshot) — inak keď prekliaty
      // POČAS kola vstúpi na lovcovu bunku, frame ho nenesie a klient ukáže čierny tieň namiesto ožiareného lovca
      const hunterHere = hunterLitCells(f[mySlot], f[oppSlot]);
      return redactRosterMana(oppSlot, redactTilesFor(mySlot, {
        ...f,
        [mySlot]: { ...f[mySlot], hunterHere },
        [oppSlot]: redactActor(f[oppSlot]),
        effects: (f.effects || []).map(e => redactEffect(mySlot, oppSlot, e, f)).filter(Boolean),
      }));
    }
    if (f?.[oppSlot]?.labyrinth && !f[oppSlot].labReveal) {
      return redactRosterMana(oppSlot, {
        ...f,
        [oppSlot]: redactHunterActor(f[oppSlot]),
        effects: (f.effects || []).filter(e => !(e.kind === "thread_mark" && e.target === oppSlot)),
      });
    }
    return f;
  });
}

// pošli stav (voliteľne s timeline) obom osobám, každej s vlastným maskovaním (char-select pick,
// labyrint redakcia, vlastná trojica HP magov); divákom (ostatné sockety) neutrálny plný snapshot
function emitStateMasked(timeline = null) {
  const plain = snapshot();
  // hráči A/B tejto roomky — maskovaný snapshot (labyrint/klon/pasca redakcia per osoba)
  for (const person of ["A", "B"]) {
    const sock = personSockets[person];
    if (!sock) continue;
    let payload = snapshotFor(person);
    if (timeline) payload = { ...payload, timeline: redactTimelineFor(slotForPerson(person), timeline) };
    sock.emit("state", payload);
  }
  // diváci tejto roomky — nemaskovaný stav
  const specPayload = timeline ? { ...plain, timeline } : plain;
  for (const s of spectators) { try { s.emit("state", specPayload); } catch {} }
}

/* -------------------- Helpers -------------------- */
function cloneActor(a) {
  if (!a) return null;
  const { slot, x, y, hp, mana, char, stone, pride, moon, worldUsed, form, labyrinth, labReveal, shield, shieldGold, mirror, mirrorGold, manaRefills, lastStandBuff, lastHopeBuff, down, locked } = a;
  // niť treba hlboko kopírovať — server do nej pushuje, plytká referencia by menila už uložené timeline framy
  const thread = (a.thread || []).map(c => [...c]);
  const threadMark = a.threadMark ? [...a.threadMark] : null;
  const clone = a.clone ? { ...a.clone } : null; // Narutov tieňový klon (pozícia)
  const trap = a.trap ? { ...a.trap } : null;    // pasca Countess/Onre (súperovi ju maskuje snapshotFor/redactTimelineFor)
  return { slot, x, y, hp, mana, char, stone, pride, moon, worldUsed, form, labyrinth, labReveal, thread, threadMark, clone, trap, shield, shieldGold, mirror, mirrorGold, manaRefills, lastStandBuff, lastHopeBuff, down, locked };
}
function snapshot() {
  return {
    phase: game.phase,
    config: game.config ? { ...game.config, tileWeights: { ...game.config.tileWeights } } : null,
    series: seriesSnapshot(),
    // zobrazované mená hráčov per slot (verejné — netreba redigovať; labyrint mená nemaskuje)
    names: { p1: personNames[game.seats.p1] || null, p2: personNames[game.seats.p2] || null },
    // host stlačil START, no 2. hráč ešte nie je → klient hosta ukáže „čakám na druhého hráča"
    awaitingOpponent: pendingMatchConfig != null,
    // Jotaro THE WORLD: kým čaká na 3 zmrazené akcie, klient (obaja) vie prepnúť UI mód (neutrálne — len slot)
    timestop: (game.timestop && game.timestop.mode === "waiting") ? { slot: game.timestop.slot } : null,
    board: { ...game.board },
    p1: cloneActor(game.players.p1),
    p2: cloneActor(game.players.p2),
    arena: game.arena,
    turn: game.turn,
    starter: game.starter,
    timerMs: timerRemainingMs(), // zostávajúci čas na ťah (null = bez limitu) — klient sa naň synchronizuje aj po refreshi
    // duálny gold button (golden mana + last stand) je v poslednom (buffnutom) kole zamknutý pre oboch
    goldLocked: !!(game.players.p1.lastStandBuff || game.players.p2.lastStandBuff),
    tiles: game.tiles.map(t => ({ ...t })),
    iks: game.iks.map(t => ({ ...t })),
    // preview zmien tiles na konci kola (len ak je zapnutý config.tilePreview) — verejná, symetrická informácia;
    // heal/mana spawny počas labyrintu rediguje redactTilesFor rovnako ako existujúce tiles
    pending: (game.config?.tilePreview && game.pending) ? {
      ikMoves: game.pending.ikMoves.map(c => ({ ...c })),
      spawns: game.pending.spawns.map(s => ({ ...s })),
    } : null,
    // tournament: draftnuté tímy per slot — po skončení draftu VEREJNÉ (HUD hlavy oboch strán, poradie
    // = poradie výberu); počas fázy team_select snapshotFor súperov tím maskuje (slepý draft).
    roster: game.roster ? {
      p1: game.roster[game.seats.p1] ? [...game.roster[game.seats.p1]] : null,
      p2: game.roster[game.seats.p2] ? [...game.roster[game.seats.p2]] : null,
    } : null,
    // kto už potvrdil tím (verejné aj počas draftu — „súper vyberá / je pripravený")
    rosterReady: game.roster ? {
      p1: !!game.roster[game.seats.p1], p2: !!game.roster[game.seats.p2],
    } : null,
    // tournament: mŕtvi magovia (HP 0) per slot — pre HUD hlavy (mŕtvy = lebka); historické info (= počet prehier),
    // nie tajná voľba, preto ide obom stranám aj v bežnom snapshote
    // pre PRÁVE NASADENÉHO maga ber ŽIVÉ hp z game.players (do game.mageHp sa zapíše až v handleGameEnd,
    // ktorý beží AŽ PO emite finálneho stavu) — inak by mág padnutý v poslednom kole série nemal lebku
    // (turnaj by skončil s 2 lebkami namiesto 3)
    mageDead: game.mageHp ? {
      p1: rosterFor("p1").filter(k => (game.players.p1?.char === k ? game.players.p1.hp : (game.mageHp[game.seats.p1]?.[k] ?? 1)) <= 0),
      p2: rosterFor("p2").filter(k => (game.players.p2?.char === k ? game.players.p2.hp : (game.mageHp[game.seats.p2]?.[k] ?? 1)) <= 0),
    } : null,
    // tournament: prenesené HP a mana všetkých 3 magov per slot — VEREJNÉ (vidí ich aj súper) pre HUD hlavy.
    // Pozn.: pre práve nasadeného maga je tu uložená (nie živá) hodnota — klient pri ňom berie živé hp/mana z p1/p2.
    rosterHp: game.mageHp ? {
      p1: { ...game.mageHp[game.seats.p1] }, p2: { ...game.mageHp[game.seats.p2] }
    } : null,
    rosterMana: game.mageMana ? {
      p1: { ...game.mageMana[game.seats.p1] }, p2: { ...game.mageMana[game.seats.p2] }
    } : null
  };
}

function inBounds(x, y, board = game.board) {
  return x >= 0 && y >= 0 && x < board.w && y < board.h;
}

function pushStateFrame(timeline, effects = [], delayMs = SMALL_DELAY_MS) {
  const snap = snapshot();
  timeline.push({ ...snap, effects, delayMs });
}

function pushInvalid(tl, who, ms = SMALL_DELAY_MS, reason = null) {
  pushStateFrame(tl, [{ kind: "invalid", target: who, reason }], ms);
}

function other(slot) { return slot === "p1" ? "p2" : "p1"; }

function isDiagAdjacent(a, b) {
  return Math.abs(a.x - b.x) === 1 && Math.abs(a.y - b.y) === 1;
}
// Medúzin special: vlastné políčko + VŠETKY políčka striktne vo zvolenom smere (left/right)
// v jej riadku a v riadkoch bezprostredne susedných (±1) — zo stredného radu tak pokryje všetky 3 riadky.
// Musí sedieť s cellsForSpecialPreview v client.js (udržiavané paralelne).
function medusaCells(me, dir) {
  const sgn = dir === "left" ? -1 : 1;
  const cells = [[me.x, me.y]];
  for (let y = me.y - 1; y <= me.y + 1; y++) {
    if (y < 0 || y >= game.board.h) continue;
    for (let x = me.x + sgn; x >= 0 && x < game.board.w; x += sgn) cells.push([x, y]);
  }
  return cells;
}
// Fire Wizard stojí na Damage dlaždici? Vtedy sa jeho special rozšíri o riadky ±1
// (dlaždice sú trvalé a vznikli v predošlých kolách, takže existujú v čase resolveTurn).
function fireOnDmgTile(me) {
  return !!me && me.char === "fire" &&
    game.tiles.some(t => t.type === "dmg" && t.x === me.x && t.y === me.y);
}
function specialDamageAndHit(players, slot) {
  const me   = players[slot];
  const foeS = slot === "p1" ? "p2" : "p1";
  const foe  = players[foeS];
  if (!me || !foe) return { dmg:0, hit:null };

  switch (me.char) {
    case "fire":      // celý riadok; na Damage dlaždici sa rozšíri o riadky ±1 (zo stredného = celá doska)
      { const hitZone = fireOnDmgTile(me) ? Math.abs(me.y - foe.y) <= 1 : me.y === foe.y;
        return hitZone ? { dmg:5, hit:foeS } : { dmg:0, hit:null }; }
    case "lightning": // všetky políčka opačnej "šachovej" farby než na ktorej stojí
      return ((me.x + me.y) % 2) !== ((foe.x + foe.y) % 2) ? { dmg:3, hit:foeS } : { dmg:0, hit:null };
    case "wanderer":  // len diagonála 1
      return isDiagAdjacent(me, foe) ? { dmg:8, hit:foeS } : { dmg:0, hit:null };
    default:
      return { dmg:0, hit:null };
  }
}
// je pozícia [x,y] v zóne specialu daného castera? (len dmg speciály — na test zásahu KLONA;
// musí sedieť so specialDamageAndHit aj s cellsForSpecialPreview v client.js)
function specialZoneHas(me, x, y) {
  switch (me.char) {
    case "fire":      return fireOnDmgTile(me) ? Math.abs(me.y - y) <= 1 : y === me.y;
    case "lightning": return ((me.x + me.y) % 2) !== ((x + y) % 2);
    case "wanderer":  return Math.abs(me.x - x) === 1 && Math.abs(me.y - y) === 1;
    default:          return false;
  }
}
// raw dmg zóny (kvôli odrazu pri zásahu klona); soldier = snajperský lúč na jednu zvolenú bunku
// (jeho „zónu" nesie akcia — cell — preto nemá vetvu v specialZoneHas, klona testuje vlastná vetva doSpecial)
const SPECIAL_ZONE_DMG = { fire: 5, lightning: 3, wanderer: 8, escanor: 8, soldier: SOLDIER_SPECIAL_DMG };

// Escanor: zóna smerového specialu podľa pride levelu. dir = "left" | "right" (ako Medúza).
// F = bunka pred Escanorom v danom smere; 0=F, 1=F+diagonály, 2=F+3×3 okolie, 3=celá plocha.
// MUSÍ sedieť s cellsForSpecialPreview v client.js (paralelne udržiavané).
function escanorCells(me, dir) {
  const W = game.board.w, H = game.board.h;
  const inb = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  const out = [];
  const add = (x, y) => { if (inb(x, y) && !out.some(c => c[0] === x && c[1] === y)) out.push([x, y]); };
  const pride = Math.max(0, Math.min(3, me.pride || 0));
  const fx = me.x + (dir === "left" ? -1 : 1), fy = me.y;
  // kotva F mimo dosky = slnko hodené DO AUTU — žiadna zóna, ANI pri pride 3 (celý hod letí von z plochy);
  // doSpecial z prázdnej zóny robí offboard whiff (mana preč, OUT OF BOUNDS, neprečiarkuje sa — ako útok do steny)
  if (fx < 0 || fx >= W) return out;
  if (pride >= 3) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) add(x, y); return out; }
  add(fx, fy);                                                        // pride 0
  if (pride === 1) { add(fx - 1, fy - 1); add(fx + 1, fy - 1); add(fx - 1, fy + 1); add(fx + 1, fy + 1); }
  if (pride === 2) for (let yy = fy - 1; yy <= fy + 1; yy++) for (let xx = fx - 1; xx <= fx + 1; xx++) add(xx, yy);
  return out;
}

// Jotaro Special 1 (v mirror slote): smerový (left/right) — OBE diagonálne bunky zvolenej strany
// (x±1, y−1) a (x±1, y+1). Rovná bunka (x±1, y) NIE. Na kraji dosky len bunky v ploche (môže byť prázdna).
// Jotaro Special 2 (po THE WORLD): jediná susedná bunka (x±1, y). Obe MUSIA sedieť s cellsForSpecialPreview.
function jotaroS1Cells(me, dir) {
  const dx = dir === "left" ? -1 : 1;
  const out = [];
  for (const dy of [-1, 1]) if (inBounds(me.x + dx, me.y + dy)) out.push([me.x + dx, me.y + dy]);
  return out;
}
function jotaroS2Cells(me, dir) {
  const dx = dir === "left" ? -1 : 1;
  return inBounds(me.x + dx, me.y) ? [[me.x + dx, me.y]] : [];
}

/* ---- Narutov tieňový klon ---- */
// Klon nemá HP — zmizne pri akomkoľvek zásahu od súpera (dmg aj status speciály), pri IK tile,
// pri recaste specialu, smrti/swape majiteľa a na konci hry. Zásah NA klona labyrint NEODHALÍ
// ani NEUKONČÍ (súper sa nesmie dozvedieť, že trafil klona); zásah spôsobený klonom je bežný
// action hit (ide cez applyHit) a labyrint ukončí.
function killClone(slot, tl, ms = SMALL_DELAY_MS) {
  const p = game.players[slot];
  if (!p?.clone) return;
  const at = [p.clone.x, p.clone.y];
  // die frame ešte s klonom v snapshote (klient cezeň prehrá rozplynutie), až potom zmizne zo stavu
  pushStateFrame(tl, [{ kind: "clone_die", target: slot, cell: at }], ms);
  p.clone = null;
}
// zásah (dmg akcia) na klona cez obrany MAJITEĽA (zdieľané flagy): shield BLOKUJE, mirror ODRAZÍ — a to na
// OBOCH figúrach samostatne (z ich vlastných buniek). Zdieľaný štít sa pri zásahu na klonovi rozbije/blokne
// aj na klonovej bunke (nielen na Narutovi), mirror odrazí z klona PLNÝ prijatý dmg (ako Narutov mirror).
// (quietDefense param ostáva kvôli podpisu volaní, ale už sa nepoužíva — obrana sa ukáže na oboch.)
function applyHitOnClone(ownerSlot, rawDmg, tl, kind = "basic", quietDefense = false) {
  const o = game.players[ownerSlot];
  if (!o?.clone) return;
  // THE WORLD: zmrazený zásah na klona (decoy) — odlož clone_die na obnovenie času (žiadny okamžitý dmg/poof)
  if (frozenActive()) { noteFrozenClone(ownerSlot); return; }
  if (o.shield) {
    // block aj na klonovej bunke — zdieľaný štít sa rozbije na oboch figúrach
    pushStateFrame(tl, [{ kind: "block", target: ownerSlot, cell: [o.clone.x, o.clone.y], gold: !!o.shieldGold }], SMALL_DELAY_MS);
    return; // štít pokryje aj klona (bez dmg), klon prežije
  }
  if (o.mirror) {
    // mirror imunita Countess/Onre — aj klonov mirror sa voči nim správa ako štít (blok z klonovej bunky)
    if (mirrorImmune(other(ownerSlot))) {
      pushStateFrame(tl, [{ kind: "block", target: ownerSlot, cell: [o.clone.x, o.clone.y], gold: !!o.mirrorGold }], SMALL_DELAY_MS);
      return; // klon prežije, nič sa neodráža
    }
    const atkSlot = other(ownerSlot);
    const atk = game.players[atkSlot];
    const reflectRaw = rawDmg; // klonov mirror odrazí PLNÝ prijatý dmg (rovnako ako Narutov mirror), nie flat 1
    const d = recvDmg(atkSlot, reflectRaw);
    // samostatný odraz z KLONOVEJ bunky (cell) — nie z pravého Naruta (inak prezradí skutočného)
    pushStateFrame(tl, [{ kind: "mirror", target: ownerSlot, cell: [o.clone.x, o.clone.y], dmg: reflectRaw, atk: kind, gold: !!o.mirrorGold }], MIRROR_BEAM_MS);
    atk.hp = Math.max(0, atk.hp - d);
    notePrideHit(atkSlot); // odraz z klonovho mirroru je tiež zásah od súpera
    pushStateFrame(tl, [{ kind: "hit", target: atkSlot, dmg: d }], SMALL_DELAY_MS);
    endLabyrinths(tl); // odrazený dmg dopadol na REÁLNEHO hráča — to labyrint ukončuje
    return; // mirror ochránil klona (prežije)
  }
  killClone(ownerSlot, tl);
}
// status special (petrify/labyrint) na klona cez obrany majiteľa — analógia applyHitOnClone:
// shield blokuje, mirror odrazí STATUS na castera (ako applyPetrify/applyLabyrinth). Bez obrany:
// PETRIFY klona ZABIJE (zásah kliatby ho rozplynie ako každý iný zásah), LABYRINT nie — kliatba bludiska
// sa týka len skutočného Naruta (prekliaty si klona nesie do labyrintu so sebou).
function applyStatusOnClone(ownerSlot, tl, statusKind, quietDefense = false) {
  const o = game.players[ownerSlot];
  if (!o?.clone) return;
  if (o.shield) {
    if (!quietDefense) pushStateFrame(tl, [{ kind: "block", target: ownerSlot, cell: [o.clone.x, o.clone.y], gold: !!o.shieldGold }], SMALL_DELAY_MS);
    return;
  }
  if (o.mirror) {
    if (quietDefense) return;
    const atkSlot = other(ownerSlot);
    pushStateFrame(tl, [{ kind: "mirror", target: ownerSlot, dmg: 0, atk: "special", gold: !!o.mirrorGold }], MIRROR_BEAM_MS);
    if (statusKind === "petrify") { petrify(atkSlot, tl); endLabyrinths(tl); }
    else { endLabyrinths(tl); loseInLabyrinth(atkSlot, tl); }
    return;
  }
  // bez obrany: petrify klona rozplynie; labyrint klona nechá žiť (kliatba len na skutočného Naruta)
  if (statusKind === "petrify") killClone(ownerSlot, tl);
}
// klon kopíruje pohyb majiteľa: horizontálne rovnako, VERTIKÁLNE INVERZNE (up<->down); kroky mimo boardu prepadnú
function moveCloneSteps(slot, delta, maxSteps) {
  const p = game.players[slot];
  if (!p?.clone) return [];
  const d = [delta[0], -delta[1]];
  const path = [];
  for (let s = 0; s < maxSteps; s++) {
    if (inBounds(p.clone.x + d[0], p.clone.y + d[1])) {
      p.clone.x += d[0]; p.clone.y += d[1];
      path.push([p.clone.x, p.clone.y]);
    }
  }
  return trackCloneSteps(slot, path);
}
// klon lovca sa ráta do pretínania Ariadninej nite — vstup klona na niť prekliateho nastaví threadMark
// (prekliaty tam uvidí siluetu — nevie, že patrí klonovi; ideálny bait)
function trackCloneSteps(slot, cells) {
  // pasca (Countess/Onre): aj klon lovca triggeruje pascu — zbieraj bunky prejdené klonom počas akcie
  if (actionSteps) actionSteps[slot + "c"].push(...cells.map(c => [...c]));
  const fx = [];
  const foeS = other(slot);
  const foe = game.players[foeS];
  if (foe?.labyrinth) {
    let mark = null;
    for (const [x, y] of cells) {
      if (foe.thread.some(([tx, ty]) => tx === x && ty === y)) mark = [x, y];
    }
    if (mark) {
      foe.threadMark = mark;
      fx.push({ kind: "thread_mark", cell: mark, target: foeS });
    }
  }
  return fx;
}

// 3 akcie, každý typ max 1× za kolo, len známe typy a smery (move, attack aj dash nesú dir)
// voliteľný úvod last_hope (len nebuffnutý hráč vo final kole) → potom golden_shield/golden_mirror (nestartér) → 3 akcie → sufix golden_mana
function validQueue(queue, slot) {
  if (!Array.isArray(queue)) return false;
  let q = queue;
  // úplne prvý môže byť last_hope — len pre nebuffnutého hráča v poslednom (final) kole
  if (q[0] && q[0].type === "last_hope") {
    const finalRound = !!(game.players.p1.lastStandBuff || game.players.p2.lastStandBuff);
    if (!finalRound || game.players[slot]?.lastStandBuff) return false;
    q = q.slice(1);
  }
  let goldenPre = null;
  if (q[0] && (q[0].type === "golden_shield" || q[0].type === "golden_mirror")) {
    if (slot === game.starter) return false;
    goldenPre = q[0].type;
    q = q.slice(1);
  }
  const trailing = q.length && q[q.length - 1] && q[q.length - 1].type;
  if (trailing === "golden_mana" || trailing === "last_stand") {
    // duálny gold button je v poslednom (buffnutom) kole zamknutý pre oboch hráčov
    if (game.players.p1.lastStandBuff || game.players.p2.lastStandBuff) return false;
    q = q.slice(0, -1);
  }
  if (q.length !== 3) return false;
  const types = q.map(a => a && a.type);
  // skamenený hráč: presne prvých `stone` akcií musí byť pass ("stoned"), inde sa vyskytovať nesmie
  const stone = Math.min(3, game.players[slot]?.stone || 0);
  for (let i = 0; i < q.length; i++) {
    if ((i < stone) !== (types[i] === "stoned")) return false;
  }
  // démon útok je platný typ len pre buffnutého hráča (posledné kolo) a je bez smeru
  const canDemon = !!game.players[slot]?.lastStandBuff;
  // swap (výmena maga) je platný typ len v turnaji; smie byť vo fronte až 2× (výnimka z „každý typ raz za kolo")
  const isTournament = !!game.mageHp && game.config?.format === "tournament";
  if (types.some(t => !ACTION_TYPES.has(t)
        && t !== "stoned"
        && !(t === "demon" && canDemon)
        && !(t === "swap" && isTournament))) return false;
  // každý NE-swap typ najviac 1×; swapov najviac 2 (ciele sa overia nižšie); stoned passov môže byť viac
  const nonSwap = types.filter(t => t !== "swap" && t !== "stoned");
  if (new Set(nonSwap).size !== nonSwap.length) return false;
  const swaps = q.filter(a => a.type === "swap");
  if (swaps.length > 2) return false;
  if (swaps.length) {
    if (!isTournament) return false;
    // počas aktívneho labyrintu (ktorejkoľvek strany) je výmena maga zakázaná — hlavy sú skryté,
    // swap sa odmieta už pri plánovaní (aj keby kliatba skončila zásahom uprostred kola)
    if (game.players.p1.labyrinth || game.players.p2.labyrinth) return false;
    // hráč s Last Stand paktom nesmie vo final kole swapnúť — inak by si zabankoval démonov
    // full-heal do rosteru (10/10 uložených pri swape) a doom by zabil náhradníka namiesto neho
    if (game.players[slot]?.lastStandBuff) return false;
    const person = game.seats[slot];
    const startChar = game.players[slot]?.char; // aktuálny mág na začiatku kola
    // Side-postavy (Countess/Onre) sa nedajú swapnúť ANI odsvapnúť — majú odlišnú sémantiku akcií
    // (diagonálny basic, charge namiesto dashu, pasca), takže mid-round výmena je nekoherentná
    if (SIDE_CHARS[startChar]) return false;                        // z nej sa nedá odísť
    const seen = new Set();
    for (const a of swaps) {
      if (SIDE_CHARS[a.to]) return false;                          // k nej sa nedá prísť
      if (!rosterFor(slot).includes(a.to)) return false;           // mág mimo draftnutého tímu
      if (a.to === startChar) return false;                        // návrat na východiskového maga nie je dovolený
      if ((game.mageHp[person]?.[a.to] ?? 0) <= 0) return false;   // mŕtveho maga nemožno nasadiť
      if (seen.has(a.to)) return false;                            // každý cieľ najviac raz
      seen.add(a.to);
    }
  }
  // golden shield/mirror sa vzájomne vylučuje s príslušnou bežnou akciou — nemôžeš ju zahrať 2× za kolo
  if (goldenPre === "golden_shield" && types.includes("shield")) return false;
  if (goldenPre === "golden_mirror" && types.includes("mirror")) return false;
  {
    // Vampire/Onryō/Jotaro: basic strieľa DIAGONÁLNE (4 diagonálne smery); Vampire/Onryō majú melee bez
    // smeru a dash = charge. Jotaro dashuje/melee normálne, ale nemá mirror (v tom slote má special1).
    const meChar = game.players[slot]?.char;
    const side = !!SIDE_CHARS[meChar];
    const isJotaro = meChar === "jotaro";
    // Luffy: basic je DIAGONÁLNY v base, ORTOGONÁLNY v gear3. Recharge prepína mód → simuluj formu
    // cez frontu (recharge PRED basicom zmení, na aký smer sa basic validuje).
    let simForm = game.players[slot]?.form;
    for (const a of q) {
      if (a.type === "recharge" && meChar === "luffy") simForm = simForm === "gear3" ? "base" : "gear3";
      if (a.type === "mirror" && isJotaro) return false;        // Jotaro nemá mirror akciu
      if (a.type === "special1" && !isJotaro) return false;     // special1 je len Jotarov
      if (a.type === "special1" && a.dir !== "left" && a.dir !== "right") return false;
      // Jotarov special: po THE WORLD (worldUsed) je to Special 2 — smerový (left/right); inak THE WORLD (bez smeru)
      if (a.type === "special" && isJotaro && game.players[slot]?.worldUsed && a.dir !== "left" && a.dir !== "right") return false;
      if ((a.type === "move" || a.type === "dash") && !MOVE_DIRS.has(a.dir)) return false;
      if (a.type === "attack") {
        const wantDiag = meChar === "luffy" ? (simForm !== "gear3") : side; // Luffy gear3 = ortogonálny
        if (!(wantDiag ? DIAG_DIRS[a.dir] : MOVE_DIRS.has(a.dir))) return false;
      }
    }
  }
  // Vojak: special nesie cieľovú bunku {x,y}. Cieľ nesmie byť súperova AKTUÁLNA bunka (ani jeho tieňový
  // klon — obe figúry sú „súper", blokovanie len pravej by prezradilo, ktorá je skutočná) — zásah má
  // padnúť len keď sa súper POHNE. Vlastná bunka sa blokuje podľa GHOST pozície v čase specialu (po
  // naplánovaných move/dash — zrkadlí klientský picker/simulatedPositions; dash sa simuluje ako keby
  // mana vyšla, rovnako ako ghost). Výnimka labyrint: prekliaty vojak strieľa naslepo — súperova bunka
  // sa nekontroluje (blokovanie by mu ju prezradilo), takže stojaceho lovca trafiť SMIE (maze buff vojaka).
  {
    const meP = game.players[slot];
    const foe = game.players[other(slot)];
    let simChar = meP?.char, sx = meP?.x, sy = meP?.y, simForm2 = meP?.form;
    for (const a of q) {
      if (a.type === "swap" && a.to) simChar = a.to; // v turnaji môže special hádzať až swapnutý mág
      if (a.type === "recharge" && simChar === "luffy") simForm2 = simForm2 === "gear3" ? "base" : "gear3"; // Luffy: recharge prepína mód
      const d = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[a.dir];
      if (a.type === "move" && d && inBounds(sx + d[0], sy + d[1])) { sx += d[0]; sy += d[1]; }
      // Vampire/Onryō: dash = charge — beh po prvú VIDITEĽNÚ figúru súpera alebo okraj (zrkadlí
      // klientský ghost; v labyrinte je súper skrytý → beh na okraj); ostatní dashujú max 2 bunky
      if (a.type === "dash" && d) {
        if (VAMP_CHARS[simChar]) {
          while (inBounds(sx + d[0], sy + d[1])) {
            sx += d[0]; sy += d[1];
            if (!meP?.labyrinth && foe && ((foe.x === sx && foe.y === sy) || (foe.clone && foe.clone.x === sx && foe.clone.y === sy))) break;
          }
        } else {
          for (let s = 0; s < 2; s++) if (inBounds(sx + d[0], sy + d[1])) { sx += d[0]; sy += d[1]; }
        }
      }
      // Vlkolakov charge hýbe kasterom — simuluj presun (stop na prvej VIDITEĽNEJ figúre súpera alebo na
      // okraji; v labyrinte je súper skrytý → beh na okraj, zrkadlí klientský ghost). Ovplyvňuje ghost
      // pozíciu neskoršieho Vojakovho specialu po turnajovom swape.
      if (a.type === "special" && simChar === "werewolf") {
        const wd = WOLF_DIRS[a.dir];
        if (wd) {
          while (inBounds(sx + wd[0], sy + wd[1])) {
            sx += wd[0]; sy += wd[1];
            if (!meP?.labyrinth && foe && ((foe.x === sx && foe.y === sy) || (foe.clone && foe.clone.x === sx && foe.clone.y === sy))) break;
          }
        }
      }
      if (a.type === "special" && simChar === "soldier") {
        const c = a.cell;
        if (!c || !Number.isInteger(c.x) || !Number.isInteger(c.y) || !inBounds(c.x, c.y)) return false;
        if (c.x === sx && c.y === sy) return false; // vlastná (ghost) bunka
        if (!meP?.labyrinth && foe) {
          if (foe.x === c.x && foe.y === c.y) return false;
          if (foe.clone && foe.clone.x === c.x && foe.clone.y === c.y) return false;
        }
      }
      // Countess/Onre: special (pasca) nesie cieľovú bunku — BEZ obmedzení (aj súperova aktuálna,
      // aj vlastná), stačí platná bunka v ploche. (Jotaro NIE — jeho special je smerový bez bunky.)
      if (a.type === "special" && VAMP_CHARS[simChar]) {
        const c = a.cell;
        if (!c || !Number.isInteger(c.x) || !Number.isInteger(c.y) || !inBounds(c.x, c.y)) return false;
      }
      // Luffy: special nesie cieľovú bunku na platnej línii (dáma base / veža gear3) z GHOST pozície;
      // special presunie Luffyho na tú bunku (ovplyvní ghost neskorších akcií).
      if (a.type === "special" && simChar === "luffy") {
        const c = a.cell;
        if (!c || !Number.isInteger(c.x) || !Number.isInteger(c.y) || !luffySpecialReaches(sx, sy, c.x, c.y, simForm2)) return false;
        sx = c.x; sy = c.y;
      }
    }
  }
  return true;
}

// Jotaro THE WORLD: 3 nové zmrazené akcie (kvázi nové kolo, všetky typy nanovo). Povolené:
// move|dash|recharge|attack|melee|shield|special1. Zakázané: special (THE WORLD beží / Special 2 ešte
// nie je), golden akcie, swap, stoned. Mana sa NEvaliduje tvrdo (nedostatok = invalid pri vykonaní).
function validTimestopQueue(queue, slot) {
  if (!Array.isArray(queue) || queue.length !== 3) return false;
  const allowed = new Set(["move", "dash", "recharge", "attack", "melee", "shield", "special1"]);
  const types = queue.map(a => a && a.type);
  if (types.some(t => !allowed.has(t))) return false;
  if (new Set(types).size !== types.length) return false; // každý typ max 1×
  const side = !!SIDE_CHARS[game.players[slot]?.char]; // Jotaro strieľa diagonálne
  for (const a of queue) {
    if ((a.type === "move" || a.type === "dash") && !MOVE_DIRS.has(a.dir)) return false;
    if (a.type === "attack" && !(side ? DIAG_DIRS[a.dir] : MOVE_DIRS.has(a.dir))) return false;
    if (a.type === "special1" && a.dir !== "left" && a.dir !== "right") return false;
  }
  return true;
}

function winnerNow() {
  const p1dead = game.players.p1.hp <= 0;
  const p2dead = game.players.p2.hp <= 0;
  if (p1dead && p2dead) return "draw";
  if (p1dead) return "p2";
  if (p2dead) return "p1";
  return null;
}

/* ---- Admin: tvrdý reset TEJTO roomky (odpojí oboch hráčov, zruší časovače) ---- */
// Globálny forceResetAll() (mimo factory) volá forceReset() na každej roomke a vyprázdni register.
function forceReset() {
  clearTurnTimer();
  try { if (personSockets.A) personSockets.A.disconnect(true); } catch {}
  try { if (personSockets.B) personSockets.B.disconnect(true); } catch {}
  for (const s of spectators) { try { s.disconnect(true); } catch {} } // odpoj aj divákov, nech nevisia na zrušenej roomke
  spectators.clear();
  personSockets.A = null;
  personSockets.B = null;
  personIds.A = null;
  personIds.B = null;
  personNames.A = null;
  personNames.B = null;
  personFreedAt.A = 0;
  personFreedAt.B = 0;
  if (roomDestroyTimer) { clearTimeout(roomDestroyTimer); roomDestroyTimer = null; }
  pendingMatchConfig = null;
}

/* -------------------- Actions -------------------- */
// koľko políčok dokáže klon prejsť daným smerom (vertikálne inverzne) — bez mutácie stavu
function cloneMovableSteps(a, delta, maxSteps) {
  if (!a?.clone) return 0;
  const d = [delta[0], -delta[1]];
  let cx = a.clone.x, cy = a.clone.y, n = 0;
  for (let s = 0; s < maxSteps; s++) {
    if (inBounds(cx + d[0], cy + d[1])) { cx += d[0]; cy += d[1]; n++; } else break;
  }
  return n;
}

// smer klona (vertikálne inverzný) — pre náraz do steny na klonovej strane (diagonály kvôli úplnosti;
// klona má len Naruto, ktorý strieľa ortogonálne)
const CLONE_DIR = { up:"down", down:"up", left:"left", right:"right", up_left:"down_left", up_right:"down_right", down_left:"up_left", down_right:"up_right" };

function doMove(slot, dir, tl) {
  const a = game.players[slot];
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir] || [0,0];
  const nx = a.x + delta[0], ny = a.y + delta[1];
  const ownCan = inBounds(nx, ny);
  // klon (Naruto) sa hýbe vertikálne inverzne s vlastným clampom
  const hasClone = !!a.clone;
  const cloneCan = hasClone && cloneMovableSteps(a, delta, 1) > 0;
  // NOVÉ PRAVIDLO: pohyb do steny sa už neprečiarkne — akcia sa „vykoná" ako náraz do steny
  // (žiadny pohyb, ale slot je spotrebovaný). Ak sa aspoň jedna figúra pohne, druhá narazí (OUT OF BOUNDS).
  const fx = [];
  if (ownCan) {
    a.x = nx; a.y = ny;
    fx.push(...trackSteps(slot, [[nx, ny]])); // labyrint: niť / obrys na nití
  } else {
    fx.push({ kind: "wall_bump", from: slot, dir }); // Naruto narazí do steny (klon beží)
  }
  if (hasClone) {
    if (cloneCan) fx.push(...moveCloneSteps(slot, delta, 1)); // klon sa hýbe (vertikálne inverzne)
    else fx.push({ kind: "wall_bump", from: slot, dir: CLONE_DIR[dir], clone: true }); // klon narazí do steny (Naruto beží)
  }
  pushStateFrame(tl, fx, MOVE_DELAY_MS);
}

function doDash(slot, dir, tl) {
  const a = game.players[slot];
  // Vampire/Onryō nemajú dash — ich dash slot je pohybové melee (charge). Jotaro dashuje normálne.
  if (VAMP_CHARS[a.char]) return doVampCharge(slot, dir, tl);
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
  if (!delta) { pushInvalid(tl, slot); return; }
  if (a.mana < DASH_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }

  // posun až o 2 políčka zvoleným smerom; na okraji sa skráti na 1 (bez možného pohybu = náraz do steny nižšie)
  let nx = a.x, ny = a.y, steps = 0;
  const path = []; // aj medzibunka — labyrintná niť/obrys sa počíta na každom prejdenom políčku
  for (let s = 0; s < 2; s++) {
    if (inBounds(nx + delta[0], ny + delta[1])) { nx += delta[0]; ny += delta[1]; steps++; path.push([nx, ny]); }
  }
  // klon dashuje vertikálne inverzne s vlastným clampom — dash prebehne aj keď Naruto naráža do steny
  const hasClone = !!a.clone;
  const cloneSteps = hasClone ? cloneMovableSteps(a, delta, 2) : 0;

  // NOVÉ PRAVIDLO: dash do steny sa už neprečiarkne — máš naň manu (overené vyššie), tak sa minie
  // a akcia sa „vykoná" ako náraz do steny (žiadny pohyb). Pasívne skreč many cez dash do steny padá.
  a.mana -= DASH_COST;
  const fx = [];
  if (steps) {
    a.x = nx; a.y = ny;
    fx.push(...trackSteps(slot, path));
  } else {
    fx.push({ kind: "wall_bump", from: slot, dir }); // Naruto narazí do steny (klon dashuje)
  }
  if (hasClone) {
    if (cloneSteps) fx.push(...moveCloneSteps(slot, delta, 2)); // klon kopíruje dash (vertikálne inverzne)
    else fx.push({ kind: "wall_bump", from: slot, dir: CLONE_DIR[dir], clone: true }); // klon narazí do steny (Naruto dashuje)
  }
  pushStateFrame(tl, fx, MOVE_DELAY_MS);
}

function doRecharge(slot, tl) {
  const a = game.players[slot];

  // Luffy: recharge je jeho „glitch" akcia — doplní manu (ak nie je plná) A VŽDY prepne mód (base↔gear3),
  // aj pri plnej mane (vtedy sa nepreškrtne — prepnutie je jeho efekt).
  if (a.char === "luffy") {
    const before = a.mana;
    a.mana = Math.min(MAX_MANA, a.mana + RECHARGE_GAIN);
    const gained = a.mana - before;
    a.form = a.form === "gear3" ? "base" : "gear3";
    const cells = a.clone ? [[a.x, a.y], [a.clone.x, a.clone.y]] : [[a.x, a.y]];
    // dlhší frame, nech sa prepínacia póza (Recharge2 base→gear3 / Special_3 gear3→base) stihne prehrať
    pushStateFrame(tl, [{ kind: "recharge", from: slot, cells, amount: gained, luffyForm: a.form }], Math.round(700 * ANIM_SLOW));
    return;
  }

  // Na maxime many -> neplatné, žiadna modrá animácia/bublina
  if (a.mana >= MAX_MANA) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana_full"); return; }

  const before = a.mana;
  a.mana = Math.min(MAX_MANA, a.mana + RECHARGE_GAIN);
  const gained = a.mana - before; // menej ak capne na MAX_MANA
  if (gained > 0) {
    // klon hrá nabíjanie naprázdno (manu zdieľa s majiteľom) — jeho bunka ide v efekte, nech aura
    // svieti na oboch a recharge neprezradí, ktorý je pravý
    const cells = a.clone ? [[a.x, a.y], [a.clone.x, a.clone.y]] : [[a.x, a.y]];
    pushStateFrame(
      tl,
      [{ kind: "recharge", from: slot, cells, amount: gained }],
      SMALL_DELAY_MS
    );
  } else {
    pushInvalid(tl, slot);
  }
}

// Vampire/Onryō: lomená dráha diagonálnej strely — RAZ sa odrazí od ktorejkoľvek steny (biliard,
// od bočnej letí späť ku kasterovi), roh neodráža (let končí), tvrdý limit VAMP_SHOT_RANGE buniek.
// Výstrel do priľahlej steny sa odrazí OKAMŽITE (spotrebuje svoj jediný odraz); do rohu = prázdna
// dráha → wall-rule whiff. Každý krok nesie aj dir (klient podľa neho otáča špic strely po odraze).
// MUSÍ sedieť s klientským cellsForAttackPreview (vampShotRoute v client.js).
const DIAG_NAME = { "-1,-1": "up_left", "1,-1": "up_right", "-1,1": "down_left", "1,1": "down_right" };
function vampShotRoute(x, y, dir) {
  let [dx, dy] = DIAG_DIRS[dir] || [];
  if (dx === undefined) return [];
  const route = [];
  let bounced = false;
  while (route.length < VAMP_SHOT_RANGE) {
    let nx = x + dx, ny = y + dy;
    if (!inBounds(nx, ny)) {
      if (bounced) break; // druhý kontakt so stenou — koniec letu
      const outX = nx < 0 || nx >= game.board.w;
      const outY = ny < 0 || ny >= game.board.h;
      if (outX && outY) break; // roh sa neodráža
      bounced = true;
      if (outX) dx = -dx; else dy = -dy;
      nx = x + dx; ny = y + dy;
      if (!inBounds(nx, ny)) break;
    }
    x = nx; y = ny;
    route.push({ x, y, dir: DIAG_NAME[dx + "," + dy] });
  }
  return route;
}

function doBasic(slot, dir, tl) {
  const me  = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];

  // Luffy GEAR 3: basic = Giant Pistol (naťahovacia ruka + priťiahnutie súpera) — vlastná vetva
  if (me.char === "luffy" && me.form === "gear3") return doLuffyGear3Basic(slot, dir, tl);

  // ortogonálne + diagonálne smery (Vampire/Onryō strieľajú diagonálne — validQueue gate-uje per postava)
  const delta = WOLF_DIRS[dir];
  if (!delta) { pushInvalid(tl, slot); return; }
  if (me.mana < BASIC_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  // NOVÉ PRAVIDLO: útok do steny sa už neprečiarkne — máš naň manu, tak sa minie a strela sa „vypustí"
  // (hneď zhasne na okraji). Klonova strela (vertikálne zrkadlená) môže pritom letieť ďalej.
  me.mana -= BASIC_COST;
  // POWER tile: +2 k MAJITEĽOVÝM strelám (klonova strela boost nemá); spotreba hneď pri použití útoku
  const pBonus = powerBoost(slot, tl);
  let anyCharge = false; // aspoň jedna strela vôbec vzlietla (dostala in-board bunku) → netreba whiff

  // strely: majiteľ + prípadný klon. Klon zrkadlí smer VERTIKÁLNE (up<->down), horizontálne rovnako
  // (rovnako ako pohyb); klonova strela dáva ROVNAKÝ dmg ako Naruto (falloff + rovnaké buffy). Každá
  // strela nesie vlastný delta `d` a `dir`, aby klonova vertikála letela opačne.
  // Terče v dráhe: SÚPEROV KLON-návnada (mimo majiteľovej bunky) strelu zožerie a letí ďalej dym; keď
  // klon STOJÍ NA majiteľovej bunke, pohltí len CLONE_DMG a zvyšok prejde na Naruta.
  const cloneDir = CLONE_DIR[dir];
  const cloneDelta = [delta[0], -delta[1]];
  // Vampire/Onryō/Luffy(base): strela letí po lomenej diagonálnej dráhe (route) s odrazom; ostatní priamo.
  // (Luffy gear3 sem nedôjde — má vlastnú vetvu doLuffyGear3Basic vyššie.)
  const route = SIDE_CHARS[me.char] ? vampShotRoute(me.x, me.y, dir) : null;
  const shots = [{ x: me.x, y: me.y, dist: 0, clone: false, d: delta, dir, done: false, spent: false, route }];
  if (me.clone) shots.push({ x: me.clone.x, y: me.clone.y, dist: 0, clone: true, d: cloneDelta, dir: cloneDir, done: false, spent: false, route: null });

  // bunky, ktorými strela preletí (route = lomená dráha; inak priamo po okraj)
  const shotScanCells = (sh) => {
    if (sh.route) return sh.route.map(st => [st.x, st.y]);
    const cs = []; let hx = sh.x, hy = sh.y;
    while (inBounds(hx + sh.d[0], hy + sh.d[1])) { hx += sh.d[0]; hy += sh.d[1]; cs.push([hx, hy]); }
    return cs;
  };
  // deterministický pre-scan: zásah REÁLNEHO hráča ktoroukoľvek strelou odhalí labyrint pred letom
  // (zásah len klona-návnady labyrint neodhaľuje; stacknutý klon strelu k Narutovi pustí → to odhalí)
  outer: for (const sh of shots) {
    for (const [hx, hy] of shotScanCells(sh)) {
      const cloneDecoy = op?.clone && op.clone.x === hx && op.clone.y === hy && !(op.x === hx && op.y === hy);
      if (cloneDecoy) break; // klon-návnada strelu zožerie — ďalej nedoletí
      if (op && op.x === hx && op.y === hy) { revealLabyrinths(tl); break outer; }
    }
  }

  // paralelný let: v každom kroku sa všetky živé strely posunú o bunku (jeden frame = všetky charge efekty)
  let guard = 0;
  while (shots.some(s => !s.done) && guard++ < 16) {
    const fx = [];
    const hits = [];
    for (const s of shots) {
      if (s.done) continue;
      if (s.route) {
        // lomená dráha (Vampire/Onryō): krok podľa route; dir sa mení po odraze (klient otáča špic)
        const st = s.route[s.dist];
        if (!st) { s.done = true; continue; }
        s.x = st.x; s.y = st.y; s.dir = st.dir; s.dist++;
      } else {
        s.x += s.d[0]; s.y += s.d[1]; s.dist++;
        if (!inBounds(s.x, s.y)) { s.done = true; continue; }
      }
      fx.push({ kind: "charge", from: slot, dir: s.dir, cell: [s.x, s.y], clone: s.clone });
      if (s.spent) continue; // už minutá na klona-návnadu — letí len vizuálne
      const cloneHere  = op?.clone && op.clone.x === s.x && op.clone.y === s.y;
      const playerHere = op && op.x === s.x && op.y === s.y;
      if (cloneHere && playerHere) { s.done = true; hits.push({ target: "stacked", shot: s }); }
      else if (cloneHere)         { hits.push({ target: "clone", shot: s }); }
      else if (playerHere)        { s.done = true; hits.push({ target: "player", shot: s }); }
    }
    if (fx.length) { anyCharge = true; pushStateFrame(tl, fx, CHARGE_STEP_MS); }
    // Vojak: granát nezasiahne v momente doletu, ale až keď na cieľovej bunke VYBUCHNE a výbuch je vidieť.
    // Keď let končí zásahom súpera (player/stacked), vlož prázdny frame: ten na klientovi stiahne granát
    // (spustí odpočet výbuchu — výbuch nabehne CHARGE_STEP_MS po ňom) a jeho delayMs = CHARGE_STEP_MS +
    // SOLDIER_GRENADE_BLAST_MS posunie hit frame tak, aby červené políčko a „-HP" padli AŽ po nábehu výbuchu.
    // Netýka sa preletu cez klona-návnadu (granát letí ďalej).
    if (me.char === "soldier" && hits.some(h => h.target === "player" || h.target === "stacked")) {
      pushStateFrame(tl, [], CHARGE_STEP_MS + SOLDIER_GRENADE_BLAST_MS);
    }
    // klonova strela dáva ROVNAKÝ dmg ako Naruto: falloff podľa VLASTNEJ vzdialenosti klona
    // (h.shot.dist sa počíta z klonovej bunky) × rovnaké násobiče (Last Stand ×2 / Last Hope ×4, maze ×2).
    // POWER bonus je flat a LEN na majiteľovej strele (klon z power tile neprofituje).
    const rawOf = (h) => Math.max(1, BASIC_DMG_MAX - h.shot.dist) * dealMul(slot) * labyrinthMul(slot) + (h.shot.clone ? 0 : pBonus);
    // súperove „player" zásahy z TOHTO kroku: stacknutý Naruto+klon strieľajúci rovnakým smerom trafí
    // z jednej bunky dvakrát → na NEKRYTÉ HP to spojíme do JEDNÉHO úderu so súčtom dmg (nie dva animačne
    // oddelené); pri obrane (štít/mirror) applyStackedHit vráti false a rieši sa každá strela zvlášť.
    const playerHits = hits.filter(h => h.target === "player");
    const ownerBonus = playerHits.some(h => !h.shot.clone) ? pBonus : 0; // bonus nesie len majiteľova strela
    if (playerHits.length && !applyStackedHit(opS, playerHits.map(rawOf), tl, "basic", ownerBonus)) {
      for (const h of playerHits) { applyHit(opS, rawOf(h), tl, "basic", h.shot.clone, h.shot.clone ? 0 : pBonus); if (winnerNow()) break; }
    }
    for (const h of hits) {
      if (h.target === "player" || winnerNow()) continue;
      const raw = rawOf(h);
      if (h.target === "stacked") {
        const defended = op.shield || op.mirror; // zdieľaná obrana kryje celý zásah (klon prežije)
        if (defended) {
          // obe figúry na JEDNEJ bunke → obrana zareaguje ako jedna postava v JEDNOM beate
          // (jeden block / jeden lúč + odraz oboch figúr naraz ako „n+n" hit) — nie dva zásahy za sebou
          applyHitPairDefended(opS, raw, tl, "basic", h.shot.clone);
        } else {
          // klon na majiteľovej bunke pohltí len CLONE_DMG (zomrie), zvyšok dmg prejde na Naruta
          applyHitOnClone(opS, CLONE_DMG, tl, "basic");
          if (!winnerNow()) {
            const through = Math.max(0, raw - CLONE_DMG);
            if (through > 0) applyHit(opS, through, tl, "basic", h.shot.clone, h.shot.clone ? 0 : pBonus);
          }
        }
      } else { // clone (návnada mimo majiteľovej bunky)
        const defended = op.shield || op.mirror; // obrana strelu zastaví (block/odraz), inak preletí cez dym
        applyHitOnClone(opS, raw, tl, "basic");
        if (defended) h.shot.done = true; else h.shot.spent = true;
      }
    }
    if (winnerNow()) break; // prvá smrť končí hru — zvyšok letu sa už nehrá
  }
  // žiadna strela nevzlietla (Naruto aj klon mieria von z plochy) — zahraj útočný švih naprázdno
  // + whiff float, nech akcia nie je „tichá" a čitateľne minula manu (namiesto starého prečiarknutia)
  if (!anyCharge) pushStateFrame(tl, [{ kind: "attack_swing", from: slot, dir, offboard: true }], SMALL_DELAY_MS);
}

function doMelee(slot, tl) {
  const me  = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];

  // Vampire/Onryō majú vlastný melee (úder na vlastnej bunke + bonus). Jotaro melee normálne.
  if (VAMP_CHARS[me.char]) return doVampMelee(slot, tl);

  if (me.mana < MELEE_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= MELEE_COST;
  // POWER tile: +2 k MAJITEĽOVMU úderu (klonov sek boost nemá); spotreba pri použití — aj pri minutí
  const pBonus = powerBoost(slot, tl);

  // úder sa švihne vždy (mana je preč aj pri minutí); bežne zasiahne len súpera na rovnakom políčku,
  // Medúza šľahá chvostom širšie — vlastné políčko + 1 diagonálne na všetky strany, za nižší dmg.
  // Zasahované bunky idú v efekte (klient ich zvýrazní a nemusí zrkadliť logiku).
  const medusa = me.char === "medusa";
  const myMeleeDmg = medusa ? MEDUSA_MELEE_DMG : (me.char === "jotaro" ? JOTARO_MELEE_DMG : MELEE_DMG);
  const cells = [[me.x, me.y]];
  if (medusa) {
    for (const [dx, dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
      if (inBounds(me.x + dx, me.y + dy)) cells.push([me.x + dx, me.y + dy]);
    }
  }
  // vlastný klon seká paralelne na SVOJEJ bunke (rovnaký dmg ako Naruto)
  const cloneCells = me.clone ? [[me.clone.x, me.clone.y]] : [];
  const atCells = (cs, px, py) => cs.some(([x, y]) => x === px && y === py);
  // terče: súperov klon-NÁVNADA (mimo majiteľovej bunky) absorbuje úder na svojej bunke celý;
  // klon STACKNUTÝ na majiteľovej bunke pohltí len CLONE_DMG a zvyšok úderu prejde na majiteľa
  // (rovnaké pravidlo ako pri prestrelenom stacknutom páre v doBasic — nie plný bait);
  // súper na inej zasahovanej bunke (Medúza) dostane úder tiež — zóna, nie jeden terč
  const stacked = !!(op?.clone && op.clone.x === op.x && op.clone.y === op.y);
  const hitFoeByMe    = !!(op && atCells(cells, op.x, op.y) && !stacked);
  const hitFoeByClone = !!(op && atCells(cloneCells, op.x, op.y) && !stacked);
  const hitStackedByMe    = stacked && atCells(cells, op.x, op.y);
  const hitStackedByClone = stacked && atCells(cloneCells, op.x, op.y);
  const hitFoeCloneByMe    = !!(op?.clone && !stacked && atCells(cells, op.clone.x, op.clone.y));
  const hitFoeCloneByClone = !!(op?.clone && !stacked && atCells(cloneCells, op.clone.x, op.clone.y));
  // zásah je istý už pred švihmi (pozície sa nemenia) — REÁLNY zásah odhalí labyrint PRED animáciou
  // (zásah len klona-návnady nie — súper sa nesmie dozvedieť, že trafil; zásah stacknutého páru
  // prejde aj na REÁLNEHO majiteľa, takže odhaľuje)
  if (hitFoeByMe || hitFoeByClone || hitStackedByMe || hitStackedByClone) revealLabyrinths(tl);
  // rovnaká dramaturgia ako special: opakované švihy v beatoch, dmg padne až po nich
  for (let r = 0; r < MELEE_REPEAT; r++) {
    pushStateFrame(tl, [{ kind: "melee", from: slot, cells: cells.concat(cloneCells) }], SPECIAL_BEAT_MS);
  }
  const meleeRaw = myMeleeDmg * dealMul(slot) * labyrinthMul(slot) + pBonus; // maze buff: 2× počas labyrintu; POWER flat +2
  const cloneMeleeRaw = MELEE_DMG * dealMul(slot) * labyrinthMul(slot); // klon (vždy Narutov) seká za plný MELEE_DMG, bez POWER bonusu
  // stacknutý pár Naruto+klon na súperovej bunke seká dvakrát → na nekryté HP JEDEN úder so súčtom
  // (klient vypíše „8+8" a zanimuje ako jeden zásah); pri obrane sa rieši každý sek zvlášť
  if (!(hitFoeByMe && hitFoeByClone && applyStackedHit(opS, [meleeRaw, cloneMeleeRaw], tl, "melee", pBonus))) {
    if (hitFoeByMe) applyHit(opS, meleeRaw, tl, "melee", false, pBonus);
    if (hitFoeByClone && !winnerNow()) applyHit(opS, cloneMeleeRaw, tl, "melee", true);
  }
  // stacknutý pár Naruto+klon: obrana kryje pár ako JEDNA postava v jednom beate (applyHitPairDefended),
  // bez obrany klon pohltí CLONE_DMG (zomrie) a ZVYŠOK úderu prejde na majiteľa — ako pri streľbe
  const stackedMelee = (raw, fromClone) => {
    if (op.shield || op.mirror) { applyHitPairDefended(opS, raw, tl, "melee", fromClone); return; }
    if (op.clone) { applyHitOnClone(opS, CLONE_DMG, tl, "melee"); raw = Math.max(0, raw - CLONE_DMG); }
    if (raw > 0 && !winnerNow()) applyHit(opS, raw, tl, "melee", fromClone, fromClone ? 0 : pBonus);
  };
  if (hitStackedByMe) stackedMelee(meleeRaw, false);
  if (hitStackedByClone && !winnerNow()) stackedMelee(cloneMeleeRaw, true);
  if ((hitFoeCloneByMe || hitFoeCloneByClone) && !winnerNow()) {
    // obrana sa už prípadne „ukázala" na zásahu hráča tou istou akciou → bez duplicitných frame-ov
    // (majiteľov sek na klona nesie aj POWER bonus — mirror z klona ho odrazí ako súčasť plného dmg)
    applyHitOnClone(opS, hitFoeCloneByMe ? myMeleeDmg * dealMul(slot) + pBonus : CLONE_DMG * dealMul(slot),
      tl, "melee", hitFoeByMe || hitFoeByClone);
  }
}

/* ---- Vampire / Onryō: melee + charge + pasca ---- */
// bonus po REÁLNE dopadnutom dmg (nie pri bloku — mirror sa voči nim správa tiež ako blok):
// Vampire lieči zo skutočne spôsobeného HP lossu; Onryō najprv odoberie súperovu manu.
// Caster si potom doplní len to, čo sa zmestí do capu — presah prepadá.
// Vampire NElieči naraz so zásahom — pri charge/trap bonuse najprv idú beaty A2 → A3 → A4,
// až po nich sa doplnia HP; Onryō drainuje hneď.
// amount: charge VAMP_CHARGE_BONUS, trap VAMP_TRAP_BONUS.
function vampBonus(slot, tl, amount, hpSource = amount) {
  const p = game.players[slot];
  const foeS = other(slot);
  const foe = game.players[foeS];
  if (p.char === "countess") {
    for (const a of ["va2", "va3", "va4"]) {
      pushStateFrame(tl, [{ kind: "vamp_heal_cast", from: slot, anim: a }], VAMP_HEAL_BEAT_MS);
    }
    const healed = Math.min(amount, Math.max(0, hpSource), START_HP - p.hp);
    if (healed > 0) {
      p.hp += healed;
      pushStateFrame(tl, [{ kind: "heal", target: slot, amount: healed }], SMALL_DELAY_MS);
    }
    return;
  }
  const drained = Math.min(amount, Math.max(0, foe.mana));
  if (drained <= 0) return;
  const gained = Math.min(drained, MAX_MANA - p.mana);
  foe.mana -= drained;
  p.mana += gained;
  pushStateFrame(tl, [{ kind: "mana_drain", from: slot, target: foeS, drained, gained }], SMALL_DELAY_MS);
}

// Dopad Vampire/Onryō melee-typu úderu (own-cell melee / charge / trap) na bunku, kde caster PRÁVE stojí.
// Rieši všetky varianty s Narutovým klonom rovnako ako doMelee (stackedMelee):
//   • samotný hráč      → applyHit (+ bonus z REÁLNE spôsobeného HP lossu)
//   • klon-návnada sám   → applyHitOnClone (zožerie úder celý, žiadny bonus)
//   • stacknutý pár       → s obranou kryje pár ako JEDNA postava (applyHitPairDefended, bez bonusu);
//     bez obrany klon pohltí CLONE_DMG (zomrie) a ZVYŠOK úderu prejde na majiteľa (bonus z tohto zvyšku)
// Predtým stacknutý pár zabíjal len klona a majiteľ nedostal nič — chyba (klon nemal byť plný bait
// na vlastnej bunke). bonusAmount 0 = melee bez heal/drain bonusu. consumeDefense: len trap beží mimo
// resolveTurn slučky (ktorá inak spotrebuje súperovu obranu za akciu castera), tak si ju spotrebuje sám.
// Vracia true, ak úder na niečo dopadol (na rozlíšenie whiffu naprázdno).
// powerBonus = POWER tile prídavok už obsiahnutý v raw — len na rozpis hit framu (samostatný „-2" float)
function vampMeleeLand(ownerSlot, raw, bonusAmount, tl, consumeDefense = false, powerBonus = 0) {
  const me   = game.players[ownerSlot];
  const foeS = other(ownerSlot);
  const foe  = game.players[foeS];
  const foeAt   = !!(foe && foe.x === me.x && foe.y === me.y);
  const cloneAt = !!(foe?.clone && foe.clone.x === me.x && foe.clone.y === me.y);
  const stacked    = foeAt && cloneAt;   // Naruto + klon na jednej bunke
  const playerHere = foeAt && !cloneAt;  // len hráč (klon inde alebo žiadny)
  const decoyHere  = cloneAt && !foeAt;  // klon-návnada sám
  const shieldArmed = foe.shield, mirrorArmed = foe.mirror;
  const defended = shieldArmed || mirrorArmed;
  if (stacked) {
    if (defended) {
      applyHitPairDefended(foeS, raw, tl, "melee", false); // obrana kryje pár ako jednu postavu
    } else {
      const hpBefore = foe.hp;
      applyHitOnClone(foeS, CLONE_DMG, tl, "melee");        // klon pohltí CLONE_DMG a zomrie
      const through = Math.max(0, raw - CLONE_DMG);
      if (through > 0 && !winnerNow()) applyHit(foeS, through, tl, "melee", false, powerBonus); // zvyšok na majiteľa
      if (bonusAmount > 0) vampBonus(ownerSlot, tl, bonusAmount, hpBefore - foe.hp);
    }
  } else if (playerHere) {
    const hpBefore = foe.hp;
    applyHit(foeS, raw, tl, "melee", false, powerBonus);
    if (bonusAmount > 0 && !defended) vampBonus(ownerSlot, tl, bonusAmount, hpBefore - foe.hp);
  } else if (decoyHere) {
    applyHitOnClone(foeS, raw, tl, "melee");                // klon-návnada zožerie úder celý
  }
  if (consumeDefense && (playerHere || stacked || decoyHere)) {
    if (shieldArmed) { foe.shield = false; foe.shieldGold = false; }
    if (mirrorArmed) { foe.mirror = false; foe.mirrorGold = false; }
  }
  return playerHere || stacked || decoyHere;
}

// Melee Vampire/Onryō: úder LEN na vlastnej bunke (bez smeru) — VAMP_MELEE_DMG, bez bonusu.
// Vampire opakuje A1 v troch beat-och ako Onryō melee; dmg padá až po celej choreografii.
function doVampMelee(slot, tl) {
  const me  = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];
  if (me.mana < MELEE_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= MELEE_COST;
  // POWER tile: +2 k úderu; spotreba pri použití — aj pri whiffe na prázdnej bunke
  const pBonus = powerBoost(slot, tl);
  const raw = VAMP_MELEE_DMG * dealMul(slot) * labyrinthMul(slot) + pBonus;
  // reálny zásah hráča (aj stacknutého páru s klonom) odhalí labyrint PRED údermi
  if (op && op.x === me.x && op.y === me.y) revealLabyrinths(tl);
  if (me.char === "countess") {
    for (let r = 0; r < MELEE_REPEAT; r++) {
      pushStateFrame(tl, [{ kind: "vamp_strike", from: slot, cell: [me.x, me.y], anim: "va1" }], VAMP_TRAP_STRIKE_MS);
    }
  } else {
    for (let r = 0; r < MELEE_REPEAT; r++) {
      pushStateFrame(tl, [{ kind: "melee", from: slot, cells: [[me.x, me.y]] }], SPECIAL_BEAT_MS);
    }
  }
  vampMeleeLand(slot, raw, 0, tl, false, pBonus); // own-cell melee bez heal/drain bonusu; klon-návnada/stacknutý pár rieši helper
}

// Charge Vampire/Onryō (nahrádza dash, rovnaká cena): pohybové melee — beh zvoleným smerom po PRVÚ
// figúru súpera (klon-návnada pred hráčom) alebo po okraj (bez cieľa = čisté premiestnenie);
// VAMP_CHARGE_DMG + VAMP_CHARGE_BONUS pri dopadnutom dmg. Na bunke terča OSTÁVA STÁŤ aj pri bloku.
// Charge do steny z okrajovej bunky = wall rule (mana preč, náraz, neprečiarkuje sa).
function doVampCharge(slot, dir, tl) {
  const me  = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
  if (!delta) { pushInvalid(tl, slot); return; }
  if (me.mana < DASH_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= DASH_COST;
  // POWER tile: ráta sa ŠTARTOVÁ bunka (caster na nej stojí v momente vyhodnotenia akcie, beh je až potom);
  // spotreba pri použití — aj keď charge skončí čistým premiestnením bez terča či nárazom do steny
  const pBonus = powerBoost(slot, tl);
  const raw = VAMP_CHARGE_DMG * dealMul(slot) * labyrinthMul(slot) + pBonus;

  // dráha: krok za krokom po okraj; stop na PRVEJ figúre (klon-návnada / hráč / stacknutý pár)
  let x = me.x, y = me.y, hit = false;
  const path = [];
  while (inBounds(x + delta[0], y + delta[1])) {
    x += delta[0]; y += delta[1];
    path.push([x, y]);
    const cloneAt = op?.clone && op.clone.x === x && op.clone.y === y;
    const foeAt   = op && op.x === x && op.y === y;
    if (cloneAt || foeAt) { hit = true; break; }
  }
  if (!path.length) {
    pushStateFrame(tl, [{ kind: "wall_bump", from: slot, dir }], SMALL_DELAY_MS);
    return;
  }
  me.x = path[path.length - 1][0];
  me.y = path[path.length - 1][1];
  // istý zásah reálneho hráča (aj stacknutého páru, aj do obrany) — odhaľ labyrint pred behom
  if (op && op.x === me.x && op.y === me.y) revealLabyrinths(tl);
  pushStateFrame(tl, [{ kind: "vamp_charge", from: slot, dir }, ...trackSteps(slot, path)], MOVE_DELAY_MS);
  if (!hit) return; // dobehla na okraj bez terča — len presun
  // Vampire seká A1 (jednotný úder podľa attack guide), Onryō pôvodný vampstrike (alias Attack_3)
  pushStateFrame(tl, [{ kind: "vamp_strike", from: slot, cell: [me.x, me.y],
    ...(me.char === "countess" ? { anim: "va1" } : {}) }], WOLF_STRIKE_MS);
  vampMeleeLand(slot, raw, VAMP_CHARGE_BONUS, tl, false, pBonus); // hráč / klon-návnada / stacknutý pár rieši helper
}

// Luffy GEAR 3 basic = Giant Pistol s priťiahnutím súpera. Luffy STOJÍ; naťahovacia ruka letí ortogonálne
// po prvú figúru súpera (klon-návnada / hráč). Pri zásahu dmg (falloff ako base 3/2/1) + PRIŤIAHNE súpera
// na bunku hneď vedľa Luffyho (pos+dir). Obrana (shield/mirror) blokuje dmg AJ priťiahnutie.
const GP_WINDUP_MS = Math.round(360 * ANIM_SLOW); // nafúknutie pästí (Recharge2)
const GP_REACH_MS  = Math.round(320 * ANIM_SLOW); // naťahovanie ruky (L_GiantPunch)
function doLuffyGear3Basic(slot, dir, tl) {
  const me = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
  if (!delta) { pushInvalid(tl, slot); return; }
  if (me.mana < BASIC_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= BASIC_COST;
  const pBonus = powerBoost(slot, tl);

  // scan po prvú figúru súpera (hráč / klon-návnada) alebo okraj
  let x = me.x, y = me.y, dist = 0, hit = false, cloneDecoy = false;
  while (inBounds(x + delta[0], y + delta[1])) {
    x += delta[0]; y += delta[1]; dist++;
    if (op && op.x === x && op.y === y) { hit = true; break; }
    if (op?.clone && op.clone.x === x && op.clone.y === y) { hit = true; cloneDecoy = true; break; }
  }
  const target = [x, y];

  // nafúknutie pästí + naťahovanie ruky (FX na klientovi kreslí gumu + L_GiantPunch podľa origin/target/dir)
  pushStateFrame(tl, [{ kind: "luffy_gp", phase: "windup", from: slot, dir, ms: GP_WINDUP_MS }], GP_WINDUP_MS);
  pushStateFrame(tl, [{ kind: "luffy_gp", phase: "reach", from: slot, dir, origin: [me.x, me.y], target, hit, ms: GP_REACH_MS }], GP_REACH_MS);

  if (!hit) { pushStateFrame(tl, [{ kind: "luffy_gp", phase: "retract", from: slot, dir }], SMALL_DELAY_MS); return; }

  const dmg = Math.max(1, BASIC_DMG_MAX - dist) * dealMul(slot) * labyrinthMul(slot) + pBonus;

  // klon-návnada (mimo majiteľovej bunky): pohltí úder, žiadny pull
  if (cloneDecoy) {
    applyHitOnClone(opS, dmg, tl, "luffy_gp");
    pushStateFrame(tl, [{ kind: "luffy_gp", phase: "retract", from: slot, dir }], SMALL_DELAY_MS);
    return;
  }

  // reálny hráč: istý zásah → odhaľ labyrint pred úderom; obrana sa vyhodnotí v applyHit
  revealLabyrinths(tl);
  const defended = op.shield || op.mirror; // shield/mirror blokuje dmg AJ pull
  applyHit(opS, dmg, tl, "luffy_gp", false, pBonus);

  // PRIŤIAHNUTIE: len keď zásah dopadol (nebránený) a súper žije — na bunku hneď vedľa Luffyho.
  // Inak (obrana / smrť / už stojí vedľa) sa ruka len STIAHNE späť — klient tak vždy korektne uzavrie
  // súvislú naťahovaciu ruku (žiadne visiace držanie po zásahu).
  if (!defended && op.hp > 0) {
    const px = me.x + delta[0], py = me.y + delta[1];
    if (px !== op.x || py !== op.y) {
      const from = [op.x, op.y];
      op.x = px; op.y = py;
      pushStateFrame(tl, [{ kind: "luffy_pull", from: slot, foe: opS, fromCell: from, toCell: [px, py], dir }], MOVE_DELAY_MS);
      return;
    }
  }
  pushStateFrame(tl, [{ kind: "luffy_gp", phase: "retract", from: slot, dir }], SMALL_DELAY_MS);
}

// Luffy SPECIAL = pohyb-a-úder ako šachová figúra. Base = DÁMA (4 dmg, Special_7 roll-bounce), gear3 = VEŽA
// (8 dmg, balón + Special_2 impact). Cieľová bunka na platnej línii (aj vlastná); Luffy sa NA ňu dogúľa a dá
// dmg tomu, kto na nej stojí (súper / klon). Ide cez obrany ako každý dmg special.
const LUFFY_SPECIAL_DMG = { base: 4, gear3: 8 };
const LUFFY_ROLL_MS = Math.round(700 * ANIM_SLOW);   // gear3 balón roll
const LUFFY_TRAVEL_MS = Math.round(340 * ANIM_SLOW); // base: dogúľanie k bunke (run/roll)
const LUFFY_CHOMP_MS  = Math.round(340 * ANIM_SLOW); // base: cvaknutie NA bunke
function luffySpecialReaches(fx, fy, tx, ty, form) {
  if (!inBounds(tx, ty)) return false;
  const dx = tx - fx, dy = ty - fy;
  if (dx === 0 && dy === 0) return true;             // vlastná bunka je platný cieľ
  const rook = dx === 0 || dy === 0;
  const diag = Math.abs(dx) === Math.abs(dy);
  return form === "gear3" ? rook : (rook || diag);   // gear3 = veža, base = dáma
}
function luffyLinePath(fx, fy, tx, ty) {
  const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
  const path = []; let x = fx, y = fy;
  while ((x !== tx || y !== ty) && path.length < 8) { x += dx; y += dy; path.push([x, y]); }
  return path;
}
function doLuffySpecial(slot, tl, cell) {
  const me = game.players[slot];
  const opS = other(slot);
  const op = game.players[opS];
  if (me.mana < SPECIAL_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !luffySpecialReaches(me.x, me.y, cell.x, cell.y, me.form)) { pushInvalid(tl, slot); return; }
  me.mana -= SPECIAL_COST;
  const pBonus = powerBoost(slot, tl);
  const gear3 = me.form === "gear3";
  const dmg = LUFFY_SPECIAL_DMG[gear3 ? "gear3" : "base"] * dealMul(slot) * labyrinthMul(slot) + pBonus;

  const foeOnTarget = !!(op && op.x === cell.x && op.y === cell.y);
  const cloneOnTarget = !foeOnTarget && !!(op?.clone && op.clone.x === cell.x && op.clone.y === cell.y);

  if (foeOnTarget) revealLabyrinths(tl); // istý zásah reálneho hráča → odhaľ labyrint pred rolovaním

  const willHit = foeOnTarget || cloneOnTarget; // na cieľovej bunke stojí súper/klon (aj keď má štít/mirror)
  const path = luffyLinePath(me.x, me.y, cell.x, cell.y);
  if (gear3) {
    // gear3: najprv PREMENA na guľu NA ŠTARTOVACEJ bunke (Luffy ešte nehýbe), POTOM dogúľanie k cieľu, potom VÝBUCH
    pushStateFrame(tl, [{ kind: "luffy_ball_form", from: slot }], LUFFY_TRAVEL_MS);
    me.x = cell.x; me.y = cell.y;
    pushStateFrame(tl, [{ kind: "luffy_roll", from: slot, form: "gear3", target: [cell.x, cell.y], ...trackSteps(slot, path) }], LUFFY_ROLL_MS);
    pushStateFrame(tl, [{ kind: "luffy_explode", from: slot, target: [cell.x, cell.y], hit: willHit }], LUFFY_CHOMP_MS);
  } else {
    // base: najprv DOGÚĽANIE (beh/kotúľ) k bunke, potom CVAKNUTIE zubami NA bunke (hit=zastaví na cvaknutí)
    me.x = cell.x; me.y = cell.y;
    pushStateFrame(tl, [{ kind: "luffy_roll", from: slot, form: "base", target: [cell.x, cell.y], ...trackSteps(slot, path) }], LUFFY_TRAVEL_MS);
    pushStateFrame(tl, [{ kind: "luffy_chomp", from: slot, target: [cell.x, cell.y], hit: willHit }], LUFFY_CHOMP_MS);
  }

  if (foeOnTarget) applyHit(opS, dmg, tl, "luffy_special", false, pBonus);
  else if (cloneOnTarget) applyHitOnClone(opS, dmg, tl, "luffy_special");
  // miss = čistý presun (roll/chomp frame už odohral)
}

// Countess/Onre sú IMÚNNE voči mirroru: súperov mirror sa voči ich dmg správa ako obyčajný štít
// (bloklne celý dmg, nič neodráža; spotrebuje sa bežne ako obrana krytej akcie)
function mirrorImmune(atkSlot) {
  return !!VAMP_CHARS[game.players[atkSlot]?.char];
}

/* ---- Pasca (Countess/Onre special) ---- */
// zber buniek, ktorými figúry prešli počas PRÁVE vykonávanej akcie (napĺňajú trackSteps/trackCloneSteps);
// null mimo vyhodnocovania akcie — pasca sa triggeruje až PO úplnom dokončení súperovej akcie
let actionSteps = null;

/* ---- Jotaro THE WORLD (time-stop) ---- */
// sentinel z doAction hore do runRoundLoop: kolo sa pozastaví a čaká na klientove timestop_actions
const PAUSE = Symbol("timestop_pause");
// beží zamrazená trojica Jotarových akcií? (súper zmrznutý, jeho zásahy sa len OHLASujú a kumulujú)
function frozenActive() { return game.timestop?.mode === "frozen"; }
// zmrazený zásah na súpera — NEmeň HP, len ohlás label (ts_hit / ts_mirror ak je nabitý mirror) a zaeviduj raw;
// dmg dopadne kumulatívne (jeden hit s parts) pri obnovení času (applyTimestopResume). raw už obsahuje dealMul (D11).
function noteFrozenHit(tl, targetSlot, raw, kind) {
  const ts = game.timestop;
  if (!ts) return;
  ts.hits.push({ raw, kind });
  pushStateFrame(tl, [{ kind: ts.foeMirror ? "ts_mirror" : "ts_hit", target: targetSlot, dmg: raw, atk: kind }], SMALL_DELAY_MS);
}
// zmrazený zásah na súperovho tieňového klona — odlož clone_die na obnovenie času (žiadny okamžitý poof)
function noteFrozenClone(ownerSlot) {
  const ts = game.timestop; const o = game.players[ownerSlot];
  if (ts && o?.clone) ts.cloneEvents.push({ ownerSlot, cell: [o.clone.x, o.clone.y] });
}

function randomTrapCell() {
  const c = pickCell(() => true);
  return c ? { x: c.x, y: c.y } : null;
}

// zánik pasce s viditeľnou deštrukciou — vidia ju OBAJA hráči (zámer: súper sa dozvie, že riziko pominulo)
function breakTrap(slot, tl) {
  const p = game.players[slot];
  if (!p?.trap) return;
  pushStateFrame(tl, [{ kind: "trap_break", from: slot, cell: [p.trap.x, p.trap.y] }], SMALL_DELAY_MS);
  p.trap = null;
}

// po dokončení akcie: (a) vlastný vstup/prechod majiteľa cez vlastnú pascu ju ZNIČÍ,
// (b) súperov vstup/prechod (aj jeho tieňovým klonom) ju TRIGGERNE. Teleport triggera je ďalší pohyb →
// môže reťazovo spustiť pascu druhej strany (Countess vs Onre); každá pasca sa triggerom spotrebuje,
// takže reťaz je konečná.
function resolveTrapsAfterAction(tl) {
  let guard = 0;
  while (actionSteps && guard++ < 4) {
    const steps = actionSteps;
    actionSteps = { p1: [], p2: [], p1c: [], p2c: [] }; // pohyby triggera (teleport) sa zbierajú nanovo
    let any = false;
    for (const moverSlot of ["p1", "p2"]) {
      const moved = steps[moverSlot] || [];
      const movedClone = steps[moverSlot + "c"] || [];
      if (!moved.length && !movedClone.length) continue;
      const onCell = (t) => ([x, y]) => x === t.x && y === t.y;
      const p = game.players[moverSlot];
      if (p.trap && moved.some(onCell(p.trap))) breakTrap(moverSlot, tl);
      const ownerSlot = other(moverSlot);
      const o = game.players[ownerSlot];
      if (o.trap && (moved.some(onCell(o.trap)) || movedClone.some(onCell(o.trap)))) {
        if (triggerTrap(ownerSlot, tl)) any = true;
        if (winnerNow()) return;
      }
    }
    if (!any) break;
  }
}

// spustenie pasce: VŽDY ju spotrebuje a caster sa na bunku VŽDY teleportne; triggerovaný
// melee úder (3 dmg + bonus) už nestojí ďalšiu manu. Súper, čo bunkou len prebehol, dostane
// úder naprázdno. Petrifikovaný caster netriggeruje —
// súperov prechod pascu ZNIČÍ (rovnaká deštrukcia ako vlastný vstup). Vracia true, ak prebehol teleport.
function triggerTrap(ownerSlot, tl) {
  const o = game.players[ownerSlot];
  const foeS = other(ownerSlot);
  const foe = game.players[foeS];
  const cell = o.trap;
  o.trap = null; // trigger pascu vždy spotrebuje
  if (o.stone > 0 || o.hp <= 0) {
    pushStateFrame(tl, [{ kind: "trap_break", from: ownerSlot, cell: [cell.x, cell.y] }], SMALL_DELAY_MS);
    return false;
  }
  // istý zásah reálneho hráča (aj stacknutého páru s klonom, aj do štítu/mirror-bloku) odhalí prípadný
  // labyrint PRED animáciou triggera; whiff naprázdno ani zabitý klon-návnada labyrint neodhaľujú/nekončia
  if (foe && foe.x === cell.x && foe.y === cell.y) revealLabyrinths(tl);
  // pasca sa rozžiari — od tohto momentu ju vidia OBAJA (súper sa dozvedá, kde bola)
  pushStateFrame(tl, [{ kind: "trap_trigger", from: ownerSlot, cell: [cell.x, cell.y] }], SMALL_DELAY_MS);
  // teleport VŽDY: out na pôvodnej bunke → in na bunke pasce (thread labyrintu ráta aj teleport bunku)
  pushStateFrame(tl, [{ kind: "trap_tp_out", from: ownerSlot }], TELEPORT_OUT_MS);
  o.x = cell.x; o.y = cell.y;
  pushStateFrame(tl, [{ kind: "trap_tp_in", from: ownerSlot }, ...trackSteps(ownerSlot, [[cell.x, cell.y]])], TELEPORT_IN_MS);
  // trigger úder: Countess = A1 (jednotná choreografia s melee), Onre = Attack_1 — jeho zjavenie
  // s výkrikom (Scream) hrá klient už počas trap_tp_in framu; dmg dopadne až po údere
  pushStateFrame(tl, [{ kind: "vamp_strike", from: ownerSlot, cell: [cell.x, cell.y],
    anim: o.char === "countess" ? "va1" : "vattack1" }], VAMP_TRAP_STRIKE_MS);
  const raw = VAMP_TRAP_DMG * dealMul(ownerSlot) * labyrinthMul(ownerSlot);
  // trap-melee je akcia castera mimo resolveTurn slučky → zásah si spotrebuje súperovu obranu sám
  // (consumeDefense). Heal beaty A2→A3→A4 + doplnenie HP / mana drain rieši vampBonus vnútri helpera;
  // stacknutý pár Naruto+klon: klon pohltí CLONE_DMG, zvyšok prejde na Naruta a bonus je z toho zvyšku.
  const hitSomething = vampMeleeLand(ownerSlot, raw, VAMP_TRAP_BONUS, tl, true);
  if (!hitSomething) pushStateFrame(tl, [], SMALL_DELAY_MS); // súper bunkou len prebehol — úder naprázdno
  return true;
}

// Výstupný násobič dmg: Last Hope ultra mód = 4×, Last Stand buff = 2×, inak 1×.
// Prijatý dmg sa zaokrúhľuje na floor(½) pri Last Stand aj Last Hope (½ chráni 1-HP Last Hope hráča pred dmg tile).
function dealMul(slot)      { const p = game.players[slot]; return p.lastHopeBuff ? 4 : p.lastStandBuff ? 2 : 1; }
function recvDmg(slot, dmg) { const p = game.players[slot]; return (p.lastStandBuff || p.lastHopeBuff) ? Math.floor(dmg / 2) : dmg; }
// 2× VÝSTUPNÝ dmg pre hráča s maze buffom (ten, čo úspešne priamym castom zaklial súpera do labyrintu).
// Aplikuje sa na raw pred applyHit → ak je Minotaurov útok odrazený, doubled dmg sa vráti späť naňho.
// mazeBuff nezíska mirror-lovec (labyrint cez odraz) ani prekliaty Minotaur → presne cielené na hráča Minotaura.
function labyrinthMul(slot) { return game.players[slot]?.mazeBuff ? 2 : 1; }

// akýkoľvek zásah AKCIOU medzi hráčmi ukončí labyrint (oboch pri mirror matchi) — počíta sa aj
// zablokovaný/odrazený zásah (applyHit/applyPetrify/applyLabyrinth sa volajú len keď akcia trafila);
// tile damage ide mimo applyHit, takže labyrint neukončuje. Volá sa až PO zásahových frame-och
// (block/odraz/hit + úbytok HP) — ESCAPED a rozsvietenie arény prídu po dohratí zásahu; odhalenie
// súpera prebehlo už pred animáciou akcie (revealLabyrinths), vtedy zanikla aj niť s obrysom.
function endLabyrinths(tl) {
  for (const slot of ["p1", "p2"]) {
    const p = game.players[slot];
    if (!p.labyrinth) continue;
    p.labyrinth = false;
    p.labReveal = false;
    p.thread = [];
    p.threadMark = null;
    game.players[other(slot)].mazeBuff = false; // labyrint skončil → kaster stráca 2× dmg
    pushStateFrame(tl, [{ kind: "labyrinth_end", target: slot }], SMALL_DELAY_MS);
  }
}

// Ak akcia labyrint ISTO ukončí (zásah padne — počíta sa aj do štítu/zrkadla), odhalenie prebehne
// ešte PRED jej animáciou: labReveal zruší redakciu aj hmlu (klient zjaví skrytého súpera fade-om
// a odkryje jeho widget — HP/mana sú opäť viditeľné), samotný labyrinth flag ale beží ďalej,
// takže aréna ostáva stmavená až po labyrinth_end. Niť a obrys zanikajú už pri odhalení,
// aby ich lovec nevidel ani na okamih. Zásah je deterministický — pozície sa počas animácie nemenia.
function revealLabyrinths(tl) {
  if (frozenActive()) return; // THE WORLD (bod 8): počas zamrazenia sa labyrint neodhaľuje — odklad na obnovenie času
  for (const slot of ["p1", "p2"]) {
    const p = game.players[slot];
    if (!p.labyrinth || p.labReveal) continue;
    p.labReveal = true;
    p.thread = [];
    p.threadMark = null;
    pushStateFrame(tl, [{ kind: "labyrinth_reveal", target: slot }], LAB_REVEAL_MS);
  }
}

// aplikuje zásah cez prípadné obrany obrancu (shield blokuje celý dmg, mirror ho odrazí do útočníka)
// labyrint končí až PO dohratí zásahovej animácie (block/odraz/hit + úbytok HP) — odhalenie súpera
// už predtým zabezpečil revealLabyrinths (labReveal), takže tieto framy sa hrajú neredigované.
// fromClone: zásah pochádza od tieňového klona útočníka — mirror odraz vtedy zničí KLONA
// (nie HP majiteľa); Narutova a klonova strela sú jedna paralelná akcia, obrana neguje obe.
// Escanor pride: poznač „dostal zásah od súpera" — volá sa VŠADE, kde hráčovi klesá HP kvôli súperovi
// (priamy dopad, stacknutý pár, zóna/démon aj odraz vlastného útoku od mirroru). Tile/IK dmg a statusy
// (petrify/banish) sa NEpočítajú. Vyhodnotí sa na konci kola v resolveTurn (−1 pride), flag sa tam nuluje.
function notePrideHit(slot) {
  const p = game.players[slot];
  if (p.char === "escanor") p.prideHit = true;
}

// bonus = POWER tile prídavok obsiahnutý v rawDmg — na NEKRYTOM zásahu sa pripne na hit frame (klient
// ho vypíše ako samostatný zlatý „-2" float vedľa základu); pri bloku/odraze sa rozpis nepripína
// (mirror odráža plný dmg vrátane bonusu ako jedno číslo).
function applyHit(targetSlot, rawDmg, tl, kind = "basic", fromClone = false, bonus = 0) {
  // THE WORLD: zmrazený zásah na súpera sa len ohlási a kumuluje (dopadne pri obnovení času)
  if (frozenActive() && targetSlot === game.timestop.foeSlot && !fromClone) { noteFrozenHit(tl, targetSlot, rawDmg, kind); return; }
  const t = game.players[targetSlot];
  if (t.shield) {
    pushStateFrame(tl, [{ kind: "block", target: targetSlot, gold: !!t.shieldGold }], SMALL_DELAY_MS);
    endLabyrinths(tl); // aj zablokovaný zásah ukončuje labyrint
    return;
  }
  if (t.mirror) {
    // Countess/Onre: imunita voči mirroru — súperov mirror sa voči ich dmg správa ako OBYČAJNÝ ŠTÍT
    // (blok frame, nič sa neodráža; obrana sa spotrebuje bežne v resolveTurn/triggerTrap)
    if (mirrorImmune(other(targetSlot))) {
      pushStateFrame(tl, [{ kind: "block", target: targetSlot, gold: !!t.mirrorGold }], SMALL_DELAY_MS);
      endLabyrinths(tl); // aj mirror-imunitou zablokovaný zásah je zásah — labyrint končí
      return;
    }
    // odrazený dmg ide „surovo" — neaplikuje sa cez útočníkove obrany a nedá sa znova odraziť
    // poradie: najprv mirror frame (HP ešte nezmenené), až potom hit frame s poklesom HP útočníka
    const atkSlot = other(targetSlot);
    const atk = game.players[atkSlot];
    // delay = čas dopadu beamu (nie SMALL_DELAY_MS), aby dmg padol hneď ako beam zasiahne — bez medzery;
    // atk/dmg riadia hrúbku a štýl beamu na klientovi (basic podľa dmg, melee hrubý, special fialovo prepletený)
    pushStateFrame(tl, [{ kind: "mirror", target: targetSlot, dmg: rawDmg, atk: kind, gold: !!t.mirrorGold }], MIRROR_BEAM_MS);
    if (fromClone) {
      // odraz klonovej akcie letí do klona a rozplynie ho — akcia však na obrancu dopadla, labyrint končí
      killClone(atkSlot, tl);
      endLabyrinths(tl);
      return;
    }
    const d = recvDmg(atkSlot, rawDmg); // ½ ak má útočník (príjemca odrazu) last stand buff
    atk.hp = Math.max(0, atk.hp - d);
    notePrideHit(atkSlot); // odraz od mirroru je tiež zásah od súpera
    pushStateFrame(tl, [{ kind: "hit", target: atkSlot, dmg: d }], SMALL_DELAY_MS);
    endLabyrinths(tl); // odrazený zásah ukončuje labyrint — až po dopade odrazu
    return;
  }
  const d = recvDmg(targetSlot, rawDmg); // ½ ak má obranca last stand buff (2× maze buff je už v rawDmg)
  t.hp = Math.max(0, t.hp - d);
  notePrideHit(targetSlot);
  const hitFx = { kind: "hit", target: targetSlot, dmg: d };
  // POWER bonus rozpis len keď polovičné prijímanie (Last Stand ½) čísla neskreslí — inak jeden súčet
  if (bonus > 0 && d === rawDmg && d >= bonus) hitFx.bonus = bonus;
  pushStateFrame(tl, [hitFx], SMALL_DELAY_MS);
  endLabyrinths(tl); // labyrint končí až po dopade zásahu a úbytku HP
}

// Viac SÚBEŽNÝCH zásahov jednou akciou (stacknutý Naruto+klon strieľa/seká rovnakým smerom z jednej
// bunky) na NEKRYTÉ HP súpera = JEDEN úder so súčtom dmg — klient ho podľa `parts` vypíše ako „2+2"
// a zanimuje ako jeden zásah (nie dva za sebou). Pri obrane (štít/mirror) vráti false → volajúci
// nechá každú strelu prejsť applyHit-om zvlášť (obrana rieši každú osobitne). Vráti true ak spracoval.
function applyStackedHit(targetSlot, raws, tl, kind = "basic", bonus = 0) {
  // THE WORLD: každý zmrazený zásah ohlás samostatne (kumulát pri obnovení); vracia true = spracované
  if (frozenActive() && targetSlot === game.timestop.foeSlot) { for (const r of raws) noteFrozenHit(tl, targetSlot, r, kind); return true; }
  const t = game.players[targetSlot];
  if (raws.length < 2 || t.shield || t.mirror) return false; // jediný zásah / obrana → rieši applyHit
  const parts = raws.map(r => recvDmg(targetSlot, r)); // ½ pri Last Stand/Hope (2× maze je už v raw)
  const total = parts.reduce((a, b) => a + b, 0);
  t.hp = Math.max(0, t.hp - total);
  notePrideHit(targetSlot);
  const hitFx = { kind: "hit", target: targetSlot, dmg: total, parts };
  // POWER bonus je vnútri PRVEJ časti (majiteľova strela/sek — klon boost nemá); rozpis len bez ½ skreslenia
  if (bonus > 0 && total === raws.reduce((a, b) => a + b, 0) && parts[0] >= bonus) hitFx.bonus = bonus;
  pushStateFrame(tl, [hitFx], SMALL_DELAY_MS);
  endLabyrinths(tl); // súbežný zásah tiež ukončuje labyrint (odhalenie prebehlo pred letom)
  return true;
}

// Zásah JEDNEJ akcie do STACKNUTÉHO páru Naruto+klon so zdieľanou obranou (obe figúry na jednej bunke).
// Obrana zareaguje ako JEDNA postava v JEDNOM beate: shield = jeden block frame; mirror = JEDEN lúč z bunky
// páru a útočník dostane odraz OBOCH figúr NARAZ — jeden hit frame s parts [n, n] (klient vypíše rozpis
// v jednom floate a HP klesne naraz). fromClone (strela pochádza od útočníkovho klona): odraz z páru
// rozplynie útočníkovho klona a HP zásah nesie len jednu časť — zachováva pôvodnú kombináciu
// applyHitOnClone (odraz do HP) + applyHit (fromClone → killClone), len v jednom spoločnom beate.
// Volať LEN keď je obrana armed (o.shield || o.mirror) a klon stojí na majiteľovej bunke.
function applyHitPairDefended(ownerSlot, rawDmg, tl, kind = "basic", fromClone = false) {
  const o = game.players[ownerSlot];
  // THE WORLD: zmrazený zásah na stacknutý pár — ohlás hráčov zásah + odlož clone_die (obrana/mirror sa
  // vyhodnotí kumulatívne pri obnovení cez ts.foeShield/foeMirror)
  if (frozenActive() && ownerSlot === game.timestop.foeSlot) { noteFrozenHit(tl, ownerSlot, rawDmg, kind); noteFrozenClone(ownerSlot); return; }
  const atkSlot = other(ownerSlot);
  const atk = game.players[atkSlot];
  if (o.shield) {
    pushStateFrame(tl, [{ kind: "block", target: ownerSlot, gold: !!o.shieldGold }], SMALL_DELAY_MS);
    endLabyrinths(tl);
    return;
  }
  // mirror imunita Countess/Onre — mirror stacknutého páru sa správa ako štít (jeden blok, nič sa neodráža)
  if (mirrorImmune(atkSlot)) {
    pushStateFrame(tl, [{ kind: "block", target: ownerSlot, gold: !!o.mirrorGold }], SMALL_DELAY_MS);
    endLabyrinths(tl);
    return;
  }
  pushStateFrame(tl, [{ kind: "mirror", target: ownerSlot, dmg: rawDmg, atk: kind, gold: !!o.mirrorGold }], MIRROR_BEAM_MS);
  if (fromClone) {
    const d = recvDmg(atkSlot, rawDmg);
    atk.hp = Math.max(0, atk.hp - d);
    notePrideHit(atkSlot);
    const fx = [{ kind: "hit", target: atkSlot, dmg: d }];
    if (atk.clone) { fx.push({ kind: "clone_die", target: atkSlot, cell: [atk.clone.x, atk.clone.y] }); atk.clone = null; }
    pushStateFrame(tl, fx, SMALL_DELAY_MS);
    endLabyrinths(tl);
    return;
  }
  const parts = [recvDmg(atkSlot, rawDmg), recvDmg(atkSlot, rawDmg)];
  const total = parts[0] + parts[1];
  atk.hp = Math.max(0, atk.hp - total);
  notePrideHit(atkSlot);
  pushStateFrame(tl, [{ kind: "hit", target: atkSlot, dmg: total, parts }], SMALL_DELAY_MS);
  endLabyrinths(tl);
}

// Jedna akcia zasiahne obrancu (ownerSlot) a VOLITEĽNE aj jeho tieňového klona (includeClone) — keďže Naruto
// a klon sú „tá istá postava" so zdieľanou obranou, ich reakcie idú do SPOLOČNÝCH beatov (blok / mirror-lúč /
// hit sa prehrajú NARAZ, nie sekvenčne). ownerDmg = dmg na Naruta; klon STACKNUTÝ na jeho bunke z neho
// pohltí CLONE_DMG (bez obrany), klon-návnada na vlastnej bunke netlmí nič.
function applyHitBoth(ownerSlot, ownerDmg, tl, kind, includeClone, bonus = 0) {
  const o = game.players[ownerSlot];
  // THE WORLD: zmrazený zónový zásah — ohlás hráčov zásah (pri stacknutom klonovi zníž o CLONE_DMG soak)
  // + odlož clone_die; dopadne kumulatívne pri obnovení času
  if (frozenActive() && ownerSlot === game.timestop.foeSlot) {
    const withCl = !!(includeClone && o.clone);
    const stacked = withCl && o.clone.x === o.x && o.clone.y === o.y;
    noteFrozenHit(tl, ownerSlot, stacked ? Math.max(0, ownerDmg - CLONE_DMG) : ownerDmg, kind);
    if (withCl) noteFrozenClone(ownerSlot);
    return;
  }
  const withClone = !!(includeClone && o.clone);
  const cloneCell = withClone ? [o.clone.x, o.clone.y] : null;
  const atkSlot = other(ownerSlot);
  const atk = game.players[atkSlot];

  if (o.shield) {
    // block na Narutovi AJ na klonovej bunke v jednom beate → štít praskne na oboch naraz
    const fx = [{ kind: "block", target: ownerSlot, gold: !!o.shieldGold }];
    if (withClone) fx.push({ kind: "block", target: ownerSlot, cell: cloneCell, gold: !!o.shieldGold });
    pushStateFrame(tl, fx, SMALL_DELAY_MS);
    endLabyrinths(tl);
    return;
  }
  if (o.mirror) {
    // mirror imunita Countess/Onre — obrana zareaguje ako štít na oboch figúrach v jednom beate
    if (mirrorImmune(atkSlot)) {
      const fx = [{ kind: "block", target: ownerSlot, gold: !!o.mirrorGold }];
      if (withClone) fx.push({ kind: "block", target: ownerSlot, cell: cloneCell, gold: !!o.mirrorGold });
      pushStateFrame(tl, fx, SMALL_DELAY_MS);
      endLabyrinths(tl);
      return;
    }
    const cloneRaw = ownerDmg; // klon dostal tú istú akciu ako Naruto → jeho mirror odrazí PLNÝ dmg (nie flat 1)
    // lúče oboch naraz (jeden beat), potom oba dopady na útočníka naraz (jeden beat)
    const beams = [{ kind: "mirror", target: ownerSlot, dmg: ownerDmg, atk: kind, gold: !!o.mirrorGold }];
    if (withClone) beams.push({ kind: "mirror", target: ownerSlot, cell: cloneCell, dmg: cloneRaw, atk: kind, gold: !!o.mirrorGold });
    pushStateFrame(tl, beams, MIRROR_BEAM_MS);
    const dO = recvDmg(atkSlot, ownerDmg);
    const dC = withClone ? recvDmg(atkSlot, cloneRaw) : 0;
    atk.hp = Math.max(0, atk.hp - dO - dC);
    notePrideHit(atkSlot);
    // oba odrazy dopadnú na útočníka ako JEDEN úder so súčtom a rozpisom (klient: jeden float „-n -n HP"),
    // nie dva samostatné floaty — HP klesne naraz
    const hits = dC > 0
      ? [{ kind: "hit", target: atkSlot, dmg: dO + dC, parts: [dO, dC] }]
      : [{ kind: "hit", target: atkSlot, dmg: dO }];
    pushStateFrame(tl, hits, SMALL_DELAY_MS);
    endLabyrinths(tl);
    return;
  }
  // bez obrany: klon STACKNUTÝ na majiteľovej bunke pohltí CLONE_DMG zo zásahu a majiteľ berie len
  // zvyšok (rovnaké pravidlo ako prestrelený stacknutý pár pri streľbe/melee); klon-návnada zasiahnutý
  // zónou na VLASTNEJ bunke nič netlmí (majiteľ berie plný dmg) — klon zaniká, VŠETKO v jednom beate
  const stacked = withClone && o.clone.x === o.x && o.clone.y === o.y;
  const raw = stacked ? Math.max(0, ownerDmg - CLONE_DMG) : ownerDmg;
  const d = recvDmg(ownerSlot, raw);
  o.hp = Math.max(0, o.hp - d);
  if (d > 0) notePrideHit(ownerSlot);
  const fx = [];
  if (d > 0) {
    const hitFx = { kind: "hit", target: ownerSlot, dmg: d };
    // POWER bonus rozpis (samostatný „-2" float) len keď ho ½ prijímanie/klonov soak neskreslí
    if (bonus > 0 && d === raw && d >= bonus) hitFx.bonus = bonus;
    fx.push(hitFx);
  }
  if (withClone) { fx.push({ kind: "clone_die", target: ownerSlot, cell: cloneCell }); o.clone = null; }
  if (!fx.length) fx.push({ kind: "hit", target: ownerSlot, dmg: 0 }); // poistka: beat nesmie byť prázdny
  pushStateFrame(tl, fx, SMALL_DELAY_MS);
  endLabyrinths(tl);
}

// skamenenie cez obrany obrancu — zrkadlí applyHit: shield ho zablokuje (a spotrebuje sa),
// mirror ho odrazí na Medúzu (surovo — odrazený kameň sa už nedá blokovať ani znova odraziť)
function applyPetrify(targetSlot, tl) {
  const t = game.players[targetSlot];
  if (t.shield) {
    pushStateFrame(tl, [{ kind: "block", target: targetSlot, gold: !!t.shieldGold }], SMALL_DELAY_MS);
    endLabyrinths(tl); // zasahujúci (hoci zablokovaný) petrify je tiež zásah — labyrint končí po block animácii
    return;
  }
  if (t.mirror) {
    const atkSlot = other(targetSlot);
    pushStateFrame(tl, [{ kind: "mirror", target: targetSlot, dmg: 0, atk: "special", gold: !!t.mirrorGold }], MIRROR_BEAM_MS);
    petrify(atkSlot, tl);
    endLabyrinths(tl); // labyrint končí až po dopade odrazeného skamenenia
    return;
  }
  petrify(targetSlot, tl);
  endLabyrinths(tl); // labyrint končí až po dohratí skamenenia
}
function petrify(slot, tl) {
  game.players[slot].stone = STONE_ACTIONS;
  pushStateFrame(tl, [{ kind: "petrify", target: slot }], SMALL_DELAY_MS);
}

// labyrint cez obrany obrancu — zrkadlí applyPetrify: shield ho zablokuje (a spotrebuje sa),
// mirror ho odrazí na Minotaura (v labyrinte skončí sám kaster — oslepne a niť ťahá on)
function applyLabyrinth(targetSlot, tl) {
  const t = game.players[targetSlot];
  if (t.shield) {
    pushStateFrame(tl, [{ kind: "block", target: targetSlot, gold: !!t.shieldGold }], SMALL_DELAY_MS);
    endLabyrinths(tl); // zasahujúci (hoci zablokovaný) labyrint je tiež zásah — prípadný bežiaci labyrint kastera končí
    return;
  }
  // starý labyrint musí skončiť PRED novým zakliatím (nikdy nebežia dva naraz) — až po prípadnej odrazovej animácii
  if (t.mirror) {
    const atkSlot = other(targetSlot);
    pushStateFrame(tl, [{ kind: "mirror", target: targetSlot, dmg: 0, atk: "special", gold: !!t.mirrorGold }], MIRROR_BEAM_MS);
    endLabyrinths(tl);
    loseInLabyrinth(atkSlot, tl);
    return;
  }
  endLabyrinths(tl);
  loseInLabyrinth(targetSlot, tl);
  // priamy (neodrazený) cast → KASTER (ten, čo hrá Minotaura) získa maze buff: 2× dmg + imunita na Damage/IK
  // dlaždice, kým labyrint trvá. Pri odraze/štíte sa sem nedostaneme, takže mirror-lovec buff nezíska.
  game.players[other(targetSlot)].mazeBuff = true;
}
function loseInLabyrinth(slot, tl) {
  const p = game.players[slot];
  p.labyrinth = true;
  p.thread = [[p.x, p.y]]; // niť začína tam, kde postava stála pri zakliatí
  p.threadMark = null;
  pushStateFrame(tl, [{ kind: "labyrinth", target: slot }], SMALL_DELAY_MS);
}

// labyrint: prekliaty necháva niť na každom políčku, na ktoré vstúpi (dash aj cez medzibunku).
// threadMark = POSLEDNÉ políčko, kde sa niť a Minotaur stretli — vznikne oboma smermi:
// (a) Minotaur vstúpi na niť (aj prebehnutím dashom), (b) prekliaty dorastie niťou na bunku,
// kde Minotaur práve stojí. Prekliaty tam vidí jeho obrys. Vracia efekty k pohybovému frame-u.
function trackSteps(slot, cells) {
  // pasca (Countess/Onre): zbieraj bunky, ktorými figúra počas akcie prešla (vrátane teleportu triggera) —
  // resolveTrapsAfterAction z nich po dokončení akcie vyhodnotí vstup/prechod cez pascu
  if (actionSteps) actionSteps[slot].push(...cells.map(c => [...c]));
  const fx = [];
  const p = game.players[slot];
  const foeS = other(slot);
  const foe = game.players[foeS];
  if (p.labyrinth) {
    let mark = null;
    for (const [x, y] of cells) {
      if (!p.thread.some(([tx, ty]) => tx === x && ty === y)) p.thread.push([x, y]);
      if (foe && !foe.labyrinth && foe.x === x && foe.y === y) mark = [x, y]; // niť dorástla na Minotaurovu bunku
      // lovcov tieňový klon sa ráta tiež — prekliaty na jeho bunke uvidí siluetu (nevie, že je to klon)
      if (foe && !foe.labyrinth && foe.clone && foe.clone.x === x && foe.clone.y === y) mark = [x, y];
    }
    if (mark) {
      p.threadMark = mark;
      fx.push({ kind: "thread_mark", cell: mark, target: slot });
    }
  }
  if (foe?.labyrinth) {
    // lovec prechádza niťou → preblik na KAŽDEJ prejdenej niťovej bunke (nie len na poslednej);
    // threadMark ostane posledná bunka (tam silueta natrvalo ostane)
    for (const [x, y] of cells) {
      if (foe.thread.some(([tx, ty]) => tx === x && ty === y)) {
        foe.threadMark = [x, y];
        fx.push({ kind: "thread_mark", cell: [x, y], target: foeS }); // target = kto obrys uvidí
      }
    }
  }
  return fx;
}

function doShield(slot, tl) {
  const a = game.players[slot];
  // BLOCK tile: obrana sa na ňom nedá castnúť — prečiarknutie BEZ ceny (mana ostáva).
  // THE WORLD (D3): počas zamrazenia sú dlaždice inertné → shield sa armne aj z block tile.
  if (defenseBlockedBy(a) && !frozenActive()) { pushInvalid(tl, slot, SMALL_DELAY_MS, "blocked_shield"); return; }
  if (a.mana < SHIELD_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  a.mana -= SHIELD_COST;
  a.shield = true;
  a.shieldGold = false;
  pushStateFrame(tl, [{ kind: "shield", from: slot }], SMALL_DELAY_MS);
}

function doMirror(slot, tl) {
  const a = game.players[slot];
  // BLOCK tile: obrana sa na ňom nedá castnúť — prečiarknutie BEZ ceny (mana ostáva)
  if (defenseBlockedBy(a)) { pushInvalid(tl, slot, SMALL_DELAY_MS, "blocked_mirror"); return; }
  if (a.mana < MIRROR_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  a.mana -= MIRROR_COST;
  a.mirror = true;
  a.mirrorGold = false;
  pushStateFrame(tl, [{ kind: "mirror_on", from: slot }], SMALL_DELAY_MS);
}

// Jotaro Special 1 (v mirror slote): 4 many, smerový (left/right), 4 dmg na OBE diagonálne bunky strany.
// Cez obrany ako každý dmg special (shield blokuje, mirror odrazí 4). Zóna zasiahne súpera aj jeho klona
// (applyHitBoth). Prázdna zóna (útok z krajného stĺpca von) = wall-rule whiff (mana preč, choreografia, bez dmg).
function doJotaroS1(slot, dir, tl) {
  const actor = game.players[slot];
  if (!actor) return;
  if (dir !== "left" && dir !== "right") { pushInvalid(tl, slot); return; }
  if (actor.mana < JOTARO_S1_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  actor.mana -= JOTARO_S1_COST;
  const pBonus = powerBoost(slot, tl); // POWER tile: +2; spotreba pri použití (aj whiff/block/odraz)
  const cells = jotaroS1Cells(actor, dir);
  if (!cells.length) { // celá zóna mimo plochy → útok do steny (vykoná sa, mana preč, neprečiarkuje sa)
    pushStateFrame(tl, [{ kind: "special1", from: slot, dir, cells: [], offboard: true }], SPECIAL_BEAT_MS);
    return;
  }
  const foeS = other(slot);
  const foe  = game.players[foeS];
  const inZone = !!(foe && cells.some(([x, y]) => x === foe.x && y === foe.y));
  const cloneStruck = !!(foe?.clone && cells.some(([x, y]) => x === foe.clone.x && y === foe.clone.y));
  if (inZone) revealLabyrinths(tl); // istý zásah odhalí prípadný labyrint pred animáciou
  pushStateFrame(tl, [{ kind: "special1", from: slot, dir, cells }], SPECIAL_BEAT_MS);
  const dmg = JOTARO_S1_DMG * dealMul(slot) + pBonus;
  if (inZone) applyHitBoth(foeS, dmg, tl, "special", cloneStruck, pBonus);
  else if (cloneStruck) applyHitOnClone(foeS, dmg, tl, "special", false);
  else pushStateFrame(tl, [], SMALL_DELAY_MS);
}

// THE WORLD (Jotarov special pred prvým použitím) — jednorazový time-stop. Cast + zachytenie súperovej
// nabitej obrany, potom PAUZA (runRoundLoop pošle čiastočnú timeline a čaká na klientove timestop_actions).
// Mana gate (5) overil doSpecial. Vracia PAUSE sentinel.
function doJotaroWorld(slot, tl) {
  const actor = game.players[slot];
  const foeS = other(slot);
  const foe = game.players[foeS];
  actor.mana -= WORLD_COST;
  actor.worldUsed = true; // po THE WORLD sa special button natrvalo mení na Special 2 (prežíva swap)
  // cast: Star Platinum „menace" + celoplošný blik (ako Minotaur) + invert flash (globálny — vidia obaja);
  // nedá sa blokovať/odraziť. Po tomto frame plocha prestane blikať a čas sa zastaví (timestop_wait).
  const castCells = [];
  for (let y = 0; y < game.board.h; y++) for (let x = 0; x < game.board.w; x++) castCells.push([x, y]);
  pushStateFrame(tl, [{ kind: "timestop_start", from: slot, cells: castCells }], TIMESTOP_CAST_MS);
  // zachyť súperovu NABITÚ obranu (armed PRED castom) — NEspotrebuje sa castom (runRoundLoop preskočí
  // consumption), platí cez celé zamrazenie a vyhodnotí sa kumulatívne pri obnovení času (applyTimestopResume)
  game.timestop = {
    slot, foeSlot: foeS,
    foeShield: !!foe?.shield, foeShieldGold: !!foe?.shieldGold,
    foeMirror: !!foe?.mirror, foeMirrorGold: !!foe?.mirrorGold,
    hits: [], cloneEvents: [], mode: "waiting",
  };
  return PAUSE;
}

// zmrazené vykonanie 3 nových Jotarových akcií (frozen mode), potom obnovenie času a kumulatívna aplikácia
function runTimestopActions(queue) {
  const ts = game.timestop, ctx = game.roundCtx, tl = ctx.tl;
  ts.mode = "frozen";
  const slot = ts.slot;
  // actionSteps zámerne null (D4): pasce sa počas zamrazenia netriggerujú a prejdené bunky sa nezbierajú;
  // trackSteps ale niť labyrintu pletie ďalej (D5 — je to Jotarov reálny pohyb)
  actionSteps = null;
  for (const act of queue) {
    // frozen:true — klient túto akciu NEzaráta do round-scriptu (kurzor ostáva na THE WORLD), len ju animuje
    pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: act.type, dir: act.dir || null }, frozen: true }], 250);
    doAction(slot, act, tl); // frozen: zásah na súpera sa cez guardy v apply* len ohlási (ts_hit/ts_mirror)
    pushStateFrame(tl, [], ACTION_GAP_MS);
  }
  applyTimestopResume();
  // resume mohol niekoho zabiť (kumulatívny zásah / mirror odraz na Jotara) — prvá smrť končí hru
  if (winnerNow()) { ctx.ended = true; return finishRound(); }
  runRoundLoop(); // pokračuj zvyškom kola od uloženej pozície (ctx.i / ctx.slotIdx)
}

// obnovenie času: reveal (ak zásah + labyrint), timestop_end, potom JEDEN kumulatívny beat
// (block / mirror odraz / hit s parts / nič) podľa súperovej nabitej obrany a súčtu zmrazených zásahov.
function applyTimestopResume() {
  const ts = game.timestop, ctx = game.roundCtx, tl = ctx.tl;
  ts.mode = "applying"; // vypni frozen (frozenActive() false) — reveal/endLabyrinths a kumulatívny zásah bežia naživo
  const jslot = ts.slot, foeS = ts.foeSlot;
  const jo = game.players[jslot], foe = game.players[foeS];
  const anyEvent = ts.hits.length > 0 || ts.cloneEvents.length > 0;
  // istý zásah počas zamrazenia + beží labyrint → reveal PRED aplikačnými frame-ami (hra nesmie skončiť v hmle)
  if (anyEvent) revealLabyrinths(tl);
  pushStateFrame(tl, [{ kind: "timestop_end", from: jslot }], TIMESTOP_END_MS);

  // odložené klonové úmrtia (decoy/absorb) — poof pri obnovení
  for (const ev of ts.cloneEvents) {
    const o = game.players[ev.ownerSlot];
    if (o?.clone) { pushStateFrame(tl, [{ kind: "clone_die", target: ev.ownerSlot, cell: [o.clone.x, o.clone.y] }], SMALL_DELAY_MS); o.clone = null; }
  }

  if (ts.hits.length === 0) {
    // žiadny zásah na hráča (nanajvýš zomrel decoy klon) → nabitá obrana OSTÁVA (D1), labyrint (ak decoy) NEkončí
    game.timestop = null;
    return;
  }
  const parts = ts.hits.map(h => recvDmg(ts.foeShield ? foeS : (ts.foeMirror ? jslot : foeS), h.raw));
  const total = parts.reduce((a, b) => a + b, 0);
  const rawTotal = ts.hits.reduce((a, h) => a + h.raw, 0);

  if (ts.foeShield) {
    // shield platil cez celé zamrazenie: jeden block, 0 dmg, spotrebuj
    pushStateFrame(tl, [{ kind: "block", target: foeS, gold: ts.foeShieldGold }], SMALL_DELAY_MS);
    foe.shield = false; foe.shieldGold = false;
  } else if (ts.foeMirror) {
    // mirror: foe nezraniteľný + JEDEN kumulatívny odraz celého súčtu späť na Jotara
    pushStateFrame(tl, [{ kind: "mirror", target: foeS, dmg: rawTotal, atk: "special", gold: ts.foeMirrorGold }], MIRROR_BEAM_MS);
    foe.mirror = false; foe.mirrorGold = false;
    if (jo.shield) {
      // Jotaro si počas zamrazenia nabil štít → odraz mu ho ZNIČÍ namiesto zásahu (jeden block, 0 dmg)
      pushStateFrame(tl, [{ kind: "block", target: jslot, gold: jo.shieldGold }], SMALL_DELAY_MS);
      jo.shield = false; jo.shieldGold = false;
    } else {
      jo.hp = Math.max(0, jo.hp - total);
      notePrideHit(jslot);
      pushStateFrame(tl, [{ kind: "hit", target: jslot, dmg: total, ...(parts.length > 1 ? { parts } : {}) }], SMALL_DELAY_MS);
    }
  } else {
    // bez obrany: jeden kombinovaný hit s parts (súčet naraz, jeden hurt)
    foe.hp = Math.max(0, foe.hp - total);
    notePrideHit(foeS);
    pushStateFrame(tl, [{ kind: "hit", target: foeS, dmg: total, ...(parts.length > 1 ? { parts } : {}) }], SMALL_DELAY_MS);
  }
  endLabyrinths(tl); // aspoň jeden zásah/blok/odraz dopadol → labyrint končí (aj blokovaný/odrazený)
  game.timestop = null;
}

function doSpecial(slot, tl, dir = null, cell = null) {
  const actor = game.players[slot];
  if (!actor) return;

  // Bez many -> len spätná väzba (Hurt na klientovi + low mana výstraha), žiadna special animácia
  if (actor.mana < SPECIAL_COST) {
    pushInvalid(tl, slot, SMALL_DELAY_MS, "mana");
    return;
  }

  // Luffy: special = pohyb-a-úder ako šachová figúra (base dáma / gear3 veža) — nesie cieľovú bunku
  if (actor.char === "luffy") { doLuffySpecial(slot, tl, cell); return; }

  // Medúza: special nedáva dmg — súpera v zóne SKAMENÍ (preskočí najbližšie 2 základné akcie).
  // Zóna má smer (left/right); zásah ide cez obrany (shield blokuje, mirror odrazí kameň na Medúzu).
  if (actor.char === "medusa") {
    if (dir !== "left" && dir !== "right") { pushInvalid(tl, slot); return; }
    actor.mana -= SPECIAL_COST;
    const cells = medusaCells(actor, dir);
    const foeS = other(slot);
    const foe  = game.players[foeS];
    const inZone = !!(foe && cells.some(([x, y]) => x === foe.x && y === foe.y));
    // súperov tieňový klon v zóne skamenenie nezvládne — zmizne (zóna zasahuje hráča aj klona naraz)
    const cloneInZone = !!(foe?.clone && cells.some(([x, y]) => x === foe.clone.x && y === foe.clone.y));
    // istý zásah (aj do štítu/zrkadla) — prípadný labyrint sa odhalí ešte PRED nádychmi
    if (inZone && !(foe.stone > 0)) revealLabyrinths(tl);
    for (let r = 0; r < SPECIAL_REPEAT; r++) {
      pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells }], SPECIAL_BEAT_MS);
    }
    if (!inZone && !cloneInZone) {
      pushStateFrame(tl, [], SMALL_DELAY_MS);
      return;
    }
    const foeStruck = inZone && !(foe.stone > 0);
    if (inZone) {
      // už skamenený súper: útok bez efektu, žiadny refresh countera
      if (foe.stone > 0) pushInvalid(tl, slot, SMALL_DELAY_MS, "already_stone");
      else applyPetrify(foeS, tl);
    }
    if (cloneInZone) applyStatusOnClone(foeS, tl, "petrify", foeStruck);
    return;
  }

  // Minotaur: special nedáva dmg — CELOPLOŠNÝ (zasiahne súpera vždy), prenesie ho do LABYRINTU:
  // súper nevidí board (len vlastnú bunku + svoju niť), kým jeden hráč nezasiahne druhého.
  // Ide cez obrany ako petrify (shield blokuje, mirror odrazí — v labyrinte skončí sám Minotaur).
  if (actor.char === "minotaur") {
    actor.mana -= SPECIAL_COST;
    const cells = [];
    for (let y = 0; y < game.board.h; y++)
      for (let x = 0; x < game.board.w; x++) cells.push([x, y]);
    const foeS = other(slot);
    const foe  = game.players[foeS];
    // istý zásah — kasterov prípadný VLASTNÝ labyrint (mirror match) sa odhalí ešte pred nádychmi
    if (foe && !foe.labyrinth) revealLabyrinths(tl);
    for (let r = 0; r < SPECIAL_REPEAT; r++) {
      pushStateFrame(tl, [{ kind: "special", from: slot, cells }], SPECIAL_BEAT_MS);
    }
    if (!foe) { pushStateFrame(tl, [], SMALL_DELAY_MS); return; }
    // súper už blúdi v labyrinte: útok bez efektu, niť sa neresetuje
    if (foe.labyrinth) { pushInvalid(tl, slot, SMALL_DELAY_MS, "already_lost"); return; }
    applyLabyrinth(foeS, tl);
    // celoplošný special zasiahne aj súperovho tieňového klona (obrana ho kryje — už sa ukázala vyššie)
    applyStatusOnClone(foeS, tl, "labyrinth", true);
    return;
  }

  // Naruto: special nedáva dmg — TIEŇOVÝ KLON. Range self: nedá sa blokovať ani odraziť,
  // ale Naruto musí stáť na bunke SÁM (bez súpera; vlastný klon nevadí). Recast s aktívnym
  // klonom: starý klon najprv zmizne ako po zásahu, potom beží bežný summon. Klon vzniká na
  // Narutovej bunke (kým zdieľajú bunku, kreslí sa len jeden — a stojaci klon absorbuje
  // najbližší jednoterčový zásah namiesto Naruta).
  if (actor.char === "naruto") {
    const foeS = other(slot);
    const foe  = game.players[foeS];
    // summon vyžaduje bunku bez súpera — súper stojaci na Narutovej bunke je JEDINÝ spôsob, ako special
    // zablokovať. NOVÉ PRAVIDLO: máš naň manu → minie sa aj tak. Starý klon zaniká VŽDY (recast aj blok)
    // ešte PRED animáciou pečatí — Naruto sa naň nakoncentruje bez ohľadu na to, či nový vznikne.
    actor.mana -= SPECIAL_COST;
    killClone(slot, tl);
    if (foe && foe.x === actor.x && foe.y === actor.y) {
      for (let r = 0; r < SPECIAL_REPEAT; r++)
        pushStateFrame(tl, [{ kind: "special", from: slot, cells: [[actor.x, actor.y]] }], SPECIAL_BEAT_MS);
      pushInvalid(tl, slot, SMALL_DELAY_MS, "not_alone");
      return;
    }
    // pečate (Special.png) v rovnakej kadencii ako ostatné speciály; zóna = vlastná bunka
    for (let r = 0; r < SPECIAL_REPEAT; r++) {
      pushStateFrame(tl, [{ kind: "special", from: slot, cells: [[actor.x, actor.y]] }], SPECIAL_BEAT_MS);
    }
    // summon choreografia: Naruto + kópia na tej istej bunke tvárou v tvár hrajú Special_2, potom klon vznikne na jeho bunke
    pushStateFrame(tl, [{ kind: "clone_summon", from: slot, cell: [actor.x, actor.y] }], CLONE_SUMMON_MS);
    actor.clone = { x: actor.x, y: actor.y };
    pushStateFrame(tl, [{ kind: "clone_born", from: slot, cell: [actor.x, actor.y] }], SMALL_DELAY_MS);
    return;
  }

  // Vojak: snajperský lúč na ZVOLENÚ bunku (akcia nesie cell — validQueue overil hranice, súperovu
  // aktuálnu bunku aj vlastnú ghost pozíciu; v labyrinte prekliateho vojaka sa súperova bunka neblokuje).
  // 10 dmg tomu, kto na bunke STOJÍ v momente výstrelu — súper je zraniteľný, len keď sa pohne (alebo
  // stojaci lovec, keď strieľa prekliaty vojak). Ide cez obrany ako každý dmg special (shield blokuje,
  // mirror odrazí 10); samotného vojaka lúč nikdy nezraní (vlastnú bunku ani nejde zvoliť).
  if (actor.char === "soldier") {
    if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !inBounds(cell.x, cell.y)) { pushInvalid(tl, slot); return; }
    actor.mana -= SPECIAL_COST;
    const pBonus = powerBoost(slot, tl); // POWER tile: +2 k lúču; spotreba pri použití — aj keď lúč mine
    const cells = [[cell.x, cell.y]];
    const foeS = other(slot);
    const foe  = game.players[foeS];
    const inZone = !!(foe && foe.x === cell.x && foe.y === cell.y);
    const cloneStruck = !!(foe?.clone && foe.clone.x === cell.x && foe.clone.y === cell.y);
    // istý zásah reálneho hráča (aj do štítu/zrkadla) odhalí prípadný labyrint ešte pred animáciou
    if (inZone) revealLabyrinths(tl);
    // mierenie: JEDEN dlhý cast frame (nie opakované beaty — sniperka nestrieľa dávkou) — veľký sprite
    // drží mieriacu pózu, laser sight sa ustáli na cieli a výšľah vyjde raz tesne pred lúčom
    pushStateFrame(tl, [{ kind: "special", from: slot, cells }], SOLDIER_AIM_MS);
    // lúč zo zbrane + výbuch na cieľovej bunke — zásah (hit/block/odraz) padne až po dolete
    pushStateFrame(tl, [{ kind: "soldier_beam", from: slot, cell: [cell.x, cell.y] }], SOLDIER_BEAM_MS);
    const dmg = SPECIAL_ZONE_DMG.soldier * dealMul(slot) + pBonus;
    if (inZone) applyHitBoth(foeS, dmg, tl, "special", cloneStruck, pBonus);
    else if (cloneStruck) applyHitOnClone(foeS, dmg, tl, "special", false); // klon-návnada na cieli — zomiera (obrana kryje/odráža)
    else pushStateFrame(tl, [], SMALL_DELAY_MS);
    return;
  }

  // Vlkolak (werewolf): „moon charge" — rozbehne sa jedným z 8 smerov (aj diagonály) a zastane na PRVEJ
  // figúre súpera v dráhe (klon-návnada absorbuje úder skôr než súper — ako pri melee) alebo na okraji
  // plochy. Vlastnú bunku nezasahuje (súper na vlkolakovej bunke = beh na okraj bez hitu, ako basic).
  // Zásah = WOLF_MOON_DMG[moon] (bez falloffu podľa vzdialenosti) cez obrany ako každý dmg special
  // (shield blokuje, mirror odrazí plný moon dmg) — vlkolak ale na bunke terča OSTÁVA STÁŤ aj pri
  // bloku/odraze (hit je hit). Bez terča je akcia len presun na poslednú bunku smeru; charge z okrajovej
  // bunky von z plochy sa VYKONÁ podľa wall pravidla (mana preč, wall_bump, neprečiarkuje sa).
  if (actor.char === "werewolf") {
    const delta = WOLF_DIRS[dir];
    if (!delta) { pushInvalid(tl, slot); return; }
    actor.mana -= SPECIAL_COST;
    // POWER tile: ráta sa ŠTARTOVÁ bunka (na nej vlkolak stojí v momente vyhodnotenia; beh je až potom);
    // spotreba pri použití — aj pri behu bez terča či náraze do steny
    const pBonus = powerBoost(slot, tl);
    const foeS = other(slot);
    const foe  = game.players[foeS];
    // dráha: krok za krokom po okraj; stop na prvej figúre (klon pred súperom — bait pravidlo ako melee).
    // Klon STACKNUTÝ na majiteľovej bunke = "stacked": pohltí len CLONE_DMG, zvyšok prejde na Naruta
    // (rovnaké pravidlo ako pri basic/melee cez stacknutý pár) — nie plný bait.
    let x = actor.x, y = actor.y, target = null; // null | "clone" | "player" | "stacked"
    const path = [];
    while (inBounds(x + delta[0], y + delta[1])) {
      x += delta[0]; y += delta[1];
      path.push([x, y]);
      const cloneHere  = !!(foe?.clone && foe.clone.x === x && foe.clone.y === y);
      const playerHere = !!(foe && foe.x === x && foe.y === y);
      if (cloneHere && playerHere) { target = "stacked"; break; }
      if (cloneHere) { target = "clone"; break; }
      if (playerHere) { target = "player"; break; }
    }
    // charge do steny z okrajovej bunky — akcia sa vykoná na mieste: rozbehová póza + náraz (OUT OF BOUNDS)
    if (!path.length) {
      pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells: [] }], WOLF_CAST_MS);
      pushStateFrame(tl, [{ kind: "wall_bump", from: slot, dir }], SMALL_DELAY_MS);
      return;
    }
    const raw = WOLF_MOON_DMG[Math.max(0, Math.min(3, actor.moon || 0))] * dealMul(slot) * labyrinthMul(slot) + pBonus;
    // istý zásah REÁLNEHO hráča (aj do štítu/zrkadla) odhalí prípadný labyrint pred animáciou;
    // zásah klona-návnady labyrint neodhaľuje (kill klona ho nekončí — súper sa nesmie dozvedieť, že trafil klona).
    // stacknutý pár: presah dopadne na REÁLNEHO majiteľa → odhaľuje ako player zásah
    if (target === "player" || target === "stacked") revealLabyrinths(tl);
    // rozbehový cast: veľký Run+Attack v strede, malá postava tiež (casting), dráha bliká
    pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells: path.map(c => [...c]) }], WOLF_CAST_MS);
    // samotný beh: presun na cieľovú bunku jedným sklzom (ako dash); niť labyrintu ráta všetky prejdené bunky
    actor.x = path[path.length - 1][0];
    actor.y = path[path.length - 1][1];
    pushStateFrame(tl, [{ kind: "wolf_charge", from: slot, dir }, ...trackSteps(slot, path)], MOVE_DELAY_MS);
    if (!target) return; // dobehol na okraj bez terča — len presun
    // seknutie (Attack_2) na bunke terča; dmg/block/odraz dopadne až po ňom
    pushStateFrame(tl, [{ kind: "wolf_strike", from: slot, cell: [actor.x, actor.y] }], WOLF_STRIKE_MS);
    if (target === "player") applyHit(foeS, raw, tl, "special", false, pBonus);
    else if (target === "stacked") {
      // klon na majiteľovej bunke: so zdieľanou obranou reaguje pár ako jedna postava (applyHitPairDefended),
      // bez obrany klon pohltí len CLONE_DMG (zomrie) a zvyšok moon dmg prejde na Naruta (ako basic/melee)
      if (foe.shield || foe.mirror) applyHitPairDefended(foeS, raw, tl, "special", false);
      else {
        applyHitOnClone(foeS, CLONE_DMG, tl, "special");
        if (!winnerNow()) {
          const through = Math.max(0, raw - CLONE_DMG);
          if (through > 0) applyHit(foeS, through, tl, "special", false, pBonus);
        }
      }
    }
    else applyHitOnClone(foeS, raw, tl, "special");
    return;
  }

  // Countess Vampire / Onre: special = PASCA na zvolenej bunke (cell-picker ako Vojak, BEZ obmedzení —
  // aj súperova aktuálna bunka; trigger až pri opätovnom vstupe/prechode, státie netriggeruje). Značku
  // vidí len caster (player.trap aj trap_set sa súperovi redigujú). Max 1 pasca — recast starú nahradí
  // (pokojne aj tou istou bunkou). Trigger rieši resolveTrapsAfterAction/triggerTrap po súperovej akcii.
  if (VAMP_CHARS[actor.char]) {
    if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !inBounds(cell.x, cell.y)) { pushInvalid(tl, slot); return; }
    actor.mana -= SPECIAL_COST;
    // cast bliká CELOU plochou (ako Minotaurov special) — pasca môže byť hocikde, plný blik jej polohu
    // neprezradí (blikajúca len cieľová bunka by áno).
    // Countess: JEDEN dlhý frame — A5 (celá útočná sekvencia) sa hrá RAZ od frame 0; beaty by ju
    // reštartovali. Onre: pôvodné beaty (Scream loop reštart nevadí).
    const castCells = [];
    for (let y = 0; y < game.board.h; y++)
      for (let x = 0; x < game.board.w; x++) castCells.push([x, y]);
    if (actor.char === "countess") {
      pushStateFrame(tl, [{ kind: "special", from: slot, cells: castCells }], VAMP_CAST_MS);
    } else {
      for (let r = 0; r < SPECIAL_REPEAT; r++) {
        pushStateFrame(tl, [{ kind: "special", from: slot, cells: castCells }], SPECIAL_BEAT_MS);
      }
    }
    actor.trap = { x: cell.x, y: cell.y };
    pushStateFrame(tl, [{ kind: "trap_set", from: slot, cell: [cell.x, cell.y] }], SMALL_DELAY_MS);
    return;
  }

  // Jotaro: special = THE WORLD (jednorazový time-stop). Po ňom (worldUsed) sa button natrvalo zmení na
  // Special 2 = smerový (left/right) 8 dmg útok na JEDINÚ susednú bunku (x±1, y); cez obrany ako každý dmg
  // special (shield blokuje, mirror odrazí 8). Cast z krajného stĺpca von z plochy = wall-rule whiff.
  if (actor.char === "jotaro") {
    if (!actor.worldUsed) return doJotaroWorld(slot, tl); // THE WORLD (mana gate 5 už overený vyššie)
    // Special 2
    if (dir !== "left" && dir !== "right") { pushInvalid(tl, slot); return; }
    actor.mana -= JOTARO_S2_COST;
    const pBonus = powerBoost(slot, tl);
    const cells = jotaroS2Cells(actor, dir);
    if (!cells.length) { // susedná bunka mimo plochy → útok do steny (vykoná sa, mana preč, neprečiarkuje sa)
      pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells: [], offboard: true }], SPECIAL_BEAT_MS);
      return;
    }
    const foeS = other(slot);
    const foe  = game.players[foeS];
    const inZone = !!(foe && cells.some(([x, y]) => x === foe.x && y === foe.y));
    const cloneStruck = !!(foe?.clone && cells.some(([x, y]) => x === foe.clone.x && y === foe.clone.y));
    if (inZone) revealLabyrinths(tl);
    pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells }], SPECIAL_BEAT_MS);
    const dmg = JOTARO_S2_DMG * dealMul(slot) + pBonus;
    if (inZone) applyHitBoth(foeS, dmg, tl, "special", cloneStruck, pBonus);
    else if (cloneStruck) applyHitOnClone(foeS, dmg, tl, "special", false);
    else pushStateFrame(tl, [], SMALL_DELAY_MS);
    return;
  }

  // Escanor: smerový (left/right) dmg special; rozsah zóny podľa pride levelu (8 dmg). Cez obrany ako
  // ostatné dmg speciály (shield blokuje, mirror odrazí 8 na Escanora). Zóna = escanorCells (pride).
  if (actor.char === "escanor") {
    if (dir !== "left" && dir !== "right") { pushInvalid(tl, slot); return; }
    actor.mana -= SPECIAL_COST;
    const pBonus = powerBoost(slot, tl); // POWER tile: +2 k slnku; spotreba pri použití — aj pri hode do autu
    const cells = escanorCells(actor, dir);
    // hod slnka MIMO plochy (kotva F von z dosky → prázdna zóna, aj pri pride 3): akcia sa VYKONÁ ako útok
    // do steny — mana je preč, choreografia prebehne (slnko odletí do autu), klient ukáže OUT OF BOUNDS,
    // akcia sa NEprečiarkuje; žiadny dmg ani zásah klona
    if (!cells.length) {
      pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells, offboard: true }], ESC_SPECIAL_MS);
      return;
    }
    const foeS = other(slot);
    const foe  = game.players[foeS];
    const inZone = !!(foe && cells.some(([x, y]) => x === foe.x && y === foe.y));
    const cloneStruck = !!(foe?.clone && cells.some(([x, y]) => x === foe.clone.x && y === foe.clone.y));
    if (inZone) revealLabyrinths(tl); // istý zásah odhalí prípadný labyrint pred animáciou
    // 1 special frame drží celú choreografiu (klient ju spustí); zásah dopadne až po nej (ESC_SPECIAL_MS)
    pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells }], ESC_SPECIAL_MS);
    const dmg = SPECIAL_ZONE_DMG.escanor; // 8
    if (inZone) applyHitBoth(foeS, dmg * dealMul(slot) + pBonus, tl, "special", cloneStruck, pBonus);
    else if (cloneStruck) applyHitOnClone(foeS, dmg * dealMul(slot) + pBonus, tl, "special", false);
    else pushStateFrame(tl, [], SMALL_DELAY_MS);
    return;
  }

  actor.mana -= SPECIAL_COST;
  // POWER tile (fire/lightning/wanderer zónové speciály): +2 k zóne; spotreba pri použití — aj keď zóna minie
  const pBonus = powerBoost(slot, tl);

  // vyhodnotenie zásahu je deterministické už pred nádychmi (pozície sa počas nich nemenia) —
  // istý zásah odhalí prípadný labyrint ešte PRED animáciou špeciálu
  const { dmg, hit } = specialDamageAndHit(game.players, slot);
  // súperov tieňový klon v zóne — zomiera spolu so zásahom hráča (zóna zasahuje oboch naraz)
  const zFoeS = other(slot);
  const zFoe  = game.players[zFoeS];
  const cloneStruck = !!(zFoe?.clone && specialZoneHas(actor, zFoe.clone.x, zFoe.clone.y));
  if (dmg > 0 && hit) revealLabyrinths(tl);

  // Fire Wizard: ak special dostal boost zo stojacej Damage dlaždice (rozšírenie zóny o riadky ±1),
  // po animácii ju SKONZUMUJE (zmizne pre oboch — nezávisle od toho, či special zasiahol/bol blokovaný)
  const fireConsumes = fireOnDmgTile(actor);

  // 3× „nádych“ (caster animuje špeciál; klient bliká rozsah)
  for (let r = 0; r < SPECIAL_REPEAT; r++) {
    pushStateFrame(tl, [{ kind: "special", from: slot }], SPECIAL_BEAT_MS);
  }

  // spotreba Damage dlaždice AŽ PO nádychoch (animácia dokončená) — krátky flare na klientovi
  if (fireConsumes) {
    game.tiles = game.tiles.filter(t => !(t.type === "dmg" && t.x === actor.x && t.y === actor.y));
    pushStateFrame(tl, [{ kind: "tile_consume", from: slot, cell: [actor.x, actor.y] }], SMALL_DELAY_MS);
  }

  // Naruto + jeho klon = tá istá postava so zdieľanou obranou → ak zóna zasiahne oboch, block/odraz/hit idú NARAZ
  const ownerHit = !!(dmg > 0 && hit); // hit === zFoeS (súper bol v zóne)
  if (ownerHit) {
    applyHitBoth(zFoeS, dmg * dealMul(slot) + pBonus, tl, "special", cloneStruck, pBonus);
  } else if (cloneStruck) {
    // zóna minula súpera, ale trafila jeho klona → klon reaguje sám (POWER bonus nesie aj tento zásah)
    applyHitOnClone(zFoeS, (SPECIAL_ZONE_DMG[actor.char] || 0) * dealMul(slot) + pBonus, tl, "special", false);
  } else {
    pushStateFrame(tl, [], SMALL_DELAY_MS);
  }
}

// Démon útok (len buffnutý hráč v poslednom kole): veľký démon v strede sa animuje ako special,
// blikajú cieľové bunky (všetky okrem kasterovej) a potom dá 10 dmg súperovi, ak na niektorej stojí.
function doDemon(slot, tl) {
  const me  = game.players[slot];
  const opS = other(slot);
  const op  = game.players[opS];

  if (me.mana < DEMON_COST) { pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= DEMON_COST;
  // POWER tile: aj démon je akcia s okamžitým dmg → +2 (10 → 12); spotreba pri použití
  const pBonus = powerBoost(slot, tl);

  // dosah = všetky políčka okrem toho, na ktorom kaster stojí (jediná „bezpečná" bunka pre súpera)
  const cells = [];
  for (let y = 0; y < game.board.h; y++)
    for (let x = 0; x < game.board.w; x++)
      if (!(x === me.x && y === me.y)) cells.push([x, y]);

  // zásah: súper dostane dmg, ak NESTOJÍ na kasterovej bunke; cez shield/mirror (applyHit) — bez 2× buffu (10 = istá smrť)
  const inRange = op && !(op.x === me.x && op.y === me.y);
  // istý zásah — prípadný labyrint sa odhalí ešte pred vynorením démona
  if (inRange) revealLabyrinths(tl);

  // démon sa vynorí veľký v strede + bliká cieľové bunky v rovnakej kadencii ako special (ultimatka)
  pushStateFrame(tl, [{ kind: "demon_summon", from: slot }], LS_APPEAR_MS);
  for (let r = 0; r < SPECIAL_REPEAT; r++) {
    pushStateFrame(tl, [{ kind: "demon_attack", from: slot, cells }], SPECIAL_BEAT_MS);
  }

  // ak súper bráni (shield alebo mirror), démon nech najprv zmizne zo stredu, nech je block/odraz animácia viditeľná
  const defended = inRange && (op.shield || op.mirror);
  if (defended) pushStateFrame(tl, [{ kind: "demon_center_out", from: slot }], SMALL_DELAY_MS);
  // súperov tieňový klon v zóne (všade okrem kasterovej bunky) — zomiera/bráni SPOLU so súperom v jednom beate
  const cloneInRange = !!(op?.clone && !(op.clone.x === me.x && op.clone.y === me.y));
  if (inRange) {
    applyHitBoth(opS, DEMON_DMG + pBonus, tl, "demon", cloneInRange, pBonus);
  } else if (cloneInRange) {
    applyHitOnClone(opS, DEMON_DMG + pBonus, tl, "demon", false);
  } else {
    pushStateFrame(tl, [], SMALL_DELAY_MS);
  }
  if (!defended) pushStateFrame(tl, [{ kind: "demon_center_out", from: slot }], SMALL_DELAY_MS); // inak démon zmizne až po zásahu
}

// Výmena maga (len turnaj): na svojom kroku uloží živý stav odchádzajúceho maga, prehrá dvojfázový teleport
// (starý mág zmizne → nový sa objaví) a nasadí nového maga s jeho prenesenými HP/manou. Pozícia (x,y) ostáva.
// Nasledujúce akcie v tom istom kole už vykonáva nový mág (číta sa game.players[slot]).
function doSwap(slot, to, tl) {
  const me = game.players[slot];
  const person = game.seats[slot];
  const from = me.char;
  if (!game.mageHp || !rosterFor(slot).includes(to) || to === from) { pushInvalid(tl, slot, SMALL_DELAY_MS); return; }
  // poistka k validQueue: side-postavu nemožno swapnúť ani odswapnúť (odlišná sémantika akcií)
  if (SIDE_CHARS[from] || SIDE_CHARS[to]) { pushInvalid(tl, slot, SMALL_DELAY_MS); return; }
  if ((game.mageHp[person]?.[to] ?? 0) <= 0) { pushInvalid(tl, slot, SMALL_DELAY_MS); return; }
  // labyrint mohol padnúť v tomto kole PO naplánovaní swapu (Minotaurov special skôr v poradí) —
  // počas kliatby je výmena zakázaná pre obe strany, naplánovaný swap prepadne ako invalid
  if (game.players.p1.labyrinth || game.players.p2.labyrinth) { pushInvalid(tl, slot, SMALL_DELAY_MS); return; }
  // poistka k validQueue: hráč s Last Stand buffom vo final kole nesmie swapnúť (buff sa zapína
  // až na konci aktivačného kola, takže mid-round race nehrozí — guard drží pravidlo aj do budúcna)
  if (me.lastStandBuff) { pushInvalid(tl, slot, SMALL_DELAY_MS); return; }
  // tieňový klon odchádza s Narutom (nesmie prežiť výmenu maga); pasca zaniká swapom tiež
  killClone(slot, tl);
  breakTrap(slot, tl);
  // ulož živý stav odchádzajúceho maga (nesie sa do ďalších kôl / char-selectu ďalšej hry)
  game.mageHp[person][from] = Math.max(0, me.hp);
  game.mageMana[person][from] = Math.max(0, Math.min(MAX_MANA, me.mana));
  // (1) starý mág zmizne
  pushStateFrame(tl, [{ kind: "teleport_out", from: slot, char: from }], TELEPORT_OUT_MS);
  // prepni identitu + nasaď HP/manu nového maga
  me.char = to;
  me.pride = 0; // Escanor: nasadenie swapom začína na pride 0
  me.prideHit = false; // zásahy predchodcu sa na nového maga neprenášajú
  me.hp = game.mageHp[person][to];
  me.mana = game.mageMana[person][to];
  me.moon = to === "werewolf" ? moonLevelFor(me.hp) : 0; // Vlkolak: fáza HNEĎ podľa preneseného HP
  // (2) nový mág sa objaví
  pushStateFrame(tl, [{ kind: "teleport_in", from: slot, char: to }], TELEPORT_IN_MS);
}

function doAction(slot, action, tl) {
  if (!action) return;
  switch (action.type) {
    case "swap":     return doSwap(slot, action.to, tl);
    case "move":     return doMove(slot, action.dir, tl);
    case "dash":     return doDash(slot, action.dir, tl);
    case "recharge": return doRecharge(slot, tl);
    case "attack":   return doBasic(slot, action.dir, tl);
    case "melee":    return doMelee(slot, tl);
    case "special":  return doSpecial(slot, tl, action.dir, action.cell || null); // dir: Medúza/Escanor/Jotaro(S2); cell: Vojak (cieľová bunka)
    case "special1": return doJotaroS1(slot, action.dir, tl); // Jotarov útok v mirror slote (smer left/right)
    case "shield":   return doShield(slot, tl);
    case "mirror":   return doMirror(slot, tl);
    case "demon":    return doDemon(slot, tl);
    default: break;
  }
}

/* -------------------- Special tiles -------------------- */
function hasTile(x, y) {
  return game.tiles.some(t => t.x === x && t.y === y);
}
function hasIK(x, y) {
  return game.iks.some(t => t.x === x && t.y === y);
}
// BLOCK tile: figúra na ňom nemôže armovať shield/mirror. Kontroluje majiteľa AJ jeho tieňového klona —
// zdieľaná obrana sa armuje na oboch figúrach naraz, takže klon stojaci na block tile cast tiež zmarí.
// Kontrola je až pri VYKONANÍ (nie vo validQueue) — vlastná pozícia v momente vyhodnotenia nie je pri
// plánovaní istá (charge sa zastavuje o súperovu figúru, trap teleportuje).
function defenseBlockedBy(a) {
  const onBlock = (x, y) => game.tiles.some(t => t.type === "block" && t.x === x && t.y === y);
  return !!a && (onBlock(a.x, a.y) || (!!a.clone && onBlock(a.clone.x, a.clone.y)));
}
// POWER tile: caster stojí na ňom v momente vyhodnotenia dmg akcie → vráti +POWER_TILE_BONUS k útoku
// a tile SPOTREBUJE (tile_consume flare). Volá sa hneď po odpočte many — spotreba platí za POUŽITIE útoku,
// aj keď skončí whiffom do steny / blokom / odrazom (rovnaká filozofia ako Fireova konzumácia dmg tile).
// Bonus je flat (NEnásobí sa dealMul/labyrinthMul — klient ho vypisuje ako samostatný „-2" float) a mirror
// ho odráža ako súčasť plného dmg. Narutov klon boost nemá ani tile nespotrebúva (ráta sa LEN majiteľova bunka).
function powerBoost(slot, tl) {
  if (frozenActive()) return 0; // THE WORLD (D2): dlaždice sa počas zamrazenia nevyhodnocujú — power inertný, nespotrebuje sa
  const me = game.players[slot];
  const idx = game.tiles.findIndex(t => t.type === "power" && t.x === me.x && t.y === me.y);
  if (idx < 0) return 0;
  game.tiles.splice(idx, 1);
  pushStateFrame(tl, [{ kind: "tile_consume", from: slot, cell: [me.x, me.y], tile: "power" }], SMALL_DELAY_MS);
  return POWER_TILE_BONUS;
}
function pickCell(filterFn) {
  const cells = [];
  for (let y = 0; y < game.board.h; y++)
    for (let x = 0; x < game.board.w; x++)
      if (filterFn(x, y)) cells.push({ x, y });
  return cells.length ? cells[Math.floor(Math.random() * cells.length)] : null;
}

// koniec ťahu: pickupy (heal/mana) a damage políčka (dmg/IK); štít tile damage neblokuje.
// stonedStep = kto bol skamenený na začiatku kroku — skamenená postava sa berie, akoby na políčku nikto nestál
// (žiadny pickup, žiadny dmg/IK), a to aj v kroku, v ktorom jej kameň práve skončil
function endOfStepTileEffects(tl, stonedStep = { p1: false, p2: false }) {
  const order = game.starter === "p1" ? ["p1", "p2"] : ["p2", "p1"];
  const stoned = (slot) => stonedStep[slot] || game.players[slot].stone > 0;

  // heal/mana — pri oboch hráčoch na rovnakom tile berie ten, kto kolo začína
  for (const slot of order) {
    const p = game.players[slot];
    if (p.hp <= 0) continue;
    if (stoned(slot)) continue;    // skamenený nezbiera
    if (hasIK(p.x, p.y)) continue; // IK prekrýva => pickup neaktívny
    const idx = game.tiles.findIndex(t => (t.type === "heal" || t.type === "mana") && t.x === p.x && t.y === p.y);
    if (idx === -1) continue;
    const tile = game.tiles[idx];
    // najprv zvýrazni vyhodnocované políčko, potom aplikuj efekt
    pushStateFrame(tl, [{ kind: "tile_proc", tile: tile.type, cell: [p.x, p.y] }], 600);
    game.tiles.splice(idx, 1); // jediné spotrebovateľné políčka
    if (tile.type === "heal") {
      // Lightning: heal dlaždica ju lieči na plné HP (ostatní +1)
      const healAmount = p.char === "lightning" ? START_HP : p.hp + 1;
      const healed = Math.min(START_HP, healAmount) - p.hp;
      p.hp += healed;
      if (healed > 0) {
        // Lightning full-heal pasívka: klient ukáže „SUPER HEAL" float namiesto obyčajného +N HP
        pushStateFrame(tl, [{ kind: "heal", target: slot, amount: healed, super: p.char === "lightning" }], SMALL_DELAY_MS);
      } else {
        pushStateFrame(tl, [], SMALL_DELAY_MS); // pri plnom HP sa spotrebuje naprázdno
      }
    } else {
      const gained = MAX_MANA - p.mana;
      p.mana = MAX_MANA;
      if (gained > 0) {
        pushStateFrame(tl, [{ kind: "recharge", from: slot, cells: [[p.x, p.y]], amount: gained }], SMALL_DELAY_MS);
      } else {
        pushStateFrame(tl, [], SMALL_DELAY_MS); // pri plnej mane sa spotrebuje naprázdno
      }
    }
  }

  // dmg / IK
  for (const slot of order) {
    const p = game.players[slot];
    if (p.hp <= 0) continue;
    if (stoned(slot)) continue; // na skamenenú postavu sa tile dmg/IK nevyhodnocuje
    // (kaster labyrintu dostáva tile dmg/IK normálne ako mimo labyrintu — mazeBuff už nedáva imunitu na dlaždice)
    let dmg = 0, tileType = null;
    if (hasIK(p.x, p.y)) { dmg = 10; tileType = "ik"; }
    else if (game.tiles.some(t => t.type === "dmg" && t.x === p.x && t.y === p.y)) {
      // Fire Wizard už NIE je imunný voči Damage dlaždiciam — dostane bežný 1 dmg;
      // výmenou mu státie na ohnivom políčku rozšíri special o riadky ±1 (viď fireOnDmgTile).
      dmg = 1; tileType = "dmg";
    }
    if (dmg > 0) {
      const d = recvDmg(slot, dmg);
      // tile dmg labyrint bežne NEkončí — výnimka je smrteľný zásah: pred finálnym dmg sa prehrá
      // rovnaká postupnosť ako pri akciovom zásahu (reveal PRED animáciou, koniec labyrintu po hite),
      // aby smrť nepadla v hmle a hra neskončila s aktívnou redakciou
      const lethalInLab = d >= p.hp && (game.players.p1.labyrinth || game.players.p2.labyrinth);
      if (lethalInLab) revealLabyrinths(tl);
      // najprv zvýrazni vyhodnocované políčko, potom zásah (½ ak má hráč last stand buff — platí aj na tile/IK)
      pushStateFrame(tl, [{ kind: "tile_proc", tile: tileType, cell: [p.x, p.y] }], 600);
      p.hp = Math.max(0, p.hp - d);
      pushStateFrame(tl, [{ kind: "hit", target: slot, dmg: d }], SMALL_DELAY_MS);
      if (lethalInLab) endLabyrinths(tl);
      // prvý mŕtvy okamžite ukončuje hru — druhý tile zásah sa už nevyhodnotí (remíza nemôže nastať)
      if (winnerNow()) return;
    }
  }

  // tieňové klony: heal/mana IGNORUJÚ (neberú — nespotrebovaný pickup pod „postavou" klona prezrádza),
  // dmg tile ukáže kozmetický -1 (klona nezabíja), IK tile klona ZNIČÍ (tile dmg labyrint nekončí)
  for (const slot of order) {
    const p = game.players[slot];
    if (!p.clone) continue;
    const { x, y } = p.clone;
    if (hasIK(x, y)) {
      pushStateFrame(tl, [{ kind: "tile_proc", tile: "ik", cell: [x, y] }], 600);
      killClone(slot, tl);
    } else if (game.tiles.some(t => t.type === "dmg" && t.x === x && t.y === y)) {
      // rovnaká dramaturgia ako pri hráčovom tile zásahu: NAJPRV rozsvieť políčko (vlastný frame),
      // až POTOM kozmetický zásah na klonovi — inak sa blik políčka „stratí" v spoločnom frame
      pushStateFrame(tl, [{ kind: "tile_proc", tile: "dmg", cell: [x, y] }], 600);
      pushStateFrame(tl, [{ kind: "clone_hit", target: slot, cell: [x, y], dmg: 1 }], SMALL_DELAY_MS);
    }
  }
}

// vyber typ tile podľa percentuálnych váh (dmg/heal/mana/ik/power/block, spolu ~100); null ak sú všetky 0
function rollTileType(weights) {
  const order = ["dmg", "heal", "mana", "ik", "power", "block"];
  const total = order.reduce((a, k) => a + Math.max(0, weights?.[k] || 0), 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const k of order) {
    r -= Math.max(0, weights?.[k] || 0);
    if (r < 0) return k;
  }
  return order[order.length - 1];
}

// koniec kola: zmaterializuj VOPRED ohlásené zmeny (game.pending — hráči ich celé kolo videli ako preview)
// a hneď vyžrebuj novú sadu na koniec ďalšieho kola. Náhoda sa tak hádže o kolo skôr než dopadne.
function endOfRoundTiles() {
  if (!game.config) return;
  commitPendingTiles();
  rollPendingTiles();
}

// vykonaj ohlásené zmeny: presuň každý IK na jeho ohlásený cieľ + spawni ohlásené nové tiles.
// Constraints sa NEprehodnocujú — vyhodnotili sa už pri žrebe (rollPendingTiles) proti budúcemu stavu
// a tiles môžu počas kola už len MIZNÚŤ (pickup, Fireova konzumácia), takže ohlásená bunka ostáva legálna.
function commitPendingTiles() {
  const p = game.pending;
  if (!p) return;
  game.iks = game.iks.map((ik, i) => p.ikMoves[i] ? { ...p.ikMoves[i] } : ik); // pole je paralelné s game.iks
  for (const s of p.spawns) {
    if (s.type === "ik") game.iks.push({ x: s.x, y: s.y });
    else game.tiles.push({ x: s.x, y: s.y, type: s.type });
  }
  game.pending = null;
}

// vyžrebuj zmeny, ktoré dopadnú na konci NASLEDUJÚCEHO kola: cieľ presunu každého IK (dva IK nesmú skončiť
// na rovnakom políčku; ostatné tiles a hráči nevadia) + tilesPerRound nových spawnov podľa percentuálnych váh.
// Všetky constraints sa vyhodnocujú proti BUDÚCEMU stavu dosky (ohlásené IK ciele + ohlásené spawny).
function rollPendingTiles() {
  if (!game.config) return;
  const ikMoves = [];
  for (const ik of game.iks) {
    const c = pickCell((x, y) => !ikMoves.some(m => m.x === x && m.y === y));
    ikMoves.push(c ? { x: c.x, y: c.y } : { x: ik.x, y: ik.y }); // bez voľného políčka ostane na mieste
  }
  const spawns = [];
  const futureIK = (x, y) => ikMoves.some(m => m.x === x && m.y === y)
    || spawns.some(s => s.type === "ik" && s.x === x && s.y === y);
  const futureTile = (x, y) => hasTile(x, y) || spawns.some(s => s.type !== "ik" && s.x === x && s.y === y);
  const n = Math.max(1, Math.min(3, game.config.tilesPerRound || 1));
  for (let k = 0; k < n; k++) {
    const type = rollTileType(game.config.tileWeights);
    if (!type) break;
    if (type === "ik") {
      // IK môže vzniknúť hocikde (aj pod hráčom, aj nad iným tile); len nie na budúcej pozícii iného IK
      const c = pickCell((x, y) => !futureIK(x, y));
      if (c) spawns.push({ x: c.x, y: c.y, type: "ik" });
    } else {
      // môže byť aj pod hráčom; nie na existujúcom/ohlásenom tile ani pod budúcim IK
      const c = pickCell((x, y) => !futureTile(x, y) && !futureIK(x, y));
      if (c) spawns.push({ x: c.x, y: c.y, type });
      else {
        // doska je plná special tiles (žiadna bunka pre dmg/heal/mana) → namiesto preskočenia spawnu
        // padne IK BEZ OHĽADU na váhy (IK smie prekryť tiles) — late-game poistka, nech sa hra nezasekne
        const ik = pickCell((x, y) => !futureIK(x, y));
        if (ik) spawns.push({ x: ik.x, y: ik.y, type: "ik" });
      }
    }
  }
  game.pending = { ikMoves, spawns };
}

/* -------------------- Turn timer (server-side enforcement) -------------------- */
// časovač beží na serveri (nezávisle od fokusu tabu); klient si robí len vlastný displej + skorší auto-lock.
// backstop tu garantuje, že kolo sa vyhodnotí, aj keď je niektorý tab na pozadí (throttle rAF) alebo odpojený.
const QUICKDRAW_MS = 60000;
const TIMER_GRACE_MS = 2500; // server strieľa o čosi neskôr než klient, nech foreground tab stihne auto-lock s rozpracovanou frontou
let turnTimer = null;
let turnDeadline = null; // Date.now() času, kedy má klient odpočítavať/auto-locknúť (bez grace); zdieľané s klientom

function timerRemainingMs() { return turnDeadline ? Math.max(0, turnDeadline - Date.now()) : null; }

function clearTurnTimer() {
  if (turnTimer) { clearTimeout(turnTimer); turnTimer = null; }
  turnDeadline = null;
  roomEmit("turn_timer", { ms: null });
}

// platná základná akcia? (move/attack/dash potrebujú smer); allowDemon = buffnutý hráč smie navoliť aj démon útok;
// char kvôli Vampire/Onryō (diagonálny attack; dash = charge s rovnakými smermi, melee bez smeru)
function validBasicAction(a, used, allowDemon = false, char = null) {
  if (!a) return false;
  const known = ACTION_TYPES.has(a.type) || (allowDemon && a.type === "demon");
  if (!known || used.has(a.type)) return false;
  const side = !!SIDE_CHARS[char];      // diagonálny basic (Countess/Onre/Jotaro)
  const isJotaro = char === "jotaro";
  if (a.type === "mirror" && isJotaro) return false;    // Jotaro nemá mirror (v tom slote má special1)
  if (a.type === "special1" && !isJotaro) return false; // special1 je len Jotarov
  if (a.type === "special1" && a.dir !== "left" && a.dir !== "right") return false;
  if ((a.type === "move" || a.type === "dash") && !MOVE_DIRS.has(a.dir)) return false;
  // Luffy: basic je diag (base) / ortogonálny (gear3) podľa formy — tu (draft/auto-fill) akceptuj oboje,
  // presnú formu vynúti autoritatívny validQueue pri lock_in.
  if (a.type === "attack") {
    if (char === "luffy") { if (!(DIAG_DIRS[a.dir] || MOVE_DIRS.has(a.dir))) return false; }
    else if (!(side ? DIAG_DIRS[a.dir] : MOVE_DIRS.has(a.dir))) return false;
  }
  return true;
}
// hráč, ktorý sa nestihol locknúť: zachová svoju rozpracovanú frontu (draft) a chýbajúce do 3 doplní náhodne
// exclude = typy, ktoré už pokrýva golden predťah (shield pri golden_shield, mirror pri golden_mirror) —
// nesmú sa pridať ani z draftu, ani z náhodného doplnenia (inak by sa akcia zahrala 2× za kolo)
function fillFromDraft(draftQueue, exclude = new Set(), allowDemon = false, limit = 3, char = null, slot = null) {
  const q = [], used = new Set(exclude);
  for (const a of (Array.isArray(draftQueue) ? draftQueue : [])) {
    if (q.length >= limit) break;
    if (!validBasicAction(a, used, allowDemon, char)) continue;
    q.push({ type: a.type, dir: a.dir || null, cell: a.cell || null }); // cell = cieľ Vojakovho/Countess/Onre specialu
    used.add(a.type);
  }
  const isJotaro = char === "jotaro";
  // special1 je len Jotarov; Jotaro naopak nemá mirror (v tom slote má special1) — vyhoď z náhodného poolu
  const pool = [...ACTION_TYPES].filter(t => !used.has(t)
    && !(t === "special1" && !isJotaro) && !(t === "mirror" && isJotaro));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const dirs = [...MOVE_DIRS];
  const side = !!SIDE_CHARS[char]; // diagonálny attack (Countess/Onre/Jotaro)
  const vamp = !!VAMP_CHARS[char]; // special s bunkou = pasca (len Countess/Onre)
  const lr = () => (Math.random() < 0.5 ? "left" : "right");
  while (q.length < limit && pool.length) {
    const t = pool.shift();
    if (t === "attack" && char === "luffy") { // Luffy: gear3 = ortogonálny, base = diagonálny
      const gear3 = game.players[slot]?.form === "gear3";
      q.push({ type: t, dir: gear3 ? dirs[Math.floor(Math.random() * dirs.length)] : DIAG_DIR_KEYS[Math.floor(Math.random() * DIAG_DIR_KEYS.length)] });
    }
    else if (t === "attack" && side) q.push({ type: t, dir: DIAG_DIR_KEYS[Math.floor(Math.random() * DIAG_DIR_KEYS.length)] });
    else if (t === "move" || t === "attack" || t === "dash") q.push({ type: t, dir: dirs[Math.floor(Math.random() * dirs.length)] });
    else if (t === "special1") q.push({ type: t, dir: lr() }); // Jotarov special1 — smer left/right
    else if (t === "special" && (char === "medusa" || char === "escanor")) q.push({ type: t, dir: lr() }); // Medúzin/Escanorov special potrebuje smer
    else if (t === "special" && char === "werewolf") q.push({ type: t, dir: WOLF_DIR_KEYS[Math.floor(Math.random() * WOLF_DIR_KEYS.length)] }); // Vlkolakov charge — náhodný z 8 smerov
    else if (t === "special" && char === "soldier") q.push({ type: t, cell: randomSoldierTarget(slot) }); // Vojakov special potrebuje cieľovú bunku
    else if (t === "special" && char === "luffy") q.push({ type: t, cell: randomLuffySpecialTarget(slot) }); // Luffy special = bunka na platnej línii
    else if (t === "special" && vamp) q.push({ type: t, cell: randomTrapCell() }); // pasca — ľubovoľná bunka
    else if (t === "special" && isJotaro) q.push(game.players[slot]?.worldUsed ? { type: t, dir: lr() } : { type: t }); // Special 2 (smer) / THE WORLD (bez args)
    else q.push({ type: t });
  }
  return q;
}

// náhodná platná cieľová bunka Vojakovho specialu (timeout auto-fill) — rovnaké pravidlá ako validQueue:
// nie vlastná bunka, nie súperova figúra ani jeho klon (v labyrinte prekliateho sa súper neblokuje)
function randomSoldierTarget(slot) {
  const meP = slot ? game.players[slot] : null;
  const foe = slot ? game.players[other(slot)] : null;
  const c = pickCell((x, y) => {
    if (meP && meP.x === x && meP.y === y) return false;
    if (meP && !meP.labyrinth && foe) {
      if (foe.x === x && foe.y === y) return false;
      if (foe.clone && foe.clone.x === x && foe.clone.y === y) return false;
    }
    return true;
  });
  return c ? { x: c.x, y: c.y } : null;
}

// náhodná platná cieľová bunka Luffyho specialu (timeout auto-fill) — na platnej línii (dáma base / veža gear3)
// z jeho AKTUÁLNEJ pozície a formy; vlastná bunka povolená
function randomLuffySpecialTarget(slot) {
  const meP = slot ? game.players[slot] : null;
  if (!meP) return null;
  const c = pickCell((x, y) => luffySpecialReaches(meP.x, meP.y, x, y, meP.form));
  return c ? { x: c.x, y: c.y } : c;
}

// naplánuj backstop pre práve začínajúce kolo; extraMs = čas, kým klient dohrá timeline (počas neho neplánuje)
function beginPlanningTimer(extraMs = 0) {
  const t = game.config?.timer;
  if (t === "30" || t === "60" || t === "120") {
    armTurnTimer(extraMs + parseInt(t, 10) * 1000);
  } else {
    clearTurnTimer(); // "off"/"quickdraw" -> teraz žiadny limit (quickdraw sa nasadí až po locku)
  }
}
// intendedMs = čas, ktorý klient odpočítava a po ktorom auto-lockne; server backstop strieľa o grace neskôr
function armTurnTimer(intendedMs) {
  if (turnTimer) clearTimeout(turnTimer);
  turnDeadline = Date.now() + intendedMs;
  turnTimer = setTimeout(onTurnTimeout, intendedMs + TIMER_GRACE_MS);
  roomEmit("turn_timer", { ms: intendedMs });
}

function onTurnTimeout() {
  turnTimer = null;
  turnDeadline = null;
  if (game.phase !== "playing") return;
  if (!game.players.p1.char || !game.players.p2.char) return;
  for (const slot of ["p1", "p2"]) {
    const p = game.players[slot];
    if (p.locked) continue;
    // gold zachovaj len keď si ho navolil; vyhodnoť pred frontou, nech vieš, čo z nej vylúčiť
    p.golden = !!p.draft?.golden && slot !== game.starter; // golden shield len pre nestartéra
    p.goldenMirror = !!p.draft?.goldenMirror && slot !== game.starter; // golden mirror tiež len pre nestartéra
    // duálny gold button (mana/last stand) je v poslednom buffnutom kole zamknutý pre oboch
    const goldLocked = game.players.p1.lastStandBuff || game.players.p2.lastStandBuff;
    p.goldenMana = !goldLocked && !!p.draft?.goldenMana;
    p.lastStand  = !goldLocked && !!p.draft?.lastStand && !p.goldenMana; // výlučné s golden mana
    // Last Hope — len nebuffnutý hráč vo final kole; nikdy sa nedopĺňa náhodne, len ak ho hráč navolil
    p.lastHope   = goldLocked && !p.lastStandBuff && !!p.draft?.lastHope;
    // zahraj, čo má hráč rozpracované (draft), chýbajúce do 3 doplň náhodne — bez akcie, ktorú už pokrýva golden
    const exclude = new Set();
    if (p.golden) exclude.add("shield");
    if (p.goldenMirror) exclude.add("mirror");
    // skamenené sloty na začiatku kola sú pevné pass ťahy — dopĺňa sa len zvyšok
    const stone = Math.min(3, p.stone || 0);
    p.queue = [
      ...Array.from({ length: stone }, () => ({ type: "stoned" })),
      ...fillFromDraft(p.draft?.queue, exclude, !!p.lastStandBuff, 3 - stone, p.char, slot),
    ];
    p.locked = true;
  }
  if (game.players.p1.locked && game.players.p2.locked) resolveTurn();
  else emitStateMasked(); // labyrint: prekliaty nesmie dostať súperovu pozíciu ani tu
}

/* -------------------- Last Stand (frame-driven) -------------------- */
// pomocné: plynulé prepísanie HP+many cez zopár frame-ov (HUD sa hýbe zo snapshotov)
function lsTweenFrames(slot, toHp, toMana, totalMs, kind, tl) {
  const p = game.players[slot];
  const fromHp = p.hp, fromMana = p.mana, steps = 4;
  for (let s = 1; s <= steps; s++) {
    p.hp   = Math.round(fromHp   + (toHp   - fromHp)   * (s / steps));
    p.mana = Math.round(fromMana + (toMana - fromMana) * (s / steps));
    pushStateFrame(tl, [{ kind, target: slot }], Math.round(totalMs / steps));
  }
  p.hp = toHp; p.mana = toMana;
}

// summon: démon v strede → odčerpá HP/manu na 0 → smrť → objaví sa za postavou → zlaté dvíhanie na 10 → usadenie.
// buff+doom (a tým golden stav na klientovi) sa zapnú až vo fáze „revive" (po smrti), nie počas umierania.
function resolveLastStandSummon(slot, tl) {
  const p = game.players[slot];
  pushStateFrame(tl, [{ kind: "last_stand_summon", from: slot }], LS_APPEAR_MS); // démon v strede (HP ešte plné)
  lsTweenFrames(slot, 0, 0, LS_DRAIN_MS, "last_stand_drain", tl);                 // HP+mana → 0
  p.down = true;                                                                  // hráč padá mŕtvy (leží až do settle)
  pushStateFrame(tl, [{ kind: "last_stand_kill", from: slot }], LS_KILL_MS);     // smrť + démon zmizne zo stredu
  killClone(slot, tl);                                                           // Naruto zomrel → klon zaniká HNEĎ pri smrti (pred vzkriesením)
  breakTrap(slot, tl);                                                           // pasca zaniká smrťou castera (aj touto rituálnou — deštrukciu vidia obaja)
  p.lastStandBuff = true; p.lastStandDoom = true;                                 // od TERAZ golden stav + buff/doom
  pushStateFrame(tl, [{ kind: "last_stand_revive", from: slot }], LS_REVIVE_MS); // démon sa objaví za postavou (0→1)
  lsTweenFrames(slot, START_HP, MAX_MANA, LS_RISE_MS, "last_stand_rise", tl);     // HP+mana 0 → 10 (zlaté), hráč stále leží
  p.down = false;                                                                 // pri 10/10 hráč vstane
  pushStateFrame(tl, [{ kind: "last_stand_settle", from: slot }], LS_SETTLE_MS); // démon → 0.25, hráč vstane
}

// Last Hope summon: červená „hope" postava v strede → HP padne na 1, mana sa naplní na 10 → postava zmizne, ultra mód (4×) ostáva.
function resolveLastHopeSummon(slot, tl) {
  const p = game.players[slot];
  p.lastHopeBuff = true;                                                          // ultra mód HNEĎ → mana začne pulzovať červeno ešte pred doplnením
  pushStateFrame(tl, [{ kind: "last_hope_summon", from: slot }], LH_APPEAR_MS); // hope postava v strede (mana už červená)
  lsTweenFrames(slot, 1, MAX_MANA, LH_DRAIN_MS, "last_hope_drain", tl);          // až POTOM HP→1, mana→10 (pulzuje červeno počas dopĺňania)
  pushStateFrame(tl, [{ kind: "last_hope_settle", from: slot }], LH_SETTLE_MS);  // postava zmizne, červený mód zostáva
}

// banish: golden OFF → duch zosilnie a odíde z postavy → objaví sa v strede → odčerpá HP/manu na 0 → smrť.
function resolveLastStandBanish(slot, tl) {
  const p = game.players[slot];
  pushStateFrame(tl, [{ kind: "last_stand_banish", from: slot }], LS_B_LEAVE_MS);         // golden off + duch odíde
  pushStateFrame(tl, [{ kind: "last_stand_banish_center", from: slot }], LS_B_CENTER_MS); // duch v strede
  lsTweenFrames(slot, 0, 0, LS_B_DRAIN_MS, "last_stand_drain", tl);                        // HP+mana → 0 (smrť; bez záverečného „hit" → žiadne červené bliknutie/−10 HP)
  p.down = true;                                                                           // hráč padá mŕtvy
  killClone(slot, tl);                                                                     // Naruto zomrel (doom) → klon zaniká
  pushStateFrame(tl, [{ kind: "last_stand_banish_kill", from: slot }], LS_B_KILL_MS);     // démon zmizne, hráč leží mŕtvy
}

/* -------------------- Turn resolution -------------------- */
// resolveTurn je REZUMOVATEĽNÝ (kvôli Jotarovmu THE WORLD, ktorý kolo uprostred pozastaví a čaká na
// klienta): init kontextu + Last Hope/golden pre-fáza tu, hlavný interleave loop v runRoundLoop() (číta/
// zapisuje game.roundCtx a vie skončiť buď finishRound(), alebo PAUZOU), koncová fáza vo finishRound().
function resolveTurn() {
  clearTurnTimer();
  const tl = [];
  // prvý „nulový“ frame pre hladký začiatok
  pushStateFrame(tl, [], 10);

  const order = game.starter === "p1" ? ["p1","p2"] : ["p2","p1"];
  // Escanor pride: zachyť PRED spracovaním, či daný Escanor v tomto kole použil shield/mirror/golden shield/mirror
  // (fronta aj golden flagy sa počas kola menia/miznú). Na konci kola: použil obranu ALEBO dostal zásah
  // (p.prideHit z notePrideHit) → −1, inak → +1. Číta sa FRONTA, nie výsledok — obrana zmarená BLOCK tile
  // (blocked_shield/mirror) teda pride uberá tiež (skúsil sa brániť) — zámer.
  const escUsedDefense = {};
  for (const slot of ["p1", "p2"]) {
    const p = game.players[slot];
    if (p.char !== "escanor") continue;
    escUsedDefense[slot] = !!p.golden || !!p.goldenMirror ||
      (p.queue || []).some(a => a && (a.type === "shield" || a.type === "mirror"));
  }
  // Pútnik (wanderer): ak v tomto kole použil mirror (obyčajný ALEBO golden), pasívna +many na konci kola NEpríde.
  // Zachyť PRED spracovaním kola — golden flag aj fronta (golden predťah) sa počas kola menia/miznú (ako pri Escanorovi).
  // Číta sa FRONTA, nie výsledok — mirror zmarený BLOCK tile regen tiež ruší (zámer, hoci mana ostala).
  const wandererUsedMirror = {};
  for (const slot of ["p1", "p2"]) {
    const p = game.players[slot];
    if (p.char !== "wanderer") continue;
    wandererUsedMirror[slot] = !!p.goldenMirror || (p.queue || []).some(a => a && a.type === "mirror");
  }
  // doom: zachyť na začiatku kola — true len v buffnutom (poslednom) kole, NIE v aktivačnom (vtedy sa nastaví až v gold fáze)
  const doomSlot = game.players.p1.lastStandDoom ? "p1" : game.players.p2.lastStandDoom ? "p2" : null;

  // Last Hope — úvodná akcia NEbuffnutého hráča vo final kole, vyhodnotená PRED golden shield/mirror.
  // Týka sa len final kola (niekto má lastStandBuff); pre nebuffnutého buď zahranie, alebo prázdny beat (kurzor cezeň prejde).
  if (game.players.p1.lastStandBuff || game.players.p2.lastStandBuff) {
    for (const slot of order) {
      const p = game.players[slot];
      if (p.lastStandBuff) continue; // buffnutý hráč Last Hope nemá (má démon útok)
      if (p.lastHope) {
        p.lastHope = false;
        pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: "last_hope", dir: null } }], 250);
        // skamenený hráč: zlaté akcie sa nevykonajú (bez ceny) a kameň NEuberajú
        if (p.stone > 0) { pushStateFrame(tl, [{ kind: "stoned", target: slot }], SMALL_DELAY_MS); continue; }
        resolveLastHopeSummon(slot, tl);
      } else {
        pushStateFrame(tl, [{ kind: "beat_empty", from: slot, beat: "lhope" }], ACTION_GAP_MS);
      }
    }
  }

  // golden shield / golden mirror — extra predťah hráča, ktorý je v kole druhý, vyhodnotený pred prvou akciou startera
  const second = order[1];
  if (game.players[second].golden || game.players[second].goldenMirror) {
    const gp = game.players[second];
    const isMirror = gp.goldenMirror;
    const cost = isMirror ? GOLDEN_MIRROR_COST : GOLDEN_COST;
    const type = isMirror ? "golden_mirror" : "golden_shield";
    pushStateFrame(tl, [{ kind: "action", from: second, action: { type, dir: null } }], 250);
    if (gp.stone > 0) {
      // skamenený hráč: zlatý predťah sa nevykoná (mana ostáva) a kameň NEuberá
      pushStateFrame(tl, [{ kind: "stoned", target: second }], SMALL_DELAY_MS);
    } else if (defenseBlockedBy(gp)) {
      // BLOCK tile: ani zlatý predťah sa na ňom nedá castnúť — prečiarknutie BEZ ceny
      pushInvalid(tl, second, SMALL_DELAY_MS, isMirror ? "blocked_mirror" : "blocked_shield");
    } else if (gp.mana >= cost) {
      gp.mana -= cost;
      if (isMirror) {
        gp.mirror = true;
        gp.mirrorGold = true;
        pushStateFrame(tl, [{ kind: "golden_mirror", from: second }], SMALL_DELAY_MS);
      } else {
        gp.shield = true;
        gp.shieldGold = true;
        pushStateFrame(tl, [{ kind: "golden_shield", from: second }], SMALL_DELAY_MS);
      }
    } else {
      pushInvalid(tl, second, SMALL_DELAY_MS, "mana");
    }
    gp.golden = false;
    gp.goldenMirror = false;
    pushStateFrame(tl, [], ACTION_GAP_MS); // oddeľ predťah od prvej akcie startera
  } else {
    // prázdny golden shield/mirror beat — zelená šípka cezeň prekrokuje (rovnako ako prázdny golden mana)
    pushStateFrame(tl, [{ kind: "beat_empty", from: second, beat: "gpre" }], ACTION_GAP_MS);
  }

  // ulož kontext rezumovateľného kola a spusti hlavný interleave loop
  game.roundCtx = {
    tl, order, i: 0, slotIdx: 0, ended: false,
    stonedStep: null, tookStoned: null,
    escUsedDefense, wandererUsedMirror, doomSlot,
    second, emittedUpTo: 0,
  };
  runRoundLoop();
}

// hlavný interleave loop kola — číta/zapisuje game.roundCtx, takže sa dá po THE WORLD pauze rezumovať
// od uloženej pozície (ctx.i = číslo akcie 0–2, ctx.slotIdx = ktorý slot v order je na rade).
function runRoundLoop() {
  const ctx = game.roundCtx;
  const { tl, order } = ctx;
  while (ctx.i < 3) {
    // skamenenie chráni pred tile efektmi počas CELÉHO kroku, v ktorom padol aj posledný skamenený ťah
    // (odkamenenie je „na konci ťahu" — tiles sa začnú vyhodnocovať až od nasledujúceho kroku).
    // Zachyť ho pri VSTUPE do kroku (slotIdx 0), aby pauza uprostred kroku nestratila hodnotu.
    if (ctx.slotIdx === 0) {
      ctx.stonedStep = { p1: game.players.p1.stone > 0, p2: game.players.p2.stone > 0 };
      ctx.tookStoned = { p1: false, p2: false }; // kto v tomto kroku odohral skamenený pass
    }
    while (ctx.slotIdx < order.length) {
      const slot = order[ctx.slotIdx];
      const meP = game.players[slot];
      if (meP.stone > 0) {
        // skamenený ťah: akcia sa preskočí (bez many) a NEspotrebuje súperovu obranu.
        // Kameň sa NEuberá teraz — až na KONCI kroku (nižšie), aby socha vizuálne vydržala celý tento krok
        // vrátane vyhodnotenia jeho dlaždíc; odkamenenie sa tak prejaví až na začiatku NASLEDUJÚCEJ akcie
        // (predtým socha zmizla už pri „STONED" float 2. akcie, hoci dlaždica pod hráčom sa ešte netriggerovala).
        ctx.tookStoned[slot] = true;
        pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: "stoned", dir: null, to: null } }], 250);
        pushStateFrame(tl, [{ kind: "stoned", target: slot }], SMALL_DELAY_MS);
        pushStateFrame(tl, [], ACTION_GAP_MS);
        ctx.slotIdx++;
        continue;
      }
      const foe = other(slot);
      // obrany kryjú práve túto (najbližšiu) súperovu akciu — spotrebujú sa ňou aj bez zásahu
      const foeShieldArmed = game.players[foe].shield;
      const foeMirrorArmed = game.players[foe].mirror;
      const act = meP.queue[ctx.i];
      // ohlás akciu klientovi (záznam kola pod HUD widgetom)
      if (act) pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: act.type, dir: act.dir || null, to: act.to || null } }], 250);
      // pasca (Countess/Onre): zbieraj bunky prejdené počas akcie; trigger sa vyhodnotí AŽ PO jej dokončení
      actionSteps = { p1: [], p2: [], p1c: [], p2c: [] };
      const res = doAction(slot, act, tl);
      // Jotaro THE WORLD: kolo sa POZASTAVÍ — pošli čiastočnú timeline (končí timestop_wait) a čakaj na
      // timestop_actions. Súperovu obranu NEspotrebuj (ostáva armed cez zamrazenie), pasce nevyhodnocuj (čas stojí).
      if (res === PAUSE) {
        actionSteps = null;
        ctx.slotIdx++; // resume pokračuje NASLEDUJÚCOU akciou pôvodnej queue
        pushStateFrame(tl, [{ kind: "timestop_wait", from: slot }], SMALL_DELAY_MS);
        ctx.emittedUpTo = tl.length;
        emitStateMasked(tl); // partial emit; časovač kola sa NEspúšťa
        return;
      }
      if (foeShieldArmed) { game.players[foe].shield = false; game.players[foe].shieldGold = false; }
      if (foeMirrorArmed) { game.players[foe].mirror = false; game.players[foe].mirrorGold = false; }
      resolveTrapsAfterAction(tl);
      actionSteps = null;

      // po každej akcii skontroluj lethal
      const w = winnerNow();
      if (w) { ctx.ended = true; return finishRound(); }
      // krátka pokojová pauza medzi akciami, nech oko stihne zaregistrovať každý ťah
      pushStateFrame(tl, [], ACTION_GAP_MS);
      ctx.slotIdx++;
    }

    // koniec ťahu — efekty špeciálnych políčok (pickupy, dmg, IK)
    endOfStepTileEffects(tl, ctx.stonedStep);
    // až TERAZ ubudni kameň za skamenené passy tohto kroku — socha (kreslená zo state.stone) tak zmizne
    // až v ďalšom kroku, čiže vizuálne na začiatku nasledujúcej akcie, keď sa dlaždice pod hráčom spustia
    for (const slot of order) {
      if (!ctx.tookStoned[slot] || game.players[slot].stone <= 0) continue;
      game.players[slot].stone--;
      // posledný kameň odišiel → socha sa roztrieští (klient vykreslí kamenné úlomky, nie len preblik)
      if (game.players[slot].stone === 0) pushStateFrame(tl, [{ kind: "unpetrify", target: slot }], SMALL_DELAY_MS);
    }
    if (winnerNow()) { ctx.ended = true; return finishRound(); }
    ctx.i++;
    ctx.slotIdx = 0;
  }
  finishRound();
}

// koncová fáza kola (po dohraní všetkých akcií alebo po lethal) — pride/moon, obrany, gold fáza, doom,
// tiles, emit timeline, reset a naplánovanie ďalšieho kola. Číta game.roundCtx a na konci ho vynuluje.
function finishRound() {
  const ctx = game.roundCtx;
  const { tl, order, escUsedDefense, wandererUsedMirror, doomSlot } = ctx;
  let ended = ctx.ended;

  // koniec hry: tieňové klony miznú (aj pri výhre majiteľa) — poof po dohraní smrteľného zásahu;
  // pasce zanikajú ticho (smrť castera / koniec hry — nová hra aj tak resetuje hráčov)
  if (ended) {
    killClone("p1", tl); killClone("p2", tl);
    game.players.p1.trap = null; game.players.p2.trap = null;
  }

  // Escanor pride: koniec kola — použil obranu ALEBO dostal zásah od súpera → −1, inak → +1 (clamp 0–3;
  // stále len ±1 za kolo, podmienky sa nesčítavajú). Prejaví sa v nasledujúcom kole.
  for (const slot of ["p1", "p2"]) {
    const p = game.players[slot];
    if (p.char !== "escanor" || !(slot in escUsedDefense)) continue;
    p.pride = Math.max(0, Math.min(3, (p.pride || 0) + ((escUsedDefense[slot] || p.prideHit) ? -1 : 1)));
  }
  // flag zásahu žije len jedno kolo (nuluj bez ohľadu na char — mág sa mohol vymeniť swapom)
  game.players.p1.prideHit = false;
  game.players.p2.prideHit = false;

  // nevyužité obrany zanikajú s koncom kola
  game.players.p1.shield = false;
  game.players.p2.shield = false;
  game.players.p1.shieldGold = false;
  game.players.p2.shieldGold = false;
  game.players.p1.mirror = false;
  game.players.p2.mirror = false;
  game.players.p1.mirrorGold = false;
  game.players.p2.mirrorGold = false;

  if (!ended) {
    // post-round gold fáza: golden mana + last stand. Démon je len JEDEN — ak ho navolia obaja,
    // vyhodnotí sa len tomu, koho akcia príde na rad prvá (starter), druhému červený ✗.
    let demonUsed = false;
    for (const slot of order) {
      const p = game.players[slot];
      if (p.lastStand) {
        p.lastStand = false;
        pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: "last_stand", dir: null } }], 250);
        // skamenený hráč: zlatá akcia sa nevykoná (bez ceny) a kameň NEuberá
        if (p.stone > 0) { pushStateFrame(tl, [{ kind: "stoned", target: slot }], SMALL_DELAY_MS); continue; }
        if (demonUsed) { pushInvalid(tl, slot, SMALL_DELAY_MS, "no_demon"); continue; }
        demonUsed = true;
        resolveLastStandSummon(slot, tl); // démon zabije + oživí na plno, nastaví buff + doom na ďalšie kolo
        continue;
      }
      if (!p.goldenMana) {
        // prázdny golden-mana beat — zelená šípka cezeň prekrokuje s prázdnym počkaním (nie preskočenie).
        // V buffnutom poslednom kole (doomSlot) to nerobíme — tam je démon „end" bunka + banish.
        if (!doomSlot) pushStateFrame(tl, [{ kind: "beat_empty", from: slot, beat: "gmana" }], ACTION_GAP_MS);
        continue;
      }
      p.goldenMana = false;
      const cost = p.manaRefills + 1;
      pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: "golden_mana", dir: null } }], 250);
      // skamenený hráč: zlatá akcia sa nevykoná (bez ceny) a kameň NEuberá
      if (p.stone > 0) { pushStateFrame(tl, [{ kind: "stoned", target: slot }], SMALL_DELAY_MS); continue; }
      // refill nesmie hráča zabiť a pri plnej mane je naprázdno -> neplatný
      if (p.hp > cost && p.mana < MAX_MANA) {
        p.hp -= cost;
        const gained = Math.min(GOLDEN_MANA_GAIN, MAX_MANA - p.mana);
        p.mana += gained;
        p.manaRefills++;
        pushStateFrame(tl, [{ kind: "golden_mana", from: slot, hpCost: cost, gained }], SMALL_DELAY_MS);
      } else {
        // odmietnutý refill: plná mana (naprázdno) alebo by bol smrteľný
        pushInvalid(tl, slot, SMALL_DELAY_MS, p.mana >= MAX_MANA ? "mana_full" : "hp_low");
      }
    }

    // DOOM: ak je toto buffnuté (posledné) kolo a obaja stále žijú → démon Last Stand hráča opustí a zabije ho.
    // Banish je istá smrť = koniec hry — ak beží labyrint, prehraj rovnakú sekvenciu ako pri istom zásahu:
    // odhalenie PRED banish animáciou, koniec labyrintu (ESCAPED + rozsvietenie) po smrti — hra nesmie
    // skončiť v hmle/redakcii (rovnaké pravidlo ako smrteľný tile/IK zásah)
    if (doomSlot && !winnerNow()) {
      const labActive = game.players.p1.labyrinth || game.players.p2.labyrinth;
      if (labActive) revealLabyrinths(tl);
      resolveLastStandBanish(doomSlot, tl);
      if (labActive) endLabyrinths(tl);
      ended = true;
      game.players.p1.trap = null; game.players.p2.trap = null; // koniec hry — pasce ticho zanikajú
    }
  }

  if (!ended) {
    // Vlkolak: fáza mesiaca sa prepočíta na KONCI kola z aktuálnych HP (po tiles, golden mane aj Last Stand
    // full-heale) — nesie ju až finálny frame; klient porovná prvý/posledný frame a ukáže float s novou fázou.
    for (const slot of ["p1", "p2"]) {
      const p = game.players[slot];
      if (p.char === "werewolf") p.moon = moonLevelFor(p.hp);
    }

    // Pútnik (wanderer): pasívne +WANDERER_MANA_REGEN many na konci kola — len ak ešte žije, je aktívny
    // a v tomto kole NEpoužil mirror (obyčajný ani golden). Čierna recharge animácia (dark:true).
    for (const slot of ["p1", "p2"]) {
      const p = game.players[slot];
      if (p.char !== "wanderer" || p.hp <= 0) continue;
      if (wandererUsedMirror[slot]) {
        // použil mirror → žiadna pasívna mana; oznám hráčovi dôvod (float „MIRROR USED")
        pushStateFrame(tl, [{ kind: "wanderer_no_regen", target: slot }], SMALL_DELAY_MS);
        continue;
      }
      const gain = Math.min(MAX_MANA - p.mana, WANDERER_MANA_REGEN);
      if (gain > 0) {
        p.mana += gain;
        pushStateFrame(tl, [{ kind: "recharge", from: slot, cells: [[p.x, p.y]], amount: gain, dark: true }], SMALL_DELAY_MS);
      }
    }

    // prechod do ďalšieho kola: až TU dopadnú zmeny tiles — commit ohláseného preview + žreb nového
    // na ďalšie kolo. Oboje nesie až finálny mini-frame, takže klient ukáže nové tiles AJ čerstvý preview
    // spolu s „ROUND N / FINAL ROUND" animáciou na začiatku nasledujúceho kola, nie uprostred dohrávania akcií.
    endOfRoundTiles();
    const nextTurn    = game.turn + 1;
    const nextStarter = game.starter === "p1" ? "p2" : "p1"; // preklop (hru mohol začínať aj p2)
    tl.push({ ...snapshot(), turn: nextTurn, starter: nextStarter, effects: [], delayMs: 10 });
    game.turn    = nextTurn;
    game.starter = nextStarter;
  }

  // emit: normálne celá timeline; po THE WORLD pauze (emittedUpTo>0) len POKRAČOVANIE (už odohrané frame-y
  // sa neposielajú dvakrát) so seed frame-om súčasného stavu — klient aplikuje timeline[0] a animuje od [1]
  let emitTl = tl;
  if (ctx.emittedUpTo > 0) {
    const seed = { ...tl[ctx.emittedUpTo - 1], effects: [], delayMs: 10 };
    emitTl = [seed, ...tl.slice(ctx.emittedUpTo)];
  }
  emitStateMasked(emitTl); // per-osoba: labyrintová redakcia snapshotu AJ timeline (roster HP/mana je verejné)

  // príprava na ďalšie plánovanie (lokálny stav; vizuálne odomkne až klient po dohraní timeline)
  game.players.p1.locked = false;
  game.players.p2.locked = false;
  game.players.p1.queue = [];
  game.players.p2.queue = [];
  game.players.p1.goldenMana = false; // nevyhodnotený refill (ukončené kolo) prepadá
  game.players.p2.goldenMana = false;
  game.players.p1.goldenMirror = false;
  game.players.p2.goldenMirror = false;
  game.players.p1.lastStand = false; // nevyhodnotený last stand prepadá (buff/doom NEresetujeme — nesú sa do posledného kola)
  game.players.p2.lastStand = false;
  game.players.p1.lastHope = false; // nevyhodnotený last hope prepadá (buff platí len v rozohranom final kole, hra ním aj tak končí)
  game.players.p2.lastHope = false;
  game.players.p1.draft = { queue: [], golden: false, goldenMirror: false, goldenMana: false, lastStand: false, lastHope: false };
  game.players.p2.draft = { queue: [], golden: false, goldenMirror: false, goldenMana: false, lastStand: false, lastHope: false };

  const dur = emitTl.reduce((a, f) => a + (f.delayMs || 0), 0);
  game.roundCtx = null; // kolo dohrané — kontext už netreba (ďalšie kolo si vytvorí nový)
  if (ended) {
    handleGameEnd(dur);
  } else {
    // ďalšie kolo: backstop začne až po čase, kým klient dohrá timeline (počas neho neplánuje)
    beginPlanningTimer(dur);
  }
}

// koniec jednej hry: zapíš výhru do série; ak je séria rozhodnutá -> match_over,
// inak po dohraní timeline (na klientovi) spusti ďalšiu hru (strany ostávajú fixné, nový char-select)
function handleGameEnd(timelineDurationMs) {
  clearTurnTimer();
  const w = winnerNow(); // "p1" | "p2" | "draw"
  // tournament: ulož aktuálne HP a manu oboch nasadených magov (porazeného mág padne na 0 = trvalo mŕtvy)
  if (game.mageHp) {
    for (const slot of ["p1", "p2"]) {
      const p = game.players[slot];
      const person = game.seats[slot];
      if (p?.char && game.mageHp[person]) {
        game.mageHp[person][p.char] = Math.max(0, p.hp);
        if (game.mageMana[person]) game.mageMana[person][p.char] = Math.max(0, Math.min(MAX_MANA, p.mana));
      }
    }
  }
  let winnerPerson = null;
  if (w === "p1" || w === "p2") {
    winnerPerson = game.seats[w];
    game.seriesWins[winnerPerson] = (game.seriesWins[winnerPerson] || 0) + 1;
  }
  const matchOver = !!winnerPerson && game.seriesWins[winnerPerson] >= game.series.needed;

  // game_result dostanú obaja — klient ho vyhodnotí až na konci prehrávania timeline
  roomEmit("game_result", { gameWinner: w, series: seriesSnapshot(), matchOver });

  if (matchOver) {
    game.phase = "match_over";
    roomEmit("game_over", { winner: w, series: seriesSnapshot() }); // séria skončila
  } else {
    // medzihra: počkaj, kým klient dohrá timeline + animáciu smrti + zobrazí skóre, potom ďalšia hra.
    // Guard na identitu hry: retry/admin reset medzitým vytvorí NOVÝ game objekt — stale časovač
    // z opustenej série sa vtedy zahodí (inak by o desiatky sekúnd resetol postavy a startera
    // úplne inej rozbehnutej hry).
    const forGame = game;
    setTimeout(() => {
      if (game !== forGame) return;
      roomEmit("new_game", { series: seriesSnapshot() });
      startGame(game.series.gameIndex + 1);
    }, (timelineDurationMs || 0) + 6500);
  }
}

/* -------------------- Match / game start -------------------- */
function startMatch(config) {
  game.config = config;
  // BIELY (p1, vľavo) začína hru 1 — náhodné je, KTO je biely: osoby A/B sa vylosujú na sloty
  // ešte PRED animáciou ruletky na klientovi (color_roll nižšie je už len divadlo s hotovým výsledkom).
  // FORCE_FIRST_STARTER=A|B pripne osobu na p1/bieleho (testy). Sloty sú fixné na celú sériu;
  // v sérii (bo3/tournament) sa štartér jednotlivých hier strieda (viď startGame).
  const white = FORCE_FIRST_STARTER || (Math.random() < 0.5 ? "A" : "B");
  game.seats = { p1: white, p2: otherPerson(white) };
  game.series = {
    gameIndex: 0,
    needed: MATCH_FORMATS[config.format] || 1,
    format: config.format,
  };
  game.seriesWins = { A: 0, B: 0 };
  game.roster = null;
  game.mageHp = null;
  game.mageMana = null;
  // PORADIE emitov je kritické: ruleta farieb (nepriehľadný celoobrazovkový overlay) musí dôjsť klientovi
  // PRED prvým stavom, ktorý farbu prezradí (p2 má zrkadlený char-select + alt-color HUD). Na pomalom
  // pripojení inak klient stihne vykresliť odkrytú plochu skôr, než ju overlay prekryje.
  //  1) you_are — sloty sa práve prelosovali, klient potrebuje aktuálny slot pre `me` (join-time you_are
  //     ešte mal default sloty a mohol byť nesprávny); color_roll ho číta.
  //  2) color_roll — overlay sa zapne (zakryje predošlú obrazovku).
  //  3) state — char-select/plocha sa vykreslí UŽ POD overlayom.
  emitYouAre();
  roomEmit("color_roll", {});
  if (config.format === "tournament") {
    // slepý draft tímov: pred hrou 1 si každý vyberie TEAM_SIZE postáv z celého poolu (choose_team);
    // mageHp/mageMana vzniknú až po potvrdení oboch (finishTeamSelect → startGame(1))
    game.roster = { A: null, B: null };
    game.phase = "team_select";
    emitStateMasked();
  } else {
    startGame(1); // emitne ešte raz you_are (neškodná duplicita) + state — oboje už po color_roll
  }
}

// oba tímy potvrdené → HP a mana každého draftnutého maga štartujú na plno / na START_MANA
// a prenášajú sa medzi hrami série
function finishTeamSelect() {
  game.mageHp = { A: fullMage(START_HP, game.roster.A), B: fullMage(START_HP, game.roster.B) };
  game.mageMana = { A: fullMage(START_MANA, game.roster.A), B: fullMage(START_MANA, game.roster.B) };
  startGame(1);
}

function fullMage(value, roster) {
  const m = {};
  for (const k of roster) m[k] = value;
  return m;
}

// pripraví novú hru v sérii: strany sú FIXNÉ na celú sériu (vylosované v startMatch; p1 = biely vľavo).
// Hru 1 začína VŽDY biely (p1); v sérii (bo3/tournament) sa štartér hier strieda — hru 2 otvára čierny (p2).
// Resetne hráčov a vyčistí postavy (char-select pred každou hrou).
function startGame(gameIndex) {
  clearTurnTimer();
  game.series.gameIndex = gameIndex;

  game.players.p1 = newPlayer("p1");
  game.players.p2 = newPlayer("p2");
  game.roundCtx = null;  // rozpracované/pozastavené kolo z predošlej hry nesmie prežiť
  game.timestop = null;  // ani Jotarova time-stop pauza
  game.turn = 1;
  game.starter = (gameIndex % 2 === 1) ? "p1" : "p2"; // nepárne hry otvára biely, párne čierny; v rámci hry sa štartér kola preklápa
  game.tiles = [];
  game.iks = [];
  game.pending = null;
  rollPendingTiles(); // preview spawnov na koniec 1. kola — hráči ho vidia už pri plánovaní prvých akcií
  game.phase = "playing";

  emitYouAre();
  emitStateMasked(); // char-select potrebuje per-osoba mageHp (tournament)
}

// očisti a zvaliduj nastavenia z lobby; pri nezmysle vráti null
function sanitizeConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  const format = MATCH_FORMATS[raw.format] ? raw.format : null;
  if (!format) return null;
  const timer = TIMER_OPTIONS.has(String(raw.timer)) ? String(raw.timer) : "off";
  const perRound = Math.max(1, Math.min(3, Math.round(Number(raw.tilesPerRound) || 1)));
  const w = raw.tileWeights || {};
  const weights = {};
  let sum = 0;
  for (const k of ["dmg", "heal", "mana", "ik", "power", "block"]) {
    const v = Math.max(0, Math.round(Number(w[k]) || 0));
    weights[k] = v; sum += v;
  }
  if (sum !== 100) return null; // percentá musia dať presne 100
  return { format, tilesPerRound: perRound, tileWeights: weights, timer, tilePreview: !!raw.tilePreview };
}

  /* -------------------- Room lifecycle (per-room, closure) -------------------- */
  // Je osoba p „nažive" — má živý socket, alebo ešte beží jej grace okno (môže sa vrátiť reconnectom)?
  function personAlive(p) {
    return !!personSockets[p] || (!!personIds[p] && Date.now() - personFreedAt[p] <= RECLAIM_GRACE_MS);
  }
  // obaja hráči preč (ani jeden nažive) → roomka je prázdna
  function roomEmpty() { return !personAlive("A") && !personAlive("B"); }
  // riadok tejto roomky pre room-browser (počet hráčov, či sa dá pripojiť)
  function roomsRow() {
    const players = ["A", "B"].filter(personAlive).length;
    return { id, players, max: 2, canJoin: players < 2, phase: game.phase };
  }
  // voľné miesto (nie je obsadené živým socketom ani grace-held tokenom)
  function isFree(p) { return !personSockets[p] && (!personIds[p] || Date.now() - personFreedAt[p] > RECLAIM_GRACE_MS); }
  // token už patrí niektorej osobe tejto roomky? → vráť "A"/"B" (reclaim po reconnecte), inak null
  function reclaimPersonFor(cid) {
    if (!cid) return null;
    if (personIds.A === cid) return "A";
    if (personIds.B === cid) return "B";
    return null;
  }
  // po odpojení naplánuj kontrolu: ak sú po grace obaja stále preč, roomku zruš
  function scheduleRoomDestroyCheck() {
    if (roomDestroyTimer) clearTimeout(roomDestroyTimer);
    roomDestroyTimer = setTimeout(() => {
      roomDestroyTimer = null;
      if (roomEmpty()) destroySelf();
    }, RECLAIM_GRACE_MS + 500);
  }
  // zruš túto roomku: vyčisti stav a časovače, odstráň z registra, diváci sa vrátia na room-browser
  function destroySelf() {
    clearTurnTimer();
    if (roomDestroyTimer) { clearTimeout(roomDestroyTimer); roomDestroyTimer = null; }
    personSockets.A = null; personSockets.B = null;
    personIds.A = null; personIds.B = null;
    personNames.A = null; personNames.B = null;
    personFreedAt.A = 0; personFreedAt.B = 0;
    pendingMatchConfig = null;
    // prípadní diváci → späť na room-browser
    for (const s of spectators) { try { s.data.roomId = null; s.data.spectating = false; s.leave(String(id)); browsing.add(s); } catch {} }
    spectators.clear();
    rooms.delete(id);
    broadcastRooms();
  }
  // ak host čaká (stlačil START pred príchodom súpera) a sú už obaja → spusti zápas (color roll)
  function maybeStartPending() {
    if (pendingMatchConfig && personAlive("A") && personAlive("B") && game.phase === "lobby") {
      const cfg = pendingMatchConfig;
      pendingMatchConfig = null;
      startMatch(cfg);
    }
  }

  // posadí socket ako osobu A/B do TEJTO roomky: zapamätá token+meno, pošle mu identitu a stav
  function seat(socket, p) {
    const cid = socket.handshake.auth?.id || null;
    const old = personSockets[p];
    if (old && old !== socket) { try { old.disconnect(true); } catch {} } // odpoj starý/mŕtvy socket tej istej osoby
    personSockets[p] = socket;
    personIds[p] = cid;
    if (socket.data.pendingName) personNames[p] = socket.data.pendingName; // pri recovery pendingName prázdne → drž pôvodné
    socket.data.person = p;
    socket.data.roomId = id;
    socket.data.spectating = false;
    spectators.delete(socket);
    browsing.delete(socket);
    socket.join(String(id));
    socket.emit("you_are", { slot: slotForPerson(p), isHost: p === "A" });
    socket.emit("state", snapshotFor(p)); // počas char-selectu maskuje súperov pick
    if (p === "B") maybeStartPending(); // 2. hráč dorazil → ak host čakal, spusti zápas
  }

  // pripoj sa do tejto roomky ako 2. hráč (osoba B; ak host odišiel a B ostal, obsadí A)
  function join(socket) {
    if (socket.data.person) return;
    if (isFree("B")) { seat(socket, "B"); broadcastRooms(); }
    else if (isFree("A")) { seat(socket, "A"); broadcastRooms(); }
    else socket.emit("join_denied", "full");
  }

  // sleduj túto roomku ako divák
  function spectate(socket) {
    if (socket.data.person) return;
    browsing.delete(socket);
    spectators.add(socket);
    socket.data.roomId = id;
    socket.data.spectating = true;
    socket.join(String(id));
    socket.emit("spectator");
    socket.emit("state", snapshot());
  }

  // opusti roomku (hráč aj divák) → miesto sa uvoľní hneď, socket ide späť na room-browser
  function leave(socket) {
    const p = socket.data.person;
    if (spectators.delete(socket)) { /* divák */ }
    if (p) {
      if (personSockets[p] === socket) personSockets[p] = null;
      personIds[p] = null; personFreedAt[p] = 0; personNames[p] = null; // dobrovoľný odchod → bez grace
      socket.data.person = null;
      clearTurnTimer();
    }
    socket.data.roomId = null;
    socket.data.spectating = false;
    socket.leave(String(id));
    browsing.add(socket);
    socket.emit("rooms", roomsSnapshot());
    if (roomEmpty()) destroySelf(); else broadcastRooms(); // ak ostal sám nikto → zruš; inak uprav počet
  }

  /* -------------------- Herné handlery (per-room, dispatchnuté z io.on) -------------------- */
  // úvodná obrazovka: host nastaví formát + tiles + časový limit a spustí zápas
  function onConfigure(socket, raw) {
    if (socket.data.person !== "A") return;   // konfiguruje len host
    if (game.phase !== "lobby") return;        // len pred začiatkom zápasu
    const config = sanitizeConfig(raw);
    if (!config) return;
    if (personAlive("B")) {
      startMatch(config);                       // súper je tu → rovno štart (color roll)
    } else {
      pendingMatchConfig = config;              // súper ešte nie je → zapamätaj config a čakaj naňho
      socket.emit("state", snapshotFor("A"));   // host uvidí „čakám na druhého hráča" (awaitingOpponent)
    }
  }

  // turnajový draft: hráč naslepo potvrdí tím TEAM_SIZE unikátnych postáv z poolu CHARS (raz za zápas)
  function onChooseTeam(socket, keys) {
    const person = socket.data.person;
    if (!person) return;
    if (game.phase !== "team_select") return;
    if (!game.roster || game.roster[person]) return; // tím sa potvrdzuje raz
    if (!Array.isArray(keys) || keys.length !== TEAM_SIZE) return;
    const team = keys.map(String);
    if (new Set(team).size !== TEAM_SIZE) return;    // bez duplicít v tíme
    // len známe postavy z poolu + PRÍPADNE vlastná side-postava (p1 → countess; p2 → onre|jotaro)
    const slot = slotForPerson(person);
    if (!team.every(k => CHARS.includes(k) || SIDE_CHARS[k] === slot)) return;
    game.roster[person] = team;
    if (game.roster.A && game.roster.B) finishTeamSelect();
    else emitStateMasked(); // súper uvidí rosterReady („opponent is ready"), nie samotný tím
  }

  function onChooseCharacter(socket, key) {
    const person = socket.data.person;
    if (!person) return;
    if (game.phase !== "playing") return;       // postava sa volí len v hernej fáze (pred kolami)
    const slot = slotForPerson(person);
    // Countess/Onre: viazané na STRANU (countess len p1/biela, onre len p2/čierna). Mimo turnaja hocikedy
    // pre svoju stranu; v turnaji len ak si ich hráč draftol do svojho rosteru (mageHp existuje len v turnaji)
    const sideOk = SIDE_CHARS[key] === slot && (!game.mageHp || rosterFor(slot).includes(key));
    if (!CHARS.includes(key) && !sideOk) return;
    const me = game.players[slot];
    if (me.char) return;                          // postava sa pre danú hru volí raz
    // tournament: mŕtveho maga (HP 0) sa nedá zvoliť; HP aj mana sa prenášajú z predošlej hry
    if (game.mageHp) {
      const hp = game.mageHp[person]?.[key] ?? 0;
      if (hp <= 0) return;
      me.hp = hp;
      me.mana = game.mageMana[person]?.[key] ?? START_MANA;
    }
    me.char = key;
    me.pride = 0; // Escanor: každá nová hra začína na pride 0
    me.prideHit = false;
    me.form = "base"; // Luffy: každá hra začína v base móde
    me.moon = key === "werewolf" ? moonLevelFor(me.hp) : 0; // Vlkolak: fáza HNEĎ podľa (preneseného) HP
    // obaja vybrali -> začína 1. kolo, naštartuj časovač pred emitom (snapshot nesie timerMs pre refresh-sync)
    if (game.players.p1.char && game.players.p2.char) beginPlanningTimer(0);
    emitStateMasked(); // súperov pick sa odhalí až keď si vyberie aj druhý hráč (žiadna výhoda pre rozmýšľajúceho)
  }

  function onLockIn(socket, queue, clientTurn, ack) {
    // spätná kompat.: starší klient/test volá lock_in(queue) alebo lock_in(queue, ack) bez čísla kola
    if (typeof clientTurn === "function") { ack = clientTurn; clientTurn = undefined; }
    const person = socket.data.person;
    if (!person) return;
    if (game.phase !== "playing") return;
    const slot = slotForPerson(person);
    if (!game.players.p1.char || !game.players.p2.char) return; // ešte sa vyberajú postavy
    // počas Jotarovho THE WORLD čakania je bežný lock_in neplatný (rieši sa cez timestop_actions)
    if (game.timestop?.mode === "waiting") { if (typeof ack === "function") ack({ ok: false, reason: "timestop" }); return; }
    const me = game.players[slot];
    // zopakovaný lock_in (stratený ack) pre už vyriešené kolo → zahoď, nech sa stará voľba nevloží do nového kola
    if (clientTurn !== undefined && clientTurn !== game.turn) { if (typeof ack === "function") ack({ ok: true }); return; }
    // idempotencia: v tomto kole už som locknutý (stratil sa len ack) → len potvrď, nereparsuj voľbu
    if (me.locked) { if (typeof ack === "function") ack({ ok: true }); return; }
    if (!validQueue(queue, slot)) { if (typeof ack === "function") ack({ ok: false }); return; }
    let q = queue;
    me.lastHope = q[0]?.type === "last_hope"; // úvodná akcia (pred golden) — validQueue už overil, že smie
    if (me.lastHope) q = q.slice(1);
    me.golden = q[0]?.type === "golden_shield";
    me.goldenMirror = q[0]?.type === "golden_mirror";
    if (me.golden || me.goldenMirror) q = q.slice(1);
    const trailing = q[q.length - 1]?.type;
    me.goldenMana = trailing === "golden_mana";
    me.lastStand  = trailing === "last_stand";
    if (me.goldenMana || me.lastStand) q = q.slice(0, -1);
    me.queue = q.map(a => ({ ...a }));
    me.locked = true;
    if (typeof ack === "function") ack({ ok: true }); // potvrď klientovi prijatie ťahu (klient inak opakuje)

    if (game.players.p1.locked && game.players.p2.locked) {
      resolveTurn();
    } else {
      // quick-draw: hneď ako sa jeden locklne, druhý má QUICKDRAW_MS na ťah
      if (game.config?.timer === "quickdraw") armTurnTimer(QUICKDRAW_MS);
      emitStateMasked(); // labyrint: prekliaty nesmie dostať súperovu pozíciu ani tu
    }
  }

  // Jotaro THE WORLD: 3 zmrazené akcie od hráča Jotara počas pauzy kola. Po nich runTimestopActions
  // dohrá zvyšok kola a pošle POKRAČOVACIU timeline (finishRound cez ctx.emittedUpTo).
  function onTimestopActions(socket, queue, ack) {
    const person = socket.data.person;
    if (!person) return;
    if (game.phase !== "playing") { if (typeof ack === "function") ack({ ok: false }); return; }
    const ts = game.timestop;
    if (!ts || ts.mode !== "waiting" || !game.roundCtx) { if (typeof ack === "function") ack({ ok: false, reason: "no_timestop" }); return; }
    const slot = slotForPerson(person);
    if (slot !== ts.slot) { if (typeof ack === "function") ack({ ok: false, reason: "not_yours" }); return; }
    if (!validTimestopQueue(queue, slot)) { if (typeof ack === "function") ack({ ok: false }); return; }
    if (typeof ack === "function") ack({ ok: true });
    runTimestopActions(queue.map(a => ({ type: a.type, dir: a.dir || null })));
  }

  // priebežne posielaná rozpracovaná voľba — backstop ju pri timeoute zahrá (a doplní len chýbajúce do 3)
  function onDraftQueue(socket, d) {
    const person = socket.data.person;
    if (!person || game.phase !== "playing") return;
    const slot = slotForPerson(person);
    const me = game.players[slot];
    if (me.locked) return;
    const inQ = Array.isArray(d?.queue) ? d.queue : [];
    const out = [], used = new Set();
    const allowDemon = !!me.lastStandBuff;
    for (const a of inQ) {
      if (out.length >= 3) break;
      if (!validBasicAction(a, used, allowDemon, me.char)) continue;
      out.push({ type: a.type, dir: a.dir || null, cell: a.cell || null }); // cell = cieľ Vojakovho/Countess/Onre specialu
      used.add(a.type);
    }
    me.draft = { queue: out, golden: !!d?.golden, goldenMirror: !!d?.goldenMirror, goldenMana: !!d?.goldenMana, lastStand: !!d?.lastStand, lastHope: !!d?.lastHope };
  }

  function onRetry(socket) {
    clearTurnTimer();
    newGame();
    roomEmit("reset");
    roomEmit("state", snapshot());
  }

  function onDisconnect(socket) {
    if (spectators.delete(socket)) return; // divák odišiel — počet hráčov sa nezmenil
    const wasPlayer = personSockets.A === socket || personSockets.B === socket;
    // uvoľni len živý socket; personIds zámerne NEmažeme → hráč si po reconnecte (do grace) vyžiada svoj slot späť
    if (personSockets.A === socket) { personSockets.A = null; personFreedAt.A = Date.now(); }
    if (personSockets.B === socket) { personSockets.B = null; personFreedAt.B = Date.now(); }
    if (wasPlayer) {
      clearTurnTimer();            // bez hráča nemá zmysel auto-resolve; odpojenie diváka časovač neruší
      scheduleRoomDestroyCheck();  // ak sa obaja odpojili → po grace roomku zruš
    }
    broadcastRooms();              // ostatní na room-browseri vidia aktuálny počet hráčov
  }

  newGame(); // čerstvé lobby pri vzniku roomky
  return {
    id, roomsRow, reclaimPersonFor, seat, join, spectate, leave, forceReset,
    isEmpty: roomEmpty, onConfigure, onChooseTeam, onChooseCharacter, onLockIn, onTimestopActions, onDraftQueue, onRetry, onDisconnect,
  };
}
/* ==================== koniec Room factory ==================== */

/* -------------------- Room registry (globálne) -------------------- */
// zoznam roomiek pre room-browser + či sa dá vytvoriť nová (limit MAX_ROOMS)
function roomsSnapshot() {
  const list = [];
  for (const room of rooms.values()) list.push(room.roomsRow());
  return { rooms: list, canCreate: rooms.size < MAX_ROOMS };
}
// pošli aktuálny zoznam roomiek všetkým na room-browseri (nie posadeným hráčom ani divákom)
function broadcastRooms() {
  const snap = roomsSnapshot();
  for (const s of browsing) { try { s.emit("rooms", snap); } catch {} }
}
// admin: tvrdý reset VŠETKÝCH roomiek (odpojí hráčov, vyprázdni register)
function forceResetAll() {
  for (const room of rooms.values()) room.forceReset();
  rooms.clear();
  broadcastRooms(); // browsing klienti uvidia prázdny zoznam (canCreate)
}
function roomForSocket(socket) { return rooms.get(socket.data.roomId) || null; }

/* -------------------- Admin endpoint -------------------- */
app.get("/admin/reset-all", (req, res) => {
  if (!okAdmin(req.query.key)) return res.status(403).send("forbidden");
  forceResetAll();
  res.send("ok");
});

/* -------------------- IO -------------------- */
// Brána: heslo (ak je nejaké nastavené) + platné meno. Odmietnuté spojenie klient dostane ako `connect_error`
// s message "bad_pass" / "bad_name". Pozn.: pri connectionStateRecovery sa middleware preskočí (skipMiddlewares),
// vtedy sa meno neprepisuje (guard v seat) — recovnutý socket už bol overený.
io.use((socket, next) => {
  const pass = socket.handshake.auth?.pass;
  if (PLAYER_KEYS.size && !PLAYER_KEYS.has(pass)) return next(new Error("bad_pass"));
  const name = validateName(socket.handshake.auth?.name);
  if (!name) return next(new Error("bad_name"));
  socket.data.pendingName = name;
  next();
});

io.on("connection", (socket) => {
  const cid = socket.handshake.auth?.id || null; // trvalý token klienta (localStorage)
  socket.data.person = null;
  socket.data.roomId = null;

  // reclaim naprieč roomkami: token už patrí hráčovi v niektorej žijúcej roomke → vráť ho rovno na miesto
  let placed = false;
  if (cid) {
    for (const room of rooms.values()) {
      const p = room.reclaimPersonFor(cid);
      if (p) { room.seat(socket, p); placed = true; break; }
    }
  }
  if (!placed) {
    // nový príchod → room-browser (create/join/spectate); miesto sa pridelí až explicitne
    browsing.add(socket);
    socket.emit("rooms", roomsSnapshot());
  }
  broadcastRooms();

  // --- Room lifecycle (globálny routing) ---
  socket.on("create_room", () => {
    if (socket.data.person || socket.data.roomId) return; // už niekde je
    if (rooms.size >= MAX_ROOMS) return;                  // limit počtu roomiek
    const room = createRoom(nextRoomId++);
    rooms.set(room.id, room);
    room.seat(socket, "A"); // tvorca = host (osoba A) a nastaví parametre zápasu
    broadcastRooms();
  });
  socket.on("join_room", (arg) => {
    if (socket.data.person || socket.data.roomId) return;
    const room = rooms.get(arg?.roomId);
    if (!room) return;
    room.join(socket);
  });
  socket.on("spectate_room", (arg) => {
    if (socket.data.person || socket.data.roomId) return;
    const room = rooms.get(arg?.roomId);
    if (!room) return;
    room.spectate(socket);
  });
  socket.on("leave_room", () => { roomForSocket(socket)?.leave(socket); });

  // --- Herné eventy (dispatch do roomky socketu) ---
  socket.on("configure_match", (raw) => roomForSocket(socket)?.onConfigure(socket, raw));
  socket.on("choose_team", (keys) => roomForSocket(socket)?.onChooseTeam(socket, keys));
  socket.on("choose_character", (key) => roomForSocket(socket)?.onChooseCharacter(socket, key));
  socket.on("lock_in", (queue, clientTurn, ack) => roomForSocket(socket)?.onLockIn(socket, queue, clientTurn, ack));
  socket.on("timestop_actions", (queue, ack) => roomForSocket(socket)?.onTimestopActions(socket, queue, ack));
  socket.on("draft_queue", (d) => roomForSocket(socket)?.onDraftQueue(socket, d));
  socket.on("retry", () => roomForSocket(socket)?.onRetry(socket));

  // --- admin reset cez socket (napr. z klienta s ?admin=1) — globálny (všetky roomky)
  socket.on("admin_reset_all", (key) => { if (okAdmin(key)) forceResetAll(); });

  // --- admin reset LEN tejto roomky (rohový button v hre): odpojí jej hráčov aj divákov a roomku zruší
  socket.on("admin_reset_room", (key) => {
    if (!okAdmin(key)) return;
    const room = roomForSocket(socket);
    if (!room) return;
    room.forceReset();         // odpojí hráčov + divákov, zruší časovače
    rooms.delete(room.id);     // vyradí roomku z registra
    broadcastRooms();          // ostatní na room-browseri uvidia aktuálny zoznam
  });

  socket.on("disconnect", () => {
    browsing.delete(socket);
    roomForSocket(socket)?.onDisconnect(socket);
  });
});

httpServer.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
