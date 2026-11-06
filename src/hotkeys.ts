export type Scope = 'Both modes' | 'Slide mode' | 'Interact slide' | 'DAG mode';
export const hotkeys = [
  { action: 'mode', scope: 'Both modes', keys: ['g', '/'], label: 'Switch Slide / DAG mode' },
  { action: 'guide', scope: 'Both modes', keys: ['?'], label: 'Open guide and hotkey reference' },
  { action: 'walkthrough', scope: 'Both modes', keys: ['w'], label: 'Start / stop controls walkthrough' },
  { action: 'cancel', scope: 'Both modes', keys: ['Escape'], label: 'Stop; close guide; otherwise return to parent in DAG' },
  { action: 'orbit-right', scope: 'Both modes', keys: ['o'], label: 'Orbit clockwise' },
  { action: 'orbit-left', scope: 'Both modes', keys: ['Shift+o'], label: 'Orbit counterclockwise' },
  { action: 'camera-reset', scope: 'Both modes', keys: ['r'], label: 'Reset slide camera / frame current DAG layer' },
  { action: 'previous', scope: 'Slide mode', keys: ['ArrowUp', 'ArrowLeft', 'PageUp'], label: 'Previous slide' },
  { action: 'next', scope: 'Slide mode', keys: ['ArrowDown', 'ArrowRight', 'PageDown'], label: 'Next slide' },
  { action: 'first', scope: 'Slide mode', keys: ['Home'], label: 'First slide' },
  { action: 'last', scope: 'Slide mode', keys: ['End'], label: 'Last slide' },
  { action: 'slide-action', scope: 'Slide mode', keys: ['Enter'], label: 'Invoke this slide’s action' },
  { action: 'playback', scope: 'Slide mode', keys: ['Space'], label: 'Start / pause story playback' },
  { action: 'demo-previous', scope: 'Interact slide', keys: ['['], label: 'Select previous demo node' },
  { action: 'demo-next', scope: 'Interact slide', keys: [']'], label: 'Select next demo node' },
  { action: 'node-open', scope: 'Both modes', keys: ['n'], label: 'Open selected node’s child DAG' },
  { action: 'node-parent', scope: 'Both modes', keys: ['t'], label: 'Return to parent node' },
  { action: 'node-create', scope: 'Both modes', keys: ['c'], label: 'Create a node inside the open parent' },
  { action: 'node-color', scope: 'Both modes', keys: ['x'], label: 'Recolor selected node' },
  { action: 'node-remove', scope: 'Both modes', keys: ['Delete', 'Backspace'], label: 'Remove a created node and its descendants' },
  { action: 'demo-reset', scope: 'Interact slide', keys: ['Shift+r'], label: 'Reset demo graph' },
  { action: 'dag-previous', scope: 'DAG mode', keys: ['['], label: 'Select previous peer' },
  { action: 'dag-next', scope: 'DAG mode', keys: [']'], label: 'Select next peer' },
  { action: 'dag-upstream', scope: 'DAG mode', keys: ['h'], label: 'Select upstream rank' },
  { action: 'dag-downstream', scope: 'DAG mode', keys: ['l'], label: 'Select downstream rank' },
  { action: 'dag-lane-next', scope: 'DAG mode', keys: ['j'], label: 'Select next lane' },
  { action: 'dag-lane-previous', scope: 'DAG mode', keys: ['k'], label: 'Select previous lane' },
  { action: 'dag-predecessor', scope: 'DAG mode', keys: ['u', 'p'], label: 'Follow an incoming dependency' },
  { action: 'dag-focus', scope: 'DAG mode', keys: ['Enter'], label: 'Focus selected node' },
  { action: 'dag-trace', scope: 'DAG mode', keys: ['Shift+Enter'], label: 'Toggle direct-neighbor trace' },
  { action: 'dag-root', scope: 'DAG mode', keys: ['f', 'Home'], label: 'Show all slides' },
  { action: 'dag-present', scope: 'DAG mode', keys: ['v'], label: 'Present owning slide' },
  { action: 'pan-left', scope: 'DAG mode', keys: ['ArrowLeft'], label: 'Pan left' },
  { action: 'pan-right', scope: 'DAG mode', keys: ['ArrowRight'], label: 'Pan right' },
  { action: 'pan-up', scope: 'DAG mode', keys: ['ArrowUp'], label: 'Pan up' },
  { action: 'pan-down', scope: 'DAG mode', keys: ['ArrowDown'], label: 'Pan down' },
  { action: 'detail-more', scope: 'DAG mode', keys: ['Shift+ArrowUp'], label: 'Increase detail' },
  { action: 'detail-less', scope: 'DAG mode', keys: ['Shift+ArrowDown'], label: 'Decrease detail' },
  { action: 'zoom-in', scope: 'DAG mode', keys: ['+', '='], label: 'Zoom in' },
  { action: 'zoom-out', scope: 'DAG mode', keys: ['-'], label: 'Zoom out' },
] as const satisfies readonly { action: string; scope: Scope; keys: readonly string[]; label: string }[];
export type Action = typeof hotkeys[number]['action'];

export function resolveHotkey(key: string, shift: boolean, mode: 'slides' | 'dag', slide: string): Action | undefined {
  const normalized = key === ' ' ? 'Space' : key.length === 1 && /[a-z]/i.test(key) ? key.toLowerCase() : key;
  const chord = shift && !['?', '+'].includes(normalized) ? `Shift+${normalized}` : normalized;
  return hotkeys.find(binding => (binding.keys as readonly string[]).includes(chord) && (
    binding.scope === 'Both modes' || binding.scope === (mode === 'dag' ? 'DAG mode' : 'Slide mode') ||
    (binding.scope === 'Interact slide' && mode === 'slides' && slide === 'interact')
  ))?.action;
}

export function hotkeyMarkdown() {
  return ['## Executable hotkey catalog', '', '| Context | Hotkey | Action |', '| --- | --- | --- |',
    ...hotkeys.map(item => `| ${item.scope} | ${item.keys.map(key => `\`${key}\``).join(' / ')} | ${item.label} |`),
  ].join('\n');
}
