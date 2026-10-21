// M7mas Parkour — سيرفر الغرف (WebSocket relay)
// السيرفر ما يحسب شي في اللعب، بس يدير الغرف وكودها ويمرّر الرسائل بين اللاعبين.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 8;
const rooms = new Map(); // code -> { code, host, members: Map<id, ws> }

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end('M7mas Parkour server OK — rooms: ' + rooms.size);
});
const wss = new WebSocketServer({ server, maxPayload: 8192 });

const send = (w, m) => { if (w && w.readyState === 1) w.send(JSON.stringify(m)); };
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += ABC[Math.floor(Math.random() * ABC.length)];
    if (!rooms.has(c)) return c;
  }
}
let counter = 0;

wss.on('connection', (ws) => {
  ws.id = 'p' + (++counter).toString(36) + Math.random().toString(36).slice(2, 6);
  ws.room = null;
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'create' && !ws.room) {
      const code = newCode();
      const r = { code, host: ws, members: new Map([[ws.id, ws]]) };
      rooms.set(code, r);
      ws.room = r;
      send(ws, { t: 'created', code, id: ws.id });
    } else if (m.t === 'join' && !ws.room) {
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r) return send(ws, { t: 'err', m: 'ما لقينا روم بهذا الكود' });
      if (r.members.size >= MAX_PLAYERS) return send(ws, { t: 'err', m: 'الروم ممتلئ (الحد 8 لاعبين)' });
      r.members.set(ws.id, ws);
      ws.room = r;
      send(ws, { t: 'joined', code: r.code, id: ws.id });
      send(r.host, { t: 'peer-join', id: ws.id });
    } else if (m.t === 'tohost' && ws.room && ws !== ws.room.host) {
      send(ws.room.host, { t: 'data', from: ws.id, d: m.d });
    } else if (m.t === 'bcast' && ws.room && ws === ws.room.host) {
      for (const [id, w] of ws.room.members) {
        if (w !== ws && id !== m.except) send(w, { t: 'data', from: 'host', d: m.d });
      }
    }
    // m.t === 'ping' يتجاهل (بس يبقي الاتصال حي)
  });

  ws.on('close', () => {
    const r = ws.room;
    if (!r) return;
    r.members.delete(ws.id);
    if (r.host === ws) {
      for (const w of r.members.values()) { send(w, { t: 'closed' }); w.room = null; }
      rooms.delete(r.code);
    } else {
      send(r.host, { t: 'peer-leave', id: ws.id });
    }
  });
  ws.on('error', () => {});
});

// يقفل الاتصالات الميتة ويبقي Render صاحي أثناء اللعب
setInterval(() => {
  wss.clients.forEach((w) => {
    if (!w.alive) return w.terminate();
    w.alive = false;
    w.ping();
  });
}, 25000);

server.listen(PORT, () => console.log('M7mas Parkour server on :' + PORT));
