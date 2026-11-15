import { test, expect } from '@playwright/test';
import path from 'node:path';

async function load(page, draw = false) {
  page.on('pageerror', (e) => console.error('GAME ERROR:', e.message));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', (route) => {
    const relative = route.request().url().split('three@0.170.0/')[1];
    return route.fulfill({ path: path.resolve('node_modules/three', relative), contentType: 'application/javascript' });
  });
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible();
  // Functional tests keep input, physics and sockets live, but avoid continuous software GPU work.
  await page.evaluate((draw) => { const r = window.__islandBomber.renderer; r.setPixelRatio(draw ? .7 : .4); r.shadowMap.enabled = false; if (!draw) r.render = () => {}; }, draw);
}
async function solo(page) {
  await page.locator('#btn-fly').click();
  if (await page.locator('#tutorial').isVisible()) await page.locator('#btn-tut-go').click();
  await expect.poll(() => page.evaluate(() => window.__islandBomber.state)).toBe('playing');
}
async function room(host, guest, hostGround) {
  await load(host); await load(guest);
  await (hostGround ? host : guest).locator('#role-list button').nth(1).click();
  await host.locator('#btn-online').click(); await host.locator('#btn-create').click();
  await expect(host.locator('#lobby')).toBeVisible();
  await host.locator('#lobby-maps button').nth(1).click();
  const code = await host.locator('#lobby-code').textContent();
  await guest.locator('#btn-online').click(); await guest.locator('#join-code').fill(code); await guest.locator('#btn-join').click();
  await expect(host.locator('#lobby-players li')).toHaveCount(2);
  await expect(host.locator('#lobby-role-note')).toContainText('Air vs ground');
  await host.locator('#btn-lobby-start').click();
  for (const p of [host, guest]) await expect.poll(() => p.evaluate(() => window.__islandBomber.state)).toBe('playing');
}

test('both maps load, large levels place 20/24/28 vehicles, switching retains the original island', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await load(page);
  for (const [mapIndex, levelIndex, count] of [[1, 0, 20], [1, 1, 24], [1, 2, 28], [0, 0, 4]]) {
    await page.locator('#map-list button').nth(mapIndex).click();
    await page.locator('#level-list button').nth(levelIndex).click();
    await solo(page);
    const data = await page.evaluate(() => {
      const g = window.__islandBomber, w = g.world;
      return { trucks: g.session.trucks.length, dry: g.session.trucks.every((t) => w.drivable(t.pos.x, t.pos.z)), map: w.map.id, ground: w.heightAt(0, 0), buildings: w.buildings.length };
    });
    expect(data.trucks).toBe(count); expect(data.dry).toBe(true);
    expect(Number.isFinite(data.ground)).toBe(true);
    expect(data.map).toBe(mapIndex ? 'large' : 'small');
    expect(data.buildings).toBe(mapIndex ? 50 : 0);
    if (mapIndex === 1 && levelIndex === 0) await page.screenshot({ path: 'test-results/large-jet.png' });
    await page.keyboard.press('Escape'); await page.locator('#btn-quit').click();
  }
  expect(errors).toEqual([]);
});

test('solo ground role drives, aims, fires, reloads, and faces bombing AI', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await load(page); await page.locator('#map-list button').nth(1).click();
  await page.locator('#role-list button').nth(1).click(); await solo(page);
  await expect(page.locator('#gun-sight')).toBeVisible();
  const initial = await page.evaluate(() => { const g = window.__islandBomber; return { pos: g.jet.position.toArray(), aim: g.jet.turretYaw, bots: [...g.session.players.values()].filter((p) => p.ai).length }; });
  expect(initial.bots).toBe(3);
  await page.keyboard.down('w'); await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(500); await page.keyboard.up('w'); await page.keyboard.up('ArrowLeft');
  const moved = await page.evaluate(() => ({ pos: window.__islandBomber.jet.position.toArray(), aim: window.__islandBomber.jet.turretYaw }));
  expect(moved.pos).not.toEqual(initial.pos); expect(moved.aim).not.toBe(initial.aim);
  await page.keyboard.down('Space'); await page.waitForTimeout(450); await page.keyboard.up('Space');
  expect(await page.evaluate(() => window.__islandBomber.jet.rounds)).toBeLessThan(30);
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => window.__islandBomber.jet.reload > 0)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__islandBomber.jet.rounds)).toBe(30);
  await page.keyboard.press('c'); await page.screenshot({ path: 'test-results/ground-sight.png' });
  await page.evaluate(() => window.__islandBomber.advance(5));
  expect(await page.evaluate(() => [...window.__islandBomber.session.players.values()].some((p) => p.ai && p.stats.dropped > 0))).toBe(true);
  expect(errors).toEqual([]);
});

