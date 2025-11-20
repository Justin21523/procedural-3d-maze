/**
 * Room decoration props (furniture, objects, etc.)
 * Creates simple 3D models for different room types
 */

import * as THREE from 'three';
import { ROOM_TYPES } from '../world/tileTypes.js';
import { CONFIG } from '../core/config.js';

/**
 * Create a desk (for classroom/office)
 * @param {number} x - World X position
 * @param {number} z - World Z position
 * @param {number} color - Desk color
 * @returns {THREE.Group} Desk mesh group
 */
export function createDesk(x, z, color = 0x8b7355) {
  const group = new THREE.Group();

  // Desktop
  const topGeometry = new THREE.BoxGeometry(1.2, 0.05, 0.6);
  const deskMaterial = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.7,
    metalness: 0.1,
  });
  const top = new THREE.Mesh(topGeometry, deskMaterial);
  top.position.y = 0.7;
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  // Legs
  const legGeometry = new THREE.BoxGeometry(0.05, 0.7, 0.05);
  const legPositions = [
    { x: -0.55, z: -0.25 },
    { x: -0.55, z: 0.25 },
    { x: 0.55, z: -0.25 },
    { x: 0.55, z: 0.25 },
  ];

  legPositions.forEach(pos => {
    const leg = new THREE.Mesh(legGeometry, deskMaterial);
    leg.position.set(pos.x, 0.35, pos.z);
    leg.castShadow = true;
    group.add(leg);
  });

  group.position.set(x, 0, z);
  return group;
}

/**
 * Create a chair
 * @param {number} x - World X position
 * @param {number} z - World Z position
 * @param {number} rotation - Rotation in radians
 * @param {number} color - Chair color
 * @returns {THREE.Group} Chair mesh group
 */
export function createChair(x, z, rotation = 0, color = 0x5c3a1e) {
  const group = new THREE.Group();

  const chairMaterial = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.8,
    metalness: 0,
  });

  // Seat
  const seatGeometry = new THREE.BoxGeometry(0.4, 0.05, 0.4);
  const seat = new THREE.Mesh(seatGeometry, chairMaterial);
  seat.position.y = 0.4;
  seat.castShadow = true;
  seat.receiveShadow = true;
  group.add(seat);

  // Backrest
  const backGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.05);
  const back = new THREE.Mesh(backGeometry, chairMaterial);
  back.position.set(0, 0.6, -0.175);
  back.castShadow = true;
  group.add(back);

  // Legs
  const legGeometry = new THREE.BoxGeometry(0.05, 0.4, 0.05);
  const legPositions = [
    { x: -0.15, z: -0.15 },
    { x: -0.15, z: 0.15 },
    { x: 0.15, z: -0.15 },
    { x: 0.15, z: 0.15 },
  ];

  legPositions.forEach(pos => {
    const leg = new THREE.Mesh(legGeometry, chairMaterial);
    leg.position.set(pos.x, 0.2, pos.z);
    leg.castShadow = true;
    group.add(leg);
  });

  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

/**
 * Create a bookshelf (for library)
 * @param {number} x - World X position
 * @param {number} z - World Z position
 * @param {number} rotation - Rotation in radians
 * @returns {THREE.Group} Bookshelf mesh group
 */
export function createBookshelf(x, z, rotation = 0) {
  const group = new THREE.Group();

  const shelfMaterial = new THREE.MeshStandardMaterial({
    color: 0x6b4423,
    roughness: 0.9,
    metalness: 0,
  });

  // Frame
  const frameGeometry = new THREE.BoxGeometry(1.5, 2, 0.3);
  const frame = new THREE.Mesh(frameGeometry, shelfMaterial);
  frame.position.y = 1;
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  // Shelves
  for (let i = 0; i < 4; i++) {
    const shelfGeometry = new THREE.BoxGeometry(1.4, 0.03, 0.28);
    const shelf = new THREE.Mesh(shelfGeometry, shelfMaterial);
    shelf.position.y = 0.5 + i * 0.5;
    shelf.castShadow = true;
    group.add(shelf);
  }

  // Books (simple colored boxes)
  const bookColors = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3, 0xf38181];
  for (let shelf = 0; shelf < 3; shelf++) {
    for (let book = 0; book < 8; book++) {
      const bookGeometry = new THREE.BoxGeometry(0.08, 0.35, 0.15);
      const bookMaterial = new THREE.MeshStandardMaterial({
        color: bookColors[Math.floor(Math.random() * bookColors.length)],
        roughness: 0.8,
      });
      const bookMesh = new THREE.Mesh(bookGeometry, bookMaterial);
      bookMesh.position.set(
        -0.6 + book * 0.16,
        0.7 + shelf * 0.5,
        0
      );
      bookMesh.rotation.y = (Math.random() - 0.5) * 0.2;
      bookMesh.castShadow = true;
      group.add(bookMesh);
    }
  }

  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

/**
 * Create a toilet (for bathroom)
 * @param {number} x - World X position
 * @param {number} z - World Z position
 * @param {number} rotation - Rotation in radians
 * @returns {THREE.Group} Toilet mesh group
 */
