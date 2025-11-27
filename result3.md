我先直接給「可以貼進專案」的修改方案；後面再解釋關卡設計與測試流程。
（以下路徑都用你描述的結構：`src/core/gameLoop.js` 之類。）

---

## 1. 自動駕駛＋手動輸入共存（GameLoop 合併邏輯）

你現在的程式其實已經有一套滿完整的 autopilot 合併邏輯了，只要確認這一段存在於 `GameLoop.update()` 的前半段即可。

### 1-1. `src/core/gameLoop.js`：在 `update(deltaTime)` 裡的 autopilot 區段

請在 `update(deltaTime)` 中（在呼叫 `this.player.update()` 之前）確保有下面這一段；如果你現在是舊版，建議直接用這段覆蓋舊的 autopilot 邏輯：

```js
  update(deltaTime) {
    // Clamp deltaTime to prevent physics issues on lag spikes
    const dt = Math.min(deltaTime, 0.1);

    // Don't update if game is over
    if (this.gameState && this.gameState.gameOver) {
      return;
    }

    // Update game state timer
    if (this.gameState) {
      this.gameState.updateTimer();
    }

    // --- Autopilot orchestration ---
    // 玩家輸入優先；空閒超過延遲才讓 autopilot 接管 movement/look
    let externalCommand = null;
    const allowAutopilot = !!CONFIG.AUTOPILOT_ENABLED;
    const delay = CONFIG.AUTOPILOT_DELAY ?? 0;

    const idleSeconds = this.player?.input?.getIdleTimeSeconds
      ? this.player.input.getIdleTimeSeconds()
      : Infinity;

    const mouseDelta = this.player?.input?.peekMouseDelta
      ? this.player.input.peekMouseDelta()
      : { x: 0, y: 0 };

    const hasPlayerMove =
      this.player?.input?.isKeyPressed('KeyW') ||
      this.player?.input?.isKeyPressed('KeyA') ||
      this.player?.input?.isKeyPressed('KeyS') ||
      this.player?.input?.isKeyPressed('KeyD') ||
      this.player?.input?.isKeyPressed('ShiftLeft') ||
      this.player?.input?.isKeyPressed('ShiftRight');

    const hasPlayerLook = mouseDelta.x !== 0 || mouseDelta.y !== 0;

    // 只有「完全 idle」（沒按鍵、沒動滑鼠）且超過 AUTOPILOT_DELAY 才讓 autopilot 真正接管
    const autopilotControlling =
      allowAutopilot &&
      idleSeconds >= delay &&
      !hasPlayerMove &&
      !hasPlayerLook;

    if (this.autopilot) {
      // autopilot 只看 CONFIG 開關；即使玩家有輸入，仍然持續規劃路徑
      this.autopilot.setEnabled(allowAutopilot);

      // 一律讓 autopilot.tick() 持續跑，用來更新 internal path / stuck 偵測
      externalCommand = this.autopilot.tick(dt);

      // 若此幀玩家有任何輸入，就把指令丟掉：玩家輸入即時覆蓋 move/look
      if (!autopilotControlling) {
        externalCommand = null;
      }
    }

    // 將 Autopilot 的指令注入 PlayerController（不直接改位置）
    if (externalCommand) {
      this.player.applyExternalControl(externalCommand, dt);
    }

    // autopilotControlling = true 時，即使沒 pointer lock 也允許移動
    this.autopilotActive = autopilotControlling;
    this.player.update(dt, this.autopilotActive);

    // 其餘 update（怪物、任務、UI ...）維持不變
    // ...
```

**行為解說：**

