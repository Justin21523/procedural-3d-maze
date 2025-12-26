/**
 * Post-processing pipeline for horror game visual effects
 * Includes Bloom and Color Grading for atmospheric rendering
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CONFIG } from '../core/config.js';

/**
 * Color Grading Shader for horror atmosphere
 * Adjusts brightness, contrast, saturation, and color tint
 */
const ColorGradingShader = {
  uniforms: {
    tDiffuse: { value: null },
    brightness: { value: 0.0 },
    contrast: { value: 1.0 },
    saturation: { value: 1.0 },
    tintColor: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
    tintStrength: { value: 0.0 }
  },

  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float brightness;
    uniform float contrast;
    uniform float saturation;
    uniform vec3 tintColor;
    uniform float tintStrength;

    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Apply brightness
      color.rgb += brightness;

      // Apply contrast
      color.rgb = (color.rgb - 0.5) * contrast + 0.5;

      // Apply saturation
      float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color.rgb = mix(vec3(luminance), color.rgb, saturation);

      // Apply color tint
      color.rgb = mix(color.rgb, color.rgb * tintColor, tintStrength);

      // Clamp to valid range
      color.rgb = clamp(color.rgb, 0.0, 1.0);

      gl_FragColor = color;
    }
  `
};

export class PostProcessingManager {
  /**
   * Create the post-processing manager
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = CONFIG.POST_PROCESSING_ENABLED !== false;

    // Create composer
    this.composer = new EffectComposer(renderer);

    // Setup passes
    this.setupPasses();

    console.log('✨ Post-processing pipeline initialized');
  }

  /**
   * Setup all post-processing passes
   */
  setupPasses() {
    const width = this.renderer.domElement.width;
    const height = this.renderer.domElement.height;

    // 1. Render Pass - renders the scene
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // 2. Bloom Pass - for glowing lights
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      CONFIG.BLOOM_STRENGTH || 0.3,
      CONFIG.BLOOM_RADIUS || 0.4,
      CONFIG.BLOOM_THRESHOLD || 0.85
    );
    this.bloomPass.enabled = CONFIG.BLOOM_ENABLED !== false;
    this.composer.addPass(this.bloomPass);

    // 3. Color Grading Pass - for horror atmosphere
    this.colorGradingPass = new ShaderPass(ColorGradingShader);
    this.updateColorGrading();
    this.colorGradingPass.enabled = CONFIG.COLOR_GRADING_ENABLED !== false;
    this.composer.addPass(this.colorGradingPass);

    // 4. Output Pass - ensures correct color space output
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  /**
   * Update color grading uniforms from config
   */
  updateColorGrading() {
    if (!this.colorGradingPass) return;

    const uniforms = this.colorGradingPass.uniforms;

    // Apply horror-style color grading
    uniforms.brightness.value = CONFIG.CG_BRIGHTNESS ?? -0.05;
    uniforms.contrast.value = CONFIG.CG_CONTRAST ?? 1.1;
    uniforms.saturation.value = CONFIG.CG_SATURATION ?? 0.85;

    // Parse tint color
    const tintColor = new THREE.Color(CONFIG.CG_TINT_COLOR ?? 0xffffcc);
    uniforms.tintColor.value.set(tintColor.r, tintColor.g, tintColor.b);
    uniforms.tintStrength.value = CONFIG.CG_TINT_STRENGTH ?? 0.1;
  }

  /**
   * Update bloom settings
   * @param {Object} settings - { strength, radius, threshold }
   */
  setBloomSettings(settings) {
    if (!this.bloomPass) return;

    if (settings.strength !== undefined) {
      this.bloomPass.strength = settings.strength;
    }
    if (settings.radius !== undefined) {
      this.bloomPass.radius = settings.radius;
    }
    if (settings.threshold !== undefined) {
      this.bloomPass.threshold = settings.threshold;
    }
  }

  /**
   * Enable/disable bloom
   * @param {boolean} enabled
   */
  setBloomEnabled(enabled) {
    if (this.bloomPass) {
      this.bloomPass.enabled = enabled;
    }
  }

  /**
   * Enable/disable color grading
   * @param {boolean} enabled
   */
  setColorGradingEnabled(enabled) {
    if (this.colorGradingPass) {
      this.colorGradingPass.enabled = enabled;
    }
  }

  /**
   * Enable/disable all post-processing
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Check if post-processing is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Render with post-processing
   */
  render() {
    if (this.enabled && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Handle window resize
   * @param {number} width
   * @param {number} height
   */
  setSize(width, height) {
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(width, height);
    }
  }

  /**
   * Update camera reference (if camera changes)
   * @param {THREE.Camera} camera
   */
  setCamera(camera) {
    this.camera = camera;
    if (this.renderPass) {
      this.renderPass.camera = camera;
    }
  }

  /**
   * Dispose of resources
   */
  dispose() {
    if (this.composer) {
      this.composer.dispose();
    }
  }
}
