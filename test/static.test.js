"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const myroll = fs.readFileSync(path.join(root, "public/myroll.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

test("all app selectors used by the main script exist in the document", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const refs = new Set([...js.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map(match => match[1]));
  assert.deepEqual([...refs].filter(id => !ids.has(id)), []);
});

test("3D response is scroll-driven and does not hijack pointer or wheel gestures", () => {
  assert.match(js, /addEventListener\("scroll"/);
  assert.doesNotMatch(js, /addEventListener\(["'](?:wheel|pointermove|mousemove)["']/);
  assert.match(css, /perspective\(/);
  assert.match(css, /prefers-reduced-motion/);
});

test("service worker never caches authenticated API responses", () => {
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
});

test("account and progress controls are present", () => {
  assert.match(html, /id="registerForm"/);
  assert.match(html, /id="loginForm"/);
  assert.match(html, /id="deleteAccountButton"/);
  assert.match(js, /\/api\/progress/);
  assert.match(js, /\/branches/);
  assert.match(js, /parentNodeId/);
  assert.doesNotMatch(js, /GEMINI_API_KEY/);
  assert.match(myroll, /\/api\/learning\/history/);
});


test("learning provider uses the configured Groq API", () => {
  const learning = fs.readFileSync(path.join(root, "lib/learning.js"), "utf8");
  const env = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  assert.match(learning, /api\.groq\.com\/openai\/v1\/chat\/completions/);
  assert.match(learning, /GROQ_API_KEY/);
  assert.match(learning, /browser_search/);
  assert.match(learning, /type: "json_schema"/);
  assert.match(env, /GROQ_API_KEY=/);
  assert.match(env, /GROQ_MODEL=/);
});
