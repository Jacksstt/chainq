{{ config(materialized = 'view') }}

SELECT
  CAST(NULL AS TIMESTAMP) AS block_time,
  CAST(NULL AS VARCHAR)   AS chain,
  CAST(NULL AS VARCHAR)   AS subject,
  CAST(NULL AS VARCHAR)   AS provider,
  CAST(NULL AS VARCHAR)   AS proof_uri
WHERE FALSE
