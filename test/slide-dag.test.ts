import test from 'node:test';
import assert from 'node:assert/strict';
import { slides } from '../src/slides.ts';
import { SlideDagState, slideDagNodes, slideDagEdges, resolveLayer, layoutWorkplane, lodForDistance } from '../src/slide-dag.ts';

test('the slide DAG contains exactly the five presentation slides', () => {
  assert.deepEqual(slideDagNodes.map(node => node.id), slides.map(slide => slide.id));
  const layout = layoutWorkplane(slideDagNodes, slideDagEdges);
  for (const edge of slideDagEdges) assert.ok(layout.find(node => node.id === edge.from)!.rank < layout.find(node => node.id === edge.to)!.rank);
  const interact = layout.find(node => node.id === 'interact')!;
  const playback = layout.find(node => node.id === 'playback')!;
  assert.equal(interact.rank, playback.rank);
  assert.equal(Math.abs(interact.z - playback.z), 7);
  assert.equal(layout.find(node => node.id === 'navigate')!.x - layout.find(node => node.id === 'welcome')!.x, 8.5);
});
test('every example node opens its interior and returns to its parent selection', () => {
  for (const slide of slides) {
    const state = new SlideDagState();
    state.select(slide.id);
    assert.ok(state.enter());
    assert.equal(state.path.length, 1);
    assert.equal(state.layer.nodes.length, slide.children!.length);
    assert.ok(state.layer.nodes.every(node => node.slideId === slide.id));
    assert.ok(state.back());
    assert.equal(state.selected, slide.id);
    assert.equal(state.path.length, 0);
  }
});
test('node interiors support multiple depths, empty nodes, and root recovery', () => {
  const state = new SlideDagState();
  state.select('interact'); state.enter(); state.select('interact/edit'); state.enter();
  assert.equal(state.path.length, 2);
  assert.deepEqual(state.layer.nodes.map(node => node.id), ['interact/edit/create', 'interact/edit/color', 'interact/edit/remove']);
  assert.equal(state.enter(), true);
  assert.equal(state.layer.nodes.length, 0);
  assert.equal(resolveLayer([...state.path, 'invalid']).path.length, 3);
  assert.ok(state.back()); assert.equal(state.selected, 'interact/edit/create');
  assert.ok(state.back()); assert.equal(state.selected, 'interact/edit');
  state.root(); assert.equal(state.selected, 'interact');
  assert.equal(state.back(), false);
});
test('one root owns every node; empty nodes support at least 512 recursive opens', () => {
  const state = new SlideDagState();
  assert.equal(state.rootNode.id, 'root'); assert.equal(state.rootNode.parentId, null);
  assert.ok(state.nodes.every(node => node.parentId === 'root'));
  state.select('interact'); state.enter(); state.select('interact/edit'); state.enter(); state.enter();
  const depth = state.path.length;
  for (let i = 0; i < 512; i++) {
    const owner = state.layer.owner;
    const child = state.create();
    assert.equal(child.parentId, owner.id);
    assert.equal(state.find(child.id), child);
    assert.ok(state.enter()); assert.equal(state.layer.owner.id, child.id);
    assert.equal(state.layer.nodes.length, 0);
  }
  const snapshot = state.snapshot(); state.root(); state.restore(snapshot);
  assert.equal(state.path.length, depth + 512);
  while (state.back()) {}
  assert.equal(state.layer.owner.id, 'root');
});
test('created siblings link only within their parent; deleting removes descendants and links', () => {
  const state = new SlideDagState(); state.enter(); state.enter();
  const a = state.create(); const b = state.create();
  assert.deepEqual(state.layer.edges.at(-1), { from: a.id, to: b.id });
  assert.doesNotThrow(() => layoutWorkplane(state.layer.nodes, state.layer.edges));
  state.enter(); const child = state.create(); state.back();
  assert.ok(state.remove()); assert.equal(state.find(child.id), undefined);
  assert.ok(state.layer.edges.every(edge => edge.to !== b.id && edge.from !== b.id));
  state.root(); assert.equal(state.remove(), false); // Authored slides are protected.
});
test('rank navigation and dependency tracing do not change containment', () => {
  const state = new SlideDagState();
  state.navigate('downstream'); assert.equal(state.selected, 'navigate');
  state.navigate('downstream'); assert.equal(state.selected, 'interact');
  state.navigate('lane-next'); assert.equal(state.selected, 'playback');
  state.navigate('lane-previous'); assert.equal(state.selected, 'interact');
  assert.deepEqual(state.traceIds(), ['interact', 'navigate', 'make-it-yours']);
  state.navigate('predecessor'); assert.equal(state.selected, 'navigate');
  assert.equal(state.path.length, 0);
});
test('layout rejects cycles, duplicate nodes, and broken links', () => {
  assert.throws(() => layoutWorkplane([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]), /cycles/);
  assert.throws(() => layoutWorkplane([{ id: 'a' }, { id: 'a' }], []), /Duplicate/);
  assert.throws(() => layoutWorkplane([{ id: 'a' }], [{ from: 'a', to: 'missing' }]), /Unknown/);
});
test('zoom chooses graph-point, title-only, and full-content detail', () => {
  assert.equal(lodForDistance(90), 0);
  assert.equal(lodForDistance(42), 1);
  assert.equal(lodForDistance(18), 2);
});
