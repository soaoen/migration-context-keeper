# migration-context-keeper

通用迁移上下文管理 Skill —— 解决 **AI 记忆易失、模型切换上下文丢失、长周期迁移失控** 三大痛点。

## 功能

- **垂直切片定义**：契约、数据、路由、依赖、验收标准一站式录入
- **架构决策记录**：轻量 ADR，决策-备选-后果可追溯
- **状态流转**：`defined → implementing → contract-test → shadow → cutover → done`
- **上下文打包/恢复**：`context dump/load` 实现模型/会话间无损交接

## 安装

### Claude Code
```bash
# 方式 1：下载脚本到用户级目录
curl -fsSL https://raw.githubusercontent.com/soaoen/migration-context-keeper/main/scripts/mck.ts \
  -o ~/.claude/scripts/mck.ts
chmod +x ~/.claude/scripts/mck.ts

# 方式 2：克隆整仓库（便于改源码）
git clone https://github.com/soaoen/migration-context-keeper.git ~/.claude/skills/migration-context-keeper
```

将 `skill.md` 内容放入项目的 `.claude/skills/migration-context-keeper.md`。

### 其他 AI 工具
将 `skill.md` 放入工具对应的 skills 目录，`scripts/mck.ts` 放到任意可执行路径。

## 使用

```bash
# 1. 项目首次使用
/mck init

# 2. 定义首个切片（AI 会逐步提问）
/mck slice define user-auth

# 3. 记录关键决策
/mck decision add 001-runtime-choice

# 4. 开发中更新状态
/mck slice status user-auth implementing
/mck slice status user-auth contract-test

# 5. 模型切换前导出上下文
/mck context dump > migration-bundle.json

# 6. 新模型会话恢复
/mck context load migration-bundle.json
```

## 依赖

- Bun ≥ 1.0（`bun scripts/mck.ts ...`）
- 无 npm 依赖

## 目录结构

```
migration-context-keeper/
├── skill.md                    # Skill 定义文档
├── scripts/
│   └── mck.ts                  # 核心 CLI
├── README.md
├── LICENSE
└── package.json
```

## 数据存储

所有数据存储在项目根目录的 `.migration-context/` 下：

```
.migration-context/
├── slices/
│   └── <slice-name>.json       # 切片定义
├── decisions/
│   └── <id>-<slug>.md          # 架构决策（Markdown + Frontmatter）
├── state.json                  # 全局状态
└── context-bundle.json         # dump 产物
```

- 纯文本文件，Git 友好，可 Diff、可 PR Review
- 无外部数据库依赖

## 许可证

MIT License - 详见 [LICENSE](LICENSE)
