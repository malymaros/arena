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
| 7 | Rozdelenie `client.js` na moduly `public/client/*` + zdieľaný stav | stredné | 4–6 |

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

## Etapa 5 - stav

- [x] **Háčiky postáv** `on: { deploy, hitTaken, roundStart, afterActions, roundEnd, roundEndFx }`: Escanor pride,
      vlkolak moon, Pútnikova pasívna mana. Snímky `roundStart` sa ukladajú do `roundCtx.charInfo` (THE WORLD resume)
      a dostane ich len postava, ktorá na slote ostala celé kolo (swap uprostred kola ich zahodí - ako predtým).
- [x] **Spoločný reset pri nasadení** `deployReset` (voľba postavy aj swap) + háčik `deploy`.
- [x] **Prepísania akcií** v postave: `basic` (Luffy Gear 3 - presunuté do luffy.js), `recharge` (Luffy forma),
      `dash`/`melee` (Vampire/Onryō charge a úder - celý vamp kit presunutý do vampires.js), `kit.mirrorImmune`.
- [x] Engine už nerozhoduje podľa mien postáv; ostáva len viazanie na stranu (`SIDE_CHARS`: swap, draft),
      trigger pasce (mechanika enginu, úder cez `vampMeleeLand` z postavy) a pár detailov choreografie
      (Vojakov granát, anim. názvy pasce, Fire na Damage dlaždici).
- Overenie: po každom kroku difftest 2 420 zápasov = 0 rozdielov, golden 48/48, `npm test` (aj turnaj/swap).
- [x] Rozdelenie mechaník enginu do modulov `engine/labyrinth.js` (redakcia, niť, odhalenie/koniec), `timestop.js`
      (THE WORLD), `laststand.js` (Last Stand/Hope, démon, násobiče dmg), `tiles.js` (dlaždice). Moduly sú továrne
      `xxxModule(E)`; `E` = vnútorný scope enginu (getter/setter pre `game`/`rand`/`actionSteps` + funkcie). Čisto
      organizačné: difftest 4 840 zápasov = 0 rozdielov, golden 48/48, `npm test`. game.js 2 472 → ~1 850 riadkov.

## Etapa 6 - stav

- [x] **6a - dáta postáv v klientskom registri `public/chars/<key>.js`** (+ `index.js` s popisom polí, `common.js`):
      meno a priečinky spritov, efektový sprite specialu, vlastné animácie, aliasy súborov, poloha/výrez hlavy,
      odstup na zdieľanej bunke, veľkosť portrétu, teleport swapu, náhľady vo výbere, side/vamp. Z `client.js`
      zmizlo 17 tabuliek (~200 riadkov); `index.js` z registra skladá rovnomenné tabuľky, ktoré `client.js` importuje.
      Overenie: tabuľky z registra == pôvodné literály z HEAD (hodnoty, aj poradie kľúčov tam, kde sa iterujú).
- [x] **`tools/browser-smoke.mjs`** - dymový test klienta v reálnom prehliadači (headless Chrome/Edge cez CDP):
      boti hrajú seedované zápasy (všetkých 13 postáv, aj side-postavy a turnaj so swapmi), prehliadač ich sleduje
      ako divák pri 8× zrýchlenom čase, plus hover všetkých kariet vo výbere. Padá na JS výnimkách, console.error
      a 4xx; `--compare` spustí to isté nad HEAD a porovná množinu načítaných spritov.
- [x] **6b-1 - tlačidlá a special do registra:** `buttons` (tooltip/cena/skin melee, special, dash, attack, recharge,
      mirror), `specialTarget` (typ pickera), `specialZone` (náhľad zóny). browser-smoke rozšírený o UI sondu (ako
      hráč na p1 aj p2 zvolí každú postavu a uloží akčné tlačidlá + náhľady vo výbere; HEAD výsledok sa kešuje).
      Overenie: zóny == stará `cellsForSpecialPreview` (89 856 prípadov), UI sonda 52/52, 196 rovnakých spritov.
