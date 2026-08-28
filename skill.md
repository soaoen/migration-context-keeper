---
name: migration-context-keeper
description: 通用迁移上下文管理 Skill：垂直切片定义、架构决策记录、状态追踪、上下文打包/恢复。适用于任何语言/框架迁移项目。
---

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

将 `skill.md` 内容放入项目的 `.claude/skills/migration-context-keeper.md`（或用上述 clone 目录）。

### 其他 AI 工具（Cursor / Cline / Windsurf 等）
将 `skill.md` 放入工具对应的 skills 目录，`scripts/mck.ts` 放在任意可执行路径（或在 PATH 中）。

## 依赖
- Bun ≥ 1.0（或 Node ≥ 18 + `--experimental-strip-types`）
- 无外部 npm 依赖

## 使用方式
```
/mck <subcommand> [args]
```

## 子命令总览
| 命令 | 说明 |
|------|------|
| `init` | 在当前工作目录初始化 `.migration-context/` 结构 |
| `slice define <name>` | 交互式定义一个垂直切片（契约、表、路由、依赖、验收标准） |
| `slice list` | 列出所有切片及状态 |
| `slice status <name> [new-state]` | 查看/更新切片状态 |
| `slice show <name>` | 显示切片完整定义 |
| `decision add <id>` | 记录一条架构决策（ADR 简化版） |
| `decision list` | 列出所有决策 |
| `decision show <id>` | 显示决策详情 |
| `context dump [output]` | 导出完整上下文包（JSON，默认 stdout） |
| `context load <file>` | 从包恢复上下文到当前目录 |

## 切片状态流转
```
defined → implementing → contract-test → shadow → cutover → done
                    ↘ blocked / abandoned
```

## 数据目录结构
```
.migration-context/
├── slices/
│   └── <slice-name>.json
├── decisions/
│   └── <id>-<slug>.md
├── state.json
└── context-bundle.json   # dump 产物
```

## 交互约定
- `slice define` / `decision add`：采用 **AI 引导式问答**，逐字段确认，生成前预览
- 所有写入操作均会先显示 diff，确认后再落盘
- `context dump` 产物可直接喂给新模型会话，实现「无损上下文交接」

## 典型工作流
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

## 配置（可选）
在项目根目录 `.mckrc.json` 可自定义：
```json
{
  "contextDir": ".migration-context",
  "scriptPath": "scripts/mck.ts",
  "defaultStates": ["defined", "implementing", "contract-test", "shadow", "cutover", "done", "blocked", "abandoned"]
}
```