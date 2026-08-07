import {
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  containerDocumentSyncTombstones,
  containerMetadataDocuments,
  documents,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import type { ContainerAccessLevel } from "@tearleads/crypto";
import type {
  ContainerDocumentSummary,
  ContainerDocumentSyncTombstone,
  ListContainerDocumentsResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { uniqueSortedStrings } from "../../utils/array";
import { textExpression } from "../../utils/sqlDialect";
import type {
  ContainerAccessProjection,
  ContainerWriterProjectionContext,
} from "../../workflows/containers/writerProjection";
import {
  collectReferencedPrincipalsFromContainerAccess,
  KeyingReadAccessError,
  resolveReadableContainerAccess,
  resolveReadableContainerAccessBatch,
} from "../../workflows/keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";
import {
  normalizeSyncPageLimit,
  normalizeSyncWatermark,
  watermarkPredicate,
} from "./syncPaging";
import { createContainerWriterProjectionContext } from "./writerProjection";

interface ListContainerDocumentsOptions {
  readonly limit?: number | undefined;
  readonly watermark?: SyncWatermark | null;
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
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

async function requireReadableContainer(
  runtime: ApiServiceRuntime,
  containerId: string,
  userId: string,
  context?: ContainerWriterProjectionContext,
) {
  try {
    return await resolveReadableContainerAccess({
      containerId,
      ...(context ? { context } : {}),
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

const ACCESS_LEVEL_RANK: Record<ContainerAccessLevel, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

function maxAccessLevel(
  current: ContainerAccessLevel | null,
  incoming: ContainerAccessLevel,
): ContainerAccessLevel {
  if (
    current === null ||
    ACCESS_LEVEL_RANK[incoming] > ACCESS_LEVEL_RANK[current]
  ) {
    return incoming;
  }

  return current;
}

async function resolveDocumentContainerAccessById(input: {
  readonly containerAccess: ContainerAccessProjection;
  readonly containerId: string;
  readonly context: ContainerWriterProjectionContext;
  readonly linkedContainerIdsByManifestHash: ReadonlyMap<
    string,
    readonly string[]
  >;
  readonly runtime: ApiServiceRuntime;
  readonly userId: string;
}): Promise<Map<string, ContainerAccessProjection>> {
  const accessByContainerId = new Map<string, ContainerAccessProjection>([
    [input.containerId, input.containerAccess],
  ]);
  const containerIds = Array.from(
    new Set(Array.from(input.linkedContainerIdsByManifestHash.values()).flat()),
  ).filter((containerId) => containerId !== input.containerId);
  if (containerIds.length === 0) {
    return accessByContainerId;
  }

  const accessResults = await resolveReadableContainerAccessBatch({
    containerIds,
    context: input.context,
    executor: input.runtime.db,
    userId: input.userId,
  });

  for (const [containerId, result] of accessResults) {
    if (result.status === "fulfilled") {
      accessByContainerId.set(containerId, result.value);
      continue;
    }
    if (result.reason.status === 403 || result.reason.status === 404) {
      continue;
    }

    throw result.reason;
  }

  return accessByContainerId;
}

function documentAccessPaths(input: {
  readonly accessByContainerId: ReadonlyMap<string, ContainerAccessProjection>;
  readonly fallbackAccess: ContainerAccessProjection;
  readonly linkedContainerIds: readonly string[];
}): ContainerAccessProjection[] {
  const accessPaths = input.linkedContainerIds.flatMap((containerId) => {
    const access = input.accessByContainerId.get(containerId);
    return access ? [access] : [];
  });

  return accessPaths.length > 0 ? accessPaths : [input.fallbackAccess];
}

function effectiveDocumentAccessLevel(
  accessPaths: readonly ContainerAccessProjection[],
): ContainerAccessLevel {
  return (
    accessPaths.reduce<ContainerAccessLevel | null>(
      (current, accessPath) => maxAccessLevel(current, accessPath.accessLevel),
      null,
    ) ?? "read"
  );
}

async function loadCurrentContainerDocumentRows(input: {
  readonly containerId: string;
  readonly limit: number;
  readonly runtime: ApiServiceRuntime;
  readonly watermark: SyncWatermark | null;
}): Promise<ContainerDocumentRow[]> {
  return (
    input.runtime.db
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
          eq(
            accessManifestDocumentLinkProjection.containerId,
            input.containerId,
          ),
        ),
      )
      .innerJoin(documents, eq(documents.id, accessManifestHeads.objectId))
      .leftJoin(
        containerMetadataDocuments,
        eq(containerMetadataDocuments.documentId, documents.id),
      )
      .leftJoin(
        organizationRosterEntries,
        eq(organizationRosterEntries.profileDocumentId, documents.id),
      )
      // Container metadata documents sync through the container tree itself, and
      // roster profile documents carry member PII that must stay Admins-scoped —
      // both are withheld from generic container-document discovery. The
      // organization profile document is deliberately NOT excluded: it lives in a
      // Members-granted metadata container, so serving it here (gated by the
      // container read-access check above) is how active members discover and
      // decrypt the org's display name.
      .where(sql`
      ${accessManifestHeads.objectKind} = ${"document"}
      and ${containerMetadataDocuments.documentId} is null
      and ${organizationRosterEntries.profileDocumentId} is null
      ${watermarkPredicate(
        sql`${documents.updatedAt}`,
        textExpression(sql`${accessManifestHeads.objectId}`),
        input.watermark,
      )}
    `)
      .orderBy(asc(documents.updatedAt), asc(accessManifestHeads.objectId))
      .limit(input.limit + 1)
  );
}

async function loadContainerDocumentTombstoneRows(input: {
  readonly containerId: string;
  readonly limit: number;
  readonly runtime: ApiServiceRuntime;
  readonly watermark: SyncWatermark | null;
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
        sql`${containerDocumentSyncTombstones.updatedAt}`,
        textExpression(sql`${containerDocumentSyncTombstones.documentId}`),
        input.watermark,
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
      uniqueSortedStrings(linkedContainerIds),
    );
  }

  return linkedContainerIdsByManifestHash;
}

function documentChangeUpdatedAt(
  change: ContainerDocumentSummary | ContainerDocumentSyncTombstone,
): string {
  return change.updatedAt;
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
): SyncWatermark {
  return {
    updatedAt: documentChangeUpdatedAt(change),
    id: documentChangeId(change),
  };
}

async function buildListContainerDocumentsResponse(input: {
  readonly containerAccess: ContainerAccessProjection;
  readonly containerId: string;
  readonly context: ContainerWriterProjectionContext;
  readonly documentRows: readonly ContainerDocumentRow[];
  readonly limit: number;
  readonly runtime: ApiServiceRuntime;
  readonly tombstoneRows: readonly ContainerDocumentTombstoneRow[];
  readonly userId: string;
  readonly watermark: SyncWatermark | null;
}): Promise<ListContainerDocumentsResponse> {
  const linkedContainerIdsByManifestHash =
    await loadLinkedContainerIdsByManifestHash(
      input.runtime,
      input.documentRows.map((row) => row.manifestHash),
    );
  const accessByContainerId = await resolveDocumentContainerAccessById({
    containerAccess: input.containerAccess,
    containerId: input.containerId,
    context: input.context,
    linkedContainerIdsByManifestHash,
    runtime: input.runtime,
    userId: input.userId,
  });
  const items: ContainerDocumentSummary[] = input.documentRows
    .slice(0, input.limit)
    .map((documentRow) => {
      const linkedContainerIds =
        linkedContainerIdsByManifestHash.get(documentRow.manifestHash) ?? [];
      const accessPaths = documentAccessPaths({
        accessByContainerId,
        fallbackAccess: input.containerAccess,
        linkedContainerIds,
      });

      return {
        createdAt: documentRow.createdAt.toISOString(),
        currentAccessEpoch: documentRow.manifestEpoch,
        currentAccessStateHash: documentRow.manifestHash,
        effectiveAccessLevel: effectiveDocumentAccessLevel(accessPaths),
        id: documentRow.documentId,
        linkedContainerIds,
        referencedPrincipals:
          collectReferencedPrincipalsFromContainerAccess(accessPaths),
        updatedAt: documentRow.updatedAt.toISOString(),
      };
    });
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
    lastChange === null ? input.watermark : documentChangeWatermark(lastChange);

  return {
    hasMore,
    items: items.filter((item) => itemIds.has(item.id)),
    nextWatermark,
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
  const limit = normalizeSyncPageLimit(
    options.limit,
    () => new ListContainerDocumentsError("Invalid limit", 400),
  );
  const watermark = normalizeSyncWatermark(
    options.watermark,
    () => new ListContainerDocumentsError("Invalid watermark", 400),
  );

  const context = createContainerWriterProjectionContext(runtime.db);
  const containerAccess = await requireReadableContainer(
    runtime,
    containerId,
    userId,
    context,
  );
  const [documentRows, tombstoneRows] = await Promise.all([
    loadCurrentContainerDocumentRows({
      containerId,
      limit,
      runtime,
      watermark,
    }),
    loadContainerDocumentTombstoneRows({
      containerId,
      limit,
      runtime,
      watermark,
    }),
  ]);
  return buildListContainerDocumentsResponse({
    containerAccess,
    containerId,
    context,
    documentRows,
    limit,
    runtime,
    tombstoneRows,
    userId,
    watermark,
  });
}
