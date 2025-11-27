先說這一版多了什麼，再給你可以直接貼的程式碼片段 👇

---

## 一、這一版新增 / 調整的重點

在你上一版（已經有：等級表 1~5、自動駕駛、怪物 speedFactor、avoidMask、避怪與卡住偵測等）**之上**，這版我多做了這幾件事：

1. **Autopilot × 手動操作 2.0**

   * **滑鼠視角不再關掉 Autopilot**：只有 WASD / Shift 才會視為「玩家接管」，滑鼠純轉頭仍然讓 autopilot 保持接管移動。
   * **有滑鼠輸入時只關閉 autopilot 的轉頭**：當你這一幀有移動滑鼠，autopilot 仍會幫你走路，但不會再強制扭你的視角。

2. **連續「推離牆面」防卡角**

   * 在 `GameLoop` 裡新增 `separatePlayerFromWalls`：

     * 以玩家為圓形 collider，周圍 3×3 的牆磚視為方形 collider。
     * 偵測重疊時計算最小推開向量，把玩家推離牆面。
     * 最後再確認推完仍在可走 tile 上，避免被推進牆裡。
   * 和既有的 `separatePlayerFromMonsters` 一樣，每幀持續微調，減少「卡牆角」感覺。

3. **擴充到 7 關，加入新怪物 GREETER**

   * 在 `LEVEL_CONFIGS` 末端加上 **L6 / L7**，難度再往上疊但怪物數量仍維持 ≤ 12：

     * L6：大型迷宮 + 高密度巡邏，加入少量友善型 GREETER 當作氣氛與誘導。
     * L7：時間壓力終局，怪物 AI 基本版型不變，但整體速度與記憶再上修。
   * 兩關都使用已經存在的任務欄位（`missions.type/missionPointCount/requiredToUnlockExit/timeLimitSec`）與 autopilot 欄位。

4. **新怪物類型 GREETER（友善問候型）**

   * 在 `monsterTypes.js` 新增 `GREETER`：

     * `aiType: 'shyGreeter'`，直接掛到你已經有的 `ShyGreeterBrain`。
     * 移動慢、視野廣、會在看到玩家時靠近打招呼，太近又會退開，不會 sprint、也不造成傷害。
   * 在新的 L2/L6/L7 的 `typeWeights` 中配置一些 `GREETER`，讓迷宮看起來比較「活」。

下面是對應程式碼修改。

---

## 二、程式碼修改

### 1. `src/core/gameLoop.js`

（Autopilot 與滑鼠操作共存 + 牆面推離）

#### 1-1. Autopilot 接管判定 & 指令合併

找到 `update(deltaTime)` 裡處理 autopilot 的那一段，原本大致長這樣（重點是 `hasPlayerMove/hasPlayerLook/autopilotIdleSeconds` 那段）：

```js
// AutoPilot takeover
let externalCommand = null;
const allowAutopilot =
  CONFIG.AUTOPILOT_ENABLED && this.autopilot && !this.gameState?.gameOver;

if (allowAutopilot && this.player && this.player.input) {
  const mouseDelta = this.player.input.peekMouseDelta
    ? this.player.input.peekMouseDelta()
    : { x: 0, y: 0 };

  const hasPlayerMove =
    this.player.input.isKeyPressed('KeyW') ||
    this.player.input.isKeyPressed('KeyA') ||
    this.player.input.isKeyPressed('KeyS') ||
    this.player.input.isKeyPressed('KeyD') ||
    this.player.input.isKeyPressed('ShiftLeft') ||
    this.player.input.isKeyPressed('ShiftRight');

  const hasPlayerLook = mouseDelta.x !== 0 || mouseDelta.y !== 0;

  if (hasPlayerMove || hasPlayerLook) {
    this.autopilotIdleSeconds = 0;
  } else {
    this.autopilotIdleSeconds += deltaTime;
  }
} else {
  this.autopilotIdleSeconds = 0;
}

const allowAutopilotNow =
  allowAutopilot &&
  this.autopilotIdleSeconds >= CONFIG.AUTOPILOT_DELAY;
const autopilotControlling = allowAutopilotNow;

if (this.autopilot) {
  this.autopilot.setEnabled(allowAutopilotNow);
  if (autopilotControlling) {
    const cmd = this.autopilot.tick(deltaTime);
    externalCommand = cmd;
  }
}

this.autopilotActive = autopilotControlling;
if (this.player) {
  this.player.update(deltaTime, this.autopilotActive, externalCommand);
}
```

改成 **下面這版**（完整替換這段）：

