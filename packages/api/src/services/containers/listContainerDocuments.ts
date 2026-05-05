import type {
  ContainerDocumentSummary,
  ContainerDocumentSyncTombstone,
  ListContainerDocumentsResponse,
} from "@tearleads/validators/response";
import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import {
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  containerDocumentSyncTombstones,
  containerMetadataDocuments,
  documents,
} from "../../schema";
import {
  collectReferencedPrincipalsFromContainerAccess,
  KeyingReadAccessError,
  resolveReadableContainerAccess,
} from "../../workflows/keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";
import {
  assertContainerSyncCursorReadBarrier,
  assertContainerSyncCursorScope,
  ContainerSyncCursorError,
  type ContainerSyncCursorPayload,
  type ContainerSyncWatermark,
  createContainerSyncCursor,
  decodeContainerSyncCursor,
} from "./syncCursor";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

interface ListContainerDocumentsOptions {
  readonly cursor?: string | null;
  readonly limit?: number | undefined;
}

type ContainerDocumentRow = {
  createdAt: Date;
  documentId: string;
  manifestHash: string;
  manifestEpoch: number;
  updatedAt: Date;
};

type ContainerDocumentTombstoneRow = {
  documentId: string;
  updatedAt: Date;
};

export class ListContainerDocumentsError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(message);
  }
}

async function requireReadableContainer(
  runtime: ApiServiceRuntime,
  containerId: string,
  userId: string,
) {
  try {
    return await resolveReadableContainerAccess({
      containerId,
      executor: runtime.db,
      userId,
    });
  } catch (error) {
    if (error instanceof KeyingReadAccessError) {
      throw new ListContainerDocumentsError(error.message, error.status);
    }
    throw error;
  }
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new ListContainerDocumentsError("Invalid limit", 400);
  }
  return Math.min(value, MAX_LIMIT);
}

function watermarkPredicate(
  tableAlias: string,
  watermark: ContainerSyncWatermark | null | undefined,
  idColumn = "id",
): SQL {
  if (!watermark) {
    return sql``;
  }

  return sql`and (${sql.raw(`${tableAlias}.updated_at`)}, ${sql.raw(
    `${tableAlias}.${idColumn}`,
  )}::text) > (${new Date(watermark.updatedAt)}, ${watermark.id})`;
}

function validateCursor(input: {
  cursorToken: string | null | undefined;
  containerId: string;
  userId: string;
}): ContainerSyncCursorPayload | null {
  try {
    const cursor = decodeContainerSyncCursor(input.cursorToken);
    assertContainerSyncCursorScope(cursor, {
      lane: "containerDocuments",
      scope: { containerId: input.containerId, userId: input.userId },
    });
    return cursor;
  } catch (error) {
    if (error instanceof ContainerSyncCursorError) {
      throw new ListContainerDocumentsError(error.message, 400);
    }
    throw error;
  }
}

async function loadCurrentContainerDocumentRows(input: {
  readonly containerId: string;
  readonly cursor: ContainerSyncCursorPayload | null;
  readonly limit: number;
  readonly runtime: ApiServiceRuntime;
}): Promise<ContainerDocumentRow[]> {
  return input.runtime.db
    .select({
      createdAt: documents.createdAt,
      documentId: accessManifestHeads.objectId,
      manifestHash: accessManifestHeads.manifestHash,
      manifestEpoch: accessManifestHeads.epoch,
      updatedAt: documents.updatedAt,
    })
    .from(accessManifestHeads)
    .innerJoin(
      accessManifestDocumentLinkProjection,
      and(
        eq(
          accessManifestDocumentLinkProjection.manifestHash,
          accessManifestHeads.manifestHash,
        ),
        eq(accessManifestDocumentLinkProjection.containerId, input.containerId),
      ),
    )
    .innerJoin(
      documents,
      sql`${documents.id}::text = ${accessManifestHeads.objectId}`,
    )
    .leftJoin(
      containerMetadataDocuments,
      eq(containerMetadataDocuments.documentId, documents.id),
    )
    .where(sql`
      ${accessManifestHeads.objectKind} = ${"document"}
      and ${containerMetadataDocuments.documentId} is null
      ${watermarkPredicate("documents", input.cursor?.watermark)}
    `)
    .orderBy(asc(documents.updatedAt), asc(accessManifestHeads.objectId))
    .limit(input.limit + 1);
}

