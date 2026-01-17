import * as THREE from 'three';

function makeEmissiveMaterial(color, emissive, emissiveIntensity = 0.35, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness: 0.55,
    metalness: 0.08,
    transparent: options.transparent === true,
    opacity: Number.isFinite(options.opacity) ? options.opacity : 1.0
  });
}

export function createKeycardPickupObject() {
  const group = new THREE.Group();
  const bodyMat = makeEmissiveMaterial(0x90caf9, 0x42a5f5, 0.55);
  const stripeMat = makeEmissiveMaterial(0x263238, 0x000000, 0.0);

  const card = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.02), bodyMat);
  card.position.set(0, 0.16, 0);
  group.add(card);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.021), stripeMat);
  stripe.position.set(0, 0.19, 0.01);
  group.add(stripe);

  group.userData.__kind = 'keycardPickup';
  return group;
}

export function createLockedDoorBarrierObject() {
  const group = new THREE.Group();
  const frameMat = makeEmissiveMaterial(0xff1744, 0xff5252, 0.45);
  const paneMat = makeEmissiveMaterial(0xff5252, 0xff1744, 0.65, { transparent: true, opacity: 0.28 });

  const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), frameMat);
  frameL.position.set(-0.46, 0.8, 0);
  group.add(frameL);

  const frameR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), frameMat);
  frameR.position.set(0.46, 0.8, 0);
  group.add(frameR);

  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.08), frameMat);
  frameTop.position.set(0, 1.56, 0);
  group.add(frameTop);

  const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.46), paneMat);
  pane.position.set(0, 0.8, 0);
  group.add(pane);

  group.userData.__kind = 'lockedDoorBarrier';
  group.userData.__pane = pane;
  setLockedDoorBarrierState(group, { unlocked: false });
  return group;
}

export function setLockedDoorBarrierState(object3d, { unlocked = false } = {}) {
  const g = object3d;
  g.userData.__unlocked = unlocked === true;
  const pane = g?.userData?.__pane || null;
  if (pane?.material && !Array.isArray(pane.material)) {
    pane.material.opacity = unlocked ? 0.08 : 0.28;
    pane.material.emissiveIntensity = unlocked ? 0.2 : 0.65;
    pane.material.color.setHex(unlocked ? 0x66ff99 : 0xff5252);
    pane.material.emissive.setHex(unlocked ? 0x22aa66 : 0xff1744);
  }
}

export function createRotatingDoorBarrierObject() {
  const group = new THREE.Group();
  const frameMat = makeEmissiveMaterial(0xffb300, 0xffd54f, 0.38);
  const paneMat = makeEmissiveMaterial(0xfff59d, 0xffd54f, 0.55, { transparent: true, opacity: 0.22 });

  const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.55, 0.08), frameMat);
  frameL.position.set(-0.46, 0.78, 0);
  group.add(frameL);

  const frameR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.55, 0.08), frameMat);
  frameR.position.set(0.46, 0.78, 0);
  group.add(frameR);

  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.08), frameMat);
  frameTop.position.set(0, 1.52, 0);
  group.add(frameTop);

  const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.42), paneMat);
  pane.position.set(0, 0.78, 0);
  group.add(pane);

  group.userData.__kind = 'rotatingDoorBarrier';
  group.userData.__pane = pane;
  setRotatingDoorBarrierState(group, { open: false });
  return group;
}

export function setRotatingDoorBarrierState(object3d, { open = false } = {}) {
  const g = object3d;
  const isOpen = open === true;
  g.userData.__open = isOpen;
  const pane = g?.userData?.__pane || null;
  if (pane?.material && !Array.isArray(pane.material)) {
    pane.material.opacity = isOpen ? 0.06 : 0.22;
    pane.material.emissiveIntensity = isOpen ? 0.18 : 0.55;
    pane.material.color.setHex(isOpen ? 0x66ff99 : 0xfff59d);
    pane.material.emissive.setHex(isOpen ? 0x22aa66 : 0xffd54f);
  }
}

