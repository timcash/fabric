import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';
import { slides } from '../src/slides.ts';

const output = await mkdtemp(join(tmpdir(), 'slide-template-tour-'));
const chrome = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(path => existsSync(path));
assert.ok(chrome, 'Install Chrome or set CHROME_PATH.');
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
function log(message: string) {
  const line = new Error().stack?.split('\n')[2]?.match(/:(\d+):\d+\)?$/)?.[1] || '?';
  console.log(`[${new Date().toISOString()}, INFO, browser-test.ts, module, ${line}] ${message}`);
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const expectSlide = async (id: string) => page.waitForFunction(value => document.body.dataset.slide === value, { timeout: 5000 }, id);
const state = async (name: string) => page.$eval('#scene', (element, key) => (element as HTMLElement).dataset[key], name);

try {
  log(`Screenshot directory: ${output}`);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${origin}/?tourDuration=900`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#scene[data-rendered="true"]');
  assert.equal(await page.$$eval('#scene canvas', nodes => nodes.length), 1);
  assert.equal(await page.$$eval('#slide-progress button', nodes => nodes.length), 5);
  for (let i = 0; i < slides.length; i++) {
    await expectSlide(slides[i].id);
    await delay(650);
    assert.equal(await state('model'), slides[i].model);
    await page.screenshot({ path: join(output, `${i + 1}-${slides[i].id}.png`) });
    if (i < slides.length - 1) await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('ArrowRight');
  await expectSlide('make-it-yours');
  await page.keyboard.press('Home');
  await expectSlide('welcome');
  await page.mouse.move(700, 500);
  await page.mouse.wheel({ deltaY: 140 });
  await expectSlide('navigate');
  for (let i = 0; i < 26; i++) { await page.mouse.wheel({ deltaY: 7 }); await delay(30); }
  await expectSlide('navigate');
  await delay(300);
  await page.mouse.wheel({ deltaY: -140 });
  await expectSlide('welcome');
  await page.click('#slide-action');
  await expectSlide('navigate');
  await page.goBack();
  await expectSlide('welcome');
  await page.goForward();
  await expectSlide('navigate');
  log('Five slides, canvas rendering, momentum gating, actions, boundaries, and browser history pass.');

  await page.keyboard.press('ArrowRight');
  await expectSlide('interact');
  await delay(750);
  const positions = JSON.parse((await state('nodePositions'))!);
  const target = positions.find((position: {id:number}) => position.id === 3);
  await page.mouse.click(target.x, target.y);
  assert.equal(await state('selectedNode'), '3', 'Real mesh raycasting selects node 3');
  await page.keyboard.press('c');
  assert.equal(await state('nodeCount'), '6');
  assert.equal(await state('edgeCount'), '6');
  await page.keyboard.press('x');
  assert.equal(await state('selectedColor'), '1');
  await page.keyboard.press('Delete');
  assert.equal(await state('nodeCount'), '5');
  assert.equal(await state('edgeCount'), '5');
  await page.click('#slide-action');
  assert.equal(await state('nodeCount'), '6');
  await page.click('#reset-graph');
  assert.equal(await state('nodeCount'), '5');
  const camera = await state('camera');
  await page.mouse.move(1150, 550);
  await page.mouse.down();
  await page.mouse.move(1260, 590, { steps: 10 });
  await page.mouse.up();
  await delay(300);
  assert.notEqual(await state('camera'), camera, 'Dragging changes the actual camera');
  await page.keyboard.press('r');
  await delay(900);
  log('Actual Three.js selection, add, recolor, delete, reset, and camera orbit pass.');

  await page.keyboard.press('Home');
  await page.click('#play');
  await expectSlide('navigate');
  await page.keyboard.press('ArrowLeft');
  await expectSlide('welcome');
  await delay(1100);
  await expectSlide('welcome');
  assert.equal(await page.$eval('body', body => body.dataset.playing), 'false');
  await page.click('#play');
  await page.keyboard.press('Escape');
  await delay(1000);
  await expectSlide('welcome');
  await page.keyboard.press('End');
  await page.click('#slide-action');
  assert.equal(await page.$eval('#guide-dialog', node => (node as HTMLDialogElement).open), true);
  await page.mouse.move(700, 500);
  await page.mouse.wheel({ deltaY: 600 });
  await expectSlide('make-it-yours');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#guide-dialog', node => (node as HTMLDialogElement).open), false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'slide-action');
  assert.equal(await (await fetch(`${origin}/guide.md`)).text(), await readFile(new URL('../docs/guide.md', import.meta.url), 'utf8'));
  await page.keyboard.press('Home');
  await page.click('#play');
  await expectSlide('make-it-yours');
  assert.equal(await page.$eval('body', body => body.dataset.playing), 'false');
  log('Autoplay takeover, Escape, completion, guide scrolling, source text, and focus restoration pass.');

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${origin}/#welcome`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#scene[data-rendered="true"]');
  await delay(600);
  await page.screenshot({ path: join(output, 'mobile-welcome.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const session = await page.createCDPSession();
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 540 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 450 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expectSlide('navigate');
  await page.click('#next');
  await expectSlide('interact');
  await page.click('#slide-action');
  assert.equal(await state('nodeCount'), '6');
  await delay(600);
  await page.screenshot({ path: join(output, 'mobile-interact.png') });
  await page.click('#open-guide');
  await page.screenshot({ path: join(output, 'mobile-guide.png') });
  await page.click('#close-guide');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(`${origin}/#playback`, { waitUntil: 'networkidle0' });
  await expectSlide('playback');
  assert.equal(await state('motion'), 'reduced');
  assert.equal(await page.$eval('body', body => body.dataset.playing), 'false');
  const cameraBefore = await state('camera');
  await delay(200);
  assert.equal(await state('camera'), cameraBefore);
  log('Mobile touch navigation, graph action, guide, deep links, and reduced motion pass.');

  const fallback = await browser.newPage();
  await fallback.evaluateOnNewDocument(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
      return type.includes('webgl') ? null : original.apply(this, [type, ...args] as never);
    } as typeof original;
  });
  await fallback.goto(origin, { waitUntil: 'networkidle0' });
  assert.equal(await fallback.$eval('#scene-fallback', node => (node as HTMLElement).hidden), false);
  await fallback.click('#next');
  assert.equal(await fallback.$eval('body', node => node.dataset.slide), 'navigate');
  await fallback.click('#open-guide');
  assert.equal(await fallback.$eval('#guide-dialog', node => (node as HTMLDialogElement).open), true);
  await fallback.close();
  assert.deepEqual(errors, [], 'No browser errors or failed assets');
  log(`PASS. WebGL fallback and all interactions verified. Screenshots: ${output}`);
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
