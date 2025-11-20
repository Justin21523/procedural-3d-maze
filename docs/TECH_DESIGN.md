# 技術設計文件（Technical Design Document）

**專案：** Procedural 3D Maze Prototype
**技術棧：** JavaScript (ES6+) + Three.js
**開發原則：** 極簡工具鏈、模組化架構、演算法可讀性優先

---

## 一、技術選型（Technology Stack）

### 1.1 核心技術

| 技術 | 版本 | 用途 | 選擇理由 |
|------|------|------|---------|
| **Three.js** | ^0.160.0 | 3D 渲染引擎 | 業界標準、文件完善、學習曲線平緩 |
| **JavaScript (ES6+)** | - | 程式語言 | 原生支援、無需編譯、適合原型開發 |
| **Vite** | ^5.0.0 | 開發伺服器與打包工具 | 極簡配置、快速熱更新、原生 ES Module 支援 |

### 1.2 不使用的技術（與理由）

| 技術類型 | 不使用 | 理由 |
|---------|--------|------|
| **前端框架** | React / Vue / Svelte | 本專案無複雜 UI 需求，原生 JS 更直接 |
| **遊戲引擎** | Unity / Godot | 學習目標是演算法實作，不是使用現成引擎 |
| **TypeScript** | - | 初期優先快速實作，後期可考慮遷移 |
| **複雜狀態管理** | Redux / Zustand | 遊戲邏輯簡單，不需要大型狀態管理方案 |

---

## 二、專案結構（Project Structure）

### 2.1 目錄架構

```
.
├── README.md                    # 專案整體說明
├── index.html                   # HTML 入口點
├── docs/                        # 所有文件（設計、技術、演算法）
│   ├── README.md               # 文件地圖
│   ├── GAME_DESIGN.md          # 遊戲設計
│   ├── TECH_DESIGN.md          # 本文件
│   ├── AI_ALGO_NOTES.md        # 演算法筆記
│   ├── GLOSSARY_中英術語.md     # 術語表
│   ├── CHANGELOG.md            # 重大變更記錄
│   └── TODO.md                 # 功能待辦
├── public/                      # 靜態資源（預留給未來的圖片、音效等）
├── src/                         # 程式碼主目錄
│   ├── core/                   # 核心系統
│   │   ├── config.js          # 全域配置
│   │   ├── gameLoop.js        # 主遊戲迴圈
│   │   └── eventBus.js        # 事件系統（選用）
│   ├── rendering/              # 渲染模組
│   │   ├── scene.js           # Three.js 場景管理
│   │   ├── camera.js          # 第一人稱相機
│   │   └── lighting.js        # 燈光設定
│   ├── world/                  # 世界與地圖
│   │   ├── mapGenerator.js    # 迷宮生成演算法
│   │   ├── tileTypes.js       # 格子類型定義
│   │   └── worldState.js      # 世界狀態管理
│   ├── player/                 # 玩家系統
│   │   ├── input.js           # 輸入處理
│   │   └── playerController.js # 玩家控制器
│   ├── ai/                     # AI 系統
│   │   ├── pathfinding.js     # A* 路徑搜尋
│   │   ├── fsm.js             # 有限狀態機
│   │   └── monsters.js        # 怪物實作
│   └── utils/                  # 工具函式
│       ├── math.js            # 數學工具
│       └── random.js          # 隨機數工具
├── assets/                      # 美術資源（後期）
│   ├── models/                # 3D 模型
│   ├── textures/              # 貼圖
│   └── sounds/                # 音效
├── scripts/                     # 開發腳本與說明
│   └── dev.md                 # 開發環境設定說明
├── package.json                # NPM 依賴與腳本
├── vite.config.js              # Vite 配置（極簡）
└── .gitignore                  # Git 忽略規則
```

### 2.2 模組職責劃分