* `InputHandler.getIdleTimeSeconds()` 會在任何鍵盤或滑鼠事件時重置計時，因此 idle 判斷很精準。
* `hasPlayerMove` / `hasPlayerLook` 把 WASD＋Shift＋滑鼠視角都視為「手動輸入」，只要有，就禁止這幀注入 autopilot 的指令。
* `autopilot.tick(dt)` 每幀仍然會跑（只要 CONFIG 沒關），這樣 autopilot 可以持續重新規劃路徑與 stuck 偵測；但「位移與轉向」只有在 `autopilotControlling === true` 時才透過 `applyExternalControl()` 注入玩家。
* `this.autopilotActive` 會傳到 `PlayerController.update(dt, autopilotActive)`，讓 autopilot 在沒有 pointer lock 的情況下也可以移動。

### 1-2. `src/player/playerController.js`：手動滑鼠視角＋外部控制共存

目前你的 `PlayerController.update()` 已經正確把滑鼠與 autopilot 的 look 合併了：

```js
  update(deltaTime, autopilotActive = false) {
    // 只要 autopilot 啟動，就允許無 pointer lock 的移動
    if (!this.input.isPointerLocked() && !autopilotActive) {
      return;
    }

    // Save last position for step tracking
    this.lastPosition.copy(this.position);

    // 先吃掉滑鼠輸入 → 玩家總是可以手動調整視角
    const mouseDelta = this.input.consumeMouseDelta();
    this.camera.updateRotation(mouseDelta.x, mouseDelta.y);

    // 再套用 autopilot 的絕對 yaw（若有）
    if (this.externalLookYaw !== null) {
      this.camera.setYaw(this.externalLookYaw);
      this.externalLookYaw = null;
    }

    const moveVector = this.externalMove
      ? this.externalMove.clone()
      : this.calculateMovement(deltaTime);

    this.applyMovement(moveVector);
    this.updateStatistics();
    this.camera.updatePosition(this.position.x, this.position.y, this.position.z);

    // 清掉這幀的 externalMove
    this.externalMove = null;
  }
```

這樣的組合滿足：

* 滑鼠隨時可以改變視角（即使 autopilot 開著），而且總是優先於 autopilot。
* autopilot 的 `lookYaw` 只會在「玩家 idle」的幀被套用，且用 `FirstPersonCamera.setYaw()` 直接對應絕對朝向。

---

## 2. 防卡牆／卡怪：連續分離＋圓形碰撞

你現在已有兩層 anti-stuck：

* `PlayerController.canMoveTo()`＋`tryUnstuck()`：針對牆角、狹縫做 8 點檢查與微移位／最後跳到最近可走格。
* `GameLoop.applyPlayerKnockback()`＋`separatePlayerFromMonsters()`：打到怪物會推開，且每幀持續做軟分離，避免黏在怪身上。

這裡我增加一層「**圓形玩家 vs 牆的連續分離**」在 `PlayerController` 裡，專門處理貼牆／卡牆角的情況，不會把人推進牆裡。

### 2-1. `src/player/playerController.js`：在 `applyMovement()` 後呼叫 `separateFromWalls()`

把原本的 `applyMovement` 換成這版（僅在最後多呼叫 `this.separateFromWalls();`，其它邏輯保留）：

```js
  /**
   * Apply movement with collision detection
   * @param {THREE.Vector3} moveVector - Desired movement vector
   */
  applyMovement(moveVector) {
    if (moveVector.lengthSq() === 0) {
      return;
    }

    const beforePos = this.position.clone();
    const targetX = this.position.x + moveVector.x;
    const targetZ = this.position.z + moveVector.z;

    // 1. 先嘗試完整位移
    if (this.canMoveTo(targetX, targetZ)) {
      this.position.x = targetX;
      this.position.z = targetZ;

      // 做一次牆面分離，避免剛好卡在牆角邊緣
      this.separateFromWalls();
      return;
    }

    // 2. 滑牆：嘗試單軸移動，優先較大軸
    let moved = false;
    if (Math.abs(moveVector.x) > Math.abs(moveVector.z)) {
      const newPosX = this.position.x + moveVector.x;
      if (this.canMoveTo(newPosX, this.position.z)) {
        this.position.x = newPosX;
        moved = true;
      }
      const newPosZ = this.position.z + moveVector.z;
      if (this.canMoveTo(this.position.x, newPosZ)) {
        this.position.z = newPosZ;
        moved = true;
      }
    } else {
      const newPosZ = this.position.z + moveVector.z;
      if (this.canMoveTo(this.position.x, newPosZ)) {
        this.position.z = newPosZ;
        moved = true;
      }
      const newPosX = this.position.x + moveVector.x;
      if (this.canMoveTo(newPosX, this.position.z)) {
        this.position.x = newPosX;
        moved = true;
      }
    }

    // 3. 完全卡住時嘗試輕微挪動避免「貼牆卡住」
    const movedDistance = this.position.distanceTo(beforePos);
    if (movedDistance < 0.0001) {
      this.tryUnstuck(moveVector);
    } else {
      this.stuckTimer = 0;
    }

    // 4. 最後再做一次牆面分離（針對卡牆角）
    this.separateFromWalls();
  }
```

