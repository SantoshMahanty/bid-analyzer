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
    setupResultTabs();
    setupJSONValidation();
    initializeTheme();
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
    document.getElementById("batch-file").addEventListener("change", (e) => {
        handleFileUpload(e, "batch");
    });
}

function switchMode(mode) {
    state.currentMode = mode;

    // Update button states
    document.querySelectorAll(".mode-option").forEach(btn => {
        btn.classList.remove("active");
    });
    document.querySelector(`.mode-option[data-mode="${mode}"]`).classList.add("active");

    // Update content visibility
    document.querySelectorAll(".mode-content").forEach(el => el.style.display = "none");
    document.getElementById(`input-${mode}`).style.display = "block";

    // Compare mode has its own textareas; carry over what the user already
    // typed so switching to it doesn't mean re-pasting. Never overwrites.
    if (mode === "compare") {
        copyIfEmpty("request-raw", "compare-request-raw");
        copyIfEmpty("response-raw", "compare-response-raw");
    }
    // Deliberately no clearInputs() here — switching modes must not discard
    // input. Each mode owns separate fields, and Clear stays available.
}

function copyIfEmpty(fromId, toId) {
    const from = document.getElementById(fromId);
    const to = document.getElementById(toId);
    if (from && to && from.value.trim() && !to.value.trim()) {
        to.value = from.value;
    }
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
        else if (state.currentMode === "batch") {
            const rawText = document.getElementById("batch-raw").value.trim();
            if (!rawText) {
                showStatus("Paste or upload a batch of payloads", "error");
                return;
            }
            const formData = new FormData();
            formData.append("raw_text", rawText);
            formData.append("mode", document.getElementById("batch-mode").value);
            const batch = await postForm("/analyze/batch", formData);

            state.report = { batch };
            displayBatchResults(batch);
            const analyzed = batch.aggregates?.entries_analyzed || 0;
            showStatus(analyzed ? `Analyzed ${analyzed} entries` : "Nothing could be analyzed", analyzed ? "success" : "error");
            return;
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
    document.getElementById("export-group").hidden = false;

    // Phase 3: Enhanced Overview with KPI Metrics Dashboard
    let overviewHtml = "<div style='display: grid; gap: 2rem;'>";

    if (report.request) {
        const det = report.request.request_type_detection || {};
        const ctvScore = det.ctv_score || 0;
        // Scale comes from the backend so the bar can actually reach 100%.
        const ctvMax = det.ctv_score_max || 14;
        const ctvPercent = Math.min((ctvScore / ctvMax) * 100, 100);
        overviewHtml += `
            <div style='background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2rem; border-radius: 16px; box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);'>
                <div style='display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;'>
                    <div>
                        <h3 style='margin: 0; font-size: 1.5rem;'>📋 Bid Request</h3>
                        <p style='margin: 0.5rem 0 0 0; opacity: 0.9; font-size: 0.9rem;'>${report.request.summary?.ad_format || "Standard"} • ${report.request.summary?.environment_guess || "Web"}</p>
                    </div>
                    <div style='text-align: right;'>
                        <div style='font-size: 2rem; font-weight: 800;'>${report.request.summary?.impression_count || 1}</div>
                        <div style='font-size: 0.85rem; opacity: 0.9;'>Impressions</div>
                    </div>
                </div>

                <div style='display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;'>
                    <div style='background: rgba(255,255,255,0.15); padding: 1rem; border-radius: 10px;'>
                        <div style='font-size: 0.75rem; opacity: 0.9; margin-bottom: 0.5rem;'>Request ID</div>
                        <div style='font-size: 0.85rem; word-break: break-all;'>${(report.request.summary?.request_id || "—").substring(0, 12)}</div>
                    </div>
                    <div style='background: rgba(255,255,255,0.15); padding: 1rem; border-radius: 10px;'>
                        <div style='font-size: 0.75rem; opacity: 0.9; margin-bottom: 0.5rem;'>Devices</div>
                        <div style='font-size: 0.85rem;'>${report.request.summary?.device_type_count || 1} types</div>
                    </div>
                    <div style='background: rgba(255,255,255,0.15); padding: 1rem; border-radius: 10px;'>
                        <div style='font-size: 0.75rem; opacity: 0.9; margin-bottom: 0.5rem;'>Publishers</div>
                        <div style='font-size: 0.85rem;'>${report.request.summary?.publisher_count || 1}</div>
                    </div>
                </div>

                <div style='margin-top: 1.5rem;'>
                    <div style='display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;'>
                        <span style='font-size: 0.9rem;'>🎯 CTV Confidence Score</span>
                        <span style='font-size: 1rem; font-weight: 700;'>${ctvScore}/${ctvMax}</span>
                    </div>
                    <div style='background: rgba(255,255,255,0.2); border-radius: 10px; height: 10px; overflow: hidden;'>
                        <div style='background: linear-gradient(90deg, #4ade80, #fbbf24, #ef4444); width: ${ctvPercent}%; height: 100%; transition: width 0.3s;'></div>
                    </div>
                    <div style='font-size: 0.75rem; margin-top: 0.5rem; opacity: 0.8;'>${det.ctv_label || "Analyzing..."}</div>
                </div>
            </div>`;
    }

    if (report.response) {
        const bidCount = report.response.summary?.bid_count || 0;
        const seatCount = report.response.summary?.seat_count || 0;
        overviewHtml += `
            <div style='background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 2rem; border-radius: 16px; box-shadow: 0 10px 30px rgba(245, 87, 108, 0.3);'>
                <div style='display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;'>
                    <div>
                        <h3 style='margin: 0; font-size: 1.5rem;'>📨 Bid Response</h3>
                        <p style='margin: 0.5rem 0 0 0; opacity: 0.9; font-size: 0.9rem;'>${bidCount > 0 ? "Active Bids" : "No Bids"} • ${seatCount} Seat${seatCount !== 1 ? "s" : ""}</p>
                    </div>
                    <div style='text-align: right;'>
                        <div style='font-size: 2rem; font-weight: 800;'>$${report.response.summary?.max_bid_price || "0"}</div>
                        <div style='font-size: 0.85rem; opacity: 0.9;'>Max Bid</div>
                    </div>
                </div>

                <div style='display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;'>
                    <div style='background: rgba(255,255,255,0.15); padding: 1rem; border-radius: 10px; text-align: center;'>
                        <div style='font-size: 1.5rem; font-weight: 700;'>${bidCount}</div>
                        <div style='font-size: 0.75rem; opacity: 0.9;'>Total Bids</div>
                    </div>
                    <div style='background: rgba(255,255,255,0.15); padding: 1rem; border-radius: 10px; text-align: center;'>
                        <div style='font-size: 1.5rem; font-weight: 700;'>${seatCount}</div>
                        <div style='font-size: 0.75rem; opacity: 0.9;'>Seat Count</div>
                    </div>
                    <div style='background: rgba(255,255,255,0.15); padding: 1rem; border-radius: 10px; text-align: center;'>
                        <div style='font-size: 1.5rem; font-weight: 700;'>${report.response.summary?.avg_bid_price ? "$" + report.response.summary.avg_bid_price : "—"}</div>
                        <div style='font-size: 0.75rem; opacity: 0.9;'>Avg Bid</div>
                    </div>
                </div>

                <div style='margin-top: 1.5rem;'>
                    <div style='display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;'>
                        <span style='font-size: 0.9rem;'>📊 Response Health</span>
                        <span style='background: ${bidCount > 0 ? "rgba(74, 222, 128, 0.3)" : "rgba(239, 68, 68, 0.3)"}; padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.75rem; font-weight: 600;'>${bidCount > 0 ? "✓ Healthy" : "⚠️ No Bids"}</span>
                    </div>
                </div>
            </div>`;
    }

    overviewHtml += "</div>";
    document.getElementById("tab-overview").innerHTML = overviewHtml;

    // Phase 3: Enhanced Human Explanations Tab
    const explanations = report.request?.human_explanations || [];
    if (explanations.length > 0) {
        let html = `<div style='display: grid; gap: 1rem;'>
            <div style='background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 1.5rem; border-radius: 12px;'>
                <h3 style='margin: 0 0 0.5rem 0;'>💡 Key Insights</h3>
                <p style='margin: 0; opacity: 0.9; font-size: 0.9rem;'>${explanations.length} important finding${explanations.length !== 1 ? "s" : ""}</p>
            </div>

            <div style='display: grid; gap: 1rem;'>`;

        explanations.forEach((exp, i) => {
            const colors = ['#f0fdf4', '#d1fae5', '#a7f3d0'];
            const borderColors = ['#10b981', '#059669', '#047857'];
            html += `<div style='padding: 1.5rem; background: ${colors[i % 3]}; border-left: 4px solid ${borderColors[i % 3]}; border-radius: 10px;'>
                <div style='display: flex; gap: 0.75rem; align-items: flex-start;'>
                    <span style='font-size: 1.5rem;'>💡</span>
                    <div>
                        <div style='font-weight: 700; color: #047857; margin-bottom: 0.5rem;'>Insight ${i+1}</div>
                        <div style='color: #1f2937; line-height: 1.5;'>${exp}</div>
                    </div>
                </div>
            </div>`;
        });
        html += "</div></div>";
        if (document.getElementById("tab-human")) {
            document.getElementById("tab-human").innerHTML = html;
        }
    }

    // Phase 3: Enhanced Signals & CTV Tab
    const signals = report.request?.inferred_signals || {};
    if (Object.keys(signals).length > 0) {
        let html = `<div style='display: grid; gap: 1rem;'>
            <div style='background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); color: white; padding: 1.5rem; border-radius: 12px;'>
                <h3 style='margin: 0 0 0.5rem 0;'>📺 Detected Signals</h3>
                <p style='margin: 0; opacity: 0.9; font-size: 0.9rem;'>${Object.keys(signals).length} signal${Object.keys(signals).length !== 1 ? "s" : ""} identified</p>
            </div>

            <div style='display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem;'>`;

        for (const [key, value] of Object.entries(signals)) {
            let icon, bgColor, borderColor;
            if (key.includes('ctv')) {
                icon = '📺';
                bgColor = '#fdf2f8';
                borderColor = '#be185d';
            } else if (key.includes('version')) {
                icon = '📦';
                bgColor = '#eff6ff';
                borderColor = '#0369a1';
            } else if (key.includes('privacy')) {
                icon = '🔒';
                bgColor = '#f0fdf4';
                borderColor = '#059669';
            } else {
                icon = '🎯';
                bgColor = '#fefce8';
                borderColor = '#ca8a04';
            }

            html += `<div style='padding: 1.25rem; background: ${bgColor}; border-left: 4px solid ${borderColor}; border-radius: 10px;'>
                <div style='display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 0.75rem;'>
                    <span style='font-size: 1.5rem;'>${icon}</span>
                    <div style='font-weight: 700; flex: 1;'>${key.replace(/_/g, ' ').toUpperCase()}</div>
                </div>
                <div style='font-size: 0.9rem; color: #475569; line-height: 1.5;'>${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}</div>
            </div>`;
        }
        html += "</div></div>";
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

    /* Compare matrix. The backend returns {overall_status, checks[], summary};
       each check is {status: PASS|WARNING|FAIL, label, message}. */
    if (report.comparison) {
        const checks = report.comparison.checks || [];
        const summary = report.comparison.summary || {};
        const overall = report.comparison.overall_status || "UNKNOWN";

        const tone = {
            PASS: { bg: "#d1fae5", border: "#10b981", text: "#065f46", icon: "✅" },
            WARNING: { bg: "#fef3c7", border: "#f59e0b", text: "#78350f", icon: "⚠️" },
            FAIL: { bg: "#fee2e2", border: "#ef4444", text: "#7f1d1d", icon: "❌" }
        };
        const overallColor = { PASS: "#10b981", WARNING: "#f59e0b", FAIL: "#ef4444" }[overall] || "#667eea";

        const passed = checks.filter(c => c.status === "PASS").length;
        const warned = checks.filter(c => c.status === "WARNING").length;
        const failed = checks.filter(c => c.status === "FAIL").length;

        let html = `<div style='display: grid; gap: 1rem;'>
            <div style='background: ${overallColor}; color: white; padding: 1.5rem; border-radius: 12px;'>
                <h3 style='margin: 0 0 0.5rem 0;'>⚖️ Request vs Response — ${esc(overall)}</h3>
                <p style='margin: 0; opacity: 0.9; font-size: 0.9rem;'>${checks.length} check${checks.length !== 1 ? "s" : ""} run across ${summary.request_impression_count ?? 0} impression(s) and ${summary.response_bid_count ?? 0} bid(s)</p>
            </div>

            <div style='display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;'>
                <div style='background: #d1fae5; border-left: 4px solid #10b981; padding: 1rem; border-radius: 8px;'>
                    <div style='font-size: 1.5rem; font-weight: 700; color: #047857;'>${passed}</div>
                    <div style='font-size: 0.85rem; color: #065f46;'>✓ Passed</div>
                </div>
                <div style='background: #fef3c7; border-left: 4px solid #f59e0b; padding: 1rem; border-radius: 8px;'>
                    <div style='font-size: 1.5rem; font-weight: 700; color: #92400e;'>${warned}</div>
                    <div style='font-size: 0.85rem; color: #78350f;'>⚠️ Warnings</div>
                </div>
                <div style='background: #fee2e2; border-left: 4px solid #ef4444; padding: 1rem; border-radius: 8px;'>
                    <div style='font-size: 1.5rem; font-weight: 700; color: #991b1b;'>${failed}</div>
                    <div style='font-size: 0.85rem; color: #7f1d1d;'>❌ Failures</div>
                </div>
            </div>`;

        const blocked = (summary.blocklist_violations || 0) + (summary.seat_violations || 0);
        if (blocked || summary.below_floor_bids || summary.deal_mismatches || (summary.unmatched_impids || []).length) {
            const chips = [];
            if (summary.below_floor_bids) chips.push(`${summary.below_floor_bids} bid(s) below floor`);
            if (summary.deal_mismatches) chips.push(`${summary.deal_mismatches} deal mismatch(es)`);
            if (summary.blocklist_violations) chips.push(`${summary.blocklist_violations} blocklist violation(s)`);
            if (summary.seat_violations) chips.push(`${summary.seat_violations} seat violation(s)`);
            if ((summary.unmatched_impids || []).length) chips.push(`${summary.unmatched_impids.length} unmatched impid(s)`);
            html += `<div style='padding: 1rem 1.25rem; background: #fee2e2; border-left: 4px solid #ef4444; border-radius: 8px; color: #7f1d1d;'>
                <strong>Why this bid may be discarded:</strong> ${chips.map(esc).join(" • ")}
            </div>`;
        }

        html += "<div style='display: grid; gap: 0.75rem;'>";
        if (!checks.length) {
            html += `<div style='padding: 1.25rem; opacity: 0.7;'>No comparable fields were found in these two payloads.</div>`;
        }
        for (const check of checks) {
            const t = tone[check.status] || tone.WARNING;
            html += `<div style='padding: 1.25rem; background: ${t.bg}; border-left: 4px solid ${t.border}; border-radius: 8px; color: ${t.text};'>
                <div style='display: flex; gap: 0.75rem; align-items: flex-start;'>
                    <span style='font-size: 1.25rem;'>${t.icon}</span>
                    <div style='flex: 1;'>
                        <div style='font-weight: 600; margin-bottom: 0.25rem;'>${esc(check.label)}</div>
                        <div>${esc(check.message)}</div>
                    </div>
                </div>
            </div>`;
        }

        html += "</div></div>";
        document.getElementById("tab-compare").innerHTML = html;
    } else {
        document.getElementById("tab-compare").innerHTML = `<div style='padding: 2rem; text-align: center; color: #6b7280;'>
            <p style='font-size: 1rem; margin: 0;'>📊 Compare both request and response to see verification results</p>
            <p style='font-size: 0.85rem; margin: 0.5rem 0 0 0; opacity: 0.8;'>Paste or upload both payloads in Request and Response modes, then use Compare mode</p>
        </div>`;
    }

    // Phase 3: Enhanced Warnings with Categories
    const warnings = [
        ...(report.request?.warnings || []),
        ...(report.response?.warnings || [])
    ];
    if (warnings.length === 0) {
        document.getElementById("tab-warnings").innerHTML = `
            <div style='padding: 2rem; text-align: center; background: #d1fae5; border-radius: 12px; border: 2px solid #10b981;'>
                <div style='font-size: 2rem; margin-bottom: 0.5rem;'>✓</div>
                <p style='color: #047857; font-weight: 600; margin: 0;'>All Clear!</p>
                <p style='color: #065f46; font-size: 0.9rem; margin: 0.5rem 0 0 0;'>No warnings or errors detected in your payloads</p>
            </div>`;
    } else {
        let html = `<div style='display: grid; gap: 1rem;'>
            <div style='background: linear-gradient(135deg, #f59e0b 0%, #dc2626 100%); color: white; padding: 1.5rem; border-radius: 12px;'>
                <h3 style='margin: 0 0 0.5rem 0;'>⚠️ Issues Found</h3>
                <p style='margin: 0; opacity: 0.9; font-size: 0.9rem;'>${warnings.length} warning${warnings.length !== 1 ? "s" : ""} detected</p>
            </div>

            <div style='display: grid; gap: 0.75rem;'>`;

        warnings.forEach((w, idx) => {
            const level = w.toLowerCase().includes('error') || w.toLowerCase().includes('critical') ? 'error' : 'warning';
            const bgColor = level === 'error' ? '#fee2e2' : '#fef3c7';
            const borderColor = level === 'error' ? '#ef4444' : '#f59e0b';
            const textColor = level === 'error' ? '#7f1d1d' : '#92400e';
            const icon = level === 'error' ? '🚨' : '⚠️';

            html += `<div style='padding: 1.25rem; background: ${bgColor}; border-left: 4px solid ${borderColor}; border-radius: 8px; color: ${textColor};'>
                <div style='display: flex; gap: 0.75rem; align-items: flex-start;'>
                    <span style='font-size: 1.25rem;'>${icon}</span>
                    <div>
                        <div style='font-weight: 600; margin-bottom: 0.25rem;'>${level === 'error' ? 'Error' : 'Warning'} #${idx + 1}</div>
                        <div>${w}</div>
                    </div>
                </div>
            </div>`;
        });

        html += "</div></div>";
        document.getElementById("tab-warnings").innerHTML = html;
    }

    // Raw JSON Tree
    document.getElementById("tab-raw").innerHTML = `<pre style='font-size: 0.8rem; overflow-x: auto; max-height: 500px;'>${JSON.stringify(report, null, 2)}</pre>`;
}

/* Batch payloads come from log files, so their ids and warning strings are
   untrusted text. Escape anything interpolated into batch markup. */
function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

function kpiCard(label, value, tone) {
    const colors = {
        good: "#10b981", bad: "#ef4444", neutral: "#6366f1", warn: "#f59e0b"
    };
    return `<div style='background: var(--panel-bg, #fff); border: 1px solid var(--panel-border, #e5e7eb); border-left: 4px solid ${colors[tone] || colors.neutral}; padding: 1rem 1.25rem; border-radius: 10px;'>
        <div style='font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.7; margin-bottom: 0.35rem;'>${esc(label)}</div>
        <div style='font-size: 1.6rem; font-weight: 800;'>${esc(value)}</div>
    </div>`;
}

function distributionBlock(title, distribution) {
    if (!distribution || !Object.keys(distribution).length) return "";
    const total = Object.values(distribution).reduce((a, b) => a + b, 0) || 1;
    let html = `<div style='margin-bottom: 1.5rem;'>
        <h4 style='margin: 0 0 0.75rem 0; font-size: 0.95rem;'>${esc(title)}</h4>`;
    for (const [key, count] of Object.entries(distribution)) {
        const pct = Math.round((count / total) * 100);
        html += `<div style='margin-bottom: 0.5rem;'>
            <div style='display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.2rem;'>
                <span>${esc(key)}</span><span style='opacity: 0.7;'>${count} (${pct}%)</span>
            </div>
            <div style='background: rgba(127,127,127,0.18); border-radius: 6px; height: 8px; overflow: hidden;'>
                <div style='background: linear-gradient(90deg, #667eea, #764ba2); width: ${pct}%; height: 100%;'></div>
            </div>
        </div>`;
    }
    return html + "</div>";
}

function displayBatchResults(report) {
    document.getElementById("results-placeholder").style.display = "none";
    document.getElementById("results-content").style.display = "block";
    document.getElementById("export-group").hidden = false;

    const agg = report.aggregates || {};
    const rows = report.rows || [];

    /* --- Overview: aggregate KPIs ------------------------------------- */
    let overview = `<div style='display: grid; gap: 1.5rem;'>
        <div style='display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;'>
            ${kpiCard("Entries analyzed", agg.entries_analyzed ?? 0, "neutral")}
            ${kpiCard("Valid", agg.valid_count ?? 0, "good")}
            ${kpiCard("Invalid", agg.invalid_count ?? 0, (agg.invalid_count ? "bad" : "good"))}
            ${kpiCard("Skipped", agg.entries_skipped ?? 0, (agg.entries_skipped ? "warn" : "neutral"))}
            ${kpiCard("Requests", agg.request_count ?? 0, "neutral")}
            ${kpiCard("Responses", agg.response_count ?? 0, "neutral")}
            ${kpiCard("Total warnings", agg.total_warnings ?? 0, (agg.total_warnings ? "warn" : "good"))}
            ${kpiCard("Total errors", agg.total_errors ?? 0, (agg.total_errors ? "bad" : "good"))}
        </div>`;

    const notes = (report.notes || []).concat(agg.notes || []);
    if (notes.length) {
        overview += `<div style='padding: 1rem 1.25rem; background: rgba(99,102,241,0.1); border-left: 4px solid #6366f1; border-radius: 8px; font-size: 0.9rem;'>
            ${notes.map(n => `<div>• ${esc(n)}</div>`).join("")}
        </div>`;
    }

    if ((report.line_errors || []).length) {
        overview += `<div style='padding: 1rem 1.25rem; background: rgba(245,158,11,0.12); border-left: 4px solid #f59e0b; border-radius: 8px; font-size: 0.9rem;'>
            <strong>${report.line_errors.length} unparseable line(s) skipped</strong>
            ${report.line_errors.slice(0, 10).map(e => `<div>• line ${e.line}: ${esc(e.error)}</div>`).join("")}
        </div>`;
    }

    const rb = agg.request_breakdown;
    if (rb) {
        overview += `<div style='display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.5rem;'>
            <div>${distributionBlock("Ad format", rb.ad_format)}${distributionBlock("Inventory source", rb.inventory_source)}</div>
            <div>${distributionBlock("Environment", rb.environment)}${distributionBlock("CTV likelihood", rb.ctv_label)}</div>
            <div>${distributionBlock("Version guess", rb.version_guess)}${distributionBlock("Deal type", rb.deal_type)}</div>
        </div>`;
        if (rb.bid_floor) {
            overview += `<div style='display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;'>
                ${kpiCard("Min floor", rb.bid_floor.min, "neutral")}
                ${kpiCard("Avg floor", rb.bid_floor.avg, "neutral")}
                ${kpiCard("Max floor", rb.bid_floor.max, "neutral")}
            </div>`;
        }
    }

    const sb = agg.response_breakdown;
    if (sb) {
        overview += distributionBlock("No-bid style", sb.no_bid_style);
        if (sb.bid_price) {
            overview += `<div style='display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;'>
                ${kpiCard("Min price", sb.bid_price.min, "neutral")}
                ${kpiCard("Avg price", sb.bid_price.avg, "neutral")}
                ${kpiCard("Max price", sb.bid_price.max, "neutral")}
            </div>`;
        }
    }

    document.getElementById("tab-overview").innerHTML = overview + "</div>";

    /* --- Batch tab: per-entry table ----------------------------------- */
    let table = "";
    if (!rows.length) {
        table = "<p style='opacity: 0.7;'>No entries could be analyzed.</p>";
    } else {
        const isRequest = rows.some(r => r.kind === "request");
        const headers = isRequest
            ? ["#", "ID", "Imps", "Format", "Inventory", "Environment", "CTV", "Version", "Floor", "Warn", "Err"]
            : ["#", "ID", "Seats", "Bids", "Min price", "Max price", "No-bid", "Creative", "Warn", "Err"];

        table = `<div style='overflow-x: auto;'><table style='width: 100%; border-collapse: collapse; font-size: 0.85rem;'>
            <thead><tr>${headers.map(h => `<th style='text-align: left; padding: 0.6rem; border-bottom: 2px solid rgba(127,127,127,0.3); white-space: nowrap;'>${esc(h)}</th>`).join("")}</tr></thead><tbody>`;

        rows.forEach(r => {
            const bad = r.error_count > 0;
            const cells = r.kind === "request"
                ? [r.index, r.id, r.impressions, r.ad_format, r.inventory_source, r.environment,
                   `${r.ctv_score ?? "—"} (${r.ctv_label ?? "—"})`, r.version_guess,
                   r.min_floor === null || r.min_floor === undefined ? "—" : r.min_floor,
                   r.warning_count, r.error_count]
                : [r.index, r.id, r.seat_count, r.bid_count,
                   r.min_bid_price ?? "—", r.max_bid_price ?? "—",
                   r.no_bid_reason ?? "—", r.creative_metadata, r.warning_count, r.error_count];

            table += `<tr style='background: ${bad ? "rgba(239,68,68,0.08)" : "transparent"};'>` +
                cells.map(c => `<td style='padding: 0.55rem 0.6rem; border-bottom: 1px solid rgba(127,127,127,0.15); white-space: nowrap;'>${esc(c)}</td>`).join("") +
                "</tr>";
        });
        table += "</tbody></table></div>";
    }

    if ((report.skipped || []).length) {
        table += `<div style='margin-top: 1.5rem; padding: 1rem 1.25rem; background: rgba(245,158,11,0.12); border-left: 4px solid #f59e0b; border-radius: 8px; font-size: 0.9rem;'>
            <strong>Skipped entries</strong>
            ${report.skipped.slice(0, 20).map(s => `<div>• entry ${s.index}: ${esc(s.reason)}</div>`).join("")}
        </div>`;
    }
    document.getElementById("tab-batch").innerHTML = table;

    /* --- Warnings tab: ranked by frequency ---------------------------- */
    const topErrors = agg.top_errors || [];
    const topWarnings = agg.top_warnings || [];
    let warnHtml = "";
    if (!topErrors.length && !topWarnings.length) {
        warnHtml = "<div style='padding: 2rem; text-align: center; opacity: 0.7;'>✅ No warnings or errors across the batch.</div>";
    } else {
        const section = (title, items, tone) => {
            if (!items.length) return "";
            const color = tone === "error" ? "#ef4444" : "#f59e0b";
            return `<h4 style='margin: 1rem 0 0.75rem 0;'>${esc(title)}</h4>` + items.map(item =>
                `<div style='display: flex; gap: 1rem; align-items: flex-start; padding: 0.85rem 1rem; margin-bottom: 0.5rem; border-left: 4px solid ${color}; background: rgba(127,127,127,0.07); border-radius: 6px;'>
                    <span style='font-weight: 800; min-width: 3rem;'>${item.count}×</span>
                    <span>${esc(item.message)}</span>
                </div>`).join("");
        };
        warnHtml = section(`Most frequent errors (${agg.distinct_errors || 0} distinct)`, topErrors, "error") +
                   section(`Most frequent warnings (${agg.distinct_warnings || 0} distinct)`, topWarnings, "warning");
    }
    document.getElementById("tab-warnings").innerHTML = warnHtml;

    /* --- Tabs that carry no meaning for a batch ----------------------- */
    const na = "<div style='padding: 2rem; text-align: center; opacity: 0.6;'>Not applicable in Batch mode. Use the Overview, Batch, and Warnings tabs.</div>";
    ["tab-human", "tab-request", "tab-response", "tab-compare", "tab-signals", "tab-interview"]
        .forEach(id => { document.getElementById(id).innerHTML = na; });

    document.getElementById("tab-raw").innerHTML =
        `<pre style='font-size: 0.8rem; overflow-x: auto; max-height: 500px;'>${esc(JSON.stringify(report, null, 2))}</pre>`;

    activateTab(document.getElementById("tabbtn-overview"));
}

/* WAI-ARIA tab pattern: roving tabindex + aria-selected kept in sync so
   screen readers and keyboard users get the same state as the visuals. */
function activateTab(btn) {
    if (!btn) return;
    document.querySelectorAll(".tab-button").forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
        b.tabIndex = -1;
    });
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    btn.tabIndex = 0;
    document.getElementById(btn.getAttribute("aria-controls"))?.classList.add("active");
}

