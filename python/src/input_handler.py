"""
Module 1: Input Handler
=======================
Entry point for the AI Database Analysis Agent pipeline.

Accepts 4 input types:
  1. CSV files    → pandas → in-memory SQLite
  2. SQLite file  → direct connection
  3. SQL dump     → dialect-fix → in-memory SQLite
  4. Live DB URL  → SQLAlchemy engine + inspector

All paths produce a Standard Schema JSON dict consumed by every
downstream module.
"""

import json
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd


# ---------------------------------------------------------------------------
# Type-detection helpers
# ---------------------------------------------------------------------------

def _detect_column_type(series: pd.Series) -> str:
    """Infer a SQL column type from a pandas Series by sampling its values."""
    sample = series.dropna()
    if sample.empty:
        return "TEXT"

    # Already numeric dtype?
    if pd.api.types.is_integer_dtype(series):
        return "INTEGER"
    if pd.api.types.is_float_dtype(series):
        return "REAL"

    # Try coercing strings to numbers
    numeric = pd.to_numeric(sample, errors="coerce")
    if numeric.notna().all():
        if (numeric == numeric.astype(int)).all():
            return "INTEGER"
        return "REAL"

    # Check for date/datetime patterns
    _DATE_PATTERNS = [
        r"\d{4}-\d{2}-\d{2}",              # 2023-01-15
        r"\d{2}/\d{2}/\d{4}",              # 01/15/2023
        r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}",  # datetime
    ]
    str_sample = sample.astype(str).head(50)
    for pat in _DATE_PATTERNS:
        if str_sample.str.match(pat).mean() > 0.8:
            return "DATETIME"

    return "TEXT"


# ---------------------------------------------------------------------------
# FK inference (for CSV inputs that lack explicit constraints)
# ---------------------------------------------------------------------------

def _infer_foreign_keys(dataframes: dict[str, pd.DataFrame]) -> list[dict]:
    """
    Heuristic FK detection:
      • Columns ending in '_id' that appear in 2 + tables
      • Column whose name matches `<other_table>_id`
    Returns a list of FK candidate dicts with ``inferred: True``.
    """
    # Map each column name → list of tables it appears in
    col_tables: dict[str, list[str]] = {}
    for tbl, df in dataframes.items():
        for col in df.columns:
            col_tables.setdefault(col, []).append(tbl)

    fk_candidates: list[dict] = []

    for col, tables in col_tables.items():
        if not col.endswith("_id") or len(tables) < 2:
            continue

        # Try to figure out which table is the "parent" for this id.
        # If a table name matches the prefix (e.g. 'customer_id' → a table
        # containing 'customer') treat it as the parent; otherwise fall back
        # to the first table alphabetically.
        prefix = col.rsplit("_id", 1)[0].lower()
        parent = None
        for t in tables:
            if prefix in t.lower():
                parent = t
                break
        if parent is None:
            parent = sorted(tables)[0]

        for child in tables:
            if child == parent:
                continue
            fk_candidates.append({
                "child_table": child,
                "child_column": col,
                "parent_table": parent,
                "parent_column": col,
                "inferred": True,
            })

    return fk_candidates


# ---------------------------------------------------------------------------
# Standard Schema extraction from a sqlite3.Connection
# ---------------------------------------------------------------------------

