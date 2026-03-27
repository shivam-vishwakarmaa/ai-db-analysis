"""
Module 5: AI Generator
========================
Orchestrates all AI generation tasks via the OpenRouter API (free tier).
Generates domain detection, per-table business summaries, data dictionary,
quality narrative, and final recommendations.

Uses OpenRouter's OpenAI-compatible endpoint with free model fallback chain:
  1. meta-llama/llama-3.3-70b-instruct:free
  2. google/gemma-3-27b-it:free
  3. deepseek/deepseek-r1:free
  4. mistralai/mistral-small-3.1-24b-instruct:free

Public API
----------
  detect_domain(schema, api_key)           → domain dict
  generate_table_summaries(schema, api_key) → {table: summary}
  generate_data_dictionary(schema, api_key) → {table: columns_dict}
  generate_quality_narrative(quality, api_key) → narrative string
  generate_recommendations(schema, quality, api_key) → recommendations dict
  run_full_generation(schema, quality, api_key) → complete AI report
  export_ai_outputs(report, output_dir) → writes all output files
"""

import json
import os
import re
import time
from datetime import datetime
from typing import Any, Optional

try:
    import requests as _requests
except ImportError:
    _requests = None


# ───────────────────────────────────────────────────────────
# OpenRouter config
# ───────────────────────────────────────────────────────────

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

FREE_MODELS = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-3-27b-it:free",
    "deepseek/deepseek-r1:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
]


def _call_openrouter(
    prompt: str,
    api_key: str,
    *,
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 2000,
    expect_json: bool = False,
    retries: int = 2,
) -> str:
    """
    Call OpenRouter API with automatic free-model fallback.
    Returns the assistant's text content.
    """
    if _requests is None:
        raise ImportError("requests is required: pip install requests")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ai-db-analysis-agent.local",
        "X-Title": "AI Database Analysis Agent",
    }

    models_to_try = [model] if model else []
    models_to_try += [m for m in FREE_MODELS if m not in models_to_try]

    payload = {
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    last_error = None
    for m in models_to_try:
        payload["model"] = m
        for attempt in range(retries):
            try:
                resp = _requests.post(
                    OPENROUTER_URL, json=payload, headers=headers, timeout=60
                )
                if resp.status_code == 200:
                    content = resp.json()["choices"][0]["message"]["content"]
                    if expect_json:
                        content = _extract_json(content)
                    return content
                elif resp.status_code == 429:
                    # Rate limited — wait and retry
                    time.sleep(2 * (attempt + 1))
                    continue
                else:
                    last_error = f"{m}: HTTP {resp.status_code} — {resp.text[:200]}"
                    break
            except Exception as e:
                last_error = f"{m}: {str(e)}"
                if attempt < retries - 1:
                    time.sleep(1)

    raise RuntimeError(f"All models failed. Last error: {last_error}")


def _extract_json(text: str) -> str:
    """Strip markdown fences and extract JSON from AI response."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    # Try to find JSON object or array
    for start_char, end_char in [("{", "}"), ("[", "]")]:
        idx_start = text.find(start_char)
        idx_end = text.rfind(end_char)
        if idx_start != -1 and idx_end > idx_start:
            return text[idx_start : idx_end + 1]
    return text


def _parse_json_safe(text: str) -> Any:
    """Parse JSON from text, returning a fallback dict on failure."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw_response": text}


# ───────────────────────────────────────────────────────────
# Schema summary builder (for prompts)
# ───────────────────────────────────────────────────────────

