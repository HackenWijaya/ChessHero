import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';

const PORT = process.env.PORT || 3000;
const INITIAL_TIME_MINUTES = parseInt(process.env.INITIAL_MINUTES || '5', 10);
const INITIAL_TIME_MS = INITIAL_TIME_MINUTES * 60 * 1000;

const app = express();
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, {
  // Default same-origin; adjust if you add a separate frontend
});

function randomRoomId(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

const rooms = new Map();

function playerCount(room) {
  return Number(Boolean(room.players.white)) + Number(Boolean(room.players.black));
}

function summarizeRoom(room) {
  return {
    id: room.id,
    status: room.status,
    players: {
      joined: playerCount(room),
      capacity: 2,
    },
    createdAt: room.createdAt ?? 0,
  };
}

function getLobbyState() {
  return Array.from(rooms.values())
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map((room) => summarizeRoom(room));
}

function broadcastLobby() {
  io.emit('lobby_state', getLobbyState());
}

function createRoom(id) {
  const chess = new Chess();
  const room = {
    id,
    chess,
    players: { white: null, black: null },
    status: 'waiting', // waiting | playing | ended
    clocks: { white: INITIAL_TIME_MS, black: INITIAL_TIME_MS },
    lastUpdate: Date.now(),
    drawOfferedBy: null, // 'w' | 'b' | null
    result: null, // { reason, winner } or { reason, winner: 'draw' }
    rematchRequests: new Set(), // contains 'w' and/or 'b'
    createdAt: Date.now(),
  };
  rooms.set(id, room);
  broadcastLobby();
  return room;
}

function getOrCreateRoom(id) {
  return rooms.get(id) || createRoom(id);
}

function seatForSocket(room, socketId) {
  if (room.players.white === socketId) return 'white';
  if (room.players.black === socketId) return 'black';
  return null;
}

function abbrev(side) {
  return side === 'white' ? 'w' : side === 'black' ? 'b' : null;
}

function opponent(abbrevTurn) {
  return abbrevTurn === 'w' ? 'b' : 'w';
}

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  const seat = room ? seatForSocket(room, socket.id) : null;
  socket.leave(roomId);
  socket.data.roomId = null;
  if (!room) {
    broadcastLobby();
    return;
  }

  const ab = abbrev(seat);
  if (seat === 'white') {
    room.players.white = null;
    room.rematchRequests.delete('w');
  } else if (seat === 'black') {
    room.players.black = null;
    room.rematchRequests.delete('b');
  }
  if (ab && room.drawOfferedBy === ab) {
    room.drawOfferedBy = null;
  }

  io.to(roomId).emit('state', computeState(room));
  broadcastLobby();
}

function computeState(room) {
  return {
    id: room.id,
    fen: room.chess.fen(),
    turn: room.chess.turn(), // 'w' or 'b'
    status: room.status,
    clocks: { white: room.clocks.white, black: room.clocks.black },
    players: { white: Boolean(room.players.white), black: Boolean(room.players.black) },
    drawOfferedBy: room.drawOfferedBy, // 'w' | 'b' | null
    result: room.result,
    check: room.chess.isCheck(),
  };
}

function startGame(room) {
  room.chess.reset();
  room.status = 'playing';
  room.clocks.white = INITIAL_TIME_MS;
  room.clocks.black = INITIAL_TIME_MS;
  room.lastUpdate = Date.now();
  room.drawOfferedBy = null;
  room.result = null;
  room.rematchRequests.clear();
  broadcastLobby();
}

function endGame(room, reason, winner) {
  room.status = 'ended';
  room.result = { reason, winner: winner ?? 'draw' };
  broadcastLobby();
}

// API: Create a new room
app.post('/api/new', (req, res) => {
  let id;
  do {
    id = randomRoomId(6);
  } while (rooms.has(id));
  createRoom(id);
  res.json({ id, url: `/\u003Froom=${id}` });
});

