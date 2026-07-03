# Naruto sprite pipeline

Extrakcia herných spritov z ripnutého sheetu `NARUTO.png` (nepravidelná koláž na magenta pozadí).
Výstupy sú už skopírované v `public/assets/naruto/` — tieto skripty slúžia na pregenerovanie,
ak treba vymeniť frames alebo doladiť výber.

```
npm install pngjs        # jediná závislosť (lokálne v tomto priečinku)
node detect.js           # 1. detekcia frame boxov -> cells.json + overview.png (očíslovaný náhľad)
node pack.js             # 2. zloženie pásov podľa spec-u v pack.js -> out/*.png
node recolor.js          # 3. P2 žltá paleta (+ zlatý Charge/Rasengan) -> out/p2/*.png
node preview.js A.png B.png   # kontaktný náhľad vybraných pásov -> out/_preview2.png
node gen_viewer.js       # animovaný HTML prehliadač všetkých pásov -> viewer.html
```

- Spec animácií (ktoré bunky/boxy tvoria ktorý pás) je `ANIMS` v `pack.js` — bunky sa vyberajú
  y-pásmom cez `band()`, alebo explicitnými boxami tam, kde detekcia zliala susedné sprity.
- Formát výstupu: štvorcové frames v horizontálnom páse (engine odvodí počet = šírka/výška),
  postavy 128 px kotvené na spodok, projektil 64 px centrovaný — presne ako existujúce postavy.
- Mapovanie výstupov na herné súbory (`Idle.png` ← Stance atď.) je popísané v `NARUTO_PLAN.md` v roote.
- P2 paleta: mapa farieb vypočítaná z dvojice kostýmov v sheete (oranžový ↔ žltý, mení len
  `#e84000→#d89800` a `#f89840→#f8e050`); modrá čakra sa prefarbuje hue-shiftom na zlatú.
