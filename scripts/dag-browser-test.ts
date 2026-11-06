import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';
import { slides } from '../src/slides.ts';

const output = await mkdtemp(join(tmpdir(), 'slide-dag-tour-'));
const chrome = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
assert.ok(chrome, 'Install Chrome or set CHROME_PATH');
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
const base = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const data = (key: string) => page.$eval('#scene', (node, key) => (node as HTMLElement).dataset[key], key);
const waitData = (key: string, value: string) => page.waitForFunction((key, value) => (document.getElementById('scene') as HTMLElement).dataset[key] === value, { timeout: 6000 }, key, value);
const mode = (value: string) => page.waitForFunction(value => document.body.dataset.mode === value, {}, value);
async function assertNeutralDagBackground() {
  assert.equal(await page.$eval('body', body => getComputedStyle(body).backgroundColor), 'rgb(0, 0, 0)');
  // Check rendered pixels as well as CSS: the old blue backdrop was a Three.js mesh.
  // Blue slide models remain intentional, but must not tint most of the scene.
  const screenshot = await page.screenshot({ encoding: 'base64' });
  const blueFraction = await page.evaluate(async png => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const rect = document.getElementById('scene')!.getBoundingClientRect();
    const scale = image.width / innerWidth;
    const pixels = context.getImageData(Math.round(rect.x * scale), Math.round(rect.y * scale), Math.round(rect.width * scale), Math.round(rect.height * scale)).data;
    let blue = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2] - pixels[i] > 20 && pixels[i + 2] - pixels[i + 1] > 10) blue++;
    return blue / (pixels.length / 4);
  }, screenshot);
  assert.ok(blueFraction < .12, `DAG backdrop must be neutral; blue content occupies ${(blueFraction * 100).toFixed(1)}% of scene pixels`);
}
async function assertPreview(id: string, model: string) {
  const previews = JSON.parse((await data('dagPreviews'))!);
  const preview = previews.find((item: {id: string}) => item.id === id);
  const source = JSON.parse((await data('slideModels'))!)[model];
  assert.ok(preview?.visible && preview.scale > .01, `${id}: 3D model is visible at Full content`);
  assert.equal(preview.model, model);
  assert.equal(preview.sharedResources, true, `${id}: shares actual Slide-mode geometry and materials`);
  assert.ok(preview.meshCount > 0);
  assert.deepEqual({ meshCount: preview.meshCount, geometryTypes: preview.geometryTypes, graphNodes: preview.graphNodes }, source, `${id}: all source meshes and graph edits are present`);
  return preview;
}
async function clickNode(id: string, touch = false) {
  const nodes = JSON.parse((await data('dagNodes'))!);
  const point = nodes.find((node: {id: string}) => node.id === id);
  assert.ok(point?.visible, `Visible mesh for ${id}`);
  if (touch) await page.touchscreen.tap(Math.round(point.x), Math.round(point.y));
  else await page.mouse.click(point.x, point.y);
  await waitData('dagSelected', id);
}
function log(message: string) {
  const line = new Error().stack?.split('\n')[2]?.match(/:(\d+):\d+\)?$/)?.[1] ?? '?';
  console.log(`[${new Date().toISOString()}, INFO, dag-browser-test.ts, module, ${line}] ${message}`);
}

