# Pridávanie postáv do hry — príručka pre nového agenta

Tento dokument je návod, ako do arény pridať **novú postavu (mága)** s čo najmenším počtom chýb.
Vznikol po tom, čo pridanie **Naruta** (postava s tieňovým klonom) trvalo dlho a dotklo sa prekvapivo
mnohých systémov. Cieľom je, aby si nabudúce vedel dopredu, **čo všetko treba spraviť, čo sa opýtať
používateľa a na aké okrajové prípady myslieť**.

> Najprv si prečítaj `CLAUDE.md` (architektúra hry). Tento dokument naň nadväzuje a je konkrétnejší.

---

## 0. Zásadné rozhodnutie na začiatku: aký TYP postavy to je?

Náročnosť pridania **úplne závisí od typu specialu**. Rozhodni to hneď a podľa toho odhadni rozsah:

| Typ specialu | Príklad | Náročnosť | Prečo |
|---|---|---|---|
| **Poškodzujúca zóna** (zasiahne bunky, dá dmg) | fire (riadok), lightning (šach farba), wanderer (diagonála) | **Nízka** | Len 3 paralelné funkcie + dmg konštanta. Žiadny nový stav. |
| **Cielená bunka** (hráč si cieľ VYBERÁ — akcia nesie parameter) | soldier (snajperský lúč na zvolenú bunku) | **Stredná** | Žiadny nový stav, ale akcia nesie `cell` → nový picker UI, validácia vo `validQueue` (ghost pozícia, súperova bunka + klon, labyrint výnimka), timeout auto-fill a hover náhľad z akcie namiesto zo zóny. |
| **Statusový special** (bez dmg, mení stav súpera) | medusa (petrify), minotaur (labyrint) | **Vysoká** | Zavádza NOVÝ herný systém (nový stav v hráčovi, nová redakcia, nové animácie, nové interakcie s obranami). |
| **Summon / druhá entita** | naruto (tieňový klon) | **Veľmi vysoká** | Pridáva druhú figúru so samostatným renderom, pohybom, zásahmi, smrťou a interakciou s KAŽDÝM iným systémom. |

**Pravidlo:** poškodzujúca zóna = pár hodín. Statusový/summon special = počítaj s tým, že sa dotkneš
desiatok miest a musíš prejsť celú „maticu okrajových prípadov" (sekcia 5).

---

## 1. Čo sa používateľa opýtať PRED písaním kódu

Vyhneš sa tým prepisovaniu. Over si:

1. **Special — presná mechanika:**
   - Aké bunky zasahuje? (celý riadok / stĺpec / okolie / celá plocha / vlastná bunka / smerový?)
   - Koľko dáva dmg? Alebo **nedáva dmg** a robí status? (petrify / labyrint / summon / heal / buff…)
   - Má **smer** (ako Medúza left/right)? Ak áno, treba picker.
   - **Cena many** (štandard `SPECIAL_COST = 5`; over či iná).
   - Dá sa **blokovať štítom / odraziť mirrorom**? (fire/lightning/wanderer áno; naruto self-range nie.)
2. **Základné štatistiky** — HP, mana, dmg basic útoku/melee (default zdieľané konštanty; over výnimky).
3. **Ak je to summon/druhá entita** (klon a spol.) — prejdi s používateľom CELÚ maticu zo sekcie 5,
   lebo tam bola pri Narutovi väčšina iterácií (obrany na oboch, zrkadlenie vertikály, absorpcia,
   anonymizácia smeru, Last Stand smrť, atď.).
4. **Assety** — máme sprite sheety? V akom formáte (horizontálny strip? číslované PNG?)? Aké animácie
   chýbajú (treba alias)? Má postava **natívnu p2 paletu**, alebo použije CSS `alt-color` filter?
5. **Turnaj** — je postava súčasťou draft poolu? (Štandardne áno — všetky sú v `CHARS`.)

Ak niečo z toho nevieš, **radšej sa opýtaj** — special mechanika a obranné interakcie sú zdroj 90 % chýb.

---

## 2. Assety a sprite pipeline

- Sprite sheety sú **horizontálne stripy** v `public/assets/<char>/`; počet framov = `width / height`
  (framy musia byť **štvorcové**). Neštvorcové → uveď `frames:` v definícii animácie (`anims` postavy).
- Očakávané súbory: `Idle.png`, `Run.png`, `Attack_1.png`, `Attack_2.png`, `Hurt.png`, `Dead.png`,
  `Charge.png` (projektil basic útoku), plus special sprity.
