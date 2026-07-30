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

function getInitialRoleState() {
  return {
    inventory: 12,
    backlog: 0,
    pipeline1: 4,
    pipeline2: 4,
    incomingOrder: 4,
    orderPlaced: null,
    cost: 0,
    shipped: 0, // temporary storage for recording
  };
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // HOST: Create Room
  socket.on('createRoom', () => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      hostId: socket.id,
      players: { Retailer: null, Wholesaler: null, Distributor: null, Factory: null },
      playerNames: {},
      round: 0,
      maxRounds: 25,
      gameState: 'waiting', // waiting, in_progress, finished
      history: [], 
      state: {
        Customer: { orderPlaced: null },
        Retailer: getInitialRoleState(),
        Wholesaler: getInitialRoleState(),
        Distributor: getInitialRoleState(),
        Factory: getInitialRoleState()
      }
    };
    socket.join(roomCode);
    socket.emit('roomCreated', roomCode);
  });

  // PLAYER: Join Room
  socket.on('joinRoom', ({ roomCode, role, playerName }) => {
    roomCode = roomCode.toUpperCase();
    const room = rooms[roomCode];

    if (!room) return socket.emit('error', 'Room not found.');
    if (room.gameState !== 'waiting') return socket.emit('error', 'Game has already started.');
    if (!ROLES.includes(role)) return socket.emit('error', 'Invalid role.');
    if (room.players[role] !== null) return socket.emit('error', `Role ${role} is already taken.`);

    room.players[role] = socket.id;
    room.playerNames[role] = playerName || role;
    socket.join(roomCode);

    socket.emit('joined', { role, roomCode });
    io.to(room.hostId).emit('playerJoined', { role, playerName: room.playerNames[role] });
  });

  // HOST: Start Game
  socket.on('startGame', (roomCode) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      room.gameState = 'in_progress';
      room.round = 1;
      // Record initial state as week 0 history
      room.history.push(JSON.parse(JSON.stringify(room.state)));
      
      io.to(roomCode).emit('gameStarted', { round: room.round, state: room.state });
    }
  });

  // HOST / PLAYER: Submit Order
  socket.on('submitOrder', ({ roomCode, role, orderAmount }) => {
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'in_progress') return;

    orderAmount = parseInt(orderAmount);
    if (isNaN(orderAmount) || orderAmount < 0) return;

    // Verify sender
    if (role === 'Customer' && socket.id !== room.hostId) return;
    if (role !== 'Customer' && socket.id !== room.players[role]) return;

    room.state[role].orderPlaced = orderAmount;
    
    // Notify host about submission status
    io.to(room.hostId).emit('playerSubmitted', { role });
    
    // Check if everyone has submitted
    const allSubmitted = 
      room.state.Customer.orderPlaced !== null &&
      room.state.Retailer.orderPlaced !== null &&
      room.state.Wholesaler.orderPlaced !== null &&
      room.state.Distributor.orderPlaced !== null &&
      room.state.Factory.orderPlaced !== null;

    if (allSubmitted) {
      processRound(roomCode);
    }
  });

  function processRound(roomCode) {
    const room = rooms[roomCode];
    const s = room.state;

    // We store the current orderPlaced to pass to next week's incoming
    const orders = {
      Customer: s.Customer.orderPlaced,
      Retailer: s.Retailer.orderPlaced,
      Wholesaler: s.Wholesaler.orderPlaced,
      Distributor: s.Distributor.orderPlaced,
      Factory: s.Factory.orderPlaced
    };

    const roles = ['Retailer', 'Wholesaler', 'Distributor', 'Factory'];
    let shippedTemp = {};

    // Step 1 & 2: Slide and Fill
    for (const role of roles) {
      const state = s[role];
      // Step 1: Slide
      state.inventory += state.pipeline2;
      state.pipeline2 = state.pipeline1;
      state.pipeline1 = 0; // Will be filled in Step 3

      // Step 2: Fill
      const toShip = state.incomingOrder + state.backlog;
      const shipped = Math.min(state.inventory, toShip);
      state.inventory -= shipped;
      state.backlog = toShip - shipped;
      shippedTemp[role] = shipped;
      state.shipped = shipped;
    }

    // Step 3: Place Orders (Route information and physical shipments)
    // Info delay: orders placed this week become incomingOrder next week
    s.Retailer.incomingOrder = orders.Customer;
    s.Wholesaler.incomingOrder = orders.Retailer;
    s.Distributor.incomingOrder = orders.Wholesaler;
    s.Factory.incomingOrder = orders.Distributor;

    // Physical shipping delay: shipped this week goes to pipeline1 next week
    // Retailer's shipment goes to Customer (leaves system)
    s.Retailer.pipeline1 = shippedTemp.Wholesaler;
    s.Wholesaler.pipeline1 = shippedTemp.Distributor;
    s.Distributor.pipeline1 = shippedTemp.Factory;
    s.Factory.pipeline1 = orders.Factory; // Factory produces for itself

    // Step 4: Record IRS (Costs)
    for (const role of roles) {
      const state = s[role];
      state.cost = (state.inventory * 500) + (state.backlog * 1000);
    }

    // Save history
    room.history.push(JSON.parse(JSON.stringify(s)));

    // Check game end
    if (room.round >= room.maxRounds) {
      room.gameState = 'finished';
      io.to(roomCode).emit('gameFinished', { history: room.history });
    } else {
      // Reset orderPlaced for next round
      s.Customer.orderPlaced = null;
      s.Retailer.orderPlaced = null;
      s.Wholesaler.orderPlaced = null;
      s.Distributor.orderPlaced = null;
      s.Factory.orderPlaced = null;

      room.round++;
      io.to(roomCode).emit('newRound', { round: room.round, state: s });
    }
  }

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
