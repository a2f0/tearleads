import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifests,
  containers,
  principalMembershipProjection,
} from "@tearleads/api-shared/schema";
import type { SyncWatermark } from "@tearleads/validators/response";
import { type SQL, sql } from "drizzle-orm";
import {
  intExpression,
  jsonTextProperty,
  readDateValue,
  textExpression,
} from "../../utils/sqlDialect";
import { currentPrincipalStateHashSql } from "../../workflows/principals/currentPrincipalStateSql";
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
  return readDateValue(value, label).toISOString();
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
    -- Direct membership is the whole of reachability; principals contain only
    -- users, so there is no transitive tier to walk.
    with recursive reachable_principals as (
      select
        pmp.principal_type,
        pmp.principal_id
      from ${principalMembershipProjection} pmp
      where
        pmp.user_id = ${input.userId}
        and pmp.state_hash = ${currentPrincipalStateHashSql({
          principalId: sql`pmp.principal_id`,
          principalType: sql`pmp.principal_type`,
        })}
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
      select
        id,
        system_slot,
        organization_id,
        parent_id,
        depth,
        created_at,
        updated_at,
        epoch,
        manifest_hash,
        state
      from (
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
          m.state,
          row_number() over (partition by c.id order by h.epoch desc) as rn
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
      ) ranked_direct_grants
      where rn = 1
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
      select
        id,
        system_slot,
        organization_id,
        parent_id,
        depth,
        created_at,
        updated_at,
        epoch,
        manifest_hash,
        state
      from (
        select
          candidate.*,
          row_number() over (
            partition by candidate.id
            order by candidate.epoch desc
          ) as rn
        from candidate_containers candidate
        left join directly_granted_candidate_containers direct_grant
          on direct_grant.id = candidate.id
        where
          direct_grant.id is not null
          or (
            ${input.parentId === null ? sql`false` : sql`true`}
            and exists (select 1 from authorized_parent)
          )
      ) ranked_visible_candidates
      where rn = 1
    )
    select
      ${textExpression(sql`accessible.id`)} as "id",
      ${textExpression(sql`accessible.system_slot`)} as "systemSlot",
      ${textExpression(
        jsonTextProperty(sql`accessible.state`, "metadataDocumentId"),
      )} as "metadataDocumentId",
      ${textExpression(sql`accessible.organization_id`)} as "organizationId",
      ${textExpression(sql`accessible.parent_id`)} as "parentId",
      ${intExpression(sql`accessible.depth`)} as "depth",
      accessible.created_at as "createdAt",
      accessible.updated_at as "updatedAt",
      ${intExpression(sql`accessible.epoch`)} as "metadataAccessEpoch",
      ${textExpression(sql`accessible.manifest_hash`)} as "metadataAccessStateHash"
    from visible_candidate_containers accessible
    where true
      ${watermarkPredicate(
        sql`accessible.updated_at`,
        textExpression(sql`accessible.id`),
        input.watermark,
      )}
    order by
      accessible.updated_at asc,
      ${textExpression(sql`accessible.id`)} asc
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
