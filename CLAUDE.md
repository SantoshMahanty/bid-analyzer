# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Bid Analyzer is a local FastAPI web app that parses OpenRTB 2.5/2.6 bid request and bid response JSON and explains it in plain English: device/format decoding, CTV confidence scoring, 40+ spec validation rules, request-vs-response comparison, and batch log analysis. No database, no API keys, no frontend build step. The README is a full learning-oriented guide to the codebase (including the CTV scoring math, version-detection heuristics, and API reference) — keep it in sync when changing behavior it documents.

## Commands

Run everything from the repository root — `app/main.py` and `app/routes/analyze.py` reference `app/static` and `app/sample_data` as relative paths, so the server and tests break if started elsewhere.

```bash
pip install -r requirements.txt              # runtime dependencies
python -m uvicorn app.main:app --reload      # dev server at http://127.0.0.1:8000
python -m pytest                             # run all tests (53 tests in app/tests/)
python -m pytest app/tests/test_openrtb_2_6.py                     # one file
python -m pytest app/tests/test_batch.py -k test_jsonl             # one test by keyword
```

`pytest` is not in `requirements.txt` — install it separately (`pip install pytest`). Tests are written with `unittest.TestCase` (some use `subTest`), so `python -m unittest discover -s app/tests` also works, but pytest is the documented runner.

Useful endpoints while developing: `/health` (liveness check), `/docs` (auto-generated OpenAPI UI), `/samples` (bundled payloads from `app/sample_data/`).

## Architecture

Three layers, with a strict rule: **the services layer (`app/services/`) has no web-framework coupling** beyond accepting FastAPI's `UploadFile` in the input pipeline. Analysis functions are plain functions callable without a server.

```
routes (HTTP)  →  request_workflow.analyze_input()  →  services (engines)
```

- **`app/routes/analyze.py`** — the API: `POST /analyze/{request,response,batch}` accept multipart form fields (`raw_text`, `source_url`, optional `file`); `POST /analyze/compare` and `POST /fetch/url` take JSON bodies. `app/routes/web.py` serves the Jinja2 pages and injects an `asset_v` timestamp into script/link tags for cache busting.
- **`app/services/request_workflow.py`** — the single-payload pipeline coordinator: `normalize_input` → `parse_json_payload` → `analyze_request` or `analyze_response`. Batch mode has its own coordinator in `batch_processor.py`; comparison goes directly to `comparison_engine.py`.
- **`app/services/input_normalizer.py`** — turns raw text / file upload / URL into one normalized string. Input priority when multiple are given: raw text > file > URL. Handles gzip (magic-byte sniff) and capped chunked reads (`MAX_UPLOAD_BYTES` = 5 MB — oversized uploads are rejected without buffering the whole file).
- **`app/services/json_parser.py`** — parses and auto-classifies payloads as `bid_request` vs `bid_response` (a mode/type mismatch produces a warning, not an error).
- **Engines** — `type_detector.py` (CTV score out of 14, format/environment/version heuristics), `rules_engine.py` (OpenRTB enum-code → label tables), `request_analyzer.py` / `response_analyzer.py` (spec validation; internal `_request_warnings` / `_response_warnings` are tested directly), `comparison_engine.py` (impid matching, floor compliance, `badv`/`bcat`/`bapp` blocklists — domain matching is suffix-based, categories match hierarchically), `explanation_engine.py` (human-readable sentences).
- **`app/models/schemas.py`** — Pydantic v2 models. `AnalysisResult` is the contract with the frontend; routes return `result.model_dump()`.
- **`app/services/helpers.py`** — always use these for payload access: `get_nested(d, "device.geo.country")`, `ensure_list`, `coerce_int`/`coerce_float`, `has_value`. Real-world auction data is dirty (numbers as strings, scalars where lists belong); direct dict access is how this codebase crashes.

`docs/openrtb_2_6_extracted.txt` is the extracted OpenRTB 2.6 spec text — check it before adding or changing validation rules.

## Frontend

Vanilla JS (`app/static/app.js`, ~1,600 lines) + vanilla CSS (`app/static/styles.css`, ~1,900 lines), no build step. Conventions that matter when editing:

- **Theming is token-based.** `:root` in `styles.css` carries the dark palette (default); `html[data-theme="light"]` overrides the *tokens*, never the consuming rules. An inline script in `index.html` stamps `data-theme` before first paint. Brand washes go through `--primary-tint` / `--primary-tint-soft`, and white-on-brand text uses `--primary-solid` — don't hardcode `rgba(...)` or put white text on `--primary`. Every text/background pair in both themes must meet WCAG AA.
- **Result-rendering primitives stay in `styles.css`** (§12: `.r-table`, `.stat-tile`, `.verdict-banner`, `.status-card`, `.dist-*`, `.hero-card`). `displayResults()` in `app.js` builds DOM against these classes; inline styles would not follow the theme.
- **Icons** come from a single inline SVG sprite in `index.html`, referenced with `<use>` — add new icons to the sprite, don't inline separate SVGs.
- Result tabs are relevance-filtered per run mode via `setRelevantTabs()` (e.g. a request-only analysis shows 7 of 10 tabs); new panels must be wired into that mapping.

## Security constraints

Two protections have dedicated tests (`test_security.py`) — preserve them when touching input paths:

- **SSRF guard** in `url_fetcher.py`: resolves DNS and rejects private/loopback/link-local/reserved targets (including IPv6-mapped IPv4), and follows redirects *by hand* so every hop is re-checked. Don't switch to httpx auto-redirects.
- **Upload cap**: 5 MB enforced during chunked reading in `input_normalizer.py`.

## Code conventions

- Every Python module starts with `from __future__ import annotations`; modern typing (`X | None`, built-in generics) plus `Optional`/`Dict`/`List` in older files — match the file you're in.
- Services report problems as `warnings`/`errors` lists on result models rather than raising; user-facing messages are full plain-English sentences (the app's whole point is friendly explanations).
- Errors are spec violations; warnings are best-practice/addressability issues — keep new validation rules on the right side of that line.
