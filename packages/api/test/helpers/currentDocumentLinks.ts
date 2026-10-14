import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  containers,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { listCurrentDocumentContainerIds } from "../../src/access/read/currentDocumentLinks";

/** The document's current links, as the link projection under its head. */
export async function currentDocumentLinkRows(
  documentId: string,
): Promise<{ readonly containerId: string }[]> {
  return (await listCurrentDocumentContainerIds(documentId, db)).map(
    (containerId) => ({ containerId }),
  );
}

/**
 * Make a bare document row read as currently linked into a container, without
 * a signed manifest: a head and link projection row under a placeholder hash.
 * Only structural guards that read current links may rely on it.
 */
export async function seedCurrentDocumentLink(input: {
  readonly containerId: string;
  readonly documentId: string;
}): Promise<void> {
  const [container] = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, input.containerId));
  if (!container) throw new Error("Expected a live container");
  const manifestHash = `seeded-document-link:${input.documentId}`;
  await db.insert(accessManifestHeads).values({
    epoch: 1,
    manifestHash,
    objectId: input.documentId,
    objectKind: "document",
    organizationId: container.organizationId,
  });
  await db.insert(accessManifestDocumentLinkProjection).values({
    containerId: input.containerId,
    documentId: input.documentId,
    manifestHash,
  });
}
