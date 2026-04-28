import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  initializeContainerAccess,
  resolveContainerAccessState,
} from "../../src/access/containerAccess";
import { db } from "../../src/adapters/postgres";
import { containerMetadataDocuments, containers } from "../../src/schema";
import { createDocumentFixture } from "./documentFixture";

interface CreatedContainerFixture {
  id: string;
  metadataDocumentId: string | null;
  organizationId: string;
  parentId: string;
}

export async function createContainerFixture(input: {
  readonly createdByFingerprint?: string;
  readonly id?: string;
  readonly metadataDocumentId?: string;
  readonly parentId: string;
}): Promise<CreatedContainerFixture> {
  const id = input.id ?? crypto.randomUUID();
  const [parent] = await db
    .select({
      organizationId: containers.organizationId,
    })
    .from(containers)
    .where(eq(containers.id, input.parentId))
    .limit(1);
  invariant(parent, "expected parent container row");

  const parentAccess = await resolveContainerAccessState(input.parentId);
  invariant(parentAccess, "expected parent container access state");

  await db.insert(containers).values({
    id,
    organizationId: parent.organizationId,
    parentId: input.parentId,
  });
  await initializeContainerAccess(id, db, {
    inheritedFrom: parentAccess,
  });

  if (!input.createdByFingerprint) {
    return {
      id,
      metadataDocumentId: null,
      organizationId: parent.organizationId,
      parentId: input.parentId,
    };
  }

  const metadataDocument = await createDocumentFixture({
    createdByFingerprint: input.createdByFingerprint,
    ...(input.metadataDocumentId
      ? { documentId: input.metadataDocumentId }
      : {}),
    linkedContainerIds: [id],
  });
  await db.insert(containerMetadataDocuments).values({
    containerId: id,
    documentId: metadataDocument.id,
  });

  return {
    id,
    metadataDocumentId: metadataDocument.id,
    organizationId: parent.organizationId,
    parentId: input.parentId,
  };
}
