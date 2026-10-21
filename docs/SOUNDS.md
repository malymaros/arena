# Zvuky, hudba a zvukové balíky

O tom, ako hra znie, rozhoduje **vlastník**. Claude dohľadáva voľne dostupných kandidátov a stará sa o techniku.
Zvuky sa robia v **Sound Labe** (`/sound-lab.html`) ako **zvukový balík**, teda zip. Vytvoriť a stiahnuť si ho môže ktokoľvek.
**Do hry ho nasadí len vlastník servera.** Balík **nemení ani nenavrhuje časovanie hry**: zvuk sa prispôsobuje hre, nie naopak.

## Kde čo je

| čo | kde |
|---|---|
| **register** = základný zvuk každej udalosti (súbor, hlasitosť, `fit`, status, poznámka) + zdroje a licencie + `SOUND_API_VERSION`/`KEY_MIGRATIONS` | `public/sounds/manifest.js` |
| knižnica kandidátov (stiahnuté CC0 balíky, každý s licenciou) | `public/sounds/lib/<balík>/` |
| **KEDY** čo zaznie: čistá logika (timeline efekt → kľúč, okno akcie), Node aj prehliadač | `public/sounds/events.js` |
| **okná** udalostí zmerané z enginu (ako dlho hra na udalosti stojí) | `public/sounds/windows.json` ← `npm run sounds:windows` |
| prispôsobenie zvuku oknu (`keep` / `fade` / `fit`) | `public/sounds/fit.js` |
| orezanie na hlavnú časť (automatické nájdenie, prelínanie slučky hudby) | `public/sounds/trim.js` |
| formát balíka: validácia, migrácia, report kompatibility | `public/sounds/pack.js` |
| zip bez závislostí (zápis store, čítanie store + deflate, CRC) | `public/sounds/zip.js` |
| koncept balíka v prehliadači (IndexedDB) + „Vyskúšať v hre“ | `public/sounds/draft-store.js` |
| nainštalované balíky + aktívny (generované, neupravovať ručne) | `public/sounds/packs/index.js`, `public/sounds/packs/<id>/<verzia>/` |
| prehrávač: vrstvy základ → aktívny balík → koncept, Web Audio, hudba | `public/client/sound.js` |
| napojenie na hru (timeline → events.js → sound.js, fáza hry → hudba) | `public/client/sound-map.js` |
| zvukové okno z menu ☰ (mute, master/hudba/efekty s −/+, na dotyku vo veľkosti displeja; kláves **M** = mute) + zvuky klikov | `public/client/sound-ui.js` |
| editor balíka | **`/sound-lab.html`** |

## Ako vytvoriť balík (ktokoľvek)

1. Otvor `/sound-lab.html` (lokálne `http://localhost:3000/sound-lab.html` alebo na živom webe; server nič neukladá).
2. Vpravo hore vyplň **názov**, **id** a **autora** balíka.
3. **Všetky udalosti** alebo **Podľa postavy**: klikni na zvuk a jeho úprava sa ukáže napravo (▶ ho prehrá, znova ▶ / **■ Stop** / **Esc** ho zastaví).
   - ⏱ **okno v hre** ukazuje, ako dlho hra na tej udalosti stojí. Dĺžky súborov sú zelené, ak sa zmestia, a oranžové, ak prečnievajú.
   - Pohľad **Podľa postavy** ukazuje všetky zvuky jednej postavy. Šedé „spoločný“ znamená, že hrá rovnaký zvuk ako ostatné postavy.
     Keď jej priradíš vlastný, vznikne kľúč `<udalosť>.<postava>` (napríklad `hit.naruto` = Narutov hlas pri zásahu).
4. Z **knižnice** pridávaš zvuky cez „+“. Vlastné súbory (ogg/mp3/wav/webm, max 8 MB) **pretiahneš** do poľa nad knižnicou.
   Viac súborov pri jednej udalosti = pri každom prehratí náhodne jeden.
5. Nastav hlasitosť a režim **„Keď je zvuk dlhší ako okno“**. **Každá zmena sa uloží hneď** do konceptu, ktorý prežije refresh aj zatvorenie okna.
   Prvou zmenou vznikne **nový balík** s generickým názvom (napríklad „Balík 16.10. 14:32“). Pôvodný ostáva nezmenený.
   Hore je stále vidieť stav: *▶ bez zmien* / *✎ N zmien oproti „…“ · NEULOŽENÉ* / *✓ uložený*. Zmenené zvuky majú v zozname štítok **zmenené**.
