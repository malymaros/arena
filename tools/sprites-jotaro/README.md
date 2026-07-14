# Jotaro + Star Platinum sprite pipeline (JUS)

Extrakcia herných pásov pre Jotara a jeho stand z fan sheetov v JUS štýle (autor
Ryudara323) + jeden riadok zo SNES ripu (SmithyGCN). Zdroje na ploche
(`C:/Users/maly/Desktop/Jotaro/`):

- `jotaro_kujo_update_by_ryudara323_deaorlc.png` — Jotaro, zelené pozadie (0,127,14)
- `star_platinum_ova_sprite_jus_by_ryudara323_deaxfn3.png` — Star Platinum, šedé pozadie (63,63,63)
- `SNES - JoJo's Bizarre Adventure (JPN) - ... .png` — SNES rip, modré pozadie (0,64,128)

Všetko sú nepravidelné koláže na jednofarebnom pozadí. Sprity sú malé (~30×61 px),
preto **jednotný 2× nearest-neighbor upscale**. Formát výstupu: štvorcové frames
v horizontálnom páse (engine odvodí počet = šírka/výška), veľkosť framu je
per-segment (salvy s FX potrebujú viac než 128 px), kotva `bottom`/`center`.
Výstupy zatiaľ NIE sú v `public/assets/` — mapovanie na herné súbory a kit postavy
sa ešte nerozhodli.

*(Pôvodne tu bola aj vetva z CPS3 frame-dumpu `JotaroKujo/` — 817 snímok z Heritage
for the Future; zahodená v prospech štýlovo konzistentnej JUS vetvy, v ktorej má
Jotaro aj vlastné údery. Dump ostáva na ploche.)*

```
node detect_jus.cjs <sp|jotaro|snes>   # detekcia buniek -> cells_*.json + overview_*.png
node row_jus.cjs <sp|jotaro|snes> N    # 2x náhľad riadku N -> row_jus.png
node pack_jus.cjs    # Jotaro: zloženie pásov -> out/jus/*.png
node pack_sp.cjs     # Star Platinum: zloženie pásov -> out/sp/*.png
node pack_snes.cjs   # SNES: SP_SnesMenace (riadok 3, prefarbený) + out/char/Charge.png (ruka, bunka 6.3)
node pack_char.cjs   # kompozity Jotaro+stand pre buducu postavu -> out/char/*.png (herne nazvy)
viewer.html          # animovaný náhľad všetkých pásov (otvoriť priamo v prehliadači)
```

Konfigurácia sheetov (zdroj, farba pozadia, filter artworku) je `jus_sheets.cjs`;
spec animácií (bunky per pás + kotva) je `SEGMENTS` v `pack_jus.cjs`/`pack_sp.cjs`.
V speci môže byť namiesto id bunky aj explicitný box `{x0,y0,x1,y1}` — používa sa
tam, kde detekcia zliala susedné sprity (Jotarova bunka 12.2).

## Assety postavy (`public/assets/jotaro/`)

`pack_char.cjs` kopíruje hotové pásy pod herné názvy akcií. Jotaro a Star Platinum
sú **samostatné sprity** — Jotarov pás nesie názov akcie, standov pás k tej istej
akcii má príponu `_P` (vzájomnú pozíciu oboch figúr bude riešiť klient pri
integrácii, kompozitné pečenie do jedného framu sa neosvedčilo). P1/P2 sa zatiaľ
nerozlišuje.

| akcia | Jotaro | stand (`_P`) |
|---|---|---|
| `Idle` | J_CoatIdle (6) | SP_Idle (4) |
| `Run` | J_Run (8) | SP_Jabs (4) |
| `Attack_1` (cast strely) | J_FistRaise (5) | SP_Idle (4) |
| `Attack_2` (melee) | J_Idle (6) | SP_Barrage (6) |
| `Special_1` | J_Idle (6) | SP_BarrageUp (6) |
| `Special_2` | J_Idle (6) | SP_Punch (10) |
| `Special_3` | — | SP_SnesMenace (4) |
| `Dead` | J_Dead (3) | SP_Unsummon (6) |
| `Hurt` | J_Hurt (4) | — |
| `Charge` | oddelená ruka standu zo SNES sheetu (bunka 6.3, predposledný riadok), prefarbená rovnakým remapom — letiaci projektil (generuje `pack_snes.cjs`) | |

## Jotaro (`out/jus/`)

V tomto sheete má Jotaro plnohodnotné vlastné útoky vrátane ora-ora salvy
(veľké ružové päste) — stand na základný kit netreba.

Pásy: `J_Idle` (6), `J_Run` (8), `J_Dash` (2), `J_Guard` (3), `J_Jump` (6), `J_Hurt` (4),
`J_Dead` (3 — pád + ležanie), `J_Getup` (4), `J_Taunt` (8), `J_Punch` (4 — priamy úder
s ružovým svišťom), `J_Kick` (5), `J_CoatIdle` (6 — vlajúci plášť, win/intro), `J_Point` (4 —
ukázanie prstom), `J_CapTip` (4 — ruka na šiltovku, „yare yare"), `J_Jabs` (5), `J_Hook` (7),
`J_Barrage` (6 — ora-ora salva), `J_Uppercut` (5), `J_FistRaise` (5). Ďalší nevyužitý
materiál v sheete: ležanie/prevaly (riadok 5), podrep (7), plášťové postoje (10–11, 13–18, 24–25).

## Star Platinum (`out/sp/`)

Počíta sa s nasadením ako krátko sa zjavujúci efekt (summon → salva → unsummon),
nie ako trvalo stojaca postava.

Pásy: `SP_Idle` (4), `SP_Punch` (10 — ťažký priamy úder), `SP_Barrage`/`SP_BarrageUp` (6/6 —
ora-ora salvy), `SP_BarrageAir` (10 — veľké vzdušné FX), `SP_Summon` (5 — dym → silueta →
stand), `SP_Unsummon` (6 — spätný priebeh), `SP_Jabs` (4), `SP_Uppercut` (6),
`SP_SnesMenace` (4 — viď nižšie).

### SP_SnesMenace (zo SNES sheetu, prefarbený)

Riadok 3 SNES sheetu (vizuálne 4. riadok) = 4 sprity predkloneného trupu Star Platinuma
s päsťami (menacing/punch-lean pózy). `pack_snes.cjs` ich extrahuje a **prefarbí exaktným
remapom 16-farebnej SNES palety** (nameraná z riadku) na farby namerané z JUS SP idle
buniek — gaštanové telo → perivinka/levanduľa, magenta šál/pás → JUS modrá, zlato → JUS
zlatá, šedé → modro-šedé; zlaté pancierové päste ostávajú zlaté (vlastnosť SNES designu).
