# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev commands

Two terminals required — server and client run independently.

```powershell
# Server (port 3001, auto-restarts on save)
cd server; npm run dev

# Client (port 3000, Vite HMR)
cd client; npm run dev
```

First-time setup:
```powershell
cd server; npm i
cd ../client; npm i
```

Health check (confirms server is up):
```powershell
Invoke-RestMethod http://localhost:3001/health
```

Production build (client only — server runs as-is):
```powershell
cd client; npm run build
```

## Architecture

### Request flow

```
Browser (Phaser + HTML)
  └─ Socket.io client (socket.js singleton)
       └─ Railway WebSocket server (index.js)
            └─ Lobby (lobby.js) — one instance per active game code
```

The client and server never share code — `KEY_GROUPS` is **duplicated** in `server/src/lobby.js` (exported) and `client/src/ui.js` (local const). If you add a new key group, update both.

### Server (`server/src/`)

- **`index.js`** — Socket.io event routing only. No game logic. Owns the `lobbies: Map<code, Lobby>` singleton and enforces host-only gates before delegating to Lobby methods.
- **`lobby.js`** — All game state. One `Lobby` instance per active code. Runs a `setInterval` game loop at 30 TPS once `start()` is called. Handles: tile collision (AABB, separate X/Y axes), gem pickup, exit trigger, and win detection. Map objects (gems, exit) are parsed out of the tile grid at construction time and replaced with floor tiles so collision ignores them.

### Client (`client/src/`)

- **`main.js`** — Creates the Phaser game instance and passes `startPayload` + `mySocketId` into `game.registry` for the scene to read.
- **`socket.js`** — Exports a single `io()` instance with `autoConnect: false`. Connected explicitly in `main.js`.
- **`ui.js`** — All pre-game HTML UI (start screen → menu → lobby). Has no Phaser dependency. Manages the lobby assignment dropdowns and emits `assign-key` on change.
- **`scenes/GameScene.js`** — The only Phaser scene. Reads start data from `game.registry`. Implements client-side prediction: local inputs are applied to `displayPos` immediately each frame, then `displayPos` is exponentially lerped toward `serverPos` (the latest server-authoritative position) to correct for wall collisions and other players' movement.

### Maps (`server/maps/`)

JSON format — maps live inside `server/` because Railway only deploys that directory.

```json
{
  "width": 20, "height": 15, "tileSize": 32,
  "spawn": { "x": 112, "y": 112 },
  "tiles": [[...]]
}
```

Tile values: `0` = floor, `1` = wall, `2` = gem (collectible), `3` = exit.

Spawn coordinates are pixel positions (tile index × tileSize + tileSize/2 for center). To load a different map, change the `loadMap('level1')` call in `lobby.js`.

### Socket events

| Event | Direction | Description |
|---|---|---|
| `create-lobby` | C→S | Creates lobby, returns `{code, slot, isHost}` |
| `join-lobby` | C→S | Joins by code, returns `{code, slot, isHost}` |
| `assign-key` | C→S | Host reassigns a player's key group |
| `start-game` | C→S | Host starts; server emits `game-started` to room |
| `input` | C→S | `{key: 'up'|'down'|'left'|'right'|'action', pressed: bool}` |
| `lobby-update` | S→C | Full player list with `keyGroupId` per player |
| `game-started` | S→C | Full start payload: map data, gem positions, player key slices |
| `state` | S→C | `{character: {x, y}}` at 30 TPS |
| `gem-collected` | S→C | `{id, gemsLeft}` |
| `game-won` | S→C | `{time}` in seconds |

### Key groups

Defined in `server/src/lobby.js` (`KEY_GROUPS` export) and mirrored in `client/src/ui.js`. Each group maps logical inputs (`up`, `down`, etc.) to physical key names (`W`, `UP`, `SPACE`, etc.). The client's `GameScene` uses `KEY_TO_ACTION` to map physical key names to logical actions, handling arrow keys and WASD as equivalent inputs with correct multi-key deduplication.

## Deployment

- **Client** → Vercel (`client/` root, Vite preset). `VITE_SERVER_URL` in `client/.env` points to the Railway server.
- **Server** → Railway (`server/` root directory). `PORT` env var is set automatically by Railway.
- Commits to `master` auto-deploy on both platforms.
