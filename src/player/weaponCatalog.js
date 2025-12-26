import { CONFIG } from '../core/config.js';

export const DEFAULT_WEAPON_ORDER = Object.freeze(['rifle', 'shotgun', 'launcher']);

export function createWeaponCatalog() {
  const rifleInterval = CONFIG.PLAYER_FIRE_INTERVAL ?? 0.08;
  const bulletSpeed = CONFIG.PLAYER_BULLET_SPEED ?? 42;
  const bulletLifetime = CONFIG.PLAYER_BULLET_LIFETIME ?? 2.2;
  const baseDamage = CONFIG.PLAYER_BULLET_DAMAGE ?? 1;

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
      projectile: {
        kind: 'bullet',
        speed: bulletSpeed,
        lifetime: bulletLifetime,
        damage: baseDamage,
        color: 0xffee88
      },
      modes: {
        standard: {
          label: 'Standard',
          projectile: { pierce: 0, damage: baseDamage, color: 0xffee88, stunSeconds: 0.12 }
        },
        piercing: {
          label: 'Piercing',
          projectile: { pierce: 2, damage: Math.max(1, Math.round(baseDamage * 0.9)), color: 0x88ffcc, stunSeconds: 0.18 }
        }
      },
      defaultMode: 'standard'
    },
    shotgun: {
      id: 'shotgun',
      name: 'Shotgun',
      fireMode: 'semi',
      fireInterval: 0.85,
      magSize: 6,
      reserveStart: 36,
      reserveMax: 60,
      reloadSeconds: 2.1,
      recoilKick: 1.35,
      muzzleColor: 0xffccaa,
      pellets: 7,
      spread: 0.11,
      projectile: {
        kind: 'pellet',
        speed: Math.max(26, bulletSpeed * 0.75),
        lifetime: Math.min(1.6, bulletLifetime),
        damage: Math.max(1, Math.round(baseDamage * 0.85)),
        color: 0xffddaa,
        stunSeconds: 0.3
      }
    },
    launcher: {
      id: 'launcher',
      name: 'Grenade Launcher',
      fireMode: 'semi',
      fireInterval: 0.95,
      magSize: 4,
      reserveStart: 16,
      reserveMax: 24,
      reloadSeconds: 2.4,
      recoilKick: 1.15,
      muzzleColor: 0x66ff99,
      projectile: {
        kind: 'grenade',
        speed: 20,
        lifetime: 2.2,
        damage: Math.max(2, baseDamage * 2),
        explosionRadius: 3.2,
        explosionDamage: 7,
        color: 0x66ff99,
        explosionColor: 0x66ff99,
        stunSeconds: 0.25
      }
    }
  };
}

