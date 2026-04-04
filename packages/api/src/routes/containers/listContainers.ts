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

const CONTAINER_OBJECT_TYPE = "container";

interface AccessibleContainerRow {
  id: string;
  metadataDocumentId: string | null;
  organizationId: string;
  parentId: string | null;
}

export const listContainersRoute = new Hono();

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

function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

async function listAccessibleContainersForUser(
  userId: string,
): Promise<AccessibleContainerRow[]> {
  const result = await db.execute(sql`
    with recursive seed_containers as (
      select distinct c.id
      from ${containers} c
      inner join ${objectAccessGrants} g
        on g.object_type = ${CONTAINER_OBJECT_TYPE}
       and g.object_id = c.id::text
      left join ${organizationMembers} om
        on g.subject_type = ${"organization"}
       and g.subject_id = om.organization_id::text
       and om.user_id::text = ${userId}
      left join ${groupMembers} gm
        on g.subject_type = ${"group"}
       and g.subject_id = gm.group_id::text
       and gm.user_id::text = ${userId}
      where
        (g.subject_type = ${"user"} and g.subject_id = ${userId})
        or (g.subject_type = ${"organization"} and om.id is not null)
        or (g.subject_type = ${"group"} and gm.id is not null)
    ),
    accessible_containers as (
      select c.id, c.organization_id, c.parent_id
      from ${containers} c
      inner join seed_containers seed on seed.id = c.id
      union
      select child.id, child.organization_id, child.parent_id
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
