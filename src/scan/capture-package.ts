/**
 * Exports the turn-in-place frames, person masks and per-frame metadata as a zip, ready for offline photogrammetry
 * or Gaussian-splat training. The browser measures; heavier reconstruction runs on a GPU machine. The known height
 * travels with the frames so the reconstruction can be brought to metric scale.
 */
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { FrontAnalysis } from './measure.ts';
import type { Report } from './report.ts';
import type { Landmark } from './types.ts';
import type { CameraEstimate } from './turntable.ts';
import { PHONE_FOV_DEG } from './measure.ts';

export type PackagedFrame = { jpeg: Blob; mask: Blob; thetaDeg: number; timestamp: number; cmPerPx: number; landmarks: Landmark[]; world: Landmark[]; camera?: CameraEstimate; up?: [number, number, number] | null };

const README = `Fabric body scan — capture package

frames/NNN.jpg   camera frames from the walk-around (helper moves, subject still) or turn (phone still) step
masks/NNN.png    person masks (white = subject)
meta.json        per frame: camera estimate (angle around the subject, distance, height, from the subject's known
                 height), the phone's gravity "up" vector, MediaPipe landmarks and scale; the intrinsics guess;
                 and the measurement report

Walk-around captures see a static scene (room + still subject), which is what visual odometry and SfM expect:
solve poses with COLMAP/GLOMAP, a feed-forward model (MASt3R/VGGT), or a metric visual-odometry model such as
NVIDIA MetricTrail (research licence; needs a CUDA GPU), then train 3D Gaussian splatting (gsplat, nerfstudio).
The per-frame camera estimates make a good initialization and a scale check: the reconstruction is metric when
the subject's height equals meta.json → heightCm. For turn captures (phone still, person turning), mask the
background and treat the subject as the object.
`;

export async function buildCapturePackage(frames: readonly PackagedFrame[], report: Report, front: FrontAnalysis): Promise<Blob> {
  const files: Zippable = { 'README.txt': strToU8(README) };
  const meta = {
    heightCm: front.heightCm,
    cmPerPxFront: front.scale.cmPerPx,
    note: 'thetaDeg is folded to 0–90°; camera.angle is the full angle around the subject (radians, 0 = in front, + toward the subject\'s left). Intrinsics are a guess from a typical phone lens.',
    report,
    intrinsicsGuess: { fovDegLongSide: PHONE_FOV_DEG, note: 'fx = fy = (long side / 2) / tan(fov / 2) in frame pixels; cx, cy = frame centre' },
    frames: [] as object[],
  };
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i], name = String(i).padStart(3, '0');
    files[`frames/${name}.jpg`] = [new Uint8Array(await f.jpeg.arrayBuffer()), { level: 0 }];
    files[`masks/${name}.png`] = [new Uint8Array(await f.mask.arrayBuffer()), { level: 0 }];
    meta.frames.push({ file: `frames/${name}.jpg`, mask: `masks/${name}.png`, thetaDeg: f.thetaDeg, timestamp: f.timestamp, cmPerPx: f.cmPerPx, camera: f.camera, up: f.up, landmarks: f.landmarks, worldLandmarks: f.world });
  }
  files['meta.json'] = strToU8(JSON.stringify(meta, null, 1));
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}
