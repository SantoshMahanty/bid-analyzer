const state = {
    samples: [],
    report: null,
};

document.addEventListener("DOMContentLoaded", () => {
    bindTabNavigation();
    bindActions();
    loadSamples();
});

function bindActions() {
    document.getElementById("analyze-btn").addEventListener("click", analyzeWorkflow);
    document.getElementById("load-default-btn").addEventListener("click", loadDefaultSamples);
    document.getElementById("clear-btn").addEventListener("click", clearAll);
    document.getElementById("copy-report-btn").addEventListener("click", copyReport);
    document.getElementById("export-html-btn").addEventListener("click", exportHtmlReport);
    document.getElementById("export-json-btn").addEventListener("click", exportJsonReport);

    document.querySelectorAll("[data-load-sample]").forEach((button) => {
        button.addEventListener("click", () => {
            const target = button.dataset.loadSample;
            applySelectedSample(target);
        });
    });
}

function bindTabNavigation() {
    document.querySelectorAll(".tab-button").forEach((button) => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
            button.classList.add("active");
            document.getElementById(`tab-${button.dataset.tab}`).classList.add("active");
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
    } catch (error) {
        showStatus("Unable to load sample files.", "error");
    }
}

function populateSampleSelect(selectId, kind) {
    const select = document.getElementById(selectId);
    const samples = state.samples.filter((sample) => sample.kind === kind);
    select.innerHTML = `<option value="">Choose a ${kind} sample</option>`;
    samples.forEach((sample) => {
        const option = document.createElement("option");
        option.value = sample.name;
        option.textContent = sample.name;
        select.appendChild(option);
    });
}

function applySelectedSample(target) {
    const select = document.getElementById(`${target}-sample`);
    const sample = state.samples.find((item) => item.name === select.value);
    if (!sample) {
        showStatus(`Choose a ${target} sample first.`, "info");
        return;
    }
    document.getElementById(`${target}-raw`).value = sample.content;
    document.getElementById(`${target}-url`).value = "";
    document.getElementById(`${target}-file`).value = "";
    showStatus(`${sample.name} loaded into the ${target} panel.`, "info");
}

function loadDefaultSamples() {
    const requestSample = state.samples.find((sample) => sample.name === "sample_request_ctv.json");
    const responseSample = state.samples.find((sample) => sample.name === "sample_response_ctv.json");
    if (requestSample) {
        document.getElementById("request-raw").value = requestSample.content;
    }
    if (responseSample) {
        document.getElementById("response-raw").value = responseSample.content;
    }
    showStatus("Loaded the default CTV request and response samples.", "info");
}

function clearAll() {
    ["request", "response"].forEach((target) => {
        document.getElementById(`${target}-raw`).value = "";
        document.getElementById(`${target}-url`).value = "";
        document.getElementById(`${target}-file`).value = "";
        document.getElementById(`${target}-sample`).value = "";
        document.getElementById(`${target}-source-pill`).textContent = "Idle";
    });
    state.report = null;
    updateExportButtons(false);
    document.getElementById("results").classList.add("hidden");
    document.getElementById("results-placeholder").classList.remove("hidden");
    document.getElementById("overall-status").textContent = "Ready";
    document.getElementById("overall-status").className = "status-chip neutral";
    hideStatus();
}

function panelHasInput(target) {
    const raw = document.getElementById(`${target}-raw`).value.trim();
    const url = document.getElementById(`${target}-url`).value.trim();
    const file = document.getElementById(`${target}-file`).files[0];
    return Boolean(raw || url || file);
}

function buildFormData(target) {
    const formData = new FormData();
    formData.append("raw_text", document.getElementById(`${target}-raw`).value);
    formData.append("source_url", document.getElementById(`${target}-url`).value);
    const file = document.getElementById(`${target}-file`).files[0];
    if (file) {
        formData.append("file", file);
    }
    return formData;
}

