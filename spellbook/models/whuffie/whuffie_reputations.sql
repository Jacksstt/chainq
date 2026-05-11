{{ config(materialized = 'view') }}

-- Composite Whuffie score (Theorem 2 of the companion paper).
--
-- score = clamp(α · trust_centrality + (1-α) · s · log10(1 + hostage_usd) / 6)
-- gated by pop_distinct_providers >= 1.
--
-- v0.0.x: empty placeholder until raw inputs are populated.
WITH base AS (
  SELECT
    CAST(NULL AS DATE)    AS day,
    CAST(NULL AS VARCHAR) AS subject,
    CAST(NULL AS DOUBLE)  AS trust_centrality,
    CAST(NULL AS DOUBLE)  AS hostage_usd,
    CAST(NULL AS INTEGER) AS pop_distinct_providers,
    CAST(NULL AS DOUBLE)  AS sybil_resistance_budget_usd
  WHERE FALSE
)
SELECT
  day,
  subject,
  CASE
    WHEN pop_distinct_providers IS NULL OR pop_distinct_providers < 1 THEN 0.0
    ELSE LEAST(1.0, GREATEST(0.0,
      0.65 * trust_centrality
      + 0.35 * 0.70 * (LOG10(1 + GREATEST(0, hostage_usd)) / 6.0)
    ))
  END AS score,
  trust_centrality,
  hostage_usd,
  pop_distinct_providers,
  sybil_resistance_budget_usd
FROM base
