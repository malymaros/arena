# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A 2-player turn-based browser arena game (wizard duel on a 5×3 grid) built with Express + Socket.IO. No build step, no tests, no linter — plain JS served statically. Code comments are in Slovak.

## Commands

```
npm start        # node server.js → http://localhost:3000
npm test         # integration tests — boots the server on :3996, drives 2 socket clients (test/game-test.mjs)
```

Environment variables: `PORT` (default 3000), `ADMIN_KEY` (optional password for admin reset; if unset, reset is open).

## Architecture

Two files contain all the logic:

- `server.js` — authoritative game state and turn resolution (single global game, exactly 2 player slots: `p1`/`p2`)
- `public/client.js` — rendering, animation, and input; trusts the server's state but replays it via timelines

### Server-authoritative timeline model

The core pattern: the client does **not** simulate the game state. Each turn, both players queue exactly 3 actions (`move`, `dash`, `recharge`, `attack`, `melee`, `special`, `shield`, `mirror`) — each action type at most once per round, enforced both in the client UI and in server-side `validQueue()` — and emit `lock_in`. Two optional extra actions can wrap the queue: the round's **non-starter** may prepend `golden_shield` (3 mana, resolved before the starter's first action, behaves exactly like a shield), and **either player** may append `golden_mana` (resolved after everything else in the round; +6 mana for HP, the HP cost grows by 1 with each use per game — tracked in `manaRefills`, refused if it would kill or mana is full). `move`, `dash` and `attack` carry a `dir` (up/down/left/right): the basic attack fires in the chosen direction and hits the first opponent in its path (damage falloff 3/2/1 by distance, never its own cell), so aiming is a prediction of where the opponent will be when the action resolves. `dash` (4 mana) moves up to 2 cells in one direction (clamped at the board edge; no possible movement = invalid). `melee` (4 mana, 8 dmg) hits only an opponent sharing the caster's cell. For planning previews the client simulates its **own** queued moves ("ghost"): a translucent sprite shows the post-move position and aim/special previews are computed from the position valid at that point in the queue (`simulatedPositions()`/`ghostPos()` in `client.js`). When both are locked, `resolveTurn()` executes actions interleaved (starter alternates by turn parity: odd → p1, even → p2), and builds a **timeline** — an array of state snapshots, each with an `effects` array (`charge`, `hit`, `recharge`, `special`, `invalid`) and a `delayMs`. The whole timeline is emitted in one `state` event; the client plays it back frame-by-frame with `setTimeout` in `schedulePlayTimeline()`, mapping effects to sprite animations.

When changing game logic, the server-side `do*` action functions must push frames via `pushStateFrame()` for anything the client should animate — state changes without frames render as teleports.

Turn resolution checks for a winner (`hp <= 0`) after **every individual action and every individual tile hit** and aborts the rest of the turn on lethal — the first death ends the game, so a draw cannot occur. `game_over` is emitted alongside the final timeline, but the client deliberately delays the overlay until attack/death animations finish (`serverWinner` + `showGameOverSequence`).

### Socket protocol

Client → server: `choose_character` (fire | lightning | wanderer), `lock_in` (array of 3 actions, or 4 with `golden_shield` first — only valid from the round's non-starter), `retry`, `admin_reset_all`.
Server → client: `you_are` (slot assignment, first-come-first-served), `state` (snapshot, optionally with `timeline`), `game_over`, `reset`.

### Game balance constants

All tuning lives at the top of `server.js`: HP/mana, costs, damage, and animation pacing (`*_MS` constants — currently 2× slowed). Client-side timing constants in `client.js` (`MOVE_MS`, `ATTACK_SWING_MS`, etc.) must stay in sync with the server's `delayMs` values or animations desync from the timeline playback.

Character specials differ by hit zone: fire hits the whole row (5 dmg), lightning hits every cell of the **opposite chess-color** to the one it stands on — half the board, and each orthogonal move flips its parity (3 dmg) — wanderer hits diagonal-adjacent only (8 dmg). The hit logic is in `specialDamageAndHit()` (server) and must match `cellsForSpecialPreview()` (client hover/cast preview) — they are maintained in parallel.

Defenses cover **the opponent's next action** after activation and are consumed by it even if it dealt no damage: shield (2 mana) blocks all damage, mirror (4 mana) reflects the full damage back at the attacker (applied raw — reflected damage cannot be shielded or re-reflected), golden shield (3 mana, pre-round extra action of the non-starter) sets the same `shield` flag. All are armed/consumed in the `resolveTurn()` loop, applied in `applyHit()`, and expire at end of round — they do **not** carry over. Strict interleaving means two own defenses are never armed simultaneously — each one covers exactly the opponent action that follows its activation.

Special tiles spawn at the end of every round (75% dmg, rest heal/mana/IK) and resolve at the **end of each step** in `endOfStepTileEffects()`: dmg tiles are permanent (1 dmg if standing on them), heal/mana are the only consumables (taken by the round starter if both players share the cell), and the single IK tile (10 dmg) is the only overlay — it relocates each round and hides tiles beneath it. Tile damage bypasses all defenses (shield/mirror).

HP and mana both cap at 10 and are rendered in the HUD as 10-segment bars (`renderBar()` in `client.js`). Tile size is rectangular, driven by the `--tile-w`/`--tile-h` CSS variables, which `client.js` reads at startup (`TILE_W`/`TILE_H`).

### Sprites and assets

Sprite sheets are horizontal strips in `public/assets/<char>/`; frame count is inferred from `width / height` (frames must be square). Animation definitions (file, fps, loop) live in `ANIM_DEF` / `SPECIAL_ANIMS` in `client.js`. Arena background layers are listed in the client-side `ARENAS_CLIENT` map and loaded from `public/arenas/<key>/`. Background layers render into low-res canvases (`ARENA_RES`, upscaled with `image-rendering: pixelated`).

### Admin reset

`GET /admin/reset-all?key=…` or the socket event `admin_reset_all` disconnects both players and recreates the game. The client shows a reset button when loaded with `?admin=1` (optionally `&key=…`).