### 2-2. 新增 `separateFromWalls()`：圓形 collider 對牆的連續解穿

在 `PlayerController` 內（放在 `canMoveTo()` 之後、`tryUnstuck()` 之前或之後都可），加入這個方法： 

```js
  /**
   * Resolve small overlaps between the player circle and nearby wall tiles.
   * 以圓形 collider 持續把玩家從牆面 / 牆角推開，但不會推進牆內。
   */
  separateFromWalls() {
    if (!this.worldState || !this.worldState.isWalkable) {
      return;
    }

    const tileSize = CONFIG.TILE_SIZE || 1;
    const radius = CONFIG.PLAYER_RADIUS;
    const gridPos = this.getGridPosition();

    let centerX = this.position.x;
    let centerZ = this.position.z;

    // 檢查自身格子周圍 3x3 的牆磚
    for (let gy = gridPos.y - 1; gy <= gridPos.y + 1; gy++) {
      for (let gx = gridPos.x - 1; gx <= gridPos.x + 1; gx++) {
        // 把「不可走」一律視為牆，包括邊界外
        if (this.worldState.isWalkable(gx, gy)) {
          continue;
        }

        const tileMinX = gx * tileSize;
        const tileMaxX = tileMinX + tileSize;
        const tileMinZ = gy * tileSize;
        const tileMaxZ = tileMinZ + tileSize;

        // 取得牆 tile 對玩家中心的最近點（矩形最近點）
        const nearestX = Math.max(tileMinX, Math.min(centerX, tileMaxX));
        const nearestZ = Math.max(tileMinZ, Math.min(centerZ, tileMaxZ));

        const dx = centerX - nearestX;
        const dz = centerZ - nearestZ;
        const distSq = dx * dx + dz * dz;

        // 若距離 >= 半徑，代表沒有交疊
        if (distSq === 0 || distSq >= radius * radius) {
          continue;
        }

        const dist = Math.sqrt(distSq) || 0.0001;
        const overlap = (radius - dist) * 1.05; // 稍微超出一點，避免浮點誤差

        const nx = dx / dist;
        const nz = dz / dist;

        const newX = centerX + nx * overlap;
        const newZ = centerZ + nz * overlap;

        // 最後仍透過 canMoveTo 檢查，確保不會被推進牆裡
        if (this.canMoveTo(newX, newZ)) {
          this.position.x = newX;
          this.position.z = newZ;
          centerX = newX;
          centerZ = newZ;
        }
      }
    }
  }
```

這段等於在 **每幀移動完之後，把玩家當成圓形 collider，對附近牆磚做分離**：

* 貼牆跑步時會微微被推離牆面，不會卡在波浪邊緣。
* 卡牆角時，最近點會在牆角附近，推力剛好沿著角落斜向推出。
* 因為最後仍用 `canMoveTo()` 檢查，推開過程也不會把人推進牆內。

### 2-3. 怪物分離／被打退（原本就有，這裡整理成「防黏怪」方案）

