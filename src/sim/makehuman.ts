/**
 * The CC0 MakeHuman base mesh as a posable test body. Parses the OBJ, skeleton and skin weights, scales to
 * centimetres with the soles on y = 0, and poses the arms with linear blend skinning (rotations about joints).
 * Pure TypeScript: used by Node tests and by the in-browser simulation.
 *
 * Frame: x = subject's left, y = up, z = forward (the subject faces +z). Units: cm.
 */

export type Vec3 = [number, number, number];
export type Bone = { name: string; parent: string | null; head: Vec3; tail: Vec3 };
export type BodyModel = {
  positions: Float32Array; // all vertices (body + helpers), rest pose, cm
  triangles: Uint32Array; // body surface only
  bodyVertices: Uint32Array;
  bones: Map<string, Bone>;
  children: Map<string, string[]>;
  skin: { bones: string[]; weights: number[] }[]; // per vertex, normalized
  heightCm: number;
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** `girthScale` widens (>1) or slims (<1) the body by scaling x and z about the vertical axis. */
export function loadMakeHuman(objText: string, skeleton: { bones: Record<string, { head: string; tail: string; parent: string | null }>; joints: Record<string, number[]> }, weightsJson: { weights: Record<string, [number, number][]> }, girthScale = 1): BodyModel {
  const verts: number[] = [];
  const tris: number[] = [];
  let group = '';
  for (const line of objText.split('\n')) {
    if (line.startsWith('v ')) { const p = line.split(/\s+/); verts.push(+p[1] * 10 * girthScale, +p[2] * 10, +p[3] * 10 * girthScale); }
    else if (line.startsWith('g ')) group = line.slice(2).trim();
    else if (line.startsWith('f ') && group === 'body') {
      const idx = line.trim().split(/\s+/).slice(1).map(t => parseInt(t, 10) - 1);
      for (let k = 1; k + 1 < idx.length; k++) tris.push(idx[0], idx[k], idx[k + 1]);
    }
  }
  const positions = new Float32Array(verts);
  const used = new Set(tris);
  let minY = Infinity, maxY = -Infinity;
  for (const i of used) { minY = Math.min(minY, positions[i * 3 + 1]); maxY = Math.max(maxY, positions[i * 3 + 1]); }
  for (let i = 0; i < positions.length; i += 3) positions[i + 1] -= minY;
  const joint = (name: string): Vec3 => {
    const ids = skeleton.joints[name];
    const s: Vec3 = [0, 0, 0];
    for (const i of ids) { s[0] += positions[i * 3]; s[1] += positions[i * 3 + 1]; s[2] += positions[i * 3 + 2]; }
    return [s[0] / ids.length, s[1] / ids.length, s[2] / ids.length];
  };
  const bones = new Map<string, Bone>();
  const children = new Map<string, string[]>();
  for (const [name, b] of Object.entries(skeleton.bones)) {
    bones.set(name, { name, parent: b.parent, head: joint(b.head), tail: joint(b.tail) });
    if (b.parent) children.set(b.parent, [...(children.get(b.parent) ?? []), name]);
  }
  const skin = Array.from({ length: positions.length / 3 }, () => ({ bones: [] as string[], weights: [] as number[] }));
  for (const [bone, list] of Object.entries(weightsJson.weights)) for (const [vi, w] of list) { skin[vi].bones.push(bone); skin[vi].weights.push(w); }
  for (const s of skin) { const t = s.weights.reduce((a, b) => a + b, 0); if (t > 0) s.weights = s.weights.map(w => w / t); }
  return { positions, triangles: new Uint32Array(tris), bodyVertices: new Uint32Array([...used].sort((a, b) => a - b)), bones, children, skin, heightCm: maxY - minY };
}

/** Rigid transform as rotation (3×3 row-major) about a pivot. */
type Xform = { r: number[]; pivot: Vec3; t: Vec3 };
const IDENTITY: Xform = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], pivot: [0, 0, 0], t: [0, 0, 0] };
function rotationBetween(a: Vec3, b: Vec3): number[] {
  const u = norm(a), v = norm(b), c = dot(u, v);
  const k = cross(u, v), s = len(k);
  if (s < 1e-9) return c > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [-1, 0, 0, 0, -1, 0, 0, 0, 1];
  const [x, y, z] = [k[0] / s, k[1] / s, k[2] / s], C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}
const apply = (x: Xform, p: Vec3): Vec3 => {
  const d = sub(p, x.pivot), r = x.r;
  return [r[0] * d[0] + r[1] * d[1] + r[2] * d[2] + x.pivot[0] + x.t[0], r[3] * d[0] + r[4] * d[1] + r[5] * d[2] + x.pivot[1] + x.t[1], r[6] * d[0] + r[7] * d[1] + r[8] * d[2] + x.pivot[2] + x.t[2]];
};
/** a ∘ b as a single matrix + offset (computed numerically from basis images). */
function compose(a: Xform, b: Xform): Xform {
  const o = apply(a, apply(b, [0, 0, 0]));
  const col = (e: Vec3) => sub(apply(a, apply(b, e)), o);
  const ex = col([1, 0, 0]), ey = col([0, 1, 0]), ez = col([0, 0, 1]);
  return { r: [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]], pivot: [0, 0, 0], t: o };
}

export type PoseSpec = { armDeg: number }; // arm angle from hanging straight down: 90 = T-pose
export type PosedBody = { positions: Float32Array; boneXform: Map<string, Xform>; model: BodyModel; pose: PoseSpec };

