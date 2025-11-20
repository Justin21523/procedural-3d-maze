# 复杂怪物 AI 系统 - 技术文档

## 📋 概览

本游戏已实现基于**行为树（Behavior Tree）**的复杂怪物 AI 系统，支持多种怪物类型和智能行为模式。

---

## 🎯 已实现功能

### ✅ 核心系统

1. **行为树引擎** (`src/ai/behaviorTree.js`)
   - Selector 节点（OR 逻辑）
   - Sequence 节点（AND 逻辑）
   - Parallel 节点（并行执行）
   - Condition 节点（条件检查）
   - Action 节点（行为执行）
   - Decorator 节点（Inverter, Repeater, Cooldown）

2. **A* 寻路算法** (`src/ai/pathfinding.js`)
   - 网格寻路
   - 对角线移动支持
   - 路径缓存优化
   - 路径平滑
   - 视线检测

3. **怪物类型系统** (`src/ai/monsterTypes.js`)
   - 5 种不同类型的怪物
   - 每种类型独特的统计数据和行为
   - 自动混合生成系统

---

## 🦊 怪物类型详细说明

### 1. Hunter（猎手）🔴
**模型**: fuzzlefox（狐狸）
**特点**: 快速、激进、持续追踪

**统计数据**:
- 速度: 3.6 (120%)
- 视野范围: 18 格
- 视野角度: 140°
- 听觉范围: 12 格

**行为**:
- 追逐记忆: 10 秒
- 搜索半径: 5 格
- 搜索持续时间: 8 秒
- 巡逻风格: 主动
- 发光颜色: 红色

**AI 特性**:
- 看到玩家后会长时间追逐
- 失去视线后会主动搜索
- 使用 A* 寻路智能绕路
- 很少停顿，总是在移动

---

### 2. Wanderer（流浪者）🟡
**模型**: cute_chick（小鸡）
**特点**: 缓慢、迟钝、自主游荡

**统计数据**:
- 速度: 2.1 (70%)
- 视野范围: 10 格
- 视野角度: 90°
- 听觉范围: 5 格

**行为**:
- 追逐记忆: 3 秒（很快放弃）
- 搜索半径: 2 格
- 巡逻风格: 随机
- 停顿几率: 30%
- 发光颜色: 黄色

**AI 特性**:
- 完全自主游荡，不遵循固定路线
- 经常停顿和转头
- 即使看到玩家也很快失去兴趣
- 对声音反应迟钝

---

### 3. Sentinel（哨兵）🟢
**模型**: pbr_low-poly_fox_character.glb
**特点**: 守卫区域，视野极广

**统计数据**:
- 速度: 2.7 (90%)
- 视野范围: 20 格（最远）
- 视野角度: 160°（几乎 180°）
- 听觉范围: 15 格

**行为**:
- 追逐记忆: 5 秒
- 巡逻风格: 区域
- 返回区域: 是
- 发光颜色: 绿色

**AI 特性**:
- 守卫特定房间或区域
- 视野极广，很难躲避
- 追逐后会返回原来的巡逻区域
- 适合放置在关键通道

---

### 4. Stalker（潜行者）🟣
**模型**: fuzzlefox（狐狸，不同配置）
**特点**: 跟随玩家，保持距离

**统计数据**:
- 速度: 3.0 (100%)
- 视野范围: 22 格（超远）
- 视野角度: 100°（聚焦）
- 听觉范围: 18 格（极佳）

**行为**:
- 追逐记忆: 15 秒（非常持久）
- 搜索半径: 7 格
- 跟随距离: 8 格
- 停顿几率: 40%（经常停下监听）
- 发光颜色: 紫色

**AI 特性**:
- 不会直接追上玩家，保持一定距离
- 经常停下来听声音
- 记忆力极强，很难甩掉
- 适合制造紧张气氛

---

### 5. Rusher（冲锋者）🟠
**模型**: cute_chick（小鸡，不同配置）
**特点**: 极快但注意力短暂

**统计数据**:
- 速度: 4.5 (150%) ⚡ **最快**
- 视野范围: 12 格
- 视野角度: 110°
- 听觉范围: 8 格

