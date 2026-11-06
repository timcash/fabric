/**
 * Simulated phone camera. Renders the CC0 MakeHuman mesh with three.js as the "video" and runs either the real
 * MediaPipe pose model on each rendered frame or the exact oracle (true mask and joints).
 *
 * Scenarios:
 *  - 'orbit' (default): the subject stands still in a furnished room while a helper (a second MakeHuman body,
 *    arms forward holding the phone) walks a circle around them. The handheld phone wanders in distance, height,
 *    aim, pitch and roll, and reports a noisy gravity vector like a real accelerometer.
 *  - 'turn': the phone stands still and the subject turns in place in front of a plain wall.
 * An outside view shows the phone (and helper) relative to the subject.
 */
import * as THREE from 'three';
import type { Feed, Frame, Step } from '../scan/feeds.ts';
import type { PoseSource } from '../scan/pose-mediapipe.ts';
import { apply3, orbitCamera, phoneCamera, rotY, type Camera } from './camera.ts';
import { bodyCenter, landmarks3d, loadMakeHuman, poseBody, type BodyModel, type PosedBody, type Vec3 } from './makehuman.ts';
import { oracleObservation } from './observe.ts';
import { frontPose, helperPose, leveled, sensedUp } from './path.ts';
import { buildRoom } from './room.ts';

export type Detector = 'mediapipe' | 'oracle';
export type Scenario = 'orbit' | 'turn';
export type SimOptions = { detector: Detector; scenario?: Scenario; pose?: PoseSource; turnStepDeg?: number; girthScale?: number; base?: string };

const SKIN = new THREE.Color('#c99a7c'), SUIT = new THREE.Color('#3b4a63'), SHIRT = new THREE.Color('#9c3b3b'), JEANS = new THREE.Color('#2f3b52');
const SKIN_BONES = /^(head|neck|jaw|eye|tongue|levator|oris|temporalis|risorius|special|orbicularis|wrist|finger|metacarpal|thumb|foot|toe)/;
const LEG_BONES = /^(pelvis|upperleg|lowerleg|root)/;

export async function loadModel(base: string, girthScale = 1): Promise<BodyModel> {
  const root = `${base.replace(/\/$/, '')}/sim/makehuman/`;
  const [obj, skel, weights] = await Promise.all(['base.obj', 'default.mhskel', 'default_weights.mhw'].map(f => fetch(root + f).then(r => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.text(); })));
  return loadMakeHuman(obj, JSON.parse(skel), JSON.parse(weights), girthScale);
}

function bodyMesh(model: BodyModel, positions: Float32Array, palette: (bone: string) => THREE.Color): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(model.triangles, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const colors = new Float32Array(model.positions.length);
  model.skin.forEach((s, v) => palette(s.bones[s.weights.indexOf(Math.max(...s.weights))] ?? '').toArray(colors, v * 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 }));
}

export class SimFeed implements Feed {
  readonly kind = 'sim';
  readonly mirror = false;
  readonly scenario: Scenario;
  cam: Camera;
  readonly canvas = document.createElement('canvas');
  readonly inset = document.createElement('canvas');
  /** True camera (leveled, for scoring) and position per frame timestamp. */
  readonly cameras = new Map<number, { leveled: Camera; position: Vec3 }>();
  private renderer: THREE.WebGLRenderer;
  private insetRenderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private insetCamera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
  private mesh: THREE.Mesh;
  private helper: THREE.Group | null = null;
  private phone: THREE.Mesh;
  private poses = new Map<number, { body: PosedBody; joints: Vec3[]; placed: Float32Array }>();
  private armDeg = -1;
  private yaw = 0;
  private turned = 0;
  private up: Vec3 = [0, 1, 0];
  private start = performance.now();

