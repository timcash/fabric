/**
 * Live AR callouts: each measurement level drawn on the body in the current frame, with its running value.
 * Levels (cm above the floor, from the front view) are placed through this frame's own shoulder, hip, knee and
 * ankle landmarks, so the lines stay on the body while the camera moves or the subject turns.
 */
import { lerp } from './geometry.ts';
import { runAt } from './mask.ts';
import type { FrontAnalysis, Site } from './measure.ts';
import { formatLength, type Report, type Units } from './report.ts';
import { LM, type Observation } from './types.ts';

export type Callout = { id: Site; y: number; x0: number; x1: number; text: string; locked: boolean };

const SITES: { id: Site; name: string; leg?: boolean }[] = [
  { id: 'neck', name: 'NECK' }, { id: 'chest', name: 'CHEST' }, { id: 'waist', name: 'WAIST' }, { id: 'hip', name: 'HIP' },
  { id: 'thigh', name: 'THIGH', leg: true }, { id: 'knee', name: 'KNEE', leg: true }, { id: 'calf', name: 'CALF', leg: true }, { id: 'ankle', name: 'ANKLE', leg: true },
];

/** Height above the floor (cm) → image row in this frame, piecewise-linear through the joints. */
export function levelMapper(o: Observation, front: FrontAnalysis): (h: number) => number {
  const y = (a: number, b: number) => ((o.landmarks[a].y + o.landmarks[b].y) / 2) * o.height;
  const J = front.ref.legJointsCm;
  const pts: [number, number][] = [[front.ref.shoulderCm, y(LM.leftShoulder, LM.rightShoulder)], [J.hip, y(LM.leftHip, LM.rightHip)], [J.knee, y(LM.leftKnee, LM.rightKnee)], [J.ankle, y(LM.leftAnkle, LM.rightAnkle)]];
  return h => {
    let i = 0;
    while (i < pts.length - 2 && h < pts[i + 1][0]) i++;
    const [h0, y0] = pts[i], [h1, y1] = pts[i + 1];
    return lerp(y0, y1, (h0 - h) / (h0 - h1 || 1));
  };
}

export function callouts(o: Observation, front: FrontAnalysis, report: Report | null, units: Units): Callout[] {
  const P = (i: number) => ({ x: o.landmarks[i].x * o.width, y: o.landmarks[i].y * o.height });
  const toRow = levelMapper(o, front);
  const sh = { x: (P(LM.leftShoulder).x + P(LM.rightShoulder).x) / 2, y: (P(LM.leftShoulder).y + P(LM.rightShoulder).y) / 2 };
  const hp = { x: (P(LM.leftHip).x + P(LM.rightHip).x) / 2, y: (P(LM.leftHip).y + P(LM.rightHip).y) / 2 };
  // The leg on the image's right, so its tag has room beside it.
  const legs = [[LM.leftHip, LM.leftKnee, LM.leftAnkle], [LM.rightHip, LM.rightKnee, LM.rightAnkle]].map(c => c.map(P));
  const leg = legs[0][1].x > legs[1][1].x ? legs[0] : legs[1];
  const legX = (y: number) => (y <= leg[1].y ? lerp(leg[0].x, leg[1].x, (y - leg[0].y) / (leg[1].y - leg[0].y || 1)) : lerp(leg[1].x, leg[2].x, (y - leg[1].y) / (leg[2].y - leg[1].y || 1)));
  const out: Callout[] = [];
  for (const s of SITES) {
    const level = front.sites[s.id]?.heightCm;
    if (level === undefined) continue;
    const y = toRow(level);
    if (!(y > 0 && y < o.height)) continue;
    const x = s.leg ? legX(y) : lerp(sh.x, hp.x, Math.min(1, Math.max(0, (y - sh.y) / (hp.y - sh.y || 1))));
    const run = runAt(o.mask, y, x, 6);
    if (!run) continue;
    const m = report?.measurements.find(r => r.id === s.id);
    out.push({ id: s.id, y, x0: run.x0, x1: run.x1, text: `${s.name} ${m ? formatLength(m.cm, units).replace(' ', '') : '···'}`, locked: m?.method === 'turntable' || m?.method === 'two-view' });
  }
  return out;
}

export type Visible = { x: number; y: number; w: number; h: number };

/**
 * Draws callouts in canvas coordinates, in black and white: a line across the body and a value tag beside it.
 * Locked values (measured from all angles) get a solid white tag. `mirror` flips positions (selfie view) without
 * mirroring the text; `visible` is the part of the canvas on screen, so tags stay readable and in view.
 */
export function drawCallouts(ctx: CanvasRenderingContext2D, items: readonly Callout[], mirror: boolean, visible?: Visible) {
  const W = ctx.canvas.width, vis = visible ?? { x: 0, y: 0, w: W, h: ctx.canvas.height }, k = vis.w / 360;
  ctx.save();
  ctx.font = `600 ${Math.round(13 * k)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  ctx.textBaseline = 'middle';
  const h = 20 * k;
  let lastY = -Infinity;
  for (const c of [...items].sort((a, b) => a.y - b.y)) {
    const [x0, x1] = mirror ? [W - c.x1, W - c.x0] : [c.x0, c.x1];
    const ly = Math.max(c.y, lastY + h + 3 * k); // stack tags that would overlap; the leader bends to reach them
    lastY = ly;
    const w = ctx.measureText(c.text).width + 10 * k;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(x0, c.y); ctx.lineTo(x1, c.y);
    for (const x of [x0, x1]) { ctx.moveTo(x, c.y - 5 * k); ctx.lineTo(x, c.y + 5 * k); }
    const lx = Math.min(vis.x + vis.w - 6 * k - w, x1 + 16 * k);
    ctx.moveTo(x1, c.y); ctx.lineTo(lx - 5 * k, ly); ctx.lineTo(lx, ly);
    ctx.stroke();
    ctx.fillStyle = c.locked ? '#fff' : '#000';
    ctx.fillRect(lx, ly - h / 2, w, h);
    ctx.strokeRect(lx, ly - h / 2, w, h);
    ctx.fillStyle = c.locked ? '#000' : '#fff';
    ctx.fillText(c.text, lx + 5 * k, ly + 1);
  }
  ctx.restore();
}
