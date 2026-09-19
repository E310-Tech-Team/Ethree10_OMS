"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { authErrorCopy } from "@/lib/auth-errors";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, ArrowRight, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

const schema = z.object({
  email: z.string().email("Enter a valid email address."),
});

type FormValues = z.infer<typeof schema>;

/**
 * `errorCode` is whatever Auth.js put in `?error=` after bouncing the user
 * back here. It used to be ignored entirely, so a failed sign-in looked
 * exactly like arriving at the page fresh.
 */
export function LoginForm({ errorCode }: { errorCode: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [quickLoginLoading, setQuickLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(authErrorCopy(errorCode)?.message ?? null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [devDialogOpen, setDevDialogOpen] = useState(false);
  const [devEmail, setDevEmail] = useState("admin@ethree10.r4c.global");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: FormValues) {
    setLoading(true);
    setError(null);
    setConfirmation(null);

    try {
      // `redirect: false` so a failed send is visible. With the default
      // redirect the browser navigates to the "check your inbox" page whatever
      // happened, so an email that never left told the user to go and wait for
      // it — and the setConfirmation call below it could never run.
      const result = await signIn("email", {
        email: values.email,
        callbackUrl: "/dashboard",
        redirect: false,
      });

      if (result?.error) {
        setError(authErrorCopy(result.error)?.message ?? null);
        return;
      }

      setConfirmation(`Magic link sent to ${values.email}. Open your inbox to continue.`);
      router.push("/magic-link-sent");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    setError(null);
    setConfirmation(null);
    // Same reason: on failure Auth.js redirects back to /login?error=..., which
    // is now read on arrival, but handling it here as well means the message
    // appears without a round trip when the failure is immediate.
    const result = await signIn("google", { callbackUrl: "/dashboard", redirect: false });
    if (result?.error) {
      setError(authErrorCopy(result.error)?.message ?? null);
      return;
    }
    if (result?.url) router.push(result.url);
  }

  async function quickLogin() {
    setQuickLoginLoading(true);
    setError(null);
    setConfirmation(null);

    try {
      await signIn("credentials", {
        email: devEmail,
        callbackUrl: "/dashboard",
      });
      setDevDialogOpen(false);
    } catch {
      setError("Quick login failed. Check the seeded dev user email.");
    } finally {
      setQuickLoginLoading(false);
    }
  }

  return (
    <>
      <div className="space-y-5">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                className="h-11 pl-9"
                {...register("email")}
              />
            </div>
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {confirmation && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{confirmation}</span>
            </div>
          )}

          <Button type="submit" disabled={loading} className="h-11 w-full">
            {loading ? "Sending link..." : "Send magic link"}
            {!loading && <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>

        <div className="relative">
          <Separator />
          <div className="absolute inset-0 flex items-center justify-center">
            <Badge variant="secondary" className="bg-card px-2 uppercase tracking-[0.2em] text-[10px]">
              Or continue with
            </Badge>
          </div>
        </div>

        <Button type="button" variant="outline" onClick={signInWithGoogle} className="h-11 w-full">
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </Button>

        {(process.env.NODE_ENV === "development" ||
          process.env.NEXT_PUBLIC_E2E_TEST_AUTH === "true") && (
          <>
            <div className="relative">
              <Separator />
              <div className="absolute inset-0 flex items-center justify-center">
                <Badge variant="outline" className="bg-card px-2 uppercase tracking-[0.2em] text-[10px]">
                  Local dev
                </Badge>
              </div>
            </div>

            <Button
              type="button"
              variant="secondary"
              className="h-11 w-full border border-dashed border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
              onClick={() => setDevDialogOpen(true)}
            >
              Quick Login (Local Dev)
            </Button>
          </>
        )}
      </div>

      <Dialog open={devDialogOpen} onOpenChange={setDevDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quick login</DialogTitle>
            <DialogDescription>
              Use a seeded development account without opening a prompt dialog.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="dev-email">Seeded user email</Label>
            <Input
              id="dev-email"
              type="email"
              value={devEmail}
              onChange={(event) => setDevEmail(event.target.value)}
              placeholder="admin@ethree10.r4c.global"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDevDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={quickLogin} disabled={quickLoginLoading || !devEmail.trim()}>
              {quickLoginLoading ? "Signing in..." : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
