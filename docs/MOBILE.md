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
- `public/client/mobile-ui.js`: na dotykovom zariadení výzva „ROTATE YOUR DEVICE" na výšku; celá obrazovka je v menu ☰
  (len kde to prehliadač vie - Android Chrome; iPhone Safari nie, tam pomôže „Pridať na plochu");
- CSS: žiadny pull-to-refresh, double-tap zoom, výber textu ani kontextová bublina pri podržaní (trieda `.touch` na `<html>`).

**Kontrola:** `node tools/screens.mjs` nasníma login, výber postáv a hru na 9 veľkostiach (desktop, tablet, mobil na šírku
aj na výšku) do `tmp/screens/` (mimo gitu). `--only phone` vyberie len niektoré zariadenia.

## Návrh mobilného UI (dohodnutý s vlastníkom 2026-10-21)

**Pre koho:** telefóny (dotyk, kratšia strana do ~500 px) dostanú nové rozloženie; tablety ostávajú pri desktopovom
rozložení, ale dostanú nové dotykové ovládanie; desktop sa nemení.

### Krok 1 - menu ☰, reload, admin, zvukové okno (hotové)
- **Menu ☰** vľavo dole (`client/menu.js`), vždy dostupné aj nad zaseknutými overlaymi: **RELOAD GAME** (obnovenie
  stránky, server hráča vráti na miesto - záchrana pri zaseknutí, v nainštalovanej appke niet iného refreshu),
  celá obrazovka, **SOUND**, sekcia **ADMIN** (reset tejto roomky / všetkých).
- **Admin = prihlásenie admin heslom** (`ADMIN_KEY` na serveri, nie v repe) namiesto hesla hráča. `?admin=1` zrušené;
  na webe ostáva rohové tlačidlo „Reset this room" a „RESET ROOMS" v zozname roomiek - len pre admina.
- **Zvukové okno** (`client/sound-ui.js`): MUTE + MASTER/MUSIC/SFX - široké posuvníky s veľkým jazdcom a tlačidlá −/+
  po 10 %; na dotyku vo veľkosti displeja.
- Menu a okná sa na dotyku kreslia v skutočnej veľkosti displeja (`--ui-k` = 1 / --app-scale), nezmenšujú sa s hrou.

### Krok 2 - dotykové ovládanie (telefón aj tablet) (hotové)
- **Ťuk na akciu = výber + náhľad:** zóna zásahu svieti na boarde, popis (názov · zóna · dmg · cena) v **info riadku
  nad lištou tlačidiel**; nič sa nezaradí omylom.
- **Smer / cieľ ťuknutím na board:** okolo postavy (resp. jej ghostu) sa ukážu šípky / povolené políčka, ťukneš priamo
  na ne. Akcia bez smeru (recharge, shield…) sa zaradí druhým ťuknutím na to isté tlačidlo.
- **Výber postavy:** ťuk na kartu = schopnosť + náhľad, potvrdenie tlačidlom **PICK <meno>**.
- Skrytá stránka (runa) musí byť dosiahnuteľná aj dotykom; `:hover` štýly nesmú „visieť" po ťuknutí.

**Ako je to spravené (`public/client/touch.js`, len pri dotyku - desktop nezmenený):**
- jeden capture listener na `click`: prvé ťuknutie na prvok zo zoznamu `SELECTABLE` (akčné tlačidlá, golden polovice,
  šípky a políčka pickerov, karty postáv, hlavy tímu) ho len označí (`.touch-armed`) a pošle mu syntetický
  `mouseenter` - teda tie isté náhľady zón, ktoré na desktope ukazuje hover (`preview-hovers.js`, `queue.js`, …);
  druhé ťuknutie klik pustí ďalej; nad označenou akciou svieti štítok **TAP AGAIN** (`#touch-confirm`).
  `oneTap()` = výnimky: tlačidlá otvárajúce picker a **všetky šípky / políčka pickerov** (jedno ťuknutie - výberom
  bola už akcia; zónu ukazuje stlačenie, kým drží prst). Kým je picker otvorený, ostatné akcie sa neoznačujú -
  klik prejde do `controls.js`, ktorý tlačidlom zatrasie (rovnaký zámok ako na desktope). Položky frontu sú len náhľad.
- výber postáv na telefóne: prvá viditeľná karta je vždy predvybraná bez hlasu (`arenaSilent` na syntetickom
  mouseenter) - pravý panel s náhľadom nikdy nie je prázdny. Hlas mena: dotyk pošle mouseenter dvakrát
  (prehliadač + touch.js), `char-select.js` druhý v rámci 500 ms ignoruje, inak by utol práve spustený hlas. Nové tlačidlo s náhľadom netreba nikde registrovať - stačí mu mouseenter handler ako na desktope.
- pickery (`#dir-picker`, `#aim-picker`, … `#cell-picker`) sa pri štarte presunú do `#touch-layer` (fixná vrstva v body
  zarovnaná na board); MutationObserver ich pri otvorení umiestni na ghost pozíciu (cell-picker = mriežka cez board).
- `:hover` pravidlá sa pri štarte vymažú zo štýlov (sú len kozmetické); runa reaguje na `pointermove`/`pointerdown`.
- **Test:** `node tools/touch-smoke.mjs [--shots <adresár>]` - skutočné dotyky v emulácii telefónu
  (`TOUCH_DEVICE=tablet` = iPad). Pozor: prihlasovacie meno v teste nesmie obsahovať heslo - headless Chrome by
  otvoril správcu hesiel a ten „zje" koniec dotyku.

### Krok 3 - rozloženie na telefóne (hotové)
- **Hra:** štruktúra ako desktop, prepočítaná pre telefón - HUD v stĺpcoch ~150 px po bokoch (celý: portrét, log kola,
  korunky + 1st, hlavy tímu), board v strede väčší (~520×280 px na 844×390), pod ním front [1][2][3]; dole lišta
  tlačidiel ~50×44 px s čitateľnými číslami (golden vľavo, ⏎ a LOCK vpravo).
- **Login:** veľký nápis ARENA, NAME + PASSWORD + ENTER v jednom riadku hore (klávesnica na šírku zakryje spodných ~60 %).
- **Lobby hosta:** dva stĺpce bez rolovania - vľavo formát / počet dlaždíc / časovač / náhľad / farba, vpravo
  percentá dlaždíc s veľkými −/+, veľké START vpravo dole.
- **Zoznam roomiek, výber postáv:** na celú obrazovku, väčšie karty a tlačidlá.

**Ako je to spravené:** telefón = dotyk + kratšia strana fyzického displeja ≤ 500 px (`isPhone` vo `viewport.js`,
trieda `.phone` na `<html>`; tablety nie). Virtuálna obrazovka je na telefóne nižšia (`PHONE_DESIGN_H` 830 namiesto
920), takže všetko vyjde ~15 % väčšie (board ~500×270 px na 844×390). Celé rozloženie je čisté CSS v sekcii
„Telefón" na konci `styles.css` - ovládanie a texty sa tam v dizajnových px zväčšujú, aby mali na displeji veľkosť
pre prst a oko. Výber postáv je dvojstĺpcový (karty | náhľad schopnosti + PICK), login je jeden riadok navrchu,
lobby má dva stĺpce a percentá dlaždíc majú na dotyku tlačidlá −/+ (`lobby.js`). Info riadok s popisom akcie je
na telefóne navrchu (cez ROUND nadpis), lišta tlačidiel je posunutá doprava od menu ☰.
**Pozor pri úpravách:** `#char-select` má na telefóne `display: grid` cez id selektor - preto `:not(.hidden)`,
inak by prebil `.char-select.hidden` a výber postáv by nezmizol.

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
