# Záznamy zápasov (MATCHES) a rozbor zápasu (ANALYZE) - plán

Návrh vlastníka 2026-11-04. Maketa zoznamu a game over: `public/dev/match-review.html` (sekcie 1-2; sekcia 3
„statický rozbor" je **prekonaná** - rozbor bude skutočná herná obrazovka, viď nižšie).

## Rozhodnutia vlastníka

| Téma | Rozhodnutie |
|---|---|
| Identita | **bez mien** - len biely / čierny + postavy (rovnako ako telemetria) |
| Kto vidí | **každý** prihlásený hráč |
| Rozsah | ukladá sa **bez limitu**, zoznam MATCHES ukáže **posledných 100** (`MATCHES_SHOWN`, jeden posuvník v oranžovej farbe ARENA), najnovšie hore; **séria (BO3 / turnaj) = jeden záznam** (max 3 / 5 hier) |
| Verzia | história sa **vynuluje** pri novej verzii, ktorá by staré záznamy poškodila (viď „Verzia záznamov") |
| Filtre | žiadne (zatiaľ), ani text „last 100 / newest first" |
| Spoločné pozeranie | nie |
| Analýza (grafy, štatistiky, kľúčové momenty) | nie (v tejto fáze) |
| Animované prehrávanie | **nie** - rozbor je statický |
| Pohľad | **biely / čierny** - presne to, čo videl ten hráč (bez „všetko odkryté"); prepína sa **klikom na HUD** (vybraný má zlatý rám) |

## Game over

- Existujúce okno game over (polopriehľadný panel, verdikt v hlavičke hry) dostalo modré **ANALYZE** medzi **▶ PLAY AGAIN**
  (zelené) a **✕ LEAVE ROOM**; tlačidlá rovnako široké. Text `⚪ WHITE WINS` z makety zatiaľ nie (v hre je verdikt
  WINNER! / LOSER!) - potvrdiť s vlastníkom.
- ANALYZE otvorí rozbor **len tohto zápasu** (pri sérii záložky jej hier G1…G5).

## MATCHES (z hlavného menu = room browser)

Jeden riadok = jeden zápas / séria: **dátum a čas**, aréna (kocka = losovaná), formát, štítok bota (VS AI · BABY / NORMAL /
CHEATER), biely vs čierny (hlavy postáv; turnaj = tím 3, mŕtvi zošednutí; **bot = hlava bota** podľa úrovne + meno postavy, ktorú
hral, napr. „AI · NARUTO"), skóre + korunka víťaza, kolá spolu, ikona konca každej hry, štítok **DEMON**, ak sa hral démon.
Klik = rozbalí hry; každá hra má modré **ANALYZE**. Nedohraný zápas (odchod, reset) ostáva, označený UNFINISHED.

### Ako skončila hra (4 ikony, spodný pruh = farba víťaza)

| Ikona | Kedy |
|---|---|
| **aréna** | dlaždica (dmg / IK), Shrek (rev, tackle), smrad, **smrť po Last Stande na konci posledného kola** (doom) |
| **útok** | akákoľvek akcia súpera (basic, melee, special, charge, pasca, **démon**) a aj **vlastná strela cez portál** |
| **mirror** | vlastný útok odrazený súperovým mirrorom |
| **breaker** | shield / mirror breaker súpera |

Démon nie je príčina smrti - hra s démonom dostane len štítok DEMON (v zozname pri zázname aj pri hre).
Príčina sa určí pri zápise z posledného zásahu porazeného (telemetria už má `game_end.lastHit`; doplniť rozlíšenie mirror / breaker /
doom / vlastná strela).

## ANALYZE = herná obrazovka v režime rozboru

Nie samostatná stránka - **normálna obrazovka zápasu** (doska, pozadie arény, HUD s portrétmi, HP/mana, dlaždice, portály, Shrek,
itemy, klon, pasca vo vlastnom pohľade, hmla labyrintu v pohľade prekliateho), ale **úplne statická**:

- figúry v **jednom idle frame** (žiadne animácie, žiadne efekty, žiadne floaty, žiadne zvuky ani hudba);
- mení sa len **stav**: pozície, HP, mana, obrany, stavy, dlaždice, portály, pozícia Shreka, itemy;
- **spodná lišta akcií (tlačidlá) tam nie je** → na jej mieste **väčší panel kola** (tá istá lišta kola ako v hre: golden shield |
  3 + 3 akcie v poradí | golden mana / démon; Last Hope a THE WORLD akcie podľa kola). Všetky akcie oboch strán sú v nej vyplnené
  (v pohľade prekliateho v labyrinte súperove ako „?");
- klik na akciu v paneli (alebo ← / →) = **zelený trojuholník sa presunie pod ňu** a doska ukáže **stav po tej akcii**
  (prvá pozícia = začiatok kola, posledná = koniec kola po dlaždiciach / Shrekovi / doome);
- dole len **◀ ROUND n / N ▶** na prepínanie kôl (↑ / ↓); kolo s démonom má pri čísle štítok DEMON;
- hore: záložky hier série a ✕ (späť na game over / MATCHES);
- **pohľad = klik na HUD**: vybraný HUD (biely alebo čierny) má **zlatý rám** a doska ukazuje to, čo videl ten hráč; klik na
  druhý HUD prepne pohľad (kolo a akcia ostanú). Na začiatku je vybraný pohľad toho, kto rozbor otvoril (divák / MATCHES: biely);
- **THE WORLD**: klik na Jotarovu akciu THE WORLD v paneli kola rozbalí **jeho 3 frozen akcie** (tak, ako ich zadal počas pauzy)
  ako ďalšie bunky panelu - každá sa dá kliknúť (stav po nej; zásahy na súpera počas pauzy sú len ohlásené, HP klesne až v
  kroku „koniec pauzy", ktorý nasleduje po nich). V pohľade súpera sú frozen akcie viditeľné tak, ako ich videl on.

## Dáta

Server pri každom kole (recorder, `telemetry/recorder.js` už segmentuje timeline podľa `frame.act`) uloží pre **každý pohľad**
(`redactTimelineFor(slot, tl)` - presne to, čo dostal hráč) **zápis kola**:

- `start` - snapshot na začiatku kola (pre pohľad),
- `beats[]` - pre každú akciu: komu patrí, ktorý slot lišty (golden / 1-6 / gmana / démon / last hope / THE WORLD), akcia tak, ako ju
  hráč videl (typ, smer / cieľ, alebo `unknown`), a **snapshot po nej** (posledný frame segmentu, bez `effects`),
- `end` - snapshot po konci kola.

Efekty sa neukladajú (statický rozbor ich nepotrebuje) → odhad 5-20 kB na hru po gzip-e (zmerať na prototype), t. j. desiatky MB
za rok. Uloženie: jeden súbor na záznam v `TELEMETRY_DIR/matches/` (alebo vlastný `MATCHES_DIR`); v pamäti len index (dátum, aréna,
postavy, skóre, príčiny konca - pár stoviek B na zápas), celý záznam sa číta z disku až pri ANALYZE. Socket: `matches_list
{ before? }` → stránka zoznamu (napr. 50 riadkov, ďalšie pri skrolovaní), `match_review { id }` → záznam celého zápasu.

### Verzia záznamov

Záznam ukladá **výsledné stavy** (nič sa nedosimulováva), takže zmena pravidiel, balansu ani bota ho nezmení. Kreslí ho však vždy
**aktuálny klient** - pridanie veci (postava, aréna, pole stavu) je bezpečné, premenovanie / odstránenie niečoho, čo starý záznam
obsahuje (pole stavu, postava, sprity, rozloženie lišty kola), ho môže rozbiť. Preto:

- konštanta `MATCH_RECORD_VERSION` (jedno miesto, zdieľané serverom aj klientom); každý záznam ju nesie;
- **minimálne nároky (v2, 2026-11-04):** beat ukladá len rozdiel stavu oproti predošlému (`d`; `diffState` / `applyDiff` / `expandRecord` v `shared/match-record.js`) - záznam ~5× menší (7 demo záznamov 2606 → 506 kB, gzip 43.6 → 23.7 kB); `match_review { id, gz: true }` vráti súbor tak, ako leží na disku (asynchrónne čítanie, server ho nerozbaľuje ani neparsuje), rozbalí a rozvinie ho prehliadač; v pamäti servera je len index;
- server pri štarte záznamy **inej verzie nezobrazí** - história začína odznova (súbory presunie do `matches/old-v<N>/`, nič sa
  nemaže natrvalo; keby sa niekedy oplatilo, dajú sa vrátiť migráciou);
- verziu treba zvýšiť pri každej zmene, po ktorej by starý záznam nevedel klient správne vykresliť. Stráži to test so **vzorovým
  záznamom** (`test/fixtures/match-record.json`): keď ho klient / validátor prestane vedieť načítať, test zlyhá → zvýšiť verziu
  a pregenerovať vzor (podobne ako golden, s vysvetlením v commite).

## Klient

Nový modul `public/client/review.js` (+ `match-list.js`): `body.review-mode` skryje ovládanie a timer, zobrazí veľký panel kola
a ◀ ▶; vykresľuje cez existujúcu cestu stavu bez timeline (`setState` + grid / HUD / `positionActors`), raf v režime rozboru kreslí
len idle frame 0. Žiadny socket príkaz do hry, žiadna hudba / zvuk. Musí fungovať aj pre diváka a po skončení zápasu v miestnosti.

## Okrajové prípady (overiť testom)

THE WORLD (rozbalenie 3 frozen akcií + krok konca pauzy), Last Stand / Last Hope kolo (iný layout lišty), golden akcie, pass, skamenenie,
labyrint (hmla + „?" v pohľade prekliateho, lovec vidí normálne), Narutov klon, Escanorova pride / Werewolf moon (veľkosť figúry
zo stavu), turnajový swap (postava sa mení medzi beatmi), Vampire / Onryō pasca (len vo vlastnom pohľade, kým nevybuchne), Shrek
(pozícia, HP, značky), portály, nedohraný zápas (posledné odohrané kolo).

## Fázy

1. **Prototyp** - zápis kôl z bot zápasu (`tools/match-record-demo.mjs`), režim rozboru v skutočnom klientovi (`/?review=<id>`);
   snímky PC + telefón (`tools/review-shots.mjs`). **Hotové 2026-11-04.**
2. **Ukladanie na serveri** - recorder (`telemetry/match-record.js`), úložisko (`telemetry/match-log.js`), `MATCH_RECORD_VERSION`,
   príčina konca, socket API, test `test/match-record.mjs`. **Hotové 2026-11-04.**
3. **MATCHES + ANALYZE v hre** - tlačidlo MATCHES v room browseri (`public/client/match-list.js`), modré ANALYZE na game over.
   **Hotové 2026-11-04**, čaká na schválenie vzhľadu vlastníkom.

Otvorené: divák nemá okno game over (ANALYZE len cez MATCHES); záznam sa uloží až na konci zápasu (rozohranú sériu
nejde rozobrať, kým neskončí).
