/**
 * A pinhole phone camera (portrait) and a software rasterizer that produces an anti-aliased person mask from a
 * triangle mesh. Perspective is real: near parts look larger, the floor converges, and feet pointing at the camera
 * reach lower in the image than the heels. The camera may be anywhere and tilted (a handheld phone): `rotation` is
 * world-from-camera (row-major 3×3; camera x right, y up, looking along −z), identity = upright, looking along −z.
 */
import type { Vec3 } from './makehuman.ts';

export type Camera = { width: number; height: number; f: number; cx: number; cy: number; position: Vec3; rotation?: number[] };

export function phoneCamera(o: { width?: number; height?: number; vfovDeg?: number; distanceCm?: number; heightCm?: number } = {}): Camera {
  const { width = 720, height = 1280, vfovDeg = 66, distanceCm = 280, heightCm = 100 } = o;
  return { width, height, f: height / 2 / Math.tan((vfovDeg * Math.PI) / 360), cx: width / 2, cy: height / 2, position: [0, heightCm, distanceCm] };
}

const DEG = Math.PI / 180;
export const rotY = (t: number) => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];
export const rotX = (t: number) => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
export const rotZ = (t: number) => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];
export function mul3(a: number[], b: number[]): number[] {
  const o = Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}
export const apply3 = (m: number[], v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export const transpose3 = (m: number[]) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export type OrbitPose = { phiDeg: number; radiusCm: number; heightCm: number; aimDeg?: number; pitchDeg?: number; rollDeg?: number };
/**
 * A handheld camera on a circle around the subject (origin): φ = 0 in front, φ = 90° on the subject's left.
 * Rotation = Ry(φ + aim) · Rx(pitch) · Rz(roll), the same as three.js Euler order 'YXZ'.
 */
export function orbitCamera(pose: OrbitPose, o: { width?: number; height?: number; vfovDeg?: number } = {}): Camera {
  const base = phoneCamera({ ...o, distanceCm: 0, heightCm: 0 });
  const phi = pose.phiDeg * DEG;
  return {
    ...base,
    position: [pose.radiusCm * Math.sin(phi), pose.heightCm, pose.radiusCm * Math.cos(phi)],
    rotation: mul3(mul3(rotY(phi + (pose.aimDeg ?? 0) * DEG), rotX((pose.pitchDeg ?? 0) * DEG)), rotZ((pose.rollDeg ?? 0) * DEG)),
  };
}
/** World "up" in camera coordinates: what a phone's gravity sensor reports (negated gravity). */
export const cameraUp = (cam: Camera): Vec3 => (cam.rotation ? apply3(transpose3(cam.rotation), [0, 1, 0]) : [0, 1, 0]);

/** Image coordinates (pixel edges at integers) and depth of a world point. */
export function project(cam: Camera, p: Vec3): { x: number; y: number; depth: number } {
  const d: Vec3 = [p[0] - cam.position[0], p[1] - cam.position[1], p[2] - cam.position[2]];
  const c = cam.rotation ? apply3(transpose3(cam.rotation), d) : d;
  const depth = -c[2];
  return { x: cam.cx + (cam.f * c[0]) / depth, y: cam.cy - (cam.f * c[1]) / depth, depth };
}

/** World ray (origin, direction) through image point (x, y). */
export function pixelRay(cam: Camera, x: number, y: number): { origin: Vec3; dir: Vec3 } {
  const c: Vec3 = [(x - cam.cx) / cam.f, -(y - cam.cy) / cam.f, -1];
  return { origin: cam.position, dir: cam.rotation ? apply3(cam.rotation, c) : c };
}

/** Places the body: turns it by `yawDeg` about the vertical axis through `center`, which moves to the origin. */
export function placeBody(positions: Float32Array, center: Vec3, yawDeg: number): Float32Array {
  const t = (yawDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] - center[0], z = positions[i + 2] - center[2];
    out[i] = x * c + z * s; out[i + 1] = positions[i + 1]; out[i + 2] = -x * s + z * c;
  }
  return out;
}
export function placePoint(p: Vec3, center: Vec3, yawDeg: number): Vec3 {
  const t = (yawDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const x = p[0] - center[0], z = p[2] - center[2];
  return [x * c + z * s, p[1], -x * s + z * c];
}

/** Coverage mask (0..1) of the triangles, supersampled S×S per pixel. */
export function rasterMask(cam: Camera, positions: Float32Array, triangles: Uint32Array, S = 3): Float32Array {
  const W = cam.width * S, H = cam.height * S;
  const hit = new Uint8Array(W * H);
  const px = new Float32Array(positions.length / 3), py = new Float32Array(positions.length / 3);
  for (let v = 0; v < px.length; v++) {
    const q = project(cam, [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
    px[v] = q.x * S; py[v] = q.y * S;
  }
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    const ax = px[a], ay = py[a], bx = px[b], by = py[b], cx = px[c], cy = py[c];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    const sgn = area > 0 ? 1 : -1;
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const sx = x + 0.5;
        const w0 = ((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) * sgn;
        const w1 = ((cx - bx) * (sy - by) - (cy - by) * (sx - bx)) * sgn;
        const w2 = ((ax - cx) * (sy - cy) - (ay - cy) * (sx - cx)) * sgn;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) hit[y * W + x] = 1;
      }
    }
  }
  const out = new Float32Array(cam.width * cam.height);
  const inv = 1 / (S * S);
  for (let y = 0; y < cam.height; y++) for (let x = 0; x < cam.width; x++) {
    let n = 0;
    for (let j = 0; j < S; j++) { const row = (y * S + j) * W + x * S; for (let i = 0; i < S; i++) n += hit[row + i]; }
    out[y * cam.width + x] = n * inv;
  }
  return out;
}
