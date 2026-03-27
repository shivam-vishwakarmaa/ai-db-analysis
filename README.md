# AI Database Analysis Agent

A browser-based AI agent that accepts any relational database, automatically reverse-engineers its structure, profiles data quality, maps relationships into visual ER diagrams, and generates human-readable business summaries — all inside one interactive dashboard.

## Features

- **Schema Extraction** — Every table, column, type, PK, FK, constraint
- **Visual ER Diagrams** — Mermaid.js + Kroki.io SVG rendering
- **Data Quality Scorecard** — Null rates, completeness, freshness, FK health
- **AI Business Summaries** — Plain English per-table descriptions via OpenRouter
- **Data Dictionary** — Every column described in human language
- **Recommendations** — Quality fixes, schema improvements, SQL ideas

## Tech Stack

### Frontend (React)
- React 18, Tailwind CSS v3
- SQL.js (WebAssembly SQLite), Mermaid.js, Kroki.io API
- Recharts (charts & heatmaps)
- OpenRouter API (free tier — no credit card needed)

### Python Pipeline
- pandas, sqlite3, sqlalchemy, eralchemy2
- networkx, matplotlib, seaborn
- OpenRouter API via HTTP requests

## Setup

```bash
# Install Python dependencies
pip install -r requirements.txt

# Copy env template and add your OpenRouter key
cp .env.example .env

# Install frontend dependencies
cd artifact
npm install
npm run dev
```

## API Key (Free)

1. Sign up at [openrouter.ai](https://openrouter.ai) (no credit card)
2. Copy your API key
3. Paste into `.env` as `OPENROUTER_API_KEY=sk-or-...`

## Project Structure

```
ai-db-analysis-agent/
├── artifact/                  ← React frontend
├── modules/                   ← Individual module artifacts (JSX)
├── python/
│   ├── src/                   ← Python pipeline modules
│   ├── notebooks/             ← Optional Colab notebooks
│   └── outputs/               ← Generated reports & diagrams
├── data/                      ← Demo databases (Chinook, Olist)
└── docs/                      ← Documentation & prompts
```

## License

MIT
