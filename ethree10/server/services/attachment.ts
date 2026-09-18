import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "crypto";
import { isDeclaredTypeConsistent, describeMismatch } from "@/server/services/content-sniff";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db/client";
import { s3, publicUrl, deleteFile, readHeadBytes } from "@/lib/storage";
import { env } from "@/lib/env";
import { AuditService } from "@/server/services/audit";
import { assertCanAccessTask, assertCanAccessRequest } from "@/server/auth/visibility";

/**
 * File uploads.
 *
 * Files go **straight from the browser to storage** using a presigned PUT; they
 * never pass through the app server. That is not an optimisation — a serverless
 * request body caps out around 4.5MB, and a single edited event video is far
 * larger than that.
 *
 * The flow is three steps and the third is not optional:
 *
 *   1. `createUploadUrl` — check permission, validate type and size, mint a key
 *      and a short-lived presigned PUT.
 *   2. The browser PUTs the bytes directly.
 *   3. `confirm` — HEAD the object to prove it is really there and really that
 *      size, and only then write the `Attachment` row.
 *
 * Skipping step 3 is how you end up with attachment rows pointing at nothing,
 * and a client being told their deliverable is ready when the bucket is empty.
 */

/** Presigned PUTs are short-lived; the browser uses them immediately. */
const UPLOAD_TTL_SECONDS = 600;

/**
 * What may be uploaded. An allowlist, not a blocklist — a blocklist of
 * executable types is a game you lose.
 */
const ALLOWED_MIME: Record<string, { maxBytes: number; label: string }> = {
  // Images
  "image/jpeg": { maxBytes: 25 * 1024 * 1024, label: "image" },
  "image/png": { maxBytes: 25 * 1024 * 1024, label: "image" },
  "image/webp": { maxBytes: 25 * 1024 * 1024, label: "image" },
  "image/gif": { maxBytes: 25 * 1024 * 1024, label: "image" },
  "image/svg+xml": { maxBytes: 5 * 1024 * 1024, label: "image" },
  "image/heic": { maxBytes: 25 * 1024 * 1024, label: "image" },
  // Documents
  "application/pdf": { maxBytes: 50 * 1024 * 1024, label: "document" },
  "application/msword": { maxBytes: 50 * 1024 * 1024, label: "document" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { maxBytes: 50 * 1024 * 1024, label: "document" },
  "application/vnd.ms-excel": { maxBytes: 50 * 1024 * 1024, label: "document" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { maxBytes: 50 * 1024 * 1024, label: "document" },
  "application/vnd.ms-powerpoint": { maxBytes: 50 * 1024 * 1024, label: "document" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { maxBytes: 100 * 1024 * 1024, label: "document" },
  "text/plain": { maxBytes: 5 * 1024 * 1024, label: "document" },
  "text/csv": { maxBytes: 25 * 1024 * 1024, label: "document" },
  // Archives — how design handoffs and photo sets usually arrive
  "application/zip": { maxBytes: 500 * 1024 * 1024, label: "archive" },
  "application/x-zip-compressed": { maxBytes: 500 * 1024 * 1024, label: "archive" },
  // Audio / video — Digital Media's actual output. Generous by design: a 10MB
  // cap would make this product unusable for the branch that needs it most.
  "video/mp4": { maxBytes: 2 * 1024 * 1024 * 1024, label: "video" },
  "video/quicktime": { maxBytes: 2 * 1024 * 1024 * 1024, label: "video" },
  "video/x-msvideo": { maxBytes: 2 * 1024 * 1024 * 1024, label: "video" },
  "audio/mpeg": { maxBytes: 200 * 1024 * 1024, label: "audio" },
  "audio/wav": { maxBytes: 500 * 1024 * 1024, label: "audio" },
};

export function humanBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** Strip anything that could confuse a storage key or a Content-Disposition. */
function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
}

export interface AttachmentParent {
  taskId?: string | null;
  requestId?: string | null;
  deliverableVersionId?: string | null;
}

/** Exactly one parent, named. Which one drives every check below. */
function soleParent(parent: AttachmentParent): "task" | "request" | "deliverable" {
  const provided = [parent.taskId, parent.requestId, parent.deliverableVersionId].filter(Boolean);
  if (provided.length !== 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Attach a file to exactly one of: a task, a request, or a deliverable version.",
    });
  }
  if (parent.taskId) return "task";
  if (parent.requestId) return "request";
  return "deliverable";
}

