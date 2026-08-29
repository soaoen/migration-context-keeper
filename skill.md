---
name: migration-context-keeper
description: 通用迁移上下文管理 Skill：垂直切片定义、架构决策、风险清单、所有权锁、契约验证、交接包、波次管理、WIP 上限、定时自动提交、跨工具安装。适用于任何语言/框架迁移项目，支持多机并行与无缝接手。首次使用请运行 install-tools 自动安装到各 agent 工具并注入自然语言引导。
---

## 安装

### 一条命令（推荐，约 10 秒）
```bash
curl -fsSL https://raw.githubusercontent.com/soaoen/migration-context-keeper/main/install.sh | bash
```

自动完成：
- 克隆仓库到 `~/.claude/skills/migration-context-keeper/`（技能目录）
- 安装 CLI 到 `~/.claude/scripts/mck.ts` + PATH shim `~/.local/bin/mck`
- 注入自然语言引导段到 `~/.claude/CLAUDE.md`（幂等，marker 块，重复安装只更新）
- 自动检测系统代理（http_proxy/https_proxy 或 127.0.0.1:7897/7890），无需手动配代理

> **agent 自举**：装好后，你对任意 agent（Claude Code / opencode / codex / Cursor / Cline…）说一句「用 mck 管理迁移」，agent 读到 CLAUDE.md 引导就会自己调用 `mck`；若 `mck` 命令不存在，agent 会自行用上面的 curl 命令安装。

### 其他 AI 工具（codex / opencode / cursor 等）
```bash
mck install-tools --yes
# 或：bun ~/.claude/scripts/mck.ts install-tools --yes
```
检测所有已安装的 agent 工具，复制 skill 到各自 skills 目录，并注入自然语言引导到 `AGENTS.md` / `CLAUDE.md` / `.cursor/rules/`。

### 手动安装（Claude Code）
```bash
curl -fsSL https://raw.githubusercontent.com/soaoen/migration-context-keeper/main/scripts/mck.ts \
  -o ~/.claude/scripts/mck.ts
chmod +x ~/.claude/scripts/mck.ts
# 将 skill.md 放入 ~/.claude/skills/migration-context-keeper.md
```

## 依赖
- Bun ≥ 1.0（或 Node ≥ 18 + `--experimental-strip-types`）
- 无外部 npm 依赖
- 多机/自动提交功能需要 git 仓库

## 使用方式
```
/mck <subcommand> [args]
```

## 子命令总览

### 切片
| 命令 | 说明 |
|------|------|
| `slice define <name>` | 交互式定义垂直切片（契约、数据、路由、依赖、验收标准、集成检查点） |
| `slice list` | 列出所有切片及状态、负责人、波次归属 |
| `slice show <name>` | 显示切片完整定义（含风险、owner） |
| `slice status <name> [new-state]` | 查看/更新切片状态 |
| `slice claim <name> [--force]` | 认领切片（受 WIP 上限约束） |
| `slice takeover <name>` | 接手他人切片（= claim --force 语义化，用于死机/掉线） |
| `slice release <name> [--force]` | 释放切片 |
| `slice risk add <name> <类别> <描述> --mitigate "..."` | 记录一条风险（不可预知问题） |
| `slice risk list <name>` | 列出切片风险 |
| `slice handoff <name> [output]` | 生成交接包（喂给新模型/新机器） |

### 波次管理
| 命令 | 说明 |
|------|------|
| `wave plan [s1 s2 ...]` | 查看/设置当前波次切片集合 |
| `wave next` | 推进到下一波次 |

### 并行控制
| 命令 | 说明 |
|------|------|
| `wip show` | 查看 WIP 使用率（活跃切片数/上限） |
| `wip set <n>` | 设置 WIP 上限 |
| `machines` | 查看所有机器（心跳/认领） |

### 自动提交（无缝接手关键）
| 命令 | 说明 |
|------|------|
| `autocommit start [分钟]` | 启动定时自动提交（默认 15 分钟） |
| `autocommit stop` | 停止自动提交 |
| `autocommit status` | 查看状态 |

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
| `install-tools [--status] [--project\|--global] [--skill <path>] [--yes]` | 自动安装到各 agent 工具 + 注入自然语言引导（幂等） |

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

另显示：机器活跃列表、WIP 使用率、波次进度、切片状态分布。

## 多机并行协议（松耦合：有切片就有活，有机器就能接）

`.migration-context/` **提交进项目 git 仓库**，作为唯一事实源。每台机器 `git pull` 获取最新上下文，改动后 `git push`。

### 基本工作流
```bash
git pull
/mck context check              # 1. 看冲突/过期认领/未认领切片/WIP
/mck slice claim <name>         # 2. 认领一个切片（WIP 未满时）
# ... 开发，中途 /mck slice status <name> 更新状态
/mck slice release <name>       # 3. 完成释放，机器自动空闲
git add .migration-context/ && git commit -m "..." && git push   # 4. 提交共享
```