async function loadContainerDocumentTombstoneRows(input: {
  readonly containerId: string;
  readonly cursor: ContainerSyncCursorPayload | null;
  readonly limit: number;
  readonly runtime: ApiServiceRuntime;
}): Promise<ContainerDocumentTombstoneRow[]> {
  return input.runtime.db
    .select({
      documentId: containerDocumentSyncTombstones.documentId,
      updatedAt: containerDocumentSyncTombstones.updatedAt,
    })
    .from(containerDocumentSyncTombstones)
    .where(sql`
      ${containerDocumentSyncTombstones.containerId} = ${input.containerId}
      ${watermarkPredicate(
        "container_document_sync_tombstones",
        input.cursor?.watermark,
        "document_id",
      )}
    `)
    .orderBy(
      asc(containerDocumentSyncTombstones.updatedAt),
      asc(containerDocumentSyncTombstones.documentId),
    )
    .limit(input.limit + 1);
}

async function loadLinkedContainerIdsByManifestHash(
  runtime: ApiServiceRuntime,
  manifestHashes: ReadonlyArray<string>,
) {
  const linkedContainerRows =
    manifestHashes.length === 0
      ? []
      : await runtime.db
          .select({
            containerId: accessManifestDocumentLinkProjection.containerId,
            manifestHash: accessManifestDocumentLinkProjection.manifestHash,
          })
          .from(accessManifestDocumentLinkProjection)
          .where(
            inArray(
              accessManifestDocumentLinkProjection.manifestHash,
              manifestHashes,
            ),
          );
  const linkedContainerIdsByManifestHash = new Map<string, string[]>();

  for (const manifestHash of manifestHashes) {
    linkedContainerIdsByManifestHash.set(manifestHash, []);
  }

  for (const row of linkedContainerRows) {
    linkedContainerIdsByManifestHash
      .get(row.manifestHash)
      ?.push(row.containerId);
  }

  for (const [
    manifestHash,
    linkedContainerIds,
  ] of linkedContainerIdsByManifestHash) {
    linkedContainerIdsByManifestHash.set(
      manifestHash,
      [...new Set(linkedContainerIds)].sort(),
    );
  }

  return linkedContainerIdsByManifestHash;
}

function documentChangeUpdatedAt(
  change: ContainerDocumentSummary | ContainerDocumentSyncTombstone,
): string {
  return change.updatedAt ?? "";
}

function documentChangeId(
  change: ContainerDocumentSummary | ContainerDocumentSyncTombstone,
): string {
  return "id" in change ? change.id : change.documentId;
}

function compareDocumentChanges(
  left: ContainerDocumentSummary | ContainerDocumentSyncTombstone,
  right: ContainerDocumentSummary | ContainerDocumentSyncTombstone,
): number {
  const updatedAtOrder = documentChangeUpdatedAt(left).localeCompare(
    documentChangeUpdatedAt(right),
  );
  return updatedAtOrder === 0
    ? documentChangeId(left).localeCompare(documentChangeId(right))
    : updatedAtOrder;
}

function documentChangeWatermark(
  change: ContainerDocumentSummary | ContainerDocumentSyncTombstone,
): ContainerSyncWatermark {
  return {
    updatedAt: documentChangeUpdatedAt(change),
    id: documentChangeId(change),
  };
}

