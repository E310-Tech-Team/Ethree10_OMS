import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * react-pdf must load the way the worker loads it: under tsx, as CommonJS
 * (`pnpm worker` is `tsx workers/index.ts`, and the worker renders reports).
 *
 * @react-pdf/textkit 6.4.2 started depending on @react-pdf/hyphenate, which is
 * ESM-only — its package exports offer an `import` condition and nothing
 * else. Under tsx that is ERR_PACKAGE_PATH_NOT_EXPORTED the moment react-pdf
 * is imported, so the worker cannot start: no reports, no overdue-invoice
 * runs, no reminders. `next build`, plain `node`, and this test runner all
 * load it without complaint, which is how a dependency bump carrying it went
 * green everywhere it was checked.
 *
 * So this renders a document in a separate tsx process, from a file inside the
 * project so it resolves the project's own node_modules. Nothing else here sees
 * what the worker sees. pnpm-workspace.yaml holds the versions it protects.
 */
const probe = join(process.cwd(), `.react-pdf-probe-${process.pid}.ts`);

describe("react-pdf as the worker loads it", () => {
  afterAll(() => rmSync(probe, { force: true }));

  it("renders a PDF under tsx", () => {
    writeFileSync(
      probe,
      `import { renderToBuffer, Document, Page, Text } from "@react-pdf/renderer";
import React from "react";
renderToBuffer(React.createElement(Document, null, React.createElement(Page, null,
  React.createElement(Text, null, "Hyphenation: internationalisation, institutionalisation."))))
  .then((buf) => process.stdout.write(buf.subarray(0, 5).toString()))
  .catch((e) => { process.stderr.write(String(e?.code ?? e?.message ?? e)); process.exit(1); });
`,
    );
    const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
    const out = execFileSync(tsx, [probe], { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 });
    expect(out).toBe("%PDF-");
  }, 70_000);
});
