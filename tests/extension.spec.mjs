import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let context, profile;
const url = 'https://rezka.ag/series/drama/49231-medved-2022-latest/1-lostfilm/2-season/2-episode.html';
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
  await context.route('https://rezka.ag/**', route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === '/test.wav') {
      const samples = Number(requestUrl.searchParams.get('duration')) * 8000;
      const wav = Buffer.alloc(44 + samples, 128);
      wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples, 4);
      wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
      wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
      wav.write('data', 36); wav.writeUInt32LE(samples, 40);
      return route.fulfill({ contentType: 'audio/wav', body: wav });
    }
    return route.fulfill({ contentType: 'text/html', body: fixture });
  });
});

test.afterAll(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

test.afterEach(async () => {
  for (const page of context.pages()) await page.close();
});

async function expectToggleAboveControls(page) {
  await expect.poll(async () => {
    const player = await page.locator('#cdnplayer-container').boundingBox();
    const toggle = await page.locator('#rwp-controls #toggle').boundingBox();
    return {
      right: Math.round(player.x + player.width - toggle.x - toggle.width),
      bottom: Math.round(player.y + player.height - toggle.y - toggle.height),
    };
  }).toEqual({ right: 12, bottom: 64 });
}

test('installed extension expands, resizes, and restores without replacing video', async () => {
  const page = await context.newPage();
  await page.goto(url);
  const player = page.locator('#cdnplayer-container');
  const original = await player.boundingBox();
  await expectToggleAboveControls(page);
  await page.evaluate(() => window.scrollTo(0, 100));
  await expectToggleAboveControls(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => { window.originalVideo = document.querySelector('video'); });
  await page.getByRole('button', { name: 'Fill window', exact: true }).click();
  await expect(player).toHaveClass(/rwp-player/);
  for (const viewport of [{ width: 1200, height: 800 }, { width: 900, height: 600 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => player.boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
    expect(await page.locator('video').boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
    await expectToggleAboveControls(page);
  }
  expect(await page.locator('#outside').evaluate(e => e.inert)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(player).not.toHaveClass(/rwp-player/);
  expect(await player.boundingBox()).toEqual(original);
  await expectToggleAboveControls(page);
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
  await expectToggleAboveControls(page);
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

async function addEpisodes(page, replacePlayer = false) {
  await page.locator('main').evaluate((main, replace) => {
    main.insertAdjacentHTML('beforeend', `<ul id="episodes">
      <li class="b-simple_episode__item active">Episode 1</li>
      <li class="b-simple_episode__item">Episode 2</li>
      <li class="b-simple_episode__item">Episode 3</li></ul>`);
    document.querySelector('#episodes').addEventListener('click', event => {
      window.episodeClicks = (window.episodeClicks || 0) + 1;
      document.querySelector('.b-simple_episode__item.active').classList.remove('active');
      event.target.classList.add('active');
      if (replace) {
        document.querySelector('#cdnplayer-container').remove();
        setTimeout(() => main.insertAdjacentHTML('afterbegin',
          '<div id="cdnplayer-container"><video controls></video></div>'), 100);
      }
    });
  }, replacePlayer);
}

async function playback(page, currentTime, duration = 1000) {
  await page.locator('video').evaluate(async (video, values) => {
    if (!Number.isFinite(values.duration)) {
      video.removeAttribute('src');
      delete video.dataset.fixtureSrc;
      video.load();
      return;
    }
    const src = `/test.wav?duration=${values.duration}`;
    if (video.dataset.fixtureSrc !== src) {
      const media = await (await fetch(src)).blob();
      const mediaUrl = URL.createObjectURL(media);
      if (video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
      video.dataset.fixtureSrc = src;
      await new Promise((resolve, reject) => {
        video.addEventListener('canplay', resolve, { once: true });
        video.addEventListener('error', () => reject(new Error('Fixture media failed')), { once: true });
        video.src = mediaUrl;
      });
    }
    video.currentTime = values.currentTime;
  }, { currentTime, duration });
  if (Number.isFinite(duration)) {
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBe(currentTime);
  }
}

test('next episode appears near the end, follows seeking, and preserves full window mode', async () => {
  const page = await context.newPage();
  await page.goto(url);
  await addEpisodes(page);
  const next = page.getByRole('button', { name: 'Next episode', exact: true });
  await playback(page, 910);
  await expect(next).toBeHidden();
  await page.getByRole('button', { name: 'Fill window', exact: true }).click();
  await expect(next).toBeVisible();
  await playback(page, 909);
  await expect(next).toBeHidden();
  await playback(page, 950);
  await expect(next).toBeVisible();
  await next.click();
  await expect(page.locator('.b-simple_episode__item.active')).toHaveText('Episode 2');
  await expect(next).toBeHidden();
  await expect(page.locator('#cdnplayer-container')).toHaveClass(/rwp-player/);
  expect(await page.evaluate(() => window.episodeClicks)).toBe(1);
  await playback(page, 0);
  await expect(next).toBeHidden();
  // Allow the playback monitor to observe the new episode before seeking.
  await page.waitForTimeout(600);
  await playback(page, 1000);
  await expect(next).toBeVisible();
  await next.click();
  await expect(page.locator('.b-simple_episode__item.active')).toHaveText('Episode 3');
  await expect(next).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).not.toHaveClass(/rwp-active/);
});

test('next episode keeps full window mode after asynchronous player replacement', async () => {
  const page = await context.newPage();
  await page.goto(url);
  await addEpisodes(page, true);
  await page.getByRole('button', { name: 'Fill window', exact: true }).click();
  await playback(page, 990);
  await page.getByRole('button', { name: 'Next episode', exact: true }).click();
  await expect(page.locator('#cdnplayer-container')).toHaveClass(/rwp-player/);
  await expect(page.getByRole('button', { name: 'Next episode', exact: true })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#outside')).not.toHaveAttribute('inert');
});

test('next episode handles short videos, unknown duration, disabled and missing episodes', async () => {
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole('button', { name: 'Fill window', exact: true }).click();
  const next = page.getByRole('button', { name: 'Next episode', exact: true });
  await playback(page, 999);
  await expect(next).toBeHidden();
  await addEpisodes(page);
  await playback(page, 89, 100);
  await expect(next).toBeHidden();
  await playback(page, 90, 100);
  await expect(next).toBeVisible();
  await playback(page, 90, Infinity);
  await expect(next).toBeHidden();
  await playback(page, 90, NaN);
  await expect(next).toBeHidden();
  await page.locator('.b-simple_episode__item').nth(1).evaluate(e => e.classList.add('disabled'));
  await playback(page, 90, 100);
  await expect(next).toBeHidden();
});
