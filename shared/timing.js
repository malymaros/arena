// shared/timing.js - časovanie timeline: delayMs framov, ktoré posiela server, a k nim viazané klientske
// animácie. Jeden ES modul pre engine (cez engine/constants.js) aj klienta (servírovaný na /shared/), takže
// hodnoty, ktoré musia sedieť na oboch stranách (ANIM_SLOW, CHARGE_STEP_MS, SOLDIER_AIM_MS…), sú len raz.
// Čisté konštanty, žiadne importy.

// celkové spomalenie animácií kola (1 = pôvodné tempo)
export const ANIM_SLOW = 1.8;
export const MOVE_DELAY_MS    = Math.round(800 * ANIM_SLOW); // posun postavy + malý buffer
export const MOVE_MS          = Math.round(700 * ANIM_SLOW); // klientský sklz figúry po doske (CSS --move-ms); kotúľ Luffyho gule
export const SMALL_DELAY_MS   = Math.round(600 * ANIM_SLOW);
export const ACTION_GAP_MS    = Math.round(350 * ANIM_SLOW); // pokojová pauza medzi jednotlivými akciami, nech sa dá sledovať každý ťah
export const SPECIAL_REPEAT   = 3;
export const SPECIAL_BEAT_MS  = Math.round(900 * ANIM_SLOW);
// Vojak: special = jeden silný snajperský výstrel - cast frame drží MIERENIE (veľký sprite zamrznutý
// v mieriacej póze, laser sight sa ustáli na cieli) a výšľah (framy 1–3 Shot_2) sa prehrá RAZ na jeho
// konci; až potom letí lúč. Klient (public/chars/fx/soldier.js) importuje SOLDIER_AIM_MS odtiaľto.
export const SOLDIER_AIM_MS   = 2600;
// po výstrele letí zo zbrane tenký červený lúč na zvolenú bunku + výbuch;
// jeden frame drží let lúča aj nábeh výbuchu, zásah (hit/block/mirror) padne až po ňom.
// MUSÍ sedieť s klientskou choreografiou spawnSoldierBeam v client.js.
export const SOLDIER_BEAM_MS  = 900;
// Shield / Mirror Breaker (public/client/breaker-fx.js): frame lúča. BREAK = nábeh + zohrievanie súperovej
// obrany až po roztrieštenie (zásah padne v ďalšom frame); SHORT = lúč do nezhodnej obrany (blok/odraz
// prehrá defense-fx) alebo do súpera bez obrany (lúč sa rozplynie). Klient z nich počíta dĺžky animácie.
export const BREAKER_RAMP_MS  = 140;
export const BREAKER_BREAK_MS = BREAKER_RAMP_MS + 1150;
export const BREAKER_SHORT_MS = BREAKER_RAMP_MS + 420;
// Vojakov basic granát: zásah (červené políčko + „-HP" float) NEMÁ padnúť pri dolete granátu, ale až keď
// na cieľovej bunke VYBUCHNE a výbuch je vidieť. Klient kreslí výbuch CHARGE_STEP_MS po stiahnutí granátu;
// tento konštantný odklad navyše posunie hit frame tak, aby padol AŽ po nábehu výbuchu (Explosion.png má
// 9 framov @ 12 fps = 750 ms, guľa kulminuje ~⅓ dnu). Reálne ms - výbuchová FX nie je škálovaná ANIM_SLOW.
export const SOLDIER_GRENADE_BLAST_MS = 360;
// Escanor special: server podrží zásah o dĺžku klientskej choreografie (WinSun→CruelSunHold→slnko→SunBurst),
// aby dmg dopadol AŽ po dokončení animácie. MUSÍ sedieť s klientskou choreografiou v client.js (runEscanorSpecial).
export const ESC_SPECIAL_MS   = 4625;
// Vlkolak special: rozbehový cast (veľký Run+Attack v strede) → beh po doske → Attack_2 seknutie na bunke
// terča → až potom dopadne dmg. Časy musia sedieť s klientskou obsluhou wolf_charge/wolf_strike v client.js
// (seknutie = 4 framy @ 5 fps = 800 ms, hrá raz od frame 0; dmg dopadne tesne po dokončení švihu).
export const WOLF_CAST_MS     = Math.round(1200 * ANIM_SLOW);
export const WOLF_STRIKE_MS   = Math.round(500 * ANIM_SLOW);
export const CHARGE_STEP_MS   = Math.round(240 * ANIM_SLOW); // krok strely za bunku - rýchla strela, aby ani 3-bunkový let nebol pomalší než iné akcie
// Portal Realm: krok strely, ktorý prechádza portálom, je dlhší - strela pri vstupe chvíľu mizne, výstup sa medzitým
// rozsvieti a až potom sa z neho strela vynorí (oko stihne preskočiť na druhý koniec)
export const PORTAL_SHOT_STEP_MS = Math.round(CHARGE_STEP_MS * 1.7);
// fázy kroku strely cez portál (podiel dĺžky kroku): dolet k vstupu → zmiznutie → (skrytá) → vynorenie → výstupná bunka.
// Klient (animateProjectilePortal) aj zvuk prechodu (public/sounds/events.js - zaznie pri vlete) čítajú tie isté hodnoty.
export const PORTAL_SHOT_PHASES = { enter: 0.30, gone: 0.40, out: 0.58, emerged: 0.68 };
// Portal Realm: beh cez portál (move/dash/charge) nikdy nie je rýchlejší než najrýchlejší beh na bridge
// (charge 3 bunky za MOVE_DELAY_MS) - dlhá dráha trvá dlhšie. Každý prechod = zmiznutie + vynorenie (2× POP).
export const PORTAL_POP_MS = 200;
export function portalWalkMs(cells, passes) {
  return Math.max(MOVE_DELAY_MS, Math.round(cells * MOVE_DELAY_MS / 3 + passes * 2 * PORTAL_POP_MS));
}
// časový plán prechodu figúry (efekt portal_walk) v rámci framu dĺžky ms: steps = dĺžka dráhy, passAt = indexy
// krokov, ktoré idú cez portál. Bunka = 1 jednotka chôdze (cez portál ½ k hrane + ½ od hrany), každý prechod
// = zmiznutie + vynorenie (POP). Vracia značky v poradí dráhy: { kind: "edge"|"sunk"|"jump"|"emerged"|"cell", t, idx }.
// Klient (animatePortalWalk) z nich robí keyframy, zvuk (events.js) z „edge" moment vletu - sedia na milisekundu.
export function portalWalkPlan(steps, passAt, ms) {
  const pass = new Set(passAt);
  const pop = Math.min(PORTAL_POP_MS, ms * 0.14);
  const unit = Math.max(ms * 0.3, ms - pass.size * 2 * pop) / Math.max(1, steps);
  const marks = [];
  let t = 0;
  for (let idx = 0; idx < steps; idx++) {
    if (pass.has(idx)) {
      t += unit / 2; marks.push({ kind: "edge", t, idx });
      t += pop;      marks.push({ kind: "sunk", t, idx });
      marks.push({ kind: "jump", t, idx });
      t += pop;      marks.push({ kind: "emerged", t, idx });
      t += unit / 2; marks.push({ kind: "cell", t, idx });
    } else { t += unit; marks.push({ kind: "cell", t, idx }); }
  }
  return marks;
}
export const MIRROR_BEAM_MS   = 460; // kým beam mirroru doletí k útočníkovi (CSS .mirror-beam ≈ .16+.42s); nezávisí od ANIM_SLOW
// Teleport (výmena maga v turnaji) - dvojfázová animácia: (1) starý mág zmizne, (2) nový sa objaví
export const TELEPORT_OUT_MS  = Math.round(650 * ANIM_SLOW);
export const TELEPORT_IN_MS   = Math.round(650 * ANIM_SLOW);
// Labyrint: odhalenie PRED zásahom, ktorý ho určite ukončí - skrytý súper sa zjaví (fade ako démon/teleport)
export const LAB_REVEAL_MS    = Math.round(700 * ANIM_SLOW);
// Countess melee/pasca choreografia (podľa vampire_attack_guide, A-sheety s krvavými efektmi zapečenými
// vo framoch): úder = A1 (dmg dopadne až po ňom), potom liečivé beaty A2→A3→A4 a až po nich +3 HP -
// jednotné pre charge melee, center melee aj trigger pasce. Onre má pôvodnú choreografiu (Attack_1/vampstrike,
// drain hneď po zásahu). Časy musia pokryť klientske A-animácie (A1 6f @7fps ~857 ms, A4 6f @8fps ~750 ms).
export const VAMP_TRAP_STRIKE_MS = Math.round(500 * ANIM_SLOW);
export const VAMP_HEAL_BEAT_MS   = Math.round(450 * ANIM_SLOW);
// Countess kladenie pasce: JEDEN dlhý cast frame (nie beaty) - stredová aj malá postava hrajú celé A5
// (17 framov) RAZ od frame 0; dĺžka = 17f @ SPECIAL_FPS 6 v client.js (musí sedieť, inak sa A5 usekne)
export const VAMP_CAST_MS = Math.round(17 * 1000 / 6);
// Naruto: summon klona - po pečatiach (special beaty) hrá Naruto + 2 kópie po bokoch Special_2 animáciu
export const CLONE_SUMMON_MS  = Math.round(1300 * ANIM_SLOW);
// Jotaro THE WORLD: cast = kým dohrá stredová „menace" animácia Star Platinum (Special_3_P: 4 framy @ 6 fps
// ≈ 667 ms na klientovi) - AŽ POTOM sa zamrazí čas a Jotaro si vyberá (viď enterTimestopMode). MUSÍ byť
// ≥ trvanie klientskej menace (preto fixné, nie škálované ANIM_SLOW). Koniec (obnovenie času) pred aplikáciou.
export const TIMESTOP_CAST_MS = 900;
export const TIMESTOP_END_MS  = Math.round(900 * ANIM_SLOW);

