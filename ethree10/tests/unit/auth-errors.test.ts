import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { authErrorCopy } from "@/lib/auth-errors";

/**
 * `pages.error` is "/login", so every failed sign-in lands back on the login
 * page with `?error=<code>`. The page ignored it, so a failure was
 * indistinguishable from arriving fresh — QA reported it as "Google sign-in
 * returns to login and does not explain".
 */
describe("authErrorCopy", () => {
  it("says nothing when there is no error", () => {
    // The ordinary case: someone opening /login. It must not render an empty
    // red box.
    expect(authErrorCopy(null)).toBeNull();
    expect(authErrorCopy(undefined)).toBeNull();
    expect(authErrorCopy("")).toBeNull();
  });

  it("still produces a message for a code it has never seen", () => {
    // Auth.js adds codes between versions. Returning null for an unknown one
    // would silently reproduce the exact bug this module exists to fix.
    const copy = authErrorCopy("SomeCodeInventedNextYear");
    expect(copy).not.toBeNull();
    expect(copy!.message.length).toBeGreaterThan(0);
  });

  it("does not tell the user to retry a server misconfiguration", () => {
    // The production failure was OAuthSignin: the Google provider was built
    // with an empty client id, so the request never reached Google. Telling
    // someone to try again sends them round a loop that cannot succeed.
    for (const code of ["Configuration", "OAuthSignin", "OAuthCreateAccount"]) {
      expect(authErrorCopy(code)!.retryable).toBe(false);
    }
  });

  it("points an already-registered address at the method that works", () => {
    const copy = authErrorCopy("OAuthAccountNotLinked")!;
    expect(copy.retryable).toBe(false);
    expect(copy.message).toMatch(/magic link/i);
  });

  it("explains an expired magic link as ordinary, and retryable", () => {
    const copy = authErrorCopy("Verification")!;
    expect(copy.retryable).toBe(true);
    expect(copy.message).toMatch(/expired|already been used/i);
  });

  it("never blames the user for a configuration fault", () => {
    // A message that says "check your details" for a server fault costs the
    // user time and the support desk a ticket.
    for (const code of ["Configuration", "OAuthSignin"]) {
      expect(authErrorCopy(code)!.message).toMatch(/administrator/i);
      expect(authErrorCopy(code)!.message).not.toMatch(/your password|check your details/i);
    }
  });
});

describe("the login page actually reads the error", () => {
  // The module above is useless if nothing calls it. This is what was really
  // broken: the copy did not exist, but neither did the wiring.
  it("passes ?error through to the form", () => {
    const page = readFileSync(join(process.cwd(), "app/(auth)/login/page.tsx"), "utf8");
    expect(page).toMatch(/searchParams/);
    expect(page).toMatch(/errorCode=\{/);
  });

  it("renders it through authErrorCopy", () => {
    const form = readFileSync(join(process.cwd(), "app/(auth)/login/login-form.tsx"), "utf8");
    expect(form).toMatch(/authErrorCopy\(errorCode\)/);
  });
});

describe("the service worker", () => {
  const sw = () => readFileSync(join(process.cwd(), "public/sw.js"), "utf8");

  it("does not cache the redirecting root", () => {
    // Caching "/" is what produced the offline redirect loop: the fallback
    // resolved to a redirect to a page that was not cached.
    expect(sw()).not.toMatch(/addAll\(\s*\[\s*["']\/["']/);
  });

  it("precaches the offline page, which now exists", () => {
    expect(sw()).toMatch(/OFFLINE_URL/);
    expect(sw()).toMatch(/cache\.add\(/);
  });

  it("versions the cache so a deploy cannot leave stale entries", () => {
    expect(sw()).toMatch(/CACHE_VERSION/);
    expect(sw()).toMatch(/caches\.delete/);
  });

  it("never answers respondWith with undefined", () => {
    // `caches.match` resolves to undefined on a miss, and respondWith(undefined)
    // throws — turning a handled outage into the browser's own error page.
    expect(sw()).toMatch(/new Response\(/);
  });

  it("leaves non-navigation and non-GET requests alone", () => {
    // Handing an API call an HTML page is a harder bug to find than a failed
    // fetch, and replaying a POST is how a form silently submits twice.
    expect(sw()).toMatch(/request\.mode !== "navigate"/);
    expect(sw()).toMatch(/request\.method !== "GET"/);
  });
});
