/**
 * Service worker registration.
 *
 * This was an inline <script> in the root layout. Inline scripts are the reason
 * `script-src` still carries 'unsafe-inline', so moving ours to a file removes
 * one of the three inline scripts on a page — the only one that was ours. The
 * other two are Next's own RSC payload scripts, which need a per-request nonce
 * rather than a move.
 *
 * Served from /public, so plain `script-src 'self'` covers it.
 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function (error) {
      // Registration failing is not fatal — it costs the offline page, not the
      // app. Previously both outcomes were logged, including a success message
      // on every single page load.
      console.warn("Service worker registration failed:", error);
    });
  });
}
