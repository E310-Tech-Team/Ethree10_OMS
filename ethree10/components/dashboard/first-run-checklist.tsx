"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * "Ready to use" setup checklist for agency admins. Self-hides once setup is complete or when
 * the caller isn't an admin (the query is admin-gated server-side). Pass `enabled` to skip the
 * query entirely for non-admin dashboards.
 */
export function FirstRunChecklist({ enabled }: { enabled: boolean }) {
  const { data } = trpc.setup.checklist.useQuery(undefined, {
    enabled,
    retry: false,
  });

  if (!data || data.complete) return null;

  const doneCount = data.steps.filter((s) => s.done).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Finish setting up your agency</CardTitle>
        <CardDescription>
          {doneCount} of {data.steps.length} done — a few steps to get fully up and running.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.steps.map((step) => (
          <Link
            key={step.key}
            href={step.href}
            className="surface-hover flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"
          >
            <div className="flex items-center gap-3">
              {step.done ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
              ) : (
                <Circle className="h-5 w-5 shrink-0 text-muted-foreground/50" />
              )}
              <div>
                <p className={step.done ? "font-medium text-muted-foreground line-through" : "font-medium"}>
                  {step.label}
                </p>
                {!step.done && <p className="text-xs text-muted-foreground">{step.hint}</p>}
              </div>
            </div>
            {!step.done && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
