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
  uuidValue,
} from "../../utils/sqlDialect";
import { currentPrincipalStateHashSql } from "../../workflows/principals/currentPrincipalStateSql";
import type { ApiServiceRuntime } from "../runtime";
import { watermarkPredicate } from "./syncPaging";
import { readSyncTimestamp, syncTimestampExpression } from "./syncTimestamp";

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
  // Applied inside each candidate set, so neither lane reads rows the page
  // has already passed.
  const watermark = watermarkPredicate(
    sql`c.updated_at`,
    textExpression(sql`c.id`),
    input.watermark,
  );
  const result = await input.runtime.db.execute(sql`
    -- Direct membership is the whole of reachability; principals contain only
    -- users, so there is no transitive tier to walk.
    with recursive reachable_principals as (
      select
        pmp.principal_type,
        pmp.principal_id
      from ${principalMembershipProjection} pmp
      where
        pmp.user_id = ${uuidValue(input.userId)}
        and pmp.state_hash = ${currentPrincipalStateHashSql({
          principalId: sql`pmp.principal_id`,
          principalType: sql`pmp.principal_type`,
        })}
    ),
    grant_subjects as (
      select
        ${"user"} as principal_type,
        ${uuidValue(input.userId)} as principal_id
      union all
      select principal_type, principal_id from reachable_principals
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
      -- CROSS JOIN keeps each step at one parent lookup; SQLite otherwise
      -- starts from every container head.
      from target_parent_path child
      cross join ${containers} parent
      cross join ${accessManifestHeads} h
      cross join ${accessManifests} m
      where parent.id = child.parent_id
        and h.object_kind = ${"container"}
        and h.object_id = parent.id
        and m.manifest_hash = h.manifest_hash
    ),
    authorized_parent as (
      select 1
      -- From the parent path's own manifests, never every grant row.
      from target_parent_path parent
      cross join ${accessManifestContainerGrantProjection} grant_projection
      cross join grant_subjects subject
      where
        grant_projection.manifest_hash = parent.manifest_hash
        and grant_projection.subject_type = subject.principal_type
        and grant_projection.subject_id = subject.principal_id
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
        h.manifest_hash
      -- From the parent's children via its (parent_id, updated_at, id) index,
      -- starting at the watermark; CROSS JOIN stops SQLite from starting at
      -- every container head. A root listing shows only directly granted
      -- containers, so it needs no parent lane at all. The manifest state is
      -- read only for the children the listing shows.
      from ${containers} c
      cross join ${accessManifestHeads} h
      where ${
        input.parentId === null
          ? sql`false`
          : parentIdPredicate(sql`c.parent_id`, input.parentId)
      }
        ${watermark}
        and h.object_kind = ${"container"}
        and h.object_id = c.id
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
        -- The root lane, driven from this user's grant subjects through the
        -- subject index. CROSS JOIN fixes SQLite's join order; it otherwise
        -- starts from every container or head. Postgres treats these as
        -- inner joins.
        from grant_subjects subject
        cross join ${accessManifestContainerGrantProjection} grant_projection
        cross join ${accessManifestHeads} h
        cross join ${containers} c
        cross join ${accessManifests} m
        where
          grant_projection.subject_type = subject.principal_type
          and grant_projection.subject_id = subject.principal_id
          and h.manifest_hash = grant_projection.manifest_hash
          and h.object_kind = ${"container"}
          and c.id = h.object_id
          and m.manifest_hash = h.manifest_hash
          ${watermark}
      ) ranked_direct_grants
      where rn = 1
    ),
    -- Each lane has one row per container: a container has exactly one head
    -- (access_manifest_heads is unique on object_kind, object_id), and the
    -- root lane keeps one row of each container's repeated grants. A root
    -- listing shows only directly granted containers. A parent listing
    -- shows every child when the parent path is granted, and otherwise the
    -- children the user holds a direct grant on. A child's own manifest_hash
    -- is its only head, so a grant on it is exactly a direct grant on that
    -- child, found by manifest hash rather than by reading every grant the
    -- user holds.
    visible_candidate_containers as (
      ${
        input.parentId === null
          ? sql`select * from directly_granted_containers`
          : sql`
      select candidate.*, m.state
      from parent_lane_candidate_containers candidate
      cross join ${accessManifests} m
      where
        m.manifest_hash = candidate.manifest_hash
        and (
          exists (select 1 from authorized_parent)
          or exists (
            select 1
            from ${accessManifestContainerGrantProjection} grant_projection
            cross join grant_subjects subject
            where
              grant_projection.manifest_hash = candidate.manifest_hash
              and grant_projection.subject_type = subject.principal_type
              and grant_projection.subject_id = subject.principal_id
          )
        )`
      }
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
      ${syncTimestampExpression(sql`accessible.updated_at`)} as "updatedAt",
      ${intExpression(sql`accessible.epoch`)} as "metadataAccessEpoch",
      ${textExpression(sql`accessible.manifest_hash`)} as "metadataAccessStateHash"
    from visible_candidate_containers accessible
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
      updatedAt: readSyncTimestamp(row.updatedAt),
      ...(metadataAccessEpoch === undefined ? {} : { metadataAccessEpoch }),
      ...(metadataAccessStateHash === undefined
        ? {}
        : { metadataAccessStateHash }),
    });
  }

  return accessibleContainers;
}
