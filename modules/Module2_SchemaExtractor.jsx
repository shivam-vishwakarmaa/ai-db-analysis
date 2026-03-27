import React, { useState, useMemo } from 'react';

/**
 * Module 2 — SchemaExtractor
 * ==========================
 * Reads Standard Schema JSON from Module 1 and renders an interactive
 * two-panel schema viewer with anomaly detection, table role badges,
 * and an aggregated stats bar.
 *
 * @param {{ schemaJSON: object }} props
 */
export default function SchemaExtractor({ schemaJSON }) {
  const [selectedTable, setSelectedTable] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // ── Table role classifier ──────────────────────────────

  function classifyRole(table, allTables) {
    const outFKs = (table.foreign_keys || []).length;
    const colCount = (table.columns || []).length;
    const isReferenced = allTables.some(t =>
      t.name !== table.name &&
      (t.foreign_keys || []).some(fk => fk.references_table === table.name)
    );

    if (outFKs === 0 && !isReferenced) return 'isolated';
    if (outFKs === 2 && colCount <= outFKs + 2) return 'junction';
    if (outFKs >= 2) return 'fact';
    if (isReferenced) return 'dimension';
    return 'dimension';
  }

  // ── Anomaly detection ──────────────────────────────────

  function detectAnomalies(tables) {
    const anomalies = [];
    const fkColsMap = {};
    tables.forEach(t => {
      fkColsMap[t.name] = new Set((t.foreign_keys || []).map(fk => fk.column));
    });

    tables.forEach(t => {
      if (t.row_count === 0) {
        anomalies.push({ table: t.name, column: null, severity: 'warning', message: `Table '${t.name}' has 0 rows`, code: 'EMPTY_TABLE' });
      }
      if (!(t.primary_keys || []).length) {
        anomalies.push({ table: t.name, column: null, severity: 'error', message: `Table '${t.name}' has no primary key`, code: 'NO_PRIMARY_KEY' });
      }
      const AMBIGUOUS = new Set(['id','data','value','info','name','type','status','code','key','flag','desc','text','note','temp']);
      (t.columns || []).forEach(c => {
        if (AMBIGUOUS.has(c.name.toLowerCase())) {
          anomalies.push({ table: t.name, column: c.name, severity: 'info', message: `Column '${c.name}' has an ambiguous name`, code: 'AMBIGUOUS_NAME' });
        }
        if (c.name.endsWith('_id') && !fkColsMap[t.name]?.has(c.name) && !c.primary_key) {
          anomalies.push({ table: t.name, column: c.name, severity: 'warning', message: `Column '${c.name}' looks like a FK but has no constraint`, code: 'ORPHAN_FK_COLUMN' });
        }
      });
      // All-null columns from sample
      const sample = t.sample_data || [];
      if (sample.length > 0) {
        (t.columns || []).forEach(c => {
          if (sample.every(row => row[c.name] == null || row[c.name] === '')) {
            anomalies.push({ table: t.name, column: c.name, severity: 'warning', message: `Column '${c.name}' is entirely NULL in sample`, code: 'ALL_NULL_COLUMN' });
          }
        });
      }
    });
    return anomalies;
  }

  // ── Computed data ──────────────────────────────────────

  const tables = schemaJSON?.tables || [];
  const meta = schemaJSON?.metadata || {};

  const enrichedTables = useMemo(() =>
    tables.map(t => ({
      ...t,
      role: classifyRole(t, tables),
    })),
    [tables]
  );

  const anomalies = useMemo(() => detectAnomalies(tables), [tables]);

  const anomaliesByTable = useMemo(() => {
    const map = {};
    anomalies.forEach(a => {
      if (!map[a.table]) map[a.table] = [];
      map[a.table].push(a);
    });
    return map;
  }, [anomalies]);

  const stats = useMemo(() => {
    let pks = 0, fks = 0, inferredFKs = 0;
    tables.forEach(t => {
      pks += (t.primary_keys || []).length;
      (t.foreign_keys || []).forEach(fk => {
        fks++;
        if (fk.inferred) inferredFKs++;
      });
    });
    return { pks, fks, inferredFKs, tablesWithAnomalies: Object.keys(anomaliesByTable).length };
  }, [tables, anomaliesByTable]);

  const filteredTables = useMemo(() => {
    if (!searchTerm) return enrichedTables;
    const q = searchTerm.toLowerCase();
    return enrichedTables.filter(t => t.name.toLowerCase().includes(q));
  }, [enrichedTables, searchTerm]);

  const active = selectedTable
    ? enrichedTables.find(t => t.name === selectedTable)
    : enrichedTables[0] || null;

  const activeAnomalies = active ? (anomaliesByTable[active.name] || []) : [];

  // ── Role styling ───────────────────────────────────────

  const roleMeta = {
    fact:      { bg: 'bg-blue-500/15',   text: 'text-blue-400',   border: 'border-blue-500/30',   dot: 'bg-blue-400'   },
    dimension: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
    junction:  { bg: 'bg-orange-500/15',  text: 'text-orange-400',  border: 'border-orange-500/30',  dot: 'bg-orange-400'  },
    isolated:  { bg: 'bg-gray-500/15',    text: 'text-gray-400',    border: 'border-gray-500/30',    dot: 'bg-gray-400'    },
  };

  const severityIcon = { error: '🔴', warning: '🟡', info: '🔵' };

  if (!schemaJSON || !tables.length) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <p className="text-gray-500 text-lg">No schema data provided.</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex flex-col">

      {/* ── Header / Overview Card ── */}
      <div className="p-5 border-b border-gray-700/50">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">
                  Schema Report
                </span>
              </h1>
              <p className="text-sm text-gray-400 mt-1">{meta.database_name}</p>
            </div>

            {/* Quick stat pills */}
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Tables', val: meta.total_tables, color: 'blue' },
                { label: 'Columns', val: meta.total_columns, color: 'purple' },
                { label: 'Rows', val: (meta.total_rows || 0).toLocaleString(), color: 'cyan' },
              ].map(s => (
                <span
                  key={s.label}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-${s.color}-500/10 text-${s.color}-400 border border-${s.color}-500/20`}
                >
                  {s.val} {s.label}
                </span>
              ))}

              {/* FK source badge */}
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                  meta.fk_source === 'explicit'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : meta.fk_source === 'inferred'
                    ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                    : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                }`}
              >
                {meta.fk_source === 'explicit' && '🔗 Explicit FKs'}
                {meta.fk_source === 'inferred' && '🔍 Inferred FKs'}
                {meta.fk_source === 'mixed' && '🔗🔍 Mixed FKs'}
              </span>

              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                meta.input_type === 'demo' ? 'bg-pink-500/10 text-pink-400 border border-pink-500/20' : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
              }`}>
                {meta.input_type?.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main two-panel layout ── */}
      <div className="flex flex-1 overflow-hidden max-w-7xl mx-auto w-full">

        {/* ── Left sidebar ── */}
        <aside className="w-72 min-w-[280px] border-r border-gray-700/50 bg-gray-900/40 flex flex-col">
          {/* Search */}
          <div className="p-3">
            <div className="relative">
              <input
                type="text"
                placeholder="Search tables…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pl-8 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
              <svg className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* Table list */}
          <nav className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
            {filteredTables.map(t => {
              const rm = roleMeta[t.role] || roleMeta.isolated;
              const isActive = active?.name === t.name;
              const hasAnoms = !!anomaliesByTable[t.name];
              return (
                <button
                  key={t.name}
                  onClick={() => setSelectedTable(t.name)}
                  className={`
                    w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left
                    transition-all duration-150 group
                    ${isActive
                      ? `${rm.bg} ${rm.border} border`
                      : 'hover:bg-gray-800/60 border border-transparent'
                    }
                  `}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${rm.dot}`} />
                    <span className={`text-sm truncate ${isActive ? 'font-semibold text-white' : 'text-gray-300'}`}>
                      {t.name}
                    </span>
                    {hasAnoms && <span className="text-xs">⚠️</span>}
                  </div>
                  <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
                    {t.row_count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Role legend */}
          <div className="p-3 border-t border-gray-700/50 space-y-1">
            {Object.entries(roleMeta).map(([role, rm]) => (
              <div key={role} className="flex items-center gap-2 text-xs text-gray-400">
                <span className={`w-2 h-2 rounded-full ${rm.dot}`} />
                <span className="capitalize">{role}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* ── Right detail panel ── */}
        <main className="flex-1 overflow-y-auto p-6">
          {active ? (
            <div className="space-y-6">
              {/* Table header */}
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold text-white">{active.name}</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${roleMeta[active.role]?.bg} ${roleMeta[active.role]?.text} border ${roleMeta[active.role]?.border}`}>
                  {active.role}
                </span>
                <span className="text-sm text-gray-400">
                  {active.row_count.toLocaleString()} rows · {active.columns.length} columns
                </span>
              </div>

              {/* ── Columns table ── */}
              <div className="rounded-xl border border-gray-700/50 overflow-hidden">
                <div className="px-4 py-3 bg-gray-800/60 border-b border-gray-700/50">
                  <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Columns</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-700/50">
                        <th className="text-left px-4 py-2.5 font-medium">Name</th>
                        <th className="text-left px-4 py-2.5 font-medium">Type</th>
                        <th className="text-center px-4 py-2.5 font-medium">Nullable</th>
                        <th className="text-center px-4 py-2.5 font-medium">PK</th>
                        <th className="text-left px-4 py-2.5 font-medium">FK Reference</th>
                        <th className="text-center px-4 py-2.5 font-medium">Unique</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.columns.map((col, i) => {
                        const fk = (active.foreign_keys || []).find(f => f.column === col.name);
                        const isPK = col.primary_key;
                        const isFK = !!fk;
                        const rowBg = isPK
                          ? 'bg-blue-500/5'
                          : isFK
                          ? 'bg-emerald-500/5'
                          : col.nullable
                          ? 'bg-yellow-500/[0.02]'
                          : '';

                        return (
                          <tr key={i} className={`border-b border-gray-800/50 ${rowBg} hover:bg-gray-800/40 transition-colors`}>
                            <td className="px-4 py-2.5 font-medium text-gray-200">
                              {col.name}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="px-2 py-0.5 rounded bg-gray-800 text-xs text-gray-300 font-mono">
                                {col.type}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {col.nullable
                                ? <span className="text-yellow-400 text-xs">Yes</span>
                                : <span className="text-gray-600 text-xs">No</span>
                              }
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {isPK && <span className="text-blue-400">🔑</span>}
                            </td>
                            <td className="px-4 py-2.5">
                              {fk && (
                                <span className="text-emerald-400 text-xs">
                                  → {fk.references_table}.{fk.references_column}
                                  <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    fk.inferred
                                      ? 'bg-yellow-500/15 text-yellow-400'
                                      : 'bg-emerald-500/15 text-emerald-400'
                                  }`}>
                                    {fk.inferred ? 'inferred' : 'explicit'}
                                  </span>
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {col.unique && <span className="text-purple-400 text-xs">✓</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Foreign Keys section ── */}
              {(active.foreign_keys || []).length > 0 && (
                <div className="rounded-xl border border-gray-700/50 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-800/60 border-b border-gray-700/50">
                    <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                      Foreign Keys ({active.foreign_keys.length})
                    </h3>
                  </div>
                  <div className="p-4 space-y-2">
                    {active.foreign_keys.map((fk, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-gray-300">{active.name}.<span className="text-blue-400">{fk.column}</span></span>
                        <span className="text-gray-500">→</span>
                        <span className="font-mono text-gray-300">{fk.references_table}.<span className="text-emerald-400">{fk.references_column}</span></span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          fk.inferred
                            ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
                            : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        }`}>
                          {fk.inferred ? 'INFERRED' : 'EXPLICIT'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Indexes section ── */}
              <div className="rounded-xl border border-gray-700/50 overflow-hidden">
                <div className="px-4 py-3 bg-gray-800/60 border-b border-gray-700/50">
                  <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Indexes</h3>
                </div>
                <div className="p-4">
                  {(active.indexes || []).length > 0
                    ? <div className="flex flex-wrap gap-2">
                        {active.indexes.map((idx, i) => (
                          <span key={i} className="px-2.5 py-1 rounded-lg bg-gray-800 text-xs text-gray-300 font-mono border border-gray-700/50">
                            {idx}
                          </span>
                        ))}
                      </div>
                    : <p className="text-sm text-gray-500">No indexes defined</p>
                  }
                </div>
              </div>

              {/* ── Anomalies section ── */}
              {activeAnomalies.length > 0 && (
                <div className="rounded-xl border border-red-500/20 overflow-hidden">
                  <div className="px-4 py-3 bg-red-500/5 border-b border-red-500/20">
                    <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider">
                      ⚠ Anomalies ({activeAnomalies.length})
                    </h3>
                  </div>
                  <div className="p-3 space-y-2">
                    {activeAnomalies.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-gray-900/50 border border-gray-700/30">
                        <span className="flex-shrink-0 mt-0.5">{severityIcon[a.severity] || '⚪'}</span>
                        <div>
                          <span className="text-xs font-mono text-gray-500">{a.code}</span>
                          <p className="text-sm text-gray-300 mt-0.5">{a.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Sample data preview ── */}
              {(active.sample_data || []).length > 0 && (
                <div className="rounded-xl border border-gray-700/50 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-800/60 border-b border-gray-700/50">
                    <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                      Sample Data (first {active.sample_data.length} rows)
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-700/50">
                          {active.columns.map(c => (
                            <th key={c.name} className="text-left px-3 py-2 font-medium whitespace-nowrap">{c.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {active.sample_data.map((row, ri) => (
                          <tr key={ri} className="border-b border-gray-800/30 hover:bg-gray-800/30">
                            {active.columns.map(c => (
                              <td key={c.name} className="px-3 py-1.5 text-gray-400 whitespace-nowrap max-w-[200px] truncate">
                                {row[c.name] != null ? String(row[c.name]) : <span className="text-gray-600 italic">NULL</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              Select a table from the sidebar
            </div>
          )}
        </main>
      </div>

      {/* ── Bottom stats bar ── */}
      <div className="border-t border-gray-700/50 bg-gray-900/60 px-5 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-6 text-xs text-gray-400">
          <span>🔑 <strong className="text-gray-300">{stats.pks}</strong> Primary Keys</span>
          <span className="text-gray-700">|</span>
          <span>🔗 <strong className="text-gray-300">{stats.fks}</strong> Foreign Keys</span>
          <span className="text-gray-700">|</span>
          <span>🔍 <strong className="text-yellow-400">{stats.inferredFKs}</strong> Inferred FKs</span>
          <span className="text-gray-700">|</span>
          <span>⚠️ <strong className={stats.tablesWithAnomalies > 0 ? 'text-red-400' : 'text-gray-300'}>{stats.tablesWithAnomalies}</strong> Tables with Anomalies</span>
        </div>
      </div>
    </div>
  );
}
