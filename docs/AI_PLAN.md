# Ťažký AI bot — plán

Stav: **schválené 2026-11-02.** A0 hotové (`exportState`/`loadState` + `io.noFrames`, `tools/ai-bench.mjs`: ~9 400
simulovaných kôl/s na jadro). A1 hotové (`engine/ai/view.js` belief + determinizácie, `engine/ai/sim.js`, `test/ai-view.mjs`).
A2 hotové (`candidates.js`, `eval.js`, `solve.js`, `bot.js` - maticová hra + double oracle, rozpočet v ms alebo
deterministicky v počte simulácií; `tools/ai-vs.mjs`; `test/ai-bot.mjs`). A3 hotové (features per postava, `tools/ai-tune.mjs`;
váhy ostali ručné - pozri „Merania"). A4 hotové (stála AI roomka VS AI 0/1 - pôvodne tlačidlo PLAY VS AI, `worker.js` + `seat.js`, `test/ai-room.mjs`). A5 hotové (`model.js`,
`tools/scripted-bots.mjs`, `tools/ai-duel.mjs`).

## Merania (2026-11-02, deterministický rozpočet `budgetSims`)

| Test | Výsledok |
|---|---|
| bot vs náhodný bot | 30/30 (1 500 sim), 8/8 v `test/ai-bot.mjs` (600 sim) |
| ladenie váh self-play (4 generácie, 3 200 hier, 35 tis. stavov) | naučené váhy v dueli 46,4 % ±2,8 proti ručným → **zamietnuté**, ostávajú ručné |
| rozpočet 6 000 vs 1 500 sim / 1 500 vs 150 sim (bot vs bot) | 51,5 % / 50,6 % - medzi dvoma „rovnovážnymi" hráčmi viac výpočtu nepomáha (simultánne hádanie) |
| bot vs exploit štýly (120 hier, 1 500 sim) | shieldy 73 %, turtle 79 %, aggro 78 %, greedy 64 % - **neplatné**, viď nižšie |
| **oprava merania (2026-11-02):** `tools/ai-vs.mjs` nedával botovi ako osobe A čerstvý stav pred kolom (posledná timeline nesie „locked") → bot ako A nerozhodol a hral za neho náhodný bot; všetky duely so striedaním strán boli ~polovične náhodné | po oprave starý bot (80 hier): greedy 76 %, aggro 97,5 %, shieldy 95 %, turtle 96 % |
| bot s taktikou kola (sekcia 9: `threat.js`, `plans.js`, nové features, citlivosť na smrť; 80 hier) | greedy **91 %**, aggro 100 %, shieldy 94 %, turtle 95 %; **nový vs starý 58,8 % ±7,6** (160 hier); čas ťahu +~10 % |
| model súpera zap. vs vyp. | vs shieldy +4 b., ostatné ±1 b. (v šume); bot vs bot 49,5 % - neškodí |

Zistenia: (1) self-play silu takmer nemeria - hra je z veľkej časti simultánne hádanie, rovnováha proti rovnováhe je ~50 %;
(2) jednoduché vzory „útok smerom k súperovi" sú na doske 4×3 slušná stratégia a **spam specialov (greedy) je najsilnejší**
z testovaných vzorov - podnet pre balans; (3) skutočnú silu ukážu až hry s ľuďmi (telemetria AI roomiek) - ďalší krok A6:
ladenie hodnotenia a modelu súpera na hrách človek vs bot.

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

- **Naruto klon — ako človek:** bot smie vedieť len to, čo vie pozorný človek. **Zistenie pri implementácii A1:**
  klient klon nikdy „nestratí" — kým stojí na Narutovej bunke, je posunutý a polopriehľadný, a figúry sa vždy
  plynulo kĺžu (nikdy neskočia ani nezmiznú na mieste), takže pozorný človek ich vždy dokáže sledovať a vie,
  ktorá je skutočná (anonymizuje sa len vertikálny smer v logu akcií). Pozorný človek teda túto informáciu
  má, a preto ju bot berie zo snapshotu bez ďalšej redakcie. Anonymizácia by z bota spravila slabšieho
  hráča než pozorný človek, nie férovejšieho. V labyrinte klona súpera nevidí ani bot (redakcia servera).
- **Rozsah v1: single na Stone Bridge.** Architektúra sa ale od začiatku navrhuje pre všetky formáty a arény
  (eval/kandidáti s háčikmi pre portály, Shreka, turnaj), ďalšie sa pridávajú postupne.
- **Budúcnosť — arkáda:** hráč postupne porazí bota za každú postavu; keď porazí všetky, vyhral. Až po v1.
- **Čas na rozmýšľanie 10 s (vlastník 2026-11-03):** `AI_THINK_MS` (default 10 000), reálny čas. Duel: 2× výpočtu = 46 % (±11),
  4× = 59 % (±7,6) proti 1 500 simuláciám. Zároveň oprava: bot dovtedy začínal rozmýšľať až po hráčovom locku (snapshot po
  kole niesol ešte `locked`), teraz hneď po timeline kola. `AI_SIMS` ostáva ako pevný rozpočet pre testy.
- ~~Čas na rozmýšľanie: až ~5 s~~ → **zmenené 2026-11-02 (prekonané 2026-11-03):** pevný počet simulácií na ťah (`AI_SIMS`, default 1 500),
  nie čas. Merania ukázali, že viac výpočtu dnešnému botovi nepomáha; pevný rozpočet = pevná, predvídateľná sila
  a minimum CPU (~0,2 s/ťah na PC, ~1 s na e2-micro). Všetky AI roomky počítajú v **jednom** worker vlákne, ťah po ťahu.
- **Stála AI roomka (2026-11-02):** namiesto tlačidla PLAY VS AI existuje vždy jedna roomka VS AI (0/1), hrá v nej naraz
  len jeden človek, ostatní môžu sledovať; po odchode hráča / admin resete je hneď znova čistá. Admin ju resetuje ako
  hocijakú inú. Bot **nikdy nezamkne kolo skôr ako hráč** (žiadne OPPONENT IS READY), dopremýšľa 0,6–1,5 s po ňom.
- **Tvár bota** v jeho HUD namiesto portrétu (nálada z verejných udalostí); okno postavy na hover / podržanie ostáva.
- **Šetrnosť:** hra nesmie nikdy sekať - ani server, ani zariadenie hráča. Maximalizovať silu na jednotku výpočtu.

## 8. Budúca predstava - úrovne botov (zapísané 2026-11-02, realizovať až keď bude opodstatnená)

Predstava vlastníka: **Server bot** (šetrný, pevne definovaná sila, hráč vie, čo čakať) + **lokálne boty 1–3** bežiace
v prehliadači hráča. Každá úroveň má **pevne definovanú a porovnateľnú silu** - rovnaká na každom zariadení; zariadenie
rozhoduje len o tom, ktoré úrovne sú **odomknuté** (silnejšie zariadenie = viac úrovní, slabšie má vyššie zamknuté).

- **Sila = algoritmus + pevný počet simulácií** (`budgetSims`, hĺbka 1 / 2 kolá), nie čas → rovnaký súper všade, na
  pomalšom zariadení len dlhšie premýšľa.
- **Odomknutie:** krátky test výkonu pri otvorení menu proti AI (~1 s vo Web Workeri); úroveň je dostupná, len ak ju
  zariadenie zvládne v limite (napr. ≤ 5 s/ťah) s rezervou.
- **Bez sekania:** výpočet len vo Web Workeroch (nikdy hlavné vlákno), najviac časť jadier (aspoň jedno voľné);
  pri prehriatí / spomalení hráča upozorniť - nikdy potichu nemeniť silu.
- **Porovnateľnosť:** každá úroveň zmeraná duelmi (rating, napr. Elo) a zobrazená v menu; každá úroveň musí byť
  **merateľne silnejšia** než predošlá (inak nemá zmysel).
- **Podvádzanie človeka** (prečítať ťah lokálneho bota cez devtools) vlastníkovi nevadí - nehrá sa o nič, podvodník
  sa len ochudobní o zábavu. Bot sám nepodvádza nikdy.
- **Predpoklady (poradie):** (1) spoľahlivé meranie - viac skriptovaných štýlov + exploiter; (2) hodnotenie pozná
  budúce kolo (mana na obranu, súperova hrozba, ohlásené dlaždice / IK); (3) hľadanie cez 2 kolá (až tu začne výpočet
  zvyšovať silu); (4) definícia úrovní + ratingy; (5) engine v prehliadači (`process.env` v `engine/constants.js`),
  Web Workery, test výkonu, odomykanie.

## 8b. Obťažnosť BABY (implementovaná 2026-11-03)

Rozhodnutia vlastníka (2026-11-03): **2 úrovne - NORMAL (doterajší bot) a BABY** (deti a úplní začiatočníci), jedna
AI roomka. Klik na voľnú hlavu bota v room browseri otvorí okno **CHOOSE DIFFICULTY** (`public/client/ai-difficulty.js`;
vľavo BABY, vpravo NORMAL, bez popiskov) → `join_room { roomId, level }`; obsadený bot = sledovanie bez okna, v rohu
je hlava toho bota, proti ktorému sa hrá (`aiRoom.level`). Server: `aiLevel` roomky (nastaví ho `join` pred zápasom,
nová roomka = normal), meno bota v HUD **BABY** / **AI**, snapshot `aiLevel` (len v AI roomke), telemetria `ai.level`,
bot ho dostane cez `seat.setLevel` → `bot.setLevel`. Avatar BABY (`bot-face.js` `paintBaby`, návrh
`public/dev/ai-difficulty.html`): okrúhla modrá hlava, srdiečko na anténke, podbradník, cumlík FRONT RING - vo všetkých
náladách na mieste a v rovnakej farbe (aj smiech, K.O.), len „dudle"; nálady mení očami (+ slzy / pot), pri premýšľaní
bez bodiek. Bez úľav mimo bota (HP, časovač).

Správanie (`bot.js` `babyPick`, parametre `BABY`): ten istý výpočet s 15 % rozpočtu (~1,5 s/kolo), bez modelu súpera;
z ohodnotených front vyberá **mäkko**: hodnota = zmes „proti súperovej rovnováhe" a „proti súperovi, ktorý ostane
stáť" (nepredvída - strieľa tam, kde súper stojí), časť kôl zahrá náhodnú frontu z lepších 80 % predvýberu
(„ležérny ťah"), obrana max 1 za kolo + penalizácia, démon nikdy, istú výhru prehliadne (70 % keď vedie / 35 % keď
prehráva); **skryté vyrovnávanie** (vlastník ho výslovne chcel): čím viac vedie na HP, tým naivnejšie a ležérnejšie.
Meranie (30 zápasov, `--sims 1500`): vs random 90 %, vs aggro 97 %, vs greedy 80 % (NORMAL 100 / 100 / 85-90 %) -
skriptovaní súperi sú len hrubá náhrada dieťaťa; **silu doladiť podľa skutočného hrania** (`node tools/ai-vs.mjs 30
--level baby --baby "SLOP=0.8,…"`). Testy: `test/ai-bot.mjs` (determinizmus BABY), `test/ai-room.mjs` (level, meno, aiRoom.level).

## 9. Ako hru hrá vlastník (zadanie pre hodnotenie a kandidátov, 2026-11-02)

Zistenie: bot v kole ohodnotí len ~105 náhodných z 1 300–6 000 súperových front a do matice sa dostane 15–40 - rozumné
súperove plány (sprint na heal, útek z dosahu) v nej často chýbajú. Hodnotenie pozerá len na bunku, kde kolo skončí.
Vlastník hrá takto (zhrnutie jeho odpovedí - zdroj pravdy pre ďalšie úpravy `eval.js` / `candidates.js`):

**Rozhoduje najbližšie kolo** (3 ťahy: čo súper môže / nemôže s manou, čo asi spraví). Z budúcnosti len políčka
ďalšieho kola (dmg/IK/heal/mana/power) - ku koncu hry, keď je málo bezpečných buniek, je to dôležité.

- **HP sa meria hrozbou, nie absolútne:** hodnota HP závisí od súperových útokov - proti specialu za 8 je 9 HP málo
  a nevymení ho za manu; proti specialu za 5 je skok 5 → 6 HP veľký, 8 vs 9 proti 3 dmg skoro nič. Averzia k riziku
  rastie s tým, ako blízko je súper k tomu, aby ma zabil („nevytvárať súperovi ľahkú cestu k výhre"); defenzíva je
  spoľahlivejšia.
- **Mana = možnosti a nečitateľnosť.** 5+ výborné (special, obrana, breaker - súper nevie, čo príde). Súper s 1 manou,
  ktorý na mňa nedostrelí, nie je hrozba a v kole bude dobíjať. Mana políčko má obrovskú cenu pre hráča s malou manou.
- **Začínať kolo je takmer vždy výhoda** (vyhnem sa útoku, súper háda smer), hlavne keď má súper málo many - aj s
  manou na golden štít je pod tlakom (special, shield breaker, alebo nechám štít vyprchať a udriem neskoršou akciou,
  hlavne s veľkým dosahom). Preto non-starter s 3 manou golden štít niekedy nezahrá a skúsi trafiť neskôr.
- **Bunky:** najcennejšie sú tie, z ktorých útoky pokryjú čo najviac plochy (Medúza, Wanderer: stredný riadok - súper
  to ale vie). Ďalej rozhoduje, či viem ohroziť súperovu bunku a bunky, kam sa môže presunúť.
- **Zlá pozícia** = súper vie, že dostanem dmg (dmg políčko) alebo som premárnil príležitosť (mohol som ísť na mana
  políčko, išiel som na prázdne). Ísť vedome na dmg políčko má zmysel len ako prekvapenie (napr. Minotaur v labyrinte:
  súper vie, kde sú dmg políčka, preto tam nečaká útok); čím viac HP mám oproti súperovi, tým ochotnejšie riskujem.
  Stáť na dmg políčku = súper vie, že sa musím pohnúť (čitateľnosť). **Výnimka Fire:** dmg políčko je preňho cieľ
  (special ±1 riadok) - Fire s 5+ manou pri dmg políčkach tam pravdepodobne pôjde.
- **Koniec hry (plná doska dmg):** hľadať miesto, kde vydržím najdlhšie a mám najviac pohybu toto aj ďalšie kolo;
  nútený prechod cez dmg je zlý aj preto, že súper ľahšie číta moje zvyšné cesty. Málo HP + veľa dmg políčok, ďalšie
  kolo asi neprežijem → zvážiť démona.
- **Heal/mana políčka:** závisí od postavy (Lightning heal vždy - lieči do plna; Werewolf heal nechce - malé HP = vyšší
  dmg) a od súperovho dmg (prah zásahov, viď HP). Súper čaká, že pôjdem na manu pri malej mane / na heal pri malom HP;
  keď vie, že ho tam môžem potrestať, ide tam ~50 : 50.
- **IK:** nedostať sa do situácie, odkiaľ sa nepohnem; súper na IK nepôjde; kto na IK stojí, musí sa hýbať.
- **Súper bez many:** pohyb, dobitie, basic; prípadne dobitie na mana políčku. Keď stojí v mojom dosahu, väčšinou
  najprv uhne a potom dobije, ale občas naopak (len najlogickejšie ťahy sa dajú čítať) - pri jeho malom HP skoro iste
  skúsim zásah. **Súper s plnou manou:** agresívne kolo (mirror/breaker/specialy), hlavne keď mám ja málo many; alebo ma
  nechá minúť manu na štít/mirror, sám si ju nechá a pripraví si ďalšie kolo (keď začína a ja mám ešte menej).
- **Štít/mirror čakám** hlavne keď mám special s vysokým dmg a súper sa bojí zásahu (niekto aj proti basicu); čím je môj
  zásah bližšie k smrteľnému, tým viac čakám mirror (spôsob, ako otočiť hru). Wanderer/Escanor obranu nehrajú radi
  (stráca im výhodu: regen / pride).
- **Postup v kole:** 1. ako mi súper vie dať dmg (hlavne čo je pre mňa koniec - melee, silný special), 2. pozícia,
  ktorá mu zúži možnosti zásahu (ak ma odtiaľto vie trafiť len z jednej bunky, tam mierim alebo si na tú akciu
  pripravím obranu), 3. ak čakám defenzívu, tipnúť kam uhne / kedy zahrá štít či mirror a potrestať to. Striedať
  poradie (nehrať len najlogickejšie).
- **Postavy:** Medúza - kontrola hry, petrify berie súperovi akcie, z toho dmg zadarmo; Naruto - rozdelenie pokryje
  väčšiu plochu alebo dá 2× dmg; Minotaur - dostať do labyrintu a tam dávať dmg; Werewolf - brať golden manu (zníži si
  HP → vyšší dmg), najnebezpečnejší pri 8 dmg; Luffy/Jotaro - opatrne s jednorazovým specialom (potom nevýhoda proti
  démonovi). Démona hrať zriedka - vyvolávač má ~33 % (súper zvyčajne zablokuje štítom a mirrorom 2 z 3 akcií),
  okrem špecifických pozícií.
- **Chyby bota z hier:** útoky mimo dosky (zabitá mana) - opravené v `1715b00`.

**Realizácia (2026-11-02):** `engine/ai/threat.js` - mapy zásahov postáv zistené sondami na engine (čo kto komu vie dať
z ktorej bunky a za koľko many; status = 3 dmg; Soldier = súper na bunku vkročí), `reach` (pohyb / dash na budúce kolo).
`eval.js` - nové features: `threat` (môj najväčší zásah na súpera po pohybe vs jeho na mňa, k HP), `lethal` (vie zabiť),
`hits` (koľko zásahov najsilnejším útokom do smrti - HP podľa hrozby), `coverage` (koľko súperových únikových buniek
pokryjem), `safe` (bezpečné bunky na dosah na ďalšie kolo - koniec hry), `pickup` (heal / mana / power podľa potreby
a postavy), `manaOpt` (mana po prahoch 1/2/4/5), `starterPress`, dmg políčko = čitateľnosť (Fire výnimka).
`plans.js` - rozumné plány oboch strán bez simulácie (vyvážený, zabijácky, obranný, útek, útočný, ekonomický), vždy
na začiatku poolov, ako sondy predvýberu a v matici. `bot.js` `avoidDeath` - fronta, po ktorej ma súperov plán v matici
zabije, sa nehrá, ak je bezpečná alternatíva proti súperovej zmesi najviac o 0,3 horšia. Zdôvodnenie každého ťahu
(`why`) ide do telemetrie (`t: "bot"`) a `tools/bugs.mjs` ho vypíše pri hlásení z AI roomky.

**Z prvých hier vlastníka (2026-11-02, 6 hlásení):** bot volal démona (Last Stand) už v 1.-2. kole - doom má v eval pevnú
hodnotu (−0,54) a pri pesimistickej rovnováhe vyzerala ako „poistka" lepšie než bežné fronty. Oprava: `last_stand` je
kandidát len v zúfalej situácii (`desperate` v `eval.js`: HP ≤ 4 a nie viac ako súper, a súper ma budúce kolo vie
zabiť alebo nemám kam uhnúť). Keď je rovnovážna hodnota ≤ −0,9 (prehraté proti dokonalému súperovi), bot hrá frontu
s najlepším priemerom proti všetkým súperovým frontám v matici (hra na šancu). Kolo s démonom sa vyhodnocuje presne
(výsledok je istý) - útok démonom bot zvažuje, ale proti súperovi s manou na štít/mirror mu často vychádza lepšie iné.
Medúzin kameň má väčšiu váhu (`stone` −0,5). Hlásenie poslané po konci hry odkáže na posledný zápas (`lastMatchId`).

**Ďalej:** učenie zo skutočných zápasov (telemetria AI roomky: prehry/výhry bota → ladenie váh a modelu súpera, A6).
- **Doplnenie k postavám:** Luffy/Jotaro nemajú mirror → slabšia obrana proti démonovi; Luffy so specialom je hrozba
  pre vyvolávača (súper si dá Last Hope a veľkým dosahom ho zabije), Jotaro má THE WORLD ako druhý „štít" (ubráni 2 z 3).
  Werewolf golden mana: nie automaticky - dáva zmysel, ak si HP neznecení príliš oproti tomu, čo mu vie dať súper (zároveň
  si zvýši dmg); nikto ju takmer nikdy nehrá viac ako 2× za hru (3. použitie = 3 HP za 6 many po 1+2 HP). Escanor - nechať
  rásť pride, potom zasiahnuť specialom. Soldier - tipnúť (alebo vynútiť) súperov presun a zabiť ho specialom; je to
  všadeprítomná hrozba, defenzívni hráči sa preto proti nemu nehýbu, alebo len ako poslednú akciu, keď idú druhí.
  Wanderer - držať tempo (pasívna mana), mirror v zálohe ako prekvapenie, hroziť vysokým specialom a čakať, že súper
  bude hrať obranu. Lightning - ďaleko od súpera, chipovať dmg obrovským dosahom. Fire - dostať súpera specialom, hroziť
  (alebo využiť) rozšírenie cez dmg políčko. Vampire/Onryō - asi najsilnejšie: nebáť sa mirroru, pasce kontrolujú
  dosku, útočiť a držať iniciatívu.
