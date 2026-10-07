"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Plus, Star, Truck } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui-ext/status-pill";
import { EmptyState } from "@/components/ui-ext/empty-state";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { TaskCreateDialog } from "@/components/tasks/task-create-dialog";
import { TemplateApplyDialog } from "@/components/tasks/template-apply-dialog";
import { useToast } from "@/components/ui/use-toast";
import { useAgencyContext } from "@/components/providers/agency-provider";

import { formatDate } from "@/lib/format";
import { Textarea } from "@/components/ui/textarea";
import { BRANCH_LEAD_ROLES } from "@/server/auth/role-groups";
import type { Role } from "@prisma/client";


export default function ProjectDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast();
  const { isSuperAdmin, roles } = useAgencyContext();
  const utils = trpc.useUtils();
  const [creating, setCreating] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);

  const { data: project, isLoading } = trpc.projects.get.useQuery({ id });

  const isAgencyStaff =
    isSuperAdmin ||
    roles.some((r) =>
      BRANCH_LEAD_ROLES.includes(r as Role),
    );

  const deliver = trpc.projects.deliver.useMutation({
    onSuccess: () => {
      void utils.projects.get.invalidate({ id });
      toast({ title: "Project delivered", description: "The requester has been notified." });
    },
    onError: (err) =>
      toast({ title: "Couldn't deliver", description: err.message, variant: "destructive" }),
  });

  const [csatScore, setCsatScore] = useState(0);
  const [csatComment, setCsatComment] = useState("");
  const recordCsat = trpc.projects.recordCsat.useMutation({
    onSuccess: () => {
      void utils.projects.get.invalidate({ id });
      toast({ title: "Feedback submitted", description: "Thank you for your feedback!" });
    },
    onError: (err) =>
      toast({ title: "Couldn't submit feedback", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!project) {
    return <div className="py-12 text-center text-destructive">Project not found.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <span className="font-mono text-xs text-muted-foreground">{project.code}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {project.organization?.name} · {project.team?.name ?? "Unassigned"} · from{" "}
            <Link
              href={`/requests/${project.request.id}`}
              className="text-brand-600 hover:underline"
            >
              {project.request.code}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill kind="project" value={project.status} />
          {isAgencyStaff && (
            <>
              <Button variant="outline" onClick={() => setApplyingTemplate(true)}>
                Apply template
              </Button>
              <Button variant="outline" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                Add task
              </Button>
              {project.status === "active" && (
                <Button
                  onClick={() => deliver.mutate({ id })}
                  disabled={deliver.isPending}
                >
                  <Truck className="h-4 w-4" />
                  Mark delivered
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Tasks" value={project.tasks.length} />
        <Stat
          label="Done"
          value={project.tasks.filter((t) => t.status === "done").length}
        />
        <Stat label="Start" value={formatDate(project.startDate)} />
        <Stat label="Target" value={formatDate(project.targetDeliveryDate)} />
      </div>

      {project.description && (
        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{project.description}</p>
          </CardContent>
        </Card>
      )}

      {project.status === "delivered" && !isAgencyStaff && !project.csatScore && (
        <Card className="border-brand-500 bg-brand-50/50">
          <CardHeader>
            <CardTitle className="text-brand-900">Project Delivered — Sign Off Required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-brand-800">
              Please review the final deliverables. If everything looks good, provide your feedback below to close out the project.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">How would you rate your experience?</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setCsatScore(star)}
                    className="p-1 focus:outline-hidden"
                  >
                    <Star
                      className={`h-6 w-6 ${
                        csatScore >= star ? "fill-brand-500 text-brand-500" : "text-neutral-300"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Any additional comments?</label>
              <Textarea
                placeholder="Tell us what you loved, or how we can improve..."
                value={csatComment}
                onChange={(e) => setCsatComment(e.target.value)}
              />
            </div>
            <Button
              onClick={() => recordCsat.mutate({ projectId: id, score: csatScore, comment: csatComment })}
              disabled={csatScore === 0 || recordCsat.isPending}
            >
              Submit Feedback & Sign Off
            </Button>
          </CardContent>
        </Card>
      )}

      {project.status === "closed" && project.csatScore && (
        <Card>
          <CardHeader>
            <CardTitle>Project Feedback</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-1 mb-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`h-5 w-5 ${
                    project.csatScore! >= star ? "fill-brand-500 text-brand-500" : "text-neutral-300"
                  }`}
                />
              ))}
            </div>
            {project.csatComment && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{project.csatComment}</p>}
          </CardContent>
        </Card>
      )}

      {/* Everyone who can open a project sees its work. This used to be gated to
          agency admins and branch heads, which left department leads and team
          members looking at a milestone list instead of the tasks they own. The
          client-facing variant has no audience any more — clients do not log in. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Tasks</h2>
          {isAgencyStaff && project.tasks.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              Add task
            </Button>
          )}
        </div>
        {project.tasks.length === 0 ? (
          <EmptyState
            title="No tasks yet"
            description={
              isAgencyStaff
                ? "Work is assigned to tasks, not to projects — so nobody can be given this until " +
                  "there is at least one. Add a task, or apply a template to create a set at once. " +
                  "You can assign it to anyone in this project's branch."
                : "Your lead has not broken this project into tasks yet. Once they do, anything for " +
                  "you will appear in My Work."
            }
            action={isAgencyStaff ? <Button onClick={() => setCreating(true)}>Add task</Button> : undefined}
          />
        ) : (
          <KanbanBoard tasks={project.tasks} />
        )}
      </div>

      {(
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Timeline & Milestones</h2>
          {project.milestones.length === 0 ? (
            <EmptyState
              title="No milestones yet"
              description="The project team will update milestones as work progresses."
            />
          ) : (
            <div className="space-y-4">
              {project.milestones.map((m) => (
                <div key={m.id} className="flex gap-4 items-start rounded-lg border p-4 bg-card">
                  <div className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${m.completedAt ? "bg-brand-500" : "bg-neutral-200"}`} />
                  <div>
                    <h3 className="text-sm font-semibold">{m.name}</h3>
                    {m.description && <p className="text-sm text-muted-foreground mt-1">{m.description}</p>}
                    <p className="text-xs text-muted-foreground mt-2">
                      {m.completedAt ? `Completed ${formatDate(m.completedAt)}` : m.dueDate ? `Target: ${formatDate(m.dueDate)}` : "Pending"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {creating && (
        <TaskCreateDialog projectId={id} open={creating} onOpenChange={setCreating} />
      )}
      {applyingTemplate && (
        <TemplateApplyDialog projectId={id} open={applyingTemplate} onOpenChange={setApplyingTemplate} />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