async function analyzeWorkflow() {
    const hasRequest = panelHasInput("request");
    const hasResponse = panelHasInput("response");

    if (!hasRequest && !hasResponse) {
        showStatus("Enter a request, a response, or both before analyzing.", "error");
        return;
    }

    setBusy(true);
    showStatus("Analyzing payloads and applying OpenRTB-aware rules.", "info");

    try {
        const report = {
            request: null,
            response: null,
            comparison: null,
            createdAt: new Date().toISOString(),
        };

        if (hasRequest) {
            report.request = await postForm("/analyze/request", buildFormData("request"));
            applySourcePill("request", report.request);
        }

        if (hasResponse) {
            report.response = await postForm("/analyze/response", buildFormData("response"));
            applySourcePill("response", report.response);
        }

        if (report.request?.raw_payload && report.response?.raw_payload) {
            report.comparison = await postJson("/analyze/compare", {
                request_payload: report.request.raw_payload,
                response_payload: report.response.raw_payload,
                request_analysis: report.request,
                response_analysis: report.response,
            });
        }

        state.report = report;
        renderReport(report);
        updateExportButtons(true);
        showStatus("Analysis complete.", "info");
    } catch (error) {
        showStatus(`Analysis failed: ${error.message}`, "error");
    } finally {
        setBusy(false);
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

function applySourcePill(target, analysis) {
    const pill = document.getElementById(`${target}-source-pill`);
    const source = analysis?.input_source?.source_type || "unknown";
    pill.textContent = `${source} | ${analysis?.parse_status || "unknown"}`;
}

function renderReport(report) {
    document.getElementById("results-placeholder").classList.add("hidden");
    document.getElementById("results").classList.remove("hidden");

    const comparisonStatus = report.comparison?.overall_status || "neutral";
    const overall = document.getElementById("overall-status");
    overall.textContent = comparisonStatus === "neutral" ? "Single payload analysis" : comparisonStatus;
    overall.className = `status-chip ${statusClass(comparisonStatus)}`;

    renderSnapshot(report);
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

function renderSnapshot(report) {
    const snapshot = document.getElementById("results-snapshot");
    const requestState = report.request
        ? `${report.request.summary?.inventory_source || "unknown"} / ${report.request.summary?.ad_format || "unknown"}`
        : "No request provided";
    const responseState = report.response
        ? `${report.response.summary?.bid_count ?? 0} bids across ${report.response.summary?.seat_count ?? 0} seats`
        : "No response provided";
    const validationState = [
        ...(report.request?.errors || []),
        ...(report.response?.errors || []),
    ].length
        ? "Errors detected"
        : [
            ...(report.request?.warnings || []),
            ...(report.response?.warnings || []),
        ].length
            ? "Warnings detected"
            : "No major issues";
    const comparisonState = report.comparison
        ? `${report.comparison.overall_status} with ${report.comparison.summary?.matched_impids?.length || 0} mapped imp ids`
        : "Comparison unavailable";

    snapshot.innerHTML = [
        snapshotCard("Request profile", requestState),
        snapshotCard("Response profile", responseState),
        snapshotCard("Validation", validationState),
        snapshotCard("Compare status", comparisonState),
    ].join("");
}

function renderOverview(report) {
    const cards = [];
    if (report.request) {
        cards.push(metricCard("Request Type", report.request.request_type_detection?.request_type_sentence || "Request analyzed", report.request.input_source?.source_type || "unknown"));
        cards.push(metricCard("Request Impressions", report.request.summary?.impression_count ?? 0, `Format: ${report.request.summary?.ad_format || "unknown"}`));
    }
    if (report.response) {
        cards.push(metricCard("Response Bids", report.response.summary?.bid_count ?? 0, `Seats: ${report.response.summary?.seat_count ?? 0}`));
        cards.push(metricCard("Response Validity", report.response.summary?.looks_valid ? "Looks valid" : "Suspicious", report.response.summary?.creative_metadata || "unknown"));
    }
    if (report.comparison) {
        cards.push(metricCard("Comparison", report.comparison.overall_status, `${report.comparison.summary?.matched_impids?.length || 0} matched imp ids`));
    }

    document.getElementById("tab-overview").innerHTML = `
        <div class="overview-grid">${cards.join("")}</div>
    `;
}

function renderRequestSummary(request) {
    const container = document.getElementById("tab-request-summary");
    if (!request) {
        container.innerHTML = emptyState("No bid request was provided.");
        return;
    }

    container.innerHTML = `
        <div class="analysis-grid">
            ${detailCard("Request Summary", keyValueTable(request.summary))}
            ${detailCard("Input Source", keyValueTable(request.input_source))}
            ${detailCard("Parsed Fields Snapshot", keyValueTable(request.parsed_fields.top_level || {}))}
        </div>
    `;
}

function renderResponseSummary(response) {
    const container = document.getElementById("tab-response-summary");
    if (!response) {
        container.innerHTML = emptyState("No bid response was provided.");
        return;
    }

    container.innerHTML = `
        <div class="analysis-grid">
            ${detailCard("Response Summary", keyValueTable(response.summary))}
            ${detailCard("Input Source", keyValueTable(response.input_source))}
            ${detailCard("Response Fields", keyValueTable(response.parsed_fields.top_level || {}))}
        </div>
    `;
}

function renderTypeDetection(request) {
    const container = document.getElementById("tab-type-detection");
    if (!request) {
        container.innerHTML = emptyState("Request type detection is only available when a bid request is analyzed.");
        return;
    }

    const detection = request.request_type_detection || {};
    container.innerHTML = `
        <div class="cards-grid">
            ${metricCard("Inventory Source", detection.inventory_source || "unknown", "source")}
            ${metricCard("Ad Format", detection.ad_format || "unknown", "format")}
            ${metricCard("Environment", detection.environment_guess || "unknown", "environment")}
            ${metricCard("Deal Type", detection.deal_type || "unknown", "auction path")}
            ${metricCard("Auction Model", detection.auction_model || "unknown", "pricing")}
            ${metricCard("Version Guess", detection.version_guess || "unknown", detection.version_confidence || "confidence")}
            ${metricCard("CTV Score", detection.ctv_score ?? 0, detection.ctv_label || "unknown")}
        </div>
        <div class="analysis-grid">
            ${detailCard("Structured Request Type Sentence", `<p>${escapeHtml(detection.request_type_sentence || "No request type sentence generated.")}</p>`)}
            ${detailCard("Traffic Quality Notes", keyValueTable(detection.traffic_quality_notes || {}))}
            ${detailCard("CTV Reasons", listMarkup(detection.ctv_reasons || []))}
        </div>
    `;
}

function renderComparison(comparison) {
    const container = document.getElementById("tab-comparison");
    if (!comparison) {
        container.innerHTML = emptyState("Comparison runs when both a request and response are available.");
        return;
    }

    const checks = (comparison.checks || []).map((check) => `
        <div class="detail-card">
            <div class="panel-heading">
                <h4>${escapeHtml(check.label)}</h4>
                <span class="badge ${statusClass(check.status)}">${escapeHtml(check.status)}</span>
            </div>
            <p class="muted">${escapeHtml(check.message)}</p>
        </div>
    `).join("");

    container.innerHTML = `
        <div class="analysis-grid">
            ${detailCard("Comparison Summary", keyValueTable(comparison.summary || {}))}
        </div>
        <div class="analysis-grid">${checks}</div>
    `;
}

function renderHuman(report) {
    const lists = [];
    if (report.request) {
        lists.push(detailCard("Request Explanations", listMarkup(report.request.human_explanations || [])));
    }
    if (report.response) {
        lists.push(detailCard("Response Explanations", listMarkup(report.response.human_explanations || [])));
    }

    document.getElementById("tab-human").innerHTML = lists.length
        ? `<div class="analysis-grid">${lists.join("")}</div>`
        : emptyState("No human-readable explanations are available yet.");
}

function renderInterpretation(report) {
    const items = [];
    if (report.request) {
        items.push(detailCard("Request Signals", keyValueTable(report.request.inferred_signals || {})));
    }
    if (report.response) {
        items.push(detailCard("Response Signals", keyValueTable(report.response.inferred_signals || {})));
    }

    document.getElementById("tab-interpretation").innerHTML = items.length
        ? `<div class="analysis-grid">${items.join("")}</div>`
        : emptyState("No interpretation data available.");
}

function renderWarnings(report) {
    const cards = [];

    if (report.request) {
        cards.push(detailCard("Request Warnings", listMarkup(report.request.warnings || [])));
        cards.push(detailCard("Request Errors", listMarkup(report.request.errors || [])));
    }

    if (report.response) {
        cards.push(detailCard("Response Warnings", listMarkup(report.response.warnings || [])));
        cards.push(detailCard("Response Errors", listMarkup(report.response.errors || [])));
    }

    if (report.comparison) {
        const failedChecks = (report.comparison.checks || [])
            .filter((check) => check.status !== "PASS")
            .map((check) => `${check.status}: ${check.label} - ${check.message}`);
        cards.push(detailCard("Comparison Findings", listMarkup(failedChecks)));
    }

    document.getElementById("tab-warnings").innerHTML = cards.length
        ? `<div class="analysis-grid">${cards.join("")}</div>`
        : emptyState("No warnings or errors to show.");
}

function renderRaw(report) {
    const sections = [];
    if (report.request) {
        sections.push(detailCard("Request Parsed Fields", detailsBlock("View parsed request fields", report.request.parsed_fields)));
        sections.push(detailCard("Request Raw Payload", detailsBlock("View request JSON", report.request.raw_payload)));
    }
    if (report.response) {
        sections.push(detailCard("Response Parsed Fields", detailsBlock("View parsed response fields", report.response.parsed_fields)));
        sections.push(detailCard("Response Raw Payload", detailsBlock("View response JSON", report.response.raw_payload)));
    }

    document.getElementById("tab-raw").innerHTML = sections.length
        ? `<div class="raw-grid">${sections.join("")}</div>`
        : emptyState("No raw payloads available.");
}

function renderInterview(report) {
    const cards = [];
    if (report.request) {
        cards.push(detailCard("Request Interview Points", listMarkup(report.request.interview_points || [])));
    }
    if (report.response) {
        cards.push(detailCard("Response Interview Points", listMarkup(report.response.interview_points || [])));
    }

    const comparisonPoints = [];
    if (report.comparison) {
        comparisonPoints.push(`Overall request/response check status is ${report.comparison.overall_status}.`);
        if ((report.comparison.summary?.below_floor_bids || 0) > 0) {
            comparisonPoints.push("At least one response bid is below the request floor.");
        }
        if ((report.comparison.summary?.deal_mismatches || 0) > 0) {
            comparisonPoints.push("A response deal id does not map back to the request deal list.");
        }
        if ((report.comparison.summary?.matched_impids || []).length > 0) {
            comparisonPoints.push("Some response bids map cleanly to request impression ids.");
        }
    }

    if (comparisonPoints.length) {
        cards.push(detailCard("Comparison Interview Points", listMarkup(comparisonPoints)));
    }

    document.getElementById("tab-interview").innerHTML = cards.length
        ? `<div class="analysis-grid">${cards.join("")}</div>`
        : emptyState("No interview-ready points available.");
}

function metricCard(title, value, subtitle) {
    return `
        <article class="card">
            <p class="panel-kicker">${escapeHtml(title)}</p>
            <div class="metric-value">${escapeHtml(String(value))}</div>
            <p class="muted">${escapeHtml(String(subtitle || ""))}</p>
        </article>
    `;
}

function snapshotCard(title, value) {
    return `
        <article class="snapshot-card">
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(String(value))}</span>
        </article>
    `;
}

function detailCard(title, content) {
    return `
        <article class="detail-card">
            <h3>${escapeHtml(title)}</h3>
            ${content}
        </article>
    `;
}

function keyValueTable(data) {
    const entries = Object.entries(data || {});
    if (!entries.length) {
        return `<p class="muted">No fields available.</p>`;
    }
    return `
        <table class="kv-table">
            <tbody>
                ${entries.map(([key, value]) => `
                    <tr>
                        <td>${escapeHtml(key)}</td>
                        <td>${formatValue(value)}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function listMarkup(items) {
    if (!items || !items.length) {
        return `<p class="muted">No items to show.</p>`;
    }
    return `<ul class="list">${items.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("")}</ul>`;
}

function detailsBlock(label, data) {
    return `
        <details class="details-block">
            <summary>${escapeHtml(label)}</summary>
            <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
        </details>
    `;
}

function emptyState(message) {
    return `<div class="detail-card"><p class="muted">${escapeHtml(message)}</p></div>`;
}

function formatValue(value) {
    if (value === null || value === undefined) {
        return `<span class="muted">-</span>`;
    }
    if (typeof value === "object") {
        return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
    }
    return escapeHtml(String(value));
}

function showStatus(message, type = "info") {
    const banner = document.getElementById("status-banner");
    banner.textContent = message;
    banner.className = `status-banner ${type}`;
}

function hideStatus() {
    const banner = document.getElementById("status-banner");
    banner.textContent = "";
    banner.className = "status-banner hidden";
}

function setBusy(isBusy) {
    document.getElementById("analyze-btn").disabled = isBusy;
    document.getElementById("load-default-btn").disabled = isBusy;
    document.getElementById("clear-btn").disabled = isBusy;
}

function updateExportButtons(enabled) {
    document.getElementById("copy-report-btn").disabled = !enabled;
    document.getElementById("export-html-btn").disabled = !enabled;
    document.getElementById("export-json-btn").disabled = !enabled;
}

function statusClass(status) {
    if (status === "PASS") return "status-pass";
    if (status === "WARNING") return "status-warning";
    if (status === "FAIL") return "status-fail";
    return "neutral";
}

async function copyReport() {
    if (!state.report) return;
    const text = composeReportText(state.report);
    await navigator.clipboard.writeText(text);
    showStatus("Copied readable report to the clipboard.", "info");
}

function exportJsonReport() {
    if (!state.report) return;
    downloadBlob("bid-analyzer-report.json", JSON.stringify(state.report, null, 2), "application/json");
}

function exportHtmlReport() {
    if (!state.report) return;
    const text = composeReportText(state.report)
        .split("\n")
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("");
    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Bid Analyzer Report</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 32px; line-height: 1.55; color: #1b2330; }
                h1 { margin-bottom: 8px; }
                .section { margin-top: 24px; }
            </style>
        </head>
        <body>
            <h1>Bid Analyzer Report</h1>
            <div class="section">${text}</div>
        </body>
        </html>
    `;
    downloadBlob("bid-analyzer-report.html", html, "text/html");
}

function composeReportText(report) {
    const lines = [];
    lines.push("Bid Analyzer Report");
    lines.push(`Created: ${report.createdAt}`);
    lines.push("");

    if (report.request) {
        lines.push("Request Overview");
        lines.push(`- Type sentence: ${report.request.request_type_detection?.request_type_sentence || "n/a"}`);
        lines.push(`- Impression count: ${report.request.summary?.impression_count ?? 0}`);
        lines.push(`- Environment: ${report.request.summary?.environment_guess || "unknown"}`);
        lines.push(`- Deal type: ${report.request.summary?.deal_type || "unknown"}`);
        lines.push("");
    }

    if (report.response) {
        lines.push("Response Overview");
        lines.push(`- Seats: ${report.response.summary?.seat_count ?? 0}`);
        lines.push(`- Bids: ${report.response.summary?.bid_count ?? 0}`);
        lines.push(`- Creative metadata: ${report.response.summary?.creative_metadata || "unknown"}`);
        lines.push("");
    }

    if (report.comparison) {
        lines.push("Comparison");
        lines.push(`- Overall status: ${report.comparison.overall_status}`);
        (report.comparison.checks || []).forEach((check) => {
            lines.push(`- ${check.status}: ${check.label} -> ${check.message}`);
        });
        lines.push("");
    }

    const warnings = [
        ...(report.request?.warnings || []),
        ...(report.request?.errors || []),
        ...(report.response?.warnings || []),
        ...(report.response?.errors || []),
    ];
    if (warnings.length) {
        lines.push("Warnings and Errors");
        warnings.forEach((item) => lines.push(`- ${item}`));
    }

    return lines.join("\n");
}

function downloadBlob(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
