/**
 * Game State Manager
 * Manages game state including health, timer, objectives, etc.
 */

export class GameState {
  constructor() {
    // Player stats
    this.maxHealth = 100;
    this.currentHealth = 100;
    this.isDead = false;

    // Timer
    this.startTime = 0;
    this.currentTime = 0;
    this.isRunning = false;

    // Game status
    this.hasWon = false;
    this.hasLost = false;
    this.gameOver = false;

    // Objectives
    this.exitFound = false;
    this.itemsCollected = 0;
    this.itemsTotal = 0;

    // Statistics
    this.steps = 0;
    this.roomsVisited = new Set();

    console.log('🎮 GameState initialized');
  }

  /**
   * Start the game timer
   */
  startTimer() {
    this.startTime = Date.now();
    this.isRunning = true;
    console.log('⏱️ Timer started');
  }

  /**
   * Stop the game timer
   */
  stopTimer() {
    this.isRunning = false;
    console.log('⏱️ Timer stopped');
  }

  /**
   * Update timer (call every frame)
   */
  updateTimer() {
    if (this.isRunning) {
      this.currentTime = Date.now() - this.startTime;
    }
  }

  /**
   * Get elapsed time in seconds
   * @returns {number} Time in seconds
   */
  getElapsedTime() {
    return Math.floor(this.currentTime / 1000);
  }

  /**
   * Get formatted time string (MM:SS)
   * @returns {string} Formatted time
   */
  getFormattedTime() {
    const totalSeconds = this.getElapsedTime();
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Take damage
   * @param {number} amount - Damage amount
   * @returns {boolean} True if player died from this damage
   */
  takeDamage(amount) {
    this.currentHealth = Math.max(0, this.currentHealth - amount);
    console.log(`💔 Took ${amount} damage. Health: ${this.currentHealth}/${this.maxHealth}`);

    // Check if player died
    if (this.currentHealth <= 0 && !this.isDead) {
      this.isDead = true;
      this.lose('你的生命值耗尽了...');
      return true;
    }

    return false;
  }

  /**
   * Heal player
   * @param {number} amount - Heal amount
   */
  heal(amount) {
    const oldHealth = this.currentHealth;
    this.currentHealth = Math.min(this.maxHealth, this.currentHealth + amount);
    const actualHeal = this.currentHealth - oldHealth;
    console.log(`💚 Healed ${actualHeal} HP. Health: ${this.currentHealth}/${this.maxHealth}`);
  }

  /**
   * Get health percentage
   * @returns {number} Health percentage (0-100)
   */
  getHealthPercentage() {
    return (this.currentHealth / this.maxHealth) * 100;
  }

  /**
   * Mark a room as visited
   * @param {number} roomType - Room type
   */
  visitRoom(roomType) {
    this.roomsVisited.add(roomType);
  }

  /**
   * Increment step counter
   */
  addStep() {
    this.steps++;
  }

  /**
   * Player wins the game
   * @param {string} reason - Reason for winning
   */
  win(reason = '你找到了出口！') {
    if (this.gameOver) return;

    this.hasWon = true;
    this.gameOver = true;
    this.stopTimer();

    console.log('🎉 GAME WON:', reason);
    console.log('📊 Final Stats:', {
      time: this.getFormattedTime(),
      health: this.currentHealth,
      roomsVisited: this.roomsVisited.size,
      steps: this.steps
    });
  }

  /**
   * Player loses the game
   * @param {string} reason - Reason for losing
   */
  lose(reason = '游戏结束') {
    if (this.gameOver) return;

    this.hasLost = true;
    this.gameOver = true;
    this.stopTimer();

    console.log('💀 GAME LOST:', reason);
    console.log('📊 Final Stats:', {
      time: this.getFormattedTime(),
      health: this.currentHealth,
      roomsVisited: this.roomsVisited.size,
      steps: this.steps
    });
  }

  /**
   * Reset game state
   */
  reset() {
    this.currentHealth = this.maxHealth;
    this.isDead = false;
    this.hasWon = false;
    this.hasLost = false;
    this.gameOver = false;
    this.exitFound = false;
    this.itemsCollected = 0;
    this.steps = 0;
    this.roomsVisited.clear();
    this.startTime = 0;
    this.currentTime = 0;
    this.isRunning = false;

    console.log('🔄 GameState reset');
  }

  /**
   * Get game statistics
   * @returns {Object} Game statistics
   */
  getStats() {
    return {
      health: this.currentHealth,
      maxHealth: this.maxHealth,
      healthPercentage: this.getHealthPercentage(),
      time: this.getElapsedTime(),
      timeFormatted: this.getFormattedTime(),
      steps: this.steps,
      roomsVisited: this.roomsVisited.size,
      itemsCollected: this.itemsCollected,
      itemsTotal: this.itemsTotal,
      hasWon: this.hasWon,
      hasLost: this.hasLost,
      gameOver: this.gameOver
    };
  }
}
