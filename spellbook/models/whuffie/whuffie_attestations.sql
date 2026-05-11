{{ config(materialized = 'view') }}

-- Placeholder for the attestation source.
-- v0.1+ this will union EAS schemas, BrightID, BANGS, Karma3 Labs, etc.
-- For v0.0.x we expose a typed empty view so dependent models compile.
SELECT
  CAST(NULL AS TIMESTAMP) AS block_time,
  CAST(NULL AS VARCHAR)   AS chain,
  CAST(NULL AS VARCHAR)   AS attester,
  CAST(NULL AS VARCHAR)   AS subject,
  CAST(NULL AS INTEGER)   AS polarity,
  CAST(NULL AS DOUBLE)    AS weight,
  CAST(NULL AS VARCHAR)   AS source
WHERE FALSE
