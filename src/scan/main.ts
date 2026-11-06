import './scan.css';
import { DEG, foldAngle } from './geometry.ts';
import { analyzeFront, analyzeSide, armsRaised, combineAnalyses, hipScale, type FrontAnalysis, type SideAnalysis } from './measure.ts';
import { allOk, evaluate, Stillness, type Check } from './quality.ts';
import { buildReport, CM_PER_INCH, formatLength, LABELS, METHOD_TEXT, toCsv, type Report, type Units } from './report.ts';
import { analyzeTurnFrame, cameraPath, circleCoverage, unwrapAngles, yawOf, type AroundMode, type TurnSample } from './turntable.ts';
import { rectify } from './rectify.ts';
import { CameraFeed, paintMask, Tilt, type Feed, type Frame, type Step } from './feeds.ts';
import { drawAnalysis, drawGuide, drawLive, renderChecks } from './overlay.ts';
import type { SimFeed } from '../sim/sim-feed.ts';
import type { Comparison, TrajectoryError } from '../sim/compare.ts';
import type { PoseSource } from './pose-mediapipe.ts';
import type { PackagedFrame } from './capture-package.ts';
import type { Observation } from './types.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const STORE = 'fabric-body-scan:last';

let units: Units = 'cm';
let pose: PoseSource | null = null;
let feed: Feed | null = null;
let abort: AbortController | null = null;
let manual = false;
let disposeView: (() => void) | null = null;
let current: { report: Report; front: FrontAnalysis; frontObs: Observation; frontImage: HTMLCanvasElement; side: SideAnalysis | null; sideObs: Observation | null; sideImage: HTMLCanvasElement | null; frames: PackagedFrame[]; sim: SimFeed | null; comparison: Comparison[] | null; samples: TurnSample[]; trajectory: TrajectoryError | null; mode: AroundMode | 'profile' } | null = null;

try { const u = localStorage.getItem('fabric-body-scan:units'); if (u === 'in' || u === 'cm') units = u; } catch { /* storage unavailable */ }

function show(screen: 'setup' | 'capture' | 'results') {
  for (const id of ['setup', 'capture', 'results']) $(id).hidden = id !== screen;
  document.body.dataset.screen = screen;
  window.scrollTo(0, 0);
}
function setUnits(next: Units) {
  units = next;
  $('units').textContent = units;
  try { localStorage.setItem('fabric-body-scan:units', units); } catch { /* ignore */ }
  if (current) renderResults();
}
$('units').addEventListener('click', () => setUnits(units === 'cm' ? 'in' : 'cm'));
setUnits(units);
$<HTMLSelectElement>('height-unit').value = units;

function heightCm(): number | null {
  const v = parseFloat($<HTMLInputElement>('height').value);
  const cm = $<HTMLSelectElement>('height-unit').value === 'in' ? v * CM_PER_INCH : v;
  return cm >= 100 && cm <= 230 ? cm : null;
}
function setupError(message: string) { const e = $('setup-error'); e.textContent = message; e.hidden = !message; }

let lastSpoken = '';
function say(text: string) {
  if (!$<HTMLInputElement>('voice').checked || !('speechSynthesis' in window) || text === lastSpoken) return;
  lastSpoken = text;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  speechSynthesis.speak(u);
}
let audio: AudioContext | null = null;
function beep(freq = 880, ms = 120) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq; g.gain.value = 0.08;
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + ms / 1000);
  } catch { /* audio unavailable */ }
}

async function loadPose(): Promise<PoseSource> {
  if (pose) return pose;
  $('capture-status').textContent = 'Loading the on-device pose model…';
  const { createMediaPipePose } = await import('./pose-mediapipe.ts');
  pose = await createMediaPipePose();
  return pose;
}

// ---------- capture loop ----------
const live = $<HTMLCanvasElement>('live');
const liveCtx = live.getContext('2d')!;

function paint(frame: Frame, checks: readonly Check[], ready: boolean) {
  if (live.width !== frame.width || live.height !== frame.height) { live.width = frame.width; live.height = frame.height; }
  drawLive(liveCtx, frame, frame.obs, ready, feed?.mirror ?? false);
  drawGuide(liveCtx);
  renderChecks($('checks'), checks);
}
function stepHeader(n: number, total: number, title: string, instruction: string) {
  $('step-count').textContent = `Step ${n} of ${total}`;
  $('step-title').textContent = title;
  $('step-instruction').textContent = instruction;
  $('capture-status').textContent = '';
  $('countdown').textContent = '';
  $('capture-now').textContent = title === 'Turn' ? 'Finish turn' : title === 'Walk around' ? 'Finish walk' : 'Capture now';
  say(instruction);
}

