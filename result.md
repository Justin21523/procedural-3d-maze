我先把你給的 8 個檔都掃過一輪了，下面直接按「檔案 / 修改點」來講，優先處理：

* AutoPilot 卡牆 / 抖動
* 玩家/自動駕駛的移動向量 & 碰撞
* 怪物 AI 都變成一種行為
* 怪物落地問題

---

## 1. `src/ai/autoPilot.js` – 防卡牆、穩定 waypoint、跟相機同步 yaw 

### (1) 用 path smoothing，減少鋸齒路線

你已經有 `Pathfinding.smoothPath()`，但 AutoPilot 的 `plan()` 裡沒用到。建議：

```js
  plan(playerGrid) {
    const now = performance.now() / 1000;

    // ...原本的 target / cooldown 判斷...

    const target = this.pickTarget(playerGrid);
    if (!target) return;

    this.currentTarget = target;

    const avoidMask = this.buildAvoidanceMask();
    let path = this.pathfinder.findPath(playerGrid, target, true, avoidMask);

    if ((!path || path.length === 0) && avoidMask && avoidMask.size > 0) {
      path = this.pathfinder.findPath(playerGrid, target, true, null);
    }

    // ✅ 這裡做平滑
    if (path && path.length > 0) {
      path = this.pathfinder.smoothPath(path);
    }

    this.currentPath = path || [];
  }
```

這會把「直走→右轉→直走→左轉」那種鋸齒路徑壓成比較順的折線，corner 貼牆問題會少很多。

---

### (2) AutoPilot 的 move 向量改成「世界座標版」，避免跟 `applyExternalControl` 誤差

現在 AutoPilot 回傳 `move: {x, y}`，但 `PlayerController.applyExternalControl()` 把它當「本地座標（相對 yaw 的前後/左右）」來算世界向量。AutoPilot 這邊是用世界座標算 dx/dz，兩邊 coordinate system 實際上對不上，很容易在牆邊抖。

做法：

* 新增一個 `moveWorld`，明確代表「世界 X/Z 方向」。
* PlayerController 若看到 `cmd.moveWorld` 就直接用世界座標，不再透過 yaw 投影。

修改 `tick()` 裡產生 command 的部分：

```js
    // 使用「玩家世界座標 -> 目標世界座標」向量
    const dx = targetWorldX - this.playerController.position.x;
    const dz = targetWorldZ - this.playerController.position.z;
    const len = Math.hypot(dx, dz) || 1;

    // 世界座標的移動向量（只表示方向）
    const moveWorld = { x: dx / len, z: dz / len };

    // yaw 仍然照原來方式算，給相機用
    const yaw = Math.atan2(dx, dz);
    const lookYaw = yaw;

    // ... sprint 相關計算與卡住偵測 ...

    return { moveWorld, lookYaw, sprint };
```

之後在 PlayerController 裡接這個（下段詳講）。

---

### (3) Waypoint 跳轉再 aggressive 一點

現在只在「同一格 or 距離中心 < 0.2 tile」才 shift 一個 waypoint。不少卡牆是因為人在 tile 邊緣一直被當成還沒到。建議改成 while 迴圈，把「已經很接近」的 waypoint 一次跳過 1～2 個：

```js
    // 在 currentPath 最前面連續跳過「太近」的 waypoint
    const tileSize = CONFIG.TILE_SIZE;
    while (this.currentPath.length > 1) {
      const wp = this.currentPath[0];
      const cx = wp.x * tileSize + tileSize / 2;
      const cz = wp.y * tileSize + tileSize / 2;
      const dist = Math.hypot(
        cx - this.playerController.position.x,
        cz - this.playerController.position.z
      );
      if (dist < tileSize * 0.35) {
        this.currentPath.shift();
      } else {
        break;
      }
    }
```

這會讓角色在轉角快到中心時，直接切到下一段路，不會在邊界一格格「磨」。

---

### (4) 卡住偵測再強一點：直接 drop 整條 path 重算

你現在的 `stuckTimer / noProgressTimer` 是「丟掉第一個 waypoint + 重新 plan」，但如果整條 path 就是貼著牆，丟一格也沒救。建議：

```js
    if (this.stuckTimer > 1.2 || this.noProgressTimer > 0.8) {
      // 清掉整條路徑與目標
      this.currentPath = [];
      this.currentTarget = null;
      this.stuckTimer = 0;
      this.noProgressTimer = 0;
      // 順便清掉 path cache 的影響（可選）
      this.pathfinder.clearCache?.();
      this.plan(playerPos);
    }
```

這樣如果在某個角被 A* 導到奇怪的「邊界 loop」，會整條重算，不會一直在那邊左顧右盼。

---

### (5) 可選：yaw 做平滑，減少抖頭

