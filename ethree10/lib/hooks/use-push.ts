"use client";

import { useCallback, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc/client";

/**
 * Subscribing this browser to push.
 *
 * The states here are not decoration. Push has several distinct ways of being
 * unavailable and they need different words in front of a user:
 *
 *   unsupported  — no service worker or PushManager (older Safari, some in-app
 *                  browsers). Nothing the user can do.
 *   unconfigured — the server has no VAPID keys. Nothing the USER can do, but
 *                  an administrator can; saying "denied" here would send them
 *                  to browser settings to fix something that is not their end.
 *   denied       — the user refused the prompt. This is the one that cannot be
 *                  recovered in-page: once denied, requestPermission() returns
 *                  "denied" without prompting, so telling someone to "click
 *                  allow" is a dead end. They must change it in site settings.
 *   default      — never asked. The only state where a prompt will appear.
 *   granted      — permission held; may or may not be subscribed here.
 */
export type PushState =
  | "loading"
  | "unsupported"
  | "unconfigured"
  | "denied"
  | "default"
  | "granted";

/**
 * VAPID keys are base64url. Returns an ArrayBuffer rather than a Uint8Array
 * because `applicationServerKey` wants a BufferSource, and a Uint8Array view
 * over a possibly-shared buffer does not satisfy it.
 */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const [subscribedHere, setSubscribedHere] = useState(false);
  const [busy, setBusy] = useState(false);

  const config = trpc.push.config.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const subscribe = trpc.push.subscribe.useMutation();
  const unsubscribe = trpc.push.unsubscribe.useMutation();

  const configData = config.data;

  /**
   * Read the browser's own state rather than trusting our record of it: a user
   * can revoke permission or clear site data at any time and the database would
   * still say they are subscribed.
   */
  const read = useCallback(async () => {
    if (!supported()) return { state: "unsupported" as PushState, here: false };
    if (!configData) return null;
    if (!configData.enabled || !configData.publicKey) {
      return { state: "unconfigured" as PushState, here: false };
    }
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const permission = Notification.permission;
    return {
      state: (permission === "granted"
        ? "granted"
        : permission === "denied"
          ? "denied"
          : "default") as PushState,
      here: Boolean(existing),
    };
  }, [configData]);

  useEffect(() => {
    let cancelled = false;
    // Async on purpose: setting state synchronously in an effect body triggers
    // a cascading render, and every branch here needs an await anyway.
    void (async () => {
      const result = await read();
      if (cancelled || !result) return;
      setState(result.state);
      setSubscribedHere(result.here);
    })();
    return () => {
      cancelled = true;
    };
  }, [read]);

  const enable = useCallback(async () => {
    if (!supported() || !configData?.publicKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "default");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      // Reuse an existing subscription rather than creating a second one: the
      // browser returns the same endpoint anyway, and subscribing again with a
      // different key throws.
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          // Required by Chrome: a push that shows no notification is not
          // allowed, and silent pushes are what got this API abused.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBuffer(configData.publicKey),
        }));

      const json = subscription.toJSON();
      if (!json.keys?.p256dh || !json.keys?.auth) return;

      await subscribe.mutateAsync({
        endpoint: subscription.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        userAgent: navigator.userAgent.slice(0, 400),
      });
      setSubscribedHere(true);
      setState("granted");
    } finally {
      setBusy(false);
    }
  }, [configData, subscribe]);

  const disable = useCallback(async () => {
    if (!supported()) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        // Server first. Unsubscribing locally and then failing the call leaves
        // a row the server keeps posting to forever.
        await unsubscribe.mutateAsync({ endpoint: existing.endpoint });
        await existing.unsubscribe();
      }
      setSubscribedHere(false);
    } finally {
      setBusy(false);
    }
  }, [unsubscribe]);

  return { state, subscribedHere, busy, enable, disable };
}
