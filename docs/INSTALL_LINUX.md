# Linux install guide

chainq runs on any 64-bit Linux distribution with Node.js ≥ 20.
This guide is tested against Ubuntu 22.04 / 24.04 LTS and Debian 12.
The same instructions work on Fedora, Arch, and Alpine with package-manager
substitutions noted inline.

## Five-minute install (Ubuntu / Debian)

```bash
# 1. Install Node 22 from NodeSource (or use nvm — see below).
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential git

# 2. Install pnpm.
sudo npm install -g pnpm@9.12.0

# 3. Clone and bootstrap.
git clone https://github.com/Jacksstt/chainq.git ~/.chainq
cd ~/.chainq
pnpm install --frozen-lockfile
pnpm seed              # writes a few MB of sample Parquet under data/
pnpm test              # typecheck + smoke + MCP smoke

# 4. Run the MCP server (stdio transport).
node bin/chainq-mcp-stdio
```

For a fully unattended bootstrap, use the project installer:

```bash
curl -fsSL https://raw.githubusercontent.com/Jacksstt/chainq/main/scripts/install.sh | sh
```

The installer drops a `chainq` shim into `$HOME/.local/bin`; add that to
`$PATH` if it isn't already.

## Distribution notes

| Distro                | Node                              | Build deps               |
|-----------------------|-----------------------------------|--------------------------|
| Ubuntu / Debian       | NodeSource `setup_22.x`           | `build-essential`        |
| Fedora                | `dnf install nodejs npm`          | `@development-tools`     |
| Arch                  | `pacman -S nodejs npm`            | `base-devel`             |
| Alpine                | `apk add nodejs npm`              | `build-base linux-headers` |
| RHEL / Rocky          | NodeSource RPM repo               | `gcc gcc-c++ make`       |

`build-essential` (or the equivalent) is only needed when DuckDB's native
addon has to compile from source. The published binaries cover x86_64 and
aarch64 glibc Linux; users on musl libc (Alpine) will trigger a source
build, which is why `linux-headers` is listed.

## nvm-based install (no sudo required)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
. ~/.nvm/nvm.sh
nvm install 22 && nvm use 22
npm install -g pnpm@9.12.0
git clone https://github.com/Jacksstt/chainq.git
cd chainq && pnpm install --frozen-lockfile && pnpm seed && pnpm test
```

## Running under systemd

Sample unit file at `/etc/systemd/system/chainq-mcp.service`:

```ini
[Unit]
Description=chainq MCP server (stdio)
After=network.target

[Service]
Type=simple
User=chainq
WorkingDirectory=/opt/chainq
Environment=CHAINQ_DATA_DIR=/var/lib/chainq/data
ExecStart=/usr/bin/node /opt/chainq/bin/chainq-mcp-stdio
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/chainq

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /var/lib/chainq chainq
sudo mkdir -p /opt/chainq /var/lib/chainq/data
sudo cp -r ~/.chainq/. /opt/chainq/
sudo chown -R chainq:chainq /opt/chainq /var/lib/chainq
sudo systemctl daemon-reload
sudo systemctl enable --now chainq-mcp
```

Stdio transport is normally invoked by an MCP client (Claude Code, Codex)
rather than a long-running daemon. Use the systemd setup only if you wrap
chainq behind an HTTP/SSE bridge.

## Docker fallback

If you'd rather not touch system packages, use the Docker stack:

```bash
docker compose -f docker/docker-compose.yml up -d
```

See `docs/RUNNING_A_NODE.md` for the full container layout.

## Verifying the install

```bash
node bin/chainq-mcp-stdio < /dev/null   # should exit cleanly within ~1s
pnpm test                                # full local test suite
```

The MCP smoke test exits non-zero if any tool registration breaks.

## Troubleshooting

- **DuckDB native build fails on Alpine**: install `python3 g++ make linux-headers`,
  re-run `pnpm install`. The DuckDB N-API addon needs Node-API headers.
- **`pnpm: command not found`**: NodeSource installs Node but not pnpm.
  Run `sudo npm install -g pnpm@9.12.0`.
- **Permission errors during `pnpm install`**: don't run the install as root;
  use a regular user account, or fix ownership: `sudo chown -R $(id -u):$(id -g) ~/.chainq`.
- **Sandboxed CI runners (no internet at runtime)**: pre-fetch dependencies
  in a build stage and use `pnpm install --offline` at runtime.
