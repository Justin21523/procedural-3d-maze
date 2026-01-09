# 文件地圖（Documentation Map）

本目錄包含專案所有設計、技術與治理文件。**嚴格執行「單一真相檔」原則**：同一主題只允許更新原檔，禁止建立任何 `*_v2.md`、`*_final.md` 或臨時檔。

---

## 文件清單與職責

| 文件名稱 | 用途 | 更新時機 |
|---------|------|---------|
| `README.md` | 文件地圖與治理規則摘要 | 新增文件前必須先在此登記 |
| `GAME_DESIGN.md` | 遊戲設計文件（玩法、關卡、怪物、氛圍） | 遊戲規則或體驗設計變更時 |
| `TECH_DESIGN.md` | 技術設計文件（架構、模組拆分、資料流） | 架構調整或模組變更時 |
| `AI_SYSTEM.md` | AI 系統概覽（Autopilot + Enemy AI + 感知/模組） | AI 架構或感知規則變更時 |
| `AI_ALGO_NOTES.md` | 演算法筆記（迷宮生成、A*、FSM、視線判斷等） | 實作或調整演算法時 |
| `GLOSSARY_中英術語.md` | 名詞中英對照表 | 出現新術語或需要統一翻譯時 |
| `CHANGELOG.md` | 結構與系統重大變更記錄 | 重大架構改動或 breaking changes |
| `TODO.md` | 高層級功能待辦清單（Feature-level） | 規劃或完成功能時 |
| `enemy-meta.md` | Enemy 模型 meta（貼地/比例/材質）與調整流程 | 新增/調整模型與 meta 管線時 |
| `monster-movement-plan.md` | 怪物移動/脫困策略的規劃筆記 | 調整怪物移動策略或卡死修復時 |
| `assistant/README.md` | LLM/assistant 文件專區入口（系統地圖、擴充指南、除錯習慣） | 需要讓其他模型/助手接手或快速上手時 |
| `assistant/ARCHITECTURE.md` | Runtime 架構、資料流、SystemRegistry 更新順序 | 新增/調整系統、事件流或更新順序時 |
| `assistant/AI.md` | 怪物 AI（Enemy AI）與 AI 玩家（Autopilot）原理、感知與策略 | 新增怪物腦（brain）、感知規則或自動化策略時 |
| `assistant/CONTENT_SYSTEMS.md` | 關卡（Level）/任務（Mission）/互動（Interactable）/道具（Tools）配置與擴充 | 新增關卡 JSON、任務模板、道具類型或掉落規則時 |
| `assistant/RENDERING_PERFORMANCE.md` | 迷你地圖（Minimap）/世界標示（World Markers）/效能旋鈕與上限 | FPS/渲染問題排查、效能調參或新增標示時 |

---

## 文件治理規則

### 1. 單一真相檔（Single Source of Truth, SSOT）

- **同一主題只允許更新原檔**，禁止產生任何版本副本（`*_v2.md`、`*_final.md`、`*_backup.md`）。
- 需要大幅修改時，在原檔內加入「修訂記錄」小節即可。

### 2. 新增文件前必須登記

- **在建立任何新文件前**，必須先在本檔案（`docs/README.md`）的文件清單中新增一行，說明：
  - 檔名
  - 用途
  - 更新時機
- 只有在既有文件**完全沒有對應角色**時才能新增。

### 3. 禁止臨時檔案

- 不得建立 `tmp/`、`scratch/`、`notes/`、`misc/` 等臨時目錄。
- 不得建立 `test.md`、`draft.md`、`analysis.md` 等泛用名稱文件。
- 所有筆記與分析都必須歸屬到上述固定文件之一。

### 4. 語言規範

- **Markdown 文件**：繁體中文為主，關鍵術語首次出現時附英文（例如：迷宮生成 Maze Generation）。
- **程式碼、註解、檔名、變數名稱**：English only。
- **提交訊息、Issue / PR**：English only，使用 Conventional Commits。

### 5. 更新流程

每次進行開發工作時，請依序：

1. **先確認／更新對應文件**
   - 遊戲規則變更 → `GAME_DESIGN.md`
   - 架構或模組變更 → `TECH_DESIGN.md`
   - 演算法實作或調整 → `AI_ALGO_NOTES.md`

2. **再調整程式碼**
   - 依照 `src/` 既有結構擴充，不亂開新層級
   - 所有函式與類別需有 English 註解

3. **最後更新 CHANGELOG / TODO（視情況）**
   - 重大改動 → `CHANGELOG.md`
   - 功能完成 → `TODO.md`

---

## 快速導航

- **開始開發**：先讀 `GAME_DESIGN.md` 了解遊戲目標，再讀 `TECH_DESIGN.md` 了解架構
- **實作演算法**：參考 `AI_ALGO_NOTES.md` 的說明與範例
- **給 LLM/助手接手**：先讀 `assistant/README.md`，再依需求深入 `assistant/*.md`
- **專有名詞**：查閱 `GLOSSARY_中英術語.md`
- **歷史記錄**：檢視 `CHANGELOG.md`
- **待辦事項**：查看 `TODO.md`

---

**記住：所有內容必須歸屬到本清單中的文件之一，嚴禁建立任何未登記的文件或臨時檔。**
