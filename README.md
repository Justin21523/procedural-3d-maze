# Procedural 3D Maze

一個以 **JavaScript（ES Modules）+ Three.js** 製作的第一人稱（First-person）迷宮遊戲原型：每一關用程序生成（Procedural Generation）產生新的迷宮與房型，再依關卡配置生成任務（Missions）、怪物（Enemies）與掉落（Pickups）。玩家能用武器與道具（Tools）周旋，完成目標後解鎖出口進入下一關（支援無限生成/難度成長）。

本專案同時也包含 **AI 玩家（Autopilot）**：當你不操作時，角色會自動探索、解任務、戰鬥並策略性使用道具（用於 demo / 壓力測試 / 玩法驗證）。

---

## 目前重點特色（Features）

- **無限關卡（Endless Levels）**：`src/core/levelDirector.js` 支援 base levels + recipes + 動態生成（難度隨表現成長）
- **任務與互動（Missions & Interactables）**：關卡 JSON 定義任務清單；互動門檻/消耗物品走 `InteractableSystem`
- **道具玩法（Tools）**：誘餌/陷阱/干擾器/感測器/地雷 + 投擲（煙霧/閃光/誘餌）
- **AI 感知全套（Perception）**：視野（FOV/LOS）、聽覺（Noise）、嗅覺（Scent）、煙霧遮蔽視線、閃光致盲、干擾器削弱感知
- **怪物多型態（Monster Types）**：含特殊「木頭人（Weeping Angel）」等 brain；刷怪與關卡配置有多樣性保護
- **導航輔助**：迷你地圖（永遠顯示整張地圖縮圖）+ 3D 世界標示（M 開關）
- **效能保護**：遠距離 AI 節流、投射物/特效上限、像素比限制等

---

## 快速開始（Quick Start）

### 系統需求

- Node.js v18+
- 現代瀏覽器（WebGL）

### 安裝與啟動

```bash
npm install
npm run dev -- --host --port 3002
```

打開：`http://localhost:3002/`

---

## 操作方式（Controls）

### 移動/互動

| 按鍵 | 功能 |
|---|---|
| `WASD` | 移動 |
| `Mouse` | 轉視角 |
| `Shift` | 衝刺 |
| `E` | 互動 / 使用任務物件 |
| `ESC` | 暫停 / 釋放滑鼠（Pointer Lock） |
| `Tab` | 開啟/關閉設定面板 |
| `` ` `` | 顯示/隱藏 Debug 按鈕（再點擊按鈕開 debug panel） |

### 戰鬥

| 按鍵 | 功能 |
|---|---|
| `Left Click` | 開火 |
| `Right Click` 或 `F` | 格擋（Block/Guard） |
| `R` | 換彈 |
| `1/2/3` | 切換武器 |
| `B` | 切換武器模式（若武器支援） |
| `Q` | 技能：手榴彈 |
| `X` | 技能：EMP |

### 道具（Tools）

| 按鍵 | 道具 |
|---|---|
| `4` | Lure（誘餌裝置） |
| `5` | Trap（陷阱） |
| `6` | Jammer（干擾器） |
| `7` | Decoy（誘餌投擲） |
| `8` | Smoke（煙霧） |
| `9` | Flash（閃光） |
| `0` | Sensor（感測器） |
| `V` | Mine（地雷） |
| `M` | 3D 世界標示開關（World Markers） |
| `C` | 相機工具模式（某些任務會用到，例如拍照/掃描） |

---

## 手動驗證（Manual Validation）

建議固定埠（3002）跑 dev server 後，依序測：

1. AI 匯入 sanity：`http://localhost:3002/test-ai.html`
2. 主程式載入：`http://localhost:3002/diagnostic.html`
3. 主遊戲：`http://localhost:3002/`
4. Enemy Lab：`http://localhost:3002/enemy-lab.html`
5. Level Lab：`http://localhost:3002/level-lab.html`

更完整的測試說明請看：`TESTING.md`、`TESTING_GUIDE.md`

---

## 文件（Documentation）

- 文件治理規則：`docs/README.md`
- 給 LLM/專案助手接手的「全套」實作說明：`docs/assistant/README.md`
  - 架構/更新順序：`docs/assistant/ARCHITECTURE.md`
  - AI 全套：`docs/assistant/AI.md`
  - 關卡/任務/道具：`docs/assistant/CONTENT_SYSTEMS.md`
  - 迷你地圖/效能：`docs/assistant/RENDERING_PERFORMANCE.md`

---

## 專案結構（Project Structure）

```
src/
  ai/            # Autopilot + monster brains + pathfinding
  audio/         # AudioManager（含程序化音效）
  core/          # config, events, gameLoop, levelDirector, spawnDirector, toolSystem...
  entities/      # monsters, projectiles, pickups
  player/        # input, controller, gun, weapon view
  rendering/     # scene, camera, minimap, world markers
  ui/            # UIManager（HUD/提示/結算/輸入模式）
  world/         # maze grid, rooms, collision, exit, props
public/
  levels/        # 關卡 JSON 與 manifest
  level-recipes/ # 無限生成 recipes（可選）
  models/        # 模型與 meta
  textures/      # 貼圖
```


### 開發流程

1. **先更新文件**：
   - 遊戲規則變更 → 更新 `GAME_DESIGN.md`
   - 架構變更 → 更新 `TECH_DESIGN.md`
   - 演算法變更 → 更新 `AI_ALGO_NOTES.md`

2. **再修改程式碼**：
   - 遵循既有模組結構
   - 所有註解使用 English
   - 變數與函式命名要清楚

3. **提交變更**：
   ```bash
   git commit -m "feat: add A* pathfinding algorithm"
   ```

### Commit 訊息格式

```
<type>: <description>

[optional body]
```

**Type 類型：**
- `feat`: 新功能
- `fix`: Bug 修復
- `docs`: 文件更新
- `refactor`: 重構（不改變功能）
- `test`: 測試相關
- `chore`: 雜項（配置、依賴更新）

---

## Roadmap（開發路線圖）

- [x] **Phase 1** - MVP：基礎場景與第一人稱移動（2025-11-20 完成）
- [x] **Phase 2** - 隨機迷宮生成（DFS 演算法）（2025-11-20 完成）
- [x] **Phase 3** - 基礎怪物 AI（A* 路徑搜尋 + 行為樹）（2025-11-20 完成）
- [x] **Phase 4** - 完整 FSM 與視線系統（2025-11-20 完成）
- [ ] **Phase 5** - 體驗優化（音效、貼圖、UI 完善）

詳細待辦事項見 `docs/TODO.md`

---

## 螢幕截圖（Screenshots）

_（Phase 1 完成後補充截圖）_

---

## 授權（License）

MIT License - 自由使用與修改

---

## 致謝（Acknowledgements）

- **Three.js** - 強大的 3D 渲染引擎
- **Red Blob Games** - 優秀的演算法教學資源
- **Backrooms Wiki** - 靈感來源

---

## 聯絡（Contact）

如有問題或建議，請開 Issue 或 Pull Request。

---

**最後更新：2025-11-20**
**狀態：Phase 4 完成，具備完整 AI 系統與多種怪物類型**

---

## 快速連結（Quick Links）

- [開發環境設定](scripts/dev.md)
- [遊戲設計文件](docs/GAME_DESIGN.md)
- [技術設計文件](docs/TECH_DESIGN.md)
- [演算法筆記](docs/AI_ALGO_NOTES.md)