**行为**:
- 追逐记忆: 2 秒（极短）
- 搜索半径: 1 格（几乎不搜索）
- 停顿几率: 5%（几乎不停）
- 发光颜色: 橙色

**AI 特性**:
- 速度极快，很难逃脱
- 但注意力极短，容易失去目标
- 总是在快速移动
- 高风险高回报的遭遇

---

## 🧠 行为树结构

每个怪物的 AI 由行为树驱动，按优先级执行：

```
ROOT (Selector)
├─ [优先级 1] 追逐序列 (Chase Sequence)
│  ├─ 条件: CanSeePlayer
│  ├─ 动作: UpdateChaseTarget
│  ├─ 动作: PlayRunAnimation
│  └─ 动作: ChasePlayer (使用 A* 寻路)
│
├─ [优先级 2] 搜索序列 (Search Sequence)
│  ├─ 条件: HasRecentSighting (有最近目击)
│  ├─ 动作: SearchArea (螺旋搜索模式)
│  └─ 动作: PlayWalkAnimation
│
└─ [优先级 3] 巡逻/游荡 (Patrol/Wander)
   ├─ 动作: PatrolMove (定时巡逻)
   └─ 或: WanderMove (随机游荡)
```

---

## 🔊 听觉系统

### 实现方式

怪物可以"听到"玩家的移动声音：

- **正常行走**: 听觉范围 = 基础听觉范围
- **冲刺**: 听觉范围 × 1.5

### 使用方法

在 Monster.update() 中传递 `isPlayerSprinting` 参数：

```javascript
monster.update(deltaTime, playerPosition, isPlayerSprinting);
```

### 检测方法

```javascript
canHearPlayer(playerPosition, isPlayerSprinting) {
  const distance = this.position.distanceTo(playerPosition);
  const effectiveRange = isPlayerSprinting
    ? this.hearingRange * 1.5
    : this.hearingRange;
  return distance < effectiveRange;
}
```

---

## 🗺️ A* 寻路系统

### 特点

- **网格寻路**: 基于游戏的网格系统
- **对角线移动**: 支持 8 方向移动
- **防止穿墙**: 对角线移动时检查相邻格子
- **路径缓存**: 缓存最近计算的路径（5秒有效期）
- **路径平滑**: 移除不必要的路径点

### 使用方法

```javascript
// 在怪物类中
const path = this.pathfinding.findPath(
  { x: this.gridX, y: this.gridY },  // 起点
  { x: targetGridX, y: targetGridY },  // 终点
  true  // 使用缓存
);

this.currentPath = path;
```

---

## 📊 配置参数说明

### 速度等级

- **慢速 (70%)**: 2.1 单位/秒 - Wanderer
- **中速 (90%)**: 2.7 单位/秒 - Sentinel
- **正常 (100%)**: 3.0 单位/秒 - Stalker
- **快速 (120%)**: 3.6 单位/秒 - Hunter
- **极快 (150%)**: 4.5 单位/秒 - Rusher

### 视野范围

- **短 (10 格)**: Wanderer
- **中 (12-15 格)**: Rusher, Hunter
- **长 (18-20 格)**: Hunter, Sentinel
- **超长 (22 格)**: Stalker

### 追逐记忆

- **极短 (2 秒)**: Rusher - 快速失去兴趣
- **短 (3 秒)**: Wanderer - 容易放弃
- **中 (5 秒)**: Sentinel - 适度坚持
- **长 (10 秒)**: Hunter - 持续追踪
- **超长 (15 秒)**: Stalker - 几乎不放弃

---

## 🎮 游戏平衡

### 怪物数量: 8 只

默认配置会生成 8 只怪物，类型混合：
- 保证至少一只 Hunter, Wanderer, Sentinel
- 其余随机分配

### 混合策略

通过 `createMonsterMix(count)` 函数自动生成平衡的怪物组合。

---

## 🔧 调试工具

### 浏览器控制台命令

```javascript
// 查看所有怪物信息
debugMonsters()

// 输出示例:
// Monster 1:
//   Position: Vector3(10.2, 0.9, 5.4)
//   Grid: (5, 2)
//   State: CHASE
//   Model type: Group
//   Has animations: true

// 查看场景对象
debugScene()
```

