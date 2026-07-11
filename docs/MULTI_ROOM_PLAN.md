# Implementačný plán: viac roomiek naraz

Cieľ: umožniť **N nezávislých roomiek** (min. 2) na jednom serveri namiesto dnešnej jedinej globálnej hry.
Tento dokument je len plán — **nič sa zatiaľ neimplementuje.**

## 1. Východiskový stav (čo dnes bráni viacerým roomkám)

Celá herná logika v `server.js` (3137 r.) pracuje nad **jedným globálnym singletonom**:

| Globál | Charakter | Poznámka |
|---|---|---|
| `game` | objekt, **336×** `game.` | celá logika: `resolveTurn`, `doSpecial`, `applyHit`, `snapshot(For)`, tiles, labyrint, klon, pasce |
| `personSockets` / `personIds` / `personNames` / `personFreedAt` | objekty `{A,B}` | identita/socket/reconnect grace |
| `turnTimer` | primitív (handle) | jeden časovač na celý server |
| `pendingMatchConfig` | primitív | host stlačil START pred príchodom súpera |
| `roomExists` (bool!) / `roomDestroyTimer` | primitív | drôtované na presne 1 roomku |
| `browsing` | Set socketov | hráči na room-browseri — **správne globálne, ostáva** |

Room-slovník **už existuje** (`create_room`, `join_room`, `spectate_room`, `leave_room`, `roomsSnapshot`, `broadcastRooms`, `destroyRoom`, `scheduleRoomDestroyCheck`), ale je limitovaný na 1 roomku (`roomExists` je bool).

Dva jadrové problémy:
1. **Per-room stav** — všetko z tabuľky (okrem `browsing`) musí existovať raz na roomku.
2. **Scoping broadcastov** — dnes sa stav sype všetkým:
   - `emitStateMasked()` (r. 474) iteruje **cez všetky sockety** `io.sockets.sockets`.
   - `io.emit(...)` je použité **11×**: `reset`, `state`, `color_roll`, `game_result`, `game_over`, `new_game`, `turn_timer` (v `clearTurnTimer`, `beginPlanningTimer`, `forceResetAll`, `handleGameEnd`, `startMatch`, `retry`).
   Bez scopovania by roomka B dostávala stav roomky A.

## 2. Zvolený prístup: **Room factory (closure)**

Zabaliť celý blok per-room stavu **a všetkých funkcií, čo naň siahajú**, do `createRoom(id)`. Funkcie sa stanú closure nad room-lokálnymi premennými namiesto module-globálov — **netreba prepisovať 336 `game.` call-sitov** (referencujú `game` lexikálne, len sa zmení, nad čím sa uzatvárajú).

```
function createRoom(id) {
  // --- per-room stav ---
  let game;
  let personSockets = { A:null, B:null }, personIds = {...}, personNames = {...}, personFreedAt = {...};
  let turnTimer = null, roomDestroyTimer = null, pendingMatchConfig = null;

  // --- celá herná logika (dnešné r. ~227–2818) sem presunutá ---
  function newPlayer(){…}  function newGame(){…}
  function snapshot(){…}    function snapshotFor(){…}   function emitStateMasked(){…}
  function resolveTurn(){…} … doSpecial/applyHit/…      startMatch/handleGameEnd/…
  function beginPlanningTimer(){…} clearTurnTimer(){…}

  // --- per-room emit helper (nahrádza io.emit) ---
  function roomEmit(ev, payload){ for (const p of ["A","B"]) personSockets[p]?.emit(ev, payload);
                                  for (const s of spectators) s.emit(ev, payload); }

  return { id, seat, handleDisconnect, roomsRow, isEmpty, destroy, /* + socket handler dispatch */ … };
}
```

Globálna vrstva (mimo factory) sa zúži na **routing + register roomiek**:
```
const rooms = new Map();     // id -> Room
const browsing = new Set();  // sockety na room-browseri (globálne)
let nextRoomId = 1;
```

### Čo ostáva module-global (mimo factory)
- `io`, `app`, `httpServer`, statika, `io.use` middleware (heslo+meno).
- **Čisté konštanty** (HP/mana/dmg/`*_MS`, `CHARS`, `START_POS`, `BOARD`…) a **pure helpery** bez `game` (`validateName`, `sanitizeConfig`, `rollTileType`, `okAdmin`…). Ostávajú hore, factory ich používa cez closure na module scope.
- `rooms` Map, `browsing` Set, `nextRoomId`, room-browser funkcie (`roomsSnapshot` → **zoznam**, `broadcastRooms`).

