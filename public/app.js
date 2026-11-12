const $ = (id) => document.getElementById(id);
const jobTokens = new Map();
const loadingControls = [
  ...document.querySelectorAll("button,input,select,textarea"),
].map((control) => [control, control.disabled]);
for (const [control] of loadingControls) control.disabled = true;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (value) => (value == null ? "Unknown" : "$" + value.toFixed(6));
const link = (value) =>
  /^https?:\/\//i.test(value || "")
    ? `<a href="${esc(value)}" target="_blank" rel="noopener noreferrer">Source ↗</a>`
    : "No source";
let config,
  token = "",
  snapshot = { organizations: [], jobs: [], notes: [] },
  selectedJob,
  busy = false,
  starting = false,
  pause = false,
  refreshSequence = 0;
async function api(action, body) {
  if (action === "step" && body && jobTokens.has(body.jobId))
    body = { ...body, jobToken: jobTokens.get(body.jobId) };
  const response = await fetch("/api/lab?action=" + action, {
    method: body ? "POST" : "GET",
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  if (data.job?.id && data.jobToken) jobTokens.set(data.job.id, data.jobToken);
  return data;
}
function message(text, error = false) {
  $("message").textContent = text;
  $("message").className = error ? "error" : "";
}
function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function plan() {
  if (!config) return;
  const operation = $("operation").value,
    recipe = $("recipe").value;
  let stages = config.plans[operation][recipe];
  $("fresh").disabled = operation !== "meeting";
  $("reuse").disabled = operation !== "profile" || !$("profile").value;
  if (operation === "meeting" && $("fresh").checked)
    stages = [...config.plans.news[recipe], ...stages];
  if (operation === "profile" && $("reuse").checked && $("profile").value) {
    $("plan").innerHTML =
      "<p>Saved-version lookup · 0 provider calls · no new version. This does not refresh research.</p>";
    return;
  }
  $("plan").innerHTML =
    `<p>${stages.length} planned provider call${stages.length === 1 ? "" : "s"} in live mode. Mock mode makes none. Limits are caps, not guaranteed usage or completeness.</p>` +
    table(
      ["Stage", "Model", "Reasoning", "Output cap", "Search cap"],
      stages.map(
        (s) =>
          `<tr><td>${esc(s.label)}</td><td>${esc(s.model)}</td><td>${esc(s.reasoning)}</td><td>${s.outputTokens.toLocaleString()}</td><td>${s.searchLimit}</td></tr>`,
      ),
    );
}
function notes() {
  const rows = snapshot.notes.filter(
    (n) => n.organizationId === $("note-org").value,
  );
  $("notes").innerHTML = rows.length
    ? rows
        .map(
          (n) =>
            `<div class="note"><small>${esc(n.author)} · ${esc(n.createdAt)}</small><p>${esc(n.text)}</p></div>`,
        )
        .join("")
    : '<p class="muted">No shared notes.</p>';
}
async function refresh() {
  const sequence = ++refreshSequence;
  try {
    const loaded = await api("snapshot");
    if (sequence !== refreshSequence) return;
    snapshot = loaded;
    $("account-state").textContent =
      `Account ${snapshot.account.id} · ${snapshot.account.role} · ${snapshot.backend}`;
    const profile = $("profile").value,
      noteOrg = $("note-org").value;
    $("profile").innerHTML =
      '<option value="">New organization / supplied text</option>' +
      snapshot.organizations
        .filter((o) => o.versions.length)
        .map(
          (o) =>
            `<option value="${o.id}">${esc(o.name)} · v${o.versions.at(-1).version} · ${esc(o.versions.at(-1).mode)}</option>`,
        )
        .join("");
    $("profile").value = snapshot.organizations.some((o) => o.id === profile)
      ? profile
      : "";
    $("note-org").innerHTML = snapshot.organizations
      .map((o) => `<option value="${o.id}">${esc(o.name)}</option>`)
      .join("");
    if (snapshot.organizations.some((o) => o.id === noteOrg))
      $("note-org").value = noteOrg;
    notes();
    $("versions").innerHTML = table(
      [
        "Organization / ID",
        "Scope",
        "Version",
        "Mode / recipe",
        "Created / source workflow",
      ],
      snapshot.organizations.flatMap((o) =>
        o.versions.map(
          (v) =>
            `<tr><td>${esc(o.name)}<br><small>${o.id}</small></td><td>${esc(o.entityScope || "Unspecified")}</td><td>${v.version}<br><small>${v.id}</small></td><td>${esc(v.mode)} / ${esc(v.recipe || "storage probe")}</td><td>${esc(v.createdAt)}<br><small>${esc(v.jobId || "No API call")}</small></td></tr>`,
        ),
      ),
    );
    $("history").innerHTML = table(
      ["Created", "Workflow / subject", "Status", "Cost estimate", "Action"],
      snapshot.jobs
        .slice()
        .reverse()
        .map(
          (j) =>
            `<tr><td>${esc(j.createdAt)}</td><td>${esc(config.operations[j.operation].label)}<br>${esc(j.input.organization)}<br><small>${j.id}</small></td><td>${esc(j.status)} · ${esc(j.mode)}</td><td>${money(j.total?.usd)}${j.total?.uncertainStages ? "<br>Known subtotal " + money(j.total.knownSubtotalUsd) : ""}</td><td><button data-view="${j.id}">Inspect</button>${j.status === "queued" && j.createdBy === snapshot.account.id ? `<button data-resume="${j.id}" ${busy ? "disabled" : ""}>Resume</button>` : ""}</td></tr>`,
        ),
    );
    for (const b of document.querySelectorAll("[data-view]"))
      b.onclick = () =>
        render(snapshot.jobs.find((j) => j.id === b.dataset.view));
    for (const b of document.querySelectorAll("[data-resume]"))
      b.onclick = () =>
        run(snapshot.jobs.find((j) => j.id === b.dataset.resume));
    plan();
    return snapshot;
  } catch (error) {
    if (sequence !== refreshSequence) return;
    snapshot = { organizations: [], jobs: [], notes: [] };
    selectedJob = null;
    for (const id of ["versions", "history", "notes", "result"])
      $(id).textContent = "No records loaded for this account.";
    $("profile").innerHTML =
      '<option value="">New organization / supplied text</option>';
    $("note-org").innerHTML = "";
    $("export").disabled = true;
    $("account-state").textContent = error.message;
    throw error;
  }
}
function render(job) {
  selectedJob = job;
  $("export").disabled = false;
  const total = job.total || { usd: 0, knownSubtotalUsd: 0 };
  let html = `<div class="receipt"><strong>${esc(job.input.organization)} · ${esc(job.status)} · ${esc(job.mode)}</strong><br>Workflow ${job.id}<br>${job.reused ? "Saved profile reused · no new research or version<br>" : ""}Cost estimate: <strong>${money(total.usd)}</strong> · Known subtotal: ${money(total.knownSubtotalUsd)} · ${total.providerCalls || 0} live calls started · ${total.searchCalls || 0} searches<br>${total.inputTokens || 0} input / ${total.outputTokens || 0} output tokens · ${total.uncertainStages || 0} stages with unknown cost</div>`;
  html += table(
    [
      "Stage",
      "Status / model",
      "Tokens in / out",
      "Searches / seconds",
      "Estimated cost",
      "Provider reference",
    ],
    job.steps.map(
      (s) =>
        `<tr><td>${esc(s.label)}</td><td>${esc(s.status)}<br>${esc(s.model)}${s.error ? `<p class="error">${esc(s.error)}</p>` : ""}</td><td>${s.usage?.input_tokens ?? "—"} / ${s.usage?.output_tokens ?? "—"}</td><td>${s.searchCalls ?? "—"} / ${s.elapsedMs == null ? "—" : (s.elapsedMs / 1000).toFixed(1)}</td><td>${s.status === "queued" ? "Not called" : money(s.cost?.usd)}${s.cost?.lowUsd != null && s.cost?.usd == null ? "<br>" + money(s.cost.lowUsd) + "–" + money(s.cost.highUsd) : ""}</td><td>${esc(s.providerRequestId || "—")}</td></tr>`,
    ),
  );
  if (job.mode === "mock")
    html +=
      '<p class="error">Synthetic fixture: not researched. Zero cost is not a live price estimate.</p>';
  if (job.coverage)
    html += `<details open><summary>Research coverage · automated, not independent verification</summary><p>${job.coverage.sourcedFacts} facts with source links · ${job.coverage.annualPeriods.length} reported annual periods · Statements: ${esc(job.coverage.statements.join(", ") || "none")}</p><p>${job.coverage.sections.map((s) => `<span class="tag">${esc(s.key)}: ${esc(s.coverage)}</span>`).join(" ")}</p></details>`;
  if (job.document) {
    const d = job.document;
    html += `<h3>${esc(d.title)}</h3><p>${esc(d.summary)}</p><div class="facts">${d.sections.map((s) => `<section class="fact-section"><h3>${esc(s.key.replaceAll("_", " "))}</h3><small>${esc(s.coverage)}</small>${s.facts.map((f) => `<p><strong>${esc(f.label)}</strong><br>${esc(f.detail)}<br><small>${esc(f.date || "Date not supplied")} · ${link(f.source_url)}</small></p>`).join("")}</section>`).join("")}</div>`;
    if (d.financials.length)
      html +=
        "<h3>Financial statement rows</h3>" +
        table(
          [
            "Statement",
            "Metric",
            "Period / type",
            "Amount / unit",
            "Currency",
            "Source",
          ],
          d.financials.map(
            (f) =>
              `<tr><td>${esc(f.statement)}</td><td>${esc(f.metric)}</td><td>${esc(f.period)} / ${esc(f.period_type)}</td><td>${f.amount == null ? "Unknown" : f.amount.toLocaleString()} ${esc(f.unit)}</td><td>${esc(f.currency)}</td><td>${link(f.source_url)}<br>${esc(f.date)}</td></tr>`,
          ),
        );
    if (d.questions.length)
      html +=
        "<h3>Discussion directions</h3>" +
        d.questions
          .map(
            (q) =>
              `<section class="fact-section"><strong>${esc(q.question)}</strong><p>Premise: ${esc(q.premise)}</p><p>Possible role: ${esc(q.possible_role)}</p><p>Unknowns: ${esc(q.unknowns)}</p>${q.source_urls.map(link).join(" · ")}</section>`,
          )
          .join("");
    html +=
      "<h3>Gaps and limitations</h3><ul>" +
      d.gaps.map((g) => `<li>${esc(g)}</li>`).join("") +
      "</ul>";
  }
  $("result").innerHTML = html;
}
async function run(job) {
  if (busy) return;
  busy = true;
  pause = false;
  $("start").disabled = true;
  $("pause").disabled = false;
  $("actor").disabled = true;
  $("signout").disabled = true;
  try {
    render(job);
    while (job.status === "queued" && !pause) {
      const index = job.steps.findIndex((s) => s.status === "queued");
      message(
        `Running ${index + 1}/${job.steps.length}: ${job.steps[index].label}. Keep this tab open.`,
      );
      const response = await api("step", { jobId: job.id, stageIndex: index });
      if (response.persisted === false) {
        selectedJob = { ...job, unsavedReceipt: response.receipt };
        $("export").disabled = false;
        throw new Error(response.error);
      }
      job = response.job;
      render(job);
    }
    message(
      job.status === "complete"
        ? "Workflow complete. Inspect coverage and receipts below."
        : job.status === "failed"
          ? "Stage failed. Its receipt is retained; no automatic retry."
          : "Paused. Use Resume in history to continue queued stages.",
    );
  } catch (error) {
    message(error.message, true);
  } finally {
    busy = false;
    $("start").disabled = false;
    $("pause").disabled = true;
    $("actor").disabled = false;
    $("signout").disabled = false;
    await refresh().catch((e) => message(e.message, true));
  }
}
$("run-form").onsubmit = async (event) => {
  event.preventDefault();
  if (busy || starting) return;
  starting = true;
  $("start").disabled = true;
  try {
    const response = await api("start", {
      requestId: crypto.randomUUID(),
      operation: $("operation").value,
      recipe: $("recipe").value,
      mode: $("mode").value,
      organization: $("organization").value,
      domain: $("domain").value,
      entityScope: $("scope").value,
      organizationType: $("orgtype").value,
      goal: $("goal").value,
      context: $("context").value,
      profileId: $("profile").value || null,
      reuseProfile: $("reuse").checked,
      freshNews: $("fresh").checked,
    });
    await run(response.job);
  } catch (error) {
    message(error.message, true);
  } finally {
    starting = false;
    if (!busy) $("start").disabled = false;
  }
};
$("pause").onclick = () => {
  pause = true;
  message(
    "Pause requested. The current stage will finish and save its receipt.",
  );
};
for (const id of ["operation", "recipe", "fresh", "reuse"])
  $(id).onchange = plan;
$("profile").onchange = () => {
  const org = snapshot.organizations.find((o) => o.id === $("profile").value);
  if (org) {
    $("organization").value = org.name;
    $("domain").value = org.domain;
    $("scope").value = org.entityScope;
    $("note-org").value = org.id;
    notes();
  } else $("reuse").checked = false;
  plan();
};
$("note-org").onchange = notes;
$("actor").onchange = async () => {
  token = $("actor").value;
  selectedJob = null;
  $("export").disabled = true;
  $("result").textContent = "Select a workflow for this account.";
  $("probe-result").textContent = "";
  await refresh()
    .then(() => message("Shared records loaded for this account."))
    .catch((e) => message(e.message, true));
};
$("reload").onclick = () =>
  refresh()
    .then(() => message("Shared records reloaded."))
    .catch((e) => message(e.message, true));
$("probe").onclick = async () => {
  try {
    const probe = await api("storage-probe", {
      requestId: crypto.randomUUID(),
    });
    $("probe-result").textContent =
      `Written to ${probe.backend}. Org ${probe.organizationId}; version ${probe.versionId}; note ${probe.noteId}. Zero API calls. Switch accounts and compare these IDs below.`;
    await refresh();
    $("note-org").value = probe.organizationId;
    notes();
  } catch (e) {
    message(e.message, true);
  }
};
$("save-note").onclick = async () => {
  try {
    await api("note", {
      requestId: crypto.randomUUID(),
      organizationId: $("note-org").value,
      text: $("note").value,
    });
    $("note").value = "";
    await refresh();
    message("Shared note saved.");
  } catch (e) {
    message(e.message, true);
  }
};
$("auth-form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const response = await fetch(
      config.signInUrl + "/auth/v1/token?grant_type=password",
      {
        method: "POST",
        headers: {
          apikey: config.publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: $("email").value,
          password: $("password").value,
        }),
      },
    );
    const data = await response.json();
    $("password").value = "";
    if (!response.ok || !data.access_token)
      throw new Error("Sign-in failed. Check the test account credentials.");
    token = data.access_token;
    await refresh();
    message("Signed in.");
  } catch (e) {
    token = "";
    await refresh().catch(() => {});
    message(e.message, true);
  }
};
$("access-form").onsubmit = async (event) => {
  event.preventDefault();
  token = $("access-key").value;
  $("access-key").value = "";
  try {
    await refresh();
    message(
      "API test environment unlocked. Results are temporary without Supabase.",
    );
  } catch (error) {
    token = "";
    message(error.message, true);
  }
};
$("signout").onclick = async () => {
  if (token)
    await fetch(config.signInUrl + "/auth/v1/logout", {
      method: "POST",
      headers: {
        apikey: config.publishableKey,
        Authorization: "Bearer " + token,
      },
    }).catch(() => {});
  token = "";
  $("context").value = "";
  $("note").value = "";
  $("probe-result").textContent = "";
  await refresh().catch(() => {});
  message("Signed out.");
};
$("export").onclick = () => {
  if (!selectedJob) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(selectedJob, null, 2)], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "research-receipt-" + selectedJob.id + ".json";
  a.click();
  URL.revokeObjectURL(url);
};
try {
  config = await api("status");
  $("backend").textContent = config.backend;
  $("environment").textContent = config.message;
  $("operation").innerHTML = Object.entries(config.operations)
    .map(([id, o]) => `<option value="${id}">${esc(o.label)}</option>`)
    .join("");
  $("recipe").innerHTML = Object.entries(config.recipes)
    .map(
      ([id, label]) =>
        `<option value="${id}" ${id === "hybrid" ? "selected" : ""}>${esc(label)}</option>`,
    )
    .join("");
  $("mode").querySelector('[value="live"]').disabled = !config.liveEnabled;
  $("demo-auth").hidden =
    config.backend === "supabase" || config.accessKeyRequired;
  $("access-form").hidden = !config.accessKeyRequired;
  $("auth-form").hidden = config.backend !== "supabase";
  if (config.backend !== "supabase" && !config.accessKeyRequired)
    token = "demo-a";
  $("pricing").textContent =
    `USD estimate · pricing checked ${config.pricing.checkedOn} · ${config.pricing.tier}. Hourly live-call limit: ${config.hourlyLiveCalls} per member. Review rates before live benchmarking.`;
  plan();
  if (config.accessKeyRequired)
    $("account-state").textContent =
      "Enter the lab access key above. Supabase is not required for API tests.";
  else await refresh();
} catch (e) {
  message(e.message, true);
} finally {
  for (const [control, disabled] of loadingControls)
    control.disabled = disabled;
  if (config) plan();
}
