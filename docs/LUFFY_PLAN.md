# Luffy — implementačný plán

> **Stav: SCHVÁLENÉ, implementuje sa (WIP).** WIP páska ostáva na karte, kým nebude výsledok OK.
> Pred prácou si prečítaj `CLAUDE.md` a `docs/ADDING_CHARACTERS.md`.

## Stav implementácie (checklist)
- [x] **Fáza 1 — foundation:** `luffy` v `SIDE_CHARS` (P1), `form` stav (`newPlayer`/`cloneActor`),
  recharge prepína mód (aj pri plnej mane), reset formy pri voľbe postavy, karta voliteľná (WIP páska
  ostáva), ABILITY_PREVIEW. Normálny melee/dash/shield/mirror.
- [x] **Fázy 1b — opravy (feedback):**
  - Veľkosť **normalizovaná** ako Jotaro (`LUFFY_BOARD_FILL 0.58`, `LUFFY_FRAME_REF_H 128`) — Luffy už nie je „obrovský".
  - Luffy **nie je väčší v gear3** (žiadny size tell — `escPrideMul` luffy vetva odstránená).
  - Recharge tlačidlo má **fialový ❔ glitch skin** ako vamp charge / jotaro s1 (`syncRechargeBtn`, `.luffy-switch` CSS).
  - Basic: **base = diagonálny** (`vampShotRoute`), **gear3 = ortogonálny** priamy strel — server `doBasic`
    (route podľa formy), `validQueue` (simulácia formy cez frontu vrátane recharge), auto-fill, klient
    picker (`luffyEffForm`) + `cellsForAimPreview` (podľa smeru: diag→bounce, ortogonálny→priamy).
  - *(gear3 basic zatiaľ len priamy strel — **pull súpera** = Fáza 2; special = WIP invalid = Fáza 3)*
- [x] **Fáza 2 — Gear 3 basic (pull):** `doLuffyGear3Basic` — naťahovacia ruka ortogonálne po prvú figúru,
  dmg falloff 3/2/1, **priťiahne súpera** na `pos+dir`; **shield/mirror blokuje dmg AJ pull**; klon-návnada
  pohltí úder (bez pull); labyrint reveal. FX: `spawnLuffyArm` (guma + `L_GiantPunch` giant / `L_Fist` grip),
  efekty `luffy_gp` (windup/reach/retract) + `luffy_pull` (súper sa prisunie cez snapshot). Mode-switch
  anim na recharge (`luffypump`/`luffydeflate`). Sprity `L_GiantPunch`/`L_Fist` skopírované do `assets/luffy/`.
  Ukotvenie Luffyho znížené (`LUFFY_BOARD_OFF_Y 4`).
  *(TODO polish: trim posl. 2 framov Recharge2/Special_3; arm presne na živú pozíciu súpera; pull edge-cases §5)*
- [x] **Fáza 3 — speciály:** `doLuffySpecial` — base = **dáma** (4dmg, `Special_7` roll), gear3 = **veža**
  (8dmg, balón `Recharge` + `Special_2` impact `spawnLuffyImpact`); pohyb-a-úder na cieľovú bunku (aj vlastnú),
  dmg tomu kto na nej stojí (súper/klon), cez obrany. Cell picker (`buildCellPicker` luffy režim = bunky len
  na platnej línii), `validQueue` (line + form sim), auto-fill (server `randomLuffySpecialTarget` + klient).
  Effekt `luffy_roll`, button label/cost podľa formy. Mode badge = extrahované z `badges.png` (strawhat=base,
  päsť=gear3, kruh cez `border-radius`).
- [ ] **Fáza 4 — prepínacie animácie + veľkostný tween:** base→gear3 `Recharge2` (f0–4), gear3→base
  `Special_3`; `escPrideDisplay` hold.
- [ ] **Fáza 5 — polish + matica okrajových prípadov** (labyrint/pull leak, IK/dmg tile, Naruto klon decoy…).

