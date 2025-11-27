我先直接給一套「可以落地」的設計，再分檔案說明要改哪裡、改什麼。

---

## 一、關卡設計框架：等級 → 設定包

### 1. 新增一份關卡表（建議放在 `config.js` 或新檔 `levelConfigs.js`）

**資料結構：**

```js
// src/core/levelConfigs.js
export const LEVEL_CONFIGS = [
  {
    id: 1,
    name: 'L1-新手教學',
    maze: {
      width: 21,
      height: 21,
      roomDensity: 1.5,
      extraConnectionChance: 0.02,   // 死路較多，路徑簡單
    },
    monsters: {
      count: 4,
      speedMultiplier: 1.0,          // 乘在「玩家速度 * 0.8」之上
      visionMultiplier: 0.8,
      memoryMultiplier: 0.7,
      typeWeights: {                 // 怪物類型權重
        WANDERER: 0.7,
        HUNTER: 0.3
      },
      allowSprintTypes: ['HUNTER'],  // 哪些 type 可以觸發短衝刺
    },
    missions: {
      type: 'collectAndExit',        // collectAndExit | exitOnly | timeAttack | escort | puzzle
      missionPointCount: 3,
      requiredToUnlockExit: 3,
      timeLimitSec: 0                // 0 = 無限時間
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART'],
      upgradesPerLevel: 1
    },
    autopilot: {
      avoidRadius: 4,
      replanInterval: 0.6,
      stuckSeconds: 1.2,
      noProgressSeconds: 0.8
    }
  },

  {
    id: 2,
    name: 'L2-正式迷宮',
    maze: {
      width: 25,
      height: 25,
      roomDensity: 2.0,
      extraConnectionChance: 0.05
    },
    monsters: {
      count: 6,
      speedMultiplier: 1.0,
      visionMultiplier: 1.0,
      memoryMultiplier: 1.0,
      typeWeights: {
        WANDERER: 0.5,
        HUNTER: 0.3,
        SENTINEL: 0.2
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL']
    },
    missions: {
      type: 'collectAndExit',
      missionPointCount: 4,
      requiredToUnlockExit: 3,
      timeLimitSec: 0
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT'],
      upgradesPerLevel: 1
    },
    autopilot: {
      avoidRadius: 5,
      replanInterval: 0.5,
      stuckSeconds: 1.0,
      noProgressSeconds: 0.6
    }
  },

  {
    id: 3,
    name: 'L3-時間壓力',
    maze: {
      width: 29,
      height: 29,
      roomDensity: 2.5,
      extraConnectionChance: 0.08
    },
    monsters: {
      count: 8,
      speedMultiplier: 1.05,
      visionMultiplier: 1.1,
      memoryMultiplier: 1.2,
      typeWeights: {
        WANDERER: 0.3,
        HUNTER: 0.4,
        SENTINEL: 0.2,
        STALKER: 0.1
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL']
    },
    missions: {
      type: 'timeAttack',            // 限時收集+出口
      missionPointCount: 5,
      requiredToUnlockExit: 4,
      timeLimitSec: 300              // 5 分鐘
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
      upgradesPerLevel: 1
    },
    autopilot: {
      avoidRadius: 5,
      replanInterval: 0.45,
      stuckSeconds: 0.9,
      noProgressSeconds: 0.5
    }
  },

  {
    id: 4,
    name: 'L4-守衛走廊',
    maze: {
      width: 31,
      height: 31,
      roomDensity: 3.0,
      extraConnectionChance: 0.12     // loop 多、分叉多
    },
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
        RUSHER: 0.1
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'RUSHER']
    },
    missions: {
      type: 'escort',                // 未來擴充：護送 NPC 走到出口
      missionPointCount: 0,
      requiredToUnlockExit: 0,
      timeLimitSec: 420
    },
    player: {
      maxHealthMultiplier: 0.9,      // 往後關卡血量稍縮
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH', 'DASH'],
      upgradesPerLevel: 1
    },
    autopilot: {
      avoidRadius: 4,                // 高密度怪，稍微放寬避怪
      replanInterval: 0.4,
      stuckSeconds: 0.8,
      noProgressSeconds: 0.4
    }
  },

  {
    id: 5,
    name: 'L5-終局迷宮',
    maze: {
      width: 35,
      height: 35,
      roomDensity: 3.5,
      extraConnectionChance: 0.15
    },
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
        RUSHER: 0.1
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'RUSHER', 'STALKER']
    },
    missions: {
      type: 'mixed',                 // 例如：先解謎開某區，再收集、再出門
      missionPointCount: 6,
      requiredToUnlockExit: 5,
      timeLimitSec: 480
    },
    player: {
      maxHealthMultiplier: 0.85,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH', 'DASH'],
      upgradesPerLevel: 1
    },
    autopilot: {
      avoidRadius: 4,
      replanInterval: 0.35,
      stuckSeconds: 0.7,
      noProgressSeconds: 0.35
    }
  }
];
```

**每關重點調的參數：**

* **地圖**

  * `maze.width / height`：從 21 → 35（空間變大）。
  * `maze.roomDensity`：房間越多、越開闊；餵給 `carveRoomsFromCorridors` 使用。
  * `extraConnectionChance`：用來控制 `addExtraConnections`，loop 越多越像迷宮。

* **怪物**

  * `monsters.count`：依關卡增加，替代原本單一 `CONFIG.MONSTER_COUNT`。
  * `typeWeights`：各類型比例（巡邏型 SENTINEL、遊走 WANDERER、守衛、潛行 STALKER、突進 RUSHER）。
  * `speedMultiplier / visionMultiplier / memoryMultiplier`：整體難度縮放（配合玩家成長）。

* **任務/限制**

  * `missions.type`：對應不同遊玩規則（收集、時間限制、護送、解謎）。
  * `missionPointCount`：讓 `WorldState` 生成對應數量的 `MissionPoint`。
  * `requiredToUnlockExit`、`timeLimitSec`：交給 `GameState` 判定勝敗。

* **玩家**

  * `maxHealthMultiplier`：對 `GameState.maxHealth` 做 per level 調整。
  * `upgradeChoices` / `upgradesPerLevel`：每關通關後可選的成長。

* **自動駕駛**

  * `autopilot.avoidRadius`：餵給 AutoPilot 的避怪半徑。
  * `replanInterval` / `stuckSeconds` / `noProgressSeconds`：路線重算、卡住判定門檻。

---

## 二、怪物機制調整

### 1. 速度：基準 = 玩家 * 0.8

**檔案：`src/core/config.js`** 

新增參數（保留舊 `MONSTER_SPEED` 作 fallback）：