| 模組 | 職責 | 對外接口（範例） |
|------|------|-----------------|
| **core** | 遊戲主迴圈、全域配置、事件調度 | `startGame()`, `getConfig()` |
| **rendering** | Three.js 場景、相機、燈光管理 | `initScene()`, `updateCamera(position)` |
| **world** | 地圖生成、世界狀態查詢 | `generateMaze(w, h)`, `isWalkable(x, y)` |
| **player** | 輸入處理、移動控制、碰撞檢測 | `getPlayerPosition()`, `movePlayer(direction)` |
| **ai** | 路徑搜尋、狀態機、怪物行為 | `findPath(start, goal)`, `updateMonster(dt)` |
| **utils** | 數學計算、隨機數、共用工具 | `distance(a, b)`, `randomInt(min, max)` |

---

## 三、核心架構設計（Core Architecture）

### 3.1 資料流（Data Flow）

```
[Config] ─────> [World State] ─────> [Scene]
                     ↓                  ↓
                  [Player]  <──────  [Camera]
                     ↓
                 [Monsters] ────> [Pathfinding]
                     ↓
                 [Game Loop] ──> Update All
```

**流程說明：**

1. **初始化階段**：
   - 讀取 `config.js` 配置
   - 使用 `mapGenerator` 生成 2D grid
   - `worldState` 儲存地圖資料與 spawn points
   - `scene.js` 根據 grid 建立 3D Mesh（牆與地板）

2. **遊戲循環**：
   - `gameLoop.js` 每幀呼叫 `update(deltaTime)`
   - `playerController` 處理移動、更新位置
   - `camera` 同步玩家位置與視角
   - 每隻 `Monster` 執行 FSM 更新：
     - 檢查視線 → 決定狀態切換
     - 若需要追擊 → 呼叫 `pathfinding.findPath()`
     - 沿路徑移動

3. **渲染階段**：
   - Three.js 自動處理（WebGLRenderer）

### 3.2 座標系統（Coordinate System）

**Grid 座標 vs 3D 世界座標**

- **Grid 座標**（邏輯層）：
  - 2D 整數陣列，例如 `grid[y][x]`
  - `0 = Wall`, `1 = Floor`
  - 用於迷宮生成、路徑搜尋、碰撞檢測

- **3D 世界座標**（渲染層）：
  - Three.js 使用右手座標系：`(x, y, z)`
  - 轉換規則：
    ```javascript
    worldX = gridX * TILE_SIZE
    worldZ = gridY * TILE_SIZE
    worldY = PLAYER_HEIGHT // 固定高度或地形高度
    ```

- **TILE_SIZE（格子尺寸）**：
  - 建議初始值：`2` 或 `3` (Three.js 單位)
  - 可在 `config.js` 調整

### 3.3 碰撞檢測（Collision Detection）

**簡化方案（Grid-based）**

```javascript
function canMoveTo(x, y) {
  const gridX = Math.floor(x / TILE_SIZE);
  const gridY = Math.floor(y / TILE_SIZE);
  return worldState.isWalkable(gridX, gridY);
}
```

**未來可擴充**：
- 使用 Three.js 的 `Raycaster` 做精確碰撞
- 加入碰撞邊界框（Bounding Box）

---

## 四、模組詳細設計（Module Details）

### 4.1 Core 模組

#### `core/config.js`

**用途**：集中管理所有可調整參數

```javascript
export const CONFIG = {
  // Maze settings
  MAZE_WIDTH: 31,
  MAZE_HEIGHT: 31,
  TILE_SIZE: 2,
  WALL_HEIGHT: 3,

  // Player settings
  PLAYER_SPEED: 5,
  PLAYER_HEIGHT: 1.6,
  MOUSE_SENSITIVITY: 0.002,

  // Monster settings
  MONSTER_COUNT: 1,
  MONSTER_SPEED: 4,
  MONSTER_VISION_RANGE: 10,
  MONSTER_FOV: Math.PI * 2 / 3, // 120 degrees

  // Rendering
  FOV: 75,
  NEAR_PLANE: 0.1,
  FAR_PLANE: 1000,
};
```

#### `core/gameLoop.js`

**用途**：主遊戲迴圈與更新協調

