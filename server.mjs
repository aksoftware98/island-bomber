// Static file server plus a tiny WebSocket room relay, with no dependencies: node server.mjs [port]
//
// Rooms: a browser sends {t:'create'} or {t:'join', code}. Every other message is forwarded to the
// rest of the room with `from` set to the sender's id. The room's creator is the host and runs the
// trucks; the server never simulates anything.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 5173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.wav': 'audio/wav',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root) || file.endsWith('server.mjs')) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

// ---------- WebSocket framing (RFC 6455, text frames only) ----------

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 64 * 1024;

function frame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (len < 126) head[1] = len;
  else if (len < 65536) { head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

class Socket {
  constructor(sock, onMessage, onClose) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.open = true;
    this.onMessage = onMessage;
    this.onClose = onClose;
    sock.setNoDelay(true);
    sock.on('data', (d) => this.receive(d));
    sock.on('close', () => this.closed());
    sock.on('error', () => this.closed());
  }

  send(obj) {
    if (this.open) this.sock.write(frame(1, Buffer.from(JSON.stringify(obj))));
  }

  close() {
    if (!this.open) return;
    this.sock.end(frame(8, Buffer.alloc(0)));
    this.closed();
  }

  closed() {
    if (!this.open) return;
    this.open = false;
    this.sock.destroy();
    this.onClose();
  }

  receive(data) {
    this.buf = Buffer.concat([this.buf, data]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      if (!masked || len > MAX_MESSAGE) return this.close();
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);

      if (opcode === 8) return this.close();
      if (opcode === 9) { this.sock.write(frame(10, payload)); continue; }
      if (opcode === 10) continue;
      if (opcode === 1 || opcode === 0) {
        this.parts.push(payload);
        if (!fin) continue;
        const text = Buffer.concat(this.parts).toString('utf8');
        this.parts = [];
        let msg;
        try { msg = JSON.parse(text); } catch { continue; }
        if (msg && typeof msg === 'object') this.onMessage(msg);
      }
    }
  }
}

// ---------- rooms ----------

const MAX_PLAYERS = 4;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const rooms = new Map();
let nextId = 1;

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    if (!rooms.has(c)) return c;
  }
}

const cleanName = (n, id) => (String(n ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14) || `Pilot ${id}`);

function roster(room) {
  return [...room.players.values()].map((p) => ({ id: p.id, name: p.name, host: p.id === room.hostId }));
}

function broadcast(room, msg, exceptId) {
  for (const p of room.players.values()) if (p.id !== exceptId) p.ws.send(msg);
}

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (new URL(req.url, 'http://x').pathname !== '/ws' || !key) {
    sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);

  const me = { id: nextId++, name: '', role: 'jet', room: null, ws: null };
  me.ws = new Socket(sock, (msg) => onMessage(me, msg), () => leave(me));
});

function onMessage(me, msg) {
  if (msg.t === 'create' && !me.room) {
    const code = newCode();
    const room = { code, hostId: me.id, players: new Map(), started: false };
    rooms.set(code, room);
    me.name = cleanName(msg.name, me.id);
    me.room = room;
    room.players.set(me.id, me);
    me.ws.send({ t: 'welcome', id: me.id, code, host: true, players: roster(room) });
    return;
  }
  if (msg.t === 'join' && !me.room) {
    const room = rooms.get(String(msg.code ?? '').toUpperCase().trim());
    if (!room) return me.ws.send({ t: 'error', text: 'No room with that code.' });
    if (room.started) return me.ws.send({ t: 'error', text: 'That game has already started.' });
    if (room.players.size >= MAX_PLAYERS) return me.ws.send({ t: 'error', text: 'That room is full.' });
    me.name = cleanName(msg.name, me.id);
    me.room = room;
    room.players.set(me.id, me);
    me.ws.send({ t: 'welcome', id: me.id, code: room.code, host: false, players: roster(room) });
    broadcast(room, { t: 'roster', players: roster(room) }, me.id);
    return;
  }
  const room = me.room;
  if (!room) return;
  const hostOnly = new Set(['trucks', 'fire', 'result', 'damage', 'bots', 'end']);
  if (hostOnly.has(msg.t) && me.id !== room.hostId) return;
  if (msg.t === 'role') {
    if (room.started) return;
    me.role = msg.role === 'aa' ? 'aa' : 'jet';
    msg.role = me.role;
  }
  if ((msg.t === 'aa-fire' || msg.t === 'aa-reload') && me.role !== 'aa') return;
  if (msg.t === 'drop') {
    if (me.role !== 'jet' && !(me.id === room.hostId && typeof msg.owner === 'number' && msg.owner < 0)) return;
    if (me.id !== room.hostId) delete msg.owner;
  }
  if (msg.t === 'start' || msg.t === 'lobby') {
    if (me.id !== room.hostId) return;
    room.started = msg.t === 'start';
  }
  msg.from = me.id;
  if (typeof msg.to === 'number') room.players.get(msg.to)?.ws.send(msg);
  else broadcast(room, msg, me.id);
}

function leave(me) {
  const room = me.room;
  if (!room) return;
  me.room = null;
  room.players.delete(me.id);
  if (me.id === room.hostId || room.players.size === 0) {
    broadcast(room, { t: 'closed', text: 'The host left, so the room closed.' });
    for (const p of room.players.values()) { p.room = null; p.ws.close(); }
    rooms.delete(room.code);
    return;
  }
  broadcast(room, { t: 'left', id: me.id, players: roster(room) });
}

server.listen(port, () => {
  console.log(`Island Bomber running at http://localhost:${port}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  Friends on the same network: http://${a.address}:${port}`);
    }
  }
});
