/** Consume exactly one advance per gesture, including long momentum tails. */
export class WheelGate {
  private lastEvent = -Infinity;
  private lastAdvance = -Infinity;
  private consumed = false;
  private accumulated = 0;

  consume(delta: number, now: number): number {
    if (!Number.isFinite(delta) || !Number.isFinite(now)) return 0;
    if (now - this.lastEvent > 240) { this.consumed = false; this.accumulated = 0; }
    this.lastEvent = now;
    if (this.consumed) return 0;
    this.accumulated += delta;
    if (Math.abs(this.accumulated) < 24) return 0;
    this.consumed = true;
    if (now - this.lastAdvance < 700) return 0;
    this.lastAdvance = now;
    return Math.sign(this.accumulated);
  }
}

export function indexFromHash(hash: string, items: readonly { id: string }[]): number {
  const index = items.findIndex(item => `#${item.id}` === hash);
  return index < 0 ? 0 : index;
}

export function tourDuration(raw: string | null): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.max(800, Math.min(60000, value)) : 10000;
}

export function clampSlide(index: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.trunc(index)));
}