def _extract_schema_sqlite(
    conn: sqlite3.Connection,
    *,
    input_type: str,
    db_name: str = "database",
    inferred_fks: list[dict] | None = None,
    sample_rows: int = 5,
) -> dict:
    """
    Run PRAGMA queries against *conn* and return Standard Schema JSON.
    """
    inferred_fks = inferred_fks or []
    cur = conn.cursor()

    # Discover tables (skip internal SQLite tables)
    raw_tables = cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%'"
    ).fetchall()

    schema_tables: list[dict] = []
    total_rows = 0
    total_cols = 0

    for (table_name,) in raw_tables:
        # Column info
        cols_raw = cur.execute(f'PRAGMA table_info("{table_name}")').fetchall()
        # FK info
        fks_raw = cur.execute(f'PRAGMA foreign_key_list("{table_name}")').fetchall()
        # Index info
        idx_raw = cur.execute(f'PRAGMA index_list("{table_name}")').fetchall()
        # Row count
        row_count = cur.execute(
            f'SELECT COUNT(*) FROM "{table_name}"'
        ).fetchone()[0]
        # Sample data
        sample = cur.execute(
            f'SELECT * FROM "{table_name}" LIMIT {sample_rows}'
        ).fetchall()

        col_names = [c[1] for c in cols_raw]
        sample_data = [dict(zip(col_names, row)) for row in sample]

        columns = [
            {
                "name": c[1],
                "type": c[2] or "TEXT",
                "nullable": not bool(c[3]),
                "primary_key": bool(c[5]),
                "unique": False,
                "default_value": c[4],
            }
            for c in cols_raw
        ]

        # Mark unique columns from unique indexes
        unique_cols = set()
        for idx in idx_raw:
            if idx[2]:  # unique flag
                idx_info = cur.execute(
                    f'PRAGMA index_info("{idx[1]}")'
                ).fetchall()
                if len(idx_info) == 1:
                    unique_cols.add(idx_info[0][2])
        for col in columns:
            if col["name"] in unique_cols:
                col["unique"] = True

        # Explicit FKs from PRAGMA
        foreign_keys = [
            {
                "column": fk[3],
                "references_table": fk[2],
                "references_column": fk[4],
                "inferred": False,
            }
            for fk in fks_raw
        ]

        # Merge inferred FKs for this table
        for ifk in inferred_fks:
            if ifk["child_table"] == table_name:
                # Avoid duplicates
                exists = any(
                    f["column"] == ifk["child_column"]
                    and f["references_table"] == ifk["parent_table"]
                    for f in foreign_keys
                )
                if not exists:
                    foreign_keys.append({
                        "column": ifk["child_column"],
                        "references_table": ifk["parent_table"],
                        "references_column": ifk["parent_column"],
                        "inferred": True,
                    })

        schema_tables.append({
            "name": table_name,
            "row_count": row_count,
            "columns": columns,
            "primary_keys": [c[1] for c in cols_raw if c[5]],
            "foreign_keys": foreign_keys,
            "indexes": [i[1] for i in idx_raw],
            "sample_data": sample_data,
        })

        total_rows += row_count
        total_cols += len(columns)

    # Determine FK source label
    has_explicit = any(
        fk
        for t in schema_tables
        for fk in t["foreign_keys"]
        if not fk["inferred"]
    )
    has_inferred = any(
        fk
        for t in schema_tables
        for fk in t["foreign_keys"]
        if fk["inferred"]
    )
    if has_explicit and has_inferred:
        fk_source = "mixed"
    elif has_inferred:
        fk_source = "inferred"
    else:
        fk_source = "explicit"

    # Build relationships list from all FKs
    relationships: list[dict] = []
    for tbl in schema_tables:
        for fk in tbl["foreign_keys"]:
            relationships.append({
                "from_table": tbl["name"],
                "from_column": fk["column"],
                "to_table": fk["references_table"],
                "to_column": fk["references_column"],
                "cardinality": "one-to-many",
                "inferred": fk["inferred"],
            })

    return {
        "metadata": {
            "database_name": db_name,
            "input_type": input_type,
            "total_tables": len(schema_tables),
            "total_columns": total_cols,
            "total_rows": total_rows,
            "extraction_timestamp": datetime.now().isoformat(),
            "fk_source": fk_source,
        },
        "tables": schema_tables,
        "relationships": relationships,
    }


# ---------------------------------------------------------------------------
# Schema extraction from a live DB via SQLAlchemy
# ---------------------------------------------------------------------------

