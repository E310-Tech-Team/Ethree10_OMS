/**
 * Turning an Auth.js error code into something a person can act on.
 *
 * `pages.error` is set to "/login", so every failed sign-in lands back on the
 * login page with `?error=<code>` in the URL — and the login page never read
 * it. The user was returned to a clean form with no indication that anything
 * had gone wrong, which is indistinguishable from having mistyped something.
 * QA reported it as "Google sign-in returns to login and does not explain".
 *
 * Two rules in the messages below:
 *
 *   - Say whether this is the user's problem or ours. "Ask an administrator"
 *     and "try again" are different instructions, and guessing wrong wastes
 *     either their time or the support desk's.
 *   - Never blame the user for our configuration. `Configuration` and
 *     `OAuthSignin` mean the server is set up wrong; telling someone to check
 *     their password would send them in a circle.
 */

export type AuthErrorCopy = {
  /** Short, plain, and specific about what failed. */
  message: string;
  /** True when retrying might work. False when a human has to change something. */
  retryable: boolean;
};

const MESSAGES: Record<string, AuthErrorCopy> = {
  // Thrown before the request ever leaves us: a provider is missing its
  // credentials. Production hit exactly this — the Google button was rendered
  // from a provider constructed with an empty client id, so every click failed
  // here and never reached Google.
  Configuration: {
    message:
      "Sign-in is not fully configured on the server. Please contact an administrator — retrying will not help.",
    retryable: false,
  },
  OAuthSignin: {
    message:
      "We could not start the Google sign-in. This is a server configuration problem, not something you did — please contact an administrator.",
    retryable: false,
  },
  // These happen after Google has been reached, so the round trip half-worked.
  OAuthCallback: {
    message: "Google sign-in did not complete. Please try again.",
    retryable: true,
  },
  OAuthCreateAccount: {
    message: "We could not create your account from your Google profile. Please contact an administrator.",
    retryable: false,
  },
  Callback: {
    message: "Sign-in did not complete. Please try again.",
    retryable: true,
  },
  // The address is already here under a different sign-in method. Telling the
  // user to "try again" would loop them forever; the way out is the method
  // they originally used.
  OAuthAccountNotLinked: {
    message:
      "That email is already registered with a different sign-in method. Use the magic link instead, with the same address.",
    retryable: false,
  },
  EmailCreateAccount: {
    message: "We could not create your account. Please contact an administrator.",
    retryable: false,
  },
  EmailSignin: {
    message: "We could not send the magic link. Check the address and try again.",
    retryable: true,
  },
  // A magic link that is expired or already used. Links last 15 minutes and are
  // single-use, so this is the ordinary case of opening an old email.
  Verification: {
    message: "That magic link has expired or has already been used. Request a new one below.",
    retryable: true,
  },
  CredentialsSignin: {
    message: "Those sign-in details were not accepted.",
    retryable: true,
  },
  // Not a failure: a protected page asked for a session that was not there.
  SessionRequired: {
    message: "Please sign in to continue.",
    retryable: true,
  },
  AccessDenied: {
    message:
      "That account does not have access. If you believe it should, ask an administrator to invite it.",
    retryable: false,
  },
};

const FALLBACK: AuthErrorCopy = {
  message: "Sign-in failed. Please try again, or contact an administrator if it keeps happening.",
  retryable: true,
};

/**
 * Auth.js sends codes we do not enumerate (and adds new ones between versions),
 * so an unknown code must still produce a message. Returning null for anything
 * unrecognised would reproduce the silent failure this exists to fix.
 */
export function authErrorCopy(code: string | null | undefined): AuthErrorCopy | null {
  if (!code) return null;
  return MESSAGES[code] ?? FALLBACK;
}
