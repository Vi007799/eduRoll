"use strict";

const $ = selector => document.querySelector(selector);
const state = { csrf: "", user: null, journey: null, lastQuery: "", retryAction: null, resetToken: "", progressTimer: null, scrollFrame: 0, authMode: "login", busyNodes: new Set(), branchStack: [], readOnly: false };
const form = $("#searchForm");
const input = $("#searchInput");
const authModal = $("#authModal");
const authFeedback = $("#authFeedback");
const year = $("#year");
year.textContent = new Date().getFullYear();

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 3200);
}
function setAuthFeedback(message, isError = false) {
  authFeedback.textContent = message || "";
  authFeedback.classList.toggle("error", isError);
}
function showView(view) {
  $("#home").hidden = view !== "home";
  $("#learningView").hidden = view !== "learning";
  $("#loadingView").hidden = view !== "loading";
  $("#errorView").hidden = view !== "error";
  if (view === "home") window.scrollTo({ top: 0, behavior: "smooth" });
  else if (view === "loading" || view === "error") window.scrollTo({ top: 0, behavior: "instant" });
}
async function refreshCsrf() {
  const response = await fetch("/api/csrf", { credentials: "same-origin", cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not initialize a secure session.");
  state.csrf = data.csrfToken;
}
async function api(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  if (options.body && typeof options.body === "string" && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!(["GET", "HEAD", "OPTIONS"].includes(method))) {
    if (!state.csrf) await refreshCsrf();
    headers.set("X-CSRF-Token", state.csrf);
  }
  const response = await fetch(url, { ...options, method, headers, credentials: "same-origin", cache: "no-store" });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.user) {
      state.user = null;
      updateAccountUI();
    }
    throw new Error(data.error || "Something went wrong. Please try again.");
  }
  return data;
}
function updateAccountUI() {
  const signedIn = Boolean(state.user);
  $("#authOpenButton").hidden = signedIn;
  $("#accountButton").hidden = !signedIn;
  $("#accountStatus").hidden = !signedIn;
  $("#accountStatus").textContent = signedIn ? `Rolling as ${state.user.displayName}` : "";
  $("#accountButton").textContent = signedIn ? (state.user.displayName || "e").trim().charAt(0).toUpperCase() : "";
  $("#accountMenuUser").textContent = signedIn ? `${state.user.displayName} · ${state.user.email}` : "";
  $("#myLearningNav").hidden = !signedIn;
}
function setAuthMode(mode) {
  state.authMode = mode;
  $("#loginForm").hidden = mode !== "login";
  $("#registerForm").hidden = mode !== "register";
  $("#resetRequestForm").hidden = mode !== "resetRequest";
  $("#resetCompleteForm").hidden = mode !== "resetComplete";
  $("#authTabs").hidden = mode === "resetRequest" || mode === "resetComplete";
  $("#authTitle").textContent = mode === "register" ? "Make room for curiosity." : mode === "resetRequest" ? "Reset your password." : mode === "resetComplete" ? "Choose a new password." : "Welcome back.";
  $("#authDescription").textContent = mode === "register" ? "Create an account to save every path, branch and discovery." : mode === "resetRequest" ? "We'll send a secure reset link if an account exists." : mode === "resetComplete" ? "Choose a strong password you haven't used before." : "Sign in to continue learning and keep your progress across devices.";
  document.querySelectorAll("[data-auth-mode]").forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
  setAuthFeedback("");
}
function openAuth(mode = "login") {
  $("#accountMenu").hidden = true;
  setAuthMode(mode);
  authModal.hidden = false;
  const first = authModal.querySelector("form:not([hidden]) input");
  setTimeout(() => first?.focus(), 30);
}
function closeAuth() { authModal.hidden = true; }

