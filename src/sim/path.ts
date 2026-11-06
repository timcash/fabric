/**
 * The helper's walk: one circle around the subject with a handheld phone. Distance, height (walking bob), aim,
 * pitch and roll all wander, and the phone's gravity reading carries sensor noise. Deterministic for tests.
 */
import { cameraUp, orbitCamera, type Camera, type OrbitPose } from './camera.ts';
import type { Vec3 } from './makehuman.ts';

const D = Math.PI / 180;

/** Pose at fraction t ∈ [0, 1] of the walk (φ from 0° in front, toward the subject's left, to 360°). */
export function helperPose(t: number): OrbitPose {
  const p = 360 * t * D;
  return {
    phiDeg: 360 * t,
    radiusCm: 262 + 14 * Math.sin(2 * p + 0.4) + 5 * Math.sin(5 * p + 1),
    heightCm: 126 + 4 * Math.sin(3 * p) + 2.5 * Math.sin(14 * p), // arm drift plus walking bob (~7 steps a lap)
    aimDeg: 2.5 * Math.sin(3 * p + 0.5) + 0.8 * Math.sin(11 * p),
    pitchDeg: -3 + 2.5 * Math.sin(5 * p + 2) + 0.6 * Math.sin(13 * p),
    rollDeg: 2.5 * Math.sin(4 * p + 1) + 0.8 * Math.sin(17 * p),
  };
}

/** The helper standing in front for the first capture: small hand shake only. */
export function frontPose(seconds: number): OrbitPose {
  return { phiDeg: 0, radiusCm: 262, heightCm: 126 + 0.3 * Math.sin(seconds * 5), aimDeg: 0.4 * Math.sin(seconds * 3), pitchDeg: -3 + 0.4 * Math.sin(seconds * 4), rollDeg: 0.6 * Math.sin(seconds * 2.5) };
}

/** Seeded uniform noise in [−1, 1]. */
export function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return 2 * (x - Math.floor(x)) - 1;
}

/** What the phone's accelerometer reports as "up" in camera coordinates, with ~0.4° of sensor error. */
export function sensedUp(cam: Camera, seed: number): Vec3 {
  const u = cameraUp(cam), e = 0.4 * D;
  const v: Vec3 = [u[0] + e * noise(seed), u[1], u[2] + e * noise(seed + 7.1)];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** The same camera with pitch and roll removed: what the leveled frame corresponds to. */
export function leveled(pose: OrbitPose): Camera { return orbitCamera({ ...pose, pitchDeg: 0, rollDeg: 0 }); }
export { orbitCamera };
