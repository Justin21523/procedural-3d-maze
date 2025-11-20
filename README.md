# Procedural 3D Maze

一個使用 **JavaScript + Three.js** 製作的實驗性 3D 迷宮原型專案，具備隨機生成地圖、第一人稱視角移動與可愛怪物 AI。本專案的重點是**學習與實作演算法**，而非製作商業級遊戲。

**A procedural 3D maze prototype with cute monsters, built with JavaScript and Three.js. Focus on learning and implementing algorithms.**

![Phase](https://img.shields.io/badge/Phase-2%20Complete-blue)
![Version](https://img.shields.io/badge/version-0.2.0-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

---

## 特色（Features）

### Phase 1 - MVP（已完成）✅
- ✅ 第一人稱視角探索（First-person exploration）
- ✅ WASD + 滑鼠控制（WASD + mouse controls）
- ✅ 簡單 3D 場景（地板 + 牆壁）（Simple 3D scene with floor and walls）
- ✅ 碰撞檢測（Collision detection）
- ✅ Backrooms 風格視覺（Backrooms-like atmosphere）

### Phase 2 - 隨機迷宮生成（已完成）✅
- ✅ DFS-based 迷宮生成演算法
- ✅ 可配置地圖尺寸
- ✅ 自動生成出生點
- ✅ 保證迷宮連通性

### Phase 3 - 基礎怪物 AI（待實作）⬜
- ⬜ A* 路徑搜尋演算法
- ⬜ 可愛怪物追擊行為
- ⬜ 簡單視線判斷

### Phase 4 - 完整 FSM（待實作）⬜
- ⬜ 怪物狀態機（Patrol / Chase / Search）
- ⬜ 完整視線系統（視距 + 視角 + 遮擋）
- ⬜ 巡邏路徑

---

## 快速開始（Quick Start）

### 系統需求（Requirements）
- Node.js v18+
- 現代瀏覽器（支援 WebGL）

### 安裝與執行（Installation）

```bash
# 1. 複製專案（Clone the repository）
git clone https://github.com/yourusername/procedural-3d-maze.git
cd procedural-3d-maze

# 2. 安裝依賴（Install dependencies）
npm install

# 3. 啟動開發伺服器（Start dev server）
npm run dev

# 4. 開啟瀏覽器（Open browser）
# 前往 http://localhost:3000
```

### 操作方式（Controls）

| 按鍵 | 功能 |
|------|------|
| **WASD** | 移動（Move） |
| **滑鼠（Mouse）** | 轉視角（Look around） |
| **Shift** | 衝刺（Sprint） |
| **ESC** | 暫停 / 釋放滑鼠（Pause / Release mouse） |

---

## 專案結構（Project Structure）

```
procedural-3d-maze/
├── docs/                    # 📚 所有設計與技術文件
│   ├── GAME_DESIGN.md      # 遊戲設計文件
│   ├── TECH_DESIGN.md      # 技術設計文件
│   ├── AI_ALGO_NOTES.md    # 演算法筆記
│   ├── GLOSSARY_中英術語.md # 術語對照表
│   └── TODO.md             # 功能待辦清單
├── public/                  # 🌐 靜態資源
│   └── index.html          # HTML 入口
├── src/                     # 💻 程式碼主目錄
│   ├── main.js             # 主程式入口
│   ├── core/               # 核心系統（config, gameLoop）
│   ├── rendering/          # 渲染模組（scene, camera, lighting）
│   ├── world/              # 世界與地圖（worldState, mapGenerator）
│   ├── player/             # 玩家系統（input, playerController）
│   ├── ai/                 # AI 系統（pathfinding, fsm, monsters）
│   └── utils/              # 工具函式（math, random）
├── scripts/                 # 📝 開發腳本與說明
│   └── dev.md              # 開發環境設定說明
├── package.json            # NPM 依賴與腳本
└── vite.config.js          # Vite 配置
```

---

## 技術棧（Technology Stack）

| 技術 | 用途 |
|------|------|
| **JavaScript (ES6+)** | 程式語言 |
| **Three.js** | 3D 渲染引擎 |
| **Vite** | 開發伺服器與打包工具 |

**不使用的技術：** React/Vue、TypeScript、遊戲引擎（Unity/Godot）
**理由：** 專注於演算法實作，保持最簡工具鏈

---

## 演算法重點（Algorithm Highlights）

本專案實作以下核心演算法：

### 1. 迷宮生成（Maze Generation）
- **DFS-based algorithm**：深度優先搜尋生成連通迷宮
- 適合 Backrooms 風格的長走廊結構

### 2. 路徑搜尋（Pathfinding）
- **A* (A-star) algorithm**：怪物追蹤玩家的最佳路徑
- 使用 Manhattan distance 作為 heuristic

### 3. 視線判斷（Line-of-Sight）
- **距離檢查**：視距限制
- **視角檢查**：FOV 範圍
- **遮擋檢查**：Raycasting 判斷牆壁阻擋

### 4. 有限狀態機（Finite State Machine）
- **Patrol**：巡邏狀態
- **Chase**：追擊狀態
- **Search**：搜尋狀態

詳細說明請參考 `docs/AI_ALGO_NOTES.md`

---

## 文件導覽（Documentation）

| 文件 | 說明 |
|------|------|
| [GAME_DESIGN.md](docs/GAME_DESIGN.md) | 遊戲目標、玩法機制、怪物行為設計 |
| [TECH_DESIGN.md](docs/TECH_DESIGN.md) | 技術架構、模組拆分、資料流 |
| [AI_ALGO_NOTES.md](docs/AI_ALGO_NOTES.md) | 所有演算法實作細節與筆記 |
| [GLOSSARY_中英術語.md](docs/GLOSSARY_中英術語.md) | 專業術語中英對照表 |
| [TODO.md](docs/TODO.md) | 功能開發進度追蹤 |
| [CHANGELOG.md](docs/CHANGELOG.md) | 重大變更記錄 |
| [scripts/dev.md](scripts/dev.md) | 開發環境設定詳細說明 |

---

## 開發原則（Development Principles）

### 1. 單一真相檔（Single Source of Truth）
- 同一主題只有一個文件
- 禁止建立 `*_v2.md`、`*_backup.md` 等副本
- 所有更新必須回寫對應原檔

### 2. 極簡工具鏈（Minimal Tooling）
- 不使用複雜框架或過度工程
- 優先使用原生 ES Modules
- 保持依賴最少化

### 3. 演算法可讀性優先（Readability Over Cleverness）
- 清楚的程式結構比炫技重要
- 每個函式與類別都有 English 註解
- 避免 God file / God class

### 4. 約定式提交（Conventional Commits）
- 使用 `feat|fix|docs|refactor|test|chore:` 前綴
- 每次改動聚焦一件事

詳見 `docs/README.md` 的治理規則。

---

## 貢獻指南（Contributing）

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
- [ ] **Phase 3** - 基礎怪物 AI（A* 路徑搜尋）
- [ ] **Phase 4** - 完整 FSM 與視線系統
- [ ] **Phase 5** - 體驗優化（音效、UI、多怪物）

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
**狀態：Phase 2 完成，具備隨機迷宮生成功能**

---

## 快速連結（Quick Links）

- [開發環境設定](scripts/dev.md)
- [遊戲設計文件](docs/GAME_DESIGN.md)
- [技術設計文件](docs/TECH_DESIGN.md)
- [演算法筆記](docs/AI_ALGO_NOTES.md)
