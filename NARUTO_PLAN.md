# Plán: pridanie Naruta ako 6. postavy

Handoff dokument — assety sú hotové a v repe, tento plán popisuje kroky integrácie do servera
a klienta. **Mechanika špeciálnej schopnosti tu zámerne nie je definovaná** — dodá ju zadávateľ;
sekcia [5](#5-special--doplní-zadávateľ) hovorí, čo všetko treba od neho zistiť a kam sa to napája.

Pred začatím si prečítaj `CLAUDE.md` (architektúra: server-authoritative timeline, dva súbory
`server.js` + `public/client.js`, žiadny build step). Testy: `npm test`.

---

## 1. Čo je hotové (netreba robiť)

Assety sú extrahované a v repe, vo formáte enginu (štvorcové frames v horizontálnom páse,
počet frames = šírka/výška, priehľadné pozadie, postava kotvená na spodok framu):

```
public/assets/naruto/
├── Naruto_1/          P1 originál (oranžový kostým, modrá čakra)
├── Naruto_2/          P2 natívna paleta (žltý kostým, ZLATÁ čakra — projektil aj Rasengan)
└── extras/            30 pásov nevyužitého materiálu (klony, Kyubi mód, Rasengan prstenec, efekty…)
```

Obsah `Naruto_1/` aj `Naruto_2/` (identické názvy, líšia sa len paletou):

| Súbor | Frames | Účel v hre | Pôvod v sheete |
|---|---|---|---|
| `Idle.png` | 4×128 | státie | bojový postoj so stuhami |
| `Run.png` | 6×128 | move / dash (akýkoľvek pohyb) | ninja beh |
| `Attack_1.png` | 6×128 | základný útok (cast) | úderové kombo |
| `Attack_2.png` | 5×128 | melee | kick combo |
| `Hurt.png` | 3×128 | inkasovaný zásah | zapotácanie |
| `Dead.png` | 4×128 | smrť | pád dozadu → ležanie |
| `Charge.png` | 3×64 | projektil základného útoku | čakrová špirála (P2 zlatá) |
| `Special.png` | 4×128 | cast špeciálu | pečate rukami |
| `Special_2.png` | 6×128 | rezerva na „special 2" (zadávateľ vysvetlí) | dýchanie |

- Extrakčná pipeline je v `tools/sprites-naruto/` (viď tamojší README) — ak treba iné frames,
  upraví sa spec v `pack.js` a pregeneruje sa.
- Animovaný prehliadač všetkých pásov (vrátane extras a P2 palety):
  https://claude.ai/code/artifact/d43765df-c0fa-4ece-9677-d81ca45fc651

**Dôležité vlastnosti assetov:**
- Priečinok má všetky štandardné názvy → **netreba** `SPRITE_FILE_ALIAS` (ten je len pre Minotaura).
- Naruto má **natívnu P2 paletu** (ako Medúza/Minotaur) → v `CHAR_META` dostane `dirP2`, čím sa
  naňho automaticky **prestane aplikovať CSS `alt-color` filter** (`usesAltColor()` vracia false).
- Výška postavy vo frame ~62–75 px zo 128 — rovnaká ako fire/wanderer, takže `PORTRAIT_SCALE`
  (client.js:243) pravdepodobne netreba; over vizuálne v char-selecte a HUD a prípadne dolaď.

## 2. Server (`server.js`)

1. **`CHARS`** (`server.js:70`): pridaj `"naruto"`:
   ```js
   const CHARS = ["fire", "lightning", "wanderer", "medusa", "minotaur", "naruto"];
   ```
   Tým sa automaticky povolí `choose_character` aj turnajový draft (`choose_team` validuje proti
   `CHARS`). Aktualizuj aj komentár na `server.js:138`.
2. **Balančné konštanty** (vrch súboru, pri `MEDUSA_MELEE_DMG` a `SPECIAL_COST`): doplň konštanty
   podľa mechaniky špeciálu (dmg / cena, ak nebude zdieľaná `SPECIAL_COST = 5`).
3. **Special** — podľa mechaniky (viď sekcia 5) jedna z dvoch ciest:
   - čisto **damage zóna** → pridaj vetvu do `specialDamageAndHit()` (`server.js:410`) — vzor
     fire/lightning/wanderer; generická časť `doSpecial()` (od `server.js:865`) sa postará o zvyšok
     (nádychy, reveal labyrintu, applyHit).
   - **status/board efekt** → vlastná vetva v `doSpecial()` pred generickou časťou — vzor Medúza
     (`server.js:821`, smerový + petrify) alebo Minotaur (`server.js:846`, celoplošný + labyrint).
4. **Smerový special?** Ak special potrebuje `dir` ako Medúza: over validáciu v `validQueue()`
   (`server.js:430`), dispatch `doSpecial(slot, tl, action.dir)` je už generický (`server.js:959`),
   a doplň random dir do auto-fill vetvy timeru (`server.js:1131`).
5. **Pravidlá enginu, ktoré musí special dodržať:**
   - každú zmenu stavu, ktorú má klient animovať, pushni cez `pushStateFrame()` s `delayMs` —
     stav bez framu sa na klientovi prejaví ako teleport;
   - deterministický zásah → `revealLabyrinths(tl)` **pred** animačnými frames (vzor všetky vetvy);
   - obrany: dmg special ide cez `applyHit()` (shield/mirror fungujú automaticky); status special
     musí obrany riešiť explicitne ako petrify/labyrint (shield blokuje, mirror odrazí efekt na castera);
   - po každom zásahu kontrola víťaza — `applyHit`/`applyPetrify`/`applyLabyrinth` to už robia.

## 3. Klient (`public/client.js`)

1. **`CHAR_META`** (`client.js:246`):
   ```js
   naruto: { name: "Naruto", dir: "naruto/Naruto_1", dirP2: "naruto/Naruto_2" },
   ```
2. **`SPECIAL_ANIMS`** (`client.js:230`): `naruto: { file: "Special.png", fps: SPECIAL_FPS, loop: true }`
   — rieši sa relatívne k `dir`/`dirP2`, takže P2 automaticky castí v žltom (vzor Medúza).
3. **`ABILITY_PREVIEW`** (`client.js:2570`): pridaj záznam (caster pozícia, `dmg` alebo
   `effect: {num, emoji}`, anglický `desc`) — panel ability v char-selecte.
4. **`cellsForSpecialPreview()`** (`client.js:1535`): pridaj vetvu pre naruto zónu.
   ⚠️ **Musí byť 1:1 so serverovou hit logikou** (`specialDamageAndHit` / vetva v `doSpecial`) —
   udržiavajú sa paralelne, nesúlad = klamlivý preview. Ak je special smerový, over aj zrkadlenie
   pre p2 v `renderAbilityPreview` (`client.js:2578`) — vzor Medúza.
5. **Voliteľné dolaďovačky:** `PORTRAIT_SCALE` (`client.js:243`) ak postava v kartách/HUD nesedí
   veľkosťou; `FX_OFFSET_X` (`client.js:238`) ak special sprite nie je centrovaný.
6. **`Special_2.png` zatiaľ nezapájaj** — rezerva na druhú schopnosť, zadávateľ vysvetlí neskôr.

## 4. Char-select (`public/index.html`)

Na strane 1 („Experimental", `index.html:227`) nahraď placeholder kartu `char-card soon`
(`index.html:238-241`) plnohodnotnou kartou podľa vzoru Minotaura:
```html
<div class="char-card" data-char="naruto">
  <canvas class="char-canvas" width="220" height="240" data-char="naruto"></canvas>
  <div class="char-stats hidden" data-char="naruto"><span class="char-hp"></span><span class="char-mana"></span></div>
  <div class="char-name">Naruto</div>
</div>
```
Zvyšok (hover preview, klik, mirrored p2 pohľad, tournament roster-mode ktorý stránky zlučuje cez
`display: contents`) je generický cez `data-char` — netreba nič dopisovať. Turnajové mage-heads
v HUD (`renderMageHeads`) sú tiež generické cez `CHAR_META`.

## 5. Special — doplní zadávateľ

Zadávateľ vysvetlí mechaniku osobne. Otázky, ktoré treba mať zodpovedané, kým sa začne kódiť
(určujú, ktorá cesta v sekcii 2/3 platí):

1. **Zóna zásahu** — ktoré bunky? (riadok / vzor / celoplošné / smerové left-right?)
2. **Účinok** — dmg (koľko?) alebo status/board efekt (čo presne, ako dlho trvá, čo ho ukončí)?
3. **Cena** — zdieľaná `SPECIAL_COST = 5` alebo vlastná?
4. **Interakcie** (pri status efekte nutné explicitne):
   - shield/mirror — blokuje/odráža sa efekt ako pri petrify/labyrinte?
   - súbeh s labyrintom, petrify, Last Standom, tournament swapom;
   - čo pri opakovanom caste na už postihnutého (vzor `already_stone`/`already_lost`).
5. **Special 2** — na čo je `Special_2.png` (druhá schopnosť? iný idle stav?) a či sa rieši teraz
   alebo v ďalšej iterácii.

Ak special zavádza nový stav hráča (ako `stone`/`labyrinth`), nezabudni na redakciu v
`snapshotFor`/`redactTimelineFor`, ak má byť pred niektorou stranou skrytý.

## 6. Testy a overenie

1. `npm test` musí prejsť celé (boot na :3996, `FORCE_FIRST_STARTER` pinuje štartéra).
2. Pridaj testy podľa vzoru Medúzy/Minotaura v `test/game-test.mjs` (`:624`, `:741` — pomocné
   fresh-game bloky s `choose_character`): výber naruta, special (zóna/efekt/cena many),
   interakcia so shield/mirror, tournament draft s narutom v tíme.
3. Manuálne: `npm start` → dva prehliadače (`?admin=1` na reset) — over char-select kartu
   (obe stránky, hover preview, p2 zrkadlo), P1 vs P2 paletu na boarde/HUD/ghoste/projektile,
   všetky animácie (move/dash/attack/melee/hurt/death), special cast + preview, tournament
   draft so 6-postavovým poolom a swap na naruta.

## 7. Známe zádrhely

- **Timeline pacing:** `*_MS` konštanty na serveri a `MOVE_MS`/`ATTACK_SWING_MS`… na klientovi
  musia ostať v synchrone, inak sa animácie rozídu s playbackom.
- **Preview parita:** `specialDamageAndHit`/`doSpecial` (server) ↔ `cellsForSpecialPreview`
  (klient) — každá zmena zóny na jednej strane sa musí premietnuť na druhú.
- **`SPECIAL_REPEAT` nádychy:** generická vetva aj status vetvy pushujú 3 „nádychové" frames —
  drž rovnaký rytmus, klient na ne viaže blikanie zóny.
- **Charge projektil:** klient berie `Charge.png` z `charDirFor()` → P2 zlatá verzia funguje
  automaticky, žiadny recolor v kóde (vzor Medúza komentár na `client.js:1476-1482`).
- Assety sú z ripnutého copyrightovaného sheetu — OK pre súkromný projekt, **nepublikovať**.