---

## 📁 文件结构

```
src/
├── ai/
│   ├── behaviorTree.js         # 行为树核心引擎
│   ├── behaviorProfiles.js     # 怪物行为树配置
│   ├── pathfinding.js          # A* 寻路算法
│   └── monsterTypes.js         # 怪物类型定义
├── entities/
│   ├── monster.js              # 怪物实体类（已集成 BT + A*）
│   └── monsterManager.js       # 怪物管理器（支持多类型）
└── core/
    └── config.js               # 配置（MONSTER_COUNT = 8）
```

---

## 🚀 性能优化

1. **路径缓存**: A* 路径缓存 5 秒，避免重复计算
2. **行为树**: 每帧只 tick 一次，高效决策
3. **动画**: 使用 Three.js AnimationMixer，GPU 加速
4. **模型复用**: GLTFLoader 缓存，clone() 复用模型

---

## 🔮 未来扩展建议

1. **新怪物类型**:
   - Ambusher（埋伏者）- 躲在角落等待玩家
   - Coordinator（协调者）- 与其他怪物配合

2. **高级行为**:
   - 群体行为（包围玩家）
   - 学习玩家路线
   - 陷阱设置

3. **动态难度**:
   - 根据玩家表现调整怪物能力
   - 逃脱次数越多，怪物越聪明

---

## ⚠️ 注意事项

1. **性能**: 8 只怪物 + 复杂 AI，注意性能监控
2. **平衡**: 可以通过 CONFIG.MONSTER_COUNT 调整数量
3. **模型**: 确保 GLB 模型存在于 `public/models/` 目录
4. **调试**: 使用 `debugMonsters()` 排查 AI 问题

---

## 🧭 智能探索系统（Human-like Exploration AI）

### 核心原理

怪物现在使用**类人脑记忆系统**进行自主探索，特点如下：

### 记忆系统

1. **长期记忆（Long-term Memory）**
   - 记忆持续时间：**600 秒（10 分钟）**
   - 记录所有访问过的位置
   - 像人类一样，只有探索了大量新路径后才会忘记旧路径

2. **方向持久性（Direction Persistence）**
   - 持续时间：**60 秒**
   - 一旦选定方向，会沿着这个方向持续探索
   - 确保走廊被走到底，而不是中途转身

3. **障碍记忆（Stuck Memory）**
   - 记忆持续时间：**120 秒（2 分钟）**
   - 记住卡住的位置，避免重复犯错

### 目标选择算法

使用**三维评分系统**选择探索目标：

```javascript
// 距离奖励：越远越好（0-100 分）
distanceReward = (distance / maxDistance) * 100

// 访问惩罚：最近访问过的地方严重扣分（-100 到 0 分）
visitPenalty = -visitScore * 100

// 方向奖励：保持当前方向（+50 同方向，-50 反方向）
directionReward = dotProduct * 50

// 最终得分：越高越好
finalScore = distanceReward + visitPenalty + directionReward
```

### 路径预计算系统

1. **提前预计算**：当路径还剩 **10 个路点**时就开始计算下一条路径
2. **无缝切换**：当前路径结束时，立即切换到预计算的路径
3. **零停顿移动**：确保怪物永远不会因为路径计算而停顿

### 三重移动保证

```
优先级 1: 跟随 A* 路径
   ↓（如果路径为空）
优先级 2: 继续前往上次目标（并刷新紧急目标）
   ↓（如果无目标）
优先级 3: 紧急随机移动（立即生成新目标）
```

**结果**：怪物在任何情况下都会持续移动！

### 探索参数配置

| 参数 | 值 | 说明 |
|-----|---|------|
| 探索范围 | 10-50 格 | 最小 10 格，最大 50 格 |
| 备用范围 | 80 格 | 找不到目标时的扩展范围 |
| 记忆时长 | 600 秒 | 10 分钟长期记忆 |
| 方向持久 | 60 秒 | 保持方向 1 分钟 |
| 移动速度 | 9 单位/秒 | 非常快速的探索 |
| 预计算触发 | 10 路点 | 剩余 10 个路点时预计算 |

