import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * The legal pages, and the fact that anything links to them.
 *
 * Both /privacy and /terms existed and were reachable only by typing the URL —
 * nothing in the app linked to either. That is invisible from the outside: the
 * pages return 200, so every check that asks whether they exist passes, while
 * no user could ever find them.
 *
 * It matters twice over now. A privacy notice nobody can reach is not doing its
 * job, and Google's OAuth consent screen review expects the policy to be
 * reachable from the site and to describe what the app does with Google data.
 *
 * Source assertions rather than rendering, because what is being protected is
 * the presence of specific commitments and links, not the markup around them.
 */
const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

const PRIVACY = "app/(marketing)/privacy/page.tsx";
const TERMS = "app/(marketing)/terms/page.tsx";

describe("the legal pages are linked from somewhere", () => {
  it.each([
    ["the marketing footer", "app/(marketing)/layout.tsx"],
    ["the login page", "app/(auth)/login/page.tsx"],
  ])("%s links to both", (_label, file) => {
    const source = read(file);
    expect(source).toContain('href="/privacy"');
    expect(source).toContain('href="/terms"');
  });

  it("the login page links them, because the auth group has no footer", () => {
    // The one page that asks someone to hand over a Google identity. If the
    // auth layout ever gains a footer, this can move — but it must not simply
    // vanish.
    expect(read("app/(auth)/login/page.tsx")).toMatch(/privacy notice|privacy/i);
  });

  it("each page links to the other", () => {
    expect(read(PRIVACY)).toContain('href="/terms"');
    expect(read(TERMS)).toContain('href="/privacy"');
  });
});

describe("the privacy notice covers Google sign-in", () => {
  // Staff authenticate with Google, so personal data arrives from a third
  // party. A notice that does not mention it is incomplete — and this is the
  // section Google's own review looks for.
  const source = () => read(PRIVACY);

  it("names the scopes actually requested", () => {
    // server/auth/config.ts sets no custom `authorization`, so GoogleProvider
    // requests exactly these. If a scope is ever added there, this fails and
    // the notice has to be updated with it — which is the point.
    for (const scope of ["openid", "email", "profile"]) {
      expect(source()).toContain(scope);
    }
  });

  it("says what is stored, including the tokens", () => {
    // The adapter's linkAccount writes access and refresh tokens to
    // OAuthAccount. Describing the name and picture but quietly omitting the
    // tokens would be the convenient half of the truth.
    const text = source();
    expect(text).toMatch(/refresh token/i);
    expect(text).toMatch(/profile picture/i);
  });

  it("states plainly what is NOT accessed", () => {
    // The question a reader actually has.
    const text = source();
    for (const service of ["Gmail", "Drive", "Calendar", "Contacts"]) {
      expect(text).toContain(service);
    }
  });

  it("promises the data is not sold, shared, or used for advertising", () => {
    expect(source()).toMatch(/advertising/i);
    expect(source()).toMatch(/sold/i);
  });

  it("tells staff how to disconnect", () => {
    expect(source()).toMatch(/disconnect/i);
  });
});

describe("both pages address staff as well as clients", () => {
  it("the privacy notice has a staff section", () => {
    // It used to describe only client request submission, which is the smaller
    // half of who uses this platform.
    expect(read(PRIVACY)).toMatch(/if you are ethree10 staff/i);
  });

  it("the terms cover staff access", () => {
    expect(read(TERMS)).toMatch(/staff access/i);
  });

  it("both carry a last-updated date", () => {
    // A legal page with no date cannot be reasoned about.
    for (const file of [PRIVACY, TERMS]) {
      expect(read(file)).toMatch(/Last updated \d{1,2} \w+ \d{4}/);
    }
  });
});