function descendants(model: BodyModel, name: string): string[] {
  const out = [name];
  for (let i = 0; i < out.length; i++) out.push(...(model.children.get(out[i]) ?? []));
  return out;
}

/** Straightens the elbows and raises both arms in the coronal plane to `armDeg` from vertical. */
export function poseBody(model: BodyModel, pose: PoseSpec): PosedBody {
  const xf = new Map<string, Xform>();
  for (const side of ['L', 'R'] as const) {
    const sgn = side === 'L' ? 1 : -1;
    const sh = model.bones.get(`upperarm01.${side}`)!.head, el = model.bones.get(`lowerarm01.${side}`)!.head, wr = model.bones.get(`wrist.${side}`)!.head;
    const straighten: Xform = { r: rotationBetween(sub(wr, el), sub(el, sh)), pivot: el, t: [0, 0, 0] };
    const a = (pose.armDeg * Math.PI) / 180;
    const raise: Xform = { r: rotationBetween(sub(el, sh), [sgn * Math.sin(a), -Math.cos(a), 0]), pivot: sh, t: [0, 0, 0] };
    for (const b of descendants(model, `upperarm01.${side}`)) xf.set(b, raise);
    const both = compose(raise, straighten);
    for (const b of descendants(model, `lowerarm01.${side}`)) xf.set(b, both);
  }
  const src = model.positions, out = new Float32Array(src.length);
  for (let v = 0; v < src.length / 3; v++) {
    const p: Vec3 = [src[v * 3], src[v * 3 + 1], src[v * 3 + 2]];
    const s = model.skin[v];
    if (!s.bones.length) { out.set(p, v * 3); continue; }
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < s.bones.length; k++) {
      const q = apply(xf.get(s.bones[k]) ?? IDENTITY, p), w = s.weights[k];
      x += q[0] * w; y += q[1] * w; z += q[2] * w;
    }
    out[v * 3] = x; out[v * 3 + 1] = y; out[v * 3 + 2] = z;
  }
  return { positions: out, boneXform: xf, model, pose };
}

/** Posed joint (bone head) position. */
export function jointAt(body: PosedBody, bone: string, end: 'head' | 'tail' = 'head'): Vec3 {
  const b = body.model.bones.get(bone)!;
  return apply(body.boneXform.get(bone) ?? IDENTITY, b[end]);
}

const vertex = (body: PosedBody, i: number): Vec3 => [body.positions[i * 3], body.positions[i * 3 + 1], body.positions[i * 3 + 2]];

/** The 33 MediaPipe-topology landmarks as 3D points on the posed mesh (skeletal joints plus a few surface points). */
export function landmarks3d(body: PosedBody): Vec3[] {
  const J = (b: string, e: 'head' | 'tail' = 'head') => jointAt(body, b, e);
  const verts = body.model.bodyVertices;
  const pick = (score: (p: Vec3) => number, filter: (p: Vec3) => boolean): Vec3 => {
    let best: Vec3 = [0, 0, 0], bs = -Infinity;
    for (const i of verts) { const p = vertex(body, i); if (filter(p)) { const s = score(p); if (s > bs) { bs = s; best = p; } } }
    return best;
  };
  const H = body.model.heightCm;
  const headBase = J('head');
  const nose = pick(p => p[2], p => Math.abs(p[0]) < 1 && p[1] > headBase[1] + 2);
  const eyeL = J('eye.L'), eyeR = J('eye.R');
  const ear = (sgn: number) => pick(p => sgn * p[0], p => p[1] > eyeL[1] - 3 && p[1] < eyeL[1] + 1 && Math.abs(p[2] - headBase[2]) < 4);
  const mouth = (sgn: number): Vec3 => [sgn * 2.2, nose[1] - 4.5, nose[2] - 1.5];
  const footPt = (side: 'L' | 'R', score: (p: Vec3) => number) => {
    const a = J(`foot.${side}`);
    return pick(score, p => p[1] < 3 && Math.abs(p[0] - a[0]) < 6 && Math.abs(p[2] - a[2]) < 25);
  };
  const out: Vec3[] = Array.from({ length: 33 }, () => [0, H * 0.9, 0] as Vec3);
  out[0] = nose;
  out[1] = out[2] = out[3] = eyeL; out[4] = out[5] = out[6] = eyeR;
  out[7] = ear(1); out[8] = ear(-1); out[9] = mouth(1); out[10] = mouth(-1);
  for (const [s, o] of [['L', 0], ['R', 1]] as const) {
    out[11 + o] = J(`upperarm01.${s}`); out[13 + o] = J(`lowerarm01.${s}`); out[15 + o] = J(`wrist.${s}`);
    out[17 + o] = J(`finger5-3.${s}`, 'tail'); out[19 + o] = J(`finger2-3.${s}`, 'tail'); out[21 + o] = J(`finger1-3.${s}`, 'tail');
    out[23 + o] = J(`upperleg01.${s}`); out[25 + o] = J(`lowerleg01.${s}`); out[27 + o] = J(`foot.${s}`);
    out[29 + o] = footPt(s, p => -p[2] - p[1] * 2); // heel: rearmost point on the sole
    out[31 + o] = footPt(s, p => p[2] - p[1]); // toe tip
  }
  return out;
}

export function bodyCenter(body: PosedBody): Vec3 {
  const l = jointAt(body, 'upperleg01.L'), r = jointAt(body, 'upperleg01.R');
  return [(l[0] + r[0]) / 2, 0, (l[2] + r[2]) / 2];
}
