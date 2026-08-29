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

## 依赖

- Bun ≥ 1.0（`bun scripts/mck.ts ...`）
- 无 npm 依赖
- 多机/自动提交功能需要 git 仓库

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
