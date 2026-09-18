import { z } from "zod";
import { router } from "../trpc";
import { protectedProcedure } from "../procedures";
import { AttachmentService } from "@/server/services/attachment";

/** The parent an attachment hangs off. Exactly one is required — enforced in the service. */
const parent = {
  taskId: z.string().nullish(),
  requestId: z.string().nullish(),
  deliverableVersionId: z.string().nullish(),
};

export const attachmentsRouter = router({
  /** Phase 1 of the upload. Returns a presigned PUT; nothing is stored yet. */
  createUploadUrl: protectedProcedure
    .input(
      z.object({
        fileName: z.string().min(1).max(255),
        mimeType: z.string().min(3).max(200),
        size: z.number().int().positive(),
        ...parent,
      }),
    )
    .mutation(({ ctx, input }) => AttachmentService.createUploadUrl(ctx.userId, input)),

  /** Phase 3. Verifies the object really landed, then records it. */
  confirm: protectedProcedure
    .input(
      z.object({
        key: z.string().min(1),
        fileName: z.string().min(1).max(255),
        mimeType: z.string().min(3).max(200),
        ...parent,
      }),
    )
    .mutation(({ ctx, input }) => AttachmentService.confirm(ctx.userId, input)),

  list: protectedProcedure
    .input(z.object(parent))
    .query(({ ctx, input }) => AttachmentService.listFor(ctx.userId, input)),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => AttachmentService.remove(ctx.userId, input.id)),
});