6. **Vyskúšať v hre**: zapni prepínač a obnov stránku hry. Hra potom v tomto prehliadači hrá tvoj koncept.
7. **💾 Uložiť balík** stiahne `<id>-v<verzia>.zip`. Ďalšie zmeny sú ďalšia verzia toho istého balíka. **Začať odznova** vráti predvolené zvuky.
   **Načítať balík…** otvorí zip (svoj alebo cudzí) a ukáže report kompatibility. Potom môžeš v balíku pokračovať.

## Ako nasadiť balík (len vlastník servera)

```
node tools/sound-pack.mjs install ~/Downloads/moj-balik-v3.zip --activate
npm test                       # balíky sa kontrolujú aj v teste
git add public/sounds/packs && git commit -m "Zvukový balík moj-balik v3"
# deploy podľa CLAUDE.md
```
`node tools/sound-pack.mjs activate moj-balik@2` vráti staršiu verziu (staré verzie ostávajú nainštalované).
`node tools/sound-pack.mjs check` a `node tools/sound-pack.mjs report` vypíšu stav. Na serveri nie je žiadny upload, balík ide do hry len cez git.

## Verzie a kompatibilita

Balík (`pack.json`) nesie tri nezávislé verzie:

| čo | pri nesúlade |
|---|---|
| `format` (schéma `pack.json`, `PACK_FORMAT` v `pack.js`) | novší formát sa odmietne („aktualizuj hru“) |
| `soundApi` (sada udalostí, `SOUND_API_VERSION` v manifeste) | staršie kľúče sa preložia cez `KEY_MIGRATIONS`, zrušené vypadnú s poznámkou, novšie API sa odmietne |
| `madeForMs` pri každej položke (okno v čase tvorby) | ak sa okno v hre posunie o viac ako 10 %, príde upozornenie. Zvuk hrá ďalej a prispôsobí sa cez `fit` |

Report má tri úrovne: **ok**, **upozornenia** (balík funguje) alebo **nekompatibilný** (nedá sa načítať ani nainštalovať).

**Pravidlo pre vývoj:** premenovanie alebo zrušenie udalosti znamená zvýšiť `SOUND_API_VERSION`, doplniť `KEY_MIGRATIONS[nová] = { "starý": "nový" | null }`
a spustiť `node test/sound-pack.mjs --snapshot`. Test zlyhá, ak kľúč zmizne bez migrácie. Pridanie udalosti verziu nemení.

## Okná a prispôsobenie zvuku

Okno nie je odhad. `tools/sound-windows.mjs` odohrá seedované zápasy botov všetkých dvojíc postáv priamo na engine
a každý frame prejde tou istou logikou (`events.js`), ktorá v hre zvuk spúšťa.
Režimy `fit`:
- `keep` dohrá celý zvuk (nárazy, UI);
- `fade` sa na konci okna stíši (casty, lety, kroky);
- `fit` zrýchli alebo spomalí zvuk presne na okno, ak stačí ±15 % (inak `fade`).

Kratší zvuk sa nikdy nenaťahuje. Bez `fit` platí `defaultFit(kľúč)`.
**Keď sa zmení časovanie hry** (`shared/timing.js`) alebo mapovanie, `npm test` zlyhá, kým nespustíš `npm run sounds:windows`.
Balíky potom report označí upozornením na posunuté okno.

## Orezanie a slučka hudby

Každý súbor v položke môže mať **orezanie** `trim: { "<súbor>": [začiatokMs, koniecMs] }`:
- **efekt** začne rovno hlavnou časťou a skončí na konci úseku;
- **hudba** sa opakuje len v úseku a posledných ~1,5 s (pri krátkom úseku tretina) sa **prelínia so začiatkom**. Skladba tak nestíchne ani neskočí, aj keď má tichý alebo doznievajúci koniec.

V labe sa orezanie nastaví **automaticky pri pridaní súboru**: hlavná časť je hlasitosť nad 5 % maxima, s malou rezervou.
Pri súbore ho zmeníš cez **✂**: začiatok a koniec v ms, **Auto**, **Celé**, **▶ Od začiatku** a pri hudbe **▶ Prechod slučky** (začne kúsok pred koncom, aby bolo počuť prelínanie).

## Register: `default` vs `picked`

- **`default`** - dohľadal Claude. Je to len odhad podľa názvu súboru, nikto ho v hre ešte nepočul.
- **`picked`** - vybral vlastník. **Claude ho bez výslovnej žiadosti nemení.**

Prázdne `files: []` znamená vedomé ticho. `npm run sounds` vypíše, čo je ešte default.

## Hlas postavy vs. efekt

