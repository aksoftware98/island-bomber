import * as THREE from 'three';
import { loadAll, getModel, JETS, TRUCK_FILE } from './assets.js';
import { World, PAD, PAD_RADIUS, PAD_MAX_AGL } from './world.js';
import { Jet, MIN_SPEED, MAX_SPEED } from './jet.js';
import { Bomb, G, STEP, BLAST_RADIUS, NEAR_RADIUS, simulateFall } from './bomb.js';
import { Truck, Tracers, placeTrucks, LEVELS, DIFFICULTIES } from './enemy.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { clamp, deg, pick, store } from './util.js';
import { MAPS, levelForMap } from './maps.js';
import { GroundVehicle } from './ground.js';

const MSG = {
  start: ['Make every bomb count.', 'Gravity is on your side. Mostly.', 'Remember: bombs keep your speed.'],
  water: ['The fish are furious.', 'Splash! A crab has filed a complaint.', 'Great hit on the ocean. It did not notice.'],
  miss: ['Missed. The truck waves politely.', 'Close-ish. Physics remains undefeated.', 'That patch of grass had it coming.'],
  hit: ['Truck yeeted!', 'Direct hit. Newton approves.', 'Parabola perfection!', 'Boom. Textbook free fall.'],
  near: ['Scratched it! One more near miss finishes it.', 'Singed! That truck is smoking now.'],
  double: ['Two for one. Physics teacher is proud.', 'Double yeet!'],
  crash: ['The mountain did not move.', 'Ground: 1, you: 0.'],
  sea: ['Glug.', 'Submarine mode is not unlocked yet.'],
  shot: ['Shot down by a pickup truck. Embarrassing.'],
  nobombs: ['Out of bombs. Fly low over the green ring on the runway to reload.'],
  bounds: ['Wrong way, ace.'],
  hurt: ['Ouch! The paint!', 'Hey, that stings.', 'Flak! Jink, jink!'],
  smoking: ['Smoking a bit. The runway can patch you up.'],
  honk: ['HONK HONK! (angry truck noises)', 'The truck honks at you rudely.'],
  win: ['The trucks have been relocated. Upwards.', 'Isaac Newton sends his regards.'],
};
const IDLE = { turn: 0, pitch: 0, throttle: 0 };
const ONLINE_TIME = 300;
const RESPAWN_TIME = 4;
const MODES = [
  { id: 'coop', name: 'Co-op', blurb: 'Clear the island together. Team score.' },
  { id: 'race', name: 'Bomb race', blurb: 'Same trucks, most points wins.' },
];

// ---------- renderer and scene ----------

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 5000);
const pipCam = new THREE.PerspectiveCamera(50, 1.6, 0.5, 5000);
const isTouch = matchMedia('(pointer: coarse)').matches;

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const hud = new Hud();
const sfx = new Sfx();
const input = new Input();
const net = new Net();

let world, effects, tracers, radarLand;
let jets = [];
let jet;
let state = 'loading';
let session = null;
let camMode = 'chase';
let tutorialSeen = false;
const settings = {
  map: store.get('map', 'small') === 'large' ? 'large' : 'small',
  role: 'jet',
  jetIndex: clamp(store.get('jet', 0), 0, JETS.length - 1),
  level: 0,
  difficulty: clamp(store.get('difficulty', 1), 0, DIFFICULTIES.length - 1),
  name: store.get('name', ''),
};
const lobby = { picks: new Map(), roles: new Map(), map: settings.map, mode: 0, level: 0, difficulty: 1 };
const surfaceAt = (x, z) => world.surfaceAt(x, z);
const bestScore = (i) => store.get(`best-${settings.map}-${settings.role}-${i}-${DIFFICULTIES[settings.difficulty].id}`, 0);
const myId = () => (net.connected ? net.id : 0);
const online = () => Boolean(session?.online);
const isAuthority = () => !online() || net.isHost;
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const arr = (v, n = 2) => [+v.x.toFixed(n), +v.y.toFixed(n), +v.z.toFixed(n)];

// ---------- boot ----------

async function boot() {
  if (location.protocol === 'file:') {
    hud.showError('Open this game through a local web server (see README.md). Browsers block loading 3D models from file://.');
    return;
  }
  await Promise.all([loadAll((p) => hud.setLoading(p)), sfx.load()]);
  world = new World(scene, settings.map);
  effects = new Effects(scene, world);
  tracers = new Tracers(scene);
  radarLand = world.makeRadarImage();
  jets = JETS.map((j) => new Jet(getModel(j.file)));
  selectJet(settings.jetIndex);

  hud.buildMenu({ jets: JETS, maps: MAPS, levels: LEVELS, difficulties: DIFFICULTIES, settings, best: bestScore }, {
    map: (i) => { settings.map = MAPS[i].id; store.set('map', settings.map); chooseMap(settings.map); syncMenu(); },
    role: (i) => { settings.role = i ? 'aa' : 'jet'; syncMenu(); },
    jet: (i) => { sfx.init(); sfx.click(); selectJet(i); store.set('jet', i); syncMenu(); },
    level: (i) => { sfx.init(); sfx.click(); settings.level = i; syncMenu(); },
    difficulty: (i) => { sfx.init(); sfx.click(); settings.difficulty = i; store.set('difficulty', i); syncMenu(); },
  });
  hud.buildLobby({ jets: JETS, maps: MAPS, modes: MODES, levels: LEVELS, difficulties: DIFFICULTIES }, {
    map: (i) => { lobby.map = MAPS[i].id; chooseMap(lobby.map); sendLobby(); },
    role: (i) => { settings.role = i ? 'aa' : 'jet'; lobby.roles.set(net.id, settings.role); net.send({ t: 'role', role: settings.role }); renderLobby(); },
    jet: (i) => { sfx.click(); selectJet(i); store.set('jet', i); lobby.picks.set(net.id, i); net.send({ t: 'pick', jet: i }); renderLobby(); },
    mode: (i) => { sfx.click(); lobby.mode = i; sendLobby(); },
    level: (i) => { sfx.click(); lobby.level = i; sendLobby(); },
    difficulty: (i) => { sfx.click(); lobby.difficulty = i; sendLobby(); },
  });
  bindButtons();
  bindNet();
  if (isTouch) {
    document.getElementById('touch').classList.remove('hidden');
    document.getElementById('hint').classList.add('hidden');
    input.bindTouch();
  }
  const room = new URLSearchParams(location.search).get('room');
  if (room) {
    hud.setOnline({ name: settings.name, code: room.toUpperCase() });
    showScreen('online');
  } else {
    showMenu();
  }
  requestAnimationFrame(frame);
}

