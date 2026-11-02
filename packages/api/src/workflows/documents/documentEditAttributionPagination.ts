import type {
  DocumentEditAttributionRangeResponse,
  ListDocumentEditAttributionRangesResponse,
} from "@tearleads/validators/response";
import { z } from "zod";
import type { DocumentEditAttributionSegment } from "../../documents/documentEditAttribution";
import { decodeCursor, encodeCursor } from "../../utils/cursor";

interface AttributionIdentity {
  readonly attributionScope: string;
  readonly attributionRevision: number;
  readonly documentId: string;
}

interface AttributionRangeData extends AttributionIdentity {
  readonly segments: readonly DocumentEditAttributionSegment[];
}

interface AttributionRangeCursor extends AttributionIdentity {
  readonly offset: number;
  readonly version: 1;
}

interface AttributionRangeRequest {
  readonly cursor?: string | undefined;
  readonly expectedRevision?: number | undefined;
  readonly limit?: number | undefined;
}

const DEFAULT_ATTRIBUTION_RANGE_LIMIT = 100;
const MAX_ATTRIBUTION_RANGE_LIMIT = 500;

export class DocumentEditAttributionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
    this.name = "DocumentEditAttributionError";
  }
}

function invalidRangeCursor(): DocumentEditAttributionError {
  return new DocumentEditAttributionError(
    "Document attribution range cursor is invalid",
    400,
  );
}

function encodeRangeCursor(cursor: AttributionRangeCursor): string {
  return encodeCursor(cursor);
}

const nonNegativeSafeIntegerSchema = z.int().nonnegative();

/** Unknown keys are ignored; the parsed cursor carries only these fields. */
const AttributionRangeCursorSchema = z.object({
  attributionRevision: nonNegativeSafeIntegerSchema,
  attributionScope: z.string(),
  documentId: z.string(),
  offset: nonNegativeSafeIntegerSchema,
  version: z.literal(1),
});

function parseRangeCursor(
  decoded: unknown,
): AttributionRangeCursor | undefined {
  return AttributionRangeCursorSchema.safeParse(decoded).data;
}

function decodeRangeCursor(value: string): AttributionRangeCursor {
  return decodeCursor(value, parseRangeCursor, invalidRangeCursor);
}

function normalizeRangeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_ATTRIBUTION_RANGE_LIMIT;
  }
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_ATTRIBUTION_RANGE_LIMIT
  ) {
    throw new DocumentEditAttributionError(
      `Document attribution range limit must be between 1 and ${MAX_ATTRIBUTION_RANGE_LIMIT}`,
      400,
    );
  }
  return limit;
}

function rangeCursorForAttribution(
  attribution: AttributionIdentity,
  value: string | undefined,
): AttributionRangeCursor | null {
  const cursor = value === undefined ? null : decodeRangeCursor(value);
  if (
    cursor &&
    (cursor.documentId !== attribution.documentId ||
      cursor.attributionScope !== attribution.attributionScope)
  ) {
    throw invalidRangeCursor();
  }
  if (
    cursor &&
    cursor.attributionRevision !== attribution.attributionRevision
  ) {
    throw new DocumentEditAttributionError(
      "Document attribution range cursor is stale",
      409,
    );
  }
  return cursor;
}

export function validateDocumentEditAttributionRangesRequest(
  attribution: AttributionIdentity,
  input: AttributionRangeRequest,
): void {
  normalizeRangeLimit(input.limit);
  if (
    input.expectedRevision !== undefined &&
    (!Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0)
  ) {
    throw new DocumentEditAttributionError(
      "Document attribution expected revision is invalid",
      400,
    );
  }
  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== attribution.attributionRevision
  ) {
    throw new DocumentEditAttributionError(
      "Document attribution expected revision is stale",
      409,
    );
  }
  rangeCursorForAttribution(attribution, input.cursor);
}

function toRangeResponse(
  segment: DocumentEditAttributionSegment,
): DocumentEditAttributionRangeResponse {
  return {
    authorityKind: segment.authorityKind,
    endCounter: segment.endCounter,
    peerId: segment.peerId,
    startCounter: segment.startCounter,
    updateId: segment.updateId,
    writerKeyFingerprint: segment.writerKeyFingerprint,
    writerUserId: segment.writerUserId,
  };
}

export function createDocumentEditAttributionRangesPage(
  attribution: AttributionRangeData,
  input: AttributionRangeRequest,
): ListDocumentEditAttributionRangesResponse {
  validateDocumentEditAttributionRangesRequest(attribution, input);
  const limit = normalizeRangeLimit(input.limit);
  const cursor = rangeCursorForAttribution(attribution, input.cursor);
  const offset = cursor?.offset ?? 0;
  if (offset > attribution.segments.length) {
    throw invalidRangeCursor();
  }
  const items = attribution.segments
    .slice(offset, offset + limit)
    .map(toRangeResponse);
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < attribution.segments.length;
  return {
    attributionRevision: attribution.attributionRevision,
    documentId: attribution.documentId,
    hasMore,
    items,
    nextCursor: hasMore
      ? encodeRangeCursor({
          attributionScope: attribution.attributionScope,
          attributionRevision: attribution.attributionRevision,
          documentId: attribution.documentId,
          offset: nextOffset,
          version: 1,
        })
      : null,
  };
}
