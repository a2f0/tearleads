import { containerSyncTombstones } from "@tearleads/api-shared/schema";
import { isContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type {
  ContainerParentLaneIdsPage,
  ContainerSummary,
  ContainerSyncTombstone,
  ListContainersResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import { isUuidV4String } from "@tearleads/validators/util";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { textExpression } from "../../utils/postgresSql";
import type {
  ContainerWriterProjectionContext,
  PrincipalPolicyReferenceCache,
} from "../../workflows/containers/writerProjection/types";
import {
  collectReferencedPrincipalsFromContainerAccess,
  KeyingReadAccessError,
  resolveReadableContainerAccessBatch,
} from "../../workflows/keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";
import {
  containerHasDiscoveryAccess,
  discoveryGrantSubjects,
} from "./containerDiscoveryAccess";
import { discoveryCursor } from "./discoveryCursor";
import {
  readDiscoveryKey,
  readDiscoverySource,
  readDiscoverySources,
} from "./discoverySnapshot";
import {
  type AccessibleContainerRow,
  accessibleContainerIdsQuery,
  accessibleContainersQuery,
  parentIdPredicate,
  readAccessibleContainerIdRows,
  readAccessibleContainerRows,
} from "./listContainerRows";
import {
  compareDiscoveryOrder,
  discoveryWatermark,
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

interface ListContainersOptions {
  /** Shared request-scoped projection context across a parent-lane batch. */
  readonly context?: ContainerWriterProjectionContext;
  readonly principalPolicyByReference?: PrincipalPolicyReferenceCache;
  readonly discoveryKey?: string;
  readonly limit?: number | undefined;
  readonly parentId?: string | null | undefined;
  readonly watermark?: SyncWatermark | null;
}

interface ContainerTombstoneRow {
  discoveryOrder: bigint;
  containerId: string;
  depth: number;
  parentId: string | null;
  reason: "access_revoked" | "deleted";
  updatedAt: string;
}

interface ContainerChangeCandidate {
  discoveryOrder: bigint;
  kind: "container" | "tombstone";
  id: string;
  updatedAt: string;
}

interface ContainerPageSelection {
  containerIds: Set<string>;
  hasMore: boolean;
  nextWatermark: SyncWatermark | null;
  tombstoneIds: Set<string>;
}

export class ListContainersError extends Error {
  constructor(
    message: string,
    readonly status: 400,
  ) {
    super(message);
  }
}

function normalizeParentId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isUuidV4String(value)) {
    throw new ListContainersError("Invalid parentId", 400);
  }
  return value;
}

function tombstoneParentIdPredicate(parentId: string | null): SQL {
  if (parentId === null) {
    return sql`(
      ${containerSyncTombstones.parentId} is null
      or ${containerSyncTombstones.rootDiscoveryVisible} = true
    )`;
  }

  return parentIdPredicate(sql`${containerSyncTombstones.parentId}`, parentId);
}

const removalRow = z
  .object({
    discoveryOrder: z.string().transform(BigInt),
    id: z.string(),
    depth: z.number().int(),
    parentId: z.string().nullable(),
    reason: z.enum(["access_revoked", "deleted"]),
    updatedAt: z.string().transform(readSyncTimestamp),
  })
  .transform(({ id, ...row }) => ({ ...row, containerId: id }));

function containerTombstonesQuery(input: {
  readonly limit: number;
  readonly parentId: string | null;
  readonly userId: string;
  readonly watermark: SyncWatermark | null;
}): SQL {
  return sql`
    with ${discoveryGrantSubjects(input.userId)}
    select container_id as id, discovery_order::text as "discoveryOrder",
      depth, parent_id as "parentId", reason,
      ${syncTimestampExpression(sql`updated_at`)} as "updatedAt"
    from ${containerSyncTombstones}
    where user_id = ${input.userId}
      and ${tombstoneParentIdPredicate(input.parentId)}
      and (reason <> 'access_revoked' or not ${containerHasDiscoveryAccess(sql`${containerSyncTombstones.containerId}`)})
      ${watermarkPredicate(sql`discovery_order`, textExpression(sql`container_id`), input.watermark)}
    order by discovery_order, container_id
    limit ${input.limit + 1}
  `;
}

function selectContainerPage(input: {
  readonly containerRows: readonly AccessibleContainerRow[];
  readonly limit: number;
  readonly tombstoneRows: readonly ContainerTombstoneRow[];
  readonly watermark: SyncWatermark | null;
}): ContainerPageSelection {
  const candidates: ContainerChangeCandidate[] = [
    ...input.containerRows.map((row) => ({
      discoveryOrder: row.discoveryOrder,
      id: row.id,
      kind: "container" as const,
      updatedAt: row.updatedAt,
    })),
    ...input.tombstoneRows.map((row) => ({
      discoveryOrder: row.discoveryOrder,
      id: row.containerId,
      kind: "tombstone" as const,
      updatedAt: row.updatedAt,
    })),
  ];
  const selectedCandidates = candidates
    .sort(compareDiscoveryOrder)
    .slice(0, input.limit);
  const selectedContainerIds = new Set(
    selectedCandidates
      .filter((candidate) => candidate.kind === "container")
      .map((candidate) => candidate.id),
  );
  const selectedTombstoneIds = new Set(
    selectedCandidates
      .filter((candidate) => candidate.kind === "tombstone")
      .map((candidate) => candidate.id),
  );
  const lastCandidate = selectedCandidates.at(-1) ?? null;

  return {
    containerIds: selectedContainerIds,
    hasMore:
      input.containerRows.length > input.limit ||
      input.tombstoneRows.length > input.limit ||
      selectedCandidates.length < candidates.length,
    nextWatermark:
      lastCandidate === null
        ? input.watermark
        : discoveryWatermark(
            lastCandidate.discoveryOrder,
            lastCandidate.id,
            lastCandidate.updatedAt,
          ),
    tombstoneIds: selectedTombstoneIds,
  };
}

type SummaryCandidateRow = AccessibleContainerRow & {
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataDocumentId: string;
};

function toVisibleContainerSummary(
  containerRow: SummaryCandidateRow,
  accessResult: Awaited<
    ReturnType<typeof resolveReadableContainerAccessBatch>
  > extends Map<string, infer Entry>
    ? Entry | undefined
    : never,
): ContainerSummary | null {
  if (!accessResult || accessResult.status === "rejected") {
    if (accessResult?.reason instanceof KeyingReadAccessError) {
      // 403/404 reflects concurrent revocation or deletion between the
      // candidate scan and path resolution; 409 indicates inconsistent
      // stored state and belongs to this lane as a retryable lane failure
      // rather than silently advancing the watermark past the row.
      if (accessResult.reason.status === 409) {
        throw accessResult.reason;
      }
      return null;
    }
    throw new Error("Readable container access batch omitted a candidate");
  }

  const systemSlot = isContainerSystemSlot(containerRow.systemSlot)
    ? containerRow.systemSlot
    : null;
  return {
    ...(systemSlot ? { systemSlot } : {}),
    ...(containerRow.restorationId
      ? { restorationId: containerRow.restorationId }
      : {}),
    createdAt: containerRow.createdAt,
    depth: containerRow.depth,
    effectiveAccessLevel: accessResult.value.accessLevel,
    id: containerRow.id,
    metadataAccessEpoch: containerRow.metadataAccessEpoch,
    metadataAccessStateHash: containerRow.metadataAccessStateHash,
    metadataDocumentId: containerRow.metadataDocumentId,
    metadataReferencedPrincipals:
      collectReferencedPrincipalsFromContainerAccess([accessResult.value]),
    metadataUpdateCount: containerRow.metadataUpdateCount,
    organizationId: containerRow.organizationId,
    parentId: containerRow.parentId,
    updatedAt: syncItemTimestamp(containerRow.updatedAt),
  };
}

async function resolveVisibleContainerSummaries(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly principalPolicyByReference?: PrincipalPolicyReferenceCache;
  readonly containerRows: readonly AccessibleContainerRow[];
  readonly runtime: ApiServiceRuntime;
  readonly userId: string;
}): Promise<ContainerSummary[]> {
  const visibleContainers: ContainerSummary[] = [];
  const accessContext = input.context ?? {
    ...createContainerWriterProjectionContext(input.runtime.db),
    principalPolicyByReference: input.principalPolicyByReference ?? new Map(),
  };
  const candidateRows = input.containerRows.filter(
    (containerRow): containerRow is SummaryCandidateRow =>
      containerRow.metadataDocumentId !== null &&
      containerRow.metadataAccessEpoch !== undefined &&
      !!containerRow.metadataAccessStateHash,
  );
  const accessResults = await resolveReadableContainerAccessBatch({
    containerIds: candidateRows.map((containerRow) => containerRow.id),
    context: accessContext,
    executor: input.runtime.db,
    userId: input.userId,
  });

  for (const containerRow of candidateRows) {
    const summary = toVisibleContainerSummary(
      containerRow,
      accessResults.get(containerRow.id),
    );
    if (summary) visibleContainers.push(summary);
  }

  return visibleContainers;
}

