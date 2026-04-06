export type BlobBytes = Uint8Array<ArrayBuffer>;

export interface BlobStore {
  deleteBytes: (storageKey: string) => Promise<void>;
  readBytes: (storageKey: string) => Promise<BlobBytes | null>;
  writeBytes: (storageKey: string, bytes: BlobBytes) => Promise<void>;
}
