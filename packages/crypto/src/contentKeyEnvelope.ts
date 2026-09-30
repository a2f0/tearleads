import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { serializeKeyingCanonicalJson } from "./keying/canonical";
import { assertExactKeys } from "./keying/shared";
import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
} from "./keying/types";
import {
  AES_256_KEY_BYTES,
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  decryptWithDek,
  encryptWithDek,
  type SymmetricCiphertext,
} from "./symmetric";

const TEXT_ENCODER = new TextEncoder();

export class ContentKeyEnvelopeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
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
  } catch (error) {
    throw new ContentKeyEnvelopeError(`${label} must use canonical base64`, {
      cause: error,
    });
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
 * The suite is derived from the kind rather than accepted alongside it, so a
 * caller cannot pair one kind's label with the other's suite. The target hash
 * covers neither the wrapped key nor its metadata; the wrap's authenticated
 * data binds the envelope to its object instead.
 */
const CONTENT_KEY_WRAP_SUITES = {
  Blob: BLOB_CONTENT_KEY_WRAP_SUITE,
  Document: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
} as const;

/** What a content-key wrap is bound to: its object, key epoch and target. */
export interface ContentKeyWrapBinding {
  readonly kind: ContentKeyEnvelopeKind;
  /** The document id, or the blob id for an attachment key. */
  readonly objectId: string;
  readonly contentKeyEpoch: number;
  readonly containerId: string;
  readonly containerKeyEpochId: string;
}

/**
 * Authenticated data for a content-key wrap. Blob and document keys are
 * sealed to the same container KEK, so without it a server could serve one
 * object's wrap in another's bundle, or at another epoch or target, and it
 * would still open.
 */
function contentKeyWrapAssociatedData(
  binding: ContentKeyWrapBinding,
): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: "tearleads.content-key-wrap.aad",
      payload: {
        version: 1,
        suite: CONTENT_KEY_WRAP_SUITES[binding.kind],
        objectId: binding.objectId,
        contentKeyEpoch: binding.contentKeyEpoch,
        containerId: binding.containerId,
        containerKeyEpochId: binding.containerKeyEpochId,
      },
    }),
  );
}

/** Seal a content key to one target's container KEK, bound to its object. */
export function wrapContentKey(
  contentKey: Uint8Array,
  containerKek: Uint8Array,
  binding: ContentKeyWrapBinding,
): Promise<SymmetricCiphertext> {
  return encryptWithDek(
    contentKey,
    containerKek,
    contentKeyWrapAssociatedData(binding),
  );
}

/** Open a content-key wrap; it fails unless the binding matches its sealing. */
export function unwrapContentKey(
  wrapped: SymmetricCiphertext,
  containerKek: Uint8Array,
  binding: ContentKeyWrapBinding,
): Promise<Uint8Array> {
  return decryptWithDek(
    wrapped,
    containerKek,
    contentKeyWrapAssociatedData(binding),
  );
}

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
   *
   * `stored` is nonetheless stricter than simply decoding the base64, which
   * is what the client did before. That is deliberate and does not reopen the
   * lockout: the IV and key sizes are fixed by the suite, so a row that fails
   * them is malformed rather than newer, and a canonical encoding is what
   * makes comparing wrapped keys as strings — how a retained wrap is
   * recognized — mean comparing the bytes.
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
    } catch (error) {
      throw new ContentKeyEnvelopeError(
        `${label} metadata must contain exactly suite and iv`,
        { cause: error },
      );
    }
  }
  if (Reflect.get(raw, "suite") !== CONTENT_KEY_WRAP_SUITES[input.kind]) {
    throw new ContentKeyEnvelopeError(`${label} uses an unknown suite`);
  }
  const iv = Reflect.get(raw, "iv");
  if (typeof iv !== "string") {
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
