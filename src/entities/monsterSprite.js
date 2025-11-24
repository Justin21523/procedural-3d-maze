import * as THREE from 'three';

/**
 * Create a billboard sprite for a monster using a 2D texture.
 * Uses SpriteMaterial to avoid undefined uniform issues if texture fails.
 * @param {string} texturePath - Path to the sprite image (e.g., /models/monster.png)
 * @returns {THREE.Group} Group containing the sprite
 */
export function createSpriteBillboard(texturePath = '/models/monster.png') {
  const loader = new THREE.TextureLoader();

  const tex = loader.load(
    texturePath,
    undefined,
    undefined,
    () => {
      console.warn(`⚠️ Failed to load sprite texture ${texturePath}, using fallback color`);
    }
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const material = new THREE.SpriteMaterial({
    map: tex,
    color: 0xffffff,
    transparent: true,
    depthWrite: false
  });

  const sprite = new THREE.Sprite(material);
  // Adjust size as needed (width, height)
  sprite.scale.set(1.5, 2.5, 1);

  const group = new THREE.Group();
  group.add(sprite);
  return group;
}
