# Research notes — The Whuffie Problem

This package is the implementation half of an active research line on
Sybil-resistant reputation in onchain economies. The companion theory paper
is in preparation (target venues: AAMAS 2027 / FC 2027).

## Premise

Reputation systems that rely solely on cheap identifiers (addresses, accounts,
email-style handles) are provably unable to sustain prosocial cooperation in
the presence of free Sybil creation. This was sketched in Pei (2024) and
formalized by Bahrani-Garimidi-Roughgarden (2024) in the TFM setting.

The Whuffie line (a) sharpens those impossibility results, and (b) presents
a constructive hybrid mechanism — a discounted PageRank over attestations
**restricted to PoP-verified attesters**, blended with a hostage-bond stake —
that is incentive-compatible above an explicit Sybil-resistance budget.

## Three onchain data product layers

| Table | Captures | Where it lives |
|---|---|---|
| `whuffie.attestations` | All directed attestations between addresses (EAS, BrightID, BANGS, etc.) | dbt model `whuffie_attestations.sql` (planned) |
| `whuffie.hostage_bonds` | Stake commitments where a third party can slash on misbehavior | dbt model `whuffie_hostage_bonds.sql` |
| `whuffie.proofs` | Per-address proofs of personhood by provider | dbt model `whuffie_proofs.sql` |
| `whuffie.reputations` | Daily composite score per address | dbt model `whuffie_reputations.sql` |

## Composite score (Theorem 2)

```
score(a, t) = clamp_[0,1](
    α  ·  trust_centrality(a, t)
  + (1−α) · s · log10(1 + hostage_usd(a, t)) / 6
)
```

gated by `pop_distinct_providers(a, t) ≥ 1`. See `src/index.ts:compositeScore`
for the reference implementation.

Parameters used in the v0.0.x reference:

| Symbol | Value | Source |
|---|---|---|
| α (PoP / hostage weight) | 0.65 | empirical-design grid search (§4.3) |
| s (hostage discount) | 0.70 | calibration against Base Sepolia agents (§4.4) |

## Compatibility with prior work

- **Pei (2024)** — we adopt the cheap-identity framing.
- **Bahrani-Garimidi-Roughgarden (2024)** — we mirror the Sybil-proofness
  definition (Definition 5.1) but generalize past TFMs.
- **Sugaya-Wolitzky (2023)** — repeated-game impossibility (Theorem 1) is
  adapted to the cheap-identity environment in our Theorem 1.
- **Hu-Chen (2025)** — Insured Agents addresses overlapping but distinct
  problems (claim verification vs. attestation aggregation).

Full bibliography lives in the theory paper.

## Empirical experiment plan (Phase E)

- **Environment**: Base Sepolia, ERC-8004 reference implementation.
- **Baseline**: trust centrality only (α=1).
- **Hybrid**: composite score across `(C_PoP, s) ∈ {1, 4} × {0.5, 0.9}`.
- **Metrics**: cooperation rate, Sybil-budget breakeven, false-positive PoP
  proofs.

Target window: 2027/Q1.

## License

MIT, same as the rest of chainq.
