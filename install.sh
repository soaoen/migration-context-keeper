#!/usr/bin/env bash
# =============================================================================
# mck (migration-context-keeper) — 一条命令安装到 Claude Code
#
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/soaoen/migration-context-keeper/main/install.sh | bash
#
# 安装目标: ~/.claude/skills/migration-context-keeper/   (git clone 整个仓库)
#           ~/.claude/scripts/mck.ts                     (CLI 脚本)
#           ~/.local/bin/mck                             (PATH shim)
# 并注入自然语言引导段到 ~/.claude/CLAUDE.md (幂等, marker 块)
#
# 安装后可对任意 agent 说 "用 mck 管理迁移", agent 读取引导自动使用。
# =============================================================================
set -euo pipefail

REPO_URL="https://github.com/soaoen/migration-context-keeper.git"
DEST_DIR="$HOME/.claude/skills/migration-context-keeper"
SCRIPTS_DIR="$HOME/.claude/scripts"
SHIM_DIR="$HOME/.local/bin"
MCK_SCRIPT="$SCRIPTS_DIR/mck.ts"

# 代理：优先环境变量（http_proxy/https_proxy/HTTP_PROXY/HTTPS_PROXY），
# 其次常见本地代理端口（7890 Clash/7897 等），避免裸连 github 超时。
detect_proxy() {
  [ -n "${https_proxy:-}" ] && { echo "$https_proxy"; return; }
  [ -n "${HTTPS_PROXY:-}" ] && { echo "$HTTPS_PROXY"; return; }
  [ -n "${http_proxy:-}" ] && { echo "$http_proxy"; return; }
  [ -n "${HTTP_PROXY:-}" ] && { echo "$HTTP_PROXY"; return; }
  for p in 7897 7890 1087 10809; do
    if nc -z 127.0.0.1 "$p" >/dev/null 2>&1; then echo "http://127.0.0.1:$p"; return; fi
  done
  echo ""
}
PROXY="$(detect_proxy)"
GIT_PROXY_ARGS=""
if [ -n "$PROXY" ]; then
  GIT_PROXY_ARGS="-c http.proxy=$PROXY -c https.proxy=$PROXY"
  say "检测到代理 $PROXY"
fi

BOOTSTRAP_START="<!-- ===== mck (migration-context-keeper) AUTO-GENERATED START ===== -->"
BOOTSTRAP_END="<!-- ===== mck (migration-context-keeper) AUTO-GENERATED END ===== -->"

say() { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# --- 前置检查 ---
command -v git >/dev/null 2>&1 || die "需要 git 但未安装"
command -v bun  >/dev/null 2>&1 || warn "未检测到 bun; 安装后可用 'bun scripts/mck.ts' 运行。也可用 node 运行。"

# --- 1. clone 到 ~/.claude/skills/migration-context-keeper/ ---
if [ -d "$DEST_DIR/.git" ]; then
  say "已存在 $DEST_DIR, 执行 git pull 更新"
  (cd "$DEST_DIR" && git $GIT_PROXY_ARGS pull --ff-only 2>/dev/null || true)
else
  say "克隆仓库到 $DEST_DIR"
  mkdir -p "$(dirname "$DEST_DIR")"
  git $GIT_PROXY_ARGS clone --single-branch --depth 1 "$REPO_URL" "$DEST_DIR"
fi

# --- 2. 安装脚本到 ~/.claude/scripts/mck.ts ---
mkdir -p "$SCRIPTS_DIR"
cp "$DEST_DIR/scripts/mck.ts" "$MCK_SCRIPT"
chmod +x "$MCK_SCRIPT"
say "脚本安装到 $MCK_SCRIPT"

# --- 3. PATH shim ~/.local/bin/mck ---
if command -v bun >/dev/null 2>&1; then
  mkdir -p "$SHIM_DIR"
  cat > "$SHIM_DIR/mck" <<EOF
#!/usr/bin/env sh
exec bun "$MCK_SCRIPT" "\$@"
EOF
  chmod +x "$SHIM_DIR/mck"
  if echo "$PATH" | tr ':' '\n' | grep -q "$SHIM_DIR"; then
    say "shim 安装到 $SHIM_DIR/mck (已在 PATH)"
  else
    warn "shim 安装到 $SHIM_DIR/mck, 但 PATH 不含该目录。添加: export PATH=\"$SHIM_DIR:\$PATH\""
  fi
else
  warn "未安装 bun, 跳过 shim。之后安装 bun 后重跑本脚本, 或直接用 'bun $MCK_SCRIPT'"
fi

# --- 4. 注入引导段到 ~/.claude/CLAUDE.md (幂等) ---
CLAUDE_MD="$HOME/.claude/CLAUDE.md"
BOOTSTRAP=$(cat <<BOOT

${BOOTSTRAP_START}

本项目使用 **mck（migration-context-keeper）** 管理跨语言/跨框架迁移。迁移的全部状态记录在 \`.migration-context/\`（已提交 git）。

当你处理与迁移 / 重构 / 切片 / 架构决策相关的任务时：
- 先查询上下文再动手，不要凭空假设迁移进度：\`mck context check\`
- 查看切片：\`mck slice list\`；开工前认领：\`mck slice claim <name>\`
- 完工释放：\`mck slice release <name>\`；接手掉线/死机机器：\`mck slice takeover <name>\`
- 遇到不可预知的问题，记录为风险：\`mck slice risk add <name> <类别> <描述> --mitigate "缓解方案"\`
- 换模型/换机器前导出上下文：\`mck context dump\` 或 \`mck slice handoff <name>\`
- 长期任务先启动定时自动提交：\`mck autocommit start\`
- 首次使用先初始化：\`mck init\`

如果 \`mck\` 命令不存在（command not found），说明 mck 未安装。用下面的命令安装（一条命令，约 10 秒）:
\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/soaoen/migration-context-keeper/main/install.sh | bash
\`\`\`
装好后重新运行 \`mck init\`。

${BOOTSTRAP_END}
BOOT
)

mkdir -p "$(dirname "$CLAUDE_MD")"
if [ -f "$CLAUDE_MD" ]; then
  if grep -qF "$BOOTSTRAP_START" "$CLAUDE_MD"; then
    # 替换已有 marker 块 (幂等更新)
    sed -i '' "/${BOOTSTRAP_START}/,/${BOOTSTRAP_END}/d" "$CLAUDE_MD" 2>/dev/null || \
      sed -i "/${BOOTSTRAP_START}/,/${BOOTSTRAP_END}/d" "$CLAUDE_MD"
    printf '\n%s\n' "$BOOTSTRAP" >> "$CLAUDE_MD"
    say "更新 $CLAUDE_MD 中的 mck 引导段"
  else
    printf '\n%s\n' "$BOOTSTRAP" >> "$CLAUDE_MD"
    say "注入引导段到 $CLAUDE_MD"
  fi
else
  printf '%s\n' "$BOOTSTRAP" > "$CLAUDE_MD"
  say "创建 $CLAUDE_MD 并注入引导段"
fi

say "安装完成！现在对任意 agent 说「用 mck 管理迁移」，agent 会读取引导自动使用。"
say "仓库位置: $DEST_DIR"
say "更新方式: (cd $DEST_DIR && git pull) 或重跑本脚本"
