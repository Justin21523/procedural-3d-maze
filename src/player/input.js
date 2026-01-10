/**
 * Input handler for keyboard and mouse
 * Centralizes all user input processing
 */

export class InputHandler {
  constructor() {
    // Keyboard state
    this.keys = {};
    this.lastInputTime = performance.now();

    // Mouse state
    this.mouseDelta = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.mouseButtons = { left: false, right: false };
    this.mouseJustPressed = { left: false, right: false };

    // One-shot key presses
    this.justPressed = new Set();

    // Setup event listeners
    this.setupListeners();
  }

  resetState() {
    this.keys = {};
    this.justPressed = new Set();
    this.mouseDelta = { x: 0, y: 0 };
    this.mouseButtons = { left: false, right: false };
    this.mouseJustPressed = { left: false, right: false };
    this.lastInputTime = performance.now();
  }

  /**
   * Setup all input event listeners
   */
  setupListeners() {
    // Debug flag for first key press
    this.firstKeyPress = true;

    // Keyboard events
    window.addEventListener('keydown', (e) => {
      const wasDown = !!this.keys[e.code];
      this.keys[e.code] = true;
      if (!wasDown) {
        this.justPressed.add(e.code);
      }
      this.lastInputTime = performance.now();

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
      this.lastInputTime = performance.now();
    });

    window.addEventListener('blur', () => {
      // Avoid "stuck keys" when focus changes (e.g. opening overlays / switching tabs).
      this.resetState();
    });

    // Mouse movement
    document.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDelta.x = e.movementX;
        this.mouseDelta.y = e.movementY;
        this.lastInputTime = performance.now();
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        const wasDown = this.mouseButtons.left;
        this.mouseButtons.left = true;
        if (!wasDown) {
          this.mouseJustPressed.left = true;
        }
        this.lastInputTime = performance.now();
      } else if (e.button === 2) {
        const wasDown = this.mouseButtons.right;
        this.mouseButtons.right = true;
        if (!wasDown) {
          this.mouseJustPressed.right = true;
        }
        this.lastInputTime = performance.now();
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouseButtons.left = false;
        this.lastInputTime = performance.now();
      } else if (e.button === 2) {
        this.mouseButtons.right = false;
        this.lastInputTime = performance.now();
      }
    });

    // Prevent the right-click context menu while playing (pointer lock).
    document.addEventListener('contextmenu', (e) => {
      if (this.pointerLocked) {
        e.preventDefault();
      }
    });

    // Pointer lock events
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement !== null;
      console.log('Pointer lock changed:', this.pointerLocked);
      if (this.pointerLocked) {
        console.log('✅ Pointer lock ACQUIRED - Mouse is now captured');
      } else {
        // Ensure any held mouse buttons are released when pointer lock ends.
        this.mouseButtons.left = false;
        this.mouseButtons.right = false;
        this.mouseJustPressed.left = false;
        this.mouseJustPressed.right = false;
        this.mouseDelta.x = 0;
        this.mouseDelta.y = 0;
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
  requestPointerLock(element = null) {
    try {
      const target = element || document.body;
      target?.requestPointerLock?.();
    } catch (err) {
      console.error('❌ Pointer lock request failed:', err);
    }
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
   * Consume a key-down edge once.
   * @param {string} code
   * @returns {boolean}
   */
  consumeKeyPress(code) {
    if (!code) return false;
    if (this.justPressed.has(code)) {
      this.justPressed.delete(code);
      return true;
    }
    return false;
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
   * Peek current mouse delta without resetting (for input detection)
   * @returns {Object} Mouse delta {x, y}
   */
  peekMouseDelta() {
    return { ...this.mouseDelta };
  }

  /**
   * Check if pointer is locked
   * @returns {boolean} True if locked, false otherwise
   */
  isPointerLocked() {
    return this.pointerLocked;
  }

  /**
   * Seconds since the last keyboard or mouse input.
   * Used to determine when autopilot can take over.
   */
  getIdleTimeSeconds() {
    return (performance.now() - this.lastInputTime) / 1000;
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

  /**
   * Check if primary fire (left mouse) is held while pointer is locked.
   * @returns {boolean}
   */
  isFiring() {
    return this.pointerLocked && this.mouseButtons.left;
  }

  /**
   * Consume a mouse-down edge for primary fire (left click).
   * @returns {boolean}
   */
  consumeFirePressed() {
    if (!this.pointerLocked) {
      this.mouseJustPressed.left = false;
      return false;
    }
    if (this.mouseJustPressed.left) {
      this.mouseJustPressed.left = false;
      return true;
    }
    return false;
  }
}
