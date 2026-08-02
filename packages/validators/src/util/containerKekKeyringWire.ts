/**
 * Shared wire arithmetic for sealed container KEK keyrings.
 *
 * These numbers define the exact-length equality every layer enforces: the
 * server rejects a rotation whose sealed keyring ciphertext differs from
 * `sealedContainerKekKeyringBytes(keyEpoch)`, and response guards reject any
 * blob over the `MAX_CONTAINER_KEY_EPOCH` ceiling before cryptographic work.
 * `@tearleads/crypto` consumes these same constants for seal/open, so the
 * equation has one definition. The overhead constant is the AES-GCM tag.
 */
export const MAX_CONTAINER_KEY_EPOCH = 65536;
export const SEALED_CONTAINER_KEK_KEYRING_HEADER_BYTES = 8;
export const SEALED_CONTAINER_KEK_KEYRING_ENTRY_BYTES = 64;
export const SEALED_CONTAINER_KEK_KEYRING_AEAD_OVERHEAD_BYTES = 16;

export function sealedContainerKekKeyringBytes(keyEpoch: number): number {
  return (
    SEALED_CONTAINER_KEK_KEYRING_HEADER_BYTES +
    (keyEpoch - 1) * SEALED_CONTAINER_KEK_KEYRING_ENTRY_BYTES +
    SEALED_CONTAINER_KEK_KEYRING_AEAD_OVERHEAD_BYTES
  );
}

function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/** Parse ceiling: the base64 length of a keyring sealed at the epoch cap. */
export const MAX_SEALED_CONTAINER_KEK_KEYRING_BASE64_LENGTH = base64Length(
  sealedContainerKekKeyringBytes(MAX_CONTAINER_KEY_EPOCH),
);

const AES_GCM_IV_BASE64_LENGTH = base64Length(12);

/**
 * Structural bound applied before any allocation-heavy or cryptographic work.
 * Content verification (exact length for the epoch, AEAD, per-entry
 * commitments) happens in `@tearleads/crypto`; this guard only bounds a
 * hostile payload.
 */
export function isContainerKekKeyringWireRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const iv = Reflect.get(value, "iv");
  const sealed = Reflect.get(value, "sealed");
  return (
    typeof iv === "string" &&
    iv.length <= AES_GCM_IV_BASE64_LENGTH &&
    typeof sealed === "string" &&
    sealed.length <= MAX_SEALED_CONTAINER_KEK_KEYRING_BASE64_LENGTH &&
    typeof Reflect.get(value, "containerId") === "string" &&
    typeof Reflect.get(value, "containerKeyEpochId") === "string" &&
    typeof Reflect.get(value, "sealingSuite") === "string" &&
    Reflect.get(value, "version") === 1
  );
}

/**
 * Maximum epochs one kek-log page may serve. Recovery walks the log from the
 * newest page backward, so the page bound — not the container's lifetime
 * rotation count — determines a response's size.
 */
export const CONTAINER_KEK_LOG_PAGE_LIMIT = 256;

/**
 * Maximum signed container rekeys one document/blob write may carry inline.
 * Each rotation ships a keyring, which is O(its epoch) bytes, so an unbounded
 * batch is an unbounded request body.
 */
export const MAX_INLINE_CONTAINER_REKEYS = 16;
