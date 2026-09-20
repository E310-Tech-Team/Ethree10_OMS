import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy notice",
  description:
    "What Ethree10 collects from clients and staff, what it is used for, and how long it is kept.",
};

/**
 * Two audiences, said separately.
 *
 * This page used to address only clients submitting requests — tracking links,
 * briefs, deliverables — because that was the only way in. Staff now sign in
 * with Google, which means personal data arrives from a third party, and a
 * privacy notice that does not mention the sign-in method is incomplete
 * regardless of who is asking.
 *
 * The Google section is also what Google's own OAuth consent screen review
 * looks for. It is written from what the code actually does: the scopes in
 * server/auth/config.ts and the fields the adapter writes to User and
 * OAuthAccount. Do not describe data here that is not stored, and do not omit
 * data that is — the tokens in particular.
 */
export default function PrivacyPage() {
  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-16">
      <div className="space-y-2">
        <h1 className="text-4xl font-semibold">Privacy notice</h1>
        <p className="text-sm text-muted-foreground">Last updated 20 September 2026</p>
      </div>

      <p>
        Ethree10 OMS is the operating platform of Ethree10, a Reach4Christ Global initiative. It
        serves two groups of people: clients who ask us to do work, and Ethree10 staff who deliver
        it. What we hold about each is different, so they are described separately below.
      </p>

      <h2 className="text-2xl font-semibold">If you are a client</h2>
      <p>
        We collect the organisation, contact details, brief, files, and delivery communications
        needed to assess and complete your service request. This is information you give us, either
        through the request form or during the work itself.
      </p>

      <h3 className="text-xl font-semibold">Your tracking link</h3>
      <p>
        Your tracking link is a private access credential. Anyone holding it can view the
        client-safe status, public messages, and approved deliverables for that request. Do not
        publish or forward it unnecessarily. Contact us if it should be rotated or revoked.
      </p>

      <h3 className="text-xl font-semibold">What you cannot see, and neither can outsiders</h3>
      <p>
        Budgets, internal notes, audit records, staff discussions, and private files are never
        exposed through a tracking link.
      </p>

      <h2 className="text-2xl font-semibold">If you are Ethree10 staff</h2>
      <p>
        Staff accounts hold your name, work email address, and optionally a phone number, time
        zone, and profile picture. The platform records what you do in it — requests you move,
        tasks you are assigned, hours you log, approvals you give — because an operating record
        that cannot say who did what is not an operating record.
      </p>

      <h3 className="text-xl font-semibold">Signing in with Google</h3>
      <p>
        You can sign in with a Google account instead of an emailed link. When you do, we ask
        Google for three things and nothing else: confirmation of who you are, your email address,
        and your basic profile (your name and profile picture). In Google&rsquo;s terms these are
        the <code className="rounded bg-muted px-1 py-0.5 text-sm">openid</code>,{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-sm">email</code> and{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-sm">profile</code> scopes.
      </p>
      <p>
        We store your email address, name, and profile picture URL against your staff account, plus
        the access and refresh tokens Google issues so that the sign-in can be completed and
        renewed. Those tokens are held only for authentication.
      </p>
      <p>
        <strong>
          We do not request or receive access to your Gmail, Drive, Calendar, Contacts, or any
          other Google service.
        </strong>{" "}
        Nothing obtained from Google is used for advertising, sold, or shared with third parties.
        You can disconnect Ethree10 from your Google account at any time through your Google
        account&rsquo;s security settings; you will then sign in by emailed link instead.
      </p>

      <h2 className="text-2xl font-semibold">How long we keep things</h2>
      <p>
        Operational records are retained for delivery documentation, reporting, security, and legal
        obligations. Audit records stay searchable in the platform for 24 months and are then moved
        to an archive kept for compliance and investigation. Staff accounts are deactivated rather
        than erased when someone leaves, so that the history of work they did remains attributable.
      </p>

      <h2 className="text-2xl font-semibold">Where your data is held</h2>
      <p>
        Data is stored on servers we operate, along with the services needed to run the platform:
        email delivery, payment processing, and error reporting. These process data on our
        instructions and for no purpose of their own.
      </p>

      <h2 className="text-2xl font-semibold">Contact</h2>
      <p>
        To ask what we hold about you, to have it corrected, or to request deletion where
        applicable, use the{" "}
        <Link href="/contact" className="underline underline-offset-4">
          contact page
        </Link>
        . See also our{" "}
        <Link href="/terms" className="underline underline-offset-4">
          terms of service
        </Link>
        .
      </p>
    </main>
  );
}
