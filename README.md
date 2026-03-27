# AI Database Analysis Agent

[![React](https://img.shields.io/badge/React-18.2%2B-61DAFB?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.0%2B-646CFF?logo=vite)](https://vitejs.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js)](https://nodejs.org/)
[![Python 3.8+](https://img.shields.io/badge/Python-3.8%2B-blue)](https://www.python.org/downloads/)
[![Gemini API](https://img.shields.io/badge/Google%20Gemini-AI-FF6F00?logo=google)](https://ai.google.dev/)

## Table of Contents

1. [Project Overview](#project-overview)
2. [Features](#features)
3. [Architecture & Privacy](#architecture--privacy)
4. [Prerequisites](#prerequisites)
5. [Installation & Setup](#installation--setup)
6. [Configuration](#configuration)
7. [Running the Application](#running-the-application)
8. [API Documentation](#api-documentation)
9. [Technology Stack](#technology-stack)
10. [Project Structure](#project-structure)
11. [Troubleshooting](#troubleshooting)
12. [License](#license)

---

## Project Overview

The **AI Database Analysis Agent** is a powerful, browser-based forensic tool that accepts any relational database, automatically reverse-engineers its structure, profiles data quality, maps relationships into visual Entity-Relationship (ER) diagrams, and generates human-readable business summaries.

Built with a **privacy-first architecture**, the core analysis engine runs locally in your browser using WebAssembly (WASM), ensuring that your raw data never leaves your machine. Only lightweight schema metadata is passed to the AI (Google Gemini) for generating insights, dictionaries, and relationship maps.

### Key Features:

- Universal database ingestion (SQLite, CSV, PostgreSQL, MySQL, MongoDB)
- Automated schema extraction and intelligent relationship inference
- Statistical data quality profiling and health scoring
- AI-generated data dictionaries and business context reports
- Interactive Graphviz ER diagrams
- Universal Migrator for exporting DBs to Postgres, MySQL, or Oracle
- 100% Client-side data execution (Privacy Guard)

### Value Proposition:

- **Accelerate Onboarding:** Instantly understand undocumented legacy databases.
- **Ensure Data Privacy:** Analyze gigabytes of data securely within the browser sandbox.
- **Automate Documentation:** Replace weeks of manual data dictionary writing with AI generation.
- **Streamline Migrations:** Export and migrate schemas between different SQL dialects flawlessly.

---

## Features

### 1. Multi-Source Data Ingestion (Upload Tab)

- Drag-and-drop support for `.sqlite`, `.db`, `.csv`, and `.sql` dump files.
- Fetch remote data directly via Cloud URLs.
- Node.js backend integration for live connections to PostgreSQL, MySQL, and MongoDB.

### 2. Schema Intelligence (Schema Tab)

- Automated extraction of tables, columns, data types, and nullability constraints.
- Primary Key (PK) and Foreign Key (FK) detection.
- Quick preview of table metadata and top 5 sample rows.

### 3. Entity-Relationship Mapping (Relationships Tab)

- AI-powered LangGraph automatic mapper to infer missing relationships mathematically.
- Dynamic, interactive ER diagrams rendered using Graphviz and Kroki.
- Zoom, pan, and modular viewing (all tables vs. specific table clusters).

### 4. Data Quality Engine (Quality Tab)

- Calculates a global "Health Score" (0-100) based on data completeness and freshness.
- Statistical profiling: mean, min, max, null rates, and uniqueness percentages.
- Orphan row detection for broken foreign key constraints.
- Automated anomaly feed alerting you to critical data integrity issues.

### 5. AI Data Dictionary (Dictionary Tab)

- Seamless Google Gemini API integration.
- Generates concise, business-readable descriptions for every column in your database.
- Interactive two-panel layout linking the generated dictionary with mini-ER diagrams.

### 6. Business Context Summaries (Summaries Tab)

- Acts as a Principal Data Architect to synthesize your schema into a professional Markdown report.
- Infers core business entities, workflow lifecycles, and key KPIs based on data structures.

### 7. Privacy Guard (Audit Tab)

- Real-time forensic tracer proving zero data leakage.
- Shows exact byte/row metrics of what is processed locally via WASM vs. what metadata is ingressed to the LLM.

### 8. Universal Migrator (Export Tab)

- Translates the current database schema and row data into target-specific syntax.
- Supports 1-click exports to **MySQL**, **PostgreSQL**, and **Oracle**.

---

## Architecture & Privacy

The system uses a hybrid, privacy-centric architecture:

1. **Local WASM Processing:** When a user uploads a `.sqlite` or `.csv` file, the file is loaded directly into the browser's memory using `sql.js` (SQLite compiled to WebAssembly). The row-level data _never_ touches a backend server.
2. **Metadata Ingress:** For AI features, only structural metadata (table names, column names, types) and a maximum of 3 anonymized sample rows are sent to the Gemini API.
3. **Remote Connectors:** For live databases (Postgres/MySQL/Mongo), a lightweight Node.js Express server acts as a bridge, querying the system catalogs (`information_schema`) to extract metadata without downloading the full datasets.
4. **Python Pipeline:** A standalone CLI pipeline (`pipeline.py`) is provided for developers who wish to run the entire analysis offline or via CI/CD scripts.

---

## Prerequisites

### System Requirements

- **OS:** Windows, macOS, or Linux
- **Memory:** Minimum 4GB RAM (8GB recommended for large local databases)

### Required Software

- **Frontend & Node API:** Node.js 18.0+ and npm 8.0+
- **Python CLI Pipeline:** Python 3.8+ and pip
- **Google Gemini API Key:** Get your free key from [Google AI Studio](https://makersuite.google.com/app/apikey)

---

## Installation & Setup

### Step 1: Clone the Repository

```bash
git clone [https://github.com/shivam-vishwakarmaa/ai-db-analysis.git](https://github.com/shivam-vishwakarmaa/ai-db-analysis.git)
cd ai-db-analysis

Step 2: Frontend SetupBashcd frontend
npm install
Step 3: Node.js Remote Connection API SetupBash# From the project root
npm install
Step 4: Python Pipeline Setup (Optional)Bashcd python
python -m venv venv

# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

pip install -r ../requirements.txt
⚙️ ConfigurationCreate a .env file in the frontend directory (for the React app) and the root directory (for the Python CLI):frontend/.envCode snippet# Required for AI Dictionary & Summaries
VITE_GEMINI_API_KEY=your-google-gemini-api-key-here
Root .env (for Python)Code snippetGEMINI_API_KEY=your-google-gemini-api-key-here
Running the Application1. Start the React FrontendThis is the primary user interface.Bashcd frontend
npm run dev
Access the application at http://localhost:51732. Start the Node.js API (For live remote databases)Run this if you want to connect to remote Postgres, MySQL, or MongoDB instances.Bash# From the project root
npm start
The API will listen on http://localhost:30013. Run the Python CLI Pipeline (Headless Mode)Use the Python script to run automated analysis on a database without the UI.Bashcd python/src
python pipeline.py --input ../../sample_data/chinook.db --type sqlite --output-dir ../../outputs
API DocumentationThe Node.js backend provides a bridge to connect to live SQL/NoSQL databases.Extract Remote SchemaEndpoint: POST /api/connectDescription: Connects to a provided database string, extracts the schema via information_schema, and returns a unified JSON format compatible with the frontend agent.Request Body:JSON{
  "connectionString": "postgresql://user:password@localhost:5432/mydb"
}
Supports postgresql://, mysql://, and mongodb:// formats.Response (200 OK):JSON{
  "schema": {
    "metadata": {
      "database_name": "mydb",
      "input_type": "postgres",
      "total_tables": 15,
      "total_columns": 84,
      "total_rows": 45000,
      "fk_source": "inferred"
    },
    "tables": [ ... ],
    "relationships": [ ... ]
  }
}
🛠️ Technology StackFrontend ApplicationTechnologyPurposeReact 18UI FrameworkViteBuild Tool & Dev ServerTailwind CSSStyling & UI Gridsql.js (WASM)In-browser SQLite execution & parsingRechartsData quality visualizationPapaParseCSV to SQLite conversionBackend API & CLITechnologyPurposeNode.js / ExpressRemote database connector APIpg / mysql2 / mongodbDatabase-specific driversPython 3Standalone analysis pipelineGoogle Gemini APILLM for Business Summaries and DictionariesKroki / GraphvizER Diagram renderingProject StructurePlaintextai-db-analysis/
├── frontend/                 # React UI Application
│   ├── public/
│   │   └── sql-wasm/         # Pre-compiled WebAssembly SQLite engine
│   ├── src/
│   │   ├── App.jsx           # Main Dashboard and Logic
│   │   ├── RelationshipMapper.jsx
│   │   ├── index.css         # Tailwind globals
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
│
├── python/                   # Standalone Python Analysis Pipeline
│   └── src/
│       ├── pipeline.py       # Master CLI orchestrator
│       ├── ai_generator.py   # LLM context generation
│       ├── quality_profiler.py
│       └── schema_extractor.py
│
├── server.js                 # Node.js API for live DB connections
├── package.json              # Node.js dependencies
└── README.md                 # This documentation

TroubleshootingIssue: "API Status 404: Model not found"Solution: The default Gemini models (gemini-1.5-flash) might not be enabled in your region or for your API key. The app includes a smart fallback mechanism, but ensure that the Generative Language API is enabled in your Google Cloud / AI Studio console.Issue: "WASM module failed to load"Solution: Ensure you are running the frontend via npm run dev or a proper web server. Loading WASM files directly from the file:// protocol in the browser is blocked by default CORS/security policies.Issue: Large CSV uploads crash the browserSolution: The application batches CSV inserts (500 rows at a time). However, files larger than 100MB may exhaust browser RAM. For massive datasets, use the Python CLI pipeline instead.Issue: Node backend cannot connect to MySQL/PostgresSolution: Ensure the database server is running, the port is accessible, and the connection string contains the correct username, password, and host parameters.LicenseThis project is licensed under the ISC License.
```
