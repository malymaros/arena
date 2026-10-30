# Shield Breaker / Mirror Breaker — plán

Stav: **dizajn schválený vlastníkom 2026-10-30, engine neimplementovaný.** Vizuál (animácia + tlačidlá) sa ladí
v náhľade `/?breakerdebug=1` (`public/client/debug-breaker.js`), budúci efekt je `public/client/breaker-fx.js`.

Cieľ: dotiahnuť yomi trojuholník. Dnes je obrana bezpečná voľba — najhoršie, čo sa jej stane, je, že ju spotrebuje
súperova akcia bez dmg. Breaker ju trestá, ak súper obranu prečíta.

## 1. Pravidlá (rozhodnutia vlastníka)

- Dve nové akcie: **Shield Breaker** (`shield_breaker`) a **Mirror Breaker** (`mirror_breaker`). Pracovné názvy.
- **Slot:** breaker je alternatíva svojej obrany — klik na štít / mirror otvorí výber obrana | breaker (ako smerový
  picker útoku; ostatné tlačidlá sú medzitým zamknuté). Shield Breaker a štít sa v kole vylučujú, rovnako Mirror
  Breaker a mirror. Každý max 1× za kolo.
- **Cena = cena obrany:** Shield Breaker `SHIELD_COST` (2), Mirror Breaker `MIRROR_COST` (4).
- **Golden breaker NEEXISTUJE:** golden predťah beží pred prvou akciou startéra, súper vtedy nikdy nemá nabitú obranu.
- **Cieľ:** súperova obrana nabitá v momente, keď breaker beží (= breaker je súperova najbližšia akcia po obrane).
  Nie je to pozičný útok — dosah je celá doska, portály nehrajú rolu.
- **Výsledok podľa súperovej obrany:**

  | súper má | Shield Breaker | Mirror Breaker |
  |---|---|---|
  | štít (aj golden) | rozbije štít + **2 dmg** | štít ho **zablokuje** (0 dmg, štít spotrebovaný) |
  | mirror (aj golden) | mirror ho **odrazí** — útočník dostane 2 | rozbije mirror + **4 dmg** |
  | nič | nič (lúč sa rozplynie, mana minutá, žiadny text) | nič |

- Obrana sa breakerom **vždy spotrebuje** (je to súperova najbližšia akcia), aj pri bloku / odraze.
- **Násobiče platia:** Last Stand ×2, Last Hope ×4, maze buff ×2 (aj na odraz — mirror odráža plný dmg).
  Prijímajúci Last Stand/Hope = ½ ako pri každom zásahu.
- **Power dlaždica sa nespotrebuje** a nedáva bonus (ako pri štíte).
- **Def-blocker dlaždica breaker nezakazuje** (je to útok, nie obrana).
- **Vampire / Onryō:** ich imunita na mirror sa breakera **netýka** (breaker nie je odraz ich útoku) — Shield
  Breaker do ich mirroru sa normálne odrazí, Mirror Breaker ich mirror rozbije.
- **Jotaro, Luffy:** nemajú mirror → nemajú Mirror Breaker (mirror slot = Special 1). Shield Breaker majú.
- **Narutov klon:** zdieľaná obrana — dmg ide na majiteľa, klon zásahom zaniká (any damage dissolves the clone).
- **Labyrint:** zásah (aj blokovaný / odrazený) labyrint ukončí ako každý zásah; reveal pred animáciou.
- **Escanor:** zásah breakerom aj odrazený Shield Breaker = zásah od súpera → −1 pride.
- **THE WORLD:** Jotaro smie Shield Breaker aj v zmrazených akciách (súperova obrana trvá celé zamrazenie).

## 2. Vizuál (schvaľuje sa v náhľade)

- Útočník drží svoju range attack pózu, **súvislý lúč** z ruky do súpera vo farbe breakera (štít tyrkys, mirror fialová).
- Správna obrana: bariéra (šesťuholník / tabuľa) sa **zohrieva** farba obrany → oranžová → červená → biely žiar,
  praskliny v 3 vlnách, roztrieštenie + otras dosky, „SHIELD BROKEN!" / „MIRROR SHATTERED!", hurt + −N HP.
