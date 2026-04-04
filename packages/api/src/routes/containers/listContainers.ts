import type { ListContainersResponse } from "@tearleads/validators/response";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  canReadContainerAccess,
  resolveContainerAccessState,
} from "../../access/containerAccess";
import {
  listRecipientEncapsulationPublicKeys,
  resolveDocumentAccessState,
} from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import { requireAuth } from "../../middleware/session";
import { containerMetadataDocuments, containers } from "../../schema";

export const listContainersRoute = new Hono();

listContainersRoute.get("/containers", requireAuth, async (c) => {
  const session = c.get("session");
  const containerRows = await db
    .select({
      id: containers.id,
      metadataDocumentId: containerMetadataDocuments.documentId,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
    })
    .from(containers)
    .leftJoin(
      containerMetadataDocuments,
      eq(containerMetadataDocuments.containerId, containers.id),
    )
    .orderBy(
      asc(containers.organizationId),
      asc(containers.parentId),
      asc(containers.id),
    );

  const visibleContainers: ListContainersResponse = [];

  for (const containerRow of containerRows) {
    if (!containerRow.metadataDocumentId) {
      continue;
    }

    const access = await resolveContainerAccessState(containerRow.id);
    if (!access || !canReadContainerAccess(access, session.userId)) {
      continue;
    }

    const metadataAccess = await resolveDocumentAccessState(
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