### 无缝接手（死机/掉线/卡住）
```bash
# 接手方：
/mck machines                   # 1. 看谁离线了、认领了谁
/mck slice handoff <slice>      # 2. 生成交接包（可选，理解上下文）
/mck slice takeover <slice>     # 3. 接手（强制覆盖过期认领）
git pull                        # 4. 拿到最新进度（依赖 autocommit 落盘）
# 5. 继续开发
```

### 定时自动提交（保证接手零损失）
```bash
/mck autocommit start [分钟]     # 机器开始干活前启动（默认 15 分钟）
# 每 N 分钟自动 git add/commit/push，进度落盘
# 即使机器突然死亡，接手方 git pull 即拿到全部半成品
/mck autocommit status          # 查看
/mck autocommit stop            # 停止
```
- 提交信息带 `[mck] <机器名> autocommit` 前缀，可辨识
- 半成品提交是设计使然，非错误；这是「无缝接手」的代价

### 波次推进（可选）
```bash
/mck wave plan slice-auth slice-channels slice-templates   # 定义本波次切片集合
# 机器自由认领本波次的切片，跑完 release
/mck wave next                  # 本波次完成，进入下一波次
```
- 波次不绑定具体机器——有多少机器就并行多少，剩余切片留到下一波次
- 4 切片 3 台 → 3 台各干一个，剩 1 个下波次由任意空闲机器收尾

### WIP 上限（防过度并行）
```bash
/mck wip set <n>                # 同时最多 n 个切片在途
/mck wip show                   # 当前使用率
```
- claim 新切片时校验；WIP 满则拒绝
- WIP 是「并行安全度」的旋钮——切片切得越干净，可安全调得越高

## 交接包（slice handoff）
`/mck slice handoff <name>` 生成包含以下内容的 JSON：
- 切片完整定义（契约、验收标准、集成检查点、风险）
- 关联的架构决策
- 依赖切片的状态
- 全局上下文（当前切片、下一步、风险、WIP、波次）
- **接收者操作清单**（pull → takeover → 实现 → 风险自查 → autocommit → release）

这是「换模型 / 换机器」时的无损交接介质。

## 数据目录结构
```
.migration-context/          ← 提交进 git（多机共享）
├── slices/
│   └── <slice-name>.json    # 切片定义（含 risks、owner、integrationChecks）
├── decisions/
│   └── <id>-<slug>.md       # 架构决策（Markdown + Frontmatter）
├── state.json               # 全局状态 + machines 心跳 + wipLimit + wave
├── auto/autocommit.json     # 自动提交状态（本机，gitignore）
└── context-bundle.json      # dump 产物（派生物，gitignore）
```

## 交互约定
- `slice define` / `decision add`：采用 **AI 引导式问答**，逐字段确认，生成前预览
- 所有写入操作均会先显示 diff，确认后再落盘（交互模式下）
- `context dump/load` 产物可直接喂给新模型会话，实现「无损上下文交接」

## 跨工具安装与 agent 自举

`mck` 的核心（脚本 + `.migration-context/` 数据）**不依赖任何特定 agent 工具**——任何工具都能通过 bash 调用。工具差异只在「skill 放哪」：

| 工具 | skill 位置 | 引导注入位置 | 说明 |
|------|-----------|-------------|------|
| Claude Code | `~/.claude/skills/migration-context-keeper.md` | `CLAUDE.md` | 原生支持 |
| opencode | `~/.claude/skills/`（官方兼容） | `AGENTS.md` | 零适配 |
| Codex CLI | `~/.codex/skills/<name>/SKILL.md` | `AGENTS.md` | 官方格式一致 |
| Cursor | `.cursor/rules/mck.mdc` | 同左 | 自动生成 |
| Cline | `.claude/skills/` | 同左 | 兼容目录 |
| Windsurf | `.windsurf/rules/` | 同左 | 手动放置 |

一次 `mck install-tools` 覆盖上表所有全局/项目位置，并向规则文件写入**自然语言引导段**——任何 agent 读到后即可自行调用 mck，实现「用户说人话，agent 自举」。

> 对 agent 的关键指令：**`mck` 命令不存在时，先跑 `mck install-tools --yes` 安装，而不是放弃使用。**

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

# 6. 模型切换前生成交接包 / 导出上下文
/mck slice handoff user-auth > auth-handoff.json
/mck context dump > migration-bundle.json

# 7. 新模型/新机器恢复
/mck context load migration-bundle.json
```

## 配置（可选）
在项目根目录 `.mckrc.json`（本地配置，建议 gitignore）：
```json
{
  "contextDir": ".migration-context",
  "defaultStates": ["defined", "implementing", "contract-test", "shadow", "cutover", "done", "blocked", "abandoned"],
  "staleClaimHours": 4,
  "defaultWipLimit": 4,
  "defaultAutoCommitInterval": 15
}
```
