import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';
import { walkthroughSteps, type TourInput } from '../src/walkthrough-steps.ts';

const output = await mkdtemp(join(tmpdir(), 'recursive-node-tour-'));
const chrome = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
assert.ok(chrome, 'Install Chrome or set CHROME_PATH');
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
const base = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors: string[] = [];
const runtimeLogs: string[] = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); else if (entry.text().includes('walkthrough.ts')) { runtimeLogs.push(entry.text()); console.log(entry.text()); } });
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = () => page.evaluate(() => ({ ...document.body.dataset, ...document.getElementById('scene')!.dataset, guideOpen: String((document.getElementById('guide-dialog') as HTMLDialogElement).open) }));
const expect = (values: Record<string, string>) => page.waitForFunction(values => {
  const state = { ...document.body.dataset, ...document.getElementById('scene')!.dataset } as Record<string, string>;
  return Object.entries(values).every(([key, value]) => state[key] === value);
}, { timeout: 8000 }, values);
async function press(chord: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  if (chord.startsWith('Shift+')) { await page.keyboard.down('Shift'); await page.keyboard.press(chord.slice(6)); await page.keyboard.up('Shift'); }
  else await page.keyboard.press(chord);
}
async function perform(input: TourInput) {
  if ('key' in input) await press(input.key);
  else if ('click' in input) await page.click(input.click);
  else { await page.mouse.move(720, 500); await page.mouse.wheel({ deltaY: input.wheel }); }
}
function log(message: string) {
  const line = new Error().stack?.split('\n')[2]?.match(/:(\d+):\d+\)?$/)?.[1] ?? '0';
  console.log(`[${new Date().toISOString()}, INFO, walkthrough-browser-test.ts, module, ${line}] ${message}`);
}
const measurements: { id: string; milliseconds: number }[] = [];

