/* Client-side logic for Multiplayer Chess with lobby */

const params = new URLSearchParams(location.search);
const initialRoomParam = params.get('room');

// Lobby elements
const lobbyScreen = document.getElementById('lobbyScreen');
const lobbyCreateBtn = document.getElementById('lobbyCreateBtn');
const lobbyJoinInput = document.getElementById('lobbyJoinInput');
const lobbyJoinBtn = document.getElementById('lobbyJoinBtn');
const lobbyEmpty = document.getElementById('lobbyEmpty');
const roomListEl = document.getElementById('roomList');
const backToLobbyBtn = document.getElementById('backToLobbyBtn');
const activeRoomBadge = document.getElementById('activeRoomBadge');
const activeRoomIdText = document.getElementById('activeRoomId');

// Game elements
const gameScreen = document.getElementById('gameScreen');
const roomInfo = document.getElementById('roomInfo');
const roomIdText = document.getElementById('roomIdText');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const statusText = document.getElementById('statusText');
const board = document.getElementById('board');
const ctx = board.getContext('2d');
const topPlayerRow = document.getElementById('topPlayerRow');
const topPlayerTag = document.getElementById('topPlayerTag');
const topTimerEl = document.getElementById('top-timer');
const bottomPlayerRow = document.getElementById('bottomPlayerRow');
const bottomPlayerTag = document.getElementById('bottomPlayerTag');
const bottomTimerEl = document.getElementById('bottom-timer');
const drawBtn = document.getElementById('drawBtn');
const resignBtn = document.getElementById('resignBtn');
const rematchBtn = document.getElementById('rematchBtn');
const promotionOverlay = document.getElementById('promotionOverlay');
const themeButtons = document.querySelectorAll('.theme-card');

const THEMES = ['iron', 'captain', 'hulk'];
const THEME_KEY = 'comicChessTheme';

const DEFAULT_TIMER_TEXT = '--:--';

let lobbyRooms = [];
let activeRoomId = initialRoomParam ? initialRoomParam.trim().toUpperCase() : null;
let mySide = 'spectator'; // 'white' | 'black' | 'spectator'
let currentState = null;
let selectedSquare = null;
let legalMoves = [];
let pendingPromotion = null; // { from, to }

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m2 = Math.floor(s / 60).toString().padStart(2, '0');
  const s2 = (s % 60).toString().padStart(2, '0');
  return `${m2}:${s2}`;
}

function resetTimers() {
  if (topTimerEl) topTimerEl.textContent = DEFAULT_TIMER_TEXT;
  if (bottomTimerEl) bottomTimerEl.textContent = DEFAULT_TIMER_TEXT;
  topPlayerRow?.classList.remove('active');
  bottomPlayerRow?.classList.remove('active');
}

function updateUrl() {
  const url = new URL(window.location.href);
  if (activeRoomId) {
    url.searchParams.set('room', activeRoomId);
  } else {
    url.searchParams.delete('room');
  }
  history.replaceState(null, '', url);
}

function refreshLayout() {
  const inGame = Boolean(activeRoomId);
  if (lobbyScreen) lobbyScreen.hidden = inGame;
  if (gameScreen) gameScreen.hidden = !inGame;
  if (backToLobbyBtn) backToLobbyBtn.hidden = !inGame;
  if (roomInfo) roomInfo.hidden = !inGame;
  if (activeRoomBadge) activeRoomBadge.hidden = !inGame;

  if (inGame) {
    if (roomIdText) roomIdText.textContent = activeRoomId;
    if (activeRoomIdText) activeRoomIdText.textContent = activeRoomId;
    if (lobbyJoinInput) lobbyJoinInput.value = activeRoomId;
  } else {
    if (lobbyJoinInput && document.activeElement !== lobbyJoinInput) {
      lobbyJoinInput.value = '';
    }
  }

  updateStatus();
  updateButtons();
  updateUrl();
  renderLobby();
  renderTimers();
}

