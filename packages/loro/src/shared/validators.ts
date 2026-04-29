export type DocumentCheckpointKind = "fresh_baseline" | "rotate_baseline";

export interface SyncDocumentOutgoingUpdate {
  checkpointKind?: DocumentCheckpointKind;
  id: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector?: string;
}