```js
  PLAYER_SPEED: 4,

  MONSTER_BASE_SPEED_FACTOR: 0.8,       // 新：怪物基礎 = 玩家速度 * 0.8
  MONSTER_SPRINT_MULTIPLIER: 1.6,       // 怪物短衝刺倍率
  MONSTER_LEVEL_SPEED_MULT: 1.0,        // 由關卡表覆寫，用來稍微加快高關卡怪物
```

**檔案：`src/ai/monsterTypes.js`** – 統一用「速度係數」而不是絕對速度。

範例（只示意一個 type，其它類似改）：

```js
  HUNTER: {
    name: 'Hunter',
    aiType: 'roomHunter',
    // ...

    stats: {
      // speedFactor 是相對於「玩家基礎速度 * MONSTER_BASE_SPEED_FACTOR」
      speedFactor: 1.1,          // 比一般怪快一點
      visionRange: 18,
      visionFOV: Math.PI * 140 / 180,
      hearingRange: 12,
      scale: 1,
    },
    // ...
  },
```

WANDERER 可以用 0.8，SENTINEL 1.0，STALKER 1.1，RUSHER 1.0（但靠 brain 的 sprint/phase 突進）等等。

**檔案：`src/entities/monster.js`** – 真正算速度。

```js
  constructor(model, spawnGrid, worldState, typeConfig = {}, levelConfig = null) {
    // ...
    this.typeConfig = typeConfig || {};
    this.stats = this.typeConfig.stats || {};

    const speedFactor = this.stats.speedFactor ?? 1.0;
    const levelMult = levelConfig?.monsters?.speedMultiplier ?? CONFIG.MONSTER_LEVEL_SPEED_MULT ?? 1.0;

    // 基準 = 玩家速度 * 0.8 * typeFactor * levelMult
    this.baseSpeed =
      CONFIG.PLAYER_SPEED *
      (CONFIG.MONSTER_BASE_SPEED_FACTOR ?? 0.8) *
      speedFactor *
      levelMult;

    this.speed = this.baseSpeed;

    // 其他照舊
    this.visionRange =
      (this.stats.visionRange ?? CONFIG.MONSTER_VISION_RANGE) *
      (levelConfig?.monsters?.visionMultiplier ?? 1.0);

    // ...
  }

  getSpeed(isSprinting = false) {
    const sprintMult = isSprinting ? (CONFIG.MONSTER_SPRINT_MULTIPLIER || 1.6) : 1.0;
    return this.baseSpeed * sprintMult;
  }
```

這裡多加 `levelConfig` 參數，由 `MonsterManager` 生成怪物時帶入（下面會說）。

### 2. sprint 僅在特定型態/條件觸發

**檔案：`src/ai/monsterAI.js` – 各 brain 的 `computeSprint` 已存在** 

我們再加「只有在 `levelConfig.monsters.allowSprintTypes` 包含此 type 名稱時才允許衝刺」。

在 `BaseMonsterBrain` 增加建構子讀取：

```js
  constructor(worldState, pathfinder, monster, playerRef, config = {}) {
    // ...
    this.allowSprint = config.allowSprint ?? true;  // MonsterManager 依類型/關卡傳
  }

  computeSprint(distToTarget, distToPlayer) {
    if (!this.allowSprint) return false;
    void distToTarget;
    void distToPlayer;
    return false;
  }
```

在子類別比如 `RoomHunterBrain` 覆寫時：

```js
  computeSprint(distToTarget, distToPlayer) {
    if (!this.allowSprint) return false;
    if (this.targetType === 'chase') {
      // 玩家距離 3 格以上才啟動短衝刺
      return distToPlayer > 3;
    }
    return false;
  }
```

`SpeedJitterBrain` / `TeleportStalkerBrain` 同理，在衝刺 or sprintPhase 前先檢查 `this.allowSprint`。

**檔案：`src/entities/monsterManager.js` – 在 `buildBrainConfig` 加 allowSprint** 

MonsterManager 已經有 `buildBrainConfig(typeConfig)`，再塞一個 flag：

```js
  buildBrainConfig(typeConfig, levelConfig) {
    const stats = typeConfig?.stats || {};
    const behavior = typeConfig?.behavior || {};
    const allowSprintTypes = levelConfig?.monsters?.allowSprintTypes || [];

    return {
      visionRange: stats.visionRange,
      chaseTimeout: behavior.chaseMemory ? behavior.chaseMemory / 1000 : undefined,
      searchRadius: behavior.searchRadius,
      preferredMode: behavior.preferredMode,
      allowSprint: allowSprintTypes.includes(typeConfig?.name)
    };
  }
```

呼叫 `createMonsterBrain` 時把 `levelConfig` 傳進去。

### 3. hasLineOfSight：放在 WorldState 給 AI 使用

**檔案：`src/world/worldState.js`**

Monster brains（`RoomHunterBrain`, `ShyGreeterBrain`）會呼叫 `worldState.hasLineOfSight` 判斷能不能「看到」玩家。

可以直接移植 `Pathfinding.hasLineOfSight` 的做法到這裡：

```js
  /**
   * Grid-based line of sight check between two tiles.
   * @param {Object} a {x, y}
   * @param {Object} b {x, y}
   * @returns {boolean}
   */
  hasLineOfSight(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(distance);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(a.x + dx * t);
      const y = Math.round(a.y + dy * t);

      if (!this.isWalkable(x, y)) {
        return false;
      }
    }
    return true;
  }
```

這樣：

* 巡邏/問候型怪（ShyGreeter）會只有「看得到 & 在視野距離內」才進入 greet/flee 模式。
* RoomHunter 會在 home 區巡邏，有 LOS 才追擊，追丟一段時間後回家。

### 4. MonsterManager：依關卡套用怪物 mix + 難度倍率

**檔案：`src/ai/monsterTypes.js` – 新增帶權重的 mix 函式** 

```js
export function createMonsterMix(count, weights = null) {
  const types = { ...MonsterTypes };

  if (!weights) {
    // 舊版行為
    // ...
    return legacyMix;
  }

  // 將 weights 正規化
  const entries = Object.entries(weights);
  const sum = entries.reduce((acc, [, w]) => acc + w, 0) || 1;
  const normalized = entries.map(([name, w]) => [name, w / sum]);

  const mix = [];
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    let acc = 0;
    for (const [name, p] of normalized) {
      acc += p;
      if (r <= acc) {
        mix.push(types[name] || MonsterTypes.HUNTER);
        break;
      }
    }
  }
  return mix;
}
```

**檔案：`src/entities/monsterManager.js` – 初始化時帶關卡設定**

新增一個 API，例如：

```js
  async initializeForLevel(levelConfig) {
    const count = levelConfig?.monsters?.count ?? CONFIG.MONSTER_COUNT;
    const weights = levelConfig?.monsters?.typeWeights || null;

    const spawnPoints = this.worldState.getMonsterSpawns();
    const mix = createMonsterMix(count, weights);

    for (let i = 0; i < count; i++) {
      const typeConfig = mix[i];
      const spawn = spawnPoints[i];

      // 把 levelConfig 傳進 Monster/brain
      await this.spawnMonster(
        createSpriteBillboard(typeConfig.sprite || '/models/monster.png'),
        [],
        spawn,
        typeConfig,
        levelConfig
      );
    }
  }
```

