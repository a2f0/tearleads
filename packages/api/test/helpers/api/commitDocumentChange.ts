import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
import { routeApp } from "../../../src/routeApp";

export async function commitDocumentChange(
  documentId: string,
  input: {
    accessEpoch: number;
    attachmentCommits: Array<{
      slotId: string;
      stageId: string;
      expectedBindingId: string | null;
    }>;
    attachmentDetaches: Array<{
      slotId: string;
      expectedBindingId: string;
    }>;
    attachmentRewraps: Array<{
      slotId: string;
      expectedBindingId: string;
      recipientEnvelopes: SerializedRecipientEnvelope[];
    }>;
    documentRecipientEnvelopes?: SerializedRecipientEnvelope[];
    loroUpdate: {
      checkpointKind?: "fresh_baseline" | "rotate_baseline";
      id: string;
      encryptedData: string;
      partialStartVersionVector: string;
      partialEndVersionVector: string;
      sourceVersionVector?: string;
      referencedSlotIds: string[];
    } | null;
  },
  token: string,
): Promise<Response> {
  return routeApp.request(`/documents/${documentId}/commit-change`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
}
