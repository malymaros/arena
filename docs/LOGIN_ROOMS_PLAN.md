# Plán: prihlásenie (meno + heslo), zobrazenie mena v hre, zoznam roomiek

Cieľ: pred vstupom do hry **login** (meno + heslo, heslo rozdáva admin), po logine **zoznam roomiek**
(zatiaľ 1) s počtom hráčov a tlačidlom **Pripojiť** / **Pozorovať** (2/2 → len pozorovať), meno hráča
sa zobrazuje v hre. Validácia mena: **max 8 znakov `A–Z/a–z`, nič iné** (žiadne emoji/diakritika/medzery).

> Rozsah: **NIE** skutočné multi-room (singleton `game` ostáva), **NIE** DB/účty. Len brána + meno + jedna roomka
> s explicitným „join" krokom. Skutočné viac-hier-naraz je samostatný veľký refactor (viď „Mimo rozsah").

Fázovanie: **Fáza 1** = heslo + meno (rýchla hodnota: cudzí von, meno v hre). **Fáza 2** = room-browser obrazovka.

---

## Súčasný stav (na čom staviame)

- Identita = osoba **A/B** cez token `auth:{id}` (localStorage) — `client.js:12`, server `server.js:2300–2323`.
- Reclaim/grace: `personSockets/personIds/personFreedAt` + `RECLAIM_GRACE_MS` — `server.js:171–177`, `2305–2318`.
- **Divák už existuje**: 3. pripojenie dostane `spectator` → watch-only — `server.js:2323`, `client.js:4514`.
- Priradenie miesta je **automatické pri connecte** (`server.js:2322–2324`) — toto zmeníme na explicitný „join".
- Snapshoty: `snapshot()` `server.js:419`, `snapshotFor(person)` `:282` — sem pridáme mená.
- Obrazovky cez `.hidden` triedu: `#lobby`, `#lobby-wait`, `#char-select`, `#spectator` (index.html).

---

## FÁZA 1 — heslo + meno

