# Výkon na mobile a tablete - implementačný plán

Cieľ: hra nesmie sekať na strednom telefóne/tablete, hlavne pri vyvolaní démona (Last Stand) a Last Hope.
Všetko je **čisto klientske** (engine/server sa nemení → `npm run golden` ostáva bez zmeny). Postup je etapový:
po každej etape hra funguje, lint/testy prechádzajú a vzhľad na desktope je rovnaký (ak etapa výslovne
nehovorí inak).

## Diagnóza (stav 2026-10-22)

Čo beží počas démona (Last Stand) a prečo to bolí:

| # | Miesto | Problém |
|---|---|---|
| D1 | `actorFilter` (`public/client/board-fx.js`) | zlatá žiara = `brightness` + `saturate` + **7× `drop-shadow`**, hodnoty sa menia **každý frame** → GPU prekreslí filter postavy 60×/s. To isté (bez brightness) robí `pulseGlow` pri shielde/mirrore. |
| D2 | `raf.js` + `placeChargeAura` | `getComputedStyle(actorEl).left/top` v každom frame (démon za postavou + každá aura) → vynútený prepočet štýlov/layoutu uprostred zápisov. |
| D3 | `spawnChargeAura` | permanentná zlatá aura sa vytvára **každých 950 ms** (žije 1100 ms → 2 naraz): 18 pásikov, každý s `box-shadow` a nekonečnou animáciou, + jadro s radial-gradientom a ring s box-shadow. Ustavičné vytváranie/mazanie DOM. |
| D4 | `styles.css` `.hud-box.death-golden .bar` | `death-bar-pulse` animuje **`box-shadow`** (repaint každý frame), k tomu `drop-shadow` na ikonách. |
| D5 | `overlays.js` `deathFog`/`hopeFog` | 560×560 div s **`filter: blur(28px)`**. |
| D6 | `last-stand.js` | nástup/odchod démona a Last Hope animuje **`filter: blur(18px)`** na veľkom canvase (démon 2× zväčšený). |
| D7 | `assets/death/spritesheet_strip.png` 5024×314, `assets/hope/sprite_strip.png` **9216×512** (~19 MB v pamäti) | šírka nad 4096 px = limit textúry na mnohých mobilných GPU (iOS) → delenie/opakovaný upload, pomalé dekódovanie. |
| D8 | `raf.js` | `deathCenter` + `deathBehind` (a Last Hope) sa kreslia **aj keď sú neviditeľné** (opacity 0). |
| D9 | `overlays.js` | backing canvasu Last Hope je 943×629 px, démona ~370 px, hoci zdrojový frame je menší (768×512, 314×314) → zbytočne veľká plocha na vyplnenie. |
| D10 | `raf.js` | slučka beží na plnej frekvencii displeja (60–120 Hz), hoci sprity menia frame ~10×/s. |
| D11 | `raf.js` a ďalšie | `el.style.filter/left/top/…` sa zapisuje každý frame aj s rovnakou hodnotou → zbytočné invalidácie štýlu. |
| D12 | `styles.css` `body.labyrinth-mode #arena`, `body.timestop-mode #arena` | stmavenie arény cez `filter` s transition. |
| D13 | `grid.js` `renderGrid` | `gridEl.innerHTML = ""` + nové bunky pri **každom frame timeline** (nie každom raf frame - nízka priorita). |
| D14 | `viewport.js` | celý `<body>` je zmenšený `transform: scale`; či to zdražuje filtre, treba **overiť meraním** (Chrome zvyčajne rasterizuje už v cieľovej mierke). |

## Etapa 0 - meranie (baseline)

Bez čísel nevieme, čo pomohlo. Nástroj `tools/perf-probe.mjs` (podobný `browser-smoke.mjs`, rovnaký spôsob
spustenia Chrome/Edge cez CDP):

1. Emulácia telefónu 844×390, `touch`, **CPU throttling 4×** (`Emulation.setCPUThrottlingRate`).
2. Spectate seeded bot zápasu, v ktorom padne Last Stand aj Last Hope. Seed nájsť cez engine headless
   (`tools/simulate.mjs` - spočítať `lastStand`/`lastHope` efekty pre seedy). Ak random-bot démona nikdy
   nevolá, pridať mu do `tools/random-bot.mjs` voľbu, ktorá ho pri splnených podmienkach zvolí.
