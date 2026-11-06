import test from 'node:test';
import assert from 'node:assert/strict';
import { DEG, cauchyPerimeter, ellipsePerimeter, ellipseWidth, foldAngle, yawFromSpans } from '../src/scan/geometry.ts';
import { chordAlong, rowRuns, verticalExtent } from '../src/scan/mask.ts';
import { analyzeFront, analyzeSide } from '../src/scan/measure.ts';
import { analyzeTurnFrame, girthFromWidths } from '../src/scan/turntable.ts';
import { buildReport, toCsv } from '../src/scan/report.ts';
import { armAngle, defaultBody as body, renderBody, truth } from '../src/scan/synthetic.ts';
import type { Mask } from '../src/scan/types.ts';

const near = (actual: number, expected: number, tol: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual.toFixed(3)} vs ${expected.toFixed(3)} (±${tol})`);
const pct = (actual: number, expected: number, p: number, what: string) => near(actual, expected, expected * p, what);

test('ellipse and Cauchy perimeters agree; Cauchy recovers non-elliptical shapes', () => {
  near(ellipsePerimeter(10, 10), 2 * Math.PI * 10, 1e-9, 'circle');
  near(cauchyPerimeter(t => ellipseWidth(34, 25, t)), ellipsePerimeter(17, 12.5), 1e-3, 'ellipse via Cauchy');
  // Rounded rectangle 30 × 20 with 5 cm corner radius: true perimeter 2(20 + 10) + 2π·5.
  const width = (t: number) => 20 * Math.abs(Math.cos(t)) + 10 * Math.abs(Math.sin(t)) + 10;
  const truePerimeter = 60 + 10 * Math.PI;
  near(cauchyPerimeter(width), truePerimeter, 1e-2, 'rounded rectangle via Cauchy');
  const twoView = ellipsePerimeter(15, 10);
  assert.ok(Math.abs(twoView - truePerimeter) / truePerimeter > 0.03, 'a two-view ellipse misreads boxy sections');
  const sampled = [15, 25, 35, 45, 55, 65, 75, 85].map(d => [d * DEG, width(d * DEG)] as [number, number]);
  pct(girthFromWidths(30, 20, sampled)!.girthCm, truePerimeter, 0.005, 'turntable girth of rounded rectangle');
});

test('angle folding and yaw from projected spans', () => {
  near(foldAngle(170 * DEG), 10 * DEG, 1e-9, 'fold 170°');
  near(foldAngle(-100 * DEG), 80 * DEG, 1e-9, 'fold −100°');
  near(yawFromSpans(0.5, 0.5, 1, 1), 60 * DEG, 1e-9, 'cos⁻¹ 0.5');
});

test('mask runs and chords are sub-pixel accurate', () => {
  const w = 40, data = new Float32Array(w * 3);
  for (let x = 0; x < w; x++) data[w + x] = Math.max(0, Math.min(1, Math.min(x + 1 - 10.3, 25.6 - x)));
  const mask: Mask = { width: w, height: 3, data };
  const [run] = rowRuns(mask, 1.5);
  near(run.x0, 10.3, 0.1, 'left edge');
  near(run.x1, 25.6, 0.1, 'right edge');
  const o = renderBody(body, { pose: 'a-pose' });
  const c = chordAlong(o.mask, { x: 360, y: 600 }, { x: 1, y: 0 });
  assert.ok(c && c.length > 0);
  const ext = verticalExtent(o.mask, { x: 360, y: 600 })!;
  near((ext.bottom - ext.top) * (175 / (1280 * 0.82)), 175, 0.3, 'silhouette height');
});

const front = analyzeFront(renderBody(body, { pose: 'a-pose' }), { kind: 'height', heightCm: body.heightCm })!;

test('front view: widths, levels and lengths match the synthetic body', () => {
  assert.ok(front, 'front analysis');
  assert.deepEqual(front.warnings, []);
  near(front.sites.chest!.heightCm, 128.9, 1, 'chest level');
  near(front.sites.waist!.heightCm, 105, 1.5, 'waist level (narrowest)');
  near(front.sites.hip!.heightCm, 88, 1.5, 'hip level (fullest)');
  for (const s of ['neck', 'chest', 'waist', 'hip'] as const) near(front.sites[s]!.widthCm, 2 * truth.torsoAxes(body, front.sites[s]!.heightCm)![0], 0.4, `${s} width`);
  near(front.lengths.inseam!.cm, 80, 0.6, 'inseam');
  near(front.lengths.armLength!.cm, 56, 0.3, 'arm length');
  near(front.lengths.legLength!.cm, 88, 0.3, 'hip-joint height');
  near(front.lengths.torsoLength!.cm, 56, 0.3, 'torso length');
  near(front.lengths.shoulderBreadth!.cm, 2 * (18 + 6 / Math.cos(armAngle('a-pose'))), 0.6, 'bideltoid breadth');
  near(front.sites.bicep!.widthCm, 2 * truth.armRadius(body, 0.35 * 30), 0.4, 'upper-arm width');
});

test('two-view girths are within 2% of the tape-measure truth', () => {
  const side = analyzeSide(renderBody(body, { pose: 'v-up', yawDeg: 90 }), front, { kind: 'fixed', cmPerPx: front.scale.cmPerPx })!;
  assert.ok(side);
  const report = buildReport(front, side);
  const by = Object.fromEntries(report.measurements.map(m => [m.id, m]));
  for (const s of ['chest', 'waist', 'hip'] as const) {
    assert.equal(by[s].method, 'two-view');
    pct(by[s].cm, truth.torso(body, by[s].levelCm!), 0.02, `${s} girth`);
  }
  for (const s of ['thigh', 'knee', 'calf'] as const) pct(by[s].cm, truth.leg(body, by[s].levelCm!), 0.03, `${s} girth`);
  assert.match(toCsv(report), /^id,measurement,cm,in/);
});

test('turntable samples at many angles give turntable girths', () => {
  const samples = [];
  for (let yaw = 0; yaw <= 360; yaw += 9) {
    const s = analyzeTurnFrame(renderBody(body, { pose: 'v-up', yawDeg: yaw, timestamp: yaw }), front);
    if (s) samples.push(s);
  }
  assert.ok(samples.length > 30);
  const report = buildReport(front, null, samples);
  assert.ok(report.turnCoverage >= 0.8, `coverage ${report.turnCoverage}`);
  for (const s of ['chest', 'waist', 'hip'] as const) {
    const m = report.measurements.find(x => x.id === s)!;
    assert.equal(m.method, 'turntable');
    pct(m.cm, truth.torso(body, m.levelCm!), 0.025, `${s} turntable girth`);
  }
});

test('front-only scans fall back to labelled estimates', () => {
  const report = buildReport(front, null);
  assert.equal(report.measurements.find(m => m.id === 'waist')!.method, 'front-estimate');
  assert.equal(report.measurements.find(m => m.id === 'thigh')!.method, 'circular');
});

test('near-profile frames: leg depth corrects for leg spacing; raised arms skip the neck', () => {
  const yaw = 84;
  const side = analyzeSide(renderBody(body, { pose: 'v-up', yawDeg: yaw }), front, { kind: 'fixed', cmPerPx: front.scale.cmPerPx }, yaw * DEG)!;
  assert.equal(side.sites.neck, undefined);
  const report = buildReport(front, side);
  for (const s of ['thigh', 'knee', 'calf', 'ankle'] as const) {
    const m = report.measurements.find(x => x.id === s)!;
    assert.equal(m.method, 'two-view');
    pct(m.cm, truth.leg(body, m.levelCm!), 0.03, `${s} girth at ${yaw}°`);
  }
  assert.equal(report.measurements.find(x => x.id === 'neck')!.method, 'front-estimate');
});

test('a second person touching the subject is rejected instead of measured', () => {
  const o = renderBody(body, { pose: 'a-pose' });
  for (let y = 300; y < 1100; y++) for (let x = 470; x < 720; x++) o.mask.data[y * o.width + x] = 1; // someone standing against the left arm
  const a = analyzeFront(o, { kind: 'height', heightCm: body.heightCm })!;
  assert.ok(a.warnings.some(w => /implausible|touching/.test(w)), a.warnings.join(' | '));
  for (const [name, s] of Object.entries(a.sites)) assert.ok(s!.widthCm < 0.35 * body.heightCm, `${name} ${s!.widthCm}`);
});
