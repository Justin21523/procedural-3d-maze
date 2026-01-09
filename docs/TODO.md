# 功能待辦清單（TODO）

**用途：** 追蹤高層級功能開發進度（Feature-level）

狀態標記：

- ✅ 已完成（Completed）
- 🚧 進行中（In Progress）
- ⬜ 待開始（Pending）
- 🔄 需重構（Needs Refactor）
- ❌ 已取消（Cancelled）

---

## ✅ 已實作（現況功能）

### 核心循環

- ✅ 程序生成迷宮（含房型 room map）
- ✅ 多關卡（`public/levels/*.json`）+ 無限生成（recipes/dynamic）
- ✅ 任務系統（MissionDirector）+ 出口 gating（required objectives 才能離開）

### 玩家工具組（Player Kit）

- ✅ 武器：射擊/換彈/切槍/模式切換 + 技能（Q/X）
- ✅ 格擋（Block/Guard）含耐力與破防冷卻
- ✅ 道具系統（Tools）：
  - ✅ 部署：Lure/Trap/Jammer/Sensor/Mine
  - ✅ 投擲：Decoy/Smoke/Flash
  - ✅ HUD 固定顯示數量與快捷鍵

### AI 全套

- ✅ AI 玩家（Autopilot）：任務解題 + 反抖動/脫困 + 戰鬥節奏
- ✅ Autopilot 道具策略（PlayerToolAISystem）
- ✅ 怪物 AI：brain 架構 + modules（noise/tactics/squad）
- ✅ 感知：視覺（FOV/LOS/煙霧遮蔽）、聽覺（Noise）、嗅覺（Scent）
- ✅ 特殊怪：木頭人（Weeping Angel）
- ✅ 刷怪系統（SpawnDirector）：波次 + 多樣性保護（避免單一怪種）

### 導航/UX/效能

- ✅ Minimap：永遠顯示整張地圖縮圖（marker zoom 不裁切）
- ✅ 3D 世界標示（M 開關）：掉落/裝置/目標提示
- ✅ 效能保護：遠距離 AI 節流、投射物/特效上限、像素比限制等
- ✅ 程序化音效：道具 throw/deploy/trigger + objective chime

---

## 🚧 進行中（近期優先）

- 🚧 平衡（Balance）：怪物數量/傷害/視距、道具持續時間與掉落權重、任務節奏
- 🚧 關卡內容擴充：更多 recipes、更多 mission 組合、更多「非任務導向」遭遇設計
- 🚧 效能目標：中階機器維持 ~60 FPS（持續減少 draw calls/每幀掃描成本）

---

## ⬜ 待開始（中長期）

- ⬜ 更多道具變體（例如：煙霧/閃光的強弱版本、可部署標記器、更多陷阱類）
- ⬜ 更多 AI 規則與怪種（例如：只聽聲/只靠氣味、遮蔽物更嚴格、特殊觸發條件）
- ⬜ 教學/提示 UX：新手引導、快捷鍵提示一致化
- ⬜ 音效資產（非程序化）：環境音、怪物音、武器音（可選）
- ⬜ 設定保存：將部分設定寫入 localStorage（可選）

---

## 參考文件

- 文件治理：`docs/README.md`
- 接手者專區：`docs/assistant/README.md`

