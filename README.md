# Bid Analyzer

**A local web app that reads OpenRTB bid requests and bid responses and explains them in plain English.**

You paste a blob of advertising JSON into the browser, click **Analyze**, and the app tells you what kind of ad opportunity it is, whether the data is valid, what is missing, and — if you give it both sides — whether the bid actually answered the request correctly.

Built with Python (FastAPI) on the backend and plain HTML/CSS/JavaScript on the frontend. No database, no cloud services, no API keys. It runs entirely on your own machine.

---

## Table of Contents

1. [The problem this solves](#1-the-problem-this-solves)
2. [Background: what is OpenRTB?](#2-background-what-is-openrtb)
3. [What the app actually does](#3-what-the-app-actually-does)
4. [Tech stack (and why)](#4-tech-stack-and-why)
5. [Getting started](#5-getting-started)
6. [Project structure](#6-project-structure)
7. [How the code works — the pipeline](#7-how-the-code-works--the-pipeline)
8. [Inside the rules engine](#8-inside-the-rules-engine)
9. [The comparison engine](#9-the-comparison-engine)
10. [The user interface, tab by tab](#10-the-user-interface-tab-by-tab)
11. [API reference](#11-api-reference)
12. [Sample data](#12-sample-data)
13. [Running the tests](#13-running-the-tests)
14. [Glossary](#14-glossary)
15. [Limitations and security notes](#15-limitations-and-security-notes)
16. [Ideas for extending the project](#16-ideas-for-extending-the-project)

---

## 1. The problem this solves

Online display ads are bought and sold by computers, in auctions that finish in about 100 milliseconds. Every one of those auctions is a pair of JSON messages: a **bid request** ("here is an ad slot, who wants it?") and a **bid response** ("I do, here is my price and my ad").

If you work in advertising technology, you spend a lot of time staring at those JSON blobs trying to answer questions like:

- Is this a phone, a laptop, or a smart TV?
- Why did my company's bid get rejected?
- Is this a private deal or an open auction?
- Which required fields did the publisher forget to send?

Doing this by eye is slow and error-prone. A single CTV (smart-TV) bid request can be 300 lines of nested JSON, and the meaningful parts are scattered across a dozen objects.

**Bid Analyzer automates the reading.** It is not a JSON prettifier — a prettifier just adds indentation. This app *understands* the fields: it knows that `device.devicetype = 3` means "connected TV", that `at = 1` means "first-price auction", and that a bid of `$18.00` against a floor of `$20.00` will be thrown away.

---

## 2. Background: what is OpenRTB?

You do not need any advertising knowledge to run this project, but the code will make much more sense with ten minutes of context. (The app also ships with a built-in tutorial page at `/tutorial` that covers this in more depth.)

### 2.1 The players

| Player | Role | Everyday analogy |
|---|---|---|
| **Publisher** | Owns the app/website/TV channel with ad space to sell | The shop with a window to rent |
| **SSP / Exchange** | Runs the auction on the publisher's behalf | The auctioneer |
| **DSP** | Bids on behalf of advertisers | The bidder in the room |
| **Advertiser** | Wants their ad shown | The person who wants the window |

### 2.2 The 100-millisecond auction

1. You open a mobile game. There is a blank ad slot on the screen.
2. The publisher's SDK tells the **SSP**: "I have a slot."
3. The SSP builds a **bid request** — a JSON document describing the slot, the device, the app, the user's country, the minimum price — and blasts it to dozens of **DSPs** at once.
4. Each DSP has about 100 ms (the `tmax` field says exactly how long) to decide. It replies with a **bid response**: its price (`price`), the ad markup (`adm`), and which impression it is bidding on (`impid`).
5. The SSP picks the winner, the ad renders, everybody logs the result.

**OpenRTB** is the industry standard — published by the IAB Tech Lab — that defines the exact shape of those two JSON documents, so that hundreds of companies can talk to each other without custom integrations. This project targets OpenRTB **2.5 and 2.6**, the versions in real-world production use today.

### 2.3 A minimal bid request

```json
{
  "id": "req-ctv-001",
  "at": 1,
  "tmax": 120,
  "cur": ["USD"],
  "app": {
    "name": "Living Room TV",
    "bundle": "com.livingroomtv.app"
  },
  "device": {
    "ua": "Roku/DVP-12.0",
    "devicetype": 3
  },
  "imp": [
    {
      "id": "imp-ctv-1",
      "bidfloor": 18.5,
      "video": { "mimes": ["video/mp4"], "podid": "pod-a" }
    }
  ]
}
```

Reading it field by field: auction id `req-ctv-001`, first-price auction (`at: 1`), reply within 120 ms, priced in USD, the inventory is an **app** (not a website) called Living Room TV, running on a **Roku** device (`devicetype: 3` = connected TV), and there is **one impression** available, a **video** slot with a minimum price of **$18.50 CPM**, which belongs to an ad **pod** (a commercial break).

### 2.4 A minimal bid response

```json
{
  "id": "req-ctv-001",
  "cur": "USD",
  "seatbid": [
    {
      "seat": "dsp-seat-1",
      "bid": [
        {
          "id": "bid-1",
          "impid": "imp-ctv-1",
          "price": 24.25,
          "adomain": ["examplebrand.com"],
          "dur": 30
        }
      ]
    }
  ]
}
```

The `id` echoes the request's id so the two can be matched. `impid` points at the specific impression being bid on. `price` is $24.25 CPM — comfortably above the $18.50 floor, so this bid is valid.

**Those two documents are exactly what this app takes as input.**

---

## 3. What the app actually does

Give it a **request** and it will:

- Detect whether the inventory is an **app** or a **website**
- Detect the **ad format** — banner, video, audio, native, or mixed
- Score how likely this is **CTV** (smart-TV) traffic, on a 0–14 scale, and show the reasons
- Read the **auction model** (first-price vs second-price) and the **deal path** (open auction, PMP, private auction)
- Guess whether the payload looks **2.5-compatible** or **2.6-aligned**
- Run ~40 validation checks and list **warnings** (bad practice) and **errors** (spec violations)
- Write plain-English **explanations**, field by field
- Produce a short **cheatsheet** you could use in an interview

Give it a **response** and it will:

- Count **seats** and **bids**, and report the price range
- Detect **no-bid** responses and decode the no-bid reason code
- Check every bid for required fields (`id`, `impid`, `price`, `adomain`, and render markup)
- Validate **substitution macros** such as `${AUCTION_PRICE}` and flag legacy or malformed forms

Give it **both** and it will additionally cross-check the two against each other — the most useful part of the tool, covered in [section 9](#9-the-comparison-engine).

Everything can then be exported as **JSON, CSV, HTML, or PDF**, or copied to the clipboard.

---

## 4. Tech stack (and why)

| Layer | Choice | Why this choice |
|---|---|---|
| Web framework | **FastAPI** | Modern async Python framework. Gives automatic interactive API docs at `/docs` for free. |
| Server | **Uvicorn** | The ASGI server that actually runs FastAPI. `--reload` restarts on file save. |
| Data validation | **Pydantic** (via FastAPI) | Defines the response shapes in [schemas.py](app/models/schemas.py) as typed Python classes. |
| Templating | **Jinja2** | Renders `index.html` server-side (used only to inject a cache-busting version string). |
| HTTP client | **httpx** | Async HTTP client for the "fetch JSON from a URL" feature. |
| Frontend | **Plain HTML + CSS + JavaScript** | No React, no build step, no `npm install`. Open the file, read the code, refresh the browser. |
| Tests | **unittest** (run via pytest) | Standard library — nothing extra to learn. |

The deliberate theme here is **no unnecessary machinery**. There is no database (nothing needs to persist), no authentication (it runs on `127.0.0.1`), and no frontend build pipeline. A student can read the entire codebase in an afternoon.

**Requirements:** Python 3.10 or newer (developed on 3.13). The code uses `X | None` union syntax, which needs 3.10+.

---

## 5. Getting started

### 5.1 Clone and enter the project

```bash
cd "path/to/bid analyzer"
```

### 5.2 Create a virtual environment

A virtual environment keeps this project's packages separate from the rest of your system.

**Windows (PowerShell):**

```powershell
python -m venv venv; .\venv\Scripts\Activate.ps1
```

**macOS / Linux:**

```bash
python3 -m venv venv && source venv/bin/activate
```

Your prompt should now start with `(venv)`.

### 5.3 Install dependencies

```bash
pip install -r requirements.txt
```

This installs FastAPI, Uvicorn, Jinja2, httpx, and python-multipart (needed for file uploads). It takes about 30 seconds.

### 5.4 Run the server

```bash
python -m uvicorn app.main:app --reload
```

Decoding that command: `app.main` is the file `app/main.py`, `:app` is the `app = FastAPI(...)` object inside it, and `--reload` makes the server restart automatically whenever you save a file.

You should see:

```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

> **Important:** run this command from the **project root**, not from inside `app/`. The code loads `app/static` and `app/templates` using paths relative to the working directory.

### 5.5 Open it

| URL | What it is |
|---|---|
| <http://127.0.0.1:8000> | The main analyzer UI |
| <http://127.0.0.1:8000/tutorial> | Built-in OpenRTB 2.6 masterclass |
| <http://127.0.0.1:8000/docs> | Auto-generated interactive API docs (FastAPI freebie) |
| <http://127.0.0.1:8000/health> | Health check — returns `{"status":"ok"}` |

### 5.6 Your first analysis (30 seconds)

1. Leave the mode selector on **🔍 Request**.
2. Click the **📋 Samples** tab and pick `sample_request_ctv.json`.
3. Click **▶️ Analyze Now**.

You should see a CTV score of **14 / 14**, the verdict *"likely CTV"*, and the one-line summary:

> *This appears to be an app-based video request with strong CTV signals and pmp available access.*

Now switch to **⚖️ Compare**, load `sample_request_ctv.json` on the left and `sample_response_ctv.json` on the right, and analyze again — you will get an overall **PASS** with six individual checks.

---

## 6. Project structure

```text
bid analyzer/
├── app/
│   ├── main.py                    # Entry point: creates the FastAPI app, wires up routes
│   │
│   ├── models/
│   │   └── schemas.py             # Pydantic data classes — the "shape" of every result
│   │
│   ├── routes/                    # The HTTP layer (URL → function)
│   │   ├── analyze.py             # POST /analyze/*, POST /fetch/url, GET /samples, /health
│   │   └── web.py                 # GET / and GET /tutorial (serve the HTML pages)
│   │
│   ├── services/                  # The brain. All real logic lives here.
│   │   ├── request_workflow.py    # Orchestrator: runs the whole pipeline in order
│   │   ├── input_normalizer.py    # Step 1 — turn text/file/URL into a clean string
│   │   ├── json_parser.py         # Step 2 — parse JSON, guess request vs response
│   │   ├── request_analyzer.py    # Step 3a — analyze + validate a bid request
│   │   ├── response_analyzer.py   # Step 3b — analyze + validate a bid response
│   │   ├── type_detector.py       # CTV scoring, format/environment/deal detection
│   │   ├── rules_engine.py        # OpenRTB lookup tables (enum code → human label)
│   │   ├── explanation_engine.py  # Turns findings into plain-English sentences
│   │   ├── comparison_engine.py   # Cross-checks a request against its response
│   │   ├── url_fetcher.py         # Downloads JSON from a public URL
│   │   └── helpers.py             # Small shared utilities (safe get, type coercion)
│   │
│   ├── static/
│   │   ├── app.js                 # All frontend behaviour (~1,050 lines)
│   │   └── styles.css             # All styling, incl. light/dark themes (~875 lines)
│   │
│   ├── templates/
│   │   ├── index.html             # The analyzer page
│   │   └── tutorial.html          # The OpenRTB learning page
│   │
│   ├── sample_data/               # Six ready-to-use example payloads
│   └── tests/                     # unittest suites
│
├── docs/
│   └── openrtb_2_6_extracted.txt  # Reference text from the OpenRTB 2.6 spec
│
├── requirements.txt
└── README.md
```

### Why the services layer is separate

Notice that `routes/` contains almost no logic — `analyze.py` is only ~75 lines and mostly just forwards arguments. All the thinking happens in `services/`.

This separation is deliberate and worth internalising as a design habit:

- **The logic is testable without a web server.** Look at [test_robustness.py](app/tests/test_robustness.py) — it imports `_request_warnings` directly and calls it with a plain dictionary. No HTTP, no mocking, no fixtures.
- **The logic is reusable.** If you later want a command-line version, or a batch log processor, you import `analyze_request` and you are done. Nothing has to be rewritten.
- **Each file has one job.** When a CTV score looks wrong, you know to open `type_detector.py` — you do not have to search the codebase.

---

## 7. How the code works — the pipeline

This is the most useful section if you want to understand or modify the project. Follow one bid request from browser to result.

```
Browser (app.js)
    │  POST /analyze/request   (multipart form: raw_text / file / source_url)
    ▼
routes/analyze.py  ──►  services/request_workflow.py :: analyze_input()
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
  1. normalize_input()        2. parse_json_payload()     3. analyze_request()
  input_normalizer.py            json_parser.py             request_analyzer.py
        │                           │                           │
  text / file / URL           str → dict                  detect + validate
  gzip? encoding?             request or response?        + explain
        │                           │                           │
   NormalizedInput             ParseResult                AnalysisResult
                                                                │
                                                                ▼
                                                    JSON back to the browser
                                                    → displayResults() renders tabs
```

### Step 1 — Normalize the input ([input_normalizer.py](app/services/input_normalizer.py))

The user can supply data three ways: pasted text, an uploaded file, or a URL. This step reduces all three to one clean string, so nothing downstream has to care where the data came from.

It also handles the messy real world:

- **Priority rule.** If more than one source is provided: raw text wins, then file, then URL — and it adds a note explaining that.
- **Gzip detection.** Real ad-server logs are often gzipped. The code sniffs the first two bytes for the magic number `\x1f\x8b` and decompresses transparently:

  ```python
  if raw[:2] == b"\x1f\x8b":
      raw = gzip.decompress(raw)
  ```

- **Encoding fallback.** If UTF-8 decoding fails it retries with `errors="replace"` rather than crashing, and warns the user.

**Output:** a `NormalizedInput` object holding the text plus metadata (source type, byte size, notes).

### Step 2 — Parse and classify ([json_parser.py](app/services/json_parser.py))

Runs `json.loads()`. If that fails, the `JSONDecodeError` is caught and converted into a friendly message with the exact line and column:

```python
errors=[f"Invalid JSON format. Near line {exc.lineno}, column {exc.colno}: {exc.msg}."]
```

It then handles a practical quirk: log files often contain a JSON **array** of many requests. If the top level is a list, the analyzer takes the first object as representative and tells you so.

Finally it guesses the payload type from structural fingerprints:

| Test | Verdict |
|---|---|
| Has an `imp` array | bid **request** |
| Has `seatbid` or `nbr` | bid **response** |
| Has `app` or `site` | bid **request** |
| Has both `bidid` and `id` | bid **response** |
| None of the above | unknown |

If you paste a response while in Request mode, `request_workflow.py` notices the mismatch and warns you instead of producing nonsense.

**Output:** a `ParseResult` with `parse_status` of `parsed`, `invalid_json`, `unsupported_json`, `empty`, or `fetch_error`.

### Step 3 — Analyze ([request_analyzer.py](app/services/request_analyzer.py) / [response_analyzer.py](app/services/response_analyzer.py))

The analyzer does four things:

1. **Extracts** the fields it knows about, using whitelists (`DEVICE_FIELDS`, `VIDEO_FIELDS`, and so on — around 150 field names in total). Empty values are dropped, so the output stays readable.
2. **Detects** high-level characteristics by calling `detect_request_type()`.
3. **Validates** — `_request_warnings()` collects "this is suspicious" findings, `_request_errors()` collects "this breaks the spec" findings.
4. **Explains** by calling into `explanation_engine.py`.

Everything is packed into an `AnalysisResult` and serialised straight to JSON.

### The `parse_status != "parsed"` guard

Both analyzers open with an early return that builds a complete, empty-but-valid result when parsing failed. That is not defensive noise — it means the frontend always receives the same object shape and never has to write `if (result.summary)` checks. **Design lesson: a consistent response shape is worth a few lines of duplication.**

### Helper functions that make the code safe ([helpers.py](app/services/helpers.py))

Real bid requests are inconsistent — a field that should be a number arrives as a string, an object arrives as a string, a list arrives as a single value. Four small helpers absorb all of that:

| Helper | Problem it solves |
|---|---|
| `get_nested(data, "device.geo.country")` | Dotted-path lookup that returns a default instead of raising `KeyError` |
| `ensure_list(value)` | Wraps a single value in a list so you can always safely iterate |
| `coerce_int` / `coerce_float` | Converts `"3"` → `3`, and returns `None` instead of crashing on garbage |
| `has_value(value)` | Truthiness that treats `""`, `[]`, `{}`, and whitespace as "absent" |

These are used on nearly every line of the analysis code. That is why [test_robustness.py](app/tests/test_robustness.py) can throw payloads like `"video": "not-an-object"` at the analyzer and get warnings instead of a stack trace.

---

## 8. Inside the rules engine

### 8.1 Lookup tables ([rules_engine.py](app/services/rules_engine.py))

The OpenRTB spec encodes many things as integers. This file is the decoder ring:

```python
DEVICE_TYPE_LABELS = {
    1: "mobile or tablet", 2: "desktop",   3: "connected TV",
    4: "phone",            5: "tablet",    6: "connected device",
    7: "set-top box",
}
```

Similar tables exist for auction types, connection types, video placements, markup types, and the eleven standard no-bid reason codes. Every lookup goes through a wrapper that handles unknown values gracefully:

```python
def device_type_label(value):
    numeric = coerce_int(value)
    if numeric is None:
        return "unknown device type"
    return DEVICE_TYPE_LABELS.get(numeric, f"device type {numeric}")
```

### 8.2 CTV scoring ([type_detector.py](app/services/type_detector.py))

There is **no field in OpenRTB that says "this is a smart TV."** You have to infer it from circumstantial evidence. The app uses a weighted-signal score out of 14:

| Signal | Points | Reasoning |
|---|---:|---|
| A `video` object is present | 2 | TV ads are video; necessary but not sufficient |
| An `app` object is present | 2 | TV apps report as apps, never as websites |
| User agent contains a TV marker (`roku`, `tizen`, `webos`, `android tv`, `fire tv`, `appletv`, `smarttv`, `aft`) | **3** | Strong, hard to fake accidentally |
| `device.devicetype` is 3, 6, or 7 | **3** | The publisher explicitly declared a TV device |
| Pod fields present (`poddur`, `podid`, `podseq`, `slotinpod`) | 2 | Ad pods = commercial breaks, a TV-only concept |
| Duration-floor fields present (`mincpmpersec`, `durfloors`) | 2 | Pricing by the second is a CTV convention |

| Total score | Verdict |
|---|---|
| 6 or more | **likely CTV** |
| 3 to 5 | **maybe CTV** |
| 0 to 2 | **unlikely CTV** |

The score is never shown on its own — `ctv_reasons` lists exactly which signals fired, so you can disagree with the verdict on the evidence. The maximum is exported as the constant `CTV_SCORE_MAX` so the UI renders "14 / 14" rather than hardcoding the scale (change a weight, and the UI follows automatically).

### 8.3 Version inference

The app deliberately does **not** claim to know the exact OpenRTB version, because most payloads never state one. Instead it looks for fields that only exist in 2.6 (`poddur`, `podid`, `podseq`, `slotinpod`, `rqddurs`, `plcmt`, `mincpmpersec`, `durfloors`) and reports a labelled guess with a confidence level:

| Evidence found | Label | Confidence |
|---|---|---|
| 3 or more modern fields | likely 2.6-aligned | high |
| 1–2 modern fields | likely 2.6-aligned | medium |
| Impressions present, no modern fields | likely 2.5-compatible | medium |
| No usable impression structure | mixed / unclear | low |

**This honesty is a feature.** A tool that confidently prints "OpenRTB 2.6" from ambiguous evidence teaches you the wrong thing. Showing the evidence and a confidence level teaches you how the inference actually works.

### 8.4 Validation: warnings vs errors

The distinction matters and is applied consistently:

- **Errors** = the payload violates the spec. Examples: no `imp` array at all; a `bidfloor` that is not numeric; a video object that mixes `rqddurs` with `minduration`/`maxduration` (2.6 makes those mutually exclusive); a PMP deal with no `id`.
- **Warnings** = legal but risky, deprecated, or bad for monetisation. Examples: no `device` object; a device with no UA/IP/IFA (low addressability); deprecated hashed device IDs (`didsha1`, `macmd5`); both `keywords` and `kwarray` on the same object; missing geo; missing floor.

Roughly 40 checks are implemented across the two analyzers, including deep structural validation of `device.sua` (the 2.6 structured user agent) and GPP privacy fields.

### 8.5 Macro validation ([response_analyzer.py](app/services/response_analyzer.py))

When a DSP wins, the exchange rewrites placeholders inside the win URL — `${AUCTION_PRICE}` becomes the real clearing price. Getting the syntax wrong means the DSP is never told what it paid, which quietly breaks reporting. `check_macro_warnings()` catches three failure modes:

1. **Legacy bracket-less form** — `$AUCTION_PRICE` instead of `${AUCTION_PRICE}`
2. **Unclosed macros** — a `${AUCTION_` with no matching `}`
3. **Unknown macro names** — anything outside the seven-macro allowlist

---

## 9. The comparison engine

[comparison_engine.py](app/services/comparison_engine.py) is where the app earns its keep. It answers the question a DSP engineer actually asks: *"my bid was discarded — why?"*

It builds a lookup of every impression in the request keyed by `imp.id`, then walks every bid in the response and runs targeted checks. Each check returns **PASS**, **WARNING**, or **FAIL**; the worst individual result becomes the overall status.

| Check | What it catches |
|---|---|
| Auction id match | Response `id` does not echo the request `id` — correlation is broken |
| Currency match | Request priced in USD, response in EUR |
| **impid mapping** | The bid points at an impression that does not exist in the request |
| **Floor compliance** | `price` is below `bidfloor` — the bid will be discarded |
| **Deal match** | The bid claims a `dealid` that the request never offered |
| Creative size | Banner dimensions do not match the requested `w`×`h` |
| **Ad pod alignment** | Request is podded but the bid omits `podid`/`slotinpod`, or they disagree |
| **Duration compliance** | `dur` is not in `rqddurs`, or is outside `minduration`/`maxduration` |
| **CPM-per-second floor** | `price ÷ dur` is below `mincpmpersec` (a CTV-specific pricing rule) |
| Video/audio completeness | Request wants video but the bid has no duration or markup |

Running the two CTV samples through it produces:

```
Overall: PASS

PASS  Request/response id: Response id matches the request id.
PASS  Currency: Both payloads use USD.
PASS  Floor check for imp imp-ctv-1: Bid price 24.25 is at or above the floor 18.5.
PASS  Deal match for imp imp-ctv-1: Response dealid deal-ctv-77 exists in the request deal list.
PASS  Ad Pod ID match for imp imp-ctv-1: Response podid matches request podid 'pod-a'.
PASS  CPM per second floor for imp imp-ctv-1: Bid CPM per second (0.8083) satisfies the floor (0.3500).
```

That last check is a good example of encoded domain knowledge. On connected TV, buyers are often required to pay a minimum rate *per second of ad time* rather than a flat CPM. The engine computes `24.25 ÷ 30 = 0.8083` and compares it against the requested `mincpmpersec` of `0.35`. Nothing in the raw JSON tells you that division needs to happen — you have to know the business rule. That is precisely the kind of knowledge a tool like this exists to capture.

---

## 10. The user interface, tab by tab

Everything lives on one page, driven by [app.js](app/static/app.js). There is no framework — just `document.getElementById` and template strings.

### Three modes

| Mode | Endpoints called |
|---|---|
| 🔍 **Request** | `POST /analyze/request` |
| 📨 **Response** | `POST /analyze/response` |
| ⚖️ **Compare** | both of the above, then `POST /analyze/compare` |

### Four ways to get data in

- **📝 Paste** — with live JSON validation as you type (it shows the failing line number before you even click Analyze) and a ✨ Prettify button
- **📁 Upload** — click or drag-and-drop `.json`, `.txt`, `.log`
- **🌐 URL** — fetch JSON from a public HTTP/HTTPS address
- **📋 Samples** — one-click loading of the six bundled payloads

### Nine result tabs

| Tab | Contents |
|---|---|
| 📊 Overview | KPI cards — impressions, format, environment, floor range, validity |
| 💡 Insights | The plain-English, field-by-field explanations |
| 📋 Request | Structured breakdown of every parsed request object |
| 📨 Response | Seats, bids, prices, creative metadata |
| ⚖️ Compare | The PASS/WARNING/FAIL check list |
| 📺 Signals | CTV score with its reasons, version guess, traffic-quality notes |
| 🎓 Cheatsheet | Five interview-ready talking points about this payload |
| ⚠️ Warnings | All warnings and errors in one list |
| 📄 Raw | The original JSON, pretty-printed |

The tab strip implements the full **WAI-ARIA tab pattern** — `role="tab"`, `aria-selected`, and roving `tabindex` so arrow keys move between tabs and screen readers announce them correctly. Worth reading [`activateTab()`](app/static/app.js) if you have never implemented accessible tabs before.

### Other UI details worth reading the code for

- **Export**: Copy, JSON, CSV, HTML, and PDF (PDF is generated by opening a styled print window — no library needed)
- **Theme toggle**: light/dark, persisted in `localStorage`
- **Keyboard shortcut**: `Ctrl+Enter` analyzes from anywhere
- **Cache busting**: [web.py](app/routes/web.py) computes `asset_version()` from the newest static-file modification time and appends it as `?v=...` to the CSS and JS tags. Without this, browsers happily serve a stale `app.js` and your changes appear not to work — a genuinely maddening bug this project already hit once (commit `c88f0ef`).

---

## 11. API reference

The backend is a normal REST API, so you can use it without the UI at all. FastAPI generates interactive docs at <http://127.0.0.1:8000/docs> where you can try every endpoint in the browser.

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/analyze/request` | form: `raw_text` \| `file` \| `source_url` | `AnalysisResult` |
| `POST` | `/analyze/response` | form: `raw_text` \| `file` \| `source_url` | `AnalysisResult` |
| `POST` | `/analyze/compare` | JSON: `{request_payload, response_payload}` | comparison report |
| `POST` | `/fetch/url` | JSON: `{url}` | raw fetched text |
| `GET` | `/samples` | — | all bundled samples |
| `GET` | `/health` | — | `{"status": "ok"}` |
| `GET` | `/` | — | the analyzer HTML page |
| `GET` | `/tutorial` | — | the tutorial HTML page |

### Example: analyze a file with curl

```bash
curl -X POST http://127.0.0.1:8000/analyze/request -F "file=@app/sample_data/sample_request_ctv.json"
```

### Example: use it from Python

```python
import json, httpx

request_payload = json.load(open("app/sample_data/sample_request_ctv.json"))
response_payload = json.load(open("app/sample_data/sample_response_ctv.json"))

result = httpx.post(
    "http://127.0.0.1:8000/analyze/compare",
    json={"request_payload": request_payload, "response_payload": response_payload},
).json()

print(result["overall_status"])          # PASS
for check in result["checks"]:
    print(check["status"], check["label"])
```

### The `AnalysisResult` shape

Defined in [schemas.py](app/models/schemas.py); every analyze endpoint returns exactly these keys:

```python
{
  "input_source":  {...},   # where the data came from + notes
  "input_type":    "request" | "response" | "unknown",
  "parse_status":  "parsed" | "invalid_json" | "unsupported_json" | "empty" | "fetch_error",
  "parsed_fields": {...},   # extracted, whitelisted fields grouped by object
  "summary":       {...},   # the headline numbers
  "human_explanations": [...],
  "inferred_signals":   {...},   # CTV score, version note, traffic quality
  "request_type_detection": {...},
  "warnings": [...],
  "errors":   [...],
  "comparison_results": {...},
  "interview_points":   [...],
  "raw_payload": {...}      # the original JSON, unmodified
}
```

---

## 12. Sample data

Six payloads in `app/sample_data/`, each chosen to exercise a different code path:

| File | Demonstrates |
|---|---|
| `sample_request_ctv.json` | Connected TV — scores the full 14/14, includes ad pods, a PMP deal, and a supply chain |
| `sample_response_ctv.json` | The matching winning bid — pairs with the file above for Compare mode |
| `sample_request_banner.json` | Classic web display — the simplest case |
| `sample_response_nobid.json` | A no-bid response with an `nbr` reason code |
| `sample_request_audio.json` | Audio/podcast inventory |
| `sample_request_native.json` | Native (in-feed) inventory |

**Suggested learning exercise:** load the CTV sample, delete the `"devicetype": 3` line, and re-analyze. The score drops from 14 to 11, the verdict stays "likely CTV" (still above 6), and one entry disappears from the reasons list. Then delete the `device` object entirely and watch new warnings appear. Poking at these files is the fastest way to understand the scoring model.

---

## 13. Running the tests

```bash
python -m pytest app/tests -q
```

Expected output:

```
......                                                                   [100%]
6 passed in 1.19s
```

Two suites:

- **[test_openrtb_2_6.py](app/tests/test_openrtb_2_6.py)** — spec-conformance tests. Does the analyzer catch a video object that mixes `rqddurs` with `maxduration`? Does it flag deprecated `bid.api`? Does it validate `device.sua` structure?
- **[test_robustness.py](app/tests/test_robustness.py)** — hostile-input tests. It feeds deliberately broken payloads (`"video": "not-an-object"`, `"device": "not-an-object"`, a bid array containing a bare string) and asserts that the analyzer produces warnings instead of raising `AttributeError`.

That second suite is the more instructive one. Parsing data from other companies means you will *definitely* receive malformed input, and a validation tool that crashes on bad data is useless precisely when you need it most.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| **RTB** | Real-Time Bidding — buying each ad impression via a live auction |
| **OpenRTB** | The IAB Tech Lab standard defining the JSON format for those auctions |
| **SSP / Exchange** | Supply-Side Platform — sells inventory for publishers, runs the auction |
| **DSP** | Demand-Side Platform — bids for advertisers |
| **Impression (`imp`)** | One ad slot in one auction. A request can carry several |
| **CPM** | Cost Per Mille — price per 1,000 impressions. A `price` of 24.25 means $24.25 per 1,000 |
| **Bid floor** | Minimum acceptable price. Bid below it and you are discarded |
| **CTV** | Connected TV — Roku, Fire TV, Apple TV, smart TVs |
| **OTT** | Over-The-Top — streaming video delivered over the internet |
| **Ad pod** | A commercial break: several ads played back to back. A TV concept |
| **PMP** | Private Marketplace — an invitation-only auction |
| **Deal ID** | Identifier for a pre-negotiated buying agreement |
| **First-price** | Winner pays exactly what they bid (`at: 1`) |
| **Second-price** | Winner pays just above the runner-up (`at: 2`) |
| **`adm`** | Ad Markup — the actual HTML/VAST creative returned in the bid |
| **`nurl` / `burl`** | Win-notice and billing-notice URLs, fired when the bid wins |
| **VAST** | Video Ad Serving Template — the XML standard for video creatives |
| **IFA** | Identifier For Advertising — the resettable device ad ID |
| **GDPR / COPPA / GPP** | Privacy frameworks; their signals travel in the `regs` object |
| **Supply chain (`schain`)** | The chain of intermediaries between publisher and buyer, used to detect fraud |
| **`tmax`** | Maximum time in milliseconds the exchange will wait for a bid |
| **No-bid (`nbr`)** | A coded reason explaining why the DSP declined to bid |

---

## 15. Limitations and security notes

Being clear about what a tool does *not* do is part of good documentation.

### Functional limitations

- **Heuristics, not certainty.** CTV scoring and version inference are educated guesses from circumstantial evidence. The app always shows its reasoning so you can override it.
- **First object only.** Given a JSON array, only the first object is analyzed. There is no batch mode yet.
- **No exchange-specific knowledge.** Every SSP has its own `ext` conventions; the analyzer only reads standard OpenRTB fields.
- **2.5/2.6 focused.** OpenRTB 3.0 (a fundamentally different structure) is not supported.
- **Nothing is persisted.** Close the tab and the analysis is gone. Use the export buttons to keep results.

### Security notes

This app is designed to run **locally, on `127.0.0.1`, for a single trusted user**. Under that assumption it is fine. Please read the following before exposing it to anything else.

1. **The URL fetcher is server-side request forgery (SSRF)-capable.** [url_fetcher.py](app/services/url_fetcher.py) accepts any `http`/`https` URL and follows redirects, with no blocklist for private address ranges. Anyone who can reach the UI can make **your machine** issue requests to `http://127.0.0.1:...`, `http://192.168.x.x`, or a cloud metadata endpoint, and read the response body back through the analyzer. On localhost this is a non-issue; the moment the app is bound to `0.0.0.0` or deployed, it becomes a real vulnerability. Mitigation is to resolve the hostname and reject private, loopback, and link-local addresses before fetching, and to disable redirect following.
2. **No authentication, no rate limiting, no CSRF protection.** There is no login and no origin checking on the POST endpoints. That is acceptable for a local tool and unacceptable for a shared one.
3. **CORS is not configured**, which is the correct default — but note that means adding a permissive `CORSMiddleware` later would combine badly with points 1 and 2.
4. **Fetch size is capped at 2 MB** (`MAX_FETCH_BYTES`) with an 8-second timeout, so the URL feature cannot easily be used to exhaust memory. Uploaded files are **not** size-capped — FastAPI reads them fully into memory.
5. **Bid requests contain personal data** — IP addresses, device IDs, geolocation, sometimes user IDs. Real production payloads may fall under GDPR/CCPA. Prefer the bundled samples or anonymised data when learning, and do not paste live traffic into any hosted tool.

**Bottom line:** run it with the default `--host 127.0.0.1`. Do not put it on a shared network or the public internet without addressing points 1 and 2 first.

---

## 16. Ideas for extending the project

Roughly ordered from beginner to advanced:

**Good first tasks**

1. **Add a device type.** OpenRTB defines more `devicetype` values than `DEVICE_TYPE_LABELS` currently maps. Add one, then write a test.
2. **Add a validation rule.** Pick a `SHOULD` from the 2.6 spec (see `docs/openrtb_2_6_extracted.txt`) and implement it in `_request_warnings()`.
3. **Add a sample payload.** Build a DOOH (digital out-of-home) or rewarded-video request, drop it in `sample_data/`, and it appears in the UI automatically — `/samples` globs the directory.

**Intermediate**

4. **Batch mode.** Accept a JSON array or newline-delimited JSON log and analyze every entry, with a summary table across all of them.
5. **A CLI.** Import `analyze_input` in a `click` or `argparse` script so the analyzer works in a terminal pipeline. The services layer already makes this straightforward.
6. **Fix the SSRF.** Implement the private-address blocklist from section 15 and write tests proving `http://127.0.0.1:8000/health` and `http://169.254.169.254/` are both rejected.
7. **Analysis history.** Persist recent analyses to SQLite and add a "recent" panel.

**Advanced**

8. **Exchange adapters.** Pluggable modules that understand vendor-specific `ext` fields (Magnite, PubMatic, Index Exchange).
9. **VAST inspection.** When `bid.adm` contains VAST XML, parse it and validate the media files, tracking events, and wrapper chain.
10. **Diff mode.** Compare two bid requests side by side and highlight what changed — invaluable for debugging "it worked yesterday."
11. **OpenRTB 3.0 support.** A genuinely different object model (layered `AdCOM`); implementing it teaches you both specs properly.

---

## Reference material

- [IAB Tech Lab — OpenRTB specifications](https://iabtechlab.com/standards/openrtb/)
- `docs/openrtb_2_6_extracted.txt` — spec text bundled with this repo
- [FastAPI documentation](https://fastapi.tiangolo.com/)
- The built-in tutorial at <http://127.0.0.1:8000/tutorial>