`spawnMonster` signature 改成多一個 `levelConfig`：

```js
  async spawnMonster(model, animations, spawnPosition, typeConfig = null, levelConfig = null) {
    const monster = new Monster(model, spawnPosition, this.worldState, typeConfig, levelConfig);
    this.attachBrain(monster, typeConfig, levelConfig);
    // ...
  }

  attachBrain(monster, typeConfig, levelConfig) {
    const aiType = this.resolveAiType(typeConfig);
    const brainConfig = this.buildBrainConfig(typeConfig, levelConfig);
    const brain = createMonsterBrain({
      type: aiType,
      worldState: this.worldState,
      pathfinder: this.pathfinder,
      monster,
      playerRef: this.playerRef,
      config: brainConfig
    });
    this.brains.set(monster, brain);
  }
```

---

## 三、玩家成長 / 變化設計

### 1. 建議的 5 種跨關卡增益

**放在 `config.js` 或新檔 `playerUpgrades.js`**

```js
export const PLAYER_UPGRADES = {
  SPRINT_BOOST: {
    id: 'SPRINT_BOOST',
    name: '強化奔跑',
    desc: '永久提高玩家移動速度 +10%。',
    apply: (meta) => { meta.speedMultiplier *= 1.10; }
  },
  DASH: {
    id: 'DASH',
    name: '短衝刺',
    desc: '新增短衝刺技能（冷卻 5 秒）。',
    apply: (meta) => { meta.canDash = true; }
  },
  SHORT_STEALTH: {
    id: 'SHORT_STEALTH',
    name: '短暫隱匿',
    desc: '可啟動 3 秒隱匿，怪物視野與聽覺暫時大幅降低。',
    apply: (meta) => { meta.canStealth = true; }
  },
  EXTRA_HEART: {
    id: 'EXTRA_HEART',
    name: '額外血量',
    desc: '最大生命 +25。',
    apply: (meta) => { meta.maxHealthBonus += 25; }
  },
  MISSION_HINT: {
    id: 'MISSION_HINT',
    name: '任務提示',
    desc: 'Minimap 顯示任務/出口方向指示，AutoPilot 對任務點優先權提高。',
    apply: (meta) => { meta.hasMissionHint = true; }
  }
};
```

### 2. 放在哪裡儲存／套用

**跨關卡狀態建議：`GameState` 或 `GameMetaState`**

* 新增一個「長期」物件，例如：

```js
// 可能在 src/core/gameState.js 之類（未提供檔案）
class GameState {
  constructor() {
    this.meta = {
      levelIndex: 0,
      acquiredUpgrades: [],           // ['SPRINT_BOOST', ...]
      speedMultiplier: 1.0,
      maxHealthBonus: 0,
      canDash: false,
      canStealth: false,
      hasMissionHint: false
    };
    // ...
  }

  applyUpgrade(id) {
    if (this.meta.acquiredUpgrades.includes(id)) return;
    this.meta.acquiredUpgrades.push(id);
    PLAYER_UPGRADES[id].apply(this.meta);
  }
}
```

**與玩家移動/血量結合：**

* `PlayerController.calculateMovement()` 讀 `gameState.meta.speedMultiplier`：

```js
  calculateMovement(deltaTime) {
    const moveInput = this.input.getMovementInput();
    if (moveInput.x === 0 && moveInput.y === 0) return new THREE.Vector3(0, 0, 0);

    // ...
    let speed = CONFIG.PLAYER_SPEED;
    if (this.gameState?.meta?.speedMultiplier) {
      speed *= this.gameState.meta.speedMultiplier;
    }
    if (this.input.isSprinting()) {
      speed *= 1.5;
    }
    moveDirection.multiplyScalar(speed * deltaTime);
    return moveDirection;
  }
```

* 健康值：`GameState.maxHealth = baseHealth * levelConfig.player.maxHealthMultiplier + meta.maxHealthBonus`。

* **Dash / Stealth**：在 `InputHandler` + `PlayerController` 裡新增對應按鍵（例如空白鍵衝刺、E 鍵隱匿）：

  * Dash：短時間把 playerSpeed 再乘 2，並有 cooldown。
  * Stealth：啟動時在 `GameState` 設 `meta.stealthActiveUntil = now + 3s`，MonsterBrains 在 `canSeePlayer()` 時，如果 `gameState.meta.canStealth && stealthActive`，視野/聽力 range 縮到 30% 左右。

---

## 四、自動駕駛適配高難度關卡

你現在的 AutoPilot 已經有：避怪 avoidMask、探索記憶、stuck 檢測、path smoothing 等等。
下面是「跟關卡/難度對應」要加的部分。

### 1. AutoPilot 新增可調參數（讀 levelConfig）

**檔案：`src/ai/autoPilot.js`** 

建構子改成接受 `levelConfig`：

```js
  constructor(worldState, monsterManager, missionPointsRef, exitPointRef, playerController, levelConfig = null) {
    // ...
    const apCfg = levelConfig?.autopilot || {};

    this.planInterval = apCfg.replanInterval ?? CONFIG.AUTOPILOT_REPLAN_INTERVAL || 0.6;
    this.avoidDistance = apCfg.avoidRadius ?? CONFIG.AUTOPILOT_AVOID_RADIUS ?? 5;

    this.stuckThreshold = apCfg.stuckSeconds ?? 1.2;
    this.noProgressThreshold = apCfg.noProgressSeconds ?? 0.8;
  }
```

卡住判定的地方改用這些 threshold（你的程式裡已有 stuck/noProgress 機制，只要改成使用這些變數即可）。

### 2. Turn smoothing（避免相機在複雜轉角抖動）

在 AutoPilot 裡加一個小工具函式：

```js
  lerpAngle(current, target, maxStep) {
    let delta = target - current;
    delta = ((delta + Math.PI) % (2 * Math.PI)) - Math.PI;
    const step = Math.max(-maxStep, Math.min(maxStep, delta));
    return current + step;
  }
```

在 `tick(deltaTime)` 裡，算 yaw 時改成：

```js
    const rawYaw = Math.atan2(dx, dz);
    const currentYaw = this.playerController.camera.getYaw();
    const maxTurn = (CONFIG.AUTOPILOT_TURN_SPEED || 3.0) * deltaTime;
    const lookYaw = this.lerpAngle(currentYaw, rawYaw, maxTurn);
```

最後回傳：

```js
    return { moveWorld, lookYaw, sprint };
```

### 3. 高怪物密度 fallback

