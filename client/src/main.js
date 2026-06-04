import Phaser from 'phaser';
import { socket } from './socket.js';
import { setupMenuUI } from './ui.js';
import { GameScene } from './scenes/GameScene.js';

let game = null;

export function launchGame(startPayload, mySocketId) {
  document.getElementById('ui-overlay').classList.add('hidden');
  document.getElementById('game-container').classList.remove('hidden');

  if (game) game.destroy(true);

  const { mapData } = startPayload;

  game = new Phaser.Game({
    type: Phaser.AUTO,
    width:  mapData.width  * mapData.tileSize,
    height: mapData.height * mapData.tileSize,
    backgroundColor: '#0f0e17',
    parent: 'game-container',
    scene: [GameScene],
    input: { keyboard: true },
  });

  // game.registry is readable as this.game.registry inside any scene
  game.registry.set('startPayload', startPayload);
  game.registry.set('mySocketId',   mySocketId);
}

socket.connect();
setupMenuUI(socket, launchGame);