def _extract_schema_sqlalchemy(engine, inspector, *, db_name: str, sample_rows: int = 5) -> dict:
    """
    Use SQLAlchemy inspector for live Postgres / MySQL / etc.
    """
    from sqlalchemy import text as sa_text

    table_names = inspector.get_table_names()
    schema_tables: list[dict] = []
    total_rows = 0
    total_cols = 0

    with engine.connect() as conn:
        for table_name in table_names:
            raw_cols = inspector.get_columns(table_name)
            pk_info = inspector.get_pk_constraint(table_name)
            fk_list = inspector.get_foreign_keys(table_name)
            idx_list = inspector.get_indexes(table_name)
            unique_constraints = inspector.get_unique_constraints(table_name)

            pk_cols = set(pk_info.get("constrained_columns", []))
            unique_cols = set()
            for uc in unique_constraints:
                if len(uc["column_names"]) == 1:
                    unique_cols.add(uc["column_names"][0])

            row_count = conn.execute(
                sa_text(f'SELECT COUNT(*) FROM "{table_name}"')
            ).scalar()

            sample_result = conn.execute(
                sa_text(f'SELECT * FROM "{table_name}" LIMIT {sample_rows}')
            )
            col_names = list(sample_result.keys())
            sample_data = [dict(zip(col_names, row)) for row in sample_result]

            columns = [
                {
                    "name": c["name"],
                    "type": str(c["type"]),
                    "nullable": c.get("nullable", True),
                    "primary_key": c["name"] in pk_cols,
                    "unique": c["name"] in unique_cols,
                    "default_value": str(c["default"]) if c.get("default") else None,
                }
                for c in raw_cols
            ]

            foreign_keys = [
                {
                    "column": fk["constrained_columns"][0],
                    "references_table": fk["referred_table"],
                    "references_column": fk["referred_columns"][0],
                    "inferred": False,
                }
                for fk in fk_list
                if fk["constrained_columns"]
            ]

            schema_tables.append({
                "name": table_name,
                "row_count": row_count,
                "columns": columns,
                "primary_keys": list(pk_cols),
                "foreign_keys": foreign_keys,
                "indexes": [i["name"] for i in idx_list if i.get("name")],
                "sample_data": sample_data,
            })

            total_rows += row_count
            total_cols += len(columns)

    relationships = [
        {
            "from_table": tbl["name"],
            "from_column": fk["column"],
            "to_table": fk["references_table"],
            "to_column": fk["references_column"],
            "cardinality": "one-to-many",
            "inferred": False,
        }
        for tbl in schema_tables
        for fk in tbl["foreign_keys"]
    ]

    return {
        "metadata": {
            "database_name": db_name,
            "input_type": "live_url",
            "total_tables": len(schema_tables),
            "total_columns": total_cols,
            "total_rows": total_rows,
            "extraction_timestamp": datetime.now().isoformat(),
            "fk_source": "explicit",
        },
        "tables": schema_tables,
        "relationships": relationships,
    }


# ===================================================================
# PUBLIC API — four loader functions + unified entry point
# ===================================================================

def load_csvs(csv_paths: list[str], *, sample_rows: int = 5) -> tuple[dict, sqlite3.Connection]:
    """
    Load one or more CSV files into in-memory SQLite.
    Returns (schema_json, sqlite_connection).
    """
    conn = sqlite3.connect(":memory:")
    dataframes: dict[str, pd.DataFrame] = {}

    for path in csv_paths:
        table_name = Path(path).stem
        df = pd.read_csv(path)

        # Build CREATE TABLE with detected types
        col_defs = []
        for col in df.columns:
            sql_type = _detect_column_type(df[col])
            col_defs.append(f'"{col}" {sql_type}')

        create_sql = f'CREATE TABLE "{table_name}" ({", ".join(col_defs)})'
        conn.execute(create_sql)

        # Bulk insert via pandas (faster than row-by-row)
        df.to_sql(table_name, conn, if_exists="replace", index=False)
        dataframes[table_name] = df
        print(f"  ✓ Loaded CSV: {table_name} ({len(df):,} rows, {len(df.columns)} cols)")

    inferred_fks = _infer_foreign_keys(dataframes)
    if inferred_fks:
        print(f"  ✓ Inferred {len(inferred_fks)} FK relationship(s)")

    schema = _extract_schema_sqlite(
        conn,
        input_type="csv",
        db_name=Path(csv_paths[0]).parent.name if csv_paths else "csv_database",
        inferred_fks=inferred_fks,
        sample_rows=sample_rows,
    )
    return schema, conn


def load_sqlite(db_path: str, *, sample_rows: int = 5) -> tuple[dict, sqlite3.Connection]:
    """
    Open an existing SQLite file.
    Returns (schema_json, sqlite_connection).
    """
    if not os.path.isfile(db_path):
        raise FileNotFoundError(f"SQLite file not found: {db_path}")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    print(f"  ✓ Opened SQLite: {db_path}")

    schema = _extract_schema_sqlite(
        conn,
        input_type="sqlite",
        db_name=Path(db_path).stem,
        sample_rows=sample_rows,
    )
    return schema, conn


