/**
 * A Feed produces one Observation per animation frame plus a way to draw the matching image. The camera feed runs
 * MediaPipe on live video; the demo feed renders the synthetic body (posing and turning on cue), so the full
 * capture flow can be tried — and tested — without a camera or a person.
 */
import type { PoseSource } from './pose-mediapipe.ts';
import { defaultBody, renderBody, type ArmPose } from './synthetic.ts';
import type { Observation } from './types.ts';

export type Step = 'front' | 'profile' | 'turn';
export type Frame = { obs: Observation | null; width: number; height: number; draw(ctx: CanvasRenderingContext2D, w: number, h: number): void };

export interface Feed {
  readonly kind: 'camera' | 'demo';
  readonly mirror: boolean;
  frame(step: Step, stepElapsedMs: number): Promise<Frame | null>;
  /** Copy of the last frame's image at full resolution. */
  snapshot(): HTMLCanvasElement;
  tilt(): number | null;
  stop(): void;
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

export class DemoFeed implements Feed {
  readonly kind = 'demo';
  readonly mirror = false;
  private last: HTMLCanvasElement | null = null;
  private start = performance.now();
  /** turnMs: duration of one full synthetic turn. */
  constructor(private turnMs = 7000, private size = { width: 480, height: 854 }) {}

  async frame(step: Step, elapsed: number): Promise<Frame> {
    await new Promise(r => setTimeout(r, 16));
    let yawDeg = 0, pose: ArmPose = 'a-pose', sway = 0;
    if (step === 'front') { pose = elapsed < 900 ? 'down' : 'a-pose'; sway = elapsed < 1500 ? Math.sin(elapsed / 90) * 6 : 0; }
    if (step === 'profile') { pose = 'v-up'; yawDeg = elapsed < 700 ? 60 : 90; sway = elapsed < 1400 ? Math.sin(elapsed / 90) * 5 : 0; }
    if (step === 'turn') { pose = elapsed < 600 ? 'a-pose' : 'v-up'; yawDeg = elapsed < 900 ? 0 : (360 * (elapsed - 900)) / this.turnMs; }
    const obs = renderBody(defaultBody, { ...this.size, yawDeg, pose, centerPx: this.size.width / 2 + sway, timestamp: performance.now() - this.start });
    const image = paintMask(obs);
    this.last = image;
    return { obs, width: obs.width, height: obs.height, draw: (ctx, w, h) => ctx.drawImage(image, 0, 0, w, h) };
  }
  snapshot() {
    const c = document.createElement('canvas');
    c.width = this.last?.width ?? 1; c.height = this.last?.height ?? 1;
    if (this.last) c.getContext('2d')!.drawImage(this.last, 0, 0);
    return c;
  }
  tilt() { return 0.4; }
  stop() {}
}