---

## 1. Identita a zaradenie

**Luffy** = side-bound **P1** skrytá postava — **náprotivok Jotara** (ktorý je side-bound P1... nie,
P2). Luffy je **P1**, Jotaro **P2**; obaja žijú na Hidden stránke char-selectu (rune easter egg),
mimo `CHARS` poolu. V turnaji draftovateľný **len P1 hráčom**.

Herná identita: **postava s dvomi formami, ktoré menia jeho DOSAH.** Luffy sa prepína medzi
**blízkou formou** (silný na blízko, slabý/krátky na diaľku) a **Gear 3 formou** (obrie natiahnuté
končatiny → dobrý dosah, ale **nižší dmg** a je z neho veľký terč). To verne kopíruje anime:
Gear 3 = nafúknuté obrie končatiny = „stretch" dosah, základná/rýchla forma = blízky Gatling.
„Nižší dmg podľa formy" je práve **cena za dosah**. Rodinou mechaník = **prepínateľný stance**
(nový sebe-stav + veľkostný tell, žiadny summon/redakcia) → náročnosť **stredná**.

**Východiskový stav v projekte (už existuje):**
- Assety hotové: `public/assets/luffy/` (18 sheetov — mapovanie nižšie).
- Preview karta na Hidden stránke: `index.html:331-334` (`data-char="luffy"`, len P1),
  `PREVIEW_CAST.luffy` (`client.js:4398`, používa `Special_1.png`),
  `ABILITY_PREVIEW.luffy` (`client.js:4579`, `secret:true`).
- `CHAR_META.luffy = { name:"Luffy", dir:"luffy" }` (`client.js:560`) — **len P1**, žiadny `dirP2`
  ani `alt-color` (P1 nikdy nepotrebuje albino paletu).
- `PORTRAIT_SCALE.luffy = 0.59` (`client.js:529`).

---

## 2. Mapovanie assetov (18 sheetov → herné role)

| Sheet | Frames | Čo je na ňom | Rola |
|---|---|---|---|
| `Idle` | 4 | normálny Luffy | idle |
| `Run` | 8 | beh | move/dash |
| `Hurt` / `Dead` / `Win` | 4/4/4 | štandard | hurt/death/win |
| `Recharge` / `Recharge2` | 9/7 | dobíjanie | recharge (vlastná póza) |
| `Attack_1` | 4 | natiahnutý úder (Pistol) | **basic attack** |
| `Charge` | 1 | letiaca päsť | **projektil** basicu |
| `Attack_2` | 9 | Gatling — dávka pästí | **melee** |
| `Special_1` | 9 | **nafúkne sa do balónového tela** | GEAR THIRD — cast/transform |
| `Special_3` | 12 | windup s dvomi obrími päsťami | GEAR THIRD — veľký stredový sprite |
| `Special_4` | 14 | **Gigant Pistol** — obria päsť letí ďaleko | GEAR THIRD — úder |
| `Special_5` | 4 | balónová obria päsť | GEAR THIRD — alt/deflate |
| `Special_2` | 3 | radiálny výbuch pästí | **spare** (budúci Gear alebo alt melee) |
| `Special_6` | 12 | špirálový Rifle úder | **spare** |
| `Special_7` | 12 | rozbeh → kotúľ → nafúknutie | **spare** (dash-attack?) |

**Prečo len 2 „telové" režimy (Base + Gear 3):** máme sprity pre normálneho Luffyho a pre
**nafúknuté** (Gear 3) telo. Gear 2 (červená para), Gear 4 (Boundman) a Gear 5 (toon) **nemáme** —
vyžadovali by nové sprity. Preto prvý návrh stavia len na Base ↔ Gear 3.

---

## 3. Kit (dohodnutý dizajn 2026-07-23) — dva módy, prepínanie cez mana tlačidlo

