"use strict";

const $ = selector => document.querySelector(selector);
const state = { csrf: "", user: null, journey: null, lastQuery: "", retryAction: null, resetToken: "", progressTimer: null, scrollFrame: 0, authMode: "login", busyNodes: new Set() };
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
  $("#learningView").hidden = view !== "learning";
  $("#loadingView").hidden = view !== "loading";
  $("#errorView").hidden = view !== "error";
  if (view === "home") window.scrollTo({ top: 0, behavior: "smooth" });
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
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
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
  $("#accountStatus").textContent = signedIn ? `Learning as ${state.user.displayName}` : "";
  $("#accountButton").textContent = signedIn ? (state.user.displayName || "e").trim().charAt(0).toUpperCase() : "";
  $("#accountMenuUser").textContent = signedIn ? `${state.user.displayName} · ${state.user.email}` : "";
  $("#myLearningNav").hidden = !signedIn;
  $("#my-learning").hidden = !signedIn;
  if (signedIn) loadHistory().catch(() => {});
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
  try {
    await refreshCsrf();
    const { user } = await api("/api/auth/me");
    state.user = user;
    updateAccountUI();
    const params = new URLSearchParams(location.search);
    if (params.has("reset")) {
      state.resetToken = params.get("reset");
      openAuth("resetComplete");
      history.replaceState({}, "", location.pathname);
    }
  } catch (error) { console.error("Initialization failed:", error.message); }
}

