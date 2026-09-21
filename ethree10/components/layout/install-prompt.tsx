"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The install button, shown only when the browser says an install is possible.
 *
 * `beforeinstallprompt` fires once, and only when the browser's own criteria
 * are met (manifest, service worker, https, not already installed). It must be
 * captured and preventDefault()-ed, or Chrome shows its own mini-infobar and
 * the saved event becomes unusable.
 *
 * There is no manual fallback button. A button that cannot install anything —
 * because the browser never fired the event, or the app is already installed —
 * is worse than no button; iOS in particular has no programmatic install at
 * all, which is why Safari users are told to use Share → Add to Home Screen in
 * the settings copy rather than given a control that does nothing.
 */
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "e310:install-dismissed";

/** Has this user waved the offer away before? */
function previouslyDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // Private mode, or site data blocked. Showing the offer is the safe
    // default — worst case they dismiss it again.
    return false;
  }
}

export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // preventDefault is required, or Chrome shows its own mini-infobar and
      // the saved event becomes unusable.
      e.preventDefault();
      // Checked here rather than in the effect body: reading storage and
      // setting state synchronously in an effect causes a cascading render,
      // and this is the only moment the answer actually matters.
      if (previouslyDismissed()) return;
      setEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // Once installed the event will never fire again; clear any stale offer.
    const onInstalled = () => setEvent(null);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    // The event is single-use whatever the outcome.
    setEvent(null);
  }, [event]);

  const dismiss = useCallback(() => {
    setEvent(null);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Not worth surfacing: the offer just returns next visit.
    }
  }, []);

  if (!event) return null;

  return (
    <div className="glass fixed inset-x-4 bottom-4 z-40 flex items-center gap-3 rounded-xl p-3 pb-safe shadow-pop sm:left-auto sm:right-6 sm:w-80">
      <Download className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Install E310</p>
        <p className="text-xs text-muted-foreground">
          Opens like an app and works offline.
        </p>
      </div>
      <Button type="button" size="sm" onClick={() => void install()}>
        Install
      </Button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