async function initialize() {
  const params = new URLSearchParams(location.search);
  const journeyMatch = location.pathname.match(/^\/journey\/([0-9a-f-]{36})\/?$/i);
  const requestedJourneyId = journeyMatch?.[1] || params.get("journey");
  // Restore the account UI independently so a transient CSRF/session bootstrap
  // failure cannot prevent a saved myRoll link from being opened.
  try {
    await refreshCsrf();
  } catch (error) {
    console.error("Security session initialization failed:", error.message);
  }
  try {
    const { user } = await api("/api/auth/me");
    state.user = user;
    updateAccountUI();
  } catch (error) {
    state.user = null;
    updateAccountUI();
    console.error("Account initialization failed:", error.message);
  }
  if (params.has("reset")) {
    state.resetToken = params.get("reset");
    openAuth("resetComplete");
    history.replaceState({}, "", location.pathname);
  } else if (params.has("signin")) {
    const returnTo = params.get("returnTo") || "/";
    sessionStorage.setItem("eduroll:returnTo", returnTo.startsWith("/share/") ? returnTo : "/");
    openAuth("login");
  } else if (params.has("shared")) {
    const token = params.get("shared");
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
      $("#errorMessage").textContent = "This shared roll link is invalid."; 
      showView("error");
      return;
    }
    location.replace("/shared.html?token=" + encodeURIComponent(token));
    return;
  } else if (requestedJourneyId) {
    const journeyId = requestedJourneyId;
    if (!/^[0-9a-f-]{36}$/i.test(journeyId)) {
      $("#errorMessage").textContent = "This saved learning path link is invalid. Open myRoll and select the journey again.";
      showView("error");
      return;
    }
    await openJourney(journeyId);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const submitted = new FormData(event.currentTarget);
  data.adultConfirmation = Boolean(submitted.get("adultConfirmation"));
  data.consent = Boolean(submitted.get("consent"));
  const submit = event.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify(data) });
    state.user = result.user;
    state.csrf = result.csrfToken;
    updateAccountUI();
    closeAuth();
    const returnTo = sessionStorage.getItem("eduroll:returnTo");
    if (returnTo) { sessionStorage.removeItem("eduroll:returnTo"); location.assign(returnTo); return; }
    showToast(`Welcome back, ${state.user.displayName}.`);
    if (state.lastQuery) runSearch(state.lastQuery);
  } catch (error) {
    setAuthFeedback(error.message, true);
  }
  finally { submit.disabled = false; }
}
async function handleRegister(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const submitted = new FormData(event.currentTarget);
  data.consent = Boolean(submitted.get("consent"));
  data.adultConfirmation = Boolean(submitted.get("adultConfirmation"));
  const submit = event.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    const result = await api("/api/auth/register", { method: "POST", body: JSON.stringify(data) });
    setAuthFeedback(result.message);
    setAuthMode("login");
    setAuthFeedback(result.message);
  } catch (error) {
    setAuthFeedback(error.message, true);
  }
  finally { submit.disabled = false; }
}
async function handleResetRequest(event) {
  event.preventDefault();
  const email = new FormData(event.currentTarget).get("email");
  try {
    const result = await api("/api/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email }) });
    setAuthFeedback(result.message);
  } catch (error) { setAuthFeedback(error.message, true); }
}
async function handleResetComplete(event) {
  event.preventDefault();
  const password = new FormData(event.currentTarget).get("password");
  try {
    const result = await api("/api/auth/password-reset/complete", { method: "POST", body: JSON.stringify({ token: state.resetToken, password }) });
    state.resetToken = "";
    setAuthMode("login");
    setAuthFeedback(result.message);
  } catch (error) { setAuthFeedback(error.message, true); }
}

function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}
function safeLink(url, title) {
  try {
    const parsed = new URL(url);
    if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password) return null;
    const anchor = create("a", "source-card");
    anchor.href = parsed.toString();
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.append(create("span", "", parsed.hostname));
    anchor.append(create("strong", "", title || parsed.hostname));
    return anchor;
  } catch { return null; }
}
function followupForm(journeyId, nodeId = null, dark = false) {
  const form = create("form", `node-followup${dark ? " node-followup-dark" : ""}`);
  form.setAttribute("aria-label", "Explore a related topic");
  const input = create("input");
  input.type = "search";
  input.name = "query";
  input.maxLength = 180;
  input.required = true;
  input.placeholder = "Explore a related idea...";
  const button = create("button", "", "↗");
  button.type = "submit";
  button.setAttribute("aria-label", "Search this related topic");
  form.append(input, button);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const query = input.value.trim();
    if (query.length < 2) return;
    await runFollowup(journeyId, query, nodeId);
  });
  return form;
}
function nodePathLabel(path) { return path.map(n => n + 1).join("."); }
function branchAction(node, path, journeyId) {
  const control = create("div", "branch-control");
  const children = node.children || node.keyPoints || [];
  if (state.readOnly && !children.length) return null;
  const button = create("button", "branch-toggle", children.length ? `Explore branch · ${children.length}` : "Grow branch ↗");
  button.type = "button";
  if (children.length) {
    button.dataset.openBranch = node.id;
    button.setAttribute("aria-label", `Explore branches from ${node.title}`);
  } else {
    button.classList.add("branch-grow-button");
    button.dataset.branchNode = node.id;
    button.setAttribute("aria-label", `Grow a learning branch from ${node.title}`);
  }
  control.append(button);
  return control;
}
function renderNode(node, path, journeyId) {
  const isMajor = path.length === 1;
  const article = create("article", `learning-node tree-node ${isMajor ? "major-step" : "concept-node"}`);
  article.dataset.nodeId = node.id;
  article.dataset.depth = node.depth || path.length;
  const heading = create("div", "node-heading");
  const copy = create("div", "node-heading-copy");
  copy.append(create("div", "node-index", isMajor ? `STEP ${String(path[0] + 1).padStart(2, "0")}` : `CONCEPT ${path.map(index => index + 1).join(".")}`));
  copy.append(create("h3", "node-title", node.title));
  heading.append(copy);
  article.append(heading);
  if (node.summary) article.append(create("p", "node-summary", node.summary));
  if (node.content) article.append(create("p", "node-content", node.content));
  if (Array.isArray(node.examples) && node.examples.length) {
    const examples = create("div", "node-examples");
    node.examples.forEach(example => examples.append(create("pre", "example-block", example)));
    article.append(examples);
  }
  const controls = branchAction(node, path, journeyId);
  if (controls) article.append(controls);
  if (isMajor && !state.readOnly) {
    const actions = create("div", "node-actions");
    actions.append(followupForm(journeyId, node.id));
    article.append(actions);
  }
  return article;
}
function flattenBranch(root) {
  const items = [];
  const visit = (parent, depth = 0) => {
    (parent.children || parent.keyPoints || []).forEach(child => {
      items.push({ node: child, parent, depth });
      visit(child, depth + 1);
    });
  };
  visit(root);
  return items;
}
function renderBranchWorkspace() {
  const workspace = $("#branchWorkspace");
  const rootId = state.branchStack.at(-1);
  const root = findNode(state.journey?.stages, rootId);
  if (!root) { closeBranchWorkspace(); return; }
  $("#journeyBody").hidden = true;
  $("#sourcesSection").hidden = true;
  $(".journey-end").hidden = true;
  workspace.hidden = false;
  $("#branchWorkspaceTitle").textContent = root.title;
  const crumbs = $("#branchBreadcrumb");
  crumbs.replaceChildren();
  state.branchStack.forEach((id, index) => {
    const node = findNode(state.journey.stages, id);
    if (index) crumbs.append(create("span", "branch-crumb-separator", "›"));
    const crumb = create("button", "branch-crumb", node?.title || "Branch");
    crumb.type = "button";
    crumb.addEventListener("click", () => { state.branchStack = state.branchStack.slice(0, index + 1); renderBranchWorkspace(); });
    crumbs.append(crumb);
  });
  const grid = $("#branchWorkspaceGrid");
  grid.replaceChildren();
  const items = flattenBranch(root);
  if (!items.length) grid.append(create("p", "branch-workspace-empty", "No branches yet. Grow a branch from this topic to explore it further."));
  items.forEach(({ node, parent, depth }) => {
    const card = create("article", "workspace-node");
    card.append(create("div", "node-index", depth ? `DEEPER CONCEPT · LEVEL ${depth + 1}` : "BRANCH"));
    card.append(create("h3", "", node.title));
    if (node.summary) card.append(create("p", "workspace-summary", node.summary));
    if (node.content) card.append(create("p", "workspace-content", node.content));
    card.append(create("p", "workspace-parent", `Branch from: ${parent.title}`));
    const childNodes = node.children || node.keyPoints || [];
    if (childNodes.length || !state.readOnly) {
      const action = create("button", "branch-toggle", childNodes.length ? "Open this branch →" : "Grow this branch ↗");
      action.type = "button";
      if (childNodes.length) action.addEventListener("click", () => { state.branchStack.push(node.id); renderBranchWorkspace(); });
      else action.dataset.workspaceGrow = node.id;
      card.append(action);
    }
    grid.append(card);
  });
}
function openBranchWorkspace(nodeId) {
  if (!findNode(state.journey?.stages, nodeId)) return;
  state.branchStack = [nodeId];
  renderBranchWorkspace();
  $("#branchWorkspace").scrollIntoView({ behavior: "smooth", block: "start" });
}
function closeBranchWorkspace() {
  state.branchStack = [];
  $("#branchWorkspace").hidden = true;
  $("#journeyBody").hidden = false;
  $("#sourcesSection").hidden = !$("#sourcesGrid").children.length;
  $(".journey-end").hidden = false;
}

