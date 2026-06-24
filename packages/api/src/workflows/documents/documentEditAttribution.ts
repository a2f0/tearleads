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
  const [updates, headers, baselines] = await Promise.all([
    executor
      .select({ id: documentUpdates.id, sequence: documentUpdates.sequence })
      .from(documentUpdates)
      .where(eq(documentUpdates.documentId, documentId)),
    executor
      .select({
        updateId: documentContentWriteHeaders.updateId,
        header: documentContentWriteHeaders.header,
      })
      .from(documentContentWriteHeaders)
      .where(eq(documentContentWriteHeaders.documentId, documentId)),
    executor
      .select({ baselineUpdateId: documentAuditCheckpoints.baselineUpdateId })
      .from(documentAuditCheckpoints)
      .where(
        and(
          eq(documentAuditCheckpoints.documentId, documentId),
          eq(documentAuditCheckpoints.checkpointKind, "rotate_baseline"),
        ),
      ),
  ]);

  const sequenceByUpdateId = new Map(
    updates.map((update) => [update.id, update.sequence]),
  );
  const baselineUpdateIds = new Set(
    baselines.map((baseline) => baseline.baselineUpdateId),
  );
  const meta = new Map<string, UpdateAttributionMeta>();
  for (const { updateId, header } of headers) {
    const sequence = sequenceByUpdateId.get(updateId);
    if (sequence === undefined) {
      continue;
    }
    meta.set(updateId, {
      sequence,
      writerUserId: header.writerUserId,
      writerKeyFingerprint: header.writerKeyFingerprint,
      isBaseline: baselineUpdateIds.has(updateId),
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
      continue;
    }
    attributionSpans.push({
      peerId: span.peerId,
      startCounter: span.startCounter,
      endCounter: span.endCounter,
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
