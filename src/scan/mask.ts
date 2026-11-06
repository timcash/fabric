import type { Mask, Point } from './types.ts';

export const THRESHOLD = 0.5;

/** Value of the pixel containing (x, y); 0 outside the image. */
export function pixel(mask: Mask, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= mask.width || yi >= mask.height) return 0;
  return mask.data[yi * mask.width + xi];
}

/** Bilinear sample between pixel centers. */
export function sample(mask: Mask, x: number, y: number): number {
  const fx = x - 0.5, fy = y - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const at = (xi: number, yi: number) => (xi < 0 || yi < 0 || xi >= mask.width || yi >= mask.height ? 0 : mask.data[yi * mask.width + xi]);
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
}

export const inside = (mask: Mask, p: Point, t = THRESHOLD) => sample(mask, p.x, p.y) >= t;

export type Run = { x0: number; x1: number };
export const runWidth = (r: Run) => r.x1 - r.x0;

/** Foreground runs along image row `y` (fractional y is rounded to the containing row), with sub-pixel edges. */
export function rowRuns(mask: Mask, y: number, t = THRESHOLD): Run[] {
  const row = Math.floor(y);
  if (row < 0 || row >= mask.height) return [];
  const o = row * mask.width, w = mask.width, d = mask.data;
  const runs: Run[] = [];
  let start = -1;
  const edge = (i: number) => { // crossing between pixel centers i and i + 1
    const a = i < 0 ? 0 : d[o + i], b = i + 1 >= w ? 0 : d[o + i + 1];
    const f = b === a ? 0.5 : (t - a) / (b - a);
    return i + 0.5 + Math.min(1, Math.max(0, f));
  };
  for (let i = 0; i <= w; i++) {
    const on = i < w && d[o + i] >= t;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      runs.push({ x0: start === 0 ? 0 : edge(start - 1), x1: i === w ? w : edge(i - 1) });
      start = -1;
    }
  }
  return runs;
}

/** The run on row y that contains x, or the nearest run within `slack` pixels. */
export function runAt(mask: Mask, y: number, x: number, slack = 0, t = THRESHOLD): Run | null {
  let best: Run | null = null, bestGap = Infinity;
  for (const r of rowRuns(mask, y, t)) {
    const gap = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
    if (gap < bestGap) { best = r; bestGap = gap; }
  }
  return bestGap <= slack ? best : null;
}

/** Distance from p along unit direction d to the silhouette boundary (bilinear, bisection-refined). */
function march(mask: Mask, p: Point, d: Point, t: number, maxLen: number): number {
  let inLen = 0;
  for (let s = 1; s <= maxLen; s += 1) {
    if (sample(mask, p.x + d.x * s, p.y + d.y * s) < t) {
      let lo = inLen, hi = s;
      for (let k = 0; k < 12; k++) {
        const m = (lo + hi) / 2;
        if (sample(mask, p.x + d.x * m, p.y + d.y * m) >= t) lo = m; else hi = m;
      }
      return (lo + hi) / 2;
    }
    inLen = s;
  }
  return maxLen;
}

export type Chord = { a: Point; b: Point; length: number };

/** The silhouette chord through p along unit direction d (both ways). Null if p is outside the silhouette or either side runs past maxLen. */
export function chordAlong(mask: Mask, p: Point, d: Point, t = THRESHOLD, maxLen = Math.max(mask.width, mask.height)): Chord | null {
  if (!inside(mask, p, t)) return null;
  const fwd = march(mask, p, d, t, maxLen);
  const back = march(mask, p, { x: -d.x, y: -d.y }, t, maxLen);
  if (fwd >= maxLen || back >= maxLen) return null;
  return { a: { x: p.x - d.x * back, y: p.y - d.y * back }, b: { x: p.x + d.x * fwd, y: p.y + d.y * fwd }, length: fwd + back };
}

/**
 * Vertical extent of the connected silhouette that contains `seed`, tracked row by row so stray blobs
 * (furniture, a second person) beside the body are ignored. Returns sub-pixel top and bottom.
 */
export function verticalExtent(mask: Mask, seed: Point, t = THRESHOLD): { top: number; bottom: number; topX: number; bottomX: number } | null {
  const start = runAt(mask, seed.y, seed.x, 2, t);
  if (!start) return null;
  const walk = (dir: -1 | 1) => {
    let span = { x0: start.x0, x1: start.x1 };
    let row = Math.floor(seed.y);
    for (;;) {
      const next = row + dir;
      const linked = rowRuns(mask, next, t).filter(r => r.x1 >= span.x0 - 1 && r.x0 <= span.x1 + 1);
      if (!linked.length) break;
      span = { x0: Math.min(...linked.map(r => r.x0)), x1: Math.max(...linked.map(r => r.x1)) };
      row = next;
    }
    // Refine the last row's edge vertically at the column with the strongest response.
    let bestX = Math.floor((span.x0 + span.x1) / 2), bestV = -1;
    for (let x = Math.floor(span.x0); x < Math.ceil(span.x1); x++) {
      const v = pixel(mask, x + 0.5, row + 0.5);
      if (v > bestV) { bestV = v; bestX = x; }
    }
    const a = pixel(mask, bestX + 0.5, row + 0.5), b = pixel(mask, bestX + 0.5, row + dir + 0.5);
    const f = a === b ? 0.5 : Math.min(1, Math.max(0, (t - a) / (b - a)));
    return { y: row + 0.5 + dir * f, x: bestX + 0.5 };
  };
  const up = walk(-1), down = walk(1);
  return { top: up.y, bottom: down.y, topX: up.x, bottomX: down.x };
}

/** First y below `from` where column x leaves the silhouette (e.g. the crotch below the hip midpoint). */
export function firstGapBelow(mask: Mask, from: Point, limitY: number, t = THRESHOLD): number | null {
  if (!inside(mask, from, t)) return null;
  const len = march(mask, from, { x: 0, y: 1 }, t, Math.max(0, limitY - from.y));
  return from.y + len >= limitY ? null : from.y + len;
}