- **Chýbajúce animácie** namapuj cez `spriteAlias` v `public/chars/<key>.js` (napr. Minotaur nemá `Run.png`
  → alias na `Walk.png`). Nemusíš duplikovať súbory.
- **p2 paleta:** buď natívny druhý sheet (`meta.dirP2` v `public/chars/<key>.js` — medusa/minotaur/naruto), alebo nechaj
  CSS `alt-color` filter (fire/lightning/wanderer). Natívny sheet = krajšie, ale treba druhú sadu assetov.
- **Projektil (`Charge.png`):** ak nemáš vlastný, prefarbi fireball (viď medusa/minotaur) alebo sprav
  vlastný (naruto = chakra špirála). Per-paleta kópie pre p2.
- Ak assety vznikajú extrakciou z ripnutého sheetu, urob **reprodukovateľnú pipeline** ako
  `tools/sprites-naruto/` (skript + README), nech sa dá regenerovať.
- **Ladenie pozície hlavy:** `headCx` (horizontálny stred tela), `headTop` (vrch hlavy pre „YOU"
  vlajku) a `headCrop` (výrez hlavy do HUD) v `public/chars/<key>.js` — hodnoty vylaď cez `/head-cropper.html`.

---

## 3. Kontrolný zoznam — čo treba upraviť (podľa súborov)

### `engine/` (autoritatívna logika; `server.js` sú len sockety)
- [ ] **Čísla postavy (cena, dmg, bonusy) do `shared/balance.js`** — jediný zdroj balansu; engine ich číta cez
      `engine/constants.js`, klient ich interpoluje do tooltipov (`${…}`). Nikdy nepíš číslo priamo do textu
      tlačidla — `test/balance-ui.mjs` to odhalí.
- [ ] **`CHARS`** v `engine/constants.js` — pridaj kľúč postavy (side-postava: `SIDE_CHARS`). Toto ju
      sprístupní pre `choose_character`, `choose_team` (turnaj) aj validáciu.
- [ ] **`engine/characters/<postava>.js`** + registrácia v `engine/characters/index.js` — postava sa
      deklaruje na jednom mieste (vzor: `escanor.js`, `soldier.js`, zónové `simple.js`):
      - `kit`: `attack` (`ortho`/`diag`), `mirrorSlot` (`mirror`/`special1` + register `special1` - Jotaro smer, Luffy bunka), `meleeDmg`, `healTile`
        → validácia fronty aj auto-fill sa riadia kitom, netreba písať vetvy podľa mena;
      - `special.resolve(ctx, slot, tl, { dir, cell })` — vyhodnotenie (mana gate je v `doSpecial`);
        dmg ide VÝHRADNE cez `ctx.strikeZone` / `ctx.strikeCell` (damage pipeline - obrany, klon, labyrint,
        THE WORLD sa riešia samy), frame-y cez `ctx.pushStateFrame`, pred istým zásahom `ctx.revealLabyrinths`;
      - `special.validate(ctx, a, sim)` — ak special nesie cieľ (bunka/smer), odmietnutie pri `lock_in`;
      - pasívky cez háčiky `on: { deploy, hitTaken, roundStart, afterActions, roundEnd, roundEndFx }` (vzor:
        Escanor pride, vlkolak moon, Pútnikov regen); vlastný stav hráča pridaj do `newPlayer`/`cloneActor`
        a jeho reset pri nasadení do `deployReset`;
      - iná mechanika základnej akcie = prepísanie `dash` / `melee` (vzor: Vampire), útok v slote mirroru = `special1` (vzor: Jotaro, Luffy).
- [ ] **Geometriu zóny** (ak ju kreslí aj klient) daj do `shared/geometry.js` a volaj ju zo special aj
      z klientského `cellsForSpecialPreview` - nikdy ju nepíš dvakrát.
- [ ] Ak special zavádza **nový stav** hráča (napr. `stone`, `labyrinth`, `clone`) — pridaj pole do
      `newPlayer()` (default) aj do `cloneActor()` (serializácia do snapshotu). Inak sa stav neprenesie klientovi.
- [ ] Ak stav treba pred súperom **skrývať** (labyrint) — uprav redakciu (`redactActor`, `redactHunterActor`,
      `redactEffect`, `redactTimelineFor`).

### `public/chars/<key>.js` (klientský register — dáta postavy)
- [ ] Nový súbor + riadok v `CHAR_LIST` v `public/chars/index.js` (tam je popis všetkých polí):
      **`meta`** `{ name, dir, dirP2? }`, **`specialAnim`** (efektový sprite specialu), **`headCx`/`headTop`/`headCrop`**,
      `pairShift`, `portraitScale`, **`abilityPreview`** (popis + náhľadová zóna v char-selecte), podľa potreby
      `anims` (nové anim kľúče), `spriteAlias` (chýbajúce súbory), `side`/`vamp`, `teleport*`, `previewCast`.
