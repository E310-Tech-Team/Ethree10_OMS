export const dynamic = "force-dynamic";

import Link from "next/link";
import { ClientMarketingNav } from "@/components/ClientMarketingNav";
import { E310Logo } from "@/components/brand/e310-logo";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Sticky and frosted: the header is chrome, so it stays put and lets the
          page pass beneath it rather than scrolling away as another block. */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-glass-header backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6 sm:py-4">
          {/* Same brand mark as the app sidebar, with an "AGENCY" suffix in
              place of the sidebar's "OPS". Dark variant here because the
              marketing header sits on a light surface. */}
          <Link href="/" className="flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80">
            <E310Logo variant="dark" className="h-6 w-auto" />
            {/* Hidden on the narrowest screens: at 375px it collided with the
                nav, which neither element was allowed to shrink out of. */}
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:inline">
              Agency
            </span>
          </Link>
          <ClientMarketingNav />
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-border/60 bg-glass-header backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <E310Logo variant="dark" className="h-5 w-auto" />
            <p className="text-xs text-muted-foreground">
              A Reach4Christ Global initiative. Excellence through People, Process, Product.
            </p>
          </div>
          <nav className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <Link href="/services" className="inline-flex min-h-[44px] items-center transition-colors hover:text-foreground lg:min-h-0">
              Services
            </Link>
            <Link href="/about" className="inline-flex min-h-[44px] items-center transition-colors hover:text-foreground lg:min-h-0">
              About
            </Link>
            <Link href="/request" className="inline-flex min-h-[44px] items-center transition-colors hover:text-foreground lg:min-h-0">
              Start a project
            </Link>
            <Link href="/login" className="inline-flex min-h-[44px] items-center transition-colors hover:text-foreground lg:min-h-0">
              Sign in
            </Link>
            {/*
              /privacy and /terms existed but were linked from nowhere at all —
              reachable only by typing the URL. A privacy notice nobody can find
              is not serving its purpose, and Google's OAuth consent screen
              review expects the policy to be reachable from the site itself.
            */}
            <Link href="/privacy" className="inline-flex min-h-[44px] items-center transition-colors hover:text-foreground lg:min-h-0">
              Privacy
            </Link>
            <Link href="/terms" className="inline-flex min-h-[44px] items-center transition-colors hover:text-foreground lg:min-h-0">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