在 `GameLoop` 中已有兩個關鍵方法：

* `applyPlayerKnockback(monster)`：被怪撞到時，依「玩家 - 怪物」方向推退一小段，同時檢查目標格是否 walkable。
* `separatePlayerFromMonsters(playerPos)`：每幀巡迴所有怪物，若距離小於一個最小值（約 0.6 tile），則把玩家沿著分離向量推開，同樣不會推入牆。

在 `update()` 中已有這段呼叫：

```js
    // Update monsters via MonsterManager
    if (this.monsterManager && this.monsterManager.update) {
      this.monsterManager.update(dt, playerPos);
    }

    // Soft separation to reduce sticking with monsters
    this.separatePlayerFromMonsters(playerPos);

    // Check monster collision (damage player)
    if (this.monsterManager && this.gameState) {
      const now = performance.now() / 1000;
      if (now - this.lastMonsterDamageTime > this.monsterDamageCooldown) {
        const caught = this.monsterManager.checkPlayerCaught(playerPos, 1.25);
        if (caught?.hit) {
          // ... 扣血＋ knockback ...
          this.applyPlayerKnockback(caught.monster);
        }
      }
    }
```

這樣怪物與玩家會呈現 **「軟碰撞＋受擊推退」**，搭配上述牆面分離可以大幅降低「夾在怪跟牆中間動不了」的情況。

---

## 3. 關卡數值表：7 關難度遞進 `LEVEL_CONFIGS`

以下是完整的 `src/core/levelConfigs.js`，延伸成 7 關，並維持你原本的欄位格式：