- [ ] **`buttons`** — tooltip + cena special/melee tlačidla ako šablóna nad `shared/balance.js`
      (``cost: `−${SPECIAL_COST}{💧} ${MOJA_DMG}{☠️}` ``, import `"../../shared/balance.js"`), prípadne skin
      dash/mirror/recharge slotu. To isté pre `abilityPreview.dmg`. Tlačidlo, ktoré postava má **inak** (iný melee,
      charge v dash slote, útok v mirror slote…), dostane text cez `...act("NÁZOV", cena, "veta.")` z
      `public/chars/common.js` - z neho je tooltip na PC aj okno pri podržaní tlačidla na dotyku (`client/peek.js`).
- [ ] **`specialTarget`** (`dir` / `wolf` / `cell` / `trap` / `reach` + `specialReach` / `none`) a **`specialZone`** — náhľad
      zóny zo `shared/geometry.js` (`G.…`), tú istú, ktorú volá special na serveri.
- [ ] Podľa potreby kreslenie a plánovanie: `boardFit`, `victoryAnim`, `sizeLevel`, `projectile`, `actionAnims`,
      `planUi`/`attackPicker`/`aimStopsAtFoe`/`buttonBadge`, `mirrorSlot`, `planSpecialWarn` (popis v `index.js`).

### `public/chars/fx/<key>.js` (klientská choreografia — NIE vetvy v `public/client/*`)
- [ ] Ak postava potrebuje vlastnú choreografiu, nový modul + riadok v `CHAR_FX_FACTORIES` v `public/chars/fx/index.js`
      (tam je popis háčikov). Továreň `(C) => háčiky`, `C` = klientský scope (`const C` v `public/client.js`;
      chýbajúci getter doplň tam).
- [ ] **Nové efekty timeline** (`kind: "…"`) autora tejto postavy → háčik `effect(e, frameHold)`; póza malej postavy
      → `boardAnim`; veľký stredový sprite → `centerCast`/`centerCanvas`/`drawCenter` (vlastný stred: `ownCenter`).
- [ ] Vlastné HUD prvky → `hud`, náhľad vo výbere → `preview`, karta → `drawCard`, ďalšie figúry na doske
      (ako Jotarov stand) → `init`/`position`/`drawBoard`/`stateChar`/`resetActors`.

### `public/client/*` (render/animácie/vstup — generický kód, moduly popísané v CLAUDE.md)
- [ ] Ak má special **smer** — pridaj do pickera (`controls.js`, ako medusa) a do `actionIcon` (`action-log.js`) /
      `actionBadgeView` (`queue.js`) (šípky).
- [ ] Všeobecný efekt timeline, ktorý nepatrí jednej postave (mechanika), obslúž v prehrávači `timeline.js`
      (`schedulePlayTimeline` → `step()` → `for (const e of frame.effects)`).

### `public/index.html`
- [ ] **Char-select karta** — `<div class="char-card" data-char="…">` + `<canvas … data-char="…">`
      + `.char-stats`. Pozor na stránkovanie (`data-page`) — 3 karty na stránku.

### `test/game-test.mjs`
- [ ] Pridaj testy pre nový special (dmg/zóna, obrany, a KAŽDÚ novú interakciu). Viď sekcia 6.

### `CLAUDE.md`
- [ ] Zdokumentuj special v sekcii „Character specials" a všetky nové mechaniky/interakcie.

---

## 4. „Paralelne udržiavané" miesta — najčastejší zdroj tichých chýb

Tieto musia **vždy sedieť dokopy**, inak sa náhľad rozíde s realitou alebo klient desynchne:

1. **Zóna specialu:** `specialDamageAndHit` (dmg) ↔ `specialZoneHas` (test klona) ↔
   `cellsForSpecialPreview` (klientský náhľad). Zmena v jednom → zmena vo všetkých troch.
2. **Časovanie animácií:** serverové `*_MS`/`delayMs` konštanty žijú v `shared/timing.js` (engine ich
   re-exportuje cez `engine/constants.js`). Hodnotu, ktorú potrebuje aj klient, **importuj odtiaľ**
   (`import { … } from "/shared/timing.js"`) — nikdy ju neduplikuj. Klientské dĺžky animácií (`MOVE_MS`,
   `ATTACK_SWING_MS`…) musia pokryť `delayMs` framov, inak animácia nesedí s timeline.
