# PharmaGuard - Pharmacogenomic Risk Prediction System (RIFT2026)

[![Python 3.8+](https://img.shields.io/badge/Python-3.8%2B-blue)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2%2B-61DAFB?logo=react)](https://react.dev/)

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

**PharmaGuard** is a comprehensive web-based pharmacogenomic analysis platform that predicts drug safety risks based on patient genetic profiles. The system integrates genomic data (VCF files), drug information, and clinical history to provide evidence-based risk assessments, drug interaction detection, and AI-generated clinical recommendations.

### Key Features:

- Genetic variant analysis from VCF files
- Risk assessment for 6 commonly prescribed medications
- Pharmacogenomic phenotype calculation
- Drug-drug interaction detection
- AI-powered clinical explanations (Google Gemini API)
- Comprehensive data visualization and reporting
- JSON export and data sharing capabilities
- Responsive, modern web interface

### Value Proposition:

- **Reduce adverse drug reactions** through personalized pharmacogenomic analysis
- **Enable precision medicine** with evidence-based medication selection
- **Improve patient outcomes** with data-driven clinical decisions
- **Support healthcare providers** with actionable clinical recommendations

---

## Features

### Core Functionality

**VCF File Upload & Validation**

- Drag & drop file upload
- Format validation and error reporting
- Support for files up to 50MB

**Drug Selection & Analysis**

- 6 supported medications (Warfarin, Clopidogrel, Metoprolol, Simvastatin, Sertraline, Codeine)
- Multi-select drug analyzer
- Sample data for demonstration

**Pharmacogenomic Analysis**

- Gene identification and variant detection
- Phenotype mapping (PM, IM, NM, UM)
- Star allele assignment
- Metabolizer status calculation

**Risk Stratification**

- 4-tier risk levels (LOW → MODERATE → HIGH → CRITICAL)
- Risk percentage scoring (0-100%)
- Severity classification
- Evidence-based reasoning

**Clinical Decision Support**

- Drug-drug interaction detection
- Clinical risk modifiers based on patient history
- Dosing recommendations
- Alternative drug suggestions

**AI-Generated Explanations**

- Google Gemini API integration
- Natural language variant interpretation
- Patient-friendly clinical summaries

**Comprehensive Reporting**

- Summary dashboard with quick metrics
- Gene analysis panel
- Drug risk assessment table
- Detailed drug-by-drug reports
- Variant detection table

**Data Management**

- JSON export functionality
- Copy-to-clipboard support
- Browser-based analysis history
- Session persistence with localStorage

---

## Prerequisites

### System Requirements

- **OS:** Windows, macOS, or Linux
- **Memory:** Minimum 2GB RAM
- **Storage:** At least 500MB free space

### Required Software

**Backend:**

- Python 3.8 or higher
- pip (Python package manager)

**Frontend:**

- Node.js 16.0 or higher
- npm 7.0 or higher

### API Keys

- **Google Gemini API Key** (for AI explanations)
  - Sign up at: https://ai.google.dev/
  - Get API key from: https://makersuite.google.com/app/apikey

---

## Installation & Setup

### Step 1: Clone the Repository

```bash
git clone https://github.com/Nisarg2615/RIFT2026.git
cd RIFT2026
```

### Step 2: Backend Setup

#### 2.1 Create Virtual Environment

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

#### 2.2 Install Python Dependencies

```bash
pip install -r requirements.txt
```

**Expected packages:**

- fastapi>=0.110.0
- uvicorn[standard]>=0.29.0
- python-dotenv>=1.0.0
- pydantic>=2.6.0
- google-generativeai>=0.5.0
- pytest>=8.0 (testing)
- httpx>=0.27 (testing)

#### Verify Installation

```bash
python -c "import fastapi; print(f'FastAPI {fastapi.__version__} installed')"
```

### Step 3: Frontend Setup

#### 3.1 Install Node.js Dependencies

```bash
cd frontend
npm install
```

**Expected packages:**

- react@^18.2.0
- vite@^5.0.8
- tailwindcss@^3.3.6
- framer-motion@^10.16.16
- lucide-react@^0.294.0

#### 3.2 Build Frontend (Production)

```bash
npm run build
```

This creates an optimized build in `frontend/build/` directory.

---

## ⚙️ Configuration

### 1. Create Environment File

Create a `.env` file in the project root:

```bash
touch .env  # macOS/Linux
# or
type nul > .env  # Windows
```

### 2. Configure Environment Variables

Add the following to your `.env` file:

```env
# API Configuration
GEMINI_API_KEY=your-google-gemini-api-key-here

# CORS Configuration
CORS_ORIGINS=["http://localhost:3000", "http://localhost:8000"]

# Application Settings
APP_NAME=PharmaGuard
APP_VERSION=1.0.0

# Supported Drugs (comma-separated)
SUPPORTED_DRUGS=Warfarin,Clopidogrel,Metoprolol,Simvastatin,Sertraline,Codeine

# Supported Genes (comma-separated)
SUPPORTED_GENES=CYP2C9,CYP2C19,CYP2D6,CYP3A4,TPMT,SLCO1B1,ADRA2A,HLA-B
```

### 3. Get Your Google Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click "Create API Key"
3. Copy the generated key
4. Paste it in your `.env` file as `GEMINI_API_KEY`

### 4. Verify Configuration

```bash
python -c "from src.core.config import get_settings; s = get_settings(); print(f'App: {s.app_name}, Gemini: {bool(s.gemini_api_key)}')"
```

---

## Running the Application

### Option 1: Development Mode (Recommended for First-Time Setup)

#### Terminal 1: Backend Server

```bash
# From project root
cd ..  # if in frontend directory
python -m uvicorn src.main:app --reload --port 8000
```

Expected output:

```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete
```

#### Terminal 2: Frontend Development Server

```bash
cd frontend
npm run dev
```

Expected output:

```
  VITE v5.0.8  ready in XXX ms

  ➜  Local:   http://localhost:5173/
```

**Access the application:** http://localhost:8000

### Option 2: Production Mode

#### 2.1 Build Frontend

```bash
cd frontend
npm run build
```

#### 2.2 Run Backend with Built Frontend

```bash
cd ..
python -m uvicorn src.main:app --port 8000
```

**Access the application:** http://localhost:8000

### Option 3: Docker (Optional)

```bash
# Build Docker image
docker build -t pharmaguard:latest .

# Run container
docker run -p 8000:8000 \
  -e GEMINI_API_KEY=your-api-key \
  pharmaguard:latest
```

---

## API Documentation

### Base URL

```
http://localhost:8000/api
```

### Interactive API Docs

Once the backend is running, visit:

- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

---

### Endpoints

#### 1. Health Check

**Endpoint:** `GET /api/health`

**Description:** Check API status and configuration

**Response (200 OK):**

```json
{
  "status": "ok",
  "gemini_configured": true,
  "supported_drugs": [
    "Warfarin",
    "Clopidogrel",
    "Metoprolol",
    "Simvastatin",
    "Sertraline",
    "Codeine"
  ],
  "supported_genes": [
    "CYP2C9",
    "CYP2C19",
    "CYP2D6",
    "CYP3A4",
    "TPMT",
    "SLCO1B1",
    "ADRA2A",
    "HLA-B"
  ]
}
```

**Example cURL:**

```bash
curl -X GET "http://localhost:8000/api/health"
```

---

#### 2. Pharmacogenomic Analysis (Main Endpoint)

**Endpoint:** `POST /api/analyze`

**Description:** Analyze VCF file and predict drug safety risks

**Request Headers:**

```
Content-Type: multipart/form-data
```

**Request Parameters:**

| Parameter         | Type        | Required | Description                               |
| ----------------- | ----------- | -------- | ----------------------------------------- |
| `vcf_file`        | File (.vcf) | Yes      | VCF genetic variant file                  |
| `drugs`           | string      | Yes      | Comma-separated drug names (1-6)          |
| `patient_id`      | string      | No       | Optional patient identifier               |
| `patient_history` | JSON        | No       | Optional patient demographics and history |

**Patient History JSON Schema:**

```json
{
  "age": 45,
  "gender": "Male",
  "weight_kg": 75.5,
  "ethnicity": "Caucasian",
  "blood_group": "O+",
  "conditions": ["Hypertension", "Type 2 Diabetes"],
  "current_medications": ["Lisinopril", "Metformin"],
  "allergies": ["Penicillin"],
  "prior_adverse_reactions": ["Rash from Sulfonamides"],
  "kidney_function": "Normal",
  "liver_function": "Normal",
  "smoking_status": "Never",
  "alcohol_use": "Occasional"
}
```

**Response (200 OK):**

```json
[
  {
    "drug_name": "Warfarin",
    "risk_assessment": {
      "label": "HIGH",
      "percentage": 72,
      "severity": "Severe",
      "reasoning": "Ultra-rapid metabolizer (UM) status may result in reduced drug efficacy, requiring higher doses to achieve therapeutic effect"
    },
    "metabolizer_status": "UM",
    "primary_gene": "CYP2C9",
    "detected_variants": [
      {
        "rsid": "rs1057910",
        "chromosome": "10",
        "position": 96702047,
        "genotype": "G/G",
        "zygosity": "homozygous",
        "star_alleles": "*1/*1"
      }
    ],
    "drug_interactions": [
      {
        "interacting_drug": "Aspirin",
        "severity": "moderate",
        "mechanism": "Both increase bleeding risk; combined use requires careful monitoring"
      },
      {
        "interacting_drug": "NSAIDs",
        "severity": "moderate",
        "mechanism": "NSAIDs may increase anticoagulant effects"
      }
    ],
    "evidence_score": {
      "score": 85,
      "factors": [
        "Well-characterized variant",
        "Strong annotation in ClinVar",
        "Supported by clinical evidence",
        "Population frequency data available"
      ]
    },
    "clinical_recommendations": {
      "dosing": "Monitor INR closely; may require doses 20-30% higher than standard; check every 2 weeks initially",
      "monitoring": "INR monitoring every 2-4 weeks; watch for bleeding signs",
      "contraindication": false,
      "alternative_drugs": ["Apixaban", "Rivaroxaban", "Dabigatran"]
    },
    "llm_explanation": "This patient carries genetic variants that make them an ultra-rapid metabolizer of Warfarin. This means their body breaks down the drug very quickly, which could reduce its effectiveness. As a result, standard doses may not provide adequate anticoagulation for stroke prevention...",
    "quality_metrics": {
      "overall_confidence": 0.86,
      "variant_coverage": 0.95
    }
  }
]
```

**Error Response (400 Bad Request):**

```json
{
  "detail": "No drugs specified. Please select at least 1 drug (maximum 6)."
}
```

**Error Response (422 Unprocessable Entity):**

```json
{
  "detail": [
    {
      "loc": ["body", "vcf_file"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

**Example cURL:**

```bash
curl -X POST "http://localhost:8000/api/analyze" \
  -F "vcf_file=@patient.vcf" \
  -F "drugs=Warfarin,Clopidogrel" \
  -F "patient_id=P12345" \
  -F 'patient_history={"age":45,"gender":"Male"}'
```

**Example Python (requests):**

```python
import requests
import json

url = "http://localhost:8000/api/analyze"
files = {"vcf_file": open("sample.vcf", "rb")}
data = {
    "drugs": "Warfarin,Clopidogrel,Metoprolol",
    "patient_id": "PATIENT-001",
    "patient_history": json.dumps({
        "age": 55,
        "gender": "Female",
        "kidney_function": "Normal"
    })
}

response = requests.post(url, files=files, data=data)
print(response.json())
```

**Example JavaScript (Fetch):**

```javascript
const formData = new FormData();
formData.append("vcf_file", vcfFileInput.files[0]);
formData.append("drugs", "Warfarin,Clopidogrel");
formData.append("patient_id", "PATIENT-001");
formData.append(
  "patient_history",
  JSON.stringify({
    age: 55,
    gender: "Female",
  }),
);

const response = await fetch("http://localhost:8000/api/analyze", {
  method: "POST",
  body: formData,
});

const results = await response.json();
console.log(results);
```

---

### Response Data Model

#### RiskAssessment

```json
{
  "label": "LOW|MODERATE|HIGH|CRITICAL",
  "percentage": 0-100,
  "severity": "Mild|Moderate|Severe|Life-threatening",
  "reasoning": "string explanation"
}
```

#### DetectedVariant

```json
{
  "rsid": "rs1057910",
  "chromosome": "10",
  "position": 96702047,
  "genotype": "G/G",
  "zygosity": "homozygous|heterozygous|hemizygous",
  "star_alleles": "*1/*1"
}
```

#### DrugInteraction

```json
{
  "interacting_drug": "Aspirin",
  "severity": "mild|moderate|severe",
  "mechanism": "interaction explanation"
}
```

#### ClinicalRecommendation

```json
{
  "dosing": "dosing guidance",
  "monitoring": "monitoring requirements",
  "contraindication": false,
  "alternative_drugs": ["Drug1", "Drug2"]
}
```

---

### HTTP Status Codes

| Status | Description                             |
| ------ | --------------------------------------- |
| 200    | Successful analysis                     |
| 400    | Bad request (missing parameters)        |
| 422    | Unprocessable entity (validation error) |
| 500    | Internal server error                   |

---

## Architecture

![System Architecture](docs/architecture.svg)

### Data Flow Pipeline

```
1. VCF Upload →
2. VCF Parsing →
3. Gene Identification →
4. Variant Detection →
5. Phenotype Mapping →
6. Risk Assessment →
7. Clinical Modifier Application →
8. Interaction Detection →
9. Evidence Scoring →
10. LLM Explanation Generation →
11. Results Packaging (JSON) →
12. Results Response
```

---

## 🛠️ Technology Stack

### Frontend

| Technology    | Version | Purpose                 |
| ------------- | ------- | ----------------------- |
| React         | 18.2+   | UI framework            |
| Vite          | 5.0+    | Build tool & dev server |
| Tailwind CSS  | 3.3+    | Styling                 |
| Framer Motion | 10.16+  | Animations              |
| Lucide React  | 0.294+  | Icons                   |

### Backend

| Technology    | Version | Purpose                |
| ------------- | ------- | ---------------------- |
| FastAPI       | 0.110+  | Web framework          |
| Python        | 3.8+    | Language               |
| Uvicorn       | 0.29+   | ASGI server            |
| Pydantic      | 2.6+    | Data validation        |
| Python-dotenv | 1.0+    | Environment management |

### External Services

| Service           | Purpose                 |
| ----------------- | ----------------------- |
| Google Gemini API | AI-powered explanations |

---

## Project Structure

```
RIFT2026/
├── frontend/                      # React frontend application
│   ├── src/
│   │   ├── components/           # React components
│   │   ├── App.js               # Main app component
│   │   └── index.css            # Global styles
│   ├── public/
│   │   └── index.html           # HTML entry point
│   ├── package.json             # Node dependencies
│   ├── vite.config.js           # Vite configuration
│   └── tailwind.config.js       # Tailwind configuration
│
├── src/                          # Python backend application
│   ├── api/
│   │   └── routes/
│   │       └── analyze.py       # Main analyze endpoint
│   ├── services/                 # Business logic
│   │   ├── vcf_parser.py       # VCF file parsing
│   │   ├── rules_engine.py      # Risk calculation
│   │   ├── evidence_scorer.py   # Evidence scoring
│   │   ├── interaction_checker.py # Drug interactions
│   │   ├── llm_client.py        # Gemini API client
│   │   └── clinical_modifiers.py # Clinical logic
│   ├── models/                   # Data models
│   │   └── schemas.py           # Pydantic schemas
│   ├── core/                     # Core configuration
│   │   └── config.py            # Settings management
│   ├── utils/                    # Utility functions
│   └── main.py                   # FastAPI app initialization
│
├── tests/                        # Test suite
│   └── test_analysis.py         # Integration tests
│
├── sample_data/                  # Example data
│   └── *.vcf                    # Sample VCF files
│
├── .env                         # Environment variables (create this)
├── .gitignore                   # Git ignore rules
├── requirements.txt             # Python dependencies
├── README.md                    # This file
├── SRS_Report.md               # Detailed specification
├── USER_FLOW_DIAGRAM.md        # User flow diagrams
└── LINKEDIN_PROJECT_SUMMARY.md # Project overview
```

---

## 👨‍💻 Development Guide

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src tests/

# Run specific test file
pytest tests/test_analysis.py
```

### Code Style

```bash
# Format code with black (if installed)
black src/ frontend/src

# Lint with pylint (if installed)
pylint src/
```

### Adding New Features

1. **Backend:** Add endpoint in `src/api/routes/`
2. **Frontend:** Create component in `frontend/src/components/`
3. **Tests:** Add tests in `tests/`
4. **Documentation:** Update relevant docs

### Common Development Tasks

```bash
# Install new Python package
pip install package-name
pip freeze > requirements.txt

# Install new frontend package
cd frontend
npm install package-name
npm install --save-dev package-name  # for dev-only

# Update all dependencies
cd frontend && npm update && cd ..
pip install --upgrade -r requirements.txt
```

---

## Troubleshooting

### Backend Issues

**Issue: "ModuleNotFoundError: No module named 'fastapi'"**

```bash
# Solution: Install dependencies
pip install -r requirements.txt
```

**Issue: "GEMINI_API_KEY not configured"**

```bash
# Solution: Add to .env file
GEMINI_API_KEY=your-api-key-here
```

**Issue: Port 8000 already in use**

```bash
# Solution: Use different port
python -m uvicorn src.main:app --port 8001
```

### Frontend Issues

**Issue: "npm: command not found"**

```bash
# Solution: Install Node.js from https://nodejs.org/
node --version  # verify installation
```

**Issue: "Module not found" errors**

```bash
# Solution: Reinstall node_modules
rm -rf node_modules package-lock.json
npm install
```

**Issue: Port 5173 already in use**

```bash
# Solution: Use different port
npm run dev -- --port 3000
```

### Common Issues

| Issue                   | Solution                                                    |
| ----------------------- | ----------------------------------------------------------- |
| API 404 error           | Check API endpoint URL and backend running                  |
| File upload fails       | Ensure VCF file format is valid                             |
| No results displayed    | Check browser console for errors; verify .env config        |
| LLM explanation missing | Check GEMINI_API_KEY configuration; API may be rate-limited |

---

## Documentation

Comprehensive documentation is available:

- **[SRS Report](./SRS_Report.md)** - Complete system specification (14 sections)
- **[User Flow Diagrams](./USER_FLOW_DIAGRAM.md)** - Visual user workflows (10 diagrams)

---

## Support & Contact

- **Phone:** 9561508316
- **Email:** parthdheerajpatil@gmail.com

---

## Acknowledgments

- Enjoyed working with Parth, Sarthak and Ojas
- Thank You, RIFT 2026 for providing such a wonderful and wholesome experience.
