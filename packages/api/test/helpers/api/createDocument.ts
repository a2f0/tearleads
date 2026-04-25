import { inArray } from "drizzle-orm";
import { resolveDocumentAccessState } from "../../../src/access/documentAccess";
import { db } from "../../../src/adapters/postgres";
import { routeApp } from "../../../src/routeApp";
import { containerMetadataDocuments } from "../../../src/schema";

export async function createDocument(
  token: string,
  linkedContainerIds: string[],
  expectedLinkedContainerAccessStateHashes?: Record<string, string>,
): Promise<Response> {
  let expectedHashes = expectedLinkedContainerAccessStateHashes;

  if (!expectedHashes) {
    const bindings = await db
      .select({
        containerId: containerMetadataDocuments.containerId,
        documentId: containerMetadataDocuments.documentId,
      })
      .from(containerMetadataDocuments)
      .where(
        inArray(containerMetadataDocuments.containerId, linkedContainerIds),
      );

    expectedHashes = {};

    for (const containerId of linkedContainerIds) {
      const binding = bindings.find((row) => row.containerId === containerId);
      if (!binding) {
        throw new Error(
          `Expected metadata document binding for container ${containerId}`,
        );
      }

      const access = await resolveDocumentAccessState(binding.documentId, db);
      if (!access) {
        throw new Error(
          `Expected metadata access state for container ${containerId}`,
        );
      }

      expectedHashes[containerId] = access.accessStateHash;
    }
  }

  return routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expectedLinkedContainerAccessStateHashes: expectedHashes,
      linkedContainerIds,
    }),
  });
}
