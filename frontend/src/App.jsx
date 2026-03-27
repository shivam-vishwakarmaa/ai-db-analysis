import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import Papa from "papaparse";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  LineChart,
  Line,
} from "recharts";
import {
  LayoutDashboard,
  Database,
  Link2,
  ShieldCheck,
  Book,
  Lightbulb,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  MoreHorizontal,
  ChevronRight,
  BarChart2,
  Zap,
  Activity,
  Search,
  Info,
  PieChart as PieIcon,
  LineChart as LineIcon,
  BarChart3,
  Upload,
  FileText,
  GitGraph,
  ClipboardList,
  Brain,
  Download,
} from "lucide-react";
import "./index.css";

/* Load sql.js from local public directory (same-origin, no COEP issues) */
async function loadSqlJs() {
  if (window.initSqlJs)
    return window.initSqlJs({ locateFile: (f) => `/sql-wasm/${f}` });
  await new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "/sql-wasm/sql-wasm.js";
    s.onload = resolve;
    document.head.appendChild(s);
  });
  return window.initSqlJs({ locateFile: (f) => `/sql-wasm/${f}` });
}

/* Dynamic Gemini API Helper with auto-discovery & retry (429 backoff) */
let cachedModel = null;
async function callGemini(
  apiKey,
  prompt,
  temperature = 0.2,
  retries = 5,
  delay = 5000,
) {
  try {
    let modelToUse = cachedModel || "gemini-1.5-flash";
    if (!cachedModel) {
      try {
        const listResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        );
        if (listResp.ok) {
          const listData = await listResp.json();
          const flash = (listData.models || []).find(
            (m) =>
              m.name.includes("flash") &&
              m.supportedGenerationMethods.includes("generateContent"),
          );
          if (flash) {
            modelToUse = flash.name.split("/").pop();
            cachedModel = modelToUse;
          }
        }
      } catch (e) {
        console.warn("Model discovery failed, using default flash.", e);
      }
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature },
      }),
    });

    if (resp.status === 429 && retries > 0) {
      let wait = delay;
      try {
        const err = await resp.json();
        const delayStr =
          err?.error?.details?.find((d) => d.retryDelay)?.retryDelay || "";
        const match = delayStr.match(/(\d+)/);
        if (match) wait = (parseInt(match[1]) + 2) * 1000;
      } catch (e) {}

      console.warn(
        `Gemini 429: Rate limited. Sleeping ${wait}ms... (${retries} retries left)`,
      );
      if (window.toast)
        window.toast(
          `Rate limit hit. Waiting ${Math.round(wait / 1000)}s for Gemini quota reset...`,
          "warning",
        );
      await new Promise((r) => setTimeout(r, wait));
      return callGemini(apiKey, prompt, temperature, retries - 1, delay * 1.5);
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(
        `API Status ${resp.status}: ${errText} (Model attempted: ${modelToUse})`,
      );
    }
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text)
      throw new Error("API returned an empty response. (No content generated)");
    return text;
  } catch (e) {
    throw e;
  }
}

