#!/bin/sh
# gyc-code 安装脚本（curl | sh 方式）
# 用法: curl -fsSL https://raw.githubusercontent.com/guyongcheng2026/gyc-code/main/scripts/install.sh | sh
# 安装位置: ~/.gyccode/gyc-code（源码）+ ~/.gyccode/bin/gyc（启动器）
set -e

REPO="guyongcheng2026/gyc-code"
BRANCH="main"
PREFIX="${GYCCODE_HOME:-$HOME/.gyccode}"
SRC_DIR="$PREFIX/gyc-code"
BIN_DIR="$PREFIX/bin"

# 前置检查
command -v git >/dev/null 2>&1 || { echo "错误: 需要 git"; exit 1; }
command -v bun >/dev/null 2>&1 || { echo "错误: 需要 bun（https://bun.sh）"; exit 1; }

mkdir -p "$BIN_DIR"

# 克隆/更新源码
if [ -d "$SRC_DIR/.git" ]; then
  echo "更新 gyc-code 源码..."
  git -C "$SRC_DIR" pull --ff-only origin "$BRANCH"
else
  echo "克隆 gyc-code 源码..."
  git clone --depth 1 -b "$BRANCH" "https://github.com/$REPO.git" "$SRC_DIR"
fi

# 安装依赖并构建
echo "安装依赖并构建..."
cd "$SRC_DIR"
bun install
bun run build

# 生成启动器
cat > "$BIN_DIR/gyc" <<'LAUNCHER'
#!/bin/sh
exec bun "$HOME/.gyccode/gyc-code/dist/index.js" "$@"
LAUNCHER
chmod +x "$BIN_DIR/gyc"

echo ""
echo "gyc-code 安装完成："
echo "  源码: $SRC_DIR"
echo "  启动器: $BIN_DIR/gyc"
echo ""
echo "将以下路径加入 PATH（或运行: export PATH=\"\$PATH:$BIN_DIR\"）："
echo "  $BIN_DIR"
echo ""
echo "运行 gyc --help 验证。更新请执行: $BIN_DIR/gyc upgrade"
