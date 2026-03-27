import React, { useState, useCallback, useRef } from 'react';

/*
 * Module 6 — DatabaseAnalysisDashboard
 * ======================================
 * Assembles all 5 modules into a unified tabbed dashboard.
 * Manages top-level state, pipeline progress, tab locking,
 * toast notifications, demo mode, and export panel.
 */

// ── Inline module imports (in production these come from separate files) ──
// For the merged artifact, all module code is inlined below.
// For the modular version, import from ./Module1_InputHandler etc.

// Placeholder imports — replace with actual imports in your build:
// import InputHandler from './Module1_InputHandler';
// import SchemaExtractor from './Module2_SchemaExtractor';
// import RelationshipMapper from './Module3_RelationshipMapper';
// import QualityProfiler from './Module4_QualityProfiler';
// import AIGenerator from './Module5_AIGenerator';

export default function DatabaseAnalysisDashboard() {
  // ── Top-level state ────────────────────────────────────
  const [schemaJSON, setSchemaJSON] = useState(null);
  const [sqlEngine, setSqlEngine] = useState(null);
  const [qualityReport, setQualityReport] = useState(null);
  const [aiOutputs, setAiOutputs] = useState(null);
  const [mermaidSyntax, setMermaidSyntax] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [pipelineStage, setPipelineStage] = useState(0); // 0-5
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  // ── Toast system ───────────────────────────────────────
  const addToast = useCallback((message, type = 'info') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  // ── Pipeline callbacks ─────────────────────────────────
  const onSchemaReady = useCallback((schema, engine) => {
    setSchemaJSON(schema);
    setSqlEngine(engine);
    setPipelineStage(s => Math.max(s, 1));
    addToast(`Schema extracted: ${schema.metadata?.total_tables} tables found`, 'success');
    setActiveTab(1);
  }, [addToast]);

  const onQualityReady = useCallback((report) => {
    setQualityReport(report);
    setPipelineStage(s => Math.max(s, 3));
    addToast(`Quality analysis complete: score ${report.overall_health}/100`, 'success');
  }, [addToast]);

  const onAIReady = useCallback((outputs) => {
    setAiOutputs(outputs);
    setPipelineStage(s => Math.max(s, 4));
    addToast('AI summaries generated', 'success');
  }, [addToast]);

  const onRelationshipsReady = useCallback((syntax) => {
    setMermaidSyntax(syntax);
    setPipelineStage(s => Math.max(s, 2));
    addToast('Relationships mapped', 'success');
  }, [addToast]);

  // ── Tab definitions ────────────────────────────────────
  const tabs = [
    { id: 0, label: 'Upload',        icon: '📤', minStage: 0 },
    { id: 1, label: 'Schema',        icon: '🗂',  minStage: 1 },
    { id: 2, label: 'Relationships', icon: '🔗', minStage: 1 },
    { id: 3, label: 'Quality',       icon: '📊', minStage: 1 },
    { id: 4, label: 'AI Insights',   icon: '✦',  minStage: 1 },
    { id: 5, label: 'Dictionary',    icon: '📖', minStage: 1 },
  ];

  // ── Export helpers ─────────────────────────────────────
  function exportJSON() {
    const data = { schema: schemaJSON, quality: qualityReport, ai: aiOutputs };
    download(JSON.stringify(data, null, 2), 'full_report.json', 'application/json');
  }
  function exportMarkdown() {
    let md = `# Database Analysis Report\n\n`;
    md += `**Database**: ${schemaJSON?.metadata?.database_name || '?'}\n`;
    md += `**Tables**: ${schemaJSON?.metadata?.total_tables || '?'}\n`;
    md += `**Health Score**: ${qualityReport?.overall_health || '?'}/100\n\n`;
    if (aiOutputs?.domain) {
      md += `## Executive Summary\n\n${aiOutputs.domain.executive_summary || ''}\n\n`;
    }
    if (aiOutputs?.summaries) {
      md += `## Business Summaries\n\n`;
      Object.entries(aiOutputs.summaries).forEach(([t, s]) => { md += `### ${t}\n\n${s}\n\n`; });
    }
    download(md, 'report.md', 'text/markdown');
  }
  function exportDictionaryCSV() {
    if (!aiOutputs?.dictionary) return;
    let csv = 'Table,Column,Description,Format,Sensitive\n';
    Object.entries(aiOutputs.dictionary).forEach(([t, dd]) => {
      (dd?.columns || []).forEach(c => {
        csv += `"${t}","${c.name}","${(c.description || '').replace(/"/g, '""')}","${c.format || ''}","${c.sensitive ? 'Yes' : 'No'}"\n`;
      });
    });
    download(csv, 'data_dictionary.csv', 'text/csv');
  }
  function download(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Demo mode (Chinook) ────────────────────────────────
  async function loadDemo() {
    addToast('Loading Chinook demo database…', 'info');
    try {
      const initSqlJs = window.initSqlJs || (await import('sql.js')).default;
      const SQL = await initSqlJs({ locateFile: f => `https://sql.js.org/dist/${f}` });
      const resp = await fetch('https://raw.githubusercontent.com/lerocha/chinook-database/master/ChinookDatabase/DataSources/Chinook_Sqlite.sqlite');
      const buf = await resp.arrayBuffer();
      const db = new SQL.Database(new Uint8Array(buf));

      // Extract schema
      const tableRows = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      const tableNames = tableRows[0]?.values.map(r => r[0]) || [];
      const tables = []; const relationships = [];
      let totalCols = 0, totalRows = 0;

      for (const tn of tableNames) {
        const info = db.exec(`PRAGMA table_info("${tn}")`);
        const fkInfo = db.exec(`PRAGMA foreign_key_list("${tn}")`);
        const countRes = db.exec(`SELECT COUNT(*) FROM "${tn}"`);
        const rowCount = countRes[0]?.values[0][0] || 0;
        const sampleRes = db.exec(`SELECT * FROM "${tn}" LIMIT 5`);

        const columns = (info[0]?.values || []).map(r => ({
          name: r[1], type: r[2] || 'TEXT', nullable: r[3] === 0,
          primary_key: r[5] === 1, unique: false,
        }));
        const pks = columns.filter(c => c.primary_key).map(c => c.name);
        const fks = (fkInfo[0]?.values || []).map(r => ({
          column: r[3], references_table: r[2], references_column: r[4], inferred: false,
        }));
        fks.forEach(fk => relationships.push({
          from_table: tn, from_column: fk.column,
          to_table: fk.references_table, to_column: fk.references_column,
          inferred: false, cardinality: 'one-to-many',
        }));

        const sampleCols = sampleRes[0]?.columns || [];
        const sampleData = (sampleRes[0]?.values || []).map(row => {
          const obj = {}; sampleCols.forEach((c, i) => { obj[c] = row[i]; }); return obj;
        });

        totalCols += columns.length; totalRows += rowCount;
        tables.push({ name: tn, columns, primary_keys: pks, foreign_keys: fks,
          row_count: rowCount, sample_data: sampleData, indexes: [] });
      }

      const schema = {
        metadata: { database_name: 'Chinook', input_type: 'demo',
          total_tables: tables.length, total_columns: totalCols,
          total_rows: totalRows, fk_source: 'explicit' },
        tables, relationships,
      };

      setSchemaJSON(schema);
      setSqlEngine(db);
      setPipelineStage(1);
      setActiveTab(1);
      addToast(`Demo loaded: ${tables.length} tables, ${totalRows.toLocaleString()} rows`, 'success');
    } catch (e) {
      addToast(`Demo failed: ${e.message}`, 'error');
    }
  }

  // ── Pipeline stages ────────────────────────────────────
  const stages = ['Upload', 'Schema', 'Relationships', 'Quality', 'AI Generation', 'Complete'];

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">

      {/* ── Header ── */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧠</span>
            <div>
              <h1 className="text-base font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">
                AI Database Analysis Agent
              </h1>
              {schemaJSON && (
                <p className="text-[10px] text-gray-500">
                  {schemaJSON.metadata?.database_name} · {schemaJSON.metadata?.total_tables} tables · {(schemaJSON.metadata?.total_rows || 0).toLocaleString()} rows
                </p>
              )}
            </div>
            {qualityReport && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                qualityReport.overall_health >= 90 ? 'bg-emerald-500/15 text-emerald-400'
                : qualityReport.overall_health >= 75 ? 'bg-yellow-500/15 text-yellow-400'
                : 'bg-red-500/15 text-red-400'
              }`}>
                {qualityReport.overall_health}/100
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {pipelineStage >= 1 && (
              <>
                <button onClick={exportJSON} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-[10px] text-gray-400 transition-colors">⬇ JSON</button>
                <button onClick={exportMarkdown} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-[10px] text-gray-400 transition-colors">⬇ MD</button>
                {aiOutputs?.dictionary && (
                  <button onClick={exportDictionaryCSV} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-[10px] text-gray-400 transition-colors">⬇ CSV</button>
                )}
              </>
            )}
            <a href="https://github.com" target="_blank" rel="noopener"
              className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-[10px] text-gray-400 transition-colors">GitHub</a>
          </div>
        </div>
      </header>

      {/* ── Pipeline progress bar ── */}
      <div className="bg-gray-900/50 border-b border-gray-800/50 px-4 py-2">
        <div className="max-w-7xl mx-auto flex items-center gap-1">
          {stages.map((s, i) => (
            <React.Fragment key={i}>
              <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all ${
                i < pipelineStage ? 'bg-emerald-500/15 text-emerald-400'
                : i === pipelineStage ? 'bg-blue-500/15 text-blue-400 animate-pulse'
                : 'bg-gray-800/50 text-gray-600'
              }`}>
                <span>{i < pipelineStage ? '✓' : i === pipelineStage ? '●' : '○'}</span>
                <span>{s}</span>
              </div>
              {i < stages.length - 1 && (
                <div className={`flex-1 h-px max-w-[40px] ${i < pipelineStage ? 'bg-emerald-500/40' : 'bg-gray-800'}`} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="bg-gray-900/30 border-b border-gray-800/50 px-4">
        <div className="max-w-7xl mx-auto flex gap-0.5 overflow-x-auto">
          {tabs.map(tab => {
            const locked = pipelineStage < tab.minStage;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => !locked && setActiveTab(tab.id)}
                disabled={locked}
                className={`px-4 py-2.5 text-xs font-medium transition-all whitespace-nowrap border-b-2 ${
                  isActive
                    ? 'border-blue-500 text-white bg-blue-500/5'
                    : locked
                    ? 'border-transparent text-gray-600 cursor-not-allowed'
                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
                }`}
              >
                <span className="mr-1.5">{locked ? '🔒' : tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab content ── */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 0 && (
          <UploadTab onSchemaReady={onSchemaReady} onDemo={loadDemo} />
        )}
        {activeTab === 1 && schemaJSON && (
          <SchemaTab schemaJSON={schemaJSON} />
        )}
        {activeTab === 2 && schemaJSON && (
          <RelationshipsTab schemaJSON={schemaJSON} onReady={onRelationshipsReady} />
        )}
        {activeTab === 3 && schemaJSON && (
          <QualityTab schemaJSON={schemaJSON} sqlEngine={sqlEngine} onReady={onQualityReady} />
        )}
        {activeTab === 4 && schemaJSON && (
          <AITab schemaJSON={schemaJSON} qualityReport={qualityReport} onReady={onAIReady} />
        )}
        {activeTab === 5 && aiOutputs?.dictionary && (
          <DictionaryTab dictionary={aiOutputs.dictionary} />
        )}
        {activeTab === 5 && !aiOutputs?.dictionary && (
          <div className="flex items-center justify-center h-96 text-gray-500">
            Run AI Insights first to generate the data dictionary.
          </div>
        )}
      </main>

      {/* ── Toast notifications ── */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium animate-slide-in border ${
            t.type === 'success' ? 'bg-emerald-900/90 border-emerald-500/30 text-emerald-300'
            : t.type === 'error' ? 'bg-red-900/90 border-red-500/30 text-red-300'
            : 'bg-gray-800/90 border-gray-600/30 text-gray-300'
          }`}>
            {t.type === 'success' ? '✅ ' : t.type === 'error' ? '❌ ' : 'ℹ️ '}
            {t.message}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slide-in { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .animate-slide-in { animation: slide-in 0.3s ease-out; }
      `}</style>
    </div>
  );
}


/* ════════════════════════════════════════════════════════
   Inline Tab Components (lightweight wrappers)
   In production, these import the full module components.
   ════════════════════════════════════════════════════════ */

function UploadTab({ onSchemaReady, onDemo }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-lg space-y-6 p-8">
        <div className="text-6xl mb-2">🧠</div>
        <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
          AI Database Analysis Agent
        </h2>
        <p className="text-sm text-gray-400">
          Upload any SQLite database, CSV files, or SQL dump to get instant schema analysis,
          ER diagrams, data quality scores, and AI-generated business summaries.
        </p>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col items-center gap-2 p-6 rounded-xl border-2 border-dashed border-gray-700 hover:border-blue-500/50 bg-gray-900/50 cursor-pointer transition-colors">
            <span className="text-3xl">📤</span>
            <span className="text-sm text-gray-400">Drop a .sqlite, .db, .csv, or .sql file</span>
            <input type="file" className="hidden" accept=".sqlite,.db,.csv,.sql,.sqlite3"
              onChange={e => { /* Module 1 handles this */ }} />
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-gray-800" />
            <span className="text-[10px] text-gray-600 uppercase">or</span>
            <div className="flex-1 h-px bg-gray-800" />
          </div>
          <button onClick={onDemo}
            className="py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-sm font-semibold shadow-lg shadow-purple-500/20 transition-all">
            🎵 Try Demo (Chinook Music DB)
          </button>
        </div>
      </div>
    </div>
  );
}

function SchemaTab({ schemaJSON }) {
  const tbs = schemaJSON?.tables || [];
  const [sel, setSel] = useState(null);
  const active = sel ? tbs.find(t => t.name === sel) : tbs[0];
  const roleMeta = {
    fact:{ dot:'bg-blue-400' }, dimension:{ dot:'bg-emerald-400' },
    junction:{ dot:'bg-orange-400' }, isolated:{ dot:'bg-gray-400' },
  };
  function classifyRole(t) {
    const out = (t.foreign_keys||[]).length;
    const ref = tbs.some(o => o.name !== t.name && (o.foreign_keys||[]).some(f => f.references_table === t.name));
    if (!out && !ref) return 'isolated';
    if (out === 2 && (t.columns||[]).length <= out + 2) return 'junction';
    if (out >= 2) return 'fact';
    return 'dimension';
  }
  return (
    <div className="flex h-full">
      <aside className="w-64 border-r border-gray-800 bg-gray-900/40 overflow-y-auto p-2">
        {tbs.map(t => {
          const role = classifyRole(t);
          return (
            <button key={t.name} onClick={() => setSel(t.name)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors ${active?.name === t.name ? 'bg-blue-500/10 text-white' : 'text-gray-400 hover:bg-gray-800/60'}`}>
              <span className={`w-2 h-2 rounded-full ${roleMeta[role]?.dot || 'bg-gray-500'}`} />
              <span className="truncate flex-1">{t.name}</span>
              <span className="text-gray-600">{t.row_count}</span>
            </button>
          );
        })}
      </aside>
      <main className="flex-1 overflow-y-auto p-5">
        {active && (
          <div>
            <h2 className="text-lg font-bold mb-4">{active.name}
              <span className="ml-2 text-xs text-gray-500">{active.row_count?.toLocaleString()} rows · {active.columns?.length} cols</span>
            </h2>
            <table className="w-full text-xs">
              <thead><tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left px-3 py-2">Column</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-center px-3 py-2">PK</th>
                <th className="text-center px-3 py-2">Nullable</th>
                <th className="text-left px-3 py-2">FK</th>
              </tr></thead>
              <tbody>
                {(active.columns||[]).map((c,i) => {
                  const fk = (active.foreign_keys||[]).find(f => f.column === c.name);
                  return (
                    <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/30">
                      <td className="px-3 py-1.5 font-mono text-gray-200">{c.name}</td>
                      <td className="px-3 py-1.5 text-gray-500 font-mono">{c.type}</td>
                      <td className="px-3 py-1.5 text-center">{c.primary_key ? '🔑' : ''}</td>
                      <td className="px-3 py-1.5 text-center text-gray-600">{c.nullable ? 'Yes' : 'No'}</td>
                      <td className="px-3 py-1.5 text-emerald-400">{fk ? `→ ${fk.references_table}.${fk.references_column}` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function RelationshipsTab({ schemaJSON, onReady }) {
  /* Placeholder — in production, renders Module3_RelationshipMapper */
  return (
    <div className="p-6 text-center text-gray-400">
      <p className="text-lg mb-2">🔗 Relationship Mapper</p>
      <p className="text-xs text-gray-500">
        {schemaJSON?.relationships?.length || 0} relationships detected.
        Integrate Module3_RelationshipMapper for the full interactive ER diagram.
      </p>
    </div>
  );
}

function QualityTab({ schemaJSON, sqlEngine, onReady }) {
  /* Placeholder — in production, renders Module4_QualityProfiler */
  return (
    <div className="p-6 text-center text-gray-400">
      <p className="text-lg mb-2">📊 Quality Profiler</p>
      <p className="text-xs text-gray-500">
        Integrate Module4_QualityProfiler for the full quality dashboard.
      </p>
    </div>
  );
}

function AITab({ schemaJSON, qualityReport, onReady }) {
  /* Placeholder — in production, renders Module5_AIGenerator */
  return (
    <div className="p-6 text-center text-gray-400">
      <p className="text-lg mb-2">✦ AI Insights</p>
      <p className="text-xs text-gray-500">
        Integrate Module5_AIGenerator for AI-powered analysis.
      </p>
    </div>
  );
}

function DictionaryTab({ dictionary }) {
  return (
    <div className="max-w-5xl mx-auto p-5 space-y-6">
      <h2 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400">
        📖 Data Dictionary
      </h2>
      {Object.entries(dictionary).map(([table, dd]) => {
        const cols = dd?.columns || [];
        if (!cols.length) return null;
        return (
          <div key={table} className="rounded-xl border border-gray-700/50 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-800/60 border-b border-gray-700/50">
              <h3 className="text-sm font-semibold text-gray-300">{table}</h3>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="text-gray-500 border-b border-gray-700/50">
                <th className="text-left px-3 py-2">Column</th>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-left px-3 py-2">Format</th>
                <th className="text-center px-3 py-2">Sensitive</th>
              </tr></thead>
              <tbody>
                {cols.map((c, i) => (
                  <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/30">
                    <td className="px-3 py-1.5 font-mono text-gray-300">{c.name}</td>
                    <td className="px-3 py-1.5 text-gray-400 max-w-md">{c.description}</td>
                    <td className="px-3 py-1.5 text-gray-500">{c.format || '—'}</td>
                    <td className="px-3 py-1.5 text-center">{c.sensitive ? '🔒' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
