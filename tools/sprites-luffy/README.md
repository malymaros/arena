# Luffy sprite pipeline (JUS)

Extrakcia herných pásov pre Luffyho z fan sheetu v JUS štýle (autor Degue,
post-timeskip). Zdroj na ploche (`C:/Users/maly/Desktop/Luffy/`):

- `time_skip_monkey_d__luffy_jus_sprite_sheet_by_degue_1297_d7c3p82.png` —
  1860×2753, teal pozadie (0,102,102), riadky majú textové popisky akcií
  (Stand, Walk, B+Forward, Y, B+Down, …)
- `WonderSwan … Swan Colosseum - Characters - Luffy.gif` — WSC rip (Deekman),
  iný vizuálny štýl, artworky rozhádzané vnútri plochy — **nepoužitý** (JUS
  sheet je kompletný; GIF by bol nanajvýš doplnok s prefarbením palety)

Pipeline prevzatý z `tools/sprites-jotaro` (viď jeho README) s tromi úpravami
v detekcii: `minH` filter vyhadzuje textové popisky riadkov (~7 px vysoké),
`exclude()` reže artwork + credit box v pravom hornom rohu (namiesto globálneho
`maxX`) a `maxW` je zdvihnutý na 800, lebo gumené naťahovacie útoky sú širšie
než Jotarov limit 400. Navyše kotva `bottomright` — časť naťahovacích útokov
(Rifle, Pistol, Whip, celý Gear Third) je v sheete kreslená **doľava**, takže
postava stojí pri pravom kraji framu a ruka sa tiahne doľava (pri hernom
nasadení sa pásy zrkadlia ako obvykle).

Sprity ~30×60 px → jednotný 2× nearest-neighbor upscale ako u Jotara. Formát
výstupu: štvorcové frames v horizontálnom páse (engine odvodí počet =
šírka/výška), veľkosť framu per-segment, PAD 8. Výstupy zatiaľ NIE sú
v `public/assets/` — mapovanie na herné súbory a kit postavy sa ešte nerozhodli.

```
node detect.cjs      # detekcia buniek -> cells.json + overview.png
node row.cjs N [M …] # 2x náhľad riadkov -> row.png (rows_*.png = uložené kópie)
node pack.cjs        # zloženie všetkých pásov -> out/*.png
node pack_char.cjs   # herné akcie z vybraných pásov -> out/char/*.png
viewer.html          # animovaný náhľad všetkých pásov (otvoriť priamo v prehliadači)
```

Konfigurácia sheetu je `sheet.cjs`; spec animácií (bunky per pás + kotva) je
`SEGMENTS` v `pack.cjs`. V speci môže byť namiesto id bunky aj explicitný box
`{x0,y0,x1,y1}` — použitý pre `L_FireworkFX` (rozsypané iskry riadku 12 zliate
do jedného framu).

## Herné akcie (`out/char/`)

`pack_char.cjs` skladá vybrané pásy pod herné názvy — kombinované akcie sa
lepia priamo z buniek do jednotnej veľkosti framu (kotva per-segment):

| akcia | zdrojové pásy |
|---|---|
| `Idle` | L_Stand (4) |
| `Run` | L_Run (8) |
| `Attack_1` (cast strely) | L_Jab2 (4) |
| `Attack_2` (melee) | L_Gatling bez posledného framu (9) |
| `Special_1` | L_BalloonTwist + L_ScratchFX + L_SpinWrap (9) |
| `Special_2` | L_FistWheel (3) |
| `Special_3` | L_MeatFeast (12) |
| `Special_4` | L_GiantPistol + L_GiantRocket + L_GiantPunch (14, doľava) |
| `Special_5` | L_GiantRetract (4, doľava) |
| `Special_6` | L_Rifle (9, doľava) |
| `Recharge` | L_Balloon (9) |
| `Recharge2` | L_TwinFists (7) |
| `Charge` (projektil) | L_FistJet (1) |
| `Hurt` | L_Hurt (4) |
| `Dead` | L_Lose (4 — sediaci porazený) |
| `Win` | L_Win (4) |

Mapovanie Special_1–6 / Recharge2 na konkrétne herné mechaniky (a P1/P2
paleta) sa rozhodne pri integrácii postavy.

## Pásy (`out/`, prefix `L_`)

Kompletný „všetko čo sheet dáva" výber na review — z neho vzišiel kit vyššie.

Smerové poznámky: doľava kreslené sú `L_Punch`, `L_Rifle`, `L_Pistol`,
`L_Pistol2`, `L_Whip`, `L_Unused` a celý Gear Third (kotva bottomright);
`L_Jab`, `L_Jab2`, `L_PunchBall`, `L_Bullet`, `L_RocketPull` idú doprava.
Vzdušné útoky (`L_Air*`) a `L_Grapple` (Kinnikuman crossover vtip zo sheetu)
sú zabalené len pre úplnosť.
