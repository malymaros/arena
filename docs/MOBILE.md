# Mobil a tablet

Hra beží v prehliadači aj na mobile a tablete. Plán je rozdelený na fázy; hotová je fáza 1.

## Fáza 1 - hra sa zmestí na obrazovku (hotové)

**Ako to funguje (`public/client/viewport.js`):** layout je celý v pevných pixeloch (políčka 260×185, HUD po bokoch,
toolbar dole) a potrebuje aspoň `DESIGN_W × DESIGN_H` = **1720 × 920** CSS px. Na menšej obrazovke sa stránka vykreslí
ako na „virtuálnej" obrazovke `--app-w × --app-h` (skutočná veľkosť / scale, nikdy menšia než dizajn) a celé `<body>`
sa zmenší jedným `transform: scale(--app-scale)`. Transform robí z body containing block aj pre `position: fixed`,
takže HUD, toolbar a overlaye ostanú pri okrajoch obrazovky. Na obrazovke ≥ 1720×920 je scale 1 - desktop
1920×1080 je pixelovo identický s pôvodným stavom. Bezpečné okraje (výrez kamery na šírku) sa odčítajú cez `env(safe-area-inset-*)`.

**Pravidlá pre klientsky kód:**
- nepoužívaj `window.innerWidth/innerHeight` ani `100vw/100vh` - použi `appSize()` z `viewport.js`, v CSS `var(--app-w)` / `var(--app-h)`;
- súradnice z udalostí (`clientX/Y`, `getBoundingClientRect`) sú v skutočných px obrazovky → prepočítaj cez `appScale()`;
- nové fixné prvky pridávaj do `body` (nie na `document.documentElement`), inak sa nezmenšia.

**Ďalej vo fáze 1:**
- `index.html`: viewport bez zoomu (`user-scalable=no`, `viewport-fit=cover`), PWA meta tagy, `manifest.webmanifest`
  (fullscreen, na šírku) a ikony `public/icons/` (generuje `node tools/make-icons.mjs`);
- `public/client/mobile-ui.js`: na dotykovom zariadení výzva „ROTATE YOUR DEVICE" na výšku a tlačidlo celej obrazovky
  vedľa 🔊 (len kde to prehliadač vie - Android Chrome; iPhone Safari nie, tam pomôže „Pridať na plochu");
- CSS: žiadny pull-to-refresh, double-tap zoom, výber textu ani kontextová bublina pri podržaní (trieda `.touch` na `<html>`).

**Kontrola:** `node tools/screens.mjs` nasníma login, výber postáv a hru na 9 veľkostiach (desktop, tablet, mobil na šírku
aj na výšku) do `tmp/screens/` (mimo gitu). `--only phone` vyberie len niektoré zariadenia.

## Fáza 2 - dotykové ovládanie (ďalej)

Na dotyku nefunguje všetko, čo stojí na hoveri:
- náhľady zón (special, útok, melee, demon, položky vo fronte - `preview-hovers.js`, `queue.js`, `controls.js`)
  a náhľad schopností v char-selecte → ťuknutie = náhľad, druhé ťuknutie = potvrdenie;
- tooltipy cez `title=` sa na dotyku nezobrazia → dlhé podržanie alebo info panel;
- easter-egg runa skrytej stránky reaguje len na `mousemove` → na dotyku je nedostupná (aj Vampire/Onryō/Jotaro);
- `:hover` štýly ostávajú „visieť" po ťuknutí;
- väčšie ciele pre prst (pickery smeru, výber políčka, vlkova 3×3 mriežka).

## Fáza 3 - mobilné UI (neskôr)

Kompaktnejší HUD na telefóne, akcie pod palcami, väčší login, lobby a char-select na malej obrazovke.

## Výkon (2026-10-21)

Merané v Chrome ako mobil 844×390 so 4× spomaleným procesorom (≈ stredný telefón), zápas Escanor vs Naruto:

| | pred | po |
|---|---|---|
| stiahnuté dáta (prvé spustenie + 1. zápas) | ~31 MB | ~11 MB |
| hlavné vlákno pri čakaní na ťah | 70 % | 42 % |
| hlavné vlákno pri prehrávaní kola | 79 % | 66 % |
| sekané snímky (> 50 ms) pri prehrávaní | 3,1 % | 1,3 % |

- **Pozadie arény:** originály v 3840 px (20 MB) ležia v `tools/arena-bg/src/`; `node tools/arena-bg/build.mjs` ich v headless
  Chrome zmenší rovnakým drawImage ako klient na `ARENA_RES` (320×180) do `public/arenas/` (~300 kB) a sám overí
  pixelovú zhodu. Nová aréna / zmena `ARENA_RES` = pridaj originály do `src/` a spusti skript znova.
- **Kreslenie spritov:** `drawSprite` (`public/client/sprites.js`) nekreslí znova, ak je na canvase už presne ten istý
  obraz (obrázok + frame + geometria). Akékoľvek iné kreslenie do canvasu alebo zmena jeho width/height pamäť
  zmaže automaticky - priame kreslenie (mimo drawSprite) je teda bezpečné a netreba nič volať.