for (const hostGround of [true, false]) {
  test(`mixed multiplayer: ${hostGround ? 'host' : 'guest'} gunner shoots down jet; jet bombs gunner; both respawn`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const host = await context.newPage(), guest = await context.newPage();
    const errors = []; for (const p of [host, guest]) p.on('pageerror', (e) => errors.push(e.message));
    await room(host, guest, hostGround);
    // Isolate player-vs-player damage from the randomly placed NPC flak batteries.
    await host.evaluate(() => { for (const t of window.__islandBomber.session.trucks) t.cooldown = Infinity; });
    const gun = hostGround ? host : guest, plane = hostGround ? guest : host;
    for (const p of [host, guest]) expect(await p.evaluate(() => ({ map: window.__islandBomber.world.map.id, mode: window.__islandBomber.session.mode, trucks: window.__islandBomber.session.trucks.length }))).toEqual({ map: 'large', mode: 'battle', trucks: 20 });
    const target = await gun.evaluate(() => {
      const j = window.__islandBomber.jet;
      j.turretYaw = 0; j.gunPitch = 1.2; j.applyTransform();
      return j.muzzle().addScaledVector(j.aimDirection(), 65).toArray();
    });
    await plane.evaluate((pos) => {
      const j = window.__islandBomber.jet; j.position.set(...pos); j.speed = 0; j.velocity.set(0, 0, 0); j.update = () => {};
    }, target);
    await expect.poll(() => gun.evaluate((pos) => {
      const p = [...window.__islandBomber.session.players.values()].find((p) => p.role === 'jet');
      return Math.hypot(p.jet.position.x - pos[0], p.jet.position.y - pos[1], p.jet.position.z - pos[2]);
    }, target)).toBeLessThan(1);
    await gun.bringToFront();
    await gun.keyboard.down('Space');
    await expect.poll(() => plane.evaluate(() => window.__islandBomber.session.me.stats.deaths)).toBe(1);
    await gun.keyboard.up('Space');
    await expect.poll(() => gun.evaluate(() => window.__islandBomber.session.me.stats.kills)).toBe(1);
    await expect.poll(() => plane.evaluate(() => window.__islandBomber.jet.life)).toBe(1);
    await expect.poll(() => gun.evaluate(() => [...window.__islandBomber.session.players.values()].find((p) => p.role === 'jet').jet.alive)).toBe(true);
    const ground = await gun.evaluate(() => window.__islandBomber.jet.position.toArray());
    await plane.evaluate((pos) => {
      const j = window.__islandBomber.jet; j.position.set(pos[0], pos[1] + 55, pos[2]); j.velocity.set(0, 0, 0); j.speed = 0;
    }, ground);
    await plane.bringToFront();
    await plane.keyboard.press('Space');
    await expect.poll(() => plane.evaluate(() => window.__islandBomber.session.me.stats.dropped)).toBe(1);
    await expect.poll(() => gun.evaluate(() => window.__islandBomber.session.me.stats.deaths)).toBe(1);
    await expect.poll(() => plane.evaluate(() => window.__islandBomber.session.me.stats.kills)).toBe(1);
    await expect.poll(() => gun.evaluate(() => window.__islandBomber.jet.life)).toBe(1);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('ground-only co-op synchronizes AI raiders, their bombs and the defence result', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const host = await context.newPage(), guest = await context.newPage();
  await load(host); await load(guest);
  for (const p of [host, guest]) await p.locator('#role-list button').nth(1).click();
  await host.locator('#btn-online').click(); await host.locator('#btn-create').click();
  await expect(host.locator('#lobby')).toBeVisible();
  const code = await host.locator('#lobby-code').textContent();
  await guest.locator('#btn-online').click(); await guest.locator('#join-code').fill(code); await guest.locator('#btn-join').click();
  await expect(host.locator('#lobby-players li')).toHaveCount(2);
  await expect(host.locator('#lobby-role-note')).toContainText('Ground defence');
  await host.locator('#btn-lobby-start').click();
  for (const p of [host, guest]) {
    await expect.poll(() => p.evaluate(() => window.__islandBomber.state)).toBe('playing');
    expect(await p.evaluate(() => ({ mode: window.__islandBomber.session.mode, bots: [...window.__islandBomber.session.players.values()].filter((p) => p.ai).length }))).toEqual({ mode: 'defence', bots: 3 });
  }
  await host.evaluate(() => window.__islandBomber.advance(5));
  await expect.poll(() => guest.evaluate(() => [...window.__islandBomber.session.players.values()].some((p) => p.ai && p.stats.dropped > 0))).toBe(true);
  // Exercise the host's objective and results propagation without a six-kill manual firing session.
  await host.evaluate(() => { const g = window.__islandBomber; g.session.me.stats.kills = 6; g.advance(3); });
  await expect(host.locator('#res-title')).toHaveText('Island defended, together!');
  await expect(guest.locator('#res-title')).toHaveText('Island defended, together!');
  await context.close();
});

test('renders map chooser and the large-map ground vehicle view', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await load(page, true);
  await page.locator('#map-list button').nth(1).click();
  await page.locator('#role-list button').nth(1).click();
  await page.locator('#menu .card').evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: 'design/map_selection.png' });
  await solo(page);
  await expect(page.locator('#ground-status')).toBeVisible();
  await page.screenshot({ path: 'design/ground_gameplay.png' });
  expect(errors).toEqual([]);
});

