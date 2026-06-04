import Phaser from 'phaser';
import { socket } from '../socket.js';

const PALETTE = {
  floor:      0x16213e,
  wall:       0x2d3561,
  grid:       0x0f3460,
  char:       0xe94560,
  charDot:    0xffd700,
  gem:        0xffd700,
  gemGlow:    0xffff88,
  exitLocked: 0x444466,
  exitOpen:   0x00e676,
};

const SLOT_COLORS    = ['#e94560', '#4fc3f7', '#81c784', '#ffb74d'];
const SPEED          = 160; // must match server
const CORRECTION_SPEED = 12;

// Physical key name → Phaser KeyCode
const KEY_CODE_MAP = (KC) => ({
  W: KC.W, S: KC.S, A: KC.A, D: KC.D, SPACE: KC.SPACE,
  UP: KC.UP, DOWN: KC.DOWN, LEFT: KC.LEFT, RIGHT: KC.RIGHT,
});

// Physical key name → logical input action
const KEY_TO_ACTION = {
  W: 'up', UP: 'up',
  S: 'down', DOWN: 'down',
  A: 'left', LEFT: 'left',
  D: 'right', RIGHT: 'right',
  SPACE: 'action',
};

export class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  create() {
    const payload    = this.game.registry.get('startPayload');
    const mySocketId = this.game.registry.get('mySocketId');
    const { mapData, character, players, gems, exit, totalGems } = payload;
    const me = players.find(p => p.socketId === mySocketId);

    this.serverPos   = { ...character };
    this.displayPos  = { ...character };
    this.localInputs = { up: false, down: false, left: false, right: false, action: false };
    this.localVelocity = { vx: 0, vy: 0 };
    // keyStates tracks individual physical keys so two keys mapping to the same
    // action don't cancel each other when one is released while the other is held.
    this.keyStates   = {};
    this.keyToAction = {};

    this.gemsLeft  = totalGems;
    this.totalGems = totalGems;
    this.exitPos   = exit;
    this.won       = false;

    this._drawMap(mapData);
    this._drawExit(exit, false);
    this._drawGems(gems);
    this._createCharacterGraphic();
    this._createHUD(players, me);
    this._setupInput(me?.keySlice);

    socket.on('state', ({ character: c }) => { this.serverPos = c; });

    socket.on('gem-collected', ({ id, gemsLeft }) => {
      this.gemsLeft = gemsLeft;
      this.gemGraphics.get(id)?.destroy();
      this.gemGraphics.delete(id);
      this._updateGemCounter();
      if (gemsLeft === 0) this._openExit();
    });

    socket.on('game-won', ({ time }) => {
      this.won = true;
      this._showWinScreen(time);
    });

