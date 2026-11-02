# Ťažký AI bot — plán

Stav: **schválené 2026-11-02, A0 hotové** (`exportState`/`loadState` + `io.noFrames` v engine, `tools/ai-bench.mjs`:
1440 kôl bit-identických s hlavným enginom, ~0,1 ms na simulované kolo vrátane kópie stavu = ~9 400 kôl/s na jadro).

Cieľ: jeden bot, ktorý hrá **čo najlepšie** a **nepodvádza** — rozhoduje len z toho, čo by na jeho mieste
videl človek. Žiadne úrovne obtiažnosti.

## 1. Prečo nie minimax

Kolo je **simultánna hra so skrytou informáciou** (obaja zadajú 3 akcie naslepo; labyrint, pasca, vypnutý
preview). Neexistuje jeden najlepší ťah, existuje najlepší **mix** (Nashova rovnováha, ako kameň–papier–nožnice).
Bot, ktorý vždy hrá „najlepšie", je deterministický → človek ho po pár kolách prečíta a zneužije.
Bot preto v každom kole **vypočíta pravdepodobnosti front a náhodne z nich vyberie** (vlastný seedovaný RNG).

## 2. Nepodvádzanie (tvrdé pravidlo)

- Vstup bota = **`snapshotFor(svoja osoba)`** + história snapshotov/timeline, ktoré dostal (rovnaké dáta ako klient,
  už zredigované: súperova pasca, labyrint — poloha/mana/obrana/klon lovca, `pending` pri vypnutom preview,
  slepý draft). Nikdy `engine.game`, súperov `draft`, ani herný `rand`.
- **Budúca náhoda:** simulácie bežia s vlastným RNG bota, nie s forknutým herným `rand` (inak by bot „videl"
  budúce spawny dlaždíc / portálov / Shrekove skoky pri vypnutom preview).
- **Skrytý stav** sa dopĺňa **determinizáciou**: bot vygeneruje K vierohodných verzií (kde môže byť lovec
  podľa Ariadninej nite a známych krokov, kde môže byť pasca, aká je súperova mana v labyrinte) a výsledky spriemeruje.
- Bot rozhoduje **hneď na začiatku kola** (nečaká, či/kedy človek zamkol — aj to je informácia).
- **Test `test/ai-fair.mjs`:** náhodne zmeníme skryté polia skutočného stavu (súperova pasca, poloha lovca, súperov
  draft, herný seed) → rozhodnutie bota (pri rovnakom vlastnom seede) musí byť **bit-identické**.

## 3. Architektúra

```
engine/ai/
  sim.js        stav zo snapshotu → simulačný engine (fork), rýchly režim bez frame-ov
  candidates.js generovanie rozumných front (vlastné + súperove)
  eval.js       hodnotiaca funkcia stavu
  solve.js      maticová hra + regret matching → mix
  belief.js     determinizácia skrytého stavu
  model.js      model súpera (tendencie počas zápasu)
  bot.js        decide(view, history, rng, budgetMs) → fronta | timestop fronta | postava | tím
server.js       virtuálny hráč B v miestnosti, výpočet vo worker_threads
```

### 3.1 Simulácia (`sim.js`)
- Engine dnes nevie klonovať stav. Pridáme `createEngine` interný vstup na **nastavenie stavu**
  (`loadState(state, rng)`) — logika sa nemení, goldeny ostanú.
- **Rýchly režim:** `pushStateFrame` robí pri každom frame plný snapshot — pre bota zbytočné. Príznak
  `io.noFrames` → frame obsahuje len efekty (bez snapshotu). Pred zavedením zmerať; `node tools/difftest.mjs`
  musí ostať 0 diffov.
- Rozpočet: dnes ~0,15 ms/kolo vrátane frame-ov → cieľ < 0,05 ms/kolo v rýchlom režime.

### 3.2 Kandidáti (`candidates.js`)
Platných front sú stovky až tisíce. Do matice ide ~40–80 na stranu:
- heuristiky: útok na bunky, kde súper pravdepodobne skončí (po jeho rozumných pohyboch), special na zóny,
  obrana/breaker pri hrozbe, recharge pri nízkej mane, útek z IK/dmg dlaždice/Shrekovho revu, zber itemov/heal;
- náhodná vzorka platných front (`validQueue`);
- golden shield/mirror/mana, Last Stand, Last Hope, démon, swap (turnaj);
- zlúčenie front s identickým výsledkom vo všetkých simuláciách.
- **Iterácia:** po vyriešení matice sa najhoršie stĺpce/riadky vymenia za nové kandidátov (double oracle —
  najlepšia odpoveď na súčasný mix sa pridá, kým sa mix nezlepšuje).

### 3.3 Hodnotenie (`eval.js`)
Hodnota stavu po kole z pohľadu bota (výhra/prehra = ±1, inak odhad pravdepodobnosti výhry):
- HP rozdiel (hlavná váha), mana, **mapa hrozieb** (max dmg, ktorý mi súper vie dať budúce kolo na mojej bunke
  a okolí, a naopak), poradie startéra v ďalšom kole;
