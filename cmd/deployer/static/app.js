const state = {
  namespace: localStorage.getItem("openclaw-deployer.namespace") || "",
  provider: localStorage.getItem("openclaw-deployer.provider") || "openrouter",
  selectedName: localStorage.getItem("openclaw-deployer.name") || "instance",
  model: localStorage.getItem("openclaw-deployer.model") || "",
  gcpProject: localStorage.getItem("openclaw-deployer.gcpProject") || "",
  gcpLocation: localStorage.getItem("openclaw-deployer.gcpLocation") || "",
  filesystemSource: localStorage.getItem("openclaw-deployer.filesystemSource") || "",
  gitURL: localStorage.getItem("openclaw-deployer.gitURL") || "",
  gitRef: localStorage.getItem("openclaw-deployer.gitRef") || "",
  gitPath: localStorage.getItem("openclaw-deployer.gitPath") || "",
  theme: localStorage.getItem("openclaw-deployer.theme") === "dark" ? "dark" : "light",
  claws: [],
  namespaceSuggestions: [],
  exists: false,
  ready: false,
  submitted: false,
  copied: "",
};

const providerLabels = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  google: "Google Gemini",
  "google-vertex": "Google Vertex AI (Gemini)",
  anthropic: "Anthropic",
  "anthropic-vertex": "Google Vertex AI (Claude)",
  xai: "xAI",
};

const modelDefaults = {
  anthropic: "anthropic/claude-sonnet-4-6",
  "anthropic-vertex": "anthropic-vertex/claude-sonnet-4-6",
  google: "google/gemini-3.1-pro-preview",
  "google-vertex": "google/gemini-3.1-pro-preview",
  openai: "openai/gpt-5.5",
  openrouter: "openrouter/anthropic/claude-sonnet-4-6",
  xai: "xai/grok-4.3",
};

if (Object.values(modelDefaults).includes(state.model)) {
  state.model = "";
  localStorage.removeItem("openclaw-deployer.model");
}

const modelOptions = {
  anthropic: ["anthropic/claude-sonnet-4-6", "anthropic/claude-haiku-4-5"],
  "anthropic-vertex": ["anthropic-vertex/claude-sonnet-4-6", "anthropic-vertex/claude-opus-4-8", "anthropic-vertex/claude-opus-4-7"],
  google: ["google/gemini-3.1-pro-preview", "google/gemini-3.5-flash", "google/gemini-3.1-flash-lite"],
  "google-vertex": ["google/gemini-3.1-pro-preview", "google/gemini-3.5-flash", "google/gemini-3.1-flash-lite"],
  openai: ["openai/gpt-5.5", "openai/gpt-5.4", "openai/gpt-5.4-mini"],
  openrouter: ["openrouter/anthropic/claude-sonnet-4-6", "openrouter/openai/gpt-5.5", "openrouter/google/gemini-3.5-flash", "openrouter/auto"],
  xai: ["xai/grok-4.3", "xai/grok-4.20"],
};

const googleVertexProviders = new Set(["anthropic-vertex", "google-vertex"]);

const defaultGCPLocations = {
  "anthropic-vertex": "us-east5",
  "google-vertex": "us-central1",
};

