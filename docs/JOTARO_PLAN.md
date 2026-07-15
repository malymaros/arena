# Jotaro — implementačný plán

> **Pre koho:** pre agenta/vývojára, ktorý postavu implementuje — pokojne iného, než plán písal.
> Dizajn je **schválený používateľom** (2026-07-14), nižšie je kompletný. Pred prácou si prečítaj
> `CLAUDE.md` a `docs/ADDING_CHARACTERS.md`. Kotvy `server.js:LINE` / `client.js:LINE` platia pre
> commit `759f1ae` — pri posune súborov si ich over grepom podľa názvu funkcie.
>
> **Stav implementácie sleduj v checklistoch fáz (sekcia 6)** — zaškrtávaj priamo v tomto súbore.

---

## 1. Cieľ a východiskový stav

Pridať hrateľnú postavu **Jotaro** (JoJo's Bizarre Adventure) so standom **Star Platinum** a
jednorazovým specialom **THE WORLD** (zastavenie času = odložené kumulatívne efekty + extra
mini-kolo 3 akcií uprostred vyhodnocovania kola).

Čo už existuje:

- **Assety hotové:** `public/assets/jotaro/` — Jotarov pás + `_P` pás Star Platinuma per akcia
  (`Idle.png`+`Idle_P.png`, `Run(_P)`, `Attack_1(_P)`, `Attack_2(_P)`, `Special_1(_P)`,
  `Special_2(_P)`, `Special_3_P`, `Hurt`, `Dead(_P)`, `Charge.png` = letiaca päsť standu).
  Reprodukovateľná pipeline: `tools/sprites-jotaro/` (`pack_char.cjs` kopíruje pásy pod herné názvy).
  **Chýba `Summon_P.png`** (`out/sp/SP_Summon.png` sa zatiaľ nekopíruje) — treba pre intro standu.
- **Preview karta:** Jotaro je na Hidden stránke char-selectu ako neklikateľná TOP SECRET karta
  (`index.html:322-325`, `PREVIEW_CAST` `client.js:4064`, `ABILITY_PREVIEW.jotaro` `client.js:4238`
  so `secret:true`). `CHAR_META.jotaro` už existuje (`client.js:463`, `dir` aj `dirP2` = `"jotaro"`,
  žiadny alt-color filter), `PORTRAIT_SCALE.jotaro = 0.66` (`client.js:431`).
- **Dizajn schválený** — memory `jotaro-design.md`; plné znenie nižšie v sekcii 2.

---

## 2. Schválený dizajn (záväzný)

**Dostupnosť:** side-bound **P2** skrytá postava ako Onryō — Hidden stránka (rune easter egg),
mimo `CHARS` poolu. V turnaji draftovateľná **len P2 hráčom** (vzor `sideCharForSlot`). Luffy bude
neskôr P1 náprotivok (netýka sa tohto plánu, ale nerozbi mu preview kartu).

**Kit:**

| Akcia | Správanie |
|---|---|
| move / recharge | normálne |
| **basic attack** | **diagonálny strel s odrazom od steny presne ako Vampire/Onryō** — `vampShotRoute`, range `VAMP_SHOT_RANGE` 3, dmg 3/2/1 podľa preletenej vzdialenosti, jeden odraz, roh nebounca. Projektil `Charge.png` (letiaca päsť standu). |
| dash | **normálny** dash (4 many, 2 polia) — NIE vamp charge! |
| melee | **normálny** melee (4 many, 8 dmg, vlastná bunka) — NIE vamp melee vetva |
| shield | normálny (2 many) |
| **mirror slot** | **mirror NEMÁ** — namiesto neho **Special 1**: 4 many, directional ľavo/pravo, **4 dmg na OBE diagonálne bunky zvolenej strany** (`(x±1, y−1)` a `(x±1, y+1)`; rovná bunka `(x±1, y)` NIE; na kraji dosky zóna len z existujúcich buniek). Normálne blokovateľný štítom / odrazený mirrorom. Tlačidlo dostane fialový „❔" hidden skin (ako vamp dash-charge). |
| golden shield / **golden mirror** | **oba smie** — chýba mu len klasická mirror akcia, golden mirror je povolený |
| **special** | **THE WORLD** (viď nižšie); po jeho vyhodnotení sa special button natrvalo zmení na **Special 2**: 5 many, **8 dmg**, directional ľavo/pravo, range 1 (jediná susedná bunka `(x±1, y)`); normálne blokovateľný/odraziteľný; cast z kraja von z dosky = wall rule (mana sa minie, whiff). |

**THE WORLD (special, 5 many, jednorazový per HRU):**

1. Nedá sa blokovať ani odraziť — **vždy dopadne** (sám osebe nedáva dmg; „zásah" = zastavenie času).
   Súperova nabitá obrana sa pri caste **nespotrebuje** — viď bod 5.
2. Po caste sa vyhodnocovanie kola **pozastaví**: hráč Jotara si zvolí **3 nové akcie**
   (kvázi nové kolo — všetky typy akcií nanovo, každý max 1× v rámci trojice, **nezávisle** od toho,
   čo už v kole použil; povolené: move, dash, recharge, attack, melee, shield, Special 1;
   **zakázané:** special (THE WORLD button je locked — „práve beží"; Special 2 ešte neexistuje,
   sprístupní sa až PO vyhodnotení THE WORLD), golden akcie, turnajový swap. Mana sa platí normálne,
   wall rule platí. **Zatiaľ bez časového limitu** (možno sa pridá).
3. Súper + všetky jeho animácie **zamrznú** (vrátane Narutovho klona). Jotaro sa hýbe normálne.
4. **Odložené efekty:** čokoľvek by dopadlo na súpera sa počas zmrazenia LEN ohlasuje labelmi
   (koľko dmg / aký efekt; žiadna zmena HP, žiadny okamžitý mirror odraz — len label „MIRRORED").
   Jotarove vlastné veci (mana, pohyb, wall bump, arming vlastného shieldu) bežia naživo.
5. **Kumulatívna aplikácia pri obnovení času** (po dohratí animácie poslednej zmrazenej akcie,
   stále sme vo vyhodnocovaní Jotarovho special beatu):
   - súper **bez obrany** → jeden kombinovaný `hit` frame s `parts` (súčet všetkých zásahov naraz,
     jeden hurt) — vzor `applyStackedHit`;
   - súper s **nabitým shieldom** (nabitým už pred castom THE WORLD) → obrana platí počas CELÉHO
     zamrazenia: jeden block frame, nula dmg, shield sa spotrebuje;
   - súper s **nabitým mirrorom** → nezraniteľný + **jeden kumulatívny odraz** celého súčtu na
     Jotara (príklad používateľa: basic 2 + melee 8 → jedna mirror animácia, jeden odraz 10 dmg,
     nie dva odrazy); mirror sa spotrebuje. Odraz môže Jotara zabiť (prvá smrť ukončí hru).
   - Ak Jotaro počas zmrazenia nespravil ŽIADEN zásah, nabitá obrana sa **nespotrebuje**
     (nemalo ju čo rozbiť) a ostáva na jeho ďalšiu normálnu akciu. *(default, viď 3.1)*
6. Potom kolo **pokračuje ďalšou akciou** pôvodnej queue (zvyšné akcie oboch hráčov, tiles,
   golden fáza… všetko ako normálne).
7. **Dlaždice sa počas 3 zmrazených akcií nevyhodnocujú VÔBEC** (žiadne per-step ticky, žiadne
   pickupy) — vyhodnotia sa až keď príde ich čas v rámci normálneho kola (t. j. najbližší
   `endOfStepTileEffects` po obnovení času zasiahne Jotara tam, kde reálne stojí).
8. **Labyrint:** Jotaro smie THE WORLD použiť aj prekliaty; labyrint OSTÁVA aktívny počas celého
   zamrazenia (redakcia beží ďalej), ukončí sa štandardne len ak zmrazený zásah dopadne na lovca —
   reveal sekvencia sa prehrá až pri kumulatívnej aplikácii (bod 5). Prekliaty Jotaro strieľa
   naslepo — `ts_*` announce efekty na skrytom súperovi mu treba **redigovať** (nesmie sa dozvedieť
   o zásahu pred obnovením času).
9. **Narutov klon:** zamrzne tiež; zmrazené útoky ho vedia zabiť — `clone_die` sa odohrá tiež až
   pri kumulatívnej aplikácii. Decoy klon žerie zásah celý, stacked klon absorbuje `CLONE_DMG`
   a zvyšok ide majiteľovi — všetko len ako announce, aplikácia na konci.
10. **Jednorazovosť:** raz za hru (v turnaji teda teoreticky max 3× za sériu, raz v každej hre).
    Použitie sa pamätá per osoba **cez swap v rámci hry** (swap von a späť ≠ nový THE WORLD);
    nová hra série = nový THE WORLD.

**Vizuál standu:** Star Platinum je **stále viditeľný** pri Jotarovi — druhý canvas (vzor
Narutov klon `cloneEls`), kreslí `_P` pás zodpovedajúci aktuálnej animácii Jotara (fallback
`Idle_P`). **Summon = úvodná one-shot animácia** pri prvom playbacku po nasadení (vzor Escanorov
Transform), sprite `SP_Summon` → treba doplniť do assetov ako `Summon_P.png`. Stand zmizne až keď
Jotaro zomrie — prehrá `Dead_P` (`SP_Unsummon`) a skryje sa. Pri hurt Jotara stand drží `Idle_P`
(Hurt_P neexistuje).

---

## 3. Rozhodnutia

### 3.1 Explicitne odsúhlasené používateľom

Všetko v sekcii 2 + tieto Q&A (2026-07-14): cena 5 many; per-hra jednorazovosť; obrana ako
counter (celé zamrazenie); zmrazená trojica = kvázi nové kolo (všetky typy nanovo); tiles inert;
Special 1 zóna = obe diagonály zvolenej strany; labyrint ostáva aktívny; clone_die odložený;
golden mirror povolený; jedna kumulatívna aplikácia; stand stále viditeľný so summon introm;
mirror odraz počas zamrazenia NEdáva dmg hneď — len label, kumulát pri obnovení.

### 3.2 Defaulty NEodsúhlasené explicitne (drž sa ich, pri pochybnosti sa spýtaj používateľa)

| # | Rozhodnutie | Default |
|---|---|---|
| D1 | Obrana nespotrebovaná, ak zmrazené akcie nič nezasiahli | ostáva nabitá (sekcia 2 bod 5) |
| D2 | Power tile pri zmrazenom útoku | **inert** (konzistentné s „tiles sa nevyhodnocujú vôbec") — neboostuje, nespotrebuje sa |
| D3 | Block tile (def-blocker) pri armovaní shieldu v zamrazení | **inert** (rovnaká logika) — shield sa armne aj z block tile |
| D4 | Súperova pasca (Vampire P1 vs Jotaro P2!) pri prechode bunkou v zamrazení | **nespustí sa** a prejdené bunky sa do triggeru nepočítajú (čas stojí, pasca nereaguje) — `actionSteps` po každej zmrazenej akcii zahoď bez `resolveTrapsAfterAction` |
| D5 | Ariadnina niť prekliateho Jotara počas zamrazenia | **pletie sa normálne** (je to jeho reálny pohyb) |
| D6 | Turnajový swap na Jotara / z Jotara | **zakázaný + glitch heads** ako countess/onre (iná semantika akcií — rovnaký dôvod); Jotaro pridaný do side-char swap banu |
| D7 | Zóna Special 1/2 a klon | zónové pravidlá ako u iných dmg specialov: figúra v zóne = zásah; klon+majiteľ v zóne → `applyHitBoth` vzor |
| D8 | Ghost (plánovací náhľad) standu | ghost renderuje len Jotara (stand nie) |
| D9 | Timer auto-fill môže náhodne vybrať THE WORLD | áno (je to valídna akcia); time-stop potom beží bez limitu — známa medzera, kým sa nepridá limit |
| D10 | Escanor `prideHit` z kumulatívneho zásahu | počíta sa (aplikácia ide cez štandardné HP-deduction miesta → `notePrideHit` automaticky) |
| D11 | Last Stand / Last Hope multiplikátory | zmrazené raw dmg násobí `dealMul` pri VÝPOČTE announce (útok vznikol v zamrazení), `recvDmg` ½ sa aplikuje pri kumuláte |
| D12 | Round-script lišta pre zmrazené akcie | v1 stačia floaty + announce beaty; plná integrácia do action logu je nice-to-have |

---

## 4. Architektúra THE WORLD (jadro práce)

### 4.1 Prečo je to ťažké

`resolveTurn()` (`server.js:2576-2858`) je **jediný synchrónny prechod**: postaví celé `tl` pole
a emitne ho RAZ cez `emitStateMasked(tl)` (`:2833`). Klientský prehrávač
(`schedulePlayTimeline` `client.js:3377`) je fire-and-forget `setTimeout` reťaz bez pauzy.
Protokol nemá „čiastočná timeline → čakanie na klienta → zvyšok". Toto všetko treba doplniť.

### 4.2 Server — rezumovateľné kolo

**Krok 1 — kontext kola.** Lokály, ktoré `resolveTurn` nesie naprieč iteráciami, presuň do
objektu `game.roundCtx = { tl, order, i, slotIdx, ended, escUsedDefense, wandererUsedMirror,
doomSlot, second }` (+ modulový `actionSteps` `server.js:1418` sa musí pri pauze vyprázdniť).
Rozdeľ na:

- `resolveTurn()` — init ctx (dnešné riadky `:2578-2659` vrátane Last Hope pre-fázy a golden
  pre-akcií) + `runRoundLoop()`;
- `runRoundLoop()` — hlavný interleave loop (`:2661-2713`) čítajúci/zapisujúci ctx; vie skončiť
  dvoma spôsobmi: `finishRound()` (dnešný zvyšok `:2717-2857` — pride, moon, tiles, gold fáza,
  emit, cleanup, `handleGameEnd`/`beginPlanningTimer`) alebo **PAUSE** (viď nižšie);
- správanie pre všetky existujúce postavy sa NESMIE zmeniť — refaktor over pustením `npm test`
  ešte PRED pridaním Jotara (fáza 3a checklistu).

**Krok 2 — pauza.** `doSpecial` dostane vetvu `jotaro` (vzor minotaur `:1886`):

- ak `me.worldUsed` → **Special 2**: powerBoost je mimo (D2 sa netýka — toto je normálny čas!
  `powerBoost(slot, tl)` volaj ako escanor `:2047`), zóna = `(x±dir, y)`, zásah cez
  `applyHitBoth`-vzor s `JOTARO_S2_DMG`, prázdna zóna z kraja = wall-rule whiff. Hotovo, return.
- inak → **THE WORLD**: mana gate 5; `me.worldUsed = true`; pushni cast frames
  (`timestop_start` efekt) + zachyť `foeShieldArmed/foeMirrorArmed` (obrana sa NEspotrebuje —
  pauza musí obísť consumption riadky `:2690-2691` pre túto akciu); nastav
  `game.timestop = { slot, foeShield, foeMirror, foeShieldGold, foeMirrorGold, hits: [],
  cloneEvents: [], mode: "waiting" }`; vráť sentinel `PAUSE`.

`doAction` (`:2190`) sentinel prepustí hore; `runRoundLoop` pri ňom: zapíše do ctx presnú pozíciu
resume (index akcie, ktorý slot v `order` je na rade PO tejto akcii), pushne frame s efektom
`timestop_wait` (marker konca čiastočnej timeline) a zavolá `emitStateMasked(ctx.tl)` — **partial
emit**. `ctx.tl` sa NEresetuje — pokračovanie appenduje. Časovač kola sa nespúšťa.

Snapshot (`snapshot()` `:539`) dostane top-level pole `timestop: { slot } | null` (kým
`game.timestop.mode === "waiting"`), aby reload/reclaim (`:3058`) obnovil UI mód.

**Krok 3 — nový socket event `timestop_actions`** (registruj pri `lock_in` `:3329-3331`):

- guardy: `phase === "playing"`, `game.timestop?.mode === "waiting"`, odosielateľ je
  `game.timestop.slot`; ack `{ok:false, reason}` vzor `onLockIn` `:3160`.
- `validTimestopQueue(queue, slot)` — presne 3 akcie; povolené typy
  `move|dash|recharge|attack|melee|shield|special1`; každý typ max 1×; smery ako vo `validQueue`
  (diagonálny attack!); mana sa NEvaliduje tvrdo (nedostatok many = `invalid` pri vykonaní, ako
  v normálnom kole); žiadne goldeny/swap/special/stoned (stone je počas THE WORLD nemožný —
  petrifikácia by special skipla už pred castom, `:2669`).

**Krok 4 — zmrazené vykonanie** (`runTimestopActions`): pre každú akciu `doAction` s aktívnym
`game.timestop.mode = "frozen"`. Zmrazený režim NEmení `applyHit` (poučenie z Naruta —
`docs/ADDING_CHARACTERS.md` §7!) — namiesto toho **guard na volajúcich miestach**, kde by dmg
odišiel na súpera: vetvy `doBasic` (zásah po prelete), `doMelee`, `doSpecial1` zóna → ak frozen,
volaj `announceFrozenHit(targetSlot, raw, kind, {fromClone…})`:

- pushne announce frame `ts_hit {target, dmg, kind}` (len label — HP sa nemení, takže
  `invariantCheck` testov ostáva spokojný);
- ak `foeMirror` → announce `ts_mirror` (label „MIRRORED", dmg sa NEodráža hneď);
- zaeviduje do `game.timestop.hits` surové `{raw, kind, bonus:0}` (raw už vynásobené `dealMul`/
  `labyrinthMul` — počíta sa pri útoku, D11); zásah klona → `cloneEvents` (decoy die / stacked
  absorb split podľa štandardných pravidiel, len odložene).
- **Vynechaj:** `endOfStepTileEffects` (bod 7 dizajnu), `resolveTrapsAfterAction` + vyčisti
  `actionSteps` (D4), `powerBoost` (D2), block-tile check pri shielde (D3), `revealLabyrinths`
  (odklad na resume, bod 8), `endLabyrinths`.
- Jotarove vlastné veci normálne: mana, pohyb (`trackSteps` → niť, D5), wall bump/`invalid`,
  arming vlastného shieldu.

**Krok 5 — obnovenie času** (`applyTimestopResume`): po 3 akciách, stále v tom istom behu:

1. ak treba (zásah dopadne a beží labyrint) → `revealLabyrinths(tl)` PRED aplikačnými frame-ami
   (vzor `:1352`);
2. `timestop_end` frame (obrazovkový filter dole, súper sa „rozbehne");
3. aplikácia kumulátu — jeden beat:
   - `foeShield` → jeden `block` frame (`gold` podľa `foeShieldGold`), spotrebuj;
   - `foeMirror` → jeden `mirror` frame + jeden kombinovaný `hit` na Jotara
     (`dmg = Σ raw`, `parts` = jednotlivé rany; odraz je raw — neblokuje sa, neodráža späť),
     spotrebuj; skontroluj `winnerNow`;
   - inak → `clone_die`/absorb z `cloneEvents` + jeden kombinovaný `hit` s `parts` na súpera
     (cez `recvDmg` ½ ak Last Stand, D11; `notePrideHit` automaticky, D10); `winnerNow`;
   - nič nedopadlo → obrana ostáva nabitá (D1), žiadne frame-y navyše;
   - ak dopadol aspoň jeden hit/block/mirror → `endLabyrinths(tl)` (globálne pravidlo:
     aj blokovaný/odrazený zásah ukončuje labyrint);
4. `game.timestop = null`; pokračuj `runRoundLoop()` od uloženej pozície; na konci normálny
   `finishRound()` → druhý `emitStateMasked(ctx.tl_zvyšok)`.

> **Emisia pokračovania:** druhá timeline musí začínať frame-om so súčasným stavom (klient
> `schedulePlayTimeline` aplikuje `timeline[0]`), t. j. `tl` pre druhý emit začni čerstvým
> `pushStateFrame` seedom — NEposielaj znova už odohrané frame-y. Prakticky: pri pauze si
> zapamätaj `ctx.emittedUpTo = tl.length` a druhý emit pošle `tl.slice(emittedUpTo)` so seedom.

**Krok 6 — upratovanie:** `newGame`/`startGame`/`retry`/`admin reset` musia `game.timestop`
a `game.roundCtx` nulovať. `lock_in` počas `waiting` odmietni. Disconnect = existujúca room
semantika (hra sa zavrie) — netreba špeciál.

**Persistencia `worldUsed`:** pole v `newPlayer()` (`:259`, default `false`) + do `cloneActor`
whitelistu (`:531` — klient ho potrebuje na prepnutie buttonu). `doSwap` ho **NEresetuje**
(objekt hráča prežíva swap — tým pádom drží per-hra sám od seba; pride/moon sa resetujú na
`:2181-2185`, worldUsed tam NEpridávaj). Nová hra = čerstvý `newPlayer` = false. Netreba žiadnu
`mageWorld` mapu.

### 4.3 Server — redakcia (labyrint)

`redactEffect` (`:453`) + `redactTimelineFor` (`:485`): nové efekty `ts_hit`, `ts_mirror` sa pre
**prekliateho diváka** redigujú ako ostatné opponent-side efekty (prekliaty Jotaro nesmie vidieť,
že trafil; lovec vidí všetko — on redigovaný nie je). `timestop_start/_wait/_end` sú globálne
(vidia obaja). Snapshot pole `timestop` je neutrálne (len slot) — nič neleakuje.

### 4.4 Klient — pauza prehrávača a UI módy

- **Pauza:** v `step()` (`client.js:3429`) handler efektu `timestop_wait`: NEnaplánuj ďalší
  `setTimeout` (`:3955`) a NEspusti koncovú vetvu playbacku (`:3432-3493` — UI sa nesmie
  odomknúť!). Nastav `tsWaiting = true`. Druhý `state` s timeline príde normálne —
  `schedulePlayTimeline` si cez `playGen++` (`:3380`) starý reťazec zruší sám.
- **UI hráča Jotara** (`me === timestop.slot`): otvor plánovanie v „ts móde" — recykluj
  `myQueue`/action buttony/`lockBtn`; special button disabled s pulzujúcim „THE WORLD" labelom;
  golden split-button a swap heads skryté/nekliknuteľné; lock button label „EXECUTE" → emitne
  `timestop_actions` (ack + retry vzor `emitLockIn` `:4930`). Ghost simulácia funguje normálne
  (`simulatedPositions` — pozor, štartuje z AKTUÁLNEJ pozície v zamrazení, nie z pozície na
  začiatku kola).
- **UI súpera:** full-screen `body.classList.add("timestop-mode")` (vzor `labyrinth-mode`
  `client.js:2360`; CSS v `styles.css` — grayscale/invert „ZA WARUDO" filter) + overlay text
  („⏱ TIME HAS STOPPED…"). UI ostáva locked.
- **Efekty v prehrávači** (nové vetvy v effects slučke `:3516-3944`):
  `timestop_start` (cast choreografia + zapni filter u oboch), `timestop_wait` (viď pauza),
  `ts_hit` (announce float nad cieľom — `spawnFloat` `client.js:1129` s novou CSS triedou;
  pozor na fixný 1000 ms lifetime), `ts_mirror` („MIRRORED" float), `timestop_end`
  (vypni filter; kumulatívne `hit`/`block`/`mirror`/`clone_die` frame-y sú už štandardné efekty).
- **Reload/reclaim:** `state` bez timeline s `s.timestop` → obnov príslušný mód (analógia
  escanor re-arm `:5441-5450`).
- **Zamrazené animácie súpera:** počas `timestop-mode` raf kreslí súperovho actora (+ klona)
  so zamrznutým `drawT` (drž posledný frame idle) — najjednoduchšie: `animState` súpera nastav
  na statický frame / preskoč advance času pre slot ≠ jotaro.

---

## 5. Kompletný checklist zmien po súboroch

### `server.js`

Registrácia a kit:
- [ ] `SIDE_CHARS` (`:82`) + `jotaro: "p2"`. **POZOR — kľúčový krok:** zaveď rozlíšenie
      „side-bound" (väzba na stranu, swap ban, draft) vs „vamp kit" (charge/trap/mirror-imunita/
      vamp melee). Napr. `const VAMP_CHARS = { countess:1, onre:1 }` a **audit všetkých použití
      `SIDE_CHARS`**: `:837,:840,:2163` swap ban → **ostáva SIDE_CHARS** (Jotaro tiež, D6);
      `:857,:909*,:2428,:2445,:1098` diagonálny basic → **SIDE_CHARS** (Jotaro strieľa diagonálne)
      — *`:909` je trap-cell validácia → VAMP_CHARS!*; `:990` dash→charge → **VAMP_CHARS**;
      `:1200` melee→vamp → **VAMP_CHARS**; `:2020` trap special → **VAMP_CHARS**;
      `:1410` mirrorImmune → **VAMP_CHARS**; `:3126,:3140` výber/draft → **SIDE_CHARS**.
- [ ] Konštanty: `WORLD_COST = 5`, `JOTARO_S1_COST = 4`, `JOTARO_S1_DMG = 4`,
      `JOTARO_S2_COST = 5`, `JOTARO_S2_DMG = 8` (k `VAMP_*` `:96-103`); timing `TIMESTOP_CAST_MS`
      a spol. k `*_MS` (`:150-194`).
- [ ] `newPlayer()` (`:259`): `worldUsed: false`. `cloneActor` whitelist (`:531`): + `worldUsed`.
- [ ] `ACTION_TYPES` (`:126`): + `special1`.
- [ ] `validQueue` (`:784`): `mirror` pre Jotara **reject**; `special1` len pre Jotara, s dir
      left/right; `special` pre Jotara: ak `worldUsed` → vyžaduje dir left/right (Special 2),
      inak bez parametrov (THE WORLD); diagonálny attack cez existujúcu side-char vetvu (`:851-859`).
- [ ] `doAction` (`:2190`): case `special1` → `doJotaroS1(slot, dir, tl)`.
- [ ] `doJotaroS1`: zóna `(x+dx, y−1)` a `(x+dx, y+1)`; povinný `revealLabyrinths` pri istom
      zásahu (vzor `:1865`); `powerBoost`; zásah figúr v zóne cez `applyHitBoth`-vzor
      (klon: `specialZoneHas` ekvivalent — zóna je lokálna funkcia); prázdna zóna (nemožné —
      vždy aspoň 1 bunka pri 3-riadkovej doske? NIE: krajný stĺpec x=0 smer left → OBE bunky
      mimo dosky → wall-rule whiff).
- [ ] `doSpecial` (`:1843`): vetva `jotaro` — Special 2 / THE WORLD (sekcia 4.2 krok 2).
- [ ] Rezumovateľný `resolveTurn` (sekcia 4.2 krok 1) — **samostatný commit + `npm test` zelené
      PRED Jotarom**.
- [ ] `timestop_actions` handler + `validTimestopQueue` (krok 3), `runTimestopActions` +
      `announceFrozenHit` (krok 4), `applyTimestopResume` (krok 5).
- [ ] `snapshot()` (`:539`): `timestop` pole; `redactEffect`/`redactTimelineFor` (`:453,:485`):
      `ts_hit`/`ts_mirror` redakcia pre prekliateho.
- [ ] Reset miesta: `newGame` (`:312`), `startGame` (`:2954`), retry (`:3220`) → nulovať
      `game.timestop`/`game.roundCtx`; `onLockIn` (`:3160`) guard proti `waiting`.
- [ ] Golden mirror: ŽIADNA zmena (Jotaro ho smie) — over, že `validQueue` golden vetva
      (`:793-798,:849`) nič nepodmieňuje mirror akciou.

### `public/client.js`

- [ ] `SIDE_CHARS` (`:467`) + `jotaro: "p2"`; zaveď klientský `VAMP_CHARS` ekvivalent a audit:
      `syncDashBtn` (`:4568`) → **VAMP_CHARS** (Jotarov dash NEmá ❔ skin!); special dispatch
      `special_cell` (`:4703-4722`) → **VAMP_CHARS**; attack diag picker (`:4655`) →
      **SIDE_CHARS** (Jotaro áno); draft gating (`:4180`), glitch heads (`:5066-5158`),
      `autoLockTimeout` diag attack (`:5216`) → **SIDE_CHARS**; trap-cell auto-fill → **VAMP_CHARS**.
- [ ] `HEAD_CX`/`HEAD_TOP` (`:364,:368`): jotaro hodnoty (vylaď cez `/head-cropper.html`).
- [ ] `SPRITE_FILE_ALIAS` (`:604`) / `ANIM_DEF` (`:478`): anim kľúče pre stand netreba, ak stand
      kreslíš vlastnou vetvou s `_P` súbormi (odporúčané) — mapa `standFileFor(animKey)`:
      `Idle_P` default; `Run_P` (run/dash), `Attack_1_P` (basic cast), `Attack_2_P` (melee),
      `Special_1_P` (special1), `Special_2_P` (special2), `Special_3_P` (THE WORLD cast menace),
      `Dead_P` (smrť, one-shot → hide), `Summon_P` (intro); hurt → `Idle_P`.
- [ ] **Stand render:** `standEls` canvasy (vzor `cloneEls` `:258-268`); pozícia v
      `positionActors` (za clone blokom `:2938-2975`; offset `STAND_OFFSET` vedľa Jotara,
      zrkadlený podľa facingu; pozor na `pairShift` tesnotu pri zdieľanej bunke); kreslenie
      v raf za clone slučkou (`:5682-5707`); `clearActors` (`:3963`) čistí; intro one-shot
      `standSummoned{p1,p2}` (vzor `escTransformed` `:571,:3416-3424,:5441-5450`).
- [ ] **Mirror slot → Special 1:** `syncMirrorBtn(char)` podľa vzoru `syncDashBtn` (`:4568`) —
      trieda `.jotaro-s1` s fialovým ❔ skinom (CSS vzor `.vamp-charge`), cost badge 4, tooltip;
      klik otvára L/R picker (vzor medusa `#special-picker` `index.html:193` alebo vlastný);
      push `{type:"special1", dir}`; mutual-exclusion s golden mirrorom NEplatí (special1 nie je
      mirror) — over `:4885,:4735`.
- [ ] **Special button:** vetva v label bloku (`:5500-5555`) — `worldUsed` z aktora:
      THE WORLD (5, „⏱") vs Special 2 (5, „ORA!"); klik: THE WORLD bez pickera (push
      `{type:"special"}`), Special 2 s L/R pickerom.
- [ ] `cellsForSpecialPreview` (`:2582`): vetvy — special2 `(x±1,y)`; special1 preview rieš pri
      hoveri jeho tlačidla (obe diagonály strany); THE WORLD — celá doska blikne? (cast je
      globálny — vzor minotaur `:2611`; nič konkrétne neleakuje).
- [ ] `actionIcon`/`displayDir` (`:2257-2289`) + `actionBadgeView` (`:3016`): `special1` ikona
      so šípkou; `special` jotaro ikony (⏱ / ORA).
- [ ] **Timestop klient** (sekcia 4.4): pauza v `step()`, ts-mode UI, overlay + `body.timestop-mode`,
      nové efekty, reload obnova, zamrazený súperov raf.
- [ ] `autoLockTimeout` (`:5209`): jotaro — special1 dir, special (THE WORLD bez args /
      Special 2 dir), diag attack.
- [ ] `ABILITY_PREVIEW.jotaro` (`:4238`): nahraď `secret` reálnym popisom (bez konkrétnych čísel
      v texte — vzor countess/onre `:4233-4234`; cost badge čísla áno).
- [ ] `PREVIEW_CAST` (`:4064`): jotaro vetvu odstráň / ponechaj pre luffy (dispatch `:4096` +
      guard `:4101` + `:4357` + `rosterGlitchCards` `:4499` — po zmene karty na hrateľnú z nej
      zmizne `.preview-char`, over že luffy preview ostal funkčný).

### `public/index.html`

- [ ] Jotarova karta (`:322-325`): `data-char="jotaro"` presuň na `.char-card` (vzor onre `:311`
      s `data-side="p2"`), odstráň `preview-char`, doplň `.char-stats` riadok (vzor onre).
- [ ] Prípadný nový L/R picker pre special1/special2 (alebo recykluj `#special-picker`).

### `public/styles.css`

- [ ] `.jotaro-s1` fialový skin (kópia `.vamp-charge` vzoru), `body.timestop-mode` filter,
      overlay, `.ts-float` announce štýl.

### `tools/sprites-jotaro/pack_char.cjs`

- [ ] Pridaj `Summon_P.png` ← `out/sp/SP_Summon.png` (5 framov); spusti a commitni nový asset.

### `test/game-test.mjs`

- [ ] Nový helper `playRoundTimestop(c1,c2,q1,q2,tsQueue)` — pozor: `state` listener (`:43-46`)
      prepisuje `lastTimeline`; na zachytenie DVOCH emisií v kole zbieraj timeline do poľa
      (nový listener/pole v ctx). Postup: lock oba → čakaj timeline #1 (obsahuje `timestop_wait`)
      → emit `timestop_actions` → čakaj timeline #2.
- [ ] Testy (vzory: TV1 side-binding `:1649`, TV2 diagonálna trasa `:1667`, T9/T55d mirror
      reflect, T35-39 labyrint):
  - TJ1 side-binding: jotaro reject na p1, OK na p2; draft len p2.
  - TJ2 diagonálny basic: trasa/odraz/roh/dmg 3/2/1 (kópia TV2 na jotara).
  - TJ3 special1: zóna oboch diagonál, 4 dmg; kraj dosky (1 bunka); z kraja von = whiff;
    shield block; mirror reflect 4; klon v zóne.
  - TJ4 `mirror` akcia rejectnutá; `golden_mirror` prijatý a funkčný.
  - TJ5 THE WORLD happy path: timeline #1 končí `timestop_wait`; zmrazené akcie → `ts_hit`
    announce, HP súpera v zmrazených frame-och NEMENNÉ; resume = jeden `hit` s `parts`,
    HP klesne raz; zvyšok kola sa dohrá (súperove akcie po speciale).
  - TJ6 shield counter: nabitý shield → resume jeden `block`, 0 dmg, shield spotrebovaný.
  - TJ7 mirror counter (príklad používateľa): basic 2 + melee 8 → jeden `mirror` + jeden odraz
    10 na jotara; smrteľný odraz ukončí hru.
  - TJ8 worldUsed: druhý cast specialu v ďalšom kole = Special 2 (8 dmg susedná bunka),
    žiadna pauza; wall whiff z krajného stĺpca.
  - TJ9 tiles inert: prechod cez dmg tile v zamrazení bez ticku; heal/mana nezobraté; po resume
    normálne ticky.
  - TJ10 labyrint: prekliaty jotaro + THE WORLD → labyrint beží ďalej; `ts_hit` redigovaný
    v timeline prekliateho; zásah lovca → reveal+end pri resume; miss → labyrint beží.
  - TJ11 naruto: decoy klon zabitý zmrazeným útokom → `clone_die` až pri resume; stacked split.
  - TJ12 turnaj: p2 draftne jotara; swap ban + corrupt heads; worldUsed prežije swap von/späť;
    nová hra série = nový THE WORLD.
  - TJ13 obrana nespotrebovaná pri 0 zásahoch (D1).
  - TJ14 `invariantCheck` na všetkých timeline (ts_hit nesmie rátať do HP delty — nový kind,
    `sumEffects` ho ignoruje automaticky).
  - TJ15 vamp pasca × zamrazenie (countess vs jotaro): prechod bunkou pasce v zamrazení ju
    nespustí (D4).
- [ ] Regres: celé `npm test` zelené (refaktor `resolveTurn` nesmie nič rozbiť).

### `CLAUDE.md`

- [ ] Sekcia „Character specials": odstavec **THE WORLD (Jotaro)** — celý mechanizmus (pauza
      protokolu, kumulatívna aplikácia, obrana ako counter, tiles inert, labyrint, klon,
      worldUsed persistencia, special1 v mirror slote, stand render); doplň `choose_character`
      zoznam v „Socket protocol" (jotaro p2-only) a `timestop_actions` event.

---

## 6. Fázy implementácie (odporúčané poradie commitov)

Každá fáza = samostatne commitnuteľný, testami krytý celok. Zaškrtávaj.

- [ ] **F0 — assety:** `pack_char.cjs` + `Summon_P.png`; over štvorcové framy (šírka/výška
      deliteľná — engine odvodzuje počet framov).
- [ ] **F1 — registrácia + basic kit (bez THE WORLD):** SIDE_CHARS/VAMP_CHARS split (server+klient),
      karta klikateľná, diagonálny basic, normálny dash/melee, special1 v mirror slote (+ skin,
      picker, preview, ikony), Special 2 ako DOČASNÉ správanie special buttonu (worldUsed
      inicializuj na `true`, nech je F1 hrateľná a testovateľná bez time-stopu). Testy TJ1-TJ4, TJ8.
- [ ] **F2 — stand:** standEls render, summon intro, death unsummon, HEAD_CX/TOP. Vizuálne overenie.
- [ ] **F3a — refaktor `resolveTurn` na rezumovateľný** (bez zmeny správania!). Celé `npm test`
      zelené. Samostatný commit.
- [ ] **F3b — THE WORLD:** server pauza/resume + `timestop_actions` + announce/kumulát; klient
      pauza + ts UI + filter; `worldUsed` default späť `false`. Testy TJ5-TJ7, TJ13, TJ14.
- [ ] **F4 — matica okrajov:** labyrint (TJ10), naruto (TJ11), turnaj (TJ12), tiles (TJ9),
      pasca (TJ15), Last Stand ručný check.
- [ ] **F5 — dokumentácia + polish:** CLAUDE.md, ability preview text, choreografia THE WORLD
      castu (Special_3_P menace + invert flash + „THE WORLD!" float), vizuálne overenie v
      prehliadači (obe strany, reload počas timestopu).

---

## 7. Známe pasce (nezopakuj chyby z Naruta — `docs/ADDING_CHARACTERS.md` §7)

1. **Nemeň `applyHit` default** — zmrazený režim rieš guardmi na volajúcich miestach
   (`announceFrozenHit`), nie vetvami v applyHit.
2. **1 `pushStateFrame` = 1 beat** — kumulatívna aplikácia MUSÍ byť jeden frame s `parts`
   (block/mirror/hit), nie sekvencia.
3. **`positionActors` beží na konci každého kroku** a prepíše transformy — stand pozíciuj TAM,
   nie v efekt-handleri.
4. **Klientské `*_MS` musia sedieť so serverovými `delayMs`** — nové `TIMESTOP_*_MS` konštanty
   drž v oboch súboroch synchronizované.
5. **Redakcia sa robí server-side** (`redactTimelineFor`), nie skrývaním na klientovi —
   `ts_hit` pre prekliateho.
6. **Partial emit nesmie poslať už odohrané frame-y dvakrát** a druhá timeline musí začínať
   seed frame-om (klient aplikuje `timeline[0]`).
7. **UI unlock na konci playbacku** (`client.js:3432-3493`) sa pri `timestop_wait` NESMIE
   spustiť — inak si súper naplánuje akcie uprostred cudzieho time-stopu.
8. Sprite je širší než bunka (~1.875×) — stand vedľa Jotara rieš offsetom + prípadne
   `cropXFrac`, nech sa neprekrývajú cez susedné bunky.
9. Testový `state` listener drží len poslednú timeline — na 2 emisie v kole treba pole.

---

## 8. Definition of done

- [ ] Jotaro zvoliteľný na P2 (single/bo3 cez Hidden stránku) aj draftovateľný P2 hráčom v turnaji.
- [ ] Celý kit funguje a animuje (diagonálny basic s odrazom, normálny dash/melee, special1,
      THE WORLD → Special 2, golden mirror áno / mirror nie).
- [ ] Stand: summon intro, stála prítomnosť, akčné `_P` animácie, unsummon pri smrti.
- [ ] THE WORLD: pauza protokolu, zmrazené UI oboch strán, announce labely, kumulatívna aplikácia
      (hit/block/mirror), pokračovanie kola, reload počas čakania.
- [ ] Matica: obrany, labyrint, Last Stand, turnaj (swap ban, worldUsed persistencia), tiles,
      naruto klon, vamp pasca.
- [ ] `npm test` zelené vrátane TJ1-TJ15; vizuálne overené v prehliadači.
- [ ] `CLAUDE.md` aktualizovaný.