def _build_schema_summary(schema: dict, *, include_samples: bool = False) -> str:
    """Build a concise schema text for use in AI prompts."""
    lines = []
    meta = schema.get("metadata", {})
    lines.append(f"Database: {meta.get('database_name', 'unknown')}")
    lines.append(f"Type: {meta.get('input_type', 'unknown')}")
    lines.append(f"Tables: {meta.get('total_tables', '?')}, "
                 f"Columns: {meta.get('total_columns', '?')}, "
                 f"Rows: {meta.get('total_rows', '?'):,}")
    lines.append("")

    for tbl in schema.get("tables", []):
        pk = ", ".join(tbl.get("primary_keys", [])) or "none"
        fks = [f"{fk['column']}→{fk['references_table']}.{fk['references_column']}"
               for fk in tbl.get("foreign_keys", [])]
        fk_str = ", ".join(fks) if fks else "none"
        cols = [f"{c['name']}({c.get('type', 'TEXT')})" for c in tbl.get("columns", [])]

        lines.append(f"Table: {tbl['name']} ({tbl.get('row_count', 0):,} rows)")
        lines.append(f"  PK: {pk}")
        lines.append(f"  FKs: {fk_str}")
        lines.append(f"  Columns: {', '.join(cols)}")

        if include_samples and tbl.get("sample_data"):
            sample_rows = tbl["sample_data"][:3]
            lines.append(f"  Sample: {json.dumps(sample_rows, default=str)[:500]}")
        lines.append("")

    return "\n".join(lines)


def _build_quality_summary(quality: dict) -> str:
    """Build concise quality summary for prompts."""
    lines = [
        f"Overall Health Score: {quality.get('overall_health', '?')}/100",
        f"FK Integrity: {quality.get('avg_fk_integrity', '?')}%",
        f"Issues: {len(quality.get('issues', []))}",
        "",
    ]
    for tp in quality.get("table_profiles", []):
        lines.append(
            f"  {tp['table']}: score={tp.get('score', '?')}, "
            f"completeness={tp.get('avg_completeness', '?')}%, "
            f"fk_integrity={tp.get('fk_integrity', '?')}%"
        )

    # Top issues
    issues = quality.get("issues", [])[:10]
    if issues:
        lines.append("\nTop Issues:")
        for iss in issues:
            lines.append(f"  [{iss['severity']}] {iss['table']}.{iss.get('column', '*')}: {iss['issue']}")

    return "\n".join(lines)


# ───────────────────────────────────────────────────────────
# AI Generation functions
# ───────────────────────────────────────────────────────────

def detect_domain(schema: dict, api_key: str) -> dict:
    """Detect the business domain and generate an executive summary."""
    summary = _build_schema_summary(schema, include_samples=True)
    prompt = f"""You are a senior data analyst. Analyze this database schema and sample data.

{summary}

Return JSON only — no explanation, no markdown fences:
{{
  "domain": "detected business domain (e.g. e-commerce, healthcare, finance)",
  "executive_summary": "5-6 sentence executive summary of this database",
  "db_purpose": "one sentence describing the database's primary purpose",
  "key_entities": ["list of the main business entities"],
  "data_flow": "one sentence describing how data flows through the tables"
}}"""

    result = _call_openrouter(prompt, api_key, expect_json=True)
    return _parse_json_safe(result)


def generate_table_summary(
    table: dict,
    domain: str,
    related_tables: list[str],
    api_key: str,
) -> str:
    """Generate a plain-English business summary for a single table."""
    cols = [c["name"] for c in table.get("columns", [])]
    sample = table.get("sample_data", [])[:3]

    prompt = f"""Write a 3-4 sentence business description of this database table for a non-technical audience.

Table: {table['name']} ({table.get('row_count', 0):,} rows)
Columns: {', '.join(cols)}
Sample data: {json.dumps(sample, default=str)[:400]}
Connected to: {', '.join(related_tables) if related_tables else 'none'}
Business domain: {domain}

Plain English only. No technical jargon. No bullet points. Paragraph form only. Be specific about what this table tracks and why it matters."""

    return _call_openrouter(prompt, api_key, max_tokens=500)


