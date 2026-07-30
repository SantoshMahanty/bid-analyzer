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
    setupEditors();
    initializeTheme();
    setupExportMenu();
});

/* Icon reference for markup built in JS. Same sprite as the template, so
   generated results and static chrome share one icon set. */
function icon(name, extraClass) {
    return `<svg class="icon ${extraClass || ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

/* Count badges on the tab strip, so a tab's weight is visible without
   opening it. `tone` picks the badge colour; null count hides it. */
function setBadge(id, count, tone) {
    const badge = document.getElementById(id);
    if (!badge) return;
    const n = Number(count) || 0;
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.classList.toggle("fail", tone === "fail");
    badge.classList.toggle("neutral", tone === "neutral");
    badge.hidden = n === 0;
}

function clearBadges() {
    ["insights-badge", "signals-badge", "compare-badge", "batch-badge", "warnings-badge"]
        .forEach(id => setBadge(id, 0));
}

/* Export menu. Five buttons crowded the results header, so they now live
   behind one trigger. Implemented as a real ARIA menu: Escape and
   click-outside close it, arrow keys walk the items, and focus returns to
   the trigger on close so keyboard users are not stranded. */
function setupExportMenu() {
    const trigger = document.getElementById("export-trigger");
    const list = document.getElementById("export-menu-list");
    if (!trigger || !list) return;

    const items = () => Array.from(list.querySelectorAll(".export-menu-item"));

    const open = () => {
        list.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        items()[0]?.focus();
    };

    const close = (refocus) => {
        if (list.hidden) return;
        list.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        if (refocus) trigger.focus();
    };

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        list.hidden ? open() : close(false);
    });

    // Any selection performs its action via onclick, then dismisses the menu.
    list.addEventListener("click", (e) => {
        if (e.target.closest(".export-menu-item")) close(true);
    });

    document.addEventListener("click", (e) => {
        if (!e.target.closest("#export-group")) close(false);
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close(true);
    });

    list.addEventListener("keydown", (e) => {
        const all = items();
        const i = all.indexOf(document.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); all[(i + 1) % all.length].focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); }
        else if (e.key === "Home") { e.preventDefault(); all[0].focus(); }
        else if (e.key === "End") { e.preventDefault(); all[all.length - 1].focus(); }
    });

    trigger.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); open(); }
    });
}

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

    // Dynamic layout switching per mode
    const contentEl = document.querySelector(".content");
    if (contentEl) {
        if (mode === "compare") {
            contentEl.classList.remove("split-layout");
            contentEl.classList.add("compare-layout");
        } else {
            contentEl.classList.remove("compare-layout");
            contentEl.classList.add("split-layout");
        }
    }

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
        populateSamples();
    } catch (err) {
        showStatus("Failed to load samples", "error");
    }
}

function populateSamples() {
    ["request", "response"].forEach(kind => {
        const grid = document.getElementById(`samples-${kind}-grid`);
        if (!grid) return;

        const samples = state.samples.filter(s => s.kind === kind);
        if (!samples.length) {
            grid.innerHTML = `<div style="color:var(--text-muted); padding:1rem;">No samples found.</div>`;
            return;
        }

        grid.innerHTML = "";
        samples.forEach(s => {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "sample-card btn btn-secondary";
            card.style.display = "inline-flex";
            card.style.alignItems = "center";
            card.style.gap = "0.5rem";
            card.style.padding = "0.75rem 1.25rem";
            card.style.margin = "0.35rem";
            card.innerHTML = `${icon("file")} <span>${s.name}</span>`;

            card.addEventListener("click", () => {
                const textareaId = `${kind}-raw`;
                const ta = document.getElementById(textareaId);
                if (ta) {
                    ta.value = s.content;
                    ta.dispatchEvent(new Event("input"));
                }
                // Switch back to editor tab
                const editorTab = document.querySelector(`.input-method-tab[data-method="paste"][data-mode="${kind}"]`);
                if (editorTab) editorTab.click();

                showStatus(`Loaded ${s.name}`, "info");
            });

            grid.appendChild(card);
        });
    });
}

function setupInputMethodTabs() {
    document.querySelectorAll(".input-method-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            const method = tab.dataset.method;
            const mode = tab.dataset.mode;
            if (!method || !mode) return;

            // Deactivate sibling tabs
            const parent = tab.closest(".input-method-tabs");
            if (parent) {
                parent.querySelectorAll(".input-method-tab").forEach(t => t.classList.remove("active"));
            }
            tab.classList.add("active");

            // Toggle method content views
            const modeContent = document.getElementById(`input-${mode}`);
            if (modeContent) {
                modeContent.querySelectorAll(".input-method-content").forEach(c => c.style.display = "none");
                const targetContent = document.getElementById(`method-${method}-${mode}`);
                if (targetContent) {
                    targetContent.style.display = "block";
                    targetContent.classList.add("active");
                }
            }
        });
    });
}

async function fetchURL(mode) {
    const urlInput = document.getElementById(`${mode}-url`);
    if (!urlInput || !urlInput.value.trim()) {
        showStatus("Please enter a valid HTTP/HTTPS URL", "error");
        return;
    }

    const url = urlInput.value.trim();
    showStatus(`Fetching content from URL...`, "info");

    try {
        const res = await postJson("/fetch/url", { url });
        if (res.raw_text) {
            const target = document.getElementById(`${mode}-raw`);
            if (target) {
                target.value = res.raw_text;
                target.dispatchEvent(new Event("input"));
            }
            // Switch back to editor tab
            const editorTab = document.querySelector(`.input-method-tab[data-method="paste"][data-mode="${mode}"]`);
            if (editorTab) editorTab.click();

            showStatus(`Fetched content from URL successfully`, "success");
        } else if (res.error) {
            showStatus(`Fetch error: ${res.error}`, "error");
        } else {
            showStatus("Failed to fetch content from URL", "error");
        }
    } catch (err) {
        showStatus(`Fetch error: ${err.message}`, "error");
    }
}

function handleFileUpload(e, mode) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const target = document.getElementById(`${mode}-raw`);
        target.value = event.target.result;
        target.dispatchEvent(new Event("input"));
        showStatus(`Uploaded ${file.name}`, "info");
    };
    reader.readAsText(file);
}

function clearInputs() {
    document.querySelectorAll("textarea").forEach(ta => ta.value = "");
    document.querySelectorAll("select").forEach(sel => sel.value = "");
    document.getElementById("results-placeholder").style.display = "block";
    document.getElementById("results-content").style.display = "none";
    document.getElementById("export-group").hidden = true;
    clearBadges();
    state.report = null;
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
            <div class='hero-card request'>
                <div class='hero-head'>
                    <div>
                        <h3 class='hero-title'>${icon('list')} Bid Request</h3>
                        <p class='hero-sub'>${esc(report.request.summary?.ad_format || "Standard")} • ${esc(report.request.summary?.environment_guess || "Web")}</p>
                    </div>
                    <div class='hero-figure'>
                        <div class='hero-num'>${report.request.summary?.impression_count || 1}</div>
                        <div class='hero-caption'>Impressions</div>
                    </div>
                </div>

                <div class='hero-tiles'>
                    <div class='hero-tile'>
                        <div class='hero-tile-label'>Request ID</div>
                        <div class='hero-tile-val'>${esc((report.request.summary?.request_id || "—").substring(0, 12))}</div>
                    </div>
                    <div class='hero-tile'>
                        <div class='hero-tile-label'>Devices</div>
                        <div class='hero-tile-val'>${report.request.summary?.device_type_count || 1} types</div>
                    </div>
                    <div class='hero-tile'>
                        <div class='hero-tile-label'>Publishers</div>
                        <div class='hero-tile-val'>${report.request.summary?.publisher_count || 1}</div>
                    </div>
                </div>

                <div class='hero-meter'>
                    <div class='hero-meter-head'>
                        <span>${icon('target')} CTV Confidence Score</span>
                        <strong>${ctvScore}/${ctvMax}</strong>
                    </div>
                    <div class='hero-track' role='img' aria-label='CTV confidence ${ctvScore} of ${ctvMax}'>
                        <div class='hero-fill' style='width: ${ctvPercent}%;'></div>
                    </div>
                    <div class='hero-note'>${esc(det.ctv_label || "Analyzing...")}</div>
                </div>
            </div>`;
    }

    if (report.response) {
        const bidCount = report.response.summary?.bid_count || 0;
        const seatCount = report.response.summary?.seat_count || 0;
        overviewHtml += `
            <div class='hero-card response'>
                <div class='hero-head'>
                    <div>
                        <h3 class='hero-title'>${icon('inbox')} Bid Response</h3>
                        <p class='hero-sub'>${bidCount > 0 ? "Active Bids" : "No Bids"} • ${seatCount} Seat${seatCount !== 1 ? "s" : ""}</p>
                    </div>
                    <div class='hero-figure'>
                        <div class='hero-num'>$${esc(String(report.response.summary?.max_bid_price || "0"))}</div>
                        <div class='hero-caption'>Max Bid</div>
                    </div>
                </div>

                <div class='hero-tiles'>
                    <div class='hero-tile center'>
                        <div class='hero-tile-num'>${bidCount}</div>
                        <div class='hero-tile-label'>Total Bids</div>
                    </div>
                    <div class='hero-tile center'>
                        <div class='hero-tile-num'>${seatCount}</div>
                        <div class='hero-tile-label'>Seat Count</div>
                    </div>
                    <div class='hero-tile center'>
                        <div class='hero-tile-num'>${report.response.summary?.avg_bid_price ? "$" + esc(String(report.response.summary.avg_bid_price)) : "—"}</div>
                        <div class='hero-tile-label'>Avg Bid</div>
                    </div>
                </div>

                <div class='hero-meter'>
                    <div class='hero-meter-head'>
                        <span>${icon('layout')} Response Health</span>
                        <span class='hero-pill'>${bidCount > 0 ? "Healthy" : "No Bids"}</span>
                    </div>
                </div>
            </div>`;
    }

    overviewHtml += "</div>";
    document.getElementById("tab-overview").innerHTML = overviewHtml;

    // Insights
    const explanations = report.request?.human_explanations || [];
    if (explanations.length > 0) {
        let html = `<div class='r-stack'>
            <div class='verdict-banner pass'>
                <h3>${icon('bulb')} Key Insights</h3>
                <p>${explanations.length} important finding${explanations.length !== 1 ? "s" : ""}</p>
            </div>`;

        explanations.forEach((exp, i) => {
            html += `<div class='status-card pass'>
                <span class='status-icon'>${icon('bulb')}</span>
                <div class='status-body'>
                    <div class='status-title'>Insight ${i + 1}</div>
                    <div>${esc(exp)}</div>
                </div>
            </div>`;
        });
        html += "</div>";
        document.getElementById("tab-human").innerHTML = html;
    }

    // Signals & CTV
    const signals = report.request?.inferred_signals || {};
    if (Object.keys(signals).length > 0) {
        const iconFor = (key) =>
            key.includes("ctv") ? icon("tv") : key.includes("version") ? icon("box")
            : key.includes("privacy") ? icon("lock") : icon("target");

        let html = `<div class='r-stack'>
            <div class='verdict-banner pass'>
                <h3>${icon('tv')} Detected Signals</h3>
                <p>${Object.keys(signals).length} signal${Object.keys(signals).length !== 1 ? "s" : ""} identified</p>
            </div>`;

        for (const [key, value] of Object.entries(signals)) {
            html += `<div class='status-card info'>
                <span class='status-icon'>${iconFor(key)}</span>
                <div class='status-body'>
                    <div class='status-title'>${esc(key.replace(/_/g, " ").toUpperCase())}</div>
                    <div>${esc(typeof value === "object" ? JSON.stringify(value, null, 2) : value)}</div>
                </div>
            </div>`;
        }
        html += "</div>";
        document.getElementById("tab-signals").innerHTML = html;
    }

    // Interview cheatsheet
    const interviewPoints = report.request?.interview_points || [];
    if (interviewPoints.length > 0) {
        let html = "<div class='r-stack'>";
        interviewPoints.forEach((point, i) => {
            html += `<div class='status-card warn'>
                <span class='status-icon'>${icon('cap')}</span>
                <div class='status-body'>
                    <div class='status-title'>Point ${i + 1}</div>
                    <div>${esc(point)}</div>
                </div>
            </div>`;
        });
        html += "</div>";
        document.getElementById("tab-interview").innerHTML = html;
    }

    // Request / Response summaries as key-value rows
    const summaryRows = (summary) => {
        let html = "<div class='r-stack' style='gap: 0.5rem;'>";
        for (const [k, v] of Object.entries(summary || {})) {
            html += `<div class='r-kv'>
                <span class='r-kv-key'>${esc(k)}</span>
                <span class='r-kv-val'>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</span>
            </div>`;
        }
        return html + "</div>";
    };

    if (report.request) {
        document.getElementById("tab-request").innerHTML = summaryRows(report.request.summary);
    }

    if (report.response) {
        document.getElementById("tab-response").innerHTML = summaryRows(report.response.summary);
    }

    /* Compare matrix. The backend returns {overall_status, checks[], summary};
       each check is {status: PASS|WARNING|FAIL, label, message}. */
    if (report.comparison) {
        const checks = report.comparison.checks || [];
        const summary = report.comparison.summary || {};
        const overall = report.comparison.overall_status || "UNKNOWN";

        const toneClass = { PASS: "pass", WARNING: "warn", FAIL: "fail" };
        const toneIcon = { PASS: icon("check"), WARNING: icon("warn"), FAIL: icon("fail") };
        const verdictClass = { PASS: "pass", WARNING: "warn", FAIL: "fail" }[overall] || "warn";

        const passed = checks.filter(c => c.status === "PASS").length;
        const warned = checks.filter(c => c.status === "WARNING").length;
        const failed = checks.filter(c => c.status === "FAIL").length;

        let html = `<div class='r-stack'>
            <div class='verdict-banner ${verdictClass}'>
                <h3>${icon('scale')} Request vs Response — ${esc(overall)}</h3>
                <p>${checks.length} check${checks.length !== 1 ? "s" : ""} run across ${summary.request_impression_count ?? 0} impression(s) and ${summary.response_bid_count ?? 0} bid(s)</p>
            </div>

            <div class='r-grid-3'>
                <div class='stat-tile pass'><div class='stat-num'>${passed}</div><div class='stat-label'>Passed</div></div>
                <div class='stat-tile warn'><div class='stat-num'>${warned}</div><div class='stat-label'>Warnings</div></div>
                <div class='stat-tile fail'><div class='stat-num'>${failed}</div><div class='stat-label'>Failures</div></div>
            </div>`;

        const chips = [];
        if (summary.below_floor_bids) chips.push(`${summary.below_floor_bids} bid(s) below floor`);
        if (summary.deal_mismatches) chips.push(`${summary.deal_mismatches} deal mismatch(es)`);
        if (summary.blocklist_violations) chips.push(`${summary.blocklist_violations} blocklist violation(s)`);
        if (summary.seat_violations) chips.push(`${summary.seat_violations} seat violation(s)`);
        if ((summary.unmatched_impids || []).length) chips.push(`${summary.unmatched_impids.length} unmatched impid(s)`);
        if (chips.length) {
            html += `<div class='status-card fail'>
                <span class='status-icon'>${icon('ban')}</span>
                <div class='status-body'>
                    <div class='status-title'>Why this bid may be discarded</div>
                    <div>${chips.map(esc).join(" • ")}</div>
                </div>
            </div>`;
        }

        if (!checks.length) {
            html += `<div class='r-empty'>No comparable fields were found in these two payloads.</div>`;
        }
        for (const check of checks) {
            html += `<div class='status-card ${toneClass[check.status] || "warn"}'>
                <span class='status-icon'>${toneIcon[check.status] || icon('warn')}</span>
                <div class='status-body'>
                    <div class='status-title'>${esc(check.label)}</div>
                    <div>${esc(check.message)}</div>
                </div>
            </div>`;
        }

        html += "</div>";
        document.getElementById("tab-compare").innerHTML = html;
    } else {
        document.getElementById("tab-compare").innerHTML = `<div class='r-empty'>
            <p>${icon('scale','icon-xl')}</p><p>Compare both request and response to see verification results</p>
            <p style='font-size: 0.85rem; margin-top: 0.5rem;'>Paste both payloads in Compare mode, then analyze</p>
        </div>`;
    }

    // Warnings and errors
    const warnings = [
        ...(report.request?.warnings || []),
        ...(report.response?.warnings || [])
    ];
    const errors = [
        ...(report.request?.errors || []),
        ...(report.response?.errors || [])
    ];
    clearBadges();
    setBadge("warnings-badge", warnings.length + errors.length, errors.length ? "fail" : "warn");
    setBadge("insights-badge", explanations.length, "neutral");
    setBadge("signals-badge", Object.keys(signals).length, "neutral");
    if (report.comparison) {
        const failed = (report.comparison.checks || []).filter(c => c.status === "FAIL").length;
        const warned = (report.comparison.checks || []).filter(c => c.status === "WARNING").length;
        setBadge("compare-badge", failed + warned, failed ? "fail" : "warn");
    }

    if (warnings.length === 0) {
        document.getElementById("tab-warnings").innerHTML = `
            <div class='status-card pass' style='flex-direction: column; align-items: center; text-align: center; padding: 2rem;'>
                <span class='status-icon'>${icon('check','icon-xl')}</span>
                <div class='status-body'>
                    <div class='status-title'>All clear</div>
                    <div>No warnings or errors detected in your payloads</div>
                </div>
            </div>`;
    } else {
        let html = `<div class='r-stack'>
            <div class='verdict-banner warn'>
                <h3>${icon('alert')} Issues Found</h3>
                <p>${warnings.length} warning${warnings.length !== 1 ? "s" : ""} detected</p>
            </div>`;

        warnings.forEach((w, idx) => {
            const isError = w.toLowerCase().includes("error") || w.toLowerCase().includes("critical");
            html += `<div class='status-card ${isError ? "fail" : "warn"}'>
                <span class='status-icon'>${isError ? icon('fail') : icon('warn')}</span>
                <div class='status-body'>
                    <div class='status-title'>${isError ? "Error" : "Warning"} #${idx + 1}</div>
                    <div>${esc(w)}</div>
                </div>
            </div>`;
        });

        html += "</div>";
        document.getElementById("tab-warnings").innerHTML = html;
    }

    // Raw JSON
    document.getElementById("tab-raw").innerHTML =
        `<pre style='font-size: 0.8rem; overflow-x: auto; max-height: 500px;'>${esc(JSON.stringify(report, null, 2))}</pre>`;
}