### 性能优化

1. **消除双重寻路**：`tryFindPath()` 直接设置 `currentPath`，避免重复计算
2. **早期预计算**：从 3 路点提前到 10 路点，给足时间计算
3. **智能评分**：使用清晰的加分/扣分系统，避免混淆

---

## 🔬 Frontier-based Exploration（前沿探索算法）- v4.0.0

### 算法概述

**v4.0.0 完全重构**：使用机器人学和自主导航领域的**Frontier-based Exploration**算法，替换所有 if-else 启发式逻辑。

### 什么是 Frontier？

**Frontier（前沿）**= 已探索空间与未探索空间的边界

```
示例：
■ ■ ■ ■ ■     ■ = 墙壁
■ · · F ？    · = 已探索
■ · · F ？    F = Frontier（边界）
■ · M · ？    ？= 未探索
■ ■ ■ ■ ■     M = Monster
```

### 核心算法步骤

```javascript
// 1. 标记当前位置为已探索
frontierExplorer.markExplored(currentX, currentY)

// 2. 扫描半径 30 格内所有 frontier cells
frontiers = findFrontiers(currentX, currentY)

// 3. 计算每个 frontier 的 information gain（信息增益）
infoGain = countUnexploredNeighbors(frontier, radius=5)

// 4. 将 frontiers 聚类成大区域
clusters = clusterFrontiers(frontiers, minClusterSize=3)

// 5. 为每个 cluster 选择最佳进入点
bestFrontier = selectBestFrontier(clusters)

// 6. 使用 A* 导航到选定的 frontier
path = findPath(currentPos, bestFrontier)
```

### Frontier 判定条件

一个格子是 Frontier 当且仅当：

1. ✅ 格子本身可行走
2. ✅ 格子尚未被最近探索过
3. ✅ 至少一个邻居是**已探索**格子
4. ✅ 至少一个邻居是**未探索**格子

### 评分系统（Higher = Better）

```javascript
// 距离奖励：越近越好（0-100）
distanceReward = (1 - distance/maxDistance) * 100

// 信息增益奖励：越多未探索区域越好（0-200）
infoGainReward = totalInfoGain * 2

// Cluster 大小奖励：越大的未探索区域越好（0-50）
clusterReward = min(50, clusterSize * 5)

// 探索年龄奖励：越久没访问越好（0-100）
ageReward = explorationAge * 100

// 方向一致性奖励：保持当前方向（±50）
directionReward = dotProduct * 50

// 最终得分
score = distanceReward + infoGainReward + clusterReward + ageReward + directionReward
```

### 与 v3.x 的对比

| 特性 | v3.x（启发式） | v4.0（Frontier-based） |
|-----|-------------|---------------------|
| **探索策略** | if-else 判断走廊/房间 | 系统性边界探索 |
| **代码复杂度** | ~120 行 | ~40 行（简化 67%） |
| **目标选择** | 手动评分启发式 | Information Gain 理论 |
| **完整性保证** | ❌ 无保证 | ✅ 理论上完整覆盖 |
| **振荡问题** | ⚠️ 容易来回踏步 | ✅ Cluster 聚类避免 |
| **研究基础** | 自制启发式 | 学术研究算法 |

### 卡住检测与恢复（Enhanced v4.0）

#### 1. 振荡检测（Oscillation Detection）

```javascript
// 追踪最近 10 个位置
positionHistory = [pos1, pos2, ..., pos10]

// 如果只在 2-3 个格子之间来回移动 = 振荡
if (uniqueGridCells <= 3) {
  return OSCILLATION
}
```

#### 2. 卡住原因分析

```javascript
analyzeStuckCause() {
  if (isOscillating()) return 'OSCILLATION'
  if (noWalkableNeighbors()) return 'DEAD_END'
  if (nextWaypointBlocked()) return 'PATH_BLOCKED'
  if (wallInFront()) return 'WALL_COLLISION'
  return 'UNKNOWN'
}
```

#### 3. 智能恢复策略

