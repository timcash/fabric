/**
 * A parametric synthetic body with exact ground truth. It is rendered to the same Observation shape a real pose
 * source produces (anti-aliased person mask + 33 landmarks), so the whole measurement pipeline can be tested — and
 * demonstrated without a camera — against girths that are known analytically.
 *
 * Body frame (cm): X = subject's left, Y = up from the floor, Z = forward. The camera looks along −Z at yaw 0.
 */
import { DEG, ellipsePerimeter, lerp } from './geometry.ts';
import { LANDMARK_COUNT, LM, type Landmark, type Observation } from './types.ts';

type Key = readonly [h: number, a: number, b: number];
export type ArmPose = 'arms-out' | 'a-pose' | 'down';

export type BodySpec = {
  heightCm: number;
  torso: readonly Key[]; // half-width a (lateral), half-depth b, from crotch up through the neck
  leg: readonly Key[]; // per-leg cross-section from the floor up
  legX: number; // lateral offset of each (vertical) leg axis
  shoulder: { x: number; y: number };
  hipJoint: { x: number; y: number };
  kneeY: number;
  ankleY: number;
  arm: readonly (readonly [s: number, r: number])[]; // radius along the arm from the shoulder joint
  upperArm: number;
  armLength: number; // shoulder joint → wrist
  hand: { length: number; a: number; b: number };
  head: { y: number; a: number; b: number; c: number };
};

export const defaultBody: BodySpec = {
  heightCm: 175,
  torso: [
    [80, 17.8, 11.2], [84, 18, 11.8], [88, 18.2, 12], [92, 17.8, 11.8], [96, 17, 11.5], [105, 15, 10.5], [115, 15.5, 11], [128, 17, 12.5],
    [138, 18.5, 11.5], [144, 17, 9], [147, 8, 7], [149, 6, 6.2], [158, 6, 6.2],
  ],
  leg: [[0, 4.5, 5], [6, 3.5, 3.7], [20, 4.5, 4.8], [35, 6, 6.3], [48, 5.5, 6], [60, 7, 7.5], [72, 8.5, 9], [80, 8.2, 8.7], [86, 7.5, 8]],
  legX: 9.5,
  shoulder: { x: 18, y: 144 },
  hipJoint: { x: 9, y: 88 },
  kneeY: 48,
  ankleY: 8,
  arm: [[0, 6], [8, 5], [15, 4.8], [30, 3.8], [38, 4.3], [52, 3.2], [56, 2.7]],
  upperArm: 30,
  armLength: 56,
  hand: { length: 18, a: 4, b: 1.5 },
  head: { y: 165, a: 8, b: 10, c: 10 },
};