export function createVentEntranceObject() {
  const group = new THREE.Group();
  const frameMat = makeEmissiveMaterial(0x455a64, 0x000000, 0.08);
  const grateMat = makeEmissiveMaterial(0x90a4ae, 0x4dd0e1, 0.35);

  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.72), frameMat);
  frame.position.set(0, 0.04, 0);
  group.add(frame);

  const grate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.62), grateMat);
  grate.position.set(0, 0.06, 0);
  group.add(grate);

  group.userData.__kind = 'ventEntrance';
  return group;
}

export function createMedicalStationObject() {
  const group = new THREE.Group();

  const baseMat = makeEmissiveMaterial(0xf5f5f5, 0x000000, 0.0);
  const accentMat = makeEmissiveMaterial(0xef5350, 0xff5252, 0.55);
  const glassMat = makeEmissiveMaterial(0x90caf9, 0x42a5f5, 0.28, { transparent: true, opacity: 0.25 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.35), baseMat);
  base.position.set(0, 0.45, 0);
  group.add(base);

  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.03), glassMat);
  screen.position.set(0.18, 0.72, 0.19);
  group.add(screen);

  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.03), accentMat);
  crossH.position.set(-0.18, 0.7, 0.19);
  group.add(crossH);

  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.03), accentMat);
  crossV.position.set(-0.18, 0.7, 0.19);
  group.add(crossV);

  const top = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.06, 0.4), baseMat);
  top.position.set(0, 0.93, 0);
  group.add(top);

  const glow = new THREE.PointLight(0xff5252, 0.65, 2.4);
  glow.position.set(-0.18, 0.8, 0.25);
  group.add(glow);

  group.userData.__kind = 'medicalStation';
  return group;
}

export function createArmoryLockerObject() {
  const group = new THREE.Group();

  const shellMat = makeEmissiveMaterial(0x263238, 0x000000, 0.0);
  const doorMat = makeEmissiveMaterial(0x37474f, 0x000000, 0.0);
  const accentMat = makeEmissiveMaterial(0xffd54f, 0xffb300, 0.45);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.35, 0.38), shellMat);
  body.position.set(0, 0.675, 0);
  group.add(body);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.25, 0.05), doorMat);
  door.position.set(0, 0.675, 0.19);
  group.add(door);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.055), accentMat);
  stripe.position.set(0, 1.18, 0.19);
  group.add(stripe);

  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.04), accentMat);
  handle.position.set(0.26, 0.68, 0.205);
  group.add(handle);

  const glow = new THREE.PointLight(0xffb300, 0.5, 2.6);
  glow.position.set(0, 1.05, 0.35);
  group.add(glow);

  group.userData.__kind = 'armoryLocker';
  group.userData.__door = door;
  group.userData.__opened = false;
  return group;
}

export function setArmoryLockerState(object3d, { opened = false } = {}) {
  const g = object3d;
  if (!g) return;
  g.userData.__opened = opened === true;
  const door = g.userData?.__door || null;
  if (door) {
    door.position.z = opened ? 0.02 : 0.19;
    door.rotation.y = opened ? -0.65 : 0;
  }
}

export function createControlTerminalObject() {
  const group = new THREE.Group();

  const baseMat = makeEmissiveMaterial(0x263238, 0x000000, 0.0);
  const screenMat = makeEmissiveMaterial(0x40c4ff, 0x00bcd4, 0.55, { transparent: true, opacity: 0.28 });
  const accentMat = makeEmissiveMaterial(0x66ff99, 0x22aa66, 0.38);

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.8, 12), baseMat);
  pedestal.position.set(0, 0.4, 0);
  group.add(pedestal);

  const top = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.4), baseMat);
  top.position.set(0, 0.84, 0);
  group.add(top);

  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 0.05), screenMat);
  screen.position.set(0, 0.92, 0.16);
  screen.rotation.x = -0.35;
  group.add(screen);

  const led = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.05), accentMat);
  led.position.set(0, 0.82, 0.19);
  group.add(led);

  const glow = new THREE.PointLight(0x40c4ff, 0.55, 3.0);
  glow.position.set(0, 1.15, 0.25);
  group.add(glow);

  group.userData.__kind = 'controlTerminal';
  return group;
}
