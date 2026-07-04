# Plán: pridanie Naruta ako 6. postavy

> **STAV: ZREALIZOVANÉ.** Naruto je v hre vrátane specialu (tieňový klon) — plná špecifikácia
> mechaniky je v sekcii [5](#5-special-tieňový-klon-implementované) a technický popis v `CLAUDE.md`
> (odsek „Shadow clone"). Testy: T46–T52 v `test/game-test.mjs`. Dokument ostáva ako záznam
> rozhodnutí. `Special_2.png` je zapojený v summon choreografii; prípadný „special 2" ako
> samostatná schopnosť je stále otvorený.

Handoff dokument — assety sú hotové a v repe, tento plán popisuje kroky integrácie do servera
a klienta.

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

## 5. Special: tieňový klon (implementované)

Finálna špecifikácia od zadávateľa (rozhodnutia potvrdené v Q&A):

- **Cast:** range self, cena `SPECIAL_COST = 5`, nedá sa blokovať ani odraziť. Naruto musí stáť
  na bunke **sám** (bez súpera) — inak `not_alone` invalid a mana sa neminie. Recast s aktívnym
  klonom: starý klon najprv zmizne (ako po zásahu), potom bežný summon. Choreografia: pečate
  (`Special.png`, 3 nádychy) → `clone_summon` (Naruto + 2 kópie po bokoch hrajú `Special_2.png`)
  → klon vzniká na Narutovej bunke (`clone_born`).
- **Správanie klona:** kopíruje všetky základné akcie paralelne s Narutom; jediná inverzia je
  vertikálny pohyb (hore↔dole, dash s vlastným clampom). Ak je Narutov ťah neplatný, klon nespraví
  nič. Na zdieľanej bunke s Narutom sa kreslí len jedna postava. Mana je jeden zdieľaný pool.
- **Ofenzíva klona:** klon dáva **rovnaký dmg ako Naruto** — strela s plným falloffom (podľa vlastnej
  vzdialenosti klona), melee `MELEE_DMG`, obe s rovnakými násobičmi (Last Stand/Hope, maze). Ak stojí
  klon **na Narutovej bunke**, útok rovnakým smerom trafí dvakrát = **2× dmg** (platí pre horizontálnu
  strelu a melee; vertikálna strela sa cez inverziu rozdelí hore/dole). `CLONE_DMG = 1` ostáva už len
  ako **pohlt** na zdieľanej bunke (zvyšok strely prejde na Naruta) — útok aj odraz jeho mirrorom
  vracajú plný dmg ako Naruto.
- **Obrany:** klon zdieľa Narutove shield/mirror flagy (armujú sa aj spotrebúvajú spolu, glow na
  oboch — pár je nerozoznateľný). Súperova obrana kryje Narutovu + klonovu strelu ako JEDNU akciu;
  odraz klonovej strely mirrorem zničí klona (HP Naruta netknuté).
- **Zánik:** klon nemá HP — zmizne pri akomkoľvek zásahu: strela (klon v dráhe absorbuje skôr než
  Naruto na tej istej bunke — čerstvý klon je jednorazový bait), melee, zónové specialy (zasiahnu
  hráča aj klona naraz), petrify/labyrint (status ho zničí, ak nebol krytý obranou), démon, IK tile.
  Ďalej pri recaste, smrti/swape Naruta a na konci hry. Dmg tile ho nezabíja (len kozmetický −1);
  heal/mana pickupy neberie (nespotrebovaný pickup ho prezrádza).
- **Labyrint:** zásah NA klona labyrint neodhalí ani neukončí a prekliaty strelec sa oň nedozvie
  (strela preletí cez dym po okraj, `clone_die` sa mu rediguje; klon je v redakcii skrytý ako
  Naruto). Zásah SPÔSOBENÝ klonom je bežný action hit (labyrint končí). Klon sa ráta do pretínania
  Ariadninej nite (silueta na mieste stretnutia — bait).

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