```js
// src/core/levelConfigs.js
// Level configuration table for progressive difficulty
// Each entry defines maze size/density, monster mix, missions, player upgrades, and autopilot tuning.

export const LEVEL_CONFIGS = [
  {
    id: 1,
    name: 'L1-新手教學',
    maze: { width: 21, height: 21, roomDensity: 1.5, extraConnectionChance: 0.02 },
    monsters: {
      count: 4,
      speedMultiplier: 1.0,
      visionMultiplier: 0.8,
      memoryMultiplier: 0.7,
      typeWeights: { WANDERER: 0.7, HUNTER: 0.3 },
      allowSprintTypes: ['HUNTER'],
    },
    missions: {
      type: 'collectAndExit',
      missionPointCount: 3,
      requiredToUnlockExit: 3,
      timeLimitSec: 0,
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 4,
      replanInterval: 0.6,
      stuckSeconds: 1.2,
      noProgressSeconds: 0.8,
    },
  },
  {
    id: 2,
    name: 'L2-正式迷宮',
    maze: { width: 25, height: 25, roomDensity: 2.0, extraConnectionChance: 0.05 },
    monsters: {
      count: 6,
      speedMultiplier: 1.0,
      visionMultiplier: 1.0,
      memoryMultiplier: 1.0,
      typeWeights: { WANDERER: 0.5, HUNTER: 0.3, SENTINEL: 0.2 },
      allowSprintTypes: ['HUNTER', 'SENTINEL'],
    },
    missions: {
      type: 'collectAndExit',
      missionPointCount: 4,
      requiredToUnlockExit: 3,
      timeLimitSec: 0,
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 5,
      replanInterval: 0.5,
      stuckSeconds: 1.0,
      noProgressSeconds: 0.6,
    },
  },
  {
    id: 3,
    name: 'L3-時間壓力',
    maze: { width: 29, height: 29, roomDensity: 2.5, extraConnectionChance: 0.08 },
    monsters: {
      count: 8,
      speedMultiplier: 1.05,
      visionMultiplier: 1.1,
      memoryMultiplier: 1.2,
      typeWeights: { WANDERER: 0.3, HUNTER: 0.4, SENTINEL: 0.2, STALKER: 0.1 },
      allowSprintTypes: ['HUNTER', 'SENTINEL'],
    },
    missions: {
      type: 'timeAttack',
      missionPointCount: 5,
      requiredToUnlockExit: 4,
      timeLimitSec: 300,
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 5,
      replanInterval: 0.45,
      stuckSeconds: 0.9,
      noProgressSeconds: 0.5,
    },
  },
  {
    id: 4,
    name: 'L4-守衛走廊',
    maze: { width: 31, height: 31, roomDensity: 3.0, extraConnectionChance: 0.12 },
    monsters: {
      count: 10,
      speedMultiplier: 1.1,
      visionMultiplier: 1.2,
      memoryMultiplier: 1.3,
      typeWeights: {
        WANDERER: 0.2,
        HUNTER: 0.3,
        SENTINEL: 0.3,
        STALKER: 0.1,
        RUSHER: 0.1,
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'RUSHER'],
    },
    missions: {
      type: 'escort',
      missionPointCount: 0,
      requiredToUnlockExit: 0,
      timeLimitSec: 420,
    },
    player: {
      maxHealthMultiplier: 0.9,
      upgradeChoices: [
        'SPRINT_BOOST',
        'EXTRA_HEART',
        'MISSION_HINT',
        'SHORT_STEALTH',
        'DASH',
      ],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 4,
      replanInterval: 0.4,
      stuckSeconds: 0.8,
      noProgressSeconds: 0.4,
    },
  },
  {
    id: 5,
    name: 'L5-終局迷宮',
    maze: { width: 35, height: 35, roomDensity: 3.5, extraConnectionChance: 0.15 },
    monsters: {
      count: 12,
      speedMultiplier: 1.15,
      visionMultiplier: 1.3,
      memoryMultiplier: 1.5,
      typeWeights: {
        WANDERER: 0.1,
        HUNTER: 0.35,
        SENTINEL: 0.25,
        STALKER: 0.2,
        RUSHER: 0.1,
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'RUSHER', 'STALKER'],
    },
    missions: {
      type: 'mixed',
      missionPointCount: 6,
      requiredToUnlockExit: 5,
      timeLimitSec: 480,
    },
    player: {
      maxHealthMultiplier: 0.85,
      upgradeChoices: [
        'SPRINT_BOOST',
        'EXTRA_HEART',
        'MISSION_HINT',
        'SHORT_STEALTH',
        'DASH',
      ],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 4,
      replanInterval: 0.35,
      stuckSeconds: 0.7,
      noProgressSeconds: 0.35,
    },
  },
  {
    id: 6,
    name: 'L6-黑暗校舍',
    maze: { width: 33, height: 33, roomDensity: 3.6, extraConnectionChance: 0.16 },
    monsters: {
      count: 12,
      speedMultiplier: 1.2,
      visionMultiplier: 1.4,
      memoryMultiplier: 1.6,
      typeWeights: {
        WANDERER: 0.05,
        HUNTER: 0.35,
        SENTINEL: 0.2,
        STALKER: 0.25,
        RUSHER: 0.15,
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'RUSHER', 'STALKER'],
    },
    missions: {
      type: 'timeAttack',
      missionPointCount: 7,
      requiredToUnlockExit: 5,
      timeLimitSec: 420,
    },
    player: {
      maxHealthMultiplier: 0.8,
      upgradeChoices: [
        'SPRINT_BOOST',
        'EXTRA_HEART',
        'MISSION_HINT',
        'SHORT_STEALTH',
        'DASH',
      ],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 4,
      replanInterval: 0.32,
      stuckSeconds: 0.7,
      noProgressSeconds: 0.35,
    },
  },
  {
    id: 7,
    name: 'L7-無盡輪迴',
    maze: { width: 35, height: 35, roomDensity: 3.8, extraConnectionChance: 0.18 },
    monsters: {
      count: 12,
      speedMultiplier: 1.25,
      visionMultiplier: 1.5,
      memoryMultiplier: 1.8,
      typeWeights: {
        WANDERER: 0.0,
        HUNTER: 0.3,
        SENTINEL: 0.2,
        STALKER: 0.3,
        RUSHER: 0.2,
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'RUSHER', 'STALKER'],
    },
    missions: {
      type: 'mixed',
      missionPointCount: 8,
      requiredToUnlockExit: 6,
      timeLimitSec: 540,
    },
    player: {
      maxHealthMultiplier: 0.75,
      upgradeChoices: [
        'SPRINT_BOOST',
        'EXTRA_HEART',
        'MISSION_HINT',
        'SHORT_STEALTH',
        'DASH',
      ],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 4,
      replanInterval: 0.3,
      stuckSeconds: 0.65,
      noProgressSeconds: 0.3,
    },
  },
];
```

