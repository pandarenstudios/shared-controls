import Phaser from 'phaser';
import { socket } from '../socket.js';

const PALETTE = {
  floor:   0x16213e,
  wall:    0x2d3561,
  grid:    0x0f3460,
  char:    0xe94560,
  charDot: 0xffd700,
};

// Colour each player slot differently so the HUD is easy to read
const SLOT_COLORS = ['#e94560', '#4fc3f7', '#81c784', '#ffb74d'];

export class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  create() {
    const payload    = this.game.registry.get('startPayload');
    const mySocketId = this.game.registry.get('mySocketId');

    const { mapData, character, players } = payload;
    const me = players.find(p => p.socketId === mySocketId);

    this.charPos = { ...character };

    this._drawMap(mapData);
    this._createCharacterGraphic();
    this._createHUD(players, me);
    this._setupInput(me?.keySlice);

    socket.on('state', ({ character: c }) => { this.charPos = c; });

    // Release all key inputs when this scene shuts down to avoid stuck keys
    this.events.once('shutdown', () => {
      if (me?.keySlice) {
        for (const key of me.keySlice.inputs) {
          socket.emit('input', { key, pressed: false });
        }
      }
      socket.off('state');
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────

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

  _createCharacterGraphic() {
    this.charGfx = this.add.graphics().setDepth(10);
  }

  _createHUD(players, me) {
    let y = 6;
    for (const p of players) {
      const isMe    = p.socketId === me?.socketId;
      const color   = SLOT_COLORS[p.slot] ?? '#ffffff';
      const keysStr = p.keySlice ? ` [${p.keySlice.keys.join('+')}] ${p.keySlice.label}` : '';
      const label   = `${p.name}${isMe ? ' ★' : ''}${keysStr}`;

      this.add.text(6, y, label, {
        fontSize: '11px',
        color,
        backgroundColor: '#00000099',
        padding: { x: 4, y: 2 },
      }).setDepth(20);

      y += 18;
    }
  }

  _setupInput(slice) {
    if (!slice) return;

    const KC = Phaser.Input.Keyboard.KeyCodes;
    const keyCodeMap  = { W: KC.W, S: KC.S, A: KC.A, D: KC.D, SPACE: KC.SPACE };
    const inputAction = { W: 'up', S: 'down', A: 'left', D: 'right', SPACE: 'action' };

    for (const keyName of slice.keys) {
      const code = keyCodeMap[keyName];
      if (!code) continue;
      const action = inputAction[keyName];
      const key = this.input.keyboard.addKey(code);
      key.on('down', () => socket.emit('input', { key: action, pressed: true }));
      key.on('up',   () => socket.emit('input', { key: action, pressed: false }));
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────────

  update() {
    this.charGfx.clear();
    // Body
    this.charGfx.fillStyle(PALETTE.char);
    this.charGfx.fillCircle(this.charPos.x, this.charPos.y, 13);
    // Direction dot (top-right — purely decorative)
    this.charGfx.fillStyle(PALETTE.charDot);
    this.charGfx.fillCircle(this.charPos.x + 5, this.charPos.y - 5, 3);
  }
}
