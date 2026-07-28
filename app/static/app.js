const state = {
    samples: [],
    report: null,
    currentMode: "request",
};

document.addEventListener("DOMContentLoaded", () => {
    bindModeCards();
    bindInputTabs();
    bindActions();
    loadSamples();
    initializeUI();
});

function initializeUI() {
    // Initialize with request mode active
    document.getElementById("mode-request").style.display = "block";
    document.getElementById("mode-response").style.display = "none";
    document.getElementById("mode-compare").style.display = "none";

    // Mark request card as active
    document.querySelector('[data-mode="request"]').classList.add("active");
}

/* Mode Selection */
function bindModeCards() {
    document.querySelectorAll(".mode-card").forEach((card) => {
        card.addEventListener("click", () => {
            const mode = card.dataset.mode;
            switchMode(mode);
        });
    });
}

function switchMode(mode) {
    state.currentMode = mode;

    // Update active card
    document.querySelectorAll(".mode-card").forEach((card) => {
        card.classList.remove("active");
    });
    document.querySelector(`[data-mode="${mode}"]`).classList.add("active");

    // Hide all mode panels
    document.getElementById("mode-request").style.display = "none";
    document.getElementById("mode-response").style.display = "none";
    document.getElementById("mode-compare").style.display = "none";

    // Show selected mode panel
    const modePanel = document.getElementById(`mode-${mode}`);
    if (modePanel) {
        modePanel.style.display = "block";
    }

    // Update description
    const descriptions = {
        request: "Paste or upload a bid request to inspect signals and validation",
        response: "Paste or upload a bid response to analyze seats and bids",
        compare: "Upload both request and response to validate matching and compliance"
    };
    document.getElementById("mode-description").textContent = descriptions[mode];

    clearAll();
}

/* Input Tabs */
function bindInputTabs() {
    document.querySelectorAll(".input-tab").forEach((tab) => {
        tab.addEventListener("click", (e) => {
            const tabName = tab.dataset.tab;
            const tabsContainer = tab.closest(".input-tabs");
            const contentContainer = tabsContainer.nextElementSibling;

            // Remove active from all tabs in this group
            tabsContainer.querySelectorAll(".input-tab").forEach((t) => {
                t.classList.remove("active");
            });
            tab.classList.add("active");

            // Hide all content in this section
            let current = contentContainer;
            while (current && !current.classList.contains("input-panel") && !current.classList.contains("compare-inputs")) {
                if (current.classList.contains("input-tab-content")) {
                    current.classList.remove("active");
                    current.style.display = "none";
                }
                current = current.nextElementSibling;
            }

            // Show selected tab content
            const tabContent = contentContainer.querySelector(`[id*="${tabName}"]`);
            if (tabContent) {
                tabContent.classList.add("active");
                tabContent.style.display = "block";
            }
        });
    });
}

function bindActions() {
    document.getElementById("analyze-btn").addEventListener("click", analyzeWorkflow);
    document.getElementById("clear-btn").addEventListener("click", clearAll);
    document.getElementById("copy-report-btn").addEventListener("click", copyReport);
    document.getElementById("export-html-btn").addEventListener("click", exportHtmlReport);
    document.getElementById("export-json-btn").addEventListener("click", exportJsonReport);

    // Load sample buttons
    bindSampleButtons();
}

function bindSampleButtons() {
    document.querySelectorAll("[id*='load-'][id*='-sample-btn']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            const btnId = btn.id;
            const mode = btnId.includes("request") ? "request" : btnId.includes("response") ? "response" : "compare";
            const selectId = btnId.replace("-btn", "");
            const select = document.getElementById(selectId);
            applySelectedSample(select);
        });
    });
}

async function loadSamples() {
    try {
        const response = await fetch("/samples");
        const data = await response.json();
        state.samples = data.samples || [];

        populateSampleSelect("request-sample", "request");
        populateSampleSelect("response-sample", "response");
        populateSampleSelect("compare-request-sample", "request");
        populateSampleSelect("compare-response-sample", "response");
    } catch (error) {
        showStatus("Unable to load sample files.", "error");
    }
}

function populateSampleSelect(selectId, kind) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const samples = state.samples.filter((sample) => sample.kind === kind);
    select.innerHTML = `<option value="">Choose a ${kind} sample</option>`;
    samples.forEach((sample) => {
        const option = document.createElement("option");
        option.value = sample.name;
        option.textContent = sample.name;
        select.appendChild(option);
    });
}

