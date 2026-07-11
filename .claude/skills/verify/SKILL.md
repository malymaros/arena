---
name: verify
description: Overenie zmien hernej logiky cez reálny server + 2 socket klientov (povrch = Socket.IO protokol)
---

# Verify — arena

Zmeny v `server.js` sa overujú cez reálne socket spojenia (rovnaký vzor ako `test/game-test.mjs`).

## Recept

1. Driver skript (`.mjs`) musí ležať **v repo roote** — ESM rieši `socket.io-client` podľa umiestnenia súboru, nie cwd (scratchpad nemá node_modules). Pomenuj `*.tmp.mjs` a po behu zmaž.
2. Server spawn: `spawn(process.execPath, ["server.js"], { env: { PORT: "3997", FORCE_FIRST_STARTER: "A", PLAYER_KEYS: "testpass" } })` + ~1200 ms na boot. `FORCE_FIRST_STARTER=A` → host (prvý pripojený, `create_room`) dostane p1.
3. Klient: `io(url, { transports: ["websocket"], auth: { name: "<1–8 znakov a–z>", pass: "testpass" } })`; potom `create_room` (c1) / `join_room` (c2), počkaj na `you_are`.
4. Setup: `configure_match` (host; `tileWeights: { dmg:0, heal:100, mana:0, ik:0 }` vypne náhodný tile dmg/IK), `choose_character` obaja, počkaj na `state` s oboma char.
5. Kolo: obaja `lock_in([akcia×3])`, počkaj na `state` s `timeline` + ~200 ms na root snapshot.

## Gotchas

- **Absolútne HP nie je dôkaz zásahu** — heal dlaždice môžu HP priebežne dvíhať. Dôkaz ber z timeline efektov (`kind: "hit"/"mirror"/"block"` + `target`).
- Poradie akcií: starter kola sa strieda (R1 = p1), akcie sa interleavujú starter-first — na armovanie obrany PRED útokom súpera treba obranu zaradiť tak, aby vyšla skôr v interleave.
- Štart: p1 (0,1), p2 (4,1); START_MANA 6, RECHARGE +4, basic 1, melee/dash/mirror 4, shield 2. Bezpečný whiff = attack up z riadku 1 (zasiahne prázdne (x,0)) alebo melee mimo zdieľanej bunky.
- Fronta = práve 3 akcie, každý typ max raz.
