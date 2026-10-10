# Refaktor hernej logiky - plán

Cieľ: hernú logiku vytiahnuť na samostatné miesto a zjednotiť ju tak, aby sa postavy dali meniť/pridávať
bez množenia okrajových prípadov (typicky Narutov klon). Postup je **etapový** - po každej etape hra
funguje a testy prechádzajú. Žiadny big-bang prepis.

## Diagnóza (stav pred refaktorom)

1. **Prierezové mechaniky ako flagy v 5 variantoch zásahu** - `applyHit`, `applyStackedHit`,
   `applyHitPairDefended`, `applyHitBoth`, `applyHitOnClone`; každý má vlastnú kópiu pravidiel
   shield → mirror → mirror-imunita → THE WORLD freeze → labyrint → pride. Nová mechanika = 5 miest.
   Klon nemá vlastný model, je to „druhá figúra" prilepená ku každej vetve.
2. **Postava je rozsypaná** - napr. Escanor žije v `doSpecial`, `notePrideHit`, `finishRound`,
   `newPlayer`/`cloneActor`, `fillFromDraft`, redakcii + ~15 miest na klientovi.
3. **Geometria 2× (server + klient)** - `vampShotRoute`, `escanorCells`, ghost simulácia, validácia
   frontu… sa musia ručne držať v sync.
4. Celá logika žije v closure `createRoom()` spolu so socketmi/časovačmi → testovateľná len cez
   reálny server + 2 klientov.

## Cieľová architektúra

```
engine/                 čistá herná logika, žiadne sockety
  state.js              newPlayer/newGame, figúry
  resolve.js            resolveTurn / runRoundLoop / finishRound
  damage.js             JEDEN damage pipeline
  events.js             háčiky (onHitTaken, onStep, onRoundEnd, onDeath, onDeploy…)
  tiles.js, labyrinth.js, timestop.js, laststand.js
shared/                 ES modul importovaný serverom aj prehliadačom
  geometry.js           zóny, dráhy striel, simulácia pohybu, validácia cieľov
characters/             jeden súbor = jedna postava
server.js               miestnosti, sockety, časovač, redakcia, emit
```

**A) Damage pipeline** - každý zásah:
`intercept (THE WORLD) → defense (shield/mirror/imunita, zdieľaná pre figúry) → soak (stacknutý klon)
→ apply (HP, Last Stand ½, jeden hit frame s parts) → event onHitTaken/onHitDealt`.

**B) Klon = figúra** - hráč má `[hlavná, klon?]`; cielenie vracia zasiahnuté figúry, pipeline ich
rieši jednotne. Zostanú len skutočné pravidlá (zrkadlenie vertikálnej osi).

**C) Háčiky** - pride (`onHitTaken`+`onRoundEnd`), mesiac (`onRoundEnd`/`onDeploy`), pasca a niť
(`onStep`), koniec labyrintu (`onHitTaken`).

**D) Postava = deklarácia + háčiky**

```js
// characters/escanor.js
export default {
  key: "escanor",
  state: { pride: 0 },
  kit: { attack: "ortho", melee: { dmg: 8 } },
  special: {
    cost: 5,
    target: "dir_lr",   // none | dir_lr | dir4 | dir8 | cell(filter) → validácia, auto-fill, picker
    zone: (actor, { dir }, board) => escanorCells(actor, dir),
    resolve(ctx, actor, args) { /* ctx.frame(…); ctx.damage({…}) */ },
  },
  on: {
    hitTaken(ctx, me) { me.prideHit = true; },
    roundEnd(ctx, me) { /* ±1 pride */ },
    deploy(ctx, me)   { me.pride = 0; },
  },
};
```

**E) Klient** - register `public/chars/<key>.js` (ANIM_DEF, aliasy, choreografia, skiny tlačidiel);
previews importujú `shared/geometry.js`.

## Etapy

| # | Etapa | Riziko | Odhad |
|---|---|---|---|
| 0 | Záchranná sieť: seedovateľný RNG, golden-master timeline testy, oprava nestabilného T8 | nízke | 1–2 sedenia |
| 1 | Logika z `createRoom()` do `engine/` s explicitným `ctx` (presun kódu) | nízke | 2 |
| 2 | `shared/geometry.js` server+klient | stredné | 1–2 |
| 3 | Damage pipeline + figúry | vysoké | 3–4 |
| 4 | Register postáv (`characters/*.js`), validácia z `target` - po jednej postave | stredné | 3–4 |
| 5 | Háčiky: pride, mesiac, pasca, niť, labyrint, Last Stand | stredné | 2 |
| 6 | Klientsky register postáv | stredné | 3–5 |

## Pravidlá počas refaktoru

- Okrajové prípady nemiznú, ale sú na jednom mieste. Kde je dnešné správanie medzi cestami
  nekonzistentné (napr. soak klona v rôznych `apply*`), **nerozhoduje sa potichu** - zapisuje sa do
  sekcie „Rozhodnutia" nižšie na schválenie.
- Počas refaktoru žiadne nové features (Jotaro F2, Luffy - dokončiť pred/po).
- Golden master sa mení len vedome (`npm run golden:update`) s vysvetlením v commite.

## Etapa 0 - stav

- [x] seedovateľný RNG (`ARENA_SEED`) - všetka herná náhoda roomky ide cez `rand()`, pri seede sa nanovo
      nasemienkuje v každom `startMatch` (mulberry32). `npm test` beží so seedom 1 (prepísateľné env).