try {
  log(`Screenshot directory: ${output}`);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${base}/deck.html?tourDuration=900`, { waitUntil: 'networkidle0' });
  await page.click('#play'); await page.click('#mode-toggle'); await mode('dag');
  assert.equal(await page.$eval('body', body => body.dataset.playing), 'false');
  await delay(1200);
  assert.equal(await data('dagNodeCount'), '5');
  assert.equal(await page.$$eval('#scene canvas', nodes => nodes.length), 1);
  assert.ok(JSON.parse((await data('dagNodes'))!).every((node: {visible: boolean}) => node.visible));
  await page.screenshot({ path: join(output, 'dag-overview.png') });

  for (const slide of slides) {
    await page.click('#dag-overview'); await delay(1000);
    await clickNode(slide.id); await waitData('dagLod', 'full-content'); await delay(650);
    const preview = await assertPreview(slide.id, slide.model);
    await assertNeutralDagBackground();
    if (slide.model === 'assembly') {
      await delay(150);
      assert.notDeepEqual((await assertPreview(slide.id, slide.model)).coreRotation, preview.coreRotation, 'The real assembly core continues animating in DAG mode');
    }
    await page.screenshot({ path: join(output, `focus-${slide.id}.png`) });
    await page.click('#dag-enter'); await waitData('dagDepth', '1');
    await waitData('cameraPath', 'through-parent'); await delay(1100);
    assert.equal(await data('dagNodeCount'), String(slide.children!.length));
    await page.select('#dag-lod', '2'); await waitData('dagLod', 'full-content');
    for (const child of slide.children!) await assertPreview(`${slide.id}/${child.id}`, slide.model);
    await page.screenshot({ path: join(output, `nested-${slide.id}.png`) });
    await page.click('#dag-parent'); await waitData('dagDepth', '0');
    assert.equal(await data('dagSelected'), slide.id);
    await page.click('#dag-present'); await mode('slides');
    assert.equal(await page.$eval('body', body => body.dataset.slide), slide.id);
    await page.click('#mode-toggle'); await mode('dag');
  }
  log('All five slides and nested nodes show their actual live Slide-mode meshes at Full content; selection, opening, parenting, and presentation use one canvas.');

  await page.goto(`${base}/deck.html?mode=dag#interact`, { waitUntil: 'networkidle0' });
  await delay(1000); await page.keyboard.press('n'); await waitData('dagDepth', '1'); await delay(1000);
  await clickNode('interact/edit'); await page.keyboard.press('n'); await waitData('dagDepth', '2'); await delay(1100);
  assert.equal(await data('dagNodeCount'), '3');
  const nestedUrl = page.url();
  await page.screenshot({ path: join(output, 'nested-depth-two.png') });
  await page.reload({ waitUntil: 'networkidle0' }); await waitData('dagDepth', '2');
  assert.equal(page.url(), nestedUrl);
  await page.keyboard.press('t'); await waitData('dagDepth', '1');
  assert.equal(await data('dagSelected'), 'interact/edit');
  await page.keyboard.press('Escape'); await waitData('dagDepth', '0');
  assert.equal(await data('dagSelected'), 'interact');
  await page.focus('#dag-enter'); await page.keyboard.press('Enter'); await waitData('dagDepth', '1');
  await page.focus('#dag-parent'); await page.keyboard.press('Enter'); await waitData('dagDepth', '0');
  await page.$eval('#dag-parent', node => (node as HTMLElement).blur());
  await page.select('#dag-lod', '0'); await waitData('dagLod', 'graph-point'); await delay(1000);
  assert.ok(JSON.parse((await data('dagPreviews'))!).every((item: {visible: boolean}) => !item.visible));
  await page.screenshot({ path: join(output, 'lod-points.png') });
  await page.select('#dag-lod', '1'); await waitData('dagLod', 'title-only');
  await assertNeutralDagBackground();
  assert.ok(JSON.parse((await data('dagPreviews'))!).every((item: {visible: boolean}) => !item.visible));
  await page.select('#dag-lod', '2'); await waitData('dagLod', 'full-content'); await delay(700);
  const before = Number(await data('dagDistance'));
  await page.mouse.move(720, 500); await page.mouse.wheel({ deltaY: 180 }); await delay(900);
  assert.ok(Number(await data('dagDistance')) > before);
  assert.equal(await data('dagSelected'), 'interact');
  await page.click('#dag-present'); await mode('slides');
  await page.keyboard.press('c'); assert.equal(await data('nodeCount'), '6');
  await page.keyboard.press('x'); await waitData('selectedColor', '1');
  await page.click('#mode-toggle'); await page.select('#dag-lod', '2'); await waitData('dagLod', 'full-content');
  const edited = await assertPreview('interact', 'graph');
  assert.equal(edited.graphNodes.length, 6);
  assert.equal(edited.graphNodes.at(-1).color, '42c8b0');
  await assertPreview('navigate', 'graph');
  await page.screenshot({ path: join(output, 'live-graph-preview.png') });
  await page.click('#dag-present'); await mode('slides');
  assert.equal(await data('nodeCount'), '6', 'Mode switches retain edits');
  await page.keyboard.press('Delete'); await waitData('nodeCount', '5');
  await page.click('#mode-toggle'); await page.select('#dag-lod', '2'); await waitData('dagLod', 'full-content');
  assert.equal((await assertPreview('interact', 'graph')).graphNodes.length, 5, 'Removal rebuilds the shared preview');
  await page.click('#dag-present'); await mode('slides');
  await page.keyboard.press('Home');
  for (const slide of slides.slice(1)) { await page.keyboard.press('ArrowDown'); assert.equal(await page.$eval('body', body => body.dataset.slide), slide.id); }
  await page.keyboard.press('ArrowUp'); assert.equal(await page.$eval('body', body => body.dataset.slide), 'playback');
  log('Two nesting depths, parent restoration, DAG deep links, all LOD bands, wheel zoom, edit preservation, and top-to-bottom slide order pass.');

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${base}/deck.html?mode=dag#welcome`, { waitUntil: 'networkidle0' }); await delay(1200);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(output, 'mobile-dag.png') });
  await page.select('#dag-lod', '0'); await waitData('dagLod', 'graph-point'); await delay(1200);
  assert.ok(JSON.parse((await data('dagNodes'))!).every((node: {visible: boolean}) => node.visible), 'Mobile point LOD stays inside camera clipping range');
  await page.click('#dag-overview'); await delay(1100);
  await clickNode('interact', true); await page.click('#dag-enter'); await waitData('dagDepth', '1'); await delay(1100);
  await page.screenshot({ path: join(output, 'mobile-nested.png') });
  await page.click('#dag-parent'); await waitData('dagDepth', '0');
  await page.click('#mode-toggle'); await mode('slides');
  assert.equal(await page.$eval('body', body => body.dataset.slide), 'interact');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.click('#mode-toggle'); await mode('dag'); await page.click('#dag-enter'); await waitData('dagDepth', '1'); await delay(300);
  assert.equal(await data('cameraPath'), 'idle');
  const camera = await data('camera'); await delay(250); assert.equal(await data('camera'), camera);
  assert.deepEqual(errors, []);
  log(`PASS: desktop/mobile slide DAG, nested workplanes, reduced motion, and zero browser errors. Screenshots: ${output}`);
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
