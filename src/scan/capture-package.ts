/**
 * Exports the turn-in-place frames, person masks and per-frame metadata as a zip, ready for offline photogrammetry
 * or Gaussian-splat training. The browser measures; heavier reconstruction runs on a GPU machine. The known height
 * travels with the frames so the reconstruction can be brought to metric scale.
 */
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { FrontAnalysis } from './measure.ts';
import type { Report } from './report.ts';
import type { Landmark } from './types.ts';

export type PackagedFrame = { jpeg: Blob; mask: Blob; thetaDeg: number; timestamp: number; cmPerPx: number; landmarks: Landmark[]; world: Landmark[] };

const README = `Fabric body scan — capture package

frames/NNN.jpg   camera frames from the turn-in-place step (subject turns, phone is still)
masks/NNN.png    person masks (white = subject); mask the static background before reconstruction
meta.json        per-frame folded yaw estimate (0–90°), MediaPipe landmarks, scale, and the measurement report

Because the camera is fixed and the person turns, treat it as an object-centric capture: mask the background,
then solve poses with COLMAP/GLOMAP (or a feed-forward model such as MASt3R/VGGT), and train 3D Gaussian
splatting (gsplat, nerfstudio splatfacto) or a body-model-anchored avatar. Recover metric scale by scaling the
reconstruction until the subject's height equals meta.json → heightCm (or use cmPerPx at the subject plane).
`;

export async function buildCapturePackage(frames: readonly PackagedFrame[], report: Report, front: FrontAnalysis): Promise<Blob> {
  const files: Zippable = { 'README.txt': strToU8(README) };
  const meta = {
    heightCm: front.heightCm,
    cmPerPxFront: front.scale.cmPerPx,
    note: 'thetaDeg is folded to 0–90° (|cos| of projected shoulder/hip span); use it only as a coarse initialization.',
    report,
    frames: [] as object[],
  };
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i], name = String(i).padStart(3, '0');
    files[`frames/${name}.jpg`] = [new Uint8Array(await f.jpeg.arrayBuffer()), { level: 0 }];
    files[`masks/${name}.png`] = [new Uint8Array(await f.mask.arrayBuffer()), { level: 0 }];
    meta.frames.push({ file: `frames/${name}.jpg`, mask: `masks/${name}.png`, thetaDeg: f.thetaDeg, timestamp: f.timestamp, cmPerPx: f.cmPerPx, landmarks: f.landmarks, worldLandmarks: f.world });
  }
  files['meta.json'] = strToU8(JSON.stringify(meta, null, 1));
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}
