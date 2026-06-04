import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SPEED       = 160; // px/sec
const TICK_MS     = 33;  // ~30 ticks/sec
const HALF        = 12;  // character collision half-size
const PICKUP_DIST = 20;  // px radius to collect a gem or trigger the exit

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
    this.gems      = [];
    this.exit      = null;
    this._gemsLeft = 0;
    this._interval = null;
    this._lastTick = 0;
    this._startTime = 0;
    this._won      = false;

    this._parseMapObjects();
  }

  // Scan the tile grid for gem (2) and exit (3) tiles, convert to pixel objects,
  // then replace those tiles with floor (0) so collision ignores them.
  _parseMapObjects() {
    const { tiles, tileSize } = this.map;
    const half = tileSize / 2;
    for (let row = 0; row < tiles.length; row++) {
      for (let col = 0; col < tiles[row].length; col++) {
        const t = tiles[row][col];
        if (t === 2) {
          this.gems.push({
            id: `${col}_${row}`,
            x: col * tileSize + half,
            y: row * tileSize + half,
            collected: false,
          });
          this._gemsLeft++;
          tiles[row][col] = 0;
        } else if (t === 3) {
          this.exit = { x: col * tileSize + half, y: row * tileSize + half };
          tiles[row][col] = 0;
        }
      }
    }
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
      mapData:    this.map,
      character:  this.character,
      gems:       this.gems.map(({ id, x, y }) => ({ id, x, y })),
      exit:       this.exit,
      totalGems:  this.gems.length,
      players:    this.players.map(p => ({
        socketId: p.socketId,
        name:     p.name,
        slot:     p.slot,
        keySlice: slices[p.slot] ?? null,
      })),
    };
  }

  start(io) {
    this.started    = true;
    this._startTime = Date.now();
    this._lastTick  = Date.now();
    this._interval  = setInterval(() => this._tick(io), TICK_MS);
  }

  destroy() {
    clearInterval(this._interval);
  }

  _tick(io) {
    if (this._won) return;

    const now = Date.now();
    const dt  = Math.min((now - this._lastTick) / 1000, 0.1);
    this._lastTick = now;

    // Merge inputs
    const m = { up: false, down: false, left: false, right: false };
    for (const inp of Object.values(this.inputs)) {
      if (inp.up)    m.up    = true;
      if (inp.down)  m.down  = true;
      if (inp.left)  m.left  = true;
      if (inp.right) m.right = true;
    }

    let vx = (m.right ? SPEED : 0) - (m.left ? SPEED : 0);
    let vy = (m.down  ? SPEED : 0) - (m.up   ? SPEED : 0);
    if (vx !== 0 && vy !== 0) { vx *= 0.7071; vy *= 0.7071; }

    const { tiles, tileSize } = this.map;
    let { x, y } = this.character;

    // Resolve X
    x += vx * dt;
    const rTop = Math.floor((y - HALF + 1) / tileSize);
    const rBot = Math.floor((y + HALF - 1) / tileSize);
    if (vx > 0) {
      const c = Math.floor((x + HALF) / tileSize);
      if (tiles[rTop]?.[c] === 1 || tiles[rBot]?.[c] === 1) x = c * tileSize - HALF;
    } else if (vx < 0) {
      const c = Math.floor((x - HALF) / tileSize);
      if (tiles[rTop]?.[c] === 1 || tiles[rBot]?.[c] === 1) x = (c + 1) * tileSize + HALF;
    }

    // Resolve Y
    y += vy * dt;
    const cLeft  = Math.floor((x - HALF + 1) / tileSize);
    const cRight = Math.floor((x + HALF - 1) / tileSize);
    if (vy > 0) {
      const r = Math.floor((y + HALF) / tileSize);
      if (tiles[r]?.[cLeft] === 1 || tiles[r]?.[cRight] === 1) y = r * tileSize - HALF;
    } else if (vy < 0) {
      const r = Math.floor((y - HALF) / tileSize);
      if (tiles[r]?.[cLeft] === 1 || tiles[r]?.[cRight] === 1) y = (r + 1) * tileSize + HALF;
    }

    this.character = { x, y };

    // Gem collection
    for (const gem of this.gems) {
      if (gem.collected) continue;
      const dx = x - gem.x;
      const dy = y - gem.y;
      if (dx * dx + dy * dy < PICKUP_DIST * PICKUP_DIST) {
        gem.collected = true;
        this._gemsLeft--;
        io.to(this.code).emit('gem-collected', { id: gem.id, gemsLeft: this._gemsLeft });
      }
    }

    // Exit — only active once all gems collected
    if (this._gemsLeft === 0 && this.exit) {
      const dx = x - this.exit.x;
      const dy = y - this.exit.y;
      if (dx * dx + dy * dy < PICKUP_DIST * PICKUP_DIST) {
        this._won = true;
        const elapsed = Math.floor((Date.now() - this._startTime) / 1000);
        io.to(this.code).emit('game-won', { time: elapsed });
        this.destroy();
        return;
      }
    }

    io.to(this.code).emit('state', { character: this.character });
  }
}
