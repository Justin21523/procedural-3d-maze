# LLM/Assistant 專區（LLM/Assistant Hub）

這個目錄是給 **ChatGPT/Claude/Codex 等「專案助手」**接手用的技術文件專區：用最少的猜測快速建立「遊戲現在到底怎麼運作」的心智模型，並且知道要改哪裡、怎麼擴充、怎麼驗證。

如果你是一般玩家或第一次看這個專案，建議先看根目錄 `README.md`。

---

## 0) 你先需要知道的 3 件事

1. **所有 runtime 程式碼都在 `src/`**，`public/` 只放靜態資源與關卡 JSON。
2. **系統是「多系統同一個遊戲迴圈」**：`src/core/gameLoop.js` 用 `SystemRegistry` 依序更新各系統（Autopilot、玩家、互動、武器、道具、怪物、UI…）。
3. **資料流大量用事件匯流排（EventBus）**：事件名稱在 `src/core/events.js`，用來串接 UI、道具噪音、拾取、任務狀態、戰鬥等。

---

## 1) 快速上手（Quick Start）

```bash
npm install
npm run dev -- --host --port 3002
```

常用手動測試頁：

- 主遊戲：`http://localhost:3002/`
- AI 匯入 sanity：`http://localhost:3002/test-ai.html`
- 主程式載入診斷：`http://localhost:3002/diagnostic.html`
- Enemy Lab（第一人稱敵人/戰鬥/存 meta）：`http://localhost:3002/enemy-lab.html`
- Level Lab（關卡/配方實驗）：`http://localhost:3002/level-lab.html`

---

## 2) 文件地圖（從哪裡開始讀）

- Runtime 架構與更新順序：`docs/assistant/ARCHITECTURE.md`
- AI 全套（Enemy AI + AI Player/Autopilot）：`docs/assistant/AI.md`
- 關卡/任務/互動/道具配置與擴充：`docs/assistant/CONTENT_SYSTEMS.md`
- 迷你地圖/世界標示/效能旋鈕：`docs/assistant/RENDERING_PERFORMANCE.md`

同時也要對照既有設計文件（但請以 assistant 專區為「實作現況」準）：

- 遊戲設計（玩家視角）：`docs/GAME_DESIGN.md`
- 技術設計（模組拆分）：`docs/TECH_DESIGN.md`
- 演算法筆記（路徑/視線/生成）：`docs/AI_ALGO_NOTES.md`
- 術語表：`docs/GLOSSARY_中英術語.md`

---

## 3) Key Files 速查表（最常被改的地方）

- 入口與 wiring：`src/main.js`
- 每幀更新順序：`src/core/gameLoop.js`, `src/core/systemRegistry.js`
- 事件名：`src/core/events.js`
- 關卡載入/無限關：`src/core/levelDirector.js`, `public/levels/*.json`, `public/levels/manifest.json`
- 任務系統：`src/core/missions/missionDirector.js`, `src/core/missions/missionObjects.js`
- 互動系統：`src/core/interactions/interactableSystem.js`
- 隱藏點（躲藏）：`src/core/interactions/hidingSpotSystem.js`
- 背包/物品：`src/core/inventorySystem.js`, `src/core/gameState.js`
- 掉落/刷怪/波次：`src/core/spawnDirector.js`, `src/entities/pickupManager.js`
- 道具系統（投擲/部署/裝置）：`src/core/toolSystem.js`
- AI 玩家（Autopilot）：`src/ai/autoPilot.js`, `src/core/playerToolAISystem.js`
- 怪物 AI（brains + perception）：`src/entities/monsterManager.js`, `src/entities/monsterManager/perception.js`, `src/ai/monsterAI.js`, `src/ai/brains/*`
- 迷你地圖：`src/rendering/minimap.js`
- 3D 世界標示：`src/rendering/worldMarkerSystem.js`
- 音效（程序化）：`src/audio/audioManager.js`

---

## 4) 專案助手的工作習慣（避免踩雷）

- **新增文件一定要先登記**：`docs/README.md` 的表格（SSOT 原則）。
- **避免把 gameplay AI 綁到 DOM**：AI 應該只看 `worldState/gameState/eventBus`，UI 由 `UIManager` 更新。
- **新增系統要進入 game loop**：請看 `src/core/gameLoop.js` 的 `registerSystems()`（順序很重要）。
- **關卡內容用 JSON 配置**：盡量把「數量/上限/權重」放在 `public/levels/*.json`（再由 `LevelDirector` 正規化）。

