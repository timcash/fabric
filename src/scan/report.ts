import { ellipsePerimeter } from './geometry.ts';
import { ARM_SITES, LEG_SITES, TORSO_SITES, type FrontAnalysis, type LengthId, type SideAnalysis, type Site } from './measure.ts';
import { binnedWidths, coverage, girthFromWidths, legProfileDepth, TORSO_TURN_SITES, type TurnSample, type TurnSite } from './turntable.ts';

export type Method = 'turntable' | 'two-view' | 'front-estimate' | 'circular' | 'silhouette' | 'landmark' | 'input';

export type Measurement = {
  id: Site | LengthId | 'height';
  label: string;
  group: 'girth' | 'length';
  cm: number;
  /** Expected error (±cm). A design estimate from the method, not a validated accuracy figure. */
  errorCm: number;
  method: Method;
  levelCm?: number;
  widthCm?: number;
  depthCm?: number;
};

export type Report = {
  measurements: Measurement[];
  warnings: string[];
  turnCoverage: number; // 0..1 of the folded 0–90° range
  createdAt: string;
};

export const LABELS: Record<Measurement['id'], string> = {
  height: 'Height', neck: 'Neck', chest: 'Chest / bust', waist: 'Waist (narrowest)', hip: 'Hip / seat (fullest)',
  thigh: 'Upper thigh', knee: 'Knee', calf: 'Calf', ankle: 'Ankle', bicep: 'Upper arm', forearm: 'Forearm', wrist: 'Wrist',
  shoulderBreadth: 'Shoulder span (joint centres)', armSpan: 'Arm span (fingertips)', armLength: 'Arm length (shoulder–wrist)', inseam: 'Inseam (crotch–floor)', legLength: 'Hip-joint height',
  torsoLength: 'Shoulder–hip (torso)', shoulderToCrotch: 'Shoulder–crotch', waistHeight: 'Waist height',
};

export const METHOD_TEXT: Record<Method, string> = {
  turntable: 'Widths from many angles, integrated with Cauchy’s formula',
  'two-view': 'Front width + profile depth, elliptical cross-section',
  'front-estimate': 'Front width only; depth from a typical body ratio',
  circular: 'Limb width, circular cross-section',
  silhouette: 'Silhouette distance',
  landmark: 'Pose-landmark distance',
  input: 'Entered by you (sets the scale)',
};

/** Typical depth/width ratios used only when no profile view exists. */
const TYPICAL_RATIO: Record<string, number> = { neck: 1.0, chest: 0.72, waist: 0.74, hip: 0.68 };
const WRIST_RATIO = 1.35;
const ERROR_PCT: Record<Method, number> = { turntable: 0.025, 'two-view': 0.04, 'front-estimate': 0.1, circular: 0.07, silhouette: 0.01, landmark: 0.015, input: 0 };

