# Escanor sprite pipeline

Extrakcia herných spritov z ripnutého sheetu `ESCANOR.png` (Escanor zo Seven Deadly Sins,
nepravidelná koláž na jednofarebnom magenta pozadí `163,73,164`). Výstupy sú už skopírované
v `public/assets/escanor/` (P1) a `public/assets/escanor_2/` (P2, červené oblečenie) — tieto
skripty slúžia na pregenerovanie.

```
npm install pngjs         # jediná závislosť
node detect.cjs           # 1. detekcia frame boxov -> bands.json (+ overview.png náhľad)
node export_game.cjs      # 2. herné sheety do public/assets/escanor/ + P2 recolor do escanor_2/
node collect.cjs          # (voliteľné) HOTOVE.html — galéria schválených/zložených animácií
node gen_viewer.cjs       # (voliteľné) viewer.html — animovaný prehliadač všetkých detekovaných pásov
```

- **detect.cjs** — pozadie je čistá jednofarebná magenta, takže delenie ide projekčnými profilmi:
  Y-pásma (tenké textové labely oddelené od sprite pásov) → v každom páse X-frames podľa prázdnych
  stĺpcov. Výstup `bands.json` (očíslované pásy + frame boxy).
- **export_game.cjs** — z `bands.json` skladá herné sheety do štvorcovej bunky **226×226**,
  postava **kotvená nohami na spodok** framu (feet-anchor cez `feetY`/`feetX`, ako ostatné postavy
  v hre, `belowFeet=0`) a horizontálne centrovaná. Mapovanie:
  `Idle←Stand`, `Run←Walk`, `Attack_1←Attack5` (basic), `Attack_2←Attack1` (melee), `Hurt`, `Dead`,
  `WeakIdle` (slabá „denná" forma pred premenou), `Transform`/`IntroStand` (premena → chytí sekeru),
  `Win`, `Charge` (najmenšie slnko ako pulzujúci/rotujúci projektil 64×64).
  P2 paleta: zelené oblečenie → červená (jas zelene do červeného kanála, modrá stlmená).
- Kde detekcia **zliala** susedné frames (napr. sekový oblúk Cruel Sun), rieši to explicitný box
  `BX(...)` — rez sa vedie prázdnymi stĺpcami medzi pózami.
- Formát výstupu = štvorcové frames v horizontálnom páse (engine odvodí počet = šírka/výška).
- Mechanika postavy (pride level) je popísaná v `CLAUDE.md`.