def load_sql_dump(dump_path: str, *, sample_rows: int = 5) -> tuple[dict, sqlite3.Connection]:
    """
    Read a .sql dump file, apply dialect fixes for MySQL / Postgres
    compatibility, execute into an in-memory SQLite database.
    Returns (schema_json, sqlite_connection).
    """
    if not os.path.isfile(dump_path):
        raise FileNotFoundError(f"SQL dump not found: {dump_path}")

    with open(dump_path, "r", encoding="utf-8", errors="replace") as f:
        raw_sql = f.read()

    # ── Dialect normalisation ──
    sql = raw_sql
    # MySQL → SQLite type fixes
    sql = re.sub(r"AUTO_INCREMENT", "AUTOINCREMENT", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bINT\s+UNSIGNED\b", "INTEGER", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bBIGINT\b", "INTEGER", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bTINYINT\b", "INTEGER", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bSMALLINT\b", "INTEGER", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bMEDIUMINT\b", "INTEGER", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bDOUBLE\b", "REAL", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bFLOAT\b", "REAL", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bDECIMAL\([^)]*\)", "REAL", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bENUM\([^)]*\)", "TEXT", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bSET\([^)]*\)", "TEXT", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bLONGTEXT\b", "TEXT", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bMEDIUMTEXT\b", "TEXT", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bTINYTEXT\b", "TEXT", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bVARCHAR\(\d+\)", "TEXT", sql, flags=re.IGNORECASE)

    # Remove MySQL-specific clauses
    sql = re.sub(r"\s*ENGINE\s*=\s*\w+", "", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\s*DEFAULT\s+CHARSET\s*=\s*\w+", "", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\s*COLLATE\s*=?\s*\w+", "", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\s*CHARACTER\s+SET\s+\w+", "", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\s*COMMENT\s+'[^']*'", "", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\s*ON\s+UPDATE\s+CURRENT_TIMESTAMP", "", sql, flags=re.IGNORECASE)

    # Backtick → double-quote
    sql = sql.replace("`", '"')

    # Remove statements SQLite doesn't understand
    sql = re.sub(r"(?m)^(LOCK|UNLOCK|SET|USE|/\*!).*?;\s*$", "", sql)

    conn = sqlite3.connect(":memory:")
    errors: list[str] = []
    # Execute statement-by-statement to survive partial failures
    for i, statement in enumerate(sql.split(";")):
        stmt = statement.strip()
        if not stmt:
            continue
        try:
            conn.execute(stmt)
        except Exception as exc:
            errors.append(f"Statement {i}: {str(exc)[:120]}")

    conn.commit()

    if errors:
        print(f"  ⚠ {len(errors)} statement(s) had errors (non-fatal)")
        for e in errors[:5]:
            print(f"    └ {e}")
    print(f"  ✓ SQL dump loaded into in-memory SQLite")

    schema = _extract_schema_sqlite(
        conn,
        input_type="sql_dump",
        db_name=Path(dump_path).stem,
        sample_rows=sample_rows,
    )
    return schema, conn


def load_live_db(db_url: str, *, sample_rows: int = 5) -> tuple[dict, Any]:
    """
    Connect to a live database via SQLAlchemy.
    Supports PostgreSQL, MySQL, SQLite URLs.
    Returns (schema_json, sqlalchemy_engine).
    """
    from sqlalchemy import create_engine, inspect as sa_inspect

    engine = create_engine(db_url)
    inspector = sa_inspect(engine)

    # Mask credentials in display
    safe_url = re.sub(r"://[^@]+@", "://***@", db_url)
    print(f"  ✓ Connected to: {safe_url}")

    schema = _extract_schema_sqlalchemy(
        engine,
        inspector,
        db_name=db_url.rsplit("/", 1)[-1].split("?")[0],
        sample_rows=sample_rows,
    )
    return schema, engine


# ===================================================================
# Unified entry point
# ===================================================================

def load_database(
    input_type: str,
    *,
    csv_paths: list[str] | None = None,
    sqlite_path: str | None = None,
    sql_dump_path: str | None = None,
    db_url: str | None = None,
    sample_rows: int = 5,
) -> tuple[dict, Any]:
    """
    Main router — call the correct loader based on *input_type*.

    Parameters
    ----------
    input_type : one of ``"csv"``, ``"sqlite"``, ``"sql_dump"``, ``"live_url"``
    csv_paths  : list of CSV file paths (required when input_type == "csv")
    sqlite_path: path to .db / .sqlite file
    sql_dump_path : path to .sql file
    db_url     : SQLAlchemy connection URL
    sample_rows: how many sample rows to collect per table

    Returns
    -------
    (schema_json_dict, connection_or_engine)
    """
    print(f"\n{'='*55}")
    print(f"  INPUT HANDLER — Loading [{input_type.upper()}]")
    print(f"{'='*55}")

    if input_type == "csv":
        if not csv_paths:
            raise ValueError("csv_paths required for input_type='csv'")
        return load_csvs(csv_paths, sample_rows=sample_rows)

    elif input_type == "sqlite":
        if not sqlite_path:
            raise ValueError("sqlite_path required for input_type='sqlite'")
        return load_sqlite(sqlite_path, sample_rows=sample_rows)

    elif input_type == "sql_dump":
        if not sql_dump_path:
            raise ValueError("sql_dump_path required for input_type='sql_dump'")
        return load_sql_dump(sql_dump_path, sample_rows=sample_rows)

    elif input_type == "live_url":
        if not db_url:
            raise ValueError("db_url required for input_type='live_url'")
        return load_live_db(db_url, sample_rows=sample_rows)

    else:
        raise ValueError(
            f"Unknown input_type '{input_type}'. "
            "Choose from: csv, sqlite, sql_dump, live_url"
        )


# ===================================================================
# Persistence helper
# ===================================================================

def save_schema(schema: dict, output_path: str = "outputs/schema_report.json") -> str:
    """Write schema JSON to disk and return the absolute path."""
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2, default=str)
    print(f"\n  ✓ Schema saved → {output_path}")
    return os.path.abspath(output_path)


