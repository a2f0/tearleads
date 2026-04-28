export type DocumentCheckpointKind = "fresh_baseline" | "rotate_baseline";

export interface SyncDocumentOutgoingUpdate {
  checkpointKind?: DocumentCheckpointKind;
  id: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector?: string;
}

export type DocumentRecipientEnvelopeAction = "none" | "rewrap" | "rotate";

export const DOCUMENT_RECIPIENT_ENVELOPES_CONFLICT_MESSAGE =
  "Document recipient envelopes conflict";
