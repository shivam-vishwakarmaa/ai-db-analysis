"""
Module 4: Data Quality Engine (Overhauled)
=========================================
Strictly non-LLM, deterministic data quality metrics using pandas and DuckDB.
Measures 6 dimensions (Completeness, Uniqueness, Freshness, FK Integrity, Validity, Consistency)
and generates 10 interactive Plotly visualizations for Streamlit.
"""

import os
import json
import pandas as pd
import numpy as np
import duckdb
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime
from typing import Dict, Any, List, Optional

# --- POLICY ENGINE ---
POLICIES = {
    "completeness": {
        "warning_threshold": 5.0,     # >5% nulls
        "critical_threshold": 30.0    # >30% nulls
    },
    "uniqueness": {
        "cardinality_enum_threshold": 5.0, # <5% cardinality -> enum tip
    },
    "freshness": {
        "stale_days_threshold": 365,
        "max_freshness_decay_days": 3650
    },
    "fk_integrity": {
        "breach_threshold_pct": 99.0  # <99% -> breach
    },
    "validity": {
        "outlier_violation_threshold_pct": 5.0,
        "outlier_multiplier": 1.5
    },
    "consistency": {
        "expected_order_statuses": [1, 2, 3, 4]
    },
    "weights": {
        "completeness": 0.25,
        "uniqueness": 0.20,
        "fk_integrity": 0.20,
        "freshness": 0.15,
        "validity": 0.10,
        "consistency": 0.10
    }
}