/* Batch payloads come from log files, so their ids and warning strings are
   untrusted text. Escape anything interpolated into batch markup. */
function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

/* Tone maps to a .stat-tile / .status-card modifier, so every colour comes
   from a CSS token and follows the active theme. */
function kpiCard(label, value, tone) {
    return `<div class='stat-tile ${tone || "neutral"}'>
        <div class='stat-label'>${esc(label)}</div>
        <div class='stat-num'>${esc(value)}</div>
    </div>`;
}

function distributionBlock(title, distribution) {
    if (!distribution || !Object.keys(distribution).length) return "";
    const total = Object.values(distribution).reduce((a, b) => a + b, 0) || 1;
    let html = `<div style='margin-bottom: 1.5rem;'>
        <h4 style='margin: 0 0 0.75rem 0; font-size: 0.95rem;'>${esc(title)}</h4>`;
    for (const [key, count] of Object.entries(distribution)) {
        const pct = Math.round((count / total) * 100);
        html += `<div class='dist-row'>
            <div class='dist-head'><span>${esc(key)}</span><span>${count} (${pct}%)</span></div>
            <div class='dist-track'><div class='dist-fill' style='width: ${pct}%;'></div></div>
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
    let overview = `<div class='r-stack' style='gap: 1.5rem;'>
        <div class='r-grid'>
            ${kpiCard("Entries analyzed", agg.entries_analyzed ?? 0, "neutral")}
            ${kpiCard("Valid", agg.valid_count ?? 0, "pass")}
            ${kpiCard("Invalid", agg.invalid_count ?? 0, (agg.invalid_count ? "fail" : "pass"))}
            ${kpiCard("Skipped", agg.entries_skipped ?? 0, (agg.entries_skipped ? "warn" : "neutral"))}
            ${kpiCard("Requests", agg.request_count ?? 0, "neutral")}
            ${kpiCard("Responses", agg.response_count ?? 0, "neutral")}
            ${kpiCard("Total warnings", agg.total_warnings ?? 0, (agg.total_warnings ? "warn" : "pass"))}
            ${kpiCard("Total errors", agg.total_errors ?? 0, (agg.total_errors ? "fail" : "pass"))}
        </div>`;

    const notes = (report.notes || []).concat(agg.notes || []);
    if (notes.length) {
        overview += `<div class='status-card info'>
            <span class='status-icon'>${icon('info')}</span>
            <div class='status-body'>${notes.map(n => `<div>• ${esc(n)}</div>`).join("")}</div>
        </div>`;
    }

    if ((report.line_errors || []).length) {
        overview += `<div class='status-card warn'>
            <span class='status-icon'>${icon('warn')}</span>
            <div class='status-body'>
                <div class='status-title'>${report.line_errors.length} unparseable line(s) skipped</div>
                ${report.line_errors.slice(0, 10).map(e => `<div>• line ${e.line}: ${esc(e.error)}</div>`).join("")}
            </div>
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
            overview += `<div class='r-grid'>
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
            overview += `<div class='r-grid'>
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
        table = "<div class='r-empty'>No entries could be analyzed.</div>";
    } else {
        const isRequest = rows.some(r => r.kind === "request");
        const headers = isRequest
            ? ["#", "ID", "Imps", "Format", "Inventory", "Environment", "CTV", "Version", "Floor", "Warn", "Err"]
            : ["#", "ID", "Seats", "Bids", "Min price", "Max price", "No-bid", "Creative", "Warn", "Err"];

        table = `<div class='r-table-wrap'><table class='r-table'>
            <thead><tr>${headers.map(h => `<th scope='col'>${esc(h)}</th>`).join("")}</tr></thead><tbody>`;

        rows.forEach(r => {
            const cells = r.kind === "request"
                ? [r.index, r.id, r.impressions, r.ad_format, r.inventory_source, r.environment,
                   `${r.ctv_score ?? "—"} (${r.ctv_label ?? "—"})`, r.version_guess,
                   r.min_floor === null || r.min_floor === undefined ? "—" : r.min_floor,
                   r.warning_count, r.error_count]
                : [r.index, r.id, r.seat_count, r.bid_count,
                   r.min_bid_price ?? "—", r.max_bid_price ?? "—",
                   r.no_bid_reason ?? "—", r.creative_metadata, r.warning_count, r.error_count];

            table += `<tr class='${r.error_count > 0 ? "has-error" : ""}'>` +
                cells.map(c => `<td>${esc(c)}</td>`).join("") + "</tr>";
        });
        table += "</tbody></table></div>";
    }

    if ((report.skipped || []).length) {
        table += `<div class='status-card warn' style='margin-top: 1.5rem;'>
            <span class='status-icon'>${icon('warn')}</span>
            <div class='status-body'>
                <div class='status-title'>Skipped entries</div>
                ${report.skipped.slice(0, 20).map(s => `<div>• entry ${s.index}: ${esc(s.reason)}</div>`).join("")}
            </div>
        </div>`;
    }
    document.getElementById("tab-batch").innerHTML = table;

    /* --- Warnings tab: ranked by frequency ---------------------------- */
    const topErrors = agg.top_errors || [];
    const topWarnings = agg.top_warnings || [];
    clearBadges();
    setBadge("warnings-badge", (agg.total_warnings || 0) + (agg.total_errors || 0),
             (agg.total_errors || 0) ? "fail" : "warn");
    setBadge("batch-badge", agg.entries_analyzed || 0, "neutral");

    let warnHtml = "";
    if (!topErrors.length && !topWarnings.length) {
        warnHtml = `<div class='r-empty'>${icon("check","icon-xl")}<div>No warnings or errors across the batch.</div></div>`;
    } else {
        const section = (title, items, tone) => {
            if (!items.length) return "";
            return `<h4 style='margin: 1rem 0 0.75rem 0;'>${esc(title)}</h4>` + items.map(item =>
                `<div class='status-card ${tone}' style='margin-bottom: 0.5rem;'>
                    <span class='status-icon' style='font-weight: 800; min-width: 3rem;'>${item.count}×</span>
                    <div class='status-body'>${esc(item.message)}</div>
                </div>`).join("");
        };
        warnHtml = section(`Most frequent errors (${agg.distinct_errors || 0} distinct)`, topErrors, "fail") +
                   section(`Most frequent warnings (${agg.distinct_warnings || 0} distinct)`, topWarnings, "warn");
    }
    document.getElementById("tab-warnings").innerHTML = warnHtml;

    /* --- Tabs that carry no meaning for a batch ----------------------- */
    const na = "<div class='r-empty'>Not applicable in Batch mode. Use the Overview, Batch, and Warnings tabs.</div>";
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
            // After the shell, not the textarea: the textarea now sits inside a
            // flex row next to the gutter, and a sibling there would be laid
            // out as a third column.
            (ta.closest(".editor-shell") || ta).insertAdjacentElement("afterend", status);

            let timer;
            ta.addEventListener("input", () => {
                clearTimeout(timer);
                timer = setTimeout(() => validateJSONField(ta, status), 350);
            });
        });
}

