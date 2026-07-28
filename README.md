# Bid Analyzer

Bid Analyzer is a local-first FastAPI web app for OpenRTB traffic inspection. It accepts bid requests and bid responses from raw text, uploaded files, or public URLs, then applies OpenRTB-aware parsing and rule-based analysis to explain what the payload means in practical terms.

This project is not a JSON prettifier. It aims to understand common OpenRTB 2.x request and response structure, especially real-world 2.5 and 2.6-style traffic, including:

- Request vs response detection
- App vs site inventory detection
- Banner, video, audio, native, and mixed format detection
- CTV-style signal scoring
- Auction model and deal-path interpretation
- Practical version inference for 2.5-compatible vs 2.6-aligned traffic
- Request vs response comparison checks
- Human-readable and interview-ready explanations

## Tech Stack

- Backend: FastAPI
- Frontend: Jinja-rendered HTML, plain CSS, plain JavaScript
- Local runtime: `uvicorn`

## Project Structure

```text
app/
  main.py
  models/
    schemas.py
  routes/
    analyze.py
    web.py
  services/
    comparison_engine.py
    explanation_engine.py
    helpers.py
    input_normalizer.py
    json_parser.py
    request_analyzer.py
    request_workflow.py
    response_analyzer.py
    rules_engine.py
    type_detector.py
    url_fetcher.py
  sample_data/
    sample_request_audio.json
    sample_request_banner.json
    sample_request_ctv.json
    sample_request_native.json
    sample_response_ctv.json
    sample_response_nobid.json
  static/
    app.js
    styles.css
  templates/
    index.html
requirements.txt
README.md
```

## Install and Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open the app at [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Main Features

- Two-panel workflow for bid request and bid response inputs
- Input methods:
  - Paste raw JSON or request body text
  - Upload file
  - Fetch from public URL
  - Load included sample payloads
- Result tabs:
  - Overview
  - Request Summary
  - Response Summary
  - Request Type Detection
  - Request vs Response Check
  - Human Explanation
  - OpenRTB Interpretation
  - Warnings / Errors
  - Raw Parsed Fields
  - Interview Explanation
- Export tools:
  - Copy readable report
  - Export HTML report
  - Export JSON report

## API Endpoints

- `POST /analyze/request`
- `POST /analyze/response`
- `POST /analyze/compare`
- `POST /fetch/url`
- `GET /samples`
- `GET /health`

## Notes on the Rules Engine

The analyzer uses practical heuristics rather than pretending to know the exact exchange flavor of every payload. Examples:

- CTV scoring combines app presence, video structure, user-agent markers, device type, and pod metadata.
- Version inference is best-effort. Pod and duration-floor fields are treated as stronger 2.6-style signals.
- Response comparison checks impression id mapping, floor compliance, deal matching, pod alignment, and dimension consistency where possible.

## Sample Files Included

- `sample_request_ctv.json`
- `sample_response_ctv.json`
- `sample_request_banner.json`
- `sample_response_nobid.json`
- `sample_request_audio.json`
- `sample_request_native.json`

## Extending the App

Good next steps for expansion:

- Batch log processing
- More enum coverage across OpenRTB objects
- Exchange-specific adapters
- Header-aware authenticated URL fetches
- Gzip or binary log ingestion workflows
- Report persistence and history
