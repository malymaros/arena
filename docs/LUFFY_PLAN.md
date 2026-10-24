# Luffy — kit (prerobený 2026-10-24)

> Pôvodný plán a kit (Base/Gear 3 prepínanie rechargom, Giant Pistol s priťiahnutím, special ako šachová
> dáma/veža) je v git histórii pred týmto prerobením. Tento súbor popisuje aktuálny stav.

Luffy je skrytá postava viazaná na **P1** a **zrkadlo Jotara** (P2): rovnaká kostra kitu, iný Special 1
a iný jednorazový special. Čísla sú v `shared/balance.js` (`LUFFY_*`).

| Akcia | Cena | Účinok | Animácia |
|---|---|---|---|
| Move | 0 | 1 bunka | `Run` |
| Dash | 4 | až 2 bunky | `Special_7` (fx `boardAnim`) |
| Recharge | +4 mana | bežný | `Special_3` (hostina) |
| Basic | 1 | diagonálna odrazová strela, 3/2/1 | `Attack_1` + `Charge` |
| Melee | 4 | 4 dmg, vlastná bunka | `Attack_1` (3 švihy) |
| Shield / golden shield / golden mirror | 2 / 3 / 5 | bežné | — |
| Mirror | — | **nemá**, slot je Special 1 | — |
| **Special 1** (mirror slot) | 4 | 2 dmg na ľubovoľnú bunku okrem vlastnej (ghost) bunky | `Punch` (telo) + guma + `PunchFist` |
| **Special = guľa** (raz za hru) | 5 | kotúľ o 1 bunku ←/→, výbuch 8 dmg na 3×3 okolo dopadovej bunky vrátane nej | `Special_1` (stred + doska) → `Special_2` |
| **Special 2** (po guli) | 5 | 8 dmg na susednú bunku ←/→ (ako Jotaro) | `Attack_2` + stredový overlay |

## Pravidlá a hraničné prípady
- **Special 1** smie mieriť aj na súperovu aktuálnu bunku; zakázaná je len vlastná ghost bunka (server
  `special1.validate` nad `simulateQueue`, klient `#s1-cell-picker` v režime `own`). Ak sa Luffy pre nedostatok
  many nepohol podľa plánu a cieľ je jeho bunka, akcia sa prečiarkne bez ceny. Ide cez obrany (`strikeZone`):
  štít blokuje, mirror odrazí 2; klon-návnada na bunke zomrie, stacknutý pár = pravidlo soak.
- **Guľa:** `worldUsed` (ten istý per-hra príznak ako Jotarov THE WORLD) sa nastaví pri použití vždy, aj pri
  kotúli do steny. Kotúľ z krajného stĺpca von = spálený special (mana preč, `wall_bump`, bez výbuchu).
  Kotúľ na súperovu bunku je v poriadku (súper v strede výbuchu). Výbuch Luffyho nezraní. Mirror vráti 8.
  POWER tile sa počíta zo štartovej bunky. Kotúľ ťahá Ariadninu niť a spúšťa pasce (`trackSteps`).
- **Labyrint:** všetky Luffyho zásahy reálneho súpera volajú `revealLabyrinths` pred animáciou; prekliaty
  Luffy mieri rukou naslepo.
- **Turnaj:** draftovateľný len P1; swap do/z Luffyho zakázaný (side-postava).

## Súbory
- engine: `engine/characters/luffy.js` (special1 = ruka, special = guľa / Special 2 cez `zoneStrike` z `jotaro.js`)
- geometria: `shared/geometry.js` → `luffyBallLanding`, `luffyBallCells`, guľa v `simulateQueue`
- klient: `public/chars/luffy.js` (dáta, tlačidlá, anims), `public/chars/fx/luffy.js` (guma, guľa, dash, Special 2)
- sprity: `tools/sprites-luffy/punch.cjs` (Punch.png, PunchFist.png); ostatné pásy `pack_char.cjs`
- testy: `test/game-test.mjs` blok TL1–TL5, `test/balance-ui.mjs`