function validateJSONField(textarea, status) {
    const text = textarea.value.trim();
    const shell = textarea.closest(".editor-shell");

    if (!text) {
        status.textContent = "";
        status.className = "json-status";
        textarea.classList.remove("has-error");
        textarea.removeAttribute("aria-invalid");
        delete textarea.dataset.errorLine;
        renderGutter(textarea);
        return;
    }

    try {
        JSON.parse(text);
        status.textContent = "✓ Valid JSON";
        status.className = "json-status valid";
        textarea.classList.remove("has-error");
        textarea.removeAttribute("aria-invalid");
        delete textarea.dataset.errorLine;
    } catch (err) {
        const where = jsonErrorLocation(textarea.value, err);
        status.textContent = `✗ ${err.message}${where}`;
        status.className = "json-status invalid";
        textarea.classList.add("has-error");
        textarea.setAttribute("aria-invalid", "true");
        const line = jsonErrorLine(textarea.value, err);
        if (line) textarea.dataset.errorLine = String(line);
        else delete textarea.dataset.errorLine;
    }
    if (shell) shell.classList.toggle("has-error", textarea.classList.contains("has-error"));
    renderGutter(textarea);
}

/* The numeric counterpart of jsonErrorLocation, used to highlight the
   failing row in the gutter. */
