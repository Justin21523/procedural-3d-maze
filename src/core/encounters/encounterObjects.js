import * as THREE from 'three';

function makeEmissiveMaterial(color, emissive, emissiveIntensity = 0.35) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness: 0.65,
    metalness: 0.05
  });
}

export function createTreasureChestObject({ opened = false } = {}) {
  const group = new THREE.Group();

  const baseMat = makeEmissiveMaterial(0x5d4037, 0x1b0f0b, 0.18);
  const accentMat = makeEmissiveMaterial(0x8d6e63, 0x2a1a12, 0.22);
  const glowMat = makeEmissiveMaterial(0xffd54f, 0xffc107, 0.55);

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.28, 0.44), baseMat);
  base.position.set(0, 0.14, 0);
  base.castShadow = false;
  base.receiveShadow = true;
  group.add(base);

  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 0.46), accentMat);
  trim.position.set(0, 0.26, 0);
  trim.castShadow = false;
  trim.receiveShadow = true;
  group.add(trim);

  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.18, 0.46), accentMat);
  lid.position.set(0, 0.37, -0.06);
  lid.castShadow = false;
  lid.receiveShadow = true;
  lid.userData.__lid = true;
  group.add(lid);

  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.02), glowMat);
  latch.position.set(0, 0.22, 0.23);
  latch.castShadow = false;
  latch.receiveShadow = false;
  group.add(latch);

  group.userData.__kind = 'treasureChest';
  group.userData.__lid = lid;
  setTreasureChestState(group, { opened });
  return group;
}

export function setTreasureChestState(object3d, { opened = false } = {}) {
  const g = object3d;
  const lid = g?.userData?.__lid || null;
  if (!lid) return;
  const open = opened === true;
  lid.rotation.x = open ? -Math.PI * 0.55 : 0;
  lid.position.z = open ? -0.16 : -0.06;
  g.userData.__opened = open;
}

export function createTradeKioskObject() {
  const group = new THREE.Group();

  const bodyMat = makeEmissiveMaterial(0x263238, 0x0b1114, 0.15);
  const screenMat = makeEmissiveMaterial(0x1e88e5, 0x64b5f6, 0.65);
  const accentMat = makeEmissiveMaterial(0x455a64, 0x000000, 0.08);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.92, 0.36), bodyMat);
  body.position.set(0, 0.46, 0);
  body.castShadow = false;
  body.receiveShadow = true;
  group.add(body);

  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.32, 0.02), screenMat);
  screen.position.set(0, 0.62, 0.19);
  group.add(screen);

  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.02), accentMat);
  slot.position.set(0, 0.28, 0.19);
  group.add(slot);

  group.userData.__kind = 'tradeKiosk';
  return group;
}

export function createAlarmTrapObject() {
  const group = new THREE.Group();

  const mat = makeEmissiveMaterial(0x37474f, 0xff5252, 0.45);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.6), mat);
  plate.position.set(0, 0.02, 0);
  group.add(plate);

  const wireMat = makeEmissiveMaterial(0xff5252, 0xff1744, 0.6);
  const wire = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.01, 0.02), wireMat);
  wire.position.set(0, 0.06, 0.24);
  group.add(wire);

  group.userData.__kind = 'alarmTrap';
  setAlarmTrapState(group, { triggered: false });
  return group;
}

export function setAlarmTrapState(object3d, { triggered = false } = {}) {
  const g = object3d;
  const t = triggered === true;
  g.userData.__triggered = t;
  g.traverse?.((child) => {
    if (!child?.isMesh) return;
    const mat = child.material;
    if (!mat || Array.isArray(mat)) return;
    if (mat.emissiveIntensity !== undefined) {
      mat.emissiveIntensity = t ? 0.12 : Math.max(mat.emissiveIntensity, 0.35);
    }
    if (mat.opacity !== undefined && mat.transparent) {
      mat.opacity = t ? 0.35 : 1.0;
    }
  });
}

