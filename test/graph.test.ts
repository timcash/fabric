import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoGraph } from '../src/graph.ts';
import { SlideDagState } from '../src/slide-dag.ts';

test('adding connects the selected parent and every link stays acyclic', () => {
  const graph = new DemoGraph();
  graph.select(3);
  assert.equal(graph.add(), true);
  assert.equal(graph.selected, 6);
  assert.deepEqual(graph.edges.at(-1), { from: 3, to: 6 });
  while (graph.add()) {}
  assert.equal(graph.nodes.length, 12);
  assert.ok(graph.edges.every(edge => edge.from < edge.to));
  assert.equal(graph.add(), false);
});
test('the slide example and recursive DAG share the exact same child nodes', () => {
  const state = new SlideDagState(); const graph = new DemoGraph(state);
  graph.select(2); graph.recolor();
  assert.equal(state.find('demo-2')!.color, 1);
  state.path = ['interact', 'interact/select']; state.selected = 'demo-2';
  const node = state.create();
  assert.equal(graph.nodes.length, 6);
  assert.equal(node.parentId, 'interact/select');
  state.enter(); state.create(); state.back(); state.remove();
  assert.equal(graph.nodes.length, 5);
  graph.selected = 6; assert.equal(graph.selected, 5, 'Removing in DAG cannot leave a stale slide selection');
});
test('deletion removes incident links and empty graphs can be repopulated', () => {
  const graph = new DemoGraph();
  graph.select(4);
  graph.remove();
  assert.ok(graph.edges.every(edge => edge.from !== 4 && edge.to !== 4));
  while (graph.remove()) {}
  assert.equal(graph.nodes.length, 0);
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.selected, null);
  assert.equal(graph.add(), true);
  assert.equal(graph.edges.length, 0);
});
test('selection, recoloring, and reset affect the actual graph state', () => {
  const graph = new DemoGraph();
  graph.select(2);
  graph.recolor();
  assert.equal(graph.nodes.find(node => node.id === 2)?.color, 1);
  graph.select(999);
  assert.equal(graph.selected, 2);
  graph.add();
  graph.reset();
  assert.equal(graph.nodes.length, 5);
  assert.equal(graph.edges.length, 5);
  assert.equal(graph.selected, 1);
  assert.ok(graph.nodes.every(node => node.color === 0));
});
