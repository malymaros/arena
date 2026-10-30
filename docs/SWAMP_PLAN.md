# Shrek Swamp: tretia aréna

Návrh vlastníka 2026-10-30. Shrek je **neutrálne NPC v aréne, nie hrateľná postava**. Nahrádza špeciálne
dlaždice: tlačí hru ku koncu a hráči ho môžu využiť proti súperovi.

Náhľady:
- `public/dev/swamp.html` je scénka pravidiel (dev mock-up),
- `public/dev/shrek.html` je galéria všetkých animácií zo sheetu.

## 1. Pravidlá

### Fáza 1: „Vypadnite z mojej bažiny!“

- Shrek má **20 HP** (`SHREK_HP`), ktoré sa zobrazujú nad jeho hlavou. Na štarte hry stojí na náhodnom políčku
  mimo štartových políčok hráčov.
- Pred kolom ohlási **3 políčka s číslami 1 / 2 / 3** (`game.shrek.marks`). Vidia ich obaja hráči už pri
  plánovaní, rovnako ako ohlásené dlaždice. Každé políčko je iné ako to, z ktorého na neho skáče.
- Tri ohlásené políčka sú vždy **tri rôzne** a žiadne nie je to, na ktorom Shrek práve stojí.
- Po **k-tom kroku** (keď obaja odohrajú k-tu akciu) skočí na políčko k a **zareve**: zasiahne políčko dopadu
  a jeho **ortogonálnych susedov** (kríž; na okraji 4 políčka, v rohu 3). Pôvodne (do 2026-10-31) to bol celý
  riadok a stĺpec.
- Dmg revu závisí od Shrekových HP (`SHREK_ROAR_DMG` / `SHREK_RAGE_HP`):

  | Shrekove HP | Dmg revu |
  |---|---|
  | > 10 | 1 |
  | ≤ 10 | 2 |
  | ≤ 5 | 3 |

  Rev môže hráča zabiť.

### Reakcie na zásah

Útok, ktorý Shreka zasiahne, mu ubráni rovnaký dmg ako hráčovi: platí falloff, power tile aj násobiče
Last Stand a maze. Ak Shrek prežije, hneď zareaguje. Reakcia môže útočníka zabiť.

| Útok | Reakcia | Následok |
|---|---|---|
| Basic strela | Hodí sud späť na strelca. | −1 mana, pri 0 mane −1 HP |
| Melee (Shrek na zasahovanej bunke) | Punch. | −2 many, chýbajúca mana prejde do HP |
| Special / Special 1 od útočníka v inom stĺpci | PowerUp a tackle po svojom riadku smerom k útočníkovi. | Zasiahne prvú figúru v ceste (na spoločnom políčku všetky) za dmg revu. Potom sa Shrek vráti na štartové políčko. |
| Special od útočníka v tom istom stĺpci (nad, pod alebo na jeho políčku) | Okamžitý rev. | Nevie, kam by bežal, preto zareve hneď. |

### Fáza 2: smrad

- Pri 0 HP Shrek padne (animácia HurtDead). Už nič nerobí, strely ním prechádzajú a leží za figúrkami.
  Okolo hlavy mu stále krúžia hviezdičky (posledné 3 framy HurtDead v slučke).
- Z tela sa šíri **smrad**:
  - v kole smrti je smrad len na jeho políčku,
  - na konci každého ďalšieho kola pribudnú ortogonálni susedia smradových políčok,
  - nakoniec je smrad v celej aréne.
- Smrad dáva **1 dmg na konci každého kroku** (`STENCH_DMG`), ako dmg dlaždica. Hra tak určite skončí.
  Smradové políčko vyzerá ako špeciálna dlaždica v zelenej skokov s pixel ikonou zeleného hovna a pulzuje ako IK.
- Smrad pokryje celú plochu za 4 kolá, ak Shrek padne v strede, a za 6 kôl, ak padne v rohu. Miesto aj čas
  zabitia sú preto taktické rozhodnutie.