- stav postáv: pride, mesiac, klon, pasca, labyrint/maze buff, `worldUsed`, Last Stand doom, kameň;
- prostredie: dlaždice + `pending`, portály, Shrek (HP, značky, smrad), itemy;
- séria/turnaj: HP a mana mágov v rosteri.
- **Ladenie váh self-play-om** (bot proti botu s rôznymi váhami, `tools/ai-tune.mjs`), nie ručne.
- Neskôr voliteľne: **rollouty** (dohrať 1–2 kolá lacnou politikou) na zlepšenie odhadu v kritických kolách.

### 3.4 Riešenie kola (`solve.js`)
- Matica M[i][j] = priemer eval cez K determinizácií pre moju frontu i a súperovu j.
- **Regret matching** (~1000 iterácií) → mix pre obe strany; bot vzorkuje svoju frontu z mixu.
- THE WORLD (bot = Jotaro, súper zmrazený): bez súpera → priama maximalizácia.
- Súperova THE WORLD: bot nemá čo rozhodnúť (zmrazený).

### 3.5 Model súpera (`model.js`) — yomi vrstva
- Počas zápasu si bot zapisuje tendencie človeka v situáciách (po zásahu, pri plnej mane, pri hrozbe specialom,
  posledné kolo…) z odhalených front.
- Súperov mix z regret matchingu sa **posunie k modelu** a bot hrá najlepšiu odpoveď — ale len o toľko, o koľko
  je model istý; zvyšok ostáva Nash (bezpečné využívanie: proti silnému hráčovi nestratí, slabého potrestá).
- Voliteľne neskôr: počiatočný model z telemetrie (priemerný ľudský štýl).

### 3.6 Mimo kola
- **Výber postavy:** tabuľka matchupov z turnaja bot-vs-bot (`tools/ai-matchups.mjs`); v bo3 counterpick.
  Pozor: bot vyberá **bez znalosti** súperovej voľby, ak ju človek ešte nepotvrdil (slepé ako pre človeka).
- **Turnajový draft:** tím s najlepším priemerom proti celému poolu + pokrytie slabých matchupov.
- **Pass/timer:** bot sa zmestí do časového limitu (min(časovač, ~5 s)).

## 4. Napojenie

- Lobby: voľba **VS AI** (host vždy A, bot = B). Zvyšok klienta bez zmeny — bot je bežný súper.
- Server: bot sedí ako virtuálna osoba B, dostáva masked emity ako klient, volá `engine.lockIn` / `timestopActions`
  / `chooseCharacter` / `chooseTeam`. Výpočet vo **`worker_threads`** (neblokuje ostatné miestnosti), časový limit.
- Telemetria: rozhodnutia bota sú bežné `lock` vstupy → replay funguje. Do `match_start` príznak `ai: true`.
- Bot má vlastný seed (z `rand` miestnosti pri štarte zápasu → deterministické testy).

## 5. Meranie sily (bez toho nevieme, či je „najlepší")

1. `tools/ai-vs.mjs`: bot vs náhodný bot — cieľ ≥ 98 % výhier.
2. Bot vs predchádzajúca verzia (regresie), turnaj verzií.
3. **Exploitability test:** fixné „exploit" stratégie (vždy štít, vždy special pri 5 mane, vždy útok na
   najbližšiu bunku…) — bot ich musí poraziť výrazne.
4. Human playtest + telemetria (výhry bota podľa postavy/arény).

## 6. Fázy

| Fáza | Obsah | Výstup |
|---|---|---|
| A0 | `loadState` + rýchly režim, meranie | difftest 0 diffov, ms/kolo |
| A1 | sim zo snapshotu + determinizácia + fairness test | `test/ai-fair.mjs` |
| A2 | kandidáti + eval + regret matching | bot ≥ 98 % vs random |
| A3 | double oracle, ladenie váh self-play | turnaj verzií |
| A4 | napojenie (lobby VS AI, worker, výber postavy) | hrateľné |
| A5 | model súpera, všetky formáty/arény, THE WORLD, turnaj | exploitability test |
| A6 | (voliteľné) rollouty, prior z telemetrie | |

## 7. Rozhodnutia vlastníka (2026-11-02)

- **Naruto klon — ako človek:** snapshot obsahuje skutočnú polohu Naruta aj klonu, ale bot ju nesmie použiť.
  Bot vidí dve nerozlíšiteľné figúry (sledovateľné len tak, ako ich vidí človek na doske) a skutočného Naruta
  odhaduje determinizáciou. Pohľad bota preto prechádza ešte jednou vrstvou redakcie (`botView`), ktorá
  dvojicu súperových figúr anonymizuje; fairness test pokrýva aj výmenu Naruto ↔ klon.
- **Rozsah v1: single na Stone Bridge.** Architektúra sa ale od začiatku navrhuje pre všetky formáty a arény
  (eval/kandidáti s háčikmi pre portály, Shreka, turnaj), ďalšie sa pridávajú postupne.
- **Budúcnosť — arkáda:** hráč postupne porazí bota za každú postavu; keď porazí všetky, vyhral. Až po v1.
- **Čas na rozmýšľanie: až ~5 s** na kolo (pri nastavenom kratšom časovači menej); bot počíta paralelne,
  kým človek plánuje.