- [x] golden-master testy (`test/golden.mjs`, `test/golden/*.json`) - 48 zápasov (každá p1 postava × 2 súperi,
      + zrkadlá, každá dvojica s 2 seedmi frontov), fronty generuje seedovaný klient (neplatné server odmietne
      cez ack → ďalší kandidát), zaznamenáva timeline z pohľadu oboch hráčov (redakcia), vrátane THE WORLD.
      Frame-y sú delta-kódované (len zmenené kľúče), jeden frame = jeden riadok → čitateľný diff.
      `npm run golden` porovná, `npm run golden:update` prepíše; `node test/golden.mjs <podreťazec>` filtruje.
      Pokrytie (337 kôl): klony, labyrint, pasce, THE WORLD 6×, Last Stand/Hope, démon, petrify, dlaždice.
      Slabšie pokryté (≤2×): mirror odraz, petrify, soldier beam, wolf strike, Luffy pull/explode - doplniť
      cielené scenáre, ak etapa 3 zasiahne tieto cesty. Turnaj (swap) golden zatiaľ nepokrýva.
- [x] oprava nestabilného T8 - beží bez IK dlaždíc (náhodné IK v ceste ukončilo hru pred výstrelom)

## Etapa 1 - stav

- [x] `engine/constants.js` - všetky herné konštanty a čisté helpery (1:1 z vrchu `server.js`).
- [x] `engine/game.js` - `createEngine(io)`: celý herný stav a logika roomky (akcie, zásahy, dlaždice,
      labyrint, THE WORLD, Last Stand, vyhodnotenie kola, štart zápasu/hry, redakcia snapshotov) + príkazy
      hráčov `chooseTeam`/`chooseCharacter`/`lockIn`/`timestopActions`/`draftQueue` a `autoLock` (herná
      časť vypršania časovača). Kód presunutý 1:1, zmeny len na hranici:
      `snapshot` berie mená/„čakám na súpera" z háčikov, medzihra série ide cez `io.schedule`,
      seed možno dať cez `io.seed` (prednosť pred env `ARENA_SEED`), `QUICKDRAW_MS` presunuté do konštánt.
- [x] `server.js` (~480 riadkov) - register roomiek, sedenie/reconnect, diváci, časovač kola, maskované emity;
      socket handlery sú tenké obaly nad príkazmi enginu.
- [x] headless: `npm run sim` (`tools/simulate.mjs`) - náhodné zápasy priamo cez engine, ~1 ms/zápas.
- Overenie: `npm test` + golden master 48/48 bit po bite zhodné; simulátor 6 050 zápasov bez chyby.

## Etapa 2 - stav

- [x] `shared/geometry.js` - čisté funkcie s explicitnou doskou: zóny specialov (fire/lightning/wanderer/
      Medúza/Escanor/Jotaro S1+S2/celá doska), melee dosah, diagonálna bounce strela, `runPath` (charge
      vlkolaka a Vampire/Onryō, Luffyho gear3 ruka, ich náhľady), Luffyho línie, `simulateQueue` (ghost
      + serverová validácia cieľov Vojaka/Luffyho) a `simulateClone`. Servíruje sa na `/shared/`.
- [x] engine volá shared (wrappery s `game.board`); smery `DIR8`/`DIAG_DIRS` a `VAMP_SHOT_RANGE` majú jediný
      zdroj (constants.js ich re-exportuje). Golden master 48/48 bez zmeny.
- [x] klient volá shared (−178 riadkov duplicít). Overené porovnaním starých (HEAD) a nových klientských
      funkcií na 400 000 náhodných vstupoch - zhodné okrem dvoch zámerných zmien (rozhodnutia 3 a 4).
- Mimo rozsahu: let striel v `doBasic` (krokovaná simulácia s klonom) a choreografia ostávajú v engine -
  nie sú duplikované na klientovi (klient len prehráva timeline).

## Rozhodnutia (na schválenie)

1. **„Explicitný ctx" v Etape 1 = inštancia enginu, nie parameter každej funkcie.** Engine je factory
   s vlastnou closure (`game`, `rand`) a všetok vonkajší kontakt ide cez háčiky `io`. Prepísať ~3 300 riadkov
   na `fn(ctx, …)` by bol veľký diff bez zmeny správania; explicitný `ctx` sa zavedie postupne pri rozdeľovaní
   `engine/game.js` na moduly (`damage.js`, `tiles.js`, … v etapách 3-5), kde ho moduly reálne potrebujú.
2. **Redakcia snapshotov (labyrint, pasca, slepý draft) je v enginu, nie v `server.js`** - sú to herné
   pravidlá (čo kto smie vedieť) a potrebujú plný herný stav; server len rozhoduje, komu čo poslať.
3. **Ghost po Luffyho speciali** (Etapa 2): server už predtým pri validácii fronty presúval Luffyho na cieľovú
   bunku specialu, klientský ghost nie - náhľady akcií PO speciali (ďalší Vojakov/Luffyho cieľ, mierenie)
   sa kreslili zo starej pozície. Zjednotené podľa servera (ghost sa po speciali presunie).
4. **Ghost Narutovho klona pri stene** (Etapa 2): server (`doMove`/`doDash`) pohne klonom aj keď Naruto
   narazí do steny (každá figúra má vlastný clamp), klientský ghost klona vtedy ostal stáť. Zjednotené
   podľa servera - ghost klona teraz ukazuje skutočnú budúcu pozíciu.