function renderLobby() {
  if (!roomListEl) return;
  roomListEl.innerHTML = '';

  if (!lobbyRooms || lobbyRooms.length === 0) {
    if (lobbyEmpty) lobbyEmpty.hidden = false;
    return;
  }

  if (lobbyEmpty) lobbyEmpty.hidden = true;

  lobbyRooms.forEach((room) => {
    const joined = room?.players?.joined ?? 0;
    const status = (room?.status || 'waiting').toLowerCase();

    const card = document.createElement('div');
    card.className = 'room-card';
    if (room.id === activeRoomId) card.classList.add('active');

    const header = document.createElement('div');
    header.className = 'room-card-header';

    const codeEl = document.createElement('span');
    codeEl.className = 'room-code';
    codeEl.textContent = `#${room.id}`;
    header.appendChild(codeEl);

    const statusEl = document.createElement('span');
    statusEl.className = `room-status ${status}`;
    statusEl.textContent = status.toUpperCase();
    header.appendChild(statusEl);

    card.appendChild(header);

    const playersEl = document.createElement('div');
    playersEl.className = 'room-meta';
    playersEl.innerHTML = `<span>${joined}/2 players</span>`;
    card.appendChild(playersEl);

    const joinBtn = document.createElement('button');
    joinBtn.className = 'comic-button small';
    const isFull = joined >= 2 && status === 'playing';
    if (room.id === activeRoomId) {
      joinBtn.textContent = 'Rejoin';
    } else if (isFull) {
      joinBtn.textContent = 'Full';
      joinBtn.disabled = true;
    } else {
      joinBtn.textContent = 'Join';
    }

    joinBtn.addEventListener('click', () => enterRoom(room.id));
    card.appendChild(joinBtn);

    roomListEl.appendChild(card);
  });
}

function updateThemeSelection(selectedTheme) {
  themeButtons.forEach((btn) => {
    const isActive = btn.dataset.theme === selectedTheme;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

function applyTheme(theme, { persist = true } = {}) {
  const normalized = THEMES.includes(theme) ? theme : 'iron';
  document.body.classList.remove(...THEMES.map((name) => `theme-${name}`));
  document.body.classList.add(`theme-${normalized}`);
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, normalized);
    } catch (err) {
      // Ignore storage errors (private mode, etc.)
    }
  }
  updateThemeSelection(normalized);
  render();
  renderTimers();
}

function applyTimerRow(rowEl, tagEl, timerEl, label, time, isActive) {
  if (tagEl) tagEl.textContent = label;
  if (timerEl) timerEl.textContent = time;
  if (rowEl) rowEl.classList.toggle('active', Boolean(isActive));
}

function renderTimers() {
  if (!topTimerEl || !bottomTimerEl) return;

  const clocks = currentState?.clocks || null;
  const status = currentState?.status;
  const turn = currentState?.turn;
  const players = currentState?.players || {};
  const whiteJoined = Boolean(players.white);
  const blackJoined = Boolean(players.black);

  const formatTime = (color) => {
    if (!clocks) return DEFAULT_TIMER_TEXT;
    const value = clocks[color];
    return typeof value === 'number' ? fmt(value) : DEFAULT_TIMER_TEXT;
  };

  const labelFor = (color) => {
    const colorName = color === 'white' ? 'White' : 'Black';
    const joined = color === 'white' ? whiteJoined : blackJoined;
    if (mySide === color) {
      return `You | ${colorName}`;
    }
    if (mySide === 'spectator') {
      return joined ? `${colorName} Player` : `Open | ${colorName}`;
    }
    return joined ? `Opponent | ${colorName}` : `Waiting | ${colorName}`;
  };

  let bottomColor = 'white';
  let topColor = 'black';
  if (mySide === 'black') {
    bottomColor = 'black';
    topColor = 'white';
  }

  const activeColor = status === 'playing' ? (turn === 'w' ? 'white' : 'black') : null;

  applyTimerRow(
    topPlayerRow,
    topPlayerTag,
    topTimerEl,
    labelFor(topColor),
    formatTime(topColor),
    activeColor === topColor,
  );
  applyTimerRow(
    bottomPlayerRow,
    bottomPlayerTag,
    bottomTimerEl,
    labelFor(bottomColor),
    formatTime(bottomColor),
    activeColor === bottomColor,
  );
}

function joinActiveRoom() {
  if (!activeRoomId || !socket.connected) return;
  socket.emit('join', { roomId: activeRoomId });
}

function enterRoom(roomId) {
  const normalized = roomId?.trim().toUpperCase();
  if (!normalized) return;
  activeRoomId = normalized;
  mySide = 'spectator';
  currentState = null;
  selectedSquare = null;
  legalMoves = [];
  pendingPromotion = null;
  if (promotionOverlay) promotionOverlay.hidden = true;
  resetTimers();
  refreshLayout();
  render();
  if (socket.connected) {
    socket.emit('join', { roomId: normalized });
  }
}

