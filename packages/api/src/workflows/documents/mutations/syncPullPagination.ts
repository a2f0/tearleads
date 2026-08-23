import { Buffer } from "node:buffer";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import type { DocumentSyncPullPageResponse } from "@symcrypt/validators/response";
import {
  isUuidV4String,
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES,
} from "@symcrypt/validators/util";
import type { DocumentUpdateCursorPosition } from "../../../documents/documentUpdateStore";
import { decodeCursor, encodeCursor } from "../../../utils/cursor";
import { DocumentMutationError, documentSyncStateStale } from "./errors";

interface SyncPullIdentity {
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly linkSetManifestHash: string;
  readonly targetHash: string;
}

interface SyncPullCursor extends SyncPullIdentity {
  readonly afterUpdateId: string;
  readonly upperBoundUpdateId: string;
  readonly version: 1;
}

export interface SyncPullPagePlan {
  readonly afterSequence: number;
  readonly upperBoundUpdateId: string | null;
  readonly upperBoundSequence: number;
}

export function assertSyncPullResponseFits(
  response: unknown,
  maxBytes = MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES,
): void {
  if (Buffer.byteLength(JSON.stringify(response), "utf8") > maxBytes) {
    throw new DocumentMutationError(
      "Document sync response exceeds the pull page byte ceiling",
      409,
    );
  }
}

function invalidPullCursor(): DocumentMutationError {
  return new DocumentMutationError("Document pull cursor is invalid", 400);
}

function parsePullCursor(value: unknown): SyncPullCursor | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const afterUpdateId = Reflect.get(value, "afterUpdateId");
  const contentKeyEpoch = Reflect.get(value, "contentKeyEpoch");
  const documentId = Reflect.get(value, "documentId");
  const linkSetManifestHash = Reflect.get(value, "linkSetManifestHash");
  const targetHash = Reflect.get(value, "targetHash");
  const upperBoundUpdateId = Reflect.get(value, "upperBoundUpdateId");
  const version = Reflect.get(value, "version");
  if (
    version !== 1 ||
    typeof afterUpdateId !== "string" ||
    !isUuidV4String(afterUpdateId) ||
    typeof contentKeyEpoch !== "number" ||
    !Number.isSafeInteger(contentKeyEpoch) ||
    contentKeyEpoch < 1 ||
    typeof documentId !== "string" ||
    typeof linkSetManifestHash !== "string" ||
    typeof targetHash !== "string" ||
    typeof upperBoundUpdateId !== "string" ||
    !isUuidV4String(upperBoundUpdateId)
  ) {
    return undefined;
  }
  return {
    afterUpdateId,
    contentKeyEpoch,
    documentId,
    linkSetManifestHash,
    targetHash,
    upperBoundUpdateId,
    version,
  };
}

function cursorMatchesIdentity(
  cursor: SyncPullCursor,
  identity: SyncPullIdentity,
): boolean {
  return (
    cursor.contentKeyEpoch === identity.contentKeyEpoch &&
    cursor.documentId === identity.documentId &&
    cursor.linkSetManifestHash === identity.linkSetManifestHash &&
    cursor.targetHash === identity.targetHash
  );
}

export async function resolveSyncPullPagePlan(input: {
  readonly identity: SyncPullIdentity;
  readonly request: DocumentSyncRequest;
  readonly resolveCursorBounds: (input: {
    readonly afterUpdateId: string;
    readonly upperBoundUpdateId: string;
  }) => Promise<{
    readonly afterSequence: number;
    readonly upperBoundSequence: number;
  }>;
  readonly upperBound: DocumentUpdateCursorPosition | null;
}): Promise<SyncPullPagePlan | null> {
  if (input.request.supportsPullPagination !== true) {
    return null;
  }
  if (input.request.pullCursor === undefined) {
    return {
      afterSequence: 0,
      upperBoundSequence: input.upperBound?.sequence ?? 0,
      upperBoundUpdateId: input.upperBound?.id ?? null,
    };
  }

  const cursor = decodeCursor(
    input.request.pullCursor,
    parsePullCursor,
    invalidPullCursor,
  );
  if (!cursorMatchesIdentity(cursor, input.identity)) {
    throw documentSyncStateStale(
      "Document key state changed during paginated pull",
    );
  }
  const bounds = await input.resolveCursorBounds(cursor);
  return { ...bounds, upperBoundUpdateId: cursor.upperBoundUpdateId };
}

export function createSyncPullPageResponse(input: {
  readonly hasMore: boolean;
  readonly identity: SyncPullIdentity;
  readonly lastUpdateId: string | null;
  readonly plan: SyncPullPagePlan;
}): DocumentSyncPullPageResponse {
  let nextCursor: string | null = null;
  if (input.hasMore) {
    const afterUpdateId = input.lastUpdateId;
    const upperBoundUpdateId = input.plan.upperBoundUpdateId;
    if (afterUpdateId === null || upperBoundUpdateId === null) {
      throw new Error("Paginated document pull continuation is missing bounds");
    }
    nextCursor = encodeCursor({
      ...input.identity,
      afterUpdateId,
      upperBoundUpdateId,
      version: 1,
    } satisfies SyncPullCursor);
  }
  return {
    hasMore: input.hasMore,
    nextCursor,
  };
}