function buildListContainersResponse(input: {
  readonly pageSelection: ContainerPageSelection;
  readonly tombstoneRows: readonly ContainerTombstoneRow[];
  readonly visibleContainers: readonly ContainerSummary[];
}): ListContainersResponse {
  const tombstones: ContainerSyncTombstone[] = input.tombstoneRows.map(
    (row) => ({
      containerId: row.containerId,
      depth: row.depth,
      parentId: row.parentId,
      reason: row.reason,
      updatedAt: syncItemTimestamp(row.updatedAt),
    }),
  );

  return {
    hasMore: input.pageSelection.hasMore,
    items: input.visibleContainers.filter((container) =>
      input.pageSelection.containerIds.has(container.id),
    ),
    nextWatermark: input.pageSelection.nextWatermark,
    tombstones: tombstones.filter((tombstone) =>
      input.pageSelection.tombstoneIds.has(tombstone.containerId),
    ),
  };
}

export async function listContainers(
  runtime: ApiServiceRuntime,
  userId: string,
  options: ListContainersOptions = {},
): Promise<ListContainersResponse> {
  const limit = normalizeSyncPageLimit(
    options.limit,
    () => new ListContainersError("Invalid limit", 400),
  );
  const parentId = normalizeParentId(options.parentId);
  const requestedWatermark = normalizeSyncWatermark(
    options.watermark,
    () => new ListContainersError("Invalid watermark", 400),
  );

  const cursor = discoveryCursor(
    options.discoveryKey ?? (await readDiscoveryKey(runtime)),
    [userId, "containers", parentId],
    requestedWatermark,
  );
  const watermark = cursor.position;
  const query = { limit, parentId, userId, watermark };
  const rows = await readDiscoverySources(
    runtime,
    accessibleContainersQuery(query),
    containerTombstonesQuery(query),
  );
  const accessibleContainerRows = readAccessibleContainerRows(rows.live);
  const tombstoneRows = rows.removed.map((row) => removalRow.parse(row));
  const pageSelection = selectContainerPage({
    containerRows: accessibleContainerRows,
    limit,
    tombstoneRows,
    watermark,
  });
  const visibleContainers = await resolveVisibleContainerSummaries({
    ...(options.context ? { context: options.context } : {}),
    ...(options.principalPolicyByReference
      ? { principalPolicyByReference: options.principalPolicyByReference }
      : {}),
    containerRows: accessibleContainerRows.filter((row) =>
      pageSelection.containerIds.has(row.id),
    ),
    runtime,
    userId,
  });

  const response = buildListContainersResponse({
    pageSelection,
    tombstoneRows,
    visibleContainers,
  });
  return {
    ...response,
    nextWatermark: cursor.seal(response.nextWatermark, rows.publication),
  };
}

