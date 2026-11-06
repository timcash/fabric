/**
 * Simulated phone camera: renders the CC0 MakeHuman mesh with three.js as the "video", posing and turning on cue,
 * and runs either the real MediaPipe pose model on each rendered frame or the exact oracle (true mask and joints).
 * A second, third-person view shows where the phone stands relative to the turning body.
 */
import * as THREE from 'three';
import type { Feed, Frame, Step } from '../scan/feeds.ts';
import type { PoseSource } from '../scan/pose-mediapipe.ts';
import { phoneCamera, type Camera } from './camera.ts';
import { bodyCenter, landmarks3d, loadMakeHuman, poseBody, type BodyModel, type PosedBody, type Vec3 } from './makehuman.ts';
import { oracleObservation } from './observe.ts';

export type Detector = 'mediapipe' | 'oracle';
export type SimOptions = { detector: Detector; pose?: PoseSource; turnStepDeg?: number; girthScale?: number; base?: string };

const SKIN = new THREE.Color('#c99a7c'), SUIT = new THREE.Color('#3b4a63');
const SKIN_BONES = /^(head|neck|jaw|eye|tongue|levator|oris|temporalis|risorius|special|orbicularis|wrist|finger|metacarpal|thumb|foot|toe)/;

export async function loadModel(base: string, girthScale = 1): Promise<BodyModel> {
  const root = `${base.replace(/\/$/, '')}/sim/makehuman/`;
  const [obj, skel, weights] = await Promise.all(['base.obj', 'default.mhskel', 'default_weights.mhw'].map(f => fetch(root + f).then(r => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.text(); })));
  return loadMakeHuman(obj, JSON.parse(skel), JSON.parse(weights), girthScale);
}

export class SimFeed implements Feed {
  readonly kind = 'sim';
  readonly mirror = false;
  readonly cam: Camera = phoneCamera({ distanceCm: 250, heightCm: 100 });
  readonly canvas = document.createElement('canvas');
  readonly inset = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer;
  private insetRenderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private insetCamera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
  private mesh: THREE.Mesh;
  private poses = new Map<number, { body: PosedBody; joints: Vec3[]; placed: Float32Array }>();
  private armDeg = -1;
  private yaw = 0;
  private turnFrames = 0;
  private turned = 0;
  private start = performance.now();