function setupResultTabs() {
    // Arrow keys move within a tablist; Home/End jump to its ends.
    document.querySelectorAll(".tab-button").forEach(btn => {
        btn.addEventListener("click", () => activateTab(btn));

        btn.addEventListener("keydown", (e) => {
            const group = Array.from(btn.closest("[role='tablist']").querySelectorAll(".tab-button"));
            const i = group.indexOf(btn);
            let next = null;

            if (e.key === "ArrowRight") next = group[(i + 1) % group.length];
            else if (e.key === "ArrowLeft") next = group[(i - 1 + group.length) % group.length];
            else if (e.key === "Home") next = group[0];
            else if (e.key === "End") next = group[group.length - 1];
            else return;

            e.preventDefault();
            activateTab(next);
            next.focus();
        });
    });
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
        <pre>${esc(JSON.stringify(state.report, null, 2))}</pre>
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

/* Live JSON validation: report the failing line as the user types, instead
   of only on Analyze via a notification far from the error. */
function setupJSONValidation() {
    ["request-raw", "response-raw", "compare-request-raw", "compare-response-raw"]
        .forEach(id => {
            const ta = document.getElementById(id);
            if (!ta) return;

            const status = document.createElement("div");
            status.className = "json-status";
            status.id = `${id}-status`;
            status.setAttribute("aria-live", "polite");
            ta.insertAdjacentElement("afterend", status);

            let timer;
            ta.addEventListener("input", () => {
                clearTimeout(timer);
                timer = setTimeout(() => validateJSONField(ta, status), 350);
            });
        });
}

function validateJSONField(textarea, status) {
    const text = textarea.value.trim();

    if (!text) {
        status.textContent = "";
        status.className = "json-status";
        textarea.classList.remove("has-error");
        textarea.removeAttribute("aria-invalid");
        return;
    }

    try {
        JSON.parse(text);
        status.textContent = "✓ Valid JSON";
        status.className = "json-status valid";
        textarea.classList.remove("has-error");
        textarea.removeAttribute("aria-invalid");
    } catch (err) {
        const where = jsonErrorLocation(textarea.value, err);
        status.textContent = `✗ ${err.message}${where}`;
        status.className = "json-status invalid";
        textarea.classList.add("has-error");
        textarea.setAttribute("aria-invalid", "true");
    }
}

/* Older engines report only "at position N"; derive line/column from it.
   Newer V8 already names the line, so don't repeat it. */
function jsonErrorLocation(text, err) {
    if (/line \d+/i.test(err.message)) return "";
    const m = /position (\d+)/.exec(err.message);
    if (!m) return "";
    const upto = text.slice(0, Number(m[1]));
    const line = upto.split("\n").length;
    const col = upto.length - upto.lastIndexOf("\n");
    return ` (line ${line}, column ${col})`;
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
    document.querySelectorAll(".input-method-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            const mode = tab.dataset.mode;
            const method = tab.dataset.method;

            document.querySelectorAll(`.input-method-tab[data-mode="${mode}"]`).forEach(t => {
                t.classList.remove("active");
            });
            tab.classList.add("active");

            document.querySelectorAll(".input-method-content").forEach(el => {
                if (el.id.endsWith(`-${mode}`)) el.classList.remove("active");
            });
            document.getElementById(`method-${method}-${mode}`)?.classList.add("active");
        });
    });

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

        // The endpoint reports failures in its body with ok:false, and returns
        // the payload as `text` — not `content`.
        const data = await response.json();
        if (!data.ok) {
            showStatus(`❌ ${data.error || "Fetch failed"}`, "error");
            return;
        }

        const target = document.getElementById(`${mode}-raw`);
        target.value = data.text || "";
        target.dispatchEvent(new Event("input"));   // run JSON validation
        (data.notes || []).forEach(n => showStatus(`⚠️ ${n}`, "error"));
        showStatus("✅ Fetched successfully", "success");
    } catch (err) {
        showStatus(`❌ Fetch failed: ${err.message}`, "error");
    }
}