- [x] **6b-2 - deklaratívne správanie:** `sizeLevel` (veľkosť podľa pride/moon), `projectile` (rotácia, granát),
      `actionAnims` (melee/strela/recharge póza), `planSpecialWarn`/`planClone`/`planRechargeAlwaysUseful` (⚠ v lište).
      Overenie: varovania == stará logika (33 696 prípadov), browser-smoke --compare bez rozdielu. V client.js ostáva
      76 vetiev podľa mena (zo ~155) - choreografia timeline (Escanor slnko, Jotaro stand, Luffy, Vojak, Vampire, HUD odznaky).
- [x] **6c - choreografia do registra `public/chars/fx/<key>.js`**. Továreň `(C) → háčiky`
      (`effect`, `boardAnim`, `centerCanvas`, `drawCenter` - popis v `fx/index.js`), `C` = lenivé gettery
      klientského scope v `client.js`. Hotové: **Vojak** (mierenie, laser, lúč, výšľah), **Vlkolak** (otočenie,
      `wolfrun`/`wolfstrike`), **Countess/Onryō** (one-shot A-sheety na doske aj v strede cez nový háčik
      `centerCast` a príznak `anim.fromStart`, Onryō výkrik pri teleporte pasce; hover charge číta `VAMP_CHARS`), **Naruto** (anonymizácia vertikály podľa klona),
      **Luffy - timeline** (forma, Giant Pistol ruka, special guľa/kotúľ + háčik `clearOverlays`). **Luffy - zvyšok:** háčiky `hud` (odznak módu + info) a `preview` (cyklenie base↔gear3 vo výbere), dáta `boardFit`/`victoryAnim`/`previewIdleCaster` (aj Jotaro), `fromStart`/`armCrop` v animáciách, plánovanie `planUi`/`attackPicker`/`aimStopsAtFoe`/`buttonBadge`/`specialReach` (picker `"reach"`) - v client.js ostali len vetvy podľa druhu efektu (`luffy_*`). **Jotaro - stand Star Platinum** (`fx/jotaro.js`): canvas, summon/Dead_P, výmena pozícií pri útoku, blip pri pohybe, stredový pár; nové háčiky `init`/`position`/`drawBoard`/`stateChar`/`resetActors` (volané na každom module), `moved`/`bodyShift`, `spawnCenter` a `ownCenter` (generický stred aj `casting` póza sa vynechajú); dáta `mirrorSlot`. THE WORLD (pauza, menace) ostáva v client.js - mechanika enginu. **Escanor** (`fx/escanor.js`): premena cez `roundIntro` (oneskorenie timeline) a `stateChar`, choreografia slnka, WeakIdle v `boardAnim`, pride HUD (`hud`) a náhľad (`preview`), karta (`drawCard`), stred a strela škálované s pride (`centerScale`/`centerPlace`/`projectileScale`), float `levelFloat` (aj vlkolakov mesiac); dáta `fromStart` na transform/winsun, `victoryAnim`, `headIdleFile`. Overenie: browser-smoke `--compare` 0 chýb, sonda 52/52, assety zhodné; stopa sa
      líši len v počte `charge-aura.gold` (±2 - Last Stand aura v raf je časovaná hodinami, šum). **Vlkolak - HUD a náhľad** (`hud`/`preview`, príznak `previewZone` pre moduly, ktoré zónu kreslia samé). V client.js ostali z mien len `charDirFor("soldier")` v zdieľanom `spawnExplosionAt` (výbuch volajú moduly fx) a `charDirFor("jotaro")` v THE WORLD menace (mechanika enginu). Šum stopy: počet zlatých Last Stand aur kolíše aj medzi behmi HEAD (77-84).
- [x] ~~**6b - choreografia do registra (pôvodný návrh).**~~ Nahradené etapami 6b a 6c vyššie. V `client.js` ostáva ~155 vetiev podľa mien
      (najviac escanor 33, jotaro 30, luffy 23, countess/onre 24, werewolf 14, soldier 12, medusa 10). Návrh:
      háčiky klientskej postavy (`onEffect(kind, e, ctx)` pre vlastné efekty timeline, `castOverlay`,
      `boardScale` pre pride/moon/gear3 veľkosť, `buttons` pre special/dash/mirror skin a picker) - po jednej
      postave, každý krok overený browser-smoke `--compare`.

## Etapa 7 - stav

