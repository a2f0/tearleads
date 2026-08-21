import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import {
  documentAuditCheckpoints,
  documentContentWriteHeaders,
  documents,
  documentUpdateSpans,
  documentUpdates,
} from "@symcrypt/api-shared/schema";
import type {
  DocumentEditAttributionResponse,
  DocumentEditAttributionSegmentResponse,
} from "@symcrypt/validators/response";
import { and, eq, sql } from "drizzle-orm";
import {
  type AttributionSpanInput,
  type DocumentEditAttributionSegment,
  resolveEditAttribution,
} from "../../documents/documentEditAttribution";
import { booleanExpression, jsonTextProperty } from "../../utils/sqlDialect";
import {
  KeyingReadAccessError,
  resolveReadableDocumentAccess,
} from "../keyingReadAccess";
import { DocumentEditAttributionError } from "./documentEditAttributionPagination";

export {
  createDocumentEditAttributionRangesPage,
  DocumentEditAttributionError,
  validateDocumentEditAttributionRangesRequest,
} from "./documentEditAttributionPagination";

interface DocumentEditAttributionWorkflowInput {
  readonly documentId: string;
  readonly userId: string;
}

export interface ComputedDocumentEditAttribution {
  readonly attributionScope: string;
  readonly attributionRevision: number;
  readonly documentId: string;
  readonly documentIncarnation: string;
  readonly segments: DocumentEditAttributionSegment[];
}

export interface PreparedDocumentEditAttribution {
  readonly attributionScope: string;
  readonly attributionRevision: number;
  readonly documentId: string;
  readonly documentIncarnation: string;
}

export const MAX_COMPACT_ATTRIBUTION_SEGMENTS = 2_000;