```javascript
export class GameLoop {
  constructor(scene, player, monsters) {
    this.scene = scene;
    this.player = player;
    this.monsters = monsters;
    this.lastTime = 0;
  }

  start() {
    this.lastTime = performance.now();
    this.loop();
  }

  loop() {
    const now = performance.now();
    const deltaTime = (now - this.lastTime) / 1000; // 轉成秒
    this.lastTime = now;

    this.update(deltaTime);
    this.render();

    requestAnimationFrame(() => this.loop());
  }

  update(dt) {
    this.player.update(dt);
    this.monsters.forEach(m => m.update(dt));
  }

  render() {
    this.scene.render();
  }
}
```

### 4.2 Rendering 模組

#### `rendering/scene.js`

**用途**：建立與管理 Three.js 場景

**核心功能**：
- 初始化 `WebGLRenderer`, `Scene`
- 根據 grid 生成牆與地板 Mesh
- 提供 `render()` 方法

**範例結構**：
```javascript
export class SceneManager {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer();
    this.scene = new THREE.Scene();
    // ...
  }

  buildWorldFromGrid(grid) {
    // 遍歷 grid，建立 Mesh
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x] === TILE_TYPES.WALL) {
          this.createWall(x, y);
        } else {
          this.createFloor(x, y);
        }
      }
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera.threeCamera);
  }
}
```

#### `rendering/camera.js`

**用途**：第一人稱相機控制

**功能**：
- 建立 `PerspectiveCamera`
- 處理滑鼠移動（Yaw / Pitch）
- 同步玩家位置

```javascript
export class FirstPersonCamera {
  constructor(fov, aspect, near, far) {
    this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.yaw = 0;
    this.pitch = 0;
  }

  updateRotation(deltaX, deltaY, sensitivity) {
    this.yaw -= deltaX * sensitivity;
    this.pitch -= deltaY * sensitivity;
    this.pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.pitch));

    // 更新 camera 旋轉
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  updatePosition(x, y, z) {
    this.camera.position.set(x, y, z);
  }
}
```

### 4.3 World 模組

#### `world/worldState.js`

**用途**：儲存並查詢世界狀態

```javascript
export class WorldState {
  constructor() {
    this.grid = null;
    this.spawnPoint = null;
    this.monsterSpawns = [];
  }

  initialize(grid) {
    this.grid = grid;
    this.spawnPoint = this.findRandomWalkableTile();
    this.monsterSpawns = this.findMonsterSpawns(CONFIG.MONSTER_COUNT);
  }

  isWalkable(x, y) {
    if (x < 0 || y < 0 || y >= this.grid.length || x >= this.grid[0].length) {
      return false;
    }
    return this.grid[y][x] !== TILE_TYPES.WALL;
  }

  getGrid() {
    return this.grid;
  }
}
```

#### `world/tileTypes.js`

**用途**：定義格子類型常數

```javascript
export const TILE_TYPES = {
  WALL: 0,
  FLOOR: 1,
  // 未來可擴充：
  // DOOR: 2,
  // SPECIAL: 3,
};
```

#### `world/mapGenerator.js`

**用途**：迷宮生成演算法（初期實作見 Phase 2）

```javascript
export function generateMaze(width, height, options = {}) {
  // DFS-based maze generation
  // 回傳 2D array
  // 詳見 AI_ALGO_NOTES.md
}
```

### 4.4 Player 模組

#### `player/input.js`

**用途**：統一處理鍵盤與滑鼠輸入

```javascript
export class InputHandler {
  constructor() {
    this.keys = {};
    this.mouseDelta = { x: 0, y: 0 };
    this.setupListeners();
  }

  setupListeners() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // Pointer lock for mouse
    document.addEventListener('click', () => {
      document.body.requestPointerLock();
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        this.mouseDelta.x = e.movementX;
        this.mouseDelta.y = e.movementY;
      }
    });
  }

  isKeyPressed(code) {
    return !!this.keys[code];
  }

  consumeMouseDelta() {
    const delta = { ...this.mouseDelta };
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    return delta;
  }
}
```

#### `player/playerController.js`

**用途**：玩家移動邏輯與碰撞檢測