/* Phase 4: Theme & Export Tools */

// Theme Management
function initializeTheme() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;

    // Check saved theme preference or system preference
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');

    applyTheme(theme);
    themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const newTheme = current === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
    });
}

function applyTheme(theme) {
    const toggle = document.getElementById('theme-toggle');
    const dark = theme === 'dark';

    if (dark) {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    toggle.textContent = dark ? '☀️' : '🌙';
    // The emoji carries no meaning for screen readers, so state lives here.
    toggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
}

/* Values here are payload-derived and routinely contain commas and quotes,
   so every cell goes through RFC 4180 quoting. */
function csvCell(value) {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(values) {
    return values.map(csvCell).join(',');
}

// Advanced Export Functions
function exportCSV() {
    if (!state.report) {
        showStatus("No analysis results to export", "error");
        return;
    }

    const report = state.report;
    const rows = [];

    if (report.batch) {
        // One line per analyzed entry — the shape you actually want in a sheet.
        const batchRows = report.batch.rows || [];
        if (!batchRows.length) {
            showStatus("No batch entries to export", "error");
            return;
        }
        const columns = Object.keys(batchRows[0]);
        rows.push(csvLine(columns));
        batchRows.forEach(row => rows.push(csvLine(columns.map(column => row[column]))));
    } else {
        rows.push(csvLine(['Metric', 'Value']));

        if (report.request?.summary) {
            rows.push(csvLine(['--- REQUEST DATA ---', '']));
            Object.entries(report.request.summary).forEach(([k, v]) => rows.push(csvLine([k, v])));
        }

        if (report.response?.summary) {
            rows.push(csvLine(['--- RESPONSE DATA ---', '']));
            Object.entries(report.response.summary).forEach(([k, v]) => rows.push(csvLine([k, v])));
        }

        if (report.request?.human_explanations?.length) {
            rows.push(csvLine(['--- INSIGHTS ---', '']));
            report.request.human_explanations.forEach((exp, i) => rows.push(csvLine([`Insight ${i + 1}`, exp])));
        }
    }

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bid-analysis-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    showStatus("✅ CSV exported successfully", "success");
}

function generateBatchPDFHTML(batch, timestamp) {
    const agg = batch.aggregates || {};
    const rows = batch.rows || [];
    const columns = rows.length ? Object.keys(rows[0]) : [];

    const kpi = (label, value) =>
        `<div class="kpi-card"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div></div>`;

    const frequency = (title, items) => !items?.length ? "" : `
        <div class="section">
            <h2>${esc(title)}</h2>
            ${items.map(i => `<div class="insight"><div class="insight-label">${i.count}× occurrences</div><div class="insight-text">${esc(i.message)}</div></div>`).join("")}
        </div>`;

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Batch Analysis Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1f2937; line-height: 1.6; }
        .container { max-width: 1100px; margin: 0 auto; padding: 2rem; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2rem; border-radius: 8px; margin-bottom: 2rem; }
        .header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
        .meta { font-size: 0.9rem; opacity: 0.9; }
        .section { margin-bottom: 2rem; page-break-inside: avoid; }
        .section h2 { font-size: 1.5rem; color: #667eea; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #e5e7eb; }
        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
        .kpi-card { background: #f9fafb; padding: 1rem; border-radius: 8px; border-left: 4px solid #667eea; }
        .kpi-label { font-size: 0.8rem; color: #6b7280; text-transform: uppercase; }
        .kpi-value { font-size: 1.4rem; font-weight: 700; margin-top: 0.35rem; }
        .insight { background: #fffbeb; padding: 0.85rem 1rem; margin-bottom: 0.6rem; border-left: 4px solid #f59e0b; border-radius: 4px; }
        .insight-label { color: #92400e; font-weight: 600; font-size: 0.85rem; }
        .insight-text { margin-top: 0.35rem; font-size: 0.9rem; }
        table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
        th, td { text-align: left; padding: 0.45rem 0.55rem; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
        th { background: #f3f4f6; border-bottom: 2px solid #d1d5db; }
        @media print { body { background: white; } .container { padding: 0; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📦 Batch Analysis Report</h1>
            <div class="meta">Generated: ${esc(timestamp)} • Mode: ${esc(batch.mode || "auto")}</div>
        </div>

        <div class="section">
            <h2>Summary</h2>
            <div class="kpi-grid">
                ${kpi("Entries analyzed", agg.entries_analyzed ?? 0)}
                ${kpi("Valid", agg.valid_count ?? 0)}
                ${kpi("Invalid", agg.invalid_count ?? 0)}
                ${kpi("Skipped", agg.entries_skipped ?? 0)}
                ${kpi("Requests", agg.request_count ?? 0)}
                ${kpi("Responses", agg.response_count ?? 0)}
                ${kpi("Total warnings", agg.total_warnings ?? 0)}
                ${kpi("Total errors", agg.total_errors ?? 0)}
            </div>
        </div>

        ${frequency("Most frequent errors", agg.top_errors)}
        ${frequency("Most frequent warnings", agg.top_warnings)}

        ${rows.length ? `
        <div class="section">
            <h2>Per-entry results</h2>
            <table>
                <thead><tr>${columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
                <tbody>${rows.map(r => `<tr>${columns.map(c => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody>
            </table>
        </div>` : ""}
    </div>
</body>
</html>`;
}

function exportPDF() {
    if (!state.report) {
        showStatus("No analysis results to export", "error");
        return;
    }

    // For PDF export, we'll generate styled HTML and let browser handle it
    const htmlContent = generatePDFHTML();
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bid-analysis-${new Date().toISOString().slice(0,10)}.html`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    showStatus("✅ Report exported (open in browser and print as PDF)", "success");
}

function generatePDFHTML() {
    const report = state.report;
    const timestamp = new Date().toLocaleString();

    if (report.batch) return generateBatchPDFHTML(report.batch, timestamp);

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Bid Analysis Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1f2937; line-height: 1.6; }
        .container { max-width: 900px; margin: 0 auto; padding: 2rem; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2rem; border-radius: 8px; margin-bottom: 2rem; }
        .header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
        .meta { font-size: 0.9rem; opacity: 0.9; }
        .section { margin-bottom: 2rem; page-break-inside: avoid; }
        .section h2 { font-size: 1.5rem; color: #667eea; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #e5e7eb; }
        .kpi-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1rem; }
        .kpi-card { background: #f9fafb; padding: 1rem; border-radius: 8px; border-left: 4px solid #667eea; }
        .kpi-label { font-size: 0.85rem; color: #6b7280; text-transform: uppercase; }
        .kpi-value { font-size: 1.5rem; font-weight: 700; color: #1f2937; margin-top: 0.5rem; }
        .insight { background: #f0fdf4; padding: 1rem; margin-bottom: 0.75rem; border-left: 4px solid #10b981; border-radius: 4px; }
        .insight-label { color: #047857; font-weight: 600; font-size: 0.9rem; }
        .insight-text { color: #1f2937; margin-top: 0.5rem; }
        pre { background: #f9fafb; padding: 1rem; overflow-x: auto; border-radius: 4px; font-size: 0.85rem; }
        @media print { body { background: white; } .container { padding: 0; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Bid Analysis Report</h1>
            <div class="meta">Generated: ${timestamp}</div>
        </div>

        ${report.request ? `
        <div class="section">
            <h2>📋 Request Analysis</h2>
            <div class="kpi-grid">
                <div class="kpi-card">
                    <div class="kpi-label">Request ID</div>
                    <div class="kpi-value">${report.request.summary?.request_id?.substring(0, 12) || '—'}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Format</div>
                    <div class="kpi-value">${report.request.summary?.ad_format || '—'}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Impressions</div>
                    <div class="kpi-value">${report.request.summary?.impression_count || 1}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">CTV Score</div>
                    <div class="kpi-value">${report.request.request_type_detection?.ctv_score || 0}/${report.request.request_type_detection?.ctv_score_max || 14}</div>
                </div>
            </div>
            ${report.request.human_explanations?.length ? `
            <h3 style="margin-top: 1.5rem; color: #1f2937; margin-bottom: 1rem;">Key Insights</h3>
            ${report.request.human_explanations.map((exp, i) => `
            <div class="insight">
                <div class="insight-label">💡 Insight ${i+1}</div>
                <div class="insight-text">${exp}</div>
            </div>
            `).join('')}
            ` : ''}
        </div>
        ` : ''}

        ${report.response ? `
        <div class="section">
            <h2>📨 Response Analysis</h2>
            <div class="kpi-grid">
                <div class="kpi-card">
                    <div class="kpi-label">Total Bids</div>
                    <div class="kpi-value">${report.response.summary?.bid_count || 0}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Seats</div>
                    <div class="kpi-value">${report.response.summary?.seat_count || 0}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Max Bid</div>
                    <div class="kpi-value">$${report.response.summary?.max_bid_price || '—'}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Avg Bid</div>
                    <div class="kpi-value">$${report.response.summary?.avg_bid_price || '—'}</div>
                </div>
            </div>
        </div>
        ` : ''}

        <div class="section">
            <h2>📄 Raw Data</h2>
            <pre>${JSON.stringify(report, null, 2)}</pre>
        </div>
    </div>
</body>
</html>`;
}
