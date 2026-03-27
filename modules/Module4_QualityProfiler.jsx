import React, { useState, useMemo, useEffect } from 'react';

/**
 * Module 4 — QualityProfiler
 * ===========================
 * Runs SQL queries via the SQL.js database instance to compute
 * data quality metrics, then renders an interactive dashboard with
 * health scores, heatmap, column details, issues, and charts.
 *
 * @param {{ schemaJSON: object, sqlEngine: object }} props
 *   sqlEngine is the SQL.js db instance from Module 1
 */
export default function QualityProfiler({ schemaJSON, sqlEngine }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedTable, setSelectedTable] = useState(null);
  const [sortBy, setSortBy] = useState('null_rate');
  const [sortDesc, setSortDesc] = useState(true);
  const [showIssuesPanel, setShowIssuesPanel] = useState(false);

  const tables = schemaJSON?.tables || [];

  // ── Run profiling on mount ─────────────────────────────

  useEffect(() => {
    if (!sqlEngine || !tables.length) return;
    runProfiling();
  }, [sqlEngine, tables.length]);

  // ── SQL helpers ────────────────────────────────────────

  function sqlExec(query) {
    try {
      const result = sqlEngine.exec(query);
      if (!result.length) return [];
      return result[0].values;
    } catch { return []; }
  }

  function sqlScalar(query) {
    const rows = sqlExec(query);
    return rows.length ? rows[0][0] : null;
  }

  // ── Profiling engine ───────────────────────────────────

  async function runProfiling() {
    setLoading(true);
    const tableProfiles = [];
    const fkReport = [];
    const issues = [];
    const NUMERIC_TYPES = new Set(['INTEGER','INT','REAL','FLOAT','DOUBLE','NUMERIC','DECIMAL','NUMBER']);
    const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
    const now = new Date();

    for (const tbl of tables) {
      const { name, columns, foreign_keys = [], primary_keys = [] } = tbl;
      const rowCount = sqlScalar(`SELECT COUNT(*) FROM "${name}"`) || 0;

      if (rowCount === 0) {
        tableProfiles.push({
          table: name, row_count: 0, column_profiles: [],
          numeric_stats: [], freshness: [],
          avg_completeness: 0, freshness_score: 50, fk_integrity: 100,
          score: 0, score_color: 'red',
        });
        continue;
      }

      // Column profiles
      const colProfiles = [];
      for (const col of columns) {
        const nullCount = sqlScalar(`SELECT COUNT(*) - COUNT("${col.name}") FROM "${name}"`) || 0;
        const distinctCount = sqlScalar(`SELECT COUNT(DISTINCT "${col.name}") FROM "${name}"`) || 0;
        const nullRate = rowCount > 0 ? +(nullCount / rowCount * 100).toFixed(2) : 0;
        const completeness = +(100 - nullRate).toFixed(2);
        const uniqueness = rowCount > 0 ? +(distinctCount / rowCount * 100).toFixed(2) : 0;

        const profile = {
          column: col.name, type: col.type || 'TEXT',
          row_count: rowCount, null_count: nullCount,
          null_rate: nullRate, completeness,
          distinct_count: distinctCount, uniqueness,
        };

        // Numeric stats
        const baseType = (col.type || '').toUpperCase().split('(')[0].trim();
        if (NUMERIC_TYPES.has(baseType)) {
          const stats = sqlExec(`SELECT MIN("${col.name}"), MAX("${col.name}"), AVG("${col.name}") FROM "${name}" WHERE "${col.name}" IS NOT NULL`);
          if (stats.length) {
            profile.min = stats[0][0];
            profile.max = stats[0][1];
            profile.avg = stats[0][2] != null ? +stats[0][2].toFixed(4) : null;
          }
        }

        // Freshness (datetime or text that looks like date)
        let isDate = ['DATETIME','TIMESTAMP','DATE','TIME'].includes(baseType);
        if (!isDate) {
          const sample = sqlExec(`SELECT "${col.name}" FROM "${name}" WHERE "${col.name}" IS NOT NULL LIMIT 5`);
          if (sample.length && sample.every(r => r[0] && DATE_RE.test(String(r[0])))) isDate = true;
        }
        if (isDate) {
          const dateRange = sqlExec(`SELECT MIN("${col.name}"), MAX("${col.name}") FROM "${name}" WHERE "${col.name}" IS NOT NULL`);
          if (dateRange.length && dateRange[0][1]) {
            const maxDate = new Date(String(dateRange[0][1]).slice(0, 19));
            if (!isNaN(maxDate)) {
              const days = Math.floor((now - maxDate) / (1000 * 60 * 60 * 24));
              profile.freshness_days = days;
              profile.freshness_score = freshnessToScore(days);
              profile.min_date = dateRange[0][0];
              profile.max_date = dateRange[0][1];
            }
          }
        }

        colProfiles.push(profile);

        // Issues: high null rate
        if (nullRate > 50) {
          issues.push({
            severity: nullRate > 80 ? 'critical' : 'warning',
            table: name, column: col.name,
            issue: `High null rate: ${nullRate}%`, code: 'HIGH_NULL_RATE',
          });
        }
        // Issues: low uniqueness
        if (uniqueness < 5 && distinctCount > 0 && rowCount > 10) {
          issues.push({
            severity: 'info', table: name, column: col.name,
            issue: `Low uniqueness: ${uniqueness}% (${distinctCount} distinct)`,
            code: 'LOW_UNIQUENESS',
          });
        }
        // Stale data
        if (profile.freshness_days != null && profile.freshness_days > 365) {
          issues.push({
            severity: 'warning', table: name, column: col.name,
            issue: `Stale data: last record ${profile.freshness_days} days ago`,
            code: 'STALE_DATA',
          });
        }
      }

      const avgCompleteness = colProfiles.length
        ? +(colProfiles.reduce((s, c) => s + c.completeness, 0) / colProfiles.length).toFixed(2)
        : 100;

      const freshCols = colProfiles.filter(c => c.freshness_score != null);
      const avgFreshness = freshCols.length
        ? +(freshCols.reduce((s, c) => s + c.freshness_score, 0) / freshCols.length).toFixed(2)
        : 80;

      tableProfiles.push({
        table: name, row_count: rowCount,
        column_profiles: colProfiles, avg_completeness: avgCompleteness,
        freshness_score: avgFreshness,
      });

      // FK integrity
      for (const fk of foreign_keys) {
        const total = sqlScalar(`SELECT COUNT(*) FROM "${name}" WHERE "${fk.column}" IS NOT NULL`) || 0;
        const orphaned = sqlScalar(
          `SELECT COUNT(*) FROM "${name}" WHERE "${fk.column}" IS NOT NULL AND "${fk.column}" NOT IN (SELECT "${fk.references_column}" FROM "${fk.references_table}")`
        ) || 0;
        const integrity = total > 0 ? +((total - orphaned) / total * 100).toFixed(2) : 100;

        fkReport.push({
          child_table: name, child_column: fk.column,
          parent_table: fk.references_table, parent_column: fk.references_column,
          total_fk_values: total, orphaned_count: orphaned,
          integrity_pct: integrity, inferred: fk.inferred || false,
        });

        if (integrity < 100) {
          issues.push({
            severity: integrity < 80 ? 'critical' : 'warning',
            table: name, column: fk.column,
            issue: `FK integrity: ${integrity}% — ${orphaned} orphaned → ${fk.references_table}.${fk.references_column}`,
            code: 'FK_INTEGRITY_FAILURE',
          });
        }
      }
    }

    // Compute per-table FK integrity & scores
    const fkByTable = {};
    fkReport.forEach(fk => {
      if (!fkByTable[fk.child_table]) fkByTable[fk.child_table] = [];
      fkByTable[fk.child_table].push(fk.integrity_pct);
    });

    for (const tp of tableProfiles) {
      const fkVals = fkByTable[tp.table] || [100];
      tp.fk_integrity = +(fkVals.reduce((a, b) => a + b, 0) / fkVals.length).toFixed(2);
      tp.score = scoreTable(tp.avg_completeness, tp.fk_integrity, tp.freshness_score);
      tp.score_color = scoreColor(tp.score);
    }

    const nonEmpty = tableProfiles.filter(t => t.row_count > 0);
    const overallHealth = nonEmpty.length
      ? +(nonEmpty.reduce((s, t) => s + t.score, 0) / nonEmpty.length).toFixed(2)
      : 0;

    const avgFKIntegrity = fkReport.length
      ? +(fkReport.reduce((s, f) => s + f.integrity_pct, 0) / fkReport.length).toFixed(2)
      : 100;

    // Sort issues by severity
    const sevOrder = { critical: 0, warning: 1, info: 2 };
    issues.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

    setReport({
      overall_health: overallHealth,
      overall_color: scoreColor(overallHealth),
      table_profiles: tableProfiles,
      fk_report: fkReport,
      avg_fk_integrity: avgFKIntegrity,
      issues,
    });
    setLoading(false);
  }

  function freshnessToScore(days) {
    if (days <= 1) return 100;
    if (days <= 7) return 95;
    if (days <= 30) return 85;
    if (days <= 90) return 70;
    if (days <= 365) return 50;
    return 25;
  }

  function scoreTable(comp, fkInt, fresh) {
    return +Math.min(100, Math.max(0, comp * 0.4 + fkInt * 0.3 + fresh * 0.2 + 80 * 0.1)).toFixed(2);
  }

  function scoreColor(score) {
    if (score >= 90) return 'green';
    if (score >= 75) return 'yellow';
    if (score >= 50) return 'orange';
    return 'red';
  }

  const colorMap = {
    green: { bg: 'bg-emerald-500', text: 'text-emerald-400', ring: 'ring-emerald-500/30', bar: '#22c55e' },
    yellow: { bg: 'bg-yellow-500', text: 'text-yellow-400', ring: 'ring-yellow-500/30', bar: '#eab308' },
    orange: { bg: 'bg-orange-500', text: 'text-orange-400', ring: 'ring-orange-500/30', bar: '#f97316' },
    red: { bg: 'bg-red-500', text: 'text-red-400', ring: 'ring-red-500/30', bar: '#ef4444' },
  };

  // ── Selected table detail ──────────────────────────────

  const activeProfile = report?.table_profiles?.find(t => t.table === selectedTable);

  const sortedColumns = useMemo(() => {
    if (!activeProfile) return [];
    const cols = [...activeProfile.column_profiles];
    cols.sort((a, b) => {
      const av = a[sortBy] ?? 0;
      const bv = b[sortBy] ?? 0;
      return sortDesc ? bv - av : av - bv;
    });
    return cols;
  }, [activeProfile, sortBy, sortDesc]);

  // ── Cell color for heatmap ─────────────────────────────

  function heatColor(value) {
    if (value >= 95) return 'bg-emerald-500/20 text-emerald-300';
    if (value >= 80) return 'bg-emerald-500/10 text-emerald-400';
    if (value >= 60) return 'bg-yellow-500/15 text-yellow-300';
    if (value >= 40) return 'bg-orange-500/15 text-orange-300';
    return 'bg-red-500/15 text-red-300';
  }

  // ── Loading / empty states ─────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Running quality analysis…</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <p className="text-gray-500">Waiting for database connection…</p>
      </div>
    );
  }

  const cm = colorMap[report.overall_color] || colorMap.green;

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">

      {/* ── Header ── */}
      <div className="p-5 border-b border-gray-700/50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-amber-400 to-orange-400">
                Data Quality Report
              </span>
            </h1>
            <p className="text-xs text-gray-400 mt-1">
              {schemaJSON?.metadata?.database_name} — {tables.length} tables analysed
            </p>
          </div>
          <button
            onClick={() => setShowIssuesPanel(!showIssuesPanel)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showIssuesPanel ? 'bg-red-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
          >
            ⚠ {report.issues.length} Issues
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-5 space-y-6">

        {/* ── 1. Overall Health Score ── */}
        <div className="flex flex-col items-center py-6">
          <div className={`relative w-32 h-32 rounded-full ring-4 ${cm.ring} flex items-center justify-center`}
            style={{ background: `conic-gradient(${cm.bar} ${report.overall_health * 3.6}deg, #1f2937 0deg)` }}>
            <div className="absolute inset-2 bg-gray-900 rounded-full flex items-center justify-center flex-col">
              <span className={`text-3xl font-bold ${cm.text}`}>{report.overall_health}</span>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">/ 100</span>
            </div>
          </div>
          <p className="text-sm text-gray-400 mt-3">Database Health Score</p>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            <span>Completeness-weighted 40%</span>
            <span>FK Integrity 30%</span>
            <span>Freshness 20%</span>
            <span>Consistency 10%</span>
          </div>
        </div>

        {/* ── 2. Table Quality Heatmap ── */}
        <div className="rounded-xl border border-gray-700/50 overflow-hidden">
          <div className="px-4 py-3 bg-gray-800/60 border-b border-gray-700/50">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Table Quality Heatmap</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-700/50">
                  <th className="text-left px-4 py-2.5 font-medium">Table</th>
                  <th className="text-right px-3 py-2.5 font-medium">Rows</th>
                  <th className="text-center px-3 py-2.5 font-medium">Completeness</th>
                  <th className="text-center px-3 py-2.5 font-medium">FK Integrity</th>
                  <th className="text-center px-3 py-2.5 font-medium">Freshness</th>
                  <th className="text-center px-3 py-2.5 font-medium">Score</th>
                  <th className="text-center px-3 py-2.5 font-medium">Grade</th>
                </tr>
              </thead>
              <tbody>
                {report.table_profiles.map(tp => {
                  const tcm = colorMap[tp.score_color] || colorMap.green;
                  const isActive = selectedTable === tp.table;
                  return (
                    <tr
                      key={tp.table}
                      onClick={() => setSelectedTable(isActive ? null : tp.table)}
                      className={`border-b border-gray-800/50 cursor-pointer transition-colors
                        ${isActive ? 'bg-blue-500/10' : 'hover:bg-gray-800/40'}`}
                    >
                      <td className="px-4 py-2.5 font-medium text-gray-200">{tp.table}</td>
                      <td className="px-3 py-2.5 text-right text-gray-400 font-mono text-xs">
                        {tp.row_count.toLocaleString()}
                      </td>
                      <td className={`px-3 py-2.5 text-center font-mono text-xs ${heatColor(tp.avg_completeness)}`}>
                        {tp.avg_completeness}%
                      </td>
                      <td className={`px-3 py-2.5 text-center font-mono text-xs ${heatColor(tp.fk_integrity)}`}>
                        {tp.fk_integrity}%
                      </td>
                      <td className={`px-3 py-2.5 text-center font-mono text-xs ${heatColor(tp.freshness_score)}`}>
                        {tp.freshness_score}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`font-bold font-mono text-sm ${tcm.text}`}>{tp.score}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-block w-6 h-6 rounded-full text-[10px] font-bold leading-6 text-center ${tcm.bg} text-white`}>
                          {tp.score >= 90 ? 'A' : tp.score >= 75 ? 'B' : tp.score >= 50 ? 'C' : 'D'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── 3. Column Detail Table (on table click) ── */}
        {activeProfile && (
          <div className="rounded-xl border border-blue-500/20 overflow-hidden">
            <div className="px-4 py-3 bg-blue-500/5 border-b border-blue-500/20 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-blue-400 uppercase tracking-wider">
                {activeProfile.table} — Column Details
              </h2>
              <span className="text-xs text-gray-400">{activeProfile.column_profiles.length} columns · Click header to sort</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 uppercase tracking-wider border-b border-gray-700/50">
                    <th className="text-left px-4 py-2 font-medium">Column</th>
                    <th className="text-left px-3 py-2 font-medium">Type</th>
                    {[
                      ['null_rate', 'Null Rate'],
                      ['completeness', 'Complete'],
                      ['distinct_count', 'Distinct'],
                      ['uniqueness', 'Unique'],
                    ].map(([key, label]) => (
                      <th
                        key={key}
                        className="px-3 py-2 font-medium text-center cursor-pointer hover:text-gray-300"
                        onClick={() => {
                          if (sortBy === key) setSortDesc(!sortDesc);
                          else { setSortBy(key); setSortDesc(true); }
                        }}
                      >
                        {label} {sortBy === key ? (sortDesc ? '↓' : '↑') : ''}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium text-left">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedColumns.map((col, i) => {
                    const colIssues = report.issues.filter(
                      iss => iss.table === activeProfile.table && iss.column === col.column
                    );
                    return (
                      <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/30">
                        <td className="px-4 py-2 font-mono text-gray-200">{col.column}</td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{col.type}</span>
                        </td>
                        <td className={`px-3 py-2 text-center font-mono ${col.null_rate > 50 ? 'text-red-400' : col.null_rate > 20 ? 'text-yellow-400' : 'text-gray-400'}`}>
                          {col.null_rate}%
                        </td>
                        <td className={`px-3 py-2 text-center font-mono ${heatColor(col.completeness)}`}>
                          {col.completeness}%
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-gray-400">{col.distinct_count.toLocaleString()}</td>
                        <td className={`px-3 py-2 text-center font-mono ${col.uniqueness < 5 ? 'text-orange-400' : 'text-gray-400'}`}>
                          {col.uniqueness}%
                        </td>
                        <td className="px-3 py-2">
                          {colIssues.map((iss, j) => (
                            <span key={j} className={`inline-block mr-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${
                              iss.severity === 'critical' ? 'bg-red-500/15 text-red-400'
                              : iss.severity === 'warning' ? 'bg-yellow-500/15 text-yellow-400'
                              : 'bg-blue-500/15 text-blue-400'
                            }`}>
                              {iss.code}
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 4. Quality Score Bar Chart (pure CSS) ── */}
        <div className="rounded-xl border border-gray-700/50 overflow-hidden">
          <div className="px-4 py-3 bg-gray-800/60 border-b border-gray-700/50">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Score per Table</h2>
          </div>
          <div className="p-4 space-y-2">
            {report.table_profiles
              .filter(tp => tp.row_count > 0)
              .sort((a, b) => b.score - a.score)
              .map(tp => {
                const tcm = colorMap[tp.score_color] || colorMap.green;
                return (
                  <div key={tp.table} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-40 truncate text-right">{tp.table}</span>
                    <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${tp.score}%`, backgroundColor: tcm.bar }}
                      />
                    </div>
                    <span className={`text-xs font-bold font-mono w-12 text-right ${tcm.text}`}>
                      {tp.score}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>

        {/* ── 5. Completeness Distribution ── */}
        <div className="grid grid-cols-2 gap-4">
          {/* Completeness buckets */}
          <div className="rounded-xl border border-gray-700/50 overflow-hidden">
            <div className="px-4 py-3 bg-gray-800/60 border-b border-gray-700/50">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Completeness Distribution</h2>
            </div>
            <div className="p-4">
              {(() => {
                const allCols = report.table_profiles.flatMap(tp => tp.column_profiles);
                const buckets = [
                  { label: '95-100%', min: 95, max: 100, color: '#22c55e' },
                  { label: '80-95%', min: 80, max: 95, color: '#84cc16' },
                  { label: '60-80%', min: 60, max: 80, color: '#eab308' },
                  { label: '40-60%', min: 40, max: 60, color: '#f97316' },
                  { label: '0-40%', min: 0, max: 40, color: '#ef4444' },
                ];
                const total = allCols.length || 1;
                return buckets.map(b => {
                  const count = allCols.filter(c => c.completeness >= b.min && c.completeness < (b.max === 100 ? 101 : b.max)).length;
                  const pct = (count / total * 100).toFixed(0);
                  return (
                    <div key={b.label} className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-400 w-16">{b.label}</span>
                      <div className="flex-1 h-4 bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: b.color }} />
                      </div>
                      <span className="text-xs text-gray-400 w-16 text-right">{count} ({pct}%)</span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* FK Integrity summary */}
          <div className="rounded-xl border border-gray-700/50 overflow-hidden">
            <div className="px-4 py-3 bg-gray-800/60 border-b border-gray-700/50">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">FK Integrity</h2>
            </div>
            <div className="p-4 space-y-2">
              {report.fk_report.length === 0 ? (
                <p className="text-sm text-gray-500">No FK relationships to check</p>
              ) : report.fk_report.map((fk, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${fk.integrity_pct >= 100 ? 'bg-emerald-400' : fk.integrity_pct >= 80 ? 'bg-yellow-400' : 'bg-red-400'}`} />
                  <span className="text-gray-300 truncate flex-1">
                    {fk.child_table}.{fk.child_column} → {fk.parent_table}
                  </span>
                  <span className={`font-mono font-medium ${fk.integrity_pct >= 100 ? 'text-emerald-400' : fk.integrity_pct >= 80 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {fk.integrity_pct}%
                  </span>
                  {fk.orphaned_count > 0 && (
                    <span className="text-red-400 text-[10px]">({fk.orphaned_count} orphaned)</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Issues Slide-out Panel ── */}
      {showIssuesPanel && (
        <div className="fixed inset-y-0 right-0 w-96 bg-gray-900 border-l border-gray-700 shadow-2xl z-50 flex flex-col">
          <div className="p-4 border-b border-gray-700/50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider">
              ⚠ Issues ({report.issues.length})
            </h2>
            <button onClick={() => setShowIssuesPanel(false)}
              className="text-gray-500 hover:text-white text-lg">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {report.issues.map((iss, i) => (
              <div key={i} className={`p-3 rounded-lg border ${
                iss.severity === 'critical' ? 'bg-red-500/5 border-red-500/20'
                : iss.severity === 'warning' ? 'bg-yellow-500/5 border-yellow-500/20'
                : 'bg-blue-500/5 border-blue-500/20'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span>{iss.severity === 'critical' ? '🔴' : iss.severity === 'warning' ? '🟡' : '🔵'}</span>
                  <span className="text-[10px] font-mono text-gray-500">{iss.code}</span>
                </div>
                <p className="text-xs text-gray-300">
                  <span className="text-gray-500">{iss.table}</span>
                  {iss.column && <span className="text-gray-500">.{iss.column}</span>}
                  <span className="mx-1">—</span>
                  {iss.issue}
                </p>
              </div>
            ))}
            {report.issues.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-8">No issues detected ✅</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