function bindButtons() {
  const on = (id, fn) => document.getElementById(id).addEventListener('click', () => { sfx.init(); sfx.click(); fn(); });
  on('btn-fly', () => (settings.role === 'aa' || tutorialSeen ? startSolo() : showTutorial()));
  on('btn-how', showTutorial);
  on('btn-online', () => { hud.setOnline({ name: settings.name }); showScreen('online'); });
  on('btn-tut-go', () => { tutorialSeen = true; startSolo(); });
  on('btn-tut-back', showMenu);
  on('btn-resume', resume);
  on('btn-quit', () => { leaveRoom(); clearRun(); showMenu(); });
  on('btn-again', () => (online() ? backToLobby() : startSolo()));
  on('btn-next', () => { settings.level = Math.min(settings.level + 1, LEVELS.length - 1); startSolo(); });
  on('btn-menu', () => { leaveRoom(); clearRun(); showMenu(); });
  on('btn-create', () => connect(''));
  on('btn-join', () => connect(hud.onlineForm().code));
  on('btn-online-back', showMenu);
  on('btn-lobby-leave', () => { leaveRoom(); showMenu(); });
  on('btn-lobby-start', hostStart);
  on('btn-copy', () => {
    const link = inviteLink();
    navigator.clipboard?.writeText(link).then(() => hud.lobbyNote('Invite link copied.'), () => hud.lobbyNote(link));
  });
  document.getElementById('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(hud.onlineForm().code); });
}

function selectJet(i) {
  if (jet) scene.remove(jet.object);
  settings.jetIndex = i;
  jet = jets[i];
  scene.add(jet.object);
}

function chooseMap(id) {
  if (world.map.id === id) return;
  world.setMap(id);
  radarLand = world.makeRadarImage();
}

function showScreen(id) {
  if (id !== 'hud') state = id;
  hud.show(id);
}

function syncMenu() {
  hud.syncMenu(settings, bestScore);
}

function showMenu() {
  input.setActive(false);
  chooseMap(settings.map);
  selectJet(settings.jetIndex);
  input.groundMode = false;
  sfx.engine(false);
  syncMenu();
  showScreen('menu');
}

function showTutorial() {
  showScreen('tutorial');
}

// ---------- online rooms ----------

function inviteLink() {
  return `${location.origin}${location.pathname}?room=${net.code}`;
}

async function connect(code) {
  sfx.init();
  const form = hud.onlineForm();
  settings.name = form.name;
  store.set('name', form.name);
  if (code !== '' && !/^[A-Za-z]{4}$/.test(code)) {
    hud.onlineError('Room codes are 4 letters.');
    return;
  }
  hud.onlineBusy(code ? 'join' : 'create');
  try {
    await net.connect(form.name, code.toUpperCase());
  } catch (err) {
    hud.onlineError(err.message);
    return;
  } finally {
    hud.onlineBusy(null);
  }
  lobby.picks.clear();
  lobby.roles.clear();
  lobby.roles.set(net.id, settings.role);
  net.send({ t: 'role', role: settings.role });
  lobby.picks.set(net.id, settings.jetIndex);
  net.send({ t: 'pick', jet: settings.jetIndex });
  if (net.isHost) {
    lobby.level = settings.level;
    lobby.difficulty = settings.difficulty;
    lobby.map = settings.map;
    sendLobby();
  }
  history.replaceState(null, '', `?room=${net.code}`);
  showLobby();
}

function leaveRoom() {
  if (!net.ws) return;
  net.close();
  history.replaceState(null, '', location.pathname);
}

function sendLobby() {
  if (!net.isHost) return;
  net.send({ t: 'lobby', map: lobby.map, mode: lobby.mode, level: lobby.level, difficulty: lobby.difficulty });
  renderLobby();
}

function showLobby() {
  clearRun();
  selectJet(settings.jetIndex);
  input.groundMode = false;
  chooseMap(lobby.map);
  sfx.engine(false);
  renderLobby();
  showScreen('lobby');
}

function renderLobby() {
  hud.renderLobby({
    code: net.code,
    link: inviteLink(),
    isHost: net.isHost,
    myId: net.id,
    players: net.players.map((p) => ({ ...p, jet: lobby.picks.get(p.id) ?? 0, role: lobby.roles.get(p.id) ?? 'jet' })),
    myRole: settings.role,
    map: lobby.map,
    myJet: settings.jetIndex,
    mode: lobby.mode,
    level: lobby.level,
    difficulty: lobby.difficulty,
  });
}

function backToLobby() {
  if (net.isHost) sendLobby();
  showLobby();
}

function hostStart() {
  if (!net.isHost) return;
  chooseMap(lobby.map);
  const level = levelForMap(LEVELS[lobby.level], lobby.map);
  const roles = net.players.map((p) => lobby.roles.get(p.id) ?? 'jet');
  const config = {
    map: lobby.map,
    online: true,
    mode: roles.every((r) => r === 'aa') ? 'defence' : roles.includes('aa') ? 'battle' : MODES[lobby.mode].id,
    level: lobby.level,
    difficulty: lobby.difficulty,
    wind: randomWind(level),
    trucks: placeTrucks(world, level).map((t) => ({ x: +t.x.toFixed(2), z: +t.z.toFixed(2), yaw: +t.yaw.toFixed(3) })),
    players: net.players.map((p) => ({ id: p.id, name: p.name, jet: lobby.picks.get(p.id) ?? 0, role: lobby.roles.get(p.id) ?? 'jet' })),
  };
  net.send({ t: 'start', config });
  startRun(config);
}

function bindNet() {
  const inRun = () => session?.online && (state === 'playing' || state === 'paused');
  net
    .on('roster', () => {
      // Someone joined: tell them what we picked and, from the host, the room settings.
      net.send({ t: 'pick', jet: settings.jetIndex });
      net.send({ t: 'role', role: settings.role });
      if (net.isHost) sendLobby();
      if (state === 'lobby') renderLobby();
    })
    .on('left', (m) => {
      lobby.picks.delete(m.id);
      lobby.roles.delete(m.id);
      if (state === 'lobby') renderLobby();
      const p = session?.players.get(m.id);
      if (p && session) {
        hud.message(`${p.name} left the game.`, 'info', 3);
        removePlayer(p);
      }
    })
    .on('pick', (m) => { lobby.picks.set(m.from, m.jet); if (state === 'lobby') renderLobby(); })
    .on('role', (m) => { lobby.roles.set(m.from, m.role === 'aa' ? 'aa' : 'jet'); if (state === 'lobby') renderLobby(); })
    .on('lobby', (m) => {
      lobby.mode = m.mode;
      lobby.level = m.level;
      lobby.difficulty = m.difficulty;
      lobby.map = m.map === 'large' ? 'large' : 'small';
      if (state === 'lobby') chooseMap(lobby.map);
      if (state === 'results') showLobby();
      else if (state === 'lobby') renderLobby();
    })
    .on('start', (m) => startRun(m.config))
    .on('jet', (m) => { if (inRun()) remoteJetState(m.from, m.s); })
    .on('bots', (m) => { if (inRun() && m.from === net.players.find((p) => p.host)?.id) for (const [id, snap] of m.s) remoteJetState(id, snap); })
    .on('aa-fire', (m) => { if (inRun() && isAuthority()) acceptGroundFire(m.from, m); })
    .on('aa-reload', (m) => { if (inRun() && isAuthority()) reloadGroundWeapon(m.from); })
    .on('damage', (m) => { if (inRun() && m.from === net.players.find((p) => p.host)?.id) receiveDamage(m.id, m.health, m.attacker); })
    .on('trucks', (m) => {
      if (!inRun()) return;
      m.s.forEach((snap, i) => { if (session.trucks[i]?.alive) session.trucks[i].applySnapshot(snap); });
    })
    .on('fire', (m) => {
      if (!inRun()) return;
      const p = v3(m.p);
      tracers.spawn(p, v3(m.d), m.owner ?? null);
      sfx.flak(soundVolume(p) * 0.8);
    })
    .on('drop', (m) => { if (inRun()) spawnBomb(m.owner ?? m.from, m.id, v3(m.p), v3(m.v)); })
    .on('result', (m) => { if (inRun()) applyResult(m.r); })
    .on('dead', (m) => { if (inRun()) remoteDied(m.from, m.kind); })
    .on('end', (m) => { if (inRun()) finishOnline(m.stats, m.outcome); })
    .on('closed', (m) => {
      net.close();
      kicked(m.text);
    })
    .on('disconnect', () => kicked('Lost the connection to the game server.'));
}

function kicked(text) {
  if (state === 'menu' || state === 'loading') return;
  clearRun();
  history.replaceState(null, '', location.pathname);
  hud.setOnline({ name: settings.name });
  hud.onlineError(text);
  showScreen('online');
}

// ---------- a run ----------

function randomWind(level) {
  if (!level.wind) return [0, 0];
  const a = Math.random() * Math.PI * 2;
  return [+(Math.cos(a) * level.wind).toFixed(3), +(Math.sin(a) * level.wind).toFixed(3)];
}

function clearRun() {
  input.setActive(false);
  sfx.setPaused(false);
  sfx.stopEffects();
  if (!session) return;
  for (const t of session.trucks) t.dispose();
  for (const b of session.bombs) { b.whistle?.stop(); b.dispose(); }
  for (const p of session.players.values()) if (!p.local) removePlayer(p);
  if (jet.role === 'aa') scene.remove(jet.object);
  tracers.clear();
  effects.clear();
  hud.clearMessages();
  hud.clearLabels();
  session = null;
}

function removePlayer(p) {
  p.jet.alive = false;
  session.targets = session.targets.filter((j) => j !== p.jet);
  scene.remove(p.jet.object);
  hud.removeLabel(p.id);
  session.players.delete(p.id);
}

function startSolo() {
  chooseMap(settings.map);
  const level = levelForMap(LEVELS[settings.level], settings.map);
  startRun({
    map: settings.map,
    online: false,
    mode: settings.role === 'aa' ? 'defence' : 'solo',
    level: settings.level,
    difficulty: settings.difficulty,
    wind: randomWind(level),
    trucks: placeTrucks(world, level),
    players: [{ id: 0, name: 'You', jet: settings.jetIndex, role: settings.role }],
  });
}

const newStats = () => ({ kills: 0, doubles: 0, near: 0, dropped: 0, hits: 0, deaths: 0 });

function spawnPoint(index, count) {
  return new THREE.Vector3((index - (count - 1) / 2) * 45, 90 + index * 6, -world.map.radius + 90);
}

function groundSpawn(index) {
  // Deterministic, spaced, safe dry ground, shared by every client.
  const points = [];
  for (let radius = 55; radius < world.map.radar; radius += 20) {
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12, x = PAD.x + Math.cos(a) * radius, z = PAD.z + Math.sin(a) * radius;
      if (world.drivable(x, z) && points.every((p) => Math.hypot(x - p.x, z - p.z) > 25)) points.push(new THREE.Vector3(x, world.heightAt(x, z), z));
      if (points.length > index) return points[index];
    }
  }
  throw new Error('No safe ground spawn available');
}