class QualityEngine:
    def __init__(self, db_path: str):
        self.db_path = db_path
        # Connect to a transient DuckDB and attach the SQLite DB
        self.con = duckdb.connect(database=':memory:')
        # Note: In a real environment, ensure the sqlite extension is loaded
        # duckdb.execute("INSTALL sqlite; LOAD sqlite;")
        self.con.execute(f"ATTACH '{db_path}' AS db (TYPE SQLITE)")
        
    def get_df(self, table_name: str) -> pd.DataFrame:
        """Fetch table as pandas DataFrame via DuckDB."""
        return self.con.execute(f'SELECT * FROM db."{table_name}"').df()

    def compute_completeness(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Dimension 1: Completeness - Null analysis."""
        if len(df) == 0:
            return {"score": 0, "column_metrics": {}, "column_status": {}}
            
        null_counts = df.isnull().sum()
        null_pct = (null_counts / len(df)) * 100
        col_status = {}
        for col, pct in null_pct.items():
            if pct > POLICIES["completeness"]["critical_threshold"]:
                col_status[col] = "CRITICAL"
            elif pct > POLICIES["completeness"]["warning_threshold"]:
                col_status[col] = "WARNING"
            else:
                col_status[col] = "PASS"
        
        # Table completeness score = average non-null rate
        table_score = 100 - null_pct.mean()
        return {
            "score": round(float(table_score), 2),
            "column_metrics": null_pct.to_dict(),
            "column_status": col_status
        }

    def compute_uniqueness(self, df: pd.DataFrame, pk_cols: List[str]) -> Dict[str, Any]:
        """Dimension 2: Uniqueness - Duplicate PKs and Cardinality."""
        violations = []
        if len(df) == 0:
            return {"score": 0, "violations": [], "cardinality": {}}

        for pk in pk_cols:
            if pk in df.columns and df[pk].duplicated().any():
                violations.append({"column": pk, "issue": "Duplicate PK values", "severity": "CRITICAL"})
        
        cardinality = {}
        for col in df.columns:
            unique_count = df[col].nunique()
            card_pct = (unique_count / len(df)) * 100
            flag = None
            if card_pct < POLICIES["uniqueness"]["cardinality_enum_threshold"] and df[col].dtype == 'object':
                flag = "POSSIBLE_ENUM"
            cardinality[col] = {"pct": round(float(card_pct), 2), "flag": flag, "count": int(unique_count)}
            
        # Any duplicate PK is an immediate score drop
        score = 100 if not violations else 0
        return {"score": score, "violations": violations, "cardinality": cardinality}

    def compute_freshness(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Dimension 3: Freshness - Age of data."""
        date_cols = [col for col in df.columns if pd.api.types.is_datetime64_any_dtype(df[col]) or "date" in col.lower() or "time" in col.lower()]
        reports = {}
        now = datetime.now()
        
        if not date_cols or len(df) == 0:
            return {"score": 100.0, "columns": {}} # Default pass if no dates

        for col in date_cols:
            try:
                vals = pd.to_datetime(df[col], errors='coerce').dropna()
                if vals.empty: continue
                max_date = vals.max()
                days_ago = (now - max_date).days
                status = "DATA_STALE" if days_ago > POLICIES["freshness"]["stale_days_threshold"] else "FRESH"
                # Linear decay: 100 at 0 days, 0 at max_decay_days
                decay_limit = POLICIES["freshness"]["max_freshness_decay_days"]
                score = max(0, 100 - (days_ago / decay_limit * 100))
                reports[col] = {
                    "days_ago": int(days_ago), 
                    "status": status, 
                    "score": round(float(score), 2), 
                    "max_date": max_date.isoformat()
                }
            except: continue
        
        avg_score = np.mean([r["score"] for r in reports.values()]) if reports else 100.0
        return {"score": round(float(avg_score), 2), "columns": reports}

    def compute_fk_integrity(self, table_name: str, fks: List[Dict]) -> Dict[str, Any]:
        """Dimension 4: FK Integrity - Orphan row detection."""
        breaches = []
        scores = []
        
        for fk in fks:
            child_col = fk["column"]
            parent_table = fk["references_table"]
            parent_col = fk["references_column"]
            
            try:
                # Use DuckDB for anti-join
                query = f"""
                    SELECT COUNT(*) FROM db."{table_name}" c
                    LEFT ANTI JOIN db."{parent_table}" p ON c."{child_col}" = p."{parent_col}"
                    WHERE c."{child_col}" IS NOT NULL
                """
                orphans = self.con.execute(query).fetchone()[0]
                total = self.con.execute(f'SELECT COUNT(*) FROM db."{table_name}" WHERE "{child_col}" IS NOT NULL').fetchone()[0]
                
                integrity_pct = ((total - orphans) / total * 100) if total > 0 else 100.0
                scores.append(integrity_pct)
                if integrity_pct < POLICIES["fk_integrity"]["breach_threshold_pct"]:
                    breaches.append({
                        "fk": f"{child_col} -> {parent_table}.{parent_col}", 
                        "orphans": int(orphans), 
                        "integrity": round(float(integrity_pct), 2),
                        "severity": "FK_BREACH"
                    })
            except: continue

        avg_score = np.mean(scores) if scores else 100.0
        return {"score": round(float(avg_score), 2), "breaches": breaches}

    def compute_validity(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Dimension 5: Validity - Outliers and Domain Rules."""
        violations = []
        num_cols = df.select_dtypes(include=[np.number]).columns
        
        if len(df) == 0:
            return {"score": 0, "violations": []}

        for col in num_cols:
            Q1 = df[col].quantile(0.25)
            Q3 = df[col].quantile(0.75)
            IQR = Q3 - Q1
            lower = Q1 - POLICIES["validity"]["outlier_multiplier"] * IQR
            upper = Q3 + POLICIES["validity"]["outlier_multiplier"] * IQR
            outliers_mask = (df[col] < lower) | (df[col] > upper)
            outlier_count = outliers_mask.sum()
            outlier_pct = (outlier_count / len(df)) * 100
            
            if outlier_pct > POLICIES["validity"]["outlier_violation_threshold_pct"]:
                violations.append({
                    "column": col, 
                    "issue": "OUTLIER_WARNING", 
                    "pct": round(float(outlier_pct), 2),
                    "count": int(outlier_count)
                })
            
            # Domain specific
            col_lower = col.lower()
            if "price" in col_lower or "amount" in col_lower:
                zeros = (df[col] == 0).sum()
                if zeros > 0: 
                    violations.append({"column": col, "issue": "INVALID_PRICE", "count": int(zeros)})
            if "discount" in col_lower:
                invalid_range = (df[col] > 1.0).sum()
                if invalid_range > 0: 
                    violations.append({"column": col, "issue": "INVALID_RANGE", "count": int(invalid_range)})
        
        score = max(0, 100 - (len(violations) * 10))
        return {"score": score, "violations": violations}

    def compute_consistency(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Dimension 6: Consistency - Cross-column logic."""
        violations = []
        if len(df) == 0:
            return {"score": 0, "violations": []}

        # Date sequence check
        if "shipped_date" in df.columns and "order_date" in df.columns:
            try:
                bad_mask = pd.to_datetime(df["shipped_date"], errors='coerce') < pd.to_datetime(df["order_date"], errors='coerce')
                bad_count = bad_mask.sum()
                if bad_count > 0:
                    violations.append({"issue": "DATE_SEQUENCE_VIOLATION", "count": int(bad_count)})
            except: pass
            
        # Enum set check
        if "order_status" in df.columns:
            invalid_mask = ~df["order_status"].isin(POLICIES["consistency"]["expected_order_statuses"])
            invalid_count = invalid_mask.sum()
            if invalid_count > 0:
                violations.append({"issue": "INVALID_STATUS", "count": int(invalid_count)})
                
        score = 100 if not violations else max(0, 100 - (len(violations) * 20))
        return {"score": float(score), "violations": violations}

    def get_stats(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Comprehensive descriptive statistics."""
        stats = {}
        for col in df.columns:
            col_data = df[col].dropna()
            if col_data.empty: 
                stats[col] = {"issue": "All values are NULL"}
                continue
            
            if pd.api.types.is_numeric_dtype(df[col]):
                q1 = col_data.quantile(0.25)
                q3 = col_data.quantile(0.75)
                iqr = q3 - q1
                stats[col] = {
                    "type": "numeric",
                    "mean": float(col_data.mean()), 
                    "median": float(col_data.median()), 
                    "mode": float(col_data.mode()[0]) if not col_data.mode().empty else None,
                    "std": float(col_data.std()), 
                    "var": float(col_data.var()), 
                    "min": float(col_data.min()), 
                    "max": float(col_data.max()),
                    "range": float(col_data.max() - col_data.min()), 
                    "q1": float(q1), 
                    "q3": float(q3),
                    "iqr": float(iqr), 
                    "skew": float(col_data.skew()), 
                    "kurtosis": float(col_data.kurtosis()),
                    "count": int(len(col_data))
                }
            elif pd.api.types.is_datetime64_any_dtype(df[col]) or "date" in col.lower():
                try:
                    dt_data = pd.to_datetime(col_data, errors='coerce').dropna()
                    if dt_data.empty: continue
                    stats[col] = {
                        "type": "date",
                        "earliest": dt_data.min().isoformat(), 
                        "latest": dt_data.max().isoformat(),
                        "range_days": int((dt_data.max() - dt_data.min()).days),
                        "most_common_year": int(dt_data.dt.year.mode()[0]) if not dt_data.dt.year.mode().empty else None,
                        "most_common_month": int(dt_data.dt.month.mode()[0]) if not dt_data.dt.month.mode().empty else None
                    }
                except: pass
            else: # Text / Object
                stats[col] = {
                    "type": "text",
                    "most_freq": str(col_data.mode()[0]) if not col_data.mode().empty else None,
                    "least_freq": str(col_data.value_counts().idxmin()) if not col_data.empty else None,
                    "unique_count": int(col_data.nunique()),
                    "avg_len": float(col_data.astype(str).str.len().mean()),
                    "min_len": int(col_data.astype(str).str.len().min()),
                    "max_len": int(col_data.astype(str).str.len().max())
                }
        return stats

    def generate_charts(self, table_results: Dict[str, Dict], current_table: str, df: pd.DataFrame) -> Dict[str, Any]:
        """Generate 10 Plotly visualizations."""
        charts = {}
        res = table_results[current_table]
        
        # 1. Quality Overview (Horizontal bar for all tables)
        overview_data = []
        for t, r in table_results.items():
            score = r["weighted_score"]
            color = "green" if score > 90 else "orange" if score > 70 else "red"
            overview_data.append({"Table": t, "Score": score, "Color": color})
        fig1 = px.bar(overview_data, x="Score", y="Table", orientation='h', title="Database Quality Overview",
                     color="Color", color_discrete_map={"green": "#22C55E", "orange": "#FACC15", "red": "#EF4444"})
        charts["overview"] = fig1
        
        # 2. Null Heatmap
        null_matrix = pd.DataFrame({col: [pct] for col, pct in res["completeness"]["column_metrics"].items()}, index=[current_table])
        fig2 = px.imshow(null_matrix, title="Null percentage Heatmap", color_continuous_scale="Reds", zmin=0, zmax=100)
        charts["null_heatmap"] = fig2
        
        # 3. Completeness Radar
        dims = ["Completeness", "Uniqueness", "Freshness", "Integrity", "Validity", "Consistency"]
        vals = [res["completeness"]["score"], res["uniqueness"]["score"], res["freshness"]["score"], 
                res["fk_integrity"]["score"], res["validity"]["score"], res["consistency"]["score"]]
        fig3 = go.Figure(data=go.Scatterpolar(r=vals, theta=dims, fill='toself'))
        fig3.update_layout(polar=dict(radialaxis=dict(visible=True, range=[0, 100])), title=f"Quality Radar: {current_table}")
        charts["radar"] = fig3
        
        num_cols = df.select_dtypes(include=[np.number]).columns
        if not num_cols.empty:
            sel_col = num_cols[0]
            # 4. Distribution Histogram
            fig4 = px.histogram(df, x=sel_col, title=f"Distribution: {sel_col}", marginal="box", nbins=30)
            charts["distribution"] = fig4
            
            # 5. Box Plot
            fig5 = px.box(df, y=sel_col, title=f"Statistical Box Plot: {sel_col}", points="outliers")
            charts["box_plot"] = fig5
            
            # 6. Correlation Heatmap
            if len(num_cols) > 1:
                corr = df[num_cols].corr()
                fig6 = px.imshow(corr, text_auto=True, title="Pearson Correlation Heatmap", color_continuous_scale="RdBu_r", zmin=-1, zmax=1)
                charts["correlation"] = fig6
            
            # 9. Outlier Scatter
            fig9 = px.scatter(df, y=sel_col, title=f"Outlier Detection: {sel_col}")
            # Add IQR lines
            Q1 = df[sel_col].quantile(0.25)
            Q3 = df[sel_col].quantile(0.75)
            IQR = Q3 - Q1
            fig9.add_hline(y=Q1 - 1.5*IQR, line_dash="dash", line_color="red")
            fig9.add_hline(y=Q3 + 1.5*IQR, line_dash="dash", line_color="red")
            charts["outlier_scatter"] = fig9

        # 7. Freshness Timeline
        if res["freshness"]["columns"]:
            t_data = []
            for c, f in res["freshness"]["columns"].items():
                t_data.append({"Column": c, "Date": f["max_date"], "Status": f["status"]})
            fig7 = px.scatter(t_data, x="Date", y="Column", color="Status", title="Data Freshness Timeline")
            charts["freshness_timeline"] = fig7

        # 8. Cardinality Bar
        card_data = [{"Column": k, "Cardinality %": v["pct"]} for k, v in res["uniqueness"]["cardinality"].items()]
        fig8 = px.bar(card_data, x="Column", y="Cardinality %", title="Column Cardinality")
        fig8.add_hline(y=5, line_dash="dash", line_color="red", annotation_text="Enumeration Threshold")
        charts["cardinality_bar"] = fig8

        # 10. Policy Violation Summary (Stacked Bar)
        v_data = [
            {"Table": current_table, "Type": "Uniqueness", "Count": len(res["uniqueness"]["violations"])},
            {"Table": current_table, "Type": "FK Breach", "Count": len(res["fk_integrity"]["breaches"])},
            {"Table": current_table, "Type": "Validity", "Count": len(res["validity"]["violations"])},
            {"Table": current_table, "Type": "Consistency", "Count": len(res["consistency"]["violations"])},
        ]
        fig10 = px.bar(v_data, x="Table", y="Count", color="Type", title="Policy Violation Summary")
        charts["policy_violations"] = fig10

        return charts

def run_quality_pipeline(schema: Dict, db_path: str) -> Dict[str, Any]:
    """Execute complete metrics pipeline."""
    engine = QualityEngine(db_path)
    table_results = {}
    
    # Analyze every table
    for tbl in schema.get("tables", []):
        tname = tbl["name"]
        df = engine.get_df(tname)
        
        # Dimensions
        comp = engine.compute_completeness(df)
        uniq = engine.compute_uniqueness(df, tbl.get("primary_keys", []))
        fresh = engine.compute_freshness(df)
        
        # FKs related to this table
        table_fks = [fk for fk in schema.get("relationships", []) if fk["from_table"] == tname]
        intgr = engine.compute_fk_integrity(tname, table_fks)
        
        valid = engine.compute_validity(df)
        cons = engine.compute_consistency(df)
        
        # Weighted Score
        w = POLICIES["weights"]
        weighted_score = (
            comp["score"] * w["completeness"] +
            uniq["score"] * w["uniqueness"] +
            intgr["score"] * w["fk_integrity"] +
            fresh["score"] * w["freshness"] +
            valid["score"] * w["validity"] +
            cons["score"] * w["consistency"]
        )
        
        table_results[tname] = {
            "completeness": comp,
            "uniqueness": uniq,
            "freshness": fresh,
            "fk_integrity": intgr,
            "validity": valid,
            "consistency": cons,
            "weighted_score": round(float(weighted_score), 2),
            "stats": engine.get_stats(df)
        }
        
    # Generate charts and final metadata
    final_reports = {}
    for tname in table_results.keys():
        df = engine.get_df(tname)
        report = table_results[tname]
        report["charts"] = engine.generate_charts(table_results, tname, df)
        
        # Human readable suggestions
        suggestions = []
        if report["completeness"]["score"] < 90: suggestions.append("Consider backfilling NULL values in critical columns.")
        if report["fk_integrity"]["breaches"]: suggestions.append("Repair orphan records in foreign key relationships.")
        if report["freshness"]["score"] < 50: suggestions.append("Update data source; recent records are missing.")
        report["remediation_suggestions"] = suggestions
        
        final_reports[tname] = report

    # Export to Streamlit session state
    try:
        import streamlit as st
        st.session_state.quality_reports = final_reports
    except ImportError:
        pass
        
    return final_reports

if __name__ == "__main__":
    # Example usage (stub)
    print("Quality Engine Module Loaded.")
