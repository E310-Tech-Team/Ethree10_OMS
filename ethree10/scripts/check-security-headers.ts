const requiredHeaders = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": ["camera=()", "microphone=()", "geolocation=()"],
  // The reporting directives are checked because their absence is invisible:
  // a Report-Only policy with nowhere to report looks identical to a working
  // one from the outside, and that is exactly how this shipped for months.
  "content-security-policy-report-only": [
    "default-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "report-uri /api/csp-report",
    "report-to csp",
  ],
  // The group name and the path, not the whole literal. The URL is absolute
  // when NEXT_PUBLIC_APP_URL is set and relative when it is not, so pinning the
  // exact string asserted the development shape and failed against the correct
  // production one — which is what it did on first deploy.
  "reporting-endpoints": ["csp=", "/api/csp-report"],
} as const;

export {};

function baseUrl() {
  return (
    process.env["SECURITY_HEADERS_BASE_URL"] ??
    process.env["SMOKE_BASE_URL"] ??
    process.env["NEXT_PUBLIC_APP_URL"] ??
    process.env["NEXTAUTH_URL"] ??
    "http://127.0.0.1:3000"
  ).replace(/\/$/, "");
}

function headerIncludes(actual: string | null, expected: string | readonly string[]) {
  if (!actual) return false;
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  return expectedValues.every((value) => actual.includes(value));
}

async function main() {
  const url = `${baseUrl()}/api/health?mode=live`;
  const response = await fetch(url, { headers: { accept: "application/json" } });

  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}`);
  }

  const missing = Object.entries(requiredHeaders)
    .filter(([name, expected]) => !headerIncludes(response.headers.get(name), expected))
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing or invalid security headers at ${url}: ${missing.join(", ")}`);
  }

  console.log(`PASS security headers at ${url}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