def generate_table_summaries(schema: dict, domain: str, api_key: str) -> dict[str, str]:
    """Generate business summaries for all tables."""
    tables = schema.get("tables", [])
    relationships = schema.get("relationships", [])

    summaries = {}
    for i, tbl in enumerate(tables):
        # Find related tables
        related = set()
        for r in relationships:
            if r["from_table"] == tbl["name"]:
                related.add(r["to_table"])
            if r["to_table"] == tbl["name"]:
                related.add(r["from_table"])

        print(f"  ⏳ Generating summary {i + 1}/{len(tables)}: {tbl['name']}")
        summaries[tbl["name"]] = generate_table_summary(
            tbl, domain, list(related), api_key
        )
        time.sleep(0.5)  # Rate limit courtesy

    return summaries


def generate_data_dictionary(
    table: dict,
    api_key: str,
) -> dict:
    """Generate a data dictionary for a single table."""
    col_samples = {}
    for col in table.get("columns", []):
        samples = [
            row.get(col["name"])
            for row in table.get("sample_data", [])[:5]
            if row.get(col["name"]) is not None
        ]
        col_samples[col["name"]] = {
            "type": col.get("type", "TEXT"),
            "nullable": col.get("nullable", True),
            "primary_key": col.get("primary_key", False),
            "samples": [str(s)[:50] for s in samples[:3]],
        }

    prompt = f"""Generate a data dictionary for this database table.
Return JSON only — no explanation, no markdown fences.

Table: {table['name']}
Columns with samples: {json.dumps(col_samples, default=str)}

{{
  "table": "{table['name']}",
  "columns": [
    {{
      "name": "column_name",
      "description": "plain English description of what this column stores",
      "format": "expected format (e.g. UUID, ISO date, currency amount)",
      "business_rule": "any business rule that applies, or null",
      "sensitive": false,
      "suggested_name": "a clearer name if the current one is ambiguous, or null"
    }}
  ]
}}"""

    result = _call_openrouter(prompt, api_key, expect_json=True, max_tokens=2500)
    return _parse_json_safe(result)


def generate_all_dictionaries(schema: dict, api_key: str) -> dict[str, dict]:
    """Generate data dictionaries for all tables."""
    tables = schema.get("tables", [])
    dictionaries = {}

    for i, tbl in enumerate(tables):
        print(f"  ⏳ Generating dictionary {i + 1}/{len(tables)}: {tbl['name']}")
        dictionaries[tbl["name"]] = generate_data_dictionary(tbl, api_key)
        time.sleep(0.5)

    return dictionaries


def generate_quality_narrative(quality: dict, api_key: str) -> str:
    """Generate a plain-English data quality assessment narrative."""
    summary = _build_quality_summary(quality)

    prompt = f"""Write a 200-word data quality assessment for this database.

{summary}

Cover these points in flowing prose (not bullet points):
1. What the overall health score means
2. The top 3 most critical issues with specific table.column locations
3. Which tables are cleanest vs which need the most work
4. 3 specific, actionable fixes the data team should prioritize
5. A one-sentence readiness verdict: is this database ready for analytics?

Write as a senior data quality analyst. Be specific, cite numbers."""

    return _call_openrouter(prompt, api_key, max_tokens=1000)


def generate_recommendations(
    schema: dict,
    quality: dict,
    domain: str,
    api_key: str,
) -> dict:
    """Generate final recommendations including fixes, improvements, and sample queries."""
    schema_summary = _build_schema_summary(schema)
    quality_summary = _build_quality_summary(quality)

    prompt = f"""Generate final recommendations for this {domain} database.

Schema:
{schema_summary}

Quality:
{quality_summary}

Return JSON only — no explanation, no markdown fences:
{{
  "critical_fixes": [
    {{"issue": "description", "table": "table_name", "fix": "specific SQL or action"}}
  ],
  "schema_improvements": [
    "specific improvement suggestion"
  ],
  "missing_fks": [
    {{"from_table": "...", "from_column": "...", "to_table": "...", "confidence": "high/medium/low"}}
  ],
  "analytical_queries": [
    {{"question": "business question this answers", "sql": "SELECT query"}}
  ],
  "readiness": {{
    "analytics": "Ready/Needs Work/Not Ready — reason",
    "ml_training": "Ready/Needs Work/Not Ready — reason",
    "reporting": "Ready/Needs Work/Not Ready — reason"
  }}
}}"""

    result = _call_openrouter(prompt, api_key, expect_json=True, max_tokens=3000)
    return _parse_json_safe(result)