```javascript
export class PlayerController {
  constructor(worldState, camera, input) {
    this.worldState = worldState;
    this.camera = camera;
    this.input = input;
    this.position = { x: 0, y: CONFIG.PLAYER_HEIGHT, z: 0 };
  }

  update(dt) {
    // 處理滑鼠視角
    const mouseDelta = this.input.consumeMouseDelta();
    this.camera.updateRotation(
      mouseDelta.x,
      mouseDelta.y,
      CONFIG.MOUSE_SENSITIVITY
    );

    // 處理 WASD 移動
    const moveVector = this.calculateMoveVector(dt);
    this.applyMovement(moveVector);

    // 同步相機
    this.camera.updatePosition(this.position.x, this.position.y, this.position.z);
  }

  calculateMoveVector(dt) {
    // 根據 camera.yaw 與 WASD 輸入計算移動向量
    // 詳見實作
  }

  applyMovement(vector) {
    // 碰撞檢測 + 移動
    const newX = this.position.x + vector.x;
    const newZ = this.position.z + vector.z;

    if (this.worldState.isWalkable(
      Math.floor(newX / CONFIG.TILE_SIZE),
      Math.floor(newZ / CONFIG.TILE_SIZE)
    )) {
      this.position.x = newX;
      this.position.z = newZ;
    }
  }
}
```

### 4.5 AI 模組

**（Phase 3-4 實作，詳細演算法見 `AI_ALGO_NOTES.md`）**

#### `ai/pathfinding.js`
- 實作 A* 演算法

#### `ai/fsm.js`
- 簡易 FSM 工具類別

#### `ai/monsters.js`
- Monster 類別：整合 FSM、視線判斷、路徑跟隨

---

## 五、開發工具鏈（Development Tooling）

### 5.1 使用 Vite 的理由

| 需求 | Vite 優勢 |
|------|---------|
| **快速啟動** | 使用原生 ES Module，無需 bundle |
| **熱更新** | 檔案修改後瞬間反映 |
| **極簡配置** | 幾乎零配置即可使用 |
| **打包支援** | 需要時可 `vite build` 產生生產版本 |

### 5.2 Vite 最小配置

**`vite.config.js`**

```javascript
import { defineConfig } from 'vite';

export default defineConfig({
  root: './public',
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
```

### 5.3 NPM Scripts

**`package.json`**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

---

## 六、效能考量（Performance Considerations）

### 6.1 初期不需優化的部分

- **多邊形數量**：初期使用方塊，多邊形極少，無瓶頸
- **陰影與光線追蹤**：不使用即時陰影
- **物理引擎**：無需引入 Cannon.js 等，簡單碰撞即可

### 6.2 需注意的潛在問題

| 問題 | 解決方案 |
|------|---------|
| **地圖過大導致 Mesh 數量爆炸** | 使用 InstancedMesh 或 Merged Geometry |
| **A* 每幀執行過於頻繁** | 限制更新頻率（例如每 0.5 秒）|
| **視線判斷 Raycasting 過多** | 僅在必要時檢查、加入冷卻時間 |

---

## 七、測試策略（Testing Strategy）

### 7.1 手動測試重點

- **迷宮生成**：檢查是否有孤島、死路過多
- **玩家移動**：確認不穿牆、視角流暢
- **怪物追擊**：路徑是否合理、狀態切換正確

### 7.2 未來自動化測試（選用）

- 使用 Vitest 進行演算法單元測試（A*、迷宮生成）
- 不針對 Three.js 渲染做測試

---

## 八、部署與分享（Deployment）

### 8.1 靜態部署

- 執行 `npm run build` 產生 `dist/` 資料夾
- 可部署至：
  - **GitHub Pages**
  - **Netlify**
  - **Vercel**

### 8.2 分享連結

完成後可直接分享網址，無需安裝任何軟體。

---

## 九、修訂記錄（Revision History）

| 日期 | 版本 | 修改內容 | 修改者 |
|------|------|---------|--------|
| 2025-11-20 | v0.1 | 初版：定義技術棧、模組架構、資料流 | Claude Code |

---

**注意：本文件應隨架構調整持續更新。所有技術決策與模組變更必須記錄於此。禁止建立任何技術設計副本文件。**