### Alternatíva (nižšia námaha, vyššia krehkosť) — „ambient pointer"
Keďže Node je single-thread a resolveTurn/timeline je **plne synchrónny** (žiadny `await` uprostred), dá sa namiesto factory nechať funkcie na module scope a na začiatku každého entry-pointu prepnúť ambientný pointer `game = room.game` (mutácie objektov `personSockets.A=…` píšu skrz pointer). **Reassignované primitívy** (`turnTimer`, `pendingMatchConfig`, `roomDestroyTimer`) by museli byť room-properties.
- ✅ Diff je malý (~desiatky riadkov namiesto presunu ~2600 r. do factory).
- ❌ Footgun: akýkoľvek budúci `await` uprostred ťahu ambient stav rozbije; časovačové callbacky musia pointer poctivo obnoviť. Neodporúčam ako primárnu cestu, ale je to legitímna rýchla verzia.

> **Rozhodnutie pre teba:** factory (robustné, väčší diff) vs. ambient pointer (rýchle, krehké). Zvyšok plánu píšem pre **factory**.

## 3. Server — zmeny po blokoch

### 3.1 Room registry + routing (nová globálna vrstva)
- `rooms: Map<id, Room>`, `nextRoomId`.
- `roomForSocket(socket)` → z `socket.data.roomId`.
- `roomsSnapshot()` → **pole** riadkov: `[{ id, players, max:2, phase, canJoin }]` + globálne `canCreate` (napr. limit max roomiek).
- `broadcastRooms()` → pošli zoznam každému v `browsing`.
- Voliteľne `MAX_ROOMS` konštanta (napr. 4), aby sa server nezahltil.

### 3.2 `io.on("connection")` (r. 2924) — prepis routingu
- **Reclaim naprieč roomkami**: dnes pozerá len na globálne `personIds`. Nové: prejdi `rooms`, nájdi roomku, kde `personIds.A/B === cid` a je vo grace → `room.seat(...)` do tej roomky (`socket.data.roomId = room.id`, `socket.join(room.id)`).
- Inak → `browsing.add(socket)`, pošli zoznam roomiek.

### 3.3 Room-lifecycle handlery (dnes r. 2957–2993)
- `create_room` → globálne: vytvor `createRoom(nextRoomId++)`, vlož do `rooms`, `room.seat("A")`, `socket.data.roomId=id`, broadcast. Guard: `person`/limit `MAX_ROOMS`.
- `join_room` / `spectate_room` → **musia niesť `roomId`** (klient ho pošle): `rooms.get(roomId)` → `room.seat("B")` / spectator. Guardy (`full`, neexistuje) ostávajú, len per-room.
- `leave_room` → `room.leave(socket)`; ak `room.isEmpty()` → `room.destroy()` + `rooms.delete(id)`.

### 3.4 Herné handlery (`configure_match`, `choose_team`, `choose_character`, `lock_in`, `draft_queue`, `retry`, `admin_reset_all`, `disconnect`)
- Každý na začiatku: `const room = roomForSocket(socket); if(!room) return;` a **volá metódy/funkcie danej roomky** (v factory verzii sú to closure funkcie, dispatchnuté cez `room`).
- `admin_reset_all` → globálne: zruš/obnov **všetky** roomky (`forceResetAll` iteruje `rooms`).
- `disconnect` → `room.handleDisconnect(socket)` (uvoľní socket, `personFreedAt`, `clearTurnTimer`, `scheduleRoomDestroyCheck`) **+** `browsing.delete`.

### 3.5 Scoping emitov (kritické)
- V rámci roomky **nahradiť `io.emit` → `roomEmit`** (11 sitov) a `emitStateMasked` iteráciu `io.sockets.sockets` → iterovať len **hráčov+divákov roomky**.
- Zaviesť `room.spectators: Set` (dnes divák dostane `snapshot()` raz a nič ďalej ho neaktualizuje na globálnom broadcaste — pri per-room treba divákov evidovať a posielať im `roomEmit`). Divákom sa posiela **nemaskovaný** `snapshot()` (ako dnes).
- Socket.IO natívne rooms: `socket.join(room.id)`; broadcast cez `io.to(room.id)` je alternatíva k manuálnemu setu (pozn.: maskovanie `snapshotFor` je per-osoba, takže hráčom aj tak treba adresný emit; `io.to` sa hodí len pre nemaskované eventy).

