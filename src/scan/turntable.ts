/**
 * Turn-in-place capture. The phone stays still while the subject turns a full circle with both arms held straight
 * out to the sides, so the arms stay above the chest from every angle. Each frame gives caliper widths from one
 * viewing angle: the torso at the chest, waist and hip, and each leg wherever the two legs separate in the image.
 * Cauchy's formula turns widths-by-angle into the girth a tape would read, without assuming an elliptical section.
 */
import { DEG, cauchyPerimeter, clamp, ellipseWidth, foldAngle, lerp, median, mid, px, yawFromSpans } from './geometry.ts';
import { measureScale, type FrontAnalysis } from './measure.ts';
import { runAt, runWidth } from './mask.ts';
import { LM, type Observation, type Point } from './types.ts';

export const TORSO_TURN_SITES = ['chest', 'waist', 'hip'] as const;
export const LEG_TURN_SITES = ['thigh', 'knee', 'calf', 'ankle'] as const;
export const TURN_SITES = [...TORSO_TURN_SITES, ...LEG_TURN_SITES] as const;
export type TurnSite = (typeof TURN_SITES)[number];
export const BIN_DEG = 10;
export const BIN_COUNT = 90 / BIN_DEG;

export type LegSite = (typeof LEG_TURN_SITES)[number];
export type TurnSample = {
  theta: number;
  widthsCm: Partial<Record<TurnSite, number>>;
  /** Near profile: width of the overlapping legs at the nearer leg's scale (an upper bound on that leg's depth). */
  legOverlapCm?: Partial<Record<LegSite, number>>;
  timestamp: number;
  cmPerPx: number;
};

/** Horizontal image distance between two landmarks (perspective tilts the vertical component as the body turns). */
const hspan = (o: Observation, a: number, b: number) => Math.abs(o.landmarks[a].x - o.landmarks[b].x) * o.width;

/** Folded yaw (0 = facing the camera, π/2 = profile) from shoulder and hip spans relative to the front view. */
export function yawOf(o: Observation, front: FrontAnalysis): number {
  return yawFromSpans(hspan(o, LM.leftShoulder, LM.rightShoulder), hspan(o, LM.leftHip, LM.rightHip), front.ref.shoulderSpanPx, front.ref.hipSpanPx);
}

/** Measures one turn frame using the front view's scale, floor row, levels and reference spans. */
export function analyzeTurnFrame(o: Observation, front: FrontAnalysis): TurnSample | null {
  const P = (i: number) => px(o.landmarks[i], o.width, o.height);
  // The phone is static and the subject turns in place, so the front view's floor row and scale still hold.
  // If the hips moved vertically the subject stepped toward or away from the camera: skip the frame.
  const scale = measureScale(o, { kind: 'fixed', cmPerPx: front.scale.cmPerPx, floorY: front.scale.floorY });
  if (!scale) return null;
  const hp = mid(P(LM.leftHip), P(LM.rightHip)), sh = mid(P(LM.leftShoulder), P(LM.rightShoulder));
  if (Math.abs(hp.y - front.ref.hipYPx) > 0.03 * front.ref.bodyPx) return null;
  const theta = yawOf(o, front);
  if (!Number.isFinite(theta)) return null;
  const s = scale.cmPerPx, T = hp.y - sh.y;
  const rowOf = (h: number) => scale.floorY - h / s;
  const widthsCm: TurnSample['widthsCm'] = {};
  let legOverlapCm: TurnSample['legOverlapCm'];
  for (const site of TORSO_TURN_SITES) {
    const level = front.sites[site]?.heightCm;
    if (level === undefined) continue;
    const y = rowOf(level);
    const r = runAt(o.mask, y, lerp(sh.x, hp.x, clamp((y - sh.y) / (T || 1), 0, 1)), 6);
    if (r && !armAtEdge(o, y, 0.12 * T, r)) widthsCm[site] = runWidth(r) * s;
  }
  // Legs: as the body turns one leg comes nearer the camera (larger, and lower in the image below eye level) and
  // the other recedes. Each leg's own hip, knee and ankle landmarks map height to its image row and scale.
  const J = front.ref.legJointsCm;
  const legs = [[LM.leftHip, LM.leftKnee, LM.leftAnkle], [LM.rightHip, LM.rightKnee, LM.rightAnkle]].map(([a, b, c]) => [P(a), P(b), P(c)] as const);
  for (const site of LEG_TURN_SITES) {
    const level = front.sites[site]?.heightCm;
    if (level === undefined) continue;
    const per = legs.map(([hip, knee, ankle]) => {
      const [top, bottom, hTop, hBottom] = level >= J.knee ? [hip, knee, J.hip, J.knee] : [knee, ankle, J.knee, J.ankle];
      const t = (hTop - level) / (hTop - hBottom || 1);
      const p = { x: lerp(top.x, bottom.x, t), y: lerp(top.y, bottom.y, t) };
      const legCmPerPx = (hTop - hBottom) / Math.max(1, bottom.y - top.y);
      const r = runAt(o.mask, p.y, p.x, 4);
      return r ? { r, w: runWidth(r) * legCmPerPx } : null;
    });
    if (!per[0] || !per[1]) continue;
    // Separate runs: average the legs (their mirror-image sections make the pair symmetric in angle).
    if (per[0].r.x1 < per[1].r.x0 || per[1].r.x1 < per[0].r.x0) widthsCm[site] = (per[0].w + per[1].w) / 2;
    // Near profile the nearer leg (larger in the image) covers the farther one. Read the overlap at the nearer
    // leg's scale; it is smallest, and equal to that leg's depth, when the farther leg is fully hidden.
    else if (theta > 75 * DEG) {
      const near = per[0].w / runWidth(per[0].r) < per[1].w / runWidth(per[1].r) ? per[0] : per[1];
      (legOverlapCm ??= {})[site as LegSite] = near.w;
    }
  }
  return { theta, widthsCm, legOverlapCm, timestamp: o.timestamp, cmPerPx: s };
}

