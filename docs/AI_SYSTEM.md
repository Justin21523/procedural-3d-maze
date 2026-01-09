# AI 系統概覽（AI System Overview）

本文件提供 AI 的「設計級摘要」：AI 玩家（Autopilot）與怪物 AI（Enemy AI）如何分工、感知規則如何串起道具與玩法。若你需要 code-level 的完整追蹤（含檔案路徑、事件流、brain/module 擴充方式），請看 `docs/assistant/AI.md`。

---

## 一、AI 玩家（Autopilot）

目的：在玩家沒有輸入時接管角色，用來做 demo、壓力測試、驗證任務模板與 AI 生存策略。

核心檔案：

- 決策與導航：`src/ai/autoPilot.js`
- 接管判斷（idle/玩家輸入）：`src/core/gameLoop.js`（`autopilot` system）
- 任務狀態來源：`src/core/missions/missionDirector.js:getAutopilotState()`
- 道具策略：`src/core/playerToolAISystem.js`

行為摘要：

- **任務解題**：把目標拆成 Search/MoveTo/Interact tasks，降低在複雜地圖中卡住的機率
- **反抖動**：visited/unreachable 記憶 + junction step-lock，避免在多路口來回震盪
- **戰鬥節奏**：依 LOS/視角/距離決定是否開火；在 `stealthNoise` 等任務會抑制射擊/移動
- **道具使用**：在被看見/貼臉/守點等情境自動使用煙霧、閃光、陷阱、干擾器、感測器等

---

## 二、怪物 AI（Enemy AI）

### 2.1 Brain 架構（Monster Brains）

每隻怪物都有一個 brain（大腦）輸出每幀命令：

- brain 基底：`src/ai/brains/baseBrain.js:BaseMonsterBrain`
- 建立 factory：`src/ai/monsterAI.js:createMonsterBrain()`
- 管理與更新：`src/entities/monsterManager.js`

brain 指令（概念）：

- `move`：x/y 平面移動向量（正規化）
- `lookYaw`：朝向（用於轉向/射擊）
- `sprint`：是否衝刺
- `fire`：選配（由 combat module 或 brain 決定）

### 2.2 感知（Perception）

感知集中在 `src/entities/monsterManager/perception.js`：

- 視覺（Vision）：距離 + 視角（FOV）+ LOS
  - **煙霧（Smoke）會遮蔽視線**
- 聽覺（Noise）：玩家腳步、槍聲、誘餌、警戒傳播（alert）
- 嗅覺（Scent）：玩家移動留下氣味麵包屑；誘餌/誘餌投擲也會留下氣味

### 2.3 模組化加成（Modules）

brain 可透過 `src/ai/brainComposer.js` 加掛共用模組：

- 噪音調查（Noise Investigation）
- 側翼/掩護戰術（Flank/Cover Tactics）
- 小隊協調（Squad Coordination）

### 2.4 特殊怪：木頭人（Weeping Angel）

「玩家看著就不動，轉頭才靠近」的特殊規則：

- brain：`src/ai/brains/weepingAngel.js`
- type：`src/ai/monsterTypes.js:WEEPING_ANGEL`

---

## 三、AI 與玩法的關鍵連動點

道具（Tools）不是獨立系統；它們會直接影響 AI 感知：

- 誘餌/誘餌投擲：製造噪音 + 氣味（讓怪物被拉走）
- 煙霧：遮蔽視線（斷追/守點）
- 閃光：致盲/暈眩（緊急保命）
- 干擾器：削弱聽覺/嗅覺（降低被定位的機率）
- 感測器：靠近時 ping（給玩家/AI 玩家早期警告）

配置與擴充請看：`docs/assistant/CONTENT_SYSTEMS.md`

---

## 參考（Implementation Reference）

- AI 全套（詳細）：`docs/assistant/AI.md`
- 架構與更新順序：`docs/assistant/ARCHITECTURE.md`