/**
 * The deliverable version's task, which is what its permissions hang off.
 * A version is a revision of a deliverable, and a deliverable belongs to a task.
 */
async function deliverableTaskId(versionId: string): Promise<{ versionId: string; taskId: string }> {
  const version = await db.deliverableVersion.findUnique({
    where: { id: versionId },
    select: { id: true, deliverable: { select: { taskId: true } } },
  });
  if (!version) throw new TRPCError({ code: "NOT_FOUND", message: "Deliverable version not found." });
  return { versionId: version.id, taskId: version.deliverable.taskId };
}

/**
 * Exactly one parent, and you must be allowed to write to it.
 *
 * The record-level checks (assertCanAccessTask / assertCanAccessRequest) confirm
 * both that the role holds the action and that the record is inside the caller's
 * branches. Previously this asked only the first question, so a branch head
 * holding `task.update` could attach to any task in the agency.
 */
async function assertCanAttach(actorId: string, parent: AttachmentParent): Promise<string> {
  switch (soleParent(parent)) {
    case "task":
      await assertCanAccessTask(actorId, parent.taskId!, "task.update");
      return `attachments/tasks/${parent.taskId}`;
    case "request":
      await assertCanAccessRequest(actorId, parent.requestId!, "request.update");
      return `attachments/requests/${parent.requestId}`;
    case "deliverable": {
      const { versionId, taskId } = await deliverableTaskId(parent.deliverableVersionId!);
      await assertCanAccessTask(actorId, taskId, "task.update");
      return `attachments/deliverables/${versionId}`;
    }
  }
}

/**
 * The same resolution for reading. Listing a parent's files is a read, so it
 * takes the read action rather than the write one — a team member may look at
 * the files on a request they are allowed to see without being allowed to
 * change it.
 */
async function assertCanReadParent(actorId: string, parent: AttachmentParent): Promise<void> {
  switch (soleParent(parent)) {
    case "task":
      return assertCanAccessTask(actorId, parent.taskId!, "task.read");
    case "request":
      return assertCanAccessRequest(actorId, parent.requestId!, "request.read");
    case "deliverable": {
      const { taskId } = await deliverableTaskId(parent.deliverableVersionId!);
      return assertCanAccessTask(actorId, taskId, "task.read");
    }
  }
}

