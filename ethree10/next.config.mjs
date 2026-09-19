import { contentSecurityPolicy, reportingEndpoints } from "./lib/csp.mjs";

export const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), usb=(), bluetooth=(), payment=(self)",
  },
  // Names the endpoint group used by `report-to` in the policy itself. Without
  // this header the modern reporting mechanism has nowhere to send anything,
  // which is half of why nothing was being collected.
  {
    key: "Reporting-Endpoints",
    value: reportingEndpoints(),
  },
  // Still Report-Only. The point of this change is to start collecting
  // evidence; enforcing without it is how you break a live journey to fix a
  // problem you have not measured.
  {
    key: "Content-Security-Policy-Report-Only",
    value: contentSecurityPolicy(),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build output location. Overridable so a deploy can build into a staging
  // directory and swap it in only once the build has succeeded — see
  // scripts/build-atomic.mjs. Unset everywhere else, so this is `.next` for
  // local development and for `next start`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  serverExternalPackages: ["@prisma/client", "bcryptjs", "@react-pdf/renderer"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
