# Enemy 模型 Metadata（`meta.json`）

本文件說明如何用 `public/models/<enemy>/meta.json` 來「資料驅動」調整敵人模型（scale、貼地、朝向）與部分玩法覆寫（AI/戰鬥/血量等），讓你**新增模型時不用改 runtime code**。

---

## 位置（Location）

- `public/models/<enemy>/meta.json`

範例：

```json
{
  "scaleMultiplier": 1.0,
  "groundOffset": 0.02
}
```

---

## 支援欄位（Supported Fields）

### 1) Top-level

- `aiType`（string）：覆寫使用哪個 brain（例如 `hunter`, `roomHunter`, `autopilotWanderer`, `distanceStalker`, `speedJitter`, `teleportStalker`, `greeter`, `weepingAngel`…）。
- `scaleMultiplier`（number）：乘上 monster type 的 `stats.scale`，讓不同模型在世界中大小一致。
- `groundOffset`（number）：垂直偏移，讓模型「腳貼地」。
- `hitRadius`（number）：子彈命中半徑覆寫。
- `correctionOffset`（object, optional）：`{x,y,z}`，用來把模型內層中心點校正到原點附近（避免轉向時「繞圈」）。
- `correctionRotationDeg`（object, optional）：`{x,y,z}`（度），用來修正模型 upright/forward。
- `correctionRotationRad`（object, optional）：`{x,y,z}`（弧度），同上（deg 的替代）。

備註：

- 若不提供 `correctionRotation*`，會使用 loader 的 auto-upright 結果。
- 若只想修 forward 方向，通常只調 `y`，保留 `x/z` 讓 upright tilt 不被破壞。

### 2) `stats`（淺合併到 monster type stats）

常見：

- `health`（number）
- `scale`（number）
- `speedFactor`（number）
- `visionRange`（number）
- `visionFOV`（number, radians）
- `hearingRange`（number）
- `hitRadius`（number）

### 3) `combat`（淺合併到 monster type combat）

常見：

- `contactDamage`（number）
- `hitStunSeconds`（number）
- `deathDelay`（number）
- `deathExplosionRadius`（number）
- `deathExplosionDamage`（number）

巢狀：

- `combat.ranged`：遠程攻擊調參（validated + best-effort clamped）

#### `combat.ranged`（節奏與效能也在這裡）

常見欄位：

- `enabled`（boolean）
- `kind`（string，例如 `"bolt"`）
- `range` / `minRange`（number）
- `damage`（number）
- `cooldown` 或 `shotInterval`（seconds）
- `fireChance`（0..1）
- `spread`（0..1）

節奏欄位（降低 spam、避免 FPS 崩）：

- `magSize`（integer）
- `reloadSeconds`（seconds）
- `burstMin` / `burstMax`（shots per burst）
- `burstRestSeconds`（seconds）
- `fireAlignDeg`（required yaw alignment before firing）
- `turnSpeed`（rad/s）

### 4) `brain`（合併到 MonsterManager 的 brainConfig）

這裡用來做 brain/modules wiring（戰術、小隊協調等）。

範例：

```json
{
  "brain": {
    "modules": {
      "squadCoordination": true,
      "noiseInvestigation": true,
      "flankCoverTactics": true
    }
  }
}
```

---

## Notes（重要備註）

- `meta.json` 會在 runtime 做 sanitize：型別不對會忽略，數值會 clamp 到安全範圍。
- 建議用以下頁面調參：
  - `enemy-lab.html`：第一人稱測試 + live tuning（可保存）
  - `test-enemy-meta.html`：輕量 transform 預覽（scale/upright/groundOffset）

---

## 保存（Save to Disk via Dev Server）

當你用 Vite dev server 跑起來時（`npm run dev`），`enemy-lab.html` 可直接寫入檔案：

- `POST /api/enemy-meta` with `{ modelPath: "/models/...", meta: {...} }`
- 寫入到：
  - Folder models：`public/models/<folder>/meta.json`
  - Root models：`public/models/<file>.meta.json`

---

## 模型管線自動化（Model Pipeline Automation）

新增/移除 `public/models/` 下的檔案後，可以用 scripts 重新產生 manifest / meta stubs：

- `npm run models:sync`（只處理 folder `meta.json`）
- `npm run models:sync:all`（也會產生 root `*.meta.json`）

