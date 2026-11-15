import { test, expect } from '@playwright/test';
import path from 'node:path';

async function load(page, ground = false) {
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', (route) => route.fulfill({
    path: path.resolve('node_modules/three', route.request().url().split('three@0.170.0/')[1]), contentType: 'application/javascript',
  }));
  await page.goto('/'); await expect(page.locator('#menu')).toBeVisible();
  await page.evaluate(() => { window.__islandBomber.renderer.render = () => {}; });
  if (ground) await page.locator('#role-list button').nth(1).click();
  await page.locator('#btn-fly').click();
  if (await page.locator('#tutorial').isVisible()) await page.locator('#btn-tut-go').click();
  await expect.poll(() => page.evaluate(() => window.__islandBomber.state)).toBe('playing');
  await page.evaluate(() => {
    const g = window.__islandBomber;
    for (const t of g.session.trucks) t.cooldown = Infinity;
    window.recordedAudio = [];
    const original = g.sfx.ctx.createBufferSource.bind(g.sfx.ctx);
    g.sfx.ctx.createBufferSource = () => {
      const source = original(), start = source.start.bind(source);
      source.start = (...args) => {
        const name = Object.keys(g.sfx.samples).find((key) => g.sfx.samples[key] === source.buffer);
        if (name) window.recordedAudio.push({ name, rate: source.playbackRate.value });
        return start(...args);
      };
      return source;
    };
  });
}

test('recorded bomb fall fits flight, pauses with physics, and gives way to the impact recording', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await load(page);
  const samples = await page.evaluate(() => Object.fromEntries(Object.entries(window.__islandBomber.sfx.samples).map(([key, b]) => [key, { duration: b.duration, sampleRate: b.sampleRate }])));
  expect(samples.bomb.duration).toBeCloseTo(4.204, 2);
  expect(samples.gun.duration).toBeCloseTo(.673, 2);
  expect(samples.explosion.duration).toBeCloseTo(8.865, 2);
  expect(samples.bomb.sampleRate).toBe(48000);
  await page.evaluate(() => {
    const g = window.__islandBomber;
    g.jet.position.set(0, g.world.surfaceAt(0, 45) + 55, 45);
    g.jet.velocity.set(0, 0, 0); g.jet.speed = 0; g.jet.update = () => {};
  });
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__islandBomber.sfx.voices.bomb.size)).toBe(1);
  expect(await page.evaluate(() => {
    const g = window.__islandBomber;
    return window.recordedAudio.find((a) => a.name === 'bomb').rate * g.session.bombs[0].prediction.t;
  })).toBeCloseTo(samples.bomb.duration, 2);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__islandBomber.sfx.ctx.state)).toBe('suspended');
  const at = await page.evaluate(() => window.__islandBomber.sfx.ctx.currentTime);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__islandBomber.sfx.ctx.currentTime) - at).toBeLessThan(.03);
  await page.locator('#btn-resume').click();
  await expect.poll(() => page.evaluate(() => window.__islandBomber.sfx.ctx.state)).toBe('running');
  await page.evaluate(() => window.__islandBomber.advance(4));
  expect(await page.evaluate(() => window.__islandBomber.sfx.voices.bomb.size)).toBe(0);
  expect(await page.evaluate(() => window.recordedAudio.some((a) => a.name === 'explosion'))).toBe(true);
  await page.keyboard.press('Escape'); await page.locator('#btn-quit').click();
  expect(await page.evaluate(() => Object.values(window.__islandBomber.sfx.voices).every((set) => set.size === 0))).toBe(true);
  expect(errors).toEqual([]);
});

test('ground firing plays the supplied gun recording and bounds overlapping combat sounds', async ({ page }) => {
  await load(page, true);
  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => window.recordedAudio.some((a) => a.name === 'gun'))).toBe(true);
  await page.keyboard.up('Space');
  const voices = await page.evaluate(() => {
    const sfx = window.__islandBomber.sfx;
    for (let i = 0; i < 30; i++) { sfx.flak(); sfx.boom(); }
    return { gun: sfx.voices.gun.size, explosion: sfx.voices.explosion.size, compressor: sfx.compressor.ratio.value };
  });
  expect(voices.gun).toBe(12); expect(voices.explosion).toBe(6); expect(voices.compressor).toBeGreaterThan(1);
});

test('missing recordings retain playable synthesized sound effects', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/assets/audio/*.wav', (route) => route.fulfill({ status: 404, body: 'missing' }));
  await load(page, true);
  expect(await page.evaluate(() => Object.keys(window.__islandBomber.sfx.samples))).toEqual([]);
  await page.evaluate(() => { const sfx = window.__islandBomber.sfx; sfx.flak(); sfx.boom(); const w = sfx.whistle(1); w.setVolume(.2); w.stop(); });
  expect(errors).toEqual([]);
});
