# @chainq/light-client

Trust-minimised verification for chainq query results.

When you pull data from a public archive (`@chainq/snapshot`) you trust the
archive. For audit trails and regulated deployments, this package adds a
verifiable second leg: a light client follows the chain's sync committee
and signs off on the block hashes underlying your query.

## Status

v0.0.x: types and stubs. Real Lodestar / Helios integration ships in
v0.2.0. See [`RESEARCH.md`](RESEARCH.md).

## API (target)

```ts
import { createLightClient, verifyRows } from "@chainq/light-client";

const lc = createLightClient({
  checkpoint: "0xabc..." // weak-subjectivity checkpoint
});

const receipt = await verifyRows(result.rows, lc);
// receipt is a portable JSON blob with canonical block hashes + rows hash.
```
