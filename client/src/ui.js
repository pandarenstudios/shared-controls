export function setupMenuUI(socket, launchGame) {
  const menuPanel  = document.getElementById('menu-panel');
  const lobbyPanel = document.getElementById('lobby-panel');
  const menuError  = document.getElementById('menu-error');
  const lobbyError = document.getElementById('lobby-error');
  const nameInput  = document.getElementById('player-name');
  const joinCode   = document.getElementById('join-code');
  const createBtn  = document.getElementById('create-btn');
  const joinBtn    = document.getElementById('join-btn');
  const startBtn   = document.getElementById('start-btn');
  const waitMsg    = document.getElementById('waiting-msg');
  const codeDisplay = document.getElementById('lobby-code-display');
  const playerList  = document.getElementById('player-list');

  let mySlot  = -1;
  let isHost  = false;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function showLobby(code) {
    menuPanel.classList.add('hidden');
    lobbyPanel.classList.remove('hidden');
    codeDisplay.textContent = code;
  }

  function renderPlayers(players) {
    playerList.innerHTML = '';
    for (const p of players) {
      const row = document.createElement('div');
      row.className = 'player-row' + (p.slot === mySlot ? ' you' : '');

      const nameEl = document.createElement('span');
      nameEl.textContent =
        p.name + (p.slot === mySlot ? ' (you)' : '') + (p.slot === 0 ? ' ♛' : '');

      row.appendChild(nameEl);
      playerList.appendChild(row);
    }

    if (isHost) {
      startBtn.classList.remove('hidden');
      waitMsg.classList.add('hidden');
      const ready = players.length >= 2;
      startBtn.disabled    = !ready;
      startBtn.textContent = ready
        ? `Start Game  (${players.length} players)`
        : 'Start Game  (need ≥ 2 players)';
    }
  }

  // ── Menu events ───────────────────────────────────────────────────────────

  createBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return (menuError.textContent = 'Enter a name first.');
    menuError.textContent = '';
    createBtn.disabled = true;

    socket.emit('create-lobby', { name }, (res) => {
      createBtn.disabled = false;
      if (!res.ok) return (menuError.textContent = res.error);
      mySlot = res.slot;
      isHost = res.isHost;
      showLobby(res.code);
      renderPlayers([{ name, slot: 0 }]);
    });
  });

  joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const code = joinCode.value.trim();
    if (!name) return (menuError.textContent = 'Enter a name first.');
    if (!code) return (menuError.textContent = 'Enter a lobby code.');
    menuError.textContent = '';
    joinBtn.disabled = true;

    socket.emit('join-lobby', { name, code }, (res) => {
      joinBtn.disabled = false;
      if (!res.ok) return (menuError.textContent = res.error);
      mySlot = res.slot;
      isHost = res.isHost;
      showLobby(res.code);
      // lobby-update will arrive immediately after and populate the player list
    });
  });

  startBtn.addEventListener('click', () => socket.emit('start-game'));

  // Allow pressing Enter in the name / code inputs
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') createBtn.click(); });
  joinCode.addEventListener('keydown',  e => { if (e.key === 'Enter') joinBtn.click(); });

  // ── Socket events ─────────────────────────────────────────────────────────

  socket.on('lobby-update', (players) => {
    renderPlayers(players);
  });

  socket.on('game-started', (payload) => {
    launchGame(payload, socket.id);
  });

  socket.on('connect_error', () => {
    menuError.textContent = 'Cannot reach server. Is it running on port 3001?';
  });
}
