export interface BlobStore {
  deleteBytes: (storageKey: string) => Promise<void>;
  readBytes: (storageKey: string) => Promise<Uint8Array | null>;
  writeBytes: (storageKey: string, bytes: Uint8Array) => Promise<void>;
}
