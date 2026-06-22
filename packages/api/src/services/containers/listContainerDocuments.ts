import {
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  containerDocumentSyncTombstones,
  containerMetadataDocuments,
  documents,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import type {
  ContainerDocumentSummary,
  ContainerDocumentSyncTombstone,
  ListContainerDocumentsResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { textExpression } from "../../utils/sqlDialect";
import {
  collectReferencedPrincipalsFromContainerAccess,
  KeyingReadAccessError,
  resolveReadableContainerAccess,
} from "../../workflows/keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";
import {
  normalizeSyncPageLimit,
  normalizeSyncWatermark,
  watermarkPredicate,
} from "./syncPaging";

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

async function loadCurrentContainerDocumentRows(input: {
  readonly containerId: string;
  readonly limit: number;
  readonly runtime: ApiServiceRuntime;
  readonly watermark: SyncWatermark | null;
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
    .innerJoin(documents, eq(documents.id, accessManifestHeads.objectId))
    .leftJoin(
      containerMetadataDocuments,
      eq(containerMetadataDocuments.documentId, documents.id),
    )
    .leftJoin(
      organizationRosterEntries,
      eq(organizationRosterEntries.profileDocumentId, documents.id),
    )
    .leftJoin(organizations, eq(organizations.profileDocumentId, documents.id))
    .where(sql`
      ${accessManifestHeads.objectKind} = ${"document"}
      and ${containerMetadataDocuments.documentId} is null
      and ${organizationRosterEntries.profileDocumentId} is null
      and ${organizations.profileDocumentId} is null
      ${watermarkPredicate(
        sql`${documents.updatedAt}`,
        textExpression(sql`${accessManifestHeads.objectId}`),
        input.watermark,
      )}
    `)
    .orderBy(asc(documents.updatedAt), asc(accessManifestHeads.objectId))
    .limit(input.limit + 1);
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
): SyncWatermark {
  return {
    updatedAt: documentChangeUpdatedAt(change),
    id: documentChangeId(change),
  };
}

async function buildListContainerDocumentsResponse(input: {
  readonly containerId: string;
  readonly documentRows: readonly ContainerDocumentRow[];
  readonly limit: number;
  readonly referencedPrincipals: ReturnType<
    typeof collectReferencedPrincipalsFromContainerAccess
  >;
  readonly runtime: ApiServiceRuntime;
  readonly tombstoneRows: readonly ContainerDocumentTombstoneRow[];
  readonly watermark: SyncWatermark | null;
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

  const containerAccess = await requireReadableContainer(
    runtime,
    containerId,
    userId,
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
  const referencedPrincipals = collectReferencedPrincipalsFromContainerAccess([
    containerAccess,
  ]);

  return buildListContainerDocumentsResponse({
    containerId,
    documentRows,
    limit,
    referencedPrincipals,
    runtime,
    tombstoneRows,
    watermark,
  });
}