const els = {
  themeToggle: document.getElementById("theme-toggle"),
  avatar: document.getElementById("avatar"),
  user: document.getElementById("user"),
  namespace: document.getElementById("namespace"),
  namespaceOptions: document.getElementById("namespace-options"),
  clawName: document.getElementById("clawName"),
  provider: document.getElementById("provider"),
  model: document.getElementById("model"),
  modelOptions: document.getElementById("model-options"),
  defaultModel: document.getElementById("default-model"),
  vertexBox: document.getElementById("vertex-box"),
  gcpProject: document.getElementById("gcpProject"),
  gcpLocation: document.getElementById("gcpLocation"),
  credentialLabel: document.getElementById("credential-label"),
  vertexGuide: document.getElementById("vertex-guide"),
  vertexHelp: document.getElementById("vertex-help"),
  apiKey: document.getElementById("apiKey"),
  gcpCredentials: document.getElementById("gcpCredentials"),
  advancedToggle: document.getElementById("advanced-toggle"),
  advancedCaret: document.getElementById("advanced-caret"),
  advancedBody: document.getElementById("advanced-body"),
  filesystemSource: document.getElementById("filesystemSource"),
  filesystemSourceHint: document.getElementById("filesystem-source-hint"),
  workspaceSourceHelp: document.getElementById("workspace-source-help"),
  gitBox: document.getElementById("git-box"),
  gitURL: document.getElementById("gitURL"),
  gitRef: document.getElementById("gitRef"),
  gitPath: document.getElementById("gitPath"),
  uploadBox: document.getElementById("upload-box"),
  agentFiles: document.getElementById("agentFiles"),
  uploadName: document.getElementById("upload-name"),
  provision: document.getElementById("provision"),
  reset: document.getElementById("reset"),
  previewOpen: document.getElementById("preview-open"),
  alert: document.getElementById("alert"),
  reviewList: document.getElementById("review-list"),
  instancesCount: document.getElementById("instances-count"),
  instancesBody: document.getElementById("instances-body"),
  previewOverlay: document.getElementById("preview-overlay"),
  previewDialog: document.getElementById("preview-dialog"),
  previewYaml: document.getElementById("preview-yaml"),
  copyYaml: document.getElementById("copy-yaml"),
  previewClose: document.getElementById("preview-close"),
  previewClose2: document.getElementById("preview-close-2"),
};

els.namespace.value = state.namespace;
els.clawName.value = state.selectedName;
els.provider.value = state.provider;
els.model.value = state.model;
els.gcpProject.value = state.gcpProject;
els.gcpLocation.value = state.gcpLocation || defaultGCPLocations[state.provider] || "";
els.filesystemSource.value = state.filesystemSource;
els.gitURL.value = state.gitURL;
els.gitRef.value = state.gitRef;
els.gitPath.value = state.gitPath;

applyTheme(state.theme);
renderModelOptions();
renderCredentialFields();
renderFilesystemSource();
renderReview();

// ---------- helpers ----------
function isGoogleVertex() {
  return googleVertexProviders.has(els.provider.value);
}

// Management is inferred: choosing a workspace source means the user manages
// config; leaving it as "None" leaves the operator in control. This replaces
// the former Config owner radio toggle while keeping the /api/provision
// contract (which still accepts `management`) unchanged.
function inferredManagement() {
  const source = els.filesystemSource.value;
  return source === "git" || source === "upload" ? "user" : "operator";
}

function effectiveModel() {
  return els.model.value.trim() || modelDefaults[els.provider.value] || "";
}

function applyTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", state.theme);
  localStorage.setItem("openclaw-deployer.theme", state.theme);
  const toDark = state.theme === "dark";
  els.themeToggle.textContent = toDark ? "☀" : "☾";
  const aria = toDark ? "Switch to light mode" : "Switch to dark mode";
  els.themeToggle.setAttribute("aria-label", aria);
  els.themeToggle.setAttribute("title", aria);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

async function init() {
  try {
    const me = await api("/api/me");
    if (me.defaultNamespace && !state.namespace) {
      state.namespace = me.defaultNamespace;
      els.namespace.value = state.namespace;
      localStorage.setItem("openclaw-deployer.namespace", state.namespace);
    }
    if (me.user) {
      els.user.textContent = me.user;
      els.avatar.textContent = me.user.slice(0, 2).toUpperCase();
    }
  } catch (error) {
    renderAlert({ kind: "danger", title: "Couldn't load your session", body: error.message });
    return;
  }
  await loadNamespaceSuggestions();
  await refresh();
}

// One-time cluster-wide read so the namespace field can suggest every namespace
// the user can see, without making each refresh list Claws cluster-wide.
async function loadNamespaceSuggestions() {
  try {
    const all = await api("/api/claws");
    state.namespaceSuggestions = [...new Set((all.claws || []).map((claw) => claw.namespace).filter(Boolean))].sort();
    renderNamespaceOptions([]);
  } catch {
    // Best effort: the namespace field stays editable without suggestions.
  }
}

