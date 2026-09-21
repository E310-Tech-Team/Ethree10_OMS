/**
 * Service worker: offline fallback, asset caching, and push.
 *
 * The first version of this file was example code that shipped, and its own
 * comment said so. It fell back to a route that did not exist, precached "/"
 * which redirects (an offline loop), and relied on `caches.match(a) ||
 * caches.match(b)`, where the left side is a Promise and therefore always
 * truthy — so the fallback was dead code and a cache miss resolved to
 * `undefined`, which throws inside respondWith.
 *
 * What it does now:
 *
 *   - precaches the offline page, so a failed navigation has somewhere to go
 *   - caches immutable build assets, so a reload offline is not a blank page
 *   - never touches API calls or writes
 *   - handles Web Push and notification clicks
 *
 * Bump CACHE_VERSION when the offline page or this file's caching rules change.
 * `activate` deletes every cache that is not current, so stale entries cannot
 * outlive a deploy.
 */
const CACHE_VERSION = "v3";
const OFFLINE_CACHE = `ethree10-offline-${CACHE_VERSION}`;
const ASSET_CACHE = `ethree10-assets-${CACHE_VERSION}`;
const CURRENT_CACHES = [OFFLINE_CACHE, ASSET_CACHE];
const OFFLINE_URL = "/offline";

/** Keeps the asset cache from growing without bound across many deploys. */
const MAX_ASSET_ENTRIES = 120;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      // Just the offline page. `cache.add` is atomic — one 404 rejects the whole
      // call and the worker never installs — so this holds exactly what is
      // needed and nothing whose existence is a guess.
      //
      // `reload` bypasses the HTTP cache so a deploy cannot install a stale copy
      // of the very page meant to reflect the current build.
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
        names
          .filter((name) => name.startsWith("ethree10-") && !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Trim oldest-first. Cache API preserves insertion order, so keys() is FIFO. */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)));
}

/**
 * Build output under /_next/static is content-hashed, so a given URL's bytes
 * never change. Cache-first is safe there and is what makes an offline reload
 * render something rather than nothing.
 */
function isImmutableAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never interfere with a write. Replaying or masking a POST is how a form
  // submission silently does nothing, or happens twice.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (isImmutableAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { cacheName: ASSET_CACHE });
        if (cached) return cached;
        const response = await fetch(request);
        // Only store a complete, successful response. Caching an opaque or
        // partial one means serving a broken asset from cache forever.
        if (response.ok && response.status === 200) {
          const cache = await caches.open(ASSET_CACHE);
          await cache.put(request, response.clone());
          void trimCache(ASSET_CACHE, MAX_ASSET_ENTRIES);
        }
        return response;
      })(),
    );
    return;
  }

  // Navigations get a network-first strategy with the offline page as fallback.
  // Everything else — API calls, JSON, images — must fail normally so the
  // page's own error handling runs; a data fetch handed an HTML page in
  // response is a harder bug than a failed fetch.
  if (request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch {
        const cached = await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE });
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

/**
 * Web Push.
 *
 * The payload is whatever server/notifications/push.ts sent. It is parsed
 * defensively: a push that cannot be read must still show something, because
 * the browser shows its own generic "This site has been updated in the
 * background" notice if the handler resolves without showing one.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "E310";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: "/icon-192-maskable.png",
    // Collapses repeats of the same thing rather than stacking them. The server
    // sends the notification kind plus entity id.
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    timestamp: payload.timestamp || Date.now(),
    data: { url: payload.url || "/notifications" },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Clicking a notification should land on the thing it is about, and should
 * reuse an open window rather than piling up tabs.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/notifications";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        // Same-origin window already open: focus it and navigate in place.
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});

/**
 * Chrome rotates push subscriptions. Without this the subscription silently
 * dies and the user stops receiving anything with no error anywhere.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
      if (!applicationServerKey) return;
      const fresh = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      await fetch("/api/push/resubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldEndpoint: event.oldSubscription?.endpoint ?? null,
          subscription: fresh.toJSON(),
        }),
      });
    })(),
  );
});
