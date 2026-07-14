export type DocumentCheckpointKind = "rotate_baseline";
type DocumentCheckpointPayloadKind = "full_history_snapshot";

export interface SyncDocumentOutgoingUpdate {
  checkpointKind?: DocumentCheckpointKind;
  checkpointPayloadKind?: DocumentCheckpointPayloadKind;
  id: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector?: string;
}
