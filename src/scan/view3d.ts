/** A measured-body preview: every girth drawn as its cross-section at true height, lofted into a simple hull. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FrontAnalysis } from './measure.ts';
import type { Measurement, Report } from './report.ts';

type Ring = { y: number; x: number; a: number; b: number; color: number; axis?: THREE.Vector3 };
const COLOR: Record<string, number> = { neck: 0xc9a7ff, chest: 0x66acff, waist: 0x50dc96, hip: 0xffb35c, thigh: 0xff7a8a, knee: 0xffd166, calf: 0x7fe0ff, ankle: 0xd4d4d4, bicep: 0xf78fff, forearm: 0xb9f27c, wrist: 0xffe08a };

function ringPoints(r: Ring, n = 64): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = r.axis ? new THREE.Quaternion().setFromUnitVectors(up, r.axis.clone().normalize()) : null;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const p = new THREE.Vector3(r.a * Math.cos(t), 0, r.b * Math.sin(t));
    if (q) p.applyQuaternion(q);
    pts.push(p.add(new THREE.Vector3(r.x, r.y, 0)));
  }
  return pts;
}

function loft(rings: Ring[], material: THREE.Material): THREE.Mesh {
  const n = 64, pos: number[] = [], idx: number[] = [];
  rings.forEach(r => ringPoints(r, n).forEach(p => pos.push(p.x, p.y, p.z)));
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) {
    const a = k * n + i, b = k * n + ((i + 1) % n), c = a + n, d = b + n;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

export function showBody(container: HTMLElement, report: Report, front: FrontAnalysis): () => void {
  const W = container.clientWidth || 320, H = container.clientHeight || 420;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { container.textContent = '3D preview unavailable on this device.'; return () => {}; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H);
  container.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.01, 20);
  const heightM = front.heightCm / 100;
  camera.position.set(1.6, heightM * 0.65, 2.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, heightM * 0.5, 0);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x101820, 2.2));
  const grid = new THREE.GridHelper(2, 20, 0x3a4a60, 0x1c2633);
  scene.add(grid);

  const by = new Map<string, Measurement>(report.measurements.map(m => [m.id, m]));
  const s = front.scale.cmPerPx / 100;
  const bodyX = (front.sites.hip?.chords[0] ? (front.sites.hip.chords[0].a.x + front.sites.hip.chords[0].b.x) / 2 : 0);
  const ring = (id: string, x = 0, axis?: THREE.Vector3): Ring | null => {
    const m = by.get(id);
    if (!m || m.levelCm === undefined || !m.widthCm) return null;
    const depth = m.depthCm ?? (m.method === 'front-estimate' ? m.widthCm * 0.72 : m.widthCm);
    return { y: m.levelCm / 100, x, a: m.widthCm / 200, b: depth / 200, color: COLOR[id] ?? 0xffffff, axis };
  };
  const surface = new THREE.MeshStandardMaterial({ color: 0x9fb4d0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, roughness: 0.8 });
  const torso = ['hip', 'waist', 'chest', 'neck'].map(id => ring(id)).filter((r): r is Ring => !!r);
  const all: Ring[] = [...torso];
  if (torso.length > 1) scene.add(loft(torso, surface));
  for (const side of [0, 1]) {
    const legRings = ['thigh', 'knee', 'calf', 'ankle'].map(id => {
      const c = front.sites[id as 'thigh']?.chords[side] ?? front.sites[id as 'thigh']?.chords[0];
      return c ? ring(id, ((c.a.x + c.b.x) / 2 - bodyX) * s) : null;
    }).filter((r): r is Ring => !!r);
    if (legRings.length > 1) scene.add(loft(legRings, surface));
    all.push(...legRings);
    for (const id of ['bicep', 'forearm', 'wrist']) {
      const c = front.sites[id as 'bicep']?.chords[side];
      if (!c) continue;
      const axis = new THREE.Vector3(-(c.b.y - c.a.y), -(c.b.x - c.a.x), 0); // chord ⟂ arm axis (image y flips)
      const r = ring(id, ((c.a.x + c.b.x) / 2 - bodyX) * s, axis);
      if (r) { r.y = (front.scale.floorY - (c.a.y + c.b.y) / 2) * s; all.push(r); }
    }
  }
  for (const r of all) {
    const g = new THREE.BufferGeometry().setFromPoints(ringPoints(r));
    scene.add(new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: r.color })));
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), surface);
  head.scale.set(0.08, 0.11, 0.1);
  head.position.set(0, heightM - 0.11, 0);
  scene.add(head);
  const pole = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.45, 0, 0), new THREE.Vector3(-0.45, heightM, 0)]);
  scene.add(new THREE.Line(pole, new THREE.LineDashedMaterial({ color: 0x66acff, dashSize: 0.04, gapSize: 0.03 })).computeLineDistances());

  let frame = 0;
  const loop = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(loop); };
  loop();
  container.dataset.rendered = 'true';
  return () => { cancelAnimationFrame(frame); controls.dispose(); renderer.dispose(); };
}
