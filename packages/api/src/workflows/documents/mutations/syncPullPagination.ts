import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncPullPageResponse } from "@tearleads/validators/response";
import {
  isUuidV4String,
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES,
} from "@tearleads/validators/util";
import { z } from "zod";
import {
  type DocumentUpdateCursorPosition,
  DocumentUpdateReadError,
} from "../../../documents/documentUpdateStore";
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
  readonly historyMode?: "raw" | undefined;
  readonly upperBoundUpdateId: string;
  readonly version: 1 | 2;
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
type RawSyncPullCursorPayloadWire = readonly [
  version: 2,
  historyMode: "raw",
  contentKeyEpoch: number,
  documentId: string,
  linkSetManifestHash: string,
  targetHash: string,
  afterUpdateId: string,
  upperBoundUpdateId: string,
];
type RawSyncPullCursorWire = readonly [
  ...payload: RawSyncPullCursorPayloadWire,
  signature: string,
];

const SYNC_PULL_CURSOR_HMAC_DOMAIN = "tearleads.document-sync-pull-cursor.v1";
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
  return documentSyncStateStale(
    "Document pull cursor is invalid; restart the pull",
  );
}

const uuidV4Schema = z.string().refine(isUuidV4String);
const contentKeyEpochSchema = z.int().min(1);
const signatureSchema = z.string().regex(BASE64URL_SHA256_PATTERN);
const pullCursorBodySchemas = [
  contentKeyEpochSchema,
  z.string(),
  z.string(),
  z.string(),
  uuidV4Schema,
  uuidV4Schema,
  signatureSchema,
] as const;

/** Version 1 is exactly 8 slots; raw-history version 2 is exactly 9. */
const PullCursorWireSchema = z.union([
  z.tuple([z.literal(1), ...pullCursorBodySchemas]),
  z.tuple([z.literal(2), z.literal("raw"), ...pullCursorBodySchemas]),
]);

type PullCursorBody = readonly [
  contentKeyEpoch: number,
  documentId: string,
  linkSetManifestHash: string,
  targetHash: string,
  afterUpdateId: string,
  upperBoundUpdateId: string,
  signature: string,
];

function pullCursorBody([
  contentKeyEpoch,
  documentId,
  linkSetManifestHash,
  targetHash,
  afterUpdateId,
  upperBoundUpdateId,
  signature,
]: PullCursorBody): Omit<SyncPullCursor, "historyMode" | "version"> {
  return {
    afterUpdateId,
    contentKeyEpoch,
    documentId,
    linkSetManifestHash,
    signature,
    targetHash,
    upperBoundUpdateId,
  };
}

function parsePullCursor(value: unknown): SyncPullCursor | undefined {
  const parsed = PullCursorWireSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.data[0] === 2) {
    const [version, historyMode, ...body] = parsed.data;
    return { ...pullCursorBody(body), historyMode, version };
  }
  const [version, ...body] = parsed.data;
  return { ...pullCursorBody(body), version };
}

function cursorPayloadWire(
  cursor: SyncPullCursorPayload,
): SyncPullCursorPayloadWire | RawSyncPullCursorPayloadWire {
  if (cursor.version === 2 && cursor.historyMode === "raw") {
    return [
      cursor.version,
      cursor.historyMode,
      cursor.contentKeyEpoch,
      cursor.documentId,
      cursor.linkSetManifestHash,
      cursor.targetHash,
      cursor.afterUpdateId,
      cursor.upperBoundUpdateId,
    ];
  }
  return [
    1,
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
  const signature = signPullCursor(cursor, cursorHmacKey);
  if (cursor.version === 2 && cursor.historyMode === "raw") {
    return encodeCursor([
      cursor.version,
      cursor.historyMode,
      cursor.contentKeyEpoch,
      cursor.documentId,
      cursor.linkSetManifestHash,
      cursor.targetHash,
      cursor.afterUpdateId,
      cursor.upperBoundUpdateId,
      signature,
    ] satisfies RawSyncPullCursorWire);
  }
  return encodeCursor([
    1,
    cursor.contentKeyEpoch,
    cursor.documentId,
    cursor.linkSetManifestHash,
    cursor.targetHash,
    cursor.afterUpdateId,
    cursor.upperBoundUpdateId,
    signature,
  ] satisfies SyncPullCursorWire);
}

function cursorMatchesIdentity(
  cursor: SyncPullCursor,
  identity: SyncPullIdentity,
  historyMode: DocumentSyncRequest["historyMode"],
): boolean {
  return (
    cursor.contentKeyEpoch === identity.contentKeyEpoch &&
    cursor.documentId === identity.documentId &&
    cursor.linkSetManifestHash === identity.linkSetManifestHash &&
    cursor.targetHash === identity.targetHash &&
    cursor.historyMode === historyMode
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
  if (
    !cursorMatchesIdentity(cursor, input.identity, input.request.historyMode)
  ) {
    throw documentSyncStateStale(
      "Document key state changed during paginated pull",
    );
  }
  let bounds: Awaited<ReturnType<typeof input.resolveCursorBounds>>;
  try {
    bounds = await input.resolveCursorBounds(cursor);
  } catch (error) {
    if (error instanceof DocumentUpdateReadError && error.status === 400) {
      throw documentSyncStateStale(
        "Document pull cursor bounds changed; restart the pull",
      );
    }
    throw error;
  }
  return { ...bounds, upperBoundUpdateId: cursor.upperBoundUpdateId };
}

export function createSyncPullPageResponse(input: {
  readonly cursorHmacKey: string | null;
  readonly hasMore: boolean;
  readonly historyMode?: DocumentSyncRequest["historyMode"];
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
        ...(input.historyMode === "raw" ? { historyMode: "raw" as const } : {}),
        upperBoundUpdateId,
        version: input.historyMode === "raw" ? 2 : 1,
      },
      input.cursorHmacKey,
    );
  }
  return {
    hasMore: input.hasMore,
    nextCursor,
  };
}
