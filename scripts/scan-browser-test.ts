/**
 * Body-scan browser test, against the production bundle with the production security headers (public/_headers):
 * 1. Simulated scan on a phone viewport: front capture (arms-out check) → turn → results scored against the mesh.
 * 2. Photo mode: MediaPipe (self-hosted, strict CSP) measures rendered front and side photos of the same body.
 * 3. Camera mode opens Chrome's fake camera and runs live checks; Cancel returns to setup.
 * Photo mode uses rendered photos of the simulated body; set SCAN_TEST_PHOTO=/path/to/full-body.jpg to use a real one.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import puppeteer, { type Page } from 'puppeteer-core';
import { preview } from 'vite';

const output = await mkdtemp(join(tmpdir(), 'fabric-body-scan-'));
const chrome = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => existsSync(p));
assert.ok(chrome, 'Install Chrome or set CHROME_PATH.');
const headers = Object.fromEntries((await readFile(new URL('../public/_headers', import.meta.url), 'utf8')).split('\n').slice(1).map(l => l.trim()).filter(Boolean).map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
const browser = await puppeteer.launch({
  executablePath: chrome, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const log = (m: string) => console.log(`[scan-browser-test] ${m}`);
let meshTruth: Record<string, number> = {};

async function open(path: string, viewport = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }) {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.setRequestInterception(true);
  page.on('request', async request => {
    if (request.resourceType() !== 'document') return request.continue();
    const response = await fetch(request.url());
    request.respond({ status: response.status, headers: { ...Object.fromEntries(response.headers), ...headers }, body: Buffer.from(await response.arrayBuffer()) });
  });
  await page.setViewport(viewport);
  await page.goto(`${origin}${path}`, { waitUntil: 'networkidle0' });
  return { page, errors };
}
const screen = (page: Page, name: string) => page.waitForFunction(n => document.body.dataset.screen === n, { timeout: 60000 }, name);

try {
  log(`Screenshots: ${output}`);
  // 1. Simulated scan on a phone viewport (exact-mask oracle: fast and deterministic; see test:sim for MediaPipe)
  {
    const { page, errors } = await open('/scan.html?detector=oracle');
    await page.screenshot({ path: join(output, '1-setup.png'), fullPage: true });
    assert.equal(await page.$eval('#units', e => e.textContent), 'cm');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `no horizontal scroll on phones (overflow ${overflow}px)`);
    await page.click('#start-demo');
    await screen(page, 'capture');
    // Arms start down in the simulation: the arms-out check must fail first, then pass.
    await page.waitForFunction(() => document.querySelector('#checks li[data-check="arms"]')?.getAttribute('data-ok') === 'false', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#checks li[data-check="arms"]')?.getAttribute('data-ok') === 'true', { timeout: 30000 });
    await page.screenshot({ path: join(output, '2-front-checks.png') });
    await page.waitForFunction(() => ['Turn', 'Walk around'].includes(document.getElementById('step-title')?.textContent ?? ''), { timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById('turn-dial')?.hidden && parseInt(document.getElementById('dial-label')!.textContent!) > 40, { timeout: 60000 });
    await page.screenshot({ path: join(output, '3-turn.png') });
    await screen(page, 'results');
    await page.waitForSelector('#view3d[data-rendered="true"]', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: join(output, '4-results.png'), fullPage: true });
    const rows = await page.$$eval('#measurements tbody tr', trs => trs.map(tr => ({ id: (tr as HTMLElement).dataset.id!, cells: [...tr.children].map(c => c.textContent!) })));
    log(rows.map(r => r.cells.join(' | ')).join('\n'));
    assert.ok(rows.length >= 18, `measurement rows: ${rows.length}`);
    for (const id of ['chest', 'waist', 'hip', 'thigh', 'knee', 'calf', 'ankle']) {
      const row = rows.find(r => r.id === id)!;
      assert.equal(row.cells[3], 'turntable', `${id} method`);
      const error = Math.abs(parseFloat(row.cells[5]));
      assert.ok(error < (['chest', 'waist', 'hip'].includes(id) ? 2 : 6), `${id}: ${row.cells[1]} vs mesh ${row.cells[4]} (${row.cells[5]})`);
    }
    assert.equal(await page.$eval('#download-package', e => (e as HTMLElement).hidden), false, 'capture package offered after a turn');
    await page.click('#units');
    assert.match(await page.$eval('#summary .stat strong', e => e.textContent!), / in$/);
    const overflowResults = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflowResults <= 0, `results fit a phone (overflow ${overflowResults}px)`);
    // Rendered "photos" of the simulated body for photo mode (front and profile, arms out).
    for (const yaw of [0, 90]) {
      const url = await page.evaluate(y => (window as unknown as { __sim: { renderPhoto(y: number): string } }).__sim.renderPhoto(y), yaw);
      await writeFile(join(output, `photo-${yaw}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    meshTruth = Object.fromEntries(rows.map(r => [r.id, parseFloat(r.cells[4])]));
    assert.deepEqual(errors, []);
    await page.close();
  }
  // 2. Photo mode: MediaPipe under CSP
  {
    const { page, errors } = await open('/scan.html');
    if (await page.$eval('#units', e => e.textContent) === 'in') await page.click('#units'); // step 1 switched to inches
    await page.select('#height-unit', 'cm');
    await page.type('#height', String(meshTruth.height));
    await page.click('#photo-mode summary');
    const photo = process.env.SCAN_TEST_PHOTO;
    const upload = async (id: string, file: string) => (await page.$(id) as unknown as { uploadFile(p: string): Promise<void> }).uploadFile(file);
    await upload('#front-photo', photo ?? join(output, 'photo-0.png'));
    if (!photo) await upload('#side-photo', join(output, 'photo-90.png'));
    await page.click('#measure-photos');
    await page.waitForFunction(() => document.body.dataset.screen === 'results' || !document.getElementById('setup-error')!.hidden, { timeout: 90000 });
    const outcome = await page.evaluate(() => document.body.dataset.screen === 'results' ? 'results' : document.getElementById('setup-error')!.textContent);
    log(`photo mode outcome: ${outcome}`);
    assert.equal(outcome, 'results', 'MediaPipe measured the rendered photos');
    await page.waitForSelector('#view3d[data-rendered="true"]');
    await page.screenshot({ path: join(output, '5-photo-results.png'), fullPage: true });
    if (!photo) {
      const got = await page.$$eval('#measurements tbody tr', trs => Object.fromEntries(trs.map(tr => [(tr as HTMLElement).dataset.id!, [parseFloat(tr.children[1].textContent!), tr.children[3].textContent!]])));
      log(`photo mode: ${['chest', 'waist', 'hip'].map(id => `${id} ${got[id]?.[0]} (${got[id]?.[1]}) vs mesh ${meshTruth[id]}`).join(', ')}`);
      for (const id of ['chest', 'waist', 'hip']) {
        assert.equal(got[id][1], 'two-view', `${id} from front + side photos`);
        assert.ok(Math.abs(got[id][0] / meshTruth[id] - 1) < 0.08, `${id} from photos within 8% of the mesh`);
      }
    }
    assert.deepEqual(errors.filter(e => !/WebGL|GPU|gl_|OpenGL|delegate/i.test(e)), []);
    await page.close();
  }
  // 3. Camera mode with Chrome's fake camera
  {
    const { page, errors } = await open('/scan.html');
    await page.select('#height-unit', 'cm');
    await page.type('#height', '180');
    await page.click('#start-camera');
    await screen(page, 'capture');
    await page.waitForFunction(() => document.querySelectorAll('#checks li').length >= 1, { timeout: 90000 });
    assert.equal(await page.$eval('#step-title', e => e.textContent), 'Front');
    await page.screenshot({ path: join(output, '6-camera.png') });
    await page.click('#cancel-scan');
    await screen(page, 'setup');
    assert.deepEqual(errors.filter(e => !/WebGL|GPU|gl_|OpenGL|delegate/i.test(e)), []);
    await page.close();
  }
  log('All body-scan browser checks passed.');
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.httpServer.close(() => resolve()));
}
