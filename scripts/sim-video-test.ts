/**
 * Simulated scan, recorded. Renders the CC0 MakeHuman body as phone-camera frames, runs the real app (MediaPipe on
 * every rendered frame) through the front capture and the 360° arms-out turn, scores every measurement against the
 * posed mesh, and records the whole run as a video.
 *
 * Outputs in test-results/body-scan-sim/:
 *   body-scan-simulation.mp4   the recorded run (setup → front → turn → results with mesh truth and 3D overlay)
 *   photos/*.png               example rendered "photos" of the body at 0°, 45°, 90°, 135° and 180°
 *   report.md, report.json     measured vs mesh truth for MediaPipe and for the exact-mask oracle
 *
 * Run after `npm run build`:  npm run test:sim
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import puppeteer, { type Page } from 'puppeteer-core';
import { preview } from 'vite';
import { comparisonTable, type Comparison } from '../src/sim/compare.ts';

const out = join(process.cwd(), 'test-results', 'body-scan-sim');
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'photos'), { recursive: true });
const chrome = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => existsSync(p));
assert.ok(chrome, 'Install Chrome or set CHROME_PATH.');
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const log = (m: string) => console.log(`[sim-video-test] ${m}`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Torso/leg girths and lengths must match the mesh within these bounds (percent; lengths in cm). */
const LIMITS = {
  oracle: { torso: 2, legs: 6, neck: 7, arms: 12, lengthCm: 2.5 },
  mediapipe: { torso: 5, legs: 12, neck: 15, arms: 25, lengthCm: 6 },
};
function check(rows: Comparison[], l: (typeof LIMITS)['oracle']): string[] {
  const bound = (id: string) => ['chest', 'waist', 'hip'].includes(id) ? l.torso : ['thigh', 'knee', 'calf', 'ankle'].includes(id) ? l.legs : id === 'neck' ? l.neck : l.arms;
  return rows.filter(r => r.method === 'input' ? false : ['neck', 'chest', 'waist', 'hip', 'thigh', 'knee', 'calf', 'ankle', 'bicep', 'forearm', 'wrist'].includes(r.id) ? Math.abs(r.errorPct) > bound(r.id) : Math.abs(r.errorCm) > l.lengthCm).map(r => `${r.id} ${r.errorPct.toFixed(1)}%`);
}

async function run(page: Page, detector: 'mediapipe' | 'oracle'): Promise<Comparison[]> {
  await page.goto(`${origin}/scan.html${detector === 'oracle' ? '?detector=oracle' : ''}`, { waitUntil: 'load' });
  await sleep(1500);
  await page.click('#start-demo');
  await page.waitForFunction(() => document.body.dataset.screen === 'capture', { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('step-title')?.textContent === 'Turn', { timeout: 180000 });
  log(`${detector}: front captured, turning`);
  await page.waitForFunction(() => document.body.dataset.screen === 'results', { timeout: 600000 });
  await page.waitForSelector('#view3d[data-rendered="true"]', { timeout: 20000 });
  return page.evaluate(() => (window as unknown as { __scan: { comparison: Comparison[] } }).__scan.comparison);
}

let failed: string[] = [];
try {
  // 1. Recorded MediaPipe run at a desktop size (capture view beside the guidance panel).
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewport({ width: 1280, height: 720 });
  const webm = join(out, 'body-scan-simulation.webm') as `${string}.webm`;
  const recorder = await page.screencast({ path: webm });
  const t0 = Date.now();
  const mp = await run(page, 'mediapipe');
  log(`mediapipe run took ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  // Show the results: summary, table with mesh truth, then the 3D overlay and annotated frames.
  await sleep(2500);
  for (const target of ['#measurements', '#view3d', '.export']) {
    await page.evaluate(sel => document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), target);
    await sleep(3500);
  }
  await recorder.stop();
  // Example rendered photos.
  for (const yaw of [0, 45, 90, 135, 180]) {
    const url = await page.evaluate(y => (window as unknown as { __sim: { renderPhoto(y: number): string } }).__sim.renderPhoto(y), yaw);
    await writeFile(join(out, 'photos', `body-yaw-${String(yaw).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  await page.screenshot({ path: join(out, 'results.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();

  // 2. Oracle run (exact mask and joints) — isolates the geometry from the ML model.
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1280, height: 720 });
  const oracle = await run(page2, 'oracle');
  await page2.close();

  const mp4 = join(out, 'body-scan-simulation.mp4');
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', mp4]);
    await rm(webm);
  } catch { log('ffmpeg/libx264 unavailable: keeping the .webm only'); }
  const md = `# Simulated body scan vs mesh ground truth

Body: CC0 MakeHuman base mesh (${oracle.find(r => r.id === 'height')?.truthCm.toFixed(1)} cm), arms straight out. Camera: portrait 720×1280, 66° vertical field of view, 2.5 m away, 1 m high. The body turns one full circle in front of the static camera. Truth: the posed mesh sliced where the app measured (tape = convex hull of the cross-section).

## MediaPipe on rendered frames (the real app pipeline)

${comparisonTable(mp)}

## Oracle: exact mask and joints (isolates measurement geometry from the ML model)

${comparisonTable(oracle)}
`;
  await writeFile(join(out, 'report.md'), md);
  await writeFile(join(out, 'report.json'), JSON.stringify({ mediapipe: mp, oracle }, null, 2));
  console.log(md);
  failed = [...check(oracle, LIMITS.oracle).map(f => `oracle ${f}`), ...check(mp, LIMITS.mediapipe).map(f => `mediapipe ${f}`)];
  log(`Video: ${existsSync(mp4) ? mp4 : webm}`);
  log(`Photos and report: ${out}`);
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.httpServer.close(() => resolve()));
}
assert.deepEqual(failed, [], `Over the limit: ${failed.join(', ')}`);
log('Simulation matches mesh ground truth within limits.');
