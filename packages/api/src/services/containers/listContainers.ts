import { containerSyncTombstones } from "@symcrypt/api-shared/schema";
import { isContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import type {
  ContainerSummary,
  ContainerSyncTombstone,
  ListContainersResponse,
  SyncWatermark,
} from "@symcrypt/validators/response";
import { isUuidV4String } from "@symcrypt/validators/util";
import { type SQL, sql } from "drizzle-orm";
import { textExpression } from "../../utils/sqlDialect";
import {
  collectReferencedPrincipalsFromContainerAccess,
  KeyingReadAccessError,
  resolveReadableContainerAccessBatch,
} from "../../workflows/keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";
import {
  type AccessibleContainerRow,
  listAccessibleContainersForUser,
  parentIdPredicate,
} from "./listContainerRows";
import {
  normalizeSyncPageLimit,
  normalizeSyncWatermark,
  watermarkPredicate,
} from "./syncPaging";
import { createContainerWriterProjectionContext } from "./writerProjection";

interface ListContainersOptions {
  readonly limit?: number | undefined;
  readonly parentId?: string | null | undefined;
  readonly watermark?: SyncWatermark | null;
}

interface ContainerTombstoneRow {
  containerId: string;
  depth: number;
  parentId: string | null;
  reason: "access_revoked" | "deleted";
  updatedAt: string;
}

interface ContainerChangeCandidate {
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

async function listContainerTombstones(input: {
  readonly limit: number;
  readonly parentId: string | null;
  readonly runtime: ApiServiceRuntime;
  readonly userId: string;
  readonly watermark: SyncWatermark | null;
}): Promise<ContainerTombstoneRow[]> {
  const rows = await input.runtime.db
    .select({
      containerId: containerSyncTombstones.containerId,
      depth: containerSyncTombstones.depth,
      parentId: containerSyncTombstones.parentId,
      reason: containerSyncTombstones.reason,
      updatedAt: containerSyncTombstones.updatedAt,
    })
    .from(containerSyncTombstones)
    .where(sql`
      ${containerSyncTombstones.userId} = ${input.userId}
      and ${tombstoneParentIdPredicate(input.parentId)}
      ${watermarkPredicate(
        sql`${containerSyncTombstones.updatedAt}`,
        textExpression(sql`${containerSyncTombstones.containerId}`),
        input.watermark,
      )}
    `)
    .orderBy(
      containerSyncTombstones.updatedAt,
      textExpression(sql`${containerSyncTombstones.containerId}`),
    )
    .limit(input.limit + 1);

  return rows.map((row) => ({
    containerId: row.containerId,
    depth: row.depth,
    parentId: row.parentId,
    reason: row.reason,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

function compareContainerChangeCandidates(
  left: ContainerChangeCandidate,
  right: ContainerChangeCandidate,
): number {
  const updatedAtOrder = left.updatedAt.localeCompare(right.updatedAt);
  return updatedAtOrder === 0
    ? left.id.localeCompare(right.id)
    : updatedAtOrder;
}

function containerCandidateWatermark(
  candidate: ContainerChangeCandidate,
): SyncWatermark {
  return {
    id: candidate.id,
    updatedAt: candidate.updatedAt,
  };
}

function selectContainerPage(input: {
  readonly containerRows: readonly AccessibleContainerRow[];
  readonly limit: number;
  readonly tombstoneRows: readonly ContainerTombstoneRow[];
  readonly watermark: SyncWatermark | null;
}): ContainerPageSelection {
  const candidates: ContainerChangeCandidate[] = [
    ...input.containerRows.map((row) => ({
      id: row.id,
      kind: "container" as const,
      updatedAt: row.updatedAt,
    })),
    ...input.tombstoneRows.map((row) => ({
      id: row.containerId,
      kind: "tombstone" as const,
      updatedAt: row.updatedAt,
    })),
  ];
  const selectedCandidates = candidates
    .sort(compareContainerChangeCandidates)
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
        : containerCandidateWatermark(lastCandidate),
    tombstoneIds: selectedTombstoneIds,
  };
}

async function resolveVisibleContainerSummaries(input: {
  readonly containerRows: readonly AccessibleContainerRow[];
  readonly runtime: ApiServiceRuntime;
  readonly userId: string;
}): Promise<ContainerSummary[]> {
  const visibleContainers: ContainerSummary[] = [];
  const accessContext = createContainerWriterProjectionContext(
    input.runtime.db,
  );
  const candidateRows = input.containerRows.filter(
    (
      containerRow,
    ): containerRow is AccessibleContainerRow & {
      metadataAccessEpoch: number;
      metadataAccessStateHash: string;
      metadataDocumentId: string;
    } =>
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
    const accessResult = accessResults.get(containerRow.id);
    if (!accessResult || accessResult.status === "rejected") {
      if (accessResult?.reason instanceof KeyingReadAccessError) {
        continue;
      }
      throw new Error("Readable container access batch omitted a candidate");
    }

    const systemSlot = isContainerSystemSlot(containerRow.systemSlot)
      ? containerRow.systemSlot
      : null;

    visibleContainers.push({
      ...(systemSlot ? { systemSlot } : {}),
      createdAt: containerRow.createdAt,
      depth: containerRow.depth,
      effectiveAccessLevel: accessResult.value.accessLevel,
      id: containerRow.id,
      metadataAccessEpoch: containerRow.metadataAccessEpoch,
      metadataAccessStateHash: containerRow.metadataAccessStateHash,
      metadataDocumentId: containerRow.metadataDocumentId,
      metadataReferencedPrincipals:
        collectReferencedPrincipalsFromContainerAccess([accessResult.value]),
      organizationId: containerRow.organizationId,
      parentId: containerRow.parentId,
      updatedAt: containerRow.updatedAt,
    });
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
      updatedAt: row.updatedAt,
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
  const watermark = normalizeSyncWatermark(
    options.watermark,
    () => new ListContainersError("Invalid watermark", 400),
  );

  const [accessibleContainerRows, tombstoneRows] = await Promise.all([
    listAccessibleContainersForUser({
      limit,
      parentId,
      runtime,
      userId,
      watermark,
    }),
    listContainerTombstones({ limit, parentId, runtime, userId, watermark }),
  ]);
  const pageSelection = selectContainerPage({
    containerRows: accessibleContainerRows,
    limit,
    tombstoneRows,
    watermark,
  });
  const visibleContainers = await resolveVisibleContainerSummaries({
    containerRows: accessibleContainerRows.filter((row) =>
      pageSelection.containerIds.has(row.id),
    ),
    runtime,
    userId,
  });

  return buildListContainersResponse({
    pageSelection,
    tombstoneRows,
    visibleContainers,
  });
}
