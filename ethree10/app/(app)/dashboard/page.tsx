"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  CheckSquare,
  FileClock,
  Clock,
  FolderKanban,
  Inbox,
  MessageSquareQuote,
  Users,
} from "lucide-react";
import { type KpiSnapshot } from "@prisma/client";
import { trpc } from "@/lib/trpc/client";
import { formatDate } from "@/lib/format";
import {
  formatPercentage,
  getCapacityStatus,
  getDashboardExperience,
  summarizeThroughput,
} from "@/lib/dashboard";
import { StatCard } from "@/components/ui-ext/stat-card";
import { StatusPill } from "@/components/ui-ext/status-pill";
import { UrgencyTag } from "@/components/ui-ext/urgency-tag";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAgencyContext } from "@/components/providers/agency-provider";
import { KpiWidget } from "@/components/dashboard/kpi-widget";
import { FirstRunChecklist } from "@/components/dashboard/first-run-checklist";
import { AnimatedItem, AnimatedPage, AnimatedSection } from "@/components/ui-ext/animated";

export default function DashboardPage() {
  const { roles, isSuperAdmin, agency: activeOrganization } = useAgencyContext();
  const experience = getDashboardExperience(roles, isSuperAdmin);

  const { data: myTasks } = trpc.tasks.myTasks.useQuery(undefined, {
    enabled: experience.isMember,
  });
  const { data: myWeek } = trpc.reports.myCurrentWeek.useQuery(undefined, {
    enabled: experience.isMember,
  });
  const { data: teamData } = trpc.dashboard.teamLead.useQuery(undefined, {
    enabled: experience.isTeamHead,
  });
  const { data: agencyData } = trpc.dashboard.agencyLead.useQuery(undefined, {
    enabled: experience.isAgencyLead,
  });
  // Removed requesterData

  const now = new Date();
  const myTaskList = myTasks ?? [];
  const myOpenTasksCount = myTaskList.length;
  const myOverdueTasksCount = myTaskList.filter(
    (task) => task.dueDate && new Date(task.dueDate) < now,
  ).length;
  const completedThisWeek = myWeek?.metrics?.tasksCompleted ?? 0;
  const capacityStatus = getCapacityStatus(agencyData?.capacity.loadRatio);
  const throughput = agencyData
    ? summarizeThroughput({
        tasksCompletedLast7Days: agencyData.metrics.completedTasksLast7Days,
        deliveredProjectsLast30Days: agencyData.metrics.deliveredProjectsLast30Days,
        closedRequestsLast30Days: agencyData.metrics.closedRequestsLast30Days,
      })
    : 0;

  return (
    <AnimatedPage className="space-y-8">
      <AnimatedSection delay={40}>
        <DashboardHero
          agencyName={activeOrganization.name}
          showRequestCta={false}
        />
      </AnimatedSection>

      {/* Admin-only "ready to use" setup checklist (isAgencyLead && isMember == admin/super_admin). */}
      {experience.isAgencyLead && experience.isMember && (
        <AnimatedSection delay={60}>
          <FirstRunChecklist enabled />
        </AnimatedSection>
      )}



      {experience.isMember && (
        <AnimatedSection className="space-y-4" delay={120}>
          <SectionHeader
            title="My work"
            description="Stay on top of your queue, weekly output, and tasks at risk."
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard
              label="My open tasks"
              value={myOpenTasksCount}
              icon={CheckSquare}
              tone="signature"
            />
            <StatCard
              label="Overdue tasks"
              value={myOverdueTasksCount}
              icon={AlertTriangle}
              hint={myOverdueTasksCount > 0 ? "These need attention now" : "You are on track"}
              className="surface-hover"
            />
            <StatCard
              label="Completed this week"
              value={completedThisWeek}
              icon={CheckCircle2}
              className="surface-hover"
            />
            <StatCard
              label="Hours logged"
              value={myWeek?.metrics?.hoursLogged ?? 0}
              icon={Briefcase}
              className="surface-hover"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SurfaceCard
              title="My next tasks"
              description="Your most urgent tasks across active projects."
              actionHref="/tasks"
              actionLabel="View all tasks"
            >
              {myTaskList.length === 0 ? (
                <EmptyState message="Nothing assigned right now." />
              ) : (
                myTaskList.slice(0, 5).map((task, index) => (
                  <AnimatedItem key={task.id} delay={index * 50}>
                    <LinkCard href={`/tasks/${task.id}`}>
                      <div className="min-w-0 flex-1 space-y-1">
                        <span className="block min-w-0 truncate font-medium">{task.title}</span>
                        <p className="text-xs text-muted-foreground">
                          {task.project?.name ?? "Project"}
                          {task.dueDate ? ` · Due ${formatDate(task.dueDate)}` : " · No due date"}
                        </p>
                      </div>
                      <StatusPill kind="task" value={task.status} />
                    </LinkCard>
                  </AnimatedItem>
                ))
              )}
            </SurfaceCard>

            <SurfaceCard
              title="Weekly snapshot"
              description="A quick view of your delivery reliability this week."
            >
              <MetricRow label="Tasks completed" value={`${myWeek?.metrics?.tasksCompleted ?? 0}`} />
              <MetricRow label="On-time rate" value={formatPercentage(myWeek?.metrics?.onTimeRate)} />
              <MetricRow label="Hours logged" value={`${myWeek?.metrics?.hoursLogged ?? 0}`} />
            </SurfaceCard>
          </div>
        </AnimatedSection>
      )}

      {experience.isTeamHead && teamData && teamData.teams.length > 0 && (
        <AnimatedSection className="space-y-4 border-t pt-6" delay={220}>
          <SectionHeader
            title="Team view"
            description="Balance intake, delivery pressure, and client follow-ups for your team."
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard
              label="Incoming requests"
              value={teamData.incomingRequests.length}
              icon={Inbox}
              tone="signature"
            />
            <StatCard
              label="Active projects"
              value={teamData.metrics.activeProjects}
              icon={FolderKanban}
              className="surface-hover"
            />
            <StatCard
              label="Awaiting client feedback"
              value={teamData.metrics.deliveredAwaitingFeedback}
              icon={MessageSquareQuote}
              className="surface-hover"
            />
            <StatCard
              label="Overdue tasks"
              value={teamData.metrics.overdueTasksCount}
              icon={AlertTriangle}
              className="surface-hover"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <SurfaceCard title="Team intake queue" description="Requests that still need active team handling.">
              {teamData.incomingRequests.length === 0 ? (
                <EmptyState message="No incoming requests need team attention right now." />
              ) : (
                teamData.incomingRequests.map((request, index) => (
                  <AnimatedItem key={request.id} delay={index * 50}>
                    <LinkCard href={`/requests/${request.id}`}>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="block min-w-0 truncate font-medium">{request.title}</span>
                          <UrgencyTag value={request.urgency} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {request.organization?.name ?? "Organization"} · Submitted {formatDate(request.createdAt)}
                        </p>
                      </div>
                      <StatusPill kind="request" value={request.stage} />
                    </LinkCard>
                  </AnimatedItem>
                ))
              )}
            </SurfaceCard>

            <Card className="surface-hover">
              <CardHeader>
                <CardTitle className="text-base">Latest KPI snapshot</CardTitle>
                <CardDescription>Operational scorecard for the teams you lead.</CardDescription>
              </CardHeader>
              <CardContent>
                <KpiWidget snapshot={teamData.kpiSnapshot as KpiSnapshot | null} />
              </CardContent>
            </Card>
          </div>
        </AnimatedSection>
      )}

      {experience.isAgencyLead && agencyData && (
        <AnimatedSection className="space-y-4 border-t pt-6" delay={280}>
          <SectionHeader
            title={experience.isExecutive && !experience.isMember ? "Executive overview" : "Agency overview"}
            description={
              experience.isExecutive && !experience.isMember
                ? "A read-only pulse of the whole agency — queue health, throughput, and delivery pressure across both teams."
                : "A real leadership surface for queue health, throughput, and delivery pressure."
            }
          />

          {/* The vision's own success measures (§1.7), against their targets.
              They were defined, measurable, and never measured. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Avg. triage time"
              value={
                agencyData.successMetrics.averageTriageHours === null
                  ? "—"
                  : `${agencyData.successMetrics.averageTriageHours}h`
              }
              icon={Clock}
              hint={`Target: under ${agencyData.successMetrics.triageTargetHours}h`}
              tone={
                agencyData.successMetrics.averageTriageHours !== null &&
                agencyData.successMetrics.averageTriageHours > agencyData.successMetrics.triageTargetHours
                  ? "accent"
                  : "default"
              }
            />
            <StatCard
              label="Client satisfaction"
              value={
                agencyData.successMetrics.averageCsat === null
                  ? "—"
                  : `${agencyData.successMetrics.averageCsat} / 5`
              }
              icon={CheckCircle2}
              hint={`Target: ${agencyData.successMetrics.csatTarget}+`}
              tone={
                agencyData.successMetrics.averageCsat !== null &&
                agencyData.successMetrics.averageCsat < agencyData.successMetrics.csatTarget
                  ? "accent"
                  : "default"
              }
            />
            <StatCard
              label="Awaiting triage"
              value={agencyData.successMetrics.awaitingTriage}
              icon={Inbox}
              hint="Unrouted client requests"
              tone={agencyData.successMetrics.awaitingTriage > 0 ? "accent" : "default"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard
              label="30-day throughput"
              value={throughput}
              icon={CheckCircle2}
              hint="Closed requests + delivered projects + completed tasks"
              tone="signature"
            />
            <StatCard
              label="Pending approvals"
              value={agencyData.metrics.pendingApprovals}
              icon={FileClock}
              className="surface-hover"
            />
            <StatCard
              label="Overdue tasks"
              value={agencyData.metrics.overdueTasksCount}
              icon={AlertTriangle}
              className="surface-hover"
            />
            <StatCard
              label="Active projects"
              value={agencyData.metrics.activeProjectsCount}
              icon={Users}
              className="surface-hover"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <SurfaceCard title="Cross-agency inbox" description="Requests that need routing, approval, or scope movement now.">
              {agencyData.crossAgencyInbox.length === 0 ? (
                <EmptyState message="Inbox zero. No cross-agency request is waiting." />
              ) : (
                agencyData.crossAgencyInbox.map((request, index) => (
                  <AnimatedItem key={request.id} delay={index * 50}>
                    <LinkCard href={`/requests/${request.id}`}>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="block min-w-0 truncate font-medium">{request.title}</span>
                          {request.urgency === "critical" && (
                            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                          )}
                          <UrgencyTag value={request.urgency} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {request.organization?.name ?? "Organization"}
                          {request.routedTeamId ? ` · Assigned` : " · Unassigned"}
                        </p>
                      </div>
                      <StatusPill kind="request" value={request.stage} />
                    </LinkCard>
                  </AnimatedItem>
                ))
              )}
            </SurfaceCard>

            <SurfaceCard title="Capacity and delivery signals" description="Live pressure indicators from work currently in flight.">
              <div className="space-y-4">
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Capacity status</p>
                      <p className="text-xs text-muted-foreground">
                        Remaining estimated work vs. weekly team capacity.
                      </p>
                    </div>
                    <Badge variant={capacityStatus.variant}>{capacityStatus.label}</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-background p-3">
                      <div className="text-xs text-muted-foreground">Remaining work</div>
                      <div className="mt-1 text-lg font-semibold">
                        {Math.round(agencyData.capacity.totalRemainingHours)}h
                      </div>
                    </div>
                    <div className="rounded-lg bg-background p-3">
                      <div className="text-xs text-muted-foreground">Weekly capacity</div>
                      <div className="mt-1 text-lg font-semibold">
                        {Math.round(agencyData.capacity.totalWeeklyCapacity)}h
                      </div>
                    </div>
                  </div>
                </div>

                <MetricRow
                  label="Delivered, awaiting client feedback"
                  value={`${agencyData.metrics.deliveredProjectsAwaitingFeedback}`}
                />
                <MetricRow
                  label="Projects delivered in last 30 days"
                  value={`${agencyData.metrics.deliveredProjectsLast30Days}`}
                />
                <MetricRow
                  label="Requests closed in last 30 days"
                  value={`${agencyData.metrics.closedRequestsLast30Days}`}
                />
              </div>
            </SurfaceCard>
          </div>

          <SurfaceCard
            title="Top in-flight projects"
            description="Projects closest to deadline or active decision points."
          >
            {agencyData.topProjects.length === 0 ? (
              <EmptyState message="No active projects are currently in flight." />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {agencyData.topProjects.map((project, index) => (
                  <AnimatedItem key={project.id} delay={index * 50}>
                    <Link
                      href={`/projects/${project.id}`}
                      className="surface-hover block rounded-xl border p-4"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="block min-w-0 truncate font-medium">{project.name}</span>
                          <StatusPill kind="project" value={project.status} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {project.organization?.name ?? "Organization"}
                          {project.team?.name ? ` · ${project.team.name}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {project.targetDeliveryDate
                            ? `Target ${formatDate(project.targetDeliveryDate)}`
                            : "No delivery target set"}
                        </p>
                      </div>
                    </Link>
                  </AnimatedItem>
                ))}
              </div>
            )}
          </SurfaceCard>
        </AnimatedSection>
      )}
    </AnimatedPage>
  );
}

function DashboardHero({
  agencyName,
  showRequestCta,
}: {
  agencyName: string;
  showRequestCta: boolean;
}) {
  return (
    <div className="brand-hero relative overflow-hidden rounded-2xl px-6 py-7 text-white shadow-pop sm:px-8 sm:py-8">
      <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/55">
            {agencyName}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Welcome back
          </h1>
          <p className="max-w-xl text-sm text-white/70">
            Here&apos;s what&apos;s moving across your operation today — requests, delivery, and the work that needs you.
          </p>
        </div>
        {showRequestCta && (
          <Button asChild variant="accent" className="shrink-0">
            <Link href="/requests/new">
              Submit a request
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-medium tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function SurfaceCard({
  title,
  description,
  children,
  actionHref,
  actionLabel,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <Card className="surface-hover">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actionHref && actionLabel ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={actionHref}>
              {actionLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function LinkCard({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="surface-hover flex items-center justify-between gap-3 rounded-xl border p-3 text-sm"
    >
      {children}
    </Link>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}
