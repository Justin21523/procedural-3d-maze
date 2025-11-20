# 测试说明

## 🔧 我修复的问题

1. ✅ **THREE.Vector3 未导入** - 在 behaviorProfiles.js 中添加了 `import * as THREE from 'three'`
2. ✅ **worldState.tileSize 不存在** - 改为使用 `CONFIG.TILE_SIZE`
3. ✅ **playAnimation 方法增强** - 支持数组和动画映射

---

## 🧪 诊断步骤

### 步骤 1: 测试模块加载
访问: **http://localhost:3002/test-ai.html**

这个页面会测试所有 AI 模块是否能正确导入。

**预期结果**:
```
✅ BehaviorTree loaded: ...
✅ Pathfinding loaded: ...
✅ MonsterTypes loaded: ...
✅ BehaviorProfiles loaded: ...
✅ Monster loaded: ...
✅ MonsterManager loaded: ...
🎉 All modules loaded successfully!
```

**如果出错**: 记录错误信息并告诉我

---

### 步骤 2: 测试主游戏
访问: **http://localhost:3002/diagnostic.html**

点击 **"Test Main Game"** 按钮

**预期结果**:
```
✅ main.js loaded successfully
```

**如果出错**: 会显示详细的错误堆栈

---

### 步骤 3: 测试实际游戏
访问: **http://localhost:3002/**

按 **F12** 打开控制台

**预期看到的日志**:
```
🎮 Initializing 8 monsters with mixed types...
📍 Got X spawn points
🎲 Monster type distribution: [Hunter, Wanderer, ...]

🦊 Spawning Hunter (1/8)...
   ✅ Loaded model: /models/fuzzlefox...
   🦊 Monster model height: X.XX, ground offset: X.XX
   🧠 Hunter behavior tree created
   👹 Hunter monster spawned at grid (X, Y)
✅ Hunter spawned successfully

... (repeat for each monster)

📊 Monster Summary:
   Hunter: 2
   Wanderer: 2
   etc...
```

---

## ❌ 可能的错误及解决方案

### 错误 1: "Cannot find module"
**原因**: 文件路径错误或文件不存在
**解决**: 检查 `src/ai/` 目录是否包含所有文件

### 错误 2: "X is not a constructor"
**原因**: 导入的类没有正确导出
**解决**: 检查 export/import 语句

### 错误 3: "Cannot read property 'x' of undefined"
**原因**: 对象未正确初始化
**解决**: 检查构造函数参数传递

### 错误 4: 游戏卡住/白屏
**可能原因**:
1. JavaScript 错误导致初始化失败
2. 无限循环
3. 模型加载失败

**调试**:
1. 打开浏览器控制台查看错误
2. 检查 Network 标签页，看哪些资源加载失败
3. 使用 diagnostic.html 逐步测试

---

## 🐛 当前已知的潜在问题

1. **模型加载可能失败**
   - 如果 GLB 模型路径错误或文件损坏
   - 系统会自动回退到 placeholder（彩色方块）

2. **性能问题**
   - 8 只怪物 + 复杂 AI 可能在低配置机器上卡顿
   - 可以暂时减少 `CONFIG.MONSTER_COUNT` 到 3-4

3. **行为树可能不执行**
   - 如果怪物没有 typeConfig，会回退到旧的 FSM
   - 检查控制台是否有 "behavior tree created" 日志

---

## 📝 报告错误时请提供

1. **控制台的完整错误信息** (截图或复制文本)
2. **使用的测试页面** (test-ai.html / diagnostic.html / index.html)
3. **浏览器版本** (Chrome / Firefox / Edge)
4. **错误发生的时机** (加载时 / 开始游戏后 / 特定操作后)

---

## ✅ 确认系统正常工作的标志

1. ✅ 所有 8 只怪物成功生成
2. ✅ 控制台显示不同的怪物类型
3. ✅ 怪物在地面上（不浮空）
4. ✅ 怪物有不同的发光颜色
5. ✅ 怪物会移动（巡逻/追逐）
6. ✅ 没有 JavaScript 错误

---

## 🔍 高级调试

如果一切看起来正常但游戏行为奇怪：

```javascript
// 在浏览器控制台输入:

// 1. 查看所有怪物
debugMonsters()

// 2. 查看场景对象
debugScene()

// 3. 查看特定怪物的行为树
window.gameLoop.monsterManager.getMonsters()[0].behaviorTree

// 4. 强制怪物移动到玩家位置（测试寻路）
const monster = window.gameLoop.monsterManager.getMonsters()[0];
const player = window.gameLoop.player;
monster.currentPath = monster.pathfinding.findPath(
  monster.getGridPosition(),
  player.getGridPosition()
);
```

---

## 📞 需要帮助?

如果遇到问题，请：
1. 先运行 test-ai.html 确认模块加载
2. 运行 diagnostic.html 确认主文件加载
3. 提供完整的错误信息和控制台日志

我会根据错误信息继续调试！
