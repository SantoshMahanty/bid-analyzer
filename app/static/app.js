let state = {
    samples: [],
    report: null,
    currentMode: "request"
};

document.addEventListener("DOMContentLoaded", async () => {
    await loadSamples();
    bindEvents();
    setupKeyboardShortcuts();
    setupDragDrop();
    setupInputMethodTabs();
});

/* Events */
function bindEvents() {
    // Mode option buttons
    document.querySelectorAll(".mode-option").forEach(btn => {
        btn.addEventListener("click", () => {
            switchMode(btn.dataset.mode);
        });
    });

    document.getElementById("analyze-btn").addEventListener("click", analyzeAll);

    // File inputs
    document.getElementById("request-file").addEventListener("change", (e) => {
        handleFileUpload(e, "request");
    });
    document.getElementById("response-file").addEventListener("change", (e) => {
        handleFileUpload(e, "response");
    });
    document.getElementById("compare-request-file").addEventListener("change", (e) => {
        handleFileUpload(e, "compare-request");
    });
    document.getElementById("compare-response-file").addEventListener("change", (e) => {
        handleFileUpload(e, "compare-response");
    });
}

function switchMode(mode) {
    state.currentMode = mode;

    // Update button states
    document.querySelectorAll(".mode-option").forEach(btn => {
        btn.classList.remove("active");
    });
    document.querySelector(`[data-mode="${mode}"]`).classList.add("active");

    // Update content visibility
    document.querySelectorAll(".mode-content").forEach(el => el.style.display = "none");
    document.getElementById(`input-${mode}`).style.display = "block";

    clearInputs();
}

async function loadSamples() {
    try {
        const res = await fetch("/samples");
        const data = await res.json();
        state.samples = data.samples || [];

        populateSamples("request-sample", "request");
        populateSamples("response-sample", "response");
        populateSamples("compare-request-sample", "request");
        populateSamples("compare-response-sample", "response");
    } catch (err) {
        showStatus("Failed to load samples", "error");
    }
}

function populateSamples(selectId, kind) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const samples = state.samples.filter(s => s.kind === kind);
    select.innerHTML = '<option value="">Choose Sample...</option>';
    samples.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.name;
        opt.textContent = s.name;
        select.appendChild(opt);
    });
}

function loadSample(mode) {
    const selectId = `${mode}-sample`;
    const selectEl = document.getElementById(selectId);
    if (!selectEl.value) {
        showStatus("Select a sample first", "info");
        return;
    }

    const sample = state.samples.find(s => s.name === selectEl.value);
    if (!sample) return;

    const textareaId = `${mode}-raw`;
    document.getElementById(textareaId).value = sample.content;
    showStatus(`Loaded ${sample.name}`, "info");
}

function handleFileUpload(e, mode) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        document.getElementById(`${mode}-raw`).value = event.target.result;
        showStatus(`Uploaded ${file.name}`, "info");
    };
    reader.readAsText(file);
}

function clearInputs() {
    document.querySelectorAll("textarea").forEach(ta => ta.value = "");
    document.querySelectorAll("select").forEach(sel => sel.value = "");
    document.getElementById("results-placeholder").style.display = "block";
    document.getElementById("results-content").style.display = "none";
}

async function analyzeAll() {
    try {
        showStatus("Analyzing...", "info");

        let report = {
            request: null,
            response: null,
            comparison: null
        };

        if (state.currentMode === "request") {
            const rawText = document.getElementById("request-raw").value.trim();
            if (!rawText) {
                showStatus("Paste or upload a bid request", "error");
                return;
            }
            const formData = new FormData();
            formData.append("raw_text", rawText);
            report.request = await postForm("/analyze/request", formData);
        }
        else if (state.currentMode === "response") {
            const rawText = document.getElementById("response-raw").value.trim();
            if (!rawText) {
                showStatus("Paste or upload a bid response", "error");
                return;
            }
            const formData = new FormData();
            formData.append("raw_text", rawText);
            report.response = await postForm("/analyze/response", formData);
        }
        else if (state.currentMode === "compare") {
            const reqText = document.getElementById("compare-request-raw").value.trim();
            const respText = document.getElementById("compare-response-raw").value.trim();

            if (!reqText || !respText) {
                showStatus("Provide both request and response", "error");
                return;
            }

            const formData1 = new FormData();
            formData1.append("raw_text", reqText);
            report.request = await postForm("/analyze/request", formData1);

            const formData2 = new FormData();
            formData2.append("raw_text", respText);
            report.response = await postForm("/analyze/response", formData2);

            if (report.request?.raw_payload && report.response?.raw_payload) {
                report.comparison = await postJson("/analyze/compare", {
                    request_payload: report.request.raw_payload,
                    response_payload: report.response.raw_payload
                });
            }
        }

        state.report = report;
        displayResults(report);
        showStatus("Analysis complete", "success");
    } catch (err) {
        showStatus(`Error: ${err.message}`, "error");
    }
}

