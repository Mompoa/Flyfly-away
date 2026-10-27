const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const INDEX = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  fs.readFile(INDEX, (err, data) => {
    if (err) { res.writeHead(500); return res.end('Error'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
let openRoom = null; // naghihintay na Quick Match
const WIN = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function check(b) {
  for (const [a, c, d] of WIN) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return { w: b[a], line: [a, c, d] };
  }
  return b.every(Boolean) ? { w: 'draw', line: null } : null;
}

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function broadcast(room) {
  for (const sym of ['X', 'O']) {
    send(room.players[sym], {
      type: 'state', code: room.code, you: sym, board: room.board, turn: room.turn,
      result: room.result, scores: room.scores, quick: !!room.quick, full: !!(room.players.X && room.players.O),
    });
  }
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  const other = room.players[ws.sym === 'X' ? 'O' : 'X'];
  send(other, { type: 'left' });
  if (other) other.room = null;
  rooms.delete(room.code);
  if (openRoom === room) openRoom = null;
}

function createRoom(ws, quick) {
  const room = {
    code: makeCode(), players: { X: ws, O: null }, board: Array(9).fill(null),
    turn: 'X', starter: 'X', result: null, scores: { X: 0, O: 0, draw: 0 }, quick,
  };
  rooms.set(room.code, room);
  ws.room = room; ws.sym = 'X';
  return room;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'create') {
      leave(ws);
      broadcast(createRoom(ws, false));
    }

    else if (m.type === 'quick') {
      leave(ws);
      const r = openRoom;
      if (r && rooms.get(r.code) === r && !r.players.O && r.players.X.readyState === 1) {
        r.players.O = ws; ws.room = r; ws.sym = 'O';
        openRoom = null;
        broadcast(r);
      } else {
        openRoom = createRoom(ws, true);
        broadcast(openRoom);
      }
    }

    else if (m.type === 'join') {
      const room = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!room) return send(ws, { type: 'error', msg: 'Walang room na may ganyang code.' });
      if (room.players.O) return send(ws, { type: 'error', msg: 'Puno na ang room.' });
      leave(ws);
      room.players.O = ws; ws.room = room; ws.sym = 'O';
      broadcast(room);
    }

    else if (m.type === 'move') {
      const room = ws.room;
      if (!room || room.result || !room.players.O) return;
      const i = m.i;
      if (!Number.isInteger(i) || i < 0 || i > 8) return;
      if (room.turn !== ws.sym || room.board[i]) return;
      room.board[i] = ws.sym;
      const r = check(room.board);
      if (r) {
        room.result = r;
        if (r.w === 'draw') room.scores.draw++; else room.scores[r.w]++;
      } else {
        room.turn = ws.sym === 'X' ? 'O' : 'X';
      }
      broadcast(room);
    }

    else if (m.type === 'rematch') {
      const room = ws.room;
      if (!room || !room.result) return;
      room.board = Array(9).fill(null);
      room.starter = room.starter === 'X' ? 'O' : 'X';
      room.turn = room.starter;
      room.result = null;
      broadcast(room);
    }
  });

  ws.on('close', () => leave(ws));
});

// Panatilihing buhay ang mga koneksyon (at linisin ang patay)
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, '0.0.0.0', () => console.log('XOX online sa port ' + PORT));
