/**
 * Thin client for the room relay in server.mjs. Messages are plain JSON objects with a `t` type.
 * The relay adds `from` (the sender's id) to everything it forwards.
 */
export class Net {
  constructor() {
    this.ws = null;
    this.id = 0;
    this.code = '';
    this.isHost = false;
    this.players = [];
    this.handlers = new Map();
  }

  on(type, fn) {
    this.handlers.set(type, fn);
    return this;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Opens the socket and creates (code empty) or joins a room. Resolves on welcome. */
  connect(name, code) {
    this.close();
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(url));
      let settled = false;
      const fail = (text) => {
        if (settled) return;
        settled = true;
        this.close();
        reject(new Error(text));
      };
      ws.onopen = () => ws.send(JSON.stringify(code ? { t: 'join', code, name } : { t: 'create', name }));
      ws.onerror = () => fail('Could not reach the game server. Is it running with node server.mjs?');
      ws.onclose = () => {
        if (!settled) return fail('The connection closed.');
        if (this.ws === ws) {
          this.ws = null;
          this.handlers.get('disconnect')?.({});
        }
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (!settled) {
          if (msg.t === 'error') return fail(msg.text);
          if (msg.t !== 'welcome') return;
          settled = true;
          this.id = msg.id;
          this.code = msg.code;
          this.isHost = msg.host;
          this.players = msg.players;
          resolve(this);
          return;
        }
        if (msg.t === 'roster' || msg.t === 'left') this.players = msg.players;
        this.handlers.get(msg.t)?.(msg);
      };
    });
  }

  send(msg) {
    if (this.connected) this.ws.send(JSON.stringify(msg));
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
  }

  nameOf(id) {
    return this.players.find((p) => p.id === id)?.name ?? `Pilot ${id}`;
  }
}