3. Zbierať `Tracing` (kategórie `devtools.timeline`) a z neho počítať: % hlavného vlákna, % frame-ov > 50 ms,
   súčet `RecalculateStyles`, `Layout`, `Paint`, `CompositeLayers` - **zvlášť pre okno démona** (od efektu
   summon po koniec kola) a pre bežné kolo.
4. Výstup: tabuľka do terminálu + `--json` do `tmp/perf/`; `--compare` spustí aj HEAD (ako browser-smoke)
   a vypíše rozdiel.

Výsledok etapy: tabuľka „pred" do tohto súboru. Každá ďalšia etapa doplní riadok „po".

## Etapa 1 - prepínač „lite" (infra)

Nový modul `public/client/perf.js`:

- `perf.lite` (bool) + trieda `html.perf-lite`. Predvolene **zapnuté na dotyku** (`isTouch` z `viewport.js`).
- Override: `?perf=lite|full` v URL (uložené do `localStorage` v try/catch) a prepínač v menu ☰
  („Úsporná grafika") - `public/client/menu.js`.
- **FPS strážca:** v `raf` kĺzavý priemer dĺžky frame-u; ak je 3 s nad ~25 ms (pod ~40 FPS), prepne sa
  `lite` automaticky (iba smerom nadol, nikdy späť počas zápasu; v manuálnom režime full sa nezapína).
- `perf.fpsCap` (30 v lite, inak 0 = bez limitu) - použije etapa 7.

Ďalšie etapy čítajú `perf.lite` (JS) alebo `.perf-lite` (CSS). Desktop bez dotyku = full, vzhľad sa nemení.

## Etapa 2 - žiara postáv bez CSS filtra každý frame (D1)

Najväčší očakávaný zisk. Platí pre zlatú žiaru (Last Stand), shield/mirror pulz aj statické „YOU".

1. **Glow vrstva namiesto `drop-shadow`:** ku každému aktérovi (`actorP1/P2`, klony) pridať druhý canvas
   za postavu (`actor-layers.js`). Do neho sa kreslí ten istý sprite frame cez `ctx.shadowBlur` +
   `shadowColor` (resp. silueta vyplnená farbou + `filter: blur` **raz do canvasu**, nie ako CSS filter).
   Prekresľuje sa **iba pri zmene frame-u spritu alebo farby** (~10×/s, rovnaký kľúč ako `drawSprite` cache).
2. **Pulz = len `opacity`** glow vrstvy (kompozítor, žiadny repaint). Zlatý jas postavy
   (`brightness`/`saturate`) nahradiť statickou triedou s pevnou hodnotou; pulz jasu robiť cez opacity
   druhej, „presvetlenej" kópie (alebo v lite úplne vypustiť).
3. `actorFilter` vráti už len statickú časť (alt-color, kameň) → hodnota sa mení len pri zmene stavu.
4. Desktop (full): vizuálne čo najbližšie k súčasnosti - porovnať screenshoty (`tools/screens.mjs`
   + ručné porovnanie počas Last Stand / shieldu / mirroru).
5. Lite: menej vrstiev rozostrenia (1 obrys + 1 žiara).

Pozor: klon (`isClone`) zlatú žiaru nemá; skrytý súper v labyrinte (x null) glow vrstvu nesmie ukázať.

## Etapa 3 - pozícia postavy bez `getComputedStyle` (D2) + `transform` namiesto `left/top`

1. V `placement.js` (`positionActors`) pri každom nastavení cieľovej `left/top` uložiť pohyb:
   `actorMotion[slot] = { x0, y0, x1, y1, t0, dur, easing }` (dur = rovnaký ako CSS transition, `none` =
   okamžite). Funkcia `liveActorPos(slot, now)` vráti interpolovanú pozíciu **výpočtom**, bez čítania DOM.
   To isté pre klony (`cloneEls`).
2. Nahradiť všetky `getComputedStyle(actorEl)` v `raf.js` a `board-fx.js` (`placeChargeAura`) volaním
   `liveActorPos`. Easing musí sedieť s CSS (napr. `linear`/`ease` → rovnaká krivka v JS), inak démon/aura
   „kĺže" vedľa postavy - overiť spomaleným prehrávaním.
3. Démona za postavou (`deathBehind`) a aury posúvať cez `transform: translate(...)` namiesto `left/top`
   (kompozítor, žiadny layout).
4. Zvyšné `getComputedStyle` (`dom.js`, `viewport.js`) sú pri štarte/resize - nechať.

## Etapa 4 - lacná aura (D3)

1. **Jedna trvalá aura na slot** namiesto novej každých 950 ms: vytvoriť pri zapnutí Last Stand/Last Hope,
   animácie v CSS nekonečne (`infinite`), zmazať pri konci stavu. Jednorazová aura pri bežnom recharge
   ostáva (vytvára sa raz za akciu).
2. Pásiky (`.ca-streak`): `box-shadow` nahradiť gradientom v samotnom pozadí (svetlý stred → priehľadný
   okraj), animovať iba `transform`/`opacity`. Ring: žiara cez druhý priehľadný ring/gradient, nie
   `box-shadow`.
3. Lite: 8 pásikov namiesto 18. Náhodné rozloženie pásikov ostáva cez `Math.random` - je to čisto vizuál
   na klientovi (pravidlo o `rand()` platí pre hernú logiku).

## Etapa 5 - HUD, hmla a nástup démona bez drahých filtrov (D4, D5, D6, D12)

1. **HP/mana bar** (`death-bar-pulse`): statická žiara v `::after` (box-shadow raz), animuje sa iba
   `opacity` pseudo-elementu. Ikony: statický `drop-shadow` je OK (nemení sa), len overiť, že nie je
   v animovanom predkovi.
2. Prejsť ostatné `@keyframes` v `styles.css`, ktoré animujú `box-shadow`/`filter` (~22) - rovnaký
   prepis tam, kde bežia nekonečne alebo počas hry (napr. pulz tlačidiel `armed`). Jednorazové krátke
   animácie môžu ostať.
3. **Hmla** (`deathFog`/`hopeFog`): `filter: blur(28px)` nahradiť `radial-gradient` s mäkkým okrajom
   (rovnaký vzhľad, nulová cena za blur).
4. **Nástup/odchod démona a Last Hope** (`last-stand.js`): v lite bez `blur`, len `opacity` + `scale`.
   Vo full ponechať blur, ale zvážiť menší (napr. 8 px) - rozhodne porovnanie.
5. **Stmavenie arény** (labyrinth/timestop): namiesto `filter` na `#arena` tmavá vrstva nad arénou
   s `opacity` (labyrint) a pre timestop grayscale aplikovaný **raz do canvasov pozadia** pri zapnutí
   (alebo ponechať filter, ak meranie ukáže, že statický filter po dobehnutí transition nestojí nič).

## Etapa 6 - sprity démona a Last Hope (D7, D8, D9)

1. **Atlas namiesto pásu:** nový skript `tools/sprites-overlays/build.cjs` (pngjs, ako ostatné
   `tools/sprites-*`) prerobí oba pásy na mriežku, ktorá sa zmestí do 4096×4096:
   démon 16 framov → 4×4 (1256×1256), Last Hope 12 framov → 4×3 (3072×1536). Originály uložiť do
   `tools/sprites-overlays/src/`.
2. `drawSprite`/`ensureSpriteMeta` (`sprites.js`): podpora `anim.cols` (a `frames`) - `sx = (idx % cols) * fw`,
   `sy = floor(idx / cols) * fh`. Bez `cols` sa správa ako doteraz (pás). Rozšíriť cache kľúč o `sy`.
3. **Mobilná varianta** len ak meranie ukáže, že pamäť/dekódovanie stále bolí: polovičné framy
   (`*_m.png`), výber podľa `perf.lite` v `demon-sprites.js`. Pri pixel-arte overiť vizuál.
4. **Nekresliť neviditeľné:** v `raf.js` kresliť `deathCenter`/`deathBehind`/`hopeCenter` iba keď je
   overlay viditeľný (príznak nastavovaný v `last-stand.js` pri appear/disappear, nie čítanie opacity).
5. **Menší backing canvasu:** `width/height` canvasu = veľkosť zdrojového frame-u (314², 768×512), CSS
   rozmer ostáva rovnaký + `image-rendering: pixelated` → menej pixelov na vyplnenie, rovnaký výsledok.
6. Prednačítať (`ensureSpriteMeta` + `img.decode()`) sprity démona a Last Hope pri štarte hry, nech
   prvé vyvolanie nečaká na dekódovanie.
7. `node tools/browser-smoke.mjs --compare` - množina načítaných spritov sa zmení zámerne (nové súbory).

## Etapa 7 - slučka a zápisy štýlov (D10, D11)

1. **Limit FPS v lite:** `raf` preskočí kreslenie, ak od posledného frame-u ubehlo < 33 ms
   (`perf.fpsCap`). `tickTurnTimer` beží vždy (lacné). CSS transition pohybu a projektilov bežia
   v prehliadači nezávisle, takže pohyb ostane plynulý.
2. **Zápis len pri zmene:** helper `setStyle(el, prop, value)` v novom `public/client/style-cache.js`
   (WeakMap el → posledné hodnoty). Použiť v `raf.js` na všetky zápisy, ktoré sa opakujú každý frame
   (`filter`, `display`, `left/top`, `transform`, `opacity`), a pre `classList.toggle` volať len pri zmene.
3. **`will-change: transform`** pre aktérov, klony, démona za postavou, projektily a stredové overlaye -
   iba prvky, ktoré sa naozaj hýbu (každá vrstva zaberá GPU pamäť; overiť v DevTools „Layers").

## Etapa 8 - nízka priorita (D13, D14)

1. **`renderGrid`:** bunky vytvoriť raz a pri frame timeline meniť len triedy/obsah zmenených buniek
   (diff podľa kľúča bunky). Robiť iba ak meranie ukáže `renderGrid` v profile prehrávania kola.
2. **Mierka `<body>`:** zmerať, či filtre/tiene v zmenšenom body stoja viac než v nezmenšenom
   (porovnať rovnakú scénu pri `scale 1` a `0.45`). Nižšie dizajnové rozlíšenie pre telefón je veľký
   zásah do layoutu (`docs/MOBILE.md`) - iba ak to čísla jasne ukážu.

## Stav realizácie (2026-10-22) - čo sa urobilo inak než v pláne

Všetky etapy sú hotové (commity „Výkon etapa N"). Odchýlky od plánu a prečo:

- **Etapa 2 (žiara):** namiesto druhej glow vrstvy za postavou (pozíciu/otočenie/veľkosť postavy nastavuje
  viac modulov - kópia by sa ľahko rozišla) má lite **statickú žiaru z 2 drop-shadow vrstiev** (namiesto 7
  pulzujúcich). Full (desktop) má pulz krokovaný po 100 ms - vzhľad rovnaký, samotné krokovanie však meranie
  takmer nezlepšilo (zisk prináša až lite).
- **Etapa 3:** démon za postavou a aury ostali na `left/top` (nie `transform`) - banish démona animuje
  `transform` cez WAAPI a nebili by sa. Kľúčové bolo odstrániť vynútený prepočet štýlov (`getComputedStyle`);
  zápisy `left/top` sa navyše robia len pri zmene (stojaca postava = žiadny layout).
- **Etapa 5:** stmavenie pri THE WORLD (grayscale) ostáva filtrom - tmavá vrstva by odfarbenie nenahradila
  a THE WORLD je zriedkavý; labyrint má v lite tmavú vrstvu.
- **Etapa 6:** polovičné rozlíšenie spritov pre mobil sa nerobilo - Last Hope sa na telefóne s vysokým DPR
  zobrazuje väčší než zdroj, zmenšenie by bolo vidno. Atlas zväčšil sťahovanie len o 3.5 %.
  V headless meraní je etapa neutrálna (limit textúr a pamäť sa prejavia až na reálnom mobilnom GPU).
- **Etapa 7:** `will-change` sa vyskúšal (A/B) - bez merateľného zisku, len GPU pamäť navyše → nezaradený.
- **Etapa 8:** `renderGrid` je v profile démona < 1 % času → bez zmeny. Zmenšenie `<body>` (viewport.js)
  výkon nebrzdí: tá istá scéna bez zmenšenia (1720×920, DPR 1) stojí viac hlavného vlákna (démon 86 %)
  než zmenšená na telefóne s porovnateľným počtom pixelov (844×390, DPR 2: 64 %) → nižšie dizajnové
  rozlíšenie by nepomohlo.

## Overenie po každej etape

- `npm run lint` (0 chýb, 0 varovaní), `npm test`, `npm run golden` (musí ostať bez zmeny - engine sa nemení).
- `node tools/browser-smoke.mjs` (žiadne JS chyby / 4xx), `node tools/touch-smoke.mjs`.
- `node tools/screens.mjs` - vizuál desktop/tablet/telefón.
- `node tools/perf-probe.mjs --compare` - doplniť riadok „po" do tabuľky nižšie.
- Ručne na reálnom telefóne (`chrome://inspect`): Last Stand, Last Hope, shield/mirror glow, labyrint, THE WORLD.

## Poradie a očakávaný prínos

| Etapa | Prínos | Riziko |
|---|---|---|
| 0 meranie | - (nutné) | nízke |
| 1 lite prepínač | infra | nízke |
| 2 žiara | **vysoký** (aj mimo démona - shield/mirror/YOU) | stredné (vizuál) |
| 3 pozícia bez getComputedStyle | **vysoký** počas pohybu | stredné (synchronizácia s CSS easing) |
| 4 aura | stredný-vysoký | nízke |
| 5 HUD/hmla/nástup/aréna | stredný | nízke |
| 6 sprity | stredný (hlavne iOS, prvé vyvolanie) | nízke |
| 7 slučka/zápisy | stredný (batéria, teplota) | nízke |
| 8 grid/mierka | nízky / neistý | stredné-vysoké |

## Výsledky merania

`node tools/perf-probe.mjs` - telefón 844×390 (DPR 3, dotyk), CPU 4× spomalené, headless Chrome, medián z 3 behov.
Okná: **round** = prehrávanie bežného kola, **golden** = plánovanie v zlatom stave (Last Stand buff, 4 s),
**demon** = finálne kolo (Last Hope + démonov útok + banish). Hl. vlákno = % času, keď je hlavné vlákno
obsadené; style = súčet Recalculate Style v okne (ms).

| Stav | round hl.vl. % | golden hl.vl. % | golden FPS | demon hl.vl. % | demon FPS | demon snímky > 50 ms % | demon style ms |
|---|---|---|---|---|---|---|---|
| pred (etapa 0) | 49.3 | 97.0 | 39.7 | 97.2 | 27.4 | 12.8 | 2074 |

**Záverečné A/B** (`--ab 26e29cd`, striedavé behy, medián; 26e29cd = klient pred zmenami, po = f431db1):

| Zariadenie / režim | okno | hl. vlákno % | GPU % | FPS | snímky > 50 ms % | p95 snímka ms |
|---|---|---|---|---|---|---|
| telefón, lite (predvolené na dotyku), 5+5 behov | round | 56 → 44 | 22 → 18 | 52 → 51 | 1.0 → 0.7 | 18 → 18 |
| | golden | 97 → 48 | 83 → 15 | 37 → 56 | 10.2 → 0.0 | 53 → 18 |
| | demon | 98 → 67 | 85 → 19 | 23 → 51 | 36.0 → 1.4 | 88 → 19 |
| tablet 1180×820, lite, 3+3 | golden | 92 → 52 | 89 → 16 | 31 → 55 | 20.3 → 0.0 | 54 → 19 |
| | demon | 94 → 71 | 90 → 20 | 19 → 50 | 53.5 → 1.2 | 107 → 35 |
| telefón, full (vzhľad desktopu), 3+3 | golden | 97 → 95 | 82 → 80 | 36 → 39 | 9.2 → 5.4 | 53 → 53 |
| | demon | 98 → 98 | 86 → 83 | 23 → 25 | 34.0 → 27.6 | 89 → 72 |

Full režim (desktop) dostal len zmeny bez vplyvu na vzhľad (poloha bez getComputedStyle, trvalá aura, zápisy
len pri zmene, kreslenie len viditeľných overlayov) - JS pri démonovi 9.7 → 4.6 s, FPS takmer rovnaké. Tablet
v nečinnom okne ukázal mierne vyššie GPU (18 → 26 %) - v rámci rozptylu behov, telefón tam naopak klesol.
