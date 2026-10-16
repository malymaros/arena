# Zvuky a hudba

Tvorivé rozhodnutia o zvuku robí **vlastník**. Claude dohľadáva voľne dostupné kandidátov a stará sa o techniku.
Ktorý zvuk je čí výber, je evidované priamo v registri.

## Kde čo je

| čo | kde |
|---|---|
| **register** (udalosť → súbor, hlasitosť, status, poznámka) + zdroje a licencie | `public/sounds/manifest.js` |
| knižnica kandidátov (stiahnuté balíky, každý s licenciou) | `public/sounds/lib/<balík>/` |
| vlastné súbory vlastníka | `public/sounds/custom/` |
| **KEDY** čo zaznie - čistá logika (timeline efekt → kľúč, okno akcie), Node aj prehliadač | `public/sounds/events.js` |
| napojenie na hru (volá events.js → sound.js, fáza hry → hudba) | `public/client/sound-map.js` |
| **okná** udalostí zmerané z enginu (ako dlho hra na udalosti stojí) | `public/sounds/windows.json` ← `npm run sounds:windows` |
| prehrávanie (Web Audio, variácie, panoráma, hudba s prelínaním, nastavenia) | `public/client/sound.js` |
| tlačidlo 🔊 v hre (mute, master/hudba/efekty, kláves **M**) + zvuky klikov | `public/client/sound-ui.js` |
| výber a skúšanie zvukov | **`/sound-lab.html`** |
| kontrola registra (súbory existujú, zdroj+licencia, status, žiadny chýbajúci kľúč) | `test/sounds.mjs` (súčasť `npm test`) |
| unit testy mapovania | `test/sound-events.mjs` |
| okná sedia s enginom | `node tools/sound-windows.mjs --check` (súčasť `npm test`) |
| prehľad: čo je default a čo picked, zdroje | `npm run sounds` |

## Status v registri

- **`default`** - dohľadal Claude. Je to len odhad podľa názvu súboru, nikto ho v hre ešte nepočul.
- **`picked`** - vybral vlastník. **Claude ho bez výslovnej žiadosti nemení.**

Prázdne `files: []` znamená vedomé ticho. Pri `picked` je to rozhodnutie, nie chyba.

## Ako vybrať zvuk (workflow vlastníka)

1. Spusti server a otvor `http://localhost:3000/sound-lab.html`.
2. Vľavo sú udalosti. ▶ prehrá aktuálny zvuk, klik na riadok otvorí editor.
3. Vpravo je knižnica. Filtruješ podľa balíka a hľadáš (`punch`, `laser`, `glass`…). Cez ▶ si zvuk vypočuješ, cez **+** ho pridáš k udalosti.
   Ak pridáš viac súborov, pri každom prehratí sa náhodne vyberie jeden (variácie, napríklad kroky).
4. Nastav hlasitosť a stlač **Použiť (prepis)**. Prepis sa uloží do `localStorage` tohto prehliadača
   a **hneď platí aj v hre**, takže si ho vyskúšaš v ozajstnom zápase.
5. **Export zmien** vygeneruje riadky so `status: "picked"`. Vlož ich do `public/sounds/manifest.js`
   (nahradia rovnaké kľúče) alebo ich pošli Claudovi. Potom stlač **Zrušiť všetky prepisy**.

Vlastný súbor (napríklad nahraté vytie pre vlkolaka) nahraj do `public/sounds/custom/`. Lab ho po obnovení stránky ponúkne v balíku `custom`.

## Ako pridať novú udalosť (vývoj)

1. Do `SOUNDS` v manifeste pridaj kľúč so `status: "default"` a poznámkou, kedy zaznie.
2. Spusti ho:
   - timeline efekt zo servera: pridaj ho do mapy `DIRECT` v `public/sounds/events.js` a spusti `npm run sounds:windows`;
   - opakujúce sa efekty (let strely, beaty castu) pridaj aj do `ONCE_PER_RUN`;
   - UI moment: zavolaj `sfx("kľúč")`.
3. Variant pre postavu: kľúč `<udalosť>.<char>` (napríklad `special.werewolf`) prebije všeobecný `<udalosť>`.
4. `npm test` (`test/sounds.mjs`) zlyhá, ak klient prehráva kľúč, ktorý v registri chýba.

Nový balík do knižnice: rozbaľ ho do `public/sounds/lib/<balík>/` aj s licenciou a doplň `SOUND_SOURCES`
(názov, autor, URL, licencia). Test zlyhá, ak balík v `SOUND_SOURCES` chýba.
**Len licencie, ktoré dovoľujú použitie v hre** (CC0 je ideálne; CC-BY si vyžaduje kredit v `SOUND_SOURCES` a v README).

## Okná (cieľová dĺžka zvuku)

Lab pri každej udalosti ukazuje ⏱ **okno v hre**, teda ako dlho hra na tej udalosti stojí, kým ide ďalej.
Nie je to odhad: `tools/sound-windows.mjs` odohrá seedované zápasy botov všetkých dvojíc postáv priamo na engine
a každý frame prejde tou istou logikou (`events.js`), ktorá v hre zvuk spúšťa. Pri súboroch ukazuje dĺžku
(zelená = zmestí sa, oranžová = prečnieva do ďalšej akcie).
**Prispôsobenie oknu** (`public/sounds/fit.js`, pole `fit` v registri, v labe „Keď je zvuk dlhší ako okno“):
`keep` = dohrá celý (nárazy, UI), `fade` = na konci okna sa stíši (casty, lety, kroky), `fit` = zrýchli/spomalí sa
presne na okno, ak stačí ±15 % (inak `fade`). Kratší zvuk sa nikdy nenaťahuje. Bez `fit` platí `defaultFit(kľúč)`.

**Keď sa zmení časovanie hry** (`shared/timing.js`) alebo mapovanie, `npm test` zlyhá, kým nespustíš `npm run sounds:windows`.
Zvukové balíky čas hry nemenia ani nenavrhujú.

## Pravidlá

- Zvuk je čisto klientský. Server ani engine o ňom nevedia, `npm run golden` sa nemení.
- Redakcia platí automaticky: čo server klientovi zamaskoval (labyrint, súperova pasca), to nezaznie
  (zvuk sa nesmie stať únikom informácie, preto **nikdy nehraj zvuk zo stavu, ktorý hráč nevidí**).
- Prehliadač pustí zvuk až po prvom geste (klik, kláves). Hudba sa vtedy rozbehne sama.
- Hudba: lobby, výber postavy a draft hrajú `music.menu`, hra `music.battle`, FINAL ROUND `music.final`
  (ak je prázdne, hrá ďalej battle). Koniec série hudbu stíši a zaznie `game.win`/`game.lose`.

## Zdroje (aktuálne v knižnici)

- **Kenney.nl** - Impact Sounds, Interface Sounds, RPG Audio, Sci-fi Sounds, Digital Audio, Music Jingles - **CC0 1.0**
  (zo Sci-fi balíka sú vynechané dlhé motorové slučky).
- **cynicmusic.com** - *Battle Theme A*, *Town Theme RPG* (OpenGameArt) - **CC0 1.0**.
