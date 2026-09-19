import type { Metadata } from "next";
import { E310Mark } from "@/components/brand/e310-logo";

/**
 * The page the service worker serves when a navigation cannot reach the network.
 *
 * It used to not exist. `sw.js` fell back to `/offline`, that route 404'd, and
 * the worker's own comment admitted it: "Don't precache offline url yet as it
 * doesn't exist, just an example". Losing connection showed a browser error.
 *
 * Two constraints shape what is on this page:
 *
 *   - It must render with **no network at all**. That rules out the PNG
 *     wordmark used elsewhere, which would be a second request that fails and
 *     leaves a broken image on the page you reach *because* the network is
 *     down. `E310Mark` is inline SVG, so it costs nothing.
 *   - It must be static, so the worker can precache it at install time. Hence
 *     `force-static` — a dynamic page cannot be put in the cache ahead of the
 *     outage it exists for.
 *
 * It also sits at the top level rather than under (app), so it is not behind
 * the authenticated layout. Someone whose connection dropped before signing in
 * should still get this rather than a redirect to a login page that cannot load.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "You are offline",
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-sm text-center">
        <E310Mark className="mx-auto h-10 w-10 text-brand-500" />

        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
          You are offline
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          E310 could not reach the network. Your connection dropped — nothing is
          wrong with your account or the platform.
        </p>

        <p className="mt-6 text-sm text-muted-foreground">
          Anything you had already opened may still work. Once you are back
          online, this page will reload on its own.
        </p>

        <button
          id="offline-retry"
          type="button"
          className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Try again
        </button>

        {/*
          Behaviour goes in an inline script, not a React handler, and the page
          stays a server component.

          A client component would need its hydration bundle to run, and that
          bundle is not in the offline cache — so the one page that must work
          without the network would have a dead button on it. Inline script is
          in the cached HTML itself and needs nothing else.

          The `online` listener means nobody has to sit and poll the button;
          the browser says when connectivity is back.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: [
              "addEventListener('online',function(){location.reload()});",
              "document.getElementById('offline-retry')",
              ".addEventListener('click',function(){location.reload()});",
            ].join(""),
          }}
        />

      </div>
    </main>
  );
}
