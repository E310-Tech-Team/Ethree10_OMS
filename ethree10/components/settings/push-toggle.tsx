"use client";

import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePush } from "@/lib/hooks/use-push";

/**
 * Turning push on for this browser.
 *
 * Each unavailable state gets its own sentence, because they are not the same
 * problem and sending someone to the wrong place is worse than saying nothing.
 * In particular, "denied" cannot be undone from here: once a user refuses the
 * prompt, requestPermission() returns "denied" without prompting again, so a
 * button offering to ask is a button that does nothing.
 */
export function PushToggle() {
  const { state, subscribedHere, busy, enable, disable } = usePush();

  if (state === "loading") {
    return <p className="text-sm text-muted-foreground">Checking this device…</p>;
  }

  if (state === "unsupported") {
    return (
      <p className="text-sm text-muted-foreground">
        This browser cannot receive push notifications. On iPhone, add E310 to your Home Screen
        first — Safari only allows them for installed apps.
      </p>
    );
  }

  if (state === "unconfigured") {
    return (
      <p className="text-sm text-muted-foreground">
        Push notifications are not configured on the server yet. This is an administrator setting,
        not something to change on your device.
      </p>
    );
  }

  if (state === "denied") {
    return (
      <p className="text-sm text-muted-foreground">
        Notifications are blocked for this site. Asking again will not prompt you — the browser
        remembers the refusal. Re-allow it in your browser&rsquo;s site settings for this page,
        then reload.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant={subscribedHere ? "outline" : "default"}
        disabled={busy}
        onClick={() => void (subscribedHere ? disable() : enable())}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : subscribedHere ? (
          <BellOff className="h-4 w-4" />
        ) : (
          <Bell className="h-4 w-4" />
        )}
        {subscribedHere ? "Turn off on this device" : "Turn on for this device"}
      </Button>
      <p className="text-sm text-muted-foreground">
        {subscribedHere
          ? "This device will receive notifications even when E310 is closed."
          : "Per device, not per account — turn it on anywhere you want to be reached."}
      </p>
    </div>
  );
}
