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

export function getDefaultMissionRoomTypes() {
  // Default to "human rooms" for objectives.
  // New archetypes can be injected via level config.
  return CONFIG?.MISSION_DEFAULT_ROOM_TYPES || null;
}
