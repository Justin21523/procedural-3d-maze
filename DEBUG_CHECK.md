# 🔍 實體顯示問題調試指南

## 問題描述
在 3D 世界中看不到出口和怪物的實體模型（只在 minimap 上看到圖標）

## ✅ 已修復的問題

### 1. Y 軸位置錯誤
**問題**：出口和怪物的 Y 軸位置設置為 0，導致它們埋在地板裡

**修復**：
- ✅ 出口點 Y 軸提升到 1.5（視線高度）
- ✅ 怪物 Y 軸提升到 0.9（地板上方）
- ✅ 怪物移動時 Y 軸保持不變

### 2. 移動時 Y 軸漂移
**問題**：怪物移動時 Y 軸位置會隨著速度向量改變

**修復**：
- ✅ moveTowards 函數只計算 XZ 平面的移動
- ✅ 每次更新都強制 Y 軸保持在 0.9

---

## 🎯 如何檢查問題已解決

### 步驟 1：啟動遊戲
```
http://localhost:3001/
```

### 步驟 2：打開瀏覽器 Console (F12)

查看是否有這些訊息：
```
🚪 Exit point created at grid: {x: XX, y: XX}
🚪 Exit mesh position: Vector3 {x: XX, y: 1.5, z: XX}
🚪 Exit mesh added to scene: true
👹 Monster spawned at grid (X, Y)
✅ Monster X added to scene and monsters array
```

### 步驟 3：在 Console 執行調試命令

```javascript
debugScene()
```

**應該看到**：
- `Total children in scene:` 應該 > 10（包含牆壁、地板、出口、怪物等）
- `Exit point mesh in scene? true`
- `Exit mesh position:` Y 應該是 1.5
- `Monster X: modelPos:` Y 應該是 0.9
- `inScene: true`（每個怪物都應該在場景中）

### 步驟 4：使用 Debug 面板傳送

1. 按 **`** 鍵顯示 Debug 按鈕
2. 點擊 Debug 按鈕打開面板
3. 按 **→ Exit** 傳送到出口

**應該看到**：
- ✅ 綠色發光的傳送門（星星形狀）
- ✅ 環繞的綠色粒子
- ✅ 上下浮動動畫

4. 按 **→ Monster** 傳送到怪物

**應該看到**：
- ✅ 紅色方塊（placeholder）
- ✅ 黃色眼睛（兩個小球）
- ✅ 方塊會移動（巡邏/追逐）

---

## 🐛 如果還是看不到

### 檢查 1：確認實體在場景中
在 Console 執行：
```javascript
debugScene()
```

如果顯示 `inScene: false`，說明實體沒有正確添加到場景。

### 檢查 2：確認位置正確
在 Console 執行：
```javascript
// 檢查出口位置
console.log('Exit position:', window.exitPoint.getMesh().position)

// 檢查怪物位置
window.monsterManager.getMonsters().forEach((m, i) => {
  console.log(`Monster ${i} position:`, m.getModel().position)
})
```

**正常值**：
- Exit Y: 1.5
- Monster Y: 0.9
- X 和 Z 應該在地圖範圍內（0 到 地圖大小 * TILE_SIZE）

### 檢查 3：確認可見性
```javascript
// 檢查是否可見
console.log('Exit visible?', window.exitPoint.getMesh().visible)
window.monsterManager.getMonsters().forEach((m, i) => {
  console.log(`Monster ${i} visible?`, m.getModel().visible)
})
```

### 檢查 4：檢查相機位置
```javascript
// 玩家位置
console.log('Player position:', player.getPosition())

// 出口距離
const exitPos = window.exitPoint.getMesh().position
const playerPos = player.getPosition()
const distance = Math.sqrt(
  Math.pow(exitPos.x - playerPos.x, 2) +
  Math.pow(exitPos.z - playerPos.z, 2)
)
console.log('Distance to exit:', distance)
```

如果距離太遠（> 100），使用 Debug 面板傳送過去。

---

## 📝 修改的文件

1. **src/world/exitPoint.js**
   - Line 24: Y 軸從 0 改為 1.5

2. **src/entities/monster.js**
   - Line 27: 初始 Y 軸從 0 改為 0.9
   - Line 211: patrol 目標 Y 軸從 0 改為 0.9
   - Line 240-260: moveTowards 函數只計算 XZ 移動
   - Line 260: 強制 Y 軸保持 0.9

3. **src/main.js**
   - Line 81-83: 添加調試訊息
   - Line 558-581: 添加 debugScene() 函數

---

## 🎮 快速測試

1. 啟動遊戲
2. 點擊「開始遊戲」
3. 按 ` 鍵打開 Debug
4. 按 **→ Exit** 傳送到出口
5. **應該立即看到綠色傳送門**

如果看到了，問題已解決！ ✅

如果還是看不到，請在 Console 執行 `debugScene()` 並截圖給我。
