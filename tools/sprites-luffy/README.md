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
viewer.html          # animovaný náhľad všetkých pásov (otvoriť priamo v prehliadači)
```

Konfigurácia sheetu je `sheet.cjs`; spec animácií (bunky per pás + kotva) je
`SEGMENTS` v `pack.cjs`. V speci môže byť namiesto id bunky aj explicitný box
`{x0,y0,x1,y1}` — použitý pre `L_FireworkFX` (rozsypané iskry riadku 12 zliate
do jedného framu).

## Pásy (`out/`, prefix `L_`)

Kompletný „všetko čo sheet dáva" výber na review — finálny kit sa vyberie
z vieweru. Zaujímavé mapovania na herné akcie:

- **Idle/Run/Hurt/Dead**: `L_Idle` (6), `L_Run` (8), `L_Hurt` (4),
  `L_Knockback`+`L_Tumble`+`L_Lying` (pád + ležanie ako Dead)
- **Basic attack + projektil**: `L_Bullet`/`L_Pistol`/`L_Punch` (naťahovací
  úder) + oddelené letiace päste `L_Fist` (3) / `L_FistJet` (1) ako `Charge.png`
- **Melee**: `L_Jab`/`L_Jab2` alebo `L_Gatling` (ora-ora salva ako Jotarova)
- **Special**: `L_Gatling`/`L_FistRain` (plošná salva), Gear Third
  `L_GiantPistol`→`L_GiantPunch` (obria päsť), `L_RifleUp`/`L_Axe` (vertikály)
- **Shield/Mirror choreografia**: `L_Balloon` (Fusen — nafúknutie a odrazenie,
  `L_BalloonBounce` reakcie) — tematicky presne mirror
- **Recharge**: `L_MeatFeast` (Ultimate Action = jedenie mäsa) alebo `L_Guard`
- **Win/Lose**: `L_Win`, `L_Lose`, `L_Stand`, `L_Cheer`

Smerové poznámky: doľava kreslené sú `L_Punch`, `L_Rifle`, `L_Pistol`,
`L_Pistol2`, `L_Whip`, `L_Unused` a celý Gear Third (kotva bottomright);
`L_Jab`, `L_Jab2`, `L_PunchBall`, `L_Bullet`, `L_RocketPull` idú doprava.
Vzdušné útoky (`L_Air*`) a `L_Grapple` (Kinnikuman crossover vtip zo sheetu)
sú zabalené len pre úplnosť.