### 每關設計意圖簡述

1. **L1-新手教學**

   * 小地圖、低房間密度、只有 WANDERER＋少量 HUNTER。
   * 沒有時間限制，讓玩家熟悉操作與 minimap、autopilot 行為。

2. **L2-正式迷宮**

   * 25×25，房間變多、SENTINEL 加入，走廊警戒區域開始出現。
   * 任務點略多，但仍無時間壓力。

3. **L3-時間壓力**

   * 29×29，怪物速度與視野提升，STALKER 參戰。
   * `timeAttack`＋ 300 秒：autopilot 需要更積極走最短路線找任務點。

4. **L4-守衛走廊**

   * 31×31，高房間密度，SENTINEL 與 RUSHER 比重高。
   * `escort` 類型預留給劇情／護送玩法（即使目前程式只把任務點當收集點用也沒關係）。

5. **L5-終局迷宮**

   * 最大地圖 35×35、怪物 12 隻，視野／記憶再上升。
   * `mixed` 任務（多任務點＋需收集大多數才能開出口），要求玩家熟悉路線與怪物分佈。

6. **L6-黑暗校舍**

   * 33×33、怪物保持 12 隻，但速度與 AI scaling 再拉高。
   * `timeAttack` 420 秒、任務點更多，強迫玩家與 autopilot 配合分區清任務。

7. **L7-無盡輪迴**

   * 35×35、完全沒有 WANDERER，全是獵人／守衛／跟蹤＋衝鋒怪。
   * `mixed` ＋較長時間限制，作為最終「全系統壓力測試」關卡。

關卡切換已在 `main.js` 中透過 `loadLevel()`＋`gameLoop.onWin` / restart 邏輯串好，不需再額外改。

---

## 4. 若要新增怪物／任務類型：最小範例

### 4-1. 新怪物類型：使用現成的 `ShyGreeterBrain`

`src/ai/monsterAI.js` 中已經有 `ShyGreeterBrain`，但 `MonsterTypes` 目前沒有對應的類型。

要加入一個新的「GREETER」怪，可以在 `src/ai/monsterTypes.js` 的 `MonsterTypes` 物件中，增加一段：

```js
  /**
   * GREETER - 看到玩家會保持距離地「打招呼」的害羞怪
   */
  GREETER: {
    name: 'Greeter',
    aiType: 'shyGreeter',
    model: '/models/monster.png',
    sprite: '/models/monster.png',

    stats: {
      speedFactor: 0.9,
      visionRange: 12,
      visionFOV: Math.PI * 120 / 180,
      hearingRange: 6,
      scale: 1,
    },

    behavior: {
      aggressiveness: 'low',
      chaseMemory: 4000,
      chaseCooldown: 4000,
      searchRadius: 3,
      searchDuration: 4000,
      patrolStyle: 'zone',
      patrolSpeed: 0.8,
      pauseChance: 0.06,
      preferredMode: 'greet',
    },

    animations: {
      idle: ['Idle', 'idle'],
      walk: ['Walk', 'walk'],
      run: ['Run', 'run'],
    },

    appearance: {
      emissiveColor: 0x00ffff,
      emissiveIntensity: 0.25,
    },
  },
```

