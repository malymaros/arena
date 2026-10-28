# Portal Realm — implementačný plán

> **Pre koho:** pre agenta/vývojára, ktorý mód implementuje — pokojne iného, než plán písal.
> Dizajn je **schválený používateľom** (2026-10-28, rozhovor s vlastníkom). Pred prácou si prečítaj
> `CLAUDE.md` (hlavne Server-authoritative timeline model, Damage pipeline, Labyrinth, Naruto,
> THE WORLD) a `docs/MOBILE.md` pred akoukoľvek zmenou layoutu. Kotvy `súbor:LINE` platia pre commit
> `6349b31` — pri posune si ich over grepom podľa názvu funkcie.
>
> **Poradie je záväzné:** Etapa 0 (vizuál na schválenie) → Etapa 1 (logika + testy, hráč nič nevidí)
> → Etapa 2 (klient podľa schváleného vizuálu). **Žiadny vizuál nejde do hry bez súhlasu vlastníka.**
> Stav sleduj v checklistoch (sekcia 7) — zaškrtávaj priamo v tomto súbore.

---

## 1. Cieľ

Nová **aréna „portal realm"** volená pri vytváraní miestnosti (vedľa dnešnej `bridge`). Aréna nie je
len pozadie — mení pravidlá: iná sada políčok a **portály na hranách dosky**, cez ktoré prechádzajú
pohyby, charge a rovné strely.

Zdroj pozadia: `tools/arena-bg/src/portal-realm/portal-realm.png` (1 vrstva, 1672×941, ~16:9).
Zmenšenú verziu do `public/arenas/portal-realm/` vyrobí `node tools/arena-bg/build.mjs`.

---

## 2. Schválený dizajn (záväzný)

### 2.1 Výber arény a lobby
- Pri vytváraní miestnosti hostiteľ volí **bridge** alebo **portal realm**. Sú to **dva samostatné
  formuláre so spoločným základom** (formát, timer, tiles/round, tile preview, farba, random chars).
- **Bridge** = presne dnešná hra. `config` bridge zápasu sa **nemení** (žiadny nový kľúč) → bridge
  goldeny ostávajú bit-identické. Kľúč `arena: "portal"` (+ `portalWeights`) je v `config` **len**
  pri portal realm (vzor `randomChars`).
- **Portal realm formulár:**
  - políčka **len `dmg` a `ik`**, predvolene **90 / 10**, súčet 100; ostatné typy (heal/mana/power/
    block) neexistujú (vo formulári nie sú, server ich vynuluje),
  - `tilesPerRound` 1–3 ako dnes,
  - **váhy typov portálov** — predvolene klasický **40**, HP **15**, mana **15**, powerup **15**,
    def-breaker **15**; súčet presne 100; jednotlivý typ smie byť 0, nie všetky.
  - `tilePreview` sa týka len políčok — **portály nemajú náhľad dopredu**.
- Pri návrate z portal realm na bridge sa obnovia bridge defaulty (dva formuláre = dva stavy).

### 2.2 Políčka v portal realm
- **Damage políčko** má nakreslené **2 ohníky** a dáva **2 dmg** za krok (bridge ostáva 1).
  Fire boost (special ±1 riadok + spotreba políčka) funguje rovnako. Kozmetický `clone_hit` na klonovi
  ukáže −2 (klon sa ani tak nerozplynie — dnešné pravidlo).
- IK bez zmeny (10 dmg, presúva sa, viac naraz). Full-board fallback na IK bez zmeny.

### 2.3 Portály — dátový model a generovanie
- Portál leží na **vonkajšej hrane okrajového políčka**: `{x, y, side}` kde `side` ∈ up/down/left/
  right = smer von z dosky. Doska 4×3 má **14 hrán** (rohové políčka po 2).
- Portály sú v **pároch** (oba konce rovnakého typu), pár má písmeno **A–G**, naraz najviac
  **7 párov** (= všetkých 14 hrán). Písmeno = prvé voľné.