Cieľ: `client.js` (5 900 riadkov, ~66 globálnych `let`) rozdeliť na moduly v `public/client/` s explicitnými
importmi. Bezpečnostná sieť: `npm run lint` (`no-undef` okamžite ukáže každý identifikátor, ktorý presunutý
kód potrebuje a nemá ho) + `tools/browser-smoke.mjs`. Väzbu sekcie meria „sonda": sekcia sa skopíruje do
samostatného súboru a ESLint vypíše jej nedefinované identifikátory (počet = koľko závislostí treba dodať).

- [x] **7a - samostatné moduly** (0–3 závislosti): `net.js` (socket, prihlásenie, room browser), `pix.js`
      (pixel-art ikony, pixelizované emoji), `arena-bg.js` (vrstvy pozadia), `lobby.js` (nastavenie zápasu
      hostom), `intermission.js` (obrazovka medzi hrami; `me` ide parametrom), `admin.js` (reset roomky),
      `debug-hope.js` (?hopedebug=1). client.js: 5 899 → ~5 360 riadkov.
- [x] **7b - stav prehrávania v jednom objekte** `playback.js`: `playGen`, `playing`, `serverWinner`,
      `serverGameResult`, `gameOverShown`, `finalRoundActive`, `roundBeatCounts`, `ts*` (THE WORLD) - predtým
      13 globálnych `let` naprieč súborom; teraz ich môžu čítať aj ďalšie moduly.
- [x] **7c - stav plánovania** `planning.js`: `myQueue`, `lockedIn`, `golden*Armed`, `lastStand/HopeArmed`,
      `openPicker` + `buttonUi()` (kontext planUi postavy).
- [x] **7d - jadro, od ktorého závisia takmer všetky sekcie:**
      `session.js` - `me`/`isHost`/`isSpectator`/`board`/`state` ako **ES live bindings** (`export let` +
      settery `setIdentity`/`setSpectator`/`setState`; zmenili sa len 4 priradenia, čítania ostali; ESLint
      `no-import-assign` stráži, že nikto nepriraďuje do importu). `dom.js` - 64 statických elementov +
      `TILE_W/TILE_H/GAP` + `cellToPx`. `sprites.js` - `ANIM_DEF`, `charDirFor`/`usesAltColor`,
      `ensureSpriteMeta`/`drawSprite`, `ACTOR_W/H`. `fx-registry.js` - `CHAR_FX`/`fxAll`/`fxOwnsCenter`,
      inštaluje sa `initCharFx(C)` (háčiky sa volajú až za behu, takže import pred inicializáciou je bezpečný).
- [x] **7e - sekcie, ktoré po 7d nemali lokálne závislosti:** `mage-head`, `explosion`, `trap-markers`, `zones`
      (náhľady zón), `retry`, `action-log`, `ghost`, `actor-layers` (canvasy figúr - pridávajú sa do #actors PRED
      figúrami z fx registra, poradie vrstiev ostáva; overlaye za `fxAll("init")` zostali v client.js),
      `demon-sprites`, `char-select` (výber, draft, náhľad špeciálu, stránkovanie, Hidden - 462 riadkov).
      client.js: 5 899 → 4 225 riadkov. Overenie: browser-smoke `--compare` 0 chýb, assety a UI sonda zhodné;
      stopa sa líši len v počte zlatých Last Stand aur (známy šum časovaný hodinami).
      Nástroje (scratchpad, nie v repe): sonda väzby sekcií (ESLint no-undef nad kópiou sekcie) a automatický
      extraktor (exporty = mená použité inde, importy podľa import riadkov client.js, prerušenie pri lokálnej
      závislosti) - každý krok kontroluje `npm run lint`.
- [ ] **7f - zvyšok:** Timeline prehrávanie (~70 lokálnych závislostí), RAF (~40), Sockets + losovanie farieb (~36),
      Queue + Controls, Facing/umiestnenie, Last Stand vizuál. Spoločný menovateľ: stav figúr (`animState`,
      `cloneFlinch`, `cloneDead`, `castingNow`, `facingOverride`, `escPrideDisplay`…) - ďalší krok je
      `actors.js` (objekt stavu figúr + `computeFacing`/`pairShift`/`positionActors`), potom HUD a Queue.

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
