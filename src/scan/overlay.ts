import { px } from './geometry.ts';
import type { Chord } from './mask.ts';
import type { FrontAnalysis, SideAnalysis, Site } from './measure.ts';
import type { Check } from './quality.ts';
import type { Observation } from './types.ts';

const BONES: [number, number][] = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32]];
const tint = document.createElement('canvas');

/** Live view: camera image, translucent person mask, and skeleton, colored by readiness. */
export function drawLive(ctx: CanvasRenderingContext2D, image: { draw(c: CanvasRenderingContext2D, w: number, h: number): void }, obs: Observation | null, ready: boolean, mirror: boolean) {
  const { width: W, height: H } = ctx.canvas;
  ctx.save();
  if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  image.draw(ctx, W, H);
  if (obs) {
    if (tint.width !== obs.width || tint.height !== obs.height) { tint.width = obs.width; tint.height = obs.height; }
    const t = tint.getContext('2d')!;
    const img = t.createImageData(obs.width, obs.height), d = img.data, m = obs.mask.data;
    const [r, g, b] = ready ? [80, 255, 160] : [62, 240, 255];
    for (let i = 0; i < m.length; i++) { const k = i * 4; d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = m[i] * 90; }
    t.putImageData(img, 0, 0);
    ctx.drawImage(tint, 0, 0, W, H);
    ctx.lineWidth = Math.max(2, W / 260);
    ctx.strokeStyle = ready ? '#50ffa0' : '#3ef0ff';
    ctx.beginPath();
    for (const [a, b2] of BONES) {
      const p = obs.landmarks[a], q = obs.landmarks[b2];
      ctx.moveTo(p.x * W, p.y * H); ctx.lineTo(q.x * W, q.y * H);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Target brackets: where the whole body should fit. */
export function drawGuide(ctx: CanvasRenderingContext2D) {
  const { width: W, height: H } = ctx.canvas;
  const x0 = W * 0.08, x1 = W * 0.92, y0 = H * 0.04, y1 = H * 0.96, L = W * 0.07;
  ctx.save();
  ctx.strokeStyle = 'rgba(62, 240, 255, .75)';
  ctx.lineWidth = Math.max(2, W / 240);
  ctx.shadowColor = '#3ef0ff'; ctx.shadowBlur = W / 80;
  ctx.beginPath();
  for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L);
  }
  ctx.stroke();
  ctx.restore();
}

const COLORS: Partial<Record<Site, string>> = { neck: '#c9a7ff', chest: '#66acff', waist: '#50dc96', hip: '#ffb35c', thigh: '#ff7a8a', knee: '#ffd166', calf: '#7fe0ff', ankle: '#d4d4d4', bicep: '#f78fff', forearm: '#b9f27c', wrist: '#ffe08a' };

/** Result thumbnail: the captured frame with every measured chord and its label. */
export function drawAnalysis(target: HTMLCanvasElement, image: HTMLCanvasElement, analysis: FrontAnalysis | SideAnalysis, obs: Observation) {
  const scale = Math.min(1, 900 / image.height);
  target.width = Math.round(image.width * scale); target.height = Math.round(image.height * scale);
  const ctx = target.getContext('2d')!;
  ctx.drawImage(image, 0, 0, target.width, target.height);
  ctx.fillStyle = '#080b1070';
  ctx.fillRect(0, 0, target.width, target.height);
  const k = target.width / obs.width;
  const line = (c: Chord, color: string) => { ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(c.a.x * k, c.a.y * k); ctx.lineTo(c.b.x * k, c.b.y * k); ctx.stroke(); };
  ctx.lineWidth = 2.5;
  ctx.font = `600 ${Math.max(11, target.width / 36)}px Inter, system-ui, sans-serif`;
  for (const [name, s] of Object.entries(analysis.sites) as [Site, { chords: Chord[] } | undefined][]) {
    if (!s) continue;
    const color = COLORS[name] ?? '#fff';
    s.chords.forEach(c => line(c, color));
    const c = s.chords[s.chords.length - 1];
    ctx.fillStyle = color;
    ctx.fillText(name, Math.max(c.a.x, c.b.x) * k + 6, ((c.a.y + c.b.y) / 2) * k + 4);
  }
  if (analysis.view === 'front') {
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    for (const id of ['armLength', 'inseam'] as const) for (const [a, b] of analysis.lengths[id]?.segments ?? []) line({ a, b, length: 0 }, '#ffffffaa');
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffffff80';
    ctx.beginPath(); ctx.moveTo(0, analysis.scale.floorY * k); ctx.lineTo(target.width, analysis.scale.floorY * k); ctx.moveTo(0, analysis.scale.topY * k); ctx.lineTo(target.width, analysis.scale.topY * k); ctx.stroke();
  }
  ctx.fillStyle = '#ffffffcc';
  for (const l of obs.landmarks.slice(11)) { const p = px(l, target.width, target.height); ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
}

export function renderChecks(list: HTMLElement, checks: readonly Check[]) {
  const summary = document.createElement('li');
  const ok = checks.filter(c => c.ok).length;
  summary.dataset.check = 'summary';
  summary.dataset.ok = String(ok === checks.length);
  summary.textContent = `SYSTEMS ${ok}/${checks.length}`;
  list.replaceChildren(summary, ...checks.map(c => {
    const li = document.createElement('li');
    li.dataset.ok = String(c.ok);
    li.dataset.check = c.id;
    li.textContent = c.label;
    if (!c.ok) li.title = c.hint;
    return li;
  }));
}