type Still = { obs: Observation[]; image: HTMLCanvasElement };
/** Waits until every check passes for a moment, counts down, then collects several frames. */
/** Analysis uses the frame leveled with the phone's gravity reading; the display keeps the raw frame. */
const level = (o: Observation | null) => (o ? rectify(o, feed?.gravityUp?.()) : null);

async function captureStill(step: 'front' | 'profile', signal: AbortSignal, refShoulderSpan?: number, handheld = false): Promise<Still> {
  const still = new Stillness();
  const started = performance.now();
  let okSince: number | null = null, spokenHint = 0;
  const collected: Observation[] = [];
  let image: HTMLCanvasElement | null = null;
  manual = false;
  while (!signal.aborted) {
    const frame = await feed!.frame(step, performance.now() - started);
    if (!frame) continue;
    const checks = evaluate(frame.obs, step, { still, tiltDeg: feed!.tilt(), refShoulderSpan, handheld });
    const ok = allOk(checks);
    const now = performance.now();
    if (manual && frame.obs) okSince ??= now - 3000;
    if (ok || manual) okSince ??= now; else if (!collected.length) okSince = null;
    paint(frame, checks, ok);
    if (okSince === null) {
      const failing = checks.find(c => !c.ok);
      if (failing && now - spokenHint > 4000) { $('capture-status').textContent = failing.hint; if (now - started > 2500) say(failing.hint); spokenHint = now; }
      $('countdown').textContent = '';
      continue;
    }
    const left = 3 - Math.floor((now - okSince) / 700);
    if (left > 0) { $('countdown').textContent = String(left); $('capture-status').textContent = 'Hold still…'; continue; }
    $('countdown').textContent = '';
    if (frame.obs && checks.find(c => c.id === 'person')?.ok) {
      if (!collected.length) { beep(); image = feed!.snapshot(); }
      collected.push(level(frame.obs)!);
      $('capture-status').textContent = `Capturing ${collected.length}/6`;
      if (collected.length >= 6) { beep(1320, 180); return { obs: collected, image: image! }; }
    }
  }
  throw new DOMException('cancelled', 'AbortError');
}

