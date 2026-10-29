# Zber herných dát (telemetria)

Server zapisuje každý zápas do denných súborov JSONL, aby sa dali neskôr vyhodnocovať postavy a balans.
Toto je 1. kolo: **len zber + stiahnutie**, žiadne štatistiky ani interpretácie (rozhodnutie vlastníka 2026-10-29).

- **Žiadna identita hráčov** – ani mená, ani osoby A/B, ani admin príznak. Strany sú len `white` (p1, vľavo)
  a `black` (p2, vpravo); sú fixné na celú sériu.
- **Fakty, nie hodnotenia** – čo hráči zadali a čo sa stalo.
- **Engine sa nemení** – `telemetry/recorder.js` obaľuje príkazy enginu a jeho `io` háčiky. Goldeny ostávajú bit-identické.

## Zapnutie a stiahnutie

| | |
|---|---|
| Zapnutie | env `TELEMETRY_DIR=/home/arena/arena-data` (v `deploy/arena.service`); bez neho sa nič nezapisuje (testy, lokálny vývoj) |
| Súbory | `$TELEMETRY_DIR/YYYY-MM-DD.jsonl` (UTC dátum zápisu), zápis v dávkach každé 2 s a pri SIGTERM (`telemetry/store.js`) |
| Stiahnutie z hry | menu ☰ → ADMIN → **DOWNLOAD DATA** → `arena-data-<dátum>.jsonl.gz` (všetky dni spojené); admin socket si vypýta jednorazový token (`admin_data_token`, 60 s), heslo nejde do URL |
| Skriptom | `curl -o data.jsonl.gz "https://arena.marosmaly.sk/admin/data?key=<ADMIN_KEY>[&from=YYYY-MM-DD]"` |
| Cez SSH | `scp -i ~/.ssh/google_compute_engine -r arena@<IP>:arena-data .` |
| Prehratie | `node tools/replay.mjs <súbor.jsonl[.gz] \| adresár> [--match <id>] [--rounds]` – na commite z `match_start.commit` |

## Replay = celý zápas sa dá dosimulovať

Engine je deterministický: všetka náhoda ide cez `rand()`, ktorý sa v `startMatch` seeduje. Server teraz pri
**každom** zápase vylosuje seed (`crypto.randomInt(2**32)`, v testoch `ARENA_SEED`) a zapíše ho. Log obsahuje
všetky vstupy v poradí, v akom ich engine dostal, takže `telemetry/replay.js` zápas prehrá znova cez headless
engine a odvodí rovnaké záznamy. `test/telemetry.mjs` (v `npm test`) to overuje na 40 bot zápasoch všetkých
formátov – keby niektorý vstup chýbal, replay sa rozíde a test zlyhá.

Podmienky: rovnaký commit (iná herná logika = iný priebeh; `match_start.commit`, `dirty` = či mal server
necommitnuté zmeny) a rovnaké `FORCE_FIRST_STARTER` (`match_start.forceFirst`, v produkcii `null`).
**Pravidlo pre nový kód: nikdy `Math.random` v hernej logike, nikdy časovač, ktorý mení stav mimo
zaznamenaného vstupu** – inak sa replay rozíde (a test to odhalí len ak to bot zápasy pokryjú).

## Formát záznamov

Každý riadok je JSON s `t` (typ) a `m` (id zápasu). `at` = ms od začiatku zápasu, `g` = číslo hry v sérii.

### Vstupy (z nich replay prehrá zápas)

| `t` | Polia | Kedy |
|---|---|---|
| `match_start` | `v` (verzia schémy), `ts` (ISO čas), `commit`, `dirty`, `balance` (sha1 `shared/balance.js`), `seed`, `forceFirst`, `config` (sanitizovaný config z lobby) | host spustil zápas |
| `team` | `side`, `team` (3 postavy v poradí draftu), `random` | turnaj: potvrdený tím (`random: true` = vylosoval server) |
| `pick` | `g`, `side`, `char`, `random` | výber postavy pre hru (`random: true` = „Random characters“, vylosoval server) |
| `lock` | `g`, `turn`, `side`, `q` (fronta presne ako prišla z klienta, vrátane golden / last stand / last hope / swap) | prijatý `lock_in` |
| `ts` | `g`, `turn`, `side`, `q` | prijaté THE WORLD akcie |
| `auto` | `g`, `turn`, `drafts` (`{ white?, black? }` rozpracovaná voľba nezamknutých strán) | vypršal timer, frontu doplnil server |
| `next` | – | spustila sa ďalšia hra série |

### Fakty

**`round`** – jedno vyhodnotené kolo: `g`, `turn`, `starter` (strana, ktorá kolo otvára), `segs`, `end`.

- `segs` = kolo rozdelené na akcie v poradí, ako sa vyhodnotili. Segment akcie má `side`, `type`
  (`move`, `attack`, `special`, `golden_mirror`, `stoned`, `swap`…), prípadne `dir` / `to`. Segment bez `side` je
  dianie mimo akcií (dlaždice na konci kroku, koniec kola…).
  - `fx` = počty efektov timeline podľa druhu (`hit`, `block`, `mirror`, `invalid`, `wall_bump`, `tile_proc`, `clone_die`, `labyrinth`, `timestop_start`, …)
  - `invalid` = dôvod neplatnej akcie (`mana`, `mana_full`, `blocked_shield`, …)
  - `hits` = zásahy `{ to, dmg, parts?, bonus?, self?, portalBonus? }` (`to` = zasiahnutá strana)
  - `d` = zmena HP/many počas segmentu `{ white: { hp, mana }, black: … }` (len nenulové)
- `end` = stav oboch strán po kole: `char`, `pos`, `hp`, `mana`, `stone`, `pride`, `moon`, `clone`, `trap`,
  `worldUsed`, `labyrinth`, `manaRefills`, `lastStand`, `lastHope`.

**`game_end`** – `g`, `winner`, `rounds`, `starter` (kto otváral 1. kolo hry), `chars`, `random`,
`final` (HP/mana), `lastHit` (segment, v ktorom porazený naposledy stratil HP: `{ side, type }` akcie, alebo
`{ side: null, fx }` pri dlaždici a pod.), v turnaji `roster` (HP a mana všetkých mágov oboch strán po hre).

**`match_end`** – `reason`, `score` (`{ white, black }` výhry v sérii), pri `finished` aj `winner`.
`reason`: `finished` | `retry` (hráč dal retry) | `admin_reset` | `abandoned` (roomka zanikla – obaja odišli) |
`restart` (nový zápas bez ukončenia starého). Pri páde/reštarte servera `match_end` chýba.

## Príklad otázky (DuckDB)

S kým Medúza (vybraná hráčom, nie náhodne) prehrávala najčastejšie:

```sql
SELECT CASE WHEN chars.white = 'medusa' THEN chars.black ELSE chars.white END AS super, count(*) AS prehry
FROM read_json_auto('arena-data/*.jsonl', union_by_name = true)
WHERE t = 'game_end' AND NOT random
  AND ((chars.white = 'medusa' AND winner = 'black') OR (chars.black = 'medusa' AND winner = 'white'))
GROUP BY super ORDER BY prehry DESC;
```