你已經有「先帶 avoidMask 算 path，若失敗再不避怪重算」。

為了高難度關卡再安全一些，可以再加一層「縮小避怪半徑」：

```js
    const avoidMask = this.buildAvoidanceMask();
    let path = this.pathfinder.findPath(playerGrid, target, true, avoidMask);

    if ((!path || path.length === 0) && this.avoidDistance > 1) {
      // 第一次退一步：縮小避怪距離
      const originalAvoid = this.avoidDistance;
      this.avoidDistance = Math.max(1, Math.floor(originalAvoid / 2));
      const smallerMask = this.buildAvoidanceMask();
      path = this.pathfinder.findPath(playerGrid, target, true, smallerMask);
      this.avoidDistance = originalAvoid;
    }

    if ((!path || path.length === 0) && avoidMask && avoidMask.size > 0) {
      // 最後退一步：完全不避怪
      path = this.pathfinder.findPath(playerGrid, target, true, null);
    }
```

---

## 五、程式調整指引（逐檔案）

### 1. `src/core/config.js` 

* 新增：

  * `MONSTER_BASE_SPEED_FACTOR`
  * `MONSTER_SPRINT_MULTIPLIER`
  * `MONSTER_LEVEL_SPEED_MULT`
* 新增 Autopilot 相關：

  * `AUTOPILOT_TURN_SPEED`
* 可保留舊 `MAZE_WIDTH / HEIGHT / ROOM_DENSITY / MONSTER_COUNT / MISSION_POINT_COUNT` 作預設。

### 2. `src/core/levelConfigs.js`（新檔）

* 定義 `LEVEL_CONFIGS`（前面 JSON 範例）。
* 由「啟動/重開遊戲」那層決定目前 level 用哪一個 config。

### 3. `src/world/mapGenerator.js` 

* `generateMazeDFS(width, height)` 改成接 options：

```js
export function generateMazeDFS(width, height, options = {}) {
  // ...
  const extraChance = options.extraConnectionChance ?? 0.08;
  carveDFS(grid);
  addExtraConnections(grid, extraChance);
  const rooms = carveRoomsFromCorridors(grid, options);
  return { grid, rooms };
}
```

* `carveRoomsFromCorridors(grid, options)`：

```js
function carveRoomsFromCorridors(grid, options = {}) {
  const density = options.roomDensity ?? CONFIG.ROOM_DENSITY || 1.0;
  // 原本使用 CONFIG.ROOM_DENSITY 的地方改成 density
}
```

### 4. `src/world/worldState.js` 

* `initialize(levelConfig)`：

```js
  initialize(levelConfig = null) {
    const mazeCfg = levelConfig?.maze || {};
    const width = mazeCfg.width ?? CONFIG.MAZE_WIDTH;
    const height = mazeCfg.height ?? CONFIG.MAZE_HEIGHT;

    const result = generateMazeDFS(width, height, {
      roomDensity: mazeCfg.roomDensity,
      extraConnectionChance: mazeCfg.extraConnectionChance
    });

    this.grid = result.grid;
    this.rooms = result.rooms;
    this.height = this.grid.length;
    this.width = this.grid[0].length;

    this.roomMap = createRoomMapFromRooms(this.grid, this.rooms);

    this.spawnPoint = this.findRandomWalkableTile();

    const monsterCount = levelConfig?.monsters?.count ?? CONFIG.MONSTER_COUNT;
    this.monsterSpawns = this.findMonsterSpawns(monsterCount);

    const missionCount = levelConfig?.missions?.missionPointCount ?? CONFIG.MISSION_POINT_COUNT;
    this.missionPoints = this.findMissionPoints(missionCount);
  }
```

* 加入 `hasLineOfSight`（前面段落已給）。

### 5. `src/entities/monster.js`、`src/ai/monsterTypes.js`、`src/ai/monsterAI.js`、`src/entities/monsterManager.js`

都已在上面分段說明：

* Monster：改 speed 公式、讀 levelConfig。
* MonsterTypes：改成 speedFactor、配合 createMonsterMix 權重。
* MonsterAI：`allowSprint`、`hasLineOfSight` 使用、不同 aiType 的模式切換已具有（patrol / chase / returning / wander / flee / greet / teleport 等）。
* MonsterManager：新增 `initializeForLevel(levelConfig)`，依 typeWeights 生怪； `buildBrainConfig` & `attachBrain` 帶入 levelConfig。

### 6. `src/ai/autoPilot.js` + `src/ai/pathfinding.js`

* AutoPilot：

  * 建構子增加 levelConfig。
  * 使用 levelConfig.autopilot 的 avoidRadius / replanInterval / stuckSeconds。
  * 加入 turn smoothing。
  * Fallback：縮小避怪 radius → 取消避怪。
* Pathfinding：目前已有 `smoothPath` & `hasLineOfSight`，可以保持不變，但已經在 AutoPilot/MonsterAI 中使用。

### 7. `src/player/playerController.js` 

* 在 `calculateMovement` 裡加入 `gameState.meta.speedMultiplier`。
* Dash / Stealth 若要實作，則：

  * 增加「衝刺冷卻」與「隱匿剩餘時間」欄位。
  * `update()` 裡讀 input 的特殊鍵，更新 `gameState.meta` 對應 flag，並對移動速度/怪物 AI 生效（透過 GameState 共享）。

### 8. `src/world/missionPoint.js` + GameState 的任務邏輯

* 保持 `MissionPoint` 本身不變；
* 在 GameState 裡依 `missions.type` 決定勝利條件：

  * `collectAndExit`：收集 >= requiredToUnlockExit + 碰到 ExitPoint。
  * `timeAttack`：計時器 <= timeLimitSec，否則 GameOver。
  * `escort`：需多一個 NPC 實體，成功跟到出口（可之後再實作）。

---

## 六、資料結構總結（關卡設定表）

已經在第一段給了完整 JSON/JS 範例，這裡整理欄位清單：

```ts
type LevelConfig = {
  id: number;
  name: string;
  maze: {
    width: number;
    height: number;
    roomDensity: number;         // 房間密度 → carveRoomsFromCorridors
    extraConnectionChance: number; // DFS 迷宮 loop 機率
  };
  monsters: {
    count: number;
    speedMultiplier: number;     // 乘在 (playerSpeed * 0.8) 之上
    visionMultiplier: number;    // 乘在 type.stats.visionRange 上
    memoryMultiplier: number;    // 乘在 behavior.chaseMemory 之類（秒數）
    typeWeights: {
      HUNTER?: number;
      WANDERER?: number;
      SENTINEL?: number;
      STALKER?: number;
      RUSHER?: number;
      // ...其他 type
    };
    allowSprintTypes: string[];  // 可以觸發短衝刺的怪物名稱
  };
  missions: {
    type: 'collectAndExit' | 'exitOnly' | 'timeAttack' | 'escort' | 'puzzle' | 'mixed';
    missionPointCount: number;
    requiredToUnlockExit: number;
    timeLimitSec: number;
  };
  player: {
    maxHealthMultiplier: number;
    upgradeChoices: string[];    // 對應 PLAYER_UPGRADES key
    upgradesPerLevel: number;
  };
  autopilot: {
    avoidRadius: number;
    replanInterval: number;
    stuckSeconds: number;
    noProgressSeconds: number;
  };
};
```

