/** Turns a posed mesh into what a pose source would report for one camera frame: an exact mask and true joints. */
import { placeBody, placePoint, project, rasterMask, type Camera } from './camera.ts';
import { bodyCenter, landmarks3d, type PosedBody } from './makehuman.ts';
import type { Observation } from '../scan/types.ts';

export function oracleObservation(body: PosedBody, cam: Camera, yawDeg: number, timestamp = 0, joints = landmarks3d(body)): Observation {
  const center = bodyCenter(body);
  const placed = placeBody(body.positions, center, yawDeg);
  const data = rasterMask(cam, placed, body.model.triangles);
  const landmarks = joints.map(j => { const q = project(cam, placePoint(j, center, yawDeg)); return { x: q.x / cam.width, y: q.y / cam.height, z: (q.depth - cam.position[2]) / 100, visibility: 0.99 }; });
  const hip = placePoint(joints[23], center, yawDeg), hip2 = placePoint(joints[24], center, yawDeg);
  const world = joints.map(j => { const p = placePoint(j, center, yawDeg); return { x: (p[0] - (hip[0] + hip2[0]) / 2) / 100, y: -(p[1] - hip[1]) / 100, z: -p[2] / 100, visibility: 0.99 }; });
  return { width: cam.width, height: cam.height, landmarks, world, mask: { width: cam.width, height: cam.height, data }, timestamp };
}
