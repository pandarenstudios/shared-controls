import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SPEED   = 160; // px/sec
const TICK_MS = 50;  // 20 ticks/sec
const HALF    = 12;  // character collision half-size — smaller than a tile so 1-tile corridors are passable

// Which logical inputs each player slot controls, indexed by total player count.
// Add more entries here to support custom key layouts.
const KEY_SLICES = {
  2: [
    { inputs: ['up', 'down'],    keys: ['W', 'S'], label: 'Up / Down' },
    { inputs: ['left', 'right'], keys: ['A', 'D'], label: 'Left / Right' },
  ],
  3: [
    { inputs: ['up', 'down'],    keys: ['W', 'S'],   label: 'Up / Down' },
    { inputs: ['left', 'right'], keys: ['A', 'D'],   label: 'Left / Right' },
    { inputs: ['action'],        keys: ['SPACE'],     label: 'Action' },
  ],
  4: [
    { inputs: ['up'],    keys: ['W'], label: 'Up' },
    { inputs: ['down'],  keys: ['S'], label: 'Down' },
    { inputs: ['left'],  keys: ['A'], label: 'Left' },
    { inputs: ['right'], keys: ['D'], label: 'Right' },
  ],
};

function loadMap(name) {
  const p = path.join(__dirname, '../maps', `${name}.json`);
  return JSON.parse(readFileSync(p, 'utf-8'));
}

export class Lobby {
  constructor(code) {
    this.code      = code;
    this.players   = [];
    this.inputs    = {};
    this.started   = false;
    this.map       = loadMap('level1');
    this.character = { x: this.map.spawn.x, y: this.map.spawn.y };
    this._interval  = null;
    this._lastTick  = 0;
  }

  addPlayer(socketId, name) {
    const slot = this.players.length;
    this.players.push({ socketId, name, slot });
    this.inputs[socketId] = { up: false, down: false, left: false, right: false, action: false };
    return slot;
  }

  removePlayer(socketId) {
    this.players = this.players.filter(p => p.socketId !== socketId);
    delete this.inputs[socketId];
  }

  setInput(socketId, key, pressed) {
    const inp = this.inputs[socketId];
    if (inp && key in inp) inp[key] = pressed;
  }

  getPlayerList() {
    return this.players.map(({ socketId, name, slot }) => ({ socketId, name, slot }));
  }

  getStartPayload() {
    const slices = KEY_SLICES[this.players.length] ?? KEY_SLICES[4];
    return {
      mapData: this.map,
      character: this.character,
      players: this.players.map(p => ({
        socketId: p.socketId,
        name:     p.name,
        slot:     p.slot,
        keySlice: slices[p.slot] ?? null,
      })),
    };
  }

  start(io) {
    this.started   = true;
    this._lastTick = Date.now();
    this._interval = setInterval(() => this._tick(io), TICK_MS);
  }

  destroy() {
    clearInterval(this._interval);
  }

  _tick(io) {
    const now = Date.now();
    const dt  = Math.min((now - this._lastTick) / 1000, 0.1); // cap spike at 100 ms
    this._lastTick = now;

    // Merge every player's inputs into a single direction vector
    const m = { up: false, down: false, left: false, right: false };
    for (const inp of Object.values(this.inputs)) {
      if (inp.up)    m.up    = true;
      if (inp.down)  m.down  = true;
      if (inp.left)  m.left  = true;
      if (inp.right) m.right = true;
    }

    let vx = (m.right ? SPEED : 0) - (m.left ? SPEED : 0);
    let vy = (m.down  ? SPEED : 0) - (m.up   ? SPEED : 0);
    // Normalise diagonal movement so it isn't faster
    if (vx !== 0 && vy !== 0) { vx *= 0.7071; vy *= 0.7071; }

    const { tiles, tileSize } = this.map;
    let { x, y } = this.character;

    // Resolve X axis independently
    x += vx * dt;
    const rTop = Math.floor((y - HALF + 1) / tileSize);
    const rBot = Math.floor((y + HALF - 1) / tileSize);
    if (vx > 0) {
      const c = Math.floor((x + HALF) / tileSize);
      if (tiles[rTop]?.[c] === 1 || tiles[rBot]?.[c] === 1)
        x = c * tileSize - HALF;
    } else if (vx < 0) {
      const c = Math.floor((x - HALF) / tileSize);
      if (tiles[rTop]?.[c] === 1 || tiles[rBot]?.[c] === 1)
        x = (c + 1) * tileSize + HALF;
    }

    // Resolve Y axis independently
    y += vy * dt;
    const cLeft  = Math.floor((x - HALF + 1) / tileSize);
    const cRight = Math.floor((x + HALF - 1) / tileSize);
    if (vy > 0) {
      const r = Math.floor((y + HALF) / tileSize);
      if (tiles[r]?.[cLeft] === 1 || tiles[r]?.[cRight] === 1)
        y = r * tileSize - HALF;
    } else if (vy < 0) {
      const r = Math.floor((y - HALF) / tileSize);
      if (tiles[r]?.[cLeft] === 1 || tiles[r]?.[cRight] === 1)
        y = (r + 1) * tileSize + HALF;
    }

    this.character = { x, y };
    io.to(this.code).emit('state', { character: this.character });
  }
}
