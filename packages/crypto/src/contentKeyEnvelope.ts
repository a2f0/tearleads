import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { assertExactKeys } from "./keying/shared";
import type {
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

/** The AES-GCM wrap suite naming the object kind an envelope belongs to. */
export type ContentKeyEnvelopeSuite =
  | typeof BLOB_CONTENT_KEY_WRAP_SUITE
  | typeof DOCUMENT_CONTENT_KEY_WRAP_SUITE;

/** Checks public envelope structure only; authentication still requires the KEK. */
export function decodeContentKeyEnvelope(input: {
  readonly envelope: {
    readonly wrappedKey: string;
    readonly wrappingMetadata?: unknown;
  };
  readonly label: "Blob" | "Document";
  /**
   * The two modes differ in exactly one respect: `submission` requires the
   * metadata to carry `suite` and `iv` and nothing else, while `stored`
   * ignores an unrecognized extra key. Every other check — the suite, and the
   * canonical base64 encoding and byte length of the IV and wrapped key — is
   * applied identically, so a submission that passes is always readable later.
   *
   * The suite is checked in both modes because blob and document wraps are
   * sealed to the same container KEK with no additional authenticated data,
   * and the target hash covers neither the wrapped key nor its metadata. The
   * suite label is therefore the only thing binding an envelope to its object
   * kind on read: without it a server could serve a document envelope inside a
   * blob bundle.
   */
  readonly origin: ContentKeyEnvelopeOrigin;
  readonly suite: ContentKeyEnvelopeSuite;
}): { readonly iv: Uint8Array; readonly ciphertext: Uint8Array } {
  const label = `${input.label} content-key target`;
  const raw = input.envelope.wrappingMetadata;
  let metadata: Record<string, unknown>;
  if (input.origin === "submission") {
    try {
      metadata = assertExactKeys(raw, ["iv", "suite"], label);
    } catch {
      throw new ContentKeyEnvelopeError(
        `${label} metadata must contain exactly suite and iv`,
      );
    }
  } else {
    if (!isPlainObject(raw)) {
      throw new ContentKeyEnvelopeError(`${label} is missing wrap metadata`);
    }
    metadata = raw;
  }
  if (Reflect.get(metadata, "suite") !== input.suite) {
    throw new ContentKeyEnvelopeError(`${label} uses an unknown suite`);
  }
  const iv = Reflect.get(metadata, "iv");
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
