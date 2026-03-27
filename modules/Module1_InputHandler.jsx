import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Module 1 — InputHandler
 * =======================
 * Accepts database input in 4 formats (CSV, SQLite, SQL dump, Demo),
 * loads it into SQL.js, extracts schema via PRAGMA queries, infers FKs
 * for CSV inputs, and calls onSchemaReady(schema, db) when done.
 *
 * @param {{ onSchemaReady: (schema: object, db: object) => void }} props
 */
export default function InputHandler({ onSchemaReady }) {
  // ── State ──────────────────────────────────────────────
  const [sqlReady, setSqlReady] = useState(false);
  const [selectedType, setSelectedType] = useState(null);    // 'csv' | 'sqlite' | 'sql_dump' | 'demo'
  const [dragActive, setDragActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [steps, setSteps] = useState([]);                    // { text, status: 'done'|'active'|'pending' }
  const [error, setError] = useState(null);
  const [schema, setSchema] = useState(null);

  const sqlRef = useRef(null);   // SQL.js module
  const dbRef = useRef(null);    // current SQL.Database
  const fileInputRef = useRef(null);

  // ── SQL.js initialisation ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initSqlJs = (await import(
          /* webpackIgnore: true */
          'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/sql-wasm.js'
        )).default;
        const SQL = await initSqlJs({
          locateFile: f =>
            `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${f}`,
        });
        if (!cancelled) {
          sqlRef.current = SQL;
          setSqlReady(true);
        }
      } catch {
        /* If ESM import fails, try the global */
        if (window.initSqlJs) {
          const SQL = await window.initSqlJs({
            locateFile: f =>
              `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${f}`,
          });
          if (!cancelled) {
            sqlRef.current = SQL;
            setSqlReady(true);
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Helpers ────────────────────────────────────────────

  /** Append or update a processing step */
  const addStep = useCallback((text, status = 'active') => {
    setSteps(prev => {
      const updated = prev.map(s =>
        s.status === 'active' ? { ...s, status: 'done' } : s
      );
      return [...updated, { text, status }];
    });
  }, []);

  const markAllDone = useCallback(() => {
    setSteps(prev => prev.map(s => ({ ...s, status: 'done' })));
  }, []);

  // ── CSV parsing ────────────────────────────────────────

  function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return { headers: [], rows: [] };
    const headers = splitCSVLine(lines[0]);
    const rows = lines.slice(1).map(splitCSVLine);
    return { headers, rows };
  }

  function splitCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  function detectColumnType(values) {
    const sample = values.filter(v => v !== '' && v != null).slice(0, 100);
    if (sample.length === 0) return 'TEXT';
    if (sample.every(v => /^-?\d+$/.test(v))) return 'INTEGER';
    if (sample.every(v => /^-?\d+\.?\d*$/.test(v))) return 'REAL';
    const dateRe = /^\d{4}-\d{2}-\d{2}/;
    if (sample.filter(v => dateRe.test(v)).length / sample.length > 0.8) return 'DATETIME';
    return 'TEXT';
  }

  function escapeSQL(val) {
    if (val === '' || val == null) return 'NULL';
    if (/^-?\d+$/.test(val)) return val;
    if (/^-?\d+\.\d+$/.test(val)) return val;
    return `'${val.replace(/'/g, "''")}'`;
  }

  // ── FK inference for CSVs ──────────────────────────────

  function inferForeignKeys(tableMap) {
    const colTables = {};
    for (const [tbl, cols] of Object.entries(tableMap)) {
      for (const col of cols) {
        if (!colTables[col]) colTables[col] = [];
        colTables[col].push(tbl);
      }
    }

    const fks = [];
    for (const [col, tables] of Object.entries(colTables)) {
      if (!col.endsWith('_id') || tables.length < 2) continue;
      const prefix = col.replace(/_id$/, '').toLowerCase();
      const parent = tables.find(t => t.toLowerCase().includes(prefix)) || tables.sort()[0];
      for (const child of tables) {
        if (child === parent) continue;
        fks.push({
          child_table: child,
          child_column: col,
          parent_table: parent,
          parent_column: col,
          inferred: true,
        });
      }
    }
    return fks;
  }

  // ── PRAGMA-based schema extraction ─────────────────────

  function extractSchema(db, inputType, dbName, inferredFKs = []) {
    const rawTables = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    if (!rawTables.length) return null;
    const tableNames = rawTables[0].values.map(r => r[0]);

    const schemaTables = [];
    let totalRows = 0;
    let totalCols = 0;

    for (const tbl of tableNames) {
      const colsResult = db.exec(`PRAGMA table_info("${tbl}")`);
      const cols = colsResult.length ? colsResult[0].values : [];

      const fksResult = db.exec(`PRAGMA foreign_key_list("${tbl}")`);
      const fks = fksResult.length ? fksResult[0].values : [];

      const idxResult = db.exec(`PRAGMA index_list("${tbl}")`);
      const idxs = idxResult.length ? idxResult[0].values : [];

      const countResult = db.exec(`SELECT COUNT(*) FROM "${tbl}"`);
      const rowCount = countResult.length ? countResult[0].values[0][0] : 0;

      const sampleResult = db.exec(`SELECT * FROM "${tbl}" LIMIT 5`);
      const colNames = cols.map(c => c[1]);
      const sampleData = sampleResult.length
        ? sampleResult[0].values.map(row => {
            const obj = {};
            colNames.forEach((n, i) => { obj[n] = row[i]; });
            return obj;
          })
        : [];

      // Detect unique columns from unique indexes
      const uniqueCols = new Set();
      for (const idx of idxs) {
        if (idx[2]) { // unique flag
          const idxInfoResult = db.exec(`PRAGMA index_info("${idx[1]}")`);
          if (idxInfoResult.length && idxInfoResult[0].values.length === 1) {
            uniqueCols.add(idxInfoResult[0].values[0][2]);
          }
        }
      }

      const columns = cols.map(c => ({
        name: c[1],
        type: c[2] || 'TEXT',
        nullable: !c[3],
        primary_key: !!c[5],
        unique: uniqueCols.has(c[1]),
        default_value: c[4],
      }));

      // Explicit FKs
      const foreignKeys = fks.map(fk => ({
        column: fk[3],
        references_table: fk[2],
        references_column: fk[4],
        inferred: false,
      }));

      // Merge inferred FKs
      for (const ifk of inferredFKs) {
        if (ifk.child_table !== tbl) continue;
        const exists = foreignKeys.some(
          f => f.column === ifk.child_column && f.references_table === ifk.parent_table
        );
        if (!exists) {
          foreignKeys.push({
            column: ifk.child_column,
            references_table: ifk.parent_table,
            references_column: ifk.parent_column,
            inferred: true,
          });
        }
      }

      schemaTables.push({
        name: tbl,
        row_count: rowCount,
        columns,
        primary_keys: cols.filter(c => c[5]).map(c => c[1]),
        foreign_keys: foreignKeys,
        indexes: idxs.map(i => i[1]),
        sample_data: sampleData,
      });

      totalRows += rowCount;
      totalCols += columns.length;
    }

    // FK source label
    const hasExplicit = schemaTables.some(t => t.foreign_keys.some(f => !f.inferred));
    const hasInferred = schemaTables.some(t => t.foreign_keys.some(f => f.inferred));
    let fkSource = 'explicit';
    if (hasExplicit && hasInferred) fkSource = 'mixed';
    else if (hasInferred) fkSource = 'inferred';

    // Relationships from all FKs
    const relationships = [];
    for (const tbl of schemaTables) {
      for (const fk of tbl.foreign_keys) {
        relationships.push({
          from_table: tbl.name,
          from_column: fk.column,
          to_table: fk.references_table,
          to_column: fk.references_column,
          cardinality: 'one-to-many',
          inferred: fk.inferred,
        });
      }
    }

    return {
      metadata: {
        database_name: dbName,
        input_type: inputType,
        total_tables: schemaTables.length,
        total_columns: totalCols,
        total_rows: totalRows,
        extraction_timestamp: new Date().toISOString(),
        fk_source: fkSource,
      },
      tables: schemaTables,
      relationships,
    };
  }

  // ── Input processors ───────────────────────────────────

  async function processCSVFiles(files) {
    const SQL = sqlRef.current;
    const db = new SQL.Database();
    dbRef.current = db;

    addStep('Reading CSV files…');
    const tableColumnsMap = {};

    for (const file of files) {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      const tableName = file.name.replace(/\.csv$/i, '');

      // Detect types
      const types = headers.map((_, ci) =>
        detectColumnType(rows.map(r => r[ci]))
      );

      // CREATE TABLE
      const colDefs = headers.map((h, i) => `"${h}" ${types[i]}`).join(', ');
      db.run(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs})`);

      // INSERT rows in batches
      const BATCH = 500;
      for (let b = 0; b < rows.length; b += BATCH) {
        const batch = rows.slice(b, b + BATCH);
        const stmts = batch.map(
          row => `INSERT INTO "${tableName}" VALUES (${row.map(escapeSQL).join(',')})`
        ).join(';\n');
        try { db.run(stmts); } catch { /* skip bad rows */ }
      }

      tableColumnsMap[tableName] = headers;
      addStep(`Loaded ${tableName} (${rows.length.toLocaleString()} rows)`);
    }

    addStep('Inferring FK relationships…');
    const inferredFKs = inferForeignKeys(tableColumnsMap);

    addStep('Extracting schema…');
    const result = extractSchema(db, 'csv', 'csv_database', inferredFKs);
    return result;
  }

  async function processSQLiteFile(file) {
    const SQL = sqlRef.current;
    addStep('Reading SQLite binary…');
    const buffer = await file.arrayBuffer();

    addStep('Loading into SQL.js…');
    const db = new SQL.Database(new Uint8Array(buffer));
    dbRef.current = db;

    addStep('Extracting schema…');
    const name = file.name.replace(/\.(db|sqlite|sqlite3)$/i, '');
    return extractSchema(db, 'sqlite', name);
  }

  async function processSQLDump(file) {
    const SQL = sqlRef.current;
    addStep('Reading SQL dump…');
    let sql = await file.text();

    addStep('Applying dialect fixes…');
    sql = sql.replace(/AUTO_INCREMENT/gi, 'AUTOINCREMENT');
    sql = sql.replace(/\bINT\s+UNSIGNED\b/gi, 'INTEGER');
    sql = sql.replace(/\bBIGINT\b/gi, 'INTEGER');
    sql = sql.replace(/\bTINYINT\b/gi, 'INTEGER');
    sql = sql.replace(/\bSMALLINT\b/gi, 'INTEGER');
    sql = sql.replace(/\bDOUBLE\b/gi, 'REAL');
    sql = sql.replace(/\bFLOAT\b/gi, 'REAL');
    sql = sql.replace(/DECIMAL\([^)]*\)/gi, 'REAL');
    sql = sql.replace(/ENUM\([^)]*\)/gi, 'TEXT');
    sql = sql.replace(/SET\([^)]*\)/gi, 'TEXT');
    sql = sql.replace(/\bLONGTEXT\b/gi, 'TEXT');
    sql = sql.replace(/\bMEDIUMTEXT\b/gi, 'TEXT');
    sql = sql.replace(/\bTINYTEXT\b/gi, 'TEXT');
    sql = sql.replace(/VARCHAR\(\d+\)/gi, 'TEXT');
    sql = sql.replace(/\s*ENGINE\s*=\s*\w+/gi, '');
    sql = sql.replace(/\s*DEFAULT\s+CHARSET\s*=\s*\w+/gi, '');
    sql = sql.replace(/\s*COLLATE\s*=?\s*\w+/gi, '');
    sql = sql.replace(/\s*CHARACTER\s+SET\s+\w+/gi, '');
    sql = sql.replace(/\s*COMMENT\s+'[^']*'/gi, '');
    sql = sql.replace(/`/g, '"');
    sql = sql.replace(/^(LOCK|UNLOCK|SET|USE|\/\*!).*?;\s*$/gm, '');

    addStep('Executing SQL…');
    const db = new SQL.Database();
    dbRef.current = db;
    let errCount = 0;
    for (const stmt of sql.split(';')) {
      const s = stmt.trim();
      if (!s) continue;
      try { db.run(s); } catch { errCount++; }
    }
    if (errCount > 0) {
      addStep(`${errCount} statement(s) skipped (non-fatal)`);
    }

    addStep('Extracting schema…');
    const name = file.name.replace(/\.sql$/i, '');
    return extractSchema(db, 'sql_dump', name);
  }

  async function loadDemoDatabase() {
    const SQL = sqlRef.current;
    addStep('Downloading Chinook demo database…');

    const url =
      'https://github.com/lerocha/chinook-database/raw/master/ChinookDatabase/DataSources/Chinook_Sqlite.sqlite';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch demo DB: ${resp.status}`);
    const buffer = await resp.arrayBuffer();

    addStep('Loading into SQL.js…');
    const db = new SQL.Database(new Uint8Array(buffer));
    dbRef.current = db;

    addStep('Extracting schema…');
    return extractSchema(db, 'demo', 'Chinook');
  }

  // ── Unified handler ────────────────────────────────────

  const handleFiles = useCallback(async (files) => {
    if (!sqlRef.current) {
      setError('SQL.js is still loading. Please wait a moment and try again.');
      return;
    }

    setProcessing(true);
    setSteps([]);
    setError(null);
    setSchema(null);

    try {
      let result;
      if (selectedType === 'csv') {
        result = await processCSVFiles(files);
      } else if (selectedType === 'sqlite') {
        result = await processSQLiteFile(files[0]);
      } else if (selectedType === 'sql_dump') {
        result = await processSQLDump(files[0]);
      }

      if (!result || !result.tables.length) {
        throw new Error('No tables found in the provided input.');
      }

      addStep(`Schema extracted: ${result.metadata.total_tables} tables found`);
      addStep(`Sample data collected`);
      addStep(`${result.relationships.length} relationship(s) mapped`);
      markAllDone();
      addStep('Standard Schema JSON ready ✓', 'done');

      setSchema(result);
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setProcessing(false);
    }
  }, [selectedType, addStep, markAllDone]);

  const handleDemo = useCallback(async () => {
    if (!sqlRef.current) {
      setError('SQL.js is still loading. Please wait a moment and try again.');
      return;
    }

    setProcessing(true);
    setSteps([]);
    setError(null);
    setSchema(null);

    try {
      const result = await loadDemoDatabase();
      if (!result || !result.tables.length) {
        throw new Error('Demo database appears empty.');
      }
      addStep(`Schema extracted: ${result.metadata.total_tables} tables found`);
      addStep(`Sample data collected`);
      addStep(`${result.relationships.length} relationship(s) mapped`);
      markAllDone();
      addStep('Standard Schema JSON ready ✓', 'done');
      setSchema(result);
    } catch (err) {
      setError(err.message || 'Failed to load demo database.');
    } finally {
      setProcessing(false);
    }
  }, [addStep, markAllDone]);

  // ── Drag & drop / file input ───────────────────────────

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) handleFiles(files);
  }, [handleFiles]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback(() => setDragActive(false), []);

  const onFileInput = useCallback((e) => {
    const files = Array.from(e.target.files);
    if (files.length) handleFiles(files);
  }, [handleFiles]);

  const acceptMap = {
    csv: '.csv',
    sqlite: '.db,.sqlite,.sqlite3',
    sql_dump: '.sql',
  };

  const reset = () => {
    setSelectedType(null);
    setProcessing(false);
    setSteps([]);
    setError(null);
    setSchema(null);
    if (dbRef.current) {
      try { dbRef.current.close(); } catch { /* ignore */ }
      dbRef.current = null;
    }
  };

  // ── Input type cards ───────────────────────────────────

  const INPUT_TYPES = [
    { id: 'csv',      icon: '📁', label: 'CSV Files',      desc: 'Upload one or more .csv files' },
    { id: 'sqlite',   icon: '🗄️', label: 'SQLite File',    desc: '.db or .sqlite database' },
    { id: 'sql_dump', icon: '📄', label: 'SQL Dump',       desc: '.sql text dump file' },
    { id: 'demo',     icon: '🎮', label: 'Demo Database',  desc: 'Chinook Music Store (11 tables)' },
  ];

  const totalFKs = schema
    ? schema.tables.reduce((sum, t) => sum + t.foreign_keys.length, 0)
    : 0;

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400">
              Database Analysis Agent
            </span>
          </h1>
          <p className="text-gray-400 text-sm">
            Module 1 — Input Handler
          </p>
          {!sqlReady && (
            <p className="mt-3 text-yellow-400 text-xs animate-pulse">
              ⏳ Loading SQL.js engine…
            </p>
          )}
        </div>

        {/* ── Success state ── */}
        {schema && !processing && (
          <div className="rounded-2xl bg-gray-800/60 backdrop-blur border border-gray-700 p-6 shadow-2xl">
            {/* Success banner */}
            <div className="flex items-center gap-3 mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
              <span className="text-3xl">✅</span>
              <div>
                <h2 className="text-lg font-semibold text-emerald-400">
                  Database Loaded Successfully
                </h2>
                <p className="text-gray-400 text-sm">
                  {schema.metadata.database_name} — {schema.metadata.input_type.toUpperCase()}
                </p>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                { label: 'Tables',  value: schema.metadata.total_tables,  color: 'blue' },
                { label: 'Columns', value: schema.metadata.total_columns, color: 'purple' },
                { label: 'Rows',    value: schema.metadata.total_rows.toLocaleString(), color: 'cyan' },
                { label: 'FKs',     value: totalFKs, color: 'amber' },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className={`rounded-xl bg-gray-900/50 border border-${color}-500/20 p-4 text-center`}
                >
                  <div className={`text-2xl font-bold text-${color}-400`}>{value}</div>
                  <div className="text-xs text-gray-500 mt-1 uppercase tracking-wider">{label}</div>
                </div>
              ))}
            </div>

            {/* FK source badge */}
            <div className="flex items-center justify-center gap-2 mb-6">
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                  schema.metadata.fk_source === 'explicit'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : schema.metadata.fk_source === 'inferred'
                    ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                    : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                }`}
              >
                {schema.metadata.fk_source === 'explicit' && '🔗 Explicit FKs'}
                {schema.metadata.fk_source === 'inferred' && '🔍 Inferred FKs'}
                {schema.metadata.fk_source === 'mixed'    && '🔗🔍 Mixed FKs'}
              </span>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => onSchemaReady && onSchemaReady(schema, dbRef.current)}
                className="flex-1 py-3 px-6 rounded-xl font-semibold text-sm
                  bg-gradient-to-r from-blue-500 to-cyan-500
                  hover:from-blue-600 hover:to-cyan-600
                  text-white shadow-lg shadow-blue-500/20
                  transition-all duration-200 hover:scale-[1.02]"
              >
                Proceed to Schema Analysis →
              </button>
              <button
                onClick={reset}
                className="py-3 px-4 rounded-xl text-sm text-gray-400
                  border border-gray-600 hover:border-gray-500
                  hover:text-white transition-all duration-200"
              >
                Reset
              </button>
            </div>
          </div>
        )}

        {/* ── Error state ── */}
        {error && !processing && !schema && (
          <div className="rounded-2xl bg-gray-800/60 backdrop-blur border border-red-500/30 p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
              <span className="text-3xl">❌</span>
              <div>
                <h2 className="text-lg font-semibold text-red-400">Something Went Wrong</h2>
                <p className="text-gray-400 text-sm mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={reset}
              className="w-full py-3 rounded-xl font-semibold text-sm
                bg-gray-700 hover:bg-gray-600 text-white transition-all duration-200"
            >
              ← Try Again
            </button>
          </div>
        )}

        {/* ── Processing state ── */}
        {processing && (
          <div className="rounded-2xl bg-gray-800/60 backdrop-blur border border-gray-700 p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <h2 className="text-lg font-semibold text-white">Processing…</h2>
            </div>
            <ul className="space-y-2">
              {steps.map((step, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  {step.status === 'done' && <span className="text-emerald-400">✓</span>}
                  {step.status === 'active' && (
                    <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  )}
                  <span className={step.status === 'done' ? 'text-gray-300' : 'text-blue-300'}>
                    {step.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Input type selector + drop zone ── */}
        {!processing && !schema && !error && (
          <div className="rounded-2xl bg-gray-800/60 backdrop-blur border border-gray-700 p-6 shadow-2xl">
            {/* Type cards */}
            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">
              Choose Input Type
            </h2>
            <div className="grid grid-cols-2 gap-3 mb-6">
              {INPUT_TYPES.map(({ id, icon, label, desc }) => (
                <button
                  key={id}
                  disabled={!sqlReady}
                  onClick={() => {
                    if (id === 'demo') {
                      setSelectedType('demo');
                      handleDemo();
                    } else {
                      setSelectedType(id);
                    }
                  }}
                  className={`
                    group relative p-4 rounded-xl border text-left
                    transition-all duration-200
                    ${!sqlReady ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:scale-[1.02]'}
                    ${selectedType === id
                      ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/10'
                      : 'border-gray-600 bg-gray-900/40 hover:border-gray-500'
                    }
                  `}
                >
                  <span className="text-2xl block mb-2">{icon}</span>
                  <span className="text-sm font-semibold text-white block">{label}</span>
                  <span className="text-xs text-gray-500 block mt-1">{desc}</span>
                  {selectedType === id && (
                    <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  )}
                </button>
              ))}
            </div>

            {/* Drop zone (only for file-based types) */}
            {selectedType && selectedType !== 'demo' && (
              <div
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  relative p-10 rounded-xl border-2 border-dashed text-center
                  cursor-pointer transition-all duration-200
                  ${dragActive
                    ? 'border-blue-400 bg-blue-500/10'
                    : 'border-gray-600 hover:border-gray-500 bg-gray-900/30'
                  }
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept={acceptMap[selectedType]}
                  multiple={selectedType === 'csv'}
                  onChange={onFileInput}
                />
                <div className="text-4xl mb-3">
                  {selectedType === 'csv' && '📁'}
                  {selectedType === 'sqlite' && '🗄️'}
                  {selectedType === 'sql_dump' && '📄'}
                </div>
                <p className="text-gray-300 text-sm font-medium">
                  {dragActive
                    ? 'Drop files here…'
                    : selectedType === 'csv'
                    ? 'Drop CSV files here or click to browse'
                    : selectedType === 'sqlite'
                    ? 'Drop .db / .sqlite file here or click to browse'
                    : 'Drop .sql dump file here or click to browse'
                  }
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  Accepted: {acceptMap[selectedType]}
                  {selectedType === 'csv' && ' (multiple files supported)'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
