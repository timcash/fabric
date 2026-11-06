/**
 * MediaPipe Pose Landmarker (BlazePose GHUM): 33 landmarks plus a person segmentation mask, on-device in WebAssembly
 * and WebGL. Assets are self-hosted under /mediapipe/ (see scripts/prepare-pose-assets.ts), so frames never leave
 * the phone and the page works under a strict 'self' Content-Security-Policy.
 */
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Observation } from './types.ts';

export type PoseSource = {
  detect(image: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, timestamp: number, mode: 'VIDEO' | 'IMAGE'): Promise<Observation | null>;
  close(): void;
  delegate: 'GPU' | 'CPU';
};

export const MODEL_FILE = 'pose_landmarker_full.task';

export async function createMediaPipePose(base = import.meta.env.BASE_URL): Promise<PoseSource> {
  const root = `${base.replace(/\/$/, '')}/mediapipe`;
  const vision = await FilesetResolver.forVisionTasks(`${root}/wasm`);
  const make = (delegate: 'GPU' | 'CPU') => PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: `${root}/${MODEL_FILE}`, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    outputSegmentationMasks: true,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let delegate: 'GPU' | 'CPU' = 'GPU';
  let landmarker: PoseLandmarker;
  try { landmarker = await make('GPU'); } catch { delegate = 'CPU'; landmarker = await make('CPU'); }
  let mode: 'VIDEO' | 'IMAGE' = 'VIDEO';
  let last = 0;
  return {
    delegate,
    async detect(image, timestamp, wanted) {
      if (wanted !== mode) { await landmarker.setOptions({ runningMode: wanted }); mode = wanted; }
      const t = Math.max(timestamp, last + 1);
      last = t;
      const result = mode === 'VIDEO' ? landmarker.detectForVideo(image, t) : landmarker.detect(image);
      const mask = result.segmentationMasks?.[0];
      try {
        if (!result.landmarks.length || !mask) return null;
        return {
          width: mask.width,
          height: mask.height,
          landmarks: result.landmarks[0].map(l => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility })),
          world: (result.worldLandmarks[0] ?? []).map(l => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility })),
          mask: { width: mask.width, height: mask.height, data: new Float32Array(mask.getAsFloat32Array()) },
          timestamp: t,
        };
      } finally {
        result.segmentationMasks?.forEach(m => m.close());
      }
    },
    close() { landmarker.close(); },
  };
}