如果你覺得相機在窄走廊急轉太硬，可以在 AutoPilot 裡加一個小工具函式，把 yaw 漸進：

```js
  lerpAngle(current, target, maxStep) {
    let delta = target - current;
    // 把角度差 normalize 到 [-PI, PI]
    delta = ((delta + Math.PI) % (2 * Math.PI)) - Math.PI;
    const step = Math.max(-maxStep, Math.min(maxStep, delta));
    return current + step;
  }
```

然後在 `tick()` 裡：

```js
    const rawYaw = Math.atan2(dx, dz);
    const currentYaw = this.playerController.camera.getYaw();
    const maxTurn = (CONFIG.AUTOPILOT_TURN_SPEED || 3.0) * deltaTime;
    const lookYaw = this.lerpAngle(currentYaw, rawYaw, maxTurn);
```

---

## 2. `src/player/playerController.js` – 移動向量 & 碰撞調整 

### (1) 支援 `moveWorld`，讓 AutoPilot 不再被 yaw 影響

在 `applyExternalControl()` 裡修改：

```js
  applyExternalControl(cmd, deltaTime = 1 / CONFIG.TARGET_FPS) {
    const baseSpeed = CONFIG.PLAYER_SPEED;
    const speed = cmd?.sprint ? baseSpeed * 1.2 : baseSpeed;

    // ✅ 先看有沒有世界座標版
    if (cmd?.moveWorld) {
      const mv = new THREE.Vector3(cmd.moveWorld.x, 0, cmd.moveWorld.z);
      if (mv.lengthSq() > 0) {
        mv.normalize().multiplyScalar(speed * deltaTime);
        this.externalMove = mv;
      }
    } else if (cmd?.move) {
      // 原本的 local space 邏輯保留，給未來其他系統用
      const mv = new THREE.Vector3();
      const yaw = typeof cmd.lookYaw === 'number' ? cmd.lookYaw : this.camera.getYaw();
      const forward = new THREE.Vector3(0, 0, -1)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const right = new THREE.Vector3(1, 0, 0)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      mv.addScaledVector(forward, cmd.move.y);
      mv.addScaledVector(right, cmd.move.x);
      if (mv.lengthSq() > 0) {
        mv.normalize().multiplyScalar(speed * deltaTime);
        this.externalMove = mv;
      }
    }

    if (cmd?.lookYaw !== undefined && cmd.lookYaw !== null) {
      this.externalLookYaw = cmd.lookYaw;
    }
  }
```

這樣 AutoPilot 只要給 `moveWorld`，整體行走就完全按照 A* 路徑方向，不會因 yaw 投影產生奇怪的側滑／貼牆抖。

---

### (2) `applyMovement`：加一層「先試一次完整位移 → 再分軸」，滑牆會順一點

現在是直接分兩軸測試 X / Z，某些 corner 會出現「X 走得動、Z 不行 → 改變 path 又卡回來」的震動感。

改成：

```js
  applyMovement(moveVector) {
    if (moveVector.lengthSq() === 0) return;

    const targetX = this.position.x + moveVector.x;
    const targetZ = this.position.z + moveVector.z;

    // 1. 先試完整移動
    if (this.canMoveTo(targetX, targetZ)) {
      this.position.x = targetX;
      this.position.z = targetZ;
      return;
    }

    // 2. 再退而求其次：只移 X 或只移 Z（滑牆效果）
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

    if (!moved) {
      // 被真正卡死：讓 AutoPilot 的 noProgressTimer 去處理
    }
  }
```

這樣在斜角貼牆時，不會先被某一軸 block 然後朝奇怪方向滑，路徑會比較順。

---

### (3) `canMoveTo`：碰撞半徑略縮，減少貼牆時「一碰就停」

如果 `CONFIG.PLAYER_RADIUS` 設得接近半格，八點檢查在窄走廊會非常敏感。可以在這裡做個縮放：

```js
    const radius = CONFIG.PLAYER_RADIUS * 0.9; // 稍微縮一點 hitbox
```

如果你希望玩家碰撞比可視模型略小，這邊是最簡單的調整點。

---

## 3. `src/rendering/camera.js` – 相機與 AutoPilot yaw 同步 

你已經有 `setYaw(yaw)`，AutoPilot 透過 `PlayerController.applyExternalControl` 設定 `externalLookYaw` 來調用。

* 若想讓手動操作時不要被 AutoPilot 搶走視角，可以在 GameLoop 裡：當偵測到玩家有鼠鍵輸入時，立刻 `autopilot.setEnabled(false)` / `autopilotActive = false`（你已經在 idle 檢測那邊做了一版，這點基本 ok）。

---

## 4. `src/ai/pathfinding.js` – 提供平滑路徑給怪物 & AutoPilot 