function startRun(config) {
  clearRun();
  chooseMap(config.map ?? 'small');
  const level = levelForMap(LEVELS[config.level], world.map.id);
  const diff = DIFFICULTIES[config.difficulty];
  const me = config.online ? net.id : 0;
  const players = new Map();
  config.players.forEach((p, index) => {
    const local = p.id === me;
    const role = p.role === 'aa' ? 'aa' : 'jet';
    if (local && jet) scene.remove(jet.object);
    const j = role === 'aa' ? new GroundVehicle(world) : new Jet(getModel(JETS[p.jet].file));
    j.role = role; j.life = 0; j.playerId = p.id;
    if (local) jet = j;
    scene.add(j.object);
    j.reset(role === 'aa' ? groundSpawn(index) : spawnPoint(index, config.players.length), 0);
    players.set(p.id, { id: p.id, name: p.name, role, jetIndex: p.jet, jet: j, local, index, stats: newStats(), net: null });
    if (!local) hud.addLabel(p.id, p.name, role === 'aa' ? '#88c567' : JETS[p.jet].color);
  });

  session = {
    online: config.online,
    mode: config.mode,
    level,
    levelIndex: config.level,
    diff,
    wind: new THREE.Vector3(config.wind[0], 0, config.wind[1]),
    players,
    me: players.get(me),
    maxHealth: diff.id === 'easy' ? 150 : 100,
    bombsLeft: level.bombs,
    bombs: [],
    seq: 0,
    trucks: [],
    dropCooldown: 0,
    endTimer: -1,
    outcome: null,
    crashPoint: null,
    respawnIn: 0,
    lastHurtMsg: -10,
    time: 0,
    timeLeft: config.online ? ONLINE_TIME : config.mode === 'defence' ? 180 : Infinity,
    mapId: world.map.id,
    smokeTimer: 0,
    physTimer: 0,
    phys: null,
    padTimer: 0,
    onPad: false,
    sendTimer: 0,
    truckTimer: 0,
    boardTimer: 0,
    menuOpen: false,
  };
  if (config.mode === 'defence') {
    for (let i = 0; i < 3; i++) {
      const id = -1 - i, j = new Jet(getModel(JETS[i % JETS.length].file));
      j.role = 'jet'; j.playerId = id; j.life = 0;
      j.reset(spawnPoint(i, 3), 0); scene.add(j.object);
      players.set(id, { id, name: `Raider ${i + 1}`, role: 'jet', ai: true, jetIndex: i, jet: j, local: false, index: i, stats: newStats(), net: null, aiTimer: i * 3 });
      hud.addLabel(id, `Raider ${i + 1}`, '#ff7777');
    }
  }
  session.targets = [...players.values()].filter((p) => p.role === 'jet').map((p) => p.jet);
  for (const p of players.values()) { p.jet.health = session.maxHealth; p.authorityHealth = session.maxHealth; }
  session.trucks = config.trucks.map((t, i) => {
    const truck = new Truck(scene, getModel(TRUCK_FILE), t, world, level, diff, i);
    if (config.online && !net.isHost) truck.applySnapshot([t.x, t.z, t.yaw, 0, 0, 0]);
    return truck;
  });
  jet.health = session.maxHealth;
  input.groundMode = jet.role === 'aa';
  input.setActive(true);
  input.keys.clear(); input.touch.fire = false; input.aimDX = input.aimDY = 0;
  document.body.classList.toggle('ground-role', input.groundMode);
  hud.setRole(jet.role, config.mode);

  camMode = 'chase';
  snapCamera();
  input.clearPresses();
  state = 'playing';
  hud.show('hud');
  hud.setOnlineHud(config.online || config.mode === 'defence');
  hud.setBombs(level.bombs, level.bombs);
  const who = config.online ? `${config.players.length} players · ${config.mode}. ` : '';
  hud.message(`${who}Level ${level.n}: ${session.trucks.length} ${jet.role === 'aa' ? 'allied vehicles. Protect the island.' : `trucks, ${level.bombs} bombs. ${pick(MSG.start)}`}`, 'info', 4.5);
  hud.message(jet.role === 'aa' ? 'W/S drive · A/D steer · mouse or arrows aim · hold Space/click to fire · R reload.' : 'The green ring on the runway reloads bombs. Fly through it low.', 'info', 7);
  if (config.mode === 'defence') hud.message('Defend the island: shoot down 6 raiders before time runs out. They drop bombs!', 'info', 7);
  if (level.wind) hud.message('Crosswind today. Watch the wind arrow.', 'warn', 4.5);
  sfx.engine(true, 0.4);
}

function pause() {
  input.setActive(false);
  if (online()) {
    // The game keeps running for everyone else, so this is only a menu over it.
    session.menuOpen = true;
    hud.setPauseText(true);
    hud.show('pause');
    return;
  }
  state = 'paused';
  sfx.engine(false);
  sfx.setPaused(true);
  hud.setPauseText(false);
  hud.show('pause');
}

function resume() {
  input.setActive(true);
  sfx.setPaused(false);
  input.clearPresses();
  hud.show('hud');
  if (online()) {
    session.menuOpen = false;
    return;
  }
  state = 'playing';
  sfx.engine(true);
}

function dropStart(out = new THREE.Vector3()) {
  return out.copy(jet.position).add(new THREE.Vector3(0, -1.6, 0));
}

function spawnBomb(owner, id, p, v) {
  const b = new Bomb(scene, p, v, session.wind, surfaceAt);
  b.owner = owner;
  b.id = id;
  session.bombs.push(b);
  if (b.prediction) b.whistle = sfx.whistle(b.prediction.t, soundVolume(b.p));
  session.players.get(owner) && session.players.get(owner).stats.dropped++;
  return b;
}

function tryDrop() {
  const s = session;
  if (!jet.alive || jet.role === 'aa') return;
  if (s.bombsLeft <= 0) {
    hud.message(pick(MSG.nobombs), 'warn', 3);
    return;
  }
  if (s.dropCooldown > 0) return;
  s.dropCooldown = 0.5;
  s.bombsLeft--;
  const id = `${myId()}:${s.seq++}`;
  const b = spawnBomb(myId(), id, dropStart(), jet.velocity);
  if (s.online) net.send({ t: 'drop', id, p: arr(b.release.p, 3), v: arr(b.release.v, 3) });
  hud.setBombs(s.level.bombs, s.bombsLeft);
  sfx.drop();
  if (b.prediction) {
    const ahead = Math.hypot(b.prediction.point.x - b.release.p.x, b.prediction.point.z - b.release.p.z);
    hud.message(`Bombs away! Falls for ${b.prediction.t.toFixed(1)} s and travels ${ahead.toFixed(0)} m forward.`, 'info', 2.6);
  }
}

function soundVolume(p) {
  return clamp(1 - camera.position.distanceTo(p) / 450, 0.08, 1);
}