try {
  log(`Screenshots: ${output}`);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(`${base}/?walkthroughSpeed=20`, { waitUntil: 'networkidle0' });
  await expect({ rendered: 'true' });
  for (const [index, step] of walkthroughSteps.entries()) {
    const before = await snapshot(); const start = performance.now();
    for (const input of step.inputs) await perform(input);
    await page.waitForFunction((values, changed, before) => {
      const state = { ...document.body.dataset, ...document.getElementById('scene')!.dataset, guideOpen: String((document.getElementById('guide-dialog') as HTMLDialogElement).open) } as Record<string, string>;
      return Object.entries(values).every(([key, value]) => state[key] === value) && changed.every(key => state[key] !== before[key]);
    }, { timeout: 8000 }, step.expect, step.changed ?? [], before);
    assert.equal(await page.$$eval('#scene canvas', nodes => nodes.length), 1);
    const state = await snapshot();
    if (state.mode === 'dag') {
      const nodes = JSON.parse(state.dagNodes!);
      assert.ok(nodes.every((node: {parentId: string; planeY: number}) => node.parentId === state.openNode && node.planeY === 0), 'All direct children occupy the open parent’s flat plane');
      assert.equal(state.rootNode, 'root'); assert.equal(state.rootParent, 'null');
    }
    measurements.push({ id: step.id, milliseconds: Math.round(performance.now() - start) });
    await page.screenshot({ path: join(output, `${String(index + 1).padStart(2, '0')}-${step.id}.png`) });
    log(`PASS replay: ${step.id}`);
  }

  // Run the actual visible walkthrough and preserve an edit made before it starts.
  await press('Home'); await press('ArrowDown'); await press('ArrowDown'); await press('c'); await press('x');
  await expect({ nodeCount: '6', selectedColor: '1' });
  await page.click('#start-walkthrough');
  await expect({ walkthroughStatus: 'running' });
  await page.waitForFunction(() => document.body.dataset.walkthroughStatus !== 'running', { timeout: 60000 });
  assert.equal((await snapshot()).walkthroughStatus, 'completed');
  const results = JSON.parse((await snapshot()).walkthroughResults!);
  assert.equal(results.length, walkthroughSteps.length); assert.ok(results.every((step: {passed: boolean}) => step.passed));
  await expect({ nodeCount: '6', selectedColor: '1' });
  assert.ok(runtimeLogs.every(line => /^\[\d{4}-\d\d-\d\dT[^,]+, INFO, walkthrough\.ts, start, \d+\] PASS /.test(line)), 'Every live tour log has the requested structured prefix');
  await page.screenshot({ path: join(output, 'live-completed.png') });
  await page.click('#stop-walkthrough');

  // Cancellation must cancel scheduled inputs before processing the user’s action.
  for (const takeover of ['keyboard', 'wheel', 'pointer'] as const) {
    await press('w'); await expect({ walkthroughStatus: 'running' });
    await page.waitForFunction(() => document.body.dataset.walkthroughStep === 'next-slide', { timeout: 8000 });
    if (takeover === 'keyboard') await press('c');
    else if (takeover === 'wheel') { await page.mouse.move(720, 500); await page.mouse.wheel({ deltaY: 140 }); }
    else await page.click('#mode-toggle');
    await expect({ walkthroughStatus: 'stopped' });
    const stopped = await snapshot(); await delay(500);
    const later = await snapshot();
    assert.equal(later.walkthroughResults, stopped.walkthroughResults, `${takeover} cancels all future steps`);
    assert.equal(later.mode, stopped.mode); assert.equal(later.slide, stopped.slide);
    if (takeover === 'keyboard') assert.equal(later.nodeCount, '7', 'User create applies after restoring their six-node graph');
    if (later.mode === 'dag') await press('g');
  }
  await press('w'); await expect({ walkthroughStatus: 'running' });
  await page.waitForFunction(() => document.body.dataset.walkthroughStep === 'nested', { timeout: 25000 });
  await expect({ dagDepth: '2' }); await press('Escape');
  await expect({ walkthroughStatus: 'stopped', dagDepth: '2' });

  // N on a slide opens that exact editable node, not a second copy of its graph.
  await page.goto(`${base}/#interact`, { waitUntil: 'networkidle0' });
  await press(']'); await press('n'); await expect({ openNode: 'demo-2', dagDepth: '3', dagNodeCount: '0' });
  await press('c'); await expect({ dagNodeCount: '1' });
  await press('t'); await expect({ openNode: 'interact/select', dagNodeCount: '5', dagSelected: 'demo-2' });
  await press('v'); await expect({ mode: 'slides', slide: 'interact' });
  await press('t'); await expect({ mode: 'dag', openNode: 'interact', dagSelected: 'interact/select' });

  // Exercise actual recursive creation/opening in the browser, including empty interiors.
  await page.goto(`${base}/?mode=dag&layer=interact%7Cinteract/edit%7Cinteract/edit/create`, { waitUntil: 'networkidle0' });
  await expect({ dagDepth: '3', dagNodeCount: '0' });
  for (let depth = 4; depth <= 35; depth++) {
    const parent = (await snapshot()).openNode;
    await press('c'); await expect({ dagNodeCount: '1' });
    const created = await snapshot();
    assert.equal(JSON.parse(created.dagNodes!)[0].parentId, parent);
    await press('n'); await expect({ dagDepth: String(depth), dagNodeCount: '0', openNode: created.dagSelected! });
  }
  await press('c'); await expect({ dagNodeCount: '1' });
  assert.equal(await page.evaluate(() => document.getElementById('dag-breadcrumb')!.clientHeight < 65), true, 'Deep breadcrumbs remain a single scrollable row');
  await page.screenshot({ path: join(output, 'depth-35.png') });
  await press('f'); await expect({ dagDepth: '0', dagNodeCount: '5' });
  await page.screenshot({ path: join(output, 'root-plane.png') });

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${base}/?mode=dag&layer=interact%7Cinteract/edit%7Cinteract/edit/create`, { waitUntil: 'networkidle0' });
  await page.click('#dag-create'); await expect({ dagNodeCount: '1' });
  await page.click('#dag-enter'); await expect({ dagDepth: '4', dagNodeCount: '0' });
  await page.click('#dag-parent'); await expect({ dagDepth: '3', dagNodeCount: '1' });
  await page.screenshot({ path: join(output, 'mobile-created-node.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'metrics.json'), JSON.stringify({ steps: measurements, liveResults: results, browserDepth: 35, errors }, null, 2));
  log(`PASS: ${measurements.length} shared steps, live controller, all takeover paths, depth 35, coplanar children, mobile controls. Artifacts: ${output}`);
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
