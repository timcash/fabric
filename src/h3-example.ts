/**
 * A small, self-contained H3 example built on h3-js (v4).
 *
 * H3 is Uber's hierarchical hexagonal grid. Every point on Earth maps to one
 * cell per resolution (0 is coarsest, 15 is finest). Cells nest into parents,
 * have six neighbors (five for the twelve pentagons per resolution), and can be
 * compared by grid distance.
 *
 * These helpers are pure: they take plain values and return plain values. The
 * module is not used by the Three.js scene or the slides.
 */
import {
  UNITS,
  cellArea,
  cellToBoundary,
  cellToChildren,
  cellToParent,
  getResolution,
  gridDisk,
  gridDistance,
  isPentagon,
  isValidCell,
  latLngToCell,
} from 'h3-js';

/** Downtown Denver, Colorado, used as the example location. */
export const DENVER = { lat: 39.7392, lng: -104.9903 } as const;

/** Resolution 9 cells average about 0.1 km2, roughly a city block. */
export const EXAMPLE_RESOLUTION = 9;

/**
 * Finds the H3 cell containing a point.
 * @param lat Latitude in degrees.
 * @param lng Longitude in degrees.
 * @param res Resolution from 0 (coarsest) to 15 (finest).
 * @returns The cell index as a 15-character hex string.
 */
export function cellAt(lat: number, lng: number, res: number): string {
  return latLngToCell(lat, lng, res);
}

/**
 * Returns the cell outline as [lat, lng] vertex pairs in degrees.
 * Hexagons have 6 vertices and pentagons have 5. Cells crossing an
 * icosahedron edge can have extra distortion vertices.
 */
export function boundaryOf(cell: string): [number, number][] {
  return cellToBoundary(cell) as [number, number][];
}

/**
 * Returns every cell within k grid steps, including the cell itself.
 * For k = 1 this is the cell plus its direct neighbors (7 for a hexagon).
 */
export function neighborsOf(cell: string, k = 1): string[] {
  return gridDisk(cell, k);
}

/**
 * Returns the ancestor cell at a coarser resolution.
 * @param res Must be less than or equal to the cell's own resolution.
 */
export function parentOf(cell: string, res: number): string {
  return cellToParent(cell, res);
}

/**
 * Returns all descendants of a cell at a finer resolution.
 * A hexagon has 7 children one level down; the count grows by 7 per level.
 */
export function childrenOf(cell: string, res: number): string[] {
  return cellToChildren(cell, res);
}

/**
 * Returns the number of grid steps between two cells at the same resolution.
 * Throws if the cells are too far apart or separated by a pentagon.
 */
export function distanceBetween(a: string, b: string): number {
  return gridDistance(a, b);
}

/** Returns the exact area of a cell in square kilometers. */
export function areaKm2(cell: string): number {
  return cellArea(cell, UNITS.km2);
}

/** Plain-object summary produced by {@link summarizeCell}. */
export interface CellSummary {
  cell: string;
  resolution: number;
  valid: boolean;
  pentagon: boolean;
  boundary: [number, number][];
  /** gridDisk(cell, 1): the cell and its direct neighbors. */
  disk: string[];
  /** Parent one resolution coarser, or null at resolution 0. */
  parent: string | null;
  /** Children one resolution finer, or an empty list at resolution 15. */
  children: string[];
  /** Grid distance from the cell to its first neighbor (1). */
  neighborDistance: number;
  areaKm2: number;
}

/**
 * Collects the facts above for the cell containing a point.
 * @example summarizeCell(DENVER.lat, DENVER.lng, EXAMPLE_RESOLUTION)
 */
export function summarizeCell(lat: number, lng: number, res: number): CellSummary {
  const cell = cellAt(lat, lng, res);
  const resolution = getResolution(cell);
  const disk = neighborsOf(cell, 1);
  const neighbor = disk.find(other => other !== cell)!;
  return {
    cell,
    resolution,
    valid: isValidCell(cell),
    pentagon: isPentagon(cell),
    boundary: boundaryOf(cell),
    disk,
    parent: resolution > 0 ? parentOf(cell, resolution - 1) : null,
    children: resolution < 15 ? childrenOf(cell, resolution + 1) : [],
    neighborDistance: distanceBetween(cell, neighbor),
    areaKm2: areaKm2(cell),
  };
}
