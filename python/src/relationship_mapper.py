"""
Module 3: Relationship Mapper
==============================
Analyses FK relationships from the Standard Schema JSON, builds a
NetworkX graph, detects cardinality, generates Mermaid ER syntax,
optionally calls OpenRouter AI for relationship narrative, and can
render a PNG via ERAlchemy2.

Public API
----------
  build_relationship_graph(schema) → nx.DiGraph + relationship metadata
  detect_cardinality(conn, rel)    → 'one-to-one' | 'one-to-many' | 'many-to-many'
  generate_mermaid_er(schema)      → Mermaid ER string
  generate_ai_narrative(schema, api_key) → AI-generated relationship narrative
  export_erd_png(db_path, output)  → PNG file path (ERAlchemy2)
  analyse_relationships(schema)    → full enriched relationship report dict
"""

import json
import os
import re
import sqlite3
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

try:
    import networkx as nx
except ImportError:
    nx = None

try:
    import requests
except ImportError:
    requests = None


# ───────────────────────────────────────────────────────────
# Relationship graph construction
# ───────────────────────────────────────────────────────────

def build_relationship_graph(schema: dict) -> tuple[Any, list[dict]]:
    """
    Build a directed graph of table relationships from Standard Schema JSON.

    Returns
    -------
    (nx.DiGraph, enriched_relationships)
        The graph has table names as nodes with metadata, and FK links as edges.
    """
    if nx is None:
        raise ImportError("networkx is required: pip install networkx")

    G = nx.DiGraph()
    tables = schema.get("tables", [])
    relationships = schema.get("relationships", [])

    # Add table nodes
    for tbl in tables:
        G.add_node(
            tbl["name"],
            row_count=tbl.get("row_count", 0),
            col_count=len(tbl.get("columns", [])),
            pk_count=len(tbl.get("primary_keys", [])),
            fk_count=len(tbl.get("foreign_keys", [])),
            role=tbl.get("role", "unknown"),
        )

    # Add relationship edges
    enriched_rels = []
    for rel in relationships:
        from_t = rel["from_table"]
        to_t = rel["to_table"]
        G.add_edge(
            from_t,
            to_t,
            column=rel["from_column"],
            ref_column=rel["to_column"],
            inferred=rel.get("inferred", False),
            cardinality=rel.get("cardinality", "one-to-many"),
        )
        enriched_rels.append(rel)

    return G, enriched_rels


# ───────────────────────────────────────────────────────────
# Cardinality detection via SQL analysis
# ───────────────────────────────────────────────────────────

def detect_cardinality(
    conn: sqlite3.Connection,
    from_table: str,
    from_column: str,
    to_table: str,
    to_column: str,
) -> str:
    """
    Analyse actual data to determine relationship cardinality.

    Logic:
      • Count distinct values in child FK column vs total rows
      • Count max occurrences of a single FK value in child
      • Count distinct in parent PK column

    Returns 'one-to-one', 'one-to-many', or 'many-to-many'.
    """
    cur = conn.cursor()

    try:
        # Child side: how many rows share the same FK value?
        child_total = cur.execute(
            f'SELECT COUNT(*) FROM "{from_table}"'
        ).fetchone()[0]
        child_distinct = cur.execute(
            f'SELECT COUNT(DISTINCT "{from_column}") FROM "{from_table}"'
        ).fetchone()[0]
        child_max_freq = cur.execute(
            f'SELECT MAX(cnt) FROM (SELECT COUNT(*) as cnt FROM "{from_table}" '
            f'GROUP BY "{from_column}")'
        ).fetchone()[0] or 1

        # Parent side: are there duplicates?
        parent_distinct = cur.execute(
            f'SELECT COUNT(DISTINCT "{to_column}") FROM "{to_table}"'
        ).fetchone()[0]
        parent_total = cur.execute(
            f'SELECT COUNT(*) FROM "{to_table}"'
        ).fetchone()[0]
    except Exception:
        return "one-to-many"  # safe fallback

    if child_total == 0 or parent_total == 0:
        return "one-to-many"

    # If each FK value appears exactly once (child_distinct == child_total) → one-to-one
    if child_distinct == child_total and child_max_freq == 1:
        return "one-to-one"

    # If both sides have duplicates → many-to-many (junction table pattern)
    if parent_distinct < parent_total and child_max_freq > 1:
        return "many-to-many"

    # Default
    return "one-to-many"


