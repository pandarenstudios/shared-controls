import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SPEED       = 160;
const TICK_MS     = 33;
const HALF        = 12;
const PICKUP_DIST = 20;
const MAX_NAME_LEN = 24;

export const KEY_GROUPS = [
  {
    id: 'move-vertical',
    inputs: ['up', 'down'],
    keys: ['W', 'UP', 'S', 'DOWN'],
    label: 'Up / Down',
    displayKeys: 'W/↑   S/↓',
  },
  {
    id: 'move-horizontal',
    inputs: ['left', 'right'],
    keys: ['A', 'LEFT', 'D', 'RIGHT'],
    label: 'Left / Right',
    displayKeys: 'A/←   D/→',
  },
  {
    id: 'action',
    inputs: ['action'],
    keys: ['SPACE'],
    label: 'Action',
    displayKeys: 'Space',
  },
];

const GROUP_BY_ID = Object.fromEntries(KEY_GROUPS.map(g => [g.id, g]));
const DEFAULT_GROUP_IDS = ['move-vertical', 'move-horizontal', 'action', 'move-horizontal'];

// Cryptographically random 4-character alphanumeric code
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function generateCode(lobbies) {
  let code;
  do {
    code = Array.from(randomBytes(4))
      .map(b => CODE_CHARS[b % CODE_CHARS.length])
      .join('');
  } while (lobbies.has(code));
  return code;
}

// Strip control characters and cap length. Returns 'Player' if the result is empty.
function sanitizeName(raw) {
  if (typeof raw !== 'string') return 'Player';
  const clean = raw.trim().replace(/[\x00-\x1F\x7F]/g, '').slice(0, MAX_NAME_LEN);
  return clean || 'Player';
}

function loadMap(name) {
  const p = path.join(__dirname, '../maps', `${name}.json`);
  return JSON.parse(readFileSync(p, 'utf-8'));
}

export class Lobby {
  static generateCode = generateCode;

  constructor(code) {
    this.code       = code;
    this.players    = [];
    this.inputs     = {};
    this.started    = false;
    this.createdAt  = Date.now();
    this.map        = loadMap('level1');
    this.character  = { x: this.map.spawn.x, y: this.map.spawn.y };
    this.gems       = [];
    this.exit       = null;
    this._gemsLeft  = 0;
    this._interval  = null;
    this._lastTick  = 0;
    this._startTime = 0;
    this._won       = false;

    this._parseMapObjects();
  }

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

  addPlayer(socketId, rawName) {
    const name     = sanitizeName(rawName);
    const slot     = this.players.length;
    const keyGroupId = DEFAULT_GROUP_IDS[slot] ?? DEFAULT_GROUP_IDS[0];
    this.players.push({ socketId, name, slot, keyGroupId });
    this.inputs[socketId] = { up: false, down: false, left: false, right: false, action: false };
    return slot;
  }

  // Returns a console-safe name for a given slot (strips ANSI-injectable chars)
  safeName(slot) {
    const p = this.players[slot];
    return p ? p.name.replace(/\x1B/g, '?') : '?';
  }

  removePlayer(socketId) {
    this.players = this.players.filter(p => p.socketId !== socketId);
    delete this.inputs[socketId];
  }

  assignKey(slot, groupId) {
    if (typeof groupId !== 'string' || !GROUP_BY_ID[groupId]) return;
    const player = this.players.find(p => p.slot === slot);
    if (player) player.keyGroupId = groupId;
  }

  setInput(socketId, key, pressed) {
    const inp = this.inputs[socketId];
    // Validate key is a known action and pressed is strictly boolean
    if (inp && typeof key === 'string' && Object.prototype.hasOwnProperty.call(inp, key) && typeof pressed === 'boolean') {
      inp[key] = pressed;
    }
  }

  getPlayerList() {
    return this.players.map(({ socketId, name, slot, keyGroupId }) =>
      ({ socketId, name, slot, keyGroupId }));
  }

  getStartPayload() {
    return {
      mapData:   this.map,
      character: this.character,
      gems:      this.gems.map(({ id, x, y }) => ({ id, x, y })),
      exit:      this.exit,
      totalGems: this.gems.length,
      players:   this.players.map(p => ({
        socketId: p.socketId,
        name:     p.name,
        slot:     p.slot,
        keySlice: GROUP_BY_ID[p.keyGroupId] ?? KEY_GROUPS[0],
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
