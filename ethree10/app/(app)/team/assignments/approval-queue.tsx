"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Check, X, UserCheck } from "lucide-react";

interface Rationale {
  chosen?: { name?: string; reason?: string };
  runnersUp?: Array<{ name: string; reason: string }>;
}

/** `rationale` is Json on the row, so it arrives untyped. */
function rationaleOf(value: unknown): Rationale | null {
  return value && typeof value === "object" ? (value as Rationale) : null;
}

/**
 * Assignments waiting on the branch head.
 *
 * These tasks are genuinely unassigned until decided — a proposal does not set
 * `assigneeUserId`, so nothing here is sitting in anyone's queue yet. That is
 * what makes the approval real rather than advisory, and it is also why this
 * queue should not be allowed to grow: work proposed and never decided is work
 * nobody is doing.
 */
export function ApprovalQueue() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const pending = trpc.tasks.pendingAssignments.useQuery();

  const invalidate = () => {
    void utils.tasks.pendingAssignments.invalidate();
    // Approving writes assigneeUserId, so anything showing who owns a task is
    // now stale — including the assignee's own queue.
    void utils.tasks.myTasks.invalidate();
    void utils.execution.assignments.invalidate();
  };

  const approve = trpc.tasks.approveAssignment.useMutation({
    onSuccess: () => {
      invalidate();
      toast({ title: "Assignment approved" });
    },
    onError: (error) =>
      toast({ title: "Could not approve", description: error.message, variant: "destructive" }),
  });

  const reject = trpc.tasks.rejectAssignment.useMutation({
    onSuccess: () => {
      invalidate();
      toast({ title: "Assignment declined" });
    },
    onError: (error) =>
      toast({ title: "Could not decline", description: error.message, variant: "destructive" }),
  });

  const items = pending.data ?? [];

  if (pending.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading approvals…</p>;
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Assignments awaiting approval</CardTitle>
          </div>
          <CardDescription>Nothing is waiting on you.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-amber-300 dark:border-amber-900/60">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <UserCheck className="h-5 w-5 text-amber-600" />
          <CardTitle className="text-lg">Assignments awaiting approval</CardTitle>
          <Badge variant="warning">{items.length}</Badge>
        </div>
        <CardDescription>
          These tasks are not assigned to anyone until you decide. Nobody is working on them yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/tasks/${item.task.id}`}
                    className="font-medium text-brand-600 hover:underline"
                  >
                    {item.task.code}
                  </Link>
                  <span className="min-w-0 wrap-break-word font-medium">{item.task.title}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Proposed: <span className="font-medium text-foreground">{item.assignee.name}</span>
                  {item.task.project ? ` · ${item.task.project.name}` : ""}
                  {item.task.dueDate ? ` · due ${new Date(item.task.dueDate).toDateString()}` : ""}
                </p>
                {rationaleOf(item.rationale) && (
                  // Why this person, and who else was considered. Approving
                  // without that is guessing, and a branch head asked to guess
                  // will eventually just approve everything.
                  <p className="text-xs text-muted-foreground">
                    {item.proposedById ? "Suggested" : "Auto-proposed"}:{" "}
                    {rationaleOf(item.rationale)?.chosen?.reason}
                    {(rationaleOf(item.rationale)?.runnersUp?.length ?? 0) > 0 && (
                      <>
                        {" · also considered "}
                        {rationaleOf(item.rationale)
                          ?.runnersUp?.map((r) => r.name)
                          .join(", ")}
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={approve.isPending}
                  onClick={() =>
                    approve.mutate({ assignmentId: item.id, note: notes[item.id]?.trim() || undefined })
                  }
                >
                  <Check className="h-3.5 w-3.5" />
                  Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={reject.isPending || (notes[item.id]?.trim().length ?? 0) < 3}
                  onClick={() => reject.mutate({ assignmentId: item.id, note: notes[item.id] ?? "" })}
                >
                  <X className="h-3.5 w-3.5" />
                  Decline
                </Button>
              </div>
            </div>
            <Input
              className="mt-3 h-8"
              placeholder="Reason — required to decline, optional to approve"
              value={notes[item.id] ?? ""}
              onChange={(event) =>
                setNotes((current) => ({ ...current, [item.id]: event.target.value }))
              }
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
