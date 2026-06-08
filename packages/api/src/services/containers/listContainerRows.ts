import type { SyncWatermark } from "@tearleads/validators/response";
import { type SQL, sql } from "drizzle-orm";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifests,
  containers,
  principalMembershipProjection,
  principalStates,
} from "../../schema";
import type { ApiServiceRuntime } from "../runtime";
import { watermarkPredicate } from "./syncPaging";

export interface AccessibleContainerRow {
  createdAt: string;
  systemSlot: string | null;
  depth: number;
  id: string;
  metadataAccessEpoch?: number;
  metadataAccessStateHash?: string;
  metadataDocumentId: string | null;
  organizationId: string;
  parentId: string | null;
  updatedAt: string;
}

interface AccessibleContainerRowShape {
  readonly id?: unknown;
  readonly metadataDocumentId?: unknown;
  readonly organizationId?: unknown;
  readonly parentId?: unknown;
}

function isAccessibleContainerRow(
  value: unknown,
): value is AccessibleContainerRow {
  if (!isAccessibleContainerRowShape(value)) {
    return false;
  }

  const id = value.id;
  const metadataDocumentId = value.metadataDocumentId;
  const organizationId = value.organizationId;
  const parentId = value.parentId;

  return (
    typeof id === "string" &&
    typeof organizationId === "string" &&
    (typeof metadataDocumentId === "string" || metadataDocumentId === null) &&
    (typeof parentId === "string" || parentId === null)
  );
}

function isAccessibleContainerRowShape(
  value: unknown,
): value is AccessibleContainerRowShape {
  return value !== null && typeof value === "object";
}

function readDateIso(value: unknown, label: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid date`);
  }
  return date.toISOString();
}

function readRequiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} is not an integer`);
  }
  return value;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parentIdPredicate(
  parentIdExpression: SQL,
  parentId: string | null,
): SQL {
  if (parentId === null) {
    return sql`${parentIdExpression} is null`;
  }

  return sql`${parentIdExpression} = ${parentId}`;
}

export async function listAccessibleContainersForUser(input: {
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
        c.system_slot,
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
        and h.object_id = c.id
      inner join ${accessManifests} m
        on m.manifest_hash = h.manifest_hash
      where ${
        input.parentId === null ? sql`false` : sql`c.id = ${input.parentId}`
      }
      union all
      select
        parent.id,
        parent.system_slot,
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
        and h.object_id = parent.id
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
        c.system_slot,
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
        and h.object_id = c.id
      inner join ${accessManifests} m
        on m.manifest_hash = h.manifest_hash
      where ${parentIdPredicate(sql`c.parent_id`, input.parentId)}
    ),
    directly_granted_containers as (
      select distinct on (c.id)
        c.id,
        c.system_slot,
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
        and h.object_id = c.id
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
      accessible.system_slot::text as "systemSlot",
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

    const metadataAccessEpoch = readOptionalNumber(row.metadataAccessEpoch);
    const metadataAccessStateHash = readOptionalString(
      row.metadataAccessStateHash,
    );

    accessibleContainers.push({
      ...row,
      createdAt: readDateIso(row.createdAt, "createdAt"),
      depth: readRequiredNumber(row.depth, "depth"),
      updatedAt: readDateIso(row.updatedAt, "updatedAt"),
      ...(metadataAccessEpoch === undefined ? {} : { metadataAccessEpoch }),
      ...(metadataAccessStateHash === undefined
        ? {}
        : { metadataAccessStateHash }),
    });
  }

  return accessibleContainers;
}