/** Every screen draws the impact. Only the host (or single player) decides what it hit. */
function onImpact(b) {
  const s = session;
  const pt = b.impact.point;
  const onWater = world.isWater(pt.x, pt.z);
  b.whistle?.stop();
  b.showGuides(surfaceAt);
  b.onWater = onWater;
  shake(pt, 1);

  if (onWater) {
    effects.splash(pt);
    sfx.splash(soundVolume(pt));
  } else {
    const n = new THREE.Vector3();
    world.heightAt(pt.x, pt.z, n);
    effects.explosion(pt.clone().setY(pt.y + 1.5), 1);
    effects.debris(pt.clone().setY(pt.y + 1), 8, [0x8a6d45, 0x5f8f3a, 0x777777], 14, 0.9);
    effects.scorch(pt, n);
    sfx.boom(soundVolume(pt));
  }

  if (isAuthority()) {
    const r = resolveImpact(b, pt);
    for (const p of s.players.values()) {
      if (p.role !== 'aa' || !p.jet.alive) continue;
      const d = p.jet.position.distanceTo(pt);
      if (d <= NEAR_RADIUS) combatDamage(p.id, d <= BLAST_RADIUS ? 150 : 55, b.owner);
    }
    if (s.online) net.send({ t: 'result', r });
    applyResult(r);
  } else if (b.result && b.owner === myId()) {
    bombFeedback(b, b.result);
  }
}

function resolveImpact(b, pt) {
  const kills = [];
  const damaged = [];
  session.trucks.forEach((t, i) => {
    if (!t.alive || Math.abs(t.pos.y - pt.y) > 15) return;
    const d = Math.hypot(t.pos.x - pt.x, t.pos.z - pt.z);
    if (d <= BLAST_RADIUS || (d <= NEAR_RADIUS && t.hp <= 1)) kills.push(i);
    else if (d <= NEAR_RADIUS) damaged.push(i);
  });
  return { id: b.id, owner: b.owner, kills, damaged, at: arr(pt) };
}

function applyResult(r) {
  const s = session;
  const at = v3(r.at);
  for (const i of r.kills) s.trucks[i]?.destroy(at, effects);
  for (const i of r.damaged) s.trucks[i]?.damage();
  const owner = s.players.get(r.owner);
  if (owner) {
    if (s.mode !== 'battle') owner.stats.kills += r.kills.length;
    owner.stats.near += r.damaged.length;
    if (r.kills.length >= 2) owner.stats.doubles++;
    if (r.kills.length || r.damaged.length) owner.stats.hits++;
  }
  const b = s.bombs.find((x) => x.id === r.id);
  if (r.owner === myId()) {
    if (b) {
      b.result = r;
      if (!b.falling) bombFeedback(b, r);
    }
  } else if (owner && r.kills.length) {
    hud.message(`${owner.name} got ${r.kills.length > 1 ? `${r.kills.length} trucks` : 'a truck'}!`, 'good', 2.5);
  }
}

/** What happened to one of my bombs, and how to do better. */
function bombFeedback(b, r) {
  if (b.report) return;
  const pt = b.impact.point;
  const travel = Math.hypot(pt.x - b.release.p.x, pt.z - b.release.p.z);
  b.report = { t: b.impact.t, travel, hit: r.kills.length > 0 };
  if (r.kills.length >= 2) {
    b.report.result = `${r.kills.length} trucks!`;
    hud.message(pick(MSG.double), 'good', 4);
    return;
  }
  if (r.kills.length === 1) {
    b.report.result = 'Direct hit';
    hud.message(pick(MSG.hit), 'good');
    return;
  }
  if (r.damaged.length) {
    b.report.result = 'Near miss: damaged';
    b.report.hit = true;
    hud.message(pick(MSG.near), 'good', 3);
    sfx.honk();
    return;
  }

  // A miss: say by how much, measured along the direction the jet was flying when it let go.
  const near = nearestTruck(pt);
  if (!near) {
    b.report.result = 'Miss';
    return;
  }
  const fx = b.release.v.x, fz = b.release.v.z;
  const len = Math.hypot(fx, fz) || 1;
  const ux = fx / len, uz = fz / len;
  const dx = pt.x - near.pos.x, dz = pt.z - near.pos.z;
  const long = dx * ux + dz * uz;
  const lat = dx * -uz + dz * ux;
  const off = `${Math.abs(long).toFixed(0)} m ${long > 0 ? 'long' : 'short'}, ${Math.abs(lat).toFixed(0)} m ${lat > 0 ? 'right' : 'left'}`;
  b.report.result = off;
  const tip = Math.abs(lat) > Math.abs(long)
    ? 'Line up straighter.'
    : long > 0 ? 'Let go a bit earlier.' : 'Let go a bit later.';
  hud.message(`${b.onWater ? pick(MSG.water) : pick(MSG.miss)} ${off}. ${tip}`, 'warn', 5);
  if (Math.hypot(dx, dz) < 40) {
    near.honk();
    sfx.honk();
    hud.message(pick(MSG.honk), 'info', 2);
  }
}

