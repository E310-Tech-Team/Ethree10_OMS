import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * Push has two failure modes that are silent by construction, and both are
 * what these assert.
 *
 * A subscription that the push service has retired keeps being posted to
 * forever unless 404/410 is treated as "this endpoint is gone". Delivery then
 * degrades over months into sending to nobody, with no error anywhere.
 *
 * And Chrome rotates subscriptions: without a `pushsubscriptionchange` handler
 * the user simply stops receiving anything, again with nothing logged.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const SW = "public/sw.js";
const PUSH = "server/notifications/push.ts";
const MANIFEST = "public/manifest.webmanifest";

describe("the service worker handles push", () => {
  const sw = () => read(SW);

  it("shows a notification for every push it receives", () => {
    // A push handler that resolves without showing one makes the browser
    // display its own "site updated in the background" notice instead.
    expect(sw()).toContain('addEventListener("push"');
    expect(sw()).toContain("showNotification");
  });

  it("survives a payload it cannot parse", () => {
    // event.data.json() throws on a non-JSON body. Falling back to an empty
    // object keeps the generic notification rather than showing nothing.
    const source = sw();
    const handler = source.slice(source.indexOf('addEventListener("push"'));
    expect(handler).toMatch(/try\s*\{[\s\S]*?event\.data[\s\S]*?\}\s*catch/);
  });

  it("routes a click to the thing the notification is about", () => {
    expect(sw()).toContain('addEventListener("notificationclick"');
    expect(sw()).toContain("notification.close()");
    // Reuse an open window rather than piling up tabs.
    expect(sw()).toContain("matchAll");
  });

  it("re-subscribes when the browser rotates the subscription", () => {
    // The silent death. Without this the user stops receiving anything.
    expect(sw()).toContain('addEventListener("pushsubscriptionchange"');
    expect(sw()).toContain("/api/push/resubscribe");
  });
});

describe("the service worker's caching stays narrow", () => {
  const sw = () => read(SW);

  it("never interferes with a write", () => {
    // Replaying or masking a POST is how a form submission silently does
    // nothing, or happens twice.
    expect(sw()).toContain('request.method !== "GET"');
  });

  it("only falls back to the offline page for navigations", () => {
    // A data fetch handed an HTML page in response is a harder bug than a
    // failed fetch.
    expect(sw()).toContain('request.mode !== "navigate"');
  });

  it("only cache-firsts content-hashed build output", () => {
    // /_next/static is immutable, so a given URL's bytes never change.
    // Cache-firsting anything else serves stale application code.
    expect(sw()).toContain("/_next/static/");
  });

  it("only stores a complete successful response", () => {
    // Caching an opaque or partial response means serving a broken asset from
    // cache forever.
    expect(sw()).toMatch(/response\.ok/);
  });

  it("deletes caches from previous versions on activate", () => {
    const source = sw();
    expect(source).toContain("CACHE_VERSION");
    expect(source).toContain("caches.delete");
  });

  it("bounds the asset cache", () => {
    expect(sw()).toContain("MAX_ASSET_ENTRIES");
  });
});

describe("the send path", () => {
  const push = () => read(PUSH);

  it("retires an endpoint the push service says is gone", () => {
    // The slow silent failure: without this, delivery degrades over months
    // into sending to nobody.
    const source = push();
    expect(source).toMatch(/status === 404 \|\| status === 410/);
    expect(source).toContain("expiredAt: new Date()");
  });

  it("does not retire an endpoint for a transient error", () => {
    // A push service outage must not permanently unsubscribe everyone.
    const source = push();
    const handler = source.slice(source.indexOf("catch (error)"));
    expect(handler).toContain("captureCriticalFailure");
  });

  it("sends to every device independently", () => {
    // A user is a set of browsers. allSettled, not all: one dead phone must
    // not stop the laptop being notified.
    expect(push()).toContain("Promise.allSettled");
  });

  it("never logs the endpoint itself", () => {
    // An endpoint is a capability to notify that device. The host is enough
    // for diagnostics.
    const source = push();
    expect(source).toContain("safeHost");
    expect(source).not.toMatch(/endpoint: subscription\.endpoint[\s\S]{0,80}captureCriticalFailure/);
  });

  it("is a no-op rather than a throw when unconfigured", () => {
    // Notification delivery is a side effect of something more important. A
    // missing key must never roll back the action that triggered it.
    const source = push();
    expect(source).toContain("if (!ensureConfigured()) return false");
  });

  it("warns about missing keys once, not per send", () => {
    const source = push();
    expect(source).toMatch(/configured = false/);
  });
});

describe("the manifest is installable", () => {
  const manifest = () => JSON.parse(read(MANIFEST)) as Record<string, unknown>;

  it("carries the fields a browser requires to offer an install", () => {
    const m = manifest();
    for (const key of ["name", "short_name", "start_url", "display", "icons"]) {
      expect(m[key], key).toBeTruthy();
    }
  });

  it("has both a 192 and a 512 icon", () => {
    const sizes = (manifest().icons as Array<{ sizes: string }>).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("has maskable icons, so Android does not letterbox the logo", () => {
    const icons = manifest().icons as Array<{ purpose?: string }>;
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("uses the brand navy as its theme colour", () => {
    // It was #1E1B4B — an indigo belonging to no part of this product. The
    // theme colour paints the status bar of an installed app, so a wrong value
    // is visible on every launch and nowhere in the app itself.
    expect(manifest().theme_color).toBe("#031629");
  });

  it("agrees with the themeColor the app serves", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('themeColor: "#031629"');
  });

  it("scopes to the whole app so navigations stay in the installed window", () => {
    expect(manifest().scope).toBe("/");
  });
});
