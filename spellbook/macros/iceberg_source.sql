{# Scan an Apache Iceberg table (READ path) via DuckDB's `iceberg` extension.
   `path` is an Iceberg table location (local dir, S3 URI, or a metadata
   `.json`). The extension must be loaded first — see `load_iceberg` below. #}
{% macro iceberg_source(path) -%}
  iceberg_scan('{{ path }}')
{%- endmacro %}

{# Install + load the DuckDB `iceberg` extension. Emitted as a snippet you can
   wire into an on-run-start hook or invoke directly, e.g.
     dbt run-operation load_iceberg
   The first INSTALL needs network access; LOAD is offline once cached. #}
{% macro load_iceberg() -%}
  INSTALL iceberg; LOAD iceberg;
{%- endmacro %}
