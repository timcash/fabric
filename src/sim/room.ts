/**
 * A furnished living room (7.6 × 7.6 m, 2.6 m ceiling; furniture kept clear of the helper's ~2.8 m circle) built from primitives, so the segmentation model has to find the
 * person against real clutter. The ceiling is on layer 2: the phone camera sees it, the outside view does not.
 */
import * as THREE from 'three';

function planks(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 16; i++) {
    const l = 46 + ((i * 37) % 11);
    g.fillStyle = `hsl(28 38% ${l}%)`;
    g.fillRect(0, i * 32, 512, 32);
    g.fillStyle = '#00000030';
    g.fillRect(0, i * 32, 512, 2);
    g.fillRect(((i * 173) % 512), i * 32, 2, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const box = (w: number, h: number, d: number, color: string, x: number, y: number, z: number, rough = 0.85) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: rough }));
  m.position.set(x, y + h / 2, z);
  return m;
};

export function buildRoom(): THREE.Group {
  const room = new THREE.Group();
  const S = 760, H = 260, half = S / 2;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ map: planks(), roughness: 0.8 }));
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);
  const wallMat = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, side: THREE.DoubleSide });
  const walls: [number, number, number, number, string][] = [[0, H / 2, -half, 0, '#e6dfd3'], [0, H / 2, half, Math.PI, '#e2ddd4'], [-half, H / 2, 0, Math.PI / 2, '#d9cfbf'], [half, H / 2, 0, -Math.PI / 2, '#e6dfd3']];
  for (const [x, y, z, ry, c] of walls) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(S, H), wallMat(c));
    w.position.set(x, y, z); w.rotation.y = ry;
    room.add(w);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(S, 10), wallMat('#f4f1ea'));
    base.position.set(x * 0.998, 5, z * 0.998); base.rotation.y = ry;
    room.add(base);
  }
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(S, S), wallMat('#f3f1ec'));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = H;
  ceiling.layers.set(2);
  room.add(ceiling);
  // Back wall: window with daylight and a frame.
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(160, 120), new THREE.MeshStandardMaterial({ color: '#bcd8f0', emissive: '#9cc4e8', emissiveIntensity: 0.7 }));
  glass.position.set(-90, 150, -half + 1);
  room.add(glass, box(170, 6, 8, '#f6f3ee', -90, 87, -half + 3), box(170, 6, 8, '#f6f3ee', -90, 207, -half + 3), box(4, 120, 6, '#f6f3ee', -90, 90, -half + 3));
  // Door on the left wall.
  const door = box(4, 210, 90, '#8a6a4a', -half + 2, 0, 150);
  room.add(door, box(4, 6, 6, '#c9b27a', -half + 5, 100, 115));
  // Sofa against the back wall, coffee table in front of it.
  const bz = -half;
  room.add(box(210, 42, 90, '#5d6b7a', 150, 0, bz + 50), box(210, 85, 20, '#56636f', 150, 0, bz + 12), box(20, 62, 90, '#56636f', 35, 0, bz + 50), box(20, 62, 90, '#56636f', 265, 0, bz + 50));
  room.add(box(40, 40, 12, '#c98b4a', 100, 42, bz + 30, 0.9), box(40, 40, 12, '#8fb3a2', 190, 42, bz + 30, 0.9));
  room.add(box(100, 4, 55, '#6f4f33', 150, 40, bz + 135));
  for (const [dx, dz] of [[-45, -22], [45, -22], [-45, 22], [45, 22]]) room.add(box(4, 40, 4, '#5a3f28', 150 + dx, 0, bz + 135 + dz));
  // Bookshelf with books on the right wall.
  const sx = half - 18;
  const shelfGroup = new THREE.Group();
  shelfGroup.add(box(120, 200, 35, '#7a5a3c', 0, 0, 0));
  const colors = ['#b2453d', '#3d6fb2', '#d1a33a', '#4c8a5a', '#6b4c8a', '#e0dcd0', '#2e2e2e'];
  for (let shelf = 0; shelf < 4; shelf++) {
    shelfGroup.add(box(112, 3, 30, '#6a4c30', 0, 12 + shelf * 48, 2));
    let x = -54;
    for (let k = 0; x < 52; k++) {
      const w = 3 + ((k * 7 + shelf * 3) % 5), h = 28 + ((k * 11 + shelf) % 14);
      shelfGroup.add(box(w, h, 22, colors[(k + shelf * 2) % colors.length], x + w / 2, 15 + shelf * 48, 4, 0.7));
      x += w + 0.6;
    }
  }
  shelfGroup.position.set(sx, 0, 40);
  shelfGroup.rotation.y = -Math.PI / 2;
  room.add(shelfGroup);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(150, 48), new THREE.MeshStandardMaterial({ color: '#8c5a4a', roughness: 1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.3, 0);
  room.add(rug);
  room.add(box(4, 160, 4, '#333', -half + 40, 0, -half + 40));
  const shade = new THREE.Mesh(new THREE.ConeGeometry(22, 30, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#f2e6c8', emissive: '#f2d79a', emissiveIntensity: 0.5, side: THREE.DoubleSide }));
  shade.position.set(-half + 40, 170, -half + 40);
  room.add(shade);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(18, 14, 35, 24), new THREE.MeshStandardMaterial({ color: '#b5653d' }));
  pot.position.set(-half + 50, 17.5, half - 60);
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(45, 1), new THREE.MeshStandardMaterial({ color: '#3f7a45', roughness: 0.9, flatShading: true }));
  leaves.position.set(-half + 50, 85, half - 60);
  room.add(pot, leaves);
  for (const [x, z, ry, w, h, c] of [[150, -half + 1, 0, 90, 55, '#d9a441'], [-half + 1, -80, Math.PI / 2, 90, 60, '#4a7fb0'], [half - 1, 220, -Math.PI / 2, 60, 80, '#b04a5e']] as const) {
    const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    art.position.set(x, 160, z); art.rotation.y = ry;
    room.add(art);
  }
  room.add(new THREE.HemisphereLight(0xfff4e6, 0x6b5a48, 1.3));
  const sun = new THREE.DirectionalLight(0xfff1dd, 1.4);
  sun.position.set(-120, 240, -200);
  room.add(sun);
  const lamp = new THREE.PointLight(0xffe2b0, 4000, 0, 2);
  lamp.position.set(0, 245, 60);
  room.add(lamp);
  return room;
}
