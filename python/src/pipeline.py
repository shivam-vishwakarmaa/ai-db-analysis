"""
Master Pipeline — Runs the complete analysis end-to-end.
=========================================================
Usage:
  python pipeline.py --input data/chinook.db --type sqlite
  python pipeline.py --input data/csvs/ --type csv
  (API key auto-reads from .env — no --api-key flag needed)
"""

import json, os, sys, argparse, sqlite3
from datetime import datetime
from pathlib import Path

# Auto-load .env file (walks up to find project root .env)
try:
    from dotenv import load_dotenv
    # Look for .env in project root (two levels up from python/src/)
    _env_path = Path(__file__).parent.parent.parent / ".env"
    load_dotenv(_env_path)
    if _env_path.exists():
        print(f"  ✓ Loaded .env from {_env_path}")
except ImportError:
    pass  # dotenv not installed, rely on explicit args/env vars

# Add src to path
sys.path.insert(0, str(Path(__file__).parent))

from input_handler import load_database
from schema_extractor import analyse_schema, export_markdown_report
from relationship_mapper import analyse_relationships, save_mermaid, save_relationship_report
from quality_profiler import profile_database, print_quality_report, export_quality_report, generate_quality_charts
from ai_generator import run_full_generation, export_ai_outputs, generate_final_markdown


def run_pipeline(
    input_type: str,
    input_path: str,
    output_dir: str = "outputs",
    api_key: str | None = None,
    generate_charts: bool = True,
):
    os.makedirs(output_dir, exist_ok=True)
    print(f"\n{'═' * 60}")
    print(f"  AI DATABASE ANALYSIS AGENT — Master Pipeline")
    print(f"  Input: {input_path} ({input_type})")
    print(f"  Output: {output_dir}/")
    print(f"{'═' * 60}")

    # Step 1: Load database
    print(f"\n▶ Step 1/5: Loading database…")
    schema = load_database(input_type, input_path)
    schema_path = os.path.join(output_dir, "schema.json")
    with open(schema_path, "w") as f:
        json.dump(schema, f, indent=2, default=str)
    print(f"  ✓ Loaded {schema['metadata']['total_tables']} tables, "
          f"{schema['metadata']['total_rows']:,} rows")

    # Step 2: Schema extraction + enrichment
    print(f"\n▶ Step 2/5: Enriching schema…")
    enriched = analyse_schema(schema)
    export_markdown_report(enriched, os.path.join(output_dir, "schema_report.md"))

    # Step 3: Relationship mapping
    print(f"\n▶ Step 3/5: Mapping relationships…")
    db_path = input_path if input_type == "sqlite" else os.path.join(output_dir, "temp.db")
    conn = None
    if input_type == "sqlite" and os.path.isfile(input_path):
        conn = sqlite3.connect(input_path)
    rel_report = analyse_relationships(enriched, conn, api_key)
    save_mermaid(rel_report["mermaid_syntax"], os.path.join(output_dir, "erd.mmd"))
    save_relationship_report(rel_report, os.path.join(output_dir, "relationship_report.json"))

    # Step 4: Quality profiling
    print(f"\n▶ Step 4/5: Profiling data quality…")
    if conn is None and input_type == "sqlite" and os.path.isfile(input_path):
        conn = sqlite3.connect(input_path)
    if conn:
        quality = profile_database(enriched, conn)
        print_quality_report(quality)
        export_quality_report(quality, os.path.join(output_dir, "quality_report.json"))
        if generate_charts:
            generate_quality_charts(quality, os.path.join(output_dir, "quality_charts.png"))
    else:
        quality = {"overall_health": 0, "issues": [], "table_profiles": []}
        print("  ⚠ No SQLite connection — quality profiling skipped")

    # Step 5: AI generation
    if api_key:
        print(f"\n▶ Step 5/5: Generating AI outputs…")
        ai_report = run_full_generation(enriched, quality, api_key)
        export_ai_outputs(ai_report, output_dir)
        generate_final_markdown(enriched, quality, ai_report,
                                os.path.join(output_dir, "final_report.md"))
    else:
        print(f"\n▶ Step 5/5: Skipped (no API key)")
        ai_report = None

    if conn:
        conn.close()

    print(f"\n{'═' * 60}")
    print(f"  ★ Pipeline complete!")
    print(f"  Check: {os.path.abspath(output_dir)}/")
    print(f"{'═' * 60}\n")

    return {"schema": enriched, "relationships": rel_report,
            "quality": quality, "ai": ai_report}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="AI DB Analysis — Master Pipeline")
    p.add_argument("--input", required=True, help="Path to DB file or CSV directory")
    p.add_argument("--type", required=True, choices=["csv", "sqlite", "sql_dump", "db_url"])
    p.add_argument("--api-key", default=os.environ.get("OPENROUTER_API_KEY"))
    p.add_argument("--output-dir", default="outputs")
    p.add_argument("--no-charts", action="store_true")
    args = p.parse_args()
    run_pipeline(args.type, args.input, args.output_dir, args.api_key, not args.no_charts)
