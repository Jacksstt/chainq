{{ config(materialized = 'view') }}

-- Raw Base logs joined against a hand-curated topic0 dictionary so each
-- row carries a human-readable `event_name` (or NULL if the signature is
-- not in the dictionary). The dictionary covers ~20 of the most common
-- event signatures across EVM chains — extending it is a one-line
-- addition. A production deployment would back this with a labels-style
-- table populated from 4byte.directory.

WITH known_signatures AS (
  SELECT * FROM (VALUES
    -- ERC-20
    ('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', 'Transfer',        'Transfer(address,address,uint256)',           'erc20'),
    ('0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925', 'Approval',        'Approval(address,address,uint256)',           'erc20'),
    -- WETH / Wrapped tokens
    ('0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c', 'WethDeposit',     'Deposit(address,uint256)',                    'weth'),
    ('0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65', 'WethWithdrawal',  'Withdrawal(address,uint256)',                 'weth'),
    -- DEX swaps
    ('0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822', 'UniV2_Swap',      'Swap(address,uint256,uint256,uint256,uint256,address)', 'dex'),
    ('0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67', 'UniV3_Swap',      'Swap(address,address,int256,int256,uint160,uint128,int24)', 'dex'),
    ('0xb2e76ae99761dc136e598d4a629bb347eccb9532a5f8bbd72e18467c3c34cc98', 'Curve_TokenExchange', 'TokenExchange(address,int128,uint256,int128,uint256)', 'dex'),
    -- DEX pool lifecycle
    ('0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f', 'UniV2_Mint',      'Mint(address,uint256,uint256)',               'dex'),
    ('0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496', 'UniV2_Burn',      'Burn(address,uint256,uint256,address)',       'dex'),
    -- Lending
    ('0xe54ae8c8ef13a09e6395e6f6e3d875ad8e6e9e2a59e3a8b9ea0ed3c6464fc23a', 'Aave_Borrow',     'Borrow(address,address,address,uint256,uint8,uint256,uint16)', 'lending'),
    ('0x4cdde6e09bb755c9a5589ebaec640bbfedff1362d4b255ebf8339782b9942faa', 'Aave_Repay',      'Repay(address,address,address,uint256,bool)', 'lending'),
    ('0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286', 'Aave_Liquidation','LiquidationCall(address,address,address,uint256,uint256,address,bool)', 'lending'),
    -- Bridge (Across canonical)
    ('0xa123dc29aebf7d0c3322c8eeb5b999e859f39937950ed31056532713d0de396f', 'Across_FundsDeposited', 'FundsDeposited(uint256,uint256,uint256,uint64,uint32,uint32,address,address,address,bytes)', 'bridge'),
    -- L2 system events (Base / OP)
    ('0x71beda60bbc5bd2af728a82ef676d57e6e2f0d68c5b08bc1bd64ed4f5f1f7a3e', 'L2StandardBridge_DepositFinalized', 'DepositFinalized(...)', 'l2system')
    -- NOTE: ERC-721 `Approval(address,address,uint256)` has the *same* keccak
    -- topic0 as ERC-20 Approval (identical signature string), so the two are
    -- indistinguishable by topic0 alone. A separate `ERC721_Approval` row was
    -- removed because each dictionary entry sharing a topic0 LEFT JOINs every
    -- matching log a second time, fanning one log out to two rows and breaking
    -- the one-row-per-log invariant of this model. Keep topic0 unique here.
  ) AS sigs(topic0, event_name, signature, domain)
)
SELECT
  l.block_number,
  l.block_time,
  l.chain,
  l.tx_hash,
  l.log_index,
  l.address,
  l.topic0,
  l.topic1,
  l.topic2,
  l.topic3,
  l.data,
  s.event_name,
  s.signature,
  s.domain
FROM {{ ref('base_raw_logs') }} AS l
LEFT JOIN known_signatures AS s ON s.topic0 = l.topic0