def detect_all_cardinalities(
    schema: dict,
    conn: Optional[sqlite3.Connection] = None,
) -> dict:
    """
    Return a dict mapping ``(from_table, from_col, to_table, to_col)`` → cardinality.
    Falls back to heuristic if no connection provided.
    """
    cardinalities = {}
    for rel in schema.get("relationships", []):
        key = (rel["from_table"], rel["from_column"],
               rel["to_table"], rel["to_column"])
        if conn:
            card = detect_cardinality(
                conn,
                rel["from_table"], rel["from_column"],
                rel["to_table"], rel["to_column"],
            )
        else:
            card = rel.get("cardinality", "one-to-many")
        cardinalities[key] = card
    return cardinalities


# ───────────────────────────────────────────────────────────
# Graph metrics
# ───────────────────────────────────────────────────────────

def compute_graph_metrics(G) -> dict:
    """Compute useful graph-level metrics for the schema."""
    if nx is None:
        return {}

    undirected = G.to_undirected()
    metrics = {
        "total_nodes": G.number_of_nodes(),
        "total_edges": G.number_of_edges(),
        "connected_components": nx.number_connected_components(undirected),
        "is_connected": nx.is_connected(undirected) if G.number_of_nodes() > 0 else False,
        "density": round(nx.density(G), 4),
    }

    # Degree centrality
    if G.number_of_nodes() > 0:
        degree_cent = nx.degree_centrality(undirected)
        hub_table = max(degree_cent, key=degree_cent.get)
        metrics["hub_table"] = hub_table
        metrics["hub_degree"] = round(degree_cent[hub_table], 4)
        metrics["centrality"] = {
            k: round(v, 4) for k, v in sorted(
                degree_cent.items(), key=lambda x: -x[1]
            )
        }

        # Betweenness centrality
        if nx.is_connected(undirected):
            between = nx.betweenness_centrality(undirected)
            metrics["betweenness"] = {
                k: round(v, 4) for k, v in sorted(
                    between.items(), key=lambda x: -x[1]
                )
            }

    # Isolated tables
    metrics["isolated_tables"] = [
        n for n in G.nodes if G.degree(n) == 0
    ]

    return metrics


# ───────────────────────────────────────────────────────────
# Mermaid ER syntax generation
# ───────────────────────────────────────────────────────────

_CARD_MAP = {
    "one-to-one": "||--||",
    "one-to-many": "||--o{",
    "many-to-many": "}o--o{",
    "many-to-one": "}o--||",
}


def generate_mermaid_er(schema: dict, cardinalities: Optional[dict] = None) -> str:
    """
    Generate Mermaid erDiagram syntax from the Standard Schema JSON.
    Shows PK + FK columns only to keep diagrams clean.
    """
    lines = ["erDiagram"]
    tables = schema.get("tables", [])

    # Table definitions — only PK + FK columns
    for tbl in tables:
        lines.append(f'    {_safe_name(tbl["name"])} {{')
        pk_names = set(tbl.get("primary_keys", []))
        fk_names = {fk["column"] for fk in tbl.get("foreign_keys", [])}
        shown = pk_names | fk_names

        for col in tbl.get("columns", []):
            if col["name"] not in shown:
                continue
            col_type = col["type"].replace(" ", "_") or "TEXT"
            marker = "PK" if col["name"] in pk_names else "FK"
            lines.append(f'        {col_type} {col["name"]} {marker}')
        lines.append("    }")

    # Relationships
    seen_rels = set()
    for rel in schema.get("relationships", []):
        from_t = _safe_name(rel["from_table"])
        to_t = _safe_name(rel["to_table"])
        pair = (from_t, to_t)
        if pair in seen_rels:
            continue
        seen_rels.add(pair)

        key = (rel["from_table"], rel["from_column"],
               rel["to_table"], rel["to_column"])
        card = "one-to-many"
        if cardinalities and key in cardinalities:
            card = cardinalities[key]
        elif rel.get("cardinality"):
            card = rel["cardinality"]

        mermaid_card = _CARD_MAP.get(card, "||--o{")
        label = rel["from_column"].replace("_id", "").replace("_", " ").title()
        lines.append(f"    {to_t} {mermaid_card} {from_t} : \"{label}\"")

    return "\n".join(lines)


def _safe_name(name: str) -> str:
    """Make a table name safe for Mermaid syntax."""
    return re.sub(r"[^a-zA-Z0-9_]", "_", name)


# ───────────────────────────────────────────────────────────
# ERAlchemy2 PNG generation
# ───────────────────────────────────────────────────────────