你現在的 `smoothPath()` 是「有 LOS 就跨多格」，很適合拿來給怪物一起用。

### (1) 在 `BaseMonsterBrain.plan()` 裡也套用 `smoothPath`

```js
  plan(monsterGrid) {
    const now = this.now();
    // ...既有 target 判斷...

    let path = null;
    if (this.pathfinder && typeof this.pathfinder.findPath === 'function') {
      const avoidMask = this.buildAvoidanceMask();
      path = this.pathfinder.findPath(monsterGrid, this.currentTarget, true, avoidMask);
      if ((!path || path.length === 0) && avoidMask) {
        path = this.pathfinder.findPath(monsterGrid, this.currentTarget, true, null);
      }

      // ✅ 平滑
      if (path && path.length > 0 && typeof this.pathfinder.smoothPath === 'function') {
        path = this.pathfinder.smoothPath(path);
      }
    }

    this.currentPath = path && path.length > 0 ? path : [];
  }
```

怪物轉角也會比較圓，不會出現「整批怪在同一轉角剎車、一起卡」。

---

## 5. `src/ai/monsterTypes.js` – 確保真的產出混合類型 

`MonsterTypes` 本身沒問題，`createMonsterMix(count)` 也會保證至少 HUNTER / WANDERER / SENTINEL。關鍵是 **MonsterManager 生成時要用這個 mix**，而不是硬寫同一種。

建議 MonsterManager 在 spawn 怪物時類似這樣用（偽碼）：

```js
import { createMonsterMix } from '../ai/monsterTypes.js';
import { createMonsterBrain } from '../ai/monsterAI.js';

const typeConfigs = createMonsterMix(monsterCount);

typeConfigs.forEach((typeConfig, i) => {
  const monster = new Monster(model, spawnGrid[i], worldState, typeConfig);

  const brain = createMonsterBrain({
    type: typeConfig.aiType,    // 這個很關鍵
    worldState,
    pathfinder,
    monster,
    playerRef,
    config: {
      // 可以把 typeConfig.behavior / stats 映射進去
      visionRange: typeConfig.stats.visionRange,
      // 其他想客製的參數
    }
  });

  this.monsters.push({ monster, brain });
});
```

如果現在 MonsterManager 把 `type: 'hunter'` 寫死，或是根本沒用 `aiType`，那所有怪當然都會走同一套邏輯，看起來就是一群「追擊怪」。

---

## 6. `src/ai/monsterAI.js` – 恢復多樣行為 & 視野/回家/冷卻邏輯 

這檔其實已經把多種 AI brain 寫好了，問題多半是「MonsterManager 沒呼叫對」。這裡重點列一下，方便你對照 MonsterManager：

### (1) `RoomHunterBrain` – 巡邏 → 看到人追擊 → 追丟後回 home

* 入口參數會從 `monster.visionRange / homeCenter / homeRadius`、`config.*` 裡抓。確保你的 `Monster` 有從 typeConfig.stats 把 `visionRange` 帶進來（Monster 有做）。
* `canSeePlayer()` 中如果 `worldState.hasLineOfSight` 有實作，就會用 LOS；建議在 `WorldState` 裡實作一個簡單的 grid raycast，避免隔牆看到人，讓 patrol / chase 的差異明顯。

### (2) `WanderCritterBrain` – 避人遊走 / 被殺會 respawn

* `avoidPlayerDistance` 內會找 `fleeTarget`，否則走 `pickExplorationTarget()`。
* 如果你覺得「看起來也在追人」，代表：

  * 不是這個 brain，可能 MonsterManager 都創 `RoomHunterBrain`。
  * 或是 world 太小，避開玩家時路徑又繞回來，看起來像追人。

### (3) `TeleportStalkerBrain` / `SpeedJitterBrain` / `CorridorGuardianBrain` / `ShyGreeterBrain`

* 這幾個 brain 都有自帶 `mode` / `state`：`wander / chase / returning / greet / flee` 等。
* 要注意 MonsterManager 在套用 `lookYaw` 時不要當成「絕對 yaw」，因為這裡回的是 *delta yaw*：

  ```js
  const yawDelta = cmd.lookYaw;
  const turnRate = CONFIG.MONSTER_TURN_RATE || 4.0;
  monster.setYaw(monster.getYaw() + yawDelta * turnRate * dt);
  ```

  這樣 RoomHunter / ShyGreeter 在不同模式下的「面向玩家 vs 朝路徑方向走」才會表現得出來。

### (4) 讓 type-specific 行為真的生效

建議在 MonsterManager 更新每隻怪時：

