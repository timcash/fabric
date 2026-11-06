import type { Landmark, Point } from './types.ts';

export const DEG = Math.PI / 180;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const along = (a: Point, b: Point, t: number): Point => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

export function unit(a: Point, b: Point): Point {
  const d = dist(a, b) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}
export const perpendicular = (d: Point): Point => ({ x: -d.y, y: d.x });

export function median(values: readonly number[]): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Ramanujan's second approximation of an ellipse perimeter (semi-axes a, b). Error < 1e-9 for body-like ratios. */
export function ellipsePerimeter(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** Width of an ellipse with full width W (θ = 0) and full depth D (θ = 90°) seen from direction θ. */
export const ellipseWidth = (W: number, D: number, theta: number) => Math.sqrt((W * Math.cos(theta)) ** 2 + (D * Math.sin(theta)) ** 2);

/**
 * Cauchy's surface-area formula in 2D: the perimeter of a convex cross-section equals the integral of its
 * caliper width over half a turn, P = ∫₀^π w(θ) dθ. A tape measure follows the convex hull, so this is the
 * girth a tape would read. `width(θ)` may be any function sampled on [0, π].
 */
export function cauchyPerimeter(width: (theta: number) => number, steps = 720): number {
  let sum = 0;
  for (let i = 0; i < steps; i++) sum += width(((i + 0.5) / steps) * Math.PI);
  return (sum * Math.PI) / steps;
}

/** Folds an angle (radians) into [0, π/2] using the cross-section's half-turn periodicity and left/right symmetry. */
export function foldAngle(theta: number): number {
  let t = Math.abs(theta) % Math.PI;
  if (t > Math.PI / 2) t = Math.PI - t;
  return t;
}

/** Normalized landmark → pixel point. */
export const px = (lm: Landmark, width: number, height: number): Point => ({ x: lm.x * width, y: lm.y * height });

/**
 * Body yaw from the 2D shoulder and hip spans relative to a frontal reference span, folded to [0, π/2].
 * Monocular landmark depth is the noisiest MediaPipe output, so the projected span (|cos θ| scaling) is preferred.
 */
export function yawFromSpans(shoulderSpan: number, hipSpan: number, refShoulder: number, refHip: number): number {
  const ratios = [shoulderSpan / refShoulder, hipSpan / refHip].filter(Number.isFinite).map(r => clamp(r, 0, 1));
  if (!ratios.length) return NaN;
  return Math.acos(ratios.reduce((a, b) => a + b, 0) / ratios.length);
}
