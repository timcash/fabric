import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DemoGraph, nodeColors } from './graph';
import type { Model, Slide } from './slides';
import { SlideDagState } from './slide-dag';
import { createSlideDagVisual } from './dag-scene';
import { DAG_VIEW_DIRECTION, describeSceneModel } from './scene-preview';

export function createScene(host: HTMLElement, graph: DemoGraph, onInteract: () => void, onSelect: (id: number) => void, dagState: SlideDagState, onDagSelect: (id: string, enter: boolean) => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x080b10, .023);
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
  camera.position.set(8, 6, 11);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.5, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minPolarAngle = .2;
  controls.maxPolarAngle = Math.PI * .47;
  let orbiting = false;
  let dagMode = false;
  let dagVisual: ReturnType<typeof createSlideDagVisual> | undefined;
  let cameraPath: { start: number; from: THREE.Vector3; fromTarget: THREE.Vector3; through: THREE.Vector3; throughTarget: THREE.Vector3 } | undefined;
  controls.addEventListener('start', () => { orbiting = true; cameraPath = undefined; onInteract(); });
  scene.add(new THREE.HemisphereLight(0xc6ddff, 0x172030, 3));
  for (const [color, power, position] of [
    [0xf2f7ff, 4, [3, 9, 6]], [0x408fff, 5, [-6, 5, -6]], [0x90c4ff, 2, [7, 3, -2]],
  ] as const) {
    const light = new THREE.DirectionalLight(color, power);
    light.position.fromArray(position);
    scene.add(light);
  }

  const materials = {
    body: new THREE.MeshStandardMaterial({ color: 0xa7bfd8, roughness: .28, metalness: .78 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x2d75da, roughness: .3, metalness: .5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x132333, roughness: .4, metalness: .6 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x86c9ff, emissive: 0x2589ff, emissiveIntensity: 1.6 }),
  };
  const box = (parent: THREE.Object3D, size: [number, number, number], pos: [number, number, number], material: THREE.Material) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 2, .06), material);
    mesh.position.fromArray(pos);
    parent.add(mesh);
    return mesh;
  };
  const groups: Record<Model, THREE.Group> = { assembly: new THREE.Group(), graph: new THREE.Group(), layers: new THREE.Group() };
  Object.entries(groups).forEach(([name, group]) => { group.name = name; group.scale.setScalar(name === 'assembly' ? 1 : .001); scene.add(group); });

  const assembly = groups.assembly;
  box(assembly, [6, .18, 5], [0, -.12, 0], materials.dark);
  for (let i = 0; i < 4; i++) {
    const plate = box(assembly, [3.6 - i * .45, .25, 3.6 - i * .45], [0, .3 + i * .65, 0], i % 2 ? materials.body : materials.blue);
    plate.rotation.y = i * .2;
    for (const sign of [-1, 1]) box(plate, [2.7 - i * .35, .025, .025], [0, .14, sign * (1.65 - i * .22)], materials.glow);
  }
  const core = new THREE.Mesh(new THREE.TorusKnotGeometry(.6, .15, 96, 12), materials.body);
  core.name = 'assembly-core';
  core.position.y = 3.2;
  assembly.add(core);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.13, .025, 8, 96), materials.glow);
  ring.position.y = 3.2;
  ring.rotation.x = Math.PI / 2.5;
  assembly.add(ring);

  for (let i = 0; i < 3; i++) {
    const layer = new THREE.Group();
    layer.position.set((i - 1) * .6, i * 1.55, (i - 1) * -.4);
    groups.layers.add(layer);
    box(layer, [5.2, .12, 3.4], [0, 0, 0], materials.dark);
    for (const z of [-1.65, 1.65]) box(layer, [5.1, .02, .025], [0, .08, z], materials.glow);
    for (let j = 0; j < 3; j++) box(layer, [1.0, .4, .85], [-1.7 + j * 1.7, .28, 0], j === i ? materials.body : materials.blue);
    for (let j = 0; j < 2; j++) box(layer, [.7, .02, .025], [-.85 + j * 1.7, .28, 0], materials.glow);
  }

  box(groups.graph, [10, .14, 6], [0, -.2, 0], materials.dark);
  const graphContent = new THREE.Group();
  groups.graph.add(graphContent);
  let pickTargets: THREE.Mesh[] = [];
  let nodePositions = new Map<number, THREE.Vector3>();
  let graphScale = 1;

  function disposeGraph() {
    graphContent.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (object.userData.ownedMaterial) (object.material as THREE.Material).dispose();
      }
    });
    graphContent.clear();
  }

  function syncGraph() {
    disposeGraph();
    pickTargets = [];
    nodePositions = new Map();
    const ranks = new Map<number, number>();
    for (const node of graph.nodes) {
      const parents = graph.edges.filter(edge => edge.to === node.id);
      ranks.set(node.id, Math.max(0, ...parents.map(edge => (ranks.get(edge.from) ?? 0) + 1)));
    }
    const maxRank = Math.max(0, ...ranks.values());
    const lanes = new Map<number, number[]>();
    for (const node of graph.nodes) {
      const rank = ranks.get(node.id)!;
      lanes.set(rank, [...lanes.get(rank) ?? [], node.id]);
    }
    for (const node of graph.nodes) {
      const rank = ranks.get(node.id)!;
      const peers = lanes.get(rank)!;
      const position = new THREE.Vector3((rank - maxRank / 2) * 2.15, .38, (peers.indexOf(node.id) - (peers.length - 1) / 2) * 1.8);
      nodePositions.set(node.id, position);
      const color = nodeColors[node.color];
      const material = new THREE.MeshStandardMaterial({ color, roughness: .35, metalness: .5, emissive: color, emissiveIntensity: node.id === graph.selected ? .45 : .02 });
      const body = box(graphContent, [1.18, .55, .95], position.toArray(), material);
      body.userData = { nodeId: node.id, ownedMaterial: true };
      body.name = `node-${node.id}`;
      pickTargets.push(body);
      box(body, [.7, .025, .04], [0, .3, .28], node.id === graph.selected ? materials.glow : materials.body);
    }
    for (const edge of graph.edges) {
      const start = nodePositions.get(edge.from)!;
      const end = nodePositions.get(edge.to)!;
      const curve = new THREE.CatmullRomCurve3([start, start.clone().lerp(end, .5).add(new THREE.Vector3(0, .3, 0)), end]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, .02, 6, false), materials.glow);
      graphContent.add(tube);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(.1, .24, 10), materials.glow);
      arrow.position.copy(start).lerp(end, .7);
      arrow.position.y += .17;
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
      graphContent.add(arrow);
    }
    graphScale = Math.min(1, 8.6 / (maxRank * 2.15 + 1.18), 4.6 / Math.max(1, ...Array.from(lanes.values(), lane => lane.length * 1.8)));
    graphContent.scale.setScalar(graphScale);
    host.dataset.nodeCount = String(graph.nodes.length);
    host.dataset.edgeCount = String(graph.edges.length);
    host.dataset.selectedNode = String(graph.selected ?? '');
    host.dataset.selectedColor = String(graph.nodes.find(node => node.id === graph.selected)?.color ?? '');
    host.dataset.slideModels = JSON.stringify(Object.fromEntries(Object.entries(groups).map(([name, model]) => [name, describeSceneModel(model)])));
    dagVisual?.rebuild();
  }
  syncGraph();
  dagVisual = createSlideDagVisual(dagState, groups);
  scene.add(dagVisual.group);

  const grid = new THREE.GridHelper(60, 60, 0x2c4c6e, 0x1a293a);
  grid.position.y = -.3;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = .4;
  scene.add(grid);
  const dagGrid = new THREE.GridHelper(60, 60, 0x444444, 0x292929);
  dagGrid.position.y = -.3;
  dagGrid.visible = false;
  (dagGrid.material as THREE.Material).transparent = true;
  (dagGrid.material as THREE.Material).opacity = .45;
  (dagGrid.material as THREE.Material).toneMapped = false;
  scene.add(dagGrid);
  let current: Slide | undefined;
  let active: Model = 'assembly';
  const desiredPosition = camera.position.clone();
  const desiredTarget = controls.target.clone();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let disposed = false;
  let previous = performance.now();
  let time = 0;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down: { x: number; y: number } | undefined;
  let lastDagPick: { id: string; at: number } | undefined;
  renderer.domElement.addEventListener('pointerdown', event => { down = { x: event.clientX, y: event.clientY }; });
  renderer.domElement.addEventListener('pointercancel', () => { down = undefined; });
  renderer.domElement.addEventListener('pointerup', event => {
    if (!down) return;
    const distance = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    down = undefined;
    if (distance > 6 || (!dagMode && current?.id !== 'interact')) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    if (dagMode) {
      const id = dagVisual?.pick(raycaster);
      if (id) { lastDagPick = { id, at: performance.now() }; onDagSelect(id, false); }
      return;
    }
    const hit = raycaster.intersectObjects(pickTargets, false)[0];
    if (hit) onSelect(hit.object.userData.nodeId as number);
  });
  renderer.domElement.addEventListener('dblclick', event => {
    if (!dagMode) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const id = lastDagPick && performance.now() - lastDagPick.at < 500 ? lastDagPick.id : dagVisual?.pick(raycaster);
    if (id) onDagSelect(id, true);
  });
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    document.getElementById('scene-fallback')!.hidden = false;
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => { document.getElementById('scene-fallback')!.hidden = true; });

  function resize() {
    const width = host.clientWidth;
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    if (!dagMode && width > 760) camera.setViewOffset(width, height, -width * .21, 0, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const dagDirection = DAG_VIEW_DIRECTION;
  const aspectScale = () => Math.min(camera.aspect / 1.2, 1);
  function dagOverview(through?: THREE.Vector3) {
    if (!dagVisual) return;
    const oldPosition = camera.position.clone();
    const oldTarget = controls.target.clone();
    orbiting = false;
    desiredTarget.copy(dagVisual.center());
    desiredPosition.copy(desiredTarget).addScaledVector(dagDirection, dagVisual.overviewDistance(camera.aspect));
    if (through) cameraPath = { start: performance.now(), from: oldPosition, fromTarget: oldTarget, through: through.clone().addScaledVector(dagDirection, 12 / aspectScale()), throughTarget: through };
    else cameraPath = undefined;
  }
  function dagFocus(distance = 18 / aspectScale()) {
    if (!dagVisual) return;
    orbiting = false;
    cameraPath = undefined;
    desiredTarget.copy(dagVisual.target());
    desiredPosition.copy(desiredTarget).addScaledVector(dagDirection, distance);
  }

  function animate(now: number) {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    const delta = Math.max(0, Math.min((now - previous) / 1000, .05));
    previous = now;
    if (document.hidden) return;
    if (!reduced.matches) time += delta;
    const blend = reduced.matches ? 1 : 1 - Math.exp(-delta * 5);
    if (cameraPath && !orbiting) {
      const progress = reduced.matches ? 1 : Math.min(1, (now - cameraPath.start) / 900);
      const amount = THREE.MathUtils.smoothstep(progress < .45 ? progress / .45 : (progress - .45) / .55, 0, 1);
      if (progress < .45) {
        camera.position.lerpVectors(cameraPath.from, cameraPath.through, amount);
        controls.target.lerpVectors(cameraPath.fromTarget, cameraPath.throughTarget, amount);
      } else {
        camera.position.lerpVectors(cameraPath.through, desiredPosition, amount);
        controls.target.lerpVectors(cameraPath.throughTarget, desiredTarget, amount);
      }
      if (progress === 1) cameraPath = undefined;
    } else if (!orbiting) { camera.position.lerp(desiredPosition, blend); controls.target.lerp(desiredTarget, blend); }
    for (const [name, group] of Object.entries(groups)) {
      const scale = THREE.MathUtils.lerp(group.scale.x, !dagMode && name === active ? 1 : .001, blend);
      group.scale.setScalar(scale);
      group.visible = scale > .01;
    }
    core.rotation.y = time * .2;
    core.rotation.z = time * .1;
    ring.rotation.z = time * .1;
    controls.enableDamping = !reduced.matches;
    controls.update();
    dagGrid.position.y = dagVisual!.center().y - .3;
    if (dagMode) dagVisual?.update(camera, camera.position.distanceTo(controls.target) * aspectScale(), renderer.domElement.getBoundingClientRect(), host);
    renderer.render(scene, camera);
    host.dataset.rendered = 'true';
    host.dataset.model = active;
    host.dataset.camera = camera.position.toArray().map(value => value.toFixed(3)).join(',');
    host.dataset.cameraTarget = controls.target.toArray().map(value => value.toFixed(3)).join(',');
    host.dataset.motion = reduced.matches ? 'reduced' : 'animated';
    host.dataset.viewMode = dagMode ? 'dag' : 'slides';
    host.dataset.cameraPath = cameraPath ? 'through-parent' : 'idle';
    // Actual projected mesh centers make the real raycast targets inspectable in tests.
    const rect = renderer.domElement.getBoundingClientRect();
    host.dataset.nodePositions = JSON.stringify(pickTargets.map(mesh => {
      const p = mesh.getWorldPosition(new THREE.Vector3()).project(camera);
      return { id: mesh.userData.nodeId, x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
    }));
  }
  frame = requestAnimationFrame(animate);

  return {
    setSlide(slide: Slide) {
      current = slide;
      active = slide.model;
      orbiting = false;
      desiredPosition.fromArray(slide.camera);
      desiredTarget.fromArray(slide.target);
    },
    setMode(mode: 'slides' | 'dag') {
      dagMode = mode === 'dag';
      grid.visible = !dagMode;
      dagGrid.visible = dagMode;
      controls.enablePan = dagMode;
      // Overview/point LOD can be much farther away, especially on narrow screens.
      camera.far = dagMode ? 1000 : 100;
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.density = dagMode ? .007 : .023;
        scene.fog.color.setHex(dagMode ? 0x000000 : 0x080b10);
      }
      dagVisual!.group.visible = dagMode;
      cameraPath = undefined;
      resize();
      if (dagMode) { dagVisual!.rebuild(); dagOverview(); }
      else if (current) this.setSlide(current);
    },
    refreshDag(throughId?: string) {
      const through = throughId ? dagVisual!.target(throughId) : undefined;
      dagVisual!.rebuild();
      dagOverview(through);
    },
    dagFocus,
    dagOverview: () => dagOverview(),
    dagZoom(delta: number) {
      const distance = Math.max(8 / aspectScale(), Math.min(140 / aspectScale(), desiredPosition.distanceTo(desiredTarget) * Math.exp(delta * .0015)));
      dagFocus(distance);
    },
    dagLod(level: number) { dagFocus([90, 42, 18][Math.max(0, Math.min(2, level))] / aspectScale()); },
    dagPan(x: number, z: number) {
      orbiting = false; cameraPath = undefined;
      const shift = new THREE.Vector3(x * 2, 0, z * 2);
      desiredPosition.add(shift); desiredTarget.add(shift);
    },
    resetCamera() { if (current) this.setSlide(current); },
    orbit(direction: number) {
      cameraPath = undefined;
      orbiting = false;
      desiredTarget.copy(controls.target);
      desiredPosition.copy(camera.position).sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), direction * Math.PI / 8).add(desiredTarget);
    },
    syncGraph,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      dagVisual?.dispose();
      disposeGraph();
      scene.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      dagGrid.geometry.dispose();
      (dagGrid.material as THREE.Material).dispose();
      Object.values(materials).forEach(material => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