- **Generovanie:**
  - **1 pár hneď pri štarte každej hry** (aj v sérii),
  - **1 pár ako úplne posledná vec na konci kola** (po políčkach, golden mane, Last Stand heale…) —
    hráči ho vidia od začiatku ďalšieho kola,
  - na **ľubovoľné dve voľné hrany** — aj na tej istej strane dosky, **aj obe hrany toho istého
    rohového políčka** (pozri 2.6),
  - keď nie sú 2 voľné hrany → nič sa nevygeneruje,
  - typ podľa `portalWeights`, všetko cez `rand()` (determinizmus),
  - hra, ktorá skončí uprostred kola, už negeneruje.
- Presný vzhľad a vizuálne párovanie (písmeno/farba) sa **schváli v etape 0**.

### 2.4 Prechod portálom — geometria
- Figúra/strela, ktorá by v ortogonálnom smere `d` opustila dosku cez hranu s portálom, **vstúpi do
  portálu**: ďalšie políčko je **políčko druhého konca páru**, nový smer = **dovnútra dosky** od hrany
  druhého konca (opak jej `side`). Prechod = 1 krok / +1 vzdialenosti.
- Hrana bez portálu (alebo so spotrebovaným) = stena ako dnes (pravidlo „akcia do steny").
- **Diagonálne pohyby nikdy nevchádzajú do portálov** („dopadajú medzi políčka"): diagonálne basicy
  Vampíra/Onryō/Jotara/Luffyho sa odrážajú ako dnes, diagonálny charge Vlkolaka končí na okraji ako dnes.

### 2.5 Spotreba
- Pár **zanikne hneď po prechode** (telom alebo strelou) — oba konce naraz.
- **Výnimka — simultánny prechod:** všetky prechody v **tom istom momente** prejdú, pár zanikne až po
  nich. Týka sa Naruta: vlastník + klon na spoločnom políčku (aj ich dve rovné strely), vlastník a klon
  v **opačných koncoch toho istého páru** (vymenia si strany).
- **Výnimka — THE WORLD:** pozri 2.10.
- Dôsledok: v jednej akcii sa ten istý pár nedá použiť dvakrát → žiadna nekonečná slučka pri charge.

### 2.6 Rohový pár (obe hrany toho istého rohu)
- Vstup jednou hranou rohu = výstup **na tom istom políčku**, otočený dovnútra od druhej hrany.
- **Strela** strelca stojaceho v rohu do rohového portálu → výstupné políčko je jeho vlastné =
  vzdialenosť 1 → **3 dmg sebe** (zámer: „keď je to idiot").
- Strelec **vedľa** rohu strieľa do rohu → roh (vzd. 1) → portál → roh znova (vzd. 2) → susedné políčko
  (vzd. 3); zastaví sa na prvej figúre.
- **`move`** do rohového portálu nechá hráča na tom istom políčku, ale **prehrá animáciu vstupu a
  výstupu** z príslušných portálov; portál sa spotrebuje a typ sa uplatní (HP/mana). `dash`/charge:
  druhý krok už v novom smere.
- **Escanor** v rohu hodí do rohového portálu → F = jeho políčko, zóna okolo neho (jeho nezasiahne);
  **Luffy** balón ostane na mieste a vybuchne okolo neho. Obaja s animáciou vstupu/výstupu.

### 2.7 Čo prechádza portálom

| Akcia | Cez portál | Efekty portálu |
|---|---|---|
| `move`, `dash` | áno | **telo** (HP, mana) |
| charge **Vlkolaka** (len ortogonálne smery), charge **Vampíra/Onryō** (dash slot) | áno | **telo aj útok** (HP, mana, powerup, def-breaker → na úder po dobehnutí) |
| **Luffy** balón (kotúľanie o 1 políčko) | áno | **telo aj útok** (powerup/def-breaker → na výbuch) |
| **Escanor** slnko — len keď F vyjde mimo dosky cez hranu s portálom | áno | **len útok** |
| rovné basic strely (vrátane strely Narutovho klona) | áno | **útok** (powerup, def-breaker) |
| diagonálne basicy (Vampír, Onryō, Jotaro, Luffy), diagonálny charge Vlkolaka | nie | — |
| area/zónové speciály: Fire, Lightning, Wanderer, Medúza, Minotaur, Naruto summon, Soldier, Jotaro S1/S2, Luffy päsť a S2, pasca, démon, Last Stand doom | nie | — |

- Escanor: ak je F na doske, hod je ako dnes a portál ostane. Zóna sa ukotví na výstupnom políčku a
  **nepretáča sa** cez okraj (pride 2 z pravého okraja doprava → zasiahnuté 2 krajné ľavé stĺpce, jeho
  stĺpec nie; pride 3 → celá doska, kým dnes je hod mimo dosky prázdny).
- **Dolet strely 3 políčka spolu**, pokles 3/2/1 pokračuje cez portál. Strela na 3. políčku pri hrane
  s portálom (dolet minutý) **do portálu nevojde**, portál ostane.
- Strela zasiahne **prvú figúru na dráhe vrátane strelca a jeho vlastného klona** (klon sa rozplynie).
  **Zóny kastera nikdy nezasiahnu** — sebe ublížiť môže len projektil.

### 2.8 Typy portálov

| Typ | Na koho | Efekt |
|---|---|---|
| klasický | — | len prechod |
| **HP** | telo | +1 HP (**Lightning: plné HP**); strela ním len prejde a spáli ho |
| **mana** | telo | mana **na maximum**; strela ho len spáli |
| **powerup** | útok | **+2 dmg**, zlatá aura na strele; telo ho len spáli |
| **def-breaker** | útok | **zásah ignoruje štít aj zrkadlo** (aj golden), biela aura; telo ho len spáli |

- **Narutov klon** pri prechode HP/mana portálom bonus nedostane, ale portál spáli (žiadna animácia
  +HP/+mana). Strela klona **dostáva** powerup aj def-breaker.
- **Charge (Vlkolak/Vampír/Onryō) a Luffyho balón** dostávajú efekty tela **aj** útoku.
- **Sčítanie:** viac portálov v jednej akcii → efekty sa sčítajú (2× powerup = +4, powerup + def-breaker =
  obe aury, telo cez mana aj HP = oboje).
- Powerup bonus je **flat** ako dnešný power tile (nenásobí sa Last Stand/maze), zrkadlo ho odráža ako
  súčasť plného dmg.
- **Def-breaker:** súperov štít/zrkadlo sa **minie bez efektu**, zobrazí sa nový popis **SHIELD DISPELLED /
  MIRROR DISPELLED** s animáciou a **dmg dopadne**.

### 2.9 Zrkadlo a portály
- Odraz sa vracia po dráhe útoku. Ak útok prešiel portálom, pár je už spotrebovaný → **odraz narazí do
  steny** a strelec nedostane nič (obranca tiež nie, zrkadlo sa minie). Je to zámerný spôsob, ako sa
  strelec vyhne odrazu.
- **Charge a Luffyho balón:** útočník stojí pri cieli (na jeho políčku / v strede výbuchu) → odraz ho
  **trafí priamo**, cez portál sa nevracia.
- Escanorovo slnko cez portál → odraz do steny.

### 2.10 Zásah vlastnou strelou
- Vlastný štít/zrkadlo nehrá rolu (kryjú len súperovu akciu).
- Last Stand multiplikátory aj maze buff **platia**.
- **Escanor stráca pride** aj za zásah sám sebou.
- **Labyrint sa neukončí.**
- Hráč, ktorý zabije sám seba, prehrá — **vyhráva súper**.

### 2.11 THE WORLD
- Jotarov pohyb v zastavenom čase beží naživo (teleport portálom hneď), ale **portál nezmizne a efekt
  sa neuplatní až do obnovenia času** — všetko naraz s ostatnými odloženými efektmi.
- Jotaro môže tým istým portálom v zamrznutí prejsť **aj opakovane**, efekt sa mu **pripíše len raz**.
- Jeho basic je diagonálny (cez portál nejde), S1 je zóna — v praxi portály v zamrznutí používa len
  `move`/`dash`.

### 2.12 Labyrint
- Portály sú **terén** — vidí ich aj prekliaty. **Zmiznutie portálu vidí** aj keď ho spálil skrytý
  lovec (vedome akceptovaný únik informácie). Prechod skrytého lovca/jeho strely je inak redigovaný ako
  ostatné súperove efekty.
- **Ariadnina niť sa pri prechode portálom celá stratí** (zmizne aj silueta `threadMark` zo starej nite), nové
  klbko začína na výstupnom políčku.
- Stretnutie s Minotaurom na výstupnom políčku = `threadMark` ako pri bežnom vstupe.
- Peek (akcia lovca začatá na torch políčku) platí aj s prechodom portálom.

### 2.13 Ostatné
- **Pasca** Vampíra/Onryō na výstupnom políčku sa spustí (výstupné políčko patrí do `actionSteps`).
- **Plánovanie:** ghost a náhľad mierenia/zón idú cez portály; ghost vie, že pár použitý mojou skoršou
  akciou v kole už neexistuje. Ak portál spáli skôr v kole **súper**, môj pohyb do tej hrany je
  `wall_bump` (mana sa minie) — akceptovaná neistota ako pri pasciach/charge.
- **Naruto:** vertikálna inverzia klona platí aj s portálmi; vlastník aj klon sa vyhodnotia správne aj
  keď každý prejde iným portálom (iného typu).

### 2.14 Vizuál (etapa 0 — schválené vlastníkom 2026-10-28, náhľad `public/dev/portal-realm.html`)
- **Premenovanie:** dnešná aréna `bridge` sa v UI volá **STONE BRIDGE** (interný kľúč `bridge` a priečinky ostávajú).
- **Animácie etapy 0 schválené všetky** (pohyb, rohová otočka, dash, HP/mana, strela so zmenou smeru, powerup
  „⚡ +2", Def-breaker „DEF BREAK" + SHIELD/MIRROR DISPELLED, zrkadlo do steny LOST IN THE VOID, strela do seba,
  spawn páru, dve figúry naraz). **Záväzné: existujúce animácie stone bridge sa nemenia** — portál len vkladá
  vlastný prechod (zmiznutie do trhliny / vynorenie) do inak nezmenenej choreografie.
- **Portál = pixel trhlina** (variant D): kockatá zubatá šošovka (4 px pixely) — tmavý okraj / farba typu /
  svetlá / biele jadro, 3 snímky „praskania" (opacity steps), pixelové iskry. **Výkon:** snímky sa vykreslia raz
  do canvasu so **zapečenou žiarou** a v DOM je len `<img>` s animovanou opacity — SVG pixely pod CSS
  `drop-shadow` dávali pri 7 pároch ~21 FPS aj bez spomalenia CPU.
- **Farby typov:** klasický = **fialová plameňov arény** (`#c04dff`/`#f2c9ff`), HP červená, mana modrá,
  powerup zlatá, def-breaker biela. **Ikona typu v strede trhliny** (srdce/kvapka/meč/štít s ✕), klasický bez ikony.
- **Párovanie = len značka**: pixelová **runa zo „spellbooku"** (7 znakov 7×7, jedna na pár, nie písmená)
  **na oboch koncoch trhliny**, tesne pri nej, vo farbe typu na tmavej doštičke. Žiadna spojnica.
- **Damage políčko = 2 ohníky vedľa seba** (16×8 pixel ikona).
- **Pozadie v plnom rozlíšení** (plynulé škálovanie, nie 320×180 pixelated ako bridge) — per-aréna režim
  kreslenia; originál (2,3 MB PNG) → WebP q0.88 = 227 kB (`public/arenas/portal-realm/portal-realm-hd.webp`,
  v etape 2 presunúť do pipeline `tools/arena-bg/`).
- **Živé pozadie** (vrstva nad obrázkom, len opacity/transform): blikajúce ohne v miskách s iskrami, rotujúci
  vír na oblohe, postupne žiariace runy, dýchajúci magický kruh, svetielka v prázdnote. **Telefón/perf-lite:**
  lite variant (bez `mix-blend-mode`, 3 iskry na misku, polovica svetielok, jeden vír) — pôvodný lite bez iskier
  a svetielok mal v emulácii (CPU 4×) ~59 FPS ako statické pozadie, plný variant ~42–46 FPS; bohatší lite
  overiť na reálnom telefóne / `tools/perf-probe.mjs` v etape 2. Pozície efektov sú naviazané na tento obrázok.
- **Ariadnina niť** pri prechode portálom **celá zhasne a zmizne aj so siluetou stretnutia (`threadMark`)**; nové
  klbko začína na výstupnom políčku.
- **Escanor / Luffy** majú **pôvodnú choreografiu** (WinSun → CruelSunHold → let slnka → SunBurst/SunFade;
  premena na guľu → kotúľ → Special_2) — portál len vloží prechod (zmiznutie do trhliny, vynorenie z druhej)
  rovnako ako pri strele/tele Fire wizarda.
- **Lobby:** výber arény = dve malé tlačidlá (výška ako ostatné voľby) s náhľadom pozadia, bez popisov.
- **Lobby — poradie váh** (rovnaké v bridge aj portal realm, kvôli zjednoteniu): mriežka 2 stĺpcov, ľavý stĺpec
  zhora Damage / Heal / Mana, pravý Insta-kill / Power / Def-blocker. Portal realm: PORTAL CHANCE má **Classic sám v prvom riadku** (miesto Damage + Insta-kill; pole široké ako HP pod ním, pravá polovica prázdna),
  potom HP | Power-up, Mana | **Def-breaker** (premenovaný no-def). Žiadny vysvetľujúci text pod portálmi. Zmena poradia sa týka aj dnešného lobby v `public/index.html`.
- **Lobby na telefóne** (`html.phone`, dnes plné na výšku): výber arény (STONE BRIDGE | PORTAL REALM) **nahrádza veľký nadpis ARENA** v hornom riadku; v portal realm má pravý stĺpec **záložky TILES | PORTALS** (naraz jeden zoznam,
  záložka so zlým súčtom svieti na červeno). Overené v náhľade 667×375 aj 844×390: oba formuláre sa zmestia bez
  posúvania, rovnaká výška → nič neposkočí. Počítač: obe sekcie pod sebou, karta ukotvená hore.

---

## 3. Návrh implementácie (engine)

- **Konštanty** (`shared/balance.js`): `PORTAL_MAX_PAIRS = 7`, `PORTAL_REALM_TILE_DMG = 2`,
  `PORTAL_HP_GAIN = 1`, `PORTAL_POWER_BONUS = 2`, default váhy `PORTAL_WEIGHTS` a `PORTAL_TILE_WEIGHTS
  {dmg:90, ik:10}`. Dolet strely zostáva `BASIC_DMG_MAX` falloff (3 políčka).
- **Stav:** `game.portals = [{ id: "A", type, ends: [{x,y,side},{x,y,side}] }]` v snapshote (verejný,
  aj pre prekliateho).
- **Geometria** (`shared/geometry.js`, zdieľaná so klientom): `portalAt(portals, x, y, dir)`,
  `stepThrough(board, portals, x, y, dir, used)` → `{ x, y, dir, portal } | null` (null = stena),
  `portalPath` pre strelu (dolet 3, pokles, prvá figúra vrátane strelca/klona), úprava `runPath` (charge),
  `escanorCells` (F cez portál), `luffyBallLanding`, `simulateQueue`/`simulateClone` (ghost a
  `validQueue` musia počítať rovnako). Bez `portals` sa všetko správa bit-identicky ako dnes.
- **Nový modul** `engine/portals.js` (vzor `tiles.js`): generovanie (`spawnPortalPair`), spotreba po
  akcii/kroku s výnimkou simultánneho prechodu, odložené efekty pre THE WORLD, typové efekty
  (HP/mana na telo, powerup/def-breaker ako `opts` do `resolveStrike`).
- **Damage pipeline:** `resolveStrike` dostane `defBreak` (defense krok: minie obranu, `dispel` frame,
  pokračuje na apply) a `power`; nový flag „reflect blocked" pre zrkadlo cez spotrebovaný portál; self-hit
  ako nová vetva (cieľ = strelec, bez obrán, pride −1, labyrint neukončiť, smrť = výhra súpera).
- **Timeline efekty** (mená finálne po etape 0): `portal_enter` / `portal_exit` (figúra aj projektil,
  so smerom), `portal_consume`, `portal_spawn`, `portal_buff` (aura na strele), `dispel`,
  `reflect_wall`. Všetko cez `pushStateFrame` — žiadne teleporty bez frameov.
- **Redakcia** (`engine/labyrinth.js`): prechody skrytého lovca filtrovať, `portal_consume` nechať
  viditeľné; prechod portálom = celá niť sa zmaže, `thread` začne znova na výstupnom políčku.

---

## 4. Etapy

### Etapa 0 — vizuál na schválenie (nič v hre)
Dummy stránka (napr. `public/dev/portal-realm.html`, mimo hry, len na náhľad), ktorú vlastník
interaktívne prejde a odsúhlasí:
1. vykreslená aréna portal realm (pozadie cez `arena-bg/build.mjs`) s doskou 4×3,
2. portály na hranách: 5 typov, vizuálne spárovanie A–G, rohový pár, plná doska (7 párov),
3. dmg políčko s 2 ohníkmi,
4. animácie: vstup/výstup tela (move, dash, rohový „otoč sa na mieste"), strela cez portál (vrátane
   zmeny smeru), zlatá a biela aura strely, spálenie portálu, spawn nového páru, odraz zrkadla do steny,
   SHIELD/MIRROR DISPELLED, zmiznutie Ariadninej nite, Escanor slnko a Luffy balón cez portál,
5. **interaktívne vytvorenie miestnosti** — dva formuláre (bridge / portal realm) so spoločným
   základom a váhami portálov,
6. kontrola na telefóne (`html.phone`) — portály na hranách mimo políčok.

**Výstup:** vlastník schváli → rozhodnutia o vzhľade sa dopíšu do sekcie 2.

### Etapa 1 — logika + testy (hráč nič nevidí)
Engine, `shared/geometry.js`, `sanitizeConfig`, server; klient iba nerozbitý (portály ignoruje).
Hotové = všetky testy zo sekcie 5 zelené, bridge goldeny bez zmeny, `npm run lint` čistý.

### Etapa 2 — klient podľa schváleného vizuálu
Lobby formuláre, kreslenie portálov, choreografia efektov, ghost/aim/zone preview cez portály, HUD,
redakcia v labyrinte, zvuky (nové kľúče → `SOUND_API_VERSION`, `npm run sounds:windows`), mobil
(`tools/screens.mjs`, `touch-smoke.mjs`), `browser-smoke.mjs`, `perf-probe.mjs`.

---

## 5. Testovacia matica (Etapa 1)

Nový súbor `test/portals.mjs` (vzor `test/engine-scenarios.mjs` — presný stav nastavený v `setup`,
jedno kolo, kontrola frameov aj výsledného stavu) + `test/geometry-portals.mjs` (čisté funkcie).
Oba v `npm test`.

**Geometria (čisté funkcie)**
- [ ] prechod každou zo 14 hrán do každej inej → správne políčko a smer dovnútra
- [ ] rovnaká strana dosky (vľavo ↔ vľavo), protiľahlé strany, susedné strany
- [ ] rohový pár: výstup na tom istom políčku, nový smer
- [ ] diagonály portály ignorujú (vampShotRoute bez zmeny, diag charge Vlkolaka bez zmeny)
- [ ] bez portálov = bit-identický výsledok všetkých existujúcich funkcií (property test na náhodných vstupoch)
- [ ] `simulateQueue` ghost: pohyb cez portál, druhá akcia do už spotrebovaného portálu = stena

**Pohyb**
- [ ] `move` cez portál → výstupné políčko, pár zanikne, frame vstup/výstup
- [ ] `move` do rohového portálu → ostane na políčku, animácia, pár zanikne
- [ ] `dash`: krok 1 cez portál, krok 2 dovnútra; krok 2 cez iný portál; krok 1 bežný + krok 2 cez portál
- [ ] pohyb do hrany so spotrebovaným portálom = `wall_bump`, mana sa minie (dash)
- [ ] súper spáli portál skôr v kole → môj pohyb = `wall_bump`
- [ ] HP portál +1, pri plnom HP bez zmeny (portál aj tak zanikne); Lightning → plné HP
- [ ] mana portál → max mana
- [ ] telo cez powerup / def-breaker → portál zanikne bez efektu
- [ ] dash cez HP aj mana portál → oboje
- [ ] dmg políčko 2 dmg / IK na výstupnom políčku sa vyhodnotí na konci kroku
- [ ] pasca na výstupnom políčku sa spustí

**Strely**
- [ ] strela cez portál zasiahne súpera s dmg podľa celkovej vzdialenosti (3/2/1)
- [ ] dolet minutý na 3. políčku pri portáli → portál ostane
- [ ] strela zasiahne strelca (horizontálne aj vertikálne cez rôzne páry), rohový pár = 3 dmg sebe
- [ ] strela zasiahne vlastného klona → klon sa rozplynie
- [ ] self-hit: Last Stand ×2/½ a maze buff platia; Escanor −1 pride; labyrint sa neukončí; smrť → výhra súpera
- [ ] powerup: +2 flat (nenásobí sa), frame s `bonus`; 2× powerup = +4
- [ ] def-breaker vs štít, zrkadlo, golden štít, golden zrkadlo → obrana minutá, `dispel`, dmg dopadne
- [ ] powerup + def-breaker na jednej strele
- [ ] strela cez HP/mana portál → spáli ho bez efektu
- [ ] zrkadlo vs strela cez portál → odraz do steny, nikto dmg, zrkadlo minuté
- [ ] zrkadlo vs strela bez portálu → dnešné správanie (regresia)

**Charge (Vlkolak ortogonálne, Vampír, Onryō)**
- [ ] charge cez portál zastaví na prvej figúre za portálom / na okraji
- [ ] charge cez HP/mana → efekt na telo; cez powerup/def-breaker → efekt na úder; kombinácie
- [ ] charge cez dva rôzne portály, ten istý pár sa druhýkrát nedá (stena)
- [ ] zrkadlo vs charge cez portál → odraz trafí útočníka priamo
- [ ] Vampír heal / Onryō drain s powerupom (bonus len pri dopadnutom zásahu)
- [ ] diagonálny charge Vlkolaka na okraji = dnešné správanie

**Escanor a Luffy**
- [ ] Escanor F na doske → portál ostane, zóna ako dnes
- [ ] Escanor F cez portál, pride 0–3, zóna ukotvená na výstupe, bez pretočenia; pride 3 = celá doska
- [ ] Escanor nezasiahne sám seba (rohový pár); powerup/def-breaker na zóne; HP/mana sa naňho neuplatní
- [ ] zrkadlo vs Escanor cez portál → odraz do steny
- [ ] Luffy balón cez portál: pristane na výstupe, výbuch 3×3 tam; HP/mana na Luffyho, powerup/def-breaker na výbuch
- [ ] Luffy rohový pár: ostane na mieste, výbuch okolo neho; `worldUsed` nastavené
- [ ] zrkadlo vs Luffy balón cez portál → odraz trafí Luffyho priamo

**Naruto**
- [ ] vlastník + klon na spoločnom políčku prejdú tým istým portálom spolu (pár zanikne po oboch)
- [ ] vlastník a klon v opačných koncoch toho istého páru → vymenia si strany
- [ ] vlastník a klon každý cez iný portál iného typu → obaja správne, každý svoj efekt
- [ ] klon cez HP/mana → bez bonusu, portál zanikne
- [ ] dve strely (vlastník + klon) cez rôzne portály, cez ten istý portál; aury pre klona
- [ ] vertikálna inverzia: jeden cez portál, druhý `wall_bump`
- [ ] `displayDir` `↕` ostáva

**THE WORLD**
- [ ] Jotaro v zamrznutí prejde portálom → teleport hneď, portál ostane, efekt až pri obnovení
- [ ] opakovaný prechod tým istým portálom → efekt len raz
- [ ] pri obnovení všetky použité páry zaniknú naraz s ostatnými efektmi

**Labyrint**
- [ ] prekliaty vidí portály aj ich zánik, nevidí prechod skrytého lovca
- [ ] celá niť zmizne a nové klbko začne na výstupnom políčku (prekliaty prechádza portálom)
- [ ] `threadMark` na výstupnom políčku
- [ ] peek akcie lovca s prechodom portálom
- [ ] self-hit prekliateho/lovca labyrint neukončí

**Generovanie a lobby**
- [ ] 1 pár pri štarte hry (aj každej hry v sérii), 1 pár na konci kola ako posledný krok
- [ ] limit 7 párov, plná doska → nič; rohový pár sa smie vygenerovať
- [ ] písmená = prvé voľné, typy podľa váh (váha 0 = nikdy)
- [ ] hra skončená uprostred kola negeneruje
- [ ] `sanitizeConfig`: portal realm vynuluje heal/mana/power/block, váhy portálov súčet 100, nie všetky 0;
      bridge config bez nového kľúča
- [ ] turnaj: portály medzi hrami resetované, swap/roster bez vplyvu

**Regresia a fuzz**
- [ ] `npm run golden` — bridge bit-identický
- [ ] nová sada goldenov pre portal realm (single, bo3, turnaj, rôzne váhy)
- [ ] `tools/simulate.mjs` hrá aj portal realm (tisíce zápasov bez výnimky, invarianty: max 7 párov,
      žiadne dva portály na tej istej hrane, HP/mana v rozsahu, hra vždy skončí)
- [ ] `node tools/difftest.mjs` = 0 diffov pre bridge
- [ ] `test/game-test.mjs`: socket test vytvorenia portal realm miestnosti a jedného kola

---

## 6. Riziká
- **Rozsah zmien v `shared/geometry.js`** — zdieľaná so klientom; každá funkcia musí mať bez `portals`
  identický výsledok (property test + difftest).
- **Damage pipeline** — `defBreak`, `power`, `reflect_wall`, self-hit nesmú vzniknúť ako nové `apply*`
  varianty; len rozšírenie `resolveStrike`.
- **THE WORLD** odložené efekty a **Naruto** simultánne prechody sú najzložitejšie — pokryť ako prvé.
- **Labyrint redakcia** — každý nový efekt prejsť cez `redactTimelineFor`.

---

## 7. Checklist

- [x] Etapa 0: dummy stránka — aréna, portály, políčka
- [x] Etapa 0: dummy stránka — animácie efektov
- [x] Etapa 0: dummy stránka — vytvorenie miestnosti (2 formuláre)
- [x] Etapa 0: **schválené vlastníkom**, vizuálne rozhodnutia dopísané do sekcie 2 (2.14)
- [x] Etapa 1: konštanty + config + generovanie
- [x] Etapa 1: geometria + ghost (`shared/geometry.js`)
- [x] Etapa 1: pohyb, dash, typy na telo
- [x] Etapa 1: strely, powerup, def-breaker, self-hit, zrkadlo do steny
- [x] Etapa 1: charge, Escanor, Luffy
- [x] Etapa 1: Naruto
- [x] Etapa 1: THE WORLD
- [x] Etapa 1: labyrint + pasca
- [x] Etapa 1: goldeny + fuzz + difftest
- [x] Etapa 2: lobby formuláre
- [x] Etapa 2: kreslenie arény, portálov, políčok
- [x] Etapa 2: choreografia efektov
- [x] Etapa 2: ghost / previews
- [x] Etapa 2: mobil, smoke testy (browser-smoke --portal, touch-smoke, screens) — zvuky: nové efekty zatiaľ bez vlastných zvukov
