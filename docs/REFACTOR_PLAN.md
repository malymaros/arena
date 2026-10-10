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

## Etapa 3 - stav

- [x] **Damage pipeline** `resolveStrike(defSlot, figs, tl, opts)` v `engine/game.js` nahradil 5 variantov
      (`applyHit`, `applyStackedHit`, `applyHitPairDefended`, `applyHitBoth`, `applyHitOnClone`):
      intercept (THE WORLD) → obrana → soak → dopad → udalosti (pride, koniec labyrintu) na jednom mieste.
- [x] **Klon = figúra v zásahu**: zásah je zoznam zasiahnutých figúr `[{ fig: "owner" | "clone", raw }]`.
      Akcie vstupujú podľa tvaru: `strikeCell` (bunka: player/clone/stacked - nahradil 6 skopírovaných
      dispatchov), `strikeZone` (zóna/démon - 7 miest), `strikeOwnerMulti` (stacknutý útočník).
- [ ] Statusy (petrify/labyrint) ostávajú v `applyPetrify`/`applyLabyrinth`/`applyStatusOnClone` -
      zjednotiť s pipeline v etape 5 (háčiky), keď sa labyrint presunie do vlastného modulu.
- [ ] Plný model figúr na hráčovi (`player.figures`) aj pre pohyb a strely - etapa 4 (register postáv).
- Overenie: golden 48/48 bez zmeny; rozdielový test HEAD vs nový engine na 15 300 headless zápasoch
  (ťažisko Naruto) - jediný rozdiel je zámerná oprava z rozhodnutia 5 (8 zápasov Naruto vs Naruto).

## Etapa 4 - stav

- [x] **Register postáv `engine/characters/`** - special každej postavy (`resolve` / `validate` / `random`)
      je v jej súbore; `doSpecial` je len mana gate + dispatch (z ~280 riadkov vetiev). Zónové speciály
      (fire/lightning/wanderer) zdieľajú `zone.js`, Vampire/Onryō `vampires.js`.
- [x] **Explicitný `ctx`** (rozhodnutie 1): postavy pristupujú k enginu len cez `ctx` z `createEngine`.
- [x] **Kit postavy**: `attack` (ortho/diag/luffy), `mirrorSlot` (mirror/special1), `meleeDmg`, `healTile` -
      `validQueue`, `validBasicAction`, `fillFromDraft`, `doMelee` a heal dlaždica čítajú kit namiesto mien.
- [x] `tools/difftest.mjs` - trvalý rozdielový test (engine z gitu vs pracovný strom, headless, autoLock).
- Overenie: po každom kroku difftest 2 420 zápasov = 0 rozdielov, golden 48/48, engine scenáre.
- Zostáva v engine (etapa 5 - háčiky): Escanor pride, vlkolak moon, Luffyho forma (recharge), vamp kit
  (charge, trigger pasce, mirror imunita), Jotarov THE WORLD; klientská choreografia (etapa 6).

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
5. **Soak mŕtveho klona (APLIKOVANÉ, Etapa 3)**: druhá strela stacknutého útočníka do stacknutého páru
   v tom istom kroku strhla `CLONE_DMG`, aj keď klon zomrel už prvou strelou (basic); melee to malo
   správne (`if (op.clone)`). Zjednotené - `strikeCell` soakuje len živým klonom. Dopad: Naruto vs Naruto,
   oba páry stacknuté, horizontálna strela - obranca dostane o 1 dmg viac (rozdielový test: 8 z 15 300).
6. **Pride len pri reálnej strate HP (APLIKOVANÉ)**: `applyHit`/`applyStackedHit` značili Escanorovi
   „dostal zásah" aj pri 0 dmg (Last Stand ½ z 1), zóny nie. Zjednotené na `d > 0` (pravidlo hovorí
   o strate HP). Golden bez zmeny.
7. **Odraz páru za 0 (APLIKOVANÉ, kozmetické)**: mirror stacknutého páru pri celkovom odraze 0 posielal
   `parts: [0, 0]`, zóna jeden hit bez parts. Zjednotené (parts len pri súčte > 0).

**Nekonzistencie nájdené pri zjednotení:**