export default function App() {
  const [geminiApiKey, setGeminiApiKey] = useState(
    import.meta.env.VITE_GEMINI_API_KEY ||
      "AIzaSyAiU9G5MVkOLzOmkTewPdwqXQpdI3FJF8Y",
  );
  const [schemaJSON, setSchemaJSON] = useState(null);
  const [sqlEngine, setSqlEngine] = useState(null);
  const [qualityReport, setQualityReport] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [stage, setStage] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [erSvgCache, setErSvgCache] = useState({});
  const [businessContext, setBusinessContext] = useState(null);
  const tid = useRef(0);

  const toast = useCallback((msg, type = "info") => {
    const id = ++tid.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  useEffect(() => {
    window.toast = toast;
  }, [toast]);

  const onSchema = useCallback(
    (schema, db) => {
      setSchemaJSON(schema);
      setSqlEngine(db);
      setStage((s) => Math.max(s, 1));
      toast(
        `Schema extracted: ${schema.metadata?.total_tables} tables`,
        "success",
      );
      setActiveTab(1);
    },
    [toast],
  );

  async function loadDemo() {
    toast("Loading Chinook demo…");
    try {
      const SQL = await loadSqlJs();
      const resp = await fetch(
        "https://raw.githubusercontent.com/lerocha/chinook-database/master/ChinookDatabase/DataSources/Chinook_Sqlite.sqlite",
      );
      const buf = await resp.arrayBuffer();
      const db = new SQL.Database(new Uint8Array(buf));
      const schema = extractSchemaFromDb(db, "Chinook", "demo");
      onSchema(schema, db);
    } catch (e) {
      toast(`Demo failed: ${e.message}`, "error");
    }
  }

  async function handleFile(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      setUploadProgress({ step: 1, max: 4, text: `Booting SQLite Engine…` });
      const SQL = await loadSqlJs();

      const sqliteFile = files.find((f) =>
        f.name.match(/\.(sqlite|sqlite3|db)$/i),
      );
      let db;
      let dbName = sqliteFile
        ? sqliteFile.name.replace(/\.[^.]+$/, "")
        : files.length > 1
          ? "Batch_Upload"
          : files[0].name.replace(/\.[^.]+$/, "");

      if (sqliteFile) {
        toast("Loading base SQLite database…");
        const buf = await sqliteFile.arrayBuffer();
        db = new SQL.Database(new Uint8Array(buf));
      } else {
        db = new SQL.Database();
      }

      let hasCsv = false;
      let samplesObj = {};
      setUploadProgress({
        step: 2,
        max: 4,
        text: `Parsing & Parsing ${files.length} Files…`,
      });

      for (const f of files) {
        if (f.name.match(/\.sql$/i)) {
          toast(`Executing ${f.name}…`);
          const txt = await f.text();
          db.exec(txt);
        } else if (f.name.match(/\.csv$/i)) {
          hasCsv = true;
          toast(`Parsing ${f.name} with PapaParse…`);
          const txt = await f.text();
          const parsed = Papa.parse(txt, {
            header: true,
            skipEmptyLines: true,
          });
          if (!parsed.data || parsed.data.length === 0) continue;

          let tbl = f.name
            .replace(/\.[^/.]+$/, "")
            .replace(/[^a-zA-Z0-9_]/g, "");
          if (tbl.match(/^\d/)) tbl = "t_" + tbl;

          const cols = Object.keys(parsed.data[0]);
          const types = cols.map((c) => {
            let isInt = true,
              isReal = true,
              isBool = true,
              isDate = true,
              hasVal = false;
            for (let i = 0; i < Math.min(5, parsed.data.length); i++) {
              const v = parsed.data[i][c];
              if (v === "" || v == null) continue;
              hasVal = true;
              if (isNaN(v)) {
                isInt = false;
                isReal = false;
              }
              if (
                v !== "0" &&
                v !== "1" &&
                String(v).toLowerCase() !== "true" &&
                String(v).toLowerCase() !== "false"
              )
                isBool = false;
              if (String(v).includes(".")) isInt = false;
              if (isNaN(Date.parse(v)) || !String(v).match(/^20\\d{2}-\\d{2}/))
                isDate = false;
            }
            if (!hasVal) return "VARCHAR(255)";
            if (isBool) return "BOOLEAN";
            if (isDate) return "DATETIME";
            if (isInt) return "INTEGER";
            if (isReal) return "REAL";
            return "VARCHAR(255)";
          });

          db.exec(
            `CREATE TABLE "${tbl}" (${cols.map((c, i) => `"${c}" ${types[i]}`).join(", ")});`,
          );
          db.exec("BEGIN TRANSACTION;");

          const BATCH_SIZE = 500;
          for (let i = 0; i < parsed.data.length; i += BATCH_SIZE) {
            const chunk = parsed.data.slice(i, i + BATCH_SIZE);
            const placeholders = cols.map(() => "?").join(",");
            const totalPlaceholders = chunk
              .map(() => `(${placeholders})`)
              .join(",");
            const stmt = db.prepare(
              `INSERT INTO "${tbl}" VALUES ${totalPlaceholders}`,
            );
            const values = [];
            chunk.forEach((row) =>
              cols.forEach((c) => values.push(row[c] || null)),
            );
            stmt.run(values);
            stmt.free();
            if (i % 10000 === 0)
              setUploadProgress((p) => ({
                ...p,
                text: `Parsing ${f.name} (${i}/${parsed.data.length})…`,
              }));
          }
          db.exec("COMMIT;");

          samplesObj[tbl] = parsed.data.slice(0, 3);
        }
      }

      toast("Extracting Unified Schema…");
      const schema = extractSchemaFromDb(
        db,
        dbName,
        hasCsv ? "multi-format" : "sqlite",
      );

      if (schema.relationships.length === 0 && schema.tables.length > 1) {
        toast("Starting LangGraph Auto-Mapper…", "info");
        try {
          let state = {
            schema: schema.tables.map((t) => ({
              name: t.name,
              columns: t.columns.map((c) => c.name),
            })),
            samples: samplesObj,
            validated: [],
            errors: [],
            proposals: [],
            attempts: 0,
          };

          const proposeNode = async (state) => {
            setUploadProgress({
              step: 3,
              max: 4,
              text: `LangGraph: AI Proposer Node (Attempt ${state.attempts + 1})…`,
            });
            const prompt = `You are a Principal DB Architect.
              Schema: ${JSON.stringify(state.schema)}
              Data Samples: ${JSON.stringify(state.samples)}
              Previous Failed Hypotheses: ${JSON.stringify(state.errors)}
              
              Infer the actual Foreign Keys mathematically. Return ONLY an un-fenced JSON array:
              [{"from_table":"", "from_column":"", "to_table":"", "to_column":""}]`;

            const r = await callGemini(geminiApiKey, prompt, 0.1);

            let p = [];
            try {
              const s = r.indexOf("["),
                e = r.lastIndexOf("]");
              const cleanJson =
                s !== -1
                  ? r.slice(s, e + 1)
                  : r
                      .replace(/```json/g, "")
                      .replace(/```/g, "")
                      .trim();
              p = JSON.parse(cleanJson);
            } catch (e) {
              console.error("Gemini AI Proposer Parse Error. Raw:", r);
              toast("AI Mapper: Invalid JSON response. Retrying...", "warning");
            }

            console.log("Gemini Proposed:", p);
            return { proposals: p, attempts: 1 };
          };

          const validateNode = (state) => {
            setUploadProgress({
              step: 3,
              max: 4,
              text: `LangGraph: SQL Validation Node (Verifying Hypotheses)…`,
            });
            let v = [],
              e = [];
            for (const p of state.proposals) {
              try {
                const q = `SELECT COUNT(*) FROM "${p.from_table}" WHERE "${p.from_column}" IS NOT NULL AND "${p.from_column}" NOT IN (SELECT "${p.to_column}" FROM "${p.to_table}")`;
                const r = db.exec(q);
                if (r.length > 0 && r[0].values && r[0].values.length > 0) {
                  const bad = r[0].values[0][0];
                  if (bad === 0) v.push({ ...p, cardinality: "many-to-one" });
                  else
                    e.push(
                      `Hypothesis ${p.from_table}.${p.from_column}->${p.to_table}.${p.to_column} failed: ${bad} orphaned rows found.`,
                    );
                } else {
                  e.push(
                    `Validation Query for ${p.from_table} returned no data.`,
                  );
                }
              } catch (err) {
                e.push(`SQL Error on ${p.from_table}: ${err.message}`);
              }
            }
            console.log("Validator Results - Passed:", v, "Errors:", e);
            return { validated: v, errors: e };
          };

          while (true) {
            const pRes = await proposeNode(state);
            state.proposals = pRes.proposals;
            state.attempts += pRes.attempts;

            const vRes = validateNode(state);
            state.validated = [...state.validated, ...vRes.validated];
            state.errors = [...state.errors, ...vRes.errors];

            if (state.errors.length === 0 || state.attempts >= 3) break;
          }

          if (state.validated && state.validated.length > 0) {
            schema.relationships = state.validated;

            state.validated.forEach((rel) => {
              const child = schema.tables.find(
                (t) => t.name === rel.from_table,
              );
              const parent = schema.tables.find((t) => t.name === rel.to_table);

              if (child) {
                if (!child.foreign_keys) child.foreign_keys = [];
                if (
                  !child.foreign_keys.some((f) => f.column === rel.from_column)
                ) {
                  child.foreign_keys.push({
                    column: rel.from_column,
                    references_table: rel.to_table,
                    references_column: rel.to_column,
                  });
                }
              }

              if (parent) {
                const pkCol = parent.columns.find(
                  (c) => c.name === rel.to_column,
                );
                if (pkCol) pkCol.primary_key = true;
                if (!parent.primary_keys) parent.primary_keys = [];
                if (!parent.primary_keys.includes(rel.to_column))
                  parent.primary_keys.push(rel.to_column);
              }
            });

            toast(
              `LangGraph mapped ${schema.relationships.length} relationships!`,
              "success",
            );
          } else {
            console.warn(
              "LangGraph Engine exhausted 3 attempts without validating any hypotheses.",
              state.errors,
            );
            toast(
              `AI Schema matching stalled. Data may be disjointed.`,
              "warning",
            );
          }
        } catch (err) {
          console.error("LangGraph Agent Critical Failure:", err);
          toast(`LangGraph Agent failed: ${err.message}`, "error");
        }
      }

      setUploadProgress({ step: 4, max: 4, text: `Rendering Unified Map…` });
      onSchema(schema, db);
    } catch (e) {
      toast(`Upload failed: ${e.message}`, "error");
    } finally {
      setUploadProgress(null);
    }
  }

  function extractSchemaFromDb(db, dbName, inputType) {
    const tableRows = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );
    const tableNames = tableRows[0]?.values.map((r) => r[0]) || [];
    const tables = [];
    const relationships = [];
    let totalCols = 0,
      totalRows = 0;

    for (const tn of tableNames) {
      const info = db.exec(`PRAGMA table_info("${tn}")`);
      const fkInfo = db.exec(`PRAGMA foreign_key_list("${tn}")`);
      const countRes = db.exec(`SELECT COUNT(*) FROM "${tn}"`);
      const rowCount = countRes[0]?.values[0][0] || 0;
      const sampleRes = db.exec(`SELECT * FROM "${tn}" LIMIT 5`);

      const columns = (info[0]?.values || []).map((r) => ({
        name: r[1],
        type: r[2] || "TEXT",
        nullable: r[3] === 0,
        primary_key: r[5] === 1,
        unique: false,
      }));
      const pks = columns.filter((c) => c.primary_key).map((c) => c.name);
      const fks = (fkInfo[0]?.values || []).map((r) => ({
        column: r[3],
        references_table: r[2],
        references_column: r[4],
        inferred: false,
      }));
      fks.forEach((fk) =>
        relationships.push({
          from_table: tn,
          from_column: fk.column,
          to_table: fk.references_table,
          to_column: fk.references_column,
          inferred: false,
          cardinality: "one-to-many",
        }),
      );

      const sampleCols = sampleRes[0]?.columns || [];
      const sampleData = (sampleRes[0]?.values || []).map((row) => {
        const o = {};
        sampleCols.forEach((c, i) => {
          o[c] = row[i];
        });
        return o;
      });

      totalCols += columns.length;
      totalRows += rowCount;
      tables.push({
        name: tn,
        columns,
        primary_keys: pks,
        foreign_keys: fks,
        row_count: rowCount,
        sample_data: sampleData,
        indexes: [],
      });
    }

    return {
      metadata: {
        database_name: dbName,
        input_type: inputType,
        total_tables: tables.length,
        total_columns: totalCols,
        total_rows: totalRows,
        fk_source: "explicit",
      },
      tables,
      relationships,
    };
  }

  const tabs = [
    { id: 0, label: "Upload", icon: Upload, min: 0 },
    { id: 1, label: "Schema", icon: FileText, min: 1 },
    { id: 2, label: "Relationships", icon: GitGraph, min: 1 },
    { id: 3, label: "Quality", icon: ClipboardList, min: 1 },
    { id: 4, label: "Dictionary", icon: Book, min: 1 },
    { id: 5, label: "Business", icon: Brain, min: 1 },
  ];
  const stages = ["Upload", "Schema", "Relationships", "Quality", "BI", "Done"];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">
                AI Database Analysis Agent
              </h1>
              {schemaJSON && (
                <p className="text-xs text-gray-500">
                  {schemaJSON.metadata?.database_name} ·{" "}
                  {schemaJSON.metadata?.total_tables} tables ·{" "}
                  {(schemaJSON.metadata?.total_rows || 0).toLocaleString()} rows
                </p>
              )}
            </div>
            {qualityReport && (
              <span
                className={`ml-3 px-2.5 py-1 rounded-full text-xs font-medium ${
                  qualityReport.overall_health >= 80
                    ? "bg-green-100 text-green-700"
                    : qualityReport.overall_health >= 60
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-red-100 text-red-700"
                }`}
              >
                Score {qualityReport.overall_health}/100
              </span>
            )}
          </div>
          {schemaJSON && (
            <button
              onClick={() => {
                const b = new Blob(
                  [
                    JSON.stringify(
                      { schema: schemaJSON, quality: qualityReport },
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json" },
                );
                const u = URL.createObjectURL(b);
                const a = document.createElement("a");
                a.href = u;
                a.download = "report.json";
                a.click();
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm transition-colors"
            >
              <Download className="w-4 h-4" /> Export
            </button>
          )}
        </div>
      </header>

      {/* Pipeline progress */}
      <div className="bg-gray-100/50 border-b border-gray-200 px-6 py-2">
        <div className="max-w-7xl mx-auto flex items-center gap-1 text-xs">
          {stages.map((s, i) => (
            <span key={i} className="flex items-center gap-1">
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  i < stage
                    ? "bg-green-100 text-green-700"
                    : i === stage
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-200 text-gray-500"
                }`}
              >
                {i < stage ? "✓" : i === stage ? "●" : "○"} {s}
              </span>
              {i < stages.length - 1 && (
                <span
                  className={`w-4 h-px ${i < stage ? "bg-green-300" : "bg-gray-300"}`}
                />
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-6">
        <div className="max-w-7xl mx-auto flex gap-2 overflow-x-auto py-1">
          {tabs.map((tab) => {
            const locked = stage < tab.min;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => !locked && setActiveTab(tab.id)}
                disabled={locked}
                className={`
                  flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-xl transition-all whitespace-nowrap
                  ${
                    activeTab === tab.id
                      ? "bg-gray-50 text-blue-600 border-b-2 border-blue-500 shadow-sm"
                      : locked
                        ? "text-gray-400 cursor-not-allowed"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {locked && <span className="text-xs ml-1">🔒</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto bg-gray-50">
        {activeTab === 0 && (
          <UploadTab
            onFile={handleFile}
            onDemo={loadDemo}
            progress={uploadProgress}
          />
        )}
        {activeTab === 1 && schemaJSON && <SchemaTab schema={schemaJSON} />}
        {activeTab === 2 && schemaJSON && (
          <RelationshipsTab
            schema={schemaJSON}
            erSvgCache={erSvgCache}
            onErSvgReady={(key, svg) =>
              setErSvgCache((c) => ({ ...c, [key]: svg }))
            }
          />
        )}
        {activeTab === 3 && schemaJSON && (
          <QualityTab
            schema={schemaJSON}
            db={sqlEngine}
            onReady={(r) => {
              setQualityReport(r);
              setStage((s) => Math.max(s, 3));
              toast(`Quality: ${r.overall_health}/100`, "success");
            }}
          />
        )}
        {activeTab === 4 && schemaJSON && (
          <DictionaryTab
            schema={schemaJSON}
            geminiApiKey={geminiApiKey}
            erSvgCache={erSvgCache}
            onErSvgReady={(key, svg) =>
              setErSvgCache((c) => ({ ...c, [key]: svg }))
            }
          />
        )}
        {activeTab === 5 && schemaJSON && (
          <BusinessContextTab
            schema={schemaJSON}
            quality={qualityReport}
            geminiApiKey={geminiApiKey}
            cached={businessContext}
            onReady={setBusinessContext}
          />
        )}
      </main>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`
            px-4 py-2 rounded-lg shadow-lg text-sm font-medium border-l-4 backdrop-blur-sm
            ${
              t.type === "success"
                ? "bg-green-50 border-green-500 text-green-800"
                : t.type === "error"
                  ? "bg-red-50 border-red-500 text-red-800"
                  : "bg-blue-50 border-blue-500 text-blue-800"
            }
          `}
          >
            {t.type === "success" ? "✓" : t.type === "error" ? "⚠" : "ℹ"}{" "}
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   TAB COMPONENTS (Redesigned)
   ════════════════════════════════════════════════════════════ */

function UploadTab({ onFile, onDemo, progress }) {
  return (
    <div className="flex items-center justify-center min-h-[70vh] p-6">
      <div className="text-center w-full max-w-2xl space-y-8">
        <div className="flex justify-center">
          <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 shadow-sm">
            <Brain className="w-12 h-12 text-blue-600" />
          </div>
        </div>
        <div>
          <h2 className="text-3xl font-bold text-gray-900">
            AI Database Analysis Agent
          </h2>
          <p className="text-gray-500 mt-2 max-w-md mx-auto">
            Upload any SQLite database to get instant schema analysis, ER
            diagrams, data quality scores, and AI-generated business summaries.
          </p>
        </div>

        {progress ? (
          <div className="p-8 rounded-2xl border border-gray-200 bg-white shadow-lg flex flex-col items-center gap-5 transition-all">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 border-4 border-gray-100 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-blue-500 rounded-full border-t-transparent animate-spin"></div>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-blue-600">
                {progress.step}/{progress.max}
              </span>
            </div>
            <div className="w-full">
              <div className="flex justify-between text-xs text-gray-500 mb-2">
                <span>Processing</span>
                <span>{Math.round((progress.step / progress.max) * 100)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
                  style={{ width: `${(progress.step / progress.max) * 100}%` }}
                ></div>
              </div>
            </div>
            <p className="text-sm text-gray-600 font-medium bg-gray-50 px-4 py-2 rounded-full">
              {progress.text}
            </p>
          </div>
        ) : (
          <label className="flex flex-col items-center gap-3 p-12 rounded-2xl border-2 border-dashed border-gray-300 hover:border-blue-400 bg-white cursor-pointer transition-colors hover:shadow-md">
            <Upload className="w-10 h-10 text-gray-400" />
            <span className="text-sm text-gray-600">
              Drop <span className="text-blue-600 font-mono">.sqlite</span> or
              bulk <span className="text-emerald-600 font-mono">.csv</span> /{" "}
              <span className="text-purple-600 font-mono">.sql</span> files
            </span>
            <input
              type="file"
              className="hidden"
              accept=".sqlite,.db,.sqlite3,.csv,.sql"
              multiple
              onChange={onFile}
            />
          </label>
        )}

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-gray-50 text-gray-500">OR</span>
          </div>
        </div>

        <button
          onClick={onDemo}
          disabled={!!progress}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-medium shadow-md transition-all disabled:opacity-50"
        >
          Try Demo (Chinook Music DB)
        </button>
      </div>
    </div>
  );
}

function SchemaTab({ schema }) {
  const [sel, setSel] = useState(null);
  const tbs = schema.tables || [];
  const active = sel ? tbs.find((t) => t.name === sel) : tbs[0];
  const roleColor = (t) => {
    const out = (t.foreign_keys || []).length;
    const ref = tbs.some(
      (o) =>
        o.name !== t.name &&
        (o.foreign_keys || []).some((f) => f.references_table === t.name),
    );
    if (!out && !ref) return "bg-gray-300";
    if (out >= 2) return "bg-blue-400";
    if (ref) return "bg-emerald-400";
    return "bg-orange-400";
  };
  return (
    <div className="flex h-[calc(100vh-160px)]">
      <aside className="w-72 border-r border-gray-200 bg-white overflow-y-auto p-4 space-y-1">
        {tbs.map((t) => (
          <button
            key={t.name}
            onClick={() => setSel(t.name)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-colors ${
              active?.name === t.name
                ? "bg-blue-50 text-blue-700 border border-blue-200"
                : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${roleColor(t)}`}
            />
            <span className="truncate flex-1 font-medium">{t.name}</span>
            <span className="text-xs text-gray-400">{t.row_count}</span>
          </button>
        ))}
      </aside>
      <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
        {active && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-xl font-bold mb-1 text-gray-900">
              {active.name}
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              {active.row_count?.toLocaleString()} rows ·{" "}
              {active.columns?.length} columns
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-medium">Column</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 text-center font-medium">PK</th>
                    <th className="px-4 py-3 text-center font-medium">
                      Nullable
                    </th>
                    <th className="px-4 py-3 font-medium">FK Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(active.columns || []).map((c, i) => {
                    const fk = (active.foreign_keys || []).find(
                      (f) => f.column === c.name,
                    );
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-gray-800">
                          {c.name}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                          {c.type}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {c.primary_key ? "🔑" : ""}
                        </td>
                        <td className="px-4 py-3 text-center text-gray-500">
                          {c.nullable ? "Yes" : "No"}
                        </td>
                        <td className="px-4 py-3 text-emerald-600 text-xs font-mono">
                          {fk
                            ? `→ ${fk.references_table}.${fk.references_column}`
                            : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(active.sample_data || []).length > 0 && (
              <>
                <h3 className="font-semibold text-gray-700 mt-8 mb-3">
                  Sample Data
                </h3>
                <div className="overflow-x-auto border border-gray-200 rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {active.columns.map((c) => (
                          <th
                            key={c.name}
                            className="px-4 py-2 text-left font-medium text-gray-600"
                          >
                            {c.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {active.sample_data.map((row, ri) => (
                        <tr key={ri} className="border-t border-gray-100">
                          {active.columns.map((c) => (
                            <td
                              key={c.name}
                              className="px-4 py-2 text-gray-500 max-w-[200px] truncate"
                            >
                              {row[c.name] != null ? (
                                String(row[c.name])
                              ) : (
                                <span className="text-gray-300 italic">
                                  NULL
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function buildGraphvizER(schema, selTable) {
  let lines = [
    "digraph ER {",
    "  rankdir=LR;",
    '  bgcolor="transparent";',
    '  node [shape=none, fontname="Inter, Helvetica, Arial, sans-serif", fontsize=10, margin=0];',
    '  edge [fontname="Inter, Helvetica, Arial, sans-serif", fontsize=9, dir=both, color="#CBD5E1", penwidth=1.5];',
  ];
  const tables = schema.tables || [];
  const rels = schema.relationships || [];

  let relevantTables = tables;
  let relevantRels = rels;
  if (selTable) {
    relevantRels = rels.filter(
      (r) => r.from_table === selTable || r.to_table === selTable,
    );
    const tableNames = new Set([selTable]);
    relevantRels.forEach((r) => {
      tableNames.add(r.from_table);
      tableNames.add(r.to_table);
    });
    relevantTables = tables.filter((t) => tableNames.has(t.name));
  }

  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  for (const t of relevantTables) {
    const safeName = t.name.replace(/[^a-zA-Z0-9_]/g, "");
    const pks = new Set(t.primary_keys || []);
    const fks = new Set((t.foreign_keys || []).map((f) => f.column));

    const isWeak = pks.size > 0 && Array.from(pks).every((pk) => fks.has(pk));
    const isSelected = selTable === t.name;
    const headerBg = isSelected ? "#FEF3C7" : isWeak ? "#FEF2F2" : "#EFF6FF";
    const headerFg = isSelected ? "#B45309" : isWeak ? "#B91C1C" : "#1E40AF";
    const borderColor = isSelected ? "#F97316" : "#E2E8F0";
    const borderWidth = isSelected ? "2" : "1";

    let html = `  ${safeName} [label=<\n    <table border="${borderWidth}" cellborder="1" cellspacing="0" cellpadding="6" color="${borderColor}" bgcolor="#FFFFFF">\n`;
    html += `       <tr><td bgcolor="${headerBg}" colspan="3"><font color="${headerFg}" point-size="12"><b>${esc(t.name)}</b></font>${isWeak ? ' <font color="#EF4444" point-size="9">&lt;&lt;Weak&gt;&gt;</font>' : ""}</td></tr>\n`;

    for (const c of t.columns || []) {
      const isPk = pks.has(c.name);
      const isFk = fks.has(c.name);
      let icon = isPk ? "🔑" : isFk ? "🔗" : "📄";
      let nameStr = isPk
        ? `<b><font color="#000000">${esc(c.name)}</font></b>`
        : `<font color="#000000">${esc(c.name)}</font>`;
      let nullStr = !c.nullable ? '<b><font color="#000000">N</font></b>' : " ";

      html += `       <tr><td align="left">${icon} ${nameStr}</td><td align="left"><font color="#000000">${esc(c.type || "TEXT")}</font></td><td align="right">${nullStr}</td></tr>\n`;
    }
    html += `     </table>\n  >];`;
    lines.push(html);
  }

  const seenRels = new Set();
  for (const r of relevantRels) {
    if (!r.from_table || !r.to_table || !r.from_column || !r.to_column)
      continue;

    const fromSafe = r.from_table.replace(/[^a-zA-Z0-9_]/g, "");
    const toSafe = r.to_table.replace(/[^a-zA-Z0-9_]/g, "");

    const key = `${fromSafe}-${toSafe}-${r.from_column}`;
    if (seenRels.has(key)) continue;
    seenRels.add(key);

    const childTable = tables.find((t) => t.name === r.from_table);
    const childCol = childTable?.columns?.find((c) => c.name === r.from_column);
    const isTotal = childCol ? !childCol.nullable : false;
    const lineStyle = isTotal ? "solid" : "dashed";

    const arrtail = "crow";
    const arrhead = "teetee";

    lines.push(
      `  ${fromSafe} -> ${toSafe} [arrowtail=${arrtail}, arrowhead=${arrhead}, style=${lineStyle}];`,
    );
  }

  lines.push("}");
  return lines.join("\n");
}

function RelationshipsTab({ schema, erSvgCache, onErSvgReady }) {
  const rels = schema.relationships || [];
  const tbs = schema.tables || [];
  const [sel, setSel] = useState(null);
  const connected = sel
    ? rels.filter((r) => r.from_table === sel || r.to_table === sel)
    : rels;

  const [svg, setSvg] = useState("");
  const [loading, setLoading] = useState(false);

  const cacheKey = sel || "__all__";

  useEffect(() => {
    async function loadDiagram() {
      if (tbs.length === 0) return;
      if (erSvgCache?.[cacheKey]) {
        setSvg(erSvgCache[cacheKey]);
        return;
      }
      setLoading(true);
      const graphvizText = buildGraphvizER(schema, sel);
      try {
        const res = await fetch("https://kroki.io/graphviz/svg", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: graphvizText,
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(
            `Kroki Graphviz Error (${res.status}): ${errText.slice(0, 100)}`,
          );
        }
        const rawSvg = await res.text();
        const responsiveSvg = rawSvg.replace(
          /<svg /,
          '<svg style="max-width:100%; height:auto;" ',
        );
        setSvg(responsiveSvg);
        onErSvgReady?.(cacheKey, responsiveSvg);
      } catch (e) {
        setSvg(`<div class="text-red-600 p-8 border border-red-200 rounded-2xl bg-red-50 flex flex-col items-center gap-3">
          <span class="text-2xl">⚠️</span>
          <div class="text-center text-sm font-bold uppercase tracking-widest">ER Diagram Failed</div>
          <div class="text-xs opacity-70 max-w-xs text-center">${e.message}</div>
          <button onclick="window.location.reload()" class="mt-2 text-xs underline hover:text-red-800">Retry Connection</button>
        </div>`);
      }
      setLoading(false);
    }
    loadDiagram();
  }, [schema, sel, cacheKey]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between border-b border-gray-200 pb-4">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <GitGraph className="w-6 h-6 text-blue-600" />
          Entity-Relationship Diagram
        </h2>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSel(null)}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
            !sel
              ? "bg-blue-600 text-white shadow-sm"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          All Tables
        </button>
        {tbs.map((t) => (
          <button
            key={t.name}
            onClick={() => setSel(t.name)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              sel === t.name
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden relative h-[600px] w-full group">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-20 backdrop-blur-sm">
            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            <span className="mt-4 text-xs font-medium text-blue-600 uppercase tracking-widest animate-pulse">
              Rendering ER Diagram…
            </span>
          </div>
        )}

        {svg && (
          <TransformWrapper
            key={sel || "all"}
            initialScale={1}
            minScale={0.1}
            maxScale={4}
            centerOnInit={true}
            wheel={{ step: 0.1 }}
          >
            {({ zoomIn, zoomOut, resetTransform }) => (
              <div className="w-full h-full relative">
                <div className="absolute top-4 right-4 z-10 flex gap-2 bg-white/90 backdrop-blur-sm p-2 rounded-xl border border-gray-200 shadow-md opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => zoomIn(0.2)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                    title="Zoom In"
                  >
                    +
                  </button>
                  <button
                    onClick={() => zoomOut(0.2)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                    title="Zoom Out"
                  >
                    -
                  </button>
                  <button
                    onClick={() => resetTransform()}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                    title="Reset View"
                  >
                    ↺
                  </button>
                </div>
                <TransformComponent wrapperClass="!w-full !h-full">
                  <div
                    className="min-w-fit min-h-fit p-16 select-none [&>svg]:cursor-grab [&>svg]:active:cursor-grabbing"
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                </TransformComponent>
              </div>
            )}
          </TransformWrapper>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200 pb-2">
          Relationships ({connected.length})
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {connected.map((r, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 p-4 rounded-xl bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  {r.from_table}
                </span>
                <span className="text-gray-400 text-xs">→</span>
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                  {r.to_table}
                </span>
              </div>
              <div className="flex justify-between items-center mt-1">
                <span className="font-mono text-xs text-gray-500">
                  .{r.from_column}
                </span>
                <span className="font-mono text-xs text-gray-500">
                  .{r.to_column}
                </span>
              </div>
              <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-medium ${r.inferred ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"}`}
                >
                  {r.inferred ? "Inferred" : "Explicit"}
                </span>
                <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {r.cardinality || "1:N"}
                </span>
              </div>
            </div>
          ))}
          {connected.length === 0 && (
            <p className="text-gray-500 text-sm py-4 col-span-full">
              No explicit foreign keys found.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function QualityTab({ schema, db, onReady }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selTable, setSelTable] = useState(null);
  const [selCol, setSelCol] = useState(null);
  const [colStats, setColStats] = useState(null);

  const cm = {
    green: "#22c55e",
    yellow: "#eab308",
    orange: "#f97316",
    red: "#ef4444",
  };

  async function run() {
    if (!db) return;
    setLoading(true);
    const profiles = [];
    const fkReport = [];
    const issues = [];
    const sql = (q) => {
      try {
        const r = db.exec(q);
        return r.length ? r[0].values : [];
      } catch {
        return [];
      }
    };
    const scalar = (q) => {
      const r = sql(q);
      return r.length ? r[0][0] : null;
    };

    for (const tbl of schema.tables) {
      const rc = scalar(`SELECT COUNT(*) FROM "${tbl.name}"`) || 0;
      if (rc === 0) {
        profiles.push({
          table: tbl.name,
          row_count: 0,
          cols: [],
          avg_comp: 0,
          fk_int: 100,
          fresh: 50,
          score: 0,
          color: "red",
        });
        continue;
      }

      let tblFresh = 50;
      const dateCols = (tbl.columns || []).filter(
        (c) =>
          c.type &&
          (c.type.toUpperCase().includes("DATE") ||
            c.type.toUpperCase().includes("TIME")),
      );
      if (dateCols.length > 0) {
        let maxEpoch = 0;
        for (const dc of dateCols) {
          const maxD = scalar(
            `SELECT MAX("${dc.name}") FROM "${tbl.name}" WHERE "${dc.name}" IS NOT NULL`,
          );
          if (maxD) {
            const ms = Date.parse(maxD);
            if (!isNaN(ms) && ms > maxEpoch) maxEpoch = ms;
          }
        }
        if (maxEpoch > 0) {
          const ageDays = (Date.now() - maxEpoch) / (1000 * 60 * 60 * 24);
          if (ageDays <= 30) tblFresh = 100;
          else if (ageDays <= 365) tblFresh = 80;
          else if (ageDays <= 1825) tblFresh = 60;
          else tblFresh = 40;
        } else {
          tblFresh = 60;
        }
      } else {
        tblFresh = 80;
      }

      const cols = (tbl.columns || []).map((c) => {
        const nc =
          scalar(`SELECT COUNT(*)-COUNT("${c.name}") FROM "${tbl.name}"`) || 0;
        const dc =
          scalar(`SELECT COUNT(DISTINCT "${c.name}") FROM "${tbl.name}"`) || 0;
        const nr = +((nc / rc) * 100).toFixed(2);
        const comp = +(100 - nr).toFixed(2);
        if (nr > 5)
          issues.push({
            sev: nr > 30 ? "critical" : "warning",
            table: tbl.name,
            col: c.name,
            msg: `Null rate: ${nr}%`,
            code: "HIGH_NULL",
          });
        return {
          name: c.name,
          type: c.type,
          null_rate: nr,
          completeness: comp,
          distinct: dc,
          uniqueness: +((dc / rc) * 100).toFixed(2),
        };
      });
      const avgComp = +(
        cols.reduce((s, c) => s + c.completeness, 0) / cols.length
      ).toFixed(2);
      for (const fk of tbl.foreign_keys || []) {
        const total =
          scalar(
            `SELECT COUNT(*) FROM "${tbl.name}" WHERE "${fk.column}" IS NOT NULL`,
          ) || 0;
        const orphan =
          scalar(
            `SELECT COUNT(*) FROM "${tbl.name}" WHERE "${fk.column}" IS NOT NULL AND "${fk.column}" NOT IN (SELECT "${fk.references_column}" FROM "${fk.references_table}")`,
          ) || 0;
        const int =
          total > 0 ? +(((total - orphan) / total) * 100).toFixed(2) : 100;
        fkReport.push({
          child: tbl.name,
          col: fk.column,
          parent: fk.references_table,
          int,
          orphan,
        });
        if (int < 99)
          issues.push({
            sev: int < 90 ? "critical" : "warning",
            table: tbl.name,
            col: fk.column,
            msg: `FK integrity: ${int}%`,
            code: "FK_FAIL",
          });
      }
      const tblFks = fkReport.filter((f) => f.child === tbl.name);
      const fkInt = tblFks.length
        ? +(tblFks.reduce((s, f) => s + f.int, 0) / tblFks.length).toFixed(2)
        : 100;
      const score = +(
        avgComp * 0.4 +
        fkInt * 0.3 +
        tblFresh * 0.2 +
        80 * 0.1
      ).toFixed(2);
      profiles.push({
        table: tbl.name,
        row_count: rc,
        cols,
        avg_comp: avgComp,
        fk_int: fkInt,
        fresh: tblFresh,
        score,
        color:
          score >= 90
            ? "green"
            : score >= 75
              ? "yellow"
              : score >= 50
                ? "orange"
                : "red",
      });
    }
    const nonEmpty = profiles.filter((p) => p.row_count > 0);
    const health = nonEmpty.length
      ? +(nonEmpty.reduce((s, p) => s + p.score, 0) / nonEmpty.length).toFixed(
          2,
        )
      : 0;
    const r = {
      overall_health: health,
      overall_color: health >= 90 ? "green" : health >= 75 ? "yellow" : "red",
      profiles,
      fk_report: fkReport,
      issues: issues.sort(
        (a, b) =>
          (a.sev === "critical" ? 0 : 1) - (b.sev === "critical" ? 0 : 1),
      ),
    };
    setReport(r);
    setLoading(false);
    onReady(r);
  }

  const getColStats = async (tableName, colName) => {
    if (!db) return;
    const sql = (q) => {
      try {
        const r = db.exec(q);
        return r.length ? r[0].values : [];
      } catch {
        return [];
      }
    };
    const scalar = (q) => {
      const r = sql(q);
      return r.length ? r[0][0] : null;
    };

    const stats = {
      mean: scalar(
        `SELECT AVG("${colName}") FROM "${tableName}" WHERE typeof("${colName}") IN ('integer','real')`,
      ),
      min: scalar(`SELECT MIN("${colName}") FROM "${tableName}"`),
      max: scalar(`SELECT MAX("${colName}") FROM "${tableName}"`),
      mode: scalar(
        `SELECT "${colName}" FROM "${tableName}" GROUP BY "${colName}" ORDER BY COUNT(*) DESC LIMIT 1`,
      ),
      nulls: scalar(
        `SELECT COUNT(*) - COUNT("${colName}") FROM "${tableName}"`,
      ),
      total: scalar(`SELECT COUNT(*) FROM "${tableName}"`),
    };

    let dist = [];
    const isNum = stats.mean !== null;
    if (isNum) {
      const step = (stats.max - stats.min) / 10 || 1;
      for (let i = 0; i < 10; i++) {
        const low = stats.min + i * step;
        const high = stats.min + (i + 1) * step;
        const count = scalar(
          `SELECT COUNT(*) FROM "${tableName}" WHERE "${colName}" >= ${low} AND "${colName}" < ${high}`,
        );
        dist.push({ bin: low.toFixed(2), value: count });
      }
    } else {
      const top5 = sql(
        `SELECT "${colName}", COUNT(*) as c FROM "${tableName}" GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
      );
      dist = top5.map((r) => ({ bin: String(r[0]).slice(0, 10), value: r[1] }));
    }

    setColStats({ ...stats, dist, isNum });
  };

  useEffect(() => {
    if (selTable && selCol) getColStats(selTable, selCol);
    else setColStats(null);
  }, [selTable, selCol]);

  const sortedProfiles = useMemo(() => {
    if (!report?.profiles) return [];
    return [...report.profiles].sort((a, b) => b.score - a.score);
  }, [report?.profiles]);

  const activeCols = useMemo(() => {
    const raw = selTable
      ? report?.profiles?.find((p) => p.table === selTable)?.cols
      : null;
    if (!raw) return null;
    return [...raw].sort((a, b) => b.null_rate - a.null_rate);
  }, [report?.profiles, selTable]);

  const issuesList = useMemo(() => {
    if (!report?.issues) return [];
    return [...report.issues];
  }, [report?.issues]);

  if (!report && !loading)
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-6 p-6">
        <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center">
          <Activity className="w-10 h-10 text-amber-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Data Quality Engine</h2>
        <p className="text-gray-500 max-w-sm text-center text-sm">
          Analyze completeness, integrity, and statistical distributions of your
          dataset.
        </p>
        <button
          onClick={run}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium shadow-sm hover:shadow-md transition-all flex items-center gap-2"
        >
          <Zap className="w-4 h-4" /> Run Quality Analysis
        </button>
      </div>
    );

  if (loading)
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-6">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 border-4 border-blue-100 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
        <div className="text-center">
          <p className="text-blue-600 font-medium uppercase tracking-widest text-xs animate-pulse">
            Analyzing Data Integrity…
          </p>
          <p className="text-gray-500 text-xs mt-1">
            Calculating null rates and orphans
          </p>
        </div>
      </div>
    );

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8 pb-16">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white border border-gray-200 rounded-2xl p-6 flex flex-col items-center justify-center shadow-sm">
          <div
            className="relative w-36 h-36 rounded-full flex items-center justify-center"
            style={{
              background: report?.overall_color
                ? `conic-gradient(${cm[report.overall_color] || "#1f2937"} ${Math.round(report.overall_health || 0) * 3.6}deg, #f3f4f6 0deg)`
                : "#f3f4f6",
            }}
          >
            <div className="absolute inset-3 bg-white rounded-full flex items-center justify-center flex-col shadow-inner">
              <span
                className="text-4xl font-black"
                style={{ color: cm[report?.overall_color] || "#374151" }}
              >
                {Math.round(report?.overall_health || 0)}
              </span>
              <span className="text-[10px] text-gray-500 font-medium uppercase tracking-widest">
                Health Score
              </span>
            </div>
          </div>
        </div>
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-500" /> Database Quality
            Overview
          </h3>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sortedProfiles}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#e5e7eb"
                  vertical={false}
                />
                <XAxis dataKey="table" hide />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "12px",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                  {sortedProfiles.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={cm[entry.color] || "#9ca3af"}
                      fillOpacity={0.8}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
            Table Quality Matrix
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-600 border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 font-medium">
                  Table Entity
                </th>
                <th className="text-right px-4 py-3 font-medium">Rows</th>
                <th className="text-center px-4 py-3 font-medium">
                  Completeness
                </th>
                <th className="text-center px-4 py-3 font-medium">Score</th>
                <th className="text-right px-6 py-3 font-medium">Grade</th>
              </tr>
            </thead>
            <tbody>
              {sortedProfiles.map((p) => (
                <tr
                  key={p.table}
                  onClick={() => {
                    setSelTable(selTable === p.table ? null : p.table);
                    setSelCol(null);
                  }}
                  className={`group border-b border-gray-100 cursor-pointer transition-all ${selTable === p.table ? "bg-blue-50" : "hover:bg-gray-50"}`}
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2 h-2 rounded-full`}
                        style={{ backgroundColor: cm[p.color] || "#9ca3af" }}
                      ></div>
                      <span className="text-gray-900 font-medium">
                        {p.table}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 font-mono">
                    {p.row_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-24 mx-auto h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-1000"
                        style={{
                          width: `${p.avg_comp}%`,
                          backgroundColor: cm[p.color] || "#9ca3af",
                        }}
                      ></div>
                    </div>
                  </td>
                  <td
                    className="px-4 py-3 text-center font-bold text-sm"
                    style={{ color: cm[p.color] || "#374151" }}
                  >
                    {Math.round(p.score)}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span
                      className="w-8 h-8 inline-flex items-center justify-center rounded-xl text-xs font-bold text-white shadow-sm"
                      style={{ backgroundColor: cm[p.color] || "#9ca3af" }}
                    >
                      {p.score >= 90
                        ? "A"
                        : p.score >= 75
                          ? "B"
                          : p.score >= 50
                            ? "C"
                            : "D"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {activeCols && (
          <div className="bg-white border border-blue-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-blue-700 uppercase tracking-widest">
                {selTable} — Column Quality
              </h3>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white z-10 border-b border-gray-100">
                  <tr className="text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-6 py-3 font-medium">Column</th>
                    <th className="text-center px-4 py-3 font-medium">Null%</th>
                    <th className="text-center px-4 py-3 font-medium">
                      Unique%
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeCols.map((c, i) => (
                    <tr
                      key={i}
                      onClick={() =>
                        setSelCol(selCol === c.name ? null : c.name)
                      }
                      className={`border-b border-gray-100 transition-all cursor-pointer ${selCol === c.name ? "bg-blue-50" : "hover:bg-gray-50"}`}
                    >
                      <td className="px-6 py-3 font-mono text-gray-800">
                        {c.name}
                      </td>
                      <td
                        className={`px-4 py-3 text-center ${c.null_rate > 5 ? "text-orange-600" : "text-gray-500"}`}
                      >
                        {c.null_rate}%
                      </td>
                      <td className="px-4 py-3 text-center text-gray-500 font-mono">
                        {c.uniqueness}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {selCol && colStats && (
          <div className="bg-white border border-emerald-200 rounded-2xl p-6 shadow-sm space-y-6 self-start">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" /> {selCol}{" "}
                Stats
              </h4>
              <button
                onClick={() => setSelCol(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { l: "Mean", v: colStats.mean, s: colStats.isNum },
                { l: "Min", v: colStats.min, s: true },
                { l: "Max", v: colStats.max, s: true },
              ].map((s, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-xl bg-gray-50 border border-gray-100 flex flex-col items-center justify-center ${!s.s ? "opacity-40" : ""}`}
                >
                  <p className="text-[10px] uppercase font-semibold text-gray-500 tracking-widest">
                    {s.l}
                  </p>
                  <p className="text-xs font-mono font-bold mt-1 text-emerald-600">
                    {typeof s.v === "number" ? s.v.toFixed(2) : String(s.v)}
                  </p>
                </div>
              ))}
            </div>
            <div className="h-44 w-full bg-gray-50 rounded-xl p-4 border border-gray-100">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={colStats.dist}>
                  <XAxis dataKey="bin" hide />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      fontSize: "10px",
                    }}
                  />
                  <Bar dataKey="value" fill="#10b981" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-red-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 bg-red-50 border-b border-red-100 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-red-700 uppercase tracking-widest flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> Anomaly Feed (
            {issuesList.length})
          </h3>
        </div>
        <div className="divide-y divide-gray-100 max-h-[300px] overflow-y-auto">
          {issuesList.map((iss, i) => (
            <div
              key={i}
              className="px-6 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors"
            >
              <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-red-100 text-red-600">
                <AlertCircle className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-800">
                    {iss.table}
                  </span>
                  <ChevronRight className="w-3 h-3 text-gray-400" />
                  <span className="text-xs font-mono text-gray-600">
                    {iss.col}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{iss.msg}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildFocusedGraphvizER(schema, tableName) {
  const tbl = schema.tables.find((t) => t.name === tableName);
  if (!tbl) return "";

  const directRels = schema.relationships.filter(
    (r) => r.from_table === tableName || r.to_table === tableName,
  );
  const neighbourNames = new Set([tableName]);
  directRels.forEach((r) => {
    neighbourNames.add(r.from_table);
    neighbourNames.add(r.to_table);
  });

  const palette = [
    "#3B82F6",
    "#8B5CF6",
    "#10B981",
    "#F59E0B",
    "#EF4444",
    "#06B6D4",
    "#EC4899",
  ];
  const colorMap = {};
  let ci = 0;
  neighbourNames.forEach((n) => {
    colorMap[n] = palette[ci++ % palette.length];
  });

  const focusTbls = schema.tables.filter((t) => neighbourNames.has(t.name));

  const nodesDot = focusTbls
    .map((t) => {
      const pks = t.primary_keys || [];
      const fks = (t.foreign_keys || []).map((f) => f.column);
      const rows = (t.columns || [])
        .map((c) => {
          const isPk = pks.includes(c.name);
          const isFk = fks.includes(c.name);
          const icon = isPk ? "🔑 " : isFk ? "🔗 " : "";
          const badge = isPk ? " PK" : isFk ? " FK" : "";
          const color = isPk ? "#FCD34D" : isFk ? "#6EE7B7" : "#CBD5E1";
          return `   <tr><td align="left" bgcolor="${isPk ? "#1E1B0A" : isFk ? "#071A12" : "#111827"}" port="${c.name}"><font color="${color}" point-size="9">${icon}${c.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}${badge} — ${c.type}</font></td></tr>`;
        })
        .join("");
      const isCenter = t.name === tableName;
      return `  "${t.name}" [label=<<table border="0" cellborder="1" cellspacing="0" cellpadding="5" bgcolor="${colorMap[t.name]}22" style="rounded">   <tr><td bgcolor="${colorMap[t.name]}" align="center"><font color="white" point-size="11"><b>${isCenter ? "★ " : ""}${t.name}</b></font></td></tr>${rows}</table>>, fillcolor="transparent", shape=none, margin=0]`;
    })
    .join("\n");

  const edgesDot = directRels
    .map(
      (r) =>
        `  "${r.from_table}":"${r.from_column}" -> "${r.to_table}":"${r.to_column}" [label="FK", fontsize=8, color="#60A5FA", fontcolor="#60A5FA", penwidth=1.5, style="${r.inferred ? "dashed" : "solid"}"]`,
    )
    .join("\n");

  return `digraph focused_er {
  rankdir=LR; bgcolor="transparent"; splines=ortho; nodesep=0.6;
  node [shape=none, fontname="Helvetica", margin=0];
  edge [fontname="Helvetica"];
${nodesDot}
${edgesDot}
}`;
}

function DictionaryTab({
  schema,
  geminiApiKey,
  erSvgCache = {},
  onErSvgReady,
}) {
  const [selTable, setSelTable] = useState(schema?.tables?.[0]?.name || null);
  const [dictCache, setDictCache] = useState({});
  const [loading, setLoading] = useState(false);
  const [erSvg, setErSvg] = useState(null);
  const [erLoading, setErLoading] = useState(false);
  const [error, setError] = useState(null);

  const tbl = (schema?.tables || []).find((t) => t.name === selTable);

  useEffect(() => {
    if (!selTable) return;
    const key = selTable;
    if (erSvgCache?.[key]) {
      setErSvg(erSvgCache[key]);
      return;
    }
    setErLoading(true);
    const dot = buildGraphvizER(schema, selTable);
    if (!dot) {
      setErLoading(false);
      return;
    }
    fetch("https://kroki.io/graphviz/svg", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: dot,
    })
      .then((r) => r.text())
      .then((svg) => {
        const resp = svg.replace(
          /<svg /,
          '<svg style="max-width:100%;height:auto;" ',
        );
        setErSvg(resp);
        onErSvgReady?.(key, resp);
      })
      .catch((e) => {
        console.warn("ER fetch error:", e);
        setErSvg(null);
      })
      .finally(() => setErLoading(false));
  }, [selTable]);

  async function generateDict() {
    if (!tbl || loading) return;
    setLoading(true);
    const samples = (tbl.sample_data || []).slice(0, 3);
    const colList = (tbl.columns || [])
      .map((c) => `${c.name} (${c.type})`)
      .join(", ");
    const prompt = `You are a Principal Data Architect writing a Human-Readable Data Dictionary.
Database domain: ${schema.metadata?.database_name || "Unknown"}.
Table: "${tbl.name}" (${tbl.row_count?.toLocaleString()} rows).
Columns: ${colList}.
Sample rows: ${JSON.stringify(samples)}.

For EACH column, write exactly ONE concise sentence (max 20 words) explaining what the column represents to a business user.
Return ONLY an unfenced JSON object where keys are column names and values are the descriptions. No markdown.`;

    try {
      const raw = await callGemini(geminiApiKey, prompt, 0.2);
      const cleanJson = raw
        .replace(/```json?/g, "")
        .replace(/```/g, "")
        .trim();
      const s = raw.indexOf("{"),
        e = raw.lastIndexOf("}");
      const dict = JSON.parse(s !== -1 ? raw.slice(s, e + 1) : "{}");
      setDictCache((c) => ({ ...c, [selTable]: dict }));
    } catch (err) {
      console.error("Dictionary generation failed:", err);
    }
    setLoading(false);
  }

  const dictData = dictCache[selTable] || null;

  return (
    <div className="flex h-[calc(100vh-160px)] overflow-hidden bg-white">
      {/* LEFT PANEL — Table Selector */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 overflow-y-auto bg-gray-50">
        <div className="px-4 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
            📖 Data Dictionary
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            {schema.tables.length} tables
          </p>
        </div>
        <div className="p-2 space-y-1">
          {(schema.tables || []).map((t) => {
            const ready = !!dictCache[t.name];
            return (
              <button
                key={t.name}
                onClick={() => setSelTable(t.name)}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-all text-sm ${
                  selTable === t.name
                    ? "bg-blue-50 border border-blue-200 text-blue-700"
                    : "hover:bg-gray-100 text-gray-700 border border-transparent"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium truncate">{t.name}</span>
                  {ready ? (
                    <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      ✓
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      ⚡
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {t.row_count?.toLocaleString()} rows · {t.columns?.length}{" "}
                  cols
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="flex-1 overflow-y-auto p-6">
        {tbl ? (
          <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{tbl.name}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {tbl.row_count?.toLocaleString()} rows · {tbl.columns?.length}{" "}
                  columns · {(tbl.primary_keys || []).length} PKs ·{" "}
                  {(tbl.foreign_keys || []).length} FKs
                </p>
              </div>
              <button
                onClick={generateDict}
                disabled={loading || !!dictData}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all shadow-sm ${
                  dictData
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default"
                    : loading
                      ? "bg-violet-50 text-violet-600 border border-violet-200 cursor-wait animate-pulse"
                      : "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-600 hover:to-fuchsia-600"
                }`}
              >
                {dictData
                  ? "✓ Dictionary Ready"
                  : loading
                    ? "⏳ Generating…"
                    : "✨ Generate with Gemini"}
              </button>
            </div>

            {/* ER Diagram */}
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(schema.tables || []).map((t) => (
                  <button
                    key={t.name}
                    onClick={() => setSelTable(t.name)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${selTable === t.name ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden relative h-[400px] w-full group">
                {erLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-20 backdrop-blur-sm">
                    <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                    <span className="mt-4 text-xs font-medium text-blue-600 animate-pulse">
                      Rendering ER Diagram…
                    </span>
                  </div>
                )}
                {erSvg && (
                  <TransformWrapper
                    key={selTable}
                    initialScale={1}
                    minScale={0.1}
                    maxScale={4}
                    centerOnInit={true}
                    wheel={{ step: 0.1 }}
                  >
                    {({ zoomIn, zoomOut, resetTransform }) => (
                      <div className="w-full h-full relative">
                        <div className="absolute top-4 right-4 z-10 flex gap-2 bg-white/90 backdrop-blur-sm p-2 rounded-xl border border-gray-200 shadow-md opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => zoomIn(0.2)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600"
                          >
                            +
                          </button>
                          <button
                            onClick={() => zoomOut(0.2)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600"
                          >
                            -
                          </button>
                          <button
                            onClick={() => resetTransform()}
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600"
                          >
                            ↺
                          </button>
                        </div>
                        <TransformComponent wrapperClass="!w-full !h-full">
                          <div
                            className="min-w-fit min-h-fit p-16 select-none [&>svg]:cursor-grab [&>svg]:active:cursor-grabbing"
                            dangerouslySetInnerHTML={{ __html: erSvg }}
                          />
                        </TransformComponent>
                      </div>
                    )}
                  </TransformWrapper>
                )}
              </div>
            </div>

            {/* Column Dictionary Table */}
            <div className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  📋 Column Definitions
                </h3>
                {!dictData && (
                  <span className="text-[10px] text-gray-400">
                    — Click "Generate with Gemini" to add AI descriptions
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr className="text-gray-600">
                      <th className="text-left px-4 py-2.5 w-44 font-medium">
                        Column
                      </th>
                      <th className="text-left px-3 py-2.5 w-28 font-medium">
                        Type
                      </th>
                      <th className="text-center px-3 py-2.5 w-12 font-medium">
                        PK
                      </th>
                      <th className="text-center px-3 py-2.5 w-12 font-medium">
                        FK
                      </th>
                      <th className="text-center px-3 py-2.5 w-12 font-medium">
                        Null?
                      </th>
                      <th className="text-left px-3 py-2.5 font-medium">
                        🤖 AI Description
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(tbl.columns || []).map((c, i) => {
                      const isFk = (tbl.foreign_keys || []).some(
                        (f) => f.column === c.name,
                      );
                      const fkRef = (tbl.foreign_keys || []).find(
                        (f) => f.column === c.name,
                      );
                      const desc = dictData?.[c.name];
                      return (
                        <tr
                          key={i}
                          className={`transition-colors ${
                            c.primary_key
                              ? "bg-yellow-50/50 hover:bg-yellow-50"
                              : isFk
                                ? "bg-emerald-50/50 hover:bg-emerald-50"
                                : "hover:bg-gray-50"
                          }`}
                        >
                          <td className="px-4 py-2.5 font-mono text-gray-800 font-medium whitespace-nowrap">
                            {c.name}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-blue-600">
                            {c.type}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {c.primary_key ? "🔑" : ""}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {isFk ? (
                              <span
                                title={`→ ${fkRef.references_table}.${fkRef.references_column}`}
                                className="cursor-help"
                              >
                                🔗
                              </span>
                            ) : (
                              ""
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center text-gray-500 text-xs">
                            {c.nullable ? "Yes" : "No"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-600 leading-relaxed text-sm">
                            {desc ? (
                              <span>{desc}</span>
                            ) : loading ? (
                              <span className="inline-block w-32 h-3 bg-gray-200 rounded animate-pulse"></span>
                            ) : (
                              <span className="text-xs italic text-gray-400">
                                Not yet generated
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sample Data Preview */}
            {(tbl.sample_data || []).length > 0 && (
              <div className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    🧪 Sample Data (first 5 rows)
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {Object.keys(tbl.sample_data[0] || {}).map((k) => (
                          <th
                            key={k}
                            className="text-left px-3 py-2 text-gray-600 font-mono font-medium whitespace-nowrap"
                          >
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tbl.sample_data.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-gray-100 hover:bg-gray-50"
                        >
                          {Object.values(row).map((val, j) => (
                            <td
                              key={j}
                              className="px-3 py-1.5 text-gray-500 font-mono whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis"
                            >
                              {val === null ? (
                                <span className="text-gray-300 italic">
                                  NULL
                                </span>
                              ) : (
                                String(val)
                              )}
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
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 text-sm">
              Select a table from the left panel
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function BusinessContextTab({
  schema,
  quality,
  geminiApiKey,
  cached,
  onReady,
}) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(cached);

  async function generate() {
    setLoading(true);
    const tablesInfo = schema.tables
      .map(
        (t) =>
          `${t.name}: ${(t.columns || []).map((c) => `${c.name} (${c.type})`).join(", ")}`,
      )
      .join("\n");
    const pkInfo = schema.tables
      .map((t) => `${t.name}: ${(t.primary_keys || []).join(", ")}`)
      .join("\n");
    const fkInfo = schema.relationships
      .map(
        (r) =>
          `${r.from_table}.${r.from_column} -> ${r.to_table}.${r.to_column}`,
      )
      .join("\n");
    const sampleInfo = schema.tables
      .map(
        (t) =>
          `Table: ${t.name}\n${JSON.stringify((t.sample_data || []).slice(0, 2)).slice(0, 2000)}`,
      )
      .join("\n\n");
    const qualityInfo = quality
      ? `Average Health: ${quality.overall_health}/100. Issues: ${quality.issues.length}`
      : "Not available";

    const prompt = `Analyze the following relational database and generate a professional business report.

DATABASE NAME: ${schema.metadata?.database_name || "Unknown"}
SCHEMA:
${tablesInfo}

PRIMARY KEYS:
${pkInfo}

FOREIGN KEYS / RELATIONSHIPS:
${fkInfo}

SAMPLE DATA:
${sampleInfo}

DATA QUALITY SUMMARY:
${qualityInfo}

---
Generate a detailed Business Context Summary with the following sections. Use Markdown formatting:

1. 🧾 Overall Business Overview
- Describe industrial domain and main purpose.

2. 🧩 Core Business Entities
- Identify key entities and what they represent in plain English.

3. 🔗 Relationship & Interaction Narrative
- Translate FKs into real-world interactions. 
- Describe cardinality simply (one-to-many, etc.).
- Include a simple text-based flow diagram using "----" symbols.

4. 🔄 Business Workflows / Lifecycle
- End-to-end processes (creation -> processing -> completion).

5. 💼 Business Functions & Use Cases
- How this data supports operations (logistics, analytics, etc).

6. 📊 Key Metrics & KPIs (Inferred)
- Derive metrics like revenue, retention, conversion, etc.

7. ⚠️ Data Quality & Business Impact
- Explain technical issues in business terms.

8. 🧠 Insights & Observations
- Structure implications or interesting patterns.

9. 📘 Glossary (Business-Friendly)
- Technical-to-Human mapping.

Guidelines:
- Professional tone, concise but informative.
- Inferred meaning intelligently.
- Output ONLY the markdown report content. No conversational filler.`;

    try {
      const text = await callGemini(geminiApiKey, prompt, 0.3);
      setReport(text || "No report generated.");
      onReady(text);
    } catch (e) {
      console.error("BI Generation Error:", e);
      setReport(
        `Analysis failed: ${e.message}. \n\nSuggested Fix: Try a different API key or check your Google AI Studio account for model access.`,
      );
    }
    setLoading(false);
  }

  const renderContent = (text) => {
    return text.split("\n").map((line, i) => {
      if (line.startsWith("### "))
        return (
          <h3
            key={i}
            className="text-lg font-bold text-gray-800 mt-6 mb-2 border-b border-gray-200 pb-1"
          >
            {line.slice(4)}
          </h3>
        );
      if (line.startsWith("## "))
        return (
          <h2
            key={i}
            className="text-xl font-bold text-blue-600 mt-8 mb-3 uppercase tracking-wider"
          >
            {line.slice(3)}
          </h2>
        );
      if (line.startsWith("# "))
        return (
          <h1
            key={i}
            className="text-2xl font-black text-gray-900 mt-10 mb-4 bg-gray-100 p-4 rounded-xl border border-gray-200"
          >
            {line.slice(2)}
          </h1>
        );
      if (line.startsWith("- ") || line.startsWith("* "))
        return (
          <li
            key={i}
            className="ml-4 text-gray-700 mb-1 leading-relaxed list-disc list-outside ml-6"
          >
            {line.slice(2)}
          </li>
        );
      if (line.match(/^\d+\.\s/))
        return (
          <h2
            key={i}
            className="text-xl font-bold text-gray-800 mt-10 mb-4 flex items-center gap-3 bg-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm"
          >
            <span className="w-8 h-8 flex items-center justify-center bg-blue-100 rounded-lg text-blue-600 text-base">
              {line.split(".")[0]}
            </span>
            {line.split(".").slice(1).join(".").trim()}
          </h2>
        );
      if (line.trim() === "") return <div key={i} className="h-4" />;
      return (
        <p key={i} className="text-gray-600 mb-4 leading-relaxed text-sm">
          {line}
        </p>
      );
    });
  };

  return (
    <div className="max-w-5xl mx-auto p-8 pb-20">
      {!report && !loading && (
        <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-6">
          <div className="text-6xl animate-bounce">🧠</div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Deep Business Analysis
            </h2>
            <p className="text-gray-500 text-sm max-w-sm">
              The agent will now analyze your schema, relationships, and data
              quality to generate a comprehensive BI report.
            </p>
          </div>
          <button
            onClick={generate}
            className="px-8 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium shadow-md transition-all active:scale-95"
          >
            ✨ Generate Professional BI Report
          </button>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
          <p className="text-blue-600 text-xs font-medium uppercase tracking-widest animate-pulse">
            Consulting Principal Data Architect…
          </p>
        </div>
      )}

      {report && !loading && (
        <div className="bg-white border border-gray-200 rounded-2xl p-10 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <span className="text-9xl rotate-12 inline-block">📋</span>
          </div>
          <div className="prose prose-slate max-w-none">
            {renderContent(report)}
          </div>
          <div className="mt-12 pt-8 border-t border-gray-200 flex justify-between items-center text-xs text-gray-400 uppercase tracking-widest">
            <span>AI Forensic Agent · BI Edition</span>
            <span>Generated {new Date().toLocaleDateString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