# ───────────────────────────────────────────────────────────
# Full pipeline
# ───────────────────────────────────────────────────────────

def run_full_generation(
    schema: dict,
    quality: dict,
    api_key: str,
    *,
    model: Optional[str] = None,
) -> dict:
    """
    Run all 5 AI generation steps in sequence.
    Returns the complete AI report dict.
    """
    print(f"\n{'═' * 55}")
    print("  AI GENERATOR — Running Pipeline")
    print(f"{'═' * 55}")

    # Step 1: Domain detection
    print("\n  [1/5] Detecting domain…")
    domain_info = detect_domain(schema, api_key)
    domain = domain_info.get("domain", "general")
    print(f"  ✓ Domain: {domain}")

    # Step 2: Business summaries
    print("\n  [2/5] Generating business summaries…")
    summaries = generate_table_summaries(schema, domain, api_key)
    print(f"  ✓ {len(summaries)} summaries generated")

    # Step 3: Data dictionary
    print("\n  [3/5] Generating data dictionary…")
    dictionaries = generate_all_dictionaries(schema, api_key)
    print(f"  ✓ {len(dictionaries)} dictionaries generated")

    # Step 4: Quality narrative
    print("\n  [4/5] Generating quality narrative…")
    narrative = generate_quality_narrative(quality, api_key)
    print(f"  ✓ Narrative generated ({len(narrative)} chars)")

    # Step 5: Recommendations
    print("\n  [5/5] Generating recommendations…")
    recommendations = generate_recommendations(schema, quality, domain, api_key)
    print(f"  ✓ Recommendations generated")

    report = {
        "domain_info": domain_info,
        "business_summaries": summaries,
        "data_dictionary": dictionaries,
        "quality_narrative": narrative,
        "recommendations": recommendations,
        "generation_timestamp": datetime.now().isoformat(),
        "model_used": model or FREE_MODELS[0],
    }

    print(f"\n  ★ AI generation complete!")
    return report


# ───────────────────────────────────────────────────────────
# Export helpers
# ───────────────────────────────────────────────────────────