---

## 七、關卡切換測試檢查清單

當玩家通關一關（`gameState.win()` 被呼叫）時，你要做這些 reset：

1. **世界重建**

   * [ ] `GameState.meta.levelIndex++`。
   * [ ] 根據 `LEVEL_CONFIGS[levelIndex]` 取得 `levelConfig`。
   * [ ] `WorldState.initialize(levelConfig)` 重新生成地圖 & spawn / missionPoints。
   * [ ] 重新建立 ExitPoint（使用新的 `worldState.getExitPoint()`）。

2. **怪物重設**

   * [ ] `monsterManager.clear()` 把舊怪從場景移除。
   * [ ] `monsterManager.initializeForLevel(levelConfig)` 依 typeWeights / count 生成新怪。
   * [ ] 確認不同 aiType（巡邏、遊走、守衛、潛行、突進）都有出現。

3. **任務/目標重設**

   * [ ] 根據 `missions.missionPointCount` 建立新的 `MissionPoint` mesh 加到 scene。
   * [ ] GameState 的 `missionsTotal / missionsCollected` 重置。
   * [ ] `missions.type` 為 `timeAttack` 時，設定 `timeLimitSec` 與倒數邏輯。

4. **玩家位置/狀態**

   * [ ] `PlayerController` 重新 teleport 到 `worldState.getSpawnPoint()`。
   * [ ] `GameState.currentHealth` 設為 `baseHealth * levelConfig.player.maxHealthMultiplier + meta.maxHealthBonus`。
   * [ ] 保留 `meta`（升級與解鎖），例如 `speedMultiplier` 等。

5. **自動駕駛與路徑**

   * [ ] 用新 `levelConfig` 建立 AutoPilot 或更新：`autopilot = new AutoPilot(worldState, monsterManager, ..., levelConfig)`。
   * [ ] 呼叫 `autopilot.pathfinder.clearCache()`。
   * [ ] 清空 `autopilot.visitedTiles / currentPath / currentTarget`。

6. **UI 更新**

   * [ ] 顯示當前關卡名稱/等級（HUD 加一個 `#level-label`）。
   * [ ] 更新任務說明文字（收集幾個、是否限時）。
   * [ ] 若 `missions.timeLimitSec > 0`，在 `gameLoop.updateUI()` 顯示倒數。
   * [ ] 如果有 `MISSION_HINT` 升級，Minimap 顯示指引箭頭/高亮任務點。

7. **音效與難度指標**

   * [ ] 進新關播提示音 / BGM 切換。
   * [ ] UI 或文字提示怪物變強（例如「⚠ Hunter 的視野變得更敏銳」）。
   * [ ] Debug 模式下可印出：地圖尺寸、房間數、怪物分布、任務型態等，方便你驗證 levelConfig 是否正確套用。

---

如果你願意，下一步可以只先實作 **Level 1–3**（純 collect / collect+exit / timeAttack）與基礎升級（SPRINT_BOOST / EXTRA_HEART / MISSION_HINT），等這套流程穩定後再加 escort/puzzle 類型，整個「連續關卡＋自動駕駛＋怪物多型態」的架構就會很完整了。


我下面會直接給「可以貼進去的程式修改」，鎖定：

* Level 1–3：

  * Lv1：純收集（COLLECT_ONLY）
  * Lv2：收集 + 出口（COLLECT_AND_EXIT）
  * Lv3：限時收集（TIME_ATTACK）
* 升級：`SPRINT_BOOST`（跑比較快）、`EXTRA_HEART`（多血）、`MISSION_HINT`（任務方向提示）

---

## 1. 在 `config.js` 建立 Level 1–3 & 升級資料

**檔案：`src/core/config.js`** 

在 `CONFIG` 物件的最後一行 `AUTOPILOT_AVOID_RADIUS: 0,` 後面，加上以下欄位（在 `};` 之前）：

```js
  AUTOPILOT_REPLAN_INTERVAL: 0.5,
  AUTOPILOT_AVOID_RADIUS: 0,

  // -----------------------------
  // Level system & player upgrades
  // -----------------------------
  CURRENT_LEVEL_INDEX: 0, // 0=第一關, 1=第二關, 2=第三關

  // 只先做 Level 1–3
  LEVEL_CONFIGS: [
    {
      id: 1,
      name: 'Lv1 - Collect Only',
      maze: {
        width: 21,
        height: 21,
        roomDensity: 1.5,
      },
      monsters: {
        count: 4,
      },
      missions: {
        // 純收集：收集完全部任務點就通關，不用管出口
        mode: 'COLLECT_ONLY', // COLLECT_ONLY | COLLECT_AND_EXIT | TIME_ATTACK
        missionPointCount: 4,
        timeLimitSeconds: null,
      },
      player: {
        baseHealth: 100,
      },
    },
    {
      id: 2,
      name: 'Lv2 - Collect & Exit',
      maze: {
        width: 25,
        height: 25,
        roomDensity: 2.0,
      },
      monsters: {
        count: 6,
      },
      missions: {
        // 收集完 -> 必須走到出口
        mode: 'COLLECT_AND_EXIT',
        missionPointCount: 5,
        timeLimitSeconds: null,
      },
      player: {
        baseHealth: 100,
      },
    },
    {
      id: 3,
      name: 'Lv3 - Time Attack Collect',
      maze: {
        width: 29,
        height: 29,
        roomDensity: 2.5,
      },
      monsters: {
        count: 8,
      },
      missions: {
        // 有時間限制的收集，收集完即通關，不需要出口
        mode: 'TIME_ATTACK',
        missionPointCount: 6,
        timeLimitSeconds: 240, // 4 分鐘
      },
      player: {
        baseHealth: 100,
      },
    },
  ],

  // 基礎升級定義（數值你之後可以再調）
  UPGRADES: {
    SPRINT_BOOST: {
      id: 'SPRINT_BOOST',
      label: '衝刺加成',
      maxStacks: 3,
      baseSpeedBonusPerStack: 0.10,  // 每層 +10% 移動速度
      sprintBonusPerStack: 0.20,     // 每層 衝刺倍率 +0.2
    },
    EXTRA_HEART: {
      id: 'EXTRA_HEART',
      label: '額外血量',
      maxStacks: 3,
      healthBonusPerStack: 20,       // 每層 +20 HP
    },
    MISSION_HINT: {
      id: 'MISSION_HINT',
      label: '任務提示',
      maxStacks: 2,
    },
  },
};
```

