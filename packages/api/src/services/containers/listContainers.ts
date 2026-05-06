import type {
  ContainerSummary,
  ContainerSyncTombstone,
  ListContainersResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import { isUuidV4String } from "@tearleads/validators/util";
import { type SQL, sql } from "drizzle-orm";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifests,
  containerSyncTombstones,
  containers,
  principalMembershipProjection,
  principalStates,
} from "../../schema";
import {
  collectReferencedPrincipalsFromContainerAccess,
  KeyingReadAccessError,
  resolveReadableContainerAccessBatch,
} from "../../workflows/keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";
import {
  normalizeSyncPageLimit,
  normalizeSyncWatermark,
  watermarkPredicate,
} from "./syncPaging";
import { createContainerWriterProjectionContext } from "./writerProjection";

interface AccessibleContainerRow {
  createdAt: string;
  depth: number;
  id: string;
  metadataAccessEpoch?: number;
  metadataAccessStateHash?: string;
  metadataDocumentId: string | null;
  organizationId: string;
  parentId: string | null;
  updatedAt: string;
}

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

function isAccessibleContainerRow(
  value: unknown,
): value is AccessibleContainerRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const id = Reflect.get(value, "id");
  const metadataDocumentId = Reflect.get(value, "metadataDocumentId");
  const organizationId = Reflect.get(value, "organizationId");
  const parentId = Reflect.get(value, "parentId");

  return (
    typeof id === "string" &&
    typeof organizationId === "string" &&
    (typeof metadataDocumentId === "string" || metadataDocumentId === null) &&
    (typeof parentId === "string" || parentId === null)
  );
}

function readDateIso(value: unknown, label: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid date`);
  }
  return date.toISOString();
}

function readRequiredNumber(value: unknown, label: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} is not an integer`);
  }
  return value as number;
}