function leaveRoomLocal() {
  if (!activeRoomId) return;
  socket.emit('leave_room');
  activeRoomId = null;
  mySide = 'spectator';
  currentState = null;
  selectedSquare = null;
  legalMoves = [];
  pendingPromotion = null;
  if (promotionOverlay) promotionOverlay.hidden = true;
  resetTimers();
  refreshLayout();
  render();
}

function getRoomUrl() {
  const url = new URL(window.location.href);
  if (activeRoomId) {
    url.searchParams.set('room', activeRoomId);
  }
  return url.toString();
}

lobbyCreateBtn?.addEventListener('click', () => {
  socket.emit('create_room', (resp) => {
    if (resp?.ok && resp.roomId) {
      enterRoom(resp.roomId);
    }
  });
});

function triggerLobbyJoin() {
  const value = lobbyJoinInput?.value || '';
  const normalized = value.trim().toUpperCase();
  if (!normalized) return;
  enterRoom(normalized);
}

lobbyJoinBtn?.addEventListener('click', triggerLobbyJoin);

lobbyJoinInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    triggerLobbyJoin();
  }
});

copyLinkBtn?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(getRoomUrl());
    copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => (copyLinkBtn.textContent = 'Copy Invite'), 1500);
  } catch (err) {
    statusText.textContent = 'Clipboard blocked';
  }
});

backToLobbyBtn?.addEventListener('click', () => {
  leaveRoomLocal();
});

themeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetTheme = btn.dataset.theme;
    applyTheme(targetTheme);
  });
});

const socket = io();

socket.on('connect', () => {
  joinActiveRoom();
});

socket.on('lobby_state', (rooms) => {
  lobbyRooms = Array.isArray(rooms) ? rooms : [];
  renderLobby();
});

socket.on('joined', ({ roomId, side }) => {
  activeRoomId = roomId;
  mySide = side || 'spectator';
  refreshLayout();
  render();
});

socket.on('state', (state) => {
  currentState = state;
  if (state?.id) {
    activeRoomId = state.id;
  }
  if (promotionOverlay) promotionOverlay.hidden = true;
  pendingPromotion = null;
  selectedSquare = null;
  legalMoves = [];
  if (state?.clocks) updateClocks(state.clocks);
  refreshLayout();
  updateStatus();
  render();
  updateButtons();
});

socket.on('clock', ({ white, black, status, result }) => {
  if (currentState) {
    if (status) currentState.status = status;
    if (result) currentState.result = result;
  }
  updateClocks({ white, black });
  updateStatus();
  updateButtons();
});

socket.on('left_room', () => {
  activeRoomId = null;
  mySide = 'spectator';
  currentState = null;
  selectedSquare = null;
  legalMoves = [];
  pendingPromotion = null;
  resetTimers();
  refreshLayout();
  render();
});

socket.on('error_message', ({ message }) => {
  if (statusText) {
    statusText.textContent = message || 'Error';
  }
});

function updateClocks(clocks) {
  if (!clocks) return;
  if (currentState) {
    currentState.clocks = {
      white: clocks.white,
      black: clocks.black,
    };
  }
  renderTimers();
}

function updateStatus() {
  if (!statusText) return;
  if (!activeRoomId) {
    statusText.textContent = 'Browse the lobby to start a comic showdown';
    return;
  }
  if (!currentState) {
    statusText.textContent = 'Connecting...';
    return;
  }

  const playing = currentState.status === 'playing';
  const ended = currentState.status === 'ended';

  if (currentState.status === 'waiting') {
    statusText.textContent = 'Waiting for opponent...';
    return;
  }

  if (playing) {
    const turnText = currentState.turn === 'w' ? 'White' : 'Black';
    if (mySide === 'spectator') {
      statusText.textContent = `${turnText} to move`;
    } else {
      const isMine = (currentState.turn === 'w' && mySide === 'white') || (currentState.turn === 'b' && mySide === 'black');
      statusText.textContent = isMine ? 'Your move' : "Opponent's move";
    }
    if (currentState.check) {
      statusText.textContent += ' - Check!';
    }
    return;
  }

  if (ended) {
    const result = currentState.result || {};
    let message = 'Draw';
    if (result.winner === 'w') message = 'White wins';
    else if (result.winner === 'b') message = 'Black wins';
    if (result.reason) {
      message += ` by ${result.reason.replace(/_/g, ' ')}`;
    }
    statusText.textContent = message;
    return;
  }

  statusText.textContent = 'Ready';
}

