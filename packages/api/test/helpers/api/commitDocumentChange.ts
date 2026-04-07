import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
import { app } from "../../../src/index";

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
      id: string;
      encryptedData: string;
      partialStartVersionVector: string;
      partialEndVersionVector: string;
      referencedSlotIds: string[];
    } | null;
  },
  token: string,
): Promise<Response> {
  return app.request(`/documents/${documentId}/commit-change`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
}
