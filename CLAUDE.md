# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Start the server (node server.js) on port 3000
```

No build step, no tests, no linter. The project runs directly with Node.js ESM.

## Architecture

Two-player browser fighting game using Express + Socket.io. All game logic lives on the server; the client handles rendering and input only.

### Files

- `server.js` — HTTP server, game state, all game logic, Socket.io event handlers
- `public/client.js` — Client: socket events, canvas rendering, animation state machine, timeline playback
- `public/index.html` — Static HTML shell
- `public/styles.css` — All styles, including `--tile` CSS variable (224px) used by both CSS and client.js
- `public/assets/<char>/` — Sprite sheets for `fire`, `lightning`, `wanderer` characters (Idle, Run, Walk, Attack_1, Attack_2, Hurt, Dead)
- `public/assets/hamehame.png` — Ultimate attack animation (root-level, not in a char subdirectory)
- `public/arenas/bridge/` — Parallax background layers for the bridge arena

### Server game loop (`server.js`)

The server holds a single global `game` object (supports exactly 2 concurrent players). Each turn:
1. Both players queue 3 actions (`lock_in` socket event)
2. When both are locked, `resolveTurn()` runs all actions in order, building a `timeline` array of state snapshots with `effects` and `delayMs`
3. The full `timeline` is broadcast via `io.emit("state", { ...snapshot, timeline })`

Actions: `move`, `recharge`, `attack` (basic — fires projectile along row), `special` (char-specific area), `ultimate` (same-tile, 10 dmg)

Special damage by character:
- `fire` — 4 dmg if on same row
- `lightning` — 2 dmg if not on same tile
- `wanderer` — 8 dmg if diagonally adjacent (1 step)

### Client rendering (`public/client.js`)

- **Sprite system**: `ensureSpriteMeta(charDir, file)` lazy-loads sprite sheets. Frame count is derived from `naturalWidth / naturalHeight` (sheets are horizontal strips). `charDir = null` means root `/assets/`.
- **Animation state machine**: `animState` tracks current animation per slot; `currentAnim(slot)` auto-falls back to `idle` when a timed anim expires.
- **Timeline playback**: `schedulePlayTimeline()` steps through server-sent frames using `setTimeout` chains, driving HUD updates, grid effects, actor positioning, and animation triggers.
- **Center FX**: Special and ultimate animations render as absolutely-positioned canvases overlaid on the actor layer (`.special-center`, `.ultimate-center`).
- **RAF loop**: Continuously draws actor canvases and all FX canvases using the current animation state.

### Socket events

| Direction | Event | Description |
|---|---|---|
| S→C | `you_are` | Assigns `p1` or `p2` slot |
| S→C | `state` | Full game snapshot; includes `timeline` array after turn resolution |
| S→C | `game_over` | Winner signal (client waits for animations to finish before showing overlay) |
| S→C | `reset` | New game started |
| C→S | `choose_character` | `"fire"` / `"lightning"` / `"wanderer"` |
| C→S | `lock_in` | Array of 3 action objects |
| C→S | `retry` | Restart after game over |
| C→S | `admin_reset_all` | Force-disconnect both players and reset (requires `ADMIN_KEY` env var if set) |

### Admin

- URL `?admin=1` (optionally `?admin=1&key=<key>`) shows a "Reset session" button in the client
- HTTP endpoint: `GET /admin/reset-all?key=<key>`
- Server env var: `ADMIN_KEY` (empty = no auth required)
