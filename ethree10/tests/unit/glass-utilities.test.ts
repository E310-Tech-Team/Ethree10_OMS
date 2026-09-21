import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * A utility class must not set `position` as a side effect of wanting a
 * decoration.
 *
 * `.glass` declared `position: relative` so an absolutely-positioned `::before`
 * could draw its specular edge. Because these utilities are emitted after
 * Tailwind's, that `relative` silently overrode `.fixed` on every element
 * carrying both — and two did:
 *
 *   - DialogContent, which gets `fixed left-1/2 top-1/2` from a class, so every
 *     dialog rendered inline in the page instead of centred over it.
 *   - The install prompt, which fell into normal flow and added page height,
 *     leaving a long scroll into empty space below the app shell.
 *
 * Radix's popover, dropdown and select were unaffected only by luck: they set
 * position through an inline style, which beats any class.
 *
 * The edge is an inset box-shadow now. These assertions are about the property
 * being absent, which is not visible in a screenshot and not covered by
 * anything else.
 */
const css = () => readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

/** The body of a single top-level rule, by selector. */
function block(selector: string): string {
  const source = css();
  const start = source.indexOf(`  ${selector} {`);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  return source.slice(start, source.indexOf("\n  }", start));
}

describe("glass surfaces never touch positioning", () => {
  it.each([".glass", ".glass-raised", ".glass-inset", ".sidebar-surface"])(
    "%s declares no position",
    (selector) => {
      expect(block(selector)).not.toMatch(/^\s*position\s*:/m);
    },
  );

  it("draws the specular edge without a positioned pseudo-element", () => {
    // ::before with position:absolute is what required position:relative.
    expect(css()).not.toContain(".glass::before");
    expect(block(".glass")).toContain("inset 0 1px 0");
  });

  it("keeps the edge on the raised variant", () => {
    // glass-raised overrides box-shadow wholesale, so the lip has to be
    // restated or floating panels lose it.
    expect(block(".glass-raised")).toContain("inset 0 1px 0");
  });

  it("still declares elevation exactly once, via shadow", () => {
    const glass = block(".glass");
    expect(glass).toContain("var(--glass-shadow)");
    // A hairline border is the light edge, not the elevation.
    expect(glass).toContain("border: 1px solid");
  });
});

describe("the components that depend on their own positioning", () => {
  it("DialogContent still asks for fixed", () => {
    // If this ever stops being a class-provided `fixed`, the interaction with
    // utility ordering above needs rechecking.
    const dialog = readFileSync(join(process.cwd(), "components/ui/dialog.tsx"), "utf8");
    expect(dialog).toContain("fixed left-1/2 top-1/2");
    expect(dialog).toContain("glass");
  });

  it("the install prompt still asks for fixed", () => {
    const prompt = readFileSync(
      join(process.cwd(), "components/layout/install-prompt.tsx"),
      "utf8",
    );
    expect(prompt).toContain("fixed");
    expect(prompt).toContain("glass");
  });
});
