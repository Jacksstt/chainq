# Running a Full Node (Optional Path)

Most chainq users never need to run a full node — `chainq pull` against a
public Subsquid archive is enough for hobbyist and consultancy workloads.
This document is for the cases where that isn't true:

- You need data Subsquid doesn't carry.
- You don't want to trust any third-party archive.
- You're running an air-gapped or regulated deployment.

## Reference stacks

### Ethereum (reth + Lighthouse)

```yaml
# extends docker-compose.yml
services:
  reth:
    image: ghcr.io/paradigmxyz/reth:latest
    command: ["node", "--http", "--http.addr", "0.0.0.0", "--http.api", "eth,net,web3,debug"]
    volumes:
      - reth_data:/root/.local/share/reth
    ports: ["8545:8545"]
  lighthouse:
    image: sigp/lighthouse:latest
    command: ["lighthouse", "bn", "--network", "mainnet", "--execution-endpoint", "http://reth:8551"]
    volumes:
      - lighthouse_data:/root/.lighthouse
```

Disk budget for pruned mode: ~1-2 TB SSD. Initial sync: 2-4 days on a fast
SSD + 200 Mbps connection. RAM: 16 GB.

### Solana (Agave validator)

Solana RPC at production scale requires 256 GB RAM and 2 TB NVMe. For chainq
purposes use Helius — running your own Solana RPC is rarely worth it.

### Filecoin (Lotus)

```yaml
  lotus:
    image: ghcr.io/filecoin-project/lotus:latest
    volumes: [lotus_data:/var/lib/lotus]
    ports: ["1234:1234"]
```

Disk: 3+ TB. RAM: 192 GB recommended.

## Wiring chainq to your node

Once a node is running, swap the cron container to use cryo against your
own RPC instead of pulling from Subsquid:

```yaml
  cron:
    environment:
      ETHEREUM_RPC: http://reth:8545
    command: >
      sh -c "cryo logs --rpc $$ETHEREUM_RPC -b N:M
             --output-dir /data --output-format parquet"
```

## When this is worth it

- **Privacy**: Subsquid sees your subscription queries. A self-hosted node sees nothing.
- **Custom datasets**: If you need state queries (`eth_call` historical),
  archive-only RPC is required.
- **Long-tail chains**: Newer L2s lack Subsquid coverage.

For everything else, `chainq pull` is the cheaper, easier path.
