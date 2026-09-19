import type { Metadata } from "next";
import Link from "next/link";
import { E310Logo } from "@/components/brand/e310-logo";

export const metadata: Metadata = {
  title: "Check your email",
};

export default function MagicLinkSentPage() {
  return (
    <div className="w-full max-w-sm space-y-6 text-center">
      {/*
        This was a hardcoded heading with the product name misspelled — a
        typo, not a second brand. Every other surface renders the wordmark
        through this component, so the one page a user lands on mid-sign-in
        was the one page showing a different name than the page they came
        from, at the exact moment they are deciding whether to trust the link
        in their inbox.
      */}
      <E310Logo variant="dark" className="mx-auto h-8 w-auto" />

      <div className="rounded-lg border bg-card p-8 shadow-sm">
        <div className="mb-4 flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100">
            <svg
              className="h-6 w-6 text-brand-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
        </div>

        <h2 className="text-xl font-semibold">Check your email</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A sign-in link has been sent to your email address. Click it to
          access your account.
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          {/* config.ts sets the email provider's maxAge to 15 * 60. This said 24
              hours, so anyone who came back to it later was told a dead link
              was still good — and then blamed the platform when it failed. */}
          The link expires in 15 minutes. If you do not see it, check your spam
          folder.
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        Wrong email?{" "}
        <Link href="/login" className="font-medium text-brand-500 hover:underline">
          Try again
        </Link>
      </p>
    </div>
  );
}