Luffy je side-bound P1, ale **NIE vamp**. Per-mág stav **`form`** = `"base"` alebo `"gear3"`
(default `"base"`; v `newPlayer()` aj `cloneActor()`; reset na `"base"` pri voľbe postavy a na
**štarte každej hry**; prežíva medzi **kolami** v rámci hry, NIE medzi hrami série). Zdieľané konštanty: `MAX_HP`/mana 10, `MELEE_DMG` 8, diagonálny strel
`VAMP_SHOT_RANGE` 3 (dmg 3/2/1).

### 3.1 Prepínanie módov = MANA tlačidlo (Luffyho „glitch" akcia)
Ako každá hidden postava má jednu akciu prerobenú na fialový „❔" glitch button (Jotaro → mirror,
Vampire/Onryō → dash), **Luffy má prerobené `recharge`**: doplní manu **úplne normálne** a **zároveň
ho prepne do opačného módu** (`base` ↔ `gear3`). Prepnutie nastáva **vždy pri použití recharge**, aj
**v rámci kola** (recharge je 1× za kolo → max 1 flip za kolo, v momente keď sa recharge vyhodnotí).
**Aj keď je mana plná** (a dobitie samo nič neurobí), recharge **stále prepne mód** — prepnutie je
jeho efekt, takže sa **nikdy nepreškrtne** ako „nevykonaná" akcia (výnimka z bežného pravidla).
Vizuál: nafúknutie/splasknutie (viď §4.3).

**Dôsledok na plánovanie (dôležité):** basic útok sa správa inak podľa módu, takže ak hráč naplánuje
`recharge → basic`, basic sa musí zobraziť a vyhodnotiť **v móde PO prepnutí**. Rieši sa to rovnako
ako existujúci ghost/aim náhľad — planner (klient) aj server `validQueue` **simulujú `form` cez frontu**
krok po kroku: basic pred recharge = pôvodný mód, basic po recharge = prepnutý. Picker/aim UI basicu
sa teda prepína podľa **simulovaného módu v tom slote** (base → diagonálny picker; gear3 → ortogonálny
smer). Timeout auto-fill to musí rešpektovať tiež.

### 3.2 Basic a melee podľa módu

| Akcia | BASE mód | GEAR 3 mód |
|---|---|---|
| **basic attack** | **diagonálny odrazový strel** (`vampShotRoute` — 4 diag smery, jeden odraz od steny, range 3, dmg **3/2/1**), projektil = **malá** letiaca päsť | **Giant Pistol — naťahovací úder, BEZ projektilu** (viď §3.3): ortogonálny smer (hor/vert ako bežné postavy), ruka sa natiahne po **prvého súpera v línii**; pri **zásahu priťiahne SÚPERA**; **žiadny bonusový dmg** (rovnaký ako base) |
| **melee** | `Attack_2`, **8 dmg**, vlastná bunka | **rovnaké** — `Attack_2`, 8 dmg |
| move / dash / shield / mirror | normálne | normálne |
| recharge | = prepnutie módu (§3.1) | = prepnutie módu |

