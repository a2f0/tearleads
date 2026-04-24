import type { ListContainersResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  canReadDocumentAccess,
  listRecipientEncapsulationPublicKeys,
  resolveDocumentAccessStates,
} from "../../access/documentAccess";
import { containerMetadataDocuments, containers } from "../../schema";
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
): Promise<AccessibleContainerRow[]> {
  const rows = await runtime.db
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
    .orderBy(containers.organizationId, containers.parentId, containers.id);

  return rows.filter(isAccessibleContainerRow);
}

export async function listContainers(
  runtime: ApiServiceRuntime,
  userId: string,
): Promise<ListContainersResponse> {
  const containerRows = await listAccessibleContainersForUser(runtime);
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
