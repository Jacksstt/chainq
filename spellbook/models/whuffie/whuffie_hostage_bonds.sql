{{ config(materialized = 'view') }}

SELECT
  CAST(NULL AS TIMESTAMP) AS block_time,
  CAST(NULL AS VARCHAR)   AS chain,
  CAST(NULL AS VARCHAR)   AS subject,
  CAST(NULL AS VARCHAR)   AS collateral_token,
  CAST(NULL AS DOUBLE)    AS collateral_amount_usd,
  CAST(NULL AS TIMESTAMP) AS expiry_time
WHERE FALSE