### 3.3 Gear 3 basic = Giant Pistol s priťiahnutím SÚPERA (zmena logiky 2026-07-23)
V Gear 3 **nehádže projektil**. Nafúkne päste a vystrelí **naťahovaciu ruku** v jednom zo **4 ortogonálnych
smerov** (hor/vert — ako bežné postavy, NIE diagonálne). Ruka letí po **prvého súpera v línii**
(prípadne po okraj dosky = minutie). Pri **zásahu Luffy STOJÍ a priťiahne SÚPERA k sebe (pull) — hra túto mechaniku zatiaľ nemá**: päsť súpera chytí a prisunie ho na **bunku hneď vedľa Luffyho** (`pos + dir`). Je to **nútený
pohyb súpera** (pull) — nová mechanika (existujúci charge hýbe len casterom). **Obrany (ZMENA 2026-07-23):**
ak má súper **shield alebo mirror**, obrana **zablokuje aj priťiahnutie** — shield zablokuje dmg **a** pull
sa nevykoná; mirror odrazí dmg späť na Luffyho **a** pull sa nevykoná. Súper sa **priťiahne LEN keď zásah
naozaj dopadne** (nebránený). (Predtým bol pull nebrániteľný — zrušené.)
Choreografia: **`Recharge2` (nafúknutie pästí, malá figúra) → tenká naťahovacia guma + skutočná päsť
(`L_Fist`) na konci → priťiahnutie súpera**; `Special_4`/GiantPistol sa dá použiť ako **veľký cast
sprite v strede** (ako Escanorov `WinSun`), NIE ako figúrka na doske (tam je malá v rohu framu →
„zmenšovala by sa"). Ukážka: `luffy-anim.html` DEMO tlačidlo. **Otvorené interakcie pull:** cez
labyrint (leak pozície?), spúšťa vamp pascu?, súper = Naruto klon (chytí sa decoy a zomrie?), pull
na IK/dmg tile.

> **Rozhodnutie (D-basic):** Luffy **zdieľa diagonálny odrazový strel** ostatných hidden postáv
> (`vampShotRoute`) — takže žiadny `DIAG_CHARS` refaktor netreba, len iný projektil (malá päsť).
> Diagonálny basic ostáva naviazaný na `SIDE_CHARS`. *(Zmena oproti staršiemu návrhu.)*

---

## 4. Special — pohyb-a-úder podľa módu (chess piece)

Special = **repositioning úder**: Luffy si na mini-mape (Soldier-style picker `buildCellPicker`)
vyberie **jedno cieľové políčko** (vrátane **vlastného**), presunie sa naň a dá dmg tomu, kto na ňom
stojí. Rozsah pohybu závisí od módu:

| | BASE mód | GEAR 3 mód |
|---|---|---|
| **pohyb (výber políčka)** | ako **dáma** v šachu (horizontála + vertikála + diagonála, cez celú dosku) | ako **veža** v šachu (len horizontála + vertikála) |
| **dmg na cieľovej bunke** | **4** | **8** |
| **cast / choreografia** | `Special_7` (rozbeh + kotúľ + nafúknutá hlava „bounce") | nafúkne sa do balónu (`Recharge` = celotelový balón) → dogúľa sa → **`Special_2`** impact na cieľovej bunke |
| **cena** | `SPECIAL_COST` 5 | 5 |

### 4.1 Detaily
- **Vlastné políčko je platný cieľ** — vtedy Luffy ostane stáť; dmg dostane súper stacknutý na jeho
  bunke (napr. Naruto klon / spoločné políčko). Ak tam nikto nie je → čistý „no-op" úder (pozri anim.).
- **Zásah vs minutie (`Special_7`, base):** ak úder **zasiahne** súpera, animácia sa **zastaví na
  frame, kde je Luffy zahryznutý** (mid-nafúknutie); ak skončí na **prázdnom** políčku (nikto tam),
  **dohrá aj zvyšné 2 framy** (dokončí kotúľ). → potreba `dataset.once`/`loopFrom`-style riadenia
  konca animácie podľa výsledku (ako Escanor `WinSun`).
- **Cez obrany** ako každý dmg special: shield blokne, mirror odrazí celý dmg (4/8) späť.
- **Pohyb** znamená, že special **mení pozíciu castera** → treba ho modelovať v klientskom ghoste
  (`simulatedPositions`) aj v serverovom `validQueue` (ako werewolf charge / vamp charge).
- **Picker validácia:** cieľ musí ležať na povolenej línii (veža/dáma) od Luffyho *ghost* pozície
  v danom bode fronty; server re-validuje vo `validQueue`, `randomLuffyTarget()` pre timeout auto-fill.

### 4.2 Zóna vs klon/obrany (paralelne udržiavané)
- Special zasiahne **len cieľovú bunku** (nie preletené) → jednoduchšie než zóna. Test klona = „stojí
  klon na cieľovej bunke?" (obdoba Soldierovho `cell`-neseného zásahu, nie `specialZoneHas`).
- Náhľad políčok (dáma/veža línie od aktuálnej pozície) sa kreslí v pickeri + hover, ako Soldier.

### 4.3 Veľkosť / vizuál módu (reuse Escanor mašinérie)
- V Gear 3 je Luffy **väčší** na boarde (verejný tell) cez existujúci `escPrideMul`/`escPrideDisplay`
  (`client.js:3017`) — pridá sa `luffy` vetva čítajúca `state[slot].form`. Prepnutie cez mana tlačidlo
  = plynulý prechod veľkosti (nafúknutie/splasknutie), nie skok.
- Base basic projektil = **malá** päsť (`Charge.png`). Gear 3 basic **nemá projektil** — je to
  naťahovacia ruka (`L_GiantPunch` → `L_Fist`), viď animačná mapa §4.5.

---

## 4.5 Animačná mapa — kompletný rozpis (2026-07-23)

Cieľ: priradiť KAŽDÝ stav/akciu ku konkrétnemu sheetu, aby sa neprerábalo. Overené na `luffy-anim.html`.

### A. Sheety a ich reálne rozmery (frame = výška)
| Sheet | Rozmer | Frames | Použitie |
|---|---|---|---|
| `Idle.png` | 512×128 | 4 | idle (oba módy, gear3 = zväčšený) |
| `Run.png` | 896×112 | 8 | move / dash (oba módy) |
| `Attack_1.png` | 576×144 | 4 | **base basic** — cast (diag. strel) |
| `Charge.png` | 112×112 | 1 | **base basic** projektil (malá päsť) |
| `Attack_2.png` | 1872×208 | 9 | **melee** (Gatling, 8 dmg, oba módy) |
| `Recharge.png` | 1296×144 | 9 | **gear3 special** balón (nafúknutie, celotelový balón) |
| `Recharge2.png` | 1120×160 | 7 | **gear3 basic** windup (pumpovanie pästí) + **prepnutie base→gear3** (bez posledných 2 framov → f0–4) |
| `Special_3.png` | 1728×144 | 12 | **prepnutie gear3→base** (bez posledných 2 framov, TBD potvrdiť „(2)") |
| `Special_2.png` | 624×208 | 3 | **gear3 special** impact (radiálne päste) na cieľovej bunke |
| `Special_7.png` | 2112×176 | 12 | **base special** (rozbeh→kotúľ→puf-hlava bounce→zotavenie) |
| `Hurt.png` | 448×112 | 4 | zásah (Luffy aj súper) |
| `Dead.png` | 448×112 | 4 | smrť |
| `Win.png` | 448×112 | 4 | výhra |
| **`L_GiantPunch.png`** ⎘ | 960×320 | 3 | **gear3 basic** — obria naťahovacia päsť (okrúhla päsť vpravo v frame; výrez `sx182 sy186 s134`) |
| **`L_Fist.png`** ⎘ | 336×112 | 3 | **gear3 basic** — zovretá päsť (úchop pri ťahaní; frame 1) |

⎘ = skopírovať z `tools/sprites-luffy/out/` do `public/assets/luffy/` cez `pack_char.cjs` (sú to **FX**
sprity, kreslené ako overlay — NIE cez `ANIM_DEF` per akciu). **Nepoužité (spare):** `Special_1/4/5/6`
(`Special_4` môže neskôr slúžiť ako veľký cast sprite v strede pre gear3 basic, ak budeme chcieť).

### B. Stav/akcia → animácia
| Akcia/stav | BASE | GEAR 3 |
|---|---|---|
| idle | `Idle` (1.0×) | `Idle` (zväčšený `escPrideMul`) |
| move / dash | `Run` | `Run` (zväčšený) |
| **recharge = prepnutie** | →gear3: `Recharge2` (f0–4, bez posl. 2) + veľkosť ↑ | →base: `Special_3` (bez posl. 2) + veľkosť ↓ |
| basic | `Attack_1` + projektil `Charge` (diag.) | sekvencia §4.5-C2 (`Recharge2`→`L_GiantPunch`→`L_Fist`) |
| melee | `Attack_2` | `Attack_2` |
| special | `Special_7` (§4.5-C3) | `Recharge`(balón)→gúľanie→`Special_2` (§4.5-C4) |
| shield / mirror | `Idle` + generický glow (ako ostatní) | `Idle`(zväčš.) + glow |
| hurt / dead / win | `Hurt` / `Dead` / `Win` | to isté (zväčš.) |

Žiadny **deploy/transform intro** (na rozdiel od Escanora) — Luffy začína rovno v `Idle` base.
Žiadna **p2 paleta** (P1-only) → žiadny `dirP2`, žiadny `alt-color`, projektil sa neprefarbuje.

### C. Viacfázové choreografie (nové timeline efekty)

**C1 — Prepnutie módu (recharge):** reuse existujúceho `recharge` efektu (mana aura), navyše frame nesie
nový `form` → klient plynulo pretweenuje **veľkosť** (vzor `escPrideDisplay`: drž starú počas prehrávania,
aplikuj po). Animácia podľa smeru: **base→gear3 = `Recharge2` bez posledných 2 framov** (f0–4, končí
v pumpnutom stave), **gear3→base = `Special_3`** (bez posledných 2 framov, TBD). Prehrá sa raz. Aj pri
plnej mane sa prehrá (nikdy sa nepreškrtne).

**C2 — Gear 3 basic (Giant Pistol + pull):** nové efekty, kreslené na FX overlay (ako soldier beam):
1. `luffy_gp_windup` — Luffy `Recharge2` (pumpovanie pästí), veľkosť gear3. (~`GP_WINDUP_MS` 380)
2. `luffy_gp_reach` — tenká guma sa naťahuje ortogonálne (hor/vert), na konci **`L_GiantPunch`** okrúhla
   päsť (otočená podľa `dir`), letí po **prvého súpera v línii**. Nesie `origin`, `tip`, `dir`. (~`GP_REACH_MS` 340)
3. **zásah** — štandardné vyhodnotenie: `hit` (dmg), resp. `block`/`mirror` (obrana sa vyhodnotí TU);
   súper spustí `Hurt`; krátky záblesk. (~`GP_HIT_MS` 90)
4. `luffy_gp_pull` — **len ak zásah dopadol (nebránený)**: päsť sa prehodí na **`L_Fist`** (úchop), súper
   sa **prisunie** z pôvodnej bunky na `pos+dir` (guma sa skracuje), súper drží `Hurt`. (~`GP_PULL_MS` 360)
   **Ak súper mal shield/mirror** (dmg blokovaný/odrazený) → **žiadny pull**, `L_GiantPunch` sa stiahne späť.
   Minutie (nikto v línii): krok 4 odpadá, `L_GiantPunch` sa stiahne späť (reverz kroku 2).

**C3 — Base special (`Special_7`, dáma):** Luffy sa **dogúľa** (glide ako dash) na zvolenú bunku a hrá
`Special_7`. **Zásah** (na cieľovej bunke stojí súper) → animácia sa zastaví na **puf-hlava frame**
(index `frames-3` = **f9**), dmg 4, súper `Hurt`. **Minutie** (prázdna bunka) → dohrá **posledné 2
framy** (f10–f11, zotavenie). Riadenie konca podľa výsledku ako Escanor `WinSun` (`dataset.once`).

**C4 — Gear 3 special (`Recharge`+`Special_2`, veža):** Luffy sa nafúkne do **balónu** (`Recharge`,
zastav na okrúhlom frame ~f4), **dogúľa sa** na zvolenú bunku (glide), tam **`Special_2`** (radiálne
päste) impact, dmg 8, súper `Hurt`. (`LUFFY_ROLL_MS` glide + `Special_2` beat)

### D. Nové timeline efekty (kind) → klient handler
- `luffy_gp_windup`, `luffy_gp_reach`, `luffy_gp_pull` (gear3 basic; FX overlay = guma + päsť sprity)
- `luffy_pull_foe` (nesie súperov `from`/`to` → klient posunie súpera; použiteľné aj ako samostatný
  „forced move" primitiv)
- `luffy_roll` (base/gear3 special glide na cieľovú bunku)
- Existujúce reuse: `recharge` (C1, + `form`), `hit`/`block`/`mirror`, `charge` (base projektil = `vampShotRoute`)

### E. Časové konštanty (server ↔ client v syncu, viď ADDING_CHARACTERS §4)
`GP_WINDUP_MS≈380`, `GP_REACH_MS≈340`, `GP_HIT_MS≈90`, `GP_PULL_MS≈360`, `LUFFY_ROLL_MS≈` (ako dash).
(Predbežné — vyladiť; v `luffy-anim.html` DEME sú tieto hodnoty.)

### F. `ANIM_DEF` / `SPECIAL_ANIMS` / `SPRITE_FILE_ALIAS`
- `ANIM_DEF`: Luffy má vlastné `Idle/Run/Attack_1/Attack_2/Recharge/Recharge2/Hurt/Dead/Win` → štandardné
  záznamy, **žiadny alias netreba** (má všetky očakávané súbory).
- `SPECIAL_ANIMS`: musí byť **mód-závislý** — base → `Special_7`, gear3 → `Special_2` (+ `Recharge` balón).
  Rieši sa vetvou podľa `state[slot].form` (nie jeden pevný sheet).
- `L_GiantPunch`/`L_Fist` sa **nenačítavajú cez `ANIM_DEF`** — sú to FX overlay obrázky (ako soldier
  `Explosion`), kreslené vlastným handlerom s rotáciou podľa smeru.

### G. Otvorené drobnosti (anim)
- Gear 3 **idle**: `Idle` zväčšený (jednoduché) — alebo držaná pumpovacia póza `Recharge2`? *(návrh: Idle zväčšený)*
- `Special_7` presné indexy freeze/rest over overiť v hre (predbežne freeze f9, rest f10–11).
- Veľkosti FX pästí (`giant` ~`TILE_H*0.95`, `grip` ~`TILE_H*0.7`) a `escPrideMul` faktor pre gear3 (~1.4–1.5×).

---

## 5. Matica okrajových prípadov (ADDING_CHARACTERS §5)

- **Obrany:**
  - *base basic* (diag. strel): shield blokne / mirror odrazí (3/2/1) — ako Vampire/Onryō.
  - *gear3 basic* (Giant Pistol + pull): shield blokne dmg **a pull sa nevykoná**; mirror odrazí dmg
    späť na Luffyho **a pull sa nevykoná**; nebránený → dmg **+ pull** (viď §3.3).
  - *special* (dáma 4 / veža 8): shield blokne / mirror odrazí celý dmg.
- **Power tile:** flat **+2** na immediate-dmg akcie (base basic, gear3 basic, melee, oba speciály),
  tile sa spotrebuje pri použití (anti-camp). Gear3 basic: bonus platí na dmg; pull tým nie je dotknutý.
- **Labyrint:** každý **action hit** (aj blokovaný/odrazený) → **ukončí labyrint**. Prekliaty Luffy
  útočí naslepo → `revealLabyrinths` → hit → `endLabyrinths`. `form` je **verejný stav** → neredaguje sa.
  **Pull cez labyrint:** pretiahnutie súpera = pozičný leak (TBD ako Ariadnina niť / silhouette).
- **Last Stand / Last Hope:** `dealMul` (×2/×4) na dmg (basic/melee/special). Žiadny „deflate" (zrušené).
- **Turnaj:** side-bound P1, **Luffy sa NEDÁ striedať** (swap do/z neho zakázaný; glitch hlavy — už
  generické cez `SIDE_CHARS` po fixe `1763dbc`). `choose_team` prijme `luffy` len pre P1
  (vzor `SIDE_CHARS[key] === slot`). **Vždy začína hru v `base` móde** (`form` reset na štarte hry).
- **Tiles/IK:** normálne. **Pull na IK/dmg dlaždicu** — dá sa súpera pritiahnuť na smrtiacu bunku?
  (TBD — pull súpera je na `pos+dir`, čo je pevná bunka; ak tam je IK, otázka je či to zabije.)
- **Súper = Naruto:** gear3 basic pull chytí **prvého v línii** — môže to byť **klon (decoy)**: chytí sa
  decoy a zomrie, alebo sa priťiahne? (TBD). Speciály zasahujú **len cieľovú bunku** (nie zóna) → klon
  ak tam stojí; test = „stojí klon na cieľovej bunke?".
- **Klon:** Luffy sám **nemá** druhú entitu → „figúrová" agenda odpadá.

---

## 6. Choreografia

**Presunuté do §4.5 „Animačná mapa"** — tá je aktuálna a záväzná. (Staršia verzia tejto sekcie
opisovala zrušený „GEAR THIRD/deflate" návrh a bola odstránená.)

---

## 7. Otvorené otázky na schválenie

1. **Special = čistý toggle formy, alebo toggle + úder?** (§4.1 vs §4.3) — čistý toggle je čitateľnejší;
   toggle+Gigant Pistol dá Gearu 3 aj „vstupný" úder.
2. **Cena/tempo prepnutia:** lacný toggle (2–3 many) každé kolo? — alebo nafúknutie „trvá" (kolo bez
   plného útoku), aby sa forma nemenila triviálne tam-späť?
3. **Presné dmg čísla foriem:** FIGHTER basic ~2 / melee 8; GEAR 3 basic flat 2 cez rad / melee ~4.
   Sedí pomer, alebo posunúť?
4. **Basic (D-basic):** rovný Pistol + refaktor `DIAG_CHARS`? *(odporúčam)* — alebo reuse diagonálneho
   strelu bez refaktora?
5. **p2 v turnaji:** Luffy je P1-only — potvrdiť, že náprotivok Jotaro (P2) mu neruší preview
   (`index.html:331`, dnes ok).

---

## 8. Súbory na úpravu (súhrn — ADDING_CHARACTERS §3)

**`server.js`:** `SIDE_CHARS` (+`luffy:"p1"`), nový `DIAG_CHARS` (ak D-basic), `SPECIAL_ZONE_DMG.luffy`,
`specialDamageAndHit`/`specialZoneHas`/`doSpecial` (luffy vetva + deflate), `newPlayer`/`cloneActor`
(`gear`/`deflated`), `choose_team` validácia (P1 side-char), deflate ½ v `doBasic`/`doMelee`/`doSpecial`,
`applyHitBoth` cesta pre zónu vs Naruto klon.

**`public/client.js`:** `cellsForSpecialPreview` (luffy zóna), `escPrideMul`/`escPrideDisplay` (luffy
vetva veľkosti), `SPECIAL_ANIMS`/`ANIM_DEF` (Special_1/3/4/5), special button label+cost+picker
(ľavo/pravo smer), `ABILITY_PREVIEW.luffy` (z `secret` na reálny popis), deflate render (malá veľkosť),
`PREVIEW_CAST` netreba meniť.

**`public/index.html`:** preview karta už existuje — po odsúhlasení sa Luffy sprístupní cez rune
(hidden page), karta prestane byť `preview-char`.

**`test/game-test.mjs`:** zóna/dmg, obrany (shield/mirror), deflate ½ nasledujúce kolo, off-board
wall rule, power tile +2, Naruto klon (`applyHitBoth`), turnaj draft P1-only + swap ban.

**`CLAUDE.md`:** sekcia „Character specials" — GEAR THIRD + deflate; side-bound P1 poznámka.
