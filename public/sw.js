"use strict";
const CACHE = "eduroll-shell-v27";
const SHELL = ["/", "/styles.css", "/mobile.css", "/app.js", "/scene3d.js", "/favicon.svg", "/manifest.webmanifest", "/myroll.html", "/myroll.css", "/myroll.js", "/shared.html", "/shared.css", "/shared.js"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))), self.clients.claim()])));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && ["/styles.css", "/app.js", "/scene3d.js", "/favicon.svg", "/manifest.webmanifest", "/myroll.css", "/myroll.js", "/shared.css", "/shared.js"].includes(url.pathname)) {
      const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  })));
});
