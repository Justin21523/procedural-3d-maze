import * as THREE from 'three';

const moonmanFrames = import.meta.glob('/models/moonman-sequence/*.png', {
  import: 'default',
  eager: true
});

function sortFrameEntries(entries) {
  return entries.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
}

function resolveFrameUrls(options) {
  if (!options) return ['/models/monster.png'];

  if (Array.isArray(options.frames) && options.frames.length > 0) {
    return options.frames;
  }

  if (options.framesFolder === '/models/moonman-sequence') {
    const sorted = sortFrameEntries(Object.entries(moonmanFrames));
    return sorted.map(([, url]) => url);
  }

  if (typeof options.path === 'string') {
    return [options.path];
  }

  return ['/models/monster.png'];
}

/**
 * Create a billboard sprite for a monster using 1 or many textures.
 * If multiple frames are provided, it animates through them sequentially.
 * @param {string|Object} config - path string or { path, framesFolder, frames, frameRate, randomStart, scale }
 * @returns {{group: THREE.Group, updateAnimation: function|undefined}}
 */
export function createSpriteBillboard(config = '/models/monster.png') {
  const loader = new THREE.TextureLoader();
  const options = typeof config === 'string' ? { path: config } : (config || {});
  const frameUrls = resolveFrameUrls(options);
  const textures = frameUrls.map(url => {
    const tex = loader.load(
      url,
      undefined,
      undefined,
      () => console.warn(`⚠️ Failed to load sprite texture ${url}, using fallback color`)
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });

  const material = new THREE.SpriteMaterial({
    map: textures[0],
    color: 0xffffff,
    transparent: true,
    depthWrite: false
  });

  const sprite = new THREE.Sprite(material);
  const scaleX = options.scale?.x ?? options.scale?.w ?? options.scaleX ?? 1.5;
  const scaleY = options.scale?.y ?? options.scale?.h ?? options.scaleY ?? 2.5;
  sprite.scale.set(scaleX, scaleY, 1);

  const group = new THREE.Group();
  group.add(sprite);

  let frameIndex = 0;
  let frameTimer = 0;
  const frameRate = options.frameRate ?? 8;
  const frameDuration = frameRate > 0 ? 1 / frameRate : Infinity;

  if (options.randomStart && textures.length > 1) {
    frameIndex = Math.floor(Math.random() * textures.length);
    material.map = textures[frameIndex];
  }

  const updateAnimation = (deltaTime = 0) => {
    if (textures.length <= 1 || !Number.isFinite(frameDuration)) return;
    frameTimer += deltaTime;
    while (frameTimer >= frameDuration) {
      frameTimer -= frameDuration;
      frameIndex = (frameIndex + 1) % textures.length;
      material.map = textures[frameIndex];
      material.needsUpdate = true;
    }
  };

  return { group, updateAnimation: textures.length > 1 ? updateAnimation : null };
}
