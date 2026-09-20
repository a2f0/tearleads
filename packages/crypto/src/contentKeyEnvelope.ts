import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { assertExactKeys } from "./keying/shared";
import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
} from "./keying/types";
import {
  AES_256_KEY_BYTES,
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
} from "./symmetric";

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
  if (value.length !== 4 * Math.ceil(size / 3)) {
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

/** The object an envelope wraps a content key for. */
export type ContentKeyEnvelopeKind = "Blob" | "Document";

/**
 * The suite is derived from the kind rather than accepted alongside it. It is
 * the only thing binding an envelope to its object kind — blob and document
 * wraps are sealed to the same container KEK with no additional authenticated
 * data, and the target hash covers neither the wrapped key nor its metadata —
 * so a caller must not be able to pair one kind's label with the other's
 * suite.
 */
const CONTENT_KEY_WRAP_SUITES = {
  Blob: BLOB_CONTENT_KEY_WRAP_SUITE,
  Document: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
} as const;

/** Checks public envelope structure only; authentication still requires the KEK. */
export function decodeContentKeyEnvelope(input: {
  readonly envelope: {
    readonly wrappedKey: string;
    readonly wrappingMetadata?: unknown;
  };
  readonly kind: ContentKeyEnvelopeKind;
  /**
   * The two modes differ in exactly one respect: `submission` requires the
   * metadata to carry `suite` and `iv` and nothing else, while `stored`
   * ignores an unrecognized extra key so a newer writer's envelope never
   * becomes unreadable. Every other check — the suite, and the canonical
   * base64 encoding and byte length of the IV and wrapped key — is applied
   * identically, so a submission that passes is always readable later.
   */
  readonly origin: ContentKeyEnvelopeOrigin;
}): { readonly iv: Uint8Array; readonly ciphertext: Uint8Array } {
  const label = `${input.kind} content-key target`;
  const raw = input.envelope.wrappingMetadata;
  if (!isPlainObject(raw)) {
    throw new ContentKeyEnvelopeError(`${label} is missing wrap metadata`);
  }
  if (input.origin === "submission") {
    try {
      assertExactKeys(raw, ["iv", "suite"], label);
    } catch {
      throw new ContentKeyEnvelopeError(
        `${label} metadata must contain exactly suite and iv`,
      );
    }
  }
  if (Reflect.get(raw, "suite") !== CONTENT_KEY_WRAP_SUITES[input.kind]) {
    throw new ContentKeyEnvelopeError(`${label} uses an unknown suite`);
  }
  const iv = Reflect.get(raw, "iv");
  if (typeof iv !== "string" || iv.length === 0) {
    throw new ContentKeyEnvelopeError(`${label} is missing an IV`);
  }
  return {
    iv: decodeFixedBase64(iv, AES_GCM_IV_BYTES, `${label} IV`),
    ciphertext: decodeFixedBase64(
      input.envelope.wrappedKey,
      AES_256_KEY_BYTES + AES_GCM_TAG_BYTES,
      `${label} wrapped key`,
    ),
  };
}
