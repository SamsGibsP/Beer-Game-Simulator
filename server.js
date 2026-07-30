const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;

app.use(express.static(path.join(__dirname, 'public')));

// In-memory state
const rooms = {};
const ROLES = ['Retailer', 'Wholesaler', 'Distributor', 'Factory'];

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // HOST: Create Room
  socket.on('createRoom', () => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      hostId: socket.id,
      players: {
        Retailer: null,
        Wholesaler: null,
        Distributor: null,
        Factory: null
      },
      playerNames: {},
      round: 0,
      maxRounds: 4,
      gameState: 'waiting', // waiting, in_progress, finished
      currentTurn: 'Customer', // Customer -> Retailer -> Wholesaler -> Distributor -> Factory -> RoundComplete
      history: [] 
      // history[round-1] = { Customer: X, Retailer: X, Wholesaler: X, Distributor: X, Factory: X }
    };
    socket.join(roomCode);
    socket.emit('roomCreated', roomCode);
  });

  // PLAYER: Join Room
  socket.on('joinRoom', ({ roomCode, role, playerName }) => {
    roomCode = roomCode.toUpperCase();
    const room = rooms[roomCode];

    if (!room) {
      return socket.emit('error', 'Room not found.');
    }

    if (room.gameState !== 'waiting') {
      return socket.emit('error', 'Game has already started.');
    }

    if (!ROLES.includes(role)) {
      return socket.emit('error', 'Invalid role.');
    }

    if (room.players[role] !== null) {
      return socket.emit('error', `Role ${role} is already taken.`);
    }

    room.players[role] = socket.id;
    room.playerNames[role] = playerName || role;
    socket.join(roomCode);

    socket.emit('joined', { role, roomCode });
    
    // Notify host that someone joined
    io.to(room.hostId).emit('playerJoined', { role, playerName: room.playerNames[role] });
  });

  // HOST: Start Game
  socket.on('startGame', (roomCode) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      // Ensure all roles are filled (Optional, but good for real game. We can force it or just warn)
      const missingRoles = ROLES.filter(r => room.players[r] === null);
      if (missingRoles.length > 0) {
        return socket.emit('error', `Missing players for: ${missingRoles.join(', ')}`);
      }

      room.gameState = 'in_progress';
      room.round = 1;
      room.currentTurn = 'Customer';
      room.history.push({});
      io.to(roomCode).emit('gameStarted', { round: room.round });
      io.to(roomCode).emit('turnUpdate', { turn: 'Customer', message: 'Menunggu Host memasukkan Customer Demand' });
    }
  });

  // HOST / PLAYER: Submit Order
  socket.on('submitOrder', ({ roomCode, orderAmount }) => {
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'in_progress') return;

    orderAmount = parseInt(orderAmount);
    if (isNaN(orderAmount)) return;

    const roundIndex = room.round - 1;
    const currentHist = room.history[roundIndex];

    const roleOrder = ['Customer', 'Retailer', 'Wholesaler', 'Distributor', 'Factory'];
    const currentRoleIndex = roleOrder.indexOf(room.currentTurn);
    
    // Verify who is sending
    if (room.currentTurn === 'Customer' && socket.id !== room.hostId) return;
    if (room.currentTurn !== 'Customer' && socket.id !== room.players[room.currentTurn]) return;

    // Save order
    currentHist[room.currentTurn] = orderAmount;

    // Advance turn
    const nextRoleIndex = currentRoleIndex + 1;
    
    if (nextRoleIndex < roleOrder.length) {
      const nextRole = roleOrder[nextRoleIndex];
      room.currentTurn = nextRole;
      
      // Emit to everyone for status update
      io.to(roomCode).emit('turnUpdate', { turn: nextRole });

      // Emit specifically to the next role so they see the incoming order
      const nextSocketId = nextRole === 'Customer' ? room.hostId : room.players[nextRole];
      if (nextSocketId) {
        io.to(nextSocketId).emit('incomingOrder', { amount: orderAmount, from: roleOrder[currentRoleIndex] });
      }
    } else {
      // Round Complete
      room.currentTurn = 'RoundComplete';
      io.to(roomCode).emit('turnUpdate', { turn: 'RoundComplete' });
      io.to(room.hostId).emit('roundComplete', { round: room.round, data: currentHist });
    }
  });

  // HOST: Next Round
  socket.on('nextRound', (roomCode) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id && room.currentTurn === 'RoundComplete') {
      if (room.round >= room.maxRounds) {
        // End Game
        room.gameState = 'finished';
        io.to(roomCode).emit('gameFinished', { history: room.history });
      } else {
        // Start next round
        room.round++;
        room.currentTurn = 'Customer';
        room.history.push({});
        io.to(roomCode).emit('newRound', { round: room.round });
        io.to(roomCode).emit('turnUpdate', { turn: 'Customer' });
      }
    }
  });

  // Disconnect logic
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