function jsonErrorLine(text, err) {
    const named = /line (\d+)/i.exec(err.message);
    if (named) return Number(named[1]);
    const pos = /position (\d+)/.exec(err.message);
    if (!pos) return null;
    return text.slice(0, Number(pos[1])).split("\n").length;
}

/* ── Line-number gutter ───────────────────────────────────────────────
   A real textarea with a synced gutter, rather than a contenteditable
   rewrite: it keeps native undo, spellcheck control, IME and accessibility
   behaviour that a custom editor would have to reimplement. */
function renderGutter(textarea) {
    const shell = textarea.closest(".editor-shell");
    const gutter = shell?.querySelector(".editor-gutter");
    if (!gutter) return;

    const lines = textarea.value ? textarea.value.split("\n").length : 1;
    const errorLine = Number(textarea.dataset.errorLine || 0);

    let html = "";
    for (let n = 1; n <= lines; n++) {
        html += n === errorLine
            ? `<span class='gutter-error'>${n}</span>\n`
            : `${n}\n`;
    }
    gutter.innerHTML = html;
    gutter.scrollTop = textarea.scrollTop;
}

function setupEditors() {
    document.querySelectorAll(".editor-shell .code-input").forEach(ta => {
        renderGutter(ta);
        ta.addEventListener("input", () => renderGutter(ta));
        // Native scroll on the textarea; the gutter follows it.
        ta.addEventListener("scroll", () => {
            const g = ta.closest(".editor-shell")?.querySelector(".editor-gutter");
            if (g) g.scrollTop = ta.scrollTop;
        });
    });
}

