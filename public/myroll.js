"use strict";
const grid = document.querySelector("#myRollGrid");
const status = document.querySelector("#myRollStatus");
const account = document.querySelector("#myRollAccount");
document.querySelector("#myRollYear").textContent = new Date().getFullYear();
let csrf = "";
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
  if (!response.ok) throw new Error(data.error || "Unable to load your learning paths.");
  return data;
}
function makeCard(journey) {
  const card = document.createElement("a");
  card.className = "myroll-card";
  card.href = "/?journey=" + encodeURIComponent(journey.id);
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
  card.append(title, meta, meter, open);
  return card;
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
    if (!journeys.length) {
      status.textContent = "Your saved learning journeys will appear here after you explore a topic.";
      return;
    }
    status.textContent = journeys.length + (journeys.length === 1 ? " learning path" : " learning paths");
    journeys.forEach(journey => grid.append(makeCard(journey)));
  } catch (error) {
    status.textContent = error.message + " Return to explore and sign in again if your session has expired.";
  }
}
document.querySelector("#myRollRefresh").addEventListener("click", load);
load();