```js
    // --- Autopilot takeover (v2) ---
    let externalCommand = null;
    const allowAutopilot =
      CONFIG.AUTOPILOT_ENABLED &&
      this.autopilot &&
      !this.gameState?.gameOver;

    let hasPlayerMove = false;
    let hasPlayerLook = false;

    if (allowAutopilot && this.player && this.player.input) {
      const mouseDelta = this.player.input.peekMouseDelta
        ? this.player.input.peekMouseDelta()
        : { x: 0, y: 0 };

      hasPlayerMove =
        this.player.input.isKeyPressed('KeyW') ||
        this.player.input.isKeyPressed('KeyA') ||
        this.player.input.isKeyPressed('KeyS') ||
        this.player.input.isKeyPressed('KeyD') ||
        this.player.input.isKeyPressed('ShiftLeft') ||
        this.player.input.isKeyPressed('ShiftRight');

      hasPlayerLook = mouseDelta.x !== 0 || mouseDelta.y !== 0;

      // 「是否 idle」只看移動鍵，滑鼠純轉頭不會重置 idle
      if (hasPlayerMove) {
        this.autopilotIdleSeconds = 0;
      } else {
        this.autopilotIdleSeconds += deltaTime;
      }
    } else {
      this.autopilotIdleSeconds = 0;
    }

    const allowAutopilotNow =
      allowAutopilot &&
      this.autopilotIdleSeconds >= (CONFIG.AUTOPILOT_DELAY || 0);

    // 只有在「啟用 autopilot 且目前沒在按移動鍵」時才由 autopilot 接管移動
    const autopilotControlling = allowAutopilotNow && !hasPlayerMove;

    if (this.autopilot) {
      this.autopilot.setEnabled(allowAutopilotNow);

      if (autopilotControlling) {
        let cmd = this.autopilot.tick(deltaTime) || null;

        if (cmd) {
          // 這一幀玩家有用滑鼠轉頭 → 保留 autopilot 移動，但不要幫忙轉頭
          if (hasPlayerLook) {
            cmd = { ...cmd, lookYaw: 0 };
          }
          externalCommand = cmd;
        }
      }
    }

    this.autopilotActive = autopilotControlling;

    if (this.player) {
      this.player.update(deltaTime, this.autopilotActive, externalCommand);
    }
```

**效果：**

* 只要你按 WASD / Shift，autopilot 就立刻「放手」。
* 你只動滑鼠看周圍時，autopilot 還是會繼續幫你往目標走，只是不會硬轉你的視角。

---

#### 1-2. 新增牆面連續推離（circle vs AABB）

在 `GameLoop` 裡原本已經有 `separatePlayerFromMonsters(playerPos)`、`applyPlayerKnockback` 等函式。就在 `separatePlayerFromMonsters` 後面，新增 **這個方法**：

```js
  /**
   * Continuously push player away from walls / corners using a circle collider
   * to reduce sticking at tight corners.
   * @param {THREE.Vector3} playerPos
   */
  separatePlayerFromWalls(playerPos) {
    if (!this.worldState || !this.player || !this.worldState.isWalkable) return;

    const tileSize = CONFIG.TILE_SIZE || 1;
    const radius =
      (CONFIG.PLAYER_COLLISION_RADIUS || 0.35) * tileSize;

    let pos = playerPos.clone();

    const baseGX = Math.floor(pos.x / tileSize);
    const baseGY = Math.floor(pos.z / tileSize);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = baseGX + dx;
        const gy = baseGY + dy;

        if (this.worldState.isWalkable(gx, gy)) continue;

        const minX = gx * tileSize;
        const maxX = minX + tileSize;
        const minZ = gy * tileSize;
        const maxZ = minZ + tileSize;

        // 最近點（AABB 最近點）
        const closestX = Math.max(minX, Math.min(pos.x, maxX));
        const closestZ = Math.max(minZ, Math.min(pos.z, maxZ));

        const dxWorld = pos.x - closestX;
        const dzWorld = pos.z - closestZ;
        const distSq = dxWorld * dxWorld + dzWorld * dzWorld;

        if (distSq <= 0) continue;
        const r = radius;
        if (distSq >= r * r) continue;

        const dist = Math.sqrt(distSq);
        const overlap = r - dist + 0.001;
        const nx = dxWorld / dist;
        const nz = dzWorld / dist;

        pos.x += nx * overlap;
        pos.z += nz * overlap;
      }
    }

    // 最後再確認推完的位置仍然在可走 tile 上，避免被推進牆裡
    const finalGX = Math.floor(pos.x / tileSize);
    const finalGY = Math.floor(pos.z / tileSize);
    if (this.worldState.isWalkable(finalGX, finalGY)) {
      this.player.setPosition(pos.x, pos.y, pos.z);
    }
  }
```

