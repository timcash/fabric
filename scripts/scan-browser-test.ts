/**
 * Body-scan browser test, against the production bundle with the production security headers (public/_headers):
 * 1. Demo flow on a phone viewport: front capture → turn → results, with girths checked against ground truth.
 * 2. Photo mode loads the self-hosted MediaPipe model and runs it under the strict CSP.
 * 3. Camera mode opens Chrome's fake camera and runs live checks; Cancel returns to setup.
 * Set SCAN_TEST_PHOTO=/path/to/full-body.jpg to also require a full measurement from a real photo.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
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
  // 1. Demo flow
  {
    const { page, errors } = await open('/scan.html');
    await page.screenshot({ path: join(output, '1-setup.png'), fullPage: true });
    assert.equal(await page.$eval('#units', e => e.textContent), 'cm');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `no horizontal scroll on phones (overflow ${overflow}px)`);
    await page.click('#start-demo');
    await screen(page, 'capture');
    await page.waitForFunction(() => document.querySelectorAll('#checks li').length >= 5);
    await page.screenshot({ path: join(output, '2-front-checks.png') });
    await page.waitForFunction(() => document.getElementById('step-title')?.textContent === 'Turn', { timeout: 20000 });
    await page.waitForFunction(() => !document.getElementById('turn-dial')?.hidden && parseInt(document.getElementById('dial-label')!.textContent!) > 40, { timeout: 20000 });
    await page.screenshot({ path: join(output, '3-turn.png') });
    await screen(page, 'results');
    await page.waitForSelector('#view3d[data-rendered="true"]', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: join(output, '4-results.png'), fullPage: true });
    const rows = await page.$$eval('#measurements tbody tr', trs => trs.map(tr => ({ id: (tr as HTMLElement).dataset.id!, cells: [...tr.children].map(c => c.textContent!) })));
    log(rows.map(r => r.cells.join(' | ')).join('\n'));
    assert.ok(rows.length >= 18, `measurement rows: ${rows.length}`);
    for (const id of ['chest', 'waist', 'hip']) {
      const row = rows.find(r => r.id === id)!;
      assert.equal(row.cells[3], 'turntable', `${id} method`);
      const [measured, real] = [parseFloat(row.cells[1]), parseFloat(row.cells[4])];
      assert.ok(Math.abs(measured / real - 1) < 0.03, `${id}: ${measured} vs true ${real}`);
    }
    for (const id of ['thigh', 'calf', 'knee', 'ankle']) {
      const row = rows.find(r => r.id === id)!;
      assert.equal(row.cells[3], 'two-view', `${id} uses the profile frames`);
      assert.ok(Math.abs(parseFloat(row.cells[1]) / parseFloat(row.cells[4]) - 1) < 0.04, `${id}: ${row.cells[1]} vs true ${row.cells[4]}`);
    }
    assert.equal(await page.$eval('#download-package', e => (e as HTMLElement).hidden), false, 'capture package offered after a turn');
    await page.click('#units');
    assert.match(await page.$eval('#summary .stat strong', e => e.textContent!), / in$/);
    const overflowResults = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflowResults <= 0, `results fit a phone (overflow ${overflowResults}px)`);
    assert.deepEqual(errors, []);
    await page.close();
  }
  // 2. Photo mode: MediaPipe under CSP
  {
    const { page, errors } = await open('/scan.html');
    await page.select('#height-unit', 'cm');
    await page.type('#height', '175');
    await page.click('#photo-mode summary');
    const photo = process.env.SCAN_TEST_PHOTO;
    const file = photo ?? join(output, '1-setup.png');
    const input = await page.$('#front-photo');
    await (input as unknown as { uploadFile(p: string): Promise<void> }).uploadFile(file);
    await page.click('#measure-photos');
    await page.waitForFunction(() => document.body.dataset.screen === 'results' || !document.getElementById('setup-error')!.hidden, { timeout: 90000 });
    const outcome = await page.evaluate(() => document.body.dataset.screen === 'results' ? 'results' : document.getElementById('setup-error')!.textContent);
    log(`photo mode outcome: ${outcome}`);
    if (photo) {
      assert.equal(outcome, 'results');
      await page.waitForSelector('#view3d[data-rendered="true"]');
      await page.screenshot({ path: join(output, '5-photo-results.png'), fullPage: true });
    } else assert.match(String(outcome), /No person|outline|results/);
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