> 之後要切換關卡，只要在載入新關前把 `CONFIG.CURRENT_LEVEL_INDEX` 設成 0 / 1 / 2 即可。

---

## 2. 讓 WorldState 依等級產生不同地圖與任務點

### 2-1. `WorldState.initialize()` 使用 LEVEL_CONFIG

**檔案：`src/world/worldState.js`** 

把 `initialize()` 改成下面這樣（保留原有 log）：

```js
  /**
   * Initialize world with procedurally generated maze
   * 使用當前 LEVEL_CONFIG 來決定大小 / 房間密度 / 怪物與任務數量
   */
  initialize() {
    // 讀取目前關卡設定
    const levels = CONFIG.LEVEL_CONFIGS || [];
    const levelIndex = CONFIG.CURRENT_LEVEL_INDEX ?? 0;
    const levelConfig = levels[levelIndex] || null;

    const mazeCfg = levelConfig?.maze || {};
    const width = mazeCfg.width ?? CONFIG.MAZE_WIDTH;
    const height = mazeCfg.height ?? CONFIG.MAZE_HEIGHT;

    console.log(`Generating maze: ${width}×${height}...`);
    const result = generateMazeDFS(width, height, {
      roomDensity: mazeCfg.roomDensity
    });
    this.grid = result.grid;
    this.rooms = result.rooms;

    this.height = this.grid.length;
    this.width = this.grid[0].length;

    // room map
    console.log('Generating room types...');
    this.roomMap = createRoomMapFromRooms(this.grid, this.rooms);

    console.log('✅ WorldState roomMap created:', this.roomMap ? 'YES' : 'NO');
    if (this.roomMap) {
      console.log('RoomMap dimensions:', this.roomMap.length, 'x', this.roomMap[0].length);
    }

    const stats = analyzeMaze(this.grid);
    console.log('Maze statistics:', stats);

    // Spawn / monsters / mission points 數量由 level 決定
    const monsterCount =
      levelConfig?.monsters?.count ?? CONFIG.MONSTER_COUNT;
    const missionCount =
      levelConfig?.missions?.missionPointCount ?? CONFIG.MISSION_POINT_COUNT;

    this.spawnPoint = this.findRandomWalkableTile();
    this.monsterSpawns = this.findMonsterSpawns(monsterCount);
    this.missionPoints = this.findMissionPoints(missionCount);
  }
```

### 2-2. `generateMazeDFS` 支援 roomDensity 覆寫

**檔案：`src/world/mapGenerator.js`** 

1. 修改 `generateMazeDFS` 函式簽名與呼叫 `carveRoomsFromCorridors`：

```js
export function generateMazeDFS(width, height, options = {}) {
  // 建議外面給奇數，這裡再保險修一次
  if (width % 2 === 0)  width  -= 1;
  if (height % 2 === 0) height -= 1;

  // 全部先當成牆
  const grid = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => TILE_TYPES.WALL)
  );

  // ==== 1) DFS carve base corridor maze ====
  carveDFS(grid);

  // 加一些額外通道減少死路
  addExtraConnections(grid, 0.08);

  // ==== 2) 從走廊長出房間 ====
  const rooms = carveRoomsFromCorridors(grid, options);

  return { grid, rooms };
}
```

2. 修改 `carveRoomsFromCorridors` 讀取 options：

```js
function carveRoomsFromCorridors(grid, options = {}) {
  const height = grid.length;
  const width = grid[0].length;

  const rooms = [];
  const baseRooms = Math.floor((width * height) / 250);

  // 若 options 有 roomDensity 則優先，其次用 CONFIG
  const density =
    (options.roomDensity ?? CONFIG.ROOM_DENSITY ?? 1.0);

  const maxRooms = Math.max(20, Math.floor(baseRooms * density));
  let attempts = 0;
  // ...
}
```

其他內容不用動。

---

## 3. GameLoop：實作 COLLECT / COLLECT+EXIT / TIME_ATTACK 流程 + 任務提示

**檔案：`src/core/gameLoop.js`** 

### 3-1. 建立 levelConfig 與每關時間

在 constructor 裡，autopilot 設定後面加上：

```js
    this.autopilot = autopilot;
    this.autopilotActive = CONFIG.AUTOPILOT_ENABLED;

    // Level 設定與本關計時
    const levels = CONFIG.LEVEL_CONFIGS || [];
    const levelIndex = CONFIG.CURRENT_LEVEL_INDEX ?? 0;
    this.levelConfig = levels[levelIndex] || null;
    this.levelElapsedTime = 0;

    // 讓 GameState 的任務總數跟實際 MissionPoints 對齊
    if (this.gameState) {
      this.gameState.missionsCollected = 0;
      this.gameState.missionsTotal = missionPoints ? missionPoints.length : 0;
    }
```

### 3-2. 在 `start()` 裡重置本關時間

```js
  start() {
    if (this.running) return;

    this.running = true;
    this.lastTime = performance.now();
    this.lastFpsUpdate = this.lastTime;

    // 重置本關時間
    this.levelElapsedTime = 0;

    // Start game timer
    if (this.gameState && !this.gameState.isRunning) {
      this.gameState.startTimer();
    }
    // ...
  }
```

### 3-3. `update()` 內累積 levelElapsedTime

在 `update(deltaTime)` 一開始 clamp 之後加一行：

```js
    const dt = Math.min(deltaTime, 0.1);

    // 本關累積時間（給 TIME_ATTACK 用）
    this.levelElapsedTime += dt;
```

### 3-4. 替換「任務 / 出口 / 時間限制」那一段

在 `update()` 裡，找到原本這段：

```js
    // Check exit point collision (win condition)
    if (this.exitPoint && this.gameState) {
      if (this.exitPoint.isPlayerNear(playerPos, 2)) {
        // Visual feedback for victory
        if (this.visualEffects) {
          this.visualEffects.victoryFlash();
        }

        this.gameState.win('你成功找到了出口！');
        this.showGameOver(true);
      }
    }

    // Check mission points
    if (this.gameState && this.missionPoints && this.missionPoints.length > 0) {
      this.missionPoints.forEach(mp => {
        if (!mp.collected && mp.isPlayerNear(playerPos, 2)) {
          mp.collect(this.sceneManager.getScene());
          this.gameState.collectMission();
        }
      });
    }

    // Update exit point animation
    if (this.exitPoint) {
      this.exitPoint.update(dt);
    }
```

**整段改成**：