接著在 `update(deltaTime)` 裡你呼叫 `separatePlayerFromMonsters` 的地方，加上一行呼叫牆面分離。大致上會像：

```js
    // 在 player.update(...) 之後，如果有需要就做分離
    if (this.player) {
      const playerPos = this.player.getPosition();

      // 先處理「卡怪」分離
      this.separatePlayerFromMonsters(playerPos);

      // 再處理「卡牆 / 卡角」分離
      const newPos = this.player.getPosition();
      this.separatePlayerFromWalls(newPos);
    }
```

（依照你實際檔案中 `update` 的結構，把這兩行插進去即可。）

---

### 2. `src/core/config.js`

（新增玩家碰撞半徑設定）

在 `CONFIG` 物件末尾 Autopilot 設定之後、多加一個欄位（保持兩格縮排、記得加逗號）：

```js
  AUTOPILOT_TURN_SPEED: 3.0, // 每秒最大轉向（rad），避免抖頭

  // Player collision radius (in tiles)
  PLAYER_COLLISION_RADIUS: 0.35,
};
```

之後如果你想微調「貼牆距離」，只要改這個值即可。

---

### 3. `src/ai/monsterTypes.js`

（新增 GREETER 類型）

在 `MonsterTypes` 物件裡，其他類型（`WANDERER/HUNTER/SENTINEL/STALKER/RUSHER`）下面，新增一個 `GREETER`；結構沿用你原本的 `stats/behavior` 風格：

```js
export const MonsterTypes = {
  // ... 既有類型 WANDERER / HUNTER / SENTINEL / STALKER / RUSHER ...

  GREETER: {
    name: 'GREETER',
    aiType: 'shyGreeter',        // 對應 monsterAI 裡的 ShyGreeterBrain
    sprite: '/models/greeter.png', // 沒有就留著預設 sprite
    color: 0x33ccff,
    stats: {
      // 略慢、主要是氣氛用
      speedFactor: 0.6,
      visionRange: 12,
      visionFOV: Math.PI * 160 / 180,
      hearingRange: 6,
      scale: 0.9,
    },
    behavior: {
      // ShyGreeterBrain 會讀這些設定
      greetDistance: 4,          // 看見玩家且距離 < 4 格就靠近招呼
      avoidPlayerDistance: 2,    // 再靠近就會退開
      memoryDuration: 4000,
    },
  },
};
```

> MonsterManager 已經會依 `typeConfig.aiType` 去選對應 brain（`createMonsterBrain` 內部），因此只要填 `aiType: 'shyGreeter'` 就能讓它走 ShyGreeterBrain 的路線。

---

### 4. `src/core/levelConfigs.js`

（擴充到 7 關，並把 GREETER 帶入）

以下是 **整個 `LEVEL_CONFIGS`** 的新版，可以直接覆蓋原檔內容（維持你目前的設定 1~5，再加上 6、7）：

