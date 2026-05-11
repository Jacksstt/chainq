import { DuckDBInstance } from '@duckdb/node-api';
const i = await DuckDBInstance.create('./data/chainq-dbt.duckdb');
const c = await i.connect();
const r = await c.runAndReadAll(`SELECT chain, day::VARCHAR AS day, transfer_count FROM erc20_transfer_daily ORDER BY chain, day LIMIT 6`);
console.log(JSON.stringify(r.getRowObjects(), (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
c.disconnectSync();