async function refresh() {
  state.namespace = els.namespace.value.trim();
  state.selectedName = els.clawName.value.trim() || "instance";
  state.provider = els.provider.value;
  state.model = els.model.value.trim();
  state.gcpProject = els.gcpProject.value.trim();
  state.gcpLocation = els.gcpLocation.value.trim();
  localStorage.setItem("openclaw-deployer.namespace", state.namespace);
  localStorage.setItem("openclaw-deployer.name", state.selectedName);
  localStorage.setItem("openclaw-deployer.provider", state.provider);
  localStorage.setItem("openclaw-deployer.model", state.model);
  localStorage.setItem("openclaw-deployer.gcpProject", state.gcpProject);
  localStorage.setItem("openclaw-deployer.gcpLocation", state.gcpLocation);

  setStatus("Checking status…");
  try {
    const current = await api("/api/claws");
    renderList(current.claws || []);
  } catch (error) {
    renderList([]);
    renderAlert({ kind: "danger", title: "Couldn't list instances", body: error.message });
  }
}

function renderList(claws) {
  state.claws = claws;
  renderNamespaceOptions(claws);
  let selected = null;
  if (state.namespace) {
    selected = claws.find((claw) => (claw.namespace || state.namespace) === state.namespace && claw.name === state.selectedName) || null;
  }
  state.exists = Boolean(selected);
  state.ready = Boolean(selected && selected.ready);
  if (selected) {
    if (selected.model) {
      els.model.value = selected.model;
      state.model = selected.model;
      localStorage.setItem("openclaw-deployer.model", selected.model);
    }
  }

  els.provision.textContent = state.exists ? "Add/update provider" : "Create";
  renderClaws(claws);
  renderReview();

  if (!state.namespace) {
    renderAlert({ kind: "idle", title: "Ready to configure", body: "Choose the namespace where your OpenClaw should run, then deploy." });
    return;
  }
  if (!state.exists) {
    renderAlert({ kind: "idle", title: "Ready to deploy", body: `No OpenClaw named ${state.selectedName} is running in project ${state.namespace}.` });
    return;
  }
  if (selected.ready) {
    renderAlert({
      kind: "success",
      title: `${selected.name} is ready`,
      body: `Your OpenClaw is running in ${state.namespace}. Further customizations can be made from the OpenClaw Control UI or the Claw CR.`,
      link: isSafeHref(selected.gatewayURL) ? selected.gatewayURL : "",
    });
    return;
  }
  if (statusKind(selected) === "failed") {
    renderAlert({ kind: "danger", title: `${selected.name} failed to deploy`, body: selected.message || selected.reason || "The Claw reported a failure." });
    return;
  }
  renderAlert({ kind: "info", title: `Deploying ${selected.name}`, body: selected.message || selected.reason || `${selected.name} is provisioning.`, spin: true });
}

function renderNamespaceOptions(claws) {
  const namespaces = [
    ...new Set([...state.namespaceSuggestions, ...claws.map((claw) => claw.namespace).filter(Boolean)]),
  ].sort();
  els.namespaceOptions.innerHTML = "";
  for (const namespace of namespaces) {
    const option = document.createElement("option");
    option.value = namespace;
    els.namespaceOptions.appendChild(option);
  }
}

// The backend exposes `ready` plus a free-form condition reason/message. Map a
// not-ready Claw to "failed" only on clear failure signals, otherwise treat it
// as still deploying.
const failurePattern = /fail|error|backoff|crash|invalid|denied|forbidden|unauthor|not ?found|missing|quota|exceeded|insufficient|timeout/i;

function statusKind(claw) {
  if (claw.ready) {
    return "ready";
  }
  if (failurePattern.test(`${claw.reason || ""} ${claw.message || ""}`)) {
    return "failed";
  }
  return "deploying";
}

const statusMeta = {
  ready: { label: "Ready", cls: "status-label--ready" },
  deploying: { label: "Deploying", cls: "status-label--deploying" },
  failed: { label: "Failed", cls: "status-label--failed" },
};

function statusIcon(kind) {
  if (kind === "ready") {
    return '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="var(--success-border)"/><path d="M5 8.2l2 2 4-4.4" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  if (kind === "failed") {
    return '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="var(--danger-border)"/><path d="M8 4.3v4.4" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.3" r="1" fill="var(--surface)"/></svg>';
  }
  return '<span class="spinner"></span>';
}