8. **Melee do klona-návnady - plný dmg (SCHVÁLENÉ, APLIKOVANÉ)**: majiteľov sek na návnadu nemal maze 2×
   (`labyrinthMul`) a sek útočníkovho KLONA do návnady počítal `CLONE_DMG × dealMul` namiesto plného
   `MELEE_DMG`. Teraz `meleeRaw` / `cloneMeleeRaw` ako pri zásahu hráča (prejaví sa na sile odrazu).
9. **Nekrytý stacknutý pár - 1 beat všade (SCHVÁLENÉ, APLIKOVANÉ)**: zásah bunky (strela/sek/charge/pasca/
   Luffy) hral najprv poof klona a potom zásah majiteľa (2 framy); teraz ako zóna v jednom beate
   (`strikeCell` "stacked" → `resolveStrike` so `soak`). Vedľajší efekt: zásah za presne `CLONE_DMG`
   (majiteľ 0) teraz ukončí labyrint - zásah páru ho už predtým odhalil, takže to zodpovedá pravidlu.
10. **Krytý stacknutý pár - jedna reakcia všade (SCHVÁLENÉ, APLIKOVANÉ)**: zóna/démon na stacknutý pár
    s obranou dávali dva bloky/lúče na tej istej bunke; teraz `pair` mód ako pri strele (jeden blok,
    jeden lúč, odraz oboch figúr ako jeden hit s parts).
    Overenie 8-10: `test/engine-scenarios.mjs` (nové, súčasť `npm test`) - na starom engine 4 FAIL, na novom
    všetko PASS; golden 48/48 bez zmeny (tieto situácie v jeho zápasoch nenastali).
11. **Odraz klonovej akcie sa vracia strelcovi (SCHVÁLENÉ, APLIKOVANÉ)**: pravidlo od zadávateľa - *klon,
    ktorý dostane akýkoľvek dmg, sa rozplynie; klon útočí aj vracia odraz zrkadlom ako normálny hráč.*
    Keď akciu vykonal útočníkov klon a obranca ju odrazí (zrkadlo na hráčovi, na návnade aj na stacknutom
    páre), KAŽDÝ odraz dopadne na strelca = útočníkovho klona, ten sa rozplynie, HP skutočného útočníka sa
    nemení; lúč mieri na klonovu bunku (neprezradí, ktorý Naruto je pravý). Predtým odraz z návnady
    a jedna časť odrazu z páru išli do HP skutočného útočníka. Overenie: R11 v `test/engine-scenarios.mjs`
    (na starom engine 5 FAIL).
12. **Dmg dlaždica a klon (ROZHODNUTÉ - bez zmeny)**: pravidlo z bodu 11 platí pre zásahy AKCIAMI. Damage
    dlaždica klona zámerne nezabíja (len kozmetický `clone_hit` −1 float), aby Narutov klon nebol príliš slabý;
    IK dlaždica ho zabíja.
13. **Vypršaný čas = PASS namiesto náhodných akcií (ROZHODNUTÉ, APLIKOVANÉ)**: pôvodne náhodné doplnenie vedelo
    zahrať akcie, ktoré hráč ručne zahrať nemôže (Luffy Gear 3 basic hore/dole). Rozhodnutie zadávateľa: zjednodušiť -
    rozpracované akcie ostanú, každý NEVYPLNENÝ slot je `pass` („THINKING" nad postavou), stojí 2 many za každý pass
    (najviac toľko, koľko hráč má) a je to bežná akcia - SPOTREBUJE súperovu nachystanú obranu. Zmizli tým náhodné
    generátory na klientovi (~40 riadkov s vetvami podľa postáv), v `fillFromDraft` aj `special.random` v postavách.
    Headless nástroje (`npm run sim`, `tools/difftest.mjs`) hrajú cez `tools/random-bot.mjs` (náhodné fronty cez
    `lockIn`, platnosť rozhoduje engine). Overenie: bežná hra botov HEAD vs nový engine 2 420 zápasov = 0 rozdielov;
    PASS scenáre v `test/engine-scenarios.mjs`. Golden bez zmeny (nepoužíva časovač).
