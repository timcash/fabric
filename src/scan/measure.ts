/**
 * Silhouette anthropometry. A front view gives widths and landmark lengths; a profile view gives depths at the
 * same heights above the floor. Heights, not pixel rows, link the views, so each view keeps its own scale.
 */
import { along, dist, lerp, median, mid, perpendicular, px, unit } from './geometry.ts';
import { chordAlong, firstGapBelow, runAt, runWidth, verticalExtent, type Chord } from './mask.ts';
import { LM, type Observation, type Point } from './types.ts';

export type TorsoSite = 'neck' | 'chest' | 'waist' | 'hip';
export type LegSite = 'thigh' | 'knee' | 'calf' | 'ankle';
export type ArmSite = 'bicep' | 'forearm' | 'wrist';
export type Site = TorsoSite | LegSite | ArmSite;
export const TORSO_SITES: readonly TorsoSite[] = ['neck', 'chest', 'waist', 'hip'];
export const LEG_SITES: readonly LegSite[] = ['thigh', 'knee', 'calf', 'ankle'];
export const ARM_SITES: readonly ArmSite[] = ['bicep', 'forearm', 'wrist'];

/** A measured chord (or a left/right pair) at one body site. */
export type SiteChord = { chords: Chord[]; widthCm: number; heightCm: number };

export type LengthId = 'shoulderBreadth' | 'armSpan' | 'armLength' | 'inseam' | 'legLength' | 'torsoLength' | 'shoulderToCrotch' | 'waistHeight';
export type LengthValue = { cm: number; segments: [Point, Point][] };

export type Scale = { cmPerPx: number; floorY: number; topY: number };

export type FrontAnalysis = {
  view: 'front';
  scale: Scale;
  heightCm: number;
  sites: Partial<Record<Site, SiteChord>>;
  lengths: Partial<Record<LengthId, LengthValue>>;
  /** Frontal reference spans (px) and the hip-joint height used to follow the subject in later frames. */
  ref: { shoulderSpanPx: number; hipSpanPx: number; hipHeightCm: number; hipYPx: number; bodyPx: number; legJointsCm: { hip: number; knee: number; ankle: number }; shoulderCm: number };
  warnings: string[];
};

export type SideAnalysis = {
  view: 'side';
  scale: Scale;
  sites: Partial<Record<TorsoSite | LegSite, SiteChord>>;
  warnings: string[];
};

const P = (o: Observation, i: number) => px(o.landmarks[i], o.width, o.height);
const toCm = (s: Scale, y: number) => (s.floorY - y) * s.cmPerPx;
const toY = (s: Scale, h: number) => s.floorY - h / s.cmPerPx;

/** 'phone': pinhole camera, upright, with a typical main-camera field of view. 'orthographic': no perspective. */
export type Lens = 'phone' | 'orthographic';
/** `facing`: cos of the viewing angle (1 = from the front, −1 = from behind), which decides where the heels sit. */
export type ScaleSource = { kind: 'height'; heightCm: number; lens?: Lens; facing?: number } | { kind: 'fixed'; cmPerPx: number; floorY?: number };

/** Typical phone main-camera field of view along the image's long side (≈26 mm equivalent). */
export const PHONE_FOV_DEG = 68;
/** The back of the heel sits about this fraction of stature behind the body's plane. */
const HEEL_BEHIND = 0.03;

/**
 * Image row of the floor under the body. Feet pointing at the camera reach lower in the image than the heels
 * (perspective), so the silhouette bottom overstates the body's pixel height by several percent. The heels sit
 * close to the body's plane, so heel landmarks are preferred; the silhouette bottom is the fallback.
 */