```js
// src/core/levelConfigs.js
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
    missions: { type: 'collectAndExit', missionPointCount: 3, requiredToUnlockExit: 3, timeLimitSec: 0 },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART'],
      upgradesPerLevel: 1,
    },
    autopilot: { avoidRadius: 4, replanInterval: 0.6, stuckSeconds: 1.2, noProgressSeconds: 0.8 },
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
      // 加入一點 GREETER 當作「安全路標」
      typeWeights: { WANDERER: 0.45, HUNTER: 0.25, SENTINEL: 0.2, GREETER: 0.1 },
      allowSprintTypes: ['HUNTER', 'SENTINEL'],
    },
    missions: { type: 'collectAndExit', missionPointCount: 4, requiredToUnlockExit: 3, timeLimitSec: 0 },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT'],
      upgradesPerLevel: 1,
    },
    autopilot: { avoidRadius: 5, replanInterval: 0.5, stuckSeconds: 1.0, noProgressSeconds: 0.6 },
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
    missions: { type: 'timeAttack', missionPointCount: 5, requiredToUnlockExit: 4, timeLimitSec: 300 },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
      upgradesPerLevel: 1,
    },
    autopilot: { avoidRadius: 5, replanInterval: 0.45, stuckSeconds: 0.9, noProgressSeconds: 0.5 },
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
      typeWeights: { WANDERER: 0.2, HUNTER: 0.3, SENTINEL: 0.3, STALKER: 0.1, RUSHER: 0.1 },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'RUSHER'],
    },
    missions: { type: 'escort', missionPointCount: 0, requiredToUnlockExit: 0, timeLimitSec: 420 },
    player: {
      maxHealthMultiplier: 0.9,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH', 'DASH'],
      upgradesPerLevel: 1,
    },
    autopilot: { avoidRadius: 4, replanInterval: 0.4, stuckSeconds: 0.8, noProgressSeconds: 0.4 },
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
    missions: { type: 'mixed', missionPointCount: 6, requiredToUnlockExit: 5, timeLimitSec: 480 },
    player: {
      maxHealthMultiplier: 0.85,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH', 'DASH'],
      upgradesPerLevel: 1,
    },
    autopilot: { avoidRadius: 4, replanInterval: 0.35, stuckSeconds: 0.7, noProgressSeconds: 0.35 },
  },
  // -----------------
  // 新增的高階關卡
  // -----------------
  {
    id: 6,
    name: 'L6-幻影交錯',
    maze: { width: 35, height: 35, roomDensity: 3.2, extraConnectionChance: 0.18 },
    monsters: {
      count: 11, // 仍然維持 <=12
      speedMultiplier: 1.18,
      visionMultiplier: 1.35,
      memoryMultiplier: 1.6,
      typeWeights: {
        WANDERER: 0.15,
        GREETER: 0.15,   // 友善路標
        HUNTER: 0.3,
        SENTINEL: 0.2,
        STALKER: 0.1,
        RUSHER: 0.1,
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'STALKER', 'RUSHER'],
    },
    missions: { type: 'mixed', missionPointCount: 7, requiredToUnlockExit: 5, timeLimitSec: 540 },
    player: {
      maxHealthMultiplier: 0.85,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH', 'DASH'],
      upgradesPerLevel: 1,
    },
    autopilot: { avoidRadius: 4, replanInterval: 0.33, stuckSeconds: 0.7, noProgressSeconds: 0.35 },
  },
  {
    id: 7,
    name: 'L7-極限試煉',
    maze: { width: 35, height: 35, roomDensity: 3.5, extraConnectionChance: 0.2 },
    monsters: {
      count: 12,
      speedMultiplier: 1.22,
      visionMultiplier: 1.4,
      memoryMultiplier: 1.7,
      typeWeights: {
        WANDERER: 0.05,
        GREETER: 0.1,
        HUNTER: 0.35,
        SENTINEL: 0.2,
        STALKER: 0.2,
        RUSHER: 0.1,
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'STALKER', 'RUSHER'],
    },
    // 終局採用有時間壓力的收集+出口
    missions: { type: 'timeAttack', missionPointCount: 7, requiredToUnlockExit: 6, timeLimitSec: 420 },
    player: {
      maxHealthMultiplier: 0.8,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH', 'DASH'],
      upgradesPerLevel: 1,
    },
    autopilot: { avoidRadius: 3.5, replanInterval: 0.3, stuckSeconds: 0.6, noProgressSeconds: 0.3 },
  },
];
```

**設計意圖簡述：**

* **L6**：地圖已接近最大、loop 多，視野與記憶再拉高；加入 GREETER 引導玩家往主幹路線跑。
* **L7**：怪物數量上限、速度/視野/記憶全部向上偏移，採限時收集 + 出口模式，autopilot 的 replan 頻率變快、noProgress 門檻更嚴格，讓自動駕駛在高壓下仍能調整路線。

---

## 三、簡單測試流程建議

1. **Autopilot × 手動操作**

   * 進入任一關（建議 L2/L3）：

     1. 放開 WASD/Shift，不動滑鼠 → 確認 autopilot 會自動開始移動。
     2. autopilot 正在走路時，只用滑鼠慢慢轉頭 →

        * 玩家仍在向前前進。
        * 視角照你手動的方向轉，不會被 autopilot 拉回去。
     3. 隨便按一下 W 或 S → autopilot 應立即停下，由你接管。

2. **卡牆 / 卡角**

   * 找迷宮中狹窄轉角，貼著牆沿著邊緣繞圈：

     * 觀察是否會「卡在角落動不了」，如果有，現在應該會微微被推離牆面、還是能滑過去。
   * 故意用 autopilot 讓玩家貼著牆走，確認不會被推進牆裡（`isWalkable` 最終檢查會阻止）。

3. **GREETER & 新關卡**

   * 切到 L2 / L6 / L7：

     * 確認會看到移動較慢、顏色不同（或 sprite 不同）的 GREETER，在看到你時會靠近、太近又退開。
     * 殺掉 GREETER（如果你目前有攻擊系統）不應有特別的 sprint 行為，也不會主動追擊。

如果你之後想再疊更多系統（像是 L6/L7 的任務型態真的做出不同玩法、或 GREETER 提示出口方向），我們可以在這一版穩定後再往上疊 👍

如果你希望，我也可以幫你把「任務類型（collectAndExit / timeAttack / mixed）」對應的勝敗判定，在 `GameState` / `GameLoop` 裡補到完全可玩版本。
