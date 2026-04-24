import type { SyncDocumentOutgoingUpdate } from "@tearleads/loro";
import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
import { resolveDocumentAccessState } from "../../../src/access/documentAccess";
import { db } from "../../../src/adapters/postgres";
import { routeApp } from "../../../src/routeApp";

export async function syncDocument(
  documentId: string,
  input: {
    accessEpoch: number;
    expectedAccessStateHash?: string;
    documentRecipientEnvelopes?: SerializedRecipientEnvelope[];
    localVersionVector: string | null;
    minLsn?: string;
    outgoingUpdates: SyncDocumentOutgoingUpdate[];
  },
  token: string,
): Promise<Response> {
  const hasWritePayload =
    input.outgoingUpdates.length > 0 ||
    input.documentRecipientEnvelopes !== undefined;
  const access =
    input.expectedAccessStateHash || !hasWritePayload
      ? null
      : await resolveDocumentAccessState(documentId, db);

  return routeApp.request(`/documents/${documentId}/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      ...input,
      expectedAccessStateHash:
        input.expectedAccessStateHash ?? access?.accessStateHash,
    }),
  });
}
