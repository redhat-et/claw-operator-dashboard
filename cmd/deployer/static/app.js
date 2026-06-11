const storedManagement = localStorage.getItem("openclaw-deployer.management");
const hasStoredManagement = ["operator", "user"].includes(storedManagement);

const state = {
  namespace: localStorage.getItem("openclaw-deployer.namespace") || "",
  provider: localStorage.getItem("openclaw-deployer.provider") || "openrouter",
  selectedName: localStorage.getItem("openclaw-deployer.name") || "instance",
  model: localStorage.getItem("openclaw-deployer.model") || "",
  gcpProject: localStorage.getItem("openclaw-deployer.gcpProject") || "",
  gcpLocation: localStorage.getItem("openclaw-deployer.gcpLocation") || "",
  management: hasStoredManagement ? storedManagement : "operator",
  filesystemSource: localStorage.getItem("openclaw-deployer.filesystemSource") || "",
  gitURL: localStorage.getItem("openclaw-deployer.gitURL") || "",
  gitRef: localStorage.getItem("openclaw-deployer.gitRef") || "",
  gitPath: localStorage.getItem("openclaw-deployer.gitPath") || "",
  claws: [],
  namespaceSuggestions: [],
  exists: false,
  ready: false,
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
  card: document.getElementById("card"),
  user: document.getElementById("user"),
  namespace: document.getElementById("namespace"),
  namespaceOptions: document.getElementById("namespace-options"),
  clawName: document.getElementById("clawName"),
  provider: document.getElementById("provider"),
  model: document.getElementById("model"),
  modelOptions: document.getElementById("model-options"),
  managementOptions: document.querySelectorAll('input[name="management"]'),
  gcpProjectRow: document.getElementById("gcp-project-row"),
  gcpLocationRow: document.getElementById("gcp-location-row"),
  gcpProject: document.getElementById("gcpProject"),
  gcpLocation: document.getElementById("gcpLocation"),
  credentialLabel: document.getElementById("credential-label"),
  apiKey: document.getElementById("apiKey"),
  gcpCredentials: document.getElementById("gcpCredentials"),
  filesystemSourceGroup: document.getElementById("filesystem-source-group"),
  filesystemSource: document.getElementById("filesystemSource"),
  filesystemSourceHint: document.getElementById("filesystem-source-hint"),
  workspaceSourceHelp: document.getElementById("workspace-source-help"),
  gitUrlRow: document.getElementById("git-url-row"),
  gitRefRow: document.getElementById("git-ref-row"),
  gitPathRow: document.getElementById("git-path-row"),
  gitURL: document.getElementById("gitURL"),
  gitRef: document.getElementById("gitRef"),
  gitPath: document.getElementById("gitPath"),
  uploadRow: document.getElementById("upload-row"),
  agentFiles: document.getElementById("agentFiles"),
  status: document.getElementById("status"),
  running: document.getElementById("running"),
  runningCount: document.getElementById("running-count"),
  runningEmpty: document.getElementById("running-empty"),
  clawList: document.getElementById("claw-list"),
  provision: document.getElementById("provision"),
  restart: document.getElementById("restart"),
  delete: document.getElementById("delete"),
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
setManagement(state.management || "operator");
renderModelOptions();
renderCredentialFields();
renderFilesystemSource();

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
    }
    if (!hasStoredManagement) {
      setManagement(me.defaultManagement || "operator");
    }
  } catch (error) {
    setStatus(error.message, true);
    setBusy(false);
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
  state.management = selectedManagement();
  localStorage.setItem("openclaw-deployer.namespace", state.namespace);
  localStorage.setItem("openclaw-deployer.name", state.selectedName);
  localStorage.setItem("openclaw-deployer.provider", state.provider);
  localStorage.setItem("openclaw-deployer.model", state.model);
  localStorage.setItem("openclaw-deployer.gcpProject", state.gcpProject);
  localStorage.setItem("openclaw-deployer.gcpLocation", state.gcpLocation);
  localStorage.setItem("openclaw-deployer.management", state.management);

  setStatus("Checking status...");
  // Prefer a namespace-scoped read so polling does not list Claws cluster-wide
  // on every refresh; fall back to the cluster-wide list only if needed.
  try {
    const path = state.namespace
      ? `/api/claws?namespace=${encodeURIComponent(state.namespace)}`
      : "/api/claws";
    const current = await api(path);
    renderList(current.claws || []);
  } catch (error) {
    if (!state.namespace) {
      renderList([]);
      setStatus(error.message, true);
      return;
    }
    try {
      const current = await api("/api/claws");
      renderList(current.claws || []);
    } catch (clusterError) {
      renderList([]);
      setStatus(clusterError.message, true);
    }
  }
}

