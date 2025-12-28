import * as THREE from 'three';
import { CONFIG } from '../config.js';

function makeEmissiveMaterial(color, emissive, intensity = 0.8, transparent = false, opacity = 1) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    roughness: 0.6,
    metalness: 0.1,
    transparent,
    opacity
  });
}

export function createKeycardObject() {
  const group = new THREE.Group();

  const mat = makeEmissiveMaterial(0xffd54f, 0xffc107, 0.65);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.22), mat);
  body.castShadow = false;
  body.receiveShadow = true;
  body.position.y = 0.04;
  group.add(body);

  const stripeMat = makeEmissiveMaterial(0x263238, 0x000000, 0.0);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.005, 0.05), stripeMat);
  stripe.castShadow = false;
  stripe.receiveShadow = true;
  stripe.position.set(0, 0.06, -0.06);
  group.add(stripe);

  return group;
}

export function createEvidenceObject() {
  const group = new THREE.Group();

  const mat = makeEmissiveMaterial(0xffffff, 0x66aaff, 0.18, true, 0.95);
  const doc = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.01, 0.36), mat);
  doc.castShadow = false;
  doc.receiveShadow = true;
  doc.position.y = 0.03;
  group.add(doc);

  return group;
}

export function createDeliveryItemObject() {
  const group = new THREE.Group();

  const crateMat = makeEmissiveMaterial(0xffcc66, 0xffb74d, 0.22);
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.20), crateMat);
  crate.castShadow = false;
  crate.receiveShadow = true;
  crate.position.y = 0.09;
  group.add(crate);

  const strapMat = makeEmissiveMaterial(0x263238, 0x000000, 0.0);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.02, 0.04), strapMat);
  strap.castShadow = false;
  strap.receiveShadow = true;
  strap.position.set(0, 0.16, 0);
  group.add(strap);

  group.rotation.y = Math.random() * Math.PI * 2;
  return group;
}

export function createPowerSwitchObject(isOn = false) {
  const group = new THREE.Group();

  const baseMat = makeEmissiveMaterial(0x37474f, 0x000000, 0.0);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.10), baseMat);
  base.castShadow = false;
  base.receiveShadow = true;
  base.position.y = 0.11;
  group.add(base);

  const leverMat = makeEmissiveMaterial(0xb0bec5, 0x000000, 0.0);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), leverMat);
  lever.castShadow = false;
  lever.receiveShadow = true;
  lever.position.set(0, 0.17, 0.03);
  group.add(lever);

  const lightMat = makeEmissiveMaterial(0xff5252, 0xff5252, 0.9);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 10), lightMat);
  light.castShadow = false;
  light.receiveShadow = false;
  light.position.set(0, 0.08, 0.06);
  group.add(light);

  group.userData.__switch = { lever, light };
  setPowerSwitchState(group, isOn);

  // Sit on floor; face player by default.
  group.position.y = 0;
  group.rotation.y = Math.random() * Math.PI * 2;

  return group;
}

export function setPowerSwitchState(object3d, isOn) {
  const data = object3d?.userData?.__switch || null;
  if (!data) return;
  const on = !!isOn;
  if (data.lever) {
    data.lever.position.y = on ? 0.18 : 0.16;
    data.lever.rotation.x = on ? -0.35 : 0.35;
  }
  if (data.light?.material) {
    const color = on ? 0x66ff99 : 0xff5252;
    data.light.material.color.setHex(color);
    data.light.material.emissive.setHex(color);
  }
}

export function createClueNoteObject(slotLabel = 'A') {
  const group = new THREE.Group();

  const paperMat = makeEmissiveMaterial(0xf5f5f5, 0x88ccff, 0.14, true, 0.96);
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.012, 0.22), paperMat);
  paper.castShadow = false;
  paper.receiveShadow = true;
  paper.position.y = 0.03;
  group.add(paper);

  const stripeColor = String(slotLabel || '').toUpperCase() === 'B'
    ? 0xffcc66
    : (String(slotLabel || '').toUpperCase() === 'C' ? 0xff66aa : 0x66ff99);
  const stripeMat = makeEmissiveMaterial(stripeColor, stripeColor, 0.45);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.006, 0.04), stripeMat);
  stripe.castShadow = false;
  stripe.receiveShadow = true;
  stripe.position.set(0, 0.045, -0.07);
  group.add(stripe);

  group.rotation.y = Math.random() * Math.PI * 2;
  return group;
}

