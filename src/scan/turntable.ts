/**
 * Turn-in-place capture. The phone stays still while the subject turns a full circle with both arms held straight
 * out to the sides, so the arms stay above the chest from every angle. Each frame gives caliper widths from one
 * viewing angle: the torso at the chest, waist and hip, and each leg wherever the two legs separate in the image.
 * Cauchy's formula turns widths-by-angle into the girth a tape would read, without assuming an elliptical section.
 */
import { DEG, cauchyPerimeter, clamp, ellipseWidth, foldAngle, lerp, median, mid, px, yawFromSpans } from './geometry.ts';
import { measureScale, PHONE_FOV_DEG, type FrontAnalysis } from './measure.ts';
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
  /** Where the camera was, relative to the subject: full angle (0 = in front, + toward the subject's left), distance and height. */
  camera?: CameraEstimate;
};
/** `cos`: signed span ratio; `noseCm`: sideways nose offset from the shoulders (+ when seen from the subject's left). */
export type CameraEstimate = { angle: number; distanceCm: number; heightCm: number; cos: number; noseCm: number };
/** 'turn': phone static, subject turns. 'orbit': subject static, a helper walks around with the phone. */
export type AroundMode = 'turn' | 'orbit';

/** Horizontal image distance between two landmarks (perspective tilts the vertical component as the body turns). */
const hspan = (o: Observation, a: number, b: number) => Math.abs(o.landmarks[a].x - o.landmarks[b].x) * o.width;

/**
 * Folded yaw (0 = facing the camera, π/2 = profile) from shoulder and hip spans relative to the front view.
 * `k` rescales this frame's pixels to the front frame's (cm per px here ÷ cm per px in front) when the camera moves.
 */
export function yawOf(o: Observation, front: FrontAnalysis, k = 1): number {
  return yawFromSpans(hspan(o, LM.leftShoulder, LM.rightShoulder) * k, hspan(o, LM.leftHip, LM.rightHip) * k, front.ref.shoulderSpanPx, front.ref.hipSpanPx);
}

/**
 * Full viewing angle (−π..π). The signed left-minus-right span gives cos θ (negative from behind: the subject's
 * left shoulder then appears on the image's left). The nose, which sticks out in front of the body, gives the
 * sign of sin θ: seen from the subject's left, it points to the image's left.
 */
function angleParts(o: Observation, front: FrontAnalysis, k: number): { c: number; nose: number } {
  const x = (i: number) => o.landmarks[i].x * o.width;
  const c = clamp(((x(LM.leftShoulder) - x(LM.rightShoulder)) * k / front.ref.shoulderSpanPx + (x(LM.leftHip) - x(LM.rightHip)) * k / front.ref.hipSpanPx) / 2, -1, 1);
  return { c, nose: -(x(LM.nose) - (x(LM.leftShoulder) + x(LM.rightShoulder)) / 2) };
}
export function signedAngle(o: Observation, front: FrontAnalysis, k = 1): number {
  const { c, nose } = angleParts(o, front, k);
  return Math.atan2((nose >= 0 ? 1 : -1) * Math.sqrt(1 - c * c), c);
}

/** Camera distance and height from this frame's metric scale, assuming an upright (leveled) typical phone lens. */
function cameraEstimate(o: Observation, front: FrontAnalysis, cmPerPx: number, floorY: number): CameraEstimate {
  const f = Math.max(o.width, o.height) / 2 / Math.tan((PHONE_FOV_DEG * Math.PI) / 360);
  const k = cmPerPx / front.scale.cmPerPx, { c, nose } = angleParts(o, front, k);
  return { angle: signedAngle(o, front, k), distanceCm: f * cmPerPx, heightCm: (floorY - o.height / 2) * cmPerPx, cos: c, noseCm: nose * cmPerPx };
}

/**
 * Refines the per-frame angles. Near the front and back, cos θ hardly changes with angle and the nose side
 * flickers, so the angle there comes from the nose's sideways offset instead: sin θ = offset / reach, with the
 * nose's forward reach learned from the frames between, where the span ratio is reliable.
 */
export function cameraPath(samples: readonly TurnSample[]): (CameraEstimate & { timestamp: number })[] {
  const cams = samples.filter(s => s.camera).map(s => ({ ...s.camera!, timestamp: s.timestamp }));
  const reach = median(cams.filter(c => Math.abs(c.cos) < 0.6).map(c => Math.abs(c.noseCm) / Math.sqrt(1 - c.cos * c.cos)));
  if (!(reach > 2)) return cams;
  return cams.map(c => {
    if (Math.abs(c.cos) < 0.92) return c;
    const sin = clamp(c.noseCm / reach, -0.9, 0.9);
    return { ...c, angle: Math.atan2(sin, Math.sign(c.cos) * Math.sqrt(1 - sin * sin)) };
  });
}

