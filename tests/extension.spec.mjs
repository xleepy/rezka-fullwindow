import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let context, profile;
const url = 'https://rezka.ag/series/test.html';
const fixture = `<!doctype html><style>
 body { margin: 0; min-height: 2000px; }
 main { margin: 80px; transform: translateX(20px); overflow: hidden; }
 #cdnplayer-container, #cdnplayer { width: 640px; height: 360px; }
 video { width: 100%; height: 100%; }
 </style><main><div id="cdnplayer-container"><div id="cdnplayer"><video controls></video></div></div>
 <button id="outside">Outside</button><button id="already-inert" inert>Unavailable</button></main>`;

test.beforeAll(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'rezka-extension-'));
  const extension = path.resolve('dist');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route('https://rezka.ag/**', route => route.fulfill({
    contentType: 'text/html', body: fixture,
  }));
});

test.afterAll(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

test.afterEach(async () => {
  for (const page of context.pages()) await page.close();
});

test('installed extension expands, resizes, and restores without replacing video', async () => {
  const page = await context.newPage();
  await page.goto(url);
  const player = page.locator('#cdnplayer-container');
  const original = await player.boundingBox();
  await page.evaluate(() => { window.originalVideo = document.querySelector('video'); });
  await page.getByRole('button', { name: 'Fill window', exact: true }).click();
  await expect(player).toHaveClass(/rwp-player/);
  for (const viewport of [{ width: 1200, height: 800 }, { width: 900, height: 600 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => player.boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
    expect(await page.locator('video').boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
  }
  expect(await page.locator('#outside').evaluate(e => e.inert)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(player).not.toHaveClass(/rwp-player/);
  expect(await player.boundingBox()).toEqual(original);
  expect(await page.locator('#outside').evaluate(e => e.inert)).toBe(false);
  expect(await page.locator('#already-inert').evaluate(e => e.inert)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('video') === window.originalVideo)).toBe(true);
});

test('real extension messaging toggles without duplicate controls', async () => {
  const page = await context.newPage();
  await page.goto(url);
  await expect(page.locator('#rwp-controls')).toHaveCount(1);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({});
    await chrome.tabs.sendMessage(tab.id, { type: 'rezka-window-toggle' });
  });
  await expect(page.locator('#cdnplayer-container')).toHaveClass(/rwp-player/);
  await expect(page.locator('#rwp-controls')).toHaveCount(1);
  await page.getByRole('button', { name: 'Restore player' }).click();
  await expect(page.locator('#cdnplayer-container')).not.toHaveClass(/rwp-player/);
});

test('player replacement restores the page and supports a new player', async () => {
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole('button', { name: 'Fill window', exact: true }).click();
  await page.locator('#cdnplayer-container').evaluate(e => e.remove());
  await expect(page.locator('html')).not.toHaveClass(/rwp-active/);
  await expect(page.locator('#rwp-controls')).toHaveCount(0);
  await page.locator('main').evaluate(e => e.insertAdjacentHTML('afterbegin',
    '<div id="cdnplayer-container"><div id="cdnplayer"><video controls></video></div></div>'));
  await page.getByRole('button', { name: 'Fill window', exact: true }).click();
  await expect(page.locator('#cdnplayer-container')).toHaveClass(/rwp-player/);
});

test('missing player shows a message when requested through Chrome messaging', async () => {
  const page = await context.newPage();
  await page.goto(url);
  await expect(page.locator('#rwp-controls')).toHaveCount(1);
  await page.locator('#cdnplayer-container').evaluate(e => e.remove());
  await expect(page.locator('#rwp-controls')).toHaveCount(0);
  const worker = context.serviceWorkers()[0];
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({});
    await chrome.tabs.sendMessage(tab.id, { type: 'rezka-window-toggle' });
  });
  await expect(page.getByRole('status')).toContainText('Player not found');
});