```js
    // --- 任務點收集 ---
    if (this.gameState && this.missionPoints && this.missionPoints.length > 0) {
      this.missionPoints.forEach(mp => {
        if (!mp.collected && mp.isPlayerNear(playerPos, 2)) {
          mp.collect(this.sceneManager.getScene());
          if (typeof this.gameState.collectMission === 'function') {
            this.gameState.collectMission();
          } else if (typeof this.gameState.missionsCollected === 'number') {
            this.gameState.missionsCollected++;
          }
        }
      });
    }

    // --- 根據關卡 mission 設定處理勝負 ---
    const missionsCfg = this.levelConfig?.missions;
    if (this.gameState && missionsCfg && !this.gameState.gameOver) {
      const mode = missionsCfg.mode; // COLLECT_ONLY | COLLECT_AND_EXIT | TIME_ATTACK
      const collected = this.gameState.missionsCollected ?? 0;
      const total =
        (typeof this.gameState.missionsTotal === 'number'
          ? this.gameState.missionsTotal
          : (this.missionPoints ? this.missionPoints.length : 0));
      const allCollected = total > 0 && collected >= total;

      // 1) TIME_ATTACK：時間到 -> 失敗
      if (mode === 'TIME_ATTACK' &&
          missionsCfg.timeLimitSeconds &&
          this.levelElapsedTime >= missionsCfg.timeLimitSeconds) {

        if (this.visualEffects && this.visualEffects.deathEffect) {
          this.visualEffects.deathEffect();
        }
        this.gameState.gameOver = true;
        this.showGameOver(false);
        return;
      }

      // 2) COLLECT_ONLY / TIME_ATTACK：收集完就直接通關（不需要出口）
      if ((mode === 'COLLECT_ONLY' || mode === 'TIME_ATTACK') && allCollected) {
        if (this.visualEffects && this.visualEffects.victoryFlash) {
          this.visualEffects.victoryFlash();
        }
        if (typeof this.gameState.win === 'function') {
          const msg = (mode === 'TIME_ATTACK')
            ? '你在時間內收集了所有任務點！'
            : '你收集了所有任務點！';
          this.gameState.win(msg);
        }
        this.showGameOver(true);
        return;
      }
    }

    // --- 出口判定 ---
    if (this.exitPoint && this.gameState && !this.gameState.gameOver) {
      if (this.exitPoint.isPlayerNear(playerPos, 2)) {
        const missionsCfg = this.levelConfig?.missions;
        const mode = missionsCfg?.mode;
        let canExit = true;

        if (mode === 'COLLECT_AND_EXIT') {
          const collected = this.gameState.missionsCollected ?? 0;
          const total =
            (typeof this.gameState.missionsTotal === 'number'
              ? this.gameState.missionsTotal
              : (this.missionPoints ? this.missionPoints.length : 0));
          // 必須先收集完所有任務點才算通關
          canExit = total === 0 || collected >= total;
        } else if (mode === 'COLLECT_ONLY' || mode === 'TIME_ATTACK') {
          // 這兩種模式不使用出口作為通關條件
          canExit = false;
        }

        if (canExit) {
          if (this.visualEffects && this.visualEffects.victoryFlash) {
            this.visualEffects.victoryFlash();
          }
          if (typeof this.gameState.win === 'function') {
            this.gameState.win('你成功找到了出口！');
          }
          this.showGameOver(true);
          return;
        }
      }
    }

    // Update exit point animation
    if (this.exitPoint) {
      this.exitPoint.update(dt);
    }
```

> 這樣：
>
> * Level 1（COLLECT_ONLY）：收集完所有任務點就通關，出口沒用。
> * Level 2（COLLECT_AND_EXIT）：必須先收集完，再走到出口才通關。
> * Level 3（TIME_ATTACK）：在 timeLimitSeconds 內收集完就通關；時間到還沒收集完視為失敗。

### 3-5. 任務提示（MISSION_HINT）顯示「最近任務方向」

在 `updateUI()` 裡找這段：

```js
    // Update mission status
    const missionElement = document.getElementById('mission-status');
    if (missionElement && this.gameState) {
      missionElement.textContent = `${this.gameState.missionsCollected}/${this.gameState.missionsTotal}`;
    }
```

改成：

```js
    // Update mission status
    const missionElement = document.getElementById('mission-status');
    if (missionElement && this.gameState) {
      const collected = this.gameState.missionsCollected ?? 0;
      const total = this.gameState.missionsTotal ?? 0;
      let text = `${collected}/${total}`;

      // 如果玩家有 MISSION_HINT 升級，顯示最近任務大方向
      const hasHint = typeof this.gameState.hasUpgrade === 'function'
        ? this.gameState.hasUpgrade('MISSION_HINT')
        : false;

      if (hasHint && this.missionPoints && this.missionPoints.length > 0) {
        const remaining = this.missionPoints.filter(mp => !mp.collected);
        if (remaining.length > 0) {
          const playerGrid = this.player.getGridPosition();
          let best = null;
          let bestDist = Infinity;

          remaining.forEach(mp => {
            const gp = mp.getGridPosition ? mp.getGridPosition() : mp.gridPos;
            if (!gp) return;
            const dx = gp.x - playerGrid.x;
            const dy = gp.y - playerGrid.y;
            const d = Math.abs(dx) + Math.abs(dy);
            if (d < bestDist) {
              bestDist = d;
              best = { dx, dy };
            }
          });

          if (best) {
            const dirLabel = this.describeDirection(best.dx, best.dy);
            text += ` | 最近任務：${dirLabel}`;
          }
        }
      }

      missionElement.textContent = text;
    }
```

然後在 `GameLoop` class 裡新增一個小 helper（放在 `updateUI()` 後面即可）：

```js
  /**
   * 將 dx/dy 轉成粗略方向文字
   */
  describeDirection(dx, dy) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ax < 1 && ay < 1) return '就在附近';

    let horiz = '';
    let vert = '';

    if (dx > 0) horiz = '東';
    else if (dx < 0) horiz = '西';

    if (dy > 0) vert = '南';
    else if (dy < 0) vert = '北';

    if (ax > ay * 1.5) return horiz || vert;
    if (ay > ax * 1.5) return vert || horiz;
    return vert + horiz; // 例如 「西北」
  }
```

---

## 4. PlayerController：讓 SPRINT_BOOST 影響速度（玩家 & Autopilot）

**檔案：`src/player/playerController.js`** 

### 4-1. `calculateMovement()` 套用 GameState 的速度加成

找到：

```js
    // Apply speed (with optional sprint)
    let speed = CONFIG.PLAYER_SPEED;
    if (this.input.isSprinting()) {
      speed *= 1.5; // Sprint multiplier
    }
```

改成：

