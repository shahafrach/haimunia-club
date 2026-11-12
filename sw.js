// Service worker for the training-log edition, served at
// haimuniya.github.io/haimunia-app/sw.js with scope ./ - the same URL and
// scope as the 2.x app it replaces, which is what lets it take over in place.
//
// HOW AN INSTALLED 2.x PHONE GETS THIS VERSION. The browser re-fetches this
// file on navigation (bypassing the HTTP cache for the script itself), sees
// the bytes changed, and installs this worker alongside the old one. The old
// page's own update flow - reg.onupdatefound -> offerUpdate() -> postMessage
// SKIP_WAITING -> controllerchange -> reload - talks to whatever worker is
// waiting, and this one answers SKIP_WAITING below. Nothing new is needed on
// the old side, which matters because the old side is already on members'
// phones and cannot be changed.
//
// SW_VERSION is written by scripts/sync-version.mjs from APP_VERSION in
// app.js; the cache name carries it, so every release is a fresh cache.
const SW_VERSION = "3.1.1";
// The 2.x app's own prefix, kept: its caches are "haimunia-v2.34.0" and so
// on, and the cleanup below removes them by this prefix.
const CACHE_PREFIX = "haimunia-v";
const CACHE = `${CACHE_PREFIX}${SW_VERSION}`;

// Everything the app cannot start without. If any of these fails to
// download, install fails and the PREVIOUS version keeps running - the safe
// outcome, since a half-cached new version would break offline.
const REQUIRED_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./app-config.js",
  "./src/usage.js",
  "./frame-guard.js",
  "./theme-init.js",
  "./src/shared/safe-helpers.js",
  "./src/constants.js",
  "./src/format.js",
  "./src/sanitize.js",
  "./src/db.js",
];
// What the app degrades gracefully without: pages, icons, photos, fonts.
// A miss is logged and install continues.
const OPTIONAL_ASSETS = [
  "./privacy.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-192-maskable.png",
  "./icon-512-maskable.png",
  "./assets/mark.png",
  "./assets/icon-barbell.png",
  "./assets/icon-chevrons.png",
  "./assets/logo-full.png",
  "./assets/medal-bronze.png",
  "./assets/medal-silver.png",
  "./assets/medal-gold.png",
  "./assets/photos/club-rig-wide.jpeg",
  "./assets/club-photos/add-stripe-wall.jpg",
  "./assets/club-photos/progress-blue-rig.jpg",
  "./assets/club-photos/achievements-plates.jpg",
  "./assets/club-photos/library-rings.jpg",
  "./assets/club-photos/community-logo-wall.jpg",
  "./assets/fonts/rubik-400-latin.woff2",
  "./assets/fonts/rubik-400-hebrew.woff2",
  "./assets/fonts/rubik-600-latin.woff2",
  "./assets/fonts/rubik-600-hebrew.woff2",
  "./assets/fonts/rubik-700-latin.woff2",
  "./assets/fonts/rubik-700-hebrew.woff2",
  "./assets/fonts/rubik-800-latin.woff2",
  "./assets/fonts/rubik-800-hebrew.woff2",
  "./assets/fonts/rubik-900-latin.woff2",
  "./assets/fonts/rubik-900-hebrew.woff2",
  "./assets/fonts/jbmono-500-latin.woff2",
  "./assets/fonts/jbmono-700-latin.woff2",
  "./assets/fonts/anton-400-latin.woff2",
  "./assets/fonts/secularone-400-hebrew.woff2",
];
const ASSETS = [...REQUIRED_ASSETS, ...OPTIONAL_ASSETS];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // cache: "reload" so a stale HTTP-cached copy of the OLD file can never
      // be precached under the new version's name.
      await Promise.all(REQUIRED_ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" }))));
      await Promise.allSettled(
        OPTIONAL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: "reload" }))
            .catch((err) => console.warn("[sw] precache miss:", url, err))
        )
      );
    })
  );
  // No skipWaiting() here: the page decides when to swap (SKIP_WAITING
  // below), so a running page never finds its assets replaced mid-session.
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // Only this app's own older caches. haimuniya.github.io is shared by
      // every repository the organisation publishes, and the 2.x worker's
      // "delete every cache but mine" took other apps' caches with it.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isPrecached(url) {
  return ASSETS.some((a) => new URL(a, self.location).pathname === url.pathname);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Only ever touch our own origin. The previous version cached every
  // successful GET from anywhere, which meant unbounded growth and let any
  // third-party response sit in the app's cache indefinitely.
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return;


  // Navigations: serve the shell. Matching with ignoreSearch is what makes the
  // manifest shortcuts (./index.html?tab=add) work offline — an exact-URL match
  // missed on the query string and fell through to a network error.
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const preload = await e.preloadResponse;
          if (preload) return preload;
          return await fetch(req);
        } catch (err) {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(req, { ignoreSearch: true })) ||
            (await cache.match("./index.html")) ||
            (await cache.match("./")) ||
            new Response("offline", { status: 503, headers: { "Content-Type": "text/plain" } })
          );
        }
      })()
    );
    return;
  }

  // Same-origin assets: stale-while-revalidate, but only re-cache things that
  // are part of the app shell.
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          // Security hunt (2026-09-11): res.redirected was never checked here.
          // A same-origin redirect still yields type:"basic"/ok:true per the
          // Fetch spec, so if a precached path were ever redirected, this
          // would have cached the REDIRECTED body under the ORIGINAL trusted
          // key - confirmed live by actually redirecting a precached path and
          // watching the redirected content get served back later, fully
          // offline. No mechanism on this app's real static-hosting origin
          // can currently produce such a redirect (checked), so this was not
          // reachable in production, but it was strictly looser than the
          // "only cache what was actually asked for" invariant this whole
          // block exists to enforce, and cheap to close outright.
          if (res && res.ok && !res.redirected && res.type === "basic" && isPrecached(url)) {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })()
  );
});
