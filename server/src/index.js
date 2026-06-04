import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';
import { Lobby } from './lobby.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

// Serve map files so the client can also fetch them directly if needed
app.use('/maps', express.static(path.join(__dirname, '../../maps')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const lobbies = new Map();

function generateCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 6).toUpperCase(); }
  while (lobbies.has(code));
  return code;
}

io.on('connection', (socket) => {
  console.log('[+]', socket.id);

  socket.on('create-lobby', ({ name }, cb) => {
    const code = generateCode();
    const lobby = new Lobby(code);
    lobbies.set(code, lobby);
    const slot = lobby.addPlayer(socket.id, name);
    socket.join(code);
    socket.data.lobbyCode = code;
    cb({ ok: true, code, slot, isHost: true });
    console.log(`${name} created lobby ${code}`);
  });

  socket.on('join-lobby', ({ code, name }, cb) => {
    const upper = code.toUpperCase();
    const lobby = lobbies.get(upper);
    if (!lobby)                    return cb({ ok: false, error: 'Lobby not found' });
    if (lobby.started)             return cb({ ok: false, error: 'Game already started' });
    if (lobby.players.length >= 4) return cb({ ok: false, error: 'Lobby full (max 4)' });

    const slot = lobby.addPlayer(socket.id, name);
    socket.join(upper);
    socket.data.lobbyCode = upper;
    // Notify everyone in the room (including the new joiner)
    io.to(upper).emit('lobby-update', lobby.getPlayerList());
    cb({ ok: true, code: upper, slot, isHost: false });
    console.log(`${name} joined lobby ${upper}`);
  });

  socket.on('start-game', () => {
    const { lobbyCode } = socket.data;
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) return;
    if (lobby.players[0]?.socketId !== socket.id) return; // host only
    if (lobby.players.length < 2) return;

    lobby.start(io);
    io.to(lobbyCode).emit('game-started', lobby.getStartPayload());
    console.log(`Game started in ${lobbyCode} (${lobby.players.length} players)`);
  });

  socket.on('input', ({ key, pressed }) => {
    const lobby = lobbies.get(socket.data.lobbyCode);
    if (lobby?.started) lobby.setInput(socket.id, key, pressed);
  });

  socket.on('disconnect', () => {
    const { lobbyCode } = socket.data;
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) return;
    lobby.removePlayer(socket.id);
    if (lobby.players.length === 0) {
      lobby.destroy();
      lobbies.delete(lobbyCode);
      console.log(`Lobby ${lobbyCode} closed`);
    } else {
      io.to(lobbyCode).emit('lobby-update', lobby.getPlayerList());
    }
    console.log('[-]', socket.id);
  });
});

const PORT = process.env.PORT ?? 3001;
httpServer.listen(PORT, () => console.log(`Server on :${PORT}`));
