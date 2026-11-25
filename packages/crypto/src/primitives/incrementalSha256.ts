import { sha256 } from "@noble/hashes/sha2.js";

export interface IncrementalSha256 {
  digest(): Uint8Array<ArrayBuffer>;
  update(bytes: Uint8Array): void;
}

/** Incremental SHA-256 for streams that cannot be materialized as one buffer. */
export function createIncrementalSha256(): IncrementalSha256 {
  const hash = sha256.create();
  let finalized = false;

  return {
    digest() {
      if (finalized) {
        throw new Error("Incremental SHA-256 has already been finalized");
      }
      finalized = true;
      return new Uint8Array(hash.digest());
    },
    update(bytes) {
      if (finalized) {
        throw new Error("Incremental SHA-256 has already been finalized");
      }
      hash.update(bytes);
    },
  };
}
