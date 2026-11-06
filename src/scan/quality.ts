/** Live capture checks: is the frame good enough to measure? Each check says what to change. */
import { dist, mid, px } from './geometry.ts';
import { verticalExtent } from './mask.ts';
import { LM, type Observation } from './types.ts';

export type CheckId = 'person' | 'frame' | 'facing' | 'profile' | 'arms' | 'feet' | 'still' | 'level';
export type Check = { id: CheckId; label: string; ok: boolean; hint: string };
export type Pose = 'front' | 'profile' | 'turn';

const KEY = [LM.nose, LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle];

/** Tracks landmark motion over a short window. */
export class Stillness {
  private history: { t: number; pts: { x: number; y: number }[] }[] = [];
  private windowMs: number;
  constructor(windowMs = 700) { this.windowMs = windowMs; }
  push(o: Observation) {
    this.history.push({ t: o.timestamp, pts: KEY.map(i => px(o.landmarks[i], o.width, o.height)) });
    // Keep the window, but never fewer than three frames, so slow devices (or slow detection) can still pass.
    while (this.history.length > 3 && o.timestamp - this.history[0].t > this.windowMs) this.history.shift();
  }
  /** Largest landmark displacement over the window (at least three frames), as a fraction of body length (px). */
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
    const reach = [[LM.leftWrist, LM.leftShoulder], [LM.rightWrist, LM.rightShoulder]].every(([w, s]) => Math.abs(P(w).x - P(s).x) > 0.6 * T);
    add('arms', ARMS_LABEL, reach && armsOut(o, T), ARMS_HINT);
    const ankleSpan = dist(P(LM.leftAnkle), P(LM.rightAnkle)), hipSpan = dist(P(LM.leftHip), P(LM.rightHip));
    add('feet', 'Feet hip-width apart', ankleSpan > 0.9 * hipSpan, 'Move your feet apart to about hip width.');
  } else if (pose === 'profile') {
    const ref = opts.refShoulderSpan ?? T * 0.7;
    add('profile', 'Side-on to the camera', shoulderSpan < 0.3 * ref, 'Turn 90° so your side faces the camera.');
  }
  if (pose !== 'front') add('arms', ARMS_LABEL, armsOut(o, T), ARMS_HINT);
  if (opts.still && pose !== 'turn') {
    opts.still.push(o);
    add('still', 'Holding still', opts.still.motion(bodyPx) < 0.012, 'Hold still for a moment.');
  }
  if (opts.tiltDeg !== undefined && opts.tiltDeg !== null) add('level', 'Phone upright', Math.abs(opts.tiltDeg) < 4, `Stand the phone upright (tilted ${opts.tiltDeg.toFixed(0)}°). Tilt distorts lengths.`);
  return checks;
}

export const ARMS_LABEL = 'Arms straight out to the sides';
export const ARMS_HINT = 'Hold both arms straight out to the sides at shoulder height (a T), so they never hide your torso.';

/**
 * Arms held out at about shoulder height: elbows and wrists between a little above the shoulders and well above
 * the chest. Uses image heights only, so it also holds when the turn points the arms at the camera.
 */
export function armsOut(o: Observation, T: number): boolean {
  const P = (i: number) => px(o.landmarks[i], o.width, o.height);
  const sh = mid(P(LM.leftShoulder), P(LM.rightShoulder));
  return [LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist].every(i => { const y = P(i).y; return y > sh.y - 0.45 * T && y < sh.y + 0.3 * T; });
}

export const allOk = (checks: readonly Check[]) => checks.every(c => c.ok);
