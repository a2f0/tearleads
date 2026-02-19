import type {
  Base64,
  EncryptedChunk,
  EncryptedManifest,
  Epoch,
  ItemId
} from './types';

export interface EncryptChunkInput {
  itemId: ItemId;
  blobId: string;
  chunkIndex: number;
  isFinal: boolean;
  plaintext: Uint8Array;
  keyEpoch: Epoch;
  contentType?: string;
}

export interface DecryptChunkInput {
  itemId: ItemId;
  blobId: string;
  chunk: EncryptedChunk;
  keyEpoch: Epoch;
  contentType?: string;
}

export type UnsignedEncryptedManifest = Omit<
  EncryptedManifest,
  'manifestSignature'
>;

export interface VfsCryptoEngine {
  encryptChunk(input: EncryptChunkInput): Promise<EncryptedChunk>;
  decryptChunk(input: DecryptChunkInput): Promise<Uint8Array>;
  signManifest(input: UnsignedEncryptedManifest): Promise<Base64>;
  verifyManifest(manifest: EncryptedManifest): Promise<boolean>;
}
