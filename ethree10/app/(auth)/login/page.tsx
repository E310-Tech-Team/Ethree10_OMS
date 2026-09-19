import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { LoginForm } from "./login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { E310Logo } from "@/components/brand/e310-logo";
import { AnimatedPage, AnimatedSection } from "@/components/ui-ext/animated";

export const metadata: Metadata = {
  title: "Sign In",
};

/**
 * `searchParams` is read here, in the server component, rather than with
 * useSearchParams() in the form. Reading it in a client component opts the
 * whole subtree into a Suspense boundary at build time; taking it as a prop
 * keeps the page static-shell-friendly and the form a plain component.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  // Auth.js sends one code; a repeated query param would arrive as an array.
  const errorCode = Array.isArray(error) ? error[0] : error;
  return (
    <AnimatedPage className="w-full max-w-md">
      <div className="space-y-6">
        <AnimatedSection className="text-center" delay={40}>
          <Badge variant="secondary" className="mb-3 inline-flex gap-1 px-3 py-1 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" />
            Secure staff access
          </Badge>
          <E310Logo variant="dark" className="mx-auto h-8 w-auto" />
          <p className="mt-2 text-sm text-muted-foreground">
            The all-in-one operating platform
          </p>
        </AnimatedSection>

        <AnimatedSection delay={120}>
          <Card className="surface-hover border-border/60 shadow-sm">
            <CardHeader className="space-y-2">
              <CardTitle className="text-2xl">Sign in</CardTitle>
              <CardDescription>
                Enter your email to receive a magic link, or continue with Google.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LoginForm errorCode={errorCode ?? null} />
            </CardContent>
          </Card>
        </AnimatedSection>
      </div>
    </AnimatedPage>
  );
}
