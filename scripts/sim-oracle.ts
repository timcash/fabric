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
import { analyzeTurnFrame, unwrapAngles, type TurnSample } from '../src/scan/turntable.ts';
import { rectify } from '../src/scan/rectify.ts';
import { frontPose, helperPose, leveled, orbitCamera, sensedUp } from '../src/sim/path.ts';
import type { OrbitPose } from '../src/sim/camera.ts';
import { trajectoryError, type TrajectoryError } from '../src/sim/compare.ts';

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

/**
 * A helper walks one circle around the static subject with a handheld phone (see src/sim/path.ts). Every frame is
 * leveled with the noisy gravity reading, gets its own metric scale from the subject's height, and is scored
 * against the mesh; the estimated camera path is scored against the true one.
 */
export function simulateOrbit(body: PosedBody, frames = 90, path: (t: number) => OrbitPose = helperPose, front0: (t: number) => OrbitPose = frontPose): { report: Report; rows: Comparison[]; samples: TurnSample[]; trajectory: TrajectoryError; coveredDeg: number } {
  const fronts = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map(t => {
    const pose = front0(t);
    const cam = orbitCamera(pose);
    return { pose, o: rectify(oracleObservation(body, cam, 0, t * 1000), sensedUp(cam, t * 100)) };
  });
  const front = combineAnalyses(fronts.map(f => analyzeFront(f.o, { kind: 'height', heightCm: body.model.heightCm })).filter(a => !!a));
  if (!front) throw new Error('front analysis failed');
  const samples: TurnSample[] = [], truths: [number, number, number][] = [], profiles: SideAnalysis[] = [];
  for (let i = 0; i < frames; i++) {
    const pose = path(i / frames);
    const cam = orbitCamera(pose);
    const o = rectify(oracleObservation(body, cam, 0, 1000 + i * 100), sensedUp(cam, i + 1));
    const s = analyzeTurnFrame(o, front, 'orbit');
    if (!s) continue;
    samples.push(s); truths.push(cam.position);
    if (s.theta > (82 * Math.PI) / 180) {
      const a = analyzeSide(o, front, { kind: 'height', heightCm: body.model.heightCm, facing: Math.cos(s.camera!.angle) }, s.theta);
      if (a) profiles.push(a);
    }
  }
  const report = buildReport(front, combineAnalyses(profiles), samples);
  return { report, rows: compareToMesh(report, front, body, leveled(fronts[0].pose)), samples, trajectory: trajectoryError(samples, truths), coveredDeg: unwrapAngles(samples).coveredDeg };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const body = loadSimBody();
  const t = Date.now();
  const { rows, report } = simulateScan(body);
  console.log(comparisonTable(rows));
  console.log(`\nwarnings: ${report.warnings.join(' | ') || 'none'}; turn coverage ${(report.turnCoverage * 100).toFixed(0)}%; ${Date.now() - t} ms`);
  const o = simulateOrbit(body);
  console.log('\nHelper walks around with a handheld phone:\n' + comparisonTable(o.rows));
  console.log(`\ncamera path: covered ${o.coveredDeg.toFixed(0)}°, ${JSON.stringify(o.trajectory)}; warnings: ${o.report.warnings.join(' | ') || 'none'}`);
}
