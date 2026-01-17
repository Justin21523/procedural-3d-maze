/**
 * Visual Effects Manager
 * Handles screen effects like damage flash, screen shake, and transitions
 */

export class VisualEffects {
  constructor() {
    // Create overlay element for flashes
    this.overlay = document.getElementById('damage-overlay') || this.createOverlay();
    this.darkOverlay = document.getElementById('dark-overlay') || this.createDarkOverlay();

    // Screen shake state
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeTimer = 0;

    // Flash state
    this.flashOpacity = 0;
    this.flashColor = 'rgba(255, 0, 0, 0.5)'; // Red by default
    this.flashDuration = 0;
    this.flashTimer = 0;

    this.darkness = 0;

    console.log('🎨 VisualEffects initialized');
  }

  /**
   * Create overlay element for visual effects
   */
  createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'damage-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.1s;
      z-index: 100;
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  createDarkOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'dark-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.08s linear;
      z-index: 90;
      background: radial-gradient(circle at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.25) 55%, rgba(0,0,0,1) 100%);
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  setDarkness(level = 0) {
    const n = Number(level);
    const v = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
    this.darkness = v;
    if (this.darkOverlay) {
      this.darkOverlay.style.opacity = String(v);
    }
  }

  /**
   * Trigger damage flash effect
   * @param {string} color - Flash color (default red)
   * @param {number} duration - Flash duration in seconds
   * @param {number} opacity - Max opacity (0-1)
   */
  damageFlash(color = 'rgba(255, 0, 0, 0.5)', duration = 0.3, opacity = 0.5) {
    this.flashColor = color;
    this.flashDuration = duration;
    this.flashTimer = duration;
    this.flashOpacity = opacity;

    // Apply flash immediately
    this.overlay.style.background = this.flashColor;
    this.overlay.style.opacity = this.flashOpacity;
  }

  /**
   * Trigger a cheap "damage ring" (red circle) overlay.
   * This avoids extra particles/shake and is GPU-friendly.
   */
  damageRing(duration = 0.35, opacity = 0.55) {
    this.flashColor = 'rgba(255, 0, 0, 1)';
    this.flashDuration = duration;
    this.flashTimer = duration;
    this.flashOpacity = opacity;

    this.overlay.style.background =
      'radial-gradient(circle at center, rgba(255, 0, 0, 0) 35%, rgba(255, 0, 0, 0) 52%, rgba(255, 0, 0, 1) 100%)';
    this.overlay.style.opacity = this.flashOpacity;
  }

  /**
   * Trigger screen shake effect
   * @param {number} intensity - Shake intensity in pixels
   * @param {number} duration - Shake duration in seconds
   */
  screenShake(intensity = 10, duration = 0.3) {
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeTimer = duration;
  }

  /**
   * Trigger caught by monster effect (combined flash + shake)
   */
  monsterCaughtEffect() {
    this.damageFlash('rgba(255, 0, 0, 0.6)', 0.4, 0.6);
    this.screenShake(15, 0.4);
  }

  /**
   * Trigger death effect
   */
  deathEffect() {
    this.damageFlash('rgba(0, 0, 0, 0.9)', 1.0, 0.9);
    this.screenShake(20, 0.5);
  }

  /**
   * Trigger victory flash
   */
  victoryFlash() {
    this.damageFlash('rgba(255, 215, 0, 0.5)', 0.5, 0.5); // Gold flash
  }

  /**
   * Update effects (call each frame)
   * @param {number} deltaTime - Time since last frame
   * @param {THREE.Camera} camera - Camera for shake effect (optional)
   */
  update(deltaTime, camera = null) {
    // Update flash
    if (this.flashTimer > 0) {
      this.flashTimer -= deltaTime;

      // Fade out flash
      const progress = this.flashTimer / this.flashDuration;
      this.overlay.style.opacity = this.flashOpacity * progress;

      if (this.flashTimer <= 0) {
        this.overlay.style.opacity = 0;
      }
    }

    // Keep darkness overlay live even when flashes are inactive.
    if (this.darkOverlay) {
      const v = Number(this.darkness) || 0;
      this.darkOverlay.style.opacity = String(Math.max(0, Math.min(1, v)));
    }

    // Update screen shake
    if (this.shakeTimer > 0 && camera) {
      this.shakeTimer -= deltaTime;

      // Calculate shake offset
      const progress = this.shakeTimer / this.shakeDuration;
      const currentIntensity = this.shakeIntensity * progress;

      // Apply random shake offset
      const shakeX = (Math.random() - 0.5) * currentIntensity * 0.001;
      const shakeY = (Math.random() - 0.5) * currentIntensity * 0.001;

      // Store original camera position if not stored
      if (!this.originalCameraPos) {
        this.originalCameraPos = {
          x: camera.position.x,
          y: camera.position.y
        };
      }

      // Apply shake (only to camera rotation for simplicity)
      camera.rotation.z = shakeX * 2;

      // Reset when done
      if (this.shakeTimer <= 0) {
        camera.rotation.z = 0;
        this.originalCameraPos = null;
      }
    }
  }

  /**
   * Add vignette effect (darkens screen edges)
   * @param {number} intensity - Intensity 0-1
   */
  setVignette(intensity) {
    const vignetteElement = document.getElementById('vignette') || this.createVignette();
    vignetteElement.style.opacity = intensity;
  }

  /**
   * Create vignette overlay
   */
  createVignette() {
    const vignette = document.createElement('div');
    vignette.id = 'vignette';
    vignette.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      opacity: 0;
      background: radial-gradient(circle, transparent 20%, rgba(0,0,0,0.8) 100%);
      transition: opacity 0.3s;
      z-index: 99;
    `;
    document.body.appendChild(vignette);
    return vignette;
  }

  /**
   * Clean up effects
   */
  dispose() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }

    const vignette = document.getElementById('vignette');
    if (vignette && vignette.parentNode) {
      vignette.parentNode.removeChild(vignette);
    }
  }
}
