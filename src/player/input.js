/**
 * Input handler for keyboard and mouse
 * Centralizes all user input processing
 */

export class InputHandler {
  constructor() {
    // Keyboard state
    this.keys = {};

    // Mouse state
    this.mouseDelta = { x: 0, y: 0 };
    this.pointerLocked = false;

    // Setup event listeners
    this.setupListeners();
  }

  /**
   * Setup all input event listeners
   */
  setupListeners() {
    // Debug flag for first key press
    this.firstKeyPress = true;

    // Keyboard events
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;

      // Debug: Log first key press
      if (this.firstKeyPress) {
        console.log('✅ First key press detected:', e.code);
        console.log('Keyboard input working correctly');
        this.firstKeyPress = false;
      }

      // Prevent default behavior for game keys
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // Mouse movement
    document.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDelta.x = e.movementX;
        this.mouseDelta.y = e.movementY;
      }
    });

    // Pointer lock events
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement !== null;
      console.log('Pointer lock changed:', this.pointerLocked);
      if (this.pointerLocked) {
        console.log('✅ Pointer lock ACQUIRED - Mouse is now captured');
      } else {
        console.log('❌ Pointer lock RELEASED - Press ESC to show menu');
      }
    });

    document.addEventListener('pointerlockerror', () => {
      console.error('❌ Pointer lock ERROR - Could not capture mouse');
    });
  }

  /**
   * Request pointer lock (mouse capture)
   * Should be called on user interaction (e.g., button click)
   */
  requestPointerLock() {
    document.body.requestPointerLock();
  }

  /**
   * Exit pointer lock
   */
  exitPointerLock() {
    if (this.pointerLocked) {
      document.exitPointerLock();
    }
  }

  /**
   * Check if a key is currently pressed
   * @param {string} code - Key code (e.g., 'KeyW', 'Space')
   * @returns {boolean} True if pressed, false otherwise
   */
  isKeyPressed(code) {
    return !!this.keys[code];
  }

  /**
   * Get mouse movement delta and reset it
   * Should be called once per frame
   * @returns {Object} Mouse delta {x, y}
   */
  consumeMouseDelta() {
    const delta = { ...this.mouseDelta };
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    return delta;
  }

  /**
   * Check if pointer is locked
   * @returns {boolean} True if locked, false otherwise
   */
  isPointerLocked() {
    return this.pointerLocked;
  }

  /**
   * Get movement input as normalized vector
   * Returns {x, y} where x is strafe (left-right) and y is forward-back
   * @returns {Object} Movement vector {x, y}
   */
  getMovementInput() {
    let x = 0;
    let y = 0;

    if (this.isKeyPressed('KeyW')) y += 1;
    if (this.isKeyPressed('KeyS')) y -= 1;
    if (this.isKeyPressed('KeyA')) x -= 1;
    if (this.isKeyPressed('KeyD')) x += 1;

    // Normalize diagonal movement
    if (x !== 0 && y !== 0) {
      const length = Math.sqrt(x * x + y * y);
      x /= length;
      y /= length;
    }

    return { x, y };
  }

  /**
   * Check if sprint key is pressed
   * @returns {boolean} True if sprinting, false otherwise
   */
  isSprinting() {
    return this.isKeyPressed('ShiftLeft') || this.isKeyPressed('ShiftRight');
  }
}