| 卡住原因 | 恢复策略 |
|---------|---------|
| **OSCILLATION** | 🔄 强制跳跃到远处 frontier（扫描半径 50 格） |
| **DEAD_END** | 🚧 转身 180° |
| **WALL_COLLISION** | 🧱 随机旋转 ±45° |
| **PATH_BLOCKED** | 🚫 清除路径，重新计算 |
| **UNKNOWN** | ❓ 随机旋转 |

### 文件结构更新

```
src/ai/
├── frontierExploration.js (NEW v4.0)  # Frontier Explorer 核心
├── behaviorProfiles.js (REWRITTEN)     # 使用 Frontier Explorer
├── behaviorTree.js                     # 不变
├── pathfinding.js                      # 不变
└── monsterTypes.js                     # 不变
```

### 配置参数（v4.0）

```javascript
FrontierExplorer({
  scanRadius: 30,           // 扫描半径
  explorationRadius: 3,     // 探索半径（标记为已探索）
  memoryDuration: 600000,   // 10 分钟记忆
  minFrontierClusters: 3,   // 最小 cluster 大小
  debug: false              // 调试模式
})
```

### 理论保证

1. **完整性（Completeness）**：理论上会探索所有可达区域
2. **系统性（Systematic）**：不依赖随机性，路径可预测
3. **效率（Efficiency）**：优先高信息增益区域

### 参考文献

- Yamauchi, B. (1997). "A frontier-based approach for autonomous exploration"
- Used in: Mars rovers, autonomous robots, SLAM systems

---

## 📝 更新日志

### 2025-11-20（版本 4.0.0）- Frontier-based Exploration 完全重构 🚀
- ✅ **完全重写探索系统**：使用 Frontier-based Exploration 算法
- ✅ **新增 frontierExploration.js**：专业探索算法实现
- ✅ **简化 behaviorProfiles.js**：从 ~120 行减少到 ~40 行（67% 减少）
- ✅ **Frontier 检测**：自动识别已探索/未探索边界
- ✅ **Information Gain**：基于信息增益的目标选择
- ✅ **Cluster 聚类**：识别大面积未探索区域
- ✅ **振荡检测**：追踪位置历史，检测来回踏步
- ✅ **智能恢复**：根据卡住原因（OSCILLATION, DEAD_END, WALL_COLLISION）采取不同策略
- ✅ **移除 if-else**：不再依赖走廊/房间/路口判断
- ✅ **理论保证**：系统性完整探索，非随机启发式

**Breaking Changes**:
- 探索行为完全重构，不再使用 v3.x 的手动评分系统
- 移除 `selectSmartTarget()`, `detectCorridor()`, `isInRoom()` 等启发式方法
- 探索逻辑从 `monster.js` 移至 `frontierExploration.js`

### 2025-11-20（版本 3.1.0）- 智能探索系统大升级
- ✅ **修复双重寻路 BUG**：消除 `behaviorProfiles.js` 中的重复路径计算
- ✅ **优化预计算时机**：从 3 路点提前到 10 路点触发
- ✅ **全新评分系统**：使用加分/扣分机制（Higher = Better）
- ✅ **增强方向持久性**：从 20 秒延长到 60 秒
- ✅ **提升移动速度**：从 7 增加到 9 单位/秒
- ✅ **类人记忆系统**：10 分钟长期记忆 + 智能遗忘机制
- ✅ **三重移动保证**：确保怪物永不停顿

### 2025-11-20（版本 3.0.0）- 自主探索 AI
- ✅ 移除玩家追逐系统（仅近距离 8 格内触发）
- ✅ 实现长期记忆系统（600 秒）
- ✅ 实现方向持久性系统（60 秒）
- ✅ 添加路径预计算功能
- ✅ 实现无缝路径切换
- ✅ 增加移动速度至 7（后来提升到 9）
- ✅ 添加紧急移动机制

### 2025-11-20（版本 2.0.0）
- ✅ 实现行为树核心引擎
- ✅ 实现 A* 寻路算法
- ✅ 创建 5 种怪物类型
- ✅ 修复怪物浮空问题
- ✅ 集成听觉系统
- ✅ 增加怪物数量至 8 只
- ✅ 完成行为树集成

---

**开发者**: Claude AI
**当前版本**: 4.0.0
**最后更新**: 2025-11-20
