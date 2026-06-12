/**
 * A persistent, replay-proof {@link NonceStore} backed by a JSON file.
 *
 * The in-memory store in `index.ts` forgets everything on restart, which means
 * a hosted operator who reboots their endpoint would re-accept a nonce that was
 * already settled. {@link FileNonceStore} survives restarts: it loads its state
 * on construct and persists (atomically: tmp file + rename) on every mutation.
 *
 * It tracks three things:
 *   - `seen`  : nonce → expiry (ms). Issued by `remember`, pruned when expired.
 *   - `used`  : nonces already consumed. A consumed nonce can never settle again.
 *   - `usedTx`: settled tx hashes. Closes the gap that an ERC-20 transfer has
 *               no memo to bind the nonce — one real payment settles exactly
 *               once via {@link FileNonceStore.consumeTx}.
 */

import type { NonceStore } from "./index.js";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";

interface PersistShape {
  seen: Record<string, number>;
  used: string[];
  usedTx: string[];
}

export class FileNonceStore implements NonceStore {
  private readonly filePath: string;
  private readonly seen = new Map<string, number>();
  private readonly used = new Set<string>();
  private readonly usedTx = new Set<string>();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  /** Load existing state (if any) and drop expired `seen` entries. */
  private load(): void {
    if (!existsSync(this.filePath)) return;
    let parsed: PersistShape;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      parsed = JSON.parse(raw) as PersistShape;
    } catch {
      // Corrupt / partial file — start clean rather than crash the endpoint.
      return;
    }
    const now = Date.now();
    if (parsed.seen && typeof parsed.seen === "object") {
      for (const [nonce, expiry] of Object.entries(parsed.seen)) {
        if (typeof expiry === "number" && expiry > now) this.seen.set(nonce, expiry);
      }
    }
    if (Array.isArray(parsed.used)) {
      for (const n of parsed.used) if (typeof n === "string") this.used.add(n);
    }
    if (Array.isArray(parsed.usedTx)) {
      for (const tx of parsed.usedTx) if (typeof tx === "string") this.usedTx.add(tx.toLowerCase());
    }
  }

  /** Atomic persist: write a tmp file then rename over the target. */
  private persist(): void {
    const shape: PersistShape = {
      seen: Object.fromEntries(this.seen),
      used: [...this.used],
      usedTx: [...this.usedTx],
    };
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(shape), "utf8");
    renameSync(tmp, this.filePath);
  }

  remember(nonce: string, expiresAt: number): void {
    this.seen.set(nonce, expiresAt);
    this.persist();
  }

  /**
   * Mark a nonce consumed. Returns false if it is unknown, already used, or
   * expired; otherwise records it and persists.
   */
  consume(nonce: string): boolean {
    if (this.used.has(nonce)) return false;
    const expiry = this.seen.get(nonce);
    if (expiry === undefined) return false; // never issued here
    if (expiry <= Date.now()) {
      // Expired — clean it up and reject.
      this.seen.delete(nonce);
      this.persist();
      return false;
    }
    this.used.add(nonce);
    this.persist();
    return true;
  }

  /**
   * Dedupe by settlement transaction. Returns false if this tx hash already
   * settled a call (one payment = one settlement), true (and persists) the
   * first time it is seen. Complements nonce replay-protection: even if two
   * nonces reference the same on-chain transfer, only the first settles.
   */
  consumeTx(txHash: string): boolean {
    const key = txHash.toLowerCase();
    if (this.usedTx.has(key)) return false;
    this.usedTx.add(key);
    this.persist();
    return true;
  }
}