function interp(keys: readonly Key[], h: number): [number, number] | null {
  if (h < keys[0][0] || h > keys[keys.length - 1][0]) return null;
  for (let i = 1; i < keys.length; i++) {
    if (h <= keys[i][0]) {
      const [h0, a0, b0] = keys[i - 1], [h1, a1, b1] = keys[i];
      const t = (h - h0) / (h1 - h0 || 1);
      return [lerp(a0, a1, t), lerp(b0, b1, t)];
    }
  }
  return null;
}
function armRadius(spec: BodySpec, s: number): number {
  const k = spec.arm;
  if (s <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (s <= k[i][0]) return lerp(k[i - 1][1], k[i][1], (s - k[i - 1][0]) / (k[i][0] - k[i - 1][0]));
  return k[k.length - 1][1];
}
/** Arm angle from hanging straight down. 'arms-out' is a near-T-pose (horizontal slices stay well-defined). */
export const armAngle = (pose: ArmPose) => (pose === 'arms-out' ? 82 : pose === 'a-pose' ? 35 : 6) * DEG;

/** Ground-truth girths (cm) a tape would read at a level. */
export const truth = {
  torso: (spec: BodySpec, h: number) => { const ab = interp(spec.torso, h); return ab ? ellipsePerimeter(ab[0], ab[1]) : NaN; },
  torsoAxes: (spec: BodySpec, h: number) => interp(spec.torso, h),
  leg: (spec: BodySpec, h: number) => { const ab = interp(spec.leg, h); return ab ? ellipsePerimeter(ab[0], ab[1]) : NaN; },
  arm: (spec: BodySpec, s: number) => 2 * Math.PI * armRadius(spec, s),
  armRadius,
};

type Slice = { x: number; z: number; a: number; b: number };

/** Horizontal cross-sections of the whole body at height h (cm). */
export function slicesAt(spec: BodySpec, h: number, pose: ArmPose): Slice[] {
  const out: Slice[] = [];
  const torso = interp(spec.torso, h);
  if (torso) out.push({ x: 0, z: 0, a: torso[0], b: torso[1] });
  const leg = interp(spec.leg, h);
  if (leg) for (const side of [-1, 1]) out.push({ x: side * spec.legX, z: 0, a: leg[0], b: leg[1] });
  if (h <= 6 && h >= 0) for (const side of [-1, 1]) out.push({ x: side * spec.legX, z: 5, a: 4.5, b: 10 }); // feet
  const hd = spec.head, u = (h - hd.y) / hd.c;
  if (Math.abs(u) < 1) { const k = Math.sqrt(1 - u * u); out.push({ x: 0, z: 0, a: hd.a * k, b: hd.b * k }); }
  const alpha = armAngle(pose), c = Math.cos(alpha), sn = Math.sin(alpha);
  const s = (spec.shoulder.y - h) / c; // distance along the arm axis
  const total = spec.armLength + spec.hand.length;
  if (s >= -4 && s <= total) { // s < 0: the deltoid cap over the shoulder joint
    const inHand = s > spec.armLength;
    const ra = inHand ? spec.hand.a : armRadius(spec, s), rb = inHand ? spec.hand.b : armRadius(spec, s);
    for (const side of [-1, 1]) out.push({ x: side * (spec.shoulder.x + Math.max(0, s) * sn), z: 0, a: ra / Math.abs(c), b: rb });
  }
  return out;
}

export type RenderOptions = {
  yawDeg?: number;
  pose?: ArmPose;
  width?: number;
  height?: number;
  cmPerPx?: number;
  floorPx?: number;
  centerPx?: number;
  timestamp?: number;
};

/** Renders the body orthographically into an anti-aliased mask and MediaPipe-style landmarks. */
export function renderBody(spec: BodySpec = defaultBody, options: RenderOptions = {}): Observation {
  const { yawDeg = 0, pose = 'arms-out', width = 720, height = 1280, timestamp = 0 } = options;
  const cmPerPx = options.cmPerPx ?? spec.heightCm / (height * 0.82);
  const floorPx = options.floorPx ?? height * 0.93;
  const centerPx = options.centerPx ?? width / 2;
  const th = yawDeg * DEG, cos = Math.cos(th), sin = Math.sin(th);
  const data = new Float32Array(width * height);
  const SUB = 4;
  const cover = new Float32Array(width);
  for (let y = 0; y < height; y++) {
    cover.fill(0);
    for (let k = 0; k < SUB; k++) {
      const h = (floorPx - (y + (k + 0.5) / SUB)) * cmPerPx;
      if (h < 0 || h > spec.heightCm + 1) continue;
      const spans = slicesAt(spec, h, pose)
        .map(sl => { const c = sl.x * cos + sl.z * sin, hw = Math.hypot(sl.a * cos, sl.b * sin); return [centerPx + (c - hw) / cmPerPx, centerPx + (c + hw) / cmPerPx]; })
        .sort((p, q) => p[0] - q[0]);
      const merged: number[][] = [];
      for (const sp of spans) { const last = merged[merged.length - 1]; if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]); else merged.push([...sp]); }
      for (const [x0, x1] of merged) {
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) cover[x] += (Math.min(x + 1, x1) - Math.max(x, x0)) / SUB;
      }
    }
    data.set(cover, y * width);
  }
  const joints = jointPositions(spec, pose);
  const project = (p: [number, number, number], vis: number): Landmark => {
    const xr = p[0] * cos + p[2] * sin, zr = -p[0] * sin + p[2] * cos;
    return { x: (centerPx + xr / cmPerPx) / width, y: (floorPx - p[1] / cmPerPx) / height, z: -zr / 100, visibility: vis };
  };
  const landmarks: Landmark[] = [], world: Landmark[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = joints[i] ?? [0, spec.hipJoint.y, 0];
    landmarks.push(project(p, joints[i] ? 0.98 : 0.2));
    const xr = p[0] * cos + p[2] * sin, zr = -p[0] * sin + p[2] * cos;
    world.push({ x: xr / 100, y: -(p[1] - spec.hipJoint.y) / 100, z: -zr / 100, visibility: joints[i] ? 0.98 : 0.2 });
  }
  return { width, height, landmarks, world, mask: { width, height, data }, timestamp };
}

function jointPositions(spec: BodySpec, pose: ArmPose): Record<number, [number, number, number]> {
  const a = armAngle(pose), dx = Math.sin(a), dy = -Math.cos(a);
  const j: Record<number, [number, number, number]> = {};
  const both = (l: number, r: number, x: number, y: number, z: number) => { j[l] = [x, y, z]; j[r] = [-x, y, z]; };
  j[LM.nose] = [0, spec.head.y - 5, spec.head.b - 0.5];
  both(LM.leftEar, LM.rightEar, spec.head.a - 0.2, spec.head.y - 2, 0);
  both(LM.mouthLeft, LM.mouthRight, 2.5, spec.head.y - 8, spec.head.b - 1.5);
  both(LM.leftShoulder, LM.rightShoulder, spec.shoulder.x, spec.shoulder.y, 0);
  both(LM.leftElbow, LM.rightElbow, spec.shoulder.x + dx * spec.upperArm, spec.shoulder.y + dy * spec.upperArm, 0);
  both(LM.leftWrist, LM.rightWrist, spec.shoulder.x + dx * spec.armLength, spec.shoulder.y + dy * spec.armLength, 0);
  both(LM.leftHip, LM.rightHip, spec.hipJoint.x, spec.hipJoint.y, 0);
  both(LM.leftKnee, LM.rightKnee, spec.legX, spec.kneeY, 0);
  both(LM.leftAnkle, LM.rightAnkle, spec.legX, spec.ankleY, 0);
  both(LM.leftHeel, LM.rightHeel, spec.legX, 0, -4); // floor contact at the back of the heel
  both(LM.leftFootIndex, LM.rightFootIndex, spec.legX, 1, 14);
  for (const i of [1, 2, 3]) j[i] = [3.2, spec.head.y, spec.head.b - 2]; // left eye group
  for (const i of [4, 5, 6]) j[i] = [-3.2, spec.head.y, spec.head.b - 2];
  for (const i of [17, 19, 21]) j[i] = j[LM.leftWrist];
  for (const i of [18, 20, 22]) j[i] = j[LM.rightWrist];
  return j;
}