function renderList(claws) {
  state.claws = claws;
  renderNamespaceOptions(claws);
  const inNamespace = state.namespace
    ? claws.filter((claw) => (claw.namespace || state.namespace) === state.namespace)
    : claws;
  let selected = null;
  if (state.namespace) {
    selected = inNamespace.find((claw) => claw.name === state.selectedName) || null;
    if (!selected && inNamespace.length > 0) {
      // The selected name isn't running here; surface the first Claw in the
      // namespace so switching namespaces lands on a real instance.
      selected = inNamespace[0];
      state.selectedName = selected.name;
      els.clawName.value = selected.name;
      localStorage.setItem("openclaw-deployer.name", selected.name);
    }
  }
  state.exists = Boolean(selected);
  state.ready = Boolean(selected && selected.ready);
  if (selected) {
    if (selected.model) {
      els.model.value = selected.model;
      state.model = selected.model;
      localStorage.setItem("openclaw-deployer.model", selected.model);
    }
    if (selected.management) {
      setManagement(selected.management);
    }
  }

  els.card.classList.toggle("ready", state.exists && state.ready);
  els.restart.disabled = !state.exists;
  els.delete.disabled = !state.exists;
  els.provision.textContent = state.exists ? "Add/update provider" : "Create";
  renderClaws(inNamespace);

  if (!state.namespace) {
    setStatus("Choose the namespace where your OpenClaw should run.");
    return;
  }
  if (!state.exists) {
    setStatus(`No OpenClaw named ${state.selectedName} is running in project ${state.namespace}.`);
    return;
  }
  if (selected.ready) {
    setStatus(
      `Your OpenClaw ${selected.name} is now running in project ${state.namespace}. Further customizations can be made from the OpenClaw Control UI or the Claw CR.`,
    );
    return;
  }
  setStatus(selected.message || selected.reason || `${selected.name} is provisioning.`);
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

function renderClaws(claws) {
  els.runningCount.textContent = String(claws.length);
  els.runningEmpty.hidden = claws.length !== 0;
  els.clawList.innerHTML = "";
  for (const claw of claws) {
    const namespace = claw.namespace || state.namespace;
    const row = document.createElement("div");
    row.className = `claw-row${namespace === state.namespace && claw.name === state.selectedName ? " selected" : ""}`;
    const details = document.createElement("button");
    details.type = "button";
    details.className = "claw-pick";
    details.textContent = `${namespace}/${claw.name} · ${claw.ready ? "Ready" : claw.reason || "Provisioning"}`;
    details.addEventListener("click", () => {
      state.namespace = namespace;
      state.selectedName = claw.name;
      els.namespace.value = namespace;
      els.clawName.value = claw.name;
      localStorage.setItem("openclaw-deployer.namespace", namespace);
      localStorage.setItem("openclaw-deployer.name", claw.name);
      renderList(state.claws);
    });
    row.appendChild(details);
    const actions = document.createElement("div");
    actions.className = "claw-row-actions";
    if (isSafeHref(claw.gatewayURL)) {
      const link = document.createElement("a");
      link.href = claw.gatewayURL;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open Control UI";
      actions.appendChild(link);
    }
    const restart = document.createElement("button");
    restart.type = "button";
    restart.className = "secondary compact claw-action";
    restart.textContent = "Restart";
    restart.addEventListener("click", (event) => {
      event.stopPropagation();
      restartClaw(namespace, claw.name);
    });
    actions.appendChild(restart);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger compact claw-action";
    remove.textContent = "Delete";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteClaw(namespace, claw.name);
    });
    actions.appendChild(remove);

    row.appendChild(actions);
    els.clawList.appendChild(row);
  }
}

function renderModelOptions() {
  els.modelOptions.innerHTML = "";
  for (const model of modelOptions[els.provider.value] || []) {
    const option = document.createElement("option");
    option.value = model;
    els.modelOptions.appendChild(option);
  }
}

function renderCredentialFields() {
  const isGoogleVertex = googleVertexProviders.has(els.provider.value);
  els.gcpProjectRow.hidden = !isGoogleVertex;
  els.gcpLocationRow.hidden = !isGoogleVertex;
  els.credentialLabel.textContent = isGoogleVertex ? "Service Account Key" : "API key";
  els.apiKey.hidden = isGoogleVertex;
  els.gcpCredentials.hidden = !isGoogleVertex;
  if (isGoogleVertex && !els.gcpLocation.value.trim()) {
    els.gcpLocation.value = defaultGCPLocations[els.provider.value] || "";
  }
}