### Itemy (namiesto dlaždíc)

- **Srdiečko** dá +1 HP (Lightning sa vylieči do plna, ako pri heal dlaždici). **Kvapka** doplní manu na plno.
  Itemy vyzerajú ako pixel ikony dlaždíc bez krúžku (variant C4, polovičná veľkosť) a vznášajú sa nad tieňom.
- V lobby bažiny: *Items per round* 1 / 2 / 3 (`config.itemsPerRound`, default 1) a šanca srdiečko / mana
  (`config.itemWeights`, default 60 / 40, spolu 100).
- Itemy padnú na štarte hry a na konci každého kola na voľné políčko (bez itemu, hráča, klona a živého Shreka).
  Na ploche je naraz najviac 4 (`ITEM_MAX`).
- Hráč item zoberie hneď pri vstupe na políčko alebo prebehnutí cezeň: pohyb, dash, charge, Luffyho kotúľ.
  Zber číta prejdené bunky akcie (`actionSteps`) pred vyhodnotením pasce. Pri plnom HP alebo mane sa item aj tak
  spotrebuje.
- Narutov klon itemy neberie. Prekliaty v labyrinte vidí item len na fakľovej bunke, ako heal/mana dlaždice.
  Počas THE WORLD sa itemy nezbierajú (čas stojí).

### Hudba

`music.battle.swamp` hrá *All Star* počas hry v bažine. Nahrávka je tichá (−17,9 LUFS, vrchol −7 dBFS), preto má
`vol` 1,0: vychádza na −17,9 LUFS rovnako ako `music.battle` (−9,9 LUFS × 0,40). Vo FINAL ROUND hrá finálna hudba ako v iných arénach.
Súbor `public/sounds/custom/music/shrek-all-star.mp3` je orezaný úsek 40,4–107,6 s originálu (rez po MP3 rámcoch,
prepočítaná Xing hlavička). Slučka `trim [514, 66737]` má 28 taktov pri 103,5 BPM a prechod 1,5 s na takt.

## 2. Rozhodnutia k okrajovým prípadom (zvolené pri implementácii, vlastník ich môže zmeniť)

| Situácia | Rozhodnutie |
|---|---|
| Štít / mirror proti Shrekovi (rev, tackle, sud, punch, smrad) | Neblokujú. Shrekove útoky sú prostredie ako dlaždice. |
| Last Stand / Last Hope | Prijatý dmg sa delí na ½ (`recvDmg`), ako pri dlaždiciach. |
| Skamenený hráč | Rev, tackle ani smrad ho nezasiahnu (socha sa ráta, akoby na políčku nikto nestál, ako pri dlaždiciach). |
| Narutov klon v dosahu revu, tacklu alebo smradu | Dostane len kozmetický `clone_hit` a nezomrie. Nesmie prezradiť, ktorá figúra je pravá. |
| Narutov klon zasiahne Shreka | Sud alebo punch letí na klon a klon sa rozplynie. Majiteľ nič neplatí. |
| Strela a Shrek s hráčom na jednom políčku | Strela zasiahne hráča. Shrek je zasiahnutý, len keď stojí na políčku sám. |
| Charge (vlkolak, Vampire/Onryō), pasca, démon, breaker | Shreka ignorujú: bežia cez neho a nereaguje. |
| Statusy (petrify, labyrint) | Na Shreka nepôsobia. |
| THE WORLD (zamrazený čas) | Shrek je inertný. Strely ním prejdú bez reakcie. |
| Labyrint | Shrek je verejný (vidí ho aj prekliaty). Reakcie a zásahy, ktoré by prekliatemu prezradili bunku skrytého lovca (`shrek_hit`/`shrek_barrel`/`shrek_mana` s `from`/`target` = lovec, `shrek_tackle`/`shrek_return` k lovcovi), sa redigujú. Shrekove HP v snapshote ostávajú verejné. |
| Escanor pride | Shrekov zásah sa neráta ako zásah od súpera. |
| Dlaždice | V bažine nie sú (lobby váhy sa ignorujú, server ich vynuluje). |

