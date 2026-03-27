import React, { useState, useCallback } from 'react';

/**
 * Module 5 — AIGenerator
 * =======================
 * Orchestrates OpenRouter API calls to generate business summaries,
 * data dictionary, quality narrative, and recommendations.
 * Shows step-by-step progress with live output streaming.
 *
 * @param {{ schemaJSON: object, qualityReport: object, apiKey: string }} props
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const FREE_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
  'deepseek/deepseek-r1:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
];

export default function AIGenerator({ schemaJSON, qualityReport, apiKey }) {
  const [step, setStep] = useState(0);       // 0=idle, 1-5=running, 6=done
  const [progress, setProgress] = useState({});
  const [results, setResults] = useState({});
  const [errors, setErrors] = useState({});
  const [running, setRunning] = useState(false);
  const [selectedModel, setSelectedModel] = useState(FREE_MODELS[0]);
  const [localApiKey, setLocalApiKey] = useState(apiKey || '');
  const [subProgress, setSubProgress] = useState('');

  const tables = schemaJSON?.tables || [];
  const relationships = schemaJSON?.relationships || [];

  // ── OpenRouter caller ──────────────────────────────────

  async function callAI(prompt, { expectJson = false, maxTokens = 2000 } = {}) {
    const key = localApiKey || apiKey;
    if (!key) throw new Error('API key required');

    const models = [selectedModel, ...FREE_MODELS.filter(m => m !== selectedModel)];
    let lastError = null;

    for (const model of models) {
      try {
        const resp = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.origin,
            'X-Title': 'AI Database Analysis Agent',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: maxTokens,
          }),
        });

        if (resp.ok) {
          const data = await resp.json();
          let content = data.choices?.[0]?.message?.content || '';
          if (expectJson) content = extractJson(content);
          return content;
        }
        lastError = `${model}: HTTP ${resp.status}`;
      } catch (e) {
        lastError = `${model}: ${e.message}`;
      }
    }
    throw new Error(lastError || 'All models failed');
  }

  function extractJson(text) {
    text = text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) return text.slice(start, end + 1);
    return text;
  }

  function parseJsonSafe(text) {
    try { return JSON.parse(text); }
    catch { return { raw_response: text }; }
  }

  // ── Build prompt helpers ───────────────────────────────

  function buildSchemaSummary(includeSamples = false) {
    const meta = schemaJSON?.metadata || {};
    let text = `Database: ${meta.database_name || 'unknown'}\nTables: ${meta.total_tables}, Columns: ${meta.total_columns}, Rows: ${(meta.total_rows || 0).toLocaleString()}\n\n`;
    for (const tbl of tables) {
      const pk = (tbl.primary_keys || []).join(', ') || 'none';
      const fks = (tbl.foreign_keys || []).map(f => `${f.column}→${f.references_table}.${f.references_column}`).join(', ') || 'none';
      const cols = (tbl.columns || []).map(c => `${c.name}(${c.type || 'TEXT'})`).join(', ');
      text += `Table: ${tbl.name} (${(tbl.row_count || 0).toLocaleString()} rows)\n  PK: ${pk}\n  FKs: ${fks}\n  Columns: ${cols}\n`;
      if (includeSamples && tbl.sample_data) {
        text += `  Sample: ${JSON.stringify(tbl.sample_data.slice(0, 3)).slice(0, 500)}\n`;
      }
      text += '\n';
    }
    return text;
  }

  function buildQualitySummary() {
    if (!qualityReport) return 'No quality report available.\n';
    let text = `Overall Health: ${qualityReport.overall_health}/100\nFK Integrity: ${qualityReport.avg_fk_integrity}%\nIssues: ${(qualityReport.issues || []).length}\n\n`;
    for (const tp of (qualityReport.table_profiles || [])) {
      text += `  ${tp.table}: score=${tp.score}, completeness=${tp.avg_completeness}%\n`;
    }
    const issues = (qualityReport.issues || []).slice(0, 10);
    if (issues.length) {
      text += '\nTop Issues:\n';
      issues.forEach(iss => { text += `  [${iss.severity}] ${iss.table}.${iss.column || '*'}: ${iss.issue}\n`; });
    }
    return text;
  }

  // ── Pipeline steps ─────────────────────────────────────

  async function runStep1_Domain() {
    const prompt = `You are a senior data analyst. Analyze this database schema and sample data.\n\n${buildSchemaSummary(true)}\n\nReturn JSON only:\n{"domain":"detected business domain","executive_summary":"5-6 sentence summary","db_purpose":"one sentence","key_entities":["list"],"data_flow":"one sentence"}`;
    const result = await callAI(prompt, { expectJson: true });
    return parseJsonSafe(result);
  }

  async function runStep2_Summaries(domain) {
    const summaries = {};
    for (let i = 0; i < tables.length; i++) {
      const tbl = tables[i];
      setSubProgress(`Generating summary ${i + 1}/${tables.length}: ${tbl.name}`);
      const related = new Set();
      relationships.forEach(r => {
        if (r.from_table === tbl.name) related.add(r.to_table);
        if (r.to_table === tbl.name) related.add(r.from_table);
      });
      const cols = (tbl.columns || []).map(c => c.name).join(', ');
      const sample = JSON.stringify((tbl.sample_data || []).slice(0, 3)).slice(0, 400);
      const prompt = `Write a 3-4 sentence business description of this database table for a non-technical audience.\n\nTable: ${tbl.name} (${(tbl.row_count || 0).toLocaleString()} rows)\nColumns: ${cols}\nSample data: ${sample}\nConnected to: ${[...related].join(', ') || 'none'}\nBusiness domain: ${domain}\n\nPlain English only. No technical jargon. No bullet points. Paragraph form only.`;
      summaries[tbl.name] = await callAI(prompt, { maxTokens: 500 });
      await sleep(500);
    }
    return summaries;
  }

  async function runStep3_Dictionary() {
    const dictionaries = {};
    for (let i = 0; i < tables.length; i++) {
      const tbl = tables[i];
      setSubProgress(`Generating dictionary ${i + 1}/${tables.length}: ${tbl.name}`);
      const colSamples = {};
      for (const col of (tbl.columns || [])) {
        const samples = (tbl.sample_data || []).slice(0, 3).map(r => r[col.name]).filter(v => v != null).map(v => String(v).slice(0, 50));
        colSamples[col.name] = { type: col.type || 'TEXT', nullable: col.nullable, primary_key: col.primary_key, samples };
      }
      const prompt = `Generate a data dictionary for this database table.\nReturn JSON only.\n\nTable: ${tbl.name}\nColumns with samples: ${JSON.stringify(colSamples)}\n\n{"table":"${tbl.name}","columns":[{"name":"col","description":"plain English","format":"expected format","business_rule":"rule or null","sensitive":false,"suggested_name":"better name or null"}]}`;
      const result = await callAI(prompt, { expectJson: true, maxTokens: 2500 });
      dictionaries[tbl.name] = parseJsonSafe(result);
      await sleep(500);
    }
    return dictionaries;
  }

  async function runStep4_Narrative() {
    const prompt = `Write a 200-word data quality assessment.\n\n${buildQualitySummary()}\n\nCover: score meaning, top 3 issues with table.column locations, cleanest vs worst tables, 3 actionable fixes, one-sentence readiness verdict. Write as a senior data quality analyst.`;
    return await callAI(prompt, { maxTokens: 1000 });
  }

  async function runStep5_Recommendations(domain) {
    const prompt = `Generate final recommendations for this ${domain} database.\n\nSchema:\n${buildSchemaSummary()}\n\nQuality:\n${buildQualitySummary()}\n\nReturn JSON only:\n{"critical_fixes":[{"issue":"desc","table":"name","fix":"action"}],"schema_improvements":["suggestion"],"missing_fks":[{"from_table":"..","from_column":"..","to_table":"..","confidence":"high/medium/low"}],"analytical_queries":[{"question":"business question","sql":"SELECT query"}],"readiness":{"analytics":"verdict","ml_training":"verdict","reporting":"verdict"}}`;
    const result = await callAI(prompt, { expectJson: true, maxTokens: 3000 });
    return parseJsonSafe(result);
  }

  // ── Main run ───────────────────────────────────────────

  const runPipeline = useCallback(async () => {
    setRunning(true);
    setErrors({});
    const r = {};

    try {
      // Step 1: Domain
      setStep(1); setProgress(p => ({ ...p, 1: 'running' }));
      setSubProgress('Detecting business domain…');
      r.domain = await runStep1_Domain();
      setResults(prev => ({ ...prev, domain: r.domain }));
      setProgress(p => ({ ...p, 1: 'done' }));
    } catch (e) {
      setErrors(prev => ({ ...prev, 1: e.message }));
      setProgress(p => ({ ...p, 1: 'error' }));
    }

    try {
      // Step 2: Summaries
      setStep(2); setProgress(p => ({ ...p, 2: 'running' }));
      const domain = r.domain?.domain || 'general';
      r.summaries = await runStep2_Summaries(domain);
      setResults(prev => ({ ...prev, summaries: r.summaries }));
      setProgress(p => ({ ...p, 2: 'done' }));
    } catch (e) {
      setErrors(prev => ({ ...prev, 2: e.message }));
      setProgress(p => ({ ...p, 2: 'error' }));
    }

    try {
      // Step 3: Dictionary
      setStep(3); setProgress(p => ({ ...p, 3: 'running' }));
      r.dictionary = await runStep3_Dictionary();
      setResults(prev => ({ ...prev, dictionary: r.dictionary }));
      setProgress(p => ({ ...p, 3: 'done' }));
    } catch (e) {
      setErrors(prev => ({ ...prev, 3: e.message }));
      setProgress(p => ({ ...p, 3: 'error' }));
    }

    try {
      // Step 4: Quality narrative
      setStep(4); setProgress(p => ({ ...p, 4: 'running' }));
      setSubProgress('Generating quality narrative…');
      r.narrative = await runStep4_Narrative();
      setResults(prev => ({ ...prev, narrative: r.narrative }));
      setProgress(p => ({ ...p, 4: 'done' }));
    } catch (e) {
      setErrors(prev => ({ ...prev, 4: e.message }));
      setProgress(p => ({ ...p, 4: 'error' }));
    }

    try {
      // Step 5: Recommendations
      setStep(5); setProgress(p => ({ ...p, 5: 'running' }));
      setSubProgress('Generating recommendations…');
      const domain = r.domain?.domain || 'general';
      r.recommendations = await runStep5_Recommendations(domain);
      setResults(prev => ({ ...prev, recommendations: r.recommendations }));
      setProgress(p => ({ ...p, 5: 'done' }));
    } catch (e) {
      setErrors(prev => ({ ...prev, 5: e.message }));
      setProgress(p => ({ ...p, 5: 'error' }));
    }

    setStep(6);
    setSubProgress('');
    setRunning(false);
  }, [localApiKey, selectedModel, tables, relationships, qualityReport]);

  // ── Regenerate a single step ───────────────────────────

  async function regenerateStep(stepNum) {
    setProgress(p => ({ ...p, [stepNum]: 'running' }));
    setErrors(prev => { const e = { ...prev }; delete e[stepNum]; return e; });
    try {
      const domain = results.domain?.domain || 'general';
      let result;
      switch (stepNum) {
        case 1: result = await runStep1_Domain(); setResults(p => ({ ...p, domain: result })); break;
        case 2: result = await runStep2_Summaries(domain); setResults(p => ({ ...p, summaries: result })); break;
        case 3: result = await runStep3_Dictionary(); setResults(p => ({ ...p, dictionary: result })); break;
        case 4: result = await runStep4_Narrative(); setResults(p => ({ ...p, narrative: result })); break;
        case 5: result = await runStep5_Recommendations(domain); setResults(p => ({ ...p, recommendations: result })); break;
      }
      setProgress(p => ({ ...p, [stepNum]: 'done' }));
    } catch (e) {
      setErrors(prev => ({ ...prev, [stepNum]: e.message }));
      setProgress(p => ({ ...p, [stepNum]: 'error' }));
    }
  }

  // ── Export helpers ─────────────────────────────────────

  function exportJSON() {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'ai_report.json');
  }

  function exportMarkdown() {
    const md = buildMarkdownReport();
    const blob = new Blob([md], { type: 'text/markdown' });
    downloadBlob(blob, 'ai_report.md');
  }

  function copyToClipboard() {
    const md = buildMarkdownReport();
    navigator.clipboard.writeText(md);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function buildMarkdownReport() {
    const meta = schemaJSON?.metadata || {};
    let md = `# AI Database Analysis Report — ${meta.database_name || 'Unknown'}\n\n`;
    const di = results.domain || {};
    md += `## Executive Summary\n\n${di.executive_summary || 'N/A'}\n\n`;
    md += `**Domain**: ${di.domain || '?'} | **Purpose**: ${di.db_purpose || '?'}\n\n---\n\n`;
    if (results.summaries) {
      md += `## Business Summaries\n\n`;
      Object.entries(results.summaries).forEach(([t, s]) => { md += `### ${t}\n\n${s}\n\n`; });
      md += '---\n\n';
    }
    if (results.dictionary) {
      md += `## Data Dictionary\n\n`;
      Object.entries(results.dictionary).forEach(([t, dd]) => {
        const cols = dd?.columns || [];
        if (!cols.length) return;
        md += `### ${t}\n\n| Column | Description | Format | Sensitive |\n|--------|-------------|--------|---|\n`;
        cols.forEach(c => { md += `| ${c.name} | ${c.description || '—'} | ${c.format || '—'} | ${c.sensitive ? 'Yes' : 'No'} |\n`; });
        md += '\n';
      });
      md += '---\n\n';
    }
    if (results.narrative) { md += `## Data Quality Assessment\n\n${results.narrative}\n\n---\n\n`; }
    if (results.recommendations) {
      const rec = results.recommendations;
      md += `## Recommendations\n\n`;
      if (rec.critical_fixes?.length) {
        md += `### Critical Fixes\n\n`;
        rec.critical_fixes.forEach(f => { md += `- **${f.table}**: ${f.issue}\n  - Fix: ${f.fix}\n`; });
        md += '\n';
      }
      if (rec.analytical_queries?.length) {
        md += `### Suggested Queries\n\n`;
        rec.analytical_queries.forEach(q => { md += `**${q.question}**\n\`\`\`sql\n${q.sql}\n\`\`\`\n\n`; });
      }
      if (rec.readiness) {
        md += `### Readiness\n\n| Use Case | Verdict |\n|----------|---------|`
        Object.entries(rec.readiness).forEach(([k, v]) => { md += `\n| ${k.replace(/_/g, ' ')} | ${v} |`; });
        md += '\n';
      }
    }
    return md;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Step definitions ───────────────────────────────────

  const steps = [
    { id: 1, label: 'Domain Detection', icon: '🎯' },
    { id: 2, label: 'Business Summaries', icon: '📝' },
    { id: 3, label: 'Data Dictionary', icon: '📖' },
    { id: 4, label: 'Quality Narrative', icon: '📊' },
    { id: 5, label: 'Recommendations', icon: '💡' },
  ];

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">

      {/* ── Header ── */}
      <div className="p-5 border-b border-gray-700/50">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-fuchsia-400">
                AI Analysis Generator
              </span>
            </h1>
            <p className="text-xs text-gray-400 mt-1">
              {tables.length} tables · OpenRouter · {selectedModel.split('/')[1]?.split(':')[0] || selectedModel}
            </p>
          </div>

          {step === 6 && (
            <div className="flex gap-2">
              <button onClick={exportJSON} className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs transition-colors">⬇ JSON</button>
              <button onClick={exportMarkdown} className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs transition-colors">⬇ Markdown</button>
              <button onClick={copyToClipboard} className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs transition-colors">📋 Copy</button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-5 space-y-6">

        {/* ── API Key / Model selector ── */}
        {step === 0 && (
          <div className="rounded-xl border border-gray-700/50 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Configuration</h2>

            <div>
              <label className="block text-xs text-gray-400 mb-1">OpenRouter API Key</label>
              <input
                type="password"
                value={localApiKey}
                onChange={e => setLocalApiKey(e.target.value)}
                placeholder="sk-or-v1-..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-violet-500/50"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                Free at <a href="https://openrouter.ai" target="_blank" rel="noopener" className="text-violet-400 hover:underline">openrouter.ai</a> — no credit card needed
              </p>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Model</label>
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none"
              >
                {FREE_MODELS.map(m => (
                  <option key={m} value={m}>{m.split('/')[1]?.replace(':free', '') || m} (free)</option>
                ))}
              </select>
            </div>

            <button
              onClick={runPipeline}
              disabled={!localApiKey || running}
              className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
                localApiKey
                  ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white shadow-lg shadow-violet-500/20'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              }`}
            >
              {running ? '⏳ Generating…' : '✦ Generate AI Analysis'}
            </button>

            <p className="text-[10px] text-gray-500 text-center">
              This will make ~{2 + tables.length * 2} API calls ({tables.length} tables × 2 calls + 3 global calls)
            </p>
          </div>
        )}

        {/* ── Progress tracker ── */}
        {step > 0 && (
          <div className="rounded-xl border border-gray-700/50 p-4">
            <div className="flex items-center justify-between gap-1">
              {steps.map((s, i) => {
                const status = progress[s.id] || 'pending';
                return (
                  <React.Fragment key={s.id}>
                    <div className="flex flex-col items-center gap-1.5 flex-1">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all ${
                        status === 'done' ? 'bg-emerald-500/20 ring-2 ring-emerald-500/40'
                        : status === 'running' ? 'bg-violet-500/20 ring-2 ring-violet-500/40 animate-pulse'
                        : status === 'error' ? 'bg-red-500/20 ring-2 ring-red-500/40'
                        : 'bg-gray-800 ring-1 ring-gray-700'
                      }`}>
                        {status === 'done' ? '✅' : status === 'running' ? s.icon : status === 'error' ? '❌' : s.icon}
                      </div>
                      <span className={`text-[10px] text-center ${
                        status === 'done' ? 'text-emerald-400' : status === 'running' ? 'text-violet-400' : status === 'error' ? 'text-red-400' : 'text-gray-500'
                      }`}>{s.label}</span>
                    </div>
                    {i < steps.length - 1 && (
                      <div className={`h-0.5 flex-1 mt-[-20px] transition-colors ${
                        progress[s.id] === 'done' ? 'bg-emerald-500/40' : 'bg-gray-700'
                      }`} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            {subProgress && (
              <p className="text-xs text-gray-400 text-center mt-3">{subProgress}</p>
            )}
          </div>
        )}

        {/* ── Results sections ── */}

        {/* Domain Info */}
        {results.domain && (
          <ResultCard
            title="🎯 Domain Detection"
            stepNum={1}
            status={progress[1]}
            error={errors[1]}
            onRegenerate={() => regenerateStep(1)}
          >
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-violet-500/15 text-violet-400 border border-violet-500/25">
                  {results.domain.domain}
                </span>
                {(results.domain.key_entities || []).map((e, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-gray-800 text-gray-400 border border-gray-700">{e}</span>
                ))}
              </div>
              <p className="text-sm text-gray-300 leading-relaxed">{results.domain.executive_summary}</p>
              <p className="text-xs text-gray-500">
                <strong className="text-gray-400">Purpose:</strong> {results.domain.db_purpose}
              </p>
            </div>
          </ResultCard>
        )}

        {/* Business Summaries */}
        {results.summaries && (
          <ResultCard
            title="📝 Business Summaries"
            stepNum={2}
            status={progress[2]}
            error={errors[2]}
            onRegenerate={() => regenerateStep(2)}
          >
            <div className="space-y-3">
              {Object.entries(results.summaries).map(([table, summary]) => (
                <div key={table} className="p-3 rounded-lg bg-gray-800/40 border border-gray-700/30">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{table}</h4>
                  <p className="text-sm text-gray-300 leading-relaxed">{summary}</p>
                </div>
              ))}
            </div>
          </ResultCard>
        )}

        {/* Data Dictionary */}
        {results.dictionary && (
          <ResultCard
            title="📖 Data Dictionary"
            stepNum={3}
            status={progress[3]}
            error={errors[3]}
            onRegenerate={() => regenerateStep(3)}
          >
            <div className="space-y-4">
              {Object.entries(results.dictionary).map(([table, dd]) => {
                const cols = dd?.columns || [];
                if (!cols.length) return null;
                return (
                  <div key={table}>
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{table}</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-700/50">
                            <th className="text-left px-3 py-1.5 font-medium">Column</th>
                            <th className="text-left px-3 py-1.5 font-medium">Description</th>
                            <th className="text-left px-3 py-1.5 font-medium">Format</th>
                            <th className="text-center px-3 py-1.5 font-medium">Sensitive</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cols.map((c, i) => (
                            <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/30">
                              <td className="px-3 py-1.5 font-mono text-gray-300">{c.name}</td>
                              <td className="px-3 py-1.5 text-gray-400 max-w-xs">{c.description}</td>
                              <td className="px-3 py-1.5 text-gray-500 font-mono">{c.format || '—'}</td>
                              <td className="px-3 py-1.5 text-center">
                                {c.sensitive ? <span className="text-red-400">🔒</span> : <span className="text-gray-600">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </ResultCard>
        )}

        {/* Quality Narrative */}
        {results.narrative && (
          <ResultCard
            title="📊 Quality Narrative"
            stepNum={4}
            status={progress[4]}
            error={errors[4]}
            onRegenerate={() => regenerateStep(4)}
          >
            <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{results.narrative}</p>
          </ResultCard>
        )}

        {/* Recommendations */}
        {results.recommendations && (
          <ResultCard
            title="💡 Recommendations"
            stepNum={5}
            status={progress[5]}
            error={errors[5]}
            onRegenerate={() => regenerateStep(5)}
          >
            <RecommendationsView data={results.recommendations} />
          </ResultCard>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────

function ResultCard({ title, stepNum, status, error, onRegenerate, children }) {
  return (
    <div className={`rounded-xl border overflow-hidden ${
      error ? 'border-red-500/20' : 'border-gray-700/50'
    }`}>
      <div className="px-4 py-3 bg-gray-800/60 border-b border-gray-700/50 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300">{title}</h2>
        <button
          onClick={onRegenerate}
          disabled={status === 'running'}
          className="px-2.5 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-[10px] text-gray-400 transition-colors disabled:opacity-50"
        >
          {status === 'running' ? '⏳' : '🔄'} Regenerate
        </button>
      </div>
      <div className="p-4">
        {error && (
          <div className="mb-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-red-400">
            ⚠ {error}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function RecommendationsView({ data }) {
  if (!data || typeof data !== 'object') return <p className="text-gray-500 text-sm">No recommendations</p>;

  return (
    <div className="space-y-4">
      {/* Critical fixes */}
      {data.critical_fixes?.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">Critical Fixes</h4>
          <div className="space-y-2">
            {data.critical_fixes.map((f, i) => (
              <div key={i} className="p-3 rounded-lg bg-red-500/5 border border-red-500/15">
                <p className="text-xs text-gray-300"><strong className="text-red-400">{f.table}</strong>: {f.issue}</p>
                <p className="text-xs text-gray-500 mt-1">Fix: {f.fix}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Schema improvements */}
      {data.schema_improvements?.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">Schema Improvements</h4>
          <ul className="space-y-1">
            {data.schema_improvements.map((s, i) => (
              <li key={i} className="text-xs text-gray-400 flex gap-2">
                <span className="text-blue-400">→</span> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Analytical queries */}
      {data.analytical_queries?.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">Suggested Queries</h4>
          <div className="space-y-2">
            {data.analytical_queries.map((q, i) => (
              <div key={i} className="p-3 rounded-lg bg-gray-800/40">
                <p className="text-xs text-gray-300 mb-1.5">{q.question}</p>
                <pre className="text-[10px] text-emerald-400 bg-gray-900 rounded p-2 overflow-x-auto font-mono">{q.sql}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Readiness */}
      {data.readiness && (
        <div>
          <h4 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-2">Readiness Assessment</h4>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(data.readiness).map(([key, verdict]) => {
              const isReady = String(verdict).toLowerCase().startsWith('ready');
              return (
                <div key={key} className={`p-3 rounded-lg border text-center ${
                  isReady ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-yellow-500/5 border-yellow-500/20'
                }`}>
                  <p className="text-[10px] text-gray-500 uppercase mb-1">{key.replace(/_/g, ' ')}</p>
                  <p className={`text-xs font-medium ${isReady ? 'text-emerald-400' : 'text-yellow-400'}`}>
                    {String(verdict).split('—')[0].trim()}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
