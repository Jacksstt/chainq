{# Read a Parquet file relative to the configured data directory. #}
{% macro parquet_source(name) -%}
  read_parquet('{{ env_var("CHAINQ_DATA_DIR", "../data") }}/{{ name }}.parquet')
{%- endmacro %}
