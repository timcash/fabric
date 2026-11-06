import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { layoutWorkplane, lodForDistance, LOD_NAMES, type SlideDagState } from './slide-dag';
import { slides, type Model } from './slides';
import { createScenePreview } from './scene-preview';

type Tile = { id: string; model: Model; preview: ReturnType<typeof createScenePreview>; group: THREE.Group; point: THREE.Mesh; title: THREE.Group; full: THREE.Group; material: THREE.MeshBasicMaterial; pointMaterial: THREE.MeshBasicMaterial; outlineMaterial: THREE.LineBasicMaterial };

/** The open node’s flat child DAG shares the existing Three.js scene and camera. */
export function createSlideDagVisual(state: SlideDagState, models: Record<Model, THREE.Group>) {
  const group = new THREE.Group();
  group.name = 'slide-dag';
  group.visible = false;
  const owned: { dispose(): void }[] = [];
  let tiles: Tile[] = [];
  let targets: THREE.Object3D[] = [];
  const center = new THREE.Vector3();
  let span = 30;

  function keep<T extends { dispose(): void }>(resource: T): T { owned.push(resource); return resource; }
  function panel(width: number, height: number, material: THREE.Material) {
    return new THREE.Mesh(keep(new RoundedBoxGeometry(width, .15, height, 2, .07)), material);
  }
  function outline(width: number, height: number, material: THREE.LineBasicMaterial) {
    const corners = [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]];
    const geometry = keep(new THREE.BufferGeometry().setFromPoints(corners.map(([x, z]) => new THREE.Vector3(x, .085, z))));
    return new THREE.LineLoop(geometry, material);
  }
  function textSurface(text: string, width: number, depth: number, color: string, size = 40) {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = Math.round(768 * depth / width);
    const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = color;
    context.font = `500 ${size}px -apple-system, BlinkMacSystemFont, sans-serif`;
    context.textBaseline = 'top';
    let line = '';
    let y = 12;
    for (const word of text.split(' ')) {
      const next = `${line}${word} `;
      if (context.measureText(next).width > 720 && line) {
        context.fillText(line, 20, y);
        y += size * 1.3;
        line = `${word} `;
      } else line = next;
    }
    context.fillText(line, 20, y);
    const texture = keep(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = keep(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    const plane = new THREE.Mesh(keep(new THREE.PlaneGeometry(width, depth)), material);
    plane.rotation.x = -Math.PI / 2;
    return plane;
  }
  function rebuild() {
    for (const resource of owned.splice(0)) resource.dispose();
    group.clear();
    tiles = [];
    targets = [];
    const layer = state.layer;
    center.set(0, 0, 0);
    // Each opened node has a local XY-style plane (world XZ). Depth is navigation,
    // not an ever-growing world-space offset or a stack of overlapping cards.
    const layout = layoutWorkplane(layer.nodes, layer.edges);
    span = Math.max(12, Math.max(...layout.map(item => item.x)) - Math.min(...layout.map(item => item.x)) + 9);
    // The interior is a coordinate plane, not a filled backdrop. The shared grid
    // supplies spatial context without covering the canvas with a blue slab.
    const positions = new Map(layout.map(item => [item.id, center.clone().add(new THREE.Vector3(item.x, 0, item.z))]));
    const edgeMaterial = keep(new THREE.MeshBasicMaterial({ color: 0x999999, toneMapped: false }));
    for (const edge of layer.edges) {
      const start = positions.get(edge.from)!;
      const end = positions.get(edge.to)!;
      const a = start.clone().add(new THREE.Vector3(3.3, -.15, 0));
      const b = end.clone().add(new THREE.Vector3(-3.3, -.15, 0));
      const midX = (a.x + b.x) / 2;
      const curve = new THREE.CurvePath<THREE.Vector3>();
      if (Math.abs(a.z - b.z) < .01) curve.add(new THREE.LineCurve3(a, b));
      else {
        const sign = Math.sign(b.z - a.z);
        const cornerA = new THREE.Vector3(midX, a.y, a.z);
        const cornerB = new THREE.Vector3(midX, a.y, b.z);
        const beforeA = cornerA.clone().add(new THREE.Vector3(-.35, 0, 0));
        const afterA = cornerA.clone().add(new THREE.Vector3(0, 0, sign * .35));
        const beforeB = cornerB.clone().add(new THREE.Vector3(0, 0, -sign * .35));
        const afterB = cornerB.clone().add(new THREE.Vector3(.35, 0, 0));
        curve.add(new THREE.LineCurve3(a, beforeA));
        curve.add(new THREE.QuadraticBezierCurve3(beforeA, cornerA, afterA));
        curve.add(new THREE.LineCurve3(afterA, beforeB));
        curve.add(new THREE.QuadraticBezierCurve3(beforeB, cornerB, afterB));
        curve.add(new THREE.LineCurve3(afterB, b));
      }
      group.add(new THREE.Mesh(keep(new THREE.TubeGeometry(curve, 32, .035, 6, false)), edgeMaterial));
      const arrow = new THREE.Mesh(keep(new THREE.ConeGeometry(.13, .4, 12)), edgeMaterial);
      arrow.rotation.z = -Math.PI / 2;
      arrow.position.copy(b).add(new THREE.Vector3(-.1, 0, 0));
      group.add(arrow);
    }
    layer.nodes.forEach((node, index) => {
      const tile = new THREE.Group();
      tile.position.copy(positions.get(node.id)!);
      tile.name = `node-${node.id}`;
      tile.userData.slideId = node.slideId;
      tile.userData.nodeId = node.id;
      group.add(tile);
      // Unlit neutral surfaces cannot pick up the slide models' blue lighting.
      const material = keep(new THREE.MeshBasicMaterial({ color: 0x101010, toneMapped: false, fog: false }));
      const pointMaterial = keep(new THREE.MeshBasicMaterial({ color: 0x999999, toneMapped: false, fog: false }));
      const outlineMaterial = keep(new THREE.LineBasicMaterial({ color: 0x777777, toneMapped: false, fog: false }));
      const full = new THREE.Group();
      tile.add(full);
      const body = panel(6.5, 4.5, material);
      body.userData.dagId = node.id;
      full.add(body, outline(6.5, 4.5, outlineMaterial));
      const titleText = textSurface(`${String(index + 1).padStart(2, '0')} / ${node.title}`, 3.0, 1.3, '#eeeeee', 58);
      titleText.position.set(-1.55, .09, -1.35);
      full.add(titleText);
      const description = textSurface(node.description, 3.0, 2.3, '#cccccc', 42);
      description.position.set(-1.55, .09, .5);
      full.add(description);
      const hint = textSurface(`${node.children.length} children · N opens node`, 5.8, .3, '#999999', 25);
      hint.position.set(0, .09, 1.95);
      full.add(hint);
      const slide = slides.find(slide => slide.id === node.slideId)!;
      const preview = createScenePreview(models[node.model], new THREE.Vector3(...slide.camera).sub(new THREE.Vector3(...slide.target)));
      full.add(preview.group);
      const title = new THREE.Group();
      tile.add(title);
      const titleBody = panel(6.5, 1.6, material);
      titleBody.userData.dagId = node.id;
      title.add(titleBody, outline(6.5, 1.6, outlineMaterial));
      const label = textSurface(`${String(index + 1).padStart(2, '0')} / ${node.title}`, 5.9, 1.25, '#eeeeee', 56);
      label.position.y = .09;
      title.add(label);
      const point = new THREE.Mesh(keep(new THREE.SphereGeometry(.32, 16, 12)), pointMaterial);
      point.userData.dagId = node.id;
      tile.add(point);
      targets.push(body, titleBody, point);
      tiles.push({ id: node.id, model: node.model, preview, group: tile, point, title, full, material, pointMaterial, outlineMaterial });
    });
  }
  rebuild();
  return {
    group, rebuild,
    center: () => center.clone(),
    target: (id = state.selected) => tiles.find(tile => tile.id === id)?.group.position.clone() ?? center.clone(),
    overviewDistance: (aspect: number) => Math.max(18, span / (2 * Math.tan(19 * Math.PI / 180) * Math.min(aspect, 2)) * 1.12),
    pick(raycaster: THREE.Raycaster) {
      const visibleTargets = targets.filter(target => target.visible && target.parent?.visible);
      return raycaster.intersectObjects(visibleTargets, false)[0]?.object.userData.dagId as string | undefined;
    },
    update(camera: THREE.Camera, distance: number, rect: DOMRect, host: HTMLElement) {
      const lod = lodForDistance(distance);
      const traced = new Set(state.traced ? state.traceIds() : []);
      tiles.forEach(tile => {
        tile.point.visible = lod === 0;
        tile.title.visible = lod === 1;
        tile.full.visible = lod === 2;
        if (tile.full.visible) tile.preview.sync();
        const color = state.layer.nodes.find(node => node.id === tile.id)?.color ?? 0;
        const highlighted = tile.id === state.selected || traced.has(tile.id);
        tile.material.color.setHex(highlighted ? 0x1c1c1c : 0x101010);
        const accent = color === 1 ? 0x42c8b0 : color === 2 ? 0xeeae5b : highlighted ? 0xffffff : 0x777777;
        tile.pointMaterial.color.setHex(accent);
        tile.outlineMaterial.color.setHex(accent);
      });
      host.dataset.dagLod = LOD_NAMES[lod];
      host.dataset.dagPreviewCount = String(group.visible && lod === 2 ? tiles.filter(tile => tile.preview.contents.meshCount > 0).length : 0);
      host.dataset.dagPreviews = JSON.stringify(tiles.map(tile => ({
        id: tile.id, model: tile.model, ...tile.preview.contents,
        visible: group.visible && tile.group.visible && tile.full.visible && tile.preview.group.visible && tile.preview.model.visible,
        scale: tile.preview.group.scale.x, sharedResources: tile.preview.sharedResources,
        coreRotation: tile.preview.model.getObjectByName('assembly-core')?.quaternion.toArray(),
      })));
      const detail = document.getElementById('dag-lod') as HTMLSelectElement | null;
      if (detail && document.activeElement !== detail) detail.value = String(lod);
      host.dataset.dagDepth = String(state.path.length);
      host.dataset.dagNodeCount = String(tiles.length);
      host.dataset.workplaneId = state.workplaneId;
      host.dataset.openNode = state.layer.owner.id;
      host.dataset.rootNode = state.rootNode.id;
      host.dataset.rootParent = String(state.rootNode.parentId);
      host.dataset.dagSelected = state.selected;
      host.dataset.dagDistance = distance.toFixed(2);
      host.dataset.dagTraced = String(state.traced);
      host.dataset.dagTraceIds = JSON.stringify([...traced]);
      host.dataset.dagNodes = JSON.stringify(tiles.map(tile => {
        const p = tile.group.getWorldPosition(new THREE.Vector3()).project(camera);
        return { id: tile.id, parentId: state.layer.owner.id, planeY: tile.group.position.y, x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2, visible: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1 };
      }));
    },
    dispose() { for (const resource of owned.splice(0)) resource.dispose(); group.clear(); },
  };
}
