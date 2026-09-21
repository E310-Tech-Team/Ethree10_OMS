import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { TRPCProvider } from "@/components/providers/trpc-provider";
import { PostHogProvider } from "@/components/providers/posthog-provider";
import { Toaster } from "@/components/ui/toaster";
import "@/app/globals.css";

// Poppins — rounded, geometric, modern. Self-hosted so boot is fast and
// offline-safe (no Google fetch at build time, which stalls dev here).
const poppins = localFont({
  src: [
    { path: "./fonts/Poppins-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Poppins-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Poppins-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Poppins-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "E310 — Operating Platform",
    template: "%s · E310",
  },
  description:
    "E310 — the all-in-one operating platform. Manage requests, track delivery, and report performance across your teams.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    // iOS ignores the manifest's icons entirely and reads this instead. Without
    // it, "Add to Home Screen" renders a screenshot of the page as the icon.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "E310",
    // The status bar sits over the app's own header, so it is translucent and
    // the header's padding accounts for the inset (see globals.css).
    statusBarStyle: "black-translucent",
  },
  applicationName: "E310",
  formatDetection: {
    // Codes like TSK-2026-00001 were being linkified as phone numbers on iOS.
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#031629",
  // `viewport-fit=cover` lets the app paint into the display cutout area on
  // notched phones; the safe-area insets in globals.css keep content clear of
  // it. Without cover, a standalone install shows letterbox bars.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // Deliberately not maximumScale/userScalable: locking zoom on a tool people
  // read dense tables in is an accessibility failure, not a polish detail.
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${poppins.variable} font-sans antialiased`}>
        <PostHogProvider>
          <TRPCProvider>{children}</TRPCProvider>
        </PostHogProvider>
        <Toaster />
        {/*
          Was an inline script. Inline scripts are why script-src still needs
          'unsafe-inline'; this was the only one of the three on a page that was
          ours to move. See lib/csp.mjs.
        */}
        <script src="/sw-register.js" defer />
      </body>
    </html>
  );
}
