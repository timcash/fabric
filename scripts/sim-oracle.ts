/**
 * Simulated scan of the CC0 MakeHuman mesh with exact masks and joints, through a perspective phone camera.
 * Prints measured vs mesh-truth for every measurement. Used by test/sim-makehuman.test.ts and runnable alone:
 *   node --experimental-strip-types scripts/sim-oracle.ts
 */
import { readFileSync } from 'node:fs';
import { phoneCamera, type Camera } from '../src/sim/camera.ts';
import { compareToMesh, comparisonTable, type Comparison } from '../src/sim/compare.ts';
import { loadMakeHuman, poseBody, type PosedBody } from '../src/sim/makehuman.ts';
import { oracleObservation } from '../src/sim/observe.ts';
import { analyzeFront, analyzeSide, combineAnalyses, type SideAnalysis } from '../src/scan/measure.ts';
import { buildReport, type Report } from '../src/scan/report.ts';
import { analyzeTurnFrame, type TurnSample } from '../src/scan/turntable.ts';

export function loadSimBody(armDeg = 90, girthScale = 1): PosedBody {
  const dir = new URL('../public/sim/makehuman/', import.meta.url);
  const model = loadMakeHuman(readFileSync(new URL('base.obj', dir), 'utf8'), JSON.parse(readFileSync(new URL('default.mhskel', dir), 'utf8')), JSON.parse(readFileSync(new URL('default_weights.mhw', dir), 'utf8')), girthScale);
  return poseBody(model, { armDeg });
}

export function simulateScan(body: PosedBody, cam: Camera = phoneCamera({ distanceCm: 250 }), turnStepDeg = 6): { report: Report; rows: Comparison[]; samples: TurnSample[]; side: SideAnalysis | null } {
  const front = analyzeFront(oracleObservation(body, cam, 0), { kind: 'height', heightCm: body.model.heightCm });
  if (!front) throw new Error('front analysis failed');
  const samples: TurnSample[] = [];
  const profiles: SideAnalysis[] = [];
  for (let yaw = 0; yaw < 360; yaw += turnStepDeg) {
    const o = oracleObservation(body, cam, yaw, yaw);
    const s = analyzeTurnFrame(o, front);
    if (!s) continue;
    samples.push(s);
    if (s.theta > (82 * Math.PI) / 180) {
      const a = analyzeSide(o, front, { kind: 'fixed', cmPerPx: front.scale.cmPerPx, floorY: front.scale.floorY }, s.theta);
      if (a) profiles.push(a);
    }
  }
  const side = combineAnalyses(profiles);
  const report = buildReport(front, side, samples);
  return { report, rows: compareToMesh(report, front, body, cam), samples, side };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const body = loadSimBody();
  const t = Date.now();
  const { rows, report } = simulateScan(body);
  console.log(comparisonTable(rows));
  console.log(`\nwarnings: ${report.warnings.join(' | ') || 'none'}; turn coverage ${(report.turnCoverage * 100).toFixed(0)}%; ${Date.now() - t} ms`);
}
