/**
 * Turn-in-place capture. The phone stays still while the subject turns a full circle with arms raised in a V,
 * so the torso is never hidden by the arms. Each frame gives the torso's caliper width at the chest, waist and
 * hip heights from one viewing angle. Cauchy's formula turns widths-by-angle into the girth a tape would read,
 * with no assumption that the cross-section is an ellipse.
 */
import { DEG, cauchyPerimeter, clamp, dist, ellipseWidth, foldAngle, lerp, median, mid, px, yawFromSpans } from './geometry.ts';
import { measureScale, type FrontAnalysis } from './measure.ts';
import { runAt, runWidth } from './mask.ts';
import { LM, type Observation } from './types.ts';

export const TURN_SITES = ['chest', 'waist', 'hip'] as const;
export type TurnSite = (typeof TURN_SITES)[number];
export const BIN_DEG = 10;
export const BIN_COUNT = 90 / BIN_DEG;

export type TurnSample = { theta: number; widthsCm: Partial<Record<TurnSite, number>>; timestamp: number; cmPerPx: number };

/** Measures one turntable frame using the front view's scale, levels and frontal reference spans. */
export function analyzeTurnFrame(o: Observation, front: FrontAnalysis): TurnSample | null {
  const P = (i: number) => px(o.landmarks[i], o.width, o.height);
  const scale = measureScale(o, { kind: 'fixed', cmPerPx: front.scale.cmPerPx });
  if (!scale) return null;
  const hp = mid(P(LM.leftHip), P(LM.rightHip)), sh = mid(P(LM.leftShoulder), P(LM.rightShoulder));
  // If the subject drifted toward or away from the camera, the hip joint's apparent height changes; follow it.
  const drift = clamp(front.ref.hipHeightCm / ((scale.floorY - hp.y) * scale.cmPerPx), 0.85, 1.15);
  const cmPerPx = Math.abs(drift - 1) > 0.04 ? scale.cmPerPx * drift : scale.cmPerPx;
  const k = cmPerPx / front.scale.cmPerPx;
  const theta = yawFromSpans(dist(P(LM.leftShoulder), P(LM.rightShoulder)) * k, dist(P(LM.leftHip), P(LM.rightHip)) * k, front.ref.shoulderSpanPx, front.ref.hipSpanPx);
  if (!Number.isFinite(theta)) return null;
  const widthsCm: TurnSample['widthsCm'] = {};
  for (const site of TURN_SITES) {
    const level = front.sites[site]?.heightCm;
    if (level === undefined) continue;
    const y = scale.floorY - level / cmPerPx;
    const t = clamp((y - sh.y) / (hp.y - sh.y || 1), 0, 1);
    const r = runAt(o.mask, y, lerp(sh.x, hp.x, t), 6);
    if (r) widthsCm[site] = runWidth(r) * cmPerPx;
  }
  return { theta, widthsCm, timestamp: o.timestamp, cmPerPx };
}

/** Folded yaw of a frame relative to the front view's shoulder and hip spans. */
export function yawOf(o: Observation, front: FrontAnalysis): number {
  const P = (i: number) => px(o.landmarks[i], o.width, o.height);
  return yawFromSpans(dist(P(LM.leftShoulder), P(LM.rightShoulder)), dist(P(LM.leftHip), P(LM.rightHip)), front.ref.shoulderSpanPx, front.ref.hipSpanPx);
}

/** Which 10° bins of the folded angle [0°, 90°] have samples. */
export function coverage(samples: readonly TurnSample[]): boolean[] {
  const bins = Array<boolean>(BIN_COUNT).fill(false);
  for (const s of samples) bins[Math.min(BIN_COUNT - 1, Math.floor(foldAngle(s.theta) / (BIN_DEG * DEG)))] = true;
  return bins;
}

/** Median width per bin for one site: [binCenterTheta, widthCm]. */
export function binnedWidths(samples: readonly TurnSample[], site: TurnSite): [number, number][] {
  const bins: { t: number[]; w: number[] }[] = Array.from({ length: BIN_COUNT }, () => ({ t: [], w: [] }));
  for (const s of samples) {
    const w = s.widthsCm[site];
    if (w === undefined) continue;
    const th = foldAngle(s.theta), b = Math.min(BIN_COUNT - 1, Math.floor(th / (BIN_DEG * DEG)));
    bins[b].t.push(th); bins[b].w.push(w);
  }
  return bins.filter(b => b.w.length).map(b => [median(b.t), median(b.w)]);
}

export type GirthEstimate = { girthCm: number; widthCm: number; depthCm: number; bins: number };

/**
 * Girth from caliper widths sampled by angle. The ellipse through the frontal width W and profile depth D is the
 * prior; sampled widths reshape it via their ratio to that ellipse, interpolated in angle. With no samples this is
 * exactly the ellipse perimeter; with dense samples it is the Cauchy perimeter of the measured widths.
 */
export function girthFromWidths(W: number, D: number | undefined, samples: readonly [number, number][]): GirthEstimate | null {
  const near90 = samples.filter(([t]) => t > 80 * DEG).map(([, w]) => w);
  const depth = D ?? (near90.length ? median(near90) : undefined);
  if (!(W > 0) || !(depth && depth > 0)) return null;
  const pts: [number, number][] = [[0, 1], ...samples.map(([t, w]): [number, number] => [t, clamp(w / ellipseWidth(W, depth, t), 0.8, 1.3)]), [Math.PI / 2, 1]];
  pts.sort((a, b) => a[0] - b[0]);
  const ratio = (t: number) => {
    for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [t0, r0] = pts[i - 1], [t1, r1] = pts[i]; return lerp(r0, r1, t1 === t0 ? 0 : (t - t0) / (t1 - t0)); }
    return 1;
  };
  const girthCm = cauchyPerimeter(th => { const f = foldAngle(th); return ellipseWidth(W, depth, f) * ratio(f); });
  return { girthCm, widthCm: W, depthCm: depth, bins: samples.length };
}
