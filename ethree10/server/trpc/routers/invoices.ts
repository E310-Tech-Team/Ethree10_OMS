import { z } from "zod";
import { hasAgencyWideScope } from "@/server/auth/role-groups";
import { TRPCError } from "@trpc/server";
import { InvoiceStatus, PaymentMethod } from "@prisma/client";
import { router } from "../trpc";
import { protectedProcedure } from "../procedures";
import { publicProcedure } from "../trpc";
import { enforcePublicRateLimit } from "@/server/security/public-rate-limit";
import { clientIp } from "@/server/security/client-ip";
import { db } from "@/server/db/client";
import { getAgencyAuthContext, requireAgencyAction } from "@/server/services/agency";
import { InvoiceService, invoicePublicUrl } from "@/server/services/invoice";
import { ReceiptService } from "@/server/services/receipt";
import { BudgetService } from "@/server/services/budget";
import { EmailService } from "@/server/notifications/email";
import { AuditService } from "@/server/services/audit";
import { NotificationService } from "@/server/services/notification";
import { NotificationAudience } from "@/server/services/notification-audience";
import { secureCode } from "@/server/security/secure-code";
import { allocateRandomCode } from "@/server/services/code-allocator";

export const invoicesRouter = router({
  list: protectedProcedure
    .input(z.object({ status: z.nativeEnum(InvoiceStatus).optional() }).optional())
    .query(async ({ ctx, input }) => {
      // In a real system we'd limit this to the agency admin or the specific client organization.
      // For now, if you are an agency admin, you see all.
      const authCtx = await getAgencyAuthContext(ctx.userId);
      if (!hasAgencyWideScope(authCtx)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return db.invoice.findMany({
        where: input?.status ? { status: input.status } : undefined,
        include: { organization: true, project: true },
        orderBy: { createdAt: "desc" },
      });
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const authCtx = await getAgencyAuthContext(ctx.userId);
      if (!hasAgencyWideScope(authCtx)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const invoice = await db.invoice.findUnique({
        where: { id: input.id },
        include: { organization: true, project: true, receipt: true },
      });
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
      return invoice;
    }),

  getByCode: publicProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ ctx, input }) => {
      // Enumeration guard. The code is the only secret protecting this data
      // (see the billing-document branch in app/api/files), so a caller must
      // not be able to walk the space. Keyed on the caller, not the code —
      // keying on the code gives every guess its own fresh window.
      const ip = clientIp(ctx.headers);
      await enforcePublicRateLimit({
        action: "invoice-lookup",
        secret: ip,
        limit: 20,
        windowSeconds: 60,
      });

      const invoice = await db.invoice.findUnique({
        where: { code: input.code },
        include: { organization: true, project: true },
      });
      if (!invoice) {
        // A miss is the signal that someone is guessing. Recorded so a run of
        // them is visible rather than silently absorbed by the limiter.
        await AuditService.log({
          actorId: null,
          action: "invoice.lookup.miss",
          entityType: "Invoice",
          entityId: input.code,
          ip,
        });
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return invoice;
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        projectId: z.string().optional(),
        currency: z.enum(["NGN", "USD"]),
        // z.coerce.date() rather than a bare string: the value went straight
        // into `new Date(input.dueAt)`, so "next Tuesday" became an Invalid
        // Date and failed at the database with a Prisma error instead of a
        // message naming the field. Every other date input in the app already
        // coerces; this one was missed.
        dueAt: z.coerce.date().optional(),
        lineItems: z.array(
          z.object({
            description: z.string().min(1),
            quantity: z.number().min(1),
            unitPrice: z.number().min(0),
          })
        ).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireAgencyAction(ctx.userId, "invoice.manage");

      const totalAmount = input.lineItems.reduce(
        (acc, item) => acc + item.quantity * item.unitPrice,
        0
      );

      // The code is the only thing standing between a stranger and this
      // invoice's public page and pay link, so it is drawn from the CSPRNG.
      const invoice = await allocateRandomCode({
        generate: () => `INV-${secureCode()}`,
        create: (code) =>
          db.invoice.create({
            data: {
              code,
              organizationId: input.organizationId,
              projectId: input.projectId,
              currency: input.currency,
              amount: totalAmount,
              lineItems: input.lineItems,
              dueAt: input.dueAt ?? null,
              status: "draft",
            },
          }),
      });

      return invoice;
    }),

  markSent: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireAgencyAction(ctx.userId, "invoice.manage");
      // Spending gate: nothing goes to a client until the Chief Executive has
      // approved the project's budget.
      const existing = await db.invoice.findUnique({ where: { id: input.id }, select: { projectId: true } });
      await BudgetService.assertApproved(existing?.projectId);
      const invoice = await db.invoice.update({
        where: { id: input.id },
        data: { status: "sent", issuedAt: new Date() },
      });
      // Generate the branded PDF so the public viewer and email have a document.
      await InvoiceService.generateInvoicePdf(invoice.id).catch((err) =>
        console.error("Invoice PDF generation failed", invoice.code, err),
      );
      return invoice;
    }),

  // Regenerate (or first-time generate) the branded invoice PDF; returns its URL.
  regeneratePdf: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireAgencyAction(ctx.userId, "invoice.manage");
      const url = await InvoiceService.generateInvoicePdf(input.id);
      return { pdfUrl: url };
    }),

  // Email the client a link to the public invoice. Marks the invoice sent.
  send: protectedProcedure
    .input(z.object({ id: z.string(), email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      await requireAgencyAction(ctx.userId, "invoice.manage");
      const existing = await db.invoice.findUnique({ where: { id: input.id }, select: { projectId: true } });
      await BudgetService.assertApproved(existing?.projectId);
      const invoice = await db.invoice.update({
        where: { id: input.id },
        data: { status: "sent", issuedAt: new Date() },
      });
      await InvoiceService.generateInvoicePdf(invoice.id).catch((err) =>
        console.error("Invoice PDF generation failed", invoice.code, err),
      );
      const sent = await EmailService.sendNotification({
        to: input.email,
        title: `Invoice ${invoice.code}`,
        body: `An invoice is ready for you to view and pay online.`,
        ctaLabel: "View & Pay Invoice",
        ctaPath: `/invoice/${invoice.code}`,
      });
      await AuditService.log({
        actorId: ctx.userId,
        organizationId: invoice.organizationId,
        action: "invoice.send",
        entityType: "Invoice",
        entityId: invoice.id,
        after: { to: input.email, emailed: sent },
      });
      await NotificationService.createMany(
        await NotificationAudience.moneyOversight(ctx.userId),
        {
          kind: "invoice_sent",
          title: `Invoice ${invoice.code} sent`,
          body: `${invoice.currency} ${invoice.amount.toString()} to ${input.email}${
            sent ? "" : " — the email could not be delivered"
          }`,
          link: "/invoices",
          entityType: "Invoice",
          entityId: invoice.id,
          allowDuplicate: true,
        },
      );

      return { emailed: sent, publicUrl: invoicePublicUrl(invoice.code) };
    }),

  /**
   * Confirm funds received for an invoice, which issues the receipt.
   *
   * Delegates to `BudgetService.confirmInvoicePayment`, which requires the
   * `payment.confirm` permission (Finance only), asserts the project's budget
   * was approved, and refuses if the confirmer is the person who approved that
   * budget. Previously this endpoint issued receipts on `invoice.manage` alone,
   * which bypassed both controls.
   */
  markPaid: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        paymentMethod: z.nativeEnum(PaymentMethod).default("bank_transfer"),
        paymentRef: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { invoice, receipt } = await BudgetService.confirmInvoicePayment(ctx.userId, {
        invoiceId: input.id,
        paymentMethod: input.paymentMethod,
        paymentRef: input.paymentRef ?? null,
      });
      return { invoice, receiptCode: receipt.code };
    }),

  markVoid: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireAgencyAction(ctx.userId, "invoice.manage");
      const invoice = await db.invoice.update({
        where: { id: input.id },
        data: { status: "void" },
      });
      await AuditService.log({
        actorId: ctx.userId,
        organizationId: invoice.organizationId,
        action: "invoice.void",
        entityType: "Invoice",
        entityId: invoice.id,
      });
      return invoice;
    }),
});