export function createKeypadObject(isUnlocked = false) {
  const group = new THREE.Group();

  const housingMat = makeEmissiveMaterial(0x263238, 0x000000, 0.0);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.10), housingMat);
  housing.castShadow = false;
  housing.receiveShadow = true;
  housing.position.y = 0.16;
  group.add(housing);

  const panelMat = makeEmissiveMaterial(0x37474f, 0x000000, 0.0);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.012), panelMat);
  panel.castShadow = false;
  panel.receiveShadow = true;
  panel.position.set(0, 0.19, 0.056);
  group.add(panel);

  const lightMat = makeEmissiveMaterial(0xff4444, 0xff4444, 0.95);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 10), lightMat);
  light.castShadow = false;
  light.receiveShadow = false;
  light.position.set(0.07, 0.09, 0.058);
  group.add(light);

  group.userData.__keypad = { light };
  setKeypadState(group, isUnlocked);

  group.rotation.y = Math.random() * Math.PI * 2;
  return group;
}

export function setKeypadState(object3d, isUnlocked) {
  const data = object3d?.userData?.__keypad || null;
  if (!data?.light?.material) return;
  const unlocked = !!isUnlocked;
  const color = unlocked ? 0x66ff99 : 0xff4444;
  data.light.material.color.setHex(color);
  data.light.material.emissive.setHex(color);
}

export function createFuseObject() {
  const group = new THREE.Group();

  const bodyMat = makeEmissiveMaterial(0xffcc66, 0xffb74d, 0.35);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 12), bodyMat);
  body.castShadow = false;
  body.receiveShadow = true;
  body.position.y = 0.06;
  body.rotation.z = Math.PI / 2;
  group.add(body);

  const capMat = makeEmissiveMaterial(0x263238, 0x000000, 0.0);
  const capA = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.018, 12), capMat);
  capA.castShadow = false;
  capA.receiveShadow = true;
  capA.position.set(-0.09, 0.06, 0);
  capA.rotation.z = Math.PI / 2;
  group.add(capA);

  const capB = capA.clone();
  capB.position.set(0.09, 0.06, 0);
  group.add(capB);

  group.rotation.y = Math.random() * Math.PI * 2;
  return group;
}

export function createFusePanelObject({ installed = false, powered = false } = {}) {
  const group = new THREE.Group();

  const baseMat = makeEmissiveMaterial(0x37474f, 0x000000, 0.0);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.12), baseMat);
  base.castShadow = false;
  base.receiveShadow = true;
  base.position.y = 0.16;
  group.add(base);

  const frameMat = makeEmissiveMaterial(0x263238, 0x000000, 0.0);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.20, 0.012), frameMat);
  frame.castShadow = false;
  frame.receiveShadow = true;
  frame.position.set(0, 0.22, 0.066);
  group.add(frame);

  const lightMat = makeEmissiveMaterial(0xff4444, 0xff4444, 0.95);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 12), lightMat);
  light.castShadow = false;
  light.receiveShadow = false;
  light.position.set(0.12, 0.08, 0.065);
  group.add(light);

  group.userData.__panel = { light };
  setFusePanelState(group, { installed, powered });

  group.rotation.y = Math.random() * Math.PI * 2;
  return group;
}

export function setFusePanelState(object3d, { installed = false, powered = false } = {}) {
  const data = object3d?.userData?.__panel || null;
  if (!data?.light?.material) return;

  const color = powered ? 0x66ff99 : (installed ? 0xffcc66 : 0xff4444);
  data.light.material.color.setHex(color);
  data.light.material.emissive.setHex(color);
}

export function createTerminalObject({ uploaded = false } = {}) {
  const group = new THREE.Group();

  const standMat = makeEmissiveMaterial(0x263238, 0x000000, 0.0);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.18), standMat);
  stand.castShadow = false;
  stand.receiveShadow = true;
  stand.position.y = 0.13;
  group.add(stand);

  const frameMat = makeEmissiveMaterial(0x37474f, 0x000000, 0.0);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.06), frameMat);
  frame.castShadow = false;
  frame.receiveShadow = true;
  frame.position.set(0, 0.30, 0.04);
  group.add(frame);

  const screenMat = makeEmissiveMaterial(0x66ff99, 0x66ff99, 0.55, true, 0.95);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.20, 0.12), screenMat);
  screen.castShadow = false;
  screen.receiveShadow = false;
  screen.position.set(0, 0.30, 0.072);
  group.add(screen);

  group.userData.__terminal = { screen };
  setTerminalState(group, { uploaded });

  group.rotation.y = Math.random() * Math.PI * 2;
  return group;
}

export function setTerminalState(object3d, { uploaded = false } = {}) {
  const data = object3d?.userData?.__terminal || null;
  if (!data?.screen?.material) return;
  const color = uploaded ? 0x66ff99 : 0x66aaff;
  data.screen.material.color.setHex(color);
  data.screen.material.emissive.setHex(color);
}

