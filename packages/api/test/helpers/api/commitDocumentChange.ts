import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
import { resolveDocumentAccessState } from "../../../src/access/documentAccess";
import { db } from "../../../src/adapters/postgres";
import { routeApp } from "../../../src/routeApp";

export async function commitDocumentChange(
  documentId: string,
  input: {
    accessEpoch: number;
    expectedAccessStateHash?: string;
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
  const access = input.expectedAccessStateHash
    ? null
    : await resolveDocumentAccessState(documentId, db);

  return routeApp.request(`/documents/${documentId}/commit-change`, {
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
