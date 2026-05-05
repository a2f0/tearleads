import type {
  ContainerSummary,
  ContainerSyncTombstone,
  ListContainersResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
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
  resolveReadableContainerAccess,
} from "../../workflows/keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";
import { createContainerWriterProjectionContext } from "./writerProjection";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

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
  readonly depth?: number | undefined;
  readonly limit?: number | undefined;
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

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new ListContainersError("Invalid limit", 400);
  }
  return Math.min(value, MAX_LIMIT);
}

function normalizeDepth(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new ListContainersError("Invalid depth", 400);
  }
  return value;
}

function normalizeWatermark(
  value: SyncWatermark | null | undefined,
): SyncWatermark | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value.updatedAt !== "string" ||
    value.updatedAt.length === 0 ||
    typeof value.id !== "string" ||
    value.id.length === 0
  ) {
    throw new ListContainersError("Invalid watermark", 400);
  }

  const updatedAt = new Date(value.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    throw new ListContainersError("Invalid watermark", 400);
  }

  return {
    id: value.id,
    updatedAt: updatedAt.toISOString(),
  };
}

function watermarkPredicate(
  updatedAtExpression: SQL,
  idExpression: SQL,
  watermark: SyncWatermark | null | undefined,
): SQL {
  if (!watermark) {
    return sql``;
  }

  return sql`and (${updatedAtExpression}, ${idExpression}) > (${new Date(
    watermark.updatedAt,
  )}, ${watermark.id})`;
}

async function listAccessibleContainersForUser(input: {
  readonly depth: number | undefined;
  readonly limit: number;
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
    current_container_manifests as (
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
    ),
    seed_containers as (
      select distinct current_container_manifests.*
      from current_container_manifests
      inner join ${accessManifestContainerGrantProjection} grant_projection
        on grant_projection.manifest_hash = current_container_manifests.manifest_hash
      left join reachable_principals rp
        on grant_projection.subject_type = rp.principal_type
        and grant_projection.subject_id = rp.principal_id
      where
        (
          grant_projection.subject_type = ${"user"}
          and grant_projection.subject_id = ${input.userId}
        )
        or rp.principal_id is not null
    ),
    accessible_containers as (
      select * from seed_containers
      union
      select child.*
      from current_container_manifests child
      inner join accessible_containers parent on child.parent_id = parent.id
    ),
    deduped_accessible_containers as (
      select distinct on (accessible.id)
        accessible.*
      from accessible_containers accessible
      order by accessible.id asc, accessible.epoch desc
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
	    from deduped_accessible_containers accessible
	    where ${input.depth === undefined ? sql`true` : sql`accessible.depth = ${input.depth}`}
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
  readonly depth: number | undefined;
  readonly limit: number;
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
	      and ${input.depth === undefined ? sql`true` : sql`${containerSyncTombstones.depth} = ${input.depth}`}
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

  for (const containerRow of input.containerRows) {
    if (!containerRow.metadataDocumentId) {
      continue;
    }

    const metadataAccessEpoch = containerRow.metadataAccessEpoch;
    const metadataAccessStateHash = containerRow.metadataAccessStateHash;
    if (metadataAccessEpoch === undefined || !metadataAccessStateHash) {
      continue;
    }

    let verifiedAccess:
      | Awaited<ReturnType<typeof resolveReadableContainerAccess>>
      | undefined;
    try {
      verifiedAccess = await resolveReadableContainerAccess({
        containerId: containerRow.id,
        context: accessContext,
        executor: input.runtime.db,
        userId: input.userId,
      });
    } catch (error) {
      if (
        error instanceof KeyingReadAccessError &&
        (error.status === 403 || error.status === 404 || error.status === 409)
      ) {
        continue;
      }
      throw error;
    }

    visibleContainers.push({
      createdAt: containerRow.createdAt,
      depth: containerRow.depth,
      id: containerRow.id,
      metadataAccessEpoch,
      metadataAccessStateHash,
      metadataDocumentId: containerRow.metadataDocumentId,
      metadataReferencedPrincipals:
        collectReferencedPrincipalsFromContainerAccess([verifiedAccess]),
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
  const depth = normalizeDepth(options.depth);
  const limit = normalizeLimit(options.limit);
  const watermark = normalizeWatermark(options.watermark);

  const [containerRows, tombstoneRows] = await Promise.all([
    listAccessibleContainersForUser({
      depth,
      limit,
      runtime,
      userId,
      watermark,
    }),
    listContainerTombstones({ depth, limit, runtime, userId, watermark }),
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
