import * as THREE from 'three';

export const DAG_VIEW_DIRECTION = new THREE.Vector3(0, 1, .28).normalize();

/** Inspect actual model meshes, not slide metadata, for renderer regression checks. */
export function describeSceneModel(model: THREE.Object3D) {
  let meshCount = 0;
  const geometryTypes: Record<string, number> = {};
  const graphNodes: { id: number; color: string }[] = [];
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    meshCount++;
    geometryTypes[object.geometry.type] = (geometryTypes[object.geometry.type] ?? 0) + 1;
    if (typeof object.userData.nodeId === 'number') {
      graphNodes.push({ id: object.userData.nodeId, color: (object.material as THREE.MeshStandardMaterial).color.getHexString() });
    }
  });
  return { meshCount, geometryTypes, graphNodes };
}

/** A second instance of the slide model in the same renderer; resources remain source-owned. */
export function createScenePreview(source: THREE.Group, viewDirection: THREE.Vector3) {
  const model = source.clone(true);
  // Slide-mode transitions hide and shrink the source root. Never inherit those transitions.
  model.position.set(0, 0, 0);
  model.quaternion.identity();
  model.scale.setScalar(1);
  model.visible = true;
  const originals: THREE.Object3D[] = [];
  const copies: THREE.Object3D[] = [];
  source.traverse(object => originals.push(object));
  model.traverse(object => copies.push(object));
  const bindings = originals.slice(1).map((object, index) => ({ source: object, copy: copies[index + 1]! }));
  const sharedResources = bindings.every(({ source, copy }) => !(source instanceof THREE.Mesh)
    || (copy instanceof THREE.Mesh && copy.geometry === source.geometry && copy.material === source.material));

  // Preserve the slide's viewing angle so stacked geometry reads as 3D on the flat DAG plane.
  const up = new THREE.Vector3(0, 1, 0);
  const origin = new THREE.Vector3();
  const slideView = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(viewDirection, origin, up));
  const dagView = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(DAG_VIEW_DIRECTION, origin, up));
  const pose = new THREE.Group();
  pose.quaternion.copy(dagView).multiply(slideView.invert());
  pose.add(model);
  const bounds = new THREE.Box3().setFromObject(pose);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = Math.min(2.75 / Math.max(size.x, .001), 2.8 / Math.max(size.z, .001), 2.2 / Math.max(size.y, .001));
  const group = new THREE.Group();
  group.name = `scene-preview-${source.name}`;
  group.scale.setScalar(scale);
  group.position.set(1.65 - center.x * scale, .15 - bounds.min.y * scale, -center.z * scale);
  group.add(pose);

  return {
    group, model, sharedResources,
    contents: describeSceneModel(model),
    sync() {
      // Structure changes rebuild the preview; animation uses the live child transforms.
      for (const { source, copy } of bindings) {
        copy.position.copy(source.position);
        copy.quaternion.copy(source.quaternion);
        copy.scale.copy(source.scale);
        copy.visible = source.visible;
      }
    },
    // No geometry/material disposal here: Slide mode owns the shared GPU resources.
  };
}
