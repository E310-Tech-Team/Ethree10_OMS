/**
 * What the Content Security Policy would have blocked.
 *
 * The policy runs in Report-Only mode and posts violations to /api/csp-report,
 * which logs them. This reads that log back and answers the only question that
 * matters before enforcing: what breaks if we turn it on?
 *
 * Read-only. It opens log files and prints. Nothing here writes, restarts or
 * changes anything.
 *
 *   pnpm csp:violations
 *
 * The URLs in the output are already redacted at the point of logging — see
 * sanitizeUrl in lib/csp-report.ts. Three of this app's routes carry a bearer
 * token in the path (/track, /invoice, /receipt), so the raw document URL of a
 * violation is a credential and never reaches the log, let alone this report.
 */
import { existsSync, readFileSync, statSync } from "fs";
import { parseViolationLog, groupViolations } from "../lib/csp-log";

/**
 * The live log and the most recent rotated one.
 *
 * Reading only the live file means a rotation an hour before the report is run
 * shows an empty result and reads as "no violations" — the most misleading
 * possible answer for a report whose whole purpose is deciding what is safe.
 */
const DEFAULT_LOGS = ["/var/log/ethree10/web.log", "/var/log/ethree10/web.log.1"];

function logFiles(): string[] {
  const override = process.env["CSP_LOG_FILE"];
  return override ? override.split(",").map((path) => path.trim()) : DEFAULT_LOGS;
}

function main() {
  const files = logFiles();
  const present: string[] = [];
  let contents = "";

  for (const file of files) {
    if (!existsSync(file)) continue;
    present.push(`${file} (${(statSync(file).size / 1024).toFixed(0)} KB)`);
    contents += readFileSync(file, "utf8");
  }

  console.log("CSP VIOLATION REPORT\n");

  if (present.length === 0) {
    // Distinguished from "no violations" on purpose. A missing log means the
    // report could not look, which is not the same as having looked and found
    // nothing — and quietly conflating them is how a policy gets enforced on
    // the strength of a report that never read anything.
    console.log("  NO LOG FILE FOUND. Looked in:");
    for (const file of files) console.log(`    ${file}`);
    console.log("\n  This is not the same as 'no violations'. Nothing was read.");
    console.log("  Check the path with: supervisorctl status ethree10-web");
    process.exitCode = 1;
    return;
  }

  console.log("  Read:");
  for (const file of present) console.log(`    ${file}`);

  const violations = parseViolationLog(contents);
  const groups = groupViolations(violations);

  console.log(`\n  ${violations.length} violations, ${groups.length} distinct causes\n`);

  if (violations.length === 0) {
    console.log("  Nothing was reported.\n");
    console.log("  Either the policy is clean, or reports are not arriving. Before");
    console.log("  reading this as clean, confirm delivery: Chrome sends reports");
    console.log("  out-of-band to the URL in the Reporting-Endpoints header, and");
    console.log("  ignores report-uri entirely whenever report-to is present, so a");
    console.log("  malformed report-to means Chrome sends nothing at all.");
    return;
  }

  console.log("BY CAUSE (commonest first)\n");
  for (const group of groups) {
    console.log(`  ${group.count}x  ${group.directive}  <-  ${group.blocked}`);
    for (const document of group.documents) console.log(`         on ${document}`);
    if (group.totalDocuments > group.documents.length) {
      console.log(`         ...and ${group.totalDocuments - group.documents.length} more pages`);
    }
    console.log();
  }

  // The two values that decide whether the nonce migration is still required.
  const inline = groups.filter((group) => group.blocked === "inline");
  const evals = groups.filter((group) => group.blocked === "eval");

  console.log("WHAT THIS MEANS FOR ENFORCING\n");
  if (evals.length > 0) {
    console.log(`  'unsafe-eval' is still in use (${evals.reduce((n, g) => n + g.count, 0)} times).`);
    console.log("  It was removed from the production policy after measuring zero");
    console.log("  eval in the built output. If these are from production rather");
    console.log("  than a dev machine, that measurement was wrong and needs redoing.\n");
  } else {
    console.log("  No eval violations. Removing 'unsafe-eval' holds.\n");
  }

  if (inline.length > 0) {
    console.log(`  Inline script still blocked ${inline.reduce((n, g) => n + g.count, 0)} times,`);
    console.log("  so 'unsafe-inline' cannot be dropped yet. Most of these will be");
    console.log("  Next's own RSC payload scripts, which need a per-request nonce");
    console.log("  from middleware rather than a code change.\n");
  } else {
    console.log("  No inline-script violations — worth checking whether the nonce");
    console.log("  migration is still needed.\n");
  }

  console.log("  Everything else above is either a source to add to the policy or");
  console.log("  a script to remove from the app. Decide each one, then enforce.");
}

main();
