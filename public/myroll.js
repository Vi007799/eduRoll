"use strict";
const grid = document.querySelector("#myRollGrid");
const status = document.querySelector("#myRollStatus");
const account = document.querySelector("#myRollAccount");
const search = document.querySelector("#myRollSearch");
document.querySelector("#myRollYear").textContent = new Date().getFullYear();
let csrf = "";
let allJourneys = [];
async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET") {
    if (!csrf) {
      const tokenResponse = await fetch("/api/csrf", { credentials: "same-origin", cache: "no-store" });
      const tokenData = await tokenResponse.json();
      csrf = tokenData.csrfToken || "";
    }
    headers.set("X-CSRF-Token", csrf);
  }
  const response = await fetch(url, { ...options, headers, credentials: "same-origin", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Unable to complete this action.");
  return data;
}
function icon(name) {
  const paths = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4m-6.6 7 6.6 4.4"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/>'
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = paths[name];
  return svg;
}
function makeCard(journey) {
  const card = document.createElement("article");
  card.className = "myroll-card";
  const main = document.createElement("a");
  main.className = "myroll-card-main";
  main.href = "/?journey=" + encodeURIComponent(journey.id);
  const title = document.createElement("h2");
  title.textContent = journey.title || journey.query || "Untitled learning path";
  const meta = document.createElement("p");
  const date = journey.last_opened_at ? new Date(journey.last_opened_at).toLocaleDateString() : "Saved journey";
  meta.textContent = [journey.intent, date].filter(Boolean).join(" · ");
  const meter = document.createElement("div");
  meter.className = "myroll-meter";
  const fill = document.createElement("span");
  fill.style.width = Math.round(Math.max(0, Math.min(1, Number(journey.progress_ratio || 0))) * 100) + "%";
  meter.append(fill);
  const open = document.createElement("span");
  open.className = "myroll-open";
  open.textContent = "Continue journey ↗";
  main.append(title, meta, meter, open);
  const menuWrap = document.createElement("div");
  menuWrap.className = "myroll-card-menu";
  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "myroll-menu-button";
  menuButton.setAttribute("aria-label", "Roll options");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.append(icon("menu"));
  const menu = document.createElement("div");
  menu.className = "myroll-menu";
  menu.hidden = true;
  const share = document.createElement("button");
  share.type = "button";
  share.append(icon("share"), document.createTextNode("Share roll"));
  share.addEventListener("click", async () => {
    share.disabled = true;
    try {
      const { url } = await request("/api/learning/" + encodeURIComponent(journey.id) + "/share", { method: "POST", body: "{}" });
      if (navigator.share) {
        try { await navigator.share({ title: journey.title || "My eduRoll", url }); }
        catch (error) { if (error.name !== "AbortError") await navigator.clipboard.writeText(url); }
      } else {
        await navigator.clipboard.writeText(url);
        status.textContent = "Share link copied to clipboard.";
      }
      menu.hidden = true;
      menuButton.setAttribute("aria-expanded", "false");
    } catch (error) {
      status.textContent = error.message + " You can copy this link: " + location.origin + "/?shared=…";
    } finally { share.disabled = false; }
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "myroll-delete";
  remove.append(icon("trash"), document.createTextNode("Delete forever"));
  remove.addEventListener("click", async () => {
    if (!window.confirm("Delete this roll and all its learning branches forever? This cannot be undone.")) return;
    remove.disabled = true;
    try {
      await request("/api/learning/" + encodeURIComponent(journey.id), { method: "DELETE" });
      allJourneys = allJourneys.filter(item => item.id !== journey.id);
      renderCards();
      status.textContent = "Roll permanently deleted.";
    } catch (error) {
      status.textContent = error.message;
      remove.disabled = false;
    }
  });
  menu.append(share, remove);
  menuButton.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const opening = menu.hidden;
    document.querySelectorAll(".myroll-menu").forEach(item => item.hidden = true);
    document.querySelectorAll(".myroll-menu-button").forEach(item => item.setAttribute("aria-expanded", "false"));
    menu.hidden = !opening;
    menuButton.setAttribute("aria-expanded", String(opening));
  });
  menuWrap.append(menuButton, menu);
  card.append(main, menuWrap);
  return card;
}
function renderCards() {
  const term = search.value.trim().toLocaleLowerCase();
  const filtered = allJourneys.filter(item => [item.title, item.query, item.intent].some(value => String(value || "").toLocaleLowerCase().includes(term)));
  grid.replaceChildren();
  filtered.forEach(journey => grid.append(makeCard(journey)));
  if (allJourneys.length && !filtered.length) status.textContent = "No rolls match your search.";
  else if (filtered.length) status.textContent = filtered.length + (filtered.length === 1 ? " learning roll" : " learning rolls");
}
async function load() {
  status.textContent = "Loading your learning paths…";
  grid.replaceChildren();
  try {
    const { user } = await request("/api/auth/me");
    if (!user) {
      status.textContent = "Sign in to view your saved learning paths.";
      return;
    }
    account.textContent = "Rolling as " + user.displayName;
    const { journeys } = await request("/api/learning/history");
    allJourneys = journeys || [];
    if (!allJourneys.length) {
      status.textContent = "Your saved learning journeys will appear here after you explore a topic.";
      return;
    }
    renderCards();
  } catch (error) {
    status.textContent = error.message + " Return to explore and sign in again if your session has expired.";
  }
}
search.addEventListener("input", renderCards);
document.addEventListener("click", () => {
  document.querySelectorAll(".myroll-menu").forEach(item => item.hidden = true);
  document.querySelectorAll(".myroll-menu-button").forEach(item => item.setAttribute("aria-expanded", "false"));
});
document.querySelector("#myRollRefresh").addEventListener("click", load);
load();