function normalizeJourney(journey) {
  const normalizeText = value => String(value || "").replace(/\r/g, "").trim();
  const normalizeKey = value => normalizeText(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const sentences = value => normalizeText(value).split(/(?<=[.!?])\s+|\n+/).map(part => part.trim()).filter(Boolean);
  const similar = (a, b) => {
    const x = normalizeKey(a), y = normalizeKey(b);
    if (!x || !y) return false;
    if (x === y || x.includes(y) || y.includes(x)) return true;
    const A = new Set(x.split(" ").filter(word => word.length > 2));
    const B = new Set(y.split(" ").filter(word => word.length > 2));
    if (!A.size || !B.size) return false;
    let overlap = 0; for (const word of A) if (B.has(word)) overlap++;
    return overlap / (A.size + B.size - overlap) >= 0.78;
  };
  const normalizeNode = (node, siblingSeen = []) => {
    const summary = normalizeText(node.summary);
    const summaryParts = sentences(summary);
    const contentParts = sentences(node.content);
    const content = contentParts.filter(sentence => !summaryParts.some(existing => similar(sentence, existing)) && !siblingSeen.some(existing => similar(sentence, existing))).join(" ");
    const keptSummary = summaryParts.filter(sentence => !siblingSeen.some(existing => similar(sentence, existing))).join(" ");
    const localSeen = [...siblingSeen, ...sentences(keptSummary), ...sentences(content)];
    const examples = (node.examples || []).map(normalizeText).filter(example => example && !localSeen.some(existing => similar(example, existing)));
    const children = node.children || node.key_points || node.keyPoints || [];
    const childSeen = [...localSeen, ...examples];
    const normalizedChildren = children.map(child => {
      const normalized = normalizeNode(child, childSeen);
      childSeen.push(...sentences(normalized.summary), ...sentences(normalized.content));
      return normalized;
    });
    return { ...node, summary: keptSummary, content, examples, children: normalizedChildren };
  };
  const seen = [];
  const stages = (journey.stages || []).map(stage => {
    const normalized = normalizeNode(stage, seen);
    seen.push(...sentences(normalized.summary), ...sentences(normalized.content));
    return normalized;
  });
  return { ...journey, introduction: normalizeText(journey.introduction), stages };
}
function renderJourney(journey, options = {}) {
  state.readOnly = Boolean(options.readOnly);
  state.journey = normalizeJourney(journey);
  $("#journeyTitle").textContent = journey.title || journey.query;
  $("#journeyContext").textContent = journey.parent_journey_id ? "A new branch of your wider learning journey" : "Start with the essentials. Follow a branch whenever you want to go deeper.";
  $("#backParentButton").hidden = state.readOnly || !journey.parent_journey_id;
  $("#backParentButton").onclick = journey.parent_journey_id ? () => openJourney(journey.parent_journey_id) : null;
  const body = $("#journeyBody");
  body.replaceChildren();
  const intro = create("section", "intro-block");
  intro.append(create("div", "intro-label", "THE SIMPLEST EXPLANATION"));
  intro.append(create("p", "", journey.introduction));
  
  body.append(intro);
  const tree = create("div", "major-branches");
  (journey.stages || []).forEach((node, index) => tree.append(renderNode(node, [index], journey.id)));
  body.append(tree);
  state.branchStack = [];
  $("#branchWorkspace").hidden = true;
  $("#journeyBody").hidden = false;
  $(".journey-end").hidden = false;
  const sourcesSection = $("#sourcesSection");
  const sourcesGrid = $("#sourcesGrid");
  sourcesGrid.replaceChildren();
  const sources = journey.sources || [];
  sources.forEach(source => {
    const card = safeLink(source.url, source.title);
    if (card) sourcesGrid.append(card);
  });
  sourcesSection.hidden = !sourcesGrid.children.length;
  showView("learning");
  requestAnimationFrame(() => {
    if (options.restoreProgress && Number(journey.progress_ratio) > 0) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: max * Number(journey.progress_ratio), behavior: "auto" });
    } else if (options.scrollToTop !== false) {
      $("#learningView").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    updateScrollScene();
  });
}

