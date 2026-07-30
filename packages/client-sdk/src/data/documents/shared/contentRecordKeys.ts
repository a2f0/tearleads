import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  type KeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { asWebCryptoBytes } from "./readers";
import {
  DOCUMENT_CONTENT_RECORD_HKDF_SALT,
  DOCUMENT_CONTENT_RECORD_KEY_INFO_DOMAIN,
  DOCUMENT_CONTENT_RECORD_PLAINTEXT_HASH_KEY_INFO_DOMAIN,
  TEXT_ENCODER,
} from "./types";

interface ContentRecordKeyInput {
  contentKeyMaterial: CryptoKey;
  contentKeyEpoch: number;
  contentRecordId: string;
  documentId: string;
  organizationId: string;
}

export function documentContentRecordDerivationPayload(
  input: Omit<ContentRecordKeyInput, "contentKeyMaterial">,
): Record<string, KeyingCanonicalJson> {
  return {
    version: 1,
    organizationId: input.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: input.contentRecordId,
  };
}

function keyInfoBytes(
  domain: string,
  input: Omit<ContentRecordKeyInput, "contentKeyMaterial">,
): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain,
      payload: documentContentRecordDerivationPayload(input),
    }),
  );
}

export async function deriveDocumentContentRecordKey(
  input: ContentRecordKeyInput & { usage: "decrypt" | "encrypt" },
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: DOCUMENT_CONTENT_RECORD_HKDF_SALT,
      info: keyInfoBytes(DOCUMENT_CONTENT_RECORD_KEY_INFO_DOMAIN, input),
    },
    input.contentKeyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    [input.usage],
  );
}

export async function deriveDocumentPlaintextHashKey(
  input: ContentRecordKeyInput,
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: DOCUMENT_CONTENT_RECORD_HKDF_SALT,
      info: keyInfoBytes(
        DOCUMENT_CONTENT_RECORD_PLAINTEXT_HASH_KEY_INFO_DOMAIN,
        input,
      ),
    },
    input.contentKeyMaterial,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

export async function importDocumentContentKeyMaterial(
  contentKey: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    asWebCryptoBytes(contentKey),
    "HKDF",
    false,
    ["deriveKey"],
  );
}