/**
 * Lists directly granted root-lane membership ids without resolving full
 * summaries or running manifest verification. Clients compare the returned ids
 * and direct grant levels against local state and fall back to a full root
 * listing only when a grant is missing or upgraded.
 */
export async function listContainerIdsOnly(
  runtime: ApiServiceRuntime,
  userId: string,
  options: Pick<
    ListContainersOptions,
    "discoveryKey" | "limit" | "parentId" | "watermark"
  > = {},
): Promise<ContainerParentLaneIdsPage> {
  const limit = normalizeSyncPageLimit(
    options.limit,
    () => new ListContainersError("Invalid limit", 400),
  );
  const parentId = normalizeParentId(options.parentId);
  if (parentId !== null) {
    throw new ListContainersError("idsOnly requires parentId to be null", 400);
  }
  const requestedWatermark = normalizeSyncWatermark(
    options.watermark,
    () => new ListContainersError("Invalid watermark", 400),
  );
  const cursor = discoveryCursor(
    options.discoveryKey ?? (await readDiscoveryKey(runtime)),
    [userId, "containers", null],
    requestedWatermark,
  );
  const rows = await readDiscoverySource(
    runtime,
    accessibleContainerIdsQuery({
      limit,
      userId,
      watermark: cursor.position,
    }),
  );
  const accessibleRows = readAccessibleContainerIdRows(rows.live);
  const hasMore = accessibleRows.length > limit;
  const pageRows = accessibleRows.slice(0, limit);
  const lastRow = pageRows.at(-1) ?? null;
  const nextWatermark =
    lastRow === null
      ? cursor.position
      : discoveryWatermark(
          lastRow.discoveryOrder,
          lastRow.id,
          lastRow.updatedAt,
        );

  return {
    hasMore,
    items: pageRows.map((row) => {
      const systemSlot = isContainerSystemSlot(row.systemSlot)
        ? row.systemSlot
        : null;
      return {
        ...(systemSlot ? { systemSlot } : {}),
        directAccessLevel: row.directAccessLevel,
        id: row.id,
        organizationId: row.organizationId,
        parentId: row.parentId,
      };
    }),
    nextWatermark: cursor.seal(nextWatermark, rows.publication),
  };
}