async function runSearch(query) {
  state.lastQuery = query;
  state.retryAction = () => runSearch(query);
  if (!state.user) { openAuth("login"); setAuthFeedback("Sign in or create an account to start a saved learning journey."); return; }
  $("#searchButton").disabled = true;
  $("#searchButton").textContent = "Exploring...";
  showView("loading");
  try {
    const { journey } = await api("/api/learning/search", { method: "POST", body: JSON.stringify({ query }) });
    renderJourney(journey);
  } catch (error) {
    $("#errorMessage").textContent = error.message;
    showView("error");
  } finally {
    $("#searchButton").disabled = false;
    $("#searchButton").innerHTML = 'Explore <span aria-hidden="true">↗</span>';
  }
}
async function runDocumentUpload(file) {
  if (!file) return;
  const allowed = /\.(pdf|docx|txt|md)$/i.test(file.name);
  if (!allowed) { $("#uploadStatus").textContent = "Choose a PDF, Word (.docx), TXT or Markdown file."; return; }
  if (file.size > 10 * 1024 * 1024) { $("#uploadStatus").textContent = "This file is larger than the 10 MB limit."; return; }
  if (!state.user) { openAuth("login"); setAuthFeedback("Sign in to prepare a saved roll from your document."); return; }
  const button = $("#uploadButton");
  const searchButton = $("#searchButton");
  button.disabled = true; searchButton.disabled = true;
  $("#uploadStatus").textContent = "Reading your document and preparing its topic-wise roll…";
  state.retryAction = () => runDocumentUpload(file);
  showView("loading");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { journey } = await api("/api/learning/upload", { method: "POST", body: bytes, headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) } });
    $("#uploadStatus").textContent = "Your document roll is ready.";
    renderJourney(journey);
  } catch (error) {
    $("#errorMessage").textContent = error.message;
    showView("error");
    $("#uploadStatus").textContent = error.message;
  } finally {
    button.disabled = false; searchButton.disabled = false;
    $("#documentInput").value = "";
  }
}
async function runFollowup(journeyId, query, contextNodeId) {
  state.retryAction = () => runFollowup(journeyId, query, contextNodeId);
  if (!state.user) { openAuth("login"); return; }
  try { await saveProgress(); } catch { /* Best effort before switching learning paths. */ }
  showView("loading");
  try {
    const { journey } = await api(`/api/learning/${journeyId}/follow-up`, { method: "POST", body: JSON.stringify(contextNodeId ? { query, contextNodeId } : { query }) });
    renderJourney(journey);
  } catch (error) {
    $("#errorMessage").textContent = error.message;
    showView("error");
  }
}
async function growBranch(button) {
  const nodeId = button.dataset.branchNode;
  if (!state.journey || state.busyNodes.has(nodeId)) return;
  const article = button.closest(".learning-node");
  const node = findNode(state.journey.stages, nodeId);
  const existing = article.querySelector(":scope > .generated-branch");
  const initialChildren = article.querySelector(":scope > .node-children");
  if ((existing || initialChildren?.children.length) && node?.elaborated) {
    (existing || initialChildren).scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  state.busyNodes.add(nodeId);
  article.querySelectorAll(".branch-error").forEach(element => element.remove());
  button.disabled = true;
  button.textContent = "Growing…";
  const loading = create("div", "branch-loading", "Growing a new path from this concept…");
  article.append(loading);
  try {
    const { nodes, sources } = await api(`/api/learning/${state.journey.id}/branches`, {
      method: "POST",
      body: JSON.stringify({ parentNodeId: nodeId, prompt: node?.elaborate_prompt || `Explain ${node?.title || "this topic"} in detail, step by step.` })
    });
    loading.remove();
    node.elaborated = true;
    node.children = [...(node.children || []), ...nodes];
    state.journey = normalizeJourney(state.journey);
    state.journey.sources = [...(state.journey.sources || []), ...(sources || [])];
    refreshSources(state.journey.sources);
    if (state.branchStack.length) renderBranchWorkspace();
    else {
      renderJourney(state.journey, { scrollToTop: false });
      openBranchWorkspace(nodeId);
    }
    updateScrollScene();
  } catch (error) {
    loading.textContent = error.message;
    loading.classList.add("branch-error");
    button.textContent = "Try again ↗";
  } finally {
    state.busyNodes.delete(nodeId);
    button.disabled = false;
  }
} 
async function growWorkspaceBranch(nodeId) {
  const node = findNode(state.journey?.stages, nodeId);
  if (!node || state.busyNodes.has(nodeId)) return;
  state.busyNodes.add(nodeId);
  const button = [...$("#branchWorkspaceGrid").querySelectorAll("[data-workspace-grow]")].find(item => item.dataset.workspaceGrow === nodeId);
  if (button) { button.disabled = true; button.textContent = "Growing…"; }
  try {
    const { nodes, sources } = await api(`/api/learning/${state.journey.id}/branches`, {
      method: "POST",
      body: JSON.stringify({ parentNodeId: nodeId, prompt: node.elaborate_prompt || `Explain ${node.title} in detail, step by step.` })
    });
    node.children = [...(node.children || []), ...nodes];
    node.elaborated = true;
    state.journey = normalizeJourney(state.journey);
    state.journey.sources = [...(state.journey.sources || []), ...(sources || [])];
    refreshSources(state.journey.sources);
    renderBranchWorkspace();
  } catch (error) {
    showToast(error.message);
    if (button) { button.disabled = false; button.textContent = "Try again ↗"; }
  } finally { state.busyNodes.delete(nodeId); }
}

function findNode(nodes, id) {
  for (const node of nodes || []) {
    if (node.id === id) return node;
    const found = findNode(node.children || node.keyPoints || [], id);
    if (found) return found;
  }
  return null;
}
function getNodePath(nodes, id, prefix = []) {
  for (let i = 0; i < (nodes || []).length; i++) {
    const node = nodes[i];
    if (node.id === id) return [...prefix, i];
    const nested = getNodePath(node.children || node.keyPoints || [], id, [...prefix, i]);
    if (nested.length) return nested;
  }
  return [];
}
function refreshSources(sources) {
  const grid = $("#sourcesGrid");
  grid.replaceChildren();
  (sources || []).forEach(source => { const card = safeLink(source.url, source.title); if (card) grid.append(card); });
  $("#sourcesSection").hidden = !grid.children.length;
}


async function openJourney(id) {
  showView("loading");
  try {
    const { journey } = await api(`/api/learning/${id}`);
    renderJourney(journey, { restoreProgress: true });
  } catch (error) { $("#errorMessage").textContent = error.message; showView("error"); }
}
async function saveProgress(keepalive = false) {
  if (!state.user || !state.journey) return;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  const candidates = [...document.querySelectorAll(".learning-node[data-node-id]")];
  const visible = candidates.filter(node => { const rect = node.getBoundingClientRect(); return rect.bottom > 130 && rect.top < window.innerHeight; });
  const active = visible.sort((a, b) => Math.abs(a.getBoundingClientRect().top - 150) - Math.abs(b.getBoundingClientRect().top - 150))[0];
  await api("/api/progress", {
    method: "POST",
    keepalive,
    body: JSON.stringify({ journeyId: state.journey.id, currentNodeId: active?.dataset.nodeId || null, progressRatio: Number(ratio.toFixed(5)) })
  });
}
function scheduleProgressSave() {
  if (!state.user || !state.journey) return;
  clearTimeout(state.progressTimer);
  state.progressTimer = setTimeout(() => saveProgress().catch(error => console.warn("Progress save failed:", error.message)), 1200);
}
function updateScrollScene() {
  // Learning cards stay in normal document flow to keep headings and content aligned.
  if (state.journey) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const percent = max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0;
    $("#journeyProgressFill").style.width = `${percent}%`;
  }
}
function onScroll() {
  if (!state.scrollFrame) state.scrollFrame = requestAnimationFrame(() => {
    state.scrollFrame = 0;
    updateScrollScene();
    scheduleProgressSave();
  });
}