async function postForm(url, formData) {
    const res = await fetch(url, { method: "POST", body: formData });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function postJson(url, body) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function displayResults(report) {
    document.getElementById("results-placeholder").style.display = "none";
    document.getElementById("results-content").style.display = "block";

    // Overview with KPI Cards
    let overviewHtml = "<div style='display: grid; gap: 1.5rem;'>";

    if (report.request) {
        const det = report.request.request_type_detection || {};
        overviewHtml += `<div style='background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1.5rem; border-radius: 12px;'>
            <h3 style='margin-bottom: 1rem;'>📋 Bid Request</h3>
            <div style='display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;'>
                <div><strong>ID:</strong> ${report.request.summary?.request_id || "—"}</div>
                <div><strong>Format:</strong> ${report.request.summary?.ad_format || "—"}</div>
                <div><strong>Environment:</strong> ${report.request.summary?.environment_guess || "—"}</div>
                <div><strong>CTV Score:</strong> ${det.ctv_score || 0}/20 (${det.ctv_label || "—"})</div>
            </div>
        </div>`;
    }

    if (report.response) {
        overviewHtml += `<div style='background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 1.5rem; border-radius: 12px;'>
            <h3 style='margin-bottom: 1rem;'>📨 Bid Response</h3>
            <div style='display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;'>
                <div><strong>Bids:</strong> ${report.response.summary?.bid_count || 0}</div>
                <div><strong>Seats:</strong> ${report.response.summary?.seat_count || 0}</div>
                <div><strong>Max Price:</strong> $${report.response.summary?.max_bid_price || "—"}</div>
                <div><strong>Status:</strong> ${report.response.summary?.no_bid_style || "Active"}</div>
            </div>
        </div>`;
    }

    overviewHtml += "</div>";
    document.getElementById("tab-overview").innerHTML = overviewHtml;

    // Human Explanations Tab
    const explanations = report.request?.human_explanations || [];
    if (explanations.length > 0) {
        let html = "<div style='display: grid; gap: 1rem;'>";
        explanations.forEach((exp, i) => {
            html += `<div style='padding: 1.25rem; background: #f0fdf4; border-left: 4px solid #10b981; border-radius: 8px;'>
                <div style='font-weight: 600; color: #047857; margin-bottom: 0.5rem;'>💡 Insight ${i+1}</div>
                <div style='color: #1f2937;'>${exp}</div>
            </div>`;
        });
        html += "</div>";
        // Add to overview if not already showing
        if (document.getElementById("tab-human")) {
            document.getElementById("tab-human").innerHTML = html;
        }
    }

    // Signals & CTV Tab
    const signals = report.request?.inferred_signals || {};
    if (Object.keys(signals).length > 0) {
        let html = "<div style='display: grid; gap: 1rem;'>";
        for (const [key, value] of Object.entries(signals)) {
            const icon = key.includes('ctv') ? '📺' : key.includes('version') ? '📦' : key.includes('privacy') ? '🔒' : '🎯';
            html += `<div style='padding: 1rem; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;'>
                <div style='font-weight: 600; color: #667eea; margin-bottom: 0.5rem;'>${icon} ${key}</div>
                <div style='color: #475569;'>${typeof value === 'object' ? JSON.stringify(value) : value}</div>
            </div>`;
        }
        html += "</div>";
        if (document.getElementById("tab-signals")) {
            document.getElementById("tab-signals").innerHTML = html;
        }
    }

    // Interview Cheatsheet Tab
    const interviewPoints = report.request?.interview_points || [];
    if (interviewPoints.length > 0) {
        let html = "<div style='display: grid; gap: 1rem;'>";
        interviewPoints.forEach((point, i) => {
            html += `<div style='padding: 1.25rem; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 8px;'>
                <div style='font-weight: 600; color: #92400e; margin-bottom: 0.5rem;'>🎓 Point ${i+1}</div>
                <div style='color: #1f2937;'>${point}</div>
            </div>`;
        });
        html += "</div>";
        if (document.getElementById("tab-interview")) {
            document.getElementById("tab-interview").innerHTML = html;
        }
    }

    // Request Summary
    if (report.request) {
        let html = "<div style='display: grid; gap: 0.75rem;'>";
        for (const [k, v] of Object.entries(report.request.summary || {})) {
            html += `<div style='padding: 0.75rem; background: #f9fafb; border-radius: 6px; display: flex; justify-content: space-between;'>
                <strong style='color: #667eea;'>${k}:</strong><span style='color: #475569;'>${typeof v === 'object' ? JSON.stringify(v) : v}</span>
            </div>`;
        }
        html += "</div>";
        document.getElementById("tab-request").innerHTML = html;
    }

    // Response Summary
    if (report.response) {
        let html = "<div style='display: grid; gap: 0.75rem;'>";
        for (const [k, v] of Object.entries(report.response.summary || {})) {
            html += `<div style='padding: 0.75rem; background: #f9fafb; border-radius: 6px; display: flex; justify-content: space-between;'>
                <strong style='color: #f5576c;'>${k}:</strong><span style='color: #475569;'>${typeof v === 'object' ? JSON.stringify(v) : v}</span>
            </div>`;
        }
        html += "</div>";
        document.getElementById("tab-response").innerHTML = html;
    }

    // Compare Matrix
    if (report.comparison) {
        let html = "<div style='display: grid; gap: 0.75rem;'>";
        for (const finding of report.comparison.comparison_findings || []) {
            const icon = finding.includes('✓') ? '✅' : finding.includes('⚠') ? '⚠️' : '❌';
            html += `<div style='padding: 1rem; background: ${finding.includes('✓') ? '#d1fae5' : '#fef3c7'}; border-left: 4px solid ${finding.includes('✓') ? '#10b981' : '#f59e0b'}; border-radius: 6px;'>
                ${icon} ${finding}
            </div>`;
        }
        html += "</div>";
        document.getElementById("tab-compare").innerHTML = html;
    } else {
        document.getElementById("tab-compare").innerHTML = "<p>Compare both request and response to see verification results</p>";
    }

    // Warnings & Errors
    const warnings = [
        ...(report.request?.warnings || []),
        ...(report.response?.warnings || [])
    ];
    if (warnings.length === 0) {
        document.getElementById("tab-warnings").innerHTML = "<p style='color: #10b981; font-weight: 600;'>✓ No warnings or errors detected</p>";
    } else {
        let html = "<div style='display: grid; gap: 0.75rem;'>";
        warnings.forEach(w => {
            html += `<div style='padding: 1rem; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px; color: #92400e;'>⚠️ ${w}</div>`;
        });
        html += "</div>";
        document.getElementById("tab-warnings").innerHTML = html;
    }

    // Raw JSON Tree
    document.getElementById("tab-raw").innerHTML = `<pre style='font-size: 0.8rem; overflow-x: auto; max-height: 500px;'>${JSON.stringify(report, null, 2)}</pre>`;
}

function switchTab(tabName, btn) {
    document.querySelectorAll(".tab-button").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${tabName}`).classList.add("active");
}

function copyResults() {
    const text = JSON.stringify(state.report, null, 2);
    navigator.clipboard.writeText(text).then(() => {
        showStatus("Copied to clipboard", "success");
    });
}

function exportJSON() {
    const text = JSON.stringify(state.report, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bid-analysis-${Date.now()}.json`;
    a.click();
    showStatus("JSON downloaded", "success");
}

function exportHTML() {
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>Bid Analysis Report</title>
    <style>
        body { font-family: sans-serif; margin: 2rem; background: #f5f7fa; }
        .container { max-width: 900px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; }
        h1 { color: #3b82f6; }
        pre { background: #f0f0f0; padding: 1rem; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Bid Analysis Report</h1>
        <p>Generated: ${new Date().toISOString()}</p>
        <pre>${JSON.stringify(state.report, null, 2)}</pre>
    </div>
</body>
</html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bid-analysis-${Date.now()}.html`;
    a.click();
    showStatus("HTML downloaded", "success");
}

function showStatus(msg, type) {
    const el = document.getElementById("status-notification");
    el.textContent = msg;
    el.className = `status-notification ${type} show`;
    setTimeout(() => el.classList.remove("show"), 4000);
}

/* Phase 2: JSON Prettify */
function prettifyJSON(textareaId) {
    const textarea = document.getElementById(textareaId);
    try {
        const parsed = JSON.parse(textarea.value);
        textarea.value = JSON.stringify(parsed, null, 2);
        showStatus("✨ JSON formatted", "success");
    } catch (err) {
        showStatus("❌ Invalid JSON: " + err.message, "error");
    }
}

/* Phase 2: Keyboard Shortcuts */
function setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            document.getElementById("analyze-btn").click();
        }
    });
}

/* Phase 2: Drag & Drop */
function setupDragDrop() {
    ["request", "response"].forEach(mode => {
        const dropzone = document.getElementById(`dropzone-${mode}`);
        if (!dropzone) return;

        const fileInput = document.getElementById(`${mode}-file`);

        dropzone.addEventListener("click", () => fileInput.click());

        ["dragenter", "dragover", "dragleave", "drop"].forEach(event => {
            dropzone.addEventListener(event, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        ["dragenter", "dragover"].forEach(event => {
            dropzone.addEventListener(event, () => {
                dropzone.classList.add("drag-over");
            });
        });

        ["dragleave", "drop"].forEach(event => {
            dropzone.addEventListener(event, () => {
                dropzone.classList.remove("drag-over");
            });
        });

        dropzone.addEventListener("drop", (e) => {
            const files = e.dataTransfer.files;
            if (files.length) {
                fileInput.files = files;
                handleFileUpload({target: fileInput}, mode);
            }
        });
    });
}

/* Phase 2: Input Method Tabs */
function setupInputMethodTabs() {
    // Initialize: hide all non-active content with a small delay
    setTimeout(() => {
        document.querySelectorAll(".input-method-content").forEach(el => {
            if (el.classList.contains("active")) {
                el.style.cssText = "display: block !important;";
            } else {
                el.style.cssText = "display: none !important;";
            }
        });
    }, 0);

    document.querySelectorAll(".input-method-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            const mode = tab.dataset.mode;
            const method = tab.dataset.method;

            // Update active tab
            document.querySelectorAll(`[data-mode="${mode}"]`).forEach(t => {
                t.classList.remove("active");
            });
            tab.classList.add("active");

            // Update visible content
            document.querySelectorAll(`.input-method-content`).forEach(el => {
                if (el.id.endsWith(`-${mode}`)) {
                    el.classList.remove("active");
                    el.style.display = "none";
                }
            });
            const content = document.getElementById(`method-${method}-${mode}`);
            if (content) {
                content.classList.add("active");
                content.style.display = "block";
            }
        });
    });

    // Populate samples with pills
    populateSamplePills("request");
    populateSamplePills("response");
}

function populateSamplePills(mode) {
    const grid = document.getElementById(`samples-${mode}-grid`);
    if (!grid) return;

    const samples = state.samples.filter(s => s.kind === mode);
    grid.innerHTML = samples.map(s =>
        `<button class="sample-pill" onclick="loadSampleByName('${s.name}', '${mode}')">
            📋 ${s.name.replace('sample_', '').replace(`.json`, '')}
        </button>`
    ).join("");
}

function loadSampleByName(sampleName, mode) {
    const sample = state.samples.find(s => s.name === sampleName);
    if (!sample) {
        showStatus("Sample not found", "error");
        return;
    }
    document.getElementById(`${mode}-raw`).value = sample.content;
    showStatus(`✅ Loaded ${sampleName}`, "success");
}

/* Phase 2: URL Fetcher */
async function fetchURL(mode) {
    const urlInput = document.getElementById(`${mode}-url`);
    const url = urlInput.value.trim();

    if (!url) {
        showStatus("Enter a URL first", "error");
        return;
    }

    try {
        showStatus("🌐 Fetching...", "info");
        const response = await fetch("/fetch/url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (data.content) {
            document.getElementById(`${mode}-raw`).value = data.content;
            showStatus("✅ Fetched successfully", "success");
        } else {
            showStatus("No content received", "error");
        }
    } catch (err) {
        showStatus(`❌ Fetch failed: ${err.message}`, "error");
    }
}