3. **`ANIM_SLOW`** je len v `shared/timing.js` (server aj klient ho importujú).
3b. **Čísla balansu** sú len v `shared/balance.js` — engine aj UI texty (tooltipy, cenovky, náhľady) z nich;
   `test/balance-ui.mjs` stráži, že sa v UI neobjaví natvrdo zapísané číslo.
4. **Každý nový `pushStateFrame` efekt** musí mať obsluhu na klientovi — inak sa stav „teleportuje"
   bez animácie.

---

## 5. Matica okrajových prípadov — proti čomu OTESTOVAŤ každý special

Toto je jadro dokumentu. Pri Narutovi sa väčšina iterácií točila práve tu. Pre **každý** nový special
(najmä statusový/summon) prejdi tieto systémy a rozhodni, ako sa správa:

### Obrany (shield / mirror)
- Blokuje special štít? Odráža ho mirror? (dmg → áno; status ide „cez obrany ako petrify" — shield blokuje,
  mirror odrazí status späť na castera.)
- Ako sa odrazí **statusový** special? (medusa → petrifikuje castera; minotaur → labyrint na castera.)
- **Ak je to summon/druhá entita:** obrana je zdieľaná — reaguje na OBOCH figúrach? Odraz vychádza z
  **správnej bunky** (nie z pravej postavy, to prezradí)? (Naruto: `applyHitBoth` rieši block/odraz oboch
  v jednom beate; `applyHitOnClone` odraz z klonovej bunky.)

### Labyrint (minotaurova redakcia)
- Čo vidí prekliaty hráč a čo nesmie vidieť? (Súperovu pozíciu/manu/efekty — redigované.)
- Čo NEVIDÍ lovec (Minotaur)? (Ariadninu niť, threadMark, manu prekliateho.)
- Ukončuje tvoj special/zásah labyrint? (Akýkoľvek **action hit** — aj blokovaný/odrazený — áno; tile dmg nie.)
- **Deterministická smrť v labyrinte** musí prehrať reveal sekvenciu (hra nesmie skončiť v hmle).
- Nový efekt/stav — treba ho redigovať? (Ak prezrádza pozíciu/úmysel súpera, áno.)

### Last Stand / Last Hope (buffnuté finálne kolo)
- Škáluje dmg buff násobičom (`dealMul`: Last Stand ×2, Last Hope ×4)? Prijatý dmg cez `recvDmg` (½)?
- Ak je to summon — čo sa deje s entitou pri **Last Stand smrti** (démon zabije → vzkriesi)? Zaniká entita?
  Zrkadlí buff vizuály? (Naruto: klon zaniká pri smrti pred vzkriesením; buff dmg áno, zlaté vizuály nie.)
- Vo finálnom kole je swap/golden zamknutý — dotýka sa to tvojej postavy?

### Turnaj (draft tímu, prenos HP/many, swap)
- Postava je v poole `CHARS` → automaticky draftovateľná. HP/mana sa **prenášajú medzi hrami** (per mág).
- Special/stav sa musí správne uložiť pri **swape** a na konci hry.
- Počas labyrintu je swap zakázaný — nekoliduje to s tvojím stavom?
- Ak entita (klon) — zaniká pri swape aj na konci hry (`doSwap`, `resolveTurn` `ended` cleanup).

### Dlaždice a IK
- Reaguje tvoj stav/entita na dmg/heal/mana/IK dlaždice? (Klon: dmg tile ho nezabíja, IK áno; pickupy neberie.)

### Shrek Swamp (`docs/SWAMP_PLAN.md`)
- Dmg special / Special 1 so zónou musí po zásahu súpera zavolať `ctx.shrekZone(slot, cells, raw, tl)` - inak
  Shrek v zóne nedostane dmg ani nereaguje (tackle / rev). Vlastné melee volá `ctx.shrekMelee(…)`. Basic strela
  ide cez `doBasic` (Shrek ju zastaví sám). Charge/trap/statusy Shreka zámerne ignorujú.

### Timeline / výhra
- Víťaz sa kontroluje po **každom** zásahu (`winnerNow()`) — „prvá smrť ukončí kolo, žiadna remíza".
  Nové zásahy to musia rešpektovať.
- Nový efekt musí byť v správnom **beate** (`pushStateFrame`) — ak majú dve veci hrať naraz, musia byť
  v jednom frame (viď `applyHitBoth` pre Naruta+klon).

