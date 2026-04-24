import type { ListContainersResponse } from "@tearleads/validators/response";
import { sql } from "drizzle-orm";
import {
  canReadDocumentAccess,
  listRecipientEncapsulationPublicKeys,
  resolveDocumentAccessStates,
} from "../../access/documentAccess";
import {
  containerMetadataDocuments,
  containers,
  objectAccessGrants,
  principalMembershipProjection,
  principalStates,
} from "../../schema";
import { uniqueSortedStrings } from "../../utils/array";
import type { ApiServiceRuntime } from "../runtime";

interface AccessibleContainerRow {
  id: string;
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
    seed_containers as (
      select distinct
        c.id,
        c.organization_id,
        c.parent_id
      from ${containers} c
      inner join ${objectAccessGrants} g
        on g.object_type = ${"container"}
       and g.object_id = c.id::text
      left join reachable_principals rp
        on g.subject_type = rp.principal_type
       and g.subject_id = rp.principal_id
      where
        (g.subject_type = ${"user"} and g.subject_id = ${userId})
        or rp.principal_id is not null
    ),
    accessible_containers as (
      select
        seed.id,
        seed.organization_id,
        seed.parent_id
      from seed_containers seed
      union
      select
        child.id,
        child.organization_id,
        child.parent_id
      from ${containers} child
      inner join accessible_containers parent on child.parent_id = parent.id
    )
    select
      accessible.id::text as "id",
      cmd.document_id::text as "metadataDocumentId",
      accessible.organization_id::text as "organizationId",
      accessible.parent_id::text as "parentId"
    from accessible_containers accessible
    left join ${containerMetadataDocuments} cmd
      on cmd.container_id = accessible.id
    order by
      accessible.organization_id asc,
      accessible.parent_id asc nulls first,
      accessible.id asc
  `);

  const accessibleContainers: AccessibleContainerRow[] = [];

  for (const row of result.rows) {
    if (!isAccessibleContainerRow(row)) {
      throw new Error("Unexpected row shape from accessible_containers query");
    }

    accessibleContainers.push(row);
  }

  return accessibleContainers;
}

export async function listContainers(
  runtime: ApiServiceRuntime,
  userId: string,
): Promise<ListContainersResponse> {
  const containerRows = await listAccessibleContainersForUser(runtime, userId);
  const metadataDocumentIds = uniqueSortedStrings(
    containerRows.flatMap((containerRow) =>
      containerRow.metadataDocumentId ? [containerRow.metadataDocumentId] : [],
    ),
  );
  const metadataAccessStateByDocumentId = await resolveDocumentAccessStates(
    metadataDocumentIds,
    runtime.db,
  );

  const visibleContainers: ListContainersResponse = [];

  for (const containerRow of containerRows) {
    if (!containerRow.metadataDocumentId) {
      continue;
    }

    const metadataAccess = metadataAccessStateByDocumentId.get(
      containerRow.metadataDocumentId,
    );
    if (!metadataAccess) {
      continue;
    }
    if (!canReadDocumentAccess(metadataAccess, userId)) {
      continue;
    }

    visibleContainers.push({
      id: containerRow.id,
      metadataAccessEpoch: metadataAccess.currentAccessEpoch,
      metadataAccessStateHash: metadataAccess.accessStateHash,
      metadataDocumentId: containerRow.metadataDocumentId,
      metadataRecipientEncapsulationPublicKeys:
        listRecipientEncapsulationPublicKeys(metadataAccess),
      metadataReferencedPrincipals: metadataAccess.referencedPrincipals,
      organizationId: containerRow.organizationId,
      parentId: containerRow.parentId,
    });
  }

  return visibleContainers;
}
