export type KeyId = string;
export type ItemId = string;
export type UserId = string;
export type Epoch = number;
export type Base64 = string;

export interface VfsWrappedKey {
  recipientUserId: UserId;
  recipientPublicKeyId: KeyId;
  keyEpoch: Epoch;
  encryptedKey: Base64;
  senderSignature: Base64;
}

export interface VfsChunkAad {
  itemId: ItemId;
  blobId: string;
  chunkIndex: number;
  isFinal: boolean;
  logicalLength: number;
  keyEpoch: Epoch;
  contentType?: string;
}

export interface EncryptedChunk {
  chunkIndex: number;
  isFinal: boolean;
  nonce: Base64;
  ciphertext: Uint8Array;
  aadHash: Base64;
  plaintextLength: number;
  ciphertextLength: number;
}

export interface EncryptedManifest {
  itemId: ItemId;
  blobId: string;
  keyEpoch: Epoch;
  contentType?: string;
  totalPlaintextBytes: number;
  totalCiphertextBytes: number;
  chunkCount: number;
  chunkHashes: Base64[];
  wrappedFileKeys: VfsWrappedKey[];
  manifestSignature: Base64;
}
