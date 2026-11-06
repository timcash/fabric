import { walkthroughSteps, walkthroughSpeed, type TourInput } from './walkthrough-steps';

export function readWalkthroughState(): Record<string, string | undefined> {
  return { ...document.body.dataset, ...document.getElementById('scene')!.dataset, guideOpen: String((document.getElementById('guide-dialog') as HTMLDialogElement).open) };
}

function perform(input: TourInput) {
  if ('click' in input) {
    const button = document.querySelector<HTMLElement>(input.click);
    if (!button) throw new Error(`Missing tour control: ${input.click}`);
    button.click();
  } else if ('wheel' in input) {
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: input.wheel, bubbles: true, cancelable: true }));
  } else {
    const shiftKey = input.key.startsWith('Shift+');
    const key = shiftKey ? input.key.slice(6) : input.key;
    // The live demo goes through the normal keyboard handler, not a tour-only state setter.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: key === 'Space' ? ' ' : key, code: key === 'Space' ? 'Space' : '', shiftKey, bubbles: true, cancelable: true }));
  }
}

export function createWalkthrough(beforeStart: () => void, afterStop: () => void) {
  let generation = 0;
  let active = false;
  let pending: (() => void) | undefined;
  const panel = document.getElementById('walkthrough')!;
  const speed = walkthroughSpeed(new URLSearchParams(location.search).get('walkthroughSpeed'));
  const results: { id: string; passed: boolean; milliseconds: number }[] = [];
  const pause = (ms: number) => new Promise<void>(resolve => {
    const timer = setTimeout(() => { pending = undefined; resolve(); }, ms);
    pending = () => { clearTimeout(timer); pending = undefined; resolve(); };
  });
  const publish = () => { document.body.dataset.walkthroughResults = JSON.stringify(results); };
  function stop(status = 'stopped') {
    if (!active) return;
    active = false; generation++; pending?.();
    document.body.dataset.walkthroughStatus = status;
    document.body.dataset.walkthrough = 'false';
    panel.hidden = status !== 'completed' && status !== 'error';
    document.getElementById('start-walkthrough')!.setAttribute('aria-pressed', 'false');
    afterStop();
  }
  async function start() {
    if (active) { stop(); return; }
    beforeStart(); active = true;
    const run = ++generation;
    results.length = 0; publish();
    panel.hidden = false;
    document.body.dataset.walkthrough = 'true';
    document.body.dataset.walkthroughStatus = 'running';
    document.body.dataset.walkthroughCount = String(walkthroughSteps.length);
    document.getElementById('start-walkthrough')!.setAttribute('aria-pressed', 'true');
    try {
      for (const [index, step] of walkthroughSteps.entries()) {
        if (run !== generation) return;
        document.body.dataset.walkthroughStep = step.id;
        document.getElementById('walkthrough-count')!.textContent = `${index + 1} / ${walkthroughSteps.length}`;
        document.getElementById('walkthrough-title')!.textContent = step.title;
        document.getElementById('walkthrough-instruction')!.textContent = step.instruction;
        document.getElementById('walkthrough-input')!.textContent = step.inputs.map(input => 'key' in input ? input.key : 'wheel' in input ? 'Scroll ↓' : 'Click action').join(' → ');
        const before = readWalkthroughState();
        const started = performance.now();
        step.inputs.forEach(perform);
        let passed = false;
        while (run === generation && performance.now() - started < 6000) {
          await pause(40);
          const state = readWalkthroughState();
          passed = Object.entries(step.expect).every(([key, value]) => state[key] === value) && (step.changed ?? []).every(key => state[key] !== before[key]);
          if (passed) break;
        }
        if (run !== generation) return;
        results.push({ id: step.id, passed, milliseconds: Math.round(performance.now() - started) }); publish();
        if (!passed) throw new Error(`Step ${step.id} did not reach its expected state`);
        const line = new Error().stack?.split('\n')[1]?.match(/:(\d+):\d+\)?$/)?.[1] ?? '0';
        console.log(`[${new Date().toISOString()}, INFO, walkthrough.ts, start, ${line}] PASS ${step.id}`);
        // Playback demonstrations must not silently advance while explaining their start/stop controls.
        await pause(step.expect.playing === 'true' ? 150 : 3200 / speed);
      }
      if (run !== generation) return;
      document.getElementById('walkthrough-title')!.textContent = 'Walkthrough complete';
      document.getElementById('walkthrough-instruction')!.textContent = `${results.length} verified steps. Your previous graph edits have been restored. Press W to replay, or continue exploring.`;
      stop('completed');
    } catch (error) {
      document.getElementById('walkthrough-title')!.textContent = 'Walkthrough needs attention';
      document.getElementById('walkthrough-instruction')!.textContent = String(error);
      console.error(`[${new Date().toISOString()}, ERROR, walkthrough.ts, start, 0] ${String(error)}`);
      stop('error');
    }
  }
  return { start, stop, get running() { return active; } };
}