Hlas je **samostatná vrstva** popri zvuku efektu (`VOICE` v `events.js`): `voice.attack` / `voice.melee` / `voice.special`
(kľúč postavy `voice.melee.fire`) zaznie **raz na začiatku akcie** a jeho okno je celá akcia. Efekt ide zvlášť:
`melee` znie pri **každom z 3 švihov**, `attack`/`special` raz za beh. `voice.attack` pokrýva aj strelu mimo plochy.
Narutov klon hlas nemá. Hlas mena pri výbere postavy = `ui.hover_char.<postava>`. Základ je ticho (`files: []`).

Výnimky (`VOICE` / `VOICE_BY_CHAR`): Jotarov THE WORLD (`timestop_start`) → `voice.special`, jeho Special 2 (efekt
`special`) → `voice.special2`, Special 1 (slot mirroru) → tiež `voice.special2`; úder Vampire/Onryō `vamp_strike` (melee na
vlastnej bunke, úder po charge, úder pasce) → `voice.melee`.

**Hlasitosť hlasov:** `node tools/voice-loudness.mjs --write` premeria všetky hlasy (`custom/` nahrávky) v **LUFS**
(EBU R128, v úseku `trim`) a nastaví `vol` na cieľ **−18 LUFS** s rezervou vrcholu −1 dBFS (`vol` najviac 2 =
zosilnenie tichej nahrávky). Spusti ho po každom pridaní/výmene nahrávky hlasu; bez `--write` len vypíše tabuľku.

## Ako pridať novú udalosť (vývoj)

1. Do `SOUNDS` v manifeste pridaj kľúč so `status: "default"` a poznámkou, kedy zaznie.
2. Spusti ho:
   - timeline efekt: pridaj ho do `DIRECT` v `events.js` (opakujúci sa efekt aj do `ONCE_PER_RUN`) a spusti `npm run sounds:windows`;
   - UI moment: zavolaj `sfx("kľúč")`.
3. `node test/sound-pack.mjs --snapshot` (aktualizuje snímku kľúčov aktuálnej verzie API).

Nový balík do knižnice: rozbaľ ho do `public/sounds/lib/<balík>/` aj s licenciou a doplň `SOUND_SOURCES`.
**Len licencie, ktoré dovoľujú použitie v hre** (CC0 ideálne; CC-BY si vyžaduje kredit).

## Testy

| test | čo overuje |
|---|---|
| `test/sounds.mjs` | register: súbory existujú, zdroj + licencia, status, `fit`; každý prehrávaný kľúč je v registri |
| `test/sound-events.mjs` | mapovanie timeline → udalosti (raz za beh, move/dash, skrytý súper, prahy, okná) |
| `node tools/sound-windows.mjs --check` | okná sedia s aktuálnym enginom |
| `test/sound-fit.mjs` | prispôsobenie oknu |
| `test/sound-trim.mjs` | orezanie (detekcia hlavnej časti, prelínanie slučky, validácia `trim`) |
| `test/sound-pack.mjs` | zip, validácia, migrácia, report, snímka kľúčov API, inštalátor |
| `node tools/sound-pack.mjs check` | nainštalované balíky sú platné voči aktuálnej hre |
| `node tools/sound-smoke.mjs` (manuálne) | reálny prehliadač: odomknutie zvuku, lab nahratie → export → import, „Vyskúšať v hre“ |

Všetko okrem `sound-smoke` beží v `npm test` (aj v CI). Zvuk je čisto klientský, `npm run golden` sa nemení.

## Pravidlá

- Server ani engine o zvuku nevedia.
- Redakcia platí automaticky: čo server klientovi zamaskoval (labyrint, súperova pasca), to nezaznie.
  **Nikdy nehraj zvuk zo stavu, ktorý hráč nevidí.**
- Prehliadač pustí zvuk až po prvom geste. Hudba sa vtedy rozbehne sama.
- Hudba: lobby, výber a draft hrajú `music.menu`, hra `music.battle`, FINAL ROUND `music.final` (ak je prázdne, hrá ďalej battle).
  Koniec série hudbu stíši a zaznie `game.win`/`game.lose`.

## Zdroje knižnice

- **Kenney.nl** - Impact Sounds, Interface Sounds, RPG Audio, Sci-fi Sounds, Digital Audio, Music Jingles - **CC0 1.0**
  (zo Sci-fi balíka sú vynechané dlhé motorové slučky).
- **cynicmusic.com** - *Battle Theme A*, *Town Theme RPG* (OpenGameArt) - **CC0 1.0**.