io.on('connection', (socket) => {
  socket.emit('lobby_state', getLobbyState());

  socket.on('create_room', (ack) => {
    let id;
    do {
      id = randomRoomId(6);
    } while (rooms.has(id));
    createRoom(id);
    ack?.({ ok: true, roomId: id });
  });

  socket.on('join', ({ roomId }) => {
    if (!roomId || typeof roomId !== 'string') {
      socket.emit('error_message', { message: 'Invalid room id' });
      return;
    }
    const normalizedId = roomId.trim().toUpperCase();
    if (socket.data.roomId && socket.data.roomId !== normalizedId) {
      leaveRoom(socket);
    }

    const room = getOrCreateRoom(normalizedId);
    socket.join(normalizedId);
    socket.data.roomId = normalizedId;

    let side = 'spectator';
    if (!room.players.white) {
      room.players.white = socket.id;
      side = 'white';
    } else if (!room.players.black) {
      room.players.black = socket.id;
      side = 'black';
    }

    socket.emit('joined', { roomId: normalizedId, side });
    io.to(normalizedId).emit('state', computeState(room));

    // Auto-start if both seats filled and game not started yet
    if (room.players.white && room.players.black && room.status === 'waiting') {
      startGame(room);
      io.to(normalizedId).emit('state', computeState(room));
    } else {
      broadcastLobby();
    }
  });

  socket.on('leave_room', () => {
    if (!socket.data.roomId) return;
    leaveRoom(socket);
    socket.emit('left_room');
  });

  // Client asks for legal moves from a square (ack pattern)
  socket.on('request_moves', ({ roomId, square }, ack) => {
    const targetRoomId = roomId || socket.data.roomId;
    const room = rooms.get(targetRoomId);
    if (!room) return ack?.({ ok: false, error: 'Room not found' });
    try {
      const moves = room.chess.moves({ square, verbose: true }) || [];
      const result = moves.map((m) => ({ to: m.to, promotion: m.flags.includes('p') }));
      ack?.({ ok: true, square, moves: result });
    } catch (e) {
      ack?.({ ok: false, error: 'Invalid square' });
    }
  });

  // Attempt a move
  socket.on('move', ({ roomId, from, to, promotion }, ack) => {
    const targetRoomId = roomId || socket.data.roomId;
    const room = rooms.get(targetRoomId);
    if (!room) return ack?.({ ok: false, error: 'Room not found' });
    if (room.status !== 'playing') return ack?.({ ok: false, error: 'Game not in playing state' });

    const side = seatForSocket(room, socket.id);
    const sideAbbrev = abbrev(side);
    if (!sideAbbrev) return ack?.({ ok: false, error: 'Spectators cannot move' });
    if (room.chess.turn() !== sideAbbrev) return ack?.({ ok: false, error: 'Not your turn' });

    // Update clock for the player to move before executing move
    const now = Date.now();
    const elapsed = now - room.lastUpdate;
    if (room.chess.turn() === 'w') {
      room.clocks.white = Math.max(0, room.clocks.white - elapsed);
    } else {
      room.clocks.black = Math.max(0, room.clocks.black - elapsed);
    }
    room.lastUpdate = now;

    let result;
    try {
      result = room.chess.move({ from, to, promotion });
    } catch (e) {
      result = null;
    }
    if (!result) {
      return ack?.({ ok: false, error: 'Illegal move' });
    }

    // Clear any outstanding draw offer after a move
    room.drawOfferedBy = null;

    // Check for game end conditions
    const chess = room.chess;
    if (chess.isCheckmate()) {
      endGame(room, 'checkmate', sideAbbrev); // mover wins
    } else if (chess.isStalemate()) {
      endGame(room, 'stalemate');
    } else if (chess.isInsufficientMaterial()) {
      endGame(room, 'insufficient_material');
    } else if (chess.isThreefoldRepetition()) {
      endGame(room, 'threefold_repetition');
    } else if (chess.isDrawByFiftyMoves()) {
      endGame(room, 'fifty_move_rule');
    } else if (chess.isDraw()) {
      endGame(room, 'draw');
    }

    ack?.({ ok: true });
    io.to(targetRoomId).emit('state', computeState(room));
  });

  socket.on('offer_draw', ({ roomId }) => {
    const targetRoomId = roomId || socket.data.roomId;
    const room = rooms.get(targetRoomId);
    if (!room || room.status !== 'playing') return;
    const side = seatForSocket(room, socket.id);
    const ab = abbrev(side);
    if (!ab) return;
    if (!room.drawOfferedBy) {
      room.drawOfferedBy = ab;
      io.to(targetRoomId).emit('state', computeState(room));
    }
  });

  socket.on('accept_draw', ({ roomId }) => {
    const targetRoomId = roomId || socket.data.roomId;
    const room = rooms.get(targetRoomId);
    if (!room || room.status !== 'playing') return;
    const side = seatForSocket(room, socket.id);
    const ab = abbrev(side);
    if (!ab) return;
    if (room.drawOfferedBy && room.drawOfferedBy !== ab) {
      endGame(room, 'draw_agreed');
      io.to(targetRoomId).emit('state', computeState(room));
    }
  });

  socket.on('resign', ({ roomId }) => {
    const targetRoomId = roomId || socket.data.roomId;
    const room = rooms.get(targetRoomId);
    if (!room || room.status !== 'playing') return;
    const side = seatForSocket(room, socket.id);
    const ab = abbrev(side);
    if (!ab) return;
    endGame(room, 'resignation', opponent(ab));
    io.to(targetRoomId).emit('state', computeState(room));
  });

  socket.on('request_rematch', ({ roomId }) => {
    const targetRoomId = roomId || socket.data.roomId;
    const room = rooms.get(targetRoomId);
    if (!room || room.status !== 'ended') return;
    const side = seatForSocket(room, socket.id);
    const ab = abbrev(side);
    if (!ab) return;
    room.rematchRequests.add(ab);
    // Start once both players have requested rematch
    if (room.rematchRequests.has('w') && room.rematchRequests.has('b')) {
      startGame(room);
    }
    io.to(targetRoomId).emit('state', computeState(room));
  });

  socket.on('get_state', ({ roomId }, ack) => {
    const targetRoomId = roomId || socket.data.roomId;
    const room = rooms.get(targetRoomId);
    if (!room) return ack?.({ ok: false, error: 'Room not found' });
    ack?.({ ok: true, state: computeState(room) });
  });

  socket.on('disconnect', () => {
    leaveRoom(socket);
  });
});

// Global clock tick: update current player's clock and broadcast
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status !== 'playing') continue;
    const elapsed = now - room.lastUpdate;
    if (elapsed <= 0) continue;

    if (room.chess.turn() === 'w') {
      room.clocks.white = Math.max(0, room.clocks.white - elapsed);
      if (room.clocks.white === 0) {
        endGame(room, 'timeout', 'b');
      }
    } else {
      room.clocks.black = Math.max(0, room.clocks.black - elapsed);
      if (room.clocks.black === 0) {
        endGame(room, 'timeout', 'w');
      }
    }
    room.lastUpdate = now;

    io.to(room.id).emit('clock', {
      white: room.clocks.white,
      black: room.clocks.black,
      turn: room.chess.turn(),
      status: room.status,
      result: room.result,
    });
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`Chess server listening on http://localhost:${PORT}`);
});
