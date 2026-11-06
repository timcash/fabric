import test from 'node:test';
import assert from 'node:assert/strict';
import { getResolution, isPentagon, isValidCell } from 'h3-js';
import {
  DENVER, EXAMPLE_RESOLUTION, areaKm2, boundaryOf, cellAt, childrenOf,
  distanceBetween, neighborsOf, parentOf, summarizeCell,
} from '../src/h3-example.ts';

test('the Denver cell is valid, nests in its parent, and measures grid distance', () => {
  const res = EXAMPLE_RESOLUTION;
  const cell = cellAt(DENVER.lat, DENVER.lng, res);
  assert.ok(isValidCell(cell));
  assert.equal(getResolution(cell), res);

  assert.equal(boundaryOf(cell).length, isPentagon(cell) ? 5 : 6);

  const disk = neighborsOf(cell, 1);
  assert.equal(disk.length, 7);
  assert.ok(disk.includes(cell));

  const parent = parentOf(cell, res - 1);
  assert.equal(getResolution(parent), res - 1);
  assert.ok(childrenOf(parent, res).includes(cell), 'The cell lies inside its parent');

  const neighbor = disk.find(other => other !== cell)!;
  assert.equal(distanceBetween(cell, neighbor), 1);
  assert.equal(distanceBetween(cell, cell), 0);

  const area = areaKm2(cell);
  assert.ok(area > 0.05 && area < 0.2, `Resolution 9 area is about 0.1 km2, got ${area}`);

  const summary = summarizeCell(DENVER.lat, DENVER.lng, res);
  assert.equal(summary.cell, cell);
  assert.equal(summary.resolution, res);
  assert.equal(summary.parent, parent);
  assert.equal(summary.children.length, 7);
  assert.equal(summary.neighborDistance, 1);
  assert.deepEqual(summary.disk, disk);
});
