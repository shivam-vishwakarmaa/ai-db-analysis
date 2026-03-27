"""
Module 2: Schema Extractor
===========================
Takes the Standard Schema JSON produced by Module 1 and generates:
  • Formatted per-table schema reports
  • Anomaly detection (missing PKs, empty tables, ambiguous names, orphan _id cols)
  • FK relationship map
  • Exportable Markdown report

Public API
----------
  analyse_schema(schema_json)  → enriched schema dict with anomalies + table roles
  detect_anomalies(schema_json)→ list[AnomalyDict]
  classify_table_role(table)   → 'fact' | 'dimension' | 'junction' | 'isolated'
  export_markdown_report(...)  → writes schema_report.md
  print_schema_report(schema)  → pretty-prints to stdout
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

# ───────────────────────────────────────────────────────────
# Table role classification
# ───────────────────────────────────────────────────────────

_AMBIGUOUS_COLUMN_NAMES = {
    "id", "data", "value", "info", "name", "type", "status",
    "code", "key", "flag", "desc", "text", "note", "temp",
}


def classify_table_role(table: dict) -> str:
    """
    Heuristic classification:
      • **fact**      — has ≥ 2 outgoing FKs (references other tables)
      • **junction**  — has exactly 2 FKs and few non-FK columns
      • **dimension** — referenced by FKs but has ≤ 1 outgoing FK
      • **isolated**  — no FK relationships at all
    """
    outgoing_fks = len(table.get("foreign_keys", []))
    col_count = len(table.get("columns", []))

    if outgoing_fks == 0:
        return "isolated"
    if outgoing_fks == 2 and col_count <= outgoing_fks + 2:
        return "junction"
    if outgoing_fks >= 2:
        return "fact"
    return "dimension"


def _is_referenced_by_others(table_name: str, all_tables: list[dict]) -> bool:
    """Check if any other table has a FK pointing to *table_name*."""
    for t in all_tables:
        if t["name"] == table_name:
            continue
        for fk in t.get("foreign_keys", []):
            if fk["references_table"] == table_name:
                return True
    return False


def classify_all_roles(schema: dict) -> dict[str, str]:
    """Return ``{table_name: role}`` for every table in the schema."""
    tables = schema.get("tables", [])
    roles: dict[str, str] = {}

    for tbl in tables:
        role = classify_table_role(tbl)
        # Upgrade isolated → dimension if referenced by other tables
        if role == "isolated" and _is_referenced_by_others(tbl["name"], tables):
            role = "dimension"
        roles[tbl["name"]] = role

    return roles


# ───────────────────────────────────────────────────────────
# Anomaly detection
# ───────────────────────────────────────────────────────────

def detect_anomalies(schema: dict) -> list[dict]:
    """
    Scan every table for common data-model anomalies.

    Returns a list of dicts:
        { table, column (optional), severity, message, code }
    """
    anomalies: list[dict] = []
    tables = schema.get("tables", [])

    # Collect all FK-declared columns per table for orphan-FK check
    fk_columns: dict[str, set[str]] = {}
    for tbl in tables:
        fk_columns[tbl["name"]] = {
            fk["column"] for fk in tbl.get("foreign_keys", [])
        }

    for tbl in tables:
        name = tbl["name"]

        # 1. Empty table
        if tbl.get("row_count", 0) == 0:
            anomalies.append({
                "table": name,
                "column": None,
                "severity": "warning",
                "message": f"Table '{name}' has 0 rows",
                "code": "EMPTY_TABLE",
            })

        # 2. No primary key
        if not tbl.get("primary_keys"):
            anomalies.append({
                "table": name,
                "column": None,
                "severity": "error",
                "message": f"Table '{name}' has no primary key defined",
                "code": "NO_PRIMARY_KEY",
            })

        col_names_seen: set[str] = set()
        for col in tbl.get("columns", []):
            cname = col["name"]

            # 3. Ambiguous column name
            if cname.lower() in _AMBIGUOUS_COLUMN_NAMES:
                anomalies.append({
                    "table": name,
                    "column": cname,
                    "severity": "info",
                    "message": f"Column '{cname}' in '{name}' has an ambiguous name",
                    "code": "AMBIGUOUS_NAME",
                })

            # 4. Duplicate column name (shouldn't happen, but safety net)
            if cname.lower() in col_names_seen:
                anomalies.append({
                    "table": name,
                    "column": cname,
                    "severity": "error",
                    "message": f"Duplicate column '{cname}' in '{name}'",
                    "code": "DUPLICATE_COLUMN",
                })
            col_names_seen.add(cname.lower())

            # 5. Orphan _id column — ends with _id but has no FK declared
            if (
                cname.endswith("_id")
                and cname not in fk_columns.get(name, set())
                and not col.get("primary_key")
            ):
                anomalies.append({
                    "table": name,
                    "column": cname,
                    "severity": "warning",
                    "message": (
                        f"Column '{cname}' in '{name}' looks like a FK "
                        f"but has no FK constraint"
                    ),
                    "code": "ORPHAN_FK_COLUMN",
                })

        # 6. Check sample_data for all-null columns
        sample = tbl.get("sample_data", [])
        if sample:
            for col in tbl.get("columns", []):
                cname = col["name"]
                if all(row.get(cname) is None for row in sample):
                    anomalies.append({
                        "table": name,
                        "column": cname,
                        "severity": "warning",
                        "message": f"Column '{cname}' in '{name}' appears entirely NULL (in sample)",
                        "code": "ALL_NULL_COLUMN",
                    })

    return anomalies


# ───────────────────────────────────────────────────────────
# Enrichment — add roles + anomalies into the schema dict
# ───────────────────────────────────────────────────────────

def analyse_schema(schema: dict) -> dict:
    """
    Enrich the Standard Schema JSON from Module 1 with:
      • ``table_roles`` mapping
      • ``anomalies`` list
      • ``schema_stats`` summary
    Returns a *new* dict (does not mutate the original).
    """
    enriched = json.loads(json.dumps(schema, default=str))  # deep copy

    roles = classify_all_roles(enriched)
    anomalies = detect_anomalies(enriched)

    # Attach role to each table
    for tbl in enriched["tables"]:
        tbl["role"] = roles.get(tbl["name"], "isolated")

    # Aggregate stats
    total_pks = sum(len(t.get("primary_keys", [])) for t in enriched["tables"])
    total_fks = sum(len(t.get("foreign_keys", [])) for t in enriched["tables"])
    total_inferred = sum(
        1 for t in enriched["tables"]
        for fk in t.get("foreign_keys", [])
        if fk.get("inferred")
    )
    tables_with_anomalies = len({a["table"] for a in anomalies})

    enriched["table_roles"] = roles
    enriched["anomalies"] = anomalies
    enriched["schema_stats"] = {
        "total_pks": total_pks,
        "total_fks": total_fks,
        "total_inferred_fks": total_inferred,
        "total_anomalies": len(anomalies),
        "tables_with_anomalies": tables_with_anomalies,
    }

    return enriched


# ───────────────────────────────────────────────────────────
# Pretty-print report
# ───────────────────────────────────────────────────────────

def print_schema_report(schema: dict) -> None:
    """Print a rich schema report to stdout."""
    from tabulate import tabulate as _tab

    enriched = analyse_schema(schema) if "schema_stats" not in schema else schema
    meta = enriched["metadata"]
    stats = enriched["schema_stats"]

    print(f"\n{'═' * 60}")
    print("  SCHEMA REPORT")
    print(f"{'═' * 60}")
    print(f"  Database  : {meta['database_name']}")
    print(f"  Input     : {meta['input_type']}")
    print(f"  Tables    : {meta['total_tables']}")
    print(f"  Columns   : {meta['total_columns']}")
    print(f"  Rows      : {meta['total_rows']:,}")
    print(f"  FK Source : {meta['fk_source']}")
    print(f"  PKs       : {stats['total_pks']}")
    print(f"  FKs       : {stats['total_fks']} ({stats['total_inferred_fks']} inferred)")
    print(f"  Anomalies : {stats['total_anomalies']} in {stats['tables_with_anomalies']} table(s)")
    print(f"{'═' * 60}")

    for tbl in enriched["tables"]:
        role = tbl.get("role", "unknown")
        print(f"\n┌─── {tbl['name']}  [{role.upper()}]  ({tbl['row_count']:,} rows) ───")

        # Column table
        col_rows = []
        for c in tbl["columns"]:
            pk_flag = "🔑" if c["primary_key"] else ""
            fk_ref = ""
            for fk in tbl["foreign_keys"]:
                if fk["column"] == c["name"]:
                    tag = "inferred" if fk.get("inferred") else "explicit"
                    fk_ref = f"→ {fk['references_table']}.{fk['references_column']} [{tag}]"
                    break
            null_flag = "✓" if c["nullable"] else "✗"
            uniq_flag = "✓" if c.get("unique") else ""
            col_rows.append([
                c["name"], c["type"], null_flag, pk_flag, fk_ref, uniq_flag,
            ])

        print(_tab(
            col_rows,
            headers=["Column", "Type", "Null?", "PK", "FK Reference", "Uniq"],
            tablefmt="simple_grid",
        ))

        # Indexes
        indexes = tbl.get("indexes", [])
        if indexes:
            print(f"  Indexes: {', '.join(indexes)}")

    # Anomalies
    anomalies = enriched.get("anomalies", [])
    if anomalies:
        print(f"\n{'═' * 60}")
        print("  ANOMALIES DETECTED")
        print(f"{'═' * 60}")
        for a in anomalies:
            icon = {"error": "🔴", "warning": "🟡", "info": "🔵"}.get(a["severity"], "⚪")
            print(f"  {icon} [{a['code']}] {a['message']}")

    # FK map
    rels = enriched.get("relationships", [])
    if rels:
        print(f"\n{'═' * 60}")
        print("  FOREIGN KEY MAP")
        print(f"{'═' * 60}")
        for r in rels:
            tag = " [inferred]" if r.get("inferred") else ""
            print(f"  {r['from_table']}.{r['from_column']} → "
                  f"{r['to_table']}.{r['to_column']}{tag}")


# ───────────────────────────────────────────────────────────
# Markdown export
# ───────────────────────────────────────────────────────────

def export_markdown_report(
    schema: dict,
    output_path: str = "outputs/schema_report.md",
) -> str:
    """Write a Markdown-formatted schema report and return the path."""
    enriched = analyse_schema(schema) if "schema_stats" not in schema else schema
    meta = enriched["metadata"]
    stats = enriched["schema_stats"]
    lines: list[str] = []

    lines.append(f"# Schema Report — {meta['database_name']}\n")
    lines.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    lines.append("## Overview\n")
    lines.append(f"| Metric | Value |")
    lines.append(f"|--------|-------|")
    lines.append(f"| Input type | {meta['input_type']} |")
    lines.append(f"| Tables | {meta['total_tables']} |")
    lines.append(f"| Columns | {meta['total_columns']} |")
    lines.append(f"| Total rows | {meta['total_rows']:,} |")
    lines.append(f"| FK source | {meta['fk_source']} |")
    lines.append(f"| Anomalies | {stats['total_anomalies']} |")
    lines.append("")

    # Per-table sections
    lines.append("## Tables\n")
    for tbl in enriched["tables"]:
        role = tbl.get("role", "unknown")
        lines.append(f"### {tbl['name']}  `{role.upper()}`  — {tbl['row_count']:,} rows\n")
        lines.append("| Column | Type | Nullable | PK | FK | Unique |")
        lines.append("|--------|------|----------|----|----|--------|")
        for c in tbl["columns"]:
            pk = "🔑" if c["primary_key"] else ""
            fk_ref = ""
            for fk in tbl["foreign_keys"]:
                if fk["column"] == c["name"]:
                    tag = "inferred" if fk.get("inferred") else "explicit"
                    fk_ref = f"→ {fk['references_table']}.{fk['references_column']} ({tag})"
                    break
            null = "Yes" if c["nullable"] else "No"
            uniq = "Yes" if c.get("unique") else ""
            lines.append(f"| {c['name']} | {c['type']} | {null} | {pk} | {fk_ref} | {uniq} |")
        lines.append("")

    # Anomalies
    anomalies = enriched.get("anomalies", [])
    if anomalies:
        lines.append("## Anomalies\n")
        for a in anomalies:
            severity_icon = {"error": "🔴", "warning": "🟡", "info": "🔵"}.get(a["severity"], "⚪")
            lines.append(f"- {severity_icon} **{a['code']}** — {a['message']}")
        lines.append("")

    # Relationships
    rels = enriched.get("relationships", [])
    if rels:
        lines.append("## Relationships\n")
        for r in rels:
            tag = " *(inferred)*" if r.get("inferred") else ""
            lines.append(
                f"- `{r['from_table']}.{r['from_column']}` → "
                f"`{r['to_table']}.{r['to_column']}`{tag}"
            )
        lines.append("")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    report_text = "\n".join(lines)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(report_text)

    print(f"  ✓ Schema report saved → {output_path}")
    return os.path.abspath(output_path)


# ───────────────────────────────────────────────────────────
# CLI entry point
# ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Module 2 — Schema Extractor")
    parser.add_argument(
        "--input", default="outputs/schema_report.json",
        help="Path to Standard Schema JSON from Module 1",
    )
    parser.add_argument(
        "--output", default="outputs/schema_report.md",
        help="Output path for Markdown report",
    )
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        schema = json.load(f)

    enriched = analyse_schema(schema)
    print_schema_report(enriched)
    export_markdown_report(enriched, args.output)
