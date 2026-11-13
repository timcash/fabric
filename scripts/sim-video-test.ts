/**
 * Simulated scan, recorded. The CC0 MakeHuman body stands with arms out in a furnished room while a helper (a second
 * body) walks a circle around them with a handheld phone. The real app runs MediaPipe on every rendered frame,
 * levels each frame with the simulated gravity sensor, measures, estimates where the camera was, and is scored
 * against the posed mesh and the true camera path. The whole run is recorded as a video.
 *
 * Outputs in test-results/body-scan-sim/:
 *   body-scan-mobile.mp4       the same run at a phone's portrait size (and body-scan-mobile-preview.gif)
 *   body-scan-simulation.mp4   the recorded run (setup → front → walk-around → results with mesh truth, 3D overlay
 *                              and the camera path)
 *   photos/*.png               rendered "photos" from the helper's walk at 0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°
 *   report.md, report.json     measured vs mesh truth and camera-path error: MediaPipe (walk-around), and the
 *                              exact-mask oracle for both the walk-around and the turn-on-the-spot scenarios
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
  // Neck is a front-only estimate and floor-based lengths (waist height, inseam) depend on the heel line; from a
  // handheld front view at chest height both are the weakest results, so their bounds are wider than the girths'.
  // Walk-around chest varies run to run (about −4.5% to 0%): it sits just below the armpits, where girth changes ~2% per cm
  // of height, and which front frame is chosen shifts it. Tracked as its own fix; torso bound is 5% until then.
  oracle: { torso: 5, legs: 8, neck: 20, arms: 12, lengthCm: 3 },
  mediapipe: { torso: 5, legs: 12, neck: 30, arms: 25, lengthCm: 6 }, // the front-only neck estimate is the weakest number
};
type Trajectory = { frames: number; ateCm: number; distanceErrCm: number; heightErrCm: number; angleErrDeg: number } | null;
type Run = { comparison: Comparison[]; trajectory: Trajectory };
function check(rows: Comparison[], l: (typeof LIMITS)['oracle']): string[] {
  const bound = (id: string) => ['chest', 'waist', 'hip'].includes(id) ? l.torso : ['thigh', 'knee', 'calf', 'ankle'].includes(id) ? l.legs : id === 'neck' ? l.neck : l.arms;
  return rows.filter(r => r.method === 'input' ? false : ['neck', 'chest', 'waist', 'hip', 'thigh', 'knee', 'calf', 'ankle', 'bicep', 'forearm', 'wrist'].includes(r.id) ? Math.abs(r.errorPct) > bound(r.id) : Math.abs(r.errorCm) > l.lengthCm).map(r => `${r.id} ${r.errorPct.toFixed(1)}%`);
}

/** Headless Chrome's fullscreen shrinks the page to its default screen size; real phones fill the display. */
const noFullscreen = (page: Page) => page.evaluateOnNewDocument(() => { Element.prototype.requestFullscreen = () => Promise.reject(new Error('disabled while recording')); });

