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

const ROLES_LINEAR = ['Retailer', 'Wholesaler', 'Distributor', 'Factory'];
const ROLES_NETWORK = [
  'Retailer 1', 'Retailer 2', 'Retailer 3', 'Retailer 4',
  'Warehouse 1', 'Warehouse 2', 'Warehouse 3',
  'Wholesale 1', 'Wholesale 2',
  'Factory'
];

const NETWORK_TOPOLOGY = {
  'Retailer 1': ['Warehouse 1', 'Warehouse 2', 'Warehouse 3'],
  'Retailer 2': ['Warehouse 1', 'Warehouse 2', 'Warehouse 3'],
  'Retailer 3': ['Warehouse 1', 'Warehouse 2', 'Warehouse 3'],
  'Retailer 4': ['Warehouse 1', 'Warehouse 2', 'Warehouse 3'],
  'Warehouse 1': ['Wholesale 1', 'Wholesale 2'],
  'Warehouse 2': ['Wholesale 1', 'Wholesale 2'],
  'Warehouse 3': ['Wholesale 1', 'Wholesale 2'],
  'Wholesale 1': ['Factory'],
  'Wholesale 2': ['Factory'],
  'Factory': ['Raw Material']
};

const NETWORK_CHILDREN = {
  'Warehouse 1': ['Retailer 1', 'Retailer 2', 'Retailer 3', 'Retailer 4'],
  'Warehouse 2': ['Retailer 1', 'Retailer 2', 'Retailer 3', 'Retailer 4'],
  'Warehouse 3': ['Retailer 1', 'Retailer 2', 'Retailer 3', 'Retailer 4'],
  'Wholesale 1': ['Warehouse 1', 'Warehouse 2', 'Warehouse 3'],
  'Wholesale 2': ['Warehouse 1', 'Warehouse 2', 'Warehouse 3'],
  'Factory': ['Wholesale 1', 'Wholesale 2']
};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function initialNodeState(role) {
  const children = NETWORK_CHILDREN[role] || [];
  const backlog = {};
  children.forEach(c => backlog[c] = 0);
  
  if (role.startsWith('Retailer')) {
    const rNum = role.split(' ')[1];
    backlog[`Customer ${rNum}`] = 0;
  }
  
  return {
    inventory: 12,
    backlog,
    inboundShipments: [],
    cost: 0,
    history: []
  };
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('createRoom', ({ mode }) => {
    const roomCode = generateRoomCode();
    const isNetwork = mode === 'network';
    const roles = isNetwork ? ROLES_NETWORK : ROLES_LINEAR;
    
    const playersObj = {};
    roles.forEach(r => playersObj[r] = null);

    const nodesObj = {};
    if (isNetwork) {
      ROLES_NETWORK.forEach(r => nodesObj[r] = initialNodeState(r));
    }

    rooms[roomCode] = {
      hostId: socket.id,
      mode: isNetwork ? 'network' : 'linear',
      players: playersObj,
      playerNames: {},
      round: 0,
      maxRounds: isNetwork ? 10 : 4,
      gameState: 'waiting', 
      
      currentTurn: 'Customer', 
      history: [],
      
      networkSubmissions: {}, 
      nodes: isNetwork ? nodesObj : null,
      timerId: null
    };
    
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, mode: rooms[roomCode].mode, topology: NETWORK_TOPOLOGY });
  });

  socket.on('joinRoom', ({ roomCode, role, playerName }) => {
    roomCode = (roomCode || '').toUpperCase();
    const room = rooms[roomCode];

    if (!room) return socket.emit('error', 'Room not found.');
    if (room.gameState !== 'waiting') return socket.emit('error', 'Game has already started.');

    const roles = room.mode === 'network' ? ROLES_NETWORK : ROLES_LINEAR;
    if (!roles.includes(role)) return socket.emit('error', 'Invalid role for this game mode.');
    if (room.players[role] !== null) return socket.emit('error', `Role ${role} is already taken.`);

    room.players[role] = socket.id;
    room.playerNames[role] = playerName || role;
    socket.join(roomCode);

    socket.emit('joined', { role, roomCode, mode: room.mode, topology: NETWORK_TOPOLOGY, parents: NETWORK_TOPOLOGY[role] });
    io.to(room.hostId).emit('playerJoined', { role, playerName: room.playerNames[role] });
  });

  function startNetworkTimer(room, roomCode) {
    if (room.timerId) clearTimeout(room.timerId);
    
    io.to(roomCode).emit('timerStart', { duration: 40 });
    
    room.timerId = setTimeout(() => {
      autoSubmitMissing(roomCode);
    }, 40000);
  }

  socket.on('startGame', (roomCode) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      room.gameState = 'in_progress';
      room.round = 1;
      
      if (room.mode === 'linear') {
        room.currentTurn = 'Customer';
        room.history.push({});
        io.to(roomCode).emit('gameStarted', { round: room.round, mode: 'linear' });
        io.to(roomCode).emit('turnUpdate', { turn: 'Customer', message: 'Menunggu Host memasukkan Customer Demand' });
      } else {
        room.networkSubmissions = {};
        io.to(roomCode).emit('gameStarted', { round: room.round, mode: 'network' });
        io.to(roomCode).emit('turnUpdateNetwork', { round: room.round });
        startNetworkTimer(room, roomCode);
      }
    }
  });

  // --- LINEAR MODE SUBMIT ---
  socket.on('submitOrder', ({ roomCode, orderAmount }) => {
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'in_progress' || room.mode !== 'linear') return;

    orderAmount = parseInt(orderAmount);
    if (isNaN(orderAmount)) return;

    const roundIndex = room.round - 1;
    const currentHist = room.history[roundIndex];

    const roleOrder = ['Customer', 'Retailer', 'Wholesaler', 'Distributor', 'Factory'];
    const currentRoleIndex = roleOrder.indexOf(room.currentTurn);
    
    if (room.currentTurn === 'Customer' && socket.id !== room.hostId) return;
    if (room.currentTurn !== 'Customer' && socket.id !== room.players[room.currentTurn]) return;

    currentHist[room.currentTurn] = orderAmount;

    const nextRoleIndex = currentRoleIndex + 1;
    if (nextRoleIndex < roleOrder.length) {
      const nextRole = roleOrder[nextRoleIndex];
      room.currentTurn = nextRole;
      io.to(roomCode).emit('turnUpdate', { turn: nextRole });
      const nextSocketId = nextRole === 'Customer' ? room.hostId : room.players[nextRole];
      if (nextSocketId) {
        io.to(nextSocketId).emit('incomingOrder', { amount: orderAmount, from: roleOrder[currentRoleIndex] });
      }
    } else {
      room.currentTurn = 'RoundComplete';
      io.to(roomCode).emit('turnUpdate', { turn: 'RoundComplete' });
      io.to(room.hostId).emit('roundComplete', { round: room.round, data: currentHist });
    }
  });

  // --- NETWORK MODE SUBMIT ---
  socket.on('submitOrderNetwork', ({ roomCode, role, orderAmount, transportMode }) => {
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'in_progress' || room.mode !== 'network') return;

    if (role === 'Host') {
      if (socket.id !== room.hostId) return;
      room.networkSubmissions[role] = { 
        c1: parseInt(orderAmount.c1) || 0, 
        c2: parseInt(orderAmount.c2) || 0,
        c3: parseInt(orderAmount.c3) || 0,
        c4: parseInt(orderAmount.c4) || 0
      };
    } else {
      if (socket.id !== room.players[role]) return;
      
      // Clean up object payload
      const cleanedAmount = {};
      NETWORK_TOPOLOGY[role].forEach(p => {
        cleanedAmount[p] = parseInt(orderAmount[p]) || 0;
      });

      room.networkSubmissions[role] = { orderAmount: cleanedAmount, transportMode: transportMode || 'Regular' };
      io.to(room.hostId).emit('playerSubmitted', { role });
    }

    const requiredRoles = ['Host', ...ROLES_NETWORK];
    const allSubmitted = requiredRoles.every(r => room.networkSubmissions[r] !== undefined);

    if (allSubmitted) {
      if (room.timerId) clearTimeout(room.timerId);
      processNetworkRound(room, roomCode);
    }
  });

  function autoSubmitMissing(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'in_progress' || room.mode !== 'network') return;

    const requiredRoles = ['Host', ...ROLES_NETWORK];
    requiredRoles.forEach(r => {
      if (!room.networkSubmissions[r]) {
        if (r === 'Host') {
          room.networkSubmissions[r] = { c1: 0, c2: 0, c3: 0, c4: 0 };
        } else {
          const parents = NETWORK_TOPOLOGY[r];
          const orderAmount = {};
          parents.forEach(p => orderAmount[p] = 0);
          room.networkSubmissions[r] = { orderAmount, transportMode: 'Regular' };
          io.to(room.hostId).emit('playerSubmitted', { role: r, auto: true });
        }
      }
    });
    
    processNetworkRound(room, roomCode);
  }

  function processNetworkRound(room, roomCode) {
    const subs = room.networkSubmissions;
    const nodes = room.nodes;

    const customerDemands = {
      'Customer 1': subs['Host'].c1 || 0,
      'Customer 2': subs['Host'].c2 || 0,
      'Customer 3': subs['Host'].c3 || 0,
      'Customer 4': subs['Host'].c4 || 0,
    };

    const nodeRequests = {};
    ['Warehouse 1', 'Warehouse 2', 'Warehouse 3', 'Wholesale 1', 'Wholesale 2', 'Factory'].forEach(n => nodeRequests[n] = {});

    ROLES_NETWORK.forEach(child => {
      const parents = NETWORK_TOPOLOGY[child];
      if (parents[0] !== 'Raw Material') {
        parents.forEach(parent => {
          nodeRequests[parent][child] = subs[child].orderAmount[parent] || 0;
        });
      }
    });

    const flowLevels = [
      ['Factory'],
      ['Wholesale 1', 'Wholesale 2'],
      ['Warehouse 1', 'Warehouse 2', 'Warehouse 3'],
      ['Retailer 1', 'Retailer 2', 'Retailer 3', 'Retailer 4']
    ];

    flowLevels.forEach(level => {
      level.forEach(nodeName => {
        const node = nodes[nodeName];
        
        let childrenDemands = {};
        if (nodeName.startsWith('Retailer')) {
          const rNum = nodeName.split(' ')[1];
          const cName = `Customer ${rNum}`;
          childrenDemands[cName] = customerDemands[cName];
        } else {
          childrenDemands = nodeRequests[nodeName];
        }

        let totalRequested = 0;
        Object.keys(childrenDemands).forEach(child => {
          totalRequested += childrenDemands[child] + (node.backlog[child] || 0);
        });

        if (totalRequested === 0) return;

        if (node.inventory >= totalRequested) {
          Object.keys(childrenDemands).forEach(child => {
            const toShip = childrenDemands[child] + (node.backlog[child] || 0);
            node.inventory -= toShip;
            node.backlog[child] = 0;

            if (!child.startsWith('Customer')) {
              const childMode = subs[child].transportMode;
              const leadTime = childMode === 'Express' ? 1 : 2;
              nodes[child].inboundShipments.push({ arriveAt: room.round + leadTime, amount: toShip });
              
              const transportCost = childMode === 'Express' ? 3 * toShip : 1 * toShip;
              nodes[child].cost += transportCost;
            }
          });
        } else {
          let remainingInventory = node.inventory;
          const shipAmounts = {};

          Object.keys(childrenDemands).forEach(child => {
            const req = childrenDemands[child] + (node.backlog[child] || 0);
            if (totalRequested > 0) {
              const ratio = req / totalRequested;
              const allocated = Math.floor(node.inventory * ratio);
              shipAmounts[child] = allocated;
              remainingInventory -= allocated;
            } else {
              shipAmounts[child] = 0;
            }
          });

          const childrenKeys = Object.keys(childrenDemands).filter(c => (childrenDemands[c] + (node.backlog[c]||0)) > shipAmounts[c]);
          let i = 0;
          while (remainingInventory > 0 && childrenKeys.length > 0) {
            shipAmounts[childrenKeys[i % childrenKeys.length]] += 1;
            remainingInventory -= 1;
            i++;
          }

          Object.keys(childrenDemands).forEach(child => {
            const req = childrenDemands[child] + (node.backlog[child] || 0);
            const shipped = shipAmounts[child] || 0;
            
            node.inventory -= shipped;
            node.backlog[child] = req - shipped;

            if (!child.startsWith('Customer') && shipped > 0) {
              const childMode = subs[child].transportMode;
              const leadTime = childMode === 'Express' ? 1 : 2;
              nodes[child].inboundShipments.push({ arriveAt: room.round + leadTime, amount: shipped });
              
              const transportCost = childMode === 'Express' ? 3 * shipped : 1 * shipped;
              nodes[child].cost += transportCost;
            }
          });
          
          node.inventory = Math.max(0, node.inventory);
        }
      });
    });

    const factoryOrder = subs['Factory'].orderAmount['Raw Material'] || 0;
    const fMode = subs['Factory'].transportMode;
    const fLeadTime = fMode === 'Express' ? 1 : 2;
    nodes['Factory'].inboundShipments.push({ arriveAt: room.round + fLeadTime, amount: factoryOrder });
    nodes['Factory'].cost += (fMode === 'Express' ? 3 * factoryOrder : 1 * factoryOrder);

    Object.keys(nodes).forEach(role => {
      const node = nodes[role];
      let arrived = 0;
      node.inboundShipments = node.inboundShipments.filter(s => {
        if (s.arriveAt <= room.round) {
          arrived += s.amount;
          return false;
        }
        return true;
      });
      node.inventory += arrived;

      let totalBacklog = 0;
      Object.values(node.backlog).forEach(v => totalBacklog += v);

      node.cost += (node.inventory * 1);
      node.cost += (totalBacklog * 2);

      node.history.push({
        inventory: node.inventory,
        totalBacklog: totalBacklog,
        cost: node.cost,
        orderPlaced: subs[role].orderAmount,
        arrived: arrived,
        transportMode: subs[role].transportMode
      });
    });

    room.currentTurn = 'RoundComplete';
    io.to(roomCode).emit('networkRoundComplete', { 
      round: room.round, 
      nodes: room.nodes,
      historyLength: nodes['Retailer 1'].history.length
    });
  }

  socket.on('nextRound', (roomCode) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id && room.currentTurn === 'RoundComplete') {
      if (room.round >= room.maxRounds) {
        room.gameState = 'finished';
        io.to(roomCode).emit('gameFinished', { history: room.history, nodes: room.nodes, mode: room.mode });
      } else {
        room.round++;
        if (room.mode === 'linear') {
          room.currentTurn = 'Customer';
          room.history.push({});
          io.to(roomCode).emit('newRound', { round: room.round, mode: 'linear' });
          io.to(roomCode).emit('turnUpdate', { turn: 'Customer' });
        } else {
          room.currentTurn = 'Waiting';
          room.networkSubmissions = {};
          io.to(roomCode).emit('newRound', { round: room.round, mode: 'network' });
          io.to(roomCode).emit('turnUpdateNetwork', { round: room.round });
          startNetworkTimer(room, roomCode);
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