function renderClaws(claws) {
  els.instancesCount.textContent = String(claws.length);
  els.instancesBody.innerHTML = "";

  if (claws.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML =
      '<div class="empty__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="6" width="16" height="12" rx="2" stroke="var(--text-muted)" stroke-width="1.5"/><path d="M4 10h16" stroke="var(--text-muted)" stroke-width="1.5"/></svg></div>' +
      "<h3>No OpenClaw instances</h3>" +
      `<p>${state.namespace ? "Deploy your first instance using the form above." : "Choose a namespace to see its instances."}</p>`;
    els.instancesBody.appendChild(empty);
    return;
  }

  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("div");
  table.className = "table";
  table.innerHTML =
    '<div class="table__col-head">Instance</div>' +
    '<div class="table__col-head">Provider</div>' +
    '<div class="table__col-head">Status</div>' +
    '<div class="table__col-head right">Actions</div>';

  for (const claw of claws) {
    const namespace = claw.namespace || state.namespace;
    const isSelected = namespace === state.namespace && claw.name === state.selectedName;
    const kind = statusKind(claw);
    const meta = statusMeta[kind];

    const nameCell = document.createElement("div");
    nameCell.className = `table__cell name-cell${isSelected ? " selected" : ""}`;
    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "instance-name";
    nameBtn.textContent = claw.name;
    nameBtn.addEventListener("click", () => {
      state.namespace = namespace;
      state.selectedName = claw.name;
      els.namespace.value = namespace;
      els.clawName.value = claw.name;
      localStorage.setItem("openclaw-deployer.namespace", namespace);
      localStorage.setItem("openclaw-deployer.name", claw.name);
      renderList(state.claws);
    });
    const nsDiv = document.createElement("div");
    nsDiv.className = "instance-ns";
    nsDiv.textContent = namespace;
    nameCell.append(nameBtn, nsDiv);

    const providerCell = document.createElement("div");
    providerCell.className = "table__cell provider-cell";
    providerCell.textContent = providerLabels[claw.provider] || claw.provider || "—";

    const statusCell = document.createElement("div");
    statusCell.className = "table__cell";
    const label = document.createElement("span");
    label.className = `status-label ${meta.cls}`;
    label.innerHTML = `${statusIcon(kind)}<span>${meta.label}</span>`;
    statusCell.appendChild(label);
    const reasonText = claw.message || claw.reason || "";
    if (reasonText && kind !== "ready") {
      const reason = document.createElement("div");
      reason.className = "status-reason";
      reason.textContent = reasonText;
      statusCell.appendChild(reason);
    }

    const actionsCell = document.createElement("div");
    actionsCell.className = "table__cell actions-cell";
    const actions = document.createElement("div");
    actions.className = "row-actions";
    if (isSafeHref(claw.gatewayURL)) {
      const link = document.createElement("a");
      link.className = "btn btn--sm";
      link.href = claw.gatewayURL;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Control UI";
      actions.appendChild(link);
    }
    const restart = document.createElement("button");
    restart.type = "button";
    restart.className = "btn btn--sm claw-action";
    restart.textContent = "Restart";
    restart.addEventListener("click", (event) => {
      event.stopPropagation();
      restartClaw(namespace, claw.name);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn--sm btn--danger claw-action";
    remove.textContent = "Delete";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteClaw(namespace, claw.name);
    });
    actions.append(restart, remove);
    actionsCell.appendChild(actions);

    table.append(nameCell, providerCell, statusCell, actionsCell);
  }

  scroll.appendChild(table);
  els.instancesBody.appendChild(scroll);
}

function renderModelOptions() {
  els.modelOptions.innerHTML = "";
  for (const model of modelOptions[els.provider.value] || []) {
    const option = document.createElement("option");
    option.value = model;
    els.modelOptions.appendChild(option);
  }
  els.defaultModel.textContent = modelDefaults[els.provider.value] || "—";
}

function renderCredentialFields() {
  const vertex = isGoogleVertex();
  els.vertexBox.hidden = !vertex;
  els.credentialLabel.textContent = vertex ? "Service account key" : "API key";
  els.apiKey.hidden = vertex;
  els.gcpCredentials.hidden = !vertex;
  els.vertexGuide.hidden = !vertex;
  els.vertexHelp.hidden = !vertex;
  if (vertex && !els.gcpLocation.value.trim()) {
    els.gcpLocation.value = defaultGCPLocations[els.provider.value] || "";
  }
}

