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
  stop(): void;
  /** Simulated feeds know when the body has turned a full circle. */
  turnDone?(): boolean;
}

export class Tilt {
  private beta: number | null = null;
  private handler = (e: DeviceOrientationEvent) => { if (e.beta !== null) this.beta = e.beta; };
  /** iOS asks for motion permission; this must run inside a user gesture. */
  static async request(): Promise<void> {
    const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (D?.requestPermission) { try { await D.requestPermission(); } catch { /* user declined; tilt stays unknown */ } }
  }
  start() { addEventListener('deviceorientation', this.handler); }
  stop() { removeEventListener('deviceorientation', this.handler); }
  /** Degrees away from upright portrait (beta 90°), or null when the device reports nothing. */
  value() { return this.beta === null ? null : this.beta - 90; }
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
    const tilt = new Tilt();
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