### 3.6 `turnTimer` / `roomDestroyTimer` / `pendingMatchConfig`
- Per-room (v closure). `beginPlanningTimer`/`clearTurnTimer`/`onTurnTimeout` uzatvárajú room → žiadne prebíjanie časovačov medzi roomkami.

## 4. Klient (`public/client.js`, `public/index.html`)

Zmeny sú **kontajnerované na room-browser** — herná časť sa nemení.

- `renderRooms(info)` (r. 64) dnes kreslí jednu „ROOM 1". Nové: `info` je **pole roomiek** → cyklus, každá karta má `Join`/`Spectate` s vlastným `roomId`, plus stále „CREATE ROOM" (ak `canCreate`).
- `socket.emit("join_room")` / `"spectate_room"` → pridať argument `roomId` (r. 85, 89).
- `socket.on("rooms", info)` (r. 96) — `info` teraz zoznam; render bez ďalších zmien logiky.
- `index.html` — `#rooms-list` už existuje; prípadne drobný CSS na viac kariet.
- Reconnect/reclaim na klientovi netreba meniť (token rieši server).

## 5. Testy (`test/game-test.mjs`)

- Dnes bootuje 1 server + 2 klientov. Pridať scenár **2 roomky súčasne**: 4 klienti (2+2), overiť **izoláciu** — akcia v roomke A nesmie doraziť do roomky B (chytáva scoping regresie).
- Overiť, že `FORCE_FIRST_STARTER` funguje per-room (dnes globálny env — buď ostáva globálny default, alebo per-room; pre test stačí globálny).
- Smoke: create → join → odohrať 1 kolo v oboch roomkách naraz.

## 6. Fázovanie (aby bolo priebežne funkčné)

1. **Refaktor bez zmeny správania**: presun stavu+logiky do `createRoom`, `rooms` Map s **max 1 roomkou** (limit), `roomEmit`/spectators, per-room timery. Cieľ: hra sa správa 1:1 ako dnes, `npm test` zelené.
2. **Uvoľniť limit na N**: routing `join/spectate` s `roomId`, `create_room` viac roomiek, `admin_reset_all` naprieč, reclaim naprieč roomkami.
3. **Klient**: zoznam roomiek + `roomId` v eventoch.
4. **Test**: 2-room izolačný scenár.
5. Deploy (systemd restart podľa `CLAUDE.md`).

## 7. Riziká a edge-cases (na strážiť)

- **Presakovanie broadcastov** — hlavné riziko; pokryť izolačným testom (fáza 4).
- **Reconnect grace naprieč roomkami** — token musí trafiť správnu roomku (`personIds` je teraz per-room; hľadať vo všetkých).
- **Divácky stream** — dnes divák nedostáva priebežné updaty na globálnom `io.emit`? Overiť: `emitStateMasked` posiela aj im (iteruje všetky sockety). Per-room `roomEmit` musí divákov evidovať, inak im zamrzne obraz — **regresia, ak sa zabudne**.
- **`connectionStateRecovery`** (r. 17, `skipMiddlewares`) — recovnutý socket obíde `io.use`; pri routingu do roomky sa spolieha na `socket.data.roomId`, ktoré po recovery **nemusí byť** nastavené → fallback na token-reclaim.
- **Subtílna redakcia** (labyrint/klon/pasca v `snapshotFor`/`redactTimelineFor`) — logiku **nemeníme**, len uzavrieme do roomky; treba len overiť, že číta room-lokálny `game`, nie starý globál.
- **Admin/`retry`/`forceResetAll`** — nesmú zrušiť cudziu roomku.

## 8. Odhad

| Časť | Rozsah |
|---|---|
| Server refaktor (factory + scoping + routing) | 1 väčšia session, mechanicky rozsiahle, logika nezmenená |
| Klient (zoznam roomiek + roomId) | menší |
| Testy | menší (nový 2-room scenár) |
| Riziko | stredné — sústredené v scopingu broadcastov a reconnect routingu |