```js
update(dt, playerPos) {
  for (const entry of this.monsters) {
    const { monster, brain } = entry;
    const cmd = brain.tick(dt);

    // 移動：把 cmd.move 視為「grid 上方向」，轉成世界向量
    const moveDir = new THREE.Vector3(cmd.move.x, 0, cmd.move.y);
    if (moveDir.lengthSq() > 0) {
      moveDir.normalize().multiplyScalar(monster.getSpeed(cmd.sprint) * dt);
      this.moveMonsterWithCollision(monster, moveDir);
    }

    // 旋轉
    if (cmd.lookYaw) {
      const turnRate = CONFIG.MONSTER_TURN_RATE || 4;
      monster.setYaw(monster.getYaw() + cmd.lookYaw * turnRate * dt);
    }

    // 特殊動作（例如 teleport）
    if (cmd.specialAction === 'teleport') {
      // 播放特效 / 音效之類
    }

    monster.updateAnimation(dt);
  }
}
```

重點是：**讓 brain 決定 target/mode**，MonsterManager 只負責移動 & 碰撞，不要再自己加一層「距離玩家 < X 就改成追擊」。

---

## 7. `src/entities/monster.js` – 用 bounding box 確保落地 

你其實已經有 `alignToGround()`，而且在：

* constructor → `applyScale()` → `syncWorldFromGrid()` → `alignToGround()`
* `setGridPosition()` → `syncWorldFromGrid()` → `alignToGround()`
* `setWorldPosition()` → `alignToGround()`
* `setModel()` → `alignToGround()`

都會被叫。

如果還是看到模型偶爾陷地，多半是：

1. GLTF 在載入後又被額外 `model.scale` 或改 position；
2. 或是 floor 不在 y=0（例如地板 mesh 抬高）。

建議加一個「強制對齊」的小方法，在載入模型當下再做一次，而且允許指定地板高度：

```js
  forceAlignToFloor(floorY = 0) {
    if (!this.model) return;
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const deltaY = floorY + 0.02 - box.min.y;
    this.model.position.y += deltaY;
  }
```

在載入 GLTF / 換皮膚時（通常在 `modelLoader` 或 `monsterManager` 裡），呼叫一次：

```js
monster.setModel(loadedModel);
monster.forceAlignToFloor(0); // 或你的實際地板高度
```

這樣不管動畫或 scale 怎麼搞，起點都會被硬壓回地板上。

---

## 8. `src/core/gameLoop.js` – Autopilot 開關跟命令注入檢查 

你現在的 AutoPilot orchestration 已經蠻合理：

* `AUTOPILOT_ENABLED` 為總開關；
* 玩家 idle 超過 `AUTOPILOT_DELAY` 秒才啟動；
* 有任何輸入就停。

這裡只補兩個細節：

1. **外部指令 null 時不要覆蓋 externalMove**
   你已經是「有 externalCommand 才呼叫 applyExternalControl」，沒問題。

2. **自動駕駛時允許無 pointer lock**
   `player.update(dt, this.autopilotActive);` 的第二個參數就是專門放這個，配合上面 `moveWorld` 的修正，AutoPilot 就可以在完全不鎖滑鼠的情況下順暢走路。

---

## 小結 – 要做的關鍵修改清單

1. **AutoPilot**：

   * `plan()` 呼叫 `smoothPath()`。
   * `tick()` 改成回傳 `moveWorld`，配合 stuck/waypoint 強化策略。

2. **PlayerController**：

   * `applyExternalControl()` 支援 `moveWorld`，不要再把 AutoPilot 的 world 向量當 local。
   * `applyMovement()` 先試整步再分軸，減少貼牆抖動。
   * 覺得 hitbox 太胖就略縮 `PLAYER_RADIUS`。

3. **怪物 AI**：

   * MonsterManager 生成怪時用 `createMonsterMix()` + `typeConfig.aiType` 丟進 `createMonsterBrain()`。
   * 更新時尊重各個 brain 的 `tick()` 結果，不要再硬加一層統一追人邏輯。
   * 在 `WorldState` 實作 `hasLineOfSight()`，讓 RoomHunter / ShyGreeter 的行為差異真的出來。

4. **怪物落地**：

   * GLTF 載入後呼叫 `monster.forceAlignToFloor()`（或至少 `alignToGround()`），確定 bounding box 貼地面。

照這幾步改完，大致可以期待：

* AutoPilot 在牆角不再瘋狂左右抖、會自己重算脫困；
* 玩家跟自動駕駛都不會無限貼牆磨；
* 地圖裡怪物會明顯分成巡邏 / 遊走 / 守衛 / 潛行 / 瞬移跟追擊幾種風格；
* 模型高度統一踩在地板上，而不是有的半身埋土。

如果你願意下一輪把 `MonsterManager` / `WorldState.hasLineOfSight` 也丟出來，我可以幫你把怪物 AI 那塊再精修成一套完整 state machine。
