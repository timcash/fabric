/**
 * Copies the MediaPipe Tasks Vision WebAssembly runtime out of node_modules and downloads the Pose Landmarker
 * model into public/mediapipe/ so the scanner is fully self-hosted. Runs before dev and build; idempotent.
 */
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'mediapipe');
const wasmSource = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const MODEL = 'pose_landmarker_full.task';
const MODEL_URL = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/${MODEL}`;
const exists = async (path: string) => stat(path).then(s => s.size > 0, () => false);

await mkdir(join(out, 'wasm'), { recursive: true });
for (const name of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  await copyFile(join(wasmSource, name), join(out, 'wasm', name));
}
const model = join(out, MODEL);
if (!(await exists(model))) {
  console.log(`Downloading ${MODEL_URL}`);
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`Model download failed: ${response.status} ${response.statusText}. Download it manually to ${model}.`);
  await writeFile(model, new Uint8Array(await response.arrayBuffer()));
}
console.log(`Pose assets ready in ${out}`);
