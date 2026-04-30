import type { ListContainersResponse } from "@tearleads/validators/response";
import { sql } from "drizzle-orm";
import {
  accessManifestHeads,
  accessManifests,
  containers,
  principalMembershipProjection,
  principalStates,
} from "../../schema";
import {
  collectReferencedPrincipalsFromContainerAccess,
  KeyingReadAccessError,
  resolveReadableContainerAccess,
} from "../keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";
import { createContainerWriterProjectionContext } from "./writerProjection";

interface AccessibleContainerRow {
  id: string;
  metadataAccessEpoch?: number;
  metadataAccessStateHash?: string;
  metadataDocumentId: string | null;
  organizationId: string;
  parentId: string | null;
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

function readOptionalNumber(value: unknown): number | undefined {
  return Number.isInteger(value) ? (value as number) : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function listAccessibleContainersForUser(
  runtime: ApiServiceRuntime,
  userId: string,
): Promise<AccessibleContainerRow[]> {
  const result = await runtime.db.execute(sql`
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
 and pmp.member_principal_id = ${userId}
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
 cross join lateral jsonb_array_elements(
 coalesce(current_container_manifests.state->'directGrants', '[]'::jsonb)
 ) as direct_grant
 left join reachable_principals rp
 on direct_grant->>'subjectType' = rp.principal_type
 and direct_grant->>'subjectId' = rp.principal_id
 where
 (
 direct_grant->>'subjectType' = ${"user"}
 and direct_grant->>'subjectId' = ${userId}
 )
 or rp.principal_id is not null
 ),
 accessible_containers as (
 select * from seed_containers
 union
 select child.*
 from current_container_manifests child
 inner join accessible_containers parent on child.parent_id = parent.id
 )
 select distinct on (accessible.id)
 accessible.id::text as "id",
 (accessible.state->>'metadataDocumentId')::text as "metadataDocumentId",
 accessible.organization_id::text as "organizationId",
 accessible.parent_id::text as "parentId",
 accessible.epoch::int as "metadataAccessEpoch",
 accessible.manifest_hash::text as "metadataAccessStateHash"
 from accessible_containers accessible
 order by
 accessible.id asc,
 accessible.epoch desc
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
      ...(metadataAccessEpoch === undefined ? {} : { metadataAccessEpoch }),
      ...(metadataAccessStateHash === undefined
        ? {}
        : { metadataAccessStateHash }),
    });
  }

  return accessibleContainers;
}

export async function listContainers(
  runtime: ApiServiceRuntime,
  userId: string,
): Promise<ListContainersResponse> {
  const containerRows = await listAccessibleContainersForUser(runtime, userId);

  const visibleContainers: ListContainersResponse = [];
  const accessContext = createContainerWriterProjectionContext(runtime.db);

  for (const containerRow of containerRows) {
    if (!containerRow.metadataDocumentId) {
      continue;
    }

    const MetadataAccessEpoch = containerRow.metadataAccessEpoch;
    const MetadataAccessStateHash = containerRow.metadataAccessStateHash;
    if (MetadataAccessEpoch === undefined || !MetadataAccessStateHash) {
      continue;
    }

    let verifiedAccess:
      | Awaited<ReturnType<typeof resolveReadableContainerAccess>>
      | undefined;
    try {
      verifiedAccess = await resolveReadableContainerAccess({
        containerId: containerRow.id,
        context: accessContext,
        executor: runtime.db,
        userId,
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
      id: containerRow.id,
      metadataAccessEpoch: MetadataAccessEpoch,
      metadataAccessStateHash: MetadataAccessStateHash,
      metadataDocumentId: containerRow.metadataDocumentId,
      metadataReferencedPrincipals:
        collectReferencedPrincipalsFromContainerAccess([verifiedAccess]),
      organizationId: containerRow.organizationId,
      parentId: containerRow.parentId,
    });
  }

  return visibleContainers;
}
