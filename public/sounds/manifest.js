// public/sounds/manifest.js - REGISTER ZVUKOV: herná udalosť → zvukový súbor(y). Jediný zdroj pravdy o tom,
// čo hrá kedy, odkiaľ súbor je a kto ho vybral. Čisté dáta (importovateľné aj v Node - test/sounds.mjs, tools/sounds-report.mjs).
//
// Položka:  "kľúč": { files: [...], vol, status, note? }
//   files  - cesty relatívne k /sounds/ (viac súborov = náhodná variácia pri každom prehratí; [] = ticho)
//   vol    - hlasitosť 0–2 (MAX_VOL v pack.js; nad 1 = zosilnenie tichej nahrávky, hudba najviac 1); násobí sa
//            hlasitosťou efektov/hudby z nastavení. Hlasy postáv nastavuje tools/voice-loudness.mjs (LUFS).
//   status - "default" = dohľadal Claude (zatiaľ len odhad podľa názvu súboru, nikto ho nepočul v hre)
//            "picked"  = vybral vlastník (tvorivé rozhodnutie - bez pýtania NEMENIŤ)
//   note   - voliteľná poznámka (prečo / čo ešte chýba)
//
// Kľúče postáv: "<udalosť>.<char>" prebíja všeobecné "<udalosť>" (napr. "special.fire" pred "special").
// Zdroj súboru sa odvodí z priečinka: lib/<balík>/ → SOUND_SOURCES[<balík>], custom/ → vlastné súbory.
// Výber a skúšanie: /sound-lab.html (prehrá knižnicu, priradí, exportuje zmeny sem). Workflow: docs/SOUNDS.md.

// verzia SADY UDALOSTÍ (kľúčov). Premenovanie / zrušenie kľúča = zvýš verziu a doplň KEY_MIGRATIONS
// { <nová verzia>: { "starý.kľúč": "nový.kľúč" | null (zrušený) } } - staršie balíky sa tak preložia.
// test/sound-pack.mjs drží snímku kľúčov každej verzie (test/fixtures/sound-api-<n>.json) a zmenu bez
// zvýšenia verzie odmietne.
export const SOUND_API_VERSION = 1;
export const KEY_MIGRATIONS = {};

export const SOUND_SOURCES = {
  "kenney-impact-sounds":    { title: "Impact Sounds",    author: "Kenney", url: "https://kenney.nl/assets/impact-sounds",    license: "CC0 1.0" },
  "kenney-interface-sounds": { title: "Interface Sounds", author: "Kenney", url: "https://kenney.nl/assets/interface-sounds", license: "CC0 1.0" },
  "kenney-rpg-audio":        { title: "RPG Audio",        author: "Kenney", url: "https://kenney.nl/assets/rpg-audio",        license: "CC0 1.0" },
  "kenney-sci-fi-sounds":    { title: "Sci-fi Sounds",    author: "Kenney", url: "https://kenney.nl/assets/sci-fi-sounds",    license: "CC0 1.0" },
  "kenney-digital-audio":    { title: "Digital Audio",    author: "Kenney", url: "https://kenney.nl/assets/digital-audio",    license: "CC0 1.0" },
  "kenney-music-jingles":    { title: "Music Jingles",    author: "Kenney", url: "https://kenney.nl/assets/music-jingles",    license: "CC0 1.0" },
  "cynicmusic":              { title: "Battle Theme A / Town Theme RPG", author: "cynicmusic.com",
                               url: "https://opengameart.org/content/battle-theme-a", license: "CC0 1.0" },
  "custom":                  { title: "Vlastné súbory vlastníka", author: "—", url: "", license: "vlastné" },
};

const IMP = "lib/kenney-impact-sounds/";
const UI  = "lib/kenney-interface-sounds/";
const RPG = "lib/kenney-rpg-audio/";
const SCI = "lib/kenney-sci-fi-sounds/";
const DIG = "lib/kenney-digital-audio/";
const JIN = "lib/kenney-music-jingles/";
const MUS = "lib/cynicmusic/";
const vars = (base, n, ext = ".ogg") => Array.from({ length: n }, (_, i) => `${base}${String(i).padStart(3, "0")}${ext}`);

