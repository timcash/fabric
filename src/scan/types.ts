/** Pixel-space point. Pixel i covers [i, i + 1); its center is i + 0.5. */
export type Point = { x: number; y: number };

/** One MediaPipe-style landmark. x/y are normalized to the image (0..1); z is relative depth. */
export type Landmark = { x: number; y: number; z: number; visibility?: number };

/** Person-segmentation confidence (0..1) at image resolution, row-major. */
export type Mask = { width: number; height: number; data: Float32Array };

/** What a pose source sees in one frame: landmarks, world landmarks, and a person mask. */
export type Observation = {
  width: number;
  height: number;
  landmarks: Landmark[];
  world: Landmark[];
  mask: Mask;
  timestamp: number;
};

/** BlazePose / MediaPipe Pose Landmarker 33-point topology (subject's left/right). */
export const LM = {
  nose: 0, leftEar: 7, rightEar: 8, mouthLeft: 9, mouthRight: 10,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30, leftFootIndex: 31, rightFootIndex: 32,
} as const;

export const LANDMARK_COUNT = 33;