function readOptionalNumber(value: unknown): number | undefined {
  return Number.isInteger(value) ? (value as number) : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function parentIdPredicate(
  parentIdExpression: SQL,
  parentId: string | null,
): SQL {
  if (parentId === null) {
    return sql`${parentIdExpression} is null`;
  }

  return sql`${parentIdExpression}::text = ${parentId}`;
}

async function listAccessibleContainersForUser(input: {
  readonly limit: number;
  readonly parentId: string | null;
  readonly runtime: ApiServiceRuntime;
  readonly userId: string;
  readonly watermark: SyncWatermark | null;
}): Promise<AccessibleContainerRow[]> {
  const result = await input.runtime.db.execute(sql`
    with recursive current_principal_states as (
      select distinct on (principal_type, principal_id)
        principal_type,
        principal_id,
        state_hash
      from ${principalStates}
      order by principal_type asc, principal_id asc, version desc
    ),
    reachable_principals as (
      select
        cps.principal_type,
        cps.principal_id
      from current_principal_states cps
      inner join ${principalMembershipProjection} pmp
        on pmp.principal_type = cps.principal_type
        and pmp.principal_id = cps.principal_id
        and pmp.state_hash = cps.state_hash
      where
        pmp.member_principal_type = ${"user"}
        and pmp.member_principal_id = ${input.userId}
      union
      select
        cps.principal_type,
        cps.principal_id
      from current_principal_states cps
      inner join ${principalMembershipProjection} pmp
        on pmp.principal_type = cps.principal_type
        and pmp.principal_id = cps.principal_id
        and pmp.state_hash = cps.state_hash
      inner join reachable_principals rp
        on pmp.member_principal_type = rp.principal_type
        and pmp.member_principal_id = rp.principal_id
    ),
    target_parent_path as (
      select
        c.id,
        c.organization_id,
        c.parent_id,
        c.depth,
        c.created_at,
        c.updated_at,
        h.epoch,
        h.manifest_hash,
        m.state
      from ${containers} c
      inner join ${accessManifestHeads} h
        on h.object_kind = ${"container"}
        and h.object_id = c.id::text
      inner join ${accessManifests} m
        on m.manifest_hash = h.manifest_hash
      where ${
        input.parentId === null
          ? sql`false`
          : sql`c.id::text = ${input.parentId}`
      }
      union all
      select
        parent.id,
        parent.organization_id,
        parent.parent_id,
        parent.depth,
        parent.created_at,
        parent.updated_at,
        h.epoch,
        h.manifest_hash,
        m.state
      from ${containers} parent
      inner join target_parent_path child
        on child.parent_id = parent.id
      inner join ${accessManifestHeads} h
        on h.object_kind = ${"container"}
        and h.object_id = parent.id::text
      inner join ${accessManifests} m
        on m.manifest_hash = h.manifest_hash
    ),
    authorized_parent as (
      select 1
      from target_parent_path parent
      inner join ${accessManifestContainerGrantProjection} grant_projection
        on grant_projection.manifest_hash = parent.manifest_hash
      left join reachable_principals rp
        on grant_projection.subject_type = rp.principal_type
        and grant_projection.subject_id = rp.principal_id
      where
        (
          grant_projection.subject_type = ${"user"}
          and grant_projection.subject_id = ${input.userId}
        )
        or rp.principal_id is not null
      limit 1
    ),
    parent_lane_candidate_containers as (
      select
        c.id,
        c.organization_id,
        c.parent_id,
        c.depth,
        c.created_at,
        c.updated_at,
        h.epoch,
        h.manifest_hash,
        m.state
      from ${containers} c
      inner join ${accessManifestHeads} h
        on h.object_kind = ${"container"}
        and h.object_id = c.id::text
      inner join ${accessManifests} m
        on m.manifest_hash = h.manifest_hash
      where ${parentIdPredicate(sql`c.parent_id`, input.parentId)}
    ),
    directly_granted_containers as (
      select distinct on (c.id)
        c.id,
        c.organization_id,
        c.parent_id,
        c.depth,
        c.created_at,
        c.updated_at,
        h.epoch,
        h.manifest_hash,
        m.state
      from ${containers} c
      inner join ${accessManifestHeads} h
        on h.object_kind = ${"container"}
        and h.object_id = c.id::text
      inner join ${accessManifests} m
        on m.manifest_hash = h.manifest_hash
      inner join ${accessManifestContainerGrantProjection} grant_projection
        on grant_projection.manifest_hash = h.manifest_hash
      left join reachable_principals rp
        on grant_projection.subject_type = rp.principal_type
        and grant_projection.subject_id = rp.principal_id
      where
        (
          grant_projection.subject_type = ${"user"}
          and grant_projection.subject_id = ${input.userId}
        )
        or rp.principal_id is not null
      order by c.id asc, h.epoch desc
    ),
    candidate_containers as (
      select * from parent_lane_candidate_containers
      union all
      select *
      from directly_granted_containers
      where ${input.parentId === null ? sql`true` : sql`false`}
    ),
    directly_granted_candidate_containers as (
      select distinct candidate.id
      from candidate_containers candidate
      inner join directly_granted_containers direct_grant
        on direct_grant.id = candidate.id
    ),
    visible_candidate_containers as (
      select distinct on (candidate.id)
        candidate.*
      from candidate_containers candidate
      left join directly_granted_candidate_containers direct_grant
        on direct_grant.id = candidate.id
      where
        direct_grant.id is not null
        or (
          ${input.parentId === null ? sql`false` : sql`true`}
          and exists (select 1 from authorized_parent)
        )
      order by candidate.id asc, candidate.epoch desc
    )
    select
      accessible.id::text as "id",
      (accessible.state->>'metadataDocumentId')::text as "metadataDocumentId",
      accessible.organization_id::text as "organizationId",
      accessible.parent_id::text as "parentId",
      accessible.depth::int as "depth",
      accessible.created_at as "createdAt",
      accessible.updated_at as "updatedAt",
      accessible.epoch::int as "metadataAccessEpoch",
      accessible.manifest_hash::text as "metadataAccessStateHash"
	    from visible_candidate_containers accessible
	    where true
	      ${watermarkPredicate(
          sql`accessible.updated_at`,
          sql`accessible.id::text`,
          input.watermark,
        )}
	    order by
	      accessible.updated_at asc,
	      accessible.id::text asc
	    limit ${input.limit + 1}
	  `);

  const accessibleContainers: AccessibleContainerRow[] = [];

  for (const row of result.rows) {
    if (!isAccessibleContainerRow(row)) {
      throw new Error("Unexpected row shape from accessible containers query");
    }

    const metadataAccessEpoch = readOptionalNumber(
      Reflect.get(row, "metadataAccessEpoch"),
    );
    const metadataAccessStateHash = readOptionalString(
      Reflect.get(row, "metadataAccessStateHash"),
    );

    accessibleContainers.push({
      ...row,
      createdAt: readDateIso(Reflect.get(row, "createdAt"), "createdAt"),
      depth: readRequiredNumber(Reflect.get(row, "depth"), "depth"),
      updatedAt: readDateIso(Reflect.get(row, "updatedAt"), "updatedAt"),
      ...(metadataAccessEpoch === undefined ? {} : { metadataAccessEpoch }),
      ...(metadataAccessStateHash === undefined
        ? {}
        : { metadataAccessStateHash }),
    });
  }

  return accessibleContainers;
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
	      and ${parentIdPredicate(
          sql`${containerSyncTombstones.parentId}`,
          input.parentId,
        )}
	      ${watermarkPredicate(
          sql`${containerSyncTombstones.updatedAt}`,
          sql`${containerSyncTombstones.containerId}::text`,
          input.watermark,
        )}
	    `)
    .orderBy(
      containerSyncTombstones.updatedAt,
      sql`${containerSyncTombstones.containerId}::text`,
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

    visibleContainers.push({
      createdAt: containerRow.createdAt,
      depth: containerRow.depth,
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

  const [containerRows, tombstoneRows] = await Promise.all([
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
    containerRows,
    limit,
    tombstoneRows,
    watermark,
  });
  const visibleContainers = await resolveVisibleContainerSummaries({
    containerRows: containerRows.filter((row) =>
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
