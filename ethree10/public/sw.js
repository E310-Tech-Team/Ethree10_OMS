/**
 * Offline fallback for navigations.
 *
 * The previous version was example code that shipped. Its own comment said so:
 * "Don't precache offline url yet as it doesn't exist, just an example". Three
 * things were wrong with it, and the third is the one that mattered most:
 *
 *   1. It fell back to `/offline`, a route that did not exist, so the fallback
 *      was a 404.
 *   2. It precached `"/"`, which redirects. A cached redirect is how you get an
 *      offline loop: the fallback resolves to a redirect to a page that is not
 *      in the cache, which falls back again.
 *   3. `caches.match(OFFLINE_URL) || caches.match("/")` never fell through.
 *      `caches.match` returns a Promise, and a Promise is always truthy, so the
 *      right-hand side was dead. Worse, a cache miss resolves to `undefined`,
 *      and `respondWith(undefined)` throws — turning a handled outage into the
 *      browser's own error page.
 *
 * The cache name carries a version. Bump it when the offline page changes;
 * `activate` deletes every cache that is not the current one, so old entries
 * cannot outlive a deploy.
 */
const CACHE_VERSION = "v2";
const CACHE_NAME = `ethree10-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Only the offline page. `cache.addAll` is atomic — one 404 rejects the
      // whole call and the worker never installs — so this list holds exactly
      // what is needed and nothing whose existence is a guess.
      //
      // `reload` bypasses the HTTP cache so a deploy cannot install a stale
      // copy of the very page meant to reflect the current build.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Navigations only. Anything else — API calls, JSON, images — must fail
  // normally so the page's own error handling runs; a fetch for data that gets
  // handed an HTML page in response is a harder bug than a failed fetch.
  if (request.mode !== "navigate") return;

  // Never interfere with a write. Replaying or masking a POST is how a form
  // submission silently does nothing, or happens twice.
  if (request.method !== "GET") return;

  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch {
        const cached = await caches.match(OFFLINE_URL, { cacheName: CACHE_NAME });
        // If the offline page is somehow missing, answer with a real Response
        // rather than `undefined`, which throws inside respondWith.
        return (
          cached ??
          new Response("You are offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }
    })(),
  );
});
