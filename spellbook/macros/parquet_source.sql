{# Read a Parquet file relative to the configured data directory. #}
{% macro parquet_source(name) -%}
  read_parquet('{{ env_var("CHAINQ_DATA_DIR", "../data") }}/{{ name }}.parquet')
{%- endmacro %}

{# Read every Parquet file matching a glob under the data dir, unioned by
   name so chains pulled at different times (with the same schema) merge
   cleanly. Used by the chain-agnostic `evm_raw_logs` source. #}
{% macro parquet_glob(pattern) -%}
  read_parquet('{{ env_var("CHAINQ_DATA_DIR", "../data") }}/{{ pattern }}', union_by_name = true)
{%- endmacro %}