function renderFilesystemSource() {
  const source = els.filesystemSource.value;
  els.gitBox.hidden = source !== "git";
  els.uploadBox.hidden = source !== "upload";
  els.workspaceSourceHelp.hidden = source === "";
}

function setAdvancedOpen(open) {
  els.advancedBody.hidden = !open;
  els.advancedToggle.setAttribute("aria-expanded", String(open));
  els.advancedCaret.classList.toggle("open", open);
}

// ---------- status alert + review ----------
function renderAlert({ kind, title, body, link, details, spin }) {
  els.alert.className = `alert alert--${kind === "idle" || kind === "info" ? "info" : kind}`;
  let icon;
  if (spin) {
    icon = '<span class="spinner"></span>';
  } else if (kind === "success") {
    icon = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="var(--success-border)"/><path d="M5 8.2l2 2 4-4.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  } else if (kind === "danger") {
    icon = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="var(--danger-border)"/><path d="M8 4.3v4.4" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.3" r="1" fill="#fff"/></svg>';
  } else {
    icon = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="var(--info-border)" stroke-width="1.4"/><path d="M8 7.2v4" stroke="var(--info-border)" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.7" r="1" fill="var(--info-border)"/></svg>';
  }

  const row = document.createElement("div");
  row.className = "alert__row";
  const iconWrap = document.createElement("div");
  iconWrap.className = "alert__icon";
  iconWrap.innerHTML = icon;
  const bodyWrap = document.createElement("div");
  bodyWrap.className = "alert__body";

  const titleEl = document.createElement("p");
  titleEl.className = "alert__title";
  titleEl.textContent = title;
  bodyWrap.appendChild(titleEl);
  if (body) {
    const bodyEl = document.createElement("p");
    bodyEl.className = "alert__text";
    bodyEl.textContent = body;
    bodyWrap.appendChild(bodyEl);
  }

  if (isSafeHref(link)) {
    const actions = document.createElement("div");
    actions.className = "alert__actions";
    const a = document.createElement("a");
    a.className = "alert__link";
    a.href = link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = 'Open Control UI <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 3h7v7M13 3L4 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy-btn";
    copy.textContent = state.copied === "alert" ? "Copied!" : "Copy URL";
    copy.addEventListener("click", () => copy_(link, "alert"));
    actions.append(a, copy);
    bodyWrap.appendChild(actions);
  }

  if (details && details.length) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "details-toggle";
    const caret = '<svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    let open = true;
    const list = document.createElement("ul");
    list.className = "details-list";
    for (const detail of details) {
      const li = document.createElement("li");
      li.textContent = detail;
      list.appendChild(li);
    }
    const sync = () => {
      toggle.innerHTML = `${caret}${open ? "Hide details" : "Show details"}`;
      toggle.querySelector("svg").style.transform = open ? "rotate(180deg)" : "rotate(0deg)";
      list.hidden = !open;
    };
    toggle.addEventListener("click", () => {
      open = !open;
      sync();
    });
    sync();
    bodyWrap.append(toggle, list);
  }

  row.append(iconWrap, bodyWrap);
  els.alert.replaceChildren(row);
}

function setStatus(message, isError = false) {
  renderAlert({ kind: isError ? "danger" : "info", title: isError ? "Something went wrong" : message, body: isError ? message : "" });
}

function renderReview() {
  const vertex = isGoogleVertex();
  const source = els.filesystemSource.value;
  const credSet = (vertex ? els.gcpCredentials.value : els.apiKey.value).trim() !== "";
  const rows = [
    ["Namespace", els.namespace.value.trim() || "—"],
    ["Name", els.clawName.value.trim() || "—"],
    ["Provider", providerLabels[els.provider.value] || els.provider.value],
    ["Model", effectiveModel() || "—"],
    ["Credential", credSet ? "Set" : "Not set"],
    ["Workspace", source === "git" ? "Git" : source === "upload" ? "Upload" : "None"],
    ["Managed by", inferredManagement()],
  ];
  els.reviewList.replaceChildren(
    ...rows.map(([k, v]) => {
      const row = document.createElement("div");
      row.className = "review__row";
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      row.append(dt, dd);
      return row;
    }),
  );
}

