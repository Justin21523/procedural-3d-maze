import { EVENTS } from './events.js';

export class FeedbackSystem {
  constructor(eventBus, audioManager = null, visualEffects = null) {
    this.eventBus = eventBus;
    this.audioManager = audioManager;
    this.visualEffects = visualEffects;
    this.lastHurtSoundAt = 0;

    this.unsubscribers = [];
    this.bind();
  }

  bind() {
    this.unsubscribers.forEach((fn) => fn?.());
    this.unsubscribers = [];

    if (!this.eventBus?.on) return;

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.PLAYER_HIT_MONSTER, (payload) => {
        this.audioManager?.playHitMarker?.();
        void payload;
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.PLAYER_DAMAGED, (payload) => {
        const amount = Number.isFinite(payload?.amount) ? payload.amount : 0;
        if (amount <= 0) return;
        if (payload?.died) return;

        const now = performance.now();
        if (now - this.lastHurtSoundAt > 120) {
          this.audioManager?.playPlayerHurt?.();
          this.lastHurtSoundAt = now;
        }
        this.visualEffects?.damageRing?.(0.35, 0.55);
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.GAME_WON, () => {
        this.audioManager?.playGameWon?.();
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.GAME_LOST, () => {
        this.audioManager?.playGameLost?.();
      })
    );
  }

  setVisualEffects(visualEffects) {
    this.visualEffects = visualEffects;
  }

  dispose() {
    this.unsubscribers.forEach((fn) => fn?.());
    this.unsubscribers = [];
  }
}
