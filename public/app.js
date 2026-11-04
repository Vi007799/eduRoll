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
  $("#home").hidden = view !== "home";
  $("#how-it-works").hidden = view !== "home";
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
  } else if (params.has("journey")) {
    const journeyId = params.get("journey");
    history.replaceState({}, "", location.pathname);
    if (!/^[0-9a-f-]{36}$/i.test(journeyId)) {
      $( "#errorMessage" ).textContent = "This saved learning path link is invalid. Open myRoll and select the journey again.";
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
function makeBranchToggle(container, count) {
  const control = create("div", "branch-control");
  const toggle = create("button", "branch-toggle", `Hide branch · ${count} ${count === 1 ? "node" : "nodes"}`);
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "true");
  toggle.addEventListener("click", () => {
    const willShow = container.hidden;
    container.hidden = !willShow;
    toggle.setAttribute("aria-expanded", String(willShow));
    toggle.textContent = willShow
      ? `Hide branch · ${count} ${count === 1 ? "node" : "nodes"}`
      : `Show branch · ${count} ${count === 1 ? "node" : "nodes"}`;
  });
  control.append(toggle);
  return control;
}
function renderNode(node, path, journeyId) {
  const isMajor = path.length === 1;
  const article = create("article", `learning-node tree-node ${isMajor ? "major-step" : "concept-node"}`);
  article.dataset.nodeId = node.id;
  article.dataset.depth = node.depth || path.length;
  const heading = create("div", "node-heading");
  const copy = create("div", "node-heading-copy");
  const label = isMajor ? `STEP ${String(path[0] + 1).padStart(2, "0")}` : `CONCEPT ${path.map(index => index + 1).join(".")}`;
  copy.append(create("div", "node-index", label));
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
  const children = Array.isArray(node.children) ? node.children : Array.isArray(node.keyPoints) ? node.keyPoints : [];
  if (children.length) {
    const childContainer = create("div", "node-children tree-branches");
    children.forEach((child, index) => childContainer.append(renderNode(child, [...path, index], journeyId)));
    article.append(childContainer);
    article.append(makeBranchToggle(childContainer, children.length));
  } else {
    const grow = create("button", "branch-button branch-grow-button", "Grow branch ↗");
    grow.type = "button";
    grow.dataset.branchNode = node.id;
    grow.setAttribute("aria-label", `Grow a learning branch from ${node.title}`);
    const control = create("div", "branch-control");
    control.append(grow);
    article.append(control);
  }
  // A contextual follow-up search belongs to each major step only.
  if (isMajor) {
    const actions = create("div", "node-actions");
    actions.append(followupForm(journeyId, node.id));
    article.append(actions);
  }
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
  
  body.append(intro);
  const tree = create("div", "major-branches");
  (journey.stages || []).forEach((node, index) => tree.append(renderNode(node, [index], journey.id)));
  body.append(tree);
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
    const container = create("div", "node-children tree-branches generated-branch");
    nodes.forEach((child, index) => container.append(renderNode(child, getNodePath(state.journey.stages, nodeId).concat(index), state.journey.id)));
    article.append(container);
    node.elaborated = true;
    node.children = [...(node.children || []), ...nodes];
    const control = create("div", "branch-control");
    control.append(makeBranchToggle(container, nodes.length));
    button.closest(".branch-control")?.replaceWith(control);
    state.journey.sources = [...(state.journey.sources || []), ...(sources || [])];
    refreshSources(state.journey.sources);
    setTimeout(() => container.scrollIntoView({ behavior: "smooth", block: "nearest" }), 120);
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


$("#journeyBody").addEventListener("click", event => { const button = event.target.closest("[data-branch-node]"); if (button) growBranch(button); });
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", () => requestAnimationFrame(updateScrollScene), { passive: true });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveProgress(true).catch(() => {}); });
window.addEventListener("pagehide", () => saveProgress(true).catch(() => {}));

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
initialize();