### 1.1 Server: heslá (env)
- `server.js` (pri `ADMIN_KEY`, `server.js:28`): `const PLAYER_KEYS = new Set((process.env.PLAYER_KEYS||"").split(",").map(s=>s.trim()).filter(Boolean));`
  - jedno zdieľané heslo `PLAYER_KEYS=tajne`, alebo viac pre viac pozvaných `PLAYER_KEYS=alfa,beta,gama`.
  - ak je Set prázdny → brána vypnutá (spätná kompat., voľne prístupné — alebo zvoliť „prázdny = zamknuté", podľa preferencie).

### 1.2 Server: auth middleware (odmietne cudzích)
- Nad `io.on("connection")` (`server.js:2300`) pridať `io.use((socket, next) => {…})`:
  - `const pass = socket.handshake.auth?.pass;` → ak `PLAYER_KEYS.size && !PLAYER_KEYS.has(pass)` → `next(new Error("bad_pass"))`.
  - `const name = validateName(socket.handshake.auth?.name)` → ak neplatné → `next(new Error("bad_name"))`.
  - inak `socket.data.pendingName = name; next();`
- `validateName(raw)`: `typeof raw==="string"`, `const n = raw.trim()`, test `/^[A-Za-z]{1,8}$/` → vráť `n` alebo `null`.
  - (voliteľne case-normalizácia; jednoznačnosť mien neriešime — duplicitné povolíme.)

### 1.3 Server: uloženie a šírenie mena
- Stav: `let personNames = { A: null, B: null };` pri `server.js:174`.
- V connection handleri po priradení `person` (`server.js:2314–2319`): `personNames[person] = socket.data.pendingName;`
- Reset (`server.js:763`) a odpojenie s vypršaným grace: nulovať `personNames[person]`.
- Snapshot — do `snapshot()` (`server.js:419`) a `snapshotFor()` pridať:
  ```js
  names: { p1: personNames[game.seats.p1] || null, p2: personNames[game.seats.p2] || null }
  ```
  (mená sú **verejné** — žiadna redakcia; pozor len nezabudnúť ich pridať aj do `redactSnapshotFor`/`redactHunterActor` ceste tak, aby ostali, keďže tie kopírujú snapshot — mená nechať vždy viditeľné).

### 1.4 Klient: odložené pripojenie + login obrazovka
- `client.js:12`: `const socket = io({ auth:{ id: arenaId }, autoConnect:false });` (handlery sa registrujú ako doteraz).
- Perzistencia pre tichý reconnect po refreshi: `sessionStorage` (prežije refresh, nie zatvorenie tabu — rozumný kompromis pri hesle):
  - pri štarte ak `sessionStorage.pass && sessionStorage.name` → nastav `socket.auth={id,pass,name}` a `socket.connect()` (preskoč login).
  - inak zobraz `#login`.
- Nová obrazovka `#login` (index.html): input **meno** (`maxlength=8`, `pattern` + live sanitizácia `value.replace(/[^A-Za-z]/g,"").slice(0,8)`), input **heslo**, tlačidlo **Vstúpiť**, miesto na chybu.
  - submit: `socket.auth = { id: arenaId, pass, name }; socket.connect();` a ulož do `sessionStorage`.
- `socket.on("connect_error", err => …)`: `err.message==="bad_pass"` → „Nesprávne heslo", `"bad_name"` → „Neplatné meno" (a **nemazať** login screen). Vyčisti `sessionStorage`, aby refresh neopakoval zlý pokus.

### 1.5 Klient: zobrazenie mena v hre
- Snapshot má `names`. Vykresliť:
  - HUD boxy `#hud-p1`/`#hud-p2` — pridať meno do portrét-hlavičky (nájsť render HUD-u; štítky „YOU/OPPONENT" `client.js:236, 1846, 2550`).
  - voliteľne „YOU" vlajka nad postavou môže ukázať meno namiesto/vedľa „YOU".
  - divácky pohľad a game-over overlay (`showGameOverSequence`) — meno víťaza.
- Fallback ak `name==null` (napr. stará session): ukáž „P1/P2" ako dnes.

### 1.6 Testy
- `test/game-test.mjs` (2 socket klienti): pridať `auth:{ pass, name }` do `io(...)`, počkať na `connect`.
- Nové: zlé heslo → očakávaj `connect_error`; neplatné meno → `connect_error`; snapshot obsahuje `names`.

**Fáza 1 výsledok:** cudzí sa nepripoja, meno je v hre. Hráč po logine ide rovno do hry (ako teraz).

---

## FÁZA 2 — zoznam roomiek + Pripojiť/Pozorovať

Zmena lifecycle: po logine hráč **nevstúpi hneď**, ale vidí zoznam a klikne Pripojiť/Pozorovať.

### 2.1 Server: seat = explicitný krok (nie auto pri connecte)
- Refactor connection handlera (`server.js:2308–2324`):
  - **Reclaim vetva** (token už vlastní A/B, `2305–2306`): auto-seat ako dnes → `emit you_are` + `state` (preskočí room-browser — dôležité pre reconnect v rozohranej hre).
  - **Nový hráč**: **neprideľuj miesto**. Nastav `socket.data.stage="browsing"` a pošli `socket.emit("rooms", roomsSnapshot())`. Miesto sa pridelí až na `join_room`.
- `roomsSnapshot()`: 
  ```js
  const occ = ["A","B"].filter(p => personSockets[p] || inGrace(p)).length; // grace-held rátaj ako obsadené
  return [{ id:1, players: occ, max:2, phase: game.phase, joinable: occ<2, }];
  ```
  (`inGrace(p)` = `personIds[p] && Date.now()-personFreedAt[p] <= RECLAIM_GRACE_MS` — inak by Join padol na reject.)
- Broadcast `rooms` všetkým „browsing" socketom pri každej zmene obsadenia (connect/disconnect/join/reset).

### 2.2 Server: nové eventy
- `socket.on("join_room", ({roomId}) => {…})`:
  - ak už `socket.data.person` → ignoruj. Nájdi voľné miesto (`isFree("A")||isFree("B")`, logika z `2310–2312`).
  - voľné → priraď (`personSockets/personIds/personNames`, ako `2314–2319`), `emit you_are` + `state`, broadcast `rooms`.
  - plné → `emit("join_denied","full")` (klient prepne tlačidlo na Pozorovať).
- `socket.on("spectate_room", ({roomId}) => { socket.emit("spectator"); socket.emit("state", snapshot()); })`
  - (znovupoužije existujúci spectator kanál `client.js:4514`).

### 2.3 Klient: room-browser obrazovka
- Nová `#rooms` (index.html): karta „Roomka 1", text „hráči: n/2", tlačidlo **Pripojiť** (ak `joinable`) alebo **Pozorovať** (ak `!joinable`).
- `socket.on("rooms", list => renderRooms(list))` → vykreslí kartu, po logine ukáž `#rooms` namiesto priameho vstupu.
- tlačidlá: `socket.emit("join_room",{roomId:1})` / `socket.emit("spectate_room",{roomId:1})`.
- `socket.on("you_are", …)` (`client.js:4470`) → skry `#rooms`, pokračuj existujúcim flow (lobby/wait/char-select).
- `socket.on("join_denied", …)` → prekresli kartu s tlačidlom Pozorovať (medzičasom sa naplnila).
- Reclaim (server pošle `you_are` hneď po connecte) → `#rooms` sa ani neukáže.

### 2.4 Testy
- Rozšíriť: 2 klienti sa po logine `join_room` posadia (FORCE_FIRST_STARTER ostáva funkčný — pozor, roll prebehne až po `configure_match` ako dnes).
- 3. klient: `rooms` ukáže `players:2, joinable:false`; `join_room` → `join_denied`; `spectate_room` → `spectator`.

---

## Edge-cases (skryté náklady — nezabudnúť)

- **Reconnect / refresh v rozohranej hre:** token reclaim musí obísť login (sessionStorage pass+name) aj room-browser (server pošle `you_are` hneď). Bez toho hráča vyhodí na prihlásenie uprostred zápasu.
- **Grace-held miesto:** odpojený-ale-reclaimovateľný hráč sa v `roomsSnapshot` ráta ako obsadený (`inGrace`), inak by tretí klikol Pripojiť a dostal reject; a pôvodný by sa nemal kam vrátiť.
- **Host lobby flow** (`configure_match`, `server.js:2327`) sa nemení — spustí sa až keď je A posadený. Room-browser je len PRED posadením.
- **Turnaj / labyrint redakcia:** mená sú verejné → pridať ich do snapshotu tak, aby ich `redactSnapshotFor`/`redactTimelineFor` NEmazali (netýka sa polohy/many).
- **admin_reset_all** (`server.js:2434`, `759`) odpojí oboch → padnú na login; `personNames` vyčistiť v resete.
- **Heslo v sessionStorage** = mierne riziko (XSS by ho prečítal). Na zdieľané pozývacie heslo cez HTTPS akceptovateľné; nepersistovať do localStorage.
- **Prázdny `PLAYER_KEYS`:** rozhodnúť „vypnutá brána" vs „všetko zamknuté". Odporúčam: prázdny = brána vypnutá (dev/lokál), v produkcii nastaviť env cez systemd (`Environment=PLAYER_KEYS=…` v `deploy/arena.service`).

---

## Odhad práce

| Časť | Náročnosť | Odhad |
|---|---|---|
| F1: heslo (middleware + env + login screen + connect_error) | nízka–stred | ~0.5 dňa |
| F1: meno (validácia oba, snapshot, render v HUD/marker/game-over) | nízka–stred | ~0.5 dňa |
| F2: room-browser (explicitný join, `rooms`/`join_room`/`spectate_room`, screen, grace) | stredná | ~1 deň |
| Testy + edge-cases (reconnect, 3. klient, turnaj) | stredná | ~0.5–1 deň |
| **Spolu** | | **~2–3 dni** |

## Mimo rozsah (samostatné, veľké)
- **Skutočné multi-room** (viac hier naraz): singleton `game` → `Map<roomId, game>` + smerovanie VŠETKÝCH eventov a broadcastov cez room (Socket.IO rooms). Veľký refactor celého `server.js`. Čistý „join" krok z F2 to do budúcna zľahčí, ale ostáva veľké.
- **Perzistentné účty / štatistiky / rebríček** = DB (SQLite/Postgres). Teraz všetko v pamäti.

## Dotknuté súbory (súhrn)
- `server.js`: env heslá (~28), `personNames` (~174), `io.use` middleware (~2300), refactor connect + `join_room`/`spectate_room` + `roomsSnapshot` (~2308–2324), disconnect broadcast (~2439), snapshot mená (~282, 419), reset (~763).
- `public/client.js`: socket `autoConnect:false` + connect po logine (~12), `connect_error`/`rooms`/`join_denied` handlery, úprava `you_are`/`spectator` (~4470, 4514), render mena v HUD (~236, 2550, game-over).
- `public/index.html`: nové obrazovky `#login`, `#rooms` (+ CSS).
- `test/game-test.mjs`: auth v `io(...)`, `join_room` krok, testy brány/mena/diváka.
- `deploy/arena.service`: `Environment=PLAYER_KEYS=…` (produkčné heslá).