function renderFilesystemSource() {
  const source = els.filesystemSource.value;
  const isUserManaged = selectedManagement() === "user";
  const isGit = source === "git";
  const isUpload = source === "upload";
  els.gitUrlRow.hidden = !isGit;
  els.gitRefRow.hidden = !isGit;
  els.gitPathRow.hidden = !isGit;
  els.uploadRow.hidden = !isUpload;
  els.workspaceSourceHelp.hidden = !(isUserManaged && source !== "");
  els.filesystemSource.disabled = !isUserManaged;
  els.filesystemSourceHint.textContent = isUserManaged
    ? "Seeds the OpenClaw workspace on first boot from a Git repository or an uploaded folder."
    : "Switch Config owner to User to seed the workspace from Git or an uploaded folder.";
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.style.color = isError ? "#b42318" : "";
}

function setBusy(busy) {
  for (const button of [els.provision, els.restart, els.delete]) {
    button.disabled = busy || (button === els.restart && !state.exists) || (button === els.delete && !state.exists);
  }
  for (const button of document.querySelectorAll(".claw-action")) {
    button.disabled = busy;
  }
}

function selectedManagement() {
  return document.querySelector('input[name="management"]:checked')?.value || "operator";
}

function setManagement(value) {
  state.management = value === "user" ? "user" : "operator";
  for (const option of els.managementOptions) {
    option.checked = option.value === state.management;
  }
  localStorage.setItem("openclaw-deployer.management", state.management);
  if (els.filesystemSource) {
    renderFilesystemSource();
  }
}

els.provision.addEventListener("click", async () => {
  const namespace = els.namespace.value.trim();
  const name = els.clawName.value.trim();
  const provider = els.provider.value;
  const model = els.model.value.trim();
  const isGoogleVertex = googleVertexProviders.has(provider);
  const apiKey = (isGoogleVertex ? els.gcpCredentials.value : els.apiKey.value).trim();
  const gcpProject = els.gcpProject.value.trim();
  const gcpLocation = els.gcpLocation.value.trim();
  const management = selectedManagement();
  const source = management === "user" ? els.filesystemSource.value : "";
  const gitURL = els.gitURL.value.trim();
  const gitRef = els.gitRef.value.trim();
  const gitPath = els.gitPath.value.trim();

  if (!namespace || !name || !apiKey) {
    setStatus(`Namespace, OpenClaw name, and ${isGoogleVertex ? "service account JSON" : "API key"} are required.`, true);
    return;
  }
  if (isGoogleVertex && (!gcpProject || !gcpLocation)) {
    setStatus("GCP project and region are required.", true);
    return;
  }
  if (isGoogleVertex && !isSupportedGCPKey(apiKey)) {
    setStatus('Valid JSON with type "service_account" or "authorized_user" is required.', true);
    return;
  }
  if (source === "git" && !gitURL) {
    setStatus("Git URL is required for a Git filesystem source.", true);
    return;
  }
  if (source === "upload" && els.agentFiles.files.length === 0) {
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
      setStatus("Uploading folder...");
      configMapName = await uploadAgentFiles(namespace, name, els.agentFiles.files);
      filesystemSource = "configmap";
    }
    setStatus(state.exists ? "Adding or updating provider..." : "Creating OpenClaw...");
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

els.restart.addEventListener("click", async () => {
  await restartClaw(els.namespace.value.trim(), els.clawName.value.trim());
});

els.delete.addEventListener("click", async () => {
  await deleteClaw(els.namespace.value.trim(), els.clawName.value.trim());
});

async function restartClaw(namespace, name) {
  if (!namespace || !name || !confirm(`Restart ${namespace}/${name}?`)) {
    return;
  }
  setBusy(true);
  setStatus(`Restarting ${namespace}/${name}...`);
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
  setStatus(`Deleting ${namespace}/${name}...`);
  try {
    await api(`/api/claw?namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`, { method: "DELETE" });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

let namespaceDebounce;
els.namespace.addEventListener("input", () => {
  clearTimeout(namespaceDebounce);
  namespaceDebounce = setTimeout(refresh, 300);
});
els.namespace.addEventListener("change", refresh);
els.clawName.addEventListener("change", refresh);
els.filesystemSource.addEventListener("change", () => {
  state.filesystemSource = els.filesystemSource.value;
  localStorage.setItem("openclaw-deployer.filesystemSource", state.filesystemSource);
  renderFilesystemSource();
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
els.provider.addEventListener("change", () => {
  state.provider = els.provider.value;
  renderModelOptions();
  renderCredentialFields();
  localStorage.setItem("openclaw-deployer.provider", state.provider);
  localStorage.setItem("openclaw-deployer.model", els.model.value.trim());
});
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
for (const option of els.managementOptions) {
  option.addEventListener("change", () => {
    if (option.checked) {
      setManagement(option.value);
    }
  });
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
