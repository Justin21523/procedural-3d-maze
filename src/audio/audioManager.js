/**
 * Audio Manager
 * Manages all game audio including ambient sounds, monster sounds, and player sounds
 * Uses Web Audio API for 3D spatial audio
 */

import * as THREE from 'three';

export class AudioManager {
  /**
   * Create audio manager
   * @param {THREE.Camera} camera - Camera for AudioListener
   */
  constructor(camera) {
    // Create Audio Listener (attached to camera)
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);

    // Audio loader
    this.loader = new THREE.AudioLoader();

    // Audio sources
    this.ambientSound = null;
    this.playerFootsteps = null;
    this.monsterSounds = new Map(); // Map<monsterId, Audio>

    // Audio buffers (cache)
    this.buffers = new Map();

    // State
    this.enabled = true;
    this.masterVolume = 1.0;
    this.ambientVolume = 0.3;
    this.effectsVolume = 0.7;

    console.log('🔊 AudioManager initialized');
  }

  /**
   * Load an audio file
   * @param {string} name - Audio identifier
   * @param {string} path - Path to audio file
   * @returns {Promise<AudioBuffer>}
   */
  async loadAudio(name, path) {
    if (this.buffers.has(name)) {
      console.log(`🔊 Using cached audio: ${name}`);
      return this.buffers.get(name);
    }

    console.log(`🔊 Loading audio: ${name} from ${path}`);

    return new Promise((resolve, reject) => {
      this.loader.load(
        path,
        (buffer) => {
          this.buffers.set(name, buffer);
          console.log(`✅ Audio loaded: ${name}`);
          resolve(buffer);
        },
        undefined,
        (error) => {
          console.error(`❌ Failed to load audio ${name}:`, error);
          reject(error);
        }
      );
    });
  }

  /**
   * Setup ambient background sound (looping)
   * @param {string} audioPath - Path to ambient audio file
   */
  async setupAmbient(audioPath = '/audio/ambient.mp3') {
    try {
      const buffer = await this.loadAudio('ambient', audioPath);

      // Create ambient sound (non-positional)
      this.ambientSound = new THREE.Audio(this.listener);
      this.ambientSound.setBuffer(buffer);
      this.ambientSound.setLoop(true);
      this.ambientSound.setVolume(this.ambientVolume * this.masterVolume);

      console.log('🎵 Ambient sound ready');
    } catch (error) {
      console.warn('⚠️ Failed to load ambient sound (optional):', error.message);
    }
  }

  /**
   * Play ambient sound
   */
  playAmbient() {
    if (this.ambientSound && !this.ambientSound.isPlaying) {
      this.ambientSound.play();
      console.log('▶️ Ambient sound playing');
    }
  }

  /**
   * Stop ambient sound
   */
  stopAmbient() {
    if (this.ambientSound && this.ambientSound.isPlaying) {
      this.ambientSound.stop();
      console.log('⏸️ Ambient sound stopped');
    }
  }

  /**
   * Create a 3D positional audio source
   * @param {THREE.Object3D} object - Object to attach audio to
   * @param {string} audioName - Name of loaded audio
   * @param {Object} options - Audio options
   * @returns {THREE.PositionalAudio}
   */
  create3DAudio(object, audioName, options = {}) {
    const buffer = this.buffers.get(audioName);
    if (!buffer) {
      console.error(`❌ Audio buffer not found: ${audioName}`);
      return null;
    }

    const {
      loop = false,
      volume = 1.0,
      refDistance = 5,
      rolloffFactor = 1,
      maxDistance = 50
    } = options;

    // Create positional audio
    const sound = new THREE.PositionalAudio(this.listener);
    sound.setBuffer(buffer);
    sound.setLoop(loop);
    sound.setVolume(volume * this.effectsVolume * this.masterVolume);
    sound.setRefDistance(refDistance);
    sound.setRolloffFactor(rolloffFactor);
    sound.setMaxDistance(maxDistance);

    // Attach to object
    object.add(sound);

    return sound;
  }

  /**
   * Procedural gunshot (short noise burst) without external assets.
   */
  playGunshot() {
    if (!this.enabled) return;

    const buffer = this.getGunshotBuffer();
    if (!buffer) return;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.9 * this.effectsVolume * this.masterVolume);
    sound.play();

    sound.onEnded = () => {
      sound.disconnect();
    };
  }

  /**
   * Procedural hit marker (short "tick") without external assets.
   */
  playHitMarker() {
    if (!this.enabled) return;

    const buffer = this.getHitMarkerBuffer();
    if (!buffer) return;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.35 * this.effectsVolume * this.masterVolume);
    sound.play();

    sound.onEnded = () => {
      sound.disconnect();
    };
  }

  /**
   * Procedural player hurt sound (short harsh thud/beep) without external assets.
   */
  playPlayerHurt() {
    if (!this.enabled) return;

    const buffer = this.getPlayerHurtBuffer();
    if (!buffer) return;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.55 * this.effectsVolume * this.masterVolume);
    sound.play();

    sound.onEnded = () => {
      sound.disconnect();
    };
  }

  /**
   * Procedural win sound (short bright chirp) without external assets.
   */
  playGameWon() {
    if (!this.enabled) return;

    const buffer = this.getGameWonBuffer();
    if (!buffer) return;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.5 * this.effectsVolume * this.masterVolume);
    sound.play();

    sound.onEnded = () => {
      sound.disconnect();
    };
  }

  /**
   * Procedural lose sound (short low buzz) without external assets.
   */
  playGameLost() {
    if (!this.enabled) return;

    const buffer = this.getGameLostBuffer();
    if (!buffer) return;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.7 * this.effectsVolume * this.masterVolume);
    sound.play();

    sound.onEnded = () => {
      sound.disconnect();
    };
  }

  /**
   * Procedural objective chime (short rising beep) without external assets.
   */
  playObjectiveChime() {
    if (!this.enabled) return;

    const buffer = this.getObjectiveChimeBuffer();
    if (!buffer) return;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.45 * this.effectsVolume * this.masterVolume);
    sound.play();

    sound.onEnded = () => {
      sound.disconnect();
    };
  }

  getGunshotBuffer() {
    if (this.buffers.has('gunshot_proc')) {
      return this.buffers.get('gunshot_proc');
    }

    const ctx = this.listener.context;
    const duration = 0.15;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t * 25); // fast decay
      data[i] = (Math.random() * 2 - 1) * envelope * 0.8;
    }

    this.buffers.set('gunshot_proc', buffer);
    return buffer;
  }

  getObjectiveChimeBuffer() {
    if (this.buffers.has('objective_chime_proc')) {
      return this.buffers.get('objective_chime_proc');
    }

    const ctx = this.listener.context;
    const duration = 0.22;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    const f0 = 440;
    const f1 = 880;

    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const k = t / duration;
      const freq = f0 + (f1 - f0) * k;
      const env = Math.sin(Math.min(1, t / 0.02) * (Math.PI / 2)) * Math.exp(-t * 8);
      data[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.7;
    }

    this.buffers.set('objective_chime_proc', buffer);
    return buffer;
  }

  getHitMarkerBuffer() {
    if (this.buffers.has('hit_proc')) {
      return this.buffers.get('hit_proc');
    }

    const ctx = this.listener.context;
    const duration = 0.07;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    const freq = 950;
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t * 55);
      const tone = Math.sin(t * Math.PI * 2 * freq) * 0.55;
      const noise = (Math.random() * 2 - 1) * 0.12;
      data[i] = (tone + noise) * envelope * 0.9;
    }

    this.buffers.set('hit_proc', buffer);
    return buffer;
  }

  getPlayerHurtBuffer() {
    if (this.buffers.has('player_hurt_proc')) {
      return this.buffers.get('player_hurt_proc');
    }

    const ctx = this.listener.context;
    const duration = 0.16;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    const f0 = 320;
    const f1 = 140;

    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const p = t / duration;
      const envelope = Math.exp(-t * 18);
      const freq = f0 + (f1 - f0) * p;
      const tone = Math.sin(t * Math.PI * 2 * freq) * 0.55;
      const noise = (Math.random() * 2 - 1) * 0.35;
      data[i] = (tone + noise) * envelope * 0.9;
    }

    this.buffers.set('player_hurt_proc', buffer);
    return buffer;
  }

  getGameWonBuffer() {
    if (this.buffers.has('game_won_proc')) {
      return this.buffers.get('game_won_proc');
    }

    const ctx = this.listener.context;
    const duration = 0.35;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    const base = 520;
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t * 6.5);
      const chirp = Math.sin(t * Math.PI * 2 * (base + t * 900)) * 0.55;
      const harmony = Math.sin(t * Math.PI * 2 * (base * 1.25 + t * 650)) * 0.25;
      data[i] = (chirp + harmony) * envelope * 0.9;
    }

    this.buffers.set('game_won_proc', buffer);
    return buffer;
  }

  getGameLostBuffer() {
    if (this.buffers.has('game_lost_proc')) {
      return this.buffers.get('game_lost_proc');
    }

    const ctx = this.listener.context;
    const duration = 0.55;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    const f0 = 180;
    const f1 = 75;

    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const p = t / duration;
      const envelope = Math.exp(-t * 3.8);
      const freq = f0 + (f1 - f0) * p;
      const tone = Math.sin(t * Math.PI * 2 * freq) * 0.6;
      const buzz = Math.sin(t * Math.PI * 2 * (freq * 2.01)) * 0.18;
      const noise = (Math.random() * 2 - 1) * 0.12;
      data[i] = (tone + buzz + noise) * envelope * 0.9;
    }

    this.buffers.set('game_lost_proc', buffer);
    return buffer;
  }

  /**
   * Play player footstep sound
   * @param {boolean} running - Is player running?
   */
  playFootstep(running = false) {
    if (!this.enabled) return;

    // Use different footstep sound based on speed
    const audioName = running ? 'footstep_run' : 'footstep_walk';

    if (!this.buffers.has(audioName)) {
      // Silently fail if audio not loaded
      return;
    }

    // Create one-shot audio
    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(this.buffers.get(audioName));
    sound.setVolume(0.4 * this.effectsVolume * this.masterVolume);
    sound.play();

    // Auto-dispose when done
    sound.onEnded = () => {
      sound.disconnect();
    };
  }

  /**
   * Setup monster audio for a monster
   * @param {string} monsterId - Unique monster ID
   * @param {THREE.Object3D} monsterModel - Monster 3D model
   */
  async setupMonsterAudio(monsterId, monsterModel) {
    try {
      // Load monster sounds if not already loaded
      if (!this.buffers.has('monster_idle')) {
        await this.loadAudio('monster_idle', '/audio/monster_idle.mp3');
      }
      if (!this.buffers.has('monster_chase')) {
        await this.loadAudio('monster_chase', '/audio/monster_chase.mp3');
      }

      // Create idle sound (looping)
      const idleSound = this.create3DAudio(monsterModel, 'monster_idle', {
        loop: true,
        volume: 0.3,
        refDistance: 8,
        maxDistance: 30
      });

      this.monsterSounds.set(monsterId, {
        idle: idleSound,
        model: monsterModel
      });

      console.log(`🔊 Monster audio setup for ${monsterId}`);
    } catch (error) {
      console.warn(`⚠️ Failed to setup monster audio for ${monsterId}:`, error.message);
    }
  }

  /**
   * Play monster chase sound (one-shot)
   * @param {THREE.Object3D} monsterModel - Monster model
   */
  playMonsterChase(monsterModel) {
    if (!this.enabled || !this.buffers.has('monster_chase')) return;

    const chaseSound = this.create3DAudio(monsterModel, 'monster_chase', {
      loop: false,
      volume: 0.6,
      refDistance: 15,
      maxDistance: 50
    });

    if (chaseSound) {
      chaseSound.play();

      // Auto-dispose
      chaseSound.onEnded = () => {
        monsterModel.remove(chaseSound);
        chaseSound.disconnect();
      };
    }
  }

  /**
   * Set master volume
   * @param {number} volume - Volume 0.0 to 1.0
   */
  setMasterVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));

    // Update all active sounds
    if (this.ambientSound) {
      this.ambientSound.setVolume(this.ambientVolume * this.masterVolume);
    }

    console.log(`🔊 Master volume set to ${this.masterVolume.toFixed(2)}`);
  }

  /**
   * Enable/disable all audio
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;

    if (!enabled) {
      this.stopAmbient();
    } else {
      this.playAmbient();
    }

    console.log(`🔊 Audio ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Update audio (called each frame)
   * @param {number} deltaTime - Time since last frame
   */
  update(deltaTime) {
    // Audio automatically updates via Three.js
    // This method can be used for dynamic volume adjustments, etc.
  }

  /**
   * Clean up all audio resources
   */
  dispose() {
    this.stopAmbient();

    // Disconnect all monster sounds
    for (const [id, sounds] of this.monsterSounds) {
      if (sounds.idle) {
        sounds.idle.stop();
        sounds.idle.disconnect();
      }
    }

    this.monsterSounds.clear();
    this.buffers.clear();

    console.log('🗑️ AudioManager disposed');
  }
}
