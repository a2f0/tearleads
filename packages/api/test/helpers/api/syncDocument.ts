import type { SyncDocumentOutgoingUpdate } from "@tearleads/loro";
import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
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
  return routeApp.request(`/documents/${documentId}/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
}
