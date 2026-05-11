{{ config(materialized = 'view') }}

-- NFT sales normalised across OpenSea / Blur / LooksRare / X2Y2 / Magic Eden.

SELECT
  block_time,
  block_number,
  chain,
  marketplace,
  collection_address,
  token_id,
  seller,
  buyer,
  currency,
  price,
  price_usd
FROM {{ parquet_source('nft.trades') }}
