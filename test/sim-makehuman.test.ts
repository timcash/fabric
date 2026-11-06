/**
 * Simulation: the CC0 MakeHuman mesh, posed with arms out, rendered through a perspective phone camera with exact
 * masks and joints, scanned by the app's own pipeline (front frame + 360° turn), and scored against girths sliced
 * from the posed mesh. Camera placement and body shape vary to show the method is not tuned to one setup.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneCamera } from '../src/sim/camera.ts';
import { comparisonTable } from '../src/sim/compare.ts';
import { loadSimBody, simulateScan } from '../scripts/sim-oracle.ts';

const LIMITS: Record<string, number> = { chest: 2, waist: 2, hip: 2, thigh: 5, knee: 5, calf: 5, ankle: 6, neck: 7, bicep: 10, forearm: 10, wrist: 12 };
const LENGTH_LIMIT_CM = 2.5;

const cases = [
  { name: 'phone at waist height, 2.5 m', girth: 1, cam: {} },
  { name: 'phone low (70 cm)', girth: 1, cam: { heightCm: 70 } },
  { name: 'phone high (130 cm), 3 m, wide lens', girth: 1, cam: { heightCm: 130, distanceCm: 300, vfovDeg: 72 } },
  { name: 'broader body (×1.25)', girth: 1.25, cam: {} },
  { name: 'slimmer body (×0.85)', girth: 0.85, cam: {} },
];

for (const c of cases) {
  test(`mesh truth: ${c.name}`, () => {
    const body = loadSimBody(90, c.girth);
    const { rows, report } = simulateScan(body, phoneCamera({ distanceCm: 250, ...c.cam }), 6);
    const failures = rows.filter(r => (r.id in LIMITS ? Math.abs(r.errorPct) > LIMITS[r.id] : Math.abs(r.errorCm) > LENGTH_LIMIT_CM));
    assert.ok(report.turnCoverage >= 0.8, `turn coverage ${report.turnCoverage}`);
    for (const id of ['chest', 'waist', 'hip', 'thigh', 'knee', 'calf']) assert.equal(rows.find(r => r.id === id)?.method, 'turntable', `${id} method`);
    assert.equal(failures.length, 0, `\n${comparisonTable(rows)}\nOver the limit: ${failures.map(f => f.id).join(', ')}`);
  });
}