// ---------- validation ----------
const errorFields = {
  namespace: "err-namespace",
  clawName: "err-clawName",
  credential: "err-credential",
  gcpProject: "err-gcpProject",
  gcpLocation: "err-gcpLocation",
  gitURL: "err-gitURL",
};

function validate() {
  const vertex = isGoogleVertex();
  const errs = {};
  if (!els.namespace.value.trim()) errs.namespace = "Namespace is required.";
  if (!els.clawName.value.trim()) errs.clawName = "OpenClaw name is required.";
  const cred = (vertex ? els.gcpCredentials.value : els.apiKey.value).trim();
  if (!cred) {
    errs.credential = vertex ? "Service account JSON is required." : "API key is required.";
  } else if (vertex && !isSupportedGCPKey(cred)) {
    errs.credential = 'Valid JSON with type "service_account" or "authorized_user" is required.';
  }
  if (vertex && !els.gcpProject.value.trim()) errs.gcpProject = "GCP project is required.";
  if (vertex && !els.gcpLocation.value.trim()) errs.gcpLocation = "GCP region is required.";
  if (els.filesystemSource.value === "git" && !els.gitURL.value.trim()) errs.gitURL = "Git URL is required for a Git source.";
  return errs;
}

function renderErrors(errs) {
  const credInput = isGoogleVertex() ? els.gcpCredentials : els.apiKey;
  const inputs = {
    namespace: els.namespace,
    clawName: els.clawName,
    credential: credInput,
    gcpProject: els.gcpProject,
    gcpLocation: els.gcpLocation,
    gitURL: els.gitURL,
  };
  for (const [key, errId] of Object.entries(errorFields)) {
    const el = document.getElementById(errId);
    const message = errs[key] || "";
    el.textContent = message;
    el.hidden = !message;
    const input = inputs[key];
    if (input) {
      if (message) {
        input.setAttribute("aria-invalid", "true");
      } else {
        input.removeAttribute("aria-invalid");
      }
    }
  }
}

// ---------- manifest preview ----------
function generateYaml() {
  const vertex = isGoogleVertex();
  const name = els.clawName.value.trim() || "instance";
  const ns = els.namespace.value.trim() || "<namespace>";
  let y = "";
  y += "apiVersion: claw.sandbox.redhat.com/v1alpha1\n";
  y += "kind: Claw\n";
  y += "metadata:\n";
  y += "  name: " + name + "\n";
  y += "  namespace: " + ns + "\n";
  y += "spec:\n";
  y += "  provider: " + els.provider.value + "\n";
  y += "  model: " + (effectiveModel() || "<provider default>") + "\n";
  y += "  configOwner: " + inferredManagement() + "\n";
  if (vertex) {
    y += "  vertex:\n";
    y += "    projectID: " + (els.gcpProject.value.trim() || "<gcp-project>") + "\n";
    y += "    location: " + (els.gcpLocation.value.trim() || "<region>") + "\n";
  }
  y += "  credentialsSecretRef:\n";
  y += "    name: " + name + "-provider\n";
  const source = els.filesystemSource.value;
  if (source === "git") {
    y += "  workspaceSource:\n    git:\n";
    y += "      url: " + (els.gitURL.value.trim() || "<git-url>") + "\n";
    if (els.gitRef.value.trim()) y += "      ref: " + els.gitRef.value.trim() + "\n";
    if (els.gitPath.value.trim()) y += "      path: " + els.gitPath.value.trim() + "\n";
  } else if (source === "upload") {
    y += "  workspaceSource:\n    configMap:\n      name: " + name + "-workspace\n";
  }
  return y;
}

function openPreview() {
  els.previewYaml.textContent = generateYaml();
  els.previewOverlay.hidden = false;
}

function closePreview() {
  els.previewOverlay.hidden = true;
}