// Last Stand (duálne tlačidlo s golden mana) - démon zabije hráča a oživí ho na plno; ďalšie kolo je posledné
// Last Stand sa prehráva FRAME-DRIVEN: každá fáza je samostatný frame (timeline prehrávač = jediný zdroj času),
// HP/mana sú v snapshotoch (server-autoritatívne, žiadny lokálny tween), vizuál viaže klient na efekt s trvaním = delayMs.
export const LS_APPEAR_MS  = 1000; // démon sa vynorí v strede
export const LS_DRAIN_MS   = 1400; // odčerpanie HP/many na 0 (rozdelené na kroky)
export const LS_KILL_MS    = 700;  // smrť + démon zmizne zo stredu
export const LS_REVIVE_MS  = 700;  // démon sa objaví za postavou (0→1)
export const LS_RISE_MS    = 1600; // zlaté dvíhanie HP/many na 10
export const LS_SETTLE_MS  = 900;  // démon → 0.25, hráč vstane
export const LS_B_LEAVE_MS  = 1500; // banish: duch zosilnie a odíde z postavy
export const LS_B_CENTER_MS = 1000; // banish: duch sa objaví v strede
export const LS_B_DRAIN_MS  = 1400; // banish: odčerpanie HP/many na 0
export const LS_B_KILL_MS   = 700;  // banish: smrť + duch zmizne