  private constructor(private model: BodyModel, private opts: SimOptions) {
    const { width, height } = this.cam;
    this.canvas.width = width; this.canvas.height = height;
    this.inset.width = 360; this.inset.height = 360;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.insetRenderer = new THREE.WebGLRenderer({ canvas: this.inset, antialias: true, alpha: true });
    this.insetRenderer.setPixelRatio(1);
    const vfov = (2 * Math.atan(height / 2 / this.cam.f) * 180) / Math.PI;
    this.camera = new THREE.PerspectiveCamera(vfov, width / height, 1, 5000);
    this.camera.position.set(...this.cam.position);
    this.scene.background = new THREE.Color('#d9d4cb');
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f70, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(120, 300, 260);
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: '#a39684', roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(1200, 600), new THREE.MeshStandardMaterial({ color: '#e7e2d8', roughness: 1 }));
    wall.position.set(0, 300, -180);
    this.scene.add(wall);
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(model.triangles, 1));
    const colors = new Float32Array(model.positions.length);
    model.skin.forEach((s, v) => {
      const top = s.bones[s.weights.indexOf(Math.max(...s.weights))] ?? '';
      (SKIN_BONES.test(top) ? SKIN : SUIT).toArray(colors, v * 3);
    });
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 }));
    this.scene.add(this.mesh);
    // Third-person view: the phone and its field of view (layer 1, invisible to the phone camera itself).
    const helper = new THREE.CameraHelper(this.camera);
    helper.layers.set(1);
    this.scene.add(helper);
    const phone = new THREE.Mesh(new THREE.BoxGeometry(8, 15, 1), new THREE.MeshStandardMaterial({ color: '#111' }));
    phone.position.set(...this.cam.position);
    phone.layers.set(1);
    this.scene.add(phone);
    this.insetCamera.layers.enable(1);
    this.setPose(15);
  }

  static async create(opts: SimOptions): Promise<SimFeed> {
    return new SimFeed(await loadModel(opts.base ?? import.meta.env.BASE_URL, opts.girthScale), opts);
  }

  get heightCm() { return this.model.heightCm; }
  /** The posed body (arms out) and camera, for scoring against mesh truth. */
  truth() { return { body: this.posed(90).body, cam: this.cam }; }
  /** Body surface placed at the origin (cm), for the 3D results view. */
  ghost() { const p = this.posed(90); return { positions: p.placed, triangles: this.model.triangles }; }

  private posed(armDeg: number) {
    const key = Math.round(armDeg);
    let p = this.poses.get(key);
    if (!p) {
      const body = poseBody(this.model, { armDeg: key });
      const c = bodyCenter(body), placed = new Float32Array(body.positions);
      for (let i = 0; i < placed.length; i += 3) { placed[i] -= c[0]; placed[i + 2] -= c[2]; }
      p = { body, joints: landmarks3d(body), placed };
      this.poses.set(key, p);
    }
    return p;
  }
  private setPose(armDeg: number) {
    if (Math.round(armDeg) === this.armDeg) return;
    this.armDeg = Math.round(armDeg);
    const p = this.posed(this.armDeg);
    this.mesh.geometry.setAttribute('position', new THREE.BufferAttribute(p.placed, 3));
    this.mesh.geometry.computeVertexNormals();
  }

  turnDone() { return this.turned >= 360; }

  async frame(step: Step, elapsed: number): Promise<Frame | null> {
    await new Promise(r => requestAnimationFrame(r));
    const ease = (t: number) => Math.min(1, Math.max(0, t));
    let sway = 0;
    if (step === 'front') {
      this.setPose(15 + 75 * ease((elapsed - 300) / 900)); // arms come up to the sides
      this.yaw = 0;
      sway = elapsed < 1600 ? Math.sin(elapsed / 120) * 3 : 0;
    } else if (step === 'profile') {
      this.setPose(90);
      this.yaw = 90 * ease(elapsed / 1000);
    } else {
      this.setPose(90);
      if (elapsed > 500) { const d = this.opts.turnStepDeg ?? 4; this.yaw += d; this.turned += d; this.turnFrames++; }
    }
    this.mesh.rotation.y = (this.yaw * Math.PI) / 180;
    this.mesh.position.x = this.opts.detector === 'oracle' ? 0 : sway;
    this.renderer.render(this.scene, this.camera);
    const a = (performance.now() - this.start) / 1000 * 0.35;
    this.insetCamera.position.set(Math.sin(a) * 520 + 200, 260, Math.cos(a) * 420 + 300);
    this.insetCamera.lookAt(0, 90, 60);
    this.insetRenderer.render(this.scene, this.insetCamera);
    const now = performance.now() - this.start;
    const obs = this.opts.detector === 'oracle'
      ? oracleObservation(this.posed(this.armDeg).body, this.cam, this.yaw, now, this.posed(this.armDeg).joints)
      : await this.opts.pose!.detect(this.canvas, now, 'VIDEO');
    return { obs, width: this.cam.width, height: this.cam.height, draw: (ctx, w, h) => ctx.drawImage(this.canvas, 0, 0, w, h) };
  }

  /** Renders the arms-out body at a given yaw as a PNG data URL (example "photos" for reports). */
  renderPhoto(yawDeg: number): string {
    this.setPose(90);
    this.mesh.rotation.y = (yawDeg * Math.PI) / 180;
    this.mesh.position.x = 0;
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  snapshot() {
    const c = document.createElement('canvas');
    c.width = this.canvas.width; c.height = this.canvas.height;
    c.getContext('2d')!.drawImage(this.canvas, 0, 0);
    return c;
  }
  tilt() { return 0; }
  stop() { /* keep the renderer: results reuse the model; it is released with the page */ }
}
