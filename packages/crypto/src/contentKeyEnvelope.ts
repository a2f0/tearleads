import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { assertExactKeys } from "./keying/shared";
import type {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
} from "./keying/types";
import { AES_GCM_IV_BYTES, AES_GCM_TAG_BYTES } from "./symmetric";

export class ContentKeyEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentKeyEnvelopeError";
  }
}

function decodeFixedBase64(
  value: string,
  size: number,
  label: string,
): Uint8Array {
  if (typeof value !== "string" || value.length !== 4 * Math.ceil(size / 3)) {
    throw new ContentKeyEnvelopeError(`${label} has an invalid encoded length`);
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(value);
  } catch {
    throw new ContentKeyEnvelopeError(`${label} must use canonical base64`);
  }
  if (bytes.length !== size || bytesToBase64(bytes) !== value) {
    throw new ContentKeyEnvelopeError(
      `${label} must encode exactly ${size} bytes in canonical base64`,
    );
  }
  return bytes;
}

/** Where an envelope came from; a submission is held to the published shape. */
export type ContentKeyEnvelopeOrigin = "stored" | "submission";

/** Checks public envelope structure only; authentication still requires the KEK. */
export function decodeContentKeyEnvelope(input: {
  readonly envelope: {
    readonly wrappedKey: string;
    readonly wrappingMetadata?: unknown;
  };
  readonly label: "Blob" | "Document";
  /**
   * `submission` enforces the published shape before anything is persisted.
   * `stored` tolerates an unexpected metadata key, which would otherwise make
   * an already decryptable envelope permanently unreadable.
   *
   * The suite is checked in both modes. Blob and document wraps are sealed to
   * the same container KEK with no additional authenticated data, and the
   * target hash covers neither the wrapped key nor its metadata, so the suite
   * label is the only thing binding an envelope to its object kind on read —
   * without it a server could serve a document envelope inside a blob bundle.
   * No stored row can carry the wrong suite, because it was always rejected.
   */
  readonly origin: ContentKeyEnvelopeOrigin;
  readonly suite:
    | typeof DOCUMENT_CONTENT_KEY_WRAP_SUITE
    | typeof BLOB_CONTENT_KEY_WRAP_SUITE;
}): { readonly iv: Uint8Array; readonly ciphertext: Uint8Array } {
  const label = `${input.label} content-key target`;
  const submitted = input.origin === "submission";
  let metadata: Record<string, unknown>;
  if (submitted) {
    try {
      metadata = assertExactKeys(
        input.envelope.wrappingMetadata,
        ["iv", "suite"],
        label,
      );
    } catch {
      throw new ContentKeyEnvelopeError(
        `${label} metadata must contain exactly suite and iv`,
      );
    }
    if (Reflect.get(metadata, "suite") !== input.suite) {
      throw new ContentKeyEnvelopeError(`${label} uses an unknown suite`);
    }
  } else {
    const stored = input.envelope.wrappingMetadata;
    if (typeof stored !== "object" || stored === null) {
      throw new ContentKeyEnvelopeError(`${label} is missing an IV`);
    }
    metadata = stored as Record<string, unknown>;
    if (Reflect.get(metadata, "suite") !== input.suite) {
      throw new ContentKeyEnvelopeError(`${label} uses an unknown suite`);
    }
  }
  const iv = Reflect.get(metadata, "iv");
  if (typeof iv !== "string" || iv.length === 0) {
    throw new ContentKeyEnvelopeError(`${label} is missing an IV`);
  }
  return {
    iv: decodeFixedBase64(iv, AES_GCM_IV_BYTES, `${label} IV`),
    ciphertext: decodeFixedBase64(
      input.envelope.wrappedKey,
      32 + AES_GCM_TAG_BYTES,
      `${label} wrapped key`,
    ),
  };
}