async function run(page: Page, detector: 'mediapipe' | 'oracle', scenario: 'orbit' | 'turn' = 'orbit'): Promise<Run> {
  await page.goto(`${origin}/?detector=${detector}&scenario=${scenario}`, { waitUntil: 'load' });
  await sleep(1500);
  // Scroll to the button first so a recording shows the page instead of jumping (on phones it is below the fold).
  await page.evaluate(() => document.getElementById('start-demo')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await sleep(1500);
  await page.click('#start-demo');
  await page.waitForFunction(() => document.body.dataset.screen === 'capture', { timeout: 30000 });
  await page.waitForFunction(() => ['Turn', 'Walk around'].includes(document.getElementById('step-title')?.textContent ?? ''), { timeout: 180000 });
  log(`${detector} ${scenario}: front captured, going around`);
  await page.waitForFunction(() => document.body.dataset.screen === 'results', { timeout: 600000 });
  await page.waitForSelector('#view3d[data-rendered="true"]', { timeout: 20000 });
  return page.evaluate(() => (window as unknown as { __scan: Run }).__scan);
}

let failed: string[] = [];
try {
  // 1. Recorded MediaPipe run at a desktop size (capture view beside the guidance panel).
  const page = await browser.newPage();
  await noFullscreen(page);
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
  for (const target of ['#measurements', '#view3d', '#path-figure', '.export']) {
    await page.evaluate(sel => document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), target);
    await sleep(3500);
  }
  await recorder.stop();
  // Example rendered photos.
  for (const yaw of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const url = await page.evaluate(y => (window as unknown as { __sim: { renderPhoto(y: number): string } }).__sim.renderPhoto(y), yaw);
    await writeFile(join(out, 'photos', `body-yaw-${String(yaw).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  await page.screenshot({ path: join(out, 'results.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();

  // 1b. The same end-to-end MediaPipe run recorded at a phone's portrait size (393 × 852).
  const phone = await browser.newPage();
  await noFullscreen(phone);
  const phoneErrors: string[] = [];
  phone.on('pageerror', e => phoneErrors.push(String(e)));
  await phone.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  // The recorder takes its frame size from the page open when it starts: open the app first (a blank page lays
  // out 980 px wide under phone emulation).
  await phone.goto(`${origin}/`, { waitUntil: 'load' });
  const phoneWebm = join(out, 'body-scan-mobile.webm') as `${string}.webm`;
  const phoneRecorder = await phone.screencast({ path: phoneWebm });
  const mpPhone = await run(phone, 'mediapipe');
  await sleep(2500);
  for (const target of ['#summary', '#measurements', '#view3d', '#path-figure', '.thumbs', '.export']) {
    await phone.evaluate(sel => document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), target);
    await sleep(3000);
  }
  await phoneRecorder.stop();
  assert.deepEqual(phoneErrors, []);
  await phone.close();
  failed.push(...check(mpPhone.comparison, LIMITS.mediapipe).map(f => `mediapipe phone ${f}`));

  // 2. Oracle runs (exact mask and joints) — isolate the geometry from the ML model.
  const oracleRun = async (scenario: 'orbit' | 'turn') => {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 720 });
    const r = await run(p, 'oracle', scenario);
    await p.close();
    return r;
  };
  const oracle = await oracleRun('orbit'), oracleTurn = await oracleRun('turn');

  const mp4 = join(out, 'body-scan-simulation.mp4'), phoneMp4 = join(out, 'body-scan-mobile.mp4'), phoneGif = join(out, 'body-scan-mobile-preview.gif');
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', phoneWebm, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', phoneMp4]);
    // A small, sped-up looping preview (GitHub READMEs show GIFs inline, not MP4s).
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', phoneMp4, '-vf', 'setpts=PTS/5,fps=5,scale=220:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', phoneGif]);
    await rm(phoneWebm);
  } catch { log('ffmpeg unavailable: keeping the phone .webm only'); }
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', mp4]);
    await rm(webm);
  } catch { log('ffmpeg/libx264 unavailable: keeping the .webm only'); }
  const path = (t: Trajectory) => t ? `Camera path: ${t.frames} frames, ${t.ateCm} cm RMS position error (angle ${t.angleErrDeg}°, height ${t.heightErrCm} cm, distance ${t.distanceErrCm} cm).` : '';
  const md = `# Simulated body scan vs mesh ground truth

Body: CC0 MakeHuman base mesh (${oracle.comparison.find(r => r.id === 'height')?.truthCm.toFixed(1)} cm), arms straight out, standing in a furnished room. A helper walks one circle around them holding the phone (portrait 720×1280, 66° vertical field of view) about 2.6 m away at chest height; distance, height, aim, pitch and roll wander, and the gravity reading has ~0.4° of noise. Truth: the posed mesh sliced where the app measured (tape = convex hull of the cross-section), and the true camera path.

## MediaPipe on rendered frames, helper walks around (the real app pipeline)

${comparisonTable(mp.comparison)}

${path(mp.trajectory)}

## Oracle (exact mask and joints), helper walks around

${comparisonTable(oracle.comparison)}

${path(oracle.trajectory)}

## Oracle, phone propped and the subject turns on the spot

${comparisonTable(oracleTurn.comparison)}

${path(oracleTurn.trajectory)}
`;
  await writeFile(join(out, 'report.md'), md);
  await writeFile(join(out, 'report.json'), JSON.stringify({ mediapipe: mp, oracle, oracleTurn }, null, 2));
  console.log(md);
  failed = [...check(oracle.comparison, LIMITS.oracle).map(f => `oracle ${f}`), ...check(oracleTurn.comparison, LIMITS.oracle).map(f => `oracle turn ${f}`), ...check(mp.comparison, LIMITS.mediapipe).map(f => `mediapipe ${f}`)];
  const pathOk = (t: Trajectory, angle: number, height: number) => !!t && t.angleErrDeg < angle && t.heightErrCm < height;
  if (!pathOk(oracle.trajectory, 3, 3)) failed.push(`oracle camera path ${JSON.stringify(oracle.trajectory)}`);
  if (!pathOk(mp.trajectory, 8, 5)) failed.push(`mediapipe camera path ${JSON.stringify(mp.trajectory)}`);
  if (!pathOk(oracleTurn.trajectory, 3, 3)) failed.push(`oracle turn camera path ${JSON.stringify(oracleTurn.trajectory)}`);
  log(`Video: ${existsSync(mp4) ? mp4 : webm}`);
  log(`Phone video: ${existsSync(phoneMp4) ? `${phoneMp4} (preview ${phoneGif})` : phoneWebm}`);
  log(`Photos and report: ${out}`);
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.httpServer.close(() => resolve()));
}
assert.deepEqual(failed, [], `Over the limit: ${failed.join(', ')}`);
log('Simulation matches mesh ground truth within limits.');
