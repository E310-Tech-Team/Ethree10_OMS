import { router } from "../trpc";
import { authRouter } from "./auth";
import { organizationsRouter } from "./organizations";
import { teamsRouter } from "./teams";
import { subunitsRouter } from "./subunits";
import { membersRouter } from "./members";
import { skillsRouter } from "./skills";
import { requestsRouter } from "./requests";
import { projectsRouter } from "./projects";
import { tasksRouter } from "./tasks";
import { leadsRouter } from "./leads";
import { auditRouter } from "./audit";
import { notificationsRouter } from "./notifications";
import { integrationsRouter } from "./integrations";
import { reportsRouter } from "./reports";
import { dashboardRouter } from "./dashboard";
import { proposalsRouter } from "./proposals";
import { approvalRulesRouter } from "./approvalRules";
import { templatesRouter } from "./templates";
import { timeLogsRouter } from "./timeLogs";
import { scorecardsRouter } from "./scorecards";
import { whatsappRouter } from "./whatsapp";
import { pushRouter } from "./push";
import { preferencesRouter } from "./preferences";
import { cmsRouter } from "./cms";
import { invoicesRouter } from "./invoices";
import { receiptsRouter } from "./receipts";
import { analyticsRouter } from "./analytics";
import { setupRouter } from "./setup";
import { trackRouter } from "./track";
import { servicesRouter } from "./services";
import { executionRouter } from "./execution";
import { budgetsRouter } from "./budgets";
import { attachmentsRouter } from "./attachments";
import { searchRouter } from "./search";

export const appRouter = router({
  auth: authRouter,
  organizations: organizationsRouter,
  teams: teamsRouter,
  subunits: subunitsRouter,
  members: membersRouter,
  skills: skillsRouter,
  requests: requestsRouter,
  projects: projectsRouter,
  tasks: tasksRouter,
  leads: leadsRouter,
  audit: auditRouter,
  notifications: notificationsRouter,
  integrations: integrationsRouter,
  reports: reportsRouter,
  dashboard: dashboardRouter,
  proposals: proposalsRouter,
  approvalRules: approvalRulesRouter,
  templates: templatesRouter,
  timeLogs: timeLogsRouter,
  scorecards: scorecardsRouter,
  whatsapp: whatsappRouter,
  push: pushRouter,
  preferences: preferencesRouter,
  cms: cmsRouter,
  invoices: invoicesRouter,
  receipts: receiptsRouter,
  analytics: analyticsRouter,
  setup: setupRouter,
  budgets: budgetsRouter,
  attachments: attachmentsRouter,
  search: searchRouter,
  track: trackRouter,
  services: servicesRouter,
  execution: executionRouter,
});

export type AppRouter = typeof appRouter;