function applySelectedSample(select) {
    if (!select || !select.value) {
        showStatus("Choose a sample first.", "info");
        return;
    }

    const sample = state.samples.find((item) => item.name === select.value);
    if (!sample) return;

    const selectId = select.id;
    const textareaId = selectId.replace("-sample", "-raw");
    const textarea = document.getElementById(textareaId);

    if (textarea) {
        textarea.value = sample.content;
        showStatus(`${sample.name} loaded.`, "info");
    }
}

function clearAll() {
    if (state.currentMode === "request") {
        document.getElementById("request-raw").value = "";
        document.getElementById("request-url").value = "";
        document.getElementById("request-file").value = "";
        document.getElementById("request-sample").value = "";
    } else if (state.currentMode === "response") {
        document.getElementById("response-raw").value = "";
        document.getElementById("response-url").value = "";
        document.getElementById("response-file").value = "";
        document.getElementById("response-sample").value = "";
    } else if (state.currentMode === "compare") {
        document.getElementById("compare-request-raw").value = "";
        document.getElementById("compare-request-file").value = "";
        document.getElementById("compare-request-sample").value = "";
        document.getElementById("compare-response-raw").value = "";
        document.getElementById("compare-response-file").value = "";
        document.getElementById("compare-response-sample").value = "";
    }

    state.report = null;
    updateExportButtons(false);
    document.getElementById("results").classList.add("hidden");
    document.getElementById("results-placeholder").classList.remove("hidden");
}

function panelHasInput(target) {
    const raw = document.getElementById(`${target}-raw`)?.value.trim() || "";
    const url = document.getElementById(`${target}-url`)?.value.trim() || "";
    const file = document.getElementById(`${target}-file`)?.files[0];
    return Boolean(raw || url || file);
}

function buildFormData(target) {
    const formData = new FormData();
    formData.append("raw_text", document.getElementById(`${target}-raw`)?.value || "");
    formData.append("source_url", document.getElementById(`${target}-url`)?.value || "");
    const file = document.getElementById(`${target}-file`)?.files[0];
    if (file) {
        formData.append("file", file);
    }
    return formData;
}

async function analyzeWorkflow() {
    let report = {
        request: null,
        response: null,
        comparison: null,
        createdAt: new Date().toISOString(),
    };

    try {
        if (state.currentMode === "request") {
            if (!panelHasInput("request")) {
                showStatus("Upload or paste a bid request to analyze.", "error");
                return;
            }
            showStatus("Analyzing bid request...", "info");
            report.request = await postForm("/analyze/request", buildFormData("request"));
        } else if (state.currentMode === "response") {
            if (!panelHasInput("response")) {
                showStatus("Upload or paste a bid response to analyze.", "error");
                return;
            }
            showStatus("Analyzing bid response...", "info");
            report.response = await postForm("/analyze/response", buildFormData("response"));
        } else if (state.currentMode === "compare") {
            const hasRequest = panelHasInput("compare-request");
            const hasResponse = panelHasInput("compare-response");

            if (!hasRequest || !hasResponse) {
                showStatus("Provide both bid request and response to compare.", "error");
                return;
            }

            showStatus("Analyzing and comparing...", "info");
            report.request = await postForm("/analyze/request", buildFormData("compare-request"));
            report.response = await postForm("/analyze/response", buildFormData("compare-response"));

            if (report.request?.raw_payload && report.response?.raw_payload) {
                report.comparison = await postJson("/analyze/compare", {
                    request_payload: report.request.raw_payload,
                    response_payload: report.response.raw_payload,
                    request_analysis: report.request,
                    response_analysis: report.response,
                });
            }
        }

        state.report = report;
        renderReport(report);
        updateExportButtons(true);
        showStatus("Analysis complete.", "success");
    } catch (error) {
        showStatus(`Analysis failed: ${error.message}`, "error");
    }
}

