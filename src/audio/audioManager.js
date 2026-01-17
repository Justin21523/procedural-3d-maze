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

    const url = String(path || '').trim();
    if (!url) throw new Error('Audio path missing');

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    }

    const ct = String(res.headers.get('content-type') || '').toLowerCase();
    // WebKit/GStreamer will emit very noisy warnings if we try to decode an HTML 404 page as audio.
    // Treat obvious non-audio responses as a missing asset.
    if (ct.includes('text/html')) {
      throw new Error(`Audio URL returned HTML (missing file?): ${url}`);
    }

    const bytes = await res.arrayBuffer();
    if (!bytes || bytes.byteLength < 16) {
      throw new Error(`Audio data empty: ${url}`);
    }

    const ctx = this.listener?.context;
    if (!ctx) throw new Error('AudioContext missing');

    const decode = (arrayBuffer) => {
      const fn = ctx.decodeAudioData.bind(ctx);
      try {
        const maybe = fn(arrayBuffer);
        if (maybe && typeof maybe.then === 'function') return maybe;
      } catch {
        // fall through to callback form
      }
      return new Promise((resolve, reject) => {
        fn(arrayBuffer, resolve, reject);
      });
    };

    const buffer = await decode(bytes.slice(0));
    this.buffers.set(name, buffer);
    console.log(`✅ Audio loaded: ${name}`);
    return buffer;
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
   * Procedural pickup "heal" chime.
   */
  playPickupHeal() {
    if (!this.enabled) return;
    const buffer = this.getPickupHealBuffer?.();
    if (!buffer) return;
    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.45 * this.effectsVolume * this.masterVolume);
    sound.play();
    sound.onEnded = () => {
      sound.disconnect();
    };
  }

  /**
   * Procedural pickup "attachment" chime.
   */
  playPickupAttachment() {
    if (!this.enabled) return;
    const buffer = this.getPickupAttachmentBuffer?.();
    if (!buffer) return;
    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.42 * this.effectsVolume * this.masterVolume);
    sound.play();
    sound.onEnded = () => {
      sound.disconnect();
    };
  }

  /**
   * Procedural monster guard clang.
   */
  playMonsterGuard() {
    if (!this.enabled) return;
    const buffer = this.getMonsterGuardBuffer?.();
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

  /**
   * Procedural weapon switch click.
   */
  playWeaponSwitch() {
    if (!this.enabled) return;
    const buffer = this.getWeaponSwitchBuffer();
    if (!buffer) return;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.4 * this.effectsVolume * this.masterVolume);
    sound.play();
    sound.onEnded = () => sound.disconnect();
  }

  /**
   * Procedural reload cue (start/finish).
   */
  playReload(kind = 'start') {
    if (!this.enabled) return;
    const buffer = kind === 'finish' ? this.getReloadFinishBuffer() : this.getReloadStartBuffer();
    if (!buffer) return;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.45 * this.effectsVolume * this.masterVolume);
    sound.play();
    sound.onEnded = () => sound.disconnect();
  }

  /**
   * Procedural weapon mode toggle.
   */
  playWeaponModeToggle() {
    if (!this.enabled) return;
    const buffer = this.getWeaponModeToggleBuffer();
    if (!buffer) return;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.35 * this.effectsVolume * this.masterVolume);
    sound.play();
    sound.onEnded = () => sound.disconnect();
  }

  /**
   * Procedural grenade launch thump.
   */
  playGrenadeLaunch() {
    if (!this.enabled) return;
    const buffer = this.getGrenadeLaunchBuffer();
    if (!buffer) return;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.6 * this.effectsVolume * this.masterVolume);
    sound.play();
    sound.onEnded = () => sound.disconnect();
  }

  /**
   * Procedural EMP pulse zap.
   */
  playEmpPulse() {
    if (!this.enabled) return;
    const buffer = this.getEmpPulseBuffer();
    if (!buffer) return;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.55 * this.effectsVolume * this.masterVolume);
    sound.play();
    sound.onEnded = () => sound.disconnect();
  }

  /**
   * Procedural alarm beep (used by alarm box devices).
   */
  playAlarmBeep() {
    if (!this.enabled) return;
    const buffer = this.getAlarmBeepBuffer?.();
    if (!buffer) return;
    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.35 * this.effectsVolume * this.masterVolume);
    sound.play();
    sound.onEnded = () => sound.disconnect();
  }

  /**
   * Procedural device destroyed crack.
   */
  playDeviceDestroyed() {
    if (!this.enabled) return;
    const buffer = this.getDeviceDestroyedBuffer?.();
    if (!buffer) return;
    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.5 * this.effectsVolume * this.masterVolume);
    sound.play();
    sound.onEnded = () => sound.disconnect();
  }

  /**
   * Procedural explosion boom (small/medium).
   */
  playExplosion(intensity = 1.0) {
    if (!this.enabled) return;
    const buffer = this.getExplosionBuffer();
    if (!buffer) return;

    const vol = Math.max(0.2, Math.min(1.0, Number(intensity) || 1.0));
    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume((0.55 + vol * 0.25) * this.effectsVolume * this.masterVolume);
    sound.play();
    sound.onEnded = () => sound.disconnect();
  }

  /**
   * Procedural tool sounds (throw/deploy/trigger) without external assets.
   * @param {string} kind
   */
  playToolThrow(kind = '') {
    if (!this.enabled) return;

    const buffer = this.getToolThrowBuffer(kind);
    if (!buffer) return;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.32 * this.effectsVolume * this.masterVolume);
    sound.play();

    sound.onEnded = () => {
      sound.disconnect();
    };
  }

  /**
   * @param {string} kind
   */
  playToolDeploy(kind = '') {
    if (!this.enabled) return;

    const buffer = this.getToolDeployBuffer(kind);
    if (!buffer) return;

    const k = this.normalizeToolKind(kind);
    const baseVolume =
      k === 'mine' ? 0.4 :
      k === 'trap' ? 0.42 :
      k === 'jammer' ? 0.4 :
      k === 'sensor' ? 0.38 :
      0.36;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(baseVolume * this.effectsVolume * this.masterVolume);
    sound.play();

    sound.onEnded = () => {
      sound.disconnect();
    };
  }

  /**
   * @param {string} kind
   */
  playToolTrigger(kind = '') {
    if (!this.enabled) return;

    const buffer = this.getToolTriggerBuffer(kind);
    if (!buffer) return;

    const k = this.normalizeToolKind(kind);
    const baseVolume =
      k === 'mine' ? 0.75 :
      k === 'flash' ? 0.7 :
      k === 'trap' ? 0.62 :
      k === 'smoke' ? 0.58 :
      k === 'decoy' ? 0.6 :
      k === 'sensor' ? 0.52 :
      0.55;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(baseVolume * this.effectsVolume * this.masterVolume);
    sound.play();

    sound.onEnded = () => {
      sound.disconnect();
    };
  }

  normalizeToolKind(kind) {
    const k = String(kind || '').trim().toLowerCase();
    if (!k) return '';
    if (k.endsWith('_grenade')) return k.slice(0, -'_grenade'.length);
    return k;
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

  getToolThrowBuffer(kind) {
    const k = this.normalizeToolKind(kind) || 'tool';
    const key = `tool_throw_${k}_proc`;
    if (this.buffers.has(key)) return this.buffers.get(key);

    const ctx = this.listener.context;
    const duration = 0.16;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    let lp = 0;
    const alpha = 0.06;
    let whooshAmp = 0.55;
    let clickAmp = 0.25;
    if (k === 'smoke') {
      whooshAmp = 0.65;
      clickAmp = 0.15;
    } else if (k === 'flash') {
      whooshAmp = 0.5;
      clickAmp = 0.32;
    }
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 18);
      const white = Math.random() * 2 - 1;
      lp += (white - lp) * alpha;
      const whoosh = lp * env;
      const click = i < sampleRate * 0.008 ? (Math.random() * 2 - 1) * (1 - i / (sampleRate * 0.008)) : 0;
      data[i] = (whoosh * whooshAmp + click * clickAmp) * 0.75;
    }

    this.buffers.set(key, buffer);
    return buffer;
  }

  getToolDeployBuffer(kind) {
    const k = this.normalizeToolKind(kind) || 'tool';
    const key = `tool_deploy_${k}_proc`;
    if (this.buffers.has(key)) return this.buffers.get(key);

    const ctx = this.listener.context;
    const sampleRate = ctx.sampleRate;

    let duration = 0.12;
    if (k === 'jammer') duration = 0.18;
    if (k === 'mine') duration = 0.11;
    if (k === 'trap') duration = 0.1;

    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    if (k === 'trap') {
      const f1 = 980;
      const f2 = 1460;
      for (let i = 0; i < frameCount; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 42);
        const tone = Math.sin(2 * Math.PI * f1 * t) * 0.55 + Math.sin(2 * Math.PI * f2 * t) * 0.35;
        const noise = (Math.random() * 2 - 1) * 0.08;
        data[i] = (tone + noise) * env * 0.9;
      }
    } else if (k === 'jammer') {
      const toneA = 520;
      const toneB = 720;
      for (let i = 0; i < frameCount; i++) {
        const t = i / sampleRate;
        const ramp = Math.sin(Math.min(1, t / 0.01) * (Math.PI / 2));
        const env = ramp * Math.exp(-t * 12);

        let tone = 0;
        if (t < 0.06) {
          tone = Math.sin(2 * Math.PI * toneA * t) * 0.75;
        } else if (t < 0.12) {
          const tt = t - 0.06;
          tone = Math.sin(2 * Math.PI * toneB * tt) * 0.75;
        }

        const noise = (Math.random() * 2 - 1) * 0.03;
        data[i] = (tone + noise) * env * 0.85;
      }
    } else if (k === 'sensor') {
      const f0 = 980;
      const f1 = 1450;
      for (let i = 0; i < frameCount; i++) {
        const t = i / sampleRate;
        const p = t / duration;
        const freq = f0 + (f1 - f0) * p;
        const env = Math.sin(Math.min(1, t / 0.014) * (Math.PI / 2)) * Math.exp(-t * 14);
        const tone = Math.sin(2 * Math.PI * freq * t) * 0.85;
        data[i] = tone * env * 0.8;
      }
    } else if (k === 'mine') {
      const f0 = 210;
      const f1 = 140;
      for (let i = 0; i < frameCount; i++) {
        const t = i / sampleRate;
        const p = t / duration;
        const freq = f0 + (f1 - f0) * p;
        const env = Math.exp(-t * 32);
        const tone = Math.sin(2 * Math.PI * freq * t) * 0.65;
        const click = (Math.random() * 2 - 1) * 0.12;
        data[i] = (tone + click) * env * 0.85;
      }
    } else {
      // Lure / generic deploy: short rising chirp.
      const f0 = 560;
      const f1 = 820;
      for (let i = 0; i < frameCount; i++) {
        const t = i / sampleRate;
        const p = t / duration;
        const freq = f0 + (f1 - f0) * p;
        const env = Math.sin(Math.min(1, t / 0.016) * (Math.PI / 2)) * Math.exp(-t * 12);
        const tone = Math.sin(2 * Math.PI * freq * t) * 0.8;
        const noise = (Math.random() * 2 - 1) * 0.05;
        data[i] = (tone + noise) * env * 0.75;
      }
    }

    this.buffers.set(key, buffer);
    return buffer;
  }

  getToolTriggerBuffer(kind) {
    const k = this.normalizeToolKind(kind) || 'tool';
    const key = `tool_trigger_${k}_proc`;
    if (this.buffers.has(key)) return this.buffers.get(key);

    const ctx = this.listener.context;
    const sampleRate = ctx.sampleRate;

    let duration = 0.22;
    if (k === 'smoke') duration = 0.45;
    if (k === 'decoy') duration = 0.28;
    if (k === 'trap') duration = 0.14;
    if (k === 'mine') duration = 0.34;
    if (k === 'sensor') duration = 0.16;

    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    if (k === 'smoke') {
      let lp = 0;
      const alpha = 0.05;
      for (let i = 0; i < frameCount; i++) {
        const t = i / sampleRate;
        const env = Math.sin(Math.min(1, t / 0.02) * (Math.PI / 2)) * Math.exp(-t * 5.5);
        const white = Math.random() * 2 - 1;
        lp += (white - lp) * alpha;
        data[i] = lp * env * 0.75;
      }
    } else if (k === 'flash') {
      const f0 = 1200;
      const f1 = 2600;
      for (let i = 0; i < frameCount; i++) {
        const t = i / sampleRate;
        const p = t / duration;
        const freq = f0 + (f1 - f0) * p;
        const env = Math.sin(Math.min(1, t / 0.012) * (Math.PI / 2)) * Math.exp(-t * 18);
        const tone = Math.sin(2 * Math.PI * freq * t) * 0.9;
        const noise = (Math.random() * 2 - 1) * 0.18;
        data[i] = (tone + noise) * env * 0.8;
      }
    } else if (k === 'trap') {
      for (let i = 0; i < frameCount; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 55);
        const snap = (Math.random() * 2 - 1) * 0.75;
        const thud = Math.sin(2 * Math.PI * 180 * t) * 0.25;
        data[i] = (snap + thud) * env * 0.85;
      }
    } else if (k === 'mine') {
      const f0 = 95;
      const f1 = 62;
      for (let i = 0; i < frameCount; i++) {
        const t = i / sampleRate;
        const p = t / duration;
        const env = Math.exp(-t * 7.5);
        const freq = f0 + (f1 - f0) * p;
        const boom = Math.sin(2 * Math.PI * freq * t) * 0.65;
        const rumble = (Math.random() * 2 - 1) * 0.35;
        data[i] = (boom + rumble) * env * 0.9;
      }
    } else if (k === 'sensor') {
      const f0 = 980;
      const f1 = 1500;
      for (let i = 0; i < frameCount; i++) {
        const t = i / sampleRate;
        const p = t / duration;
        const freq = f0 + (f1 - f0) * p;
        const env = Math.sin(Math.min(1, t / 0.012) * (Math.PI / 2)) * Math.exp(-t * 15);
        const tone = Math.sin(2 * Math.PI * freq * t) * 0.9;
        data[i] = tone * env * 0.75;
      }
    } else if (k === 'decoy') {
      const f0 = 520;
      const f1 = 920;
      for (let i = 0; i < frameCount; i++) {
        const t = i / sampleRate;
        const p = t / duration;
        const freq = f0 + (f1 - f0) * p;
        const env = Math.sin(Math.min(1, t / 0.016) * (Math.PI / 2)) * Math.exp(-t * 10);
        const tone = Math.sin(2 * Math.PI * freq * t) * 0.7;
        const pop = (Math.random() * 2 - 1) * 0.28;
        data[i] = (tone + pop) * env * 0.9;
      }
    } else {
      // Generic trigger: short pop/chirp.
      const f0 = 420;
      const f1 = 820;
      for (let i = 0; i < frameCount; i++) {
        const t = i / sampleRate;
        const p = t / duration;
        const freq = f0 + (f1 - f0) * p;
        const env = Math.sin(Math.min(1, t / 0.016) * (Math.PI / 2)) * Math.exp(-t * 12);
        const tone = Math.sin(2 * Math.PI * freq * t) * 0.75;
        const noise = (Math.random() * 2 - 1) * 0.22;
        data[i] = (tone + noise) * env * 0.8;
      }
    }

    this.buffers.set(key, buffer);
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

  getPickupHealBuffer() {
    if (this.buffers.has('pickup_heal_proc')) {
      return this.buffers.get('pickup_heal_proc');
    }

    const ctx = this.listener.context;
    const duration = 0.22;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    const f0 = 660;
    const f1 = 990;
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const k = t / duration;
      const freq = f0 + (f1 - f0) * k;
      const env = Math.sin(Math.min(1, t / 0.02) * (Math.PI / 2)) * Math.exp(-t * 10);
      const tone = Math.sin(2 * Math.PI * freq * t) * 0.7 + Math.sin(2 * Math.PI * (freq * 2) * t) * 0.15;
      data[i] = tone * env * 0.85;
    }

    this.buffers.set('pickup_heal_proc', buffer);
    return buffer;
  }

  getPickupAttachmentBuffer() {
    if (this.buffers.has('pickup_attach_proc')) {
      return this.buffers.get('pickup_attach_proc');
    }

    const ctx = this.listener.context;
    const duration = 0.18;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    const f0 = 520;
    const f1 = 1040;
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const k = t / duration;
      const freq = f0 + (f1 - f0) * Math.pow(k, 0.7);
      const env = Math.sin(Math.min(1, t / 0.015) * (Math.PI / 2)) * Math.exp(-t * 14);
      const tone = Math.sin(2 * Math.PI * freq * t) * 0.65 + Math.sin(2 * Math.PI * (freq * 1.5) * t) * 0.18;
      const click = (Math.random() * 2 - 1) * 0.08 * Math.exp(-t * 28);
      data[i] = (tone + click) * env * 0.85;
    }

    this.buffers.set('pickup_attach_proc', buffer);
    return buffer;
  }

  getMonsterGuardBuffer() {
    if (this.buffers.has('monster_guard_proc')) {
      return this.buffers.get('monster_guard_proc');
    }

    const ctx = this.listener.context;
    const duration = 0.16;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    // Metallic "clang": two close tones + noise burst, fast decay.
    const fA = 520;
    const fB = 760;
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 22);
      const tone = Math.sin(2 * Math.PI * fA * t) * 0.55 + Math.sin(2 * Math.PI * fB * t) * 0.35;
      const noise = (Math.random() * 2 - 1) * 0.25;
      data[i] = (tone + noise) * env * 0.9;
    }

    this.buffers.set('monster_guard_proc', buffer);
    return buffer;
  }

  getAlarmBeepBuffer() {
    if (this.buffers.has('alarm_beep_proc')) {
      return this.buffers.get('alarm_beep_proc');
    }

    const ctx = this.listener.context;
    const duration = 0.14;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    const f = 880;
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const env = Math.sin(Math.min(1, t / 0.01) * (Math.PI / 2)) * Math.exp(-t * 10);
      const tone = Math.sin(2 * Math.PI * f * t) * 0.8 + Math.sin(2 * Math.PI * (f * 2) * t) * 0.12;
      data[i] = tone * env * 0.9;
    }

    this.buffers.set('alarm_beep_proc', buffer);
    return buffer;
  }

  getDeviceDestroyedBuffer() {
    if (this.buffers.has('device_destroyed_proc')) {
      return this.buffers.get('device_destroyed_proc');
    }

    const ctx = this.listener.context;
    const duration = 0.2;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    const f0 = 260;
    const f1 = 90;
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const p = t / duration;
      const env = Math.exp(-t * 14);
      const freq = f0 + (f1 - f0) * p;
      const tone = Math.sin(2 * Math.PI * freq * t) * 0.5;
      const noise = (Math.random() * 2 - 1) * 0.35;
      data[i] = (tone + noise) * env * 0.95;
    }

    this.buffers.set('device_destroyed_proc', buffer);
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

  getWeaponSwitchBuffer() {
    if (this.buffers.has('weapon_switch_proc')) return this.buffers.get('weapon_switch_proc');

    const ctx = this.listener.context;
    const duration = 0.08;
    const sampleRate = ctx.sampleRate;
    const frames = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 55);
      const click = (Math.random() * 2 - 1) * 0.55;
      const tone = Math.sin(t * Math.PI * 2 * 1400) * 0.25;
      data[i] = (click + tone) * env;
    }

    this.buffers.set('weapon_switch_proc', buffer);
    return buffer;
  }

  getReloadStartBuffer() {
    if (this.buffers.has('reload_start_proc')) return this.buffers.get('reload_start_proc');

    const ctx = this.listener.context;
    const duration = 0.18;
    const sampleRate = ctx.sampleRate;
    const frames = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 18);
      const clack = (Math.random() * 2 - 1) * 0.35;
      const low = Math.sin(t * Math.PI * 2 * 240) * 0.35;
      const high = Math.sin(t * Math.PI * 2 * 1100) * 0.12;
      data[i] = (clack + low + high) * env;
    }

    this.buffers.set('reload_start_proc', buffer);
    return buffer;
  }

  getReloadFinishBuffer() {
    if (this.buffers.has('reload_finish_proc')) return this.buffers.get('reload_finish_proc');

    const ctx = this.listener.context;
    const duration = 0.14;
    const sampleRate = ctx.sampleRate;
    const frames = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 22);
      const click = (Math.random() * 2 - 1) * 0.28;
      const tone = Math.sin(t * Math.PI * 2 * 900) * 0.25;
      const thud = Math.sin(t * Math.PI * 2 * 150) * 0.22;
      data[i] = (click + tone + thud) * env;
    }

    this.buffers.set('reload_finish_proc', buffer);
    return buffer;
  }

  getWeaponModeToggleBuffer() {
    if (this.buffers.has('weapon_mode_proc')) return this.buffers.get('weapon_mode_proc');

    const ctx = this.listener.context;
    const duration = 0.12;
    const sampleRate = ctx.sampleRate;
    const frames = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 28);
      const chirp = Math.sin(t * Math.PI * 2 * (720 + t * 1800)) * 0.35;
      const tick = (Math.random() * 2 - 1) * 0.18;
      data[i] = (chirp + tick) * env;
    }

    this.buffers.set('weapon_mode_proc', buffer);
    return buffer;
  }

  getGrenadeLaunchBuffer() {
    if (this.buffers.has('grenade_launch_proc')) return this.buffers.get('grenade_launch_proc');

    const ctx = this.listener.context;
    const duration = 0.22;
    const sampleRate = ctx.sampleRate;
    const frames = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 10);
      const boom = Math.sin(t * Math.PI * 2 * (110 + t * 90)) * 0.55;
      const snap = (Math.random() * 2 - 1) * 0.12;
      data[i] = (boom + snap) * env;
    }

    this.buffers.set('grenade_launch_proc', buffer);
    return buffer;
  }

  getEmpPulseBuffer() {
    if (this.buffers.has('emp_pulse_proc')) return this.buffers.get('emp_pulse_proc');

    const ctx = this.listener.context;
    const duration = 0.24;
    const sampleRate = ctx.sampleRate;
    const frames = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 9);
      const f = 260 + t * 1900;
      const tone = Math.sin(t * Math.PI * 2 * f) * 0.38;
      const buzz = Math.sin(t * Math.PI * 2 * (f * 1.98)) * 0.16;
      const noise = (Math.random() * 2 - 1) * 0.12;
      data[i] = (tone + buzz + noise) * env;
    }

    this.buffers.set('emp_pulse_proc', buffer);
    return buffer;
  }

  getExplosionBuffer() {
    if (this.buffers.has('explosion_proc')) return this.buffers.get('explosion_proc');

    const ctx = this.listener.context;
    const duration = 0.55;
    const sampleRate = ctx.sampleRate;
    const frames = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, sampleRate);
    const data = buffer.getChannelData(0);

    const base = 85;
    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 4.8);
      const rumble = Math.sin(t * Math.PI * 2 * (base + t * 30)) * 0.65;
      const roar = (Math.random() * 2 - 1) * 0.35;
      const crack = Math.sin(t * Math.PI * 2 * (420 + t * 180)) * 0.18;
      data[i] = (rumble + roar + crack) * env;
    }

    this.buffers.set('explosion_proc', buffer);
    return buffer;
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