  private constructor(private model: BodyModel, private opts: SimOptions) {
    this.scenario = opts.scenario ?? 'orbit';
    this.cam = this.scenario === 'orbit' ? orbitCamera(frontPose(0)) : phoneCamera({ distanceCm: 250, heightCm: 100 });
    const { width, height } = this.cam;
    this.canvas.width = width; this.canvas.height = height;
    this.inset.width = 400; this.inset.height = 400;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.insetRenderer = new THREE.WebGLRenderer({ canvas: this.inset, antialias: true, alpha: true });
    this.insetRenderer.setPixelRatio(1);
    const vfov = (2 * Math.atan(height / 2 / this.cam.f) * 180) / Math.PI;
    this.camera = new THREE.PerspectiveCamera(vfov, width / height, 1, 5000);
    this.camera.rotation.order = 'YXZ';
    this.camera.layers.enable(2);
    if (this.scenario === 'orbit') this.scene.add(buildRoom());
    else {
      this.scene.background = new THREE.Color('#d9d4cb');
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f70, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(120, 300, 260);
      this.scene.add(sun);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: '#a39684', roughness: 0.95 }));
      floor.rotation.x = -Math.PI / 2;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(1200, 600), new THREE.MeshStandardMaterial({ color: '#e7e2d8', roughness: 1 }));
      wall.position.set(0, 300, -180);
      this.scene.add(floor, wall);
    }
    this.insetRenderer.setClearColor(0x0b0f16, 1);
    this.mesh = bodyMesh(model, new Float32Array(model.positions.length), b => (SKIN_BONES.test(b) ? SKIN : SUIT));
    this.scene.add(this.mesh);
    // The phone (and, when walking, the helper holding it): layer 1, seen only from outside.
    this.phone = new THREE.Mesh(new THREE.BoxGeometry(8, 15, 1), new THREE.MeshStandardMaterial({ color: '#111', emissive: '#223', emissiveIntensity: 1 }));
    this.phone.layers.set(1);
    this.scene.add(this.phone);
    const frustum = new THREE.CameraHelper(this.camera);
    frustum.layers.set(1);
    this.scene.add(frustum);
    if (this.scenario === 'orbit') {
      const held = poseBody(model, { armDeg: 75, plane: 'sagittal' });
      const c = bodyCenter(held), pos = new Float32Array(held.positions);
      for (let i = 0; i < pos.length; i += 3) { pos[i] -= c[0]; pos[i + 2] -= c[2]; }
      const helperMesh = bodyMesh(model, pos, b => (SKIN_BONES.test(b) ? SKIN : LEG_BONES.test(b) ? JEANS : SHIRT));
      helperMesh.traverse(o => o.layers.set(1));
      this.helper = new THREE.Group();
      this.helper.add(helperMesh);
      this.scene.add(this.helper);
    }
    this.insetCamera.layers.enable(1);
    this.setPose(15);
  }

  static async create(opts: SimOptions): Promise<SimFeed> {
    return new SimFeed(await loadModel(opts.base ?? import.meta.env.BASE_URL, opts.girthScale), opts);
  }

  get heightCm() { return this.model.heightCm; }
  /** The posed body (arms out) and the leveled front camera (the frame at `timestamp`), for scoring. */
  truth(timestamp?: number) {
    const frame = timestamp !== undefined ? this.cameras.get(timestamp) : undefined;
    return { body: this.posed(90).body, cam: frame?.leveled ?? (this.scenario === 'orbit' ? leveled(frontPose(0)) : this.cam) };
  }
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
  private placeCamera(cam: Camera) {
    this.cam = cam;
    this.camera.position.set(...cam.position);
    const r = cam.rotation;
    if (r) this.camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1));
    else this.camera.quaternion.identity();
    this.camera.updateMatrixWorld();
    this.phone.position.set(...cam.position);
    this.phone.quaternion.copy(this.camera.quaternion);
    if (this.helper) {
      // The helper stands behind the phone, facing the subject, holding it out in front.
      const phi = Math.atan2(cam.position[0], cam.position[2]);
      this.helper.position.set(cam.position[0] + Math.sin(phi) * 48, 0, cam.position[2] + Math.cos(phi) * 48);
      this.helper.rotation.y = phi + Math.PI;
    }
  }

  turnDone() { return this.turned >= 360; }
  /** World "up" in camera coordinates, as the phone's accelerometer would report it. */
  gravityUp(): Vec3 { return this.up; }

  async frame(step: Step, elapsed: number): Promise<Frame | null> {
    await new Promise(r => requestAnimationFrame(r));
    const ease = (t: number) => Math.min(1, Math.max(0, t));
    const d = this.opts.turnStepDeg ?? 4;
    if (step === 'front') this.setPose(15 + 75 * ease((elapsed - 300) / 900)); // arms come up to the sides
    else this.setPose(90);
    if (this.scenario === 'orbit') {
      if (step !== 'front' && elapsed > 500) this.turned += d;
      const pose = step === 'front' ? frontPose(elapsed / 1000) : helperPose(Math.min(1, this.turned / 360));
      this.placeCamera(orbitCamera(pose));
      this.yaw = 0;
      this.up = sensedUp(this.cam, this.turned + elapsed / 1000);
    } else {
      this.placeCamera(phoneCamera({ distanceCm: 250, heightCm: 100 }));
      if (step === 'front') this.yaw = 0;
      else if (step === 'profile') this.yaw = 90 * ease(elapsed / 1000);
      else if (elapsed > 500) { this.yaw += d; this.turned += d; }
      this.up = [0, 1, 0];
    }
    const sway = step === 'front' && elapsed < 1600 && this.opts.detector !== 'oracle' ? Math.sin(elapsed / 120) * 3 : 0;
    this.mesh.rotation.y = (this.yaw * Math.PI) / 180;
    this.mesh.position.x = sway;
    this.renderer.render(this.scene, this.camera);
    this.renderInset();
    const now = Math.round(performance.now() - this.start);
    // Positions are kept in the subject's frame: when the subject turns, the still phone circles them in that frame.
    const position: Vec3 = this.scenario === 'orbit' ? this.cam.position : apply3(rotY((-this.yaw * Math.PI) / 180), this.cam.position);
    this.cameras.set(now, { leveled: this.scenario === 'orbit' ? orbitCamera({ ...(step === 'front' ? frontPose(elapsed / 1000) : helperPose(Math.min(1, this.turned / 360))), pitchDeg: 0, rollDeg: 0 }) : this.cam, position });
    const p = this.posed(this.armDeg);
    const obs = this.opts.detector === 'oracle' ? oracleObservation(p.body, this.cam, this.yaw, now, p.joints) : await this.opts.pose!.detect(this.canvas, now, 'VIDEO');
    if (obs) obs.timestamp = now;
    return { obs, width: this.cam.width, height: this.cam.height, draw: (ctx, w, h) => ctx.drawImage(this.canvas, 0, 0, w, h) };
  }

  private renderInset() {
    const a = ((performance.now() - this.start) / 1000) * 0.15;
    // Cut-away view from above the walls (the ceiling is hidden from it), slowly circling.
    if (this.scenario === 'orbit') this.insetCamera.position.set(Math.sin(a + 0.6) * 520, 640, Math.cos(a + 0.6) * 520);
    else this.insetCamera.position.set(Math.sin(a) * 520 + 200, 260, Math.cos(a) * 420 + 300);
    this.insetCamera.lookAt(0, 70, 0);
    this.insetRenderer.render(this.scene, this.insetCamera);
  }

  /** Renders the arms-out body as a PNG data URL from the walking path (fraction t) or the turn (yaw). */
  renderPhoto(angleDeg: number): string {
    this.setPose(90);
    if (this.scenario === 'orbit') { this.placeCamera(orbitCamera(helperPose(angleDeg / 360))); this.mesh.rotation.y = 0; }
    else this.mesh.rotation.y = (angleDeg * Math.PI) / 180;
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
