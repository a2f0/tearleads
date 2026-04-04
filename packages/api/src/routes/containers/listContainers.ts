import type { ListContainersResponse } from "@tearleads/validators/response";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  listRecipientEncapsulationPublicKeys,
  resolveDocumentAccessStates,
} from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import { requireAuth } from "../../middleware/session";
import {
  containerMetadataDocuments,
  containers,
  groupMembers,
  objectAccessGrants,
  organizationMembers,
} from "../../schema";
import { uniqueSortedStrings } from "../../utils/array";

const CONTAINER_OBJECT_TYPE = "container";

interface AccessibleContainerRow {
  id: string;
  metadataDocumentId: string | null;
  organizationId: string;
  parentId: string | null;
}

export const listContainersRoute = new Hono();

interface SqlNamedColumn {
  name: string;
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

function aliasedColumn(alias: string, column: SqlNamedColumn) {
  return sql.raw(`${alias}.${column.name}`);
}

async function listAccessibleContainersForUser(
  userId: string,
): Promise<AccessibleContainerRow[]> {
  const containerId = aliasedColumn("c", containers.id);
  const containerOrganizationId = aliasedColumn("c", containers.organizationId);
  const containerParentId = aliasedColumn("c", containers.parentId);
  const grantObjectType = aliasedColumn("g", objectAccessGrants.objectType);
  const grantObjectId = aliasedColumn("g", objectAccessGrants.objectId);
  const grantSubjectType = aliasedColumn("g", objectAccessGrants.subjectType);
  const grantSubjectId = aliasedColumn("g", objectAccessGrants.subjectId);
  const organizationMemberId = aliasedColumn("om", organizationMembers.id);
  const organizationMemberOrganizationId = aliasedColumn(
    "om",
    organizationMembers.organizationId,
  );
  const organizationMemberUserId = aliasedColumn(
    "om",
    organizationMembers.userId,
  );
  const groupMemberId = aliasedColumn("gm", groupMembers.id);
  const groupMemberGroupId = aliasedColumn("gm", groupMembers.groupId);
  const groupMemberUserId = aliasedColumn("gm", groupMembers.userId);
  const childId = aliasedColumn("child", containers.id);
  const childOrganizationId = aliasedColumn("child", containers.organizationId);
  const childParentId = aliasedColumn("child", containers.parentId);
  const metadataDocumentId = aliasedColumn(
    "cmd",
    containerMetadataDocuments.documentId,
  );
  const metadataContainerId = aliasedColumn(
    "cmd",
    containerMetadataDocuments.containerId,
  );

  const result = await db.execute(sql`
    with recursive seed_containers as (
      select distinct ${containerId} as id
      from ${containers} c
      inner join ${objectAccessGrants} g
        on ${grantObjectType} = ${CONTAINER_OBJECT_TYPE}
       and ${grantObjectId} = ${containerId}::text
      left join ${organizationMembers} om
        on ${grantSubjectType} = ${"organization"}
       and ${grantSubjectId} = ${organizationMemberOrganizationId}::text
       and ${organizationMemberUserId}::text = ${userId}
      left join ${groupMembers} gm
        on ${grantSubjectType} = ${"group"}
       and ${grantSubjectId} = ${groupMemberGroupId}::text
       and ${groupMemberUserId}::text = ${userId}
      where
        (${grantSubjectType} = ${"user"} and ${grantSubjectId} = ${userId})
        or (${grantSubjectType} = ${"organization"} and ${organizationMemberId} is not null)
        or (${grantSubjectType} = ${"group"} and ${groupMemberId} is not null)
    ),
    accessible_containers as (
      select
        ${containerId} as id,
        ${containerOrganizationId} as organization_id,
        ${containerParentId} as parent_id
      from ${containers} c
      inner join seed_containers seed on seed.id = c.id
      union
      select
        ${childId} as id,
        ${childOrganizationId} as organization_id,
        ${childParentId} as parent_id
      from ${containers} child
      inner join accessible_containers parent on ${childParentId} = parent.id
    )
    select
      accessible.id::text as "id",
      ${metadataDocumentId}::text as "metadataDocumentId",
      accessible.organization_id::text as "organizationId",
      accessible.parent_id::text as "parentId"
    from accessible_containers accessible
    left join ${containerMetadataDocuments} cmd
      on ${metadataContainerId} = accessible.id
    order by
      accessible.organization_id asc,
      accessible.parent_id asc nulls first,
      accessible.id asc
  `);

  const rows: ReadonlyArray<unknown> = result.rows;
  const accessibleContainers: AccessibleContainerRow[] = [];

  for (const row of rows) {
    if (!isAccessibleContainerRow(row)) {
      throw new Error("Unexpected row shape from accessible_containers query");
    }

    accessibleContainers.push(row);
  }

  return accessibleContainers;
}

listContainersRoute.get("/containers", requireAuth, async (c) => {
  const session = c.get("session");
  const containerRows = await listAccessibleContainersForUser(session.userId);
  const metadataDocumentIds = uniqueSortedStrings(
    containerRows.flatMap((containerRow) =>
      containerRow.metadataDocumentId ? [containerRow.metadataDocumentId] : [],
    ),
  );
  const metadataAccessStateByDocumentId =
    await resolveDocumentAccessStates(metadataDocumentIds);

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

    visibleContainers.push({
      id: containerRow.id,
      metadataAccessEpoch: metadataAccess.currentAccessEpoch,
      metadataDocumentId: containerRow.metadataDocumentId,
      metadataRecipientEncapsulationPublicKeys:
        listRecipientEncapsulationPublicKeys(metadataAccess),
      organizationId: containerRow.organizationId,
      parentId: containerRow.parentId,
    });
  }

  return c.json<ListContainersResponse>(visibleContainers);
});
