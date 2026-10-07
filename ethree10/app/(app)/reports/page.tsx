"use client";

import Link from "next/link";
import { format } from "date-fns";
import { BarChart3, CalendarRange, FileText, Play, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useAgencyContext } from "@/components/providers/agency-provider";
import { PageHeader } from "@/components/ui-ext/page-header";
import { StatCard } from "@/components/ui-ext/stat-card";
import { AnimatedPage, AnimatedSection } from "@/components/ui-ext/animated";
import { REPORT_GENERATOR_ROLES } from "@/server/auth/role-groups";

export default function ReportsPage() {
  const { agency, roles, isSuperAdmin } = useAgencyContext();
  const { toast } = useToast();
  const { data: reports, isLoading, refetch } = trpc.reports.list.useQuery();

  const generateWeekly = trpc.reports.generateWeekly.useMutation({
    onSuccess: () => {
      toast({
        title: "Weekly reports queued",
        description: "Fresh rollups are being generated for the current reporting cycle.",
      });
      void refetch();
    },
    onError: (error) => {
      toast({
        title: "Could not generate reports",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  const generateMonthly = trpc.reports.generateMonthly.useMutation({
    onSuccess: () => {
      toast({ title: "Monthly reports generated", description: "Draft rollups are ready for review." });
      void refetch();
    },
    onError: (error) => toast({ title: "Could not generate reports", description: error.message, variant: "destructive" }),
  });

  const reportList = reports ?? [];
  const latestReport = reportList[0] ?? null;
  const withPdfCount = reportList.filter((report) => Boolean(report.pdfUrl)).length;

  return (
    <AnimatedPage className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <AnimatedSection delay={40}>
        <PageHeader
          title="Reports"
          description="Weekly and monthly rollups across the agency."
          actions={
            agency.type === "agency" && (isSuperAdmin || roles.some((role) => REPORT_GENERATOR_ROLES.includes(role))) ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => generateWeekly.mutate()} disabled={generateWeekly.isPending}>
                  {generateWeekly.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Generate weekly
                </Button>
                <Button variant="outline" onClick={() => generateMonthly.mutate()} disabled={generateMonthly.isPending}>
                  {generateMonthly.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />}
                  Generate monthly
                </Button>
              </div>
            ) : undefined
          }
        />
      </AnimatedSection>

      <AnimatedSection delay={100} className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Reports generated"
          value={reportList.length}
          icon={BarChart3}
          hint="All available report snapshots"
          className="surface-hover"
        />
        <StatCard
          label="PDF exports ready"
          value={withPdfCount}
          icon={FileText}
          hint="Reports with downloadable PDFs"
          className="surface-hover"
        />
        <StatCard
          label="Latest cycle"
          value={latestReport ? format(new Date(latestReport.periodStart), "MMM d") : "—"}
          icon={CalendarRange}
          hint={
            latestReport
              ? `${format(new Date(latestReport.periodStart), "MMM d, yyyy")} - ${format(new Date(latestReport.periodEnd), "MMM d, yyyy")}`
              : "No reports generated yet"
          }
          className="surface-hover"
        />
      </AnimatedSection>

      <AnimatedSection delay={160}>
        <Card className="surface-hover">
          <CardHeader>
            <CardTitle>Report archive</CardTitle>
            <CardDescription>
              Review recent reporting periods, confirm the scope, and open exported PDFs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="grid gap-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-14 animate-pulse rounded-lg bg-muted/60" />
                ))}
              </div>
            ) : reportList.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center">
                <p className="text-sm font-medium">No reports found yet.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Generate the first weekly rollup to populate this archive.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Level</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date Range</TableHead>
                    <TableHead>Generated At</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportList.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {report.level}
                        </Badge>
                      </TableCell>
                      <TableCell className="capitalize">{report.period}</TableCell>
                      <TableCell><Badge variant={report.status === "finalized" ? "default" : "outline"} className="capitalize">{report.status}</Badge></TableCell>
                      <TableCell>
                        {format(new Date(report.periodStart), "MMM d, yyyy")} - {format(new Date(report.periodEnd), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        {format(new Date(report.createdAt), "MMM d, yyyy HH:mm")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/reports/${report.id}`}><FileText className="h-4 w-4" /> Review</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </AnimatedSection>
    </AnimatedPage>
  );
}