def export_erd_png(
    db_path: str,
    output_path: str = "outputs/er_diagram.png",
) -> str:
    """Use ERAlchemy2 to generate a PNG ER diagram from a SQLite file."""
    try:
        from eralchemy2 import render_er
    except ImportError:
        print("  ⚠ eralchemy2 not installed, skipping PNG generation")
        return ""

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    render_er(f"sqlite:///{db_path}", output_path)
    print(f"  ✓ ER diagram PNG saved → {output_path}")
    return os.path.abspath(output_path)


# ───────────────────────────────────────────────────────────
# OpenRouter AI narrative
# ───────────────────────────────────────────────────────────

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

_FREE_MODELS = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-3-27b-it:free",
    "deepseek/deepseek-r1:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
]


def generate_ai_narrative(
    schema: dict,
    api_key: str,
    model: Optional[str] = None,
) -> dict:
    """
    Call OpenRouter to generate a relationship narrative.

    Returns dict with:
      - narrative: str (2-3 paragraph summary)
      - relationship_descriptions: list of per-relationship descriptions
    """
    if requests is None:
        raise ImportError("requests is required: pip install requests")

    # Build a concise schema summary for the prompt
    table_summaries = []
    for tbl in schema.get("tables", []):
        pk = ", ".join(tbl.get("primary_keys", [])) or "none"
        fks = [f"{fk['column']}→{fk['references_table']}.{fk['references_column']}"
               for fk in tbl.get("foreign_keys", [])]
        fk_str = ", ".join(fks) if fks else "none"
        table_summaries.append(
            f"  {tbl['name']} ({tbl.get('row_count', 0):,} rows) "
            f"PK:[{pk}] FKs:[{fk_str}]"
        )

    schema_text = "\n".join(table_summaries)

    prompt = f"""Analyse this database schema and provide:

1. A 2-3 paragraph narrative describing the overall database structure, purpose, and how tables relate to each other. Write in plain English for non-technical readers.

2. For each relationship, a one-sentence description of what it represents in business terms.

Database: {schema.get('metadata', {}).get('database_name', 'unknown')}
Tables:
{schema_text}

Respond in JSON format:
{{
  "narrative": "...",
  "relationship_descriptions": [
    {{"from_table": "...", "to_table": "...", "description": "..."}}
  ]
}}"""

    model = model or _FREE_MODELS[0]
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": 1500,
    }

    # Try each free model until one succeeds
    models_to_try = [model] + [m for m in _FREE_MODELS if m != model]
    last_error = None

    for m in models_to_try:
        payload["model"] = m
        try:
            resp = requests.post(_OPENROUTER_URL, json=payload, headers=headers, timeout=30)
            if resp.status_code == 200:
                content = resp.json()["choices"][0]["message"]["content"]
                # Parse JSON from response (strip markdown fences if present)
                content = re.sub(r"^```json\s*", "", content.strip())
                content = re.sub(r"\s*```$", "", content.strip())
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    return {"narrative": content, "relationship_descriptions": []}
            else:
                last_error = f"{m}: HTTP {resp.status_code}"
        except Exception as e:
            last_error = f"{m}: {str(e)}"

    print(f"  ⚠ AI narrative failed: {last_error}")
    return {"narrative": "", "relationship_descriptions": []}


# ───────────────────────────────────────────────────────────
# Full analysis pipeline
# ───────────────────────────────────────────────────────────

