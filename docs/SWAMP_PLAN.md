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
| Basic strela | Okamžitý rev. | Kríž okolo Shreka za dmg revu; strelca zasiahne, len ak stojí vedľa (do 2026-10-31 sud: −1 mana) |
| Melee (Shrek na zasahovanej bunke) | Okamžitý rev. | Útočník stojí na Shrekovom políčku, takže ho rev zasiahne (do 2026-10-31 punch: −2 many) |
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

### Zvuky Shreka

- **Skok 1/2/3:** cieľové políčko krátko blikne ako vyhodnocovaná špeciálna dlaždica (`shrek_call`, `SHREK_CALL_MS`
  600 ms), potom skok a rev so zvukom `shrek.roar` (`custom/shrek/shrek-roar.mp3`).
- **Zásah hráčom:** `shrek.hit` (`custom/shrek/shrek-hit.mp3`, 3,3 s) dohrá celý, Shrek pritom kričí (H_Roar v slučke)
  a jeho políčko bliká (`shrek_hit` + `shrek_scream`, spolu `SHREK_HIT_SOUND_MS`; po výmene nahrávky treba zmeniť).
  Až potom príde rev alebo nafúknutie pred tacklom (`shrek_powerup`), oboje so zvukom `shrek.roar`.
- Hlasitosť oboch zvukov je −18 LUFS (`node tools/voice-loudness.mjs`).

### Hudba

`music.battle.swamp` hrá skladbu `shrek-swamp-audio` (`custom/music/shrek-swamp.mp3`) počas hry v bažine. Vo FINAL ROUND
hrá finálna hudba ako v iných arénach. Slučku pripravuje `node tools/music-loop.mjs <vstup.mp3> <výstup.mp3> [--bars 16-40]`:
nájde úsek o celý počet taktov s rovnakou hudbou na prechode, vyreže ho po MP3 rámcoch (prepočítaná Xing hlavička) a
vypíše `trim` a `vol` pre manifest. Aktuálne: úsek 48,8–88,2 s, slučka 16 taktov (≈ 38 s, 103,5 BPM, podobnosť na prechode
0,83; dlhšie úseky sa v tejto verzii na prechode líšia), nahrávka −7,3 LUFS → `vol` 0,3 = −17,9 LUFS ako `music.battle`.

## 2. Rozhodnutia k okrajovým prípadom (zvolené pri implementácii, vlastník ich môže zmeniť)

| Situácia | Rozhodnutie |
|---|---|
| Štít / mirror proti Shrekovi (rev, tackle, smrad) | Neblokujú. Shrekove útoky sú prostredie ako dlaždice. |
| Last Stand / Last Hope | Prijatý dmg sa delí na ½ (`recvDmg`), ako pri dlaždiciach. |
| Skamenený hráč | Rev, tackle ani smrad ho nezasiahnu (socha sa ráta, akoby na políčku nikto nestál, ako pri dlaždiciach). |
| Narutov klon v dosahu revu, tacklu alebo smradu | Dostane len kozmetický `clone_hit` a nezomrie. Nesmie prezradiť, ktorá figúra je pravá. |
| Narutov klon zasiahne Shreka | Okamžitý rev ako pri hráčovi; klon v reve dostane len kozmetický zásah a ostane. |
| Strela a Shrek s hráčom na jednom políčku | Strela zasiahne hráča. Shrek je zasiahnutý, len keď stojí na políčku sám. |
| Charge (vlkolak, Vampire/Onryō), pasca, démon, breaker | Shreka ignorujú: bežia cez neho a nereaguje. |
| Statusy (petrify, labyrint) | Na Shreka nepôsobia. |
| THE WORLD (zamrazený čas) | Shrek je inertný. Strely ním prejdú bez reakcie. |
| Labyrint | Shrek je verejný (vidí ho aj prekliaty). Reakcie a zásahy, ktoré by prekliatemu prezradili bunku skrytého lovca (`shrek_hit` s `from` = lovec, zásahy lovca, `shrek_tackle`/`shrek_return` k lovcovi), sa redigujú. Shrekove HP v snapshote ostávajú verejné. |
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
- Efekty timeline: `shrek_jump`, `shrek_roar`, `shrek_hit`, `shrek_die`, `shrek_powerup`, `shrek_tackle`, `shrek_return`, `stench_proc`, `stench_spread`. Zásahy hráčov
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
- Hra používa pásy `Idle`, `Walk`, `JumpKick`, `Roar`, `PowerUp`, `Tackle` a `HurtDead`. Farby sú pôvodné zo sheetu
  (tmavší skin sa skúšal 2026-10-31 a vlastník ho zamietol).

## 4. Testy

- `test/swamp.mjs` (súčasť `npm test`) obsahuje 51 kontrol:
  - config a štart,
  - skoky a rev vrátane prahov HP,
  - reakcie (strela a melee → okamžitý rev, tackle, Narutov klon),
  - smrť a smrad,
  - redakcia v labyrinte.
- `node tools/simulate.mjs 20 --swamp` spustí náhodné zápasy a po každom kole skontroluje invarianty Shreka.
- `node tools/browser-smoke.mjs --swamp` je dymový test klienta.
- `test/telemetry.mjs` obsahuje aj 3 zápasy v bažine (replay).