export function floorRow(o: Observation, silhouetteBottom: number): number | null {
  const heels = [LM.leftHeel, LM.rightHeel].map(i => o.landmarks[i]).filter(l => (l.visibility ?? 1) >= 0.5).map(l => l.y * o.height);
  const ankle = Math.min(P(o, LM.leftAnkle).y, P(o, LM.rightAnkle).y);
  const ok = heels.filter(y => y > ankle && y <= silhouetteBottom + 2);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

/** Finds the subject's silhouette (connected to the hip midpoint) and converts pixels to centimetres. */
export function measureScale(o: Observation, source: ScaleSource): Scale | null {
  const hip = mid(P(o, LM.leftHip), P(o, LM.rightHip));
  const sh = mid(P(o, LM.leftShoulder), P(o, LM.rightShoulder));
  const seed = along(hip, sh, 0.3);
  const ext = verticalExtent(o.mask, seed) ?? verticalExtent(o.mask, hip);
  if (!ext || ext.bottom - ext.top < o.height * 0.2) return null;
  if (source.kind === 'fixed' && source.floorY !== undefined) return { cmPerPx: source.cmPerPx, floorY: source.floorY, topY: ext.top };
  const heel = floorRow(o, ext.bottom);
  let floorY = heel ?? ext.bottom;
  const scaleFor = (f: number) => (source.kind === 'height' ? source.heightCm / (f - ext.top) : source.cmPerPx);
  if (heel !== null && (source.kind === 'fixed' || source.lens !== 'orthographic')) {
    // Heels sit behind the body's plane, so with the camera above the floor they image slightly higher than the
    // floor under the body. Shift by that parallax (upright pinhole camera, typical field of view).
    const s = scaleFor(floorY), f = Math.max(o.width, o.height) / 2 / Math.tan((PHONE_FOV_DEG * Math.PI) / 360);
    const D = f * s, camHeight = (floorY - o.height / 2) * s, behind = HEEL_BEHIND * (source.kind === 'height' ? source.facing ?? 1 : 1) * (floorY - ext.top) * s;
    if (camHeight > 0) floorY += (f * camHeight * behind) / (D * (D + behind));
  }
  return { cmPerPx: scaleFor(floorY), floorY, topY: ext.top };
}

/** Horizontal silhouette width (px) at row y of the run nearest x. */
function rowChord(o: Observation, y: number, x: number, slack = 3): Chord | null {
  const r = runAt(o.mask, y, x, slack);
  return r ? { a: { x: r.x0, y }, b: { x: r.x1, y }, length: runWidth(r) } : null;
}

type Pick = 'min' | 'max' | 'median';
function scanRows(y0: number, y1: number, pick: Pick, at: (y: number) => Chord | null): Chord | null {
  const found: Chord[] = [];
  const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
  for (let y = Math.floor(lo) + 0.5; y <= hi; y += 1) { const c = at(y); if (c && c.length > 0) found.push(c); }
  if (!found.length) return null;
  if (pick === 'median') { const m = median(found.map(c => c.length)); return found.reduce((b, c) => (Math.abs(c.length - m) < Math.abs(b.length - m) ? c : b)); }
  return found.reduce((b, c) => (pick === 'min' ? c.length < b.length : c.length > b.length) ? c : b);
}

/** Scans perpendicular chords along a limb segment between fractions t0..t1. */
function scanLimb(o: Observation, a: Point, b: Point, t0: number, t1: number, pick: Pick, maxLen: number): Chord | null {
  const d = perpendicular(unit(a, b));
  const steps = Math.max(2, Math.round(dist(a, b) * Math.abs(t1 - t0)));
  const found: Chord[] = [];
  for (let i = 0; i <= steps; i++) { const c = chordAlong(o.mask, along(a, b, lerp(t0, t1, i / steps)), d, undefined, maxLen); if (c) found.push(c); }
  if (!found.length) return null;
  if (pick === 'median') { const m = median(found.map(c => c.length)); return found.reduce((x, c) => (Math.abs(c.length - m) < Math.abs(x.length - m) ? c : x)); }
  return found.reduce((x, c) => (pick === 'min' ? c.length < x.length : c.length > x.length) ? c : x);
}

const chordMidY = (c: Chord) => (c.a.y + c.b.y) / 2;
function site(s: Scale, chords: (Chord | null)[]): SiteChord | undefined {
  const ok = chords.filter((c): c is Chord => !!c);
  if (!ok.length) return undefined;
  return { chords: ok, widthCm: (ok.reduce((t, c) => t + c.length, 0) / ok.length) * s.cmPerPx, heightCm: toCm(s, ok.reduce((t, c) => t + chordMidY(c), 0) / ok.length) };
}

/** Front (A-pose) analysis: widths at every site plus landmark and silhouette lengths. */
export function analyzeFront(o: Observation, source: ScaleSource): FrontAnalysis | null {
  const scale = measureScale(o, source);
  if (!scale) return null;
  const warnings: string[] = [];
  const heightCm = source.kind === 'height' ? source.heightCm : (scale.floorY - scale.topY) * scale.cmPerPx;
  const lS = P(o, LM.leftShoulder), rS = P(o, LM.rightShoulder), lH = P(o, LM.leftHip), rH = P(o, LM.rightHip);
  const sh = mid(lS, rS), hp = mid(lH, rH), T = hp.y - sh.y;
  if (!(T > 0)) return null;
  const mouth = mid(P(o, LM.mouthLeft), P(o, LM.mouthRight));
  const cx = (y: number) => (y <= sh.y ? sh.x : y >= hp.y ? hp.x : lerp(sh.x, hp.x, (y - sh.y) / T));
  const torsoAt = (y: number) => rowChord(o, y, cx(y));
  const sites: FrontAnalysis['sites'] = {};

  const neckSpan = sh.y - mouth.y;
  // Mid-neck, below the larynx: 40% of the way up from the shoulder line to the mouth. The narrowest row is
  // right under the jaw, where a tape would catch the chin.
  const neckY = sh.y - 0.4 * neckSpan;
  sites.neck = site(scale, [scanRows(neckY - 0.12 * neckSpan, neckY + 0.12 * neckSpan, 'median', torsoAt)]);
  const chestY = sh.y + 0.27 * T;
  sites.chest = site(scale, [scanRows(chestY - 0.02 * T, chestY + 0.02 * T, 'median', torsoAt)]);
  sites.waist = site(scale, [scanRows(sh.y + 0.55 * T, sh.y + 0.85 * T, 'min', torsoAt)]);

  const limbMax = 0.6 * T;
  let crotchY = firstGapBelow(o.mask, hp, scale.floorY);
  const inseamFraction = crotchY === null ? 0 : toCm(scale, crotchY) / heightCm;
  if (crotchY !== null && (inseamFraction < 0.3 || inseamFraction > 0.56)) {
    crotchY = null;
    warnings.push('The crotch could not be located reliably (skirt, hands or objects near the hips?). Inseam and thigh are unavailable.');
  } else if (crotchY === null) warnings.push('No gap between the legs was found: stand with feet hip-width apart. Inseam and thigh are unavailable.');
  // The fullest hip sits near the hip joints. Below that, a camera above waist height sees the fronts of the
  // thighs above the apparent crotch, which would read as "wider hips".
  const hipBottom = Math.min(hp.y + 0.15 * T, (crotchY ?? Infinity) - 0.04 * T);
  sites.hip = site(scale, [scanRows(hp.y - 0.1 * T, hipBottom, 'max', torsoAt)]);

  const chestChord = sites.chest?.chords[0];
  if (chestChord && chestChord.length > 1.35 * dist(lS, rS)) warnings.push('Something wider than the torso touches it at chest level (arms down, loose clothing, or another person).');

  // Legs: perpendicular chords on each leg; left/right averaged.
  const legs = [[LM.leftHip, LM.leftKnee, LM.leftAnkle], [LM.rightHip, LM.rightKnee, LM.rightAnkle]].map(([h, k, a]) => ({ hip: P(o, h), knee: P(o, k), ankle: P(o, a) }));
  const hipWidthPx = sites.hip ? sites.hip.chords[0].length : 2 * dist(lH, rH);
  const thighY = crotchY !== null ? crotchY + 3 / scale.cmPerPx : null;
  const thighs = thighY === null ? [] : legs.map(l => {
    const t = (thighY - l.hip.y) / (l.knee.y - l.hip.y);
    const c = chordAlong(o.mask, along(l.hip, l.knee, t), perpendicular(unit(l.hip, l.knee)), undefined, limbMax);
    return c && c.length < 0.75 * hipWidthPx ? c : null;
  });
  if (thighY !== null && thighs.every(c => !c)) warnings.push('Thighs appear joined: stand with feet apart.');
  sites.thigh = site(scale, thighs);
  sites.knee = site(scale, legs.map(l => {
    const d = unit(l.hip, l.ankle);
    return chordAlong(o.mask, l.knee, perpendicular(d), undefined, limbMax);
  }));
  sites.calf = site(scale, legs.map(l => scanLimb(o, l.knee, l.ankle, 0.15, 0.5, 'max', limbMax)));
  sites.ankle = site(scale, legs.map(l => scanLimb(o, l.knee, l.ankle, 0.7, 0.92, 'min', limbMax)));

  const arms = [[LM.leftShoulder, LM.leftElbow, LM.leftWrist], [LM.rightShoulder, LM.rightElbow, LM.rightWrist]].map(([s, e, w]) => ({ s: P(o, s), e: P(o, e), w: P(o, w) }));
  sites.bicep = site(scale, arms.map(a => scanLimb(o, a.s, a.e, 0.35, 0.7, 'max', limbMax)));
  sites.forearm = site(scale, arms.map(a => scanLimb(o, a.e, a.w, 0.1, 0.45, 'max', limbMax)));
  sites.wrist = site(scale, arms.map(a => scanLimb(o, a.e, a.w, 0.8, 0.97, 'min', limbMax)));
  dropImplausible(sites, heightCm, warnings);

  const lengths: FrontAnalysis['lengths'] = {};
  const cm = (v: number) => v * scale.cmPerPx;
  lengths.shoulderBreadth = { cm: cm(dist(lS, rS)), segments: [[lS, rS]] };
  // Fingertip to fingertip: march past each wrist along the forearm to the end of the silhouette.
  const tips = arms.map(a => { const d = unit(a.e, a.w); const c = chordAlong(o.mask, a.w, d, undefined, 0.6 * T); return c ? (dot2(sub2(c.b, a.w), d) > 0 ? c.b : c.a) : null; });
  const level = arms.every(a => Math.abs(a.w.y - a.s.y) < 0.15 * dist(a.s, a.w));
  if (tips[0] && tips[1] && level) lengths.armSpan = { cm: cm(dist(tips[0], tips[1])), segments: [[tips[0], tips[1]]] };
  const armLens = arms.map(a => dist(a.s, a.e) + dist(a.e, a.w));
  const armCm = cm(median(armLens));
  if (armCm > 0.2 * heightCm && armCm < 0.42 * heightCm) lengths.armLength = { cm: armCm, segments: arms.flatMap(a => [[a.s, a.e], [a.e, a.w]] as [Point, Point][]) };
  else warnings.push('Arms looked bent or hidden, so arm length was not measured.');
  lengths.legLength = { cm: toCm(scale, hp.y), segments: [[hp, { x: hp.x, y: scale.floorY }]] };
  lengths.torsoLength = { cm: cm(T), segments: [[sh, { x: sh.x, y: hp.y }]] };
  if (crotchY !== null) {
    lengths.inseam = { cm: toCm(scale, crotchY), segments: [[{ x: hp.x, y: crotchY }, { x: hp.x, y: scale.floorY }]] };
    lengths.shoulderToCrotch = { cm: cm(crotchY - sh.y), segments: [[sh, { x: sh.x, y: crotchY }]] };
  }
  if (sites.waist) lengths.waistHeight = { cm: sites.waist.heightCm, segments: [[{ x: hp.x + hipWidthPx * 0.7, y: toY(scale, sites.waist.heightCm) }, { x: hp.x + hipWidthPx * 0.7, y: scale.floorY }]] };

  return {
    view: 'front', scale, heightCm, sites, lengths, warnings,
    ref: { shoulderSpanPx: Math.abs(lS.x - rS.x), hipSpanPx: Math.abs(lH.x - rH.x), hipHeightCm: toCm(scale, hp.y), hipYPx: hp.y, bodyPx: scale.floorY - scale.topY,
      legJointsCm: { hip: toCm(scale, hp.y), knee: toCm(scale, (P(o, LM.leftKnee).y + P(o, LM.rightKnee).y) / 2), ankle: toCm(scale, (P(o, LM.leftAnkle).y + P(o, LM.rightAnkle).y) / 2) }, shoulderCm: toCm(scale, sh.y) },
  };
}

/** Width/height ranges a real adult body falls within; anything outside is a segmentation or pose failure. */
const PLAUSIBLE: Record<Site, [number, number]> = {
  neck: [0.04, 0.12], chest: [0.12, 0.32], waist: [0.09, 0.32], hip: [0.12, 0.34], thigh: [0.05, 0.16], knee: [0.03, 0.1],
  calf: [0.03, 0.1], ankle: [0.018, 0.07], bicep: [0.025, 0.12], forearm: [0.02, 0.09], wrist: [0.016, 0.06],
};
function dropImplausible(sites: Partial<Record<Site, SiteChord | undefined>>, heightCm: number, warnings: string[]) {
  const dropped: string[] = [];
  for (const name of Object.keys(sites) as Site[]) {
    const s = sites[name];
    const r = s ? s.widthCm / heightCm : NaN;
    if (!s || !(r >= PLAUSIBLE[name][0] && r <= PLAUSIBLE[name][1])) { if (s) dropped.push(name); delete sites[name]; }
  }
  if (dropped.length) warnings.push(`Dropped implausible ${dropped.join(', ')} (loose clothing, another person, or limbs touching the body?).`);
}

/**
 * Profile analysis: silhouette depths at the heights the front view chose. Works with arms down or raised.
 * `theta` is the frame's folded yaw (π/2 = exact profile). Off-profile, the two legs no longer line up and their
 * union looks deeper by 2·L·|cos θ| (L = half the leg spacing seen from the front), which is removed.
 */
export function analyzeSide(o: Observation, front: FrontAnalysis, source: ScaleSource, theta = Math.PI / 2): SideAnalysis | null {
  const scale = measureScale(o, source);
  if (!scale) return null;
  const warnings: string[] = [];
  const sh = mid(P(o, LM.leftShoulder), P(o, LM.rightShoulder)), hp = mid(P(o, LM.leftHip), P(o, LM.rightHip));
  const T = hp.y - sh.y;
  const cx = (y: number) => (y <= sh.y ? sh.x : y >= hp.y ? hp.x : lerp(sh.x, hp.x, (y - sh.y) / (T || 1)));
  const sites: SideAnalysis['sites'] = {};
  const window: Record<TorsoSite, [number, Pick]> = { neck: [0.5, 'median'], chest: [3, 'max'], waist: [1, 'median'], hip: [4, 'max'] };
  const raised = armsAway(o);
  for (const name of ['neck', 'chest', 'waist', 'hip'] as const) {
    const f = front.sites[name];
    if (!f || (name === 'neck' && raised)) continue; // arms held out or up flank the neck in profile
    const [win, pick] = window[name];
    const c = scanRows(toY(scale, f.heightCm + win), toY(scale, f.heightCm - win), pick, y => rowChord(o, y, cx(y), 6));
    const depth = c ? c.length * scale.cmPerPx : NaN;
    const ratio = depth / f.widthCm;
    if (c && ratio > 0.4 && ratio < (name === 'neck' ? 1.35 : 1.6)) sites[name] = { chords: [c], widthCm: depth, heightCm: f.heightCm };
    else warnings.push(`Profile ${name} depth was implausible (arms or hair in the way?) and was ignored.`);
  }
  const knee = mid(P(o, LM.leftKnee), P(o, LM.rightKnee)), ankle = mid(P(o, LM.leftAnkle), P(o, LM.rightAnkle));
  const legX = (y: number) => (y <= hp.y ? hp.x : y <= knee.y ? lerp(hp.x, knee.x, (y - hp.y) / (knee.y - hp.y || 1)) : lerp(knee.x, ankle.x, Math.min(1, (y - knee.y) / (ankle.y - knee.y || 1))));
  for (const name of LEG_SITES) {
    const f = front.sites[name];
    if (!f) continue;
    const y = toY(scale, f.heightCm);
    const c = rowChord(o, y, legX(y), 8);
    const spacing = f.chords.length === 2 ? Math.abs((f.chords[0].a.x + f.chords[0].b.x) / 2 - (f.chords[1].a.x + f.chords[1].b.x) / 2) * front.scale.cmPerPx : 0;
    const depth = c ? c.length * scale.cmPerPx - spacing * Math.abs(Math.cos(theta)) : NaN;
    const ratio = depth / f.widthCm;
    if (c && ratio > 0.6 && ratio < 1.6) sites[name] = { chords: [c], widthCm: depth, heightCm: f.heightCm };
    else warnings.push(`Profile ${name} depth was implausible (legs staggered?) and was ignored.`);
  }
  return { view: 'side', scale, sites, warnings };
}

/**
 * Several frames of the same view → one analysis. Picks the frame closest to the per-site medians (so drawn chords
 * stay coherent) and replaces every site width with the median across frames.
 */
export function combineAnalyses<T extends FrontAnalysis | SideAnalysis>(list: readonly T[]): T | null {
  if (!list.length) return null;
  const names = [...new Set(list.flatMap(a => Object.keys(a.sites)))] as Site[];
  const sitesOf = (a: T) => a.sites as Partial<Record<Site, SiteChord>>;
  const med = Object.fromEntries(names.map(n => [n, median(list.map(a => sitesOf(a)[n]?.widthCm ?? NaN))])) as Record<Site, number>;
  const cost = (a: T) => names.reduce((t, n) => { const w = sitesOf(a)[n]?.widthCm; return t + (w === undefined ? 1 : Math.abs(w / med[n] - 1)); }, 0);
  const best = list.reduce((b, a) => (cost(a) < cost(b) ? a : b));
  const sites = Object.fromEntries(Object.entries(best.sites).map(([n, s]) => [n, { ...s, widthCm: med[n as Site] }]));
  const out = { ...best, sites, warnings: [...new Set(list.flatMap(a => a.warnings))].filter(w => list.filter(a => a.warnings.includes(w)).length * 2 > list.length) } as T;
  if (out.view === 'front') {
    const lens = list as readonly FrontAnalysis[], f = out as FrontAnalysis;
    f.lengths = Object.fromEntries(Object.entries(f.lengths).map(([id, v]) => [id, { ...v, cm: median(lens.map(a => a.lengths[id as LengthId]?.cm ?? NaN)) }]));
  }
  return out;
}

/** Profile photo taken separately (different distance): scale from the front view's hip-joint height. */
export function hipScale(o: Observation, front: FrontAnalysis): ScaleSource | null {
  const probe = measureScale(o, { kind: 'fixed', cmPerPx: 1 });
  if (!probe) return null;
  const hipY = (P(o, LM.leftHip).y + P(o, LM.rightHip).y) / 2;
  return { kind: 'fixed', cmPerPx: front.ref.hipHeightCm / (probe.floorY - hipY) };
}

const dot2 = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const sub2 = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });

/** True when the wrists are held out or up (above the hips), rather than hanging at the sides. */
export const armsAway = (o: Observation) => {
  const sh = (P(o, LM.leftShoulder).y + P(o, LM.rightShoulder).y) / 2, hp = (P(o, LM.leftHip).y + P(o, LM.rightHip).y) / 2;
  return P(o, LM.leftWrist).y < lerp(sh, hp, 0.45) && P(o, LM.rightWrist).y < lerp(sh, hp, 0.45);
};

/** True when both wrists are above the nose (arms raised), so the silhouette top is the hands, not the head. */
export const armsRaised = (o: Observation) => P(o, LM.leftWrist).y < P(o, LM.nose).y && P(o, LM.rightWrist).y < P(o, LM.nose).y;