function nearestTruck(p) {
  let best = null;
  let bestD = Infinity;
  for (const t of session.trucks) {
    if (!t.alive) continue;
    const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

function combatDamage(id, damage, attacker = null) {
  if (!isAuthority()) return;
  const p = session.players.get(id);
  if (!p?.jet.alive) return;
  const health = clamp(p.jet.health - damage, 0, session.maxHealth);
  if (session.online) net.send({ t: 'damage', id, health, attacker });
  receiveDamage(id, health, attacker);
}

function receiveDamage(id, health, attacker) {
  const p = session.players.get(id);
  if (!p?.jet.alive) return;
  const hurt = health < p.jet.health;
  p.jet.health = p.authorityHealth = health;
  if (p.net) p.net.health = health;
  if (hurt) effects.sparks(p.jet.position.clone());
  if (p.local && hurt) { hud.flash(); sfx.hit(); }
  if (health > 0) return;
  const shooter = session.players.get(attacker);
  if (shooter && shooter.id !== id) shooter.stats.kills++;
  if (p.local) destroyJet('shotdown', false);
  else remoteDied(id, 'shotdown');
}

function acceptGroundFire(id, message) {
  const p = session.players.get(id);
  if (!p || p.role !== 'aa' || !p.jet.alive || !Array.isArray(message.p) || !Array.isArray(message.d)) return;
  if (![...message.p, ...message.d].every(Number.isFinite)) return;
  // The host owns rate, magazine and reload state even for a remote gunner.
  const now = session.time;
  p.weapon ??= { rounds: 30, next: 0, reload: 0 };
  const w = p.weapon;
  if (now < w.next || now < w.reload) return;
  if (!w.rounds) w.rounds = 30;
  const at = v3(message.p), dir = v3(message.d);
  if (at.distanceTo(p.jet.position) > 22 || dir.length() < .9 || dir.length() > 1.1) return;
  w.next = now + .115; w.rounds--;
  if (!w.rounds) w.reload = now + 2;
  dir.normalize();
  tracers.spawn(at, dir, id);
  sfx.flak(soundVolume(at));
  if (session.online) net.send({ t: 'fire', p: arr(at), d: arr(dir, 4), owner: id });
}

function groundFire() {
  const shot = jet.shoot();
  if (!shot) return;
  const message = { t: 'aa-fire', p: arr(shot.p, 3), d: arr(shot.d, 5) };
  if (isAuthority()) acceptGroundFire(myId(), message);
  else net.send(message);
}

function reloadGroundWeapon(id) {
  const p = session.players.get(id);
  if (!p || p.role !== 'aa' || !p.jet.alive) return;
  p.weapon ??= { rounds: 30, next: 0, reload: 0 };
  if (p.weapon.reload > session.time) return;
  p.weapon.rounds = 0; p.weapon.reload = session.time + 2;
}

function jetExplodes(j, kind) {
  if (kind === 'sea') {
    effects.splash(j.position.clone().setY(0));
    sfx.splash(soundVolume(j.position));
  }
  effects.explosion(j.position.clone(), 1.6);
  effects.debris(j.position.clone(), 14, [0x6688aa, 0x333333, 0xff8a2e], 22, 1.2);
  sfx.boom(soundVolume(j.position));
}

function destroyJet(kind, announce = true) {
  input.setActive(false);
  const s = session;
  jet.alive = false;
  jet.object.visible = false;
  s.crashPoint = jet.position.clone();
  sfx.engine(false);
  jetExplodes(jet, kind);
  shake(jet.position, 2);
  const msg = jet.role === 'aa' ? ['Vehicle destroyed. Watch for incoming bombs!'] : kind === 'shotdown' ? MSG.shot : kind === 'sea' ? MSG.sea : MSG.crash;
  hud.message(pick(msg), 'bad', 4);
  if (s.online) {
    s.me.stats.deaths++;
    if (announce) net.send({ t: 'dead', kind, s: jetSnapshot() });
    s.respawnIn = RESPAWN_TIME;
    hud.message(`Respawning in ${RESPAWN_TIME} s.`, 'info', 3);
    return;
  }
  end(kind === 'shotdown' ? 'shotdown' : 'crash', 3);
}

function respawn() {
  const s = session;
  jet.life++;
  jet.reset(jet.role === 'aa' ? groundSpawn(s.me.index) : spawnPoint(s.me.index, s.players.size), 0);
  s.me.weapon = null;
  jet.health = s.maxHealth;
  input.setActive(true);
  s.bombsLeft = s.level.bombs;
  hud.setBombs(s.level.bombs, s.bombsLeft);
  camMode = 'chase';
  snapCamera();
  sfx.engine(true, 0.4);
  hud.message(jet.role === 'aa' ? 'Fresh vehicle, full magazine.' : 'Fresh jet, full bombs. Go get them.', 'info', 2.5);
}

function remoteDied(id, kind) {
  const p = session.players.get(id);
  if (!p) return;
  p.stats.deaths++;
  p.jet.alive = false;
  p.jet.object.visible = false;
  if (p.net) p.net.alive = false;
  if (p.ai) p.aiTimer = 5;
  jetExplodes(p.jet, kind);
  hud.message(`${p.name} ${kind === 'shotdown' ? 'was shot down' : 'crashed'}.`, 'bad', 2.5);
}

function end(outcome, delay) {
  if (session.outcome) return;
  session.outcome = outcome;
  session.endTimer = delay;
}

function checkEnd() {
  const s = session;
  if (s.outcome || !isAuthority()) return;
  if (s.mode === 'battle' || s.mode === 'defence') {
    const defenders = [...s.players.values()].filter((p) => !p.ai && p.role === 'aa');
    if (s.mode === 'defence' && defenders.reduce((n, p) => n + p.stats.kills, 0) >= 6) end('win', 2);
    else if (s.timeLeft <= 0) end('time', 1);
    return;
  }
  if (!s.trucks.some((t) => t.alive)) {
    hud.message(pick(MSG.win), 'good', 3);
    end('win', 2.5);
  } else if (s.timeLeft <= 0) {
    hud.message('Time is up!', 'warn', 3);
    end('time', 1);
  }
}

const baseScore = (st) => st.kills * 100 + st.doubles * 150 + st.near * 25;

function finishRun() {
  input.setActive(false);
  const s = session;
  if (s.online) {
    const stats = Object.fromEntries([...s.players.values()].filter((p) => !p.ai).map((p) => [p.id, { name: p.name, jet: p.jetIndex, role: p.role, ...p.stats }]));
    net.send({ t: 'end', stats, outcome: s.outcome });
    finishOnline(stats, s.outcome);
    return;
  }
  const st = s.me.stats;
  const won = s.outcome === 'win';
  const ground = jet.role === 'aa';
  const lines = [[`${ground ? 'Aircraft shot down' : 'Trucks destroyed'} (${st.kills} × 100)`, st.kills * 100]];
  if (st.doubles) lines.push([`Double hits (${st.doubles} × 150)`, st.doubles * 150]);
  if (st.near) lines.push([`Near misses (${st.near} × 25)`, st.near * 25]);
  let total = baseScore(st);
  if (won) {
    const timeBonus = Math.max(0, Math.round(240 - s.time));
    if (!ground) lines.push([`Unused bombs (${s.bombsLeft} × 50)`, s.bombsLeft * 50]);
    lines.push(['Health left', Math.round(jet.health)]);
    lines.push([`Time bonus (${Math.round(s.time)} s)`, timeBonus]);
    total += (ground ? 0 : s.bombsLeft * 50) + Math.round(jet.health) + timeBonus;
  }
  if (!ground) lines.push(['Accuracy', st.dropped ? `${Math.round((100 * st.hits) / st.dropped)}% of bombs hit` : 'no bombs dropped']);
  if (s.diff.score !== 1) {
    lines.push([`${s.diff.name} difficulty`, `× ${s.diff.score}`]);
    total = Math.floor(total * s.diff.score);
  }
  const key = `best-${s.mapId}-${jet.role}-${s.levelIndex}-${s.diff.id}`;
  const prev = store.get(key, 0);
  const newBest = total > prev;
  if (newBest) store.set(key, total);
  const titles = { win: ground ? 'Island defended!' : 'Island cleared!', crash: 'Crashed', shotdown: ground ? 'Vehicle destroyed' : 'Shot down', time: 'Time is up' };
  const subs = { win: ground ? 'Six raiders down. The island is safe.' : pick(MSG.win), crash: pick(MSG.crash), shotdown: ground ? 'Watch for incoming bombs. Keep moving!' : pick(MSG.shot), time: 'Try again to stop six raiders.' };
  state = 'results';
  sfx.engine(false);
  won ? sfx.win() : sfx.lose();
  hud.showResults({
    title: titles[s.outcome],
    subtitle: subs[s.outcome],
    lines,
    total,
    best: Math.max(prev, total),
    newBest,
    canNext: won && s.levelIndex < LEVELS.length - 1,
    online: false,
  });
}

function finishOnline(stats, outcome) {
  input.setActive(false);
  const s = session;
  const mult = s.diff.score;
  const rows = Object.entries(stats).map(([id, st]) => ({
    id: Number(id),
    name: st.name,
    color: st.role === 'aa' ? '#88c567' : JETS[st.jet]?.color ?? '#fff',
    role: st.role,
    kills: st.kills,
    deaths: st.deaths,
    accuracy: st.dropped ? Math.round((100 * st.hits) / st.dropped) : 0,
    score: Math.max(0, Math.floor((baseScore(st) - st.deaths * 100) * mult)),
  })).sort((a, b) => b.score - a.score);
  const coop = s.mode === 'coop' || s.mode === 'defence';
  const won = outcome === 'win';
  let title, subtitle;
  if (s.mode === 'battle') {
    const air = rows.filter((r) => r.role !== 'aa').reduce((n, r) => n + r.kills, 0);
    const ground = rows.filter((r) => r.role === 'aa').reduce((n, r) => n + r.kills, 0);
    title = air === ground ? 'Air vs ground: draw!' : air > ground ? 'Jet team wins!' : 'Anti-air team wins!';
    subtitle = `Jet team: ${air} kills · Ground team: ${ground} kills`;
  } else if (s.mode === 'defence') {
    title = won ? 'Island defended, together!' : 'Defence timed out';
    subtitle = won ? 'Six raiders down.' : 'The raiders are still flying.';
  } else if (coop) {
    title = won ? 'Island cleared, together!' : 'Time is up';
    subtitle = won ? pick(MSG.win) : 'Some trucks survived to honk another day.';
  } else {
    const top = rows[0];
    const tie = rows.length > 1 && rows[1].score === top.score;
    title = tie ? 'It is a tie!' : top.id === net.id ? 'You win the bomb race!' : `${top.name} wins the bomb race`;
    subtitle = won ? 'Every truck is gone.' : 'Time ran out.';
  }
  state = 'results';
  sfx.engine(false);
  (coop ? won : rows[0]?.id === net.id) ? sfx.win() : sfx.lose();
  hud.showResults({
    title,
    subtitle,
    online: true,
    isHost: net.isHost,
    myId: net.id,
    rows,
    team: coop ? rows.reduce((a, r) => a + r.score, 0) : null,
    note: mult !== 1 ? `${s.diff.name} difficulty: scores × ${mult}. Each crash costs 100.` : 'Each crash costs 100.',
  });
}

// ---------- multiplayer jets ----------

function jetSnapshot(actor = jet) {
  return [...arr(actor.position), +actor.yaw.toFixed(3), +actor.pitch.toFixed(3), +actor.roll.toFixed(3), +actor.speed.toFixed(1), Math.round(actor.health), actor.alive ? 1 : 0, actor.turretYaw ?? 0, actor.gunPitch ?? 0, actor.life ?? 0];
}

function remoteJetState(id, s) {
  const p = session.players.get(id);
  if (!p || p.local) return;
  if (!Array.isArray(s) || s.length < 12 || !s.every(Number.isFinite)) return;
  if (!p.jet.alive && s[8] === 1 && s[11] <= p.jet.life) return;
  const respawning = s[11] > p.jet.life;
  p.jet.life = s[11];
  if (respawning) { p.weapon = null; p.jet.health = p.authorityHealth = session.maxHealth; }
  const first = !p.net || (!p.jet.alive && s[8] === 1);
  p.net = { x: s[0], y: s[1], z: s[2], yaw: s[3], pitch: s[4], roll: s[5], speed: s[6], health: s[7], alive: s[8] === 1, at: performance.now() };
  if (first && p.net.alive) {
    p.jet.position.set(s[0], s[1], s[2]);
    p.jet.yaw = s[3];
  }
  p.jet.alive = p.net.alive;
  p.jet.object.visible = p.net.alive;
  p.jet.health = s[7];
  if (isAuthority() && !respawning) { p.jet.health = p.net.health = p.authorityHealth ?? p.jet.health; }
  p.jet.turretYaw = s[9]; p.jet.gunPitch = s[10];
}

function updateRemoteJets(dt) {
  const k = 1 - Math.exp(-dt * 10);
  for (const p of session.players.values()) {
    if (p.local || (p.ai && isAuthority()) || !p.net || !p.net.alive) continue;
    const n = p.net;
    const j = p.jet;
    // Extrapolate along the last known heading for the time since the snapshot, then ease toward it.
    const age = Math.min(0.3, (performance.now() - n.at) / 1000);
    const cp = Math.cos(n.pitch);
    const tx = n.x + Math.sin(n.yaw) * cp * n.speed * age;
    const ty = n.y + Math.sin(n.pitch) * n.speed * age;
    const tz = n.z + Math.cos(n.yaw) * cp * n.speed * age;
    if (Math.hypot(tx - j.position.x, tz - j.position.z) > 80) j.position.set(tx, ty, tz);
    else j.position.set(j.position.x + (tx - j.position.x) * k, j.position.y + (ty - j.position.y) * k, j.position.z + (tz - j.position.z) * k);
    j.yaw += (((n.yaw - j.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * k;
    j.pitch += (n.pitch - j.pitch) * k;
    j.roll += (n.roll - j.roll) * k;
    j.speed = n.speed;
    if (p.role === 'aa') j.position.y = world.heightAt(j.position.x, j.position.z);
    j.updateVectors();
    j.applyTransform();
    if (j.glow) j.glow.emissiveIntensity = 3 + Math.sin(performance.now() * 0.04) * 0.6;
  }
}

function netTick(dt) {
  const s = session;
  s.sendTimer -= dt;
  if (s.sendTimer <= 0) {
    s.sendTimer = 1 / 15;
    net.send({ t: 'jet', s: jetSnapshot() });
  }
  if (net.isHost) {
    s.truckTimer -= dt;
    if (s.truckTimer <= 0) {
      s.truckTimer = 1 / 10;
      net.send({ t: 'trucks', s: s.trucks.map((t) => t.snapshot()) });
      net.send({ t: 'bots', s: [...s.players.values()].filter((p) => p.ai).map((p) => [p.id, jetSnapshot(p.jet)]) });
    }
  }
}

// ---------- reload strip ----------

function padCheck(dt) {
  const s = session;
  const agl = jet.position.y - world.heightAt(jet.position.x, jet.position.z);
  const on = Math.hypot(jet.position.x - PAD.x, jet.position.z - PAD.z) < PAD_RADIUS && agl < PAD_MAX_AGL;
  if (on && !s.onPad) {
    s.padTimer = 0.25;
    hud.message('Over the runway: reloading.', 'good', 1.6);
  }
  s.onPad = on;
  if (!on) return;
  s.padTimer -= dt;
  if (s.padTimer > 0) return;
  s.padTimer = 0.35;
  let changed = false;
  if (s.bombsLeft < s.level.bombs) {
    s.bombsLeft++;
    changed = true;
    sfx.click();
  }
  if (jet.health < s.maxHealth) jet.health = Math.min(s.maxHealth, jet.health + 10);
  if (changed) hud.setBombs(s.level.bombs, s.bombsLeft);
}

// ---------- fixed-step simulation ----------

function updateRaiders(dt) {
  const s = session;
  for (const p of s.players.values()) {
    if (!p.ai) continue;
    const j = p.jet;
    if (!j.alive) {
      p.aiTimer -= dt;
      if (p.aiTimer <= 0) {
        j.life++; j.reset(spawnPoint(p.index, 3), 0); j.health = p.authorityHealth = s.maxHealth; p.attack = null;
      }
      continue;
    }
    if (!p.attack) {
      const defenders = [...s.players.values()].filter((o) => o.role === 'aa' && o.jet.alive);
      if (!defenders.length) continue;
      const target = defenders[p.index % defenders.length].jet.position.clone();
      const angle = p.index * 2.1 + Math.floor(s.time / 25) * .6;
      const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
      const start = target.clone().addScaledVector(dir, -350);
      let altitude = Math.max(target.y + 85, 110);
      for (let d = -350; d <= 350; d += 20) altitude = Math.max(altitude, world.surfaceAt(target.x + dir.x * d, target.z + dir.z * d) + 65);
      j.position.copy(start).setY(altitude); j.yaw = angle; j.pitch = j.roll = 0; j.speed = 38;
      p.attack = { target, dir, distance: -350, dropped: false };
    }
    const a = p.attack;
    j.updateVectors(); j.position.addScaledVector(j.velocity, dt); j.applyTransform(); a.distance += j.speed * dt;
    if (!a.dropped) {
      const pred = simulateFall(j.position, j.velocity, s.wind, surfaceAt, 1 / 30, 25);
      if (pred && pred.point.distanceTo(a.target) < 28) {
        a.dropped = true;
        const id = `ai:${p.id}:${s.seq++}`;
        const at = j.position.clone().add(new THREE.Vector3(0, -2, 0));
        spawnBomb(p.id, id, at, j.velocity);
        if (s.online) net.send({ t: 'drop', id, owner: p.id, p: arr(at, 3), v: arr(j.velocity, 3) });
      }
    }
    if (a.distance > 350) p.attack = null;
  }
}

function step(dt) {
  const s = session;
  s.time += dt;
  if (Number.isFinite(s.timeLeft)) s.timeLeft -= dt;

  if (jet.alive) {
    input.precisionAim = jet.role === 'aa' && camMode === 'bomb';
    const reloading = jet.reload > 0;
    jet.update(dt, s.menuOpen ? IDLE : input);
    if (jet.role === 'aa' && !reloading && jet.reload > 0 && jet.rounds > 0) {
      if (isAuthority()) reloadGroundWeapon(myId());
      else net.send({ t: 'aa-reload' });
    }
    if (jet.justLeftBounds) hud.message(pick(MSG.bounds), 'warn', 2);
    const ground = world.surfaceAt(jet.position.x, jet.position.z);
    if (jet.role !== 'aa') {
      if (jet.position.y - ground < 1.6) destroyJet(world.isWater(jet.position.x, jet.position.z) ? 'sea' : 'crash');
      else padCheck(dt);
    }
  } else if (s.respawnIn > 0) {
    s.respawnIn -= dt;
    if (s.respawnIn <= 0 && !s.outcome) respawn();
  }

  s.dropCooldown -= dt;
  const trigger = input.consume('dropPressed');
  if (trigger && !s.menuOpen && jet.role !== 'aa') tryDrop();
  if (jet.role === 'aa' && jet.alive && !s.menuOpen && (trigger || input.has('Space') || input.touch.fire)) groundFire();
  if (isAuthority()) {
    updateRaiders(dt);
    for (const p of s.players.values()) {
      if (p.local || p.role === 'aa' || !p.jet.alive || p.ai) continue;
      if (p.jet.position.distanceTo(PAD) < PAD_RADIUS && p.jet.position.y - PAD.y < PAD_MAX_AGL && p.jet.health < s.maxHealth && s.time > (p.healAt ?? 0)) {
        p.healAt = s.time + .35; combatDamage(p.id, -10);
      }
    }
  }

  for (const b of s.bombs) if (b.falling && b.step(dt, surfaceAt)) onImpact(b);

  const ctx = {
    targets: s.mode === 'defence' ? [] : s.targets,
    world,
    effects,
    range: s.level.range,
    fire: (p, dir) => {
      tracers.spawn(p, dir);
      sfx.flak(soundVolume(p) * 0.8);
      if (s.online) net.send({ t: 'fire', p: arr(p), d: arr(dir, 4) });
    },
  };
  for (const t of s.trucks) t.update(dt, ctx);
  tracers.step(dt, isAuthority() ? s.targets : [], world, (at, target, owner) => {
    const damage = owner === null ? s.diff.damage : s.diff.id === 'easy' ? 30 : s.diff.id === 'hard' ? 16 : 22;
    combatDamage(target.playerId, damage, owner);
  }, effects);
  if (s.online) netTick(dt);

  if (s.endTimer >= 0) {
    s.endTimer -= dt;
    if (s.endTimer < 0) finishRun();
  } else {
    checkEnd();
  }
}

// ---------- per-frame work ----------

function perFrame(dt) {
  const s = session;
  for (let i = s.bombs.length - 1; i >= 0; i--) {
    const b = s.bombs[i];
    if (b.falling) b.whistle?.setVolume?.(soundVolume(b.p));
    if (!b.falling && !b.updateLanded(dt)) {
      b.dispose();
      s.bombs.splice(i, 1);
    }
  }
  if (s.online) updateRemoteJets(dt);
  const thr = (jet.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  if (jet.glow) jet.glow.emissiveIntensity = 2.5 + thr * 3 + Math.sin(performance.now() * 0.04) * 0.6;
  sfx.engine(jet.role !== 'aa' && jet.alive && state === 'playing', thr);
  for (const p of s.players.values()) {
    const j = p.jet;
    if (!j.alive || j.health > s.maxHealth / 2) continue;
    p.smokeTimer = (p.smokeTimer ?? 0) - dt;
    if (p.smokeTimer < 0) {
      p.smokeTimer = 0.12;
      effects.puff(j.position.clone().addScaledVector(j.forward, -7), 0x4a4a4a, 1.6, 1.6, 2);
    }
  }
}

const markerMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
const trainingMarker = new THREE.Mesh(new THREE.RingGeometry(BLAST_RADIUS - 1.5, BLAST_RADIUS, 32).rotateX(-Math.PI / 2), markerMat);
const trainingArc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffe066, dashSize: 2, gapSize: 2 }));
trainingArc.frustumCulled = false;
scene.add(trainingMarker, trainingArc);
trainingMarker.visible = trainingArc.visible = false;

/** Numbers for the HUD and physics panel. Recomputed about 15 times a second. */
function computePhysics() {
  const s = session;
  const v = jet.velocity;
  const vh = Math.hypot(v.x, v.z);
  const tanPhi = Math.tan(Math.abs(jet.roll));
  const d = {
    speed: jet.speed,
    vh,
    vy: v.y,
    bankDeg: deg(jet.roll),
    pitchDeg: deg(jet.pitch),
    turnRateDeg: deg((G * tanPhi) / jet.speed),
    radius: tanPhi > 1e-3 ? (jet.speed * jet.speed) / (G * tanPhi) : Infinity,
    load: 1 / Math.cos(jet.roll),
  };

  const marker = s.diff.marker;
  const path = marker ? [] : null;
  const pred = jet.alive && s.bombsLeft > 0 ? simulateFall(dropStart(), v, s.wind, surfaceAt, 1 / 60, 40, path) : null;
  if (pred) {
    const start = dropStart();
    const h = start.y - pred.point.y;
    d.fall = {
      h,
      formulaT: (v.y + Math.sqrt(v.y * v.y + 2 * G * Math.max(0, h))) / G,
      t: pred.t,
      throw: vh * pred.t,
      drift: 0.5 * s.wind.length() * pred.t * pred.t,
      impactSpeed: pred.velocity.length(),
      point: pred.point,
    };
  }

  // Nearest truck, preferring ones in front of the nose. Trucks move, so aim where it will be
  // when the bomb lands: its position plus its velocity times the fall time.
  const fx = Math.sin(jet.yaw), fz = Math.cos(jet.yaw);
  const rx = -fz, rz = fx;
  let target = null;
  let bestRank = Infinity;
  for (const t of s.trucks) {
    if (!t.alive) continue;
    const dx = t.pos.x - jet.position.x, dz = t.pos.z - jet.position.z;
    const along = dx * fx + dz * fz;
    const lat = dx * rx + dz * rz;
    const rank = along > 0 ? Math.hypot(dx, dz) + Math.abs(lat) * 2 : Math.hypot(dx, dz) * 3 + 1000;
    if (rank < bestRank) { bestRank = rank; target = { truck: t, along, lat }; }
  }
  if (target && pred) {
    const t = target.truck;
    const mx = t.move.x * pred.t, mz = t.move.z * pred.t;
    target.drive = Math.hypot(mx, mz);
    const along = target.along + mx * fx + mz * fz;
    const lat = target.lat + mx * rx + mz * rz;
    const ix = pred.point.x - jet.position.x, iz = pred.point.z - jet.position.z;
    target.releaseIn = along - (ix * fx + iz * fz);
    target.steer = lat - (ix * rx + iz * rz);
    target.releaseSec = target.releaseIn / Math.max(vh, 1);
    target.inWindow = Math.abs(target.releaseIn) < BLAST_RADIUS * 0.7 && Math.abs(target.steer) < BLAST_RADIUS * 0.7;
  }
  if (target) delete target.truck;
  d.target = target;

  let last = null;
  for (let i = s.bombs.length - 1; i >= 0 && !last; i--) if (s.bombs[i].owner === myId()) last = s.bombs[i];
  if (last) {
    const travel = Math.hypot(last.p.x - last.release.p.x, last.p.z - last.release.p.z);
    if (last.falling) d.last = { falling: true, t: last.t, predT: last.prediction?.t ?? NaN, fallen: last.release.p.y - last.p.y, travel, speed: last.v.length() };
    else if (last.report) d.last = { falling: false, ...last.report };
  }

  trainingMarker.visible = trainingArc.visible = Boolean(marker && pred);
  if (trainingMarker.visible) {
    trainingMarker.position.copy(pred.point).y += 0.4;
    trainingArc.geometry.dispose();
    trainingArc.geometry = new THREE.BufferGeometry().setFromPoints(path);
    trainingArc.computeLineDistances();
  }
  return d;
}

function updateHud(dt) {
  const s = session;
  if (jet.role === 'aa') {
    hud.updateGround(jet, s);
    const aim = jet.muzzle().addScaledVector(jet.aimDirection(), 300).project(camera);
    const sight = document.getElementById('gun-sight');
    sight.style.left = `${(aim.x * .5 + .5) * window.innerWidth}px`;
    sight.style.top = `${(-aim.y * .5 + .5) * window.innerHeight}px`;
    trainingMarker.visible = trainingArc.visible = false;
    hud.setRelease(null);
  }
  s.physTimer -= dt;
  if (jet.role !== 'aa' && (s.physTimer <= 0 || !s.phys)) {
    s.physTimer = 1 / 15;
    s.phys = computePhysics();
    hud.renderPhysics(s.phys, s.diff.countdown);
    const t = s.phys.target;
    hud.setRelease(
      s.diff.countdown && jet.alive && s.phys.fall && t && t.along > 0 && t.releaseIn > -BLAST_RADIUS && t.releaseSec < 7 && Math.abs(t.steer) < 80
        ? t
        : null,
    );
  }
  const ground = world.heightAt(jet.position.x, jet.position.z);
  const windYaw = Math.atan2(s.wind.x, s.wind.z);
  hud.updateFlight({
    speed: jet.speed,
    agl: Math.max(0, jet.position.y - Math.max(ground, 0)),
    asl: jet.position.y,
    throttle: jet.role === 'aa' ? Math.abs(jet.speed) / 23 : (jet.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED),
    trucksLeft: s.trucks.filter((t) => t.alive).length,
    trucksTotal: s.trucks.length,
    health: (100 * jet.health) / s.maxHealth,
    wind: s.wind.length(),
    windRel: -(windYaw - jet.yaw),
    autoTurn: jet.autoTurn,
    pad: s.onPad ? `Reloading: ${s.bombsLeft} / ${s.level.bombs} bombs` : null,
    respawn: !jet.alive && s.respawnIn > 0 ? `Respawning in ${Math.ceil(s.respawnIn)} s` : null,
  });
  const others = [...s.players.values()].filter((p) => !p.local && p.jet.alive).map((p) => ({ x: p.jet.position.x, z: p.jet.position.z, yaw: p.jet.yaw, color: p.role === 'aa' ? '#88c567' : p.ai ? '#ff7777' : JETS[p.jetIndex].color }));
  hud.drawRadar(jet, s.trucks, s.bombs, s.diff.marker ? s.phys?.fall?.point : null, radarLand, others);
  if (s.online || s.mode === 'defence') {
    s.boardTimer -= dt;
    if (s.boardTimer <= 0) {
      s.boardTimer = 0.25;
      hud.setBoard({
        timeLeft: s.timeLeft,
        rows: [...s.players.values()].filter((p) => !p.ai).map((p) => ({
          name: p.local ? `${p.name} (you)` : p.name,
          color: p.role === 'aa' ? '#88c567' : JETS[p.jetIndex].color,
          kills: p.stats.kills,
          alive: p.jet.alive,
        })),
      });
    }
    for (const p of s.players.values()) {
      if (p.local) continue;
      const at = p.jet.position.clone();
      at.y += 7;
      at.project(camera);
      hud.placeLabel(p.id, p.jet.alive && at.z < 1 ? { x: (at.x * 0.5 + 0.5) * window.innerWidth, y: (-at.y * 0.5 + 0.5) * window.innerHeight } : null);
    }
  }
}

// ---------- cameras ----------

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const wantPos = new THREE.Vector3();
const wantLook = new THREE.Vector3();
let shakeAmt = 0;
let menuAngle = 0.6;
let menuJetAngle = 0;

function shake(p, strength) {
  const d = camera.position.distanceTo(p);
  shakeAmt = Math.max(shakeAmt, strength * clamp(1 - d / 300, 0, 1));
}

function chasePose(pos, look) {
  if (jet.role === 'aa') {
    const dir = jet.aimDirection();
    if (camMode === 'bomb') {
      pos.copy(jet.muzzle()).addScaledVector(dir, 1);
      look.copy(pos).addScaledVector(dir, 300);
    } else {
      pos.set(jet.position.x - Math.sin(jet.turretYaw) * 32, jet.position.y + 12, jet.position.z - Math.cos(jet.turretYaw) * 32);
      look.copy(jet.muzzle()).addScaledVector(dir, 35);
    }
    return;
  }
  const fx = Math.sin(jet.yaw), fz = Math.cos(jet.yaw);
  pos.set(jet.position.x - fx * 32, jet.position.y + 10, jet.position.z - fz * 32);
  look.copy(jet.position).addScaledVector(jet.forward, 45);
  look.y -= 6;
}

function bombPose(b, pos, look) {
  const len = Math.hypot(b.v.x, b.v.z) || 1;
  pos.set(b.p.x - (b.v.x / len) * 20, b.p.y + 9, b.p.z - (b.v.z / len) * 20);
  look.copy(b.p);
  if (b.prediction) look.lerp(b.prediction.point, 0.35);
}

function snapCamera() {
  chasePose(camPos, camLook);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

function fallingBomb() {
  if (!session) return null;
  for (let i = session.bombs.length - 1; i >= 0; i--) {
    const b = session.bombs[i];
    if (b.falling && b.owner === myId()) return b;
  }
  return null;
}

function updateCamera(dt) {
  if (state === 'menu' || state === 'tutorial' || state === 'loading' || state === 'online' || state === 'lobby') {
    menuAngle += dt * 0.05;
    const r = world.map.id === 'large' ? 760 : 430;
    camera.position.set(Math.cos(menuAngle) * r, world.map.id === 'large' ? 340 : 165, Math.sin(menuAngle) * r);
    camera.lookAt(0, 5, 0);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }
  if (state === 'playing') {
    const b = camMode === 'bomb' ? fallingBomb() : null;
    if (b) bombPose(b, wantPos, wantLook);
    else if (jet.alive) chasePose(wantPos, wantLook);
    else { wantPos.copy(camPos); wantLook.copy(session.crashPoint); }
    if (jet.role === 'aa' && camMode === 'bomb' && jet.alive) {
      camPos.copy(wantPos); camLook.copy(wantLook);
    } else {
      camPos.lerp(wantPos, 1 - Math.exp(-dt * (jet.role === 'aa' ? 12 : 6)));
      camLook.lerp(wantLook, 1 - Math.exp(-dt * (jet.role === 'aa' ? 18 : 10)));
    }
    const floor = world.surfaceAt(camPos.x, camPos.z) + 3;
    if (camPos.y < floor) camPos.y = floor;
    shakeAmt *= Math.exp(-dt * 4);
  }
  camera.position.copy(camPos);
  if (shakeAmt > 0.01) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt));
  camera.lookAt(camLook);
  const fov = jet.role === 'aa' ? (camMode === 'bomb' ? 42 : 80) : 58 + ((jet.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)) * 14;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }
}

function menuJet(dt) {
  menuJetAngle += dt * 0.35;
  const r = 130;
  jet.position.set(15 + Math.cos(menuJetAngle) * r, 70, 15 + Math.sin(menuJetAngle) * r);
  jet.yaw = Math.atan2(-Math.sin(menuJetAngle), Math.cos(menuJetAngle));
  jet.roll = 0.45;
  jet.pitch = 0;
  jet.object.visible = true;
  jet.applyTransform();
  if (jet.glow) jet.glow.emissiveIntensity = 3 + Math.sin(performance.now() * 0.04) * 0.6;
}

function render() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.render(scene, camera);

  const b = (state === 'playing' || state === 'paused') && camMode === 'chase' ? fallingBomb() : null;
  if (!b) {
    hud.setPip(null);
    return;
  }
  const pw = Math.round(Math.min(380, w * 0.32));
  const ph = Math.round(pw * 0.6);
  const left = isTouch ? Math.round((w - pw) / 2) : w - pw - 14;
  const top = isTouch ? 12 : h - ph - 14;
  bombPose(b, pipCam.position, wantLook);
  pipCam.lookAt(wantLook);
  pipCam.aspect = pw / ph;
  pipCam.updateProjectionMatrix();
  const glY = h - top - ph;
  renderer.setScissorTest(true);
  renderer.setScissor(left, glY, pw, ph);
  renderer.setViewport(left, glY, pw, ph);
  renderer.render(scene, pipCam);
  renderer.setScissorTest(false);
  hud.setPip({ left, top, width: pw, height: ph });
}