export function createLockedDoorObject({ unlocked = false } = {}) {
  const group = new THREE.Group();

  const frameMat = makeEmissiveMaterial(0x263238, 0x000000, 0.0);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.6, 0.14), frameMat);
  frame.castShadow = false;
  frame.receiveShadow = true;
  frame.position.y = 0.8;
  group.add(frame);

  const panelMat = makeEmissiveMaterial(0x37474f, 0xff4444, 0.35);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.70, 1.34, 0.08), panelMat);
  panel.castShadow = false;
  panel.receiveShadow = true;
  panel.position.set(0, 0.75, 0.06);
  group.add(panel);

  const lightMat = makeEmissiveMaterial(0xff4444, 0xff4444, 0.9);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), lightMat);
  light.castShadow = false;
  light.receiveShadow = false;
  light.position.set(0.32, 0.25, 0.09);
  group.add(light);

  group.userData.__lockedDoor = { panel, light };
  setLockedDoorState(group, { unlocked });

  group.rotation.y = Math.random() * Math.PI * 2;
  return group;
}

export function setLockedDoorState(object3d, { unlocked = false } = {}) {
  const data = object3d?.userData?.__lockedDoor || null;
  if (!data) return;
  const isUnlocked = !!unlocked;
  const color = isUnlocked ? 0x66ff99 : 0xff4444;

  if (data.panel?.material) {
    data.panel.material.emissive.setHex(color);
  }
  if (data.light?.material) {
    data.light.material.color.setHex(color);
    data.light.material.emissive.setHex(color);
  }
}

export function createAltarObject({ filled = false } = {}) {
  const group = new THREE.Group();

  const baseMat = makeEmissiveMaterial(0x37474f, 0x000000, 0.0);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.22, 14), baseMat);
  base.castShadow = false;
  base.receiveShadow = true;
  base.position.y = 0.11;
  group.add(base);

  const bowlMat = makeEmissiveMaterial(0x263238, 0x000000, 0.0);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.16, 0.08, 14), bowlMat);
  bowl.castShadow = false;
  bowl.receiveShadow = true;
  bowl.position.y = 0.24;
  group.add(bowl);

  const orbMat = makeEmissiveMaterial(0xff4444, 0xff4444, 0.65, true, 0.95);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), orbMat);
  orb.castShadow = false;
  orb.receiveShadow = false;
  orb.position.y = 0.30;
  group.add(orb);

  group.userData.__altar = { orb };
  setAltarState(group, { filled });

  group.rotation.y = Math.random() * Math.PI * 2;
  return group;
}

export function setAltarState(object3d, { filled = false } = {}) {
  const data = object3d?.userData?.__altar || null;
  if (!data?.orb?.material) return;
  const ok = !!filled;
  const color = ok ? 0x66ff99 : 0xff4444;
  data.orb.material.color.setHex(color);
  data.orb.material.emissive.setHex(color);
}

export function createPhotoTargetObject() {
  const group = new THREE.Group();

  const mat = makeEmissiveMaterial(0xffffff, 0xaa66ff, 0.25, true, 0.92);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.012, 0.30), mat);
  plate.castShadow = false;
  plate.receiveShadow = true;
  plate.position.y = 0.03;
  group.add(plate);

  const dotMat = makeEmissiveMaterial(0xaa66ff, 0xaa66ff, 0.6);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 10), dotMat);
  dot.castShadow = false;
  dot.receiveShadow = false;
  dot.position.set(0, 0.08, 0);
  group.add(dot);

  group.rotation.y = Math.random() * Math.PI * 2;
  return group;
}

export function createEscortBuddyObject() {
  const group = new THREE.Group();

  const coreMat = makeEmissiveMaterial(0x66ff99, 0x66ff99, 0.55, true, 0.92);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.34, 12), coreMat);
  core.castShadow = false;
  core.receiveShadow = true;
  core.position.y = 0.22;
  group.add(core);

  const capA = new THREE.Mesh(new THREE.SphereGeometry(0.10, 12, 12), coreMat);
  capA.castShadow = false;
  capA.receiveShadow = true;
  capA.position.set(0, 0.39, 0);
  group.add(capA);

  const capB = capA.clone();
  capB.position.set(0, 0.05, 0);
  group.add(capB);

  const ringMat = makeEmissiveMaterial(0x263238, 0x66ff99, 0.15);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 10, 18), ringMat);
  ring.castShadow = false;
  ring.receiveShadow = false;
  ring.position.set(0, 0.22, 0);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  group.rotation.y = Math.random() * Math.PI * 2;
  return group;
}

export function getDefaultMissionRoomTypes() {
  // Default to "human rooms" for objectives.
  // New archetypes can be injected via level config.
  return CONFIG?.MISSION_DEFAULT_ROOM_TYPES || null;
}
