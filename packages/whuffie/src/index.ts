/**
 * @chainq/whuffie — Sybil-resistant reputation data product.
 *
 * Implementation half of the Whuffie research line (Shibuya et al., 2027 —
 * "Reputation Without Identity: An Impossibility Result and a Constructive
 * Hybrid Mechanism"). See `RESEARCH.md` for the formal underpinnings.
 *
 * The product surfaces three onchain-derivable tables and one composite score
 * that a consuming agent can query through `chainq_query` / `chainq_metric`:
 *
 *   whuffie.attestations  — raw social attestations among addresses
 *   whuffie.hostage_bonds — stake commitments backing reputation
 *   whuffie.proofs        — proof-of-personhood proofs by provider
 *   whuffie.reputations   — composite reputation score per address (1 day rolling)
 *
 * v0.0.x ships the schema and the metric. Computation will move into dbt
 * models in v0.1.0 (see `models/`).
 */

export interface AttestationRow {
  block_time: string;
  chain: string;
  attester: string;
  subject: string;
  /** -1 (negative) | 0 (neutral) | +1 (positive). */
  polarity: -1 | 0 | 1;
  weight: number;
  source: string;
}

export interface HostageBondRow {
  block_time: string;
  chain: string;
  subject: string;
  collateral_token: string;
  collateral_amount_usd: number;
  expiry_time: string | null;
}

export interface PoPProofRow {
  block_time: string;
  chain: string;
  subject: string;
  provider: "worldcoin" | "humanode" | "civic" | "brightid" | "ens" | "other";
  proof_uri: string;
}

export interface ReputationRow {
  day: string;
  subject: string;
  /** Aggregate score in [0, 1] — see RESEARCH.md §4 for the formal definition. */
  score: number;
  /** Discounted PageRank over attestations restricted to PoP-verified attesters. */
  trust_centrality: number;
  /** USD-denominated hostage exposure that backs the score. */
  hostage_usd: number;
  /** Number of distinct PoP providers covering the subject. */
  pop_distinct_providers: number;
  /** Sybil-resistance budget at which the score is robust to attack. */
  sybil_resistance_budget_usd: number;
}

/**
 * Compute a composite Whuffie score from the constituent inputs.
 *
 * Reference: Theorem 2 (Constructive Hybrid Mechanism). The score is a weighted
 * combination of PoP-restricted trust centrality and the log of hostage-bond
 * collateralization, gated by a Sybil budget threshold.
 */
export function compositeScore(input: {
  trustCentrality: number;
  hostageUsd: number;
  popDistinctProviders: number;
  /** Constant from §3.2 — defaults to the value used in the empirical experiments. */
  alpha?: number;
  /** Hostage discount factor s ∈ [0, 1]. */
  s?: number;
}): number {
  const alpha = input.alpha ?? 0.65;
  const s = input.s ?? 0.7;
  if (input.popDistinctProviders < 1) return 0;
  const hostageTerm = Math.log10(1 + Math.max(0, input.hostageUsd));
  const raw = alpha * input.trustCentrality + (1 - alpha) * s * (hostageTerm / 6);
  return clamp01(raw);
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
