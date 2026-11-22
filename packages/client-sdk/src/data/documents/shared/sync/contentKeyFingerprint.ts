import { bytesToHex, serializeKeyingCanonicalJson } from "@tearleads/crypto";
import { asWebCryptoBytes } from "../readers";
import { DOCUMENT_CONTENT_RECORD_HKDF_SALT, TEXT_ENCODER } from "../types";

const DOCUMENT_CONTENT_KEY_FINGERPRINT_INFO_DOMAIN =
  "tearleads.document.content-key-fingerprint";

/**
 * Names the content key a device judged a document's updates under without
 * revealing it: an HKDF output in its own domain, so it derives no record key.
 * A void row keeps it so a device that later holds a different key for the
 * same epoch judges those updates again instead of trusting the old verdict.
 */
async function deriveDocumentContentKeyFingerprint(input: {
  readonly contentKey: Uint8Array;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
}): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    asWebCryptoBytes(input.contentKey),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: DOCUMENT_CONTENT_RECORD_HKDF_SALT,
      info: TEXT_ENCODER.encode(
        serializeKeyingCanonicalJson({
          domain: DOCUMENT_CONTENT_KEY_FINGERPRINT_INFO_DOMAIN,
          payload: {
            version: 1,
            objectKind: "document",
            objectId: input.documentId,
            contentKeyEpoch: input.contentKeyEpoch,
          },
        }),
      ),
    },
    material,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** One fingerprint per epoch whose key the pass held. */
export async function deriveDocumentContentKeyFingerprints(input: {
  readonly contentKeysByEpoch: ReadonlyMap<number, Uint8Array>;
  readonly documentId: string;
}): Promise<ReadonlyMap<number, string>> {
  const entries = await Promise.all(
    [...input.contentKeysByEpoch].map(
      async ([contentKeyEpoch, contentKey]) =>
        [
          contentKeyEpoch,
          await deriveDocumentContentKeyFingerprint({
            contentKey,
            contentKeyEpoch,
            documentId: input.documentId,
          }),
        ] as const,
    ),
  );
  return new Map(entries);
}
