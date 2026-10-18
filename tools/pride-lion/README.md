# Pride lion indikátor (Escanor)

Escanorov pride level (0–3) sa v HUD ukazuje ikonou levieho leva, ktorý sa **plní zlatou odspodku** —
0 = celý biely, 3 = celý zlatý (a pri 3 pulzuje = signál „max").

## Zdroj
`public/assets/pride lions.png` — ručne namaľovaný strip 3 levov vedľa seba na čiernom pozadí
(biely → čiastočne zlatý → celý zlatý), s domaľovaným detailom hrivy/tváre a obrysom, aby bol lev
čitateľný aj keď je celý vymaľovaný.

## Generovanie
```
node tools/pride-lion/make_lions.cjs
```
Vyrobí `public/assets/pride_lion_0..3.png`:
- deteguje 3 levy cez prázdne (čierne) stĺpce (strip nie je delený presne na tretiny),
- každého vycentruje na rovnakú plochu (žiadny cutoff/bleed),
- čierne pozadie vykľúči do priehľadna,
- `pride_lion_0.png` = celý biely (odvodený prefarbením plného leva; strip bielu verziu nemá).

## Použitie v kóde
- `public/index.html` — `<img src="/assets/pride_lion_0.png">` v `.pride-badge`
- `public/client.js` `renderPrideHud()` — mení `img.src` na `pride_lion_<level>.png`, pri 3 pridá triedu `.pride-max`
- `public/styles.css` — `.pride-badge.pride-max img` pulzuje (`@keyframes pride-max-pulse`)
