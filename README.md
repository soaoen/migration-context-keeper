# migration-context-keeper

通用迁移上下文管理 Skill —— 解决 **AI 记忆易失、模型切换上下文丢失、长周期迁移失控、多机并行撞车、死机无法接手** 五大痛点。

## 功能

- **垂直切片定义**：契约、数据、路由、依赖、验收标准、集成检查点一站式录入
- **架构决策记录**：轻量 ADR，决策-备选-后果可追溯
- **状态流转**：`defined → implementing → contract-test → shadow → cutover → done`
- **风险清单**：显式记录迁移中的「不可预知问题」（时序/并发/历史数据/隐式契约/环境）
- **所有权锁**：`claim/release` 防多机撞车，`takeover` 无缝接手死机遗留
- **契约验证**：`context check` 检测路由冲突、写表冲突、依赖环、过期认领等
- **波次管理**：切片集合分波次推进，机器数量动态适配
- **WIP 上限**：限制同时在途切片数，防过度并行
- **机器心跳**：`machines` 查看各机活跃度/认领情况
- **定时自动提交**：`autocommit` 保证死机后接手零损失
- **交接包**：`slice handoff` 生成模型/机器间无损交接介质
- **上下文打包/恢复**：`context dump/load` 实现模型/会话间无损交接
- **跨工具安装 + agent 自举**：`install-tools` 一条命令装到所有 agent 工具，并注入自然语言引导，让任意工具里的 agent 读引导自行使用

## 安装

### 一条命令（推荐）
```bash
curl -fsSL https://raw.githubusercontent.com/soaoen/migration-context-keeper/main/install.sh | bash
```

自动完成：
- 克隆仓库到 `~/.claude/skills/migration-context-keeper/`（技能目录）
- 安装 CLI 到 `~/.claude/scripts/mck.ts` + PATH shim `~/.local/bin/mck`
- 注入自然语言引导段到 `~/.claude/CLAUDE.md`（幂等，marker 块，重复安装只更新）
- 自动检测系统代理（http_proxy/https_proxy 或 127.0.0.1:7897/7890 等），无需手动配代理

更新：重跑上面命令即可（git pull + 重新注入）。

> 装好后对任意 agent 说「用 mck 管理迁移」，agent 读到 CLAUDE.md 引导自动使用 mck；若 `mck` 命令不存在，agent 会自行用上面的 curl 命令安装。

### 其他 AI 工具（codex / opencode / cursor 等）
仓库自带 `install-tools` 子命令，一条命令装到所有工具：
```bash
mck install-tools --yes
# 或：bun ~/.claude/scripts/mck.ts install-tools --yes
```
检测所有已安装的 agent 工具，复制 skill 到各自 skills 目录，并注入自然语言引导到 `AGENTS.md` / `CLAUDE.md` / `.cursor/rules/`。

## 使用

```bash
# 1. 项目首次使用
/mck init

# 2. 定义首个切片（AI 会逐步提问）
/mck slice define user-auth

# 3. 记录关键决策
/mck decision add 001-runtime-choice

# 4. 认领切片（多机并行时防撞车）
/mck slice claim user-auth

# 5. 遇到不可预知问题 → 记录风险
/mck slice risk add user-auth concurrency "登录与刷新竞态" --mitigate "加锁"

# 6. 模型切换前生成交接包 / 导出上下文
/mck slice handoff user-auth > auth-handoff.json
/mck context dump > migration-bundle.json

# 7. 新模型/新机器恢复
/mck context load migration-bundle.json
```

## 多机并行 + 无缝接手

```bash
# 工作机
git pull
/mck context check              # 看冲突/过期认领/WIP
/mck slice claim <name>         # 认领（WIP 未满）
/mck autocommit start           # 启动自动提交，保证接手零损失
# ... 开发
/mck slice release <name>
git add .migration-context/ && git commit -m "..." && git push

# 接手方（原机器死机/掉线后）
/mck machines                   # 看谁离线、认领了谁
/mck slice takeover <slice>     # 接手
git pull                        # 拿到 autocommit 落盘的进度
```

## 契约验证（context check）

检测：路由冲突 / 写表冲突 / 依赖环 / 缺失依赖 / 过期认领 / 无主活跃切片 / 未确认的集成检查点 / 无缓解方案的风险。另显示机器活跃、WIP 使用率、波次进度。

## 跨工具安装（agent 自举）

核心（`scripts/mck.ts` + `.migration-context/`）不依赖任何 agent 工具，任何工具都能通过 bash 调用。工具差异只在「skill 放哪」，`mck install-tools` 一次覆盖：

| 工具 | skill 位置 | 引导注入 | 兼容方式 |
|------|-----------|---------|---------|
| Claude Code | `~/.claude/skills/` | `CLAUDE.md` | 原生 |
| opencode | `~/.claude/skills/` | `AGENTS.md` | 官方兼容 Claude skills |
| Codex CLI | `~/.codex/skills/<name>/SKILL.md` | `AGENTS.md` | 官方格式一致 |
| Cursor | `.cursor/rules/mck.mdc` | 同左 | 自动生成 |
| Cline | `.claude/skills/` | 同左 | 兼容目录 |

`install-tools` 向规则文件写入的**自然语言引导段**（marker 块，幂等）告诉任何 agent：迁移任务先查 `mck context check`、开工先 `mck slice claim`、遇问题记 `mck slice risk add`、换机器 `mck context dump` 等。装好后对任意 agent 说「用 mck 管理迁移」即可，agent 自行调用。

> 关键指令：**agent 发现 `mck` 命令不存在时，先跑 `mck install-tools --yes` 安装，而不是放弃使用。**

## 依赖

- Bun ≥ 1.0（`bun scripts/mck.ts ...`）
- 无 npm 依赖
- 多机/自动提交功能需要 git 仓库

## 目录结构

```
migration-context-keeper/
├── skill.md                    # Skill 定义文档（install-tools 的安装源）
├── install.sh                  # 一键安装脚本（curl 管道执行）
├── scripts/
│   └── mck.ts                  # 核心 CLI（跨工具，纯 Bun 无依赖）
├── README.md
├── LICENSE
└── package.json
```

安装后各工具副本：
```
~/.claude/skills/migration-context-keeper.md        # Claude Code + opencode
~/.codex/skills/migration-context-keeper/SKILL.md   # Codex CLI
~/.claude/scripts/mck.ts                            # 脚本
~/.local/bin/mck                                    # 可执行 shim（PATH 内）
```

## 数据存储

`.migration-context/`（提交进 git，多机共享）：

```
.migration-context/
├── slices/
│   └── <slice-name>.json       # 切片定义（含 risks、owner、integrationChecks）
├── decisions/
│   └── <id>-<slug>.md          # 架构决策（Markdown + Frontmatter）
├── state.json                  # 全局状态 + machines 心跳 + wipLimit + wave
├── auto/autocommit.json        # 自动提交状态（本机，gitignore）
└── context-bundle.json         # dump 产物（派生物，gitignore）
```

- 纯文本文件，Git 友好，可 Diff、可 PR Review
- 无外部数据库依赖

## 许可证

MIT License - 详见 [LICENSE](LICENSE)