export class AttachmentService {
  /** Phase 1 — validate, then hand back a presigned PUT. Nothing is stored yet. */
  static async createUploadUrl(
    actorId: string,
    input: { fileName: string; mimeType: string; size: number } & AttachmentParent,
  ) {
    const rule = ALLOWED_MIME[input.mimeType];
    if (!rule) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Files of type "${input.mimeType}" are not accepted. Allowed: images, documents, archives, audio and video.`,
      });
    }
    if (input.size <= 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That file is empty." });
    }
    if (input.size > rule.maxBytes) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `That ${rule.label} is ${humanBytes(input.size)}. The limit for ${rule.label}s is ${humanBytes(rule.maxBytes)}.`,
      });
    }

    const prefix = await assertCanAttach(actorId, input);
    const key = `${prefix}/${randomBytes(9).toString("base64url")}-${safeFileName(input.fileName)}`;

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: key,
        ContentType: input.mimeType,
        ContentLength: input.size,
      }),
      { expiresIn: UPLOAD_TTL_SECONDS },
    );

    return { uploadUrl, key, expiresInSeconds: UPLOAD_TTL_SECONDS };
  }

  /**
   * Phase 3 — verify the object exists and matches, then record it.
   *
   * The browser is not trusted to report success. If the PUT silently failed or
   * was truncated, the HEAD catches it here and no row is written.
   */
  static async confirm(
    actorId: string,
    input: { key: string; fileName: string; mimeType: string } & AttachmentParent,
  ) {
    // Re-check permission: the presigned URL may have been minted minutes ago.
    const prefix = await assertCanAttach(actorId, input);
    if (!input.key.startsWith(`${prefix}/`)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "That upload key does not belong to this item." });
    }

    const existing = await db.attachment.findUnique({ where: { storageKey: input.key } });
    if (existing) return existing;

    let size: number;
    try {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: input.key }),
      );
      size = head.ContentLength ?? 0;
    } catch {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That upload did not complete. Nothing was saved — please try again.",
      });
    }

    if (size <= 0) {
      // Do not leave a zero-byte object lying around pretending to be a file.
      await deleteFile(input.key).catch(() => undefined);
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The uploaded file was empty. Nothing was saved.",
      });
    }

    const rule = ALLOWED_MIME[input.mimeType];
    if (rule && size > rule.maxBytes) {
      await deleteFile(input.key).catch(() => undefined);
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `The uploaded file is ${humanBytes(size)}, over the ${humanBytes(rule.maxBytes)} limit. It has been discarded.`,
      });
    }

    // Verify the file is what the uploader said it is. The allowlist above keys
    // on `input.mimeType`, which the client supplies — so without this the one
    // check between the bucket and arbitrary content is a string the uploader
    // chose. A ranged read: sixteen bytes, not the whole file.
    const head = await readHeadBytes(input.key, 16).catch(() => new Uint8Array());
    if (head.length > 0 && !isDeclaredTypeConsistent(input.mimeType, head)) {
      await deleteFile(input.key).catch(() => undefined);
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: describeMismatch(input.mimeType, head),
      });
    }

    const attachment = await db.attachment.create({
      data: {
        taskId: input.taskId ?? null,
        requestId: input.requestId ?? null,
        deliverableVersionId: input.deliverableVersionId ?? null,
        fileName: safeFileName(input.fileName),
        mimeType: input.mimeType,
        size,
        storageKey: input.key,
        publicUrl: publicUrl(input.key),
        uploadedById: actorId,
      },
    });

    await AuditService.log({
      actorId,
      action: "attachment.uploaded",
      entityType: "Attachment",
      entityId: attachment.id,
      after: { fileName: attachment.fileName, size, mimeType: attachment.mimeType },
    });

    return attachment;
  }

  static async listFor(actorId: string, parent: AttachmentParent) {
    // This took no actor at all, so any signed-in user could list the files on
    // any task, request or deliverable in the agency by passing its id. The
    // other three procedures on this service all resolve the parent and check
    // the caller; only the read path did not.
    await assertCanReadParent(actorId, parent);
    return db.attachment.findMany({
      where: {
        taskId: parent.taskId ?? undefined,
        requestId: parent.requestId ?? undefined,
        deliverableVersionId: parent.deliverableVersionId ?? undefined,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Remove an attachment. The stored object goes too — no orphans. */
  static async remove(actorId: string, attachmentId: string) {
    const attachment = await db.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found." });

    await assertCanAttach(actorId, {
      taskId: attachment.taskId,
      requestId: attachment.requestId,
      deliverableVersionId: attachment.deliverableVersionId,
    });

    await db.attachment.delete({ where: { id: attachmentId } });
    await deleteFile(attachment.storageKey).catch((error) =>
      console.error("Attachment object delete failed", attachment.storageKey, error),
    );
    await AuditService.log({
      actorId,
      action: "attachment.deleted",
      entityType: "Attachment",
      entityId: attachmentId,
      before: { fileName: attachment.fileName },
    });
    return { ok: true };
  }
}

export const ATTACHMENT_LIMITS = ALLOWED_MIME;
