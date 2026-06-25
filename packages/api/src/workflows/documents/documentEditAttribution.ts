import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  documentAuditCheckpoints,
  documentContentWriteHeaders,
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import {
  type AttributionSpanInput,
  type DocumentEditAttributionSegment,
  resolveEditAttribution,
} from "../../documents/documentEditAttribution";
import {
  KeyingReadAccessError,
  resolveReadableDocumentAccess,
} from "../keyingReadAccess";

interface DocumentEditAttributionWorkflowInput {
  readonly documentId: string;
  readonly userId: string;
}

interface DocumentEditAttributionResult {
  readonly documentId: string;
  readonly segments: DocumentEditAttributionSegment[];
}

export class DocumentEditAttributionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
    this.name = "DocumentEditAttributionError";
  }
}

interface UpdateAttributionMeta {
  readonly sequence: number;
  readonly writerUserId: string;
  readonly writerKeyFingerprint: string;
  readonly isBaseline: boolean;
}

async function loadUpdateAttributionMeta(
  documentId: string,
  executor: DatabaseSession,
): Promise<Map<string, UpdateAttributionMeta>> {
  // One query: the DB inner-joins each update to its (unique) write header and
  // left-joins the rotate_baseline checkpoint that re-asserted it, if any. Both
  // documentContentWriteHeaders.updateId and documentAuditCheckpoints
  // .baselineUpdateId are unique, so this yields exactly one row per update — no
  // fan-out — and offloads the join to the database instead of memory.
  const rows = await executor
    .select({
      id: documentUpdates.id,
      sequence: documentUpdates.sequence,
      header: documentContentWriteHeaders.header,
      baselineUpdateId: documentAuditCheckpoints.baselineUpdateId,
    })
    .from(documentUpdates)
    .innerJoin(
      documentContentWriteHeaders,
      eq(documentContentWriteHeaders.updateId, documentUpdates.id),
    )
    .leftJoin(
      documentAuditCheckpoints,
      and(
        eq(documentAuditCheckpoints.baselineUpdateId, documentUpdates.id),
        eq(documentAuditCheckpoints.documentId, documentId),
        eq(documentAuditCheckpoints.checkpointKind, "rotate_baseline"),
      ),
    )
    .where(eq(documentUpdates.documentId, documentId));

  const meta = new Map<string, UpdateAttributionMeta>();
  for (const row of rows) {
    meta.set(row.id, {
      sequence: row.sequence,
      writerUserId: row.header.writerUserId,
      writerKeyFingerprint: row.header.writerKeyFingerprint,
      isBaseline: row.baselineUpdateId !== null,
    });
  }

  return meta;
}

export async function runDocumentEditAttributionWorkflow(
  executor: DatabaseSession,
  input: DocumentEditAttributionWorkflowInput,
): Promise<DocumentEditAttributionResult> {
  try {
    await resolveReadableDocumentAccess({
      documentId: input.documentId,
      executor,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof KeyingReadAccessError) {
      throw new DocumentEditAttributionError(error.message, error.status);
    }
    throw error;
  }

  const metaByUpdateId = await loadUpdateAttributionMeta(
    input.documentId,
    executor,
  );
  const spanRows = await executor
    .select({
      updateId: documentUpdateSpans.updateId,
      peerId: documentUpdateSpans.peerId,
      startCounter: documentUpdateSpans.startCounter,
      endCounter: documentUpdateSpans.endCounter,
    })
    .from(documentUpdateSpans)
    .where(eq(documentUpdateSpans.documentId, input.documentId));

  const attributionSpans: AttributionSpanInput[] = [];
  for (const span of spanRows) {
    const meta = metaByUpdateId.get(span.updateId);
    if (!meta) {
      // Spans are written in the same transaction as their update and that
      // update's write header (syncDocument.ts), and loadUpdateAttributionMeta
      // inner-joins that header — so a span whose update has no meta is a
      // database-integrity violation, never a tolerable state.
      throw new Error(
        `Attribution span references update ${span.updateId} with no write header.`,
      );
    }
    attributionSpans.push({
      peerId: span.peerId,
      startCounter: span.startCounter,
      endCounter: span.endCounter,
      updateId: span.updateId,
      sequence: meta.sequence,
      writerUserId: meta.writerUserId,
      writerKeyFingerprint: meta.writerKeyFingerprint,
      isBaseline: meta.isBaseline,
    });
  }

  return {
    documentId: input.documentId,
    segments: resolveEditAttribution(attributionSpans),
  };
}