function copy_(text, id) {
  try {
    navigator.clipboard.writeText(text);
  } catch {
    // Clipboard may be unavailable (e.g. insecure context); ignore.
  }
  state.copied = id;
  if (id === "yaml") {
    els.copyYaml.textContent = "Copied!";
  } else {
    renderList(state.claws);
  }
  clearTimeout(copy_.timer);
  copy_.timer = setTimeout(() => {
    state.copied = "";
    els.copyYaml.textContent = "Copy YAML";
    if (id === "alert") {
      renderList(state.claws);
    }
  }, 1600);
}

function setBusy(busy) {
  els.provision.disabled = busy;
  els.reset.disabled = busy;
  for (const button of document.querySelectorAll(".claw-action")) {
    button.disabled = busy;
  }
}

// ---------- actions ----------
els.provision.addEventListener("click", async () => {
  state.submitted = true;
  const errs = validate();
  renderErrors(errs);
  if (Object.keys(errs).length) {
    if (errs.gitURL) {
      setAdvancedOpen(true);
    }
    renderAlert({
      kind: "danger",
      title: "Resolve errors before deploying",
      body: "Some required fields need attention. Each one is marked inline below.",
      details: Object.values(errs),
    });
    return;
  }

  const namespace = els.namespace.value.trim();
  const name = els.clawName.value.trim();
  const provider = els.provider.value;
  const model = els.model.value.trim();
  const vertex = isGoogleVertex();
  const apiKey = (vertex ? els.gcpCredentials.value : els.apiKey.value).trim();
  const gcpProject = els.gcpProject.value.trim();
  const gcpLocation = els.gcpLocation.value.trim();
  const management = inferredManagement();
  const source = els.filesystemSource.value;
  const gitURL = els.gitURL.value.trim();
  const gitRef = els.gitRef.value.trim();
  const gitPath = els.gitPath.value.trim();

  if (source === "upload" && els.agentFiles.files.length === 0) {
    setAdvancedOpen(true);
    setStatus("Choose a folder to upload, or pick a different filesystem source.", true);
    return;
  }

  setBusy(true);
  try {
    // An uploaded folder is packaged into a ConfigMap first; provisioning then
    // references it. Git and "None" provision directly.
    let filesystemSource = source;
    let configMapName = "";
    if (source === "upload") {
      setStatus("Uploading folder…");
      configMapName = await uploadAgentFiles(namespace, name, els.agentFiles.files);
      filesystemSource = "configmap";
    }
    setStatus(state.exists ? "Adding or updating provider…" : "Creating OpenClaw…");
    const current = await api("/api/provision", {
      method: "POST",
      body: JSON.stringify({
        namespace, name, provider, model, apiKey, gcpProject, gcpLocation, management,
        filesystemSource, gitURL, gitRef, gitPath, configMapName,
      }),
    });
    els.apiKey.value = "";
    els.gcpCredentials.value = "";
    els.agentFiles.value = "";
    state.selectedName = current.name || name;
    els.clawName.value = state.selectedName;
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
});

els.reset.addEventListener("click", () => {
  state.submitted = false;
  els.namespace.value = "";
  els.clawName.value = "instance";
  els.provider.value = "openrouter";
  els.model.value = "";
  els.gcpProject.value = "";
  els.gcpLocation.value = defaultGCPLocations.openrouter || "";
  els.apiKey.value = "";
  els.gcpCredentials.value = "";
  els.filesystemSource.value = "";
  els.gitURL.value = "";
  els.gitRef.value = "";
  els.gitPath.value = "";
  els.agentFiles.value = "";
  els.uploadName.hidden = true;
  renderErrors({});
  renderModelOptions();
  renderCredentialFields();
  renderFilesystemSource();
  refresh();
});

async function restartClaw(namespace, name) {
  if (!namespace || !name || !confirm(`Restart ${namespace}/${name}?`)) {
    return;
  }
  setBusy(true);
  setStatus(`Restarting ${namespace}/${name}…`);
  try {
    await api(`/api/restart?namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`, { method: "POST" });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function deleteClaw(namespace, name) {
  if (!namespace || !name || !confirm(`Delete ${namespace}/${name}?`)) {
    return;
  }
  setBusy(true);
  setStatus(`Deleting ${namespace}/${name}…`);
  try {
    await api(`/api/claw?namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`, { method: "DELETE" });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function uploadAgentFiles(namespace, name, fileList) {
  const form = new FormData();
  for (const file of fileList) {
    const relative = file.webkitRelativePath || file.name;
    // Drop the top-level folder name so archive paths are repo-root relative.
    const archivePath = relative.includes("/") ? relative.slice(relative.indexOf("/") + 1) : relative;
    form.append(archivePath, file, file.name);
  }
  const response = await fetch(
    `/api/agentfiles?namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`,
    { method: "POST", body: form },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Upload failed: ${response.status}`);
  }
  return payload.configMapName;
}

// ---------- listeners ----------
els.themeToggle.addEventListener("click", () => applyTheme(state.theme === "dark" ? "light" : "dark"));

els.advancedToggle.addEventListener("click", () => setAdvancedOpen(els.advancedBody.hidden));

els.previewOpen.addEventListener("click", openPreview);
els.previewClose.addEventListener("click", closePreview);
els.previewClose2.addEventListener("click", closePreview);
els.previewOverlay.addEventListener("click", (event) => {
  if (event.target === els.previewOverlay) {
    closePreview();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.previewOverlay.hidden) {
    closePreview();
  }
});
els.copyYaml.addEventListener("click", () => copy_(generateYaml(), "yaml"));

let namespaceDebounce;
els.namespace.addEventListener("input", () => {
  clearTimeout(namespaceDebounce);
  namespaceDebounce = setTimeout(refresh, 300);
});
els.namespace.addEventListener("change", refresh);
els.clawName.addEventListener("change", refresh);

els.provider.addEventListener("change", () => {
  state.provider = els.provider.value;
  els.model.value = "";
  state.model = "";
  renderModelOptions();
  renderCredentialFields();
  localStorage.setItem("openclaw-deployer.provider", state.provider);
  localStorage.setItem("openclaw-deployer.model", "");
  revalidate();
});

els.filesystemSource.addEventListener("change", () => {
  state.filesystemSource = els.filesystemSource.value;
  localStorage.setItem("openclaw-deployer.filesystemSource", state.filesystemSource);
  renderFilesystemSource();
  revalidate();
});

els.agentFiles.addEventListener("change", () => {
  const n = els.agentFiles.files ? els.agentFiles.files.length : 0;
  els.uploadName.hidden = n === 0;
  els.uploadName.textContent = n ? `${n} file${n === 1 ? "" : "s"} selected` : "";
});

for (const [el, key] of [
  [els.gitURL, "gitURL"],
  [els.gitRef, "gitRef"],
  [els.gitPath, "gitPath"],
]) {
  el.addEventListener("change", () => {
    state[key] = el.value.trim();
    localStorage.setItem(`openclaw-deployer.${key}`, state[key]);
  });
}

els.gcpProject.addEventListener("change", () => {
  state.gcpProject = els.gcpProject.value.trim();
  localStorage.setItem("openclaw-deployer.gcpProject", state.gcpProject);
});
els.gcpLocation.addEventListener("change", () => {
  state.gcpLocation = els.gcpLocation.value.trim();
  localStorage.setItem("openclaw-deployer.gcpLocation", state.gcpLocation);
});
els.model.addEventListener("change", () => {
  state.model = els.model.value.trim();
  localStorage.setItem("openclaw-deployer.model", state.model);
});

// Keep the Review summary live, and re-run validation once the user has tried
// to deploy so inline errors clear as fields are fixed.
const formEl = document.getElementById("form");
formEl.addEventListener("input", () => {
  renderReview();
  revalidate();
});
// Deploy is an explicit button; never let Enter submit and reload the page.
formEl.addEventListener("submit", (event) => event.preventDefault());

function revalidate() {
  renderReview();
  if (state.submitted) {
    renderErrors(validate());
  }
}

function isSafeHref(href) {
  if (!href) {
    return false;
  }
  try {
    const url = new URL(href, document.baseURI);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSupportedGCPKey(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed.type === "service_account" || parsed.type === "authorized_user";
  } catch {
    return false;
  }
}

init();
setInterval(() => {
  if (state.claws.some((claw) => !claw.ready)) {
    refresh();
  }
}, 10000);