export function buildReport(front: FrontAnalysis, side: SideAnalysis | null, turn: readonly TurnSample[] = []): Report {
  const out: Measurement[] = [];
  const add = (m: Omit<Measurement, 'label' | 'errorCm'>, extraCm = 0) =>
    out.push({ ...m, label: LABELS[m.id], errorCm: m.method === 'input' ? 0 : m.cm * ERROR_PCT[m.method] + extraCm });
  add({ id: 'height', group: 'length', cm: front.heightCm, method: 'input' });

  for (const site of TORSO_SITES) {
    const f = front.sites[site];
    if (!f) continue;
    const W = f.widthCm, D = side?.sites[site]?.widthCm;
    const samples = (TORSO_TURN_SITES as readonly string[]).includes(site) ? binnedWidths(turn, site as TurnSite) : [];
    const usable = samples.length >= 4 ? girthFromWidths(W, D, samples) : null;
    if (usable) add({ id: site, group: 'girth', cm: usable.girthCm, method: 'turntable', levelCm: f.heightCm, widthCm: W, depthCm: usable.depthCm });
    else if (D) add({ id: site, group: 'girth', cm: ellipsePerimeter(W / 2, D / 2), method: 'two-view', levelCm: f.heightCm, widthCm: W, depthCm: D });
    else add({ id: site, group: 'girth', cm: ellipsePerimeter(W / 2, (W * TYPICAL_RATIO[site]) / 2), method: 'front-estimate', levelCm: f.heightCm, widthCm: W });
  }
  for (const site of LEG_SITES) {
    const f = front.sites[site];
    if (!f) continue;
    const D = side?.sites[site]?.widthCm;
    const samples = binnedWidths(turn, site);
    const turned = samples.length >= 3 ? girthFromWidths(f.widthCm, legProfileDepth(turn, site, f.widthCm) ?? D, samples) : null;
    if (turned) add({ id: site, group: 'girth', cm: turned.girthCm, method: 'turntable', levelCm: f.heightCm, widthCm: f.widthCm, depthCm: turned.depthCm });
    else if (D) add({ id: site, group: 'girth', cm: ellipsePerimeter(f.widthCm / 2, D / 2), method: 'two-view', levelCm: f.heightCm, widthCm: f.widthCm, depthCm: D });
    else add({ id: site, group: 'girth', cm: Math.PI * f.widthCm, method: 'circular', levelCm: f.heightCm, widthCm: f.widthCm });
  }
  for (const site of ARM_SITES) {
    const f = front.sites[site];
    if (!f) continue;
    // With arms out and palms down the camera sees the wrist's thickness; wrists are about 1.35× wider than thick.
    if (site === 'wrist') add({ id: site, group: 'girth', cm: ellipsePerimeter(f.widthCm / 2, (f.widthCm * WRIST_RATIO) / 2), method: 'front-estimate', levelCm: f.heightCm, widthCm: f.widthCm });
    else add({ id: site, group: 'girth', cm: Math.PI * f.widthCm, method: 'circular', levelCm: f.heightCm, widthCm: f.widthCm });
  }
  const lengthMethod: Record<LengthId, Method> = {
    shoulderBreadth: 'landmark', armSpan: 'silhouette', armLength: 'landmark', inseam: 'silhouette', legLength: 'landmark', torsoLength: 'landmark', shoulderToCrotch: 'silhouette', waistHeight: 'silhouette',
  };
  for (const id of Object.keys(lengthMethod) as LengthId[]) {
    const v = front.lengths[id];
    if (v) add({ id, group: 'length', cm: v.cm, method: lengthMethod[id] }, lengthMethod[id] === 'landmark' ? 1.5 : 0.8);
  }
  const bins = coverage(turn);
  return {
    measurements: out,
    // Profile-view complaints about a site the turn measured are moot.
    warnings: [...front.warnings, ...(side?.warnings ?? []).filter(w => !out.some(m => m.method === 'turntable' && w.includes(`Profile ${m.id} `)))],
    turnCoverage: bins.filter(Boolean).length / bins.length,
    createdAt: new Date().toISOString(),
  };
}

export const CM_PER_INCH = 2.54;
export type Units = 'cm' | 'in';
export const formatLength = (cm: number, units: Units, digits = 1) => (units === 'cm' ? `${cm.toFixed(digits)} cm` : `${(cm / CM_PER_INCH).toFixed(digits)} in`);

export function toCsv(report: Report): string {
  const rows = [['id', 'measurement', 'cm', 'in', 'plus_minus_cm', 'method', 'level_cm', 'width_cm', 'depth_cm']];
  for (const m of report.measurements) rows.push([m.id, m.label, m.cm.toFixed(1), (m.cm / CM_PER_INCH).toFixed(2), m.errorCm.toFixed(1), m.method, m.levelCm?.toFixed(1) ?? '', m.widthCm?.toFixed(1) ?? '', m.depthCm?.toFixed(1) ?? '']);
  return rows.map(r => r.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';
}