def export_ai_outputs(report: dict, output_dir: str = "outputs") -> None:
    """Write all AI outputs to individual files."""
    os.makedirs(output_dir, exist_ok=True)

    # Business summaries
    path = os.path.join(output_dir, "business_summaries.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report.get("business_summaries", {}), f, indent=2, default=str)
    print(f"  ✓ Business summaries → {path}")

    # Data dictionary
    path = os.path.join(output_dir, "data_dictionary.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report.get("data_dictionary", {}), f, indent=2, default=str)
    print(f"  ✓ Data dictionary → {path}")

    # Quality narrative
    path = os.path.join(output_dir, "quality_narrative.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(report.get("quality_narrative", ""))
    print(f"  ✓ Quality narrative → {path}")

    # Recommendations
    path = os.path.join(output_dir, "recommendations.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report.get("recommendations", {}), f, indent=2, default=str)
    print(f"  ✓ Recommendations → {path}")

    # Full report JSON
    path = os.path.join(output_dir, "ai_report.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"  ✓ Full AI report → {path}")


def generate_final_markdown(
    schema: dict,
    quality: dict,
    ai_report: dict,
    output_path: str = "outputs/final_report.md",
) -> str:
    """Combine all outputs into a single Markdown report."""
    meta = schema.get("metadata", {})
    domain_info = ai_report.get("domain_info", {})
    summaries = ai_report.get("business_summaries", {})
    dictionaries = ai_report.get("data_dictionary", {})
    narrative = ai_report.get("quality_narrative", "")
    recommendations = ai_report.get("recommendations", {})

    lines = [
        f"# Database Analysis Report — {meta.get('database_name', 'Unknown')}",
        f"\nGenerated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"\n## Executive Summary\n",
        domain_info.get("executive_summary", "N/A"),
        f"\n**Domain**: {domain_info.get('domain', 'Unknown')}",
        f"**Purpose**: {domain_info.get('db_purpose', 'N/A')}",
        f"\n---\n",
        f"## Database Overview\n",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Tables | {meta.get('total_tables', '?')} |",
        f"| Columns | {meta.get('total_columns', '?')} |",
        f"| Total Rows | {meta.get('total_rows', 0):,} |",
        f"| Input Type | {meta.get('input_type', '?')} |",
        f"| FK Source | {meta.get('fk_source', '?')} |",
        f"| Health Score | {quality.get('overall_health', '?')}/100 |",
        f"\n---\n",
    ]

    # Business summaries
    lines.append("## Business Summaries\n")
    for tbl_name, summary in summaries.items():
        lines.append(f"### {tbl_name}\n")
        lines.append(f"{summary}\n")

    # Data dictionary
    lines.append("---\n\n## Data Dictionary\n")
    for tbl_name, dd in dictionaries.items():
        cols = dd.get("columns", []) if isinstance(dd, dict) else []
        if not cols:
            continue
        lines.append(f"### {tbl_name}\n")
        lines.append("| Column | Description | Format | Sensitive |")
        lines.append("|--------|-------------|--------|-----------|")
        for c in cols:
            desc = c.get("description", "N/A")
            fmt = c.get("format", "—")
            sens = "Yes" if c.get("sensitive") else "No"
            lines.append(f"| {c.get('name', '?')} | {desc} | {fmt} | {sens} |")
        lines.append("")

    # Quality narrative
    lines.append("---\n\n## Data Quality Assessment\n")
    lines.append(narrative)
    lines.append("")

    # Recommendations
    lines.append("---\n\n## Recommendations\n")
    if isinstance(recommendations, dict):
        # Critical fixes
        fixes = recommendations.get("critical_fixes", [])
        if fixes:
            lines.append("### Critical Fixes\n")
            for fix in fixes:
                lines.append(f"- **{fix.get('table', '?')}**: {fix.get('issue', '?')}")
                lines.append(f"  - Fix: {fix.get('fix', '?')}")
            lines.append("")

        # Schema improvements
        improvements = recommendations.get("schema_improvements", [])
        if improvements:
            lines.append("### Schema Improvements\n")
            for imp in improvements:
                lines.append(f"- {imp}")
            lines.append("")

        # Analytical queries
        queries = recommendations.get("analytical_queries", [])
        if queries:
            lines.append("### Suggested Analytical Queries\n")
            for q in queries:
                lines.append(f"**{q.get('question', '?')}**")
                lines.append(f"```sql\n{q.get('sql', '')}\n```\n")

        # Readiness
        readiness = recommendations.get("readiness", {})
        if readiness:
            lines.append("### Readiness Assessment\n")
            lines.append("| Use Case | Verdict |")
            lines.append("|----------|---------|")
            for use, verdict in readiness.items():
                lines.append(f"| {use.replace('_', ' ').title()} | {verdict} |")
            lines.append("")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    report_text = "\n".join(lines)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(report_text)
    print(f"  ✓ Final report → {output_path}")
    return os.path.abspath(output_path)


# ───────────────────────────────────────────────────────────
# CLI
# ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Module 5 — AI Generator")
    parser.add_argument("--schema", default="outputs/schema_report.json")
    parser.add_argument("--quality", default="outputs/quality_report.json")
    parser.add_argument("--api-key", required=True, help="OpenRouter API key")
    parser.add_argument("--model", default=None, help="Override model selection")
    parser.add_argument("--output-dir", default="outputs")
    args = parser.parse_args()

    with open(args.schema, "r") as f:
        schema = json.load(f)
    with open(args.quality, "r") as f:
        quality = json.load(f)

    ai_report = run_full_generation(schema, quality, args.api_key, model=args.model)
    export_ai_outputs(ai_report, args.output_dir)
    generate_final_markdown(
        schema, quality, ai_report,
        os.path.join(args.output_dir, "final_report.md"),
    )
