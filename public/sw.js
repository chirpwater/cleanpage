/**
 * Clean Page service worker (DESIGN §8).
 *
 * Cache-first over a precache list. The build id and the asset list below are
 * placeholders, replaced at build time by the Vite plugin in `vite.config.ts`
 * from the files the build actually emitted, so the list cannot rot.
 *
 * Every lookup passes `ignoreVary: true`. The precache is a fixed list of our
 * own static files, but a host may answer them with `Vary: Origin` (Vite's own
 * preview server does, and so do several static hosts). The precached entry is
 * then stored against a header-less `addAll` request and never matches the
 * document's own `cors` requests for app.js and app.css — measured: the page
 * reloaded offline with both of them ERR_FAILED and no stylesheet at all.
 *
 * No skipWaiting() and no clients.claim(), deliberately: a new version must
 * never activate under a child who is mid-sentence. Even with local recovery,
 * replacing the running app would interrupt their editing state. The new
 * worker waits and takes over on the next cold start.
 */
// Cache Storage is shared by the whole origin, including other applications
// and other copies of Clean Page hosted under different paths.
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
    // Try the REAL document first, and fall back to the app shell only when the
    // requested page is not one of ours. Answering every navigation from
    // `./index.html` made the two published statements unreachable the moment
    // this worker took control: a returning visitor — the teacher, or the
    // district reviewer following the link in the email — asked for
    // `/privacy.html` and got the typewriter, online and offline alike, with
    // only a hard reload (which bypasses the worker) to recover them. Both
    // statements are precached; they were simply never served. The shell
    // fallback stays, because a deep link into a single-page app is what §8
    // exists for.
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