export const SOUNDS = {
  /* ---------- hudba (slučka) ---------- */
  "music.menu":   { files: [MUS + "cynic-town-theme.mp3"],     vol: 0.45, status: "default", note: "lobby, výber postavy, draft" },
  "music.battle": { files: [MUS + "cynic-battle-theme-a.mp3"], vol: 0.40, status: "default", note: "hra (obe postavy zvolené)" },
  "music.final":  { files: [],                                 vol: 0.40, status: "default", note: "FINAL ROUND (Last Stand) - prázdne = hrá ďalej music.battle" },

  /* ---------- koniec hry ---------- */
  "game.win":   { files: [JIN + "jingles_NES00.ogg"], vol: 0.7, status: "default" },
  "game.lose":  { files: [JIN + "jingles_NES09.ogg"], vol: 0.7, status: "default" },
  "death":      { files: [IMP + "impactBell_heavy_002.ogg"], vol: 0.6, status: "default", note: "porazený padá" },

  /* ---------- UI ---------- */
  "ui.click":       { files: [UI + "click_002.ogg"],        vol: 0.35, status: "default", note: "každé tlačidlo" },
  "ui.lock_in":     { files: [UI + "confirmation_002.ogg"], vol: 0.6,  status: "default" },
  "ui.pick":        { files: [UI + "select_003.ogg"],       vol: 0.6,  status: "default", note: "voľba postavy" },
  "ui.hover_char":  { files: [],                            vol: 0.8,  status: "default", note: "myš nad kartou postavy - hlas mena (ui.hover_char.<postava>); prázdne = ticho" },
  "ui.timer_tick":  { files: [UI + "tick_002.ogg"],         vol: 0.5,  status: "default", note: "posledných 5 s ťahu" },
  "ui.color_roll":  { files: [UI + "scroll_003.ogg"],       vol: 0.5,  status: "default", note: "roztočenie yin-yang šípky" },
  "round.start":    { files: [JIN + "jingles_HIT03.ogg"],   vol: 0.5,  status: "default", note: "banner ROUND N" },
  "round.final":    { files: ["custom/round/final-round.mp3"], vol: 0.78, fit: "keep", trim: { "custom/round/final-round.mp3": [80,2180] }, status: "picked", note: "banner FINAL ROUND (1,9 s; súbor 2,1 s)" },

  /* ---------- pohyb ---------- */
  "move":      { files: vars(IMP + "footstep_concrete_", 5), vol: 0.5, status: "default" },
  "dash":      { files: [RPG + "cloth1.ogg", RPG + "cloth2.ogg", RPG + "cloth3.ogg", RPG + "cloth4.ogg"], vol: 0.7, status: "default" },
  "wall_bump": { files: vars(IMP + "impactSoft_medium_", 5), vol: 0.5, status: "default", note: "akcia do steny" },
  "teleport":  { files: [DIG + "phaseJump3.ogg"], vol: 0.5, status: "default", note: "turnajový swap, teleport pasce" },

  /* ---------- útoky ---------- */
  "attack":         { files: vars(SCI + "laserSmall_", 5), vol: 0.45, status: "default", note: "výstrel basic strely" },
  "attack.soldier": { files: vars(IMP + "impactMetal_light_", 5), vol: 0.5, status: "default", note: "hod granátu" },
  "attack_whiff":   { files: [RPG + "knifeSlice.ogg"], vol: 0.5, status: "default", note: "strela mimo hraciu plochu" },
  "melee":          { files: vars(IMP + "impactPunch_medium_", 5), vol: 0.6, status: "default", note: "švih/úder melee" },
  "explosion":      { files: vars(SCI + "explosionCrunch_", 5), vol: 0.5, status: "default", note: "výbuch granátu / sniper zásahu" },

  /* ---------- zásahy a obrany ---------- */
  "hit":         { files: vars(IMP + "impactPunch_heavy_", 5), vol: 0.6, status: "default", note: "zásah do HP (< 8 dmg)" },
  "hit_heavy":   { files: [SCI + "lowFrequency_explosion_000.ogg"], vol: 0.6, status: "default", note: "zásah ≥ 8 dmg" },
  "block":       { files: vars(IMP + "impactMetal_heavy_", 5), vol: 0.55, status: "default", note: "štít zablokoval" },
  "mirror":      { files: [IMP + "impactBell_heavy_001.ogg"], vol: 0.55, status: "default", note: "zrkadlo odrazilo" },
  "shield":      { files: [SCI + "forceField_000.ogg"], vol: 0.5, status: "default", note: "aktivácia štítu" },
  "mirror_on":   { files: [UI + "glass_003.ogg"], vol: 0.6, status: "default", note: "aktivácia zrkadla" },
  "golden_shield": { files: [SCI + "forceField_002.ogg"], vol: 0.6, status: "default" },
  "golden_mirror": { files: [UI + "glass_005.ogg"], vol: 0.7, status: "default" },

  /* ---------- mana, HP, stav ---------- */
  "recharge":    { files: [DIG + "powerUp2.ogg"], vol: 0.45, status: "default" },
  "golden_mana": { files: [DIG + "powerUp8.ogg"], vol: 0.5, status: "default" },
  "pass":        { files: [UI + "question_002.ogg"], vol: 0.5, status: "default", note: "💭 THINKING" },
  "invalid":     { files: [UI + "error_002.ogg"], vol: 0.45, status: "default", note: "prečiarknutá akcia (chýba mana / blok)" },
  "heal":        { files: [DIG + "powerUp5.ogg"], vol: 0.5, status: "default", note: "liečenie (Vampire bonus)" },
  "mana_drain":  { files: [DIG + "phaserDown1.ogg"], vol: 0.5, status: "default", note: "Onryō bonus" },
  "petrify":     { files: vars(IMP + "impactMining_", 5), vol: 0.6, status: "default" },
  "unpetrify":   { files: vars(IMP + "impactGlass_light_", 5), vol: 0.5, status: "default", note: "kameň sa rozpadne" },

  /* ---------- dlaždice ---------- */
  "tile.dmg":     { files: vars(IMP + "impactSoft_heavy_", 5), vol: 0.45, status: "default" },
  "tile.heal":    { files: [DIG + "powerUp5.ogg"], vol: 0.5, status: "default" },
  "tile.mana":    { files: [DIG + "phaserUp3.ogg"], vol: 0.5, status: "default" },
  "tile.ik":      { files: [SCI + "lowFrequency_explosion_001.ogg"], vol: 0.6, status: "default" },
  "tile_consume": { files: [UI + "drop_002.ogg"], vol: 0.5, status: "default", note: "Fire/power tile spotrebovaná" },

  /* ---------- statusy a mechaniky ---------- */
  "labyrinth":      { files: [SCI + "doorClose_000.ogg"], vol: 0.6, status: "default", note: "kliatba labyrintu" },
  "labyrinth_end":  { files: [SCI + "doorOpen_001.ogg"], vol: 0.6, status: "default", note: "ESCAPED" },
  "clone_summon":   { files: [DIG + "phaseJump1.ogg"], vol: 0.5, status: "default" },
  "clone_die":      { files: [DIG + "phaserDown2.ogg"], vol: 0.5, status: "default", note: "puf klona" },
  "trap_set":       { files: [RPG + "metalLatch.ogg"], vol: 0.6, status: "default", note: "počuje len majiteľ (súperovi je efekt odfiltrovaný)" },
  "trap_trigger":   { files: [UI + "glitch_002.ogg"], vol: 0.6, status: "default" },
  "trap_break":     { files: vars(IMP + "impactGlass_medium_", 5), vol: 0.5, status: "default" },
  "timestop_start": { files: [DIG + "lowDown.ogg"], vol: 0.7, status: "default", note: "THE WORLD" },
  "timestop_end":   { files: [DIG + "highUp.ogg"], vol: 0.7, status: "default" },
  "demon_summon":   { files: ["custom/demon/reaper-attack.mp3"], vol: 1.07, fit: "keep", trim: { "custom/demon/reaper-attack.mp3": [180,8960] }, status: "picked", note: "REAPER - útok démona ako jedna stopa: vynorenie → 3 bliknutia → zásah → odchod (okno cez celú fázu)" },
  "last_stand":     { files: ["custom/demon/reaper-intro1.mp3"], vol: 0.91, fit: "keep", trim: { "custom/demon/reaper-intro1.mp3": [80,2600] }, status: "picked", note: "REAPER - pakt Last Stand, STOPA 1: vyvolanie (démon sa vynorí a odčerpá HP/manu, až po smrť); okno = celá fáza" },
  "last_hope":      { files: ["custom/hope/last-hope.mp3"], vol: 1.04, fit: "keep", status: "picked", note: "Last Hope ako jedna stopa: postava sa vynorí → HP 1 / mana 10 → zmizne (okno 3,3 s; súbor 3,8 s - doznievanie ide do ďalšej akcie)" },

  /* ---------- zatiaľ ticho (udalosť je napojená, čaká na výber vlastníka) ---------- */
  "demon_attack":      { files: [], vol: 0.7, status: "default", note: "útok démona (Last Stand)" },
  "last_stand_kill":   { files: ["custom/demon/reaper-intro2.mp3"], vol: 0.95, fit: "keep", trim: { "custom/demon/reaper-intro2.mp3": [180,4400] }, status: "picked", note: "REAPER - pakt Last Stand, STOPA 2: smrť + oživenie (démon za postavou, zlaté dvíhanie, hráč vstane); okno = celá fáza" },
  "last_stand_revive": { files: [], vol: 0.7, status: "default", note: "oživenie po pakte - hrá uprostred STOPY 2 (last_stand_kill); pri jednej stope nechaj prázdne" },
  "last_stand_banish_kill": { files: [], vol: 0.7, status: "default", note: "smrť pri vyhnaní démona (doom na konci FINAL ROUND)" },
  "last_stand_banish": { files: ["custom/demon/reaper-outro-shorter.mp3"], vol: 0.94, fit: "keep", trim: { "custom/demon/reaper-outro-shorter.mp3": [0,4680] }, status: "picked", note: "REAPER - démon odchádza na konci FINAL ROUND (banish) ako jedna stopa: duch opustí postavu → v strede → odčerpanie → smrť" },
  "stoned":            { files: [], vol: 0.5, status: "default", note: "skamenený preskakuje akciu" },
  "labyrinth_reveal":  { files: [], vol: 0.6, status: "default", note: "skrytý súper sa zjaví pred zásahom" },
  "thread_mark":       { files: [], vol: 0.5, status: "default", note: "stretnutie na Ariadninej niti" },
  "clone_born":        { files: [], vol: 0.5, status: "default", note: "klon sa zrodil (po summone)" },
  "clone_hit":         { files: [], vol: 0.4, status: "default", note: "dmg dlaždica na klonovi" },
  "teleport_in":       { files: [], vol: 0.5, status: "default", note: "objavenie (swap / pasca)" },
  "vamp_heal_cast":    { files: [], vol: 0.5, status: "default", note: "Countess liečivé beaty" },
  "luffy_ball_form":   { files: [], vol: 0.6, status: "default", note: "Luffy premena na guľu" },
  "wanderer_no_regen": { files: [], vol: 0.5, status: "default", note: "Wanderer prišiel o regeneráciu" },

  /* ---------- specialy (cast) - kľúč special.<char> ---------- */
  "special":           { files: [DIG + "zap1.ogg"], vol: 0.5, status: "default", note: "fallback pre postavu bez vlastného" },
  "special.fire":      { files: [SCI + "explosionCrunch_000.ogg"], vol: 0.55, status: "default" },
  "special.lightning": { files: [SCI + "laserLarge_000.ogg"], vol: 0.55, status: "default" },
  "special.wanderer":  { files: [DIG + "phaserDown3.ogg"], vol: 0.55, status: "default" },
  "special.medusa":    { files: [UI + "glitch_001.ogg"], vol: 0.6, status: "default" },
  "special.minotaur":  { files: [SCI + "doorClose_002.ogg"], vol: 0.6, status: "default" },
  "special.naruto":    { files: [RPG + "bookFlip2.ogg"], vol: 0.6, status: "default", note: "pečate rúk" },
  "special.escanor":   { files: [SCI + "laserLarge_003.ogg"], vol: 0.6, status: "default", note: "Cruel Sun" },
  "special.soldier":   { files: [DIG + "tone1.ogg"], vol: 0.4, status: "default", note: "zamierenie (laser)" },
  "special.werewolf":  { files: [DIG + "lowRandom.ogg"], vol: 0.55, status: "default", note: "chýba vytie - kandidát na vlastný súbor" },
  "special.countess":  { files: [DIG + "phaserDown1.ogg"], vol: 0.5, status: "default" },
  "special.onre":      { files: [UI + "glitch_003.ogg"], vol: 0.6, status: "default" },
  "special.jotaro":    { files: [IMP + "impactPunch_heavy_002.ogg"], vol: 0.6, status: "default", note: "Special 2 (THE WORLD má timestop_start)" },
  "special.luffy":     { files: [RPG + "creak1.ogg"], vol: 0.6, status: "default" },

  /* ---------- akcie konkrétnych postáv ---------- */
  "soldier_beam":  { files: [SCI + "laserLarge_004.ogg"], vol: 0.6, status: "default", note: "sniper výstrel" },
  "wolf_charge":   { files: vars(IMP + "footstep_grass_", 5), vol: 0.6, status: "default" },
  "wolf_strike":   { files: [IMP + "impactPunch_heavy_004.ogg"], vol: 0.7, status: "default" },
  "vamp_charge":   { files: [RPG + "cloth4.ogg"], vol: 0.6, status: "default" },
  "vamp_strike":   { files: [RPG + "knifeSlice2.ogg"], vol: 0.6, status: "default" },
  "special1":      { files: vars(IMP + "impactPunch_heavy_", 5), vol: 0.6, status: "default", note: "Jotaro Special 1 (ORA)" },
  "luffy_pull":    { files: [RPG + "creak2.ogg"], vol: 0.6, status: "default", note: "gumové natiahnutie" },
  "luffy_gp":      { files: [RPG + "creak3.ogg"], vol: 0.6, status: "default", note: "Gear 3 nádych" },
  "luffy_roll":    { files: vars(IMP + "impactWood_medium_", 5), vol: 0.5, status: "default" },
  "luffy_explode": { files: [SCI + "explosionCrunch_002.ogg"], vol: 0.6, status: "default" },
  "luffy_chomp":   { files: [RPG + "chop.ogg"], vol: 0.6, status: "default" },

  /* ---------- HLAS postavy (samostatná vrstva popri efekte, raz na začiatku akcie) - kľúč voice.<akcia>.<postava> ---------- */
  "voice.attack":  { files: [], vol: 0.9, fit: "keep", status: "default", note: "hlas na začiatku basic strely; prázdne = ticho" },
  "voice.melee":   { files: [], vol: 0.9, fit: "keep", status: "default", note: "hlas na začiatku melee (raz, efekt úderu ide zvlášť pri každom švihu); prázdne = ticho" },
  "voice.special": { files: [], vol: 0.9, fit: "keep", status: "default", note: "hlas na začiatku špeciálu; prázdne = ticho" },
  "voice.special2": { files: [], vol: 0.9, fit: "keep", status: "default", note: "hlas na začiatku Special 2 (Jotaro po THE WORLD); prázdne = ticho" },

  /* ---------- hlasy mágov (vlastník, 17.10.) - custom/mages/<postava>-<intro|range|melee|special>.mp3 ---------- */
  "ui.hover_char.fire": { files: ["custom/mages/fire-intro.mp3"], vol: 1.09, fit: "keep", trim: { "custom/mages/fire-intro.mp3": [120,1120] }, status: "picked", note: "hover nad kartou pri výbere postavy" },
  "voice.attack.fire": { files: ["custom/mages/fire-range.mp3"], vol: 1.14, fit: "keep", trim: { "custom/mages/fire-range.mp3": [200,980] }, status: "picked", note: "hlas na začiatku basic strely (aj mimo plochy)" },
  "voice.melee.fire": { files: ["custom/mages/fire-melee.mp3"], vol: 0.67, fit: "keep", trim: { "custom/mages/fire-melee.mp3": [220,3880] }, status: "picked", note: "hlas na začiatku melee (raz, nie pri každom švihu)" },
  "voice.special.fire": { files: ["custom/mages/fire-special.mp3"], vol: 0.6, fit: "keep", trim: { "custom/mages/fire-special.mp3": [20,3240] }, status: "picked", note: "hlas na začiatku špeciálu" },
  "ui.hover_char.lightning": { files: ["custom/mages/lightning-intro.mp3"], vol: 0.93, fit: "keep", trim: { "custom/mages/lightning-intro.mp3": [60,1320] }, status: "picked", note: "hover nad kartou pri výbere postavy" },
  "voice.attack.lightning": { files: ["custom/mages/lightning-range.mp3"], vol: 1.09, fit: "keep", trim: { "custom/mages/lightning-range.mp3": [80,1240] }, status: "picked", note: "hlas na začiatku basic strely (aj mimo plochy)" },
  "voice.melee.lightning": { files: ["custom/mages/lightning-melee.mp3"], vol: 0.98, fit: "keep", trim: { "custom/mages/lightning-melee.mp3": [20,3380] }, status: "picked", note: "hlas na začiatku melee (raz, nie pri každom švihu)" },
  "voice.special.lightning": { files: ["custom/mages/lightning-special.mp3"], vol: 0.98, fit: "keep", trim: { "custom/mages/lightning-special.mp3": [60,3260] }, status: "picked", note: "hlas na začiatku špeciálu" },
  "ui.hover_char.wanderer": { files: ["custom/mages/wanderer-intro.mp3"], vol: 0.91, fit: "keep", trim: { "custom/mages/wanderer-intro.mp3": [40,1980] }, status: "picked", note: "hover nad kartou pri výbere postavy" },
  "voice.attack.wanderer": { files: ["custom/mages/wanderer-range.mp3"], vol: 0.73, fit: "keep", trim: { "custom/mages/wanderer-range.mp3": [0,1800] }, status: "picked", note: "hlas na začiatku basic strely (aj mimo plochy)" },
  "voice.melee.wanderer": { files: ["custom/mages/wanderer-melee.mp3"], vol: 0.85, fit: "keep", trim: { "custom/mages/wanderer-melee.mp3": [20,3440] }, status: "picked", note: "hlas na začiatku melee (raz, nie pri každom švihu); orezané pred „bend over…“ (fráza 3 od 3,86 s)" },
  /* ---------- hlasy Medusa / Minotaur / Naruto (vlastník, 17.10.) - Minotaur nahradený 18.10. - rovnaká schéma ako mágovia ---------- */
  "ui.hover_char.medusa": { files: ["custom/mages/medusa-intro.mp3"], vol: 1.18, fit: "keep", trim: { "custom/mages/medusa-intro.mp3": [20,960] }, status: "picked", note: "hover nad kartou pri výbere postavy" },
  "voice.attack.medusa": { files: ["custom/mages/medusa-range.mp3"], vol: 1.08, fit: "keep", trim: { "custom/mages/medusa-range.mp3": [40,1300] }, status: "picked", note: "hlas na začiatku basic strely (aj mimo plochy)" },
  "voice.melee.medusa": { files: ["custom/mages/medusa-melee.mp3"], vol: 0.68, fit: "keep", trim: { "custom/mages/medusa-melee.mp3": [0,3760] }, status: "picked", note: "hlas na začiatku melee (raz, nie pri každom švihu)" },
  "voice.special.medusa": { files: ["custom/mages/medusa-special.mp3"], vol: 0.95, fit: "keep", trim: { "custom/mages/medusa-special.mp3": [80,4480] }, status: "picked", note: "hlas na začiatku špeciálu" },
  "ui.hover_char.minotaur": { files: ["custom/mages/minotaur-intro.mp3"], vol: 0.61, fit: "keep", trim: { "custom/mages/minotaur-intro.mp3": [20,1380] }, status: "picked", note: "hover nad kartou pri výbere postavy" },
  "voice.attack.minotaur": { files: ["custom/mages/minotaur-range.mp3"], vol: 0.73, fit: "keep", trim: { "custom/mages/minotaur-range.mp3": [60,1920] }, status: "picked", note: "hlas na začiatku basic strely (aj mimo plochy)" },
  "voice.melee.minotaur": { files: ["custom/mages/minotaur-melee.mp3"], vol: 0.76, fit: "keep", trim: { "custom/mages/minotaur-melee.mp3": [60,3920] }, status: "picked", note: "hlas na začiatku melee (raz, nie pri každom švihu)" },
  "voice.special.minotaur": { files: ["custom/mages/minotaur-special.mp3"], vol: 0.71, fit: "keep", trim: { "custom/mages/minotaur-special.mp3": [20,5980] }, status: "picked", note: "hlas na začiatku špeciálu" },
  "ui.hover_char.naruto": { files: ["custom/mages/naruto-intro.mp3"], vol: 0.31, fit: "keep", trim: { "custom/mages/naruto-intro.mp3": [0,1186] }, status: "picked", note: "hover nad kartou pri výbere postavy" },
  "voice.attack.naruto": { files: ["custom/mages/naruto-range.mp3"], vol: 0.39, fit: "keep", trim: { "custom/mages/naruto-range.mp3": [800,2339] }, status: "picked", note: "hlas na začiatku basic strely (aj mimo plochy); začína až hlavnou replikou (tichý úvod 0-0,8 s odstrihnutý)" },
  "voice.melee.naruto": { files: ["custom/mages/naruto-melee.mp3"], vol: 0.29, fit: "keep", trim: { "custom/mages/naruto-melee.mp3": [380,4520] }, status: "picked", note: "hlas na začiatku melee (raz, nie pri každom švihu)" },
  "voice.special.naruto": { files: ["custom/mages/naruto-special.mp3"], vol: 0.75, fit: "keep", trim: { "custom/mages/naruto-special.mp3": [380,4598] }, status: "picked", note: "hlas na začiatku špeciálu" },
  /* ---------- hlasy Escanor / Soldier / Werewolf (vlastník, 18.10.) - rovnaká schéma ako mágovia ---------- */
  "ui.hover_char.escanor": { files: ["custom/mages/escanor-intro.mp3"], vol: 0.56, fit: "keep", trim: { "custom/mages/escanor-intro.mp3": [0,1420] }, status: "picked", note: "hover nad kartou pri výbere postavy" },
  "voice.attack.escanor": { files: ["custom/mages/escanor-range.mp3"], vol: 0.19, fit: "keep", trim: { "custom/mages/escanor-range.mp3": [0,2315] }, status: "picked", note: "hlas na začiatku basic strely (aj mimo plochy)" },
  "voice.melee.escanor": { files: ["custom/mages/escanor-melee.mp3"], vol: 0.52, fit: "keep", trim: { "custom/mages/escanor-melee.mp3": [0,3940] }, status: "picked", note: "hlas na začiatku melee (raz, nie pri každom švihu)" },
  "voice.special.escanor": { files: ["custom/mages/escanor-special.mp3"], vol: 0.43, fit: "keep", status: "picked", note: "hlas na začiatku špeciálu; vlastník ručne skrátil (bez záverečného „DIE“) - hrá celý súbor" },
  "ui.hover_char.soldier": { files: ["custom/mages/soldier-intro.mp3"], vol: 1.86, fit: "keep", trim: { "custom/mages/soldier-intro.mp3": [40,720] }, status: "picked", note: "hover nad kartou pri výbere postavy" },
  "voice.attack.soldier": { files: ["custom/mages/soldier-range.mp3"], vol: 1.35, fit: "keep", trim: { "custom/mages/soldier-range.mp3": [60,800] }, status: "picked", note: "hlas na začiatku basic strely (aj mimo plochy)" },
  "voice.melee.soldier": { files: ["custom/mages/soldier-melee.mp3"], vol: 1.34, fit: "keep", trim: { "custom/mages/soldier-melee.mp3": [20,4700] }, status: "picked", note: "hlas na začiatku melee (raz, nie pri každom švihu)" },
  "voice.special.soldier": { files: ["custom/mages/soldier-special.mp3"], vol: 1.47, fit: "keep", trim: { "custom/mages/soldier-special.mp3": [40,2900] }, status: "picked", note: "hlas na začiatku špeciálu" },
  "ui.hover_char.werewolf": { files: ["custom/mages/werewolf-intro.mp3"], vol: 1.28, fit: "keep", trim: { "custom/mages/werewolf-intro.mp3": [40,880] }, status: "picked", note: "hover nad kartou pri výbere postavy" },
  "voice.attack.werewolf": { files: ["custom/mages/werewolf-range.mp3"], vol: 1.28, fit: "keep", trim: { "custom/mages/werewolf-range.mp3": [60,1520] }, status: "picked", note: "hlas na začiatku basic strely (aj mimo plochy)" },
  "voice.melee.werewolf": { files: ["custom/mages/werewolf-melee.mp3"], vol: 1.2, fit: "keep", trim: { "custom/mages/werewolf-melee.mp3": [160,5120] }, status: "picked", note: "hlas na začiatku melee (raz, nie pri každom švihu)" },
  "voice.special.werewolf": { files: ["custom/mages/werewolf-special.mp3"], vol: 1.13, fit: "keep", trim: { "custom/mages/werewolf-special.mp3": [40,5500] }, status: "picked", note: "hlas na začiatku špeciálu" },
  /* ---------- hlasy Jotaro / Onryō (onre) / Vampire (countess) (vlastník, 18.10.) - rovnaká schéma ---------- */
  "ui.hover_char.jotaro": { files: ["custom/mages/jotaro-intro.mp3"], vol: 0.36, fit: "keep", trim: { "custom/mages/jotaro-intro.mp3": [80,1400] }, status: "picked", note: "hover nad kartou pri výbere postavy" },
  "voice.attack.jotaro": { files: ["custom/mages/jotaro-range.mp3"], vol: 0.23, fit: "keep", trim: { "custom/mages/jotaro-range.mp3": [80,1160] }, status: "picked", note: "hlas na začiatku basic strely (aj mimo plochy)" },
  "voice.melee.jotaro": { files: ["custom/mages/jotaro-melee.mp3"], vol: 0.16, fit: "keep", trim: { "custom/mages/jotaro-melee.mp3": [80,4650] }, status: "picked", note: "hlas na začiatku melee (raz, nie pri každom švihu)" },
  "voice.special.jotaro": { files: ["custom/mages/jotaro-special.mp3"], vol: 0.19, fit: "keep", trim: { "custom/mages/jotaro-special.mp3": [40,2042] }, status: "picked", note: "hlas THE WORLD (timestop_start)" },
  "voice.special2.jotaro": { files: ["custom/mages/jotaro-special2.mp3"], vol: 0.23, fit: "keep", trim: { "custom/mages/jotaro-special2.mp3": [80,2640] }, status: "picked", note: "hlas na začiatku Special 2 (po THE WORLD nahrádza special)" },
  "ui.hover_char.onre": { files: ["custom/mages/onre-intro.mp3"], vol: 1.82, fit: "keep", trim: { "custom/mages/onre-intro.mp3": [20,1160] }, status: "picked", note: "hover nad kartou pri výbere postavy" },
  "voice.attack.onre": { files: ["custom/mages/onre-range.mp3"], vol: 0.66, fit: "keep", trim: { "custom/mages/onre-range.mp3": [0,1180] }, status: "picked", note: "hlas na začiatku basic strely (aj mimo plochy)" },
  "voice.melee.onre": { files: ["custom/mages/onre-melee.mp3"], vol: 1.33, fit: "keep", trim: { "custom/mages/onre-melee.mp3": [0,1520] }, status: "picked", note: "hlas melee (raz, nie pri každom švihu) aj pri údere pasce" },
  "voice.special.onre": { files: ["custom/mages/onre-special.mp3"], vol: 0.97, fit: "keep", trim: { "custom/mages/onre-special.mp3": [0,5440] }, status: "picked", note: "hlas na začiatku špeciálu" },
  "ui.hover_char.countess": { files: ["custom/mages/countess-intro.mp3"], vol: 1.94, fit: "keep", trim: { "custom/mages/countess-intro.mp3": [0,1000] }, status: "picked", note: "hover nad kartou pri výbere postavy" },
  "voice.attack.countess": { files: ["custom/mages/countess-range.mp3"], vol: 0.68, fit: "keep", trim: { "custom/mages/countess-range.mp3": [40,920] }, status: "picked", note: "hlas na začiatku basic strely (aj mimo plochy)" },
  "voice.melee.countess": { files: ["custom/mages/countess-melee.mp3"], vol: 1.52, fit: "keep", trim: { "custom/mages/countess-melee.mp3": [0,2420] }, status: "picked", note: "hlas melee na vlastnej bunke aj pri údere pasce" },
  "voice.special.countess": { files: ["custom/mages/countess-special.mp3"], vol: 1.66, fit: "keep", trim: { "custom/mages/countess-special.mp3": [0,1540] }, status: "picked", note: "hlas na začiatku špeciálu" },
  "voice.special.wanderer": { files: ["custom/mages/wanderer-special.mp3"], vol: 0.94, fit: "keep", trim: { "custom/mages/wanderer-special.mp3": [40,5780] }, status: "picked", note: "hlas na začiatku špeciálu" },
};
