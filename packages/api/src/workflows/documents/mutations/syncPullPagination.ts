import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
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

interface SyncPullCursorPayload extends SyncPullIdentity {
  readonly afterUpdateId: string;
  readonly upperBoundUpdateId: string;
  readonly version: 1;
}

interface SyncPullCursor extends SyncPullCursorPayload {
  readonly signature: string;
}

type SyncPullCursorPayloadWire = readonly [
  version: 1,
  contentKeyEpoch: number,
  documentId: string,
  linkSetManifestHash: string,
  targetHash: string,
  afterUpdateId: string,
  upperBoundUpdateId: string,
];
type SyncPullCursorWire = readonly [
  ...payload: SyncPullCursorPayloadWire,
  signature: string,
];

const SYNC_PULL_CURSOR_HMAC_DOMAIN = "symcrypt.document-sync-pull-cursor.v1";
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * This cursor is an authenticated read-progress token, not an authorization
 * capability. Its HMAC binds the document/key identity and both storage bounds;
 * every continuation also re-runs document authorization and key-state checks,
 * and both update ids must resolve inside that authenticated document.
 *
 * `minLsn` and untracked-LSN support intentionally remain request consistency
 * controls rather than server authority. The SDK carries the prior response's
 * checkpoint and rejects LSN/mode regression; a caller that drops those checks
 * can only weaken its own read, not the fixed cursor snapshot or shared state.
 */

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
  if (!Array.isArray(value) || value.length !== 8) {
    return undefined;
  }
  const [
    version,
    contentKeyEpoch,
    documentId,
    linkSetManifestHash,
    targetHash,
    afterUpdateId,
    upperBoundUpdateId,
    signature,
  ] = value;
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
    !isUuidV4String(upperBoundUpdateId) ||
    typeof signature !== "string" ||
    !BASE64URL_SHA256_PATTERN.test(signature)
  ) {
    return undefined;
  }
  return {
    afterUpdateId,
    contentKeyEpoch,
    documentId,
    linkSetManifestHash,
    signature,
    targetHash,
    upperBoundUpdateId,
    version,
  };
}

function cursorPayloadWire(
  cursor: SyncPullCursorPayload,
): SyncPullCursorPayloadWire {
  return [
    cursor.version,
    cursor.contentKeyEpoch,
    cursor.documentId,
    cursor.linkSetManifestHash,
    cursor.targetHash,
    cursor.afterUpdateId,
    cursor.upperBoundUpdateId,
  ];
}

function signPullCursor(
  cursor: SyncPullCursorPayload,
  cursorHmacKey: string,
): string {
  return createHmac("sha256", cursorHmacKey)
    .update(SYNC_PULL_CURSOR_HMAC_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(cursorPayloadWire(cursor)), "utf8")
    .digest("base64url");
}

function cursorSignatureIsValid(
  cursor: SyncPullCursor,
  cursorHmacKey: string,
): boolean {
  const presented = Buffer.from(cursor.signature, "base64url");
  const expected = Buffer.from(
    signPullCursor(cursor, cursorHmacKey),
    "base64url",
  );
  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  );
}

function encodePullCursor(
  cursor: SyncPullCursorPayload,
  cursorHmacKey: string,
): string {
  return encodeCursor([
    ...cursorPayloadWire(cursor),
    signPullCursor(cursor, cursorHmacKey),
  ] satisfies SyncPullCursorWire);
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
  readonly cursorHmacKey: string | null;
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
  if (
    input.cursorHmacKey === null ||
    !cursorSignatureIsValid(cursor, input.cursorHmacKey)
  ) {
    throw documentSyncStateStale(
      "Document pull cursor authentication changed; restart the pull",
    );
  }
  if (!cursorMatchesIdentity(cursor, input.identity)) {
    throw documentSyncStateStale(
      "Document key state changed during paginated pull",
    );
  }
  const bounds = await input.resolveCursorBounds(cursor);
  return { ...bounds, upperBoundUpdateId: cursor.upperBoundUpdateId };
}

export function createSyncPullPageResponse(input: {
  readonly cursorHmacKey: string | null;
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
    if (input.cursorHmacKey === null) {
      throw new Error(
        "Paginated document pull continuation signing is unavailable",
      );
    }
    nextCursor = encodePullCursor(
      {
        ...input.identity,
        afterUpdateId,
        upperBoundUpdateId,
        version: 1,
      },
      input.cursorHmacKey,
    );
  }
  return {
    hasMore: input.hasMore,
    nextCursor,
  };
}
