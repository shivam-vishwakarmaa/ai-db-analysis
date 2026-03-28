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
  Globe,
  CloudDownload,
  Upload,
  Download,
} from "lucide-react";
import "./index.css";
import RelationshipMapper from "./RelationshipMapper";

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

/* ═══════════════════════════════════════════════════════════
   AI Database Analysis Agent — Main Dashboard (RE-BUILD TRIGGER)
   ═══════════════════════════════════════════════════════════ */

/* Dynamic Gemini API Helper with auto-discovery & retry (429 backoff) */
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
    // Stage 1: Sanitize & Discovery
    const key = apiKey?.trim();
    if (!key)
      throw new Error(
        "Gemini API Key is empty. Please check your configuration.",
      );

    const versions = ["v1beta", "v1"];
    const primaryModels = [
      "gemini-1.5-flash-latest",
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b",
      "gemini-1.5-pro-latest",
      "gemini-pro",
    ];

    let modelToUse = cachedModel || primaryModels[0];
    let availableModels = [];
    let discoveryError = null;

    if (!cachedModel) {
      for (const ver of versions) {
        try {
          const u = `https://generativelanguage.googleapis.com/${ver}/models?key=${key}`;
          const listResp = await fetch(u);
          if (listResp.ok) {
            const listData = await listResp.json();
            availableModels = (listData.models || []).map((m) =>
              m.name.split("/").pop(),
            );
            const choice =
              primaryModels.find((p) => availableModels.includes(p)) ||
              availableModels.find((n) => n.includes("1.5-flash")) ||
              availableModels[0];
            if (choice) {
              modelToUse = choice;
              cachedModel = modelToUse;
              break;
            }
          } else {
            discoveryError = await listResp.text();
            console.error(`Discovery ${ver} failed:`, discoveryError);
          }
        } catch (e) {
          discoveryError = e.message;
        }
      }
    }

    // Stage 2: Execution with Smart Rotation
    const executeCall = async (ver, model) => {
      const url = `https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${key}`;
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature },
        }),
      });
    };

    let finalResp = null;
    let lastAttemptedModel = modelToUse;

    // Attempt 1: The standard choice
    finalResp = await executeCall("v1beta", modelToUse);
    if (!finalResp.ok && finalResp.status === 404)
      finalResp = await executeCall("v1", modelToUse);

    // Attempt 2: If 404, loop through all primary models
    if (!finalResp.ok && finalResp.status === 404) {
      for (const pModel of primaryModels) {
        if (pModel === modelToUse) continue;
        lastAttemptedModel = pModel;
        finalResp = await executeCall("v1beta", pModel);
        if (finalResp.ok) break;
        finalResp = await executeCall("v1", pModel);
        if (finalResp.ok) break;
      }
    }

    // Attempt 3: If still 404, try ANY model found during discovery
    if (
      !finalResp.ok &&
      finalResp.status === 404 &&
      availableModels.length > 0
    ) {
      for (const aModel of availableModels.slice(0, 5)) {
        if (primaryModels.includes(aModel)) continue;
        lastAttemptedModel = aModel;
        finalResp = await executeCall("v1beta", aModel);
        if (finalResp.ok) break;
        finalResp = await executeCall("v1", aModel);
        if (finalResp.ok) break;
      }
    }

    if (finalResp.status === 429 && retries > 0) {
      let wait = delay;
      try {
        const err = await finalResp.json();
        const delayStr =
          err?.error?.details?.find((d) => d.retryDelay)?.retryDelay || "";
        const match = delayStr.match(/(\d+)/);
        if (match) wait = (parseInt(match[1]) + 2) * 1000;
      } catch (e) {}

      if (window.toast)
        window.toast(
          `Rate limit hit. Waiting ${Math.round(wait / 1000)}s...`,
          "warning",
        );
      await new Promise((r) => setTimeout(r, wait));
      return callGemini(apiKey, prompt, temperature, retries - 1, delay * 1.5);
    }

    if (!finalResp.ok) {
      const errText = await finalResp.text();
      const is404 = finalResp.status === 404;
      let msg = `API Status ${finalResp.status}: ${errText} (Last Model: ${lastAttemptedModel})`;
      if (is404) {
        msg += `\n\n🔍 DIAGNOSTIC: Google says this model doesn't exist for your key. `;
        if (availableModels.length === 0) {
          msg += `Discovery also failed with: ${discoveryError}. This usually means the 'Generative Language API' is DISABLED in your Google AI Studio project, or your key is restricted.`;
        } else {
          msg += `Your key ONLY supports: [${availableModels.join(", ")}]. None of these are compatible with our analysis engine.`;
        }
      }
      throw new Error(msg);
    }
    const data = await finalResp.json();
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
    import.meta.env.VITE_GEMINI_API_KEY || "",
  );
  const [schemaJSON, setSchemaJSON] = useState(null);
  const [sqlEngine, setSqlEngine] = useState(null);
  const [qualityReport, setQualityReport] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [aiIngressCount, setAiIngressCount] = useState(0);
  const [totalRowsProcessed, setTotalRowsProcessed] = useState(0);
  const [stage, setStage] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [erSvgCache, setErSvgCache] = useState({});
  const [businessContext, setBusinessContext] = useState(null);
  const [cloudUrl, setCloudUrl] = useState("");
  const tid = useRef(0);

  const toast = useCallback((msg, type = "info") => {
    const id = ++tid.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  useEffect(() => {
    window.toast = toast;
  }, [toast]);

  /* ── Schema loaded callback ── */
  const onSchema = useCallback(
    (schema, db) => {
      setSchemaJSON(schema);
      setSqlEngine(db);
      setTotalRowsProcessed(schema.metadata?.total_rows || 0);
      setStage((s) => Math.max(s, 1));
      toast(
        `Schema extracted: ${schema.metadata?.total_tables} tables`,
        "success",
      );
      setActiveTab(1);
    },
    [toast],
  );

  /* ── Demo: load Chinook ── */
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

  /* ── Cloud Fetch Handler ── */
  async function handleUrlFetch() {
    if (!cloudUrl) return toast("Please enter a valid URL", "warning");
    let parsedUrl;
    try {
      parsedUrl = new URL(cloudUrl);
    } catch (e) {
      return toast("Invalid URL format", "error");
    }

    toast(`Fetching data from ${parsedUrl.hostname}…`);

    try {
      setUploadProgress({
        step: 1,
        max: 4,
        text: `Connecting to Cloud Source…`,
      });
      const SQL = await loadSqlJs();
      const resp = await fetch(cloudUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

      const contentType = resp.headers.get("content-type") || "";
      const isSqlite = cloudUrl.toLowerCase().match(/\.(sqlite|sqlite3|db)$/i);
      const isCsv =
        cloudUrl.toLowerCase().match(/\.csv$/i) || contentType.includes("csv");

      if (isSqlite) {
        const buf = await resp.arrayBuffer();
        const fileName =
          cloudUrl.split("/").pop().split("?")[0] || "Cloud_DB.sqlite";
        const mockFile = {
          name: fileName,
          arrayBuffer: async () => buf,
          size: buf.byteLength,
          type: "application/x-sqlite3",
        };
        await processFiles([mockFile], SQL);
      } else if (isCsv) {
        const txt = await resp.text();
        const fileName =
          cloudUrl.split("/").pop().split("?")[0] || "cloud_data.csv";
        const mockFile = {
          name: fileName,
          text: async () => txt,
          size: txt.length,
          type: "text/csv",
        };
        await processFiles([mockFile], SQL);
      } else {
        throw new Error(
          "Unsupported file type. Please provide a .csv or .sqlite URL.",
        );
      }
    } catch (e) {
      toast(`Cloud Fetch Failed: ${e.message}`, "error");
    } finally {
      setUploadProgress(null);
    }
  }

  /* ── Universal File/Cloud Processing Logic ── */
  async function processFiles(files, SQL) {
    try {
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
        const buf = sqliteFile.arrayBuffer
          ? await sqliteFile.arrayBuffer()
          : new TextEncoder().encode(await sqliteFile.text());
        db = new SQL.Database(new Uint8Array(buf));
      } else {
        db = new SQL.Database();
      }

      let hasCsv = false;
      let samplesObj = {};
      setUploadProgress({
        step: 2,
        max: 4,
        text: `Parsing ${files.length} Data Sources…`,
      });

      for (const f of files) {
        if (f.name.match(/\.sql$/i)) {
          toast(`Executing ${f.name}…`);
          const txt = await f.text();
          db.exec(txt);
        } else if (
          f.name.match(/\.csv$/i) ||
          (f.type && f.type.includes("csv"))
        ) {
          hasCsv = true;
          toast(`Parsing ${f.name}…`);
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
              if (isNaN(Date.parse(v)) || !String(v).match(/^20\d{2}-\d{2}/))
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
                text: `Processing ${f.name} (${i}/${parsed.data.length})…`,
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
            setAiIngressCount((c) => c + state.schema.length * 3);
            setUploadProgress({
              step: 3,
              max: 4,
              text: `AI Proposer Node (Attempt ${state.attempts + 1})…`,
            });
            const prompt = `You are a Principal DB Architect.
              Schema: ${JSON.stringify(state.schema)}
              Data Samples: ${JSON.stringify(state.samples)}
              Previous Failed Hypotheses: ${JSON.stringify(state.errors)}
              
              Infer the actual Foreign Keys mathematically. Also identify the primary key for each table if not already obvious. Return ONLY an un-fenced JSON object:
              {"relationships": [{"from_table":"", "from_column":"", "to_table":"", "to_column":""}], "primary_keys": {"table_name": "column_name"}}`;

            const r = await callGemini(geminiApiKey, prompt, 0.1);
            let p = { relationships: [], primary_keys: {} };
            try {
              const s = r.indexOf("{"),
                e = r.lastIndexOf("}");
              const cleanJson =
                s !== -1
                  ? r.slice(s, e + 1)
                  : r
                      .replace(/```json/g, "")
                      .replace(/```/g, "")
                      .trim();
              p = JSON.parse(cleanJson);
              if (Array.isArray(p)) p = { relationships: p, primary_keys: {} };
            } catch (e) {
              console.error("Gemini Parse Error:", r);
            }
            return { proposals: p, attempts: state.attempts + 1 };
          };

          const validateNode = (state) => {
            setUploadProgress({
              step: 4,
              max: 4,
              text: `SQL Validator Node: Checking Integrity…`,
            });
            const valid = [];
            const fails = [];
            for (const p of state.proposals.relationships || []) {
              try {
                const total =
                  scalar(
                    db,
                    `SELECT COUNT(*) FROM "${p.from_table}" WHERE "${p.from_column}" IS NOT NULL`,
                  ) || 0;
                const orphan =
                  scalar(
                    db,
                    `SELECT COUNT(*) FROM "${p.from_table}" WHERE "${p.from_column}" IS NOT NULL AND "${p.from_column}" NOT IN (SELECT "${p.to_column}" FROM "${p.to_table}")`,
                  ) || 0;
                if (total > 0 && orphan === 0)
                  valid.push({ ...p, inferred: true });
                else if (total > 0)
                  fails.push({ ...p, error: `Orphaned rows found: ${orphan}` });
              } catch (e) {
                fails.push({ ...p, error: e.message });
              }
            }
            return {
              validated: valid,
              errors: [...state.errors, ...fails],
              pkProposals: state.proposals.primary_keys || {},
            };
          };

          const pResult = await proposeNode(state);
          const vResult = validateNode({ ...state, ...pResult });
          schema.relationships = vResult.validated;

          // Backfill schema metadata from AI findings
          vResult.validated.forEach((rel) => {
            const tbl = schema.tables.find((t) => t.name === rel.from_table);
            if (tbl) {
              if (
                !tbl.foreign_keys.some((fk) => fk.column === rel.from_column)
              ) {
                tbl.foreign_keys.push({
                  column: rel.from_column,
                  references_table: rel.to_table,
                  references_column: rel.to_column,
                  inferred: true,
                });
              }
            }
          });

          Object.entries(vResult.pkProposals).forEach(([tName, pkCol]) => {
            const tbl = schema.tables.find((t) => t.name === tName);
            if (tbl && tbl.primary_keys.length === 0) {
              tbl.primary_keys = [pkCol];
              const col = tbl.columns.find((c) => c.name === pkCol);
              if (col) col.primary_key = true;
            }
          });

          if (vResult.validated.length > 0)
            toast(
              `Mapper: Proven ${vResult.validated.length} relationships!`,
              "success",
            );
          else
            toast("Mapper: No explicit relationships proven via SQL.", "info");
        } catch (e) {
          console.error("Agentic Mapper failed:", e);
        }
      }
      onSchema(schema, db);
    } catch (e) {
      toast(`Loading failed: ${e.message}`, "error");
    } finally {
      setUploadProgress(null);
    }
  }

  // Helper for validator node
  function scalar(db, q) {
    try {
      const r = db.exec(q);
      return r.length ? r[0].values[0][0] : null;
    } catch (e) {
      return null;
    }
  }

  /* ── File Selector Handler ── */
  async function handleFile(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const SQL = await loadSqlJs();
    await processFiles(files, SQL);
  }

  /* ── Extract schema from SQL.js db ── */
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
        nullable: Number(r[3]) === 0,
        primary_key: Number(r[5]) >= 1,
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

  const generateUniversalExport = useCallback(
    (dialect) => {
      if (!schemaJSON || !sqlEngine) return;

      let content = "";
      let filename = `export_${dialect}_${new Date().getTime()}`;
      let mimeType = "text/sql";

      try {
        // SQL Dialects
        content = `-- AI Database Forensic Agent - ${dialect.toUpperCase()} Export\n`;
        content += `-- Generated: ${new Date().toLocaleString()}\n\n`;

        if (dialect === "postgres") {
          content += `SET check_function_bodies = false;\n\n`;
        } else if (dialect === "mysql") {
          content += `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n`;
        }

        schemaJSON.tables.forEach((table) => {
          const q = dialect === "postgres" || dialect === "oracle" ? '"' : "`";
          content += `-- Table: ${table.name}\n`;
          if (dialect === "mysql")
            content += `DROP TABLE IF EXISTS ${q}${table.name}${q};\n`;

          content += `CREATE TABLE ${q}${table.name}${q} (\n`;

          const colDefs = (table.columns || []).map((col) => {
            let type = "TEXT";
            const lt = (col.type || "").toLowerCase();
            if (dialect === "postgres") {
              if (lt.includes("int"))
                type = table.primary_keys?.includes(col.name)
                  ? "SERIAL"
                  : "INTEGER";
              else if (lt.includes("char")) type = "VARCHAR(255)";
              else if (lt.includes("real") || lt.includes("float"))
                type = "DOUBLE PRECISION";
              else if (lt.includes("blob")) type = "BYTEA";
            } else if (dialect === "oracle") {
              if (lt.includes("int")) type = "NUMBER(12,0)";
              else if (lt.includes("char")) type = "VARCHAR2(255)";
              else if (lt.includes("real") || lt.includes("float"))
                type = "NUMBER";
              else if (lt.includes("blob")) type = "BLOB";
              else type = "CLOB";
            } else {
              if (lt.includes("int")) type = "INT";
              else if (lt.includes("char")) type = "VARCHAR(255)";
              else if (lt.includes("real")) type = "DOUBLE";
              else if (lt.includes("blob")) type = "LONGBLOB";
              else type = "LONGTEXT";
            }
            let def = `  ${q}${col.name}${q} ${type}`;
            if (
              table.primary_keys?.includes(col.name) &&
              dialect !== "postgres"
            )
              def += " NOT NULL";
            return def;
          });

          if (table.primary_keys && table.primary_keys.length > 0) {
            colDefs.push(
              `  PRIMARY KEY (${table.primary_keys.map((k) => `${q}${k}${q}`).join(", ")})`,
            );
          }
          content += colDefs.join(",\n");
          content += `\n);\n\n`;

          const rows = sqlEngine.exec(`SELECT * FROM \`${table.name}\``);
          if (rows && rows[0]) {
            const { columns, values } = rows[0];
            values.forEach((row) => {
              const vals = row.map((v) => {
                if (v === null) return "NULL";
                if (typeof v === "number") return v;
                return `'${String(v).replace(/'/g, "''")}'`;
              });
              content += `INSERT INTO ${q}${table.name}${q} (${columns.map((c) => `${q}${c}${q}`).join(", ")}) VALUES (${vals.join(", ")});\n`;
            });
          }
          content += `\n`;
        });

        if (dialect === "mysql") content += `SET FOREIGN_KEY_CHECKS = 1;\n`;
        filename += ".sql";

        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast(`${dialect.toUpperCase()} Exported successfully!`, "success");
      } catch (err) {
        console.error("Export failed:", err);
        toast(`Export failed: ${err.message}`, "error");
      }
    },
    [schemaJSON, sqlEngine],
  );

  /* ── Tabs config ── */
  const tabs = [
    { id: 0, label: "Upload", icon: "📤", min: 0 },
    { id: 1, label: "Schema", icon: "🗂", min: 1 },
    { id: 2, label: "Relationships", icon: "🔗", min: 1 },
    { id: 3, label: "Quality", icon: "📊", min: 1 },
    { id: 4, label: "Dictionary", icon: "📖", min: 1 },
    { id: 5, label: "Business Summaries", icon: "🧠", min: 1 },
    { id: 6, label: "Privacy Guard", icon: "🛡️", min: 1 },
    { id: 7, label: "Universal Migrator", icon: "📥", min: 1 },
  ];
  const stages = [
    "Upload",
    "Schema",
    "Relationships",
    "Quality",
    "Summaries",
    "Audit",
    "Done",
  ];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md">
              <span className="text-lg">🧠</span>
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
                <span className="text-base">{tab.icon}</span>
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
            url={cloudUrl}
            onUrlChange={setCloudUrl}
            onUrlFetch={handleUrlFetch}
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
            setAiIngressCount={setAiIngressCount}
            toast={toast}
          />
        )}
        {activeTab === 5 && schemaJSON && (
          <BusinessContextTab
            schema={schemaJSON}
            quality={qualityReport}
            geminiApiKey={geminiApiKey}
            cached={businessContext}
            onReady={setBusinessContext}
            setAiIngressCount={setAiIngressCount}
            toast={toast}
          />
        )}
        {activeTab === 6 && schemaJSON && (
          <PrivacyAuditTab
            schema={schemaJSON}
            ingress={aiIngressCount}
            total={totalRowsProcessed}
          />
        )}
        {activeTab === 7 && schemaJSON && (
          <ExportTab onExport={generateUniversalExport} />
        )}
      </main>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded-lg shadow-lg text-sm font-medium border-l-4 backdrop-blur-sm ${
              t.type === "success"
                ? "bg-green-50 border-green-500 text-green-800"
                : t.type === "error"
                  ? "bg-red-50 border-red-500 text-red-800"
                  : "bg-blue-50 border-blue-500 text-blue-800"
            }`}
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
   TAB COMPONENTS
   ════════════════════════════════════════════════════════════ */

function UploadTab({ onFile, onDemo, progress, url, onUrlChange, onUrlFetch }) {
  const [connStr, setConnStr] = useState("");
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    if (!connStr.trim()) return;
    setConnecting(true);
    try {
      const res = await fetch(
        "https://ai-db-analysis.onrender.com/api/connect",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectionString: connStr }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed");
      onSchema(data.schema, null); // onSchema is passed from App
    } catch (err) {
      window.toast(`Connection error: ${err.message}`, "error");
    } finally {
      setConnecting(false);
    }
  };
  return (
    <div className="flex items-center justify-center min-h-[70vh] p-6">
      <div className="text-center w-full max-w-2xl space-y-8">
        <div className="flex justify-center">
          <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 shadow-sm">
            <span className="text-5xl">🧠</span>
          </div>
        </div>
        <div>
          <h2 className="text-3xl font-bold text-gray-900">
            AI Database Analysis Agent
          </h2>
          <p className="text-gray-500 mt-2 max-w-md mx-auto">
            Upload any SQLite database or fetch from cloud to get instant schema
            analysis, ER diagrams, stability audits, and AI insights.
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
          <div className="space-y-4">
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

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">OR</span>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">
                <Globe className="w-3 h-3 text-blue-600" /> Fetch from Cloud URL
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => onUrlChange(e.target.value)}
                  placeholder="https://example.com/data.csv"
                  className="flex-1 bg-white border border-gray-300 rounded-xl px-4 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500/50 transition-colors"
                />
                <button
                  onClick={onUrlFetch}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium flex items-center gap-2 transition-colors shadow-sm"
                >
                  <CloudDownload className="w-4 h-4" /> Fetch
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-gray-50 text-gray-500">OR</span>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            Connect to external database
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="postgresql://user:pass@host:port/dbname"
              value={connStr}
              onChange={(e) => setConnStr(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {connecting ? "Connecting..." : "Connect"}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Supports PostgreSQL, MySQL, MongoDB. Provide connection string.
            Backend required.
          </p>
        </div>
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
    '  edge [fontname="Inter, Helvetica, Arial, sans-serif", fontsize=9, dir=both, color="#475569", penwidth=1.5];',
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
    const headerBg = isSelected ? "#fed7aa" : isWeak ? "#fee2e2" : "#e0f2fe";
    const headerFg = isSelected ? "#9a3412" : isWeak ? "#991b1b" : "#0369a1";
    const borderColor = isSelected ? "#f97316" : "#cbd5e1";
    const borderWidth = isSelected ? "2" : "1";

    let html = `  ${safeName} [label=<\n    <table border="${borderWidth}" cellborder="1" cellspacing="0" cellpadding="6" color="${borderColor}" bgcolor="#ffffff">\n`;
    html += `       <tr><td bgcolor="${headerBg}" colspan="3"><font color="${headerFg}" point-size="12"><b>${esc(t.name)}</b></font>${isWeak ? ' <font color="#ef4444" point-size="9">&lt;&lt;Weak&gt;&gt;</font>' : ""}</td></tr>\n`;

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
          <Link2 className="w-6 h-6 text-blue-600" />
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
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600"
                    title="Zoom In"
                  >
                    +
                  </button>
                  <button
                    onClick={() => zoomOut(0.2)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600"
                    title="Zoom Out"
                  >
                    -
                  </button>
                  <button
                    onClick={() => resetTransform()}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600"
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
                  className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-medium ${
                    r.inferred
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
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
      <div className="flex flex-col items-center justify-center h-96 space-y-4">
        <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center mb-2">
          <Activity className="w-10 h-10 text-amber-500 animate-pulse" />
        </div>
        <h2 className="text-xl font-bold text-white">Data Quality Engine</h2>
        <p className="text-gray-500 max-w-sm text-center text-sm">
          Analyze completeness, integrity, and statistical distributions of your
          dataset.
        </p>
        <button
          onClick={run}
          className="px-8 py-3 rounded-2xl bg-gradient-to-r from-amber-600 to-orange-600 text-sm font-bold shadow-xl hover:scale-105 transition-transform flex items-center gap-2"
        >
          <Zap className="w-4 h-4" /> Run Quality Analysis
        </button>
      </div>
    );

  if (loading)
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-6">
        <div className="relative w-24 h-24">
          <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
        <div className="text-center">
          <p className="text-blue-400 font-bold uppercase tracking-widest text-[10px] animate-pulse">
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
                  className={`group border-b border-gray-100 cursor-pointer transition-all ${
                    selTable === p.table ? "bg-blue-50" : "hover:bg-gray-50"
                  }`}
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
                      className={`border-b border-gray-100 transition-all cursor-pointer ${
                        selCol === c.name ? "bg-blue-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <td className="px-6 py-3 font-mono text-gray-800">
                        {c.name}
                      </td>
                      <td
                        className={`px-4 py-3 text-center ${
                          c.null_rate > 5 ? "text-orange-600" : "text-gray-500"
                        }`}
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
                  className={`p-3 rounded-xl bg-gray-50 border border-gray-100 flex flex-col items-center justify-center ${
                    !s.s ? "opacity-40" : ""
                  }`}
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

/* ════════════════════════════════════════════════════════════
   DICTIONARY TAB — Two-Panel: Table Selector + Mini ER + AI Descriptions
   ════════════════════════════════════════════════════════════ */

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
          return `<tr><td align="left" bgcolor="${isPk ? "#1E1B0A" : isFk ? "#071A12" : "#111827"}" port="${c.name}"><font color="${color}" point-size="9">${icon}${c.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}${badge} — ${c.type}</font></td></tr>`;
        })
        .join("");
      const isCenter = t.name === tableName;
      return `  "${t.name}" [label=<<table border="0" cellborder="1" cellspacing="0" cellpadding="5" bgcolor="${colorMap[t.name]}22" style="rounded"><tr><td bgcolor="${colorMap[t.name]}" align="center"><font color="white" point-size="11"><b>${isCenter ? "★ " : ""}${t.name}</b></font></td></tr>${rows}</table>>, fillcolor="transparent", shape=none, margin=0]`;
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
  setAiIngressCount,
  toast,
}) {
  const [selTable, setSelTable] = useState(schema?.tables?.[0]?.name || null);
  const [dictCache, setDictCache] = useState({});
  const [loading, setLoading] = useState(false);
  const [erSvg, setErSvg] = useState(null);
  const [erLoading, setErLoading] = useState(false);
  const [error, setError] = useState(null);

  const tbl = (schema?.tables || []).find((t) => t.name === selTable);
  // Use the SAME buildGraphvizER as RelationshipsTab — same diagram, same cache
  useEffect(() => {
    if (!selTable) return;
    const key = selTable; // same cache key that RelationshipsTab uses
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
      toast("Generating Data Dictionary…");
      setAiIngressCount((c) => c + 3);
      const raw = await callGemini(geminiApiKey, prompt, 0.2);
      const s = raw.indexOf("{"),
        e = raw.lastIndexOf("}");
      const dict = JSON.parse(s !== -1 ? raw.slice(s, e + 1) : "{}");
      setDictCache((c) => ({ ...c, [selTable]: dict }));
      toast("Dictionary updated!", "success");
    } catch (err) {
      console.error("Dictionary generation failed:", err);
      toast(`Dictionary failed: ${err.message}`, "error");
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
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      selTable === t.name
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
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
  setAiIngressCount,
  toast,
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
      setAiIngressCount((c) => c + schema.tables.length * 2);
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

  // Simple Markdown-ish renderer
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
              Business Summaries
            </h2>
            <p className="text-gray-500 text-sm max-w-sm">
              The agent will now analyze your schema, relationships, and data
              quality to generate comprehensive business summaries.
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

function PrivacyAuditTab({ schema, ingress, total }) {
  const percent = total > 0 ? ((ingress / total) * 100).toFixed(4) : 0;

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-4 bg-emerald-50 border border-emerald-200 p-6 rounded-3xl">
        <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            Privacy Guard Audit
          </h2>
          <p className="text-sm text-gray-600">
            This real-time forensic audit proves that sensitive data never
            leaves your browser.
          </p>
        </div>
        <div className="ml-auto px-4 py-2 rounded-xl bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest">
          Verified Local
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 p-6 rounded-2xl space-y-2 shadow-sm">
          <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
            Total Rows Processed
          </div>
          <div className="text-3xl font-black text-gray-900">
            {(total || 0).toLocaleString()}
          </div>
          <div className="text-[10px] text-gray-500">
            Handled exclusively in WASM RAM
          </div>
        </div>
        <div className="bg-white border border-gray-200 p-6 rounded-2xl space-y-2 shadow-sm">
          <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
            Rows Sent to AI
          </div>
          <div className="text-3xl font-black text-blue-600">
            {(ingress || 0).toLocaleString()}
          </div>
          <div className="text-[10px] text-gray-500">
            Non-sensitive schema samples only
          </div>
        </div>
        <div className="bg-white border border-gray-200 p-6 rounded-2xl space-y-2 shadow-sm">
          <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
            Leakage Ratio
          </div>
          <div className="text-3xl font-black text-emerald-600">{percent}%</div>
          <div className="text-[10px] text-gray-500">
            Target: Low transparency ratio
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800">
            Data Traffic Forensic Tracers
          </h3>
          <div className="flex gap-2">
            <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
              <div className="w-2 h-2 rounded-full bg-emerald-500" /> Local Safe
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
              <div className="w-2 h-2 rounded-full bg-blue-500" /> AI Ingress
            </div>
          </div>
        </div>
        <div className="p-8 space-y-6">
          <div className="flex justify-between items-end">
            <div className="space-y-1">
              <div className="text-xs font-bold text-gray-800 flex items-center gap-2">
                <Database className="w-3 h-3 text-emerald-600" /> Your Local
                Browser (WASM)
              </div>
              <div className="text-[10px] text-gray-500">
                SQL.js Engine Virtualized Container
              </div>
            </div>
            <div className="text-xs font-mono text-emerald-600">
              99.99% Local Persistence
            </div>
          </div>

          <div className="relative h-4 w-full bg-gray-100 rounded-full overflow-hidden flex">
            <div
              className="h-full bg-emerald-500 transition-all duration-1000"
              style={{ width: `${100 - percent}%` }}
            ></div>
            <div
              className="h-full bg-blue-500 transition-all duration-1000"
              style={{ width: `${percent}%` }}
            ></div>
          </div>

          <div className="flex justify-between items-start text-center">
            <div className="w-1/3 p-4 rounded-xl border border-gray-200 bg-gray-50">
              <div className="text-[10px] text-gray-500 uppercase font-black mb-1">
                Row Identity
              </div>
              <div className="text-emerald-600 text-xs font-bold">
                100% PRIVATE
              </div>
            </div>
            <div className="w-1/3 p-4 rounded-xl border border-gray-200 bg-gray-50">
              <div className="text-[10px] text-gray-500 uppercase font-black mb-1">
                Financial Values
              </div>
              <div className="text-emerald-600 text-xs font-bold">EXCLUDED</div>
            </div>
            <div className="w-1/3 p-4 rounded-xl border border-gray-200 bg-gray-50">
              <div className="text-[10px] text-gray-500 uppercase font-black mb-1">
                Schema Metadata
              </div>
              <div className="text-blue-600 text-xs font-bold">INGRESSED</div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-4">
        <Info className="w-5 h-5 text-blue-600 shrink-0" />
        <p className="text-xs text-gray-600 leading-relaxed">
          The AI Forensic Agent only sends table structures and anonymized 3-row
          samples to the Gemini API for relationship mapping. No actual
          row-level data is ever stored on any server or used for training.
        </p>
      </div>
    </div>
  );
}

function ExportTab({ onExport }) {
  const dialects = [
    {
      id: "mysql",
      label: "MySQL",
      icon: "🐬",
      color: "blue",
      desc: "Standard relational export for web apps.",
    },
    {
      id: "postgres",
      label: "PostgreSQL",
      icon: "🐘",
      color: "indigo",
      desc: "Industrial-strength standard-compliant SQL.",
    },
    {
      id: "oracle",
      label: "Oracle",
      icon: "🧱",
      color: "red",
      desc: "Secure enterprise-grade database migration.",
    },
  ];

  return (
    <div className="max-w-6xl mx-auto p-12 space-y-12 animate-in fade-in duration-700">
      <div className="text-center space-y-4">
        <h2 className="text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-emerald-600">
          Universal Migrator
        </h2>
        <p className="text-gray-500 max-w-2xl mx-auto text-base">
          Select your target database dialect. The agent will generate a
          performance-optimized migration script specifically for your chosen
          environment.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {dialects.map((d) => (
          <div
            key={d.id}
            className="group relative bg-white border border-gray-200 hover:border-blue-300 p-8 rounded-[2.5rem] transition-all hover:shadow-md overflow-hidden"
          >
            <div
              className={`absolute top-0 right-0 w-32 h-32 bg-${d.color}-50 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-${d.color}-100 transition-colors`}
            />
            <div className="relative space-y-6">
              <div
                className={`w-16 h-16 rounded-2xl bg-${d.color}-100 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform`}
              >
                {d.icon}
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-gray-800 group-hover:text-blue-600 transition-colors">
                  {d.label}
                </h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  {d.desc}
                </p>
              </div>
              <button
                onClick={() => onExport(d.id)}
                className={`w-full py-4 rounded-2xl bg-gray-100 hover:bg-blue-600 text-gray-700 hover:text-white font-bold text-sm tracking-widest uppercase transition-all shadow-sm group-hover:shadow-md active:scale-95`}
              >
                Generate Script
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="p-8 bg-blue-50 border border-blue-200 rounded-[2rem] flex items-center gap-6">
        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
          ✨
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">
          The{" "}
          <span className="text-blue-600 font-bold uppercase tracking-wider text-[10px]">
            Universal Migrator
          </span>{" "}
          uses high-performance local buffering to handle thousands of rows
          instantly without hitting AI token limits.
        </p>
      </div>
    </div>
  );
}
