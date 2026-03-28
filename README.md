# AI Database Analysis Agent

[![React](https://img.shields.io/badge/React-18.2%2B-61DAFB?logo=react)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js)](https://nodejs.org/)
[![Python 3.8+](https://img.shields.io/badge/Python-3.8%2B-blue)](https://www.python.org/downloads/)
[![Gemini API](https://img.shields.io/badge/Google%20Gemini-AI-FF6F00?logo=google)](https://ai.google.dev/)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-black?logo=vercel)](https://ai-db-analysis.vercel.app/)

## Table of Contents

1. [Project Overview](#project-overview)
2. [Features](#features)
3. [Prerequisites](#prerequisites)
4. [Installation & Setup](#installation--setup)
5. [Configuration](#configuration)
6. [Running the Application](#running-the-application)
7. [API Documentation](#api-documentation)
8. [Architecture](#architecture)
9. [Technology Stack](#technology-stack)
10. [Project Structure](#project-structure)
11. [Development Guide](#development-guide)
12. [Troubleshooting](#troubleshooting)
13. [Contributing](#contributing)
14. [Documentation](#documentation)
15. [License](#license)

---

## Project Overview

**AI Database Analysis Agent** is a comprehensive browser-based forensic platform that automatically reverse-engineers relational database structures, profiles data quality, maps relationships into visual ER diagrams, and generates human-readable business summaries. The system integrates secure local WebAssembly processing with AI-driven insights to provide actionable analytics without compromising data privacy.

## Architechture Diagrma and Flow 

<img width="1024" height="559" alt="image" src="https://github.com/user-attachments/assets/cd644dab-f1bc-40b5-8271-452aa64618d0" />

### Key Features:

- Multi-source database ingestion (SQLite, CSV, PostgreSQL, MySQL, MongoDB)
- Automated schema extraction and intelligent relationship inference
- Statistical data quality profiling and health scoring
- Interactive Graphviz Entity-Relationship (ER) diagram generation
- AI-powered data dictionaries and business context reports
- Universal Migrator for exporting DBs to Postgres, MySQL, or Oracle
- 100% Client-side data execution (Privacy Guard)
- Responsive, modern web interface

### Value Proposition:

- **Accelerate onboarding** by instantly understanding undocumented legacy databases
- **Ensure strict data privacy** by analyzing datasets securely within the browser sandbox
- **Automate documentation** by replacing weeks of manual data dictionary writing with AI generation
- **Streamline platform migrations** with flawlessly generated SQL export scripts

---

## Features

### Core Functionality

**Multi-Source Data Ingestion**

- Drag & drop file upload for `.sqlite`, `.db`, `.csv`, and `.sql` dump files
- Fetch remote data directly via Cloud URLs
- Live Node.js backend integration for PostgreSQL, MySQL, and MongoDB

**Schema Intelligence & Analysis**

- Automated extraction of tables, columns, and data types
- Identification of Primary Keys (PK) and Foreign Keys (FK)
- Quick preview of table metadata and top 5 sample rows

**Entity-Relationship Mapping**

- AI-powered LangGraph automatic mapper to mathematically infer missing relationships
- Dynamic, interactive ER diagrams rendered using Graphviz and Kroki
- Modular viewing (all tables vs. specific table clusters) with zoom and pan

**Data Quality Engine**

- Global "Health Score" (0-100) based on data completeness and freshness
- Statistical profiling: mean, min, max, null rates, and uniqueness percentages
- Orphan row detection for broken foreign key constraints
- Automated anomaly feed alerting to critical data integrity issues

**AI-Generated Business Context**

- Google Gemini API integration for natural language insights
- Auto-generated, business-readable descriptions for every database column
- Comprehensive Markdown reports detailing core entities and workflow lifecycles

**Universal Migrator**

- Translates current database schema and row data into target-specific syntax
- 1-click optimized export scripts for MySQL, PostgreSQL, and Oracle

**Data Management & Privacy**

- Real-time forensic tracer proving zero row-level data leakage
- LocalStorage session persistence
- Complete JSON state export functionality

---

## Prerequisites

### System Requirements

- **OS:** Windows, macOS, or Linux
- **Memory:** Minimum 4GB RAM (8GB recommended for large datasets)
- **Storage:** At least 500MB free space

### Required Software

**Backend & API:**

- Node.js 18.0 or higher
- npm 8.0 or higher

**Python Pipeline (Optional CLI):**

- Python 3.8 or higher
- pip (Python package manager)

### API Keys

- **Google Gemini API Key** (for AI explanations and summaries)
  - Sign up at: https://ai.google.dev/
  - Get API key from: https://makersuite.google.com/app/apikey

---

## Installation & Setup

### Step 1: Clone the Repository

```bash
git clone [https://github.com/shivam-vishwakarmaa/ai-db-analysis.git](https://github.com/shivam-vishwakarmaa/ai-db-analysis.git)
cd ai-db-analysis

Step 2: Node API & Frontend Setup
2.1 Install Root Backend Dependencies

Bash
npm install
Expected packages:

express>=5.2.1

cors>=2.8.6

mongodb>=7.1.1

mysql2>=3.20.0

pg>=8.20.0

2.2 Install Frontend Dependencies & Build
Bash
cd frontend
npm install
npm run build
Step 3: Python Pipeline Setup (CLI Extension)
3.1 Create Virtual Environment
Bash
cd python
# Windows
python -m venv venv
venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
3.2 Install Python Dependencies
Bash
pip install -r ../requirements.txt
⚙️ Configuration
Use a single `.env` at the project root (shared by frontend and Python).

Bash
touch .env

Add the following variables:

Code snippet
# Browser AI (optional)
VITE_GEMINI_API_KEY=your-google-gemini-api-key-here

# Python AI (optional)
OPENROUTER_API_KEY=your-openrouter-api-key-here

Note: `frontend/vite.config.js` sets `envDir: '..'`, so Vite reads from the root `.env`.

4. Verify Configuration
Bash
node -e "require('dotenv').config({ path: '.env' }); console.log('Gemini Key Exists:', !!process.env.VITE_GEMINI_API_KEY)"
Running the Application
Option 1: Development Mode (Recommended for First-Time Setup)
Terminal 1: Node.js Backend Server (For Live Databases)
Bash
# From project root
npm start
Expected output:

API listening on 3001
Terminal 2: Frontend Development Server
Bash
cd frontend
npm run dev
Expected output:

  VITE v5.0.0  ready in XXX ms

  ➜  Local:   http://localhost:5173/
Access the application: http://localhost:5173

Option 2: Python CLI Pipeline (Headless Mode)
Run automated analysis on a database without the UI:

Bash
cd python/src
python pipeline.py --input ../../sample_data/chinook.db --type sqlite --output-dir ../../outputs
Expected output:

▶ Step 1/5: Loading database…
  ✓ Loaded 11 tables, 15,200 rows
Option 3: Docker (Optional)
Bash
# Build Docker image
docker build -t aidbanalysis:latest .

# Run container
docker run -p 5173:5173 -p 3001:3001 \
  -e VITE_GEMINI_API_KEY=your-api-key \
  aidbanalysis:latest
API Documentation
Base URL
http://localhost:3001/api
Endpoints
1. Live Database Connection & Extraction
Endpoint: POST /api/connect

Description: Connects to a provided database string (Postgres/MySQL/MongoDB), extracts the schema via system catalogs (information_schema), and returns a unified JSON format compatible with the frontend agent.

Request Headers:

Content-Type: application/json
Request Parameters:

Parameter	Type	Required	Description
connectionString	string	Yes	Standard DB connection URI
Response (200 OK):

JSON
{
  "schema": {
    "metadata": {
      "database_name": "mydb",
      "input_type": "postgres",
      "total_tables": 15,
      "total_columns": 84,
      "total_rows": 45000,
      "fk_source": "inferred"
    },
    "tables": [
      {
        "name": "users",
        "columns": [
          {
            "name": "id",
            "type": "integer",
            "nullable": false,
            "primary_key": true,
            "unique": true
          }
        ],
        "primary_keys": ["id"],
        "foreign_keys": [],
        "row_count": 1250,
        "sample_data": [{"id": 1}],
        "indexes": []
      }
    ],
    "relationships": []
  }
}
Error Response (400 Bad Request):

JSON
{
  "error": "Unsupported database type"
}
Example cURL:

Bash
curl -X POST "http://localhost:3001/api/connect" \
  -H "Content-Type: application/json" \
  -d '{"connectionString":"postgresql://user:password@localhost:5432/mydb"}'
Example JavaScript (Fetch):

JavaScript
const response = await fetch("http://localhost:3001/api/connect", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    connectionString: "mysql://root:password@localhost:3306/ecommerce"
  })
});

const results = await response.json();
console.log(results);
Response Data Model
TableSchema
JSON
{
  "name": "table_name",
  "columns": ["ColumnData"],
  "primary_keys": ["id"],
  "foreign_keys": ["ForeignKeyData"],
  "row_count": 1000,
  "sample_data": [{}]
}
ColumnData
JSON
{
  "name": "status",
  "type": "VARCHAR(255)",
  "nullable": false,
  "primary_key": false,
  "unique": false
}
ForeignKeyData
JSON
{
  "column": "user_id",
  "references_table": "users",
  "references_column": "id",
  "inferred": true
}
HTTP Status Codes
Status	Description
200	Successful connection and extraction
400	Bad request (missing URI or unsupported)
500	Internal server error (DB unreachable)
Architecture
System Architecture Diagram
┌─────────────────────────────────────────────────┐
│         React Frontend (Vite + Tailwind)        │
│  - WASM SQLite Engine (sql.js)                  │
│  - Interactive Dashboard & ER Rendering         │
│  - Real-time result visualization               │
│  - Privacy Guard Validation                     │
└─────────────────────┬───────────────────────────┘
                      │ HTTP/REST
┌─────────────────────┴───────────────────────────┐
│        Node.js API (Express + Database Drivers) │
│  - Live DB Schema Extraction                    │
│  - Supports PG, MySQL, MongoDB                  │
│  - CORS middleware                              │
└─────────────────────┬───────────────────────────┘
                      │
    ┌─────────────────┼─────────────────┐
    │                 │                 │
┌───▼────┐    ┌──────▼──────┐    ┌──────▼────┐
│ Schema │    │   Analysis  │    │  Google   │
│ Parser │    │   Engine    │    │  Gemini   │
│        │    │  (LangGraph)│    │   API     │
└────────┘    └─────────────┘    └───────────┘
Data Flow Pipeline
1. File/URL Upload or DB Connect →
2. WASM SQLite Execution (Local) →
3. Schema & Metadata Extraction →
4. Statistical Quality Profiling →
5. LangGraph AI Relationship Proposer →
6. SQL Validator Node (Integrity Checks) →
7. Graphviz ER Diagram Rendering →
8. Gemini LLM Business Summary Generation →
9. Universal SQL Migration Export
🛠️ Technology Stack
Frontend
Technology	Version	Purpose
React	18.2+	UI framework
Vite	5.0+	Build tool & dev server
Tailwind CSS	3.3+	Styling
sql.js (WASM)	1.8+	Local SQLite execution
Recharts	2.10+	Quality visualizations
Backend & CLI
Technology	Version	Purpose
Node.js	18.0+	Remote DB Connector
Express	5.2+	API Framework
Python	3.8+	Standalone CLI Pipeline
pg / mysql2	Latest	Database Drivers
External Services
Service	Purpose
Google Gemini API	AI context & summaries
Kroki / Graphviz	ER Diagram rendering
Project Structure
ai-db-analysis/
├── frontend/                      # React UI Application
│   ├── public/
│   │   └── sql-wasm/              # Pre-compiled WebAssembly SQLite engine
│   ├── src/
│   │   ├── components/            # React components
│   │   ├── App.jsx                # Main Dashboard
│   │   └── index.css              # Tailwind globals
│   ├── package.json               # Frontend dependencies
│   └── vite.config.js             # Vite configuration
│
├── python/                        # Standalone Python Analysis Pipeline
│   └── src/
│       ├── pipeline.py            # Master CLI orchestrator
│       ├── ai_generator.py        # LLM context generation
│       ├── quality_profiler.py    # Statistical analysis logic
│       └── schema_extractor.py    # Metadata extraction
│
├── server.js                      # Node.js API for live DB connections
├── package.json                   # Node.js dependencies
├── README.md                      # This file
└── .gitignore                     # Git ignore rules
👨‍💻 Development Guide
Running Code Formatters
Bash
# Format frontend code with Prettier
cd frontend
npm run format

# Format Python code with black (if installed)
black python/src/
Adding New Database Dialects
Backend: Add endpoint parsing logic in server.js using appropriate driver libraries.

Frontend Migrator: Create a new export mapping component inside App.jsx under the generateUniversalExport function.

Common Development Tasks
Bash
# Install new Node package
cd frontend
npm install package-name

# Install new Python package
cd python
pip install package-name
pip freeze > ../requirements.txt
Troubleshooting
Frontend & API Issues
Issue: "WASM module failed to load"

Bash
# Solution: Ensure you are running the frontend via a local server (npm run dev), not by opening index.html directly from the file system, due to CORS/security policies.
Issue: "API Status 404: Model not found"

Bash
# Solution: Your Gemini API key might not have access to the default model. Ensure the "Generative Language API" is enabled in your Google Cloud / AI Studio console.
Issue: Large CSV uploads crash the browser

Bash
# Solution: The application batches inserts (500 rows at a time), but files >100MB may exhaust browser RAM. Use the Python CLI pipeline for massive datasets.
Common Issues
Issue	Solution
Remote DB connection fails	Ensure credentials and port mappings are correct in URI
Missing ER Diagrams	Check network connectivity to kroki.io
Empty Business Summaries	Verify VITE_GEMINI_API_KEY is properly loaded in .env
Documentation
Comprehensive documentation is available:

Master Prompt - System prompts used for LLM interaction

API Reference - Detailed backend API definitions

```
