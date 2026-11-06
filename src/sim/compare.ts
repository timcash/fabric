/**
 * Scores a scan of the simulated body against the posed mesh. Each measured chord's image row is back-projected
 * through the simulated camera onto the body's plane, so the truth is the tape girth exactly where the app
 * measured. Level errors (where the app thought it measured) are reported separately.
 */
import type { Camera } from './camera.ts';
import { bodyCenter, jointAt, type PosedBody, type Vec3 } from './makehuman.ts';
import { crotchHeight, limbSection, sectionAt, span } from './truth.ts';
import type { FrontAnalysis } from '../scan/measure.ts';
import type { Report } from '../scan/report.ts';

export type Comparison = { id: string; label: string; method: string; measuredCm: number; truthCm: number; errorCm: number; errorPct: number; levelErrorCm?: number };

/** Body-frame point (cm) seen at image (x, y) on the plane through the body's centre facing the camera (yaw 0). */
function backProject(cam: Camera, center: Vec3, x: number, y: number, depthOffset = 0): Vec3 {
  const D = cam.position[2] - depthOffset;
  return [((x - cam.cx) * D) / cam.f + cam.position[0] + center[0], cam.position[1] - ((y - cam.cy) * D) / cam.f, center[2] + depthOffset];
}

export function compareToMesh(report: Report, front: FrontAnalysis, body: PosedBody, cam: Camera): Comparison[] {
  const center = bodyCenter(body);
  const spineZ = jointAt(body, 'spine03')[2];
  const chain = (kind: 'arm' | 'leg', side: 'L' | 'R'): [string, string, string] => kind === 'arm' ? [`upperarm01.${side}`, `lowerarm01.${side}`, `wrist.${side}`] : [`upperleg01.${side}`, `lowerleg01.${side}`, `foot.${side}`];
  const out: Comparison[] = [];
  const push = (id: string, measuredCm: number, truthCm: number | undefined, levelErrorCm?: number) => {
    const m = report.measurements.find(x => x.id === id);
    if (!m || truthCm === undefined || !Number.isFinite(truthCm)) return;
    out.push({ id, label: m.label, method: m.method, measuredCm, truthCm, errorCm: measuredCm - truthCm, errorPct: (100 * (measuredCm - truthCm)) / truthCm, levelErrorCm });
  };
  for (const m of report.measurements) {
    const site = front.sites[m.id as keyof FrontAnalysis['sites']];
    if (m.group === 'girth' && site) {
      const truths: number[] = [];
      let levelErr: number | undefined;
      for (const c of site.chords) {
        const mx = (c.a.x + c.b.x) / 2, my = (c.a.y + c.b.y) / 2;
        const p = backProject(cam, center, mx, my);
        if (['neck', 'chest', 'waist', 'hip'].includes(m.id)) {
          // A tape goes around the neck perpendicular to it (a horizontal cut would catch the jaw).
          const n0 = jointAt(body, 'neck01'), n1 = jointAt(body, 'head'), nl = Math.hypot(n1[0] - n0[0], n1[1] - n0[1], n1[2] - n0[2]);
          const s = m.id === 'neck'
            ? sectionAt(body, [center[0], p[1], n0[2] + ((p[1] - n0[1]) / (n1[1] - n0[1])) * (n1[2] - n0[2])], [(n1[0] - n0[0]) / nl, (n1[1] - n0[1]) / nl, (n1[2] - n0[2]) / nl])
            : sectionAt(body, [center[0], p[1], spineZ]);
          if (s) truths.push(s.tapeCm);
          levelErr = m.levelCm! - p[1];
        } else {
          const kind = ['bicep', 'forearm', 'wrist'].includes(m.id) ? 'arm' : 'leg';
          const side = p[0] - center[0] >= 0 ? 'L' : 'R';
          const s = limbSection(body, chain(kind, side), p);
          if (s) truths.push(s.tapeCm);
        }
      }
      if (truths.length) push(m.id, m.cm, truths.reduce((a, b) => a + b, 0) / truths.length, levelErr);
    }
  }
  const J = (b: string) => jointAt(body, b);
  const d = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const sh = (J('upperarm01.L')[1] + J('upperarm01.R')[1]) / 2, hip = (J('upperleg01.L')[1] + J('upperleg01.R')[1]) / 2, crotch = crotchHeight(body);
  const lengths: Record<string, number> = {
    height: body.model.heightCm,
    shoulderBreadth: d(J('upperarm01.L'), J('upperarm01.R')),
    armSpan: span(body),
    armLength: (d(J('upperarm01.L'), J('lowerarm01.L')) + d(J('lowerarm01.L'), J('wrist.L')) + d(J('upperarm01.R'), J('lowerarm01.R')) + d(J('lowerarm01.R'), J('wrist.R'))) / 2,
    inseam: crotch, legLength: hip, torsoLength: sh - hip, shoulderToCrotch: sh - crotch,
  };
  const waist = front.sites.waist;
  if (waist) lengths.waistHeight = backProject(cam, center, 0, (waist.chords[0].a.y + waist.chords[0].b.y) / 2)[1];
  for (const m of report.measurements) if (m.group === 'length') push(m.id, m.cm, lengths[m.id]);
  return out;
}

export function comparisonTable(rows: readonly Comparison[]): string {
  const lines = ['| Measurement | Method | Measured | Mesh truth | Error |', '| --- | --- | ---: | ---: | ---: |'];
  for (const r of rows) lines.push(`| ${r.label} | ${r.method} | ${r.measuredCm.toFixed(1)} cm | ${r.truthCm.toFixed(1)} cm | ${r.errorCm >= 0 ? '+' : ''}${r.errorCm.toFixed(1)} cm (${r.errorPct >= 0 ? '+' : ''}${r.errorPct.toFixed(1)}%) |`);
  return lines.join('\n');
}
