const CACHE_PREFIX = `cleanpage-${encodeURIComponent(self.registration.scope)}:`;
const CACHE = `${CACHE_PREFIX}__CP_BUILD__`;
const ASSETS = ["__CP_ASSETS__"];

self.addEventListener("install", (e) => {
  // `cache: "reload"` so a new build id is precached from network truth rather
  // than from whatever the browser's HTTP cache is still holding. The font
  // URLs are unhashed and `app.js`/`app.css` are too, so without this a font
  // replaced at the same URL would be baked into the new cache as the old
  // bytes — and this project's wrap and print geometry is measured against
  // exact font metrics.
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  if (e.request.mode === "navigate") {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const document = await cache.match(e.request, { ignoreVary: true, ignoreSearch: true });
        if (document) return document;
        if (await cache.match("./index.html", { ignoreVary: true })) {
          // The shell uses relative asset URLs. Serving its bytes under a
          // nested URL makes scripts, styles and fonts resolve in that nested
          // directory. Redirect to the cached entry so the editor fully boots.
          return Response.redirect(new URL("index.html", self.registration.scope).href);
        }
        return fetch(e.request);
      }),
    );
    return;
  }
  e.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match(e.request, { ignoreVary: true }))
      .then((r) => r || fetch(e.request)),
  );
});
