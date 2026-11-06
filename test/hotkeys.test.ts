import test from 'node:test';
import assert from 'node:assert/strict';
import { hotkeys, resolveHotkey } from '../src/hotkeys.ts';
import { walkthroughSteps, walkthroughSpeed } from '../src/walkthrough-steps.ts';

test('open/create/color/parent have the same meaning in both views', () => {
  for (const mode of ['slides', 'dag'] as const) {
    assert.equal(resolveHotkey('n', false, mode, 'interact'), 'node-open');
    assert.equal(resolveHotkey('c', false, mode, 'interact'), 'node-create');
    assert.equal(resolveHotkey('x', false, mode, 'interact'), 'node-color');
    assert.equal(resolveHotkey('t', false, mode, 'interact'), 'node-parent');
  }
});
test('every published binding resolves without conflicting actions', () => {
  for (const item of hotkeys) for (const chord of item.keys) {
    const shift = chord.startsWith('Shift+'); const key = shift ? chord.slice(6) : chord;
    const contexts = item.scope === 'Both modes' ? ['slides', 'dag'] as const : [item.scope === 'DAG mode' ? 'dag' : 'slides'] as const;
    for (const mode of contexts) assert.equal(resolveHotkey(key === 'Space' ? ' ' : key, shift, mode, 'interact'), item.action, `${mode}: ${chord}`);
  }
  assert.equal(resolveHotkey('R', true, 'slides', 'interact'), 'demo-reset');
  assert.equal(resolveHotkey('ArrowUp', true, 'dag', ''), 'detail-more');
  assert.equal(resolveHotkey('?', true, 'dag', ''), 'guide');
});
test('shared walkthrough steps have unique IDs, real inputs, and assertions', () => {
  assert.equal(new Set(walkthroughSteps.map(step => step.id)).size, walkthroughSteps.length);
  for (const step of walkthroughSteps) {
    assert.ok(step.inputs.length); assert.ok(Object.keys(step.expect).length || step.changed?.length);
  }
  assert.equal(walkthroughSpeed(null), 1); assert.equal(walkthroughSpeed('0'), 1);
  assert.equal(walkthroughSpeed('100'), 20); assert.equal(walkthroughSpeed('.01'), .25);
});
