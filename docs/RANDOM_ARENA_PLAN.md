# Náhodná aréna, nové lobby a divácka opona — plán

Stav: **implementované** (2026-11-01; testy `test/random-arena.mjs`, `test/spectator-curtain.mjs`, kocka v `test/telemetry.mjs`). Dev predlohy lobby a animácie boli po schválení a implementácii odstránené (sú v git histórii).

## 1. Rozhodnutia vlastníka

| Téma | Rozhodnutie |
|---|---|
| Náhodná aréna | Len možnosť „náhodne" (kocka 🎲 na konci riadku arén) - **bez** výberu, z ktorých arén sa losuje (vždy všetky 3). |
| Kocka | Statická (bez animácie), pixel art, 3D (vrch 1, predok 5, bok 3). Zapnutá = zlaté pozadie; tri karty arén vtedy majú pokojný zlatý rám (žiadne preblikávanie). |
| START | Vždy len „START" (aj pri náhodnej aréne). |
| Hlavné lobby | Arény + kocka → ⚙ ADVANCED SETTINGS (štítok DEFAULT / CUSTOM, pri kocke „CUSTOM: PORTAL, SWAMP") → FORMAT, YOUR COLOR, RANDOM CHARACTERS, TURN TIMER → START. Bez nadpisu „ARENA RULES". |
| Telefón - lobby | Celá obrazovka, nadpis ARENA (bez „Match setup"), popis ARENA nad kartami, voľné miesto rovnomerne medzi riadkami (`align-content: space-evenly`); dva stĺpce: FORMAT / TURN TIMER, YOUR COLOR / RANDOM CHARACTERS. |
| ADVANCED SETTINGS | Okno s pevnou veľkosťou, záložky = karty arén s obrázkom (bodka = upravené, červený rám = súčet ≠ 100 %), vľavo dlaždice/itemy (počet za kolo, náhľad, percentá), vpravo percentá; **Portal Realm: vpravo PORTALS PER ROUND (vedľa SPECIAL TILES PER ROUND) a pod tým PORTAL CHANCE**, vľavo TILE CHANCE. RESET TO DEFAULT (len otvorená aréna) + DONE (zablokované pri zlom súčte) vždy na rovnakom mieste. Telefón: okno uprostred so stmaveným lobby okolo. |
| Ukladanie | Každá zmena sa hneď uloží do `localStorage` (výber arény/kocky, formát, farba, náhodné postavy, časovač + nastavenia všetkých 3 arén). Viazané na zariadenie/prehliadač (nie na hráča). Poškodené/neznáme hodnoty → default. |
| Animácia losovania | Nadpis **ARENA** (štýl `.cr-title` rulety farieb) a **posuvný pás** (zmena 2026-11-01, nahradil skákajúci rám): karty arén **vždy v poradí STONE BRIDGE → PORTAL REALM → SHREK SWAMP → …** prebiehajú okienkom (okraje do tmy) popod pevnú zlatú značku (trojuholníky + čiara); štart s PORTAL REALM pod značkou, pás spomaľuje (3 s, karta pod značkou svieti + `ui.random_hop`), zastaví sa kúsok vedľa stredu vylosovanej karty a dobehne pod značku, ostatné zošednú, pod okienkom vyskočí názov (`ui.pick`), ~1.5 s drží, overlay zmizne (0.4 s). Fázy `ARENA_ROLL_*` v `shared/timing.js`. |
| Poradie | losovanie arény → ruleta farieb → výber / losovanie postáv (resp. turnajový draft). |
| Diváci | Lobby: „Waiting for host to set up the match…". Losovanie arény vidia tiež. Potom **opona** (bod 5) až do skutočného začiatku hry - nič nevidia skôr ako hráči. |

**Séria (BO3 / turnaj):** aréna sa losuje **raz za zápas** a celá séria sa hrá na nej (rozhodnutie 2026-11-01).

## 2. Server / engine

- **Config:** `configure_match` pri kocke pošle `arena: "random"` + nastavenia **všetkých troch** arén
  (`tileWeights`/`tilesPerRound`/`tilePreview` bridge, `portal: {…}`, `swamp: {…}`). `sanitizeConfig` overí
  každú zvlášť (súčty 100 %), inak `null`.
- **Výber:** `startMatch` hneď po reseede `rand()` vylosuje arénu (prvé volanie `rand()`), potom config
  **znormalizuje na config vylosovanej arény** (presne ten tvar, aký vzniká pri ručnom výbere) + kľúč
  `randomArena: true`. Zvyšok enginu sa nemení. Bez kocky sa `rand()` navyše nevolá → **goldeny bit-identické**.
- **Telemetria:** `match_start` nesie pôvodný config s `arena: "random"`; replay zavolá `startMatch` s tým istým
  configom a seedom → vylosuje tú istú arénu (žiadny nový vstup). Fakt `match_start` dostane aj vylosovanú arénu.
- **Emity (poradie kritické, ako pri farbe):** `you_are` → `arena_roll { arena }` (len pri kocke) →
  `color_roll { …, afterArena }` → `char_roll { …, afterArena }` → `state`. Časovač ťahu sa posunie
  o `ARENA_ROLL_MS` (nová konštanta v `shared/timing.js`, súčet fáz animácie).

## 3. Klient

- `public/client/lobby.js` prepísaný podľa predlohy (hlavné lobby + okno ADVANCED SETTINGS + `localStorage`
  `arena.lobby.v1`), `index.html`, `styles.css`, `styles-mobile.css` (telefón: celá obrazovka, okno uprostred).
  Pixel kocka do `public/client/pix.js`.
- `public/client/arena-roll.js` - overlay losovania (nad `#color-roll`); `color_roll`/`char_roll` počkajú
  `afterArena`. Pozadie a hudba sa prepnú na vylosovanú arénu až po animácii. Reload počas animácie → rovno výsledok.
- Zvuky: existujúce `ui.random_hop` a `ui.pick` (nový kľúč zvuku netreba).

## 4. Hráč B a divák v lobby

Hráč B ďalej vidí „Waiting for host to set up the match…"; **divák dostane tú istú obrazovku** (dnes vidí prázdnu plochu).

## 5. Divácka opona

- Od `configure_match` po **skutočný začiatok hry** divák namiesto plochy vidí obrazovku GET READY so stavom
  oboch strán: `⚪ WHITE · choosing… / drawing… / drafting team… / ✓ READY` (rovnako ⚫ BLACK) - **bez
  prezradenia postáv**.
- **Koniec opony určuje server** (`server.js`, nie engine - čisto prezentácia, replay telemetrie sa netýka):
  obaja hráči majú postavu (resp. tím) **a** uplynul čas všetkých animácií (aréna + farba + postavy - tie isté
  konštanty, o ktoré sa posúva časovač ťahu). Dovtedy divák dostáva redigovaný snapshot (bez postáv, pozícií,
  tímov) + `curtain: { white, black }`; potom normálny stav.
- To isté **pred každou ďalšou hrou série** (opätovný výber postáv). Divák, ktorý príde do bežiacej hry, vidí hru hneď.

## 6. Testy a overenie

- `test/random-arena.mjs` (nový, do `npm test`): sanitize (zlý súčet v ktorejkoľvek aréne → null), deterministický
  výber pri rovnakom seede, rozloženie cez veľa seedov (všetky 3 arény padajú), normalizovaný config = config
  ručného výberu, poradie emitov, posun časovača.
- `test/telemetry.mjs`: bot zápasy aj s kockou, replay musí sedieť.
- Socket test diváka: v lobby čakacia obrazovka, počas prípravy opona bez postáv, po konci animácií plný stav;
  medzi hrami série znova opona.
- `npm run golden` (0 zmien), `npm run lint`, `node tools/browser-smoke.mjs`, `node tools/screens.mjs` (lobby +
  ADVANCED na všetkých veľkostiach), `node tools/touch-smoke.mjs` (−/+ v ADVANCED na dotyku).
- Dokumentácia: `CLAUDE.md` (lobby, socket protokol `arena_roll`, divácka opona).