def analyse_relationships(
    schema: dict,
    conn: Optional[sqlite3.Connection] = None,
    api_key: Optional[str] = None,
) -> dict:
    """
    Run the complete Module 3 analysis.

    Returns an enriched dict with:
      - graph_metrics: centrality, hubs, components
      - cardinalities: detected cardinality per relationship
      - mermaid_syntax: Mermaid ER string
      - ai_narrative: AI-generated descriptions (if api_key provided)
    """
    print(f"\n{'═' * 55}")
    print("  RELATIONSHIP MAPPER — Analysing")
    print(f"{'═' * 55}")

    # 1. Build graph
    G, enriched_rels = build_relationship_graph(schema)
    print(f"  ✓ Graph built: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

    # 2. Detect cardinalities
    cardinalities = detect_all_cardinalities(schema, conn)
    print(f"  ✓ Cardinalities detected for {len(cardinalities)} relationship(s)")

    # Update relationships with detected cardinality
    for rel in schema.get("relationships", []):
        key = (rel["from_table"], rel["from_column"],
               rel["to_table"], rel["to_column"])
        if key in cardinalities:
            rel["cardinality"] = cardinalities[key]

    # 3. Graph metrics
    metrics = compute_graph_metrics(G) if nx else {}
    if metrics.get("hub_table"):
        print(f"  ✓ Hub table: {metrics['hub_table']} (centrality: {metrics['hub_degree']})")

    # 4. Mermaid syntax
    mermaid = generate_mermaid_er(schema, cardinalities)
    print(f"  ✓ Mermaid ER syntax generated ({len(mermaid)} chars)")

    # 5. AI narrative (optional)
    ai_narrative = {}
    if api_key:
        print("  ⏳ Generating AI narrative…")
        ai_narrative = generate_ai_narrative(schema, api_key)
        if ai_narrative.get("narrative"):
            print("  ✓ AI narrative generated")

    result = {
        "metadata": schema.get("metadata", {}),
        "relationships": enriched_rels,
        "graph_metrics": metrics,
        "cardinalities": {
            f"{k[0]}.{k[1]}→{k[2]}.{k[3]}": v
            for k, v in cardinalities.items()
        },
        "mermaid_syntax": mermaid,
        "ai_narrative": ai_narrative,
        "analysis_timestamp": datetime.now().isoformat(),
    }

    return result


# ───────────────────────────────────────────────────────────
# Export helpers
# ───────────────────────────────────────────────────────────

def save_mermaid(mermaid: str, output_path: str = "outputs/erd.mmd") -> str:
    """Write Mermaid syntax to a .mmd file."""
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(mermaid)
    print(f"  ✓ Mermaid file saved → {output_path}")
    return os.path.abspath(output_path)


def save_relationship_report(report: dict, output_path: str = "outputs/relationship_report.json") -> str:
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"  ✓ Relationship report saved → {output_path}")
    return os.path.abspath(output_path)


def print_relationship_summary(report: dict) -> None:
    """Pretty-print the relationship analysis to stdout."""
    metrics = report.get("graph_metrics", {})
    rels = report.get("relationships", [])
    cards = report.get("cardinalities", {})

    print(f"\n{'═' * 55}")
    print("  RELATIONSHIP SUMMARY")
    print(f"{'═' * 55}")
    print(f"  Tables          : {metrics.get('total_nodes', '?')}")
    print(f"  Relationships   : {metrics.get('total_edges', '?')}")
    print(f"  Connected       : {'Yes' if metrics.get('is_connected') else 'No'}")
    print(f"  Components      : {metrics.get('connected_components', '?')}")
    print(f"  Hub table       : {metrics.get('hub_table', 'N/A')}")
    print(f"  Graph density   : {metrics.get('density', '?')}")

    if rels:
        print(f"\n  Relationships:")
        for r in rels:
            key = f"{r['from_table']}.{r['from_column']}→{r['to_table']}.{r['to_column']}"
            card = cards.get(key, r.get("cardinality", "?"))
            tag = " [inferred]" if r.get("inferred") else ""
            print(f"    {r['from_table']}.{r['from_column']} → "
                  f"{r['to_table']}.{r['to_column']}  ({card}){tag}")

    narrative = report.get("ai_narrative", {}).get("narrative", "")
    if narrative:
        print(f"\n  AI Narrative:")
        for para in narrative.split("\n"):
            if para.strip():
                print(f"    {para.strip()}")


# ───────────────────────────────────────────────────────────
# CLI
# ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Module 3 — Relationship Mapper")
    parser.add_argument("--input", default="outputs/schema_report.json",
                        help="Schema JSON from Module 1")
    parser.add_argument("--db", default=None,
                        help="SQLite DB path for cardinality detection & ERAlchemy2")
    parser.add_argument("--api-key", default=None,
                        help="OpenRouter API key for AI narrative")
    parser.add_argument("--output-dir", default="outputs")
    args = parser.parse_args()

    with open(args.input, "r") as f:
        schema = json.load(f)

    conn = None
    if args.db and os.path.isfile(args.db):
        conn = sqlite3.connect(args.db)

    report = analyse_relationships(schema, conn, args.api_key)
    print_relationship_summary(report)

    save_mermaid(report["mermaid_syntax"],
                 os.path.join(args.output_dir, "erd.mmd"))
    save_relationship_report(report,
                             os.path.join(args.output_dir, "relationship_report.json"))

    if args.db:
        export_erd_png(args.db, os.path.join(args.output_dir, "er_diagram.png"))

    if conn:
        conn.close()
