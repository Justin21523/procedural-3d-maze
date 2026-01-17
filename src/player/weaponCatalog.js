import { CONFIG } from '../core/config.js';

export const DEFAULT_WEAPON_ORDER = Object.freeze(['rifle', 'pistol', 'flare']);

export function createWeaponCatalog() {
  const rifleInterval = CONFIG.PLAYER_FIRE_INTERVAL ?? 0.08;
  const bulletSpeed = CONFIG.PLAYER_BULLET_SPEED ?? 42;
  const bulletLifetime = CONFIG.PLAYER_BULLET_LIFETIME ?? 2.2;
  const baseDamage = CONFIG.PLAYER_BULLET_DAMAGE ?? 1;

  const sharedView = {
    offset: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1.0
  };

  return {
    rifle: {
      id: 'rifle',
      name: 'Rifle',
      fireMode: 'auto',
      fireInterval: rifleInterval,
      magSize: 30,
      reserveStart: 150,
      reserveMax: 240,
      reloadSeconds: 1.55,
      recoilKick: 1.0,
      muzzleColor: 0xffdd88,
      viewModelPath: '/models/weapon/assault_rifle_pbr.glb',
      view: { ...sharedView },
      projectile: {
        kind: 'bullet',
        speed: Math.max(30, bulletSpeed * 1.05),
        lifetime: bulletLifetime,
        damage: Math.max(1, Math.round(baseDamage * 1.1)),
        color: 0xffee88
      },
      ai: {
        minRangeTiles: 2,
        maxRangeTiles: 14,
        burstMinShots: 5,
        burstMaxShots: 9,
        burstRestMinSeconds: 0.22,
        burstRestMaxSeconds: 0.55,
        crowdBias: 0.2
      },
      modes: {
        standard: {
          label: 'Standard',
          projectile: { pierce: 0, damage: baseDamage, color: 0xffee88, stunSeconds: 0.12 }
        },
        piercing: {
          label: 'Piercing',
          projectile: { pierce: 2, damage: Math.max(1, Math.round(baseDamage * 0.9)), color: 0x88ffcc, stunSeconds: 0.18 }
        },
        shock: {
          label: 'Shock',
          projectile: { pierce: 0, damage: Math.max(1, Math.round(baseDamage * 0.8)), color: 0x66aaff, element: 'electric', jamSeconds: 1.35, stunSeconds: 0.1 }
        },
        incendiary: {
          label: 'Incendiary',
          projectile: { pierce: 0, damage: Math.max(1, Math.round(baseDamage * 0.75)), color: 0xff7744, element: 'fire', burnSeconds: 4.2, burnDps: 1.25, stunSeconds: 0.08 }
        }
      },
      defaultMode: 'standard',
      modSlots: 3
    },
    pistol: {
      id: 'pistol',
      name: 'Pistol',
      fireMode: 'semi',
      fireInterval: 0.24,
      magSize: 12,
      reserveStart: 72,
      reserveMax: 120,
      reloadSeconds: 1.25,
      recoilKick: 0.85,
      muzzleColor: 0xffccaa,
      viewModelPath: '/models/weapon/en_pistol.glb',
      view: { ...sharedView },
      projectile: {
        kind: 'bullet',
        speed: Math.max(34, bulletSpeed * 1.2),
        lifetime: Math.max(1.2, bulletLifetime * 0.95),
        damage: Math.max(1, Math.round(baseDamage * 2.0)),
        color: 0xffddaa,
        stunSeconds: 0.2
      },
      ai: {
        minRangeTiles: 0,
        maxRangeTiles: 8,
        burstMinShots: 2,
        burstMaxShots: 3,
        burstRestMinSeconds: 0.18,
        burstRestMaxSeconds: 0.35,
        crowdBias: 0.4
      },
      modSlots: 2
    },
    flare: {
      id: 'flare',
      name: 'Flare Gun',
      fireMode: 'semi',
      fireInterval: 0.9,
      magSize: 2,
      reserveStart: 10,
      reserveMax: 18,
      reloadSeconds: 2.15,
      recoilKick: 1.15,
      muzzleColor: 0x66ff99,
      viewModelPath: '/models/weapon/flare_gun.glb',
      view: { ...sharedView },
      projectile: {
        kind: 'grenade',
        speed: 18,
        lifetime: 2.35,
        damage: Math.max(2, Math.round(baseDamage * 2.0)),
        explosionRadius: 2.9,
        explosionDamage: 10,
        color: 0xff6644,
        explosionColor: 0xffaa55,
        stunSeconds: 0.35
      },
      ai: {
        minRangeTiles: 4,
        maxRangeTiles: 14,
        burstMinShots: 1,
        burstMaxShots: 1,
        burstRestMinSeconds: 0.35,
        burstRestMaxSeconds: 0.7,
        crowdBias: 1.0
      },
      modSlots: 1
    }
  };
}
