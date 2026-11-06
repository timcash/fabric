/**
 * Ground truth from the posed mesh: slice it with a plane, keep the cross-section loop around a chosen point,
 * and measure it the way a tape does (the convex hull perimeter). Lengths come from the skeleton and the mesh.
 */
import { jointAt, type PosedBody, type Vec3 } from './makehuman.ts';

export type Section = { tapeCm: number; loopCm: number; widthCm: number; depthCm: number; points: [number, number][] };

/** Closed cross-section loops of the surface with plane (origin, normal), as 3D points. */
export function sliceLoops(positions: Float32Array, triangles: Uint32Array, origin: Vec3, normal: Vec3): Vec3[][] {
  const n = positions.length / 3;
  const dist = (i: number) => (positions[i * 3] - origin[0]) * normal[0] + (positions[i * 3 + 1] - origin[1]) * normal[1] + (positions[i * 3 + 2] - origin[2]) * normal[2] || 1e-7;
  const points = new Map<number, Vec3>();
  const adj = new Map<number, number[]>();
  const edgePoint = (a: number, b: number, da: number, db: number) => {
    const key = a < b ? a * n + b : b * n + a;
    if (!points.has(key)) {
      const t = da / (da - db);
      points.set(key, [positions[a * 3] + t * (positions[b * 3] - positions[a * 3]), positions[a * 3 + 1] + t * (positions[b * 3 + 1] - positions[a * 3 + 1]), positions[a * 3 + 2] + t * (positions[b * 3 + 2] - positions[a * 3 + 2])]);
    }
    return key;
  };
  for (let t = 0; t < triangles.length; t += 3) {
    const v = [triangles[t], triangles[t + 1], triangles[t + 2]], d = v.map(dist);
    const keys: number[] = [];
    for (let e = 0; e < 3; e++) { const a = e, b = (e + 1) % 3; if (d[a] > 0 !== d[b] > 0) keys.push(edgePoint(v[a], v[b], d[a], d[b])); }
    if (keys.length === 2) { adj.set(keys[0], [...(adj.get(keys[0]) ?? []), keys[1]]); adj.set(keys[1], [...(adj.get(keys[1]) ?? []), keys[0]]); }
  }
  const seen = new Set<number>(), loops: Vec3[][] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop: Vec3[] = [];
    let prev = -1, cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur); loop.push(points.get(cur)!);
      const next = (adj.get(cur) ?? []).find(k => k !== prev && !seen.has(k));
      prev = cur; cur = next as number;
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

function basis(normal: Vec3): [Vec3, Vec3] {
  const a: Vec3 = Math.abs(normal[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u: Vec3 = [a[1] * normal[2] - a[2] * normal[1], a[2] * normal[0] - a[0] * normal[2], a[0] * normal[1] - a[1] * normal[0]];
  const l = Math.hypot(...u); u[0] /= l; u[1] /= l; u[2] /= l;
  return [u, [normal[1] * u[2] - normal[2] * u[1], normal[2] * u[0] - normal[0] * u[2], normal[0] * u[1] - normal[1] * u[0]]];
}

function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const crossZ = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
const perimeter = (pts: [number, number][]) => pts.reduce((s, p, i) => s + Math.hypot(p[0] - pts[(i + 1) % pts.length][0], p[1] - pts[(i + 1) % pts.length][1]), 0);
function insidePoly(pt: [number, number], poly: [number, number][]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * Cross-section around `pick` in the plane through `pick` with `normal`. widthCm/depthCm are extents along the
 * plane's x and z directions for a horizontal plane (front width and profile depth).
 */
export function sectionAt(body: PosedBody, pick: Vec3, normal: Vec3 = [0, 1, 0]): Section | null {
  const loops = sliceLoops(body.positions, body.model.triangles, pick, normal);
  const [u, v] = Math.abs(normal[1]) > 0.9 ? [[1, 0, 0] as Vec3, [0, 0, 1] as Vec3] : basis(normal);
  const to2 = (p: Vec3): [number, number] => [(p[0] - pick[0]) * u[0] + (p[1] - pick[1]) * u[1] + (p[2] - pick[2]) * u[2], (p[0] - pick[0]) * v[0] + (p[1] - pick[1]) * v[1] + (p[2] - pick[2]) * v[2]];
  const flat = loops.map(l => l.map(to2));
  let chosen = flat.find(l => insidePoly([0, 0], l));
  if (!chosen) {
    let best = Infinity;
    for (const l of flat) { const d = Math.min(...l.map(p => Math.hypot(p[0], p[1]))); if (d < best) { best = d; chosen = l; } }
  }
  if (!chosen) return null;
  const xs = chosen.map(p => p[0]), zs = chosen.map(p => p[1]);
  return { tapeCm: perimeter(hull(chosen)), loopCm: perimeter(chosen), widthCm: Math.max(...xs) - Math.min(...xs), depthCm: Math.max(...zs) - Math.min(...zs), points: chosen };
}

/** Point on the line a→b closest to p, and the segment direction. */
function onSegment(a: Vec3, b: Vec3, p: Vec3): { q: Vec3; dir: Vec3; t: number } {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2));
  const l = Math.sqrt(l2);
  return { q: [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t], dir: [d[0] / l, d[1] / l, d[2] / l], t };
}

/** Girth of an arm or leg at the limb point nearest `p`, cut perpendicular to the limb axis. */
export function limbSection(body: PosedBody, chain: [string, string, string], p: Vec3): Section | null {
  const [a, b, c] = chain.map(n => jointAt(body, n));
  const s1 = onSegment(a, b, p), s2 = onSegment(b, c, p);
  const d1 = Math.hypot(p[0] - s1.q[0], p[1] - s1.q[1], p[2] - s1.q[2]), d2 = Math.hypot(p[0] - s2.q[0], p[1] - s2.q[1], p[2] - s2.q[2]);
  const s = d1 <= d2 ? s1 : s2;
  return sectionAt(body, s.q, s.dir);
}

/** Lowest midline point of the torso between the legs. */
export function crotchHeight(body: PosedBody): number {
  let y = Infinity;
  const H = body.model.heightCm;
  for (const i of body.model.bodyVertices) {
    const x = body.positions[i * 3], py = body.positions[i * 3 + 1];
    if (Math.abs(x) < 0.6 && py > 0.3 * H && py < 0.6 * H) y = Math.min(y, py);
  }
  return y;
}

/** Horizontal extent of the posed mesh (fingertip to fingertip in a T-pose). */
export function span(body: PosedBody): number {
  let lo = Infinity, hi = -Infinity;
  for (const i of body.model.bodyVertices) { lo = Math.min(lo, body.positions[i * 3]); hi = Math.max(hi, body.positions[i * 3]); }
  return hi - lo;
}