// ---------- main loop ----------

let last = performance.now();
let acc = 0;
let clock = 0;

let lastFrameAt = 0;

function frame(now) {
  requestAnimationFrame(frame);
  lastFrameAt = performance.now();
  tick(now, true);
}

// Browsers stop animation frames in background tabs and minimised windows. Online, the game must
// keep running there (the host runs the trucks), so a worker timer, which is not paused, steps it
// whenever frames have stalled.
const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33);'], { type: 'text/javascript' })));
ticker.onmessage = () => {
  if (online() && performance.now() - lastFrameAt > 150) tick(performance.now(), false);
};

function tick(now, draw) {
  const dt = Math.min(0.1, Math.max(0, now - last) / 1000);
  last = now;
  clock += dt;

  if (input.consume('pausePressed')) {
    if (state === 'playing' && !session?.menuOpen) pause();
    else if (state === 'paused' || session?.menuOpen) resume();
  }
  if (input.consume('camPressed') && state === 'playing') {
    camMode = camMode === 'chase' ? 'bomb' : 'chase';
    hud.message(jet.role === 'aa' ? (camMode === 'bomb' ? 'Gunner sight' : 'Vehicle chase camera') : camMode === 'bomb' ? 'Bomb cam: follows your next bomb down. Press C to go back.' : 'Chase cam', 'info', 1.8);
  }
  if (input.consume('physicsToggle')) hud.togglePhysics();
  if (state !== 'playing') input.dropPressed = false;

  if (state === 'playing') {
    acc += dt;
    while (acc >= STEP) {
      step(STEP);
      acc -= STEP;
      if (state !== 'playing') { acc = 0; break; }
    }
    if (session) perFrame(dt);
  } else if (state === 'menu' || state === 'tutorial' || state === 'online' || state === 'lobby') {
    menuJet(dt);
  }
  if (state !== 'paused') effects?.update(dt);

  world.update(dt, clock, camera.position);
  updateCamera(dt);
  world.followShadow(state === 'playing' || state === 'paused' || state === 'results' ? camLook : jet.position);
  if (!draw) return;
  if (session && (state === 'playing' || state === 'paused')) updateHud(dt);
  render();
}

boot().catch((err) => {
  console.error(err);
  hud.showError(`Could not start the game: ${err.message}`);
});

// Exposed for quick checks from the browser console.
window.__islandBomber = {
  simulateFall, G, STEP, net, renderer, sfx,
  get session() { return session; },
  get jet() { return jet; },
  get world() { return world; },
  get state() { return state; },
  physicsNow: () => computePhysics(),
  /** Runs the simulation for `seconds` without rendering, for testing. */
  advance(seconds) {
    for (let i = 0; i < seconds / STEP && state === 'playing'; i++) step(STEP);
  },
};
