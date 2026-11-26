export interface SyncDocumentOutgoingUpdate {
  id: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
}
