# 📊 Bid Analyzer — OpenRTB Inspector

> **A simple, beginner-friendly guide to understanding automated ad auctions, OpenRTB payloads, and the complete codebase of Bid Analyzer.**

Welcome! Whether you are a computer science student, a junior developer, or an ad tech professional, this documentation is written so you can easily understand **what this project does**, **why it exists**, **how the advertising auction system works**, and **every detail of the underlying Python & JavaScript code**.

---

## 📚 Table of Contents

1. [What is this project? (In simple terms)](#1-what-is-this-project-in-simple-terms)
2. [Background: How Online Ad Auctions Work](#2-background-how-online-ad-auctions-work)
3. [The Problem & The Solution](#3-the-problem--the-solution)
4. [Tech Stack & Architecture Overview](#4-tech-stack--architecture-overview)
5. [Step-by-Step Installation & Quick Start](#5-step-by-step-installation--quick-start)
6. [Project Folder & File Structure](#6-project-folder--file-structure)
7. [Deep-Dive into the Code (Module by Module)](#7-deep-dive-into-the-code-module-by-module)
   - [7.1 HTTP Layer (`app/routes/`)](#71-http-layer-approutes)
   - [7.2 Data Models (`app/models/schemas.py`)](#72-data-models-appmodelsschemaspy)
   - [7.3 Services Layer (`app/services/`)](#73-services-layer-appservices)
   - [7.4 Frontend UI (`app/static/` & `app/templates/`)](#74-frontend-ui-appstatic--apptemplates)
8. [Inside the Analysis Engines](#8-inside-the-analysis-engines)
   - [8.1 How CTV Scoring Works (The Math)](#81-how-ctv-scoring-works-the-math)
   - [8.2 OpenRTB Version Detection](#82-openrtb-version-detection)
   - [8.3 The Rules & Validation Engine](#83-the-rules--validation-engine)
   - [8.4 The Comparison Engine (Matching Request vs Response)](#84-the-comparison-engine-matching-request-vs-response)
9. [API Endpoint Reference](#9-api-endpoint-reference)
10. [Automated Testing & Quality Assurance](#10-automated-testing--quality-assurance)
11. [Glossary of Important Terms](#11-glossary-of-important-terms)
12. [Security, Limitations & Future Enhancements](#12-security-limitations--future-enhancements)

---

## 1. What is this project? (In simple terms)

Imagine you open a mobile app like Spotify or turn on a smart TV app like Roku. Before a video ad or banner appears on your screen, computers perform an auction in less than **100 milliseconds** (a tenth of a second!) to decide which ad to show you and how much the advertiser will pay.

These auctions happen using structured messages formatted as **JSON** (JavaScript Object Notation):
- **Bid Request**: *"Hey advertisers! I have a Smart TV in Chicago streaming a movie. Who wants to show a 30-second video ad? Minimum price is $15.00."*
- **Bid Response**: *"I'll buy it for $18.50! Here is my video ad link."*

Normally, these JSON files are huge, highly nested, and full of numeric codes (`devicetype: 3`, `at: 1`, `nbr: 2`). Staring at raw JSON code makes it very hard to see what is happening.

**Bid Analyzer is a web app that translates those JSON messages into plain English.** It tells you:
- What device is being used (Phone, Laptop, Smart TV).
- Whether the ad format is Banner, Video, Audio, or Native.
- If there are any missing required fields or spec errors.
- If a DSP's bid answered the request correctly (Did it bid high enough? Is the ad category blocked?).

---

## 2. Background: How Online Ad Auctions Work

To understand this app, you only need to know 4 key players:

### The 4 Key Players in Ad Tech

| Player | Role | Everyday Analogy |
|---|---|---|
| **Publisher** | The app/website with space for ads | A newspaper or shop window |
| **SSP (Supply-Side Platform)** | Software that sells ad space for publishers | The auction house / auctioneer |
| **DSP (Demand-Side Platform)** | Software that bids on behalf of advertisers | The bidder in the auction room |
| **Advertiser** | The company that wants to show their ad (e.g., Nike, Coca-Cola) | The brand buying the window space |

### The 100-Millisecond Lifecycle

```
[User opens app] ──► [Publisher SDK] ──► [SSP builds Bid Request JSON]
                                                  │
                                                  ▼ (Sent over HTTP POST)
                                         [DSPs review request]
                                                  │
                                                  ▼ (Replies within tmax ~100ms)
                                         [DSP builds Bid Response JSON]
                                                  │
                                                  ▼
[Ad renders on user screen] ◄── [SSP picks winning highest bid]
```

### OpenRTB Standard
**OpenRTB** is the industry standard specification published by the **IAB Tech Lab** so that any SSP can talk to any DSP using the exact same JSON format. This project supports **OpenRTB 2.5 and 2.6**.

---

## 3. The Problem & The Solution

### The Problem
Ad Tech engineers and ad operations teams spend hours manually inspecting JSON logs trying to answer:
1. *"Why did our bid get rejected by the publisher?"*
2. *"Is this traffic actually coming from a Connected TV (CTV) or a fake bot?"*
3. *"Which required field did the exchange forget to send us?"*

A simple JSON prettifier only adds indentation — it doesn't explain what numeric codes mean or validate industry rules.

### The Solution
**Bid Analyzer automates payload inspection.** It parses the JSON, applies real-world business logic, scores device types, detects version compatibility, cross-checks bid prices against floor prices, and explains every single field in human-readable language.

---

## 4. Tech Stack & Architecture Overview

The app was designed with **zero unnecessary complexity**: no external database, no complex frameworks, no API key requirements, and no build tools.

```
       ┌──────────────────────────────────────────────────────────┐
       │                   Browser UI (Frontend)                  │
       │     HTML5 + CSS Variables + Vanilla JS (app.js)          │
       └────────────────────────────┬─────────────────────────────┘
                                    │ HTTP API Calls (Fetch API)
                                    ▼
       ┌──────────────────────────────────────────────────────────┐
       │                   FastAPI Server (Backend)               │
       │                   app/main.py & app/routes/              │
       └────────────────────────────┬─────────────────────────────┘
                                    │ Calls Python Functions
                                    ▼
       ┌──────────────────────────────────────────────────────────┐
       │                     Services Layer                       │
       │  • Normalizer  • Parser  • Type Detector  • Rules Engine  │
       │  • Request Analyzer  • Response Analyzer  • Compare      │
       └──────────────────────────────────────────────────────────┘
```

### Technology Breakdown

- **Backend**: Python 3.10+ with [FastAPI](https://fastapi.tiangolo.com/) for high-performance async routing and automatic OpenAPI documentation.
- **Server**: [Uvicorn](https://www.uvicorn.org/) (ASGI web server).
- **Data Validation**: [Pydantic v2](https://docs.pydantic.dev/) for data schema typing.
- **Frontend**: Plain HTML, CSS custom properties (variables), and Vanilla JavaScript (`app.js`).
- **Testing**: Python standard `unittest` framework executed via `pytest`.

---

## 5. Step-by-Step Installation & Quick Start

### 1. Prerequisite
Ensure you have **Python 3.10 or newer** installed:
```bash
python --version
```

### 2. Navigate to Project Directory
```bash
cd "path/to/bid analyzer"
```

### 3. Create & Activate a Virtual Environment
A virtual environment keeps project dependencies isolated.

* **Windows (PowerShell)**:
  ```powershell
  python -m venv venv
  .\venv\Scripts\Activate.ps1
  ```
* **macOS / Linux**:
  ```bash
  python3 -m venv venv
  source venv/bin/activate
  ```

### 4. Install Dependencies
```bash
pip install -r requirements.txt
```

### 5. Run the Server
```bash
python -m uvicorn app.main:app --reload
```

### 6. Open in Browser
Visit **`http://127.0.0.1:8000`** in your browser!

---

## 6. Project Folder & File Structure

Here is how the project files are organized:

```text
bid analyzer/
├── app/
│   ├── main.py                     # Entry point: initializes FastAPI app & routes
│   │
│   ├── models/
│   │   └── schemas.py              # Pydantic data models (defines response JSON shapes)
│   │
│   ├── routes/                     # HTTP API endpoints
│   │   ├── analyze.py              # POST /analyze/* API endpoints
│   │   └── web.py                  # GET / and GET /tutorial web pages
│   │
│   ├── services/                   # Core business logic & engines
│   │   ├── request_workflow.py     # Main coordinator function (analyze_input)
│   │   ├── input_normalizer.py     # Cleans raw text, handles files, URLs, Gzip
│   │   ├── json_parser.py          # Safely parses JSON & detects request vs response
│   │   ├── type_detector.py        # Scores CTV likelihood & detects ad formats
│   │   ├── rules_engine.py         # OpenRTB dictionary tables (enum code -> human text)
│   │   ├── request_analyzer.py     # Inspects bid requests & validates spec rules
│   │   ├── response_analyzer.py    # Inspects bid responses & checks macros
│   │   ├── comparison_engine.py    # Matches request vs response (price, floor, blocklists)
│   │   ├── batch_processor.py      # Analyzes arrays or multi-line JSON log payloads
│   │   ├── explanation_engine.py   # Generates human-readable sentences for fields
│   │   ├── url_fetcher.py          # Safely fetches JSON from external URLs (SSRF protected)
│   │   └── helpers.py              # Safe dictionary access & type conversion utilities
│   │
│   ├── static/
│   │   ├── app.js                  # Frontend UI logic (~1,300 lines of Vanilla JS)
│   │   └── styles.css              # Design system styling & dark/light themes
│   │
│   ├── templates/
│   │   ├── index.html              # Main application web page
│   │   └── tutorial.html           # OpenRTB learning tutorial page
│   │
│   ├── sample_data/                # Bundled example JSON files for testing
│   └── tests/                      # Automated test suite
│       ├── test_openrtb_2_6.py     # Spec validation tests
│       ├── test_robustness.py      # Hostile input & error-handling tests
│       ├── test_blocklists.py      # Domain & category blocking tests
│       ├── test_security.py        # SSRF & upload size security tests
│       └── test_batch.py           # Multi-payload batch processing tests
│
├── requirements.txt                # Python package dependencies
└── README.md                       # Project documentation
```

---

## 7. Deep-Dive into the Code (Module by Module)

Let's examine how each Python service works so you can understand the codebase line by line.

### 7.1 HTTP Layer (`app/routes/`)

- **`app/main.py`**:
  Initializes FastAPI (`app = FastAPI(...)`), mounts the `/static` folder for serving CSS/JS, and includes the routers from `web.py` and `analyze.py`.

- **`app/routes/web.py`**:
  Serves the HTML pages using Jinja2 templates. Injects an `asset_v` cache-busting timestamp into `<script>` and `<link>` tags so browsers never freeze on stale JS/CSS code.

- **`app/routes/analyze.py`**:
  Exposes the REST API endpoints:
  - `POST /analyze/request`: Accepts Form text/file/URL, calls `analyze_input(mode="request")`.
  - `POST /analyze/response`: Accepts Form text/file/URL, calls `analyze_input(mode="response")`.
  - `POST /analyze/compare`: Accepts JSON body with both request and response payloads, returns comparison metrics.
  - `POST /analyze/batch`: Analyzes multi-line JSON logs.
  - `GET /samples`: Reads and returns sample JSON payloads from `app/sample_data/`.

---

### 7.2 Data Models (`app/models/schemas.py`)

This file defines the strict structure of data returned by the backend using Pydantic classes:
- **`AnalysisResult`**: The main payload sent to the frontend containing summary cards, parsed fields, human explanations, warnings, errors, and inferred signals.
- **`ComparisonResult`**: Contains the pass/warn/fail status of cross-checking a bid response against a bid request.
- **`BatchResult`**: Holds metrics and aggregate distributions for batch analysis.

---

### 7.3 Services Layer (`app/services/`)

The services layer is completely decoupled from web framework code. This means you can run analysis functions in a terminal or background job without needing a server!

#### 1. `helpers.py` — Safe Utility Functions
Ad auction data in the real world is notoriously dirty (a number might arrive as a string like `"18.5"`, or a list might arrive as a single string). `helpers.py` provides 4 essential safety tools:
- `get_nested(dict, "device.geo.country")`: Performs dotted lookup without raising `KeyError`.
- `ensure_list(val)`: Wraps single items in a list so loops never crash.
- `coerce_int(val)` & `coerce_float(val)`: Safely converts values to numbers without throwing `ValueError`.
- `has_value(val)`: Returns `True` only if a field contains non-empty, meaningful data.

#### 2. `input_normalizer.py` — Cleaning Raw Inputs
Converts pasted text, file uploads, or URL downloads into a single normalized text string.
- Automatically handles **Gzip decompression** if the raw input starts with magic bytes `\x1f\x8b`.
- Decodes UTF-8 text with fallback error replacement.

#### 3. `json_parser.py` — Parsing & Auto-Classification
- Converts JSON text into Python dictionaries using `json.loads()`.
- Captures line and column numbers on syntax errors to give helpful error messages to users.
- Automatically detects whether a payload is a **Bid Request** (has `imp`, `app`, `site`) or a **Bid Response** (has `seatbid`, `nbr`, `bidid`).

#### 4. `type_detector.py` — Intelligence & Heuristics
Contains the core intelligence algorithms:
- **CTV Scoring**: Calculates a Connected TV score out of 14 points (see [Section 8.1](#81-how-ctv-scoring-works-the-math)).
- **Ad Format Detection**: Determines whether an impression is `banner`, `video`, `audio`, `native`, or `mixed`.
- **Environment Detection**: Detects `mobile_app`, `web`, `dooh`, or `ctv_app`.
- **Version Guessing**: Evaluates whether a payload uses OpenRTB 2.5 fields or modern OpenRTB 2.6 fields (like `poddur`, `rqddurs`, `plcmt`).

#### 5. `rules_engine.py` — Dictionary Decoders
Translates raw spec integer codes into human labels:
- `device_type_label(3)` ➔ `"connected TV"`
- `auction_type_label(1)` ➔ `"first-price auction"`
- `no_bid_reason_label(2)` ➔ `"Unmatched User / Unknown Cookie"`

#### 6. `request_analyzer.py` & `response_analyzer.py` — Spec Validation
- Extracts key OpenRTB fields.
- Checks over **40 spec rules** for errors (e.g., missing required impression IDs, invalid price values, conflicting video parameters) and warnings (e.g., missing user-agent, missing geo location, deprecated hashed device IDs).
- Evaluates macro placeholders like `${AUCTION_PRICE}`.

#### 7. `comparison_engine.py` — Cross-Checking Request vs Response
- Matches bid response items (`impid`) against bid request impressions (`imp.id`).
- Checks if the bid price satisfies the minimum `bidfloor`.
- Cross-references blocked advertiser domains (`badv`), blocked IAB categories (`bcat`), and blocked app bundles (`bapp`).

---

### 7.4 Frontend UI (`app/static/` & `app/templates/`)

- **`templates/index.html`**:
  Clean HTML5 layout featuring:
  - Header with theme toggle and tutorial link.
  - Mode selector (`Request`, `Response`, `Compare`, `Batch`).
  - Code Editor panel with line numbers and toolbar actions (`Prettify`, `Copy`, `Clear`).
  - Results view featuring KPI Dashboard cards and tabbed navigation (`Overview`, `Insights`, `Request`, `Response`, `Compare`, `Signals`, `Cheatsheet`, `Warnings`, `Raw`).

- **`static/styles.css`**:
  Vanilla CSS featuring a custom **Design System**:
  - CSS custom properties for both themes. `:root` carries the dark palette
    (the default), and `html[data-theme="light"]` overrides it. An inline
    script in `index.html` stamps `data-theme` before first paint so a
    light-preference machine does not flash dark.
  - Light mode overrides the *tokens* rather than the rules that consume
    them — redefining `--primary-light` and `--accent-cyan` fixes every
    consumer at once, instead of duplicating each selector.
  - Dark surface steps (`--bg-app` → `--surface` → `--surface-alt`) are
    spaced ~9 CIE L\* apart so cards visibly lift off the page.
  - Burnt-orange brand palette over warm brown surfaces (dark) and warm cream
    (light). Orange is a light hue, so accent duty and fill duty are split:
    `--primary` tints borders and icons, while `--primary-solid` is the darker
    shade used wherever white text sits on top. Translucent brand washes go
    through `--primary-tint` / `--primary-tint-soft` rather than hardcoded
    `rgba(...)` call sites.
  - Every text/background pair in both themes meets WCAG AA (4.5:1 for body
    text, 3:1 for large text), including the tinted status surfaces and the
    two Overview hero gradients.
  - **Fixed workspace (§5b, ≥1181px)**: the input and results panels are one
    viewport-sized workspace of two equal-height boxes. Each scrolls
    internally, so pasting a large payload never grows the page or makes one
    panel taller than the other. Sized purely by nested flex (`.app` → `.main`
    → `.content`), so there is no magic offset to keep in sync; below 1181px
    the panels stack and return to normal document flow.
  - Translucent status badges (`rgba(...)`) for clean visual feedback.
  - Responsive flexbox and grid layouts, plus a `prefers-reduced-motion`
    block that disables transitions and the animated background mesh.
  - **Result-rendering primitives** (§12: `.r-table`, `.stat-tile`,
    `.verdict-banner`, `.status-card`, `.dist-*`, `.hero-card`) are consumed
    by `displayResults()` in `app.js`. They must stay in this file — as
    inline styles they would not follow the theme.

- **`static/app.js`**:
  Handles state management and interactive behavior:
  - `switchMode()`: Handles mode tab switching without losing user text inputs, and updates the one-line mode hint in the selector bar.
  - `analyzeAll()`: Sends async POST requests to the FastAPI backend.
  - `displayResults()`: Dynamically builds KPI metric cards, tabs, warning counters, and raw JSON views using vanilla DOM manipulation.
  - `setRelevantTabs()`: Hides result tabs the current run cannot fill (e.g. a request-only analysis shows 7 of the 10 tabs, batch shows 4), so the tab strip fits without horizontal scrolling.
  - `setupDragDrop()`: Makes every editor (request, response, both compare panes, batch) a drop target with a "Drop file to load" overlay.
  - `syncHeaderOffset()`: Measures the sticky header and publishes it as `--header-h`, which the sticky results tab strip offsets against.
  - Each editor is a single stack: source strip (samples / URL / batch options) → toolbar → line-numbered code area → live JSON status bar showing validity, line count and payload size.

---

## 8. Inside the Analysis Engines

### 8.1 How CTV Scoring Works (The Math)

Connected TV (CTV) traffic is high-value inventory. Because OpenRTB doesn't have a single "is_ctv" boolean, the app evaluates **6 distinct signals** to compute a score out of **14 points**:

| Signal Evaluated | Points | Why this signal matters |
|---|---:|---|
| **User Agent String** contains `roku`, `tizen`, `webos`, `android tv`, `fire tv`, `appletv`, `smarttv` | **3 pts** | TV user agents are explicit and hard to fake. |
| **`device.devicetype`** is `3` (CTV), `6` (Connected Device), or `7` (Set-top Box) | **3 pts** | Publisher explicitly declared a TV device type. |
| **`app` object** present | **2 pts** | Connected TVs operate via streaming apps, not web browsers. |
| **`video` object** present | **2 pts** | TV ad inventory is exclusively video/audio. |
| **Ad Pod fields** (`poddur`, `podid`, `podseq`, `slotinpod`) present | **2 pts** | Ad pods represent commercial breaks, a TV-specific concept. |
| **Second-based pricing** (`mincpmpersec`, `durfloors`) present | **2 pts** | Pricing by video second is standard in CTV. |

#### Verdict Scale:
- **6 to 14 points** ➔ **Likely CTV**
- **3 to 5 points** ➔ **Maybe CTV**
- **0 to 2 points** ➔ **Unlikely CTV**

---

### 8.2 OpenRTB Version Detection

OpenRTB payloads rarely state their version explicitly. The analyzer evaluates the presence of OpenRTB 2.6 features:

- If **3+ modern fields** (`poddur`, `rqddurs`, `plcmt`, `slotinpod`) exist ➔ **Likely OpenRTB 2.6-aligned (High Confidence)**.
- If **1–2 modern fields** exist ➔ **Likely OpenRTB 2.6-aligned (Medium Confidence)**.
- If impressions exist without 2.6 fields ➔ **Likely OpenRTB 2.5-compatible**.

---

### 8.3 The Rules & Validation Engine

Validation checks are divided into two distinct severities:

1. **Errors (Spec Violations)**:
   - Request missing the `imp` array.
   - `bidfloor` is not a valid number.
   - Response bid has no price or `impid`.
   - Video object mixes `rqddurs` (exact durations) with `minduration`/`maxduration` (illegal in OpenRTB 2.6).

2. **Warnings (Best Practices & Addressability Risks)**:
   - Missing `device` object or user-agent (`ua`).
   - Hashed device IDs (`didsha1`, `macmd5`) used instead of modern resettable IDs (`ifa`).
   - Missing geolocation (`device.geo`).
   - Both `keywords` (string) and `kwarray` (list) populated on the same object.

---

### 8.4 The Comparison Engine (Matching Request vs Response)

When comparing a Bid Request against a Bid Response, the comparison engine runs 15 targeted checks:

```python
# Simplified Logic Example from comparison_engine.py
if bid_price < bid_floor:
    return CheckResult(
        status="FAIL", 
        label="Floor compliance", 
        message=f"Bid price ${bid_price} is below required floor ${bid_floor}"
    )
```

#### Key Checks Executed:
1. **Auction ID Match**: Does `response.id` echo `request.id`?
2. **Impression ID (`impid`) Match**: Does the bid point to a valid impression ID in the request?
3. **Floor Compliance**: Is `bid.price` $\ge$ `imp.bidfloor`?
4. **Advertiser Blocklist (`badv`)**: Is the bid's advertiser domain listed in the request's blocked domain list? (e.g., `ads.ford.com` correctly matches blocked domain `ford.com`).
5. **Category Blocklist (`bcat`)**: Is the bid's IAB category blocked? (e.g., Category `IAB25-3` is matched hierarchically against blocked category `IAB25`).

---

## 9. API Endpoint Reference

FastAPI automatically generates interactive OpenAPI documentation at **`http://127.0.0.1:8000/docs`**.

### Summary of Routes

| HTTP Method | Endpoint Path | Description | Request Type |
|---|---|---|---|
| `POST` | `/analyze/request` | Analyzes a single OpenRTB Bid Request | `Multipart Form` |
| `POST` | `/analyze/response` | Analyzes a single OpenRTB Bid Response | `Multipart Form` |
| `POST` | `/analyze/compare` | Compares a Request payload against a Response payload | `JSON Body` |
| `POST` | `/analyze/batch` | Analyzes multi-line JSON or array log payloads | `Multipart Form` |
| `POST` | `/fetch/url` | Safely fetches JSON content from a public URL | `JSON Body` |
| `GET` | `/samples` | Returns bundled example JSON payloads | `None` |
| `GET` | `/health` | Healthcheck endpoint (`{"status": "ok"}`) | `None` |

---

## 10. Automated Testing & Quality Assurance

The project includes an automated test suite located in `app/tests/`.

### Running Tests
Execute the tests using pytest:
```bash
python -m pytest
```

### Test Suites Included:
- **`test_openrtb_2_6.py`**: Validates OpenRTB 2.6 spec conformance rules.
- **`test_robustness.py`**: Hostile input testing (feeds broken/malformed payloads to verify the app throws friendly warnings instead of crashing).
- **`test_blocklists.py`**: Tests domain (`badv`), category (`bcat`), and app (`bapp`) blocklist matching logic.
- **`test_security.py`**: Verifies SSRF protection on internal IP ranges (`127.0.0.1`, `169.254.169.254`) and file upload size caps.
- **`test_batch.py`**: Tests multi-payload array and JSONL log parsing.

---

## 11. Glossary of Important Terms

- **RTB (Real-Time Bidding)**: Buying and selling ad impressions via automated sub-100ms auctions.
- **OpenRTB**: The standardized protocol for RTB auctions created by IAB Tech Lab.
- **SSP (Supply-Side Platform)**: System used by publishers to sell ad inventory.
- **DSP (Demand-Side Platform)**: System used by advertisers to purchase ad inventory.
- **CPM (Cost Per Mille)**: Price per 1,000 ad impressions (e.g., $15.00 CPM = $0.015 per ad).
- **Bid Floor**: Minimum CPM price acceptable for an impression.
- **CTV (Connected TV)**: Smart TVs and streaming devices (Roku, Fire TV, Apple TV).
- **Ad Pod**: A commercial break containing multiple back-to-back ads.
- **PMP (Private Marketplace)**: An invitation-only private ad auction with pre-negotiated deal rates (`dealid`).
- **VAST (Video Ad Serving Template)**: XML standard for delivering video ad creatives.

---

## 12. Security, Limitations & Future Enhancements

### Security Features
1. **SSRF Guard**: [url_fetcher.py](app/services/url_fetcher.py) blocks URL fetching from private/loopback IP ranges (`127.0.0.0/8`, `10.0.0.0/8`, `192.168.0.0/16`, AWS metadata `169.254.169.254`).
2. **File Size Limit**: Uploads are restricted to 5 MB (`MAX_UPLOAD_BYTES`) to prevent memory exhaustion.

### Limitations
- Supports OpenRTB **2.5 and 2.6** (OpenRTB 3.0 uses a different structure called AdCOM).
- Designed primarily for local execution on `127.0.0.1`.

### Future Ideas to Explore
- **VAST XML Inspector**: Parse VAST XML creative strings inside `bid.adm` to validate video bitrates and tracking pixels.
- **Side-by-Side Request Diff Tool**: Compare two bid requests to highlight what changed between software releases.
- **CLI Tool**: Package `analyze_input` into a terminal command-line tool.

---

*Happy Analyzing! If you have any questions or ideas for improvements, explore the source code in `app/services/`!*
