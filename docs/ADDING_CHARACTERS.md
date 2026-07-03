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
  (framy musia byť **štvorcové**). Neštvorcové → uveď `frames:` v `ANIM_DEF`.
- Očakávané súbory: `Idle.png`, `Run.png`, `Attack_1.png`, `Attack_2.png`, `Hurt.png`, `Dead.png`,
  `Charge.png` (projektil basic útoku), plus special sprity.
- **Chýbajúce animácie** namapuj cez `SPRITE_FILE_ALIAS` v `client.js` (napr. Minotaur nemá `Run.png`
  → alias na `Walk.png`). Nemusíš duplikovať súbory.
- **p2 paleta:** buď natívny druhý sheet (`dirP2` v `CHAR_META` — medusa/minotaur/naruto), alebo nechaj
  CSS `alt-color` filter (fire/lightning/wanderer). Natívny sheet = krajšie, ale treba druhú sadu assetov.
- **Projektil (`Charge.png`):** ak nemáš vlastný, prefarbi fireball (viď medusa/minotaur) alebo sprav
  vlastný (naruto = chakra špirála). Per-paleta kópie pre p2.
- Ak assety vznikajú extrakciou z ripnutého sheetu, urob **reprodukovateľnú pipeline** ako
  `tools/sprites-naruto/` (skript + README), nech sa dá regenerovať.
- **Ladenie pozície hlavy:** `HEAD_CX` (horizontálny stred tela) a `HEAD_TOP` (vrch hlavy pre „YOU"
  vlajku) v `client.js` — hodnoty vylaď cez `/head-cropper.html`.

---

## 3. Kontrolný zoznam — čo treba upraviť (podľa súborov)

### `server.js` (autoritatívna logika)
- [ ] **`CHARS`** (~riadok 71) — pridaj kľúč postavy. Toto ju sprístupní pre `choose_character`,
      `choose_team` (turnaj) aj validáciu.
- [ ] **`specialDamageAndHit(players, slot)`** — vetva pre nový special: vráti `{dmg, hit}` (hit = slot
      zasiahnutého alebo `null`). Len pre **dmg** speciály.
- [ ] **`specialZoneHas(me, x, y)`** — MUSÍ zodpovedať zóne z `specialDamageAndHit` (používa sa na test
      zásahu klona). Drž ich synchronizované.
- [ ] **`SPECIAL_ZONE_DMG`** (~riadok 446) — raw dmg zóny (kvôli odrazu/klonovi).
- [ ] **`doSpecial(slot, …)`** — ak special nie je štandardná dmg zóna, pridaj vetvu (ako medusa/minotaur/
      naruto). Statusové/summon speciály tu majú vlastnú vetvu s `pushStateFrame`-ami a `return`.
- [ ] Ak special zavádza **nový stav** hráča (napr. `stone`, `labyrinth`, `clone`) — pridaj pole do
      `newPlayer()` (default) aj do `cloneActor()` (serializácia do snapshotu). Inak sa stav neprenesie klientovi.
- [ ] Ak stav treba pred súperom **skrývať** (labyrint) — uprav redakciu (`redactActor`, `redactHunterActor`,
      `redactEffect`, `redactTimelineFor`).

### `public/client.js` (render/animácie/vstup)
- [ ] **`CHAR_META`** — `{ name, dir, dirP2? }`.
- [ ] **`HEAD_CX`, `HEAD_TOP`** — pozícia tela/hlavy.
- [ ] **`SPECIAL_ANIMS`** — efektový sprite specialu (file, fps, loop).
- [ ] **`ANIM_DEF`** / **`SPRITE_FILE_ALIAS`** — ak treba nové anim kľúče alebo aliasy chýbajúcich súborov.
- [ ] **`cellsForSpecialPreview(meState, dir)`** — náhľad zóny pri hoveri/caste. MUSÍ zodpovedať
      `specialZoneHas`/`specialDamageAndHit` na serveri. (Trojica server×2 + client sa udržiava paralelne!)
- [ ] **`ABILITY_PREVIEW`** — popis + náhľadová zóna v char-selecte.
- [ ] **Label special tlačidla** (blok `if (specChar === …)` v state handleri, ~riadok 3600) — cost badge
      + tooltip pre nový special. Pozor: číta sa cez `ghostCharAt()` (turnaj swap).
- [ ] Ak má special **smer** — pridaj do pickera (ako medusa) a do `actionIcon`/`actionBadgeView` (šípky).
- [ ] Ak special spúšťa **nové efekty timeline** (`kind: "…"`) — pridaj ich obsluhu v prehrávači timeline
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
2. **Časovanie animácií:** serverové `*_MS`/`delayMs` konštanty ↔ klientské `*_MS` (`MOVE_MS`,
   `ATTACK_SWING_MS`…) a `ANIM_SLOW`. Ak sa rozídu, animácia nesedí s timeline.
3. **`ANIM_SLOW`** je v `server.js` aj `client.js` — musia byť rovnaké.
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
