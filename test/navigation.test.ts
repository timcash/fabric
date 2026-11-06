import test from 'node:test';
import assert from 'node:assert/strict';
import { WheelGate, indexFromHash, tourDuration, clampSlide } from '../src/navigation.ts';
import { slides } from '../src/slides.ts';

test('exactly five examples have unique working links and actions', () => {
  assert.equal(slides.length, 5);
  assert.equal(new Set(slides.map(slide => slide.id)).size, 5);
  slides.forEach((slide, i) => { assert.equal(indexFromHash(`#${slide.id}`, slides), i); assert.ok(slide.action.label); });
  assert.equal(indexFromHash('#unknown', slides), 0);
});
test('a continuous momentum gesture advances just once', () => {
  const gate = new WheelGate();
  let total = 0;
  for (let now = 0; now < 3000; now += 25) total += gate.consume(now < 100 ? 120 : 8, now);
  assert.equal(total, 1);
  assert.equal(gate.consume(-120, 3400), -1);
});
test('a gesture begun inside the cooldown never advances late', () => {
  const gate = new WheelGate();
  assert.equal(gate.consume(90, 0), 1);
  assert.equal(gate.consume(90, 300), 0);
  for (let now = 325; now < 1500; now += 25) assert.equal(gate.consume(20, now), 0);
  assert.equal(gate.consume(90, 1800), 1);
});
test('tiny deltas accumulate; invalid input is ignored', () => {
  const gate = new WheelGate();
  assert.equal(gate.consume(NaN, 0), 0);
  assert.equal(gate.consume(8, 20), 0);
  assert.equal(gate.consume(8, 30), 0);
  assert.equal(gate.consume(8, 40), 1);
});
test('timing is bounded and slide navigation never wraps', () => {
  assert.equal(tourDuration(null), 10000);
  assert.equal(tourDuration('NaN'), 10000);
  assert.equal(tourDuration('-4'), 10000);
  assert.equal(tourDuration('100'), 800);
  assert.equal(tourDuration('90000'), 60000);
  assert.equal(tourDuration('2000'), 2000);
  assert.equal(clampSlide(-1, 5), 0);
  assert.equal(clampSlide(5, 5), 4);
});