```js
    const wantsSprint = this.input.isSprinting();

    // 基礎速度（可被 SPRINT_BOOST 影響）
    let baseSpeed = CONFIG.PLAYER_SPEED;
    if (this.gameState && typeof this.gameState.getBaseSpeedMultiplier === 'function') {
      baseSpeed *= this.gameState.getBaseSpeedMultiplier();
    }

    let speed = baseSpeed;

    if (wantsSprint) {
      if (this.gameState && typeof this.gameState.getSprintMultiplier === 'function') {
        speed = baseSpeed * this.gameState.getSprintMultiplier();
      } else {
        // 預設行為：1.5 倍
        speed = baseSpeed * 1.5;
      }
    }
```

### 4-2. `applyExternalControl()` 也要吃同樣加成（Autopilot 走路也變快）

找到：

```js
  applyExternalControl(cmd, deltaTime = 1 / CONFIG.TARGET_FPS) {
    const baseSpeed = CONFIG.PLAYER_SPEED;
    const speed = cmd?.sprint ? baseSpeed * 1.2 : baseSpeed;
```

改成：

```js
  applyExternalControl(cmd, deltaTime = 1 / CONFIG.TARGET_FPS) {
    let baseSpeed = CONFIG.PLAYER_SPEED;
    if (this.gameState && typeof this.gameState.getBaseSpeedMultiplier === 'function') {
      baseSpeed *= this.gameState.getBaseSpeedMultiplier();
    }

    let speed = baseSpeed;
    if (cmd?.sprint) {
      if (this.gameState && typeof this.gameState.getSprintMultiplier === 'function') {
        speed = baseSpeed * this.gameState.getSprintMultiplier();
      } else {
        speed = baseSpeed * 1.2;
      }
    }
```

後面 `moveWorld` / `move` 的邏輯維持原樣即可。

---

## 5. GameState：實際持有升級狀態（SPRINT_BOOST / EXTRA_HEART / MISSION_HINT）

> 這部分因為你的 GameState 檔沒有附，我用「範例實作」方式描述，你可以貼到自己的 `GameState` 類別裡，路徑大概會是 `src/core/gameState.js` 或類似。

假設你的 GameState 是一個 class，補上：

```js
import { CONFIG } from '../core/config.js';

export class GameState {
  constructor() {
    // ...
    this.currentHealth = 100;
    this.maxHealth = 100;

    // 任務
    this.missionsCollected = 0;
    this.missionsTotal = 0;

    // 升級：以 id 當 key
    this.upgrades = {
      SPRINT_BOOST: 0,
      EXTRA_HEART: 0,
      MISSION_HINT: 0,
    };
  }

  // --- 升級相關 API ---

  getUpgradeLevel(id) {
    return this.upgrades[id] || 0;
  }

  hasUpgrade(id) {
    return this.getUpgradeLevel(id) > 0;
  }

  applyUpgrade(id) {
    const def = CONFIG.UPGRADES[id];
    if (!def) return;
    const current = this.getUpgradeLevel(id);
    const next = Math.min((def.maxStacks ?? 1), current + 1);
    this.upgrades[id] = next;

    // 有些升級要立即重算血量
    if (id === 'EXTRA_HEART') {
      this.recalculateMaxHealthForCurrentLevel();
    }
  }

  /**
   * 根據當前關卡設定 + EXTRA_HEART 升級重算 maxHealth
   */
  recalculateMaxHealthForCurrentLevel(levelConfig) {
    const baseHealth =
      levelConfig?.player?.baseHealth ?? 100;

    const extraLevel = this.getUpgradeLevel('EXTRA_HEART');
    const heartDef = CONFIG.UPGRADES.EXTRA_HEART;
    const bonusPerStack = heartDef?.healthBonusPerStack ?? 20;

    this.maxHealth = baseHealth + extraLevel * bonusPerStack;
    // 每關開局可選擇回滿或維持現有血量，看你設計
    this.currentHealth = this.maxHealth;
  }

  // 給 PlayerController 用：基礎速度倍率
  getBaseSpeedMultiplier() {
    const level = this.getUpgradeLevel('SPRINT_BOOST');
    const def = CONFIG.UPGRADES.SPRINT_BOOST;
    const per = def?.baseSpeedBonusPerStack ?? 0.1;
    return 1 + level * per;
  }

  // 給 PlayerController 用：衝刺倍率（在 baseSpeed 上再乘）
  getSprintMultiplier() {
    const level = this.getUpgradeLevel('SPRINT_BOOST');
    const def = CONFIG.UPGRADES.SPRINT_BOOST;
    const per = def?.sprintBonusPerStack ?? 0.2;
    return 1.5 + level * per;
  }

  // 其他既有的函式：startTimer / updateTimer / takeDamage / getHealthPercentage 等照舊
}
```

**在你每次開新關卡時：**

假設外面有一個 `loadLevel(levelIndex)`，裡面大概這樣：

```js
function loadLevel(levelIndex) {
  CONFIG.CURRENT_LEVEL_INDEX = levelIndex;
  const levelCfg = CONFIG.LEVEL_CONFIGS[levelIndex];

  // 重新建 worldState
  const worldState = new WorldState();
  worldState.initialize();

  // 告訴 gameState 這一關的 base HP
  gameState.recalculateMaxHealthForCurrentLevel(levelCfg);

  // missionsTotal 會在 GameLoop constructor 裡根據 missionPoints.length 填好
  // ...
}
```

> 之後你可以在「通關畫面」加一個簡單 UI：提供三個選項（SPRINT_BOOST / EXTRA_HEART / MISSION_HINT），玩家選一個 → 呼叫 `gameState.applyUpgrade(id)`，再 `loadLevel(nextIndex)`。

---

## 6. 總結：目前做到的效果

* **Level 1 – Collect Only**

  * 小圖（21×21）、怪物少（4 隻）、任務點 4 個。
  * 收集完所有任務點立刻通關，不需要走到出口。

* **Level 2 – Collect & Exit**

  * 中等圖（25×25）、怪物 6 隻、任務點 5 個。
  * 必須收集完全部任務點，且走到出口才算通關；沒收集完碰到出口沒效果。

* **Level 3 – Time Attack Collect**

  * 稍大圖（29×29）、怪物 8 隻、任務點 6 個。
  * 有 240 秒時間，時間到還沒收集完 → 判定失敗；時間內收集完即可通關（不需要出口）。

* **升級：**

  * `SPRINT_BOOST`：增加走路 & 衝刺速度，PlayerController 和 Autopilot 都吃到。
  * `EXTRA_HEART`：每層 +20 HP，進新關卡時由 GameState 重算 maxHealth / currentHealth。
  * `MISSION_HINT`：在 HUD `mission-status` 右邊顯示「最近任務：東 / 西北」這類方向提示。

你可以先按上面順序改 `config.js / worldState.js / mapGenerator.js / gameLoop.js / playerController.js`，然後在自己的 GameState 補上那幾個 API。
如果改完跑起來有任何地方報錯（例如你原本 GameState 結構不一樣），把那一段錯誤訊息和 GameState 檔貼出來，我可以再幫你把接口對齊。