test('touch ground controls can fire a quick tap and aim with the second stick', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); await load(page);
  await page.locator('#role-list button').nth(1).click(); await solo(page);
  await expect(page.locator('#touch')).toBeVisible();
  const button = await page.locator('#t-bomb').boundingBox();
  await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
  await expect.poll(() => page.evaluate(() => window.__islandBomber.jet.rounds)).toBeLessThan(30);
  const before = await page.evaluate(() => window.__islandBomber.jet.turretYaw);
  const aim = await page.locator('#aim-stick').boundingBox();
  await page.mouse.move(aim.x + aim.width * .8, aim.y + aim.height / 2); await page.mouse.down();
  await page.waitForTimeout(250); await page.mouse.up();
  expect(await page.evaluate(() => window.__islandBomber.jet.turretYaw)).not.toBe(before);
  await context.close();
});

test('fullscreen captures ground aiming, precision sight slows aim, and Escape releases safely', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await load(page);
  await page.locator('#role-list button').nth(1).click(); await solo(page);
  const initialYaw = await page.evaluate(() => window.__islandBomber.jet.turretYaw);
  await page.mouse.move(800, 400);
  expect(await page.evaluate(() => window.__islandBomber.jet.turretYaw)).toBe(initialYaw);
  await page.locator('#btn-aim-fullscreen').click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
  expect(await page.evaluate(() => window.__islandBomber.jet.rounds)).toBe(30);
  await page.mouse.move(700, 500);
  await page.mouse.move(2100, 500, { steps: 4 });
  await expect.poll(() => page.evaluate(() => window.__islandBomber.jet.turretYaw)).not.toBe(initialYaw);
  expect(await page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
  const moveAim = () => page.evaluate(() => {
    const g = window.__islandBomber, before = g.jet.turretYaw;
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 20, movementY: 0 }));
    g.advance(.01);
    return Math.abs(g.jet.turretYaw - before);
  });
  const normal = await moveAim();
  await page.keyboard.press('c');
  await expect(page.locator('#messages')).toContainText('Gunner sight');
  const precision = await moveAim();
  expect(precision).toBeCloseTo(normal * .45, 4);
  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => window.__islandBomber.jet.rounds)).toBeLessThan(30);
  await page.keyboard.press('Escape'); await page.keyboard.up('Space');
  await expect(page.locator('#pause')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  await page.locator('#btn-resume').click();
  const rounds = await page.evaluate(() => window.__islandBomber.jet.rounds);
  await page.evaluate(() => window.__islandBomber.advance(.5));
  expect(await page.evaluate(() => window.__islandBomber.jet.rounds)).toBe(rounds);
  await page.locator('#aim-sensitivity').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('#aim-sensitivity-value')).toHaveText('40%');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('island-bomber:aim-sensitivity')))).toBe(.4);
  if (await page.evaluate(() => Boolean(document.fullscreenElement))) await page.evaluate(() => document.exitFullscreen());
  expect(errors).toEqual([]);
});

test('ground keyboard aim remains available when mouse capture is unsupported', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await load(page); await page.locator('#role-list button').nth(1).click(); await solo(page);
  await page.evaluate(() => { document.getElementById('game').requestPointerLock = undefined; document.documentElement.requestFullscreen = undefined; });
  await page.locator('#game').click({ position: { x: 600, y: 300 } });
  await expect(page.locator('#aim-capture-hint')).toContainText('arrow keys');
  const yaw = await page.evaluate(() => window.__islandBomber.jet.turretYaw);
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(150); await page.keyboard.up('ArrowLeft');
  expect(await page.evaluate(() => window.__islandBomber.jet.turretYaw)).not.toBe(yaw);
  expect(errors).toEqual([]);
});