export function createToilet(x, z, rotation = 0) {
  const group = new THREE.Group();

  const porcelainMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.3,
  });

  // Bowl
  const bowlGeometry = new THREE.CylinderGeometry(0.25, 0.2, 0.4, 16);
  const bowl = new THREE.Mesh(bowlGeometry, porcelainMaterial);
  bowl.position.y = 0.2;
  bowl.castShadow = true;
  bowl.receiveShadow = true;
  group.add(bowl);

  // Seat
  const seatGeometry = new THREE.TorusGeometry(0.25, 0.03, 8, 16);
  const seat = new THREE.Mesh(seatGeometry, porcelainMaterial);
  seat.position.y = 0.4;
  seat.rotation.x = Math.PI / 2;
  seat.castShadow = true;
  group.add(seat);

  // Tank
  const tankGeometry = new THREE.BoxGeometry(0.4, 0.5, 0.15);
  const tank = new THREE.Mesh(tankGeometry, porcelainMaterial);
  tank.position.set(0, 0.5, -0.2);
  tank.castShadow = true;
  group.add(tank);

  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

/**
 * Create a sink (for bathroom)
 * @param {number} x - World X position
 * @param {number} z - World Z position
 * @param {number} rotation - Rotation in radians
 * @returns {THREE.Group} Sink mesh group
 */
export function createSink(x, z, rotation = 0) {
  const group = new THREE.Group();

  const porcelainMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.3,
  });

  // Basin
  const basinGeometry = new THREE.CylinderGeometry(0.25, 0.2, 0.15, 16);
  const basin = new THREE.Mesh(basinGeometry, porcelainMaterial);
  basin.position.y = 0.8;
  basin.castShadow = true;
  basin.receiveShadow = true;
  group.add(basin);

  // Pedestal
  const pedestalGeometry = new THREE.CylinderGeometry(0.15, 0.2, 0.8, 12);
  const pedestal = new THREE.Mesh(pedestalGeometry, porcelainMaterial);
  pedestal.position.y = 0.4;
  pedestal.castShadow = true;
  group.add(pedestal);

  // Faucet
  const faucetMaterial = new THREE.MeshStandardMaterial({
    color: 0xc0c0c0,
    roughness: 0.3,
    metalness: 0.8,
  });
  const faucetGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8);
  const faucet = new THREE.Mesh(faucetGeometry, faucetMaterial);
  faucet.position.set(0, 1, 0);
  faucet.castShadow = true;
  group.add(faucet);

  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

/**
 * Create storage boxes (for storage room)
 * @param {number} x - World X position
 * @param {number} z - World Z position
 * @returns {THREE.Group} Box stack mesh group
 */
export function createBoxStack(x, z) {
  const group = new THREE.Group();

  const boxColors = [0x8b7355, 0xa0826d, 0x6b5d52];

  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const boxGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
      const boxMaterial = new THREE.MeshStandardMaterial({
        color: boxColors[Math.floor(Math.random() * boxColors.length)],
        roughness: 0.9,
        metalness: 0,
      });
      const box = new THREE.Mesh(boxGeometry, boxMaterial);
      box.position.set(
        i * 0.42 - 0.21,
        j * 0.4 + 0.2,
        0
      );
      box.rotation.y = (Math.random() - 0.5) * 0.3;
      box.castShadow = true;
      box.receiveShadow = true;
      group.add(box);
    }
  }

  group.position.set(x, 0, z);
  return group;
}

/**
 * Generate props for a room based on room type
 * @param {number} roomType - Room type from ROOM_TYPES
 * @param {number} gridX - Grid X position
 * @param {number} gridY - Grid Y position
 * @param {Array<Array<number>>} grid - Maze grid for collision checking
 * @returns {Array<THREE.Group>} Array of prop meshes
 */
export function generateRoomProps(roomType, gridX, gridY, grid) {
  const props = [];
  const worldX = gridX * CONFIG.TILE_SIZE;
  const worldZ = gridY * CONFIG.TILE_SIZE;

  // Random chance to place props (higher for non-corridor rooms)
  const placementChance = (roomType === ROOM_TYPES.CORRIDOR) ? 0.15 : 0.35;
  if (Math.random() > placementChance) return props;

  switch (roomType) {
    case ROOM_TYPES.CLASSROOM:
      // Desk with chair
      if (Math.random() > 0.5) {
        props.push(createDesk(worldX, worldZ, 0xb8a68f));
        props.push(createChair(worldX, worldZ + 0.5, 0, 0x8b7355));
      }
      break;

    case ROOM_TYPES.OFFICE:
      // Desk with chair, darker wood
      if (Math.random() > 0.5) {
        props.push(createDesk(worldX, worldZ, 0x5c3a1e));
        props.push(createChair(worldX, worldZ + 0.5, 0, 0x3d2817));
      }
      break;

    case ROOM_TYPES.BATHROOM:
      // Toilet or sink
      if (Math.random() > 0.7) {
        props.push(createToilet(worldX, worldZ, Math.random() * Math.PI * 2));
      } else if (Math.random() > 0.6) {
        props.push(createSink(worldX, worldZ, Math.random() * Math.PI * 2));
      }
      break;

    case ROOM_TYPES.STORAGE:
      // Boxes
      if (Math.random() > 0.6) {
        props.push(createBoxStack(worldX, worldZ));
      }
      break;

    case ROOM_TYPES.LIBRARY:
      // Bookshelf
      if (Math.random() > 0.7) {
        props.push(createBookshelf(worldX, worldZ, Math.random() * Math.PI * 2));
      }
      break;
  }

  return props;
}
