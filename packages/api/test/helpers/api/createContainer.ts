import type { SyncDocumentOutgoingUpdate } from "@tearleads/loro";
import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { resolveDocumentAccessState } from "../../../src/access/documentAccess";
import { db } from "../../../src/adapters/postgres";
import { routeApp } from "../../../src/routeApp";
import { containerMetadataDocuments } from "../../../src/schema";

export async function createContainer(
  input: {
    expectedAccessStateHash?: string;
    id: string;
    initialMetadataRecipientEnvelopes?: SerializedRecipientEnvelope[];
    initialMetadataUpdates?: SyncDocumentOutgoingUpdate[];
    parentId: string;
  },
  token: string,
): Promise<Response> {
  let expectedAccessStateHash = input.expectedAccessStateHash;

  if (!expectedAccessStateHash) {
    const [metadataBinding] = await db
      .select({ documentId: containerMetadataDocuments.documentId })
      .from(containerMetadataDocuments)
      .where(eq(containerMetadataDocuments.containerId, input.parentId))
      .limit(1);
    invariant(metadataBinding, "expected parent metadata document binding");

    const access = await resolveDocumentAccessState(
      metadataBinding.documentId,
      db,
    );
    invariant(access, "expected parent metadata access state");
    expectedAccessStateHash = access.accessStateHash;
  }

  return routeApp.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expectedAccessStateHash,
      id: input.id,
      initialMetadataRecipientEnvelopes:
        input.initialMetadataRecipientEnvelopes,
      initialMetadataUpdates: input.initialMetadataUpdates ?? [],
      parentId: input.parentId,
    }),
  });
}