async function handleLogin(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const submit = event.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify(data) });
    state.user = result.user;
    state.csrf = result.csrfToken;
    updateAccountUI();
    closeAuth();
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
  data.consent = Boolean(new FormData(event.currentTarget).get("consent"));
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
function renderNode(node, path, journeyId) {
  const article = create("article", "learning-node");
  article.dataset.nodeId = node.id;
  article.dataset.depth = node.depth || path.length;
  const heading = create("div", "node-heading");
  const headingCopy = create("div");
  const nodeKind = path.length === 1 ? "STEP" : path.length === 2 ? "SUBSTEP" : "BRANCH";
  headingCopy.append(create("div", "node-index", `${nodeKind} ${nodePathLabel(path).padStart(2, "0")}`));
  headingCopy.append(create("h3", "", node.title));
  heading.append(headingCopy);
  const elaborate = create("button", "elaborate-button", node.elaborated ? "Explore deeper ↗" : "Elaborate ↗");
  elaborate.type = "button";
  elaborate.dataset.elaborateNode = node.id;
  heading.append(elaborate);
  article.append(heading);
  if (node.summary) article.append(create("p", "node-summary", node.summary));
  if (node.content) article.append(create("p", "node-content", node.content));
  if (Array.isArray(node.examples) && node.examples.length) {
    const examples = create("div", "node-examples");
    node.examples.forEach(example => examples.append(create("pre", "example-block", example)));
    article.append(examples);
  }
  const children = Array.isArray(node.children) ? node.children : Array.isArray(node.keyPoints) ? node.keyPoints : [];
  if (children.length) {
    const childContainer = create("div", "node-children");
    children.forEach((child, index) => childContainer.append(renderNode(child, [...path, index], journeyId)));
    article.append(childContainer);
  }
  const actions = create("div", "node-actions");
  actions.append(followupForm(journeyId, node.id));
  article.append(actions);
  return article;
}
function normalizeJourney(journey) {
  if (Array.isArray(journey.stages)) {
    journey.stages = journey.stages.map(stage => ({ ...stage, children: stage.children || stage.keyPoints || [] }));
  }
  return journey;
}
function renderJourney(journey, options = {}) {
  state.journey = normalizeJourney(journey);
  $("#journeyTitle").textContent = journey.title || journey.query;
  $("#journeyContext").textContent = journey.parent_journey_id ? "A new branch of your wider learning journey" : "Start with the essentials. Follow a branch whenever you want to go deeper.";
  $("#backParentButton").hidden = !journey.parent_journey_id;
  $("#backParentButton").onclick = journey.parent_journey_id ? () => openJourney(journey.parent_journey_id) : null;
  const body = $("#journeyBody");
  body.replaceChildren();
  const intro = create("section", "intro-block");
  intro.append(create("div", "intro-label", "THE SIMPLEST EXPLANATION"));
  intro.append(create("p", "", journey.introduction));
  intro.append(followupForm(journey.id, null, true));
  body.append(intro);
  (journey.stages || []).forEach((node, index) => body.append(renderNode(node, [index], journey.id)));
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
    loadHistory().catch(() => {});
  } catch (error) {
    $("#errorMessage").textContent = error.message;
    showView("error");
  } finally {
    $("#searchButton").disabled = false;
    $("#searchButton").innerHTML = 'Explore <span aria-hidden="true">↗</span>';
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
    loadHistory().catch(() => {});
  } catch (error) {
    $("#errorMessage").textContent = error.message;
    showView("error");
  }
}
async function elaborateNode(button) {
  const nodeId = button.dataset.elaborateNode;
  if (!state.journey || state.busyNodes.has(nodeId)) return;
  const article = button.closest(".learning-node");
  const hasChildren = article.querySelector(":scope > .node-children");
  if (hasChildren && hasChildren.children.length && findNode(state.journey.stages, nodeId)?.elaborated) {
    hasChildren.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  state.busyNodes.add(nodeId);
  article.querySelectorAll(".branch-error").forEach(element => element.remove());
  button.disabled = true;
  button.textContent = "Researching...";
  const loading = create("div", "branch-loading", "Building a deeper learning branch...");
  article.append(loading);
  const node = findNode(state.journey.stages, nodeId);
  try {
    const { nodes, sources } = await api(`/api/learning/${state.journey.id}/branches`, {
      method: "POST",
      body: JSON.stringify({ parentNodeId: nodeId, prompt: node?.elaborate_prompt || `Explain ${node?.title || "this topic"} in detail, step by step.` })
    });
    loading.remove();
    const container = create("div", "node-children");
    nodes.forEach((child, index) => container.append(renderNode(child, getNodePath(state.journey.stages, nodeId).concat(index), state.journey.id)));
    article.append(container);
    node.elaborated = true;
    node.children = [...(node.children || []), ...nodes];
    state.journey.sources = [...(state.journey.sources || []), ...(sources || [])];
    refreshSources(state.journey.sources);
    button.textContent = "Explore deeper ↗";
    setTimeout(() => container.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
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

async function loadHistory() {
  if (!state.user) return;
  const { journeys } = await api("/api/learning/history");
  const grid = $("#historyGrid");
  grid.replaceChildren();
  journeys.forEach(journey => {
    const card = create("button", "history-card");
    card.type = "button";
    card.append(create("h3", "", journey.title || journey.query));
    card.append(create("p", "", `${journey.intent} · ${new Date(journey.last_opened_at).toLocaleDateString()}`));
    const meter = create("div", "history-meter");
    const fill = create("span");
    fill.style.width = `${Math.round(Number(journey.progress_ratio || 0) * 100)}%`;
    meter.append(fill);
    card.append(meter);
    card.addEventListener("click", () => openJourney(journey.id));
    grid.append(card);
  });
  if (!journeys.length) grid.append(create("p", "journey-context", "Your saved learning journeys will appear here."));
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
  const nodes = document.querySelectorAll(".learning-node");
  const viewportCenter = window.innerHeight * 0.52;
  nodes.forEach(node => {
    const rect = node.getBoundingClientRect();
    const distance = (rect.top + rect.height * 0.32 - viewportCenter) / Math.max(window.innerHeight, 1);
    const tilt = Math.max(-5.5, Math.min(5.5, distance * -7.2));
    const depth = Math.max(-34, Math.min(0, Math.abs(distance) * -25));
    node.style.setProperty("--node-tilt", `${tilt.toFixed(2)}deg`);
    node.style.setProperty("--node-depth", `${depth.toFixed(1)}px`);
    node.style.setProperty("--node-lift", `${Math.max(-6, Math.min(6, distance * -5)).toFixed(1)}px`);
  });
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
$("#refreshHistoryButton").addEventListener("click", () => loadHistory().catch(error => showToast(error.message)));
$("#endFollowupForm").addEventListener("submit", event => { event.preventDefault(); const query = new FormData(event.currentTarget).get("query").trim(); if (query && state.journey) runFollowup(state.journey.id, query, null); });
$("#journeyBody").addEventListener("click", event => { const button = event.target.closest("[data-elaborate-node]"); if (button) elaborateNode(button); });
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", () => requestAnimationFrame(updateScrollScene), { passive: true });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveProgress(true).catch(() => {}); });
window.addEventListener("pagehide", () => saveProgress(true).catch(() => {}));

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
initialize();
