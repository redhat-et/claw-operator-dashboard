const state = {
  claws: [],
  mode: "all",
  search: "",
  links: {},
};

const els = {
  user: document.getElementById("user"),
  summary: document.getElementById("summary"),
  externalLinks: document.getElementById("external-links"),
  search: document.getElementById("search"),
  claws: document.getElementById("claws"),
  status: document.getElementById("status"),
  modeButtons: document.querySelectorAll("[data-mode]"),
  configModal: document.getElementById("config-modal"),
  configTitle: document.getElementById("config-title"),
  configBody: document.getElementById("config-body"),
  configClose: document.getElementById("config-close"),
};

async function api(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

async function init() {
  try {
    const me = await api("/api/me");
    state.links = me;
    els.user.textContent = me.user || "";
    renderExternalLinks();
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function refresh() {
  setStatus("Loading cluster inventory...");
  try {
    const payload = await api("/api/claws");
    state.claws = payload.claws || [];
    render();
  } catch (error) {
    state.claws = [];
    render();
    setStatus(error.message, true);
  }
}

function render() {
  renderSummary();
  renderRows();
}

function renderSummary() {
  const total = state.claws.length;
  const user = state.claws.filter((claw) => claw.management === "user").length;
  const operator = state.claws.filter((claw) => claw.management !== "user").length;
  const notReady = state.claws.filter((claw) => !claw.ready).length;
  els.summary.innerHTML = "";
  for (const item of [
    ["Total", total],
    ["User-managed", user],
    ["Operator-managed", operator],
    ["Not ready", notReady],
  ]) {
    const node = document.createElement("div");
    node.className = "metric";
    node.innerHTML = `<span>${item[0]}</span><strong>${item[1]}</strong>`;
    els.summary.appendChild(node);
  }
}

function renderExternalLinks() {
  els.externalLinks.innerHTML = "";
  addExternalLink("MLflow", state.links.mlflowURL);
  addExternalLink("Prometheus", state.links.prometheusURL);
  addExternalLink("Console", state.links.consoleURL);
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

function addExternalLink(label, href) {
  if (!isSafeHref(href)) {
    return;
  }
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  els.externalLinks.appendChild(link);
}

function renderRows() {
  const rows = filteredClaws();
  els.claws.innerHTML = "";
  for (const claw of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <strong>${escapeHTML(claw.name)}</strong>
        <span>${escapeHTML(claw.namespace)}</span>
      </td>
      <td><span class="pill ${claw.management === "user" ? "user-mode" : ""}">${escapeHTML(claw.management)}</span></td>
      <td>
        <strong class="${claw.ready ? "ok" : "warn"}">${claw.ready ? "Ready" : claw.reason || "Not ready"}</strong>
        <span>${escapeHTML(claw.message || "")}</span>
      </td>
      <td>${renderProviders(claw)}</td>
      <td>${renderResourceLinks([
        ["Claw", claw.clawConsoleURL],
        [claw.configMapName, claw.configMapURL],
        [claw.proxyConfigMapName, claw.proxyConfigMapURL],
      ])}<button type="button" class="link-button view-config" data-namespace="${escapeAttr(claw.namespace)}" data-name="${escapeAttr(claw.name)}">Effective config</button></td>
      <td>${renderResourceLinks([
        [claw.gatewayDeployment, claw.gatewayDeploymentURL],
        [claw.proxyDeployment, claw.proxyDeploymentURL],
        ["Pods", claw.podsURL],
      ])}</td>
      <td>${renderResourceLinks([
        ["Gateway", claw.gatewayURL],
        ["Events", claw.eventsURL],
        ["Prometheus", claw.prometheusURL],
      ])}</td>
    `;
    els.claws.appendChild(tr);
  }
  if (rows.length === 0) {
    setStatus(state.claws.length === 0 ? "No Claws found in the cluster." : "No Claws match the current filters.");
  } else {
    setStatus(`${rows.length} Claw${rows.length === 1 ? "" : "s"} shown.`);
  }
}

function filteredClaws() {
  const query = state.search.toLowerCase();
  return state.claws.filter((claw) => {
    if (state.mode === "user" && claw.management !== "user") {
      return false;
    }
    if (state.mode === "operator" && claw.management === "user") {
      return false;
    }
    if (state.mode === "not-ready" && claw.ready) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [claw.namespace, claw.name, claw.management, ...(claw.providers || [])]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function renderProviders(claw) {
  const providers = claw.providers || [];
  if (providers.length === 0) {
    return `<span class="muted">None</span>`;
  }
  return providers.map((provider) => `<span class="provider">${escapeHTML(provider)}</span>`).join("");
}

function renderResourceLinks(links) {
  return links
    .filter(([, href]) => isSafeHref(href))
    .map(([label, href]) => `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)}</a>`)
    .join("");
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.style.color = isError ? "#b42318" : "";
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHTML(value);
}

for (const button of els.modeButtons) {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    for (const item of els.modeButtons) {
      item.classList.toggle("active", item === button);
    }
    renderRows();
  });
}

els.search.addEventListener("input", () => {
  state.search = els.search.value.trim();
  renderRows();
});

els.claws.addEventListener("click", (event) => {
  const button = event.target.closest(".view-config");
  if (!button) {
    return;
  }
  openConfig(button.dataset.namespace, button.dataset.name);
});

function openConfig(namespace, name) {
  // The live, effective openclaw.json lives on the Claw's ReadWriteOnce PVC,
  // mounted in the running gateway pod, so it can only be read from that pod.
  els.configTitle.textContent = `${namespace}/${name} — effective config`;
  els.configBody.textContent = [
    "The live, effective openclaw.json is on the Claw's PVC:",
    "",
    `  PVC:   ${name}-home-pvc`,
    "  Path:  /home/node/.openclaw/openclaw.json",
    "",
    "Read it from the running pod (requires pods/exec):",
    "",
    `  oc exec -n ${namespace} deploy/${name} -- cat /home/node/.openclaw/openclaw.json`,
    "",
    "Or open the pod's Terminal tab in the OpenShift console.",
  ].join("\n");
  els.configModal.hidden = false;
}

function closeConfig() {
  els.configModal.hidden = true;
}

els.configClose.addEventListener("click", closeConfig);
els.configModal.addEventListener("click", (event) => {
  if (event.target === els.configModal) {
    closeConfig();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.configModal.hidden) {
    closeConfig();
  }
});

init();
setInterval(refresh, 30000);