type Turn = { samples: TurnSample[]; profiles: { o: Observation; theta: number; facing: number }[]; profileImage: HTMLCanvasElement | null; frames: PackagedFrame[] };
/** Ring of 36 ten-degree sectors: which viewing angles around the subject have been captured (top = in front). */
function drawDial(bins: boolean[], coveredDeg: number) {
  const g = $('dial-bins') as unknown as SVGGElement;
  const parts: string[] = [];
  bins.forEach((on, i) => {
    const a0 = (i * 10 - 90) * DEG, a1 = a0 + 9 * DEG;
    const p = (a: number, r: number) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
    parts.push(`<path d="M ${p(a0, 30)} A 30 30 0 0 1 ${p(a1, 30)} L ${p(a1, 44)} A 44 44 0 0 0 ${p(a0, 44)} Z" fill="${on ? '#50dc96' : '#ffffff22'}"/>`);
  });
  g.innerHTML = parts.join('');
  $('dial-label').textContent = `${Math.min(360, Math.round(coveredDeg))}°`;
}
const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>(r => c.toBlob(b => r(b!), type, q));
function maskCanvas(o: Observation) {
  const c = document.createElement('canvas');
  c.width = o.width; c.height = o.height;
  const ctx = c.getContext('2d')!, img = ctx.createImageData(o.width, o.height);
  for (let i = 0; i < o.mask.data.length; i++) { const v = o.mask.data[i] * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function captureAround(front: FrontAnalysis, signal: AbortSignal, mode: AroundMode): Promise<Turn> {
  const samples: TurnSample[] = [], profiles: Turn['profiles'] = [], frames: PackagedFrame[] = [];
  let profileImage: HTMLCanvasElement | null = null;
  const started = performance.now();
  let lastFrameKept = 0, armsOutAt: number | null = null;
  manual = false;
  $('turn-dial').hidden = false;
  drawDial(circleCoverage([]), 0);
  while (!signal.aborted) {
    const elapsed = performance.now() - started;
    const frame = await feed!.frame('turn', elapsed);
    if (!frame) continue;
    const checks = evaluate(frame.obs, 'turn', { tiltDeg: feed!.tilt(), handheld: mode === 'orbit' });
    // Arms out is required: frames with the arms down are shown but never measured.
    const up = checks.find(c => c.id === 'arms')?.ok ?? false;
    if (up) armsOutAt ??= performance.now();
    paint(frame, checks, up);
    const o = level(frame.obs);
    if (o && up && armsOutAt !== null && checks.find(c => c.id === 'frame')?.ok) {
      const s = analyzeTurnFrame(o, front, mode);
      if (s) {
        samples.push(s);
        if (foldAngle(s.theta) > 80 * DEG && up && profiles.length < 10 && (!profiles.length || o.timestamp - profiles[profiles.length - 1].o.timestamp > 80)) {
          profiles.push({ o, theta: s.theta, facing: Math.cos(s.camera?.angle ?? 0) });
          profileImage ??= feed!.snapshot();
        }
        if (o.timestamp - lastFrameKept > 280 && frames.length < 60) {
          lastFrameKept = o.timestamp;
          const shot = feed!.snapshot();
          frames.push({ jpeg: await toBlob(shot, 'image/jpeg', 0.85), mask: await toBlob(maskCanvas(frame.obs!), 'image/png'), thetaDeg: s.theta / DEG, timestamp: o.timestamp, cmPerPx: s.cmPerPx, landmarks: frame.obs!.landmarks, world: o.world, camera: s.camera, up: feed!.gravityUp?.() ?? null });
        }
      }
    }
    const { coveredDeg } = unwrapAngles(samples);
    drawDial(circleCoverage(samples), coveredDeg);
    const turning = armsOutAt !== null ? performance.now() - armsOutAt : 0;
    $('capture-status').textContent = armsOutAt === null || !up ? 'Hold both arms straight out to the sides.' : mode === 'orbit' ? `Walking around… ${Math.round(coveredDeg)}° of 360°` : `Turning… ${samples.length} views`;
    const done = feed!.turnDone ? feed!.turnDone() : coveredDeg >= 345 && samples.length >= 30;
    const timeout = mode === 'orbit' ? 90000 : 25000;
    if (done || manual || (!feed!.turnDone && turning > timeout) || (armsOutAt === null && elapsed > 15000)) {
      beep(1320, 180);
      $('turn-dial').hidden = true;
      return { samples, profiles, profileImage, frames };
    }
  }
  throw new DOMException('cancelled', 'AbortError');
}

async function runCameraFlow(kind: 'camera' | 'sim') {
  let h = kind === 'sim' ? 0 : heightCm();
  if (kind === 'camera' && !h) { setupError('Enter a height between 100 and 230 cm (39–90 in).'); $('height').focus(); return; }
  setupError('');
  const scenario = params.get('scenario') === 'turn' ? 'turn' : 'orbit';
  const mode = (kind === 'sim' ? scenario : (document.querySelector('input[name="mode"]:checked') as HTMLInputElement).value) as AroundMode | 'profile';
  const handheld = mode === 'orbit';
  abort = new AbortController();
  const { signal } = abort;
  show('capture');
  try {
    let sim: SimFeed | null = null;
    if (kind === 'sim') {
      const detector = params.get('detector') === 'oracle' ? 'oracle' : 'mediapipe';
      $('capture-status').textContent = 'Loading the simulated body…';
      const { SimFeed } = await import('../sim/sim-feed.ts');
      sim = await SimFeed.create({ detector, scenario, pose: detector === 'mediapipe' ? await loadPose() : undefined, turnStepDeg: Number(params.get('turnStep')) || 4, girthScale: Number(params.get('girth')) || 1 });
      feed = sim;
      (window as unknown as { __sim: SimFeed }).__sim = sim;
      h = sim.heightCm;
      showInset(sim.inset, detector, scenario);
    } else {
      await Tilt.request();
      const facing = (document.querySelector('input[name="facing"]:checked') as HTMLInputElement).value as 'environment' | 'user';
      const p = await loadPose();
      feed = await CameraFeed.open($<HTMLVideoElement>('video'), p, facing);
    }
    const total = 2;
    stepHeader(1, total, 'Front', handheld
      ? 'Helper: stand about two and a half metres in front, phone upright at chest height, head to feet in frame. Subject: face the phone, arms straight out to the sides, palms down, feet apart.'
      : 'Face the camera. Hold both arms straight out to the sides at shoulder height, palms down, feet hip-width apart.');
    const f = await captureStill('front', signal, undefined, handheld);
    const front = combineAnalyses(f.obs.map(o => analyzeFront(o, { kind: 'height', heightCm: h! })).filter((a): a is FrontAnalysis => !!a));
    if (!front) throw new Error('Could not find a full body outline in the front frames. Check lighting and framing, then try again.');
    requireTorso(front);
    let side: SideAnalysis | null = null, sideObs: Observation | null = null, sideImage: HTMLCanvasElement | null = null;
    let samples: TurnSample[] = [], frames: PackagedFrame[] = [];
    if (mode !== 'profile') {
      if (mode === 'orbit') stepHeader(2, total, 'Walk around', 'Helper: walk slowly in a full circle around them, about two and a half metres away, keeping head to feet in frame. Subject: stay still with your arms out.');
      else stepHeader(2, total, 'Turn', 'Keep your arms straight out and turn slowly on the spot. One full circle, about ten seconds.');
      const t = await captureAround(front, signal, mode);
      samples = t.samples; frames = t.frames;
      side = combineAnalyses(t.profiles.map(p => analyzeSide(p.o, front, mode === 'orbit' ? { kind: 'height', heightCm: h!, facing: p.facing } : { kind: 'fixed', cmPerPx: front.scale.cmPerPx, floorY: front.scale.floorY }, p.theta)).filter((a): a is SideAnalysis => !!a));
      sideObs = t.profiles[0]?.o ?? null; sideImage = t.profileImage;
    } else {
      stepHeader(2, total, 'Profile', 'Keep your arms straight out and turn ninety degrees to your left.');
      const s = await captureStill('profile', signal, front.ref.shoulderSpanPx);
      side = combineAnalyses(s.obs.map(o => analyzeSide(o, front, { kind: 'fixed', cmPerPx: front.scale.cmPerPx, floorY: front.scale.floorY }, yawOf(o, front))).filter((a): a is SideAnalysis => !!a));
      sideObs = s.obs[0]; sideImage = s.image;
    }
    feed.stop();
    const report = buildReport(front, side, samples);
    say('Scan complete.');
    let comparison: Comparison[] | null = null;
    let trajectory: TrajectoryError | null = null;
    if (sim) {
      const { compareToMesh, trajectoryError } = await import('../sim/compare.ts');
      const t = sim.truth(f.obs[0].timestamp);
      comparison = compareToMesh(report, front, t.body, t.cam);
      if (mode !== 'profile') trajectory = trajectoryError(samples, samples.map(s => sim!.cameras.get(s.timestamp)?.position ?? [NaN, NaN, NaN]));
    }
    current = { report, front, frontObs: f.obs[0], frontImage: f.image, side, sideObs, sideImage, frames, sim, comparison, samples, trajectory, mode };
    (window as unknown as { __scan: unknown }).__scan = { report, comparison, trajectory };
  } catch (error) {
    feed?.stop();
    if ((error as Error).name === 'AbortError') { show('setup'); return; }
    show('setup');
    setupError(cameraMessage(error));
    return;
  }
  finish();
}

function requireTorso(front: FrontAnalysis) {
  if (!front.sites.waist && !front.sites.hip) throw new Error(`The torso outline was not usable. ${front.warnings.join(' ')} Make sure only one person is in frame, wearing fitted clothes, then try again.`);
}

function cameraMessage(error: unknown): string {
  const e = error as Error;
  if (e.name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access for this site in your browser settings, then try again.';
  if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return 'No suitable camera was found on this device.';
  if (!window.isSecureContext) return 'The camera needs a secure (https) page.';
  return e.message || String(error);
}

async function measurePhotos() {
  const h = heightCm();
  if (!h) { setupError('Enter a height between 100 and 230 cm (39–90 in).'); return; }
  const frontFile = $<HTMLInputElement>('front-photo').files?.[0];
  if (!frontFile) { setupError('Choose a front photo.'); return; }
  setupError('');
  $('measure-photos').setAttribute('aria-busy', 'true');
  try {
    const p = await loadPose();
    const load = async (file: File) => { const img = new Image(); img.src = URL.createObjectURL(file); await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d')!.drawImage(img, 0, 0); return c; };
    const frontImage = await load(frontFile);
    const frontObs = await p.detect(frontImage, 0, 'IMAGE');
    if (!frontObs) throw new Error('No person was detected in the front photo.');
    const front = analyzeFront(frontObs, { kind: 'height', heightCm: h });
    if (!front) throw new Error('Could not trace a full head-to-feet outline in the front photo.');
    requireTorso(front);
    let side: SideAnalysis | null = null, sideObs: Observation | null = null, sideImage: HTMLCanvasElement | null = null;
    const sideFile = $<HTMLInputElement>('side-photo').files?.[0];
    if (sideFile) {
      sideImage = await load(sideFile);
      sideObs = await p.detect(sideImage, 0, 'IMAGE');
      if (sideObs) {
        const source = armsRaised(sideObs) ? hipScale(sideObs, front) : { kind: 'height' as const, heightCm: h };
        side = source ? analyzeSide(sideObs, front, source, yawOf(sideObs, front)) : null;
      }
    }
    current = { report: buildReport(front, side), front, frontObs, frontImage, side, sideObs, sideImage, frames: [], sim: null, comparison: null, samples: [], trajectory: null, mode: 'profile' };
  } catch (error) {
    setupError((error as Error).message);
    return;
  } finally {
    $('measure-photos').removeAttribute('aria-busy');
  }
  finish();
}

// ---------- results ----------
function finish() {
  try { localStorage.setItem(STORE, JSON.stringify(current!.report)); } catch { /* ignore */ }
  show('results');
  renderResults();
}

function showInset(inset: HTMLCanvasElement, detector: string, scenario: string) {
  inset.className = 'sim-inset';
  inset.setAttribute('aria-label', 'Simulation: the phone and the turning body seen from outside');
  const badge = document.createElement('p');
  badge.className = 'sim-badge';
  badge.textContent = `Simulation · ${scenario === 'orbit' ? 'helper walks around in a room' : 'subject turns'} · ${detector === 'oracle' ? 'exact mask and joints' : 'MediaPipe on rendered frames'}`;
  $('stage').append(inset, badge);
}

function renderResults() {
  if (!current) return;
  const { report, front, comparison } = current;
  const demo = !!comparison;
  $('results-source').textContent = demo ? 'Simulation · scored against the posed 3D mesh' : `Scanned ${new Date(report.createdAt).toLocaleString()}`;
  const fmt = (cm: number) => formatLength(cm, units);
  $('summary').replaceChildren(...['chest', 'waist', 'hip'].map(id => {
    const m = report.measurements.find(x => x.id === id);
    const div = document.createElement('div');
    div.className = 'stat';
    div.innerHTML = '<span></span><strong></strong><small></small>';
    div.children[0].textContent = LABELS[id as 'chest'];
    div.children[1].textContent = m ? fmt(m.cm) : '—';
    div.children[2].textContent = m ? `± ${fmt(m.errorCm)} · ${m.method}` : 'not measured';
    return div;
  }));
  const head = $('measurements').querySelector('thead tr')!;
  head.querySelector('[data-truth]')?.remove();
  head.querySelector('[data-error]')?.remove();
  if (demo) for (const [key, text] of [['truth', 'Mesh'], ['error', 'Error']]) { const th = document.createElement('th'); th.scope = 'col'; th.dataset[key] = ''; th.textContent = text; head.append(th); }
  const tbody = $('measurements').querySelector('tbody')!;
  tbody.replaceChildren(...report.measurements.map(m => {
    const tr = document.createElement('tr');
    tr.dataset.id = m.id; tr.dataset.group = m.group;
    const cells = [m.label, fmt(m.cm), m.errorCm ? fmt(m.errorCm) : '—', m.method];
    if (demo) { const c = comparison!.find(x => x.id === m.id); cells.push(c ? fmt(c.truthCm) : '—', c ? `${c.errorPct >= 0 ? '+' : ''}${c.errorPct.toFixed(1)}%` : '—'); }
    cells.forEach((text, i) => { const td = document.createElement(i ? 'td' : 'th'); if (!i) td.setAttribute('scope', 'row'); td.textContent = text; if (i === 3) td.title = METHOD_TEXT[m.method]; tr.append(td); });
    return tr;
  }));
  $('warnings').replaceChildren(...report.warnings.map(w => { const li = document.createElement('li'); li.textContent = w; return li; }));
  if (report.turnCoverage > 0) { const li = document.createElement('li'); li.className = 'info'; li.textContent = `Turn coverage: ${Math.round(report.turnCoverage * 100)}% of viewing angles.`; $('warnings').append(li); }
  drawAnalysis($<HTMLCanvasElement>('front-view'), current.frontImage.width > 1 ? current.frontImage : paintMask(current.frontObs), front, current.frontObs);
  $('side-figure').hidden = !(current.side && current.sideObs);
  if (current.side && current.sideObs) drawAnalysis($<HTMLCanvasElement>('side-view'), current.sideImage ?? paintMask(current.sideObs), current.side, current.sideObs);
  $('download-package').hidden = !current.frames.length;
  drawPath();
  disposeView?.();
  disposeView = null;
  import('./view3d.ts').then(({ showBody }) => { if (current) disposeView = showBody($('view3d'), current.report, current.front, current.sim?.ghost()); });
  document.body.dataset.measured = String(report.measurements.length);
}

/** Top view of where the camera was, estimated from each frame (and the true path in simulation). */
function drawPath() {
  const fig = $('path-figure'), svg = $('path-plot');
  const est = cameraPath(current!.samples).map(c => ({ s: c, c }));
  fig.hidden = est.length < 5;
  if (fig.hidden) return;
  // World x (subject's left) and z (in front of them) seen from above with the subject facing up the screen:
  // their left is on the screen's left, so screen = (−x, −z).
  const pt = (angle: number, d: number) => [d * Math.sin(angle), d * Math.cos(angle)];
  const scr = (p: number[]) => [-p[0], -p[1]];
  const line = (pts: number[][]) => pts.map((p, i) => `${i ? 'L' : 'M'}${scr(p)[0].toFixed(1)} ${scr(p)[1].toFixed(1)}`).join(' ');
  const parts = ['<circle r="300" fill="none" stroke="#ffffff14"/>', '<circle r="200" fill="none" stroke="#ffffff10"/>', '<circle r="100" fill="none" stroke="#ffffff10"/>',
    '<ellipse rx="22" ry="14" fill="#9fb4d0"/><path d="M0 -14 L0 -40" stroke="#9fb4d0" stroke-width="4"/>'];
  if (current!.sim) {
    const truth = est.map(e => current!.sim!.cameras.get(e.s.timestamp)?.position).filter((p): p is [number, number, number] => !!p).map(p => [p[0], p[2]]);
    parts.push(`<path d="${line(truth)}" fill="none" stroke="#ffffffaa" stroke-width="3" stroke-dasharray="10 8"/>`);
  }
  parts.push(`<path d="${line(est.map(e => pt(e.c.angle, e.c.distanceCm)))}" fill="none" stroke="#50dc96" stroke-width="4"/>`);
  for (const e of est) { const [x, y] = scr(pt(e.c.angle, e.c.distanceCm)); parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#50dc96"/>`); }
  svg.innerHTML = parts.join('');
  const t = current!.trajectory;
  $('path-caption').textContent = `Camera path from above (subject faces up; rings every 1 m). Green: estimated from each frame` + (t ? `; dashed: true path. Error ${t.ateCm} cm RMS (angle ${t.angleErrDeg}°, height ${t.heightErrCm} cm, distance ${t.distanceErrCm} cm).` : '.');
}

function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
$('download-csv').addEventListener('click', () => current && download(`body-scan-${stamp()}.csv`, new Blob([toCsv(current.report)], { type: 'text/csv' })));
$('download-json').addEventListener('click', () => current && download(`body-scan-${stamp()}.json`, new Blob([JSON.stringify(current.report, null, 2)], { type: 'application/json' })));
$('download-package').addEventListener('click', async () => {
  if (!current) return;
  const { buildCapturePackage } = await import('./capture-package.ts');
  download(`body-scan-capture-${stamp()}.zip`, await buildCapturePackage(current.frames, current.report, current.front));
});
$('new-scan').addEventListener('click', () => { disposeView?.(); disposeView = null; current = null; show('setup'); });

$('setup-form').addEventListener('submit', event => { event.preventDefault(); void runCameraFlow('camera'); });
$('start-demo').addEventListener('click', () => void runCameraFlow('sim'));
$('measure-photos').addEventListener('click', () => void measurePhotos());
$('capture-now').addEventListener('click', () => { manual = true; });
$('cancel-scan').addEventListener('click', () => abort?.abort());
addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.dataset.screen === 'capture') abort?.abort(); });
$('height-unit').addEventListener('change', () => {
  const input = $<HTMLInputElement>('height'), v = parseFloat(input.value);
  const toIn = $<HTMLSelectElement>('height-unit').value === 'in';
  input.min = toIn ? '39' : '100'; input.max = toIn ? '91' : '230';
  if (Number.isFinite(v)) input.value = (toIn ? v / CM_PER_INCH : v * CM_PER_INCH).toFixed(1);
});
if (params.get('demo') === '1' || params.get('sim') === '1') void runCameraFlow('sim');
