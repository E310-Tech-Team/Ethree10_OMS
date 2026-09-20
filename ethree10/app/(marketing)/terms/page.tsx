import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "The terms on which clients submit work to Ethree10 and staff use the operating platform.",
};

/**
 * Two audiences, said separately — see the note in the privacy page.
 *
 * The staff section exists because the platform is now entered by signing in
 * with a Google account, and terms that only describe submitting a client
 * request say nothing about the conditions of that access.
 */
export default function TermsPage() {
  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-16">
      <div className="space-y-2">
        <h1 className="text-4xl font-semibold">Terms of service</h1>
        <p className="text-sm text-muted-foreground">Last updated 20 September 2026</p>
      </div>

      <p>
        Ethree10 OMS is the operating platform of Ethree10, a Reach4Christ Global initiative. These
        terms cover both submitting work to us and using the platform as a member of staff.
      </p>

      <h2 className="text-2xl font-semibold">Submitting a request</h2>
      <p>
        Submitting a request asks Ethree10 to assess the work; it does not itself create a final
        commercial commitment. Scope, timing, acceptance criteria, and applicable fees are
        confirmed through the request and proposal process.
      </p>

      <h2 className="text-2xl font-semibold">Acceptable use</h2>
      <p>
        Do not submit unlawful, malicious, infringing, or unauthorised materials. You confirm that
        Ethree10 may use supplied information and assets to evaluate and deliver the requested
        work.
      </p>

      <h2 className="text-2xl font-semibold">Delivery and acceptance</h2>
      <p>
        Delivered work can be accepted or returned with a clear change request through the secure
        tracking link. Acceptance closes the operational project record.
      </p>

      <h2 className="text-2xl font-semibold">Tracking links</h2>
      <p>
        A tracking link is a credential. Keep it to the people who need it, and tell us if it
        should be rotated or revoked.
      </p>

      <h2 className="text-2xl font-semibold">Staff access</h2>
      <p>
        Accounts are issued to Ethree10 staff for agency work and are personal to the holder. Do
        not share your account or sign-in credentials. What you can see and do is governed by your
        role, and attempting to reach records outside it is a misuse of access.
      </p>
      <p>
        You may sign in with an emailed link or with a Google account. Where you use Google, your
        use of that account also remains subject to Google&rsquo;s own terms. Access is withdrawn
        when you leave, and activity in the platform is recorded in an audit trail.
      </p>

      <h2 className="text-2xl font-semibold">Availability</h2>
      <p>
        We maintain the platform actively but do not guarantee uninterrupted availability.
        Maintenance and incidents may interrupt access.
      </p>

      <h2 className="text-2xl font-semibold">Changes and contact</h2>
      <p>
        These terms may be updated; the date above shows when they last were. For questions, use
        the{" "}
        <Link href="/contact" className="underline underline-offset-4">
          contact page
        </Link>
        . See also our{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          privacy notice
        </Link>
        .
      </p>
    </main>
  );
}
