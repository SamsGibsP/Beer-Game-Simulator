const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const leaderboardFile = path.join(__dirname, 'data', 'leaderboard.json');

// Ensure data folder exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}
if (!fs.existsSync(leaderboardFile)) {
  fs.writeFileSync(leaderboardFile, '[]');
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // Enable JSON parsing for API requests

app.get('/api/leaderboard', (req, res) => {
  const data = JSON.parse(fs.readFileSync(leaderboardFile, 'utf8'));
  res.json(data);
});

app.post('/api/leaderboard/reset', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  fs.writeFileSync(leaderboardFile, '[]');
  res.json({ success: true });
});

app.post('/api/leaderboard/delete', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const index = req.body.index;
  const lbData = JSON.parse(fs.readFileSync(leaderboardFile, 'utf8'));
  if (index >= 0 && index < lbData.length) {
    lbData.splice(index, 1);
    fs.writeFileSync(leaderboardFile, JSON.stringify(lbData, null, 2));
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid index' });
  }
});

const PORT = process.env.PORT || 3001;

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

const ADMIN_PASSWORD = 'admin1234';

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // ADMIN: Login
  socket.on('adminLogin', (pwd) => {
    if (pwd === ADMIN_PASSWORD) {
      socket.emit('adminLoginSuccess');
    } else {
      socket.emit('adminLoginFail');
    }
  });

  // HOST: Create Room
  socket.on('createRoom', (data) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      hostId: socket.id,
      players: { Retailer: null, Wholesaler: null, Distributor: null, Factory: null },
      playerNames: {},
      round: 0,
      maxRounds: data?.maxRounds || 25,
      gameState: 'waiting', // waiting, in_progress, finished
      history: [],
      state: {
        Customer: { orderPlaced: null },
        Retailer: getInitialRoleState(),
        Wholesaler: getInitialRoleState(),
        Distributor: getInitialRoleState(),
        Factory: getInitialRoleState()
      },
      roomName: data?.roomName || 'Ruang Simulasi',
      timerDuration: data?.timerDuration || 0,
      randomizeRoles: data?.randomizeRoles || false
    };
    socket.join(roomCode);
    socket.emit('roomCreated', roomCode);
  });

  // PLAYER / PROJECTOR: Join Room
  socket.on('joinRoom', ({ roomCode, role, playerName }) => {
    roomCode = roomCode.toUpperCase();
    const room = rooms[roomCode];

    if (!room) return socket.emit('error', 'Room not found.');
    
    // Projector logic
    if (role === 'Projector') {
      socket.join(roomCode);
      socket.emit('joined', { role, roomCode, roomName: room.roomName, round: room.round, maxRounds: room.maxRounds, state: room.state });
      return;
    }

    if (room.gameState !== 'waiting') return socket.emit('error', 'Game has already started.');
    if (!ROLES.includes(role)) return socket.emit('error', 'Invalid role.');
    if (room.players[role] !== null) return socket.emit('error', `Role ${role} is already taken.`);

    room.players[role] = socket.id;
    room.playerNames[role] = playerName || role;
    socket.join(roomCode);

    socket.emit('joined', { role, roomCode });
    io.to(room.hostId).emit('playerJoined', { role, playerName: room.playerNames[role] });
    io.to(roomCode).emit('projectorUpdate', { type: 'playerJoined', role, playerName: room.playerNames[role] });
  });

  // HOST: Start Game
  socket.on('startGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      room.gameState = 'in_progress';
      room.round = 1;

      // Handle Role Shuffling
      if (room.randomizeRoles) {
        const currentPlayers = [];
        for (const r of ROLES) {
          if (room.players[r]) {
            currentPlayers.push({ socketId: room.players[r], name: room.playerNames[r] });
          }
        }

        // Shuffle array
        for (let i = currentPlayers.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [currentPlayers[i], currentPlayers[j]] = [currentPlayers[j], currentPlayers[i]];
        }

        // Reassign
        let idx = 0;
        for (const r of ROLES) {
          if (idx < currentPlayers.length) {
            room.players[r] = currentPlayers[idx].socketId;
            room.playerNames[r] = currentPlayers[idx].name;
            idx++;
          } else {
            room.players[r] = null;
            room.playerNames[r] = null;
          }
        }
      }

      // Record initial state as week 0 history
      room.history.push(JSON.parse(JSON.stringify(room.state)));

      // Notify host
      socket.emit('gameStarted', {
        round: room.round,
        state: room.state,
        timerDuration: room.timerDuration,
        maxRounds: room.maxRounds,
        players: room.playerNames
      });

      // Notify each player personally
      for (const r of ROLES) {
        if (room.players[r]) {
          io.to(room.players[r]).emit('gameStartedForPlayer', {
            finalRole: r,
            round: room.round,
            state: room.state,
            timerDuration: room.timerDuration,
            maxRounds: room.maxRounds
          });
        }
      }
    }
  });

  // HOST: Kick Player
  socket.on('kickPlayer', ({ roomCode, role }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return; // Only host can kick
    
    const targetSocketId = room.players[role];
    if (targetSocketId) {
      io.to(targetSocketId).emit('kicked');
      room.players[role] = null;
      room.playerNames[role] = null;
      
      // Notify host to update UI
      socket.emit('playerKicked', { role });
    }
  });

  // PLAYER: Ready (Agreed to Rules)
  socket.on('playerReady', ({ roomCode, role }) => {
    const room = rooms[roomCode];
    if (room && room.hostId) {
      io.to(room.hostId).emit('playerIsReady', { role });
    }
  });

  // HOST / PLAYER: Submit Order
  socket.on('submitOrder', ({ roomCode, role, orderAmount, isRandom, min, max }) => {
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'in_progress') return;

    if (role === 'Customer' && isRandom) {
      min = parseInt(min) || 0;
      max = parseInt(max) || 0;
      orderAmount = Math.floor(Math.random() * (max - min + 1)) + min;
    } else {
      orderAmount = parseInt(orderAmount);
      if (isNaN(orderAmount) || orderAmount < 0) return;
    }

    // Verify sender
    if (role === 'Customer' && socket.id !== room.hostId) return;
    if (role !== 'Customer' && socket.id !== room.players[role]) return;

    room.state[role].orderPlaced = orderAmount;

    // Notify host about submission status
    io.to(room.hostId).emit('playerSubmitted', { role, orderAmount });

    // Broadcast order received to room (for Projector)
    io.to(roomCode).emit('playerOrdered', { role, orderAmount });

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

      // Kalkulasi leaderboard
      let totalCost = 0;
      let retNoBacklogWeeks = 0;

      room.history.forEach((state, idx) => {
        if (idx === 0) return;
        roles.forEach(r => { totalCost += state[r].cost; });
        if (state.Retailer.backlog === 0) retNoBacklogWeeks++;
      });

      const numWeeks = room.history.length - 1;
      const serviceLevel = numWeeks > 0 ? parseFloat(((retNoBacklogWeeks / numWeeks) * 100).toFixed(1)) : 0;

      const lbData = JSON.parse(fs.readFileSync(leaderboardFile, 'utf8'));
      lbData.push({
        roomName: room.roomName,
        cost: totalCost,
        serviceLevel: serviceLevel,
        date: new Date().toISOString()
      });
      lbData.sort((a, b) => a.cost - b.cost);
      fs.writeFileSync(leaderboardFile, JSON.stringify(lbData, null, 2));

      io.to(roomCode).emit('gameFinished', { history: room.history });
    } else {
      // Reset orderPlaced for next round
      s.Customer.orderPlaced = null;
      s.Retailer.orderPlaced = null;
      s.Wholesaler.orderPlaced = null;
      s.Distributor.orderPlaced = null;
      s.Factory.orderPlaced = null;

      room.round++;
      io.to(roomCode).emit('newRound', {
        round: room.round,
        state: s,
        timerDuration: room.timerDuration,
        maxRounds: room.maxRounds
      });
    }
  }

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