## 3. Implementácia

### Engine

- `engine/swamp.js` (`swampModule(E)`) obsahuje stav `game.shrek = { x, y, hp, dead, marks, done, stench }`.
  Funkcie:
  - `swampStartGame` (nová hra),
  - `shrekStepEnd` (koniec kroku v `runRoundLoop`: skok a rev, alebo smrad),
  - `shrekRoundEnd` (koniec kola vo `finishRound`: nové skoky alebo šírenie smradu, efekt `stench_spread`
    vo finálnom frame),
  - `shrekShot` (`doBasic`),
  - `shrekMelee` (`doMelee` + Vampire/Onryō melee),
  - `shrekZone` (`ctx`, volajú ho dmg speciály: `zone.js`, `escanor`, `soldier`, `jotaro` `zoneStrike`,
    `luffy` ruka a guľa).
- Config: `config.arena = "swamp"` → `game.arena = "shrek-swamp"`. Kľúč `shrek` je v snapshote len v bažine,
  takže bridge a portal goldeny sú bit po bite rovnaké.
- Efekty timeline: `shrek_jump`, `shrek_roar`, `shrek_hit`, `shrek_die`, `shrek_barrel`, `shrek_punch`,
  `shrek_mana`, `shrek_powerup`, `shrek_tackle`, `shrek_return`, `stench_proc`, `stench_spread`. Zásahy hráčov
  idú cez bežný `hit` so značkou `shrek: true`.
- Čísla sú v `shared/balance.js` (`SHREK_*`, `STENCH_DMG`), časovanie v `shared/timing.js` (`SHREK_*_MS`,
  `STENCH_PROC_MS`).

### Klient

- `public/client/shrek.js` kreslí Shreka do canvasu medzi figúrami (mŕtvy leží za nimi), číslo HP nad hlavou,
  čísla skokov a smrad v bunkách (`renderShrek` z `renderGrid`) a prehráva efekty (`shrekEffect` z `timeline.js`).
  Hráč sám so Shrekom na políčku odstúpi nabok (`pairShift` v `placement.js`).
- Lobby: karta SHREK SWAMP. Sekcie dlaždíc sú skryté a nahrádza ich popis Shreka (`public/client/lobby.js`).
- Pozadie je maľba v plnom rozlíšení (`public/arenas/shrek-swamp/shrek-swamp-hd.webp`, HD_ARENAS v
  `arena-bg.js`) so živými fakľami a svätojánskymi muškami. Originál je v `tools/arena-bg/src/shrek-swamp/`,
  prevod robí `node tools/arena-bg/hd-webp.mjs <src.png> <dst.webp>`.

### Sprity

- Zdrojom je `tools/sprites-shrek/SHREK.png`: rip *Shrek Reekin' Havoc* a *Shrek: Hassle at the Castle*
  od A.J. Nitra, ktorý pri použití žiada uviesť ho ako autora.
- Postup:
  1. `node tools/sprites-shrek/detect.cjs` → `cells.json`,
  2. `node tools/sprites-shrek/pack.cjs` → `public/assets/shrek/*.png` + `anims.json`.
- Hra používa pásy `Idle`, `Walk`, `JumpKick`, `Roar`, `PickUp`, `Punch`, `PowerUp`, `Tackle` a `HurtDead`.

## 4. Testy

- `test/swamp.mjs` (súčasť `npm test`) obsahuje 51 kontrol:
  - config a štart,
  - skoky a rev vrátane prahov HP,
  - reakcie (sud, punch s prelievaním, tackle, okamžitý rev, Narutov klon),
  - smrť a smrad,
  - redakcia v labyrinte.
- `node tools/simulate.mjs 20 --swamp` spustí náhodné zápasy a po každom kole skontroluje invarianty Shreka.
- `node tools/browser-smoke.mjs --swamp` je dymový test klienta.
- `test/telemetry.mjs` obsahuje aj 3 zápasy v bažine (replay).