然後在某一關的 `typeWeights` 中加入例如：

```js
typeWeights: {
  WANDERER: 0.4,
  GREETER: 0.2,
  HUNTER: 0.4,
},
```

`MonsterManager` 會透過 `createMonsterMix(count, weights)` 正確抽到 `GREETER`，而 `aiType: 'shyGreeter'` 會讓 `createMonsterBrain()` 建立對應的 `ShyGreeterBrain`。

> 注意：目前 `allowSprintTypes` 判斷是用 `typeConfig.name`（"Hunter" 這種），而不是 key 名（"HUNTER"）。如果之後想讓衝刺設定真的生效，可以把 `buildBrainConfig()` 裡改成比對 key（或額外傳 key），這部分不影響本次修改。

### 4-2. 任務類型 enum（如果要統一管理）

目前任務類型是用字串（`'collectAndExit'`, `'timeAttack'`, `'escort'`, `'mixed'`）。若想要 enum，可以在 `src/core/levelConfigs.js` 或新檔 `src/core/missionTypes.js` 裡加：

```js
export const MISSION_TYPES = {
  COLLECT_AND_EXIT: 'collectAndExit',
  TIME_ATTACK: 'timeAttack',
  ESCORT: 'escort',
  MIXED: 'mixed',
};
```

然後在 `LEVEL_CONFIGS` 裡用 `MISSION_TYPES.COLLECT_AND_EXIT` 取代硬字串即可。若要真正依 mission type 改變勝敗條件，可以在 `GameLoop.update()` 中讀取當前 `levelConfig.missions.type` 判斷，例如實作 time limit 失敗判定。

---

## 5. 測試流程建議

### 5-1. 驗證 autopilot / 手動切換

1. 在設定面板確認「AutoPilot」開啟、delay 設為 0～0.5s。
2. 放著不動，觀察 autopilot 是否開始自動走向任務點／出口。
3. **按下 W / A / S / D 或 Shift：**

   * 角色立刻改由你控制移動。
   * autopilot movement 停止（不再自動轉彎）。
4. **移動滑鼠：**

   * 視角立刻跟隨；若你持續晃動，autopilot 不會重新接管。
   * 放開滑鼠與鍵盤，等待超過 AUTOPILOT_DELAY，觀察 autopilot 再次接手。

可以在畫面左下角的 debug UI 觀察 key 狀態與 pointer lock 狀態，確認輸入判斷是否正確。

### 5-2. 驗證不再卡牆／卡怪

1. 站在狹窄走廊的牆角，持續往牆角方向前進（按 W＋A / W＋D）：

   * 角色應該會沿牆滑動，或被輕微往走廊中央推，不會原地晃動卡死。
2. 使用 debug teleport 或 minimap 點擊，把自己傳到窄房間角落附近重複測試。
3. 用 debug 按鈕傳送到怪物旁邊，主動撞上怪物：

   * 若被判定「被抓」，血量下降，並看到明顯的 knockback。
   * 若只是靠近，`separatePlayerFromMonsters` 應該會讓你和怪物之間有一點安全距離，而不會黏死。

### 5-3. 驗證關卡銜接與難度

1. 正常通關 L1～L3，確認：

   * 地圖尺寸隨關卡放大。
   * 怪物數量與類型依設定變化（可用 console `debugMonsters()` 看分佈）。
2. 在 L3 / L6 時注意時間壓力是否合理（即使目前還沒實作 time-out 失敗，你可以先觀察通關時間）。
3. 通關到 L7，確認 `restart` 之後會從 L1 重新輪回（`(currentLevelIndex + 1) % LEVEL_CONFIGS.length`）。

---

如果你願意，我也可以下一步幫你把 `missions.type` 真正串進 `GameLoop`，實作 `timeAttack` 超時判負、`collectAndExit` 收集數未達時關閉出口之類的邏輯；目前這一版主要先把 autopilot 共存、碰撞防卡，以及多關卡數值整理好。
