import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';
import { Lobby } from './lobby.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);

// Restrict to the known client origin in production.
// Set CLIENT_URL=https://your-vercel-app.vercel.app on Railway.
const allowedOrigins = process.env.CLIENT_URL
  ? ['http://localhost:3000', process.env.CLIENT_URL]
  : true; // allow all in local dev

const io = new Server(httpServer, { cors: { origin: allowedOrigins } });

app.use('/maps', express.static(path.join(__dirname, '../maps')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const lobbies = new Map();
const MAX_LOBBIES = 100;
const LOBBY_TTL_MS = 30 * 60 * 1000; // 30 min

// Purge stale lobbies every minute
setInterval(() => {
  const now = Date.now();
  for (const [code, lobby] of lobbies) {
    if (now - lobby.createdAt > LOBBY_TTL_MS) {
      lobby.destroy();
      lobbies.delete(code);
      console.log(`[ttl] lobby ${code} expired`);
    }
  }
}, 60_000);

io.on('connection', (socket) => {
  console.log('[+]', socket.id);

  socket.on('create-lobby', ({ name }, cb) => {
    if (typeof cb !== 'function') return; // client must provide an ack callback

    if (lobbies.size >= MAX_LOBBIES)
      return cb({ ok: false, error: 'Server is full, try again later' });

    if (socket.data.lobbyCode)
      return cb({ ok: false, error: 'Already in a lobby' });

    const code  = Lobby.generateCode(lobbies);
    const lobby = new Lobby(code);
    lobbies.set(code, lobby);

    const slot = lobby.addPlayer(socket.id, name);
    socket.join(code);
    socket.data.lobbyCode = code;

    cb({ ok: true, code, slot, isHost: true });
    socket.emit('lobby-update', lobby.getPlayerList());
    console.log(`[lobby] ${lobby.safeName(slot)} created ${code}`);
  });

  socket.on('join-lobby', ({ code, name }, cb) => {
    if (typeof cb !== 'function') return;

    if (socket.data.lobbyCode)
      return cb({ ok: false, error: 'Already in a lobby' });

    const upper = typeof code === 'string' ? code.toUpperCase() : '';
    const lobby = lobbies.get(upper);
    if (!lobby)                    return cb({ ok: false, error: 'Lobby not found' });
    if (lobby.started)             return cb({ ok: false, error: 'Game already started' });
    if (lobby.players.length >= 4) return cb({ ok: false, error: 'Lobby full (max 4)' });

    const slot = lobby.addPlayer(socket.id, name);
    socket.join(upper);
    socket.data.lobbyCode = upper;
    io.to(upper).emit('lobby-update', lobby.getPlayerList());
    cb({ ok: true, code: upper, slot, isHost: false });
    console.log(`[lobby] ${lobby.safeName(slot)} joined ${upper}`);
  });

  socket.on('assign-key', ({ slot, groupId }) => {
    const lobby = lobbies.get(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.players[0]?.socketId !== socket.id) return;
    if (lobby.started) return;
    lobby.assignKey(slot, groupId);
    io.to(socket.data.lobbyCode).emit('lobby-update', lobby.getPlayerList());
  });

  socket.on('start-game', () => {
    const { lobbyCode } = socket.data;
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) return;
    if (lobby.players[0]?.socketId !== socket.id) return;
    if (lobby.players.length < 2) return;

    lobby.start(io);
    io.to(lobbyCode).emit('game-started', lobby.getStartPayload());
    console.log(`[game] started in ${lobbyCode} (${lobby.players.length}p)`);
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
      console.log(`[lobby] ${lobbyCode} closed`);
    } else {
      io.to(lobbyCode).emit('lobby-update', lobby.getPlayerList());
    }
    console.log('[-]', socket.id);
  });
});

const PORT = process.env.PORT ?? 3001;
httpServer.listen(PORT, () => console.log(`Server on :${PORT}`));