/**
 * Measures one frame taken from another angle, using the front view's levels and reference spans.
 * 'turn': the phone is static and the subject turns in place, so the front view's floor row and scale hold; if the
 * hips moved vertically the subject stepped toward or away from the camera and the frame is skipped.
 * 'orbit': the phone moves, so every (leveled) frame gets its own metric scale and floor from the subject's height,
 * and is skipped if the hip-joint height it implies disagrees with the front view (a bad mask or a cut-off head).
 */
export function analyzeTurnFrame(o: Observation, front: FrontAnalysis, mode: AroundMode = 'turn'): TurnSample | null {
  const P = (i: number) => px(o.landmarks[i], o.width, o.height);
  let scale = mode === 'turn'
    ? measureScale(o, { kind: 'fixed', cmPerPx: front.scale.cmPerPx, floorY: front.scale.floorY })
    : measureScale(o, { kind: 'height', heightCm: front.heightCm });
  if (!scale) return null;
  if (mode === 'orbit') {
    // The heels sit behind the body seen from the front, beside it from the side and in front of it from behind:
    // redo the floor with the viewing angle (the span-based angle barely depends on the first scale).
    const facing = Math.cos(signedAngle(o, front, scale.cmPerPx / front.scale.cmPerPx));
    scale = measureScale(o, { kind: 'height', heightCm: front.heightCm, facing }) ?? scale;
  }
  const hp = mid(P(LM.leftHip), P(LM.rightHip)), sh = mid(P(LM.leftShoulder), P(LM.rightShoulder));
  if (mode === 'turn' && Math.abs(hp.y - front.ref.hipYPx) > 0.03 * front.ref.bodyPx) return null;
  if (mode === 'orbit' && Math.abs((scale.floorY - hp.y) * scale.cmPerPx / front.ref.hipHeightCm - 1) > 0.05) return null;
  const k = scale.cmPerPx / front.scale.cmPerPx;
  const theta = yawOf(o, front, k);
  if (!Number.isFinite(theta)) return null;
  const camera = cameraEstimate(o, front, scale.cmPerPx, scale.floorY);
  const s = scale.cmPerPx, T = hp.y - sh.y;
  const rowOf = (h: number) => scale.floorY - h / s;
  const widthsCm: TurnSample['widthsCm'] = {};
  let legOverlapCm: TurnSample['legOverlapCm'];
  // Walking around, each frame's floor line carries heel parallax and landmark noise, and a 1–2 cm level error
  // matters where girth changes fast with height (near the armpits). So torso levels are placed between this
  // frame's own shoulder- and hip-joint rows, which sit at the body's centre like the levels themselves.
  const J = front.ref.legJointsCm;
  const torsoRow = (h: number) => mode === 'orbit' ? lerp(sh.y, hp.y, (front.ref.shoulderCm - h) / (front.ref.shoulderCm - J.hip || 1)) : rowOf(h);
  for (const site of TORSO_TURN_SITES) {
    const level = front.sites[site]?.heightCm;
    if (level === undefined) continue;
    const y = torsoRow(level);
    const r = runAt(o.mask, y, lerp(sh.x, hp.x, clamp((y - sh.y) / (T || 1), 0, 1)), 6);
    if (r && !armAtEdge(o, y, 0.12 * T, r)) widthsCm[site] = runWidth(r) * s;
  }
  // Legs: as the body turns one leg comes nearer the camera (larger, and lower in the image below eye level) and
  // the other recedes. Each leg's own hip, knee and ankle landmarks map height to its image row and scale.
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
  return { theta, widthsCm, legOverlapCm, timestamp: o.timestamp, cmPerPx: s, camera };
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

/**
 * Unwraps the per-frame full angles into a continuous path (frames are consecutive, so steps stay under 180°)
 * and reports how much of the circle has been covered.
 */
export function unwrapAngles(samples: readonly TurnSample[]): { angles: number[]; coveredDeg: number } {
  const angles: number[] = [];
  for (const s of samples) {
    if (!s.camera) continue;
    const a = s.camera.angle;
    if (!angles.length) { angles.push(a); continue; }
    const prev = angles[angles.length - 1], d = a - prev;
    angles.push(prev + Math.atan2(Math.sin(d), Math.cos(d))); // shortest step from the previous angle
  }
  const coveredDeg = angles.length ? ((Math.max(...angles) - Math.min(...angles)) * 180) / Math.PI : 0;
  return { angles, coveredDeg };
}

/** 36 bins of the full circle visited by the camera (for the capture dial). */
export function circleCoverage(samples: readonly TurnSample[]): boolean[] {
  const bins = Array<boolean>(36).fill(false);
  for (const s of samples) if (s.camera) bins[Math.floor((((s.camera.angle * 180) / Math.PI + 360) % 360) / 10)] = true;
  return bins;
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