function updateButtons() {
  const inGame = Boolean(activeRoomId);
  const playing = currentState && currentState.status === 'playing';
  const isPlayer = mySide === 'white' || mySide === 'black';
  const canPlay = inGame && playing && isPlayer;

  if (drawBtn) drawBtn.disabled = !canPlay;
  if (resignBtn) resignBtn.disabled = !canPlay;

  const drawOffered = currentState?.drawOfferedBy;
  if (drawBtn) {
    if (canPlay && drawOffered && ((drawOffered === 'w' && mySide === 'black') || (drawOffered === 'b' && mySide === 'white'))) {
      drawBtn.textContent = 'Accept Draw';
      drawBtn.dataset.mode = 'accept';
    } else {
      drawBtn.textContent = 'Offer Draw';
      drawBtn.dataset.mode = 'offer';
    }
  }

  if (rematchBtn) {
    rematchBtn.disabled = !(inGame && currentState && currentState.status === 'ended' && isPlayer);
  }
}

drawBtn?.addEventListener('click', () => {
  if (!activeRoomId) return;
  const mode = drawBtn.dataset.mode || 'offer';
  if (mode === 'accept') {
    socket.emit('accept_draw', { roomId: activeRoomId });
  } else {
    socket.emit('offer_draw', { roomId: activeRoomId });
  }
});

resignBtn?.addEventListener('click', () => {
  if (!activeRoomId) return;
  if (confirm('Confirm resignation?')) {
    socket.emit('resign', { roomId: activeRoomId });
  }
});

rematchBtn?.addEventListener('click', () => {
  if (!activeRoomId) return;
  socket.emit('request_rematch', { roomId: activeRoomId });
  rematchBtn.disabled = true;
  rematchBtn.textContent = 'Awaiting opponent...';
  setTimeout(() => {
    rematchBtn.textContent = 'Rematch';
    updateButtons();
  }, 6000);
});

function getOrientation() {
  return mySide === 'black' ? 'black' : 'white';
}

function fenToBoard(fen) {
  const rows = fen.split(' ')[0].split('/');
  const output = [];
  for (let r = 0; r < 8; r++) {
    const row = rows[r];
    const line = [];
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (/[1-8]/.test(ch)) {
        for (let k = 0; k < Number(ch); k++) line.push(null);
      } else {
        line.push(ch);
      }
    }
    output.push(line);
  }
  return output;
}

function boardSize() {
  const displaySize = Math.min(520, Math.floor(window.innerWidth * 0.9));
  board.style.width = `${displaySize}px`;
  board.style.height = `${displaySize}px`;
  board.width = displaySize;
  board.height = displaySize;
  return displaySize;
}

function squareAt(x, y) {
  const size = board.width;
  const tile = size / 8;
  const i = Math.floor(x / tile);
  const j = Math.floor(y / tile);
  if (i < 0 || i > 7 || j < 0 || j > 7) return null;
  const files = 'abcdefgh';
  if (getOrientation() === 'white') {
    return files[i] + (8 - j);
  } else {
    return files[7 - i] + (j + 1);
  }
}

function filestr(i) {
  return 'abcdefgh'[i];
}

function rfToSquare(file, rank) {
  return filestr(file) + (rank + 1);
}

function squareGrid(square) {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(square[1]) - 1;
  if (getOrientation() === 'white') {
    return { i: file, j: 7 - rank };
  }
  return { i: 7 - file, j: rank };
}