/* Editor toolbar actions. */
function copyEditor(id) {
    const ta = document.getElementById(id);
    if (!ta || !ta.value.trim()) {
        showStatus("Nothing to copy", "info");
        return;
    }
    navigator.clipboard.writeText(ta.value).then(() => showStatus("Copied to clipboard", "success"));
}

function clearEditor(id) {
    const ta = document.getElementById(id);
    if (!ta) return;
    ta.value = "";
    ta.dispatchEvent(new Event("input"));
    showStatus("Editor cleared", "info");
}

function loadFirstSample(mode) {
    const sample = state.samples.find(s => s.kind === mode);
    if (!sample) {
        showStatus("No sample available", "error");
        return;
    }
    const ta = document.getElementById(`${mode}-raw`);
    ta.value = sample.content;
    ta.dispatchEvent(new Event("input"));
    showStatus(`Loaded ${sample.name}`, "success");
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
        showStatus("JSON formatted", "success");
    } catch (err) {
        showStatus("Invalid JSON: " + err.message, "error");
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
            ${icon('file')} ${s.name.replace('sample_', '').replace(`.json`, '')}
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
    showStatus(`Loaded ${sampleName}`, "success");
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
        showStatus("Fetching...", "info");
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
            showStatus(`${data.error || "Fetch failed"}`, "error");
            return;
        }

        const target = document.getElementById(`${mode}-raw`);
        target.value = data.text || "";
        target.dispatchEvent(new Event("input"));   // run JSON validation
        (data.notes || []).forEach(n => showStatus(n, "error"));
        showStatus("Fetched successfully", "success");
    } catch (err) {
        showStatus(`Fetch failed: ${err.message}`, "error");
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

    // Explicit on both sides. Setting only "dark" would leave a machine whose
    // OS is dark stuck on the prefers-color-scheme values when toggled light.
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');

    toggle.querySelector('use')?.setAttribute('href', dark ? '#i-sun' : '#i-moon');
    // The icon carries no meaning for screen readers, so state lives here.
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
    showStatus("CSV exported successfully", "success");
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
    showStatus("Report exported (open in browser and print as PDF)", "success");
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