### Ak summon/druhá entita — navyše celá „figúrová" agenda
- **Render:** vlastný canvas per slot (ako `cloneEls`), pozícia v `positionActors`, kreslenie v raf.
- **Nerozoznateľnosť** (ak má klamať súpera): žiadny efekt/animácia/log nesmie prezradiť, ktorá figúra je
  pravá. Pri Narutovi to zahŕňalo: hurt→flinch pri neplatnej akcii, anonymizáciu **vertikálneho smeru**
  pohybu aj útoku v zázname/lište (`displayDir`), odraz/blok z bunky figúry, tichý flinch pri tile zásahu,
  žiadny problik pri zániku.
- **Pohyb/zrkadlenie:** definuj presne (Naruto: horizontála 1:1, vertikála inverzne — pre pohyb AJ útok).
- **Smrť:** kedy entita zaniká? (zásah, smrť majiteľa, swap, koniec hry, recast…)

---

## 6. Testovanie

- `npm test` — integračný test (`test/game-test.mjs`) bootne server a vodí 2 socket klientov.
  `FORCE_FIRST_STARTER=A|B` pinuje štartéra (testy sa naň spoliehajú).
- Pre nový special napíš testy na: **zónu/dmg**, **obrany (shield blokne, mirror odrazí)**, a **každú novú
  interakciu** (labyrint, Last Stand, turnaj swap, klon…). Vzory: testy T40–T52 sú husté a dobré na kopírovanie.
- Používaj `invariantCheck(tl, "Txx")` — kontroluje konzistenciu HP s efektami (odhalí, keď dmg nesedí s frame-ami).
- Po ZMENE existujúcej mechaniky over, či nepadli staré testy — a ak je zmena zámerná, **uprav test** (nie kód späť).
- Vizuálne over v prehliadači (`npm start`), zvlášť animácie a časovanie (klient prehráva timeline cez `setTimeout`).

---

## 7. Konkrétne poučenia z Naruta (aby si ich nezopakoval)

- **`applyHit` je univerzálna** — ide cezeň každý zásah. Nemeň jej default správanie kvôli jednej postave;
  rob **opt-in** cesty (napr. `applyHitBoth`), inak rozbiješ časovanie celej hry.
- **Sekvenčné vs paralelné animácie:** 1 `pushStateFrame` = 1 beat, klient ich hrá po sebe. Ak majú dve
  reakcie hrať naraz (obrana Naruta aj klona), musia ísť do **jedného** framu.
- **`positionActors` beží na konci každého kroku** a prepíše transformy, ktoré si nastavil v efekt-handleri
  (Naruto summon póza sa musela držať cez stav `cloneSummonPose`, nie priamo nastaviť).
- **Sprite je širší než bunka** (~1.875×) s priehľadným okrajom — pre „dve figúry v jednej bunke" treba
  orez (`cropXFrac` v `drawSprite`), nie len offset.
- **Anonymizácia je obojsmerná a týka sa aj LOGU/lišty**, nielen boardu — súper vie korelovať smer z lišty.
- **Zdieľané obrany/mana** entít: jeden flag pre oboch, ale efekty (float/glow) duplikuj na obe figúry,
  nech nič neprezradí.
- **Redakcia (labyrint) sa robí SERVER-side** (`snapshotFor`/`redactTimelineFor`) — nie skrývaním na klientovi.

---

## 8. „Definition of done" — než to vyhlásiš za hotové

- [ ] Postava sa dá zvoliť (single/bo3) aj draftovať (turnaj).
- [ ] Basic útok, melee, pohyb, dash, recharge, obrany fungujú a animujú.
- [ ] Special: dmg/zóna/status/summon funguje presne podľa zadania; náhľad (hover aj char-select) sedí s realitou.
- [ ] Special button má správny cost badge + tooltip (aj po turnajovom swape).
- [ ] Prešla celá **matica zo sekcie 5** relevantná pre daný typ (obrany, labyrint, Last Stand, turnaj, tiles, timeline).
- [ ] p2 (pravá strana) sa renderuje správne (paleta/mirror char-select).
- [ ] `npm test` zelené (vrátane nových testov); vizuálne overené v prehliadači.
- [ ] `CLAUDE.md` aktualizovaný.

---

Ak zadanie znie ako „pridaj poškodzujúcu zónu", je to rýchle (sekcie 3–4). Ak znie ako „pridaj postavu
s novým **mechanizmom**" (status/summon/entita), počítaj s tým, že hlavná práca je **matica okrajových
prípadov (sekcia 5)** — a práve tam sa oplatí dopredu odsúhlasiť správanie s používateľom.