async function postForm(url, formData) {
    const response = await fetch(url, {
        method: "POST",
        body: formData,
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

async function postJson(url, body) {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

function renderReport(report) {
    document.getElementById("results-placeholder").classList.add("hidden");
    document.getElementById("results").classList.remove("hidden");

    const statusEl = document.getElementById("results-status");
    if (report.request && report.response && report.comparison) {
        statusEl.textContent = report.comparison?.overall_status || "Complete";
        statusEl.className = "status-badge " + (report.comparison?.overall_status === "pass" ? "success" : "warning");
    } else if (report.request) {
        statusEl.textContent = "Request Analyzed";
        statusEl.className = "status-badge success";
    } else if (report.response) {
        statusEl.textContent = "Response Analyzed";
        statusEl.className = "status-badge success";
    }

    renderOverview(report);
    renderRequestSummary(report.request);
    renderResponseSummary(report.response);
    renderTypeDetection(report.request);
    renderComparison(report.comparison);
    renderHuman(report);
    renderInterpretation(report);
    renderWarnings(report);
    renderRaw(report);
    renderInterview(report);
}

function renderOverview(report) {
    const content = document.getElementById("tab-overview");
    let html = "<div style='display: grid; gap: 1rem;'>";

    if (report.request) {
        html += `<div style='padding: 1rem; background: white; border-radius: 8px; border-left: 4px solid #3b82f6;'>
            <h3>Request</h3>
            <p><strong>ID:</strong> ${report.request.summary?.request_id || "—"}</p>
            <p><strong>Format:</strong> ${report.request.summary?.ad_format || "—"}</p>
            <p><strong>Environment:</strong> ${report.request.summary?.environment_guess || "—"}</p>
        </div>`;
    }

    if (report.response) {
        html += `<div style='padding: 1rem; background: white; border-radius: 8px; border-left: 4px solid #10b981;'>
            <h3>Response</h3>
            <p><strong>Bids:</strong> ${report.response.summary?.bid_count || 0}</p>
            <p><strong>Seats:</strong> ${report.response.summary?.seat_count || 0}</p>
            <p><strong>Max Price:</strong> $${report.response.summary?.max_bid_price || "—"}</p>
        </div>`;
    }

    html += "</div>";
    content.innerHTML = html;
}

function renderRequestSummary(request) {
    const content = document.getElementById("tab-request-summary");
    if (!request) {
        content.innerHTML = "<p>No request data</p>";
        return;
    }

    let html = "<div style='display: grid; gap: 0.5rem;'>";
    for (const [key, value] of Object.entries(request.summary || {})) {
        html += `<div style='display: grid; grid-template-columns: 150px 1fr; gap: 1rem;'>
            <strong>${key}</strong>
            <span>${typeof value === "object" ? JSON.stringify(value) : value}</span>
        </div>`;
    }
    html += "</div>";
    content.innerHTML = html;
}

function renderResponseSummary(response) {
    const content = document.getElementById("tab-response-summary");
    if (!response) {
        content.innerHTML = "<p>No response data</p>";
        return;
    }

    let html = "<div style='display: grid; gap: 0.5rem;'>";
    for (const [key, value] of Object.entries(response.summary || {})) {
        html += `<div style='display: grid; grid-template-columns: 150px 1fr; gap: 1rem;'>
            <strong>${key}</strong>
            <span>${typeof value === "object" ? JSON.stringify(value) : value}</span>
        </div>`;
    }
    html += "</div>";
    content.innerHTML = html;
}

function renderTypeDetection(request) {
    const content = document.getElementById("tab-type-detection");
    if (!request?.request_type_detection) {
        content.innerHTML = "<p>No type detection data</p>";
        return;
    }

    const det = request.request_type_detection;
    let html = `<div style='display: grid; gap: 1rem;'>
        <div style='padding: 1rem; background: white; border-radius: 8px;'>
            <p><strong>Inventory:</strong> ${det.inventory_source || "—"}</p>
            <p><strong>Format:</strong> ${det.ad_format || "—"}</p>
            <p><strong>CTV Label:</strong> ${det.ctv_label || "—"} (Score: ${det.ctv_score || 0}/20)</p>
            <p><strong>Version:</strong> ${det.version_guess || "—"}</p>
        </div>
    </div>`;
    content.innerHTML = html;
}

function renderComparison(comparison) {
    const content = document.getElementById("tab-comparison");
    if (!comparison) {
        content.innerHTML = "<p>No comparison data. Analyze both request and response to compare.</p>";
        return;
    }

    let html = "<div style='display: grid; gap: 1rem;'>";
    for (const finding of comparison.comparison_findings || []) {
        html += `<div style='padding: 1rem; background: white; border-radius: 8px; border-left: 4px solid #f59e0b;'>
            ${finding}
        </div>`;
    }
    html += "</div>";
    content.innerHTML = html;
}

function renderHuman(report) {
    const content = document.getElementById("tab-human");
    const explanations = report.request?.human_explanations || [];
    let html = "<div style='display: grid; gap: 1rem;'>";
    for (const exp of explanations) {
        html += `<div style='padding: 1rem; background: white; border-radius: 8px;'>
            ${exp}
        </div>`;
    }
    html += "</div>";
    content.innerHTML = html || "<p>No explanations available</p>";
}

function renderInterpretation(report) {
    const content = document.getElementById("tab-interpretation");
    const signals = report.request?.inferred_signals || {};
    let html = "<div style='display: grid; gap: 0.5rem;'>";
    for (const [key, value] of Object.entries(signals)) {
        html += `<div style='display: grid; grid-template-columns: 150px 1fr; gap: 1rem;'>
            <strong>${key}</strong>
            <span>${typeof value === "object" ? JSON.stringify(value) : value}</span>
        </div>`;
    }
    html += "</div>";
    content.innerHTML = html || "<p>No signal data available</p>";
}

function renderWarnings(report) {
    const content = document.getElementById("tab-warnings");
    const warnings = [
        ...(report.request?.warnings || []),
        ...(report.response?.warnings || []),
    ];

    if (warnings.length === 0) {
        content.innerHTML = "<p style='color: #10b981;'>✓ No warnings</p>";
        return;
    }

    let html = "<div style='display: grid; gap: 0.5rem;'>";
    for (const warning of warnings) {
        html += `<div style='padding: 0.75rem; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px;'>
            ${warning}
        </div>`;
    }
    html += "</div>";
    content.innerHTML = html;
}

function renderRaw(report) {
    const content = document.getElementById("tab-raw");
    let html = "<pre style='background: #f3f4f6; padding: 1rem; border-radius: 8px; overflow-x: auto;'>";
    html += JSON.stringify(report, null, 2);
    html += "</pre>";
    content.innerHTML = html;
}

function renderInterview(report) {
    const content = document.getElementById("tab-interview");
    const points = report.request?.interview_points || [];
    let html = "<ul style='padding-left: 1.5rem;'>";
    for (const point of points) {
        html += `<li style='margin-bottom: 0.75rem;'>${point}</li>`;
    }
    html += "</ul>";
    content.innerHTML = html || "<p>No interview points available</p>";
}

function updateExportButtons(enabled) {
    document.getElementById("copy-report-btn").disabled = !enabled;
    document.getElementById("export-html-btn").disabled = !enabled;
    document.getElementById("export-json-btn").disabled = !enabled;
}

function copyReport() {
    const text = JSON.stringify(state.report, null, 2);
    navigator.clipboard.writeText(text).then(() => {
        showStatus("Report copied to clipboard.", "success");
    });
}

function exportHtmlReport() {
    const html = generateHtmlReport();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bid-analysis-${Date.now()}.html`;
    a.click();
    showStatus("HTML report downloaded.", "success");
}

function exportJsonReport() {
    const json = JSON.stringify(state.report, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bid-analysis-${Date.now()}.json`;
    a.click();
    showStatus("JSON report downloaded.", "success");
}

function generateHtmlReport() {
    return `<!DOCTYPE html>
<html>
<head>
    <title>Bid Analysis Report</title>
    <style>
        body { font-family: sans-serif; margin: 2rem; }
        pre { background: #f3f4f6; padding: 1rem; overflow-x: auto; }
    </style>
</head>
<body>
    <h1>Bid Analysis Report</h1>
    <p>Generated: ${new Date().toISOString()}</p>
    <pre>${JSON.stringify(state.report, null, 2)}</pre>
</body>
</html>`;
}

function showStatus(message, type) {
    const banner = document.getElementById("status-banner");
    banner.textContent = message;
    banner.className = `status-banner ${type}`;
    banner.classList.remove("hidden");

    setTimeout(() => {
        banner.classList.add("hidden");
    }, 5000);
}

/* Result Tab Navigation */
document.addEventListener("click", (e) => {
    if (e.target.closest(".result-tab")) {
        const tab = e.target.closest(".result-tab");
        const tabName = tab.dataset.tab;

        // Remove active from all tabs
        document.querySelectorAll(".result-tab").forEach((t) => {
            t.classList.remove("active");
        });

        // Hide all content
        document.querySelectorAll(".result-tab-content").forEach((content) => {
            content.classList.remove("active");
        });

        // Set active
        tab.classList.add("active");
        document.getElementById(`tab-${tabName}`).classList.add("active");
    }
});