function requireAttributionText(
  value: string | null,
  property: string,
  updateId: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Attribution update ${updateId} has no valid ${property} in its write header.`,
    );
  }
  return value;
}

async function loadDocumentAttributionRows(
  documentId: string,
  executor: DatabaseSession,
) {
  return executor
    .select({
      attributionIncarnation: documents.attributionIncarnation,
      attributionRevision: documents.attributionRevision,
      updateId: documentUpdateSpans.updateId,
      peerId: documentUpdateSpans.peerId,
      startCounter: documentUpdateSpans.startCounter,
      endCounter: documentUpdateSpans.endCounter,
      sequence: documentUpdates.sequence,
      writerUserId: sql<
        string | null
      >`${jsonTextProperty(sql`${documentContentWriteHeaders.header}`, "writerUserId")}`,
      writerKeyFingerprint: sql<
        string | null
      >`${jsonTextProperty(sql`${documentContentWriteHeaders.header}`, "writerKeyFingerprint")}`,
      isBaseline: booleanExpression(
        sql`${documentAuditCheckpoints.baselineUpdateId} is not null`,
      ),
    })
    .from(documents)
    .leftJoin(
      documentUpdateSpans,
      eq(documentUpdateSpans.documentId, documents.id),
    )
    .leftJoin(
      documentUpdates,
      and(
        eq(documentUpdates.id, documentUpdateSpans.updateId),
        eq(documentUpdates.documentId, documentUpdateSpans.documentId),
      ),
    )
    .leftJoin(
      documentContentWriteHeaders,
      and(
        eq(documentContentWriteHeaders.updateId, documentUpdateSpans.updateId),
        eq(
          documentContentWriteHeaders.documentId,
          documentUpdateSpans.documentId,
        ),
      ),
    )
    .leftJoin(
      documentAuditCheckpoints,
      and(
        eq(
          documentAuditCheckpoints.baselineUpdateId,
          documentUpdateSpans.updateId,
        ),
        eq(documentAuditCheckpoints.documentId, documentUpdateSpans.documentId),
        eq(documentAuditCheckpoints.checkpointKind, "rotate_baseline"),
      ),
    )
    .where(eq(documents.id, documentId));
}

type DocumentAttributionRow = Awaited<
  ReturnType<typeof loadDocumentAttributionRows>
>[number];

function attributionSpanFromRow(
  span: DocumentAttributionRow,
): AttributionSpanInput | null {
  if (span.updateId === null) {
    return null;
  }
  if (span.sequence === null) {
    throw new Error(
      `Attribution span references missing update ${span.updateId}.`,
    );
  }
  if (
    span.peerId === null ||
    span.startCounter === null ||
    span.endCounter === null
  ) {
    throw new Error(
      `Attribution update ${span.updateId} has an incomplete span.`,
    );
  }

  return {
    peerId: span.peerId,
    startCounter: span.startCounter,
    endCounter: span.endCounter,
    updateId: span.updateId,
    sequence: span.sequence,
    writerUserId: requireAttributionText(
      span.writerUserId,
      "writerUserId",
      span.updateId,
    ),
    writerKeyFingerprint: requireAttributionText(
      span.writerKeyFingerprint,
      "writerKeyFingerprint",
      span.updateId,
    ),
    isBaseline: span.isBaseline,
  };
}

/**
 * Load the attribution revision, spans, and signing identities in one database
 * snapshot. The documents-first left join deliberately returns a revision row
 * for documents that do not have any spans yet.
 */
export async function computeDocumentEditAttribution(
  documentId: string,
  executor: DatabaseSession,
  attributionScope = "",
): Promise<ComputedDocumentEditAttribution> {
  const spanRows = await loadDocumentAttributionRows(documentId, executor);

  const firstRow = spanRows[0];
  if (!firstRow) {
    throw new DocumentEditAttributionError("Document not found", 404);
  }

  const attributionSpans = spanRows.flatMap((span) => {
    const attributionSpan = attributionSpanFromRow(span);
    return attributionSpan ? [attributionSpan] : [];
  });

  return {
    attributionScope,
    attributionRevision: firstRow.attributionRevision,
    documentId,
    documentIncarnation: firstRow.attributionIncarnation,
    segments: resolveEditAttribution(attributionSpans),
  };
}

function sameCompactAuthority(
  left: DocumentEditAttributionSegmentResponse,
  right: DocumentEditAttributionSegmentResponse,
): boolean {
  return (
    left.peerId === right.peerId &&
    left.writerUserId === right.writerUserId &&
    left.writerKeyFingerprint === right.writerKeyFingerprint &&
    left.authorityKind === right.authorityKind
  );
}

function compactDocumentEditAttributionSegmentsUpTo(
  segments: readonly DocumentEditAttributionSegment[],
  limit: number,
): {
  readonly segments: DocumentEditAttributionSegmentResponse[];
  readonly truncated: boolean;
} {
  const compact: DocumentEditAttributionSegmentResponse[] = [];
  for (const segment of segments) {
    const next: DocumentEditAttributionSegmentResponse = {
      authorityKind: segment.authorityKind,
      endCounter: segment.endCounter,
      peerId: segment.peerId,
      startCounter: segment.startCounter,
      writerKeyFingerprint: segment.writerKeyFingerprint,
      writerUserId: segment.writerUserId,
    };
    const previous = compact.at(-1);
    if (
      previous &&
      previous.endCounter === next.startCounter &&
      sameCompactAuthority(previous, next)
    ) {
      previous.endCounter = next.endCounter;
    } else {
      if (compact.length >= limit) {
        return { segments: compact, truncated: true };
      }
      compact.push(next);
    }
  }
  return { segments: compact, truncated: false };
}

export function compactDocumentEditAttributionSegments(
  segments: readonly DocumentEditAttributionSegment[],
): DocumentEditAttributionSegmentResponse[] {
  return compactDocumentEditAttributionSegmentsUpTo(
    segments,
    Number.POSITIVE_INFINITY,
  ).segments;
}

function boundedCompactDocumentEditAttributionSegments(
  segments: readonly DocumentEditAttributionSegment[],
): {
  readonly segments: DocumentEditAttributionSegmentResponse[];
  readonly truncated: boolean;
} {
  return compactDocumentEditAttributionSegmentsUpTo(
    segments,
    MAX_COMPACT_ATTRIBUTION_SEGMENTS,
  );
}

async function requireReadableAttributionDocument(
  executor: DatabaseSession,
  input: DocumentEditAttributionWorkflowInput,
): Promise<string> {
  try {
    const access = await resolveReadableDocumentAccess({
      documentId: input.documentId,
      executor,
      userId: input.userId,
    });
    return access.currentAccessStateHash;
  } catch (error) {
    if (error instanceof KeyingReadAccessError) {
      throw new DocumentEditAttributionError(error.message, error.status);
    }
    throw error;
  }
}

interface DocumentAttributionIdentity {
  readonly attributionRevision: number;
  readonly documentIncarnation: string;
}

async function loadDocumentAttributionIdentity(
  executor: DatabaseSession,
  documentId: string,
): Promise<DocumentAttributionIdentity | undefined> {
  const [document] = await executor
    .select({
      attributionIncarnation: documents.attributionIncarnation,
      attributionRevision: documents.attributionRevision,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  return document
    ? {
        attributionRevision: document.attributionRevision,
        documentIncarnation: document.attributionIncarnation,
      }
    : undefined;
}

type RequireReadableAttributionDocument =
  typeof requireReadableAttributionDocument;

export async function runPrepareDocumentEditAttributionWorkflow(
  executor: DatabaseSession,
  input: DocumentEditAttributionWorkflowInput,
  authorizeDocument: RequireReadableAttributionDocument = requireReadableAttributionDocument,
): Promise<PreparedDocumentEditAttribution> {
  const identityBeforeAuthorization = await loadDocumentAttributionIdentity(
    executor,
    input.documentId,
  );
  if (!identityBeforeAuthorization) {
    throw new DocumentEditAttributionError("Document not found", 404);
  }

  const accessStateHash = await authorizeDocument(executor, input);
  const identityAfterAuthorization = await loadDocumentAttributionIdentity(
    executor,
    input.documentId,
  );
  if (
    !identityAfterAuthorization ||
    identityAfterAuthorization.documentIncarnation !==
      identityBeforeAuthorization.documentIncarnation
  ) {
    throw new DocumentEditAttributionError(
      "Document attribution incarnation changed while authorizing",
      409,
    );
  }

  return {
    attributionScope: `${identityAfterAuthorization.documentIncarnation}:${accessStateHash}`,
    attributionRevision: identityAfterAuthorization.attributionRevision,
    documentId: input.documentId,
    documentIncarnation: identityAfterAuthorization.documentIncarnation,
  };
}

export function createDocumentEditAttributionResponse(
  attribution: ComputedDocumentEditAttribution,
): DocumentEditAttributionResponse {
  const compact = boundedCompactDocumentEditAttributionSegments(
    attribution.segments,
  );
  return {
    attributionRevision: attribution.attributionRevision,
    documentId: attribution.documentId,
    segments: compact.segments,
    truncated: compact.truncated,
  };
}

export async function runPreparedDocumentEditAttributionDataWorkflow(
  executor: DatabaseSession,
  prepared: PreparedDocumentEditAttribution,
): Promise<ComputedDocumentEditAttribution> {
  const attribution = await computeDocumentEditAttribution(
    prepared.documentId,
    executor,
    prepared.attributionScope,
  );
  if (attribution.documentIncarnation !== prepared.documentIncarnation) {
    throw new DocumentEditAttributionError(
      "Document attribution incarnation changed while loading",
      409,
    );
  }
  return attribution;
}
