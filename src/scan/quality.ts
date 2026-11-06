/** Live capture checks: is the frame good enough to measure? Each check says what to change. */
import { dist, mid, px } from './geometry.ts';
import { verticalExtent } from './mask.ts';
import { LM, type Observation } from './types.ts';

export type CheckId = 'person' | 'frame' | 'facing' | 'profile' | 'arms' | 'armsUp' | 'feet' | 'still' | 'level';
export type Check = { id: CheckId; label: string; ok: boolean; hint: string };
export type Pose = 'front' | 'profile' | 'turn';

const KEY = [LM.nose, LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle];

/** Tracks landmark motion over a short window. */
export class Stillness {
  private history: { t: number; pts: { x: number; y: number }[] }[] = [];
  constructor(private windowMs = 700) {}
  push(o: Observation) {
    this.history.push({ t: o.timestamp, pts: KEY.map(i => px(o.landmarks[i], o.width, o.height)) });
    while (this.history.length > 2 && o.timestamp - this.history[0].t > this.windowMs) this.history.shift();
  }
  /** Largest landmark displacement in the window, as a fraction of the given body length (px). */
  motion(bodyPx: number): number {
    if (this.history.length < 3 || this.history[this.history.length - 1].t - this.history[0].t < this.windowMs * 0.6) return Infinity;
    let worst = 0;
    for (let k = 0; k < KEY.length; k++) {
      const xs = this.history.map(h => h.pts[k].x), ys = this.history.map(h => h.pts[k].y);
      worst = Math.max(worst, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
    }
    return worst / bodyPx;
  }
  reset() { this.history = []; }
}

export function evaluate(o: Observation | null, pose: Pose, opts: { still?: Stillness; tiltDeg?: number | null; refShoulderSpan?: number } = {}): Check[] {
  const checks: Check[] = [];
  const add = (id: CheckId, label: string, ok: boolean, hint: string) => checks.push({ id, label, ok, hint });
  const person = !!o && KEY.every(i => (o.landmarks[i]?.visibility ?? 1) >= 0.5);
  add('person', 'Whole body detected', person, 'Step back until your whole body, head to feet, is on screen.');
  if (!o || !person) return checks;
  const P = (i: number) => px(o.landmarks[i], o.width, o.height);
  const hp = mid(P(LM.leftHip), P(LM.rightHip)), sh = mid(P(LM.leftShoulder), P(LM.rightShoulder));
  const T = hp.y - sh.y;
  const ext = verticalExtent(o.mask, { x: (hp.x + sh.x) / 2, y: (hp.y + sh.y) / 2 });
  const margin = o.height * 0.01;
  const framed = !!ext && ext.top > margin && ext.bottom < o.height - margin && ext.bottom - ext.top > o.height * 0.45;
  add('frame', 'Head and feet in frame', framed, ext && ext.bottom - ext.top <= o.height * 0.45 ? 'Come a little closer: fill most of the frame height.' : 'Leave a small gap above your head and below your feet.');
  const bodyPx = ext ? ext.bottom - ext.top : o.height;
  const shoulderSpan = dist(P(LM.leftShoulder), P(LM.rightShoulder));
  if (pose === 'front') {
    add('facing', 'Facing the camera', T > 0 && shoulderSpan / T > 0.45, 'Turn to face the camera squarely.');
    const wristsOut = [[LM.leftWrist, LM.leftHip], [LM.rightWrist, LM.rightHip]].every(([w, h]) => {
      const wr = P(w), hip = P(h);
      return Math.abs(wr.x - hp.x) > Math.abs(hip.x - hp.x) + 0.25 * T && wr.y > sh.y;
    });
    add('arms', 'Arms 30–45° out', wristsOut, 'Hold your arms out and down, away from your sides, so light shows between arm and torso.');
    const ankleSpan = dist(P(LM.leftAnkle), P(LM.rightAnkle)), hipSpan = dist(P(LM.leftHip), P(LM.rightHip));
    add('feet', 'Feet hip-width apart', ankleSpan > 0.9 * hipSpan, 'Move your feet apart to about hip width.');
  } else if (pose === 'profile') {
    const ref = opts.refShoulderSpan ?? T * 0.7;
    add('profile', 'Side-on to the camera', shoulderSpan < 0.3 * ref, 'Turn 90° so your side faces the camera.');
  }
  if (pose !== 'front') {
    const up = [LM.leftWrist, LM.rightWrist].every(w => P(w).y < sh.y - 0.3 * T);
    add('armsUp', 'Arms raised in a V', up, 'Raise both arms overhead in a V so they do not hide your torso.');
  }
  if (opts.still && pose !== 'turn') {
    opts.still.push(o);
    add('still', 'Holding still', opts.still.motion(bodyPx) < 0.012, 'Hold still for a moment.');
  }
  if (opts.tiltDeg !== undefined && opts.tiltDeg !== null) add('level', 'Phone upright', Math.abs(opts.tiltDeg) < 4, `Stand the phone upright (tilted ${opts.tiltDeg.toFixed(0)}°). Tilt distorts lengths.`);
  return checks;
}

export const allOk = (checks: readonly Check[]) => checks.every(c => c.ok);
