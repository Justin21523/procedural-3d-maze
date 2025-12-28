import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { TILE_TYPES } from '../world/tileTypes.js';

/**
 * Build a lightweight 3D overlay showing tiles blocked by `worldState.obstacleMap`.
 * Intended for tuning obstacle placement without guessing.
 *
 * @param {WorldState} worldState
 * @returns {THREE.InstancedMesh|null}
 */
export function createObstacleOverlayMesh(worldState) {
  const grid = worldState?.getGrid?.();
  const obstacleMap = worldState?.obstacleMap || null;
  if (!grid || !obstacleMap) return null;

  const height = grid.length;
  const width = grid?.[0]?.length || 0;
  if (!height || !width) return null;

  let count = 0;
  for (let y = 0; y < height; y++) {
    const row = obstacleMap[y];
    const gridRow = grid[y];
    if (!row || !gridRow) continue;
    for (let x = 0; x < width; x++) {
      if (!row[x]) continue;
      if (gridRow[x] === TILE_TYPES.WALL) continue;
      count += 1;
    }
  }
  if (count <= 0) return null;

  const tileSize = CONFIG.TILE_SIZE || 1;
  const geometry = new THREE.PlaneGeometry(tileSize, tileSize);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshBasicMaterial({
    color: 0xff3333,
    transparent: true,
    opacity: 0.26,
    depthWrite: false
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = '__obstacleOverlay';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  const matrix = new THREE.Matrix4();
  const yOffset = 0.035;
  let idx = 0;

  for (let y = 0; y < height; y++) {
    const row = obstacleMap[y];
    const gridRow = grid[y];
    if (!row || !gridRow) continue;
    for (let x = 0; x < width; x++) {
      if (!row[x]) continue;
      if (gridRow[x] === TILE_TYPES.WALL) continue;
      matrix.makeTranslation(
        x * tileSize + tileSize / 2,
        yOffset,
        y * tileSize + tileSize / 2
      );
      mesh.setMatrixAt(idx, matrix);
      idx += 1;
    }
  }

  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

