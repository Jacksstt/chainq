{{ config(materialized = 'view') }}

SELECT
  deal_id,
  client,
  provider,
  piece_size_bytes,
  start_epoch,
  end_epoch,
  verified_deal,
  -- Convert epoch (30 s slots) to UTC timestamp.
  TIMESTAMP '2020-08-24 22:00:00' + (start_epoch * INTERVAL '30 seconds') AS start_time,
  TIMESTAMP '2020-08-24 22:00:00' + (end_epoch   * INTERVAL '30 seconds') AS end_time
FROM {{ parquet_source('filecoin.deals') }}