- Zlá obrana: lúč zhasne a prehrá sa skutočný efekt obrany (`spawnShieldBlock` / `spawnMirrorReflect`).
- Bez obrany: lúč dorazí a rozplynie sa (žiadny dopad ani text).
- Tlačidlo breakera: tmavá krvavočervená `#4a0b0e`, ikona obrany v tóne „noir" (`pix.js` `breakerIco` — čiernobielo,
  rám zrkadla ebenový dvojtónový), popis `2☠` / `4☠`; obrana vo výbere má popis BLOCK / REFLECT.

## 3. Implementácia

### Balans
- `shared/balance.js`: `SHIELD_BREAKER_DMG = 2`, `MIRROR_BREAKER_DMG = 4` (cena = `SHIELD_COST` / `MIRROR_COST`).
- `public/client/balance-ui.js`: texty a ceny tlačidiel z konštánt; `test/balance-ui.mjs` musí prejsť.

### Engine
- `ACTION_TYPES` + `validQueue` (vylúčenie s vlastnou obranou, Jotaro/Luffy bez `mirror_breaker`, golden zakázaný),
  `validBasicAction` / `draftQueue` / `fillFromDraft` / `autoLock`, `validTimestopQueue` (+ `shield_breaker`).
- `doBreaker(slot, kind, tl)`: mana gate (wall-rule: bez many invalid), frame-y lúča, potom vetvy podľa súperovej obrany
  cez **`resolveStrike`** (nový `kind: "breaker"` s `breakerKind`: obíde len zhodnú obranu → `break` frame + hit;
  nezhodná obrana ide bežnou cestou block/reflect; bez obrany `breaker_fizzle`). Nikdy nový `apply*` variant.
- `runRoundLoop`: obrana sa spotrebuje ako pri každej akcii (bez zmeny).
- THE WORLD: intercept v `resolveStrike` — zmrazený breaker len ohlási; `applyTimestopResume` musí vedieť, že niektorý
  zmrazený zásah bol Shield Breaker (štít sa rozbije a dmg dopadne namiesto bloku). Dorozhodnúť pri implementácii.
- Redakcia (labyrint): efekty breakera ako ostatné súperove efekty; `frame.act` tag automaticky.
- Telemetria / replay: nové typy akcií idú cez `lock` (bez zmeny), skontrolovať `round` segmenty.

### Klient
- `controls.js`: skutočný výber obrana | breaker (prevziať z `debug-breaker.js`), `PICKER_BTNS`, zamykanie.
- `touch.js` (ťuk = výber + náhľad, druhý ťuk = zaradenie), `peek.js` texty (`act()` v `public/chars/common.js`).
- `queue.js` (badge už je), `action-log.js` (ikona v logu akcií súpera), round-script súpera.
- `timeline.js`: nové efekty → `breaker-fx.js` (bod výstrelu podľa postavy, klon, figúry skryté v labyrinte).
- Perf: `.perf-lite` variant lúča (len opacity/transform — skontrolovať).
- Zvuky: nové kľúče udalostí (`SOUND_API_VERSION`), `npm run sounds:windows`.

### Bot, testy, dokumenty
- `tools/random-bot.mjs`: breaker do náhodných ťahov → `npm run golden:update` s vysvetlením.
- `test/engine-scenarios.mjs`: každý riadok tabuľky z bodu 1 + Naruto, labyrint, THE WORLD, Last Stand, power tile,
  Def-blocker, Vampire/Onryō, Escanor pride, Jotaro/Luffy validácia.
- `test/game-test.mjs`: socketový scenár lock → timeline.
- CLAUDE.md (protokol `lock_in`, damage pipeline, balance), odstrániť `debug-breaker.js` + import v `client.js`.