function drawComicPiece(ctx, piece, centerX, centerY, tile, palette) {
  const isHero = piece === piece.toUpperCase();
  const type = piece.toLowerCase();
  const heroBase = (palette?.heroBase || '#FF3B30');
  const heroAccent = (palette?.heroAccent || '#FFB84D');
  const villainBase = (palette?.villainBase || '#007AFF');
  const villainAccent = (palette?.villainAccent || '#66D1FF');
  const baseColor = isHero ? heroBase : villainBase;
  const accentColor = isHero ? heroAccent : villainAccent;
  const outlineColor = '#000000';

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = Math.max(2, tile * 0.08);

  const drawPedestal = (accentScale = 1) => {
    ctx.beginPath();
    ctx.moveTo(-tile * 0.32, tile * 0.24);
    ctx.lineTo(tile * 0.32, tile * 0.24);
    ctx.lineTo(tile * 0.36, tile * 0.34);
    ctx.lineTo(-tile * 0.36, tile * 0.34);
    ctx.closePath();
    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.rect(-tile * 0.28, tile * 0.3, tile * 0.56, tile * 0.08 * accentScale);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.stroke();
  };

  const drawPawn = () => {
    drawPedestal(0.6);

    ctx.beginPath();
    ctx.ellipse(0, tile * 0.05, tile * 0.18, tile * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -tile * 0.14, tile * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -tile * 0.26, tile * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.stroke();
  };

  const drawRook = () => {
    drawPedestal();

    ctx.beginPath();
    ctx.rect(-tile * 0.24, -tile * 0.04, tile * 0.48, tile * 0.3);
    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-tile * 0.26, -tile * 0.04);
    ctx.lineTo(-tile * 0.26, -tile * 0.2);
    ctx.lineTo(-tile * 0.16, -tile * 0.2);
    ctx.lineTo(-tile * 0.16, -tile * 0.04);
    ctx.lineTo(-tile * 0.05, -tile * 0.04);
    ctx.lineTo(-tile * 0.05, -tile * 0.2);
    ctx.lineTo(tile * 0.05, -tile * 0.2);
    ctx.lineTo(tile * 0.05, -tile * 0.04);
    ctx.lineTo(tile * 0.16, -tile * 0.04);
    ctx.lineTo(tile * 0.16, -tile * 0.2);
    ctx.lineTo(tile * 0.26, -tile * 0.2);
    ctx.lineTo(tile * 0.26, -tile * 0.04);
    ctx.closePath();
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.stroke();
  };

  const drawKnight = () => {
    drawPedestal();

    ctx.beginPath();
    ctx.moveTo(tile * 0.24, tile * 0.22);
    ctx.lineTo(tile * 0.3, tile * 0.04);
    ctx.lineTo(tile * 0.08, -tile * 0.15);
    ctx.lineTo(tile * 0.24, -tile * 0.28);
    ctx.lineTo(tile * 0.12, -tile * 0.36);
    ctx.lineTo(-tile * 0.1, -tile * 0.26);
    ctx.lineTo(-tile * 0.22, -tile * 0.06);
    ctx.lineTo(-tile * 0.14, 0);
    ctx.lineTo(-tile * 0.24, tile * 0.22);
    ctx.closePath();
    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(tile * 0.02, -tile * 0.2, tile * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-tile * 0.1, -tile * 0.02);
    ctx.lineTo(tile * 0.1, tile * 0.08);
    ctx.lineTo(-tile * 0.08, tile * 0.15);
    ctx.closePath();
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.stroke();
  };

  const drawBishop = () => {
    drawPedestal();

    ctx.beginPath();
    ctx.ellipse(0, -tile * 0.02, tile * 0.18, tile * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -tile * 0.32);
    ctx.lineTo(tile * 0.14, -tile * 0.08);
    ctx.lineTo(0, tile * 0.02);
    ctx.lineTo(-tile * 0.14, -tile * 0.08);
    ctx.closePath();
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -tile * 0.38, tile * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.stroke();
  };

  const drawQueen = () => {
    drawPedestal();

    ctx.beginPath();
    ctx.moveTo(-tile * 0.24, tile * 0.2);
    ctx.lineTo(-tile * 0.32, -tile * 0.02);
    ctx.lineTo(-tile * 0.18, -tile * 0.36);
    ctx.lineTo(0, -tile * 0.16);
    ctx.lineTo(tile * 0.18, -tile * 0.36);
    ctx.lineTo(tile * 0.32, -tile * 0.02);
    ctx.lineTo(tile * 0.24, tile * 0.2);
    ctx.closePath();
    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-tile * 0.26, -tile * 0.12);
    ctx.lineTo(-tile * 0.12, -tile * 0.44);
    ctx.lineTo(0, -tile * 0.22);
    ctx.lineTo(tile * 0.12, -tile * 0.44);
    ctx.lineTo(tile * 0.26, -tile * 0.12);
    ctx.closePath();
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -tile * 0.5, tile * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.stroke();
  };

  const drawKing = () => {
    drawPedestal();

    ctx.beginPath();
    ctx.moveTo(-tile * 0.22, tile * 0.2);
    ctx.lineTo(-tile * 0.28, -tile * 0.02);
    ctx.lineTo(-tile * 0.1, -tile * 0.38);
    ctx.lineTo(tile * 0.1, -tile * 0.38);
    ctx.lineTo(tile * 0.28, -tile * 0.02);
    ctx.lineTo(tile * 0.22, tile * 0.2);
    ctx.closePath();
    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.rect(-tile * 0.05, -tile * 0.48, tile * 0.1, tile * 0.24);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.rect(-tile * 0.16, -tile * 0.4, tile * 0.32, tile * 0.1);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.stroke();
  };

  switch (type) {
    case 'p':
      drawPawn();
      break;
    case 'r':
      drawRook();
      break;
    case 'n':
      drawKnight();
      break;
    case 'b':
      drawBishop();
      break;
    case 'q':
      drawQueen();
      break;
    case 'k':
      drawKing();
      break;
    default:
      drawPawn();
  }

  ctx.restore();
}

