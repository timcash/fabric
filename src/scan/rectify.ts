/**
 * Levels a handheld frame using the phone's gravity sensor. A tilted phone (pitch and roll) is turned, by a pure
 * rotation about the lens, into the frame an upright phone at the same spot would have seen: the mask is resampled
 * (inverse warp) and the landmarks mapped forward. Everything downstream (floor row, scale from height, horizontal
 * caliper widths) assumes an upright camera; with this, it no longer needs the phone held perfectly still or level.
 *
 * `up` is world-up in camera coordinates (x right, y up, z toward the viewer: the back camera looks along −z),
 * i.e. the normalized reading of a phone's accelerometer at rest.
 */
import { PHONE_FOV_DEG } from './measure.ts';
import type { Observation } from './types.ts';

type V3 = [number, number, number];
const mulv = (m: number[], v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const T = (m: number[]) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** Pitch (camera looking up > 0) and roll of the camera from its measured up vector, in radians. */
export function tiltFromUp(up: V3): { pitch: number; roll: number } {
  const l = Math.hypot(up[0], up[1], up[2]) || 1;
  const [x, y, z] = [up[0] / l, up[1] / l, up[2] / l];
  return { roll: Math.atan2(x, y), pitch: Math.atan2(-z, Math.hypot(x, y)) };
}

/** Rotation taking rays of the tilted camera into the upright camera: Rx(pitch) · Rz(roll). */
export function levelingRotation(up: V3): number[] {
  const { pitch, roll } = tiltFromUp(up);
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp], rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  const o = Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += rx[r * 3 + k] * rz[k * 3 + c];
  return o;
}

/** Tilt away from upright, in degrees. */
export const tiltDeg = (up: V3) => { const { pitch, roll } = tiltFromUp(up); return (Math.acos(Math.min(1, Math.cos(pitch) * Math.cos(roll))) * 180) / Math.PI; };

export function rectify(o: Observation, up: V3 | null | undefined, fovDeg = PHONE_FOV_DEG): Observation {
  if (!up || tiltDeg(up) < 0.2) return o;
  const R = levelingRotation(up), Rt = T(R);
  const W = o.width, H = o.height, cx = W / 2, cy = H / 2, f = Math.max(W, H) / 2 / Math.tan((fovDeg * Math.PI) / 360);
  const toUpright = (x: number, y: number) => {
    const u = mulv(R, [(x - cx) / f, -(y - cy) / f, -1]);
    return { x: cx + (f * u[0]) / -u[2], y: cy - (f * u[1]) / -u[2] };
  };
  const landmarks = o.landmarks.map(l => { const p = toUpright(l.x * W, l.y * H); return { ...l, x: p.x / W, y: p.y / H }; });
  const src = o.mask.data, data = new Float32Array(W * H);
  // Inverse warp: each upright pixel looks up where its ray falls in the tilted frame (bilinear).
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = mulv(Rt, [(x + 0.5 - cx) / f, -(y + 0.5 - cy) / f, -1]);
      const sx = cx + (f * a[0]) / -a[2] - 0.5, sy = cy - (f * a[1]) / -a[2] - 0.5;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) continue;
      const tx = sx - x0, ty = sy - y0, i = y0 * W + x0;
      data[y * W + x] = (src[i] * (1 - tx) + src[i + 1] * tx) * (1 - ty) + (src[i + W] * (1 - tx) + src[i + W + 1] * tx) * ty;
    }
  }
  return { ...o, landmarks, mask: { width: W, height: H, data } };
}