$("#documentInput").addEventListener("change", event => runDocumentUpload(event.target.files?.[0]));

form.addEventListener("submit", event => {
  event.preventDefault();
  const query = input.value.trim();
  if (query.length >= 2) runSearch(query);
});
document.querySelectorAll("[data-query]").forEach(button => button.addEventListener("click", () => { input.value = button.dataset.query; runSearch(input.value); }));
$("#authOpenButton").addEventListener("click", () => openAuth("login"));
$("#authCloseButton").addEventListener("click", closeAuth);
authModal.addEventListener("click", event => { if (event.target === authModal) closeAuth(); });
document.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
$("#loginForm").addEventListener("submit", handleLogin);
$("#registerForm").addEventListener("submit", handleRegister);
$("#resetRequestForm").addEventListener("submit", handleResetRequest);
$("#resetCompleteForm").addEventListener("submit", handleResetComplete);
$("#forgotPasswordButton").addEventListener("click", () => setAuthMode("resetRequest"));
$("#accountButton").addEventListener("click", () => { $("#accountMenu").hidden = !$("#accountMenu").hidden; });
document.addEventListener("click", event => { if (!event.target.closest(".account-actions")) $("#accountMenu").hidden = true; });
$("#logoutButton").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST", body: "{}" }); state.user = null; state.journey = null; updateAccountUI(); $("#accountMenu").hidden = true; showView("home"); showToast("You've signed out."); await refreshCsrf(); }
  catch (error) { showToast(error.message); }
});
$("#exportButton").addEventListener("click", () => { window.location.href = "/api/account/export"; });
$("#deleteAccountButton").addEventListener("click", async () => {
  const password = window.prompt("Enter your password to permanently delete your eduRoll account and learning history.");
  if (!password) return;
  if (!window.confirm("This permanently deletes your account and saved learning journeys. Continue?")) return;
  try {
    await api("/api/account", { method: "DELETE", body: JSON.stringify({ password }) });
    state.user = null; state.journey = null; updateAccountUI(); $("#accountMenu").hidden = true; showView("home"); await refreshCsrf(); showToast("Your account has been deleted.");
  } catch (error) { showToast(error.message); }
});
$("#backHomeButton").addEventListener("click", () => { state.journey = null; showView("home"); window.scrollTo({ top: 0, behavior: "smooth" }); input.focus({ preventScroll: true }); });
$("#retryButton").addEventListener("click", () => state.retryAction ? state.retryAction() : showView("home"));


$("#journeyBody").addEventListener("click", event => {
  const open = event.target.closest("[data-open-branch]");
  const grow = event.target.closest("[data-branch-node]");
  if (open) openBranchWorkspace(open.dataset.openBranch);
  else if (grow) growBranch(grow);
});
$("#branchWorkspaceBack").addEventListener("click", () => {
  if (state.branchStack.length > 1) { state.branchStack.pop(); renderBranchWorkspace(); }
  else closeBranchWorkspace();
});
$("#branchWorkspaceGrid").addEventListener("click", event => {
  const grow = event.target.closest("[data-workspace-grow]");
  if (grow) growWorkspaceBranch(grow.dataset.workspaceGrow);
});
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", () => requestAnimationFrame(updateScrollScene), { passive: true });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveProgress(true).catch(() => {}); });
window.addEventListener("pagehide", () => saveProgress(true).catch(() => {}));

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
initialize();
