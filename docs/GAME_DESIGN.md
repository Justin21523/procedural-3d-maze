# 遊戲設計文件（Game Design Document）

本文件描述「玩家角度」看到的玩法：核心循環、任務類型、道具策略、怪物壓力與 UI 導航。程式實作細節請看 `docs/assistant/README.md`（含檔案路徑與系統關聯）。

---

## 一、遊戲願景（Vision）

這是一個類 Backrooms 的第一人稱（First-person）迷宮生存/任務原型：

- 每一關以程序生成（Procedural Generation）產生迷宮與房間配置
- 關卡會配置一組目標（Missions/Objectives）
- 玩家需要在怪物壓力下完成目標並解鎖出口
- 通關後進入下一關；支援無限生成（Endless）與難度成長（Difficulty Scaling）

同時提供 AI 玩家（Autopilot）作為 demo/測試工具：當玩家不操作時會自動解任務、戰鬥並使用道具。

---

## 二、核心循環（Core Loop）

1. **進入關卡**：生成迷宮 + 房型（Room Types）
2. **讀取目標**：HUD 顯示 objective（例如「收集證物」「修復電力」「保持安靜」）
3. **探索與資源管理**：
   - 以 minimap 掃地圖，找任務物件、掉落與出口
   - 收集彈藥/補血/道具（Tools）
4. **在怪物壓力下完成目標**：
   - 躲藏、拉視線、利用煙霧/閃光/干擾器等
5. **解鎖出口**：完成 required objectives 才能開門離開
6. **進入下一關**：難度上升（怪物/任務/配置會更緊湊）

---

## 三、玩家能力（Player Kit）

### 3.1 移動與生存

- 第一人稱移動（WASD + 滑鼠）
- 衝刺（Sprint）：更快，但通常也更「吵」
- 格擋（Block/Guard）：右鍵或 `F`，可降低傷害，但有耐力（stamina）與破防冷卻

### 3.2 戰鬥

- 射擊（Fire）/換彈（Reload）/武器切換（1/2/3）
- 技能（Skills）：例如手榴彈（`Q`）與 EMP（`X`）

### 3.3 道具（Tools）

道具目標是讓玩法「不只靠槍」：

- 誘餌（Lure）：把怪物引開，為你創造安全路線
- 陷阱（Trap）：短暫控制（stun）讓你拉距離
- 干擾器（Jammer）：降低怪物感知（聽/嗅）
- 感測器（Sensor）：提供早期警告（靠近會 ping）
- 地雷（Mine）：區域傷害 + 噪音（適合守點/撤退）
- 煙霧（Smoke）：遮蔽視線（用於斷追）
- 閃光（Flash）：短暫致盲/暈眩（緊急保命）
- 誘餌投擲（Decoy）：製造大噪音與氣味引走怪物

---

## 四、任務（Objectives）設計方向

任務由關卡 JSON 配置（`public/levels/*.json`），核心原則：

- **可組合（Composable）**：不同模板可混搭，形成多樣關卡節奏
- **有門檻（Gates）**：出口需要完成 required objectives，避免「直衝出口」
- **能促使策略**：例如「保持安靜」迫使玩家停下來、用工具控場

常見模板（例）：

- 收集/上傳：`collectEvidence` + `uploadEvidence`
- 電力：`restorePowerFuses` / `restorePower` / `reroutePower`
- 序列/解謎：`enterRoomSequence` / `switchSequence` / `codeLock`
- 潛行/守點：`stealthNoise`（Stay Quiet）、`hideForSeconds`、`surviveNoDamage`
- 戰鬥目標：`killCount`
- 逃脫：`unlockExit`

---

## 五、怪物壓力（Enemy Pressure）

怪物的設計目標是：

- 不是單一追逐：不同怪種有不同感知與戰鬥節奏
- 讓道具有價值：煙霧、閃光、誘餌、干擾器能確實改變局勢
- 避免「卡死/亂跳」：遠距離節流只節流思考，不節流移動（避免跳格）

怪種例（以 type/brain 為主）：

- Hunter：積極追擊，可能具遠程壓力
- Sentinel：偏守點/守區
- Stalker：距離跟隨或側翼
- Weeping Angel（木頭人）：被你看著就凍結，轉頭才會靠近
- Greeter：低威脅/偏引導（如果關卡配置）

---

## 六、UI 與導航（UX）

- **Minimap**：永遠顯示整張地圖縮圖（不會因調整尺寸而裁切）
- **3D 世界標示**：可用 `M` 開關，提示附近掉落/裝置/目標
- **HUD**：
  - objective/提示文字
  - 道具數量 + 固定快捷鍵
  - 噪音條（讓玩家知道自己「剛剛有多吵」）

---

## 七、難度與無限生成（Difficulty & Endless）

設計目標：

- 關卡數量不設上限
- 難度隨關卡 index 與玩家表現逐步上升（避免太快失控或太快無聊）
- 多樣性（怪物型態池、掉落權重）應由關卡 JSON 直接配置；缺漏時系統有保護機制避免單一玩法

---

## 參考（Implementation Reference）

- 給接手者（含檔案路徑與系統關聯）：`docs/assistant/README.md`
- 關卡/任務/道具：`docs/assistant/CONTENT_SYSTEMS.md`
- AI 全套：`docs/assistant/AI.md`

### 5.3 遊戲化元素

- **目標系統**：找到出口、收集道具
- **生命值與死亡**：被抓到有懲罰
- **難度遞增**：關卡越深，怪物越多

### 5.4 視覺增強

- **後處理效果**：Bloom、色差、顆粒感
- **動態燈光**：閃爍、陰影
- **粒子效果**：灰塵、霧氣

---

## 六、修訂記錄（Revision History）

| 日期 | 版本 | 修改內容 | 修改者 |
|------|------|---------|--------|
| 2025-11-20 | v0.1 | 初版：定義遊戲願景、MVP 範圍、怪物行為 | Claude Code |

---

**注意：本文件應隨專案進展持續更新，所有遊戲規則與體驗設計變更必須記錄於此。禁止建立 `GAME_DESIGN_v2.md` 等副本。**