    this.events.once('shutdown', () => {
      // Release any held inputs so the server doesn't get stuck
      for (const [action, active] of Object.entries(this.localInputs)) {
        if (active) socket.emit('input', { key: action, pressed: false });
      }
      socket.off('state');
      socket.off('gem-collected');
      socket.off('game-won');
    });
  }

  // ── Map & objects ─────────────────────────────────────────────────────────

  _drawMap({ tiles, tileSize }) {
    const gfx = this.add.graphics();
    for (let row = 0; row < tiles.length; row++) {
      for (let col = 0; col < tiles[row].length; col++) {
        const x = col * tileSize;
        const y = row * tileSize;
        if (tiles[row][col] === 1) {
          gfx.fillStyle(PALETTE.wall);
          gfx.fillRect(x, y, tileSize, tileSize);
        } else {
          gfx.fillStyle(PALETTE.floor);
          gfx.fillRect(x, y, tileSize, tileSize);
          gfx.lineStyle(1, PALETTE.grid, 0.35);
          gfx.strokeRect(x, y, tileSize, tileSize);
        }
      }
    }
  }

  _drawExit(exit, open) {
    if (!exit) return;
    if (this.exitGfx) this.exitGfx.destroy();
    const gfx   = this.add.graphics().setDepth(4);
    const color = open ? PALETTE.exitOpen : PALETTE.exitLocked;
    gfx.fillStyle(color, open ? 0.7 : 0.4);
    gfx.fillRect(exit.x - 14, exit.y - 14, 28, 28);
    gfx.lineStyle(2, color, 1);
    gfx.strokeRect(exit.x - 14, exit.y - 14, 28, 28);
    gfx.lineStyle(2, color, 0.9);
    gfx.beginPath();
    gfx.moveTo(exit.x - 5, exit.y);
    gfx.lineTo(exit.x + 5, exit.y);
    gfx.moveTo(exit.x + 2, exit.y - 4);
    gfx.lineTo(exit.x + 5, exit.y);
    gfx.lineTo(exit.x + 2, exit.y + 4);
    gfx.strokePath();
    this.exitGfx = gfx;
  }

  _openExit() {
    this._drawExit(this.exitPos, true);
    this.tweens.add({
      targets: this.exitGfx,
      alpha: { from: 0.5, to: 1 },
      duration: 400,
      yoyo: true,
      repeat: -1,
    });
  }

  _drawGems(gems) {
    this.gemGraphics = new Map();
    for (const gem of gems) {
      const gfx = this.add.graphics().setDepth(5);
      gfx.fillStyle(PALETTE.gem);
      gfx.fillTriangle(gem.x, gem.y - 9, gem.x - 7, gem.y + 5, gem.x + 7, gem.y + 5);
      gfx.lineStyle(1, PALETTE.gemGlow, 0.8);
      gfx.strokeTriangle(gem.x, gem.y - 9, gem.x - 7, gem.y + 5, gem.x + 7, gem.y + 5);
      this.gemGraphics.set(gem.id, gfx);
      this.tweens.add({
        targets: gfx,
        y: '-=4',
        duration: 900 + Math.random() * 300,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  // ── Character ─────────────────────────────────────────────────────────────

  _createCharacterGraphic() {
    this.charGfx = this.add.graphics().setDepth(10);
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  _createHUD(players, me) {
    let y = 6;
    for (const p of players) {
      const isMe    = p.socketId === me?.socketId;
      const color   = SLOT_COLORS[p.slot] ?? '#ffffff';
      const keysStr = p.keySlice
        ? `  ${p.keySlice.label}  (${p.keySlice.displayKeys})`
        : '';
      this.add.text(6, y, `${p.name}${isMe ? ' ★' : ''}${keysStr}`, {
        fontSize: '11px', color,
        backgroundColor: '#00000099',
        padding: { x: 4, y: 2 },
      }).setDepth(20);
      y += 18;
    }

    const { mapData } = this.game.registry.get('startPayload');
    const mapW = mapData.width * mapData.tileSize;

    this.gemCountText = this.add.text(mapW - 6, 6, this._gemLabel(), {
      fontSize: '13px', color: '#ffd700',
      backgroundColor: '#00000099',
      padding: { x: 6, y: 3 },
    }).setOrigin(1, 0).setDepth(20);

    this.hintText = this.add.text(mapW - 6, 26, 'collect all gems, then reach the exit', {
      fontSize: '10px', color: '#888888',
      backgroundColor: '#00000099',
      padding: { x: 4, y: 2 },
    }).setOrigin(1, 0).setDepth(20);
  }

  _gemLabel() {
    return `◆ ${this.totalGems - this.gemsLeft} / ${this.totalGems}`;
  }

  _updateGemCounter() {
    this.gemCountText?.setText(this._gemLabel());
    if (this.gemsLeft === 0) {
      this.gemCountText?.setColor('#00e676');
      this.hintText?.setText('exit is now open!').setColor('#00e676');
    }
  }

  // ── Input & prediction ────────────────────────────────────────────────────

  _setupInput(slice) {
    if (!slice) return;

    const KC      = Phaser.Input.Keyboard.KeyCodes;
    const codeMap = KEY_CODE_MAP(KC);

    for (const keyName of slice.keys) {
      const code   = codeMap[keyName];
      const action = KEY_TO_ACTION[keyName];
      if (!code || !action) continue;

      this.keyStates[keyName]   = false;
      this.keyToAction[keyName] = action;

      const key = this.input.keyboard.addKey(code);

      key.on('down', () => {
        if (this.won) return;
        const wasActive = this._isActionActive(action);
        this.keyStates[keyName] = true;
        // Only tell the server once when the action first becomes active
        if (!wasActive) socket.emit('input', { key: action, pressed: true });
        this._syncLocalInputs();
      });

      key.on('up', () => {
        this.keyStates[keyName] = false;
        // Only tell the server once when the last key for this action is released
        if (!this._isActionActive(action)) socket.emit('input', { key: action, pressed: false });
        this._syncLocalInputs();
      });
    }
  }

  // Returns true if any physical key for `action` is currently held
  _isActionActive(action) {
    return Object.entries(this.keyStates).some(
      ([k, pressed]) => pressed && this.keyToAction[k] === action,
    );
  }

  // Rebuild localInputs from current key states, then recalculate velocity
  _syncLocalInputs() {
    for (const action of Object.keys(this.localInputs)) {
      this.localInputs[action] = this._isActionActive(action);
    }
    let vx = (this.localInputs.right ? SPEED : 0) - (this.localInputs.left ? SPEED : 0);
    let vy = (this.localInputs.down  ? SPEED : 0) - (this.localInputs.up   ? SPEED : 0);
    if (vx !== 0 && vy !== 0) { vx *= 0.7071; vy *= 0.7071; }
    this.localVelocity = { vx, vy };
  }

  // ── Win screen ────────────────────────────────────────────────────────────

  _showWinScreen(time) {
    const mins = Math.floor(time / 60);
    const secs = time % 60;
    document.getElementById('win-time').textContent = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    document.getElementById('win-overlay').classList.remove('hidden');
  }

  // ── Loop ──────────────────────────────────────────────────────────────────

  update(_time, delta) {
    if (!this.won) {
      const dt   = delta / 1000;
      const lerp = 1 - Math.exp(-CORRECTION_SPEED * dt);

      this.displayPos.x += this.localVelocity.vx * dt;
      this.displayPos.y += this.localVelocity.vy * dt;
      this.displayPos.x += (this.serverPos.x - this.displayPos.x) * lerp;
      this.displayPos.y += (this.serverPos.y - this.displayPos.y) * lerp;
    }

    this.charGfx.clear();
    this.charGfx.fillStyle(PALETTE.char);
    this.charGfx.fillCircle(this.displayPos.x, this.displayPos.y, 13);
    this.charGfx.fillStyle(PALETTE.charDot);
    this.charGfx.fillCircle(this.displayPos.x + 5, this.displayPos.y - 5, 3);
  }
}
