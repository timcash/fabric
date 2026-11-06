/**
 * A Feed produces one Observation per animation frame plus a way to draw the matching image. The camera feed runs
 * MediaPipe on live video; the simulation feed (src/sim/sim-feed.ts) renders a 3D body mesh as the video, so the
 * full capture flow can be tried — and tested against mesh ground truth — without a camera or a person.
 */
import type { PoseSource } from './pose-mediapipe.ts';
import type { Observation } from './types.ts';

export type Step = 'front' | 'profile' | 'turn';
export type Frame = { obs: Observation | null; width: number; height: number; draw(ctx: CanvasRenderingContext2D, w: number, h: number): void };

export interface Feed {
  readonly kind: 'camera' | 'sim';
  readonly mirror: boolean;
  frame(step: Step, stepElapsedMs: number): Promise<Frame | null>;
  /** Copy of the last frame's image at full resolution. */
  snapshot(): HTMLCanvasElement;
  tilt(): number | null;
  /** World "up" in camera coordinates from the motion sensor (for leveling a handheld frame), if known. */
  gravityUp?(): [number, number, number] | null;
  stop(): void;
  /** Simulated feeds know when the body has turned a full circle. */
  turnDone?(): boolean;
}

/**
 * The phone's gravity reading. accelerationIncludingGravity at rest points up; it is low-pass filtered against
 * hand motion. Browsers disagree on the sign convention (iOS reports it negated), so the sign is fixed by assuming
 * the phone is held roughly upright in portrait (device y is the larger component and points up).
 * Device axes are x right, y up, z out of the screen, which are the back camera's axes.
 */
export class Tilt {
  private g: [number, number, number] | null = null;
  private handler = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (a?.x == null || a.y == null || a.z == null) return;
    const s = a.y < 0 ? -1 : 1, v: [number, number, number] = [a.x * s, a.y * s, a.z * s];
    this.g = this.g ? [this.g[0] * 0.8 + v[0] * 0.2, this.g[1] * 0.8 + v[1] * 0.2, this.g[2] * 0.8 + v[2] * 0.2] : v;
  };
  /** iOS asks for motion permission; this must run inside a user gesture. */
  static async request(): Promise<void> {
    const D = window.DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (D?.requestPermission) { try { await D.requestPermission(); } catch { /* user declined; tilt stays unknown */ } }
  }
  constructor(private selfie = false) {}
  start() { addEventListener('devicemotion', this.handler); }
  stop() { removeEventListener('devicemotion', this.handler); }
  /** World up in camera coordinates (the selfie camera faces the other way: x and z flip). */
  up(): [number, number, number] | null {
    if (!this.g) return null;
    const l = Math.hypot(...this.g) || 1, [x, y, z] = [this.g[0] / l, this.g[1] / l, this.g[2] / l];
    return this.selfie ? [-x, y, -z] : [x, y, z];
  }
  /** Degrees away from upright, or null when the device reports nothing. */
  value() { const u = this.up(); return u ? (Math.acos(Math.min(1, u[1])) * 180) / Math.PI : null; }
}

export class CameraFeed implements Feed {
  readonly kind = 'camera';
  private canvas = document.createElement('canvas');
  private constructor(readonly video: HTMLVideoElement, private stream: MediaStream, private pose: PoseSource, readonly mirror: boolean, private tiltSensor: Tilt) {}

  static async open(video: HTMLVideoElement, pose: PoseSource, facing: 'environment' | 'user'): Promise<CameraFeed> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 1080 }, height: { ideal: 1920 }, frameRate: { ideal: 30 } },
    });
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    const tilt = new Tilt(facing === 'user');
    tilt.start();
    return new CameraFeed(video, stream, pose, facing === 'user', tilt);
  }

  private lastTime = -1;
  async frame(): Promise<Frame | null> {
    // Detection is synchronous; waiting for the next display frame keeps the page responsive and paced.
    await new Promise(r => requestAnimationFrame(r));
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth || v.currentTime === this.lastTime) return null;
    this.lastTime = v.currentTime;
    const obs = await this.pose.detect(v, performance.now(), 'VIDEO');
    return { obs, width: v.videoWidth, height: v.videoHeight, draw: (ctx, w, h) => ctx.drawImage(v, 0, 0, w, h) };
  }
  snapshot() {
    this.canvas.width = this.video.videoWidth; this.canvas.height = this.video.videoHeight;
    this.canvas.getContext('2d')!.drawImage(this.video, 0, 0);
    const copy = document.createElement('canvas');
    copy.width = this.canvas.width; copy.height = this.canvas.height;
    copy.getContext('2d')!.drawImage(this.canvas, 0, 0);
    return copy;
  }
  tilt() { return this.tiltSensor.value(); }
  gravityUp() { return this.tiltSensor.up(); }
  stop() { this.stream.getTracks().forEach(t => t.stop()); this.video.srcObject = null; this.tiltSensor.stop(); }
}

/** Paints a mask as a soft-lit figure; used for the demo feed and for result thumbnails. */
export function paintMask(o: Observation, color: [number, number, number] = [205, 214, 228]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = o.width; c.height = o.height;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, o.height);
  g.addColorStop(0, '#1a2230'); g.addColorStop(1, '#0b0f16');
  ctx.fillStyle = g; ctx.fillRect(0, 0, o.width, o.height);
  const img = ctx.getImageData(0, 0, o.width, o.height), d = img.data, m = o.mask.data;
  for (let i = 0; i < m.length; i++) {
    const a = m[i];
    if (a <= 0) continue;
    const k = i * 4;
    d[k] = d[k] * (1 - a) + color[0] * a; d[k + 1] = d[k + 1] * (1 - a) + color[1] * a; d[k + 2] = d[k + 2] * (1 - a) + color[2] * a;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = '#ffffff10';
  ctx.fillRect(0, o.height * 0.93, o.width, o.height * 0.07);
  return c;
}
