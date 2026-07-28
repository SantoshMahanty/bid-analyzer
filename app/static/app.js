let state = {
    samples: [],
    report: null,
    currentMode: "request"
};

document.addEventListener("DOMContentLoaded", async () => {
    await loadSamples();
    bindEvents();
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

    // Overview
    let overviewHtml = "<div style='display: grid; gap: 1rem;'>";
    if (report.request) {
        overviewHtml += `<div style='padding: 1rem; background: #f0f0f0; border-radius: 6px;'>
            <h3>📋 Request</h3>
            <p><strong>ID:</strong> ${report.request.summary?.request_id || "—"}</p>
            <p><strong>Format:</strong> ${report.request.summary?.ad_format || "—"}</p>
            <p><strong>Environment:</strong> ${report.request.summary?.environment_guess || "—"}</p>
        </div>`;
    }
    if (report.response) {
        overviewHtml += `<div style='padding: 1rem; background: #f0f0f0; border-radius: 6px;'>
            <h3>📨 Response</h3>
            <p><strong>Bids:</strong> ${report.response.summary?.bid_count || 0}</p>
            <p><strong>Seats:</strong> ${report.response.summary?.seat_count || 0}</p>
            <p><strong>Status:</strong> ${report.response.summary?.no_bid_style || "Active Bids"}</p>
        </div>`;
    }
    overviewHtml += "</div>";
    document.getElementById("tab-overview").innerHTML = overviewHtml;

    // Request
    if (report.request) {
        let html = "<div style='display: grid; gap: 0.5rem;'>";
        for (const [k, v] of Object.entries(report.request.summary || {})) {
            html += `<div style='display: flex; gap: 1rem;'><strong style='min-width: 150px;'>${k}:</strong><span>${v}</span></div>`;
        }
        html += "</div>";
        document.getElementById("tab-request").innerHTML = html;
    } else {
        document.getElementById("tab-request").innerHTML = "<p>No request data</p>";
    }

    // Response
    if (report.response) {
        let html = "<div style='display: grid; gap: 0.5rem;'>";
        for (const [k, v] of Object.entries(report.response.summary || {})) {
            html += `<div style='display: flex; gap: 1rem;'><strong style='min-width: 150px;'>${k}:</strong><span>${v}</span></div>`;
        }
        html += "</div>";
        document.getElementById("tab-response").innerHTML = html;
    } else {
        document.getElementById("tab-response").innerHTML = "<p>No response data</p>";
    }

    // Compare
    if (report.comparison) {
        let html = "<div style='display: grid; gap: 0.75rem;'>";
        for (const finding of report.comparison.comparison_findings || []) {
            html += `<div style='padding: 0.75rem; background: #f0f0f0; border-radius: 4px;'>${finding}</div>`;
        }
        html += "</div>";
        document.getElementById("tab-compare").innerHTML = html;
    } else {
        document.getElementById("tab-compare").innerHTML = "<p>Run compare mode to see comparison</p>";
    }

    // Warnings
    const warnings = [
        ...(report.request?.warnings || []),
        ...(report.response?.warnings || [])
    ];
    if (warnings.length === 0) {
        document.getElementById("tab-warnings").innerHTML = "<p style='color: #10b981;'>✓ No warnings</p>";
    } else {
        let html = "<div style='display: grid; gap: 0.75rem;'>";
        warnings.forEach(w => {
            html += `<div style='padding: 0.75rem; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px;'>${w}</div>`;
        });
        html += "</div>";
        document.getElementById("tab-warnings").innerHTML = html;
    }

    // Raw
    document.getElementById("tab-raw").innerHTML = `<pre>${JSON.stringify(report, null, 2)}</pre>`;
}

function switchTab(tabName, btn) {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
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
    const el = document.getElementById("status-msg");
    el.textContent = msg;
    el.className = `status-msg ${type} show`;
    setTimeout(() => el.classList.remove("show"), 4000);
}
