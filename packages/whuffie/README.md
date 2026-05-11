# @chainq/whuffie

Sybil-resistant reputation as a queryable data product.

This is the implementation half of an active research line — see
[`RESEARCH.md`](RESEARCH.md) for the theoretical underpinning and citations.
Nothing else in the open-source onchain analytics ecosystem ships
reputation tables of this shape, which is the point.

## What's in here (v0.0.x)

- TypeScript types and a reference `compositeScore()` implementation.
- A research note describing the Sybil-proofness model and the constructive
  Hybrid Mechanism (Theorem 2 of the companion paper).

## What's in v0.1.0

- dbt models that materialize four tables from raw EVM data:
  `whuffie.attestations`, `whuffie.hostage_bonds`, `whuffie.proofs`,
  `whuffie.reputations`.
- A semantic-layer metric `whuffie_score` queryable from any MCP-aware agent.

## Status

The theory is being written (target: AAMAS 2027 / FC 2027). Numbers from
the empirical phase (2027/Q1) will land here as fixtures.
