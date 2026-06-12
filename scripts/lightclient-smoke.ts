#!/usr/bin/env tsx
/**
 * Offline smoke test for `@chainq/light-client` — the multi-RPC quorum light
 * client. No network is touched: `fetch` is mocked so each "endpoint" returns
 * a canned `eth_getBlockByNumber` result (or an error) per block number.
 *
 * Asserts:
 *  - AGREEMENT: 3 endpoints return identical hashes → verified=true, "3/3",
 *    no unverified blocks, a stable 0x… rowsHash.
 *  - DISAGREEMENT: a split below quorum → that block is unverified, verified=false.
 *  - CLEAR MAJORITY: 2/3 agree with quorum=2 → verified=true.
 *  - getBlockHash throws a clear "no quorum" error when quorum not met.
 *  - canonicalRowsHash: key order does not matter; different rows differ.
 *  - createLightClient (no rpcUrls) throws a clear configure message.
 */

import assert from "node:assert/strict";
import {
  createQuorumLightClient,
  createLightClient,
  verifyRows,
  canonicalRowsHash,
  hashRows,
} from "../packages/light-client/src/index.ts";

/**
 * Build a mock fetch where `hashesByUrl[url]` maps a block number to the hash
 * that endpoint returns. A value of `null` (or a missing entry) simulates an
 * endpoint error / missing block (returns a JSON-RPC error).
 */