async function buildListContainerDocumentsResponse(input: {
  readonly containerId: string;
  readonly cursor: ContainerSyncCursorPayload | null;
  readonly documentRows: readonly ContainerDocumentRow[];
  readonly limit: number;
  readonly referencedPrincipals: ReturnType<
    typeof collectReferencedPrincipalsFromContainerAccess
  >;
  readonly runtime: ApiServiceRuntime;
  readonly tombstoneRows: readonly ContainerDocumentTombstoneRow[];
  readonly userId: string;
}): Promise<ListContainerDocumentsResponse> {
  const linkedContainerIdsByManifestHash =
    await loadLinkedContainerIdsByManifestHash(
      input.runtime,
      input.documentRows.map((row) => row.manifestHash),
    );
  const items: ContainerDocumentSummary[] = input.documentRows
    .slice(0, input.limit)
    .map((documentRow) => ({
      createdAt: documentRow.createdAt.toISOString(),
      currentAccessEpoch: documentRow.manifestEpoch,
      currentAccessStateHash: documentRow.manifestHash,
      id: documentRow.documentId,
      linkedContainerIds:
        linkedContainerIdsByManifestHash.get(documentRow.manifestHash) ?? [],
      referencedPrincipals: input.referencedPrincipals,
      updatedAt: documentRow.updatedAt.toISOString(),
    }));
  const tombstones: ContainerDocumentSyncTombstone[] = input.tombstoneRows
    .slice(0, input.limit)
    .map((row) => ({
      containerId: input.containerId,
      documentId: row.documentId,
      updatedAt: row.updatedAt.toISOString(),
    }));
  const returnedChanges = [...items, ...tombstones]
    .sort(compareDocumentChanges)
    .slice(0, input.limit);
  const itemIds = new Set(
    returnedChanges
      .filter((change): change is ContainerDocumentSummary => "id" in change)
      .map((change) => change.id),
  );
  const tombstoneIds = new Set(
    returnedChanges
      .filter(
        (change): change is ContainerDocumentSyncTombstone => !("id" in change),
      )
      .map((change) => change.documentId),
  );
  const lastChange = returnedChanges.at(-1) ?? null;
  const hasMore =
    input.documentRows.length > input.limit ||
    input.tombstoneRows.length > input.limit ||
    returnedChanges.length < items.length + tombstones.length;
  const nextWatermark =
    lastChange === null
      ? (input.cursor?.watermark ?? null)
      : documentChangeWatermark(lastChange);

  return {
    hasMore,
    items: items.filter((item) => itemIds.has(item.id)),
    nextCursor:
      nextWatermark === null
        ? null
        : await createContainerSyncCursor({
            executor: input.runtime.db,
            lane: "containerDocuments",
            scope: { containerId: input.containerId, userId: input.userId },
            watermark: nextWatermark,
          }),
    tombstones: tombstones.filter((tombstone) =>
      tombstoneIds.has(tombstone.documentId),
    ),
  };
}

export async function listContainerDocuments(
  runtime: ApiServiceRuntime,
  containerId: string,
  userId: string,
  options: ListContainerDocumentsOptions = {},
): Promise<ListContainerDocumentsResponse> {
  const limit = normalizeLimit(options.limit);
  const cursor = validateCursor({
    containerId,
    cursorToken: options.cursor,
    userId,
  });

  try {
    await assertContainerSyncCursorReadBarrier(runtime.db, cursor);
  } catch (error) {
    if (error instanceof ContainerSyncCursorError) {
      throw new ListContainerDocumentsError(error.message, 503);
    }
    throw error;
  }

  const containerAccess = await requireReadableContainer(
    runtime,
    containerId,
    userId,
  );
  const [documentRows, tombstoneRows] = await Promise.all([
    loadCurrentContainerDocumentRows({ containerId, cursor, limit, runtime }),
    loadContainerDocumentTombstoneRows({ containerId, cursor, limit, runtime }),
  ]);
  const referencedPrincipals = collectReferencedPrincipalsFromContainerAccess([
    containerAccess,
  ]);

  return buildListContainerDocumentsResponse({
    containerId,
    cursor,
    documentRows,
    limit,
    referencedPrincipals,
    runtime,
    tombstoneRows,
    userId,
  });
}