function drawBoard() {
  const size = boardSize();
  const tile = size / 8;
  ctx.clearRect(0, 0, size, size);

  const computed = getComputedStyle(document.body);
  const light = computed.getPropertyValue('--light-square');
  const dark = computed.getPropertyValue('--dark-square');
  const highlight = computed.getPropertyValue('--highlight-square');
  const moveDot = computed.getPropertyValue('--move-dot');
  const palette = {
    heroBase: (computed.getPropertyValue('--hero-base') || '').trim() || '#FF3B30',
    heroAccent: (computed.getPropertyValue('--hero-accent') || '').trim() || '#FFB84D',
    villainBase: (computed.getPropertyValue('--villain-base') || '').trim() || '#007AFF',
    villainAccent: (computed.getPropertyValue('--villain-accent') || '').trim() || '#66D1FF',
  };

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const isLight = (x + y) % 2 === 0;
      ctx.fillStyle = isLight ? light : dark;
      ctx.fillRect(x * tile, y * tile, tile, tile);
    }
  }

  if (selectedSquare) {
    const { i, j } = squareGrid(selectedSquare);
    ctx.fillStyle = highlight;
    ctx.fillRect(i * tile, j * tile, tile, tile);
  }

  for (const move of legalMoves) {
    const { i, j } = squareGrid(move.to);
    ctx.fillStyle = moveDot;
    ctx.beginPath();
    ctx.arc(i * tile + tile / 2, j * tile + tile / 2, tile / 6, 0, Math.PI * 2);
    ctx.fill();
  }

  if (!currentState) return;
  const boardArr = fenToBoard(currentState.fen);

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = boardArr[r][f];
      if (!piece) continue;
      const square = rfToSquare(f, 7 - r);
      const { i, j } = squareGrid(square);
      drawComicPiece(ctx, piece, i * tile + tile / 2, j * tile + tile / 2, tile, palette);
    }
  }
}

function isMyTurn() {
  if (!currentState) return false;
  if (mySide === 'white') return currentState.turn === 'w';
  if (mySide === 'black') return currentState.turn === 'b';
  return false;
}

board.addEventListener('click', (e) => {
  if (!activeRoomId || !currentState || currentState.status !== 'playing') return;
  if (!isMyTurn()) return;
  if (!(mySide === 'white' || mySide === 'black')) return;

  const rect = board.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const sq = squareAt(x, y);
  if (!sq) return;

  if (selectedSquare) {
    const legal = legalMoves.find((m) => m.to === sq);
    if (legal) {
      if (legal.promotion) {
        pendingPromotion = { from: selectedSquare, to: sq };
        if (promotionOverlay) promotionOverlay.hidden = false;
      } else {
        sendMove(selectedSquare, sq);
      }
    }
    selectedSquare = null;
    legalMoves = [];
    render();
    return;
  }

  socket.emit('request_moves', { roomId: activeRoomId, square: sq }, (resp) => {
    if (resp?.ok) {
      selectedSquare = sq;
      legalMoves = resp.moves || [];
      render();
    }
  });
});

promotionOverlay?.addEventListener('click', (e) => {
  const target = e.target;
  if (target.tagName === 'BUTTON' && target.dataset.piece) {
    const promo = target.dataset.piece;
    const { from, to } = pendingPromotion || {};
    if (from && to) {
      sendMove(from, to, promo);
    }
    pendingPromotion = null;
    promotionOverlay.hidden = true;
  }
});

function sendMove(from, to, promotion) {
  socket.emit('move', { roomId: activeRoomId, from, to, promotion }, (resp) => {
    if (!resp?.ok) {
      statusText.textContent = resp?.error || 'Illegal move';
    }
  });
}

function render() {
  drawBoard();
}

window.addEventListener('resize', () => render());

let savedTheme = 'iron';
try {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored && THEMES.includes(stored)) {
    savedTheme = stored;
  }
} catch (err) {
  savedTheme = 'iron';
}

applyTheme(savedTheme, { persist: false });

resetTimers();
refreshLayout();
render();