function makeMockFetch(
  hashesByUrl: Record<string, Record<number, string | null>>,
): typeof globalThis.fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
      method?: string;
      params?: unknown[];
    };
    assert.equal(body.method, "eth_getBlockByNumber", "mock only handles eth_getBlockByNumber");
    const hexBlock = String((body.params ?? [])[0] ?? "0x0");
    const blockNumber = Number.parseInt(hexBlock, 16);
    const perBlock = hashesByUrl[url] ?? {};
    const hash = perBlock[blockNumber];
    if (hash == null) {
      // Simulate an endpoint that errors / has no block.
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "not found" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { number: hexBlock, hash } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

const URLS = ["https://rpc-a.test", "https://rpc-b.test", "https://rpc-c.test"];
const HASH_100 = "0x" + "a".repeat(64);
const HASH_200 = "0x" + "b".repeat(64);
const HASH_200_FORK = "0x" + "c".repeat(64);

async function main() {
  const rows = [
    { block_number: 100, tx_hash: "0x1", value: 10 },
    { block_number: 150, tx_hash: "0x2", value: 20 },
    { block_number: 200, tx_hash: "0x3", value: 30 },
  ];

  // -------------------------------------------------------------------------
  // AGREEMENT: all 3 endpoints agree on both boundary blocks (100 and 200).
  // -------------------------------------------------------------------------
  {
    const fetch = makeMockFetch({
      [URLS[0]!]: { 100: HASH_100, 200: HASH_200 },
      [URLS[1]!]: { 100: HASH_100, 200: HASH_200 },
      [URLS[2]!]: { 100: HASH_100, 200: HASH_200 },
    });
    const client = createQuorumLightClient({ chain: "ethereum", rpcUrls: URLS, fetch });
    assert.equal(client.chain, "ethereum", "client exposes chain");
    assert.equal(client.checkpoint, "quorum:3-endpoints", "default checkpoint label");

    const receipt = await verifyRows(rows, client);
    assert.equal(receipt.verified, true, "agreement → verified");
    assert.equal(receipt.chain, "ethereum", "chain taken from client");
    assert.deepEqual(receipt.blockRange, { from: 100, to: 200 }, "boundary range");
    assert.deepEqual(receipt.unverifiedBlocks, [], "no unverified blocks");
    assert.equal(receipt.agreements[100], "3/3", "block 100 agreement 3/3");
    assert.equal(receipt.agreements[200], "3/3", "block 200 agreement 3/3");
    assert.equal(receipt.blockHashes[100], HASH_100, "block 100 hash recorded");
    assert.equal(receipt.blockHashes[200], HASH_200, "block 200 hash recorded");
    assert.match(receipt.rowsHash, /^0x[0-9a-f]{64}$/, "rowsHash is 0x + sha256 hex");
    assert.equal(receipt.checkpointTrust, "quorum:3-endpoints", "checkpointTrust propagated");

    // rowsHash is stable across runs for the same rows.
    const again = await verifyRows(rows, client);
    assert.equal(again.rowsHash, receipt.rowsHash, "rowsHash is deterministic");

    // The lower-level tally.
    const q = await client.getBlockHashQuorum(100);
    assert.deepEqual(
      { hash: q.hash, agree: q.agree, total: q.total },
      { hash: HASH_100, agree: 3, total: 3 },
      "getBlockHashQuorum tally for agreement",
    );
    console.log("[lightclient-smoke] agreement ok");
  }

  // -------------------------------------------------------------------------
  // DISAGREEMENT: block 200 splits 1/1/1 (no winner reaches majority of 2).
  // Default quorum = floor(3/2)+1 = 2.
  // -------------------------------------------------------------------------
  {
    const fetch = makeMockFetch({
      [URLS[0]!]: { 100: HASH_100, 200: HASH_200 },
      [URLS[1]!]: { 100: HASH_100, 200: HASH_200_FORK },
      [URLS[2]!]: { 100: HASH_100, 200: null }, // endpoint errors on 200
    });
    const client = createQuorumLightClient({ chain: "ethereum", rpcUrls: URLS, fetch });
    const receipt = await verifyRows(rows, client);
    assert.equal(receipt.verified, false, "disagreement → not verified");
    assert.deepEqual(receipt.unverifiedBlocks, [200], "block 200 is unverified");
    assert.equal(receipt.agreements[100], "3/3", "block 100 still agrees");
    assert.equal(receipt.agreements[200], "1/3", "block 200 winner got only 1/3");
    assert.equal(receipt.blockHashes[100], HASH_100, "verified block 100 still recorded");
    assert.equal(receipt.blockHashes[200], undefined, "unverified block 200 has no hash");

    // getBlockHash throws a clear "no quorum" error.
    await assert.rejects(
      () => client.getBlockHash(200),
      /no quorum for block 200: 1\/3 agreed/,
      "getBlockHash throws clear no-quorum error",
    );
    console.log("[lightclient-smoke] disagreement ok");
  }

  // -------------------------------------------------------------------------
  // CLEAR MAJORITY: 2/3 agree on block 200, quorum=2 → verified.
  // -------------------------------------------------------------------------
  {
    const fetch = makeMockFetch({
      [URLS[0]!]: { 100: HASH_100, 200: HASH_200 },
      [URLS[1]!]: { 100: HASH_100, 200: HASH_200 },
      [URLS[2]!]: { 100: HASH_100, 200: HASH_200_FORK }, // dissenter
    });
    const client = createQuorumLightClient({ chain: "ethereum", rpcUrls: URLS, quorum: 2, fetch });
    const receipt = await verifyRows(rows, client);
    assert.equal(receipt.verified, true, "2/3 with quorum=2 → verified");
    assert.deepEqual(receipt.unverifiedBlocks, [], "no unverified blocks");
    assert.equal(receipt.agreements[200], "2/3", "block 200 agreement 2/3");
    assert.equal(receipt.blockHashes[200], HASH_200, "majority hash wins");

    const q = await client.getBlockHashQuorum(200);
    assert.equal(q.hash, HASH_200, "majority hash is the winner");
    assert.equal(q.agree, 2, "two endpoints agree");
    assert.equal(q.total, 3, "three endpoints queried");
    assert.equal(q.responses.filter((r) => r === HASH_200).length, 2, "two responses for winner");
    console.log("[lightclient-smoke] clear-majority ok");
  }

  // -------------------------------------------------------------------------
  // canonicalRowsHash: key order does not matter; different rows differ.
  // -------------------------------------------------------------------------
  {
    const a = [{ block_number: 1, address: "0xabc", value: 5 }];
    const b = [{ value: 5, address: "0xabc", block_number: 1 }]; // different key order
    const c = [{ block_number: 1, address: "0xabc", value: 6 }]; // different value
    assert.equal(canonicalRowsHash(a), canonicalRowsHash(b), "key order does not change hash");
    assert.notEqual(canonicalRowsHash(a), canonicalRowsHash(c), "different data → different hash");
    assert.equal(hashRows(a), canonicalRowsHash(a), "hashRows is an alias for canonicalRowsHash");
    assert.match(canonicalRowsHash(a), /^0x[0-9a-f]{64}$/, "canonical hash is 0x + sha256 hex");

    // Nested objects + arrays are canonicalised recursively.
    const nestedA = [{ meta: { z: 1, a: 2 }, tags: ["x", "y"] }];
    const nestedB = [{ tags: ["x", "y"], meta: { a: 2, z: 1 } }];
    assert.equal(canonicalRowsHash(nestedA), canonicalRowsHash(nestedB), "nested key order stable");
    console.log("[lightclient-smoke] canonical-hash ok");
  }

  // -------------------------------------------------------------------------
  // createLightClient (no rpcUrls) throws a clear, actionable error.
  // -------------------------------------------------------------------------
  {
    const plain = createLightClient({ checkpoint: "0xdeadbeef" });
    assert.equal(plain.checkpoint, "0xdeadbeef", "plain client keeps its checkpoint");
    await assert.rejects(
      () => plain.getBlockHash(1),
      /configure rpcUrls \/ use createQuorumLightClient/,
      "plain getBlockHash points the caller at the quorum client",
    );

    // verifyRows on a plain client → unverified (no quorum surface).
    const receipt = await verifyRows(rows, plain);
    assert.equal(receipt.verified, false, "plain client cannot verify");
    assert.equal(receipt.unverifiedBlocks.length, 2, "both boundary blocks unverified");
    assert.match(receipt.rowsHash, /^0x[0-9a-f]{64}$/, "rowsHash still computed");
    console.log("[lightclient-smoke] plain-client ok");
  }

  // -------------------------------------------------------------------------
  // Edge: empty rows → from/to 0, not verified, hash still computed.
  // -------------------------------------------------------------------------
  {
    const fetch = makeMockFetch({});
    const client = createQuorumLightClient({ chain: "base", rpcUrls: URLS, fetch });
    const receipt = await verifyRows([], client);
    assert.deepEqual(receipt.blockRange, { from: 0, to: 0 }, "empty rows → zero range");
    assert.equal(receipt.verified, false, "no blocks → not verified");
    assert.equal(receipt.chain, "base", "chain from client even when empty");
    console.log("[lightclient-smoke] empty-rows ok");
  }

  console.log("[lightclient-smoke] ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