// Last Hope - úvodná akcia NEbuffnutého hráča vo final kole (vyhodnotí sa PRED golden shield/mirror).
// Červená „hope" postava: HP padne na 1, mana sa naplní na 10, hráč ide do ultra módu = 4× dmg do konca kola.
export const LH_APPEAR_MS = 1000; // hope postava sa vynorí v strede
export const LH_DRAIN_MS  = 1400; // HP→1, mana→10
export const LH_SETTLE_MS = 900;  // postava zmizne, červený ultra mód zostáva

// Losovanie (lobby voľba „RANDOM CHARACTERS“): pred hrou kurzor poskakuje po mriežke postáv a dobehne na
// vylosovanú (server ju už pridelil, animácia je divadlo ako ruleta farieb). Skoky spomaľujú:
// i-ty skok (1..TICKS) čaká min(MAX, BASE × GROWTH^i); posledný skok dôjde na cieľ, kurzor tam chvíľu postojí
// (ďalší „neodohraný“ skok) a až potom sa postava potvrdí (meno + zvuk + intro hlas).
// Turnaj: 3 kurzory, dopadajú postupne o ROLL_TEAM_STAGGER skokov.
export const ROLL_TICKS        = 25;
export const ROLL_TICK_BASE_MS = 55;
export const ROLL_TICK_GROWTH  = 1.095;
export const ROLL_TICK_MAX_MS  = 430;
export const ROLL_TEAM_STAGGER = 5;
export const ROLL_LINGER_MS    = 2200; // po potvrdení: meno + intro hlas, potom overlay zmizne
export const ROLL_FADE_MS      = 450;
export const rollTickMs = (i) => Math.min(ROLL_TICK_MAX_MS, ROLL_TICK_BASE_MS * Math.pow(ROLL_TICK_GROWTH, i));
// celá animácia losovania postáv (od zobrazenia po zmiznutie overlayu)
export function charRollMs() {
  let t = 0;
  for (let i = 1; i <= ROLL_TICKS + 1; i++) t += rollTickMs(i); // +1 = zdržanie na cieli pred potvrdením
  return Math.round(t + ROLL_LINGER_MS + ROLL_FADE_MS);
}
// ruleta farieb (public/client/socket-handlers.js): roztočenie + výsledok + fade - losovanie postáv ide až po nej
export const COLOR_ROLL_SPIN_MS   = 3400;
export const COLOR_ROLL_RESULT_MS = 1700;
export const COLOR_ROLL_FADE_MS   = 450;
export const COLOR_ROLL_MS = COLOR_ROLL_SPIN_MS + COLOR_ROLL_RESULT_MS + COLOR_ROLL_FADE_MS;