/**
 * Has an arm merged into the torso run at row y? Then the run reaches out to the arm, so the arm's centreline
 * (shoulder→elbow→wrist, within r of the row) lies inside the run near one of its edges. An arm outside the run
 * did not merge; one deep inside it lies in front of or behind the torso and does not change the width.
 */
function armAtEdge(o: Observation, y: number, r: number, run: { x0: number; x1: number }): boolean {
  const P = (i: number) => px(o.landmarks[i], o.width, o.height);
  return [[LM.leftShoulder, LM.leftElbow, LM.leftWrist], [LM.rightShoulder, LM.rightElbow, LM.rightWrist]].some(chain =>
    [[P(chain[0]), P(chain[1])], [P(chain[1]), P(chain[2])]].some(([a, b]) => {
      if (y < Math.min(a.y, b.y) - r || y > Math.max(a.y, b.y) + r) return false;
      const t = clamp((y - a.y) / (b.y - a.y || 1), 0, 1), x = lerp(a.x, b.x, t);
      return x >= run.x0 && x <= run.x1 && (x < run.x0 + 2 * r || x > run.x1 - 2 * r);
    }));
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

/** Leg depth at profile: a low percentile of the near-profile overlap widths (the far leg fully hidden). */
export function legProfileDepth(samples: readonly TurnSample[], site: LegSite, frontWidthCm: number): number | undefined {
  // A leg's depth is between 0.6 and 1.6 times its width; wider overlaps include a foot or the other leg.
  const v = samples.map(s => s.legOverlapCm?.[site]).filter((w): w is number => w !== undefined && w > 0.6 * frontWidthCm && w < 1.6 * frontWidthCm).sort((a, b) => a - b);
  return v.length >= 2 ? v[Math.floor(v.length * 0.15)] : undefined;
}

/** Depth of an elliptical section from its frontal width W and widths at other angles (least squares on w²). */
export function fitDepth(W: number, samples: readonly [number, number][]): number | undefined {
  let num = 0, den = 0;
  for (const [t, w] of samples) {
    if (t < 25 * DEG) continue;
    const s2 = Math.sin(t) ** 2;
    num += (w * w - W * W * Math.cos(t) ** 2) * s2; den += s2 * s2;
  }
  return den > 0 && num > 0 ? Math.sqrt(num / den) : undefined;
}

export type GirthEstimate = { girthCm: number; widthCm: number; depthCm: number; bins: number };

/**
 * Girth from caliper widths sampled by angle. The ellipse through the frontal width W and profile depth D is the
 * prior; sampled widths reshape it via their ratio to that ellipse, interpolated in angle. With no samples this is
 * exactly the ellipse perimeter; with dense samples it is the Cauchy perimeter of the measured widths.
 */
export function girthFromWidths(W: number, D: number | undefined, samples: readonly [number, number][]): GirthEstimate | null {
  const near90 = samples.filter(([t]) => t > 80 * DEG).map(([, w]) => w);
  const depth = D ?? (near90.length ? median(near90) : fitDepth(W, samples));
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