# ===================================================================
# Pretty-print helper (for notebooks / CLI)
# ===================================================================

def print_summary(schema: dict) -> None:
    """Print a human-readable summary of the loaded schema."""
    from tabulate import tabulate as _tabulate

    meta = schema["metadata"]
    print(f"\n{'='*55}")
    print("  DATABASE LOADED SUCCESSFULLY")
    print(f"{'='*55}")
    print(f"  Name      : {meta['database_name']}")
    print(f"  Input     : {meta['input_type']}")
    print(f"  Tables    : {meta['total_tables']}")
    print(f"  Columns   : {meta['total_columns']}")
    print(f"  Rows      : {meta['total_rows']:,}")
    print(f"  FK Source : {meta['fk_source']}")
    print(f"  Timestamp : {meta['extraction_timestamp']}")

    rows = [
        [t["name"], f"{t['row_count']:,}", len(t["columns"]), len(t["foreign_keys"])]
        for t in schema["tables"]
    ]
    print(f"\n{_tabulate(rows, headers=['Table', 'Rows', 'Cols', 'FKs'], tablefmt='grid')}")

    if schema["relationships"]:
        print(f"\n  Relationships ({len(schema['relationships'])}):")
        for r in schema["relationships"]:
            flag = " [inferred]" if r["inferred"] else ""
            print(f"    {r['from_table']}.{r['from_column']} → "
                  f"{r['to_table']}.{r['to_column']}{flag}")


# ===================================================================
# CLI entry point
# ===================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Module 1 — Input Handler")
    parser.add_argument("input_type", choices=["csv", "sqlite", "sql_dump", "live_url"])
    parser.add_argument("--csv", nargs="+", help="CSV file paths")
    parser.add_argument("--sqlite", help="SQLite file path")
    parser.add_argument("--sql-dump", help="SQL dump file path")
    parser.add_argument("--db-url", help="Database connection URL")
    parser.add_argument("--output", default="outputs/schema_report.json")
    parser.add_argument("--sample-rows", type=int, default=5)

    args = parser.parse_args()

    schema, _conn = load_database(
        args.input_type,
        csv_paths=args.csv,
        sqlite_path=args.sqlite,
        sql_dump_path=args.sql_dump,
        db_url=args.db_url,
        sample_rows=args.sample_rows,
    )

    print_summary(schema)
    save_schema(schema, args.output)
