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
  ListContainerDocumentsResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { uniqueSortedStrings } from "../../utils/array";
import { textExpression } from "../../utils/postgresSql";
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
  type ContainerDocumentRow,
  type ContainerDocumentTombstoneRow,
  selectContainerDocumentPage,
} from "./containerDocumentPage";
import { readDiscoverySources } from "./discoverySnapshot";
import {
  normalizeSyncPageLimit,
  normalizeSyncWatermark,
  watermarkPredicate,
} from "./syncPaging";
import {
  readSyncTimestamp,
  syncItemTimestamp,
  syncTimestampExpression,
} from "./syncTimestamp";
import { createContainerWriterProjectionContext } from "./writerProjection";

interface ListContainerDocumentsOptions {
  readonly limit?: number | undefined;
  /** Shared only within a root-executor listing request. */
  readonly context?: ContainerWriterProjectionContext;
  readonly watermark?: SyncWatermark | null;
}

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
    // The lane container's policies were verified by this request's gate.
    evidence: input.containerAccess.principalPolicies,
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

const discoveryRow = z.object({
  discoveryOrder: z.string().transform(BigInt),
  id: z.string(),
  updatedAt: z.string().transform(readSyncTimestamp),
});
const removedDocumentRow = discoveryRow.transform(({ id, ...row }) => ({
  ...row,
  documentId: id,
}));
const currentDocumentRow = discoveryRow
  .extend({
    createdAt: z.string().transform((value) => new Date(value)),
    manifestHash: z.string(),
    manifestEpoch: z.number().int(),
  })
  .transform(({ id, ...row }) => ({ ...row, documentId: id }));

function currentContainerDocumentsQuery(input: {
  readonly containerId: string;
  readonly limit: number;
  readonly runtime: ApiServiceRuntime;
  readonly watermark: SyncWatermark | null;
}) {
  return (
    input.runtime.db
      .select({
        discoveryOrder: sql`${documents.discoveryOrder}::text`.as(
          "discoveryOrder",
        ),
        createdAt: syncTimestampExpression(sql`${documents.createdAt}`).as(
          "createdAt",
        ),
        id: sql`${accessManifestHeads.objectId}`.as("id"),
        manifestHash: sql`${accessManifestHeads.manifestHash}`.as(
          "manifestHash",
        ),
        manifestEpoch: sql`${accessManifestHeads.epoch}`.as("manifestEpoch"),
        updatedAt: syncTimestampExpression(sql`${documents.updatedAt}`).as(
          "updatedAt",
        ),
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
        sql`${documents.discoveryOrder}`,
        textExpression(sql`${accessManifestHeads.objectId}`),
        input.watermark,
      )}
    `)
      .orderBy(asc(documents.discoveryOrder), asc(accessManifestHeads.objectId))
      .limit(input.limit + 1)
  );
}

function documentTombstonesQuery(input: {
  readonly containerId: string;
  readonly limit: number;
  readonly runtime: ApiServiceRuntime;
  readonly watermark: SyncWatermark | null;
}) {
  return input.runtime.db
    .select({
      discoveryOrder:
        sql`${containerDocumentSyncTombstones.discoveryOrder}::text`.as(
          "discoveryOrder",
        ),
      id: sql`${containerDocumentSyncTombstones.documentId}`.as("id"),
      updatedAt: syncTimestampExpression(
        sql`${containerDocumentSyncTombstones.updatedAt}`,
      ).as("updatedAt"),
    })
    .from(containerDocumentSyncTombstones)
    .where(sql`
      ${containerDocumentSyncTombstones.containerId} = ${input.containerId}
      ${watermarkPredicate(
        sql`${containerDocumentSyncTombstones.discoveryOrder}`,
        textExpression(sql`${containerDocumentSyncTombstones.documentId}`),
        input.watermark,
      )}
    `)
    .orderBy(
      asc(containerDocumentSyncTombstones.discoveryOrder),
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
  const page = selectContainerDocumentPage(input);
  const linkedContainerIdsByManifestHash =
    await loadLinkedContainerIdsByManifestHash(
      input.runtime,
      page.documentRows.map((row) => row.manifestHash),
    );
  const accessByContainerId = await resolveDocumentContainerAccessById({
    containerAccess: input.containerAccess,
    containerId: input.containerId,
    context: input.context,
    linkedContainerIdsByManifestHash,
    runtime: input.runtime,
    userId: input.userId,
  });
  const items: ContainerDocumentSummary[] = page.documentRows.map(
    (documentRow) => {
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
        updatedAt: syncItemTimestamp(documentRow.updatedAt),
      };
    },
  );
  return {
    hasMore: page.hasMore,
    items,
    nextWatermark: page.nextWatermark,
    tombstones: page.tombstoneRows.map((row) => ({
      containerId: input.containerId,
      documentId: row.documentId,
      updatedAt: syncItemTimestamp(row.updatedAt),
    })),
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

  const context: ContainerWriterProjectionContext = options.context ?? {
    ...createContainerWriterProjectionContext(runtime.db),
    principalPolicyByReference: new Map(),
  };
  const containerAccess = await requireReadableContainer(
    runtime,
    containerId,
    userId,
    context,
  );
  const query = { containerId, limit, runtime, watermark };
  const rows = await readDiscoverySources(
    runtime,
    currentContainerDocumentsQuery(query).getSQL(),
    documentTombstonesQuery(query).getSQL(),
  );
  const documentRows = rows.live.map((row) => currentDocumentRow.parse(row));
  const tombstoneRows = rows.removed.map((row) =>
    removedDocumentRow.parse(row),
  );
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
