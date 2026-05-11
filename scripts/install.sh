#!/usr/bin/env bash
# Install chainq from source via npm/pnpm.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Jacksstt/chainq/main/scripts/install.sh | sh
#
# Prereqs: Node >= 20, git. Will install pnpm if missing.

set -euo pipefail

INSTALL_DIR="${CHAINQ_INSTALL_DIR:-$HOME/.chainq}"
REPO="${CHAINQ_REPO:-https://github.com/Jacksstt/chainq.git}"
BRANCH="${CHAINQ_BRANCH:-main}"

echo "[chainq] installing into $INSTALL_DIR"

# 1. Node check
if ! command -v node >/dev/null 2>&1; then
  echo "[chainq] node not found. Install Node >= 20 first: https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[chainq] node $NODE_MAJOR detected — need >= 20" >&2
  exit 1
fi

# 2. pnpm
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[chainq] installing pnpm"
  npm install -g pnpm@9.12.0
fi

# 3. clone or update
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "[chainq] updating existing checkout"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
else
  echo "[chainq] cloning"
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$INSTALL_DIR"
fi

# 4. install deps
cd "$INSTALL_DIR"
pnpm install --frozen-lockfile
pnpm seed

# 5. create a shim on PATH
SHIM_DIR="${CHAINQ_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$SHIM_DIR"
cat > "$SHIM_DIR/chainq" <<EOF
#!/usr/bin/env bash
exec pnpm --silent --dir "$INSTALL_DIR" --reporter=silent exec tsx "$INSTALL_DIR/packages/cli/src/bin.ts" "\$@"
EOF
chmod +x "$SHIM_DIR/chainq"

echo
echo "[chainq] installed."
echo "[chainq] add $SHIM_DIR to your PATH if it isn't already."
echo "[chainq] try: chainq help"
