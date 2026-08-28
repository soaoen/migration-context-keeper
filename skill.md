---
name: migration-context-keeper
description: 通用迁移上下文管理 Skill：垂直切片定义、架构决策、风险清单、所有权锁、契约验证、交接包、上下文打包/恢复。适用于任何语言/框架迁移项目，支持多机并行协作。
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

将 `skill.md` 内容放入项目的 `.claude/skills/migration-context-keeper.md`。

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

### 切片
| 命令 | 说明 |
|------|------|
| `slice define <name>` | 交互式定义垂直切片（契约、数据、路由、依赖、验收标准、集成检查点） |
| `slice list` | 列出所有切片及状态、负责人 |
| `slice show <name>` | 显示切片完整定义（含风险、owner） |
| `slice status <name> [new-state]` | 查看/更新切片状态 |
| `slice claim <name> [--force]` | 认领切片（所有权锁，防多机撞车） |
| `slice release <name> [--force]` | 释放切片 |
| `slice risk add <name> <类别> <描述> --mitigate "..."` | 记录一条风险（不可预知问题） |
| `slice risk list <name>` | 列出切片风险 |
| `slice handoff <name> [output]` | 生成交接包（喂给新模型/新机器） |

### 决策
| 命令 | 说明 |
|------|------|
| `decision add <id>` | 记录一条架构决策（ADR 简化版） |
| `decision list` | 列出所有决策 |
| `decision show <id>` | 显示决策详情 |

### 上下文
| 命令 | 说明 |
|------|------|
| `context check` | 契约验证 + 健康检查（见下） |
| `context dump [output]` | 导出完整上下文包（JSON，默认 stdout） |
| `context load <file>` | 从包恢复上下文到当前目录 |

### 其他
| 命令 | 说明 |
|------|------|
| `init` | 初始化 `.migration-context/` 结构 + 机器心跳 |

## 切片状态流转
```
defined → implementing → contract-test → shadow → cutover → done
                    ↘ blocked / abandoned
```

## 风险类别（slice risk add 的 <类别>）
- `timing` — 时序/组合爆炸
- `concurrency` — 并发/竞态
- `data-history` — 历史脏数据/格式不兼容
- `implicit-contract` — 隐式契约/未文档化行为
- `environment` — 环境差异（时区/Unicode/行尾符）
- `combinatorial` — 组合/集成
- `unknown` — 未知

> 用途：把迁移中「不可预知的问题」显式记录为风险，附带缓解方案。下一个 agent / 模型 / 机器不再重复踩坑。发现新问题就 `slice risk add` 追加。

## 契约验证（context check）检测项
- ✗ **路由冲突**：两个切片声明同一 HTTP 路由
- ✗ **写表冲突**：两个切片写入同一张表
- ✗ **依赖环**：切片依赖成环（A→B→A）
- ⚠ **缺失依赖**：引用不存在的切片
- ⚠ **过期认领**：owner 认领超过 `staleClaimHours`（默认 4h）
- ⚠ **无主活跃切片**：处于 implementing/cutover 等状态但无人认领
- ℹ **集成检查点**：done 切片还有未确认的集成检查点
- ℹ **无缓解方案的风险**

## 多机并行协议（5 台机器协作同一项目）
`.migration-context/` **提交进项目 git 仓库**，作为唯一事实源。每台机器 `git pull` 获取最新上下文，改动后 `git push`。

```bash
# 每台机器的工作流
git pull
/mck context check              # 1. 看冲突/过期认领/未认领切片
/mck slice claim <name>         # 2. 认领一个切片（防撞车）
# ... 开发，中途 /mck slice status <name> 更新状态
/mck slice release <name>       # 3. 完成释放
git add .migration-context/ && git commit -m "..." && git push   # 4. 提交共享
```

约定：
- **一次只认领一个切片**，改完 release 再认领下一个
- 模型/机器切换前：`/mck slice handoff <name>` 产出交接包，喂给下一个 agent
- 崩溃遗留的过期认领：`/mck context check` 会标出，确认机器已下线后 `claim --force` 覆盖
- 机器标识用 `os.hostname()`，可用环境变量 `MCK_MACHINE` 覆盖（如 `MCK_MACHINE=machine-3 /mck ...`）

## 交接包（slice handoff）
`/mck slice handoff <name>` 生成包含以下内容的 JSON：
- 切片完整定义（契约、验收标准、集成检查点、风险）
- 关联的架构决策
- 依赖切片的状态
- 全局上下文（当前切片、下一步、风险）
- **接收者操作清单**（认领 → 实现 → 风险自查 → release）

这是「换模型 / 换机器」时的无损交接介质。

## 数据目录结构
```
.migration-context/          ← 提交进 git（多机共享）
├── slices/
│   └── <slice-name>.json    # 切片定义（含 risks、owner、integrationChecks）
├── decisions/
│   └── <id>-<slug>.md       # 架构决策（Markdown + Frontmatter）
├── state.json               # 全局状态 + machines 心跳
└── context-bundle.json      # dump 产物（派生物，可 gitignore）
```

## 交互约定
- `slice define` / `decision add`：采用 **AI 引导式问答**，逐字段确认，生成前预览
- 所有写入操作均会先显示 diff，确认后再落盘（交互模式下）
- `context dump/load` 产物可直接喂给新模型会话，实现「无损上下文交接」

## 典型工作流（单机）
```bash
# 1. 项目首次使用
/mck init

# 2. 定义首个切片（AI 会逐步提问）
/mck slice define user-auth

# 3. 记录关键决策
/mck decision add 001-runtime-choice

# 4. 开发中更新状态
/mck slice status user-auth implementing

# 5. 遇到不可预知问题 → 记录风险
/mck slice risk add user-auth concurrency "登录与刷新竞态" --mitigate "加锁"

# 6. 模型切换前导出上下文
/mck context dump > migration-bundle.json

# 7. 新模型会话恢复
/mck context load migration-bundle.json
```

## 配置（可选）
在项目根目录 `.mckrc.json`（本地配置，建议 gitignore）：
```json
{
  "contextDir": ".migration-context",
  "defaultStates": ["defined", "implementing", "contract-test", "shadow", "cutover", "done", "blocked", "abandoned"],
  "staleClaimHours": 4
}
```
