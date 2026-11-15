const $ = (id) => document.getElementById(id);
const SCREENS = ['loading', 'menu', 'tutorial', 'pause', 'results', 'online', 'lobby'];
const RADAR_RANGE = 600;

const fmt = (x, n = 0) => (Number.isFinite(x) ? x.toFixed(n) : '∞');
const signed = (x, n = 0) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(n);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const kv = (label, value, cls = '') => `<div class="kv ${cls}"><span>${label}</span><b>${value}</b></div>`;
const roles = [{ name: 'Jet pilot', blurb: 'Fly, dodge flak and drop free-fall bombs.' }, { name: 'Ground anti-air', blurb: 'Drive a pickup. Aim a swivelling gun at aircraft.' }];
const mapItem = (m) => `<img class="map-preview" src="${m.preview}" alt="${m.name} preview"><span class="name">${m.name}</span><span class="blurb">${m.blurb}</span>`;
const roleItem = (r) => `<span class="name">${r.name}</span><span class="blurb">${r.blurb}</span>`;

export class Hud {
  constructor() {
    this.radar = $('radar');
    this.rctx = this.radar.getContext('2d');
    this.physPanel = $('physics');
    this.physBody = $('physics-body');
    this.bombsKey = '';
    this.labels = new Map();
    if (matchMedia('(max-width: 520px)').matches) this.physPanel.classList.add('collapsed');
    $('physics-toggle').addEventListener('click', () => this.togglePhysics());
  }

  show(id) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
    $('hud').classList.toggle('hidden', !(id === 'hud' || id === 'pause'));
  }

  togglePhysics() {
    this.physPanel.classList.toggle('collapsed');
  }

  setLoading(p) {
    $('load-bar').style.width = `${Math.round(p * 100)}%`;
  }

  showError(text) {
    const e = $('load-error');
    e.textContent = text;
    e.classList.remove('hidden');
  }

  message(text, kind = 'info', seconds = 3.2) {
    const box = $('messages');
    const p = document.createElement('p');
    p.className = `msg ${kind}`;
    p.textContent = text;
    box.appendChild(p);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => p.classList.add('out'), seconds * 1000);
    setTimeout(() => p.remove(), seconds * 1000 + 600);
  }

  clearMessages() {
    $('messages').replaceChildren();
  }

  flash() {
    const d = $('damage');
    d.classList.remove('on');
    void d.offsetWidth;
    d.classList.add('on');
  }

  setBombs(total, left) {
    const key = `${total}/${left}`;
    if (key === this.bombsKey) return;
    this.bombsKey = key;
    let html = '';
    for (let i = 0; i < total; i++) html += `<span class="bomb ${i < left ? '' : 'used'}"></span>`;
    $('h-bombs').innerHTML = html;
    $('h-bombs').setAttribute('aria-label', `${left} of ${total} bombs left`);
  }

  updateFlight(d) {
    $('h-speed').textContent = fmt(d.speed);
    $('h-kmh').textContent = `${fmt(d.speed * 3.6)} km/h`;
    $('h-agl').textContent = `${fmt(d.agl)} m`;
    $('h-asl').textContent = `${fmt(d.asl)} m`;
    $('h-throttle').style.width = `${Math.round(d.throttle * 100)}%`;
    $('h-trucks').textContent = `${d.trucksLeft} / ${d.trucksTotal}`;
    const h = $('h-health');
    h.style.width = `${Math.max(0, d.health)}%`;
    h.classList.toggle('low', d.health <= 40);
    $('h-wind-row').classList.toggle('hidden', !d.wind);
    if (d.wind) {
      $('h-wind').textContent = `${d.wind.toFixed(1)} m/s²`;
      $('h-wind-arrow').style.transform = `rotate(${d.windRel}rad)`;
    }
    $('autoturn').classList.toggle('hidden', !d.autoTurn);
    const banner = d.respawn || d.pad;
    $('banner').classList.toggle('hidden', !banner);
    if (banner) {
      $('banner').textContent = banner;
      $('banner').classList.toggle('good', Boolean(d.pad && !d.respawn));
    }
  }

  renderPhysics(d, countdown) {
    if (this.physPanel.classList.contains('collapsed')) return;
    const bank = Math.abs(d.bankDeg) < 1 ? 'level' : `${fmt(Math.abs(d.bankDeg))}° ${d.bankDeg > 0 ? 'right' : 'left'}`;
    let html = `<h4>Manoeuvring</h4>
      ${kv('Speed v', `${fmt(d.speed, 1)} m/s`)}
      ${kv('Bank angle φ', bank)}
      ${kv('Turn rate ω = g·tan φ / v', `${fmt(d.turnRateDeg, 1)} °/s`)}
      ${kv('Turn radius r = v² / (g·tan φ)', d.radius > 5000 ? 'straight' : `${fmt(d.radius)} m`)}
      ${kv('Load factor n = 1 / cos φ', `${fmt(d.load, 2)} g`)}
      ${kv('Pitch θ', `${signed(d.pitchDeg)}°`)}
      ${kv('Climb rate v<sub>y</sub> = v·sin θ', `${signed(d.vy, 1)} m/s`)}`;

    html += '<h4>Free fall if you drop now</h4>';
    if (d.fall) {
      const f = d.fall;
      html += `
        ${kv('Drop height h', `${fmt(f.h)} m`)}
        ${kv('Forward speed v<sub>h</sub>', `${fmt(d.vh, 1)} m/s`)}
        ${kv('Fall time t = (v<sub>y</sub> + √(v<sub>y</sub>² + 2gh)) / g', `${fmt(f.formulaT, 2)} s`)}
        ${kv('Throw distance d = v<sub>h</sub>·t', `${fmt(f.throw)} m`)}
        ${f.drift > 0.5 ? kv('Wind drift ½·a·t²', `${fmt(f.drift)} m`) : ''}
        ${kv('Impact speed', `${fmt(f.impactSpeed)} m/s`)}`;
    } else {
      html += '<p class="muted">No bomb to drop.</p>';
    }

    html += '<h4>Nearest truck</h4>';
    if (d.target) {
      const t = d.target;
      const side = Math.abs(t.lat) < 1 ? 'dead ahead' : `${fmt(Math.abs(t.lat))} m ${t.lat > 0 ? 'right' : 'left'}`;
      html += kv('Position', `${fmt(Math.abs(t.along))} m ${t.along >= 0 ? 'ahead' : 'behind'}, ${side}`);
      if (d.fall && t.along > 0) {
        const steer = Math.abs(t.steer) < 2 ? 'lined up' : `steer ${fmt(Math.abs(t.steer))} m ${t.steer > 0 ? 'right' : 'left'}`;
        const window = countdown && t.inWindow;
        if (t.drive > 1) html += kv('Truck drives while it falls', `${fmt(t.drive)} m`);
        html += kv('Release in = distance − throw', t.releaseIn > 0 ? `${fmt(t.releaseIn)} m · ${fmt(t.releaseSec, 1)} s` : `${fmt(-t.releaseIn)} m too late`, window ? 'go' : '');
        html += kv('Line-up', steer, window ? 'go' : '');
        if (window) html += '<p class="go-banner">DROP NOW</p>';
      }
    } else {
      html += '<p class="muted">All trucks are gone.</p>';
    }

    if (d.last) {
      const l = d.last;
      html += '<h4>Last bomb</h4>';
      if (l.falling) {
        html += `
          ${kv('Time falling', `${fmt(l.t, 1)} s of ${fmt(l.predT, 1)} s`)}
          ${kv('Height fallen ½·g·t² + …', `${fmt(l.fallen)} m`)}
          ${kv('Forward travel', `${fmt(l.travel)} m`)}
          ${kv('Speed now', `${fmt(l.speed)} m/s`)}`;
      } else {
        html += `
          ${kv('Flight time', `${fmt(l.t, 2)} s`)}
          ${kv('Forward travel', `${fmt(l.travel)} m`)}
          ${kv('Result', l.result, l.hit ? 'go' : 'bad')}`;
      }
    }
    this.physBody.innerHTML = html;
  }

  drawRadar(jet, trucks, bombs, impact, land, others = []) {
    const c = this.rctx;
    const W = this.radar.width;
    const C = W / 2;
    const R = C - 4;
    const s = R / RADAR_RANGE;
    const y = jet.yaw;
    const M00 = -Math.cos(y), M01 = Math.sin(y), M10 = -Math.sin(y), M11 = -Math.cos(y);
    const jx = jet.position.x, jz = jet.position.z;
    const toRadar = (x, z) => {
      const dx = x - jx, dz = z - jz;
      return [C + s * (M00 * dx + M01 * dz), C + s * (M10 * dx + M11 * dz)];
    };

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, W);
    c.save();
    c.beginPath();
    c.arc(C, C, R, 0, Math.PI * 2);
    c.fillStyle = 'rgba(25, 90, 150, 0.75)';
    c.fill();
    c.clip();

    const cell = land.cell;
    c.setTransform(
      s * M00 * cell, s * M10 * cell, s * M01 * cell, s * M11 * cell,
      C + s * (M00 * (land.x0 - jx) + M01 * (land.z0 - jz)),
      C + s * (M10 * (land.x0 - jx) + M11 * (land.z0 - jz)),
    );
    c.drawImage(land.canvas, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);

    c.strokeStyle = 'rgba(255,255,255,0.25)';
    c.lineWidth = 2;
    for (const r of [0.33, 0.66]) {
      c.beginPath();
      c.arc(C, C, R * r, 0, Math.PI * 2);
      c.stroke();
    }

    for (const t of trucks) {
      const [x, z] = toRadar(t.pos.x, t.pos.z);
      c.beginPath();
      c.arc(x, z, t.alive ? 7 : 4, 0, Math.PI * 2);
      c.fillStyle = t.alive ? (t.alert ? '#ff3b3b' : '#ff8a3b') : 'rgba(40,40,40,0.8)';
      c.fill();
      if (t.alive) {
        c.strokeStyle = '#fff';
        c.lineWidth = 2;
        c.stroke();
      }
    }
    for (const b of bombs) {
      if (!b.falling) continue;
      const [x, z] = toRadar(b.p.x, b.p.z);
      c.fillStyle = '#ffe066';
      c.fillRect(x - 3, z - 3, 6, 6);
    }
    for (const o of others) {
      const [x, z] = toRadar(o.x, o.z);
      c.save();
      c.translate(x, z);
      c.rotate(o.yaw - y);
      c.fillStyle = o.color;
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, -10);
      c.lineTo(-7, 7);
      c.lineTo(7, 7);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }
    if (impact) {
      const [x, z] = toRadar(impact.x, impact.z);
      c.strokeStyle = '#ffe066';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(x, z, 8, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();

    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(C, C - 12);
    c.lineTo(C - 8, C + 9);
    c.lineTo(C + 8, C + 9);
    c.closePath();
    c.fill();
  }

  setPip(rect) {
    const f = $('pip-frame');
    if (!rect) {
      f.classList.add('hidden');
      return;
    }
    f.classList.remove('hidden');
    Object.assign(f.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }

  // ---------- menus ----------

  /** Fills a .choices grid with buttons and calls onPick(index) on click. */
  choiceList(el, items, render, onPick) {
    el.innerHTML = items
      .map((it, i) => `<button type="button" class="choice" data-i="${i}" aria-pressed="false">${render(it, i)}</button>`)
      .join('');
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => onPick(Number(b.dataset.i))));
  }

  selectIn(el, index, locked = false) {
    el.querySelectorAll('button').forEach((b) => {
      const on = Number(b.dataset.i) === index;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = locked;
    });
  }

  buildMenu({ jets, maps, levels, difficulties, settings, best }, handlers) {
    this.levels = levels;
    this.choiceList($('map-list'), maps, mapItem, handlers.map);
    this.choiceList($('role-list'), roles, roleItem, handlers.role);
    const jetItem = (j) => `<span class="swatch" style="background:${j.color}"></span>
      <span class="name">${j.name}</span><span class="blurb">${j.blurb}</span>`;
    this.choiceList($('jet-list'), jets, jetItem, handlers.jet);
    this.choiceList($('level-list'), levels, (l, i) => `<span class="name">Level ${l.n}</span>
      <span class="blurb">${l.trucks} trucks · ${l.bombs} bombs</span>
      <span class="blurb">${l.note}</span>
      <span class="best" data-best="${i}">Best: ${best(i)}</span>`, handlers.level);
    this.choiceList($('diff-list'), difficulties, (d) => `<span class="name">${d.name}</span><span class="blurb">${d.blurb}</span>`, handlers.difficulty);
    this.jetItem = jetItem;
    this.syncMenu(settings, best);
  }

  syncMenu(settings, best) {
    this.selectIn($('map-list'), settings.map === 'large' ? 1 : 0);
    this.selectIn($('role-list'), settings.role === 'aa' ? 1 : 0);
    $('role-help').textContent = settings.role === 'aa' ? 'Solo defence: stop 6 AI raiders in 3 minutes. W/S drive, A/D steer, mouse or arrows aim, Space/click fire, R reload, C gunner sight. Touch: left stick drives, right stick aims.' : 'Fly solo or join friends online. Pass low over the runway to reload and repair.';
    $('btn-fly').textContent = settings.role === 'aa' ? 'Defend solo!' : 'Fly solo!';
    $('jet-list').classList.toggle('hidden', settings.role === 'aa');
    $('jet-list').previousElementSibling.classList.toggle('hidden', settings.role === 'aa');
    $('level-list').querySelectorAll('.blurb').forEach((el) => {
      const button = el.closest('button'), i = Number(button.dataset.i);
      if (el === button.querySelector('.blurb')) {
        const n = settings.map === 'large' ? [20, 24, 28][i] : this.levels[i].trucks;
        el.textContent = settings.role === 'aa' ? `${n} allied vehicles · 3 attacking aircraft` : `${n} trucks · ${settings.map === 'large' ? n + 4 : this.levels[i].bombs} bombs`;
      }
    });
    this.selectIn($('jet-list'), settings.jetIndex);
    this.selectIn($('level-list'), settings.level);
    this.selectIn($('diff-list'), settings.difficulty);
    document.querySelectorAll('[data-best]').forEach((el) => { el.textContent = `Best: ${best(Number(el.dataset.best))}`; });
  }

  // ---------- online ----------

  setOnline({ name = '', code = '' }) {
    $('player-name').value = name;
    $('join-code').value = code;
    $('online-error').classList.add('hidden');
    this.onlineBusy(null);
  }

  onlineForm() {
    return { name: $('player-name').value.trim().slice(0, 14), code: $('join-code').value.trim() };
  }

  onlineError(text) {
    const e = $('online-error');
    e.textContent = text;
    e.classList.remove('hidden');
  }

  /** Spinner on whichever button is working; both are disabled while either runs. */
  onlineBusy(which) {
    for (const [id, key, label] of [['btn-create', 'create', 'Create a room'], ['btn-join', 'join', 'Join']]) {
      const b = $(id);
      b.disabled = Boolean(which);
      b.classList.toggle('loading', which === key);
      b.textContent = which === key ? (key === 'join' ? 'Joining…' : 'Creating…') : label;
    }
    if (which) $('online-error').classList.add('hidden');
  }

  buildLobby({ jets, maps, modes, levels, difficulties }, handlers) {
    this.choiceList($('lobby-maps'), maps, mapItem, handlers.map);
    this.choiceList($('lobby-roles'), roles, roleItem, handlers.role);
    this.choiceList($('lobby-jets'), jets, this.jetItem, handlers.jet);
    this.choiceList($('lobby-modes'), modes, (m) => `<span class="name">${m.name}</span><span class="blurb">${m.blurb}</span>`, handlers.mode);
    this.choiceList($('lobby-levels'), levels, (l) => `<span class="name">Level ${l.n}</span><span class="blurb">${l.trucks} trucks · ${l.bombs} bombs</span>`, handlers.level);
    this.choiceList($('lobby-diffs'), difficulties, (d) => `<span class="name">${d.name}</span>`, handlers.difficulty);
    this.jetColors = jets.map((j) => j.color);
    this.jetNames = jets.map((j) => j.name);
  }

  renderLobby(l) {
    $('lobby-code').textContent = l.code;
    $('lobby-link').textContent = l.link;
    $('lobby-players').innerHTML = l.players
      .map((p) => `<li><span class="swatch" style="background:${this.jetColors[p.jet]}"></span>
        <b>${esc(p.name)}</b>${p.id === l.myId ? ' (you)' : ''}${p.host ? ' <span class="tag-host">host</span>' : ''}
        <span class="muted">${p.role === 'aa' ? 'Ground anti-air' : this.jetNames[p.jet]}</span></li>`)
      .join('');
    this.selectIn($('lobby-jets'), l.myJet);
    this.selectIn($('lobby-maps'), l.map === 'large' ? 1 : 0, !l.isHost);
    this.selectIn($('lobby-roles'), l.myRole === 'aa' ? 1 : 0);
    $('lobby-jets').classList.toggle('hidden', l.myRole === 'aa');
    $('lobby-jets').previousElementSibling.classList.toggle('hidden', l.myRole === 'aa');
    const ground = l.players.filter((p) => p.role === 'aa').length;
    $('lobby-role-note').textContent = ground === l.players.length ? 'Ground defence: work together to shoot down 6 AI raiders. Everyone can drive and aim independently.' : ground ? 'Air vs ground: jets bomb ground vehicles; gunners shoot down jets. Team with the most kills after 5 minutes wins.' : 'Jet-only room: the host chooses co-op or bomb race.';
    $('lobby-modes').classList.toggle('hidden', ground > 0);
    $('lobby-levels').querySelectorAll('.blurb').forEach((el, i) => { const n = l.map === 'large' ? [20, 24, 28][i] : this.levels[i].trucks; el.textContent = `${n} vehicles · ${l.map === 'large' ? n + 4 : this.levels[i].bombs} bombs`; });
    this.selectIn($('lobby-modes'), l.mode, !l.isHost);
    this.selectIn($('lobby-levels'), l.level, !l.isHost);
    this.selectIn($('lobby-diffs'), l.difficulty, !l.isHost);
    $('btn-lobby-start').classList.toggle('hidden', !l.isHost);
    $('lobby-wait').classList.toggle('hidden', l.isHost);
    $('btn-lobby-start').textContent = `Start with ${l.players.length} ${l.players.length === 1 ? 'player' : 'players'}`;
  }

  lobbyNote(text) {
    $('lobby-note').textContent = text;
  }

  setOnlineHud(on) {
    $('board').classList.toggle('hidden', !on);
  }

  setRole(role, mode) {
    const ground = role === 'aa';
    $('h-trucks').previousElementSibling.textContent = ground ? 'Allied AI vehicles' : 'AI vehicles left';
    $('physics').classList.toggle('hidden', ground);
    $('gun-sight').classList.toggle('hidden', !ground);
    $('ground-status').classList.toggle('hidden', !ground);
    $('aim-controls').classList.toggle('hidden', !ground || matchMedia('(pointer: coarse)').matches);
    $('aim-stick').classList.toggle('hidden', !ground);
    $('t-bomb').textContent = ground ? 'FIRE' : 'BOMB';
    $('t-bomb').setAttribute('aria-label', ground ? 'Fire anti-air gun' : 'Drop bomb');
    $('hint').textContent = ground ? 'W/S drive · A/D steer · Captured mouse / arrows aim · Space / click fire · R reload · C precision sight · F fullscreen · Esc release' : 'A/D turn · W/S pitch · Shift/E faster · Q slower · Space bomb · C bomb cam · H physics · P pause';
    this.bombsKey = '';
    if (mode === 'defence') $('board').classList.remove('hidden');
  }

  updateGround(actor, session) {
    const kills = [...session.players.values()].filter((p) => p.role === 'aa' && !p.ai).reduce((n, p) => n + p.stats.kills, 0);
    $('h-bombs').textContent = actor.reload > 0 ? `Reloading ${Math.max(0, actor.reload).toFixed(1)} s` : `${actor.rounds} / 30 rounds`;
    $('ground-status').textContent = `${session.mode === 'defence' ? `Raiders down ${kills} / 6 · ` : ''}Gun elevation ${Math.round(actor.gunPitch * 180 / Math.PI)}° · ${actor.reload > 0 ? 'Reloading' : 'Hold fire to shoot'}`;
  }

  setPauseText(online) {
    $('pause-text').textContent = online
      ? 'The game keeps going online, and your jet flies straight while this is open.'
      : 'Your jet is hovering. Physically impossible, but we allowed it.';
    $('btn-quit').textContent = online ? 'Leave game' : 'Quit to menu';
  }

  setBoard({ timeLeft, rows }) {
    const m = Math.max(0, Math.floor(timeLeft / 60));
    const sec = Math.max(0, Math.floor(timeLeft % 60));
    $('board-time').textContent = `${m}:${String(sec).padStart(2, '0')}`;
    $('board-time').classList.toggle('low', timeLeft < 30);
    $('board-rows').innerHTML = rows
      .map((r) => `<li class="${r.alive ? '' : 'down'}"><span class="swatch" style="background:${r.color}"></span>${esc(r.name)}<b>${r.kills}</b></li>`)
      .join('');
  }

  /** The countdown bar: when to let go for the nearest truck, if you hold this line. */
  setRelease(t) {
    const el = $('release');
    if (!t) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const late = !t.inWindow && t.releaseIn < 0;
    const now = t.inWindow;
    el.classList.toggle('go', now);
    el.classList.toggle('late', late);
    const steer = Math.abs(t.steer) < 5 ? '' : ` · steer ${Math.abs(t.steer).toFixed(0)} m ${t.steer > 0 ? 'right' : 'left'}`;
    $('release-text').textContent = now ? 'DROP NOW!' : late ? 'Too late. Go around.' : `Release in ${Math.max(0, t.releaseSec).toFixed(1)} s${steer}`;
    $('release-fill').style.width = `${Math.round(100 * Math.min(1, Math.max(0, 1 - t.releaseSec / 6)))}%`;
  }

  // ---------- name tags over other jets ----------

  addLabel(id, name, color) {
    const el = document.createElement('div');
    el.className = 'label';
    el.style.borderColor = color;
    el.textContent = name;
    $('labels').appendChild(el);
    this.labels.set(id, el);
  }

  removeLabel(id) {
    this.labels.get(id)?.remove();
    this.labels.delete(id);
  }

  clearLabels() {
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
  }

  placeLabel(id, at) {
    const el = this.labels.get(id);
    if (!el) return;
    el.classList.toggle('hidden', !at);
    if (at) el.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -100%)`;
  }

  // ---------- results ----------

  showResults(r) {
    $('res-title').textContent = r.title;
    $('res-sub').textContent = r.subtitle;
    if (r.online) {
      $('res-lines').innerHTML =
        `<table class="scores"><tr><th>Pilot</th><th>Trucks</th><th>Crashes</th><th>Accuracy</th><th>Score</th></tr>${r.rows
          .map((p) => `<tr class="${p.id === r.myId ? 'me' : ''}"><td><span class="swatch" style="background:${p.color}"></span>${esc(p.name)}</td>
            <td>${p.kills}</td><td>${p.deaths}</td><td>${p.accuracy}%</td><td><b>${p.score}</b></td></tr>`)
          .join('')}</table>` +
        (r.team !== null ? kv('Team score', r.team, 'total') : '') +
        `<p class="muted small">${r.note}</p>`;
      $('btn-again').textContent = 'Back to lobby';
      $('btn-again').classList.toggle('hidden', !r.isHost);
      $('res-wait').classList.toggle('hidden', r.isHost);
      $('btn-menu').textContent = 'Leave room';
      $('btn-next').classList.add('hidden');
    } else {
      $('res-lines').innerHTML =
        r.lines.map(([a, b]) => kv(a, b)).join('') +
        kv('Total', r.total, 'total') +
        kv('Best for this level', r.best + (r.newBest ? ' · new best!' : ''));
      $('btn-again').textContent = 'Fly again';
      $('btn-again').classList.remove('hidden');
      $('res-wait').classList.add('hidden');
      $('btn-menu').textContent = 'Menu';
      $('btn-next').classList.toggle('hidden', !r.canNext);
    }
    this.show('results');
  }
}
