import type { SyncDocumentOutgoingUpdate } from "@tearleads/loro";
import { app } from "../../../src/index";

export async function syncDocument(
  documentId: string,
  input: {
    accessEpoch: number;
    localVersionVector: string | null;
    outgoingUpdates: SyncDocumentOutgoingUpdate[];
  },
  token: string,
): Promise<Response> {
  return app.request(`/documents/${documentId}/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
}
