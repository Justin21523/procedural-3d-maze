# 變更記錄（Changelog）

本文件記錄專案的重大架構變更、系統調整與 breaking changes（不記錄小型 bug 修復；那應由 git commits 追蹤）。

格式參考：[Keep a Changelog](https://keepachangelog.com/)

> 備註：本 repo 目前未強制使用 git tags 發版；因此版本章節以「Unreleased」為主，必要時可補上 tag 後再整理版本區段。

---

## [Unreleased]

### Added（新增）

- Endless 關卡與難度成長：`LevelDirector` 支援 base levels + recipes + dynamic generation（`src/core/levelDirector.js`）
- 任務系統擴充：`MissionDirector` 支援多模板、required gating、Autopilot targets/state（`src/core/missions/missionDirector.js`）
- 刷怪/掉落導演：`SpawnDirector` 波次刷怪、工具掉落、型態多樣性保護（`src/core/spawnDirector.js`）
- 道具玩法：`ToolSystem`（部署 + 投擲）與工具拾取（`src/core/toolSystem.js`, `src/entities/pickupManager.js`）
- AI 玩家道具策略：`PlayerToolAISystem`（`src/core/playerToolAISystem.js`）
- 怪物感知全套：Noise/Scent、Smoke 斷 LOS、Flash 致盲、Jammer 削弱感知（`src/entities/monsterManager/perception.js`）
- 特殊怪：木頭人（Weeping Angel brain）（`src/ai/brains/weepingAngel.js`）
- 3D 世界標示：`WorldMarkerSystem`（M 開關）（`src/rendering/worldMarkerSystem.js`）
- 程序化音效：道具 throw/deploy/trigger + objective chime（`src/audio/audioManager.js`）
- LLM/Assistant 文件專區：`docs/assistant/*`

### Changed（變更）

- Minimap 行為改為「永遠顯示整張地圖縮圖」，zoom 只影響 markers；並加入 base layer 快取（`src/rendering/minimap.js`）
- Monster update 遠距離節流只節流「思考」不節流「移動」，避免跳格；並加入 render culling（`src/entities/monsterManager.js`）
- GameLoop 使用 `SystemRegistry` 明確化更新順序，加入 no-progress 脫困與 melee global limiter（`src/core/gameLoop.js`）

### Performance（性能）

- Renderer 限制 pixel ratio、關閉 shadows（`src/rendering/scene.js`）
- 投射物/特效硬上限、遠距離 tick 間隔（`src/core/config.js`, `src/entities/projectileManager.js`）

