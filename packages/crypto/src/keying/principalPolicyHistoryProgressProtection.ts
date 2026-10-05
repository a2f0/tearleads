import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  decryptWithDek,
  encryptWithDek,
} from "../symmetric";
import {
  normalizeCanonicalJsonValue,
  serializeKeyingCanonicalJson,
} from "./canonical";
import type { normalizePrincipalHistoryInput } from "./principalPolicyHistoryChecks";
import { PRINCIPAL_HISTORY_VERIFICATION_REVISION } from "./principalPolicyHistoryPage";
import type { PrincipalPolicyHistoryProgressOptions } from "./principalPolicyHistoryTypes";
import { throwVerification } from "./shared";

// Format domain; accepted history rules carry the page verifier's revision.
const DOMAIN = "tearleads.principal-policy-history-progress.v1";
const utf8 = new TextEncoder();

export function ownPrincipalHistoryProgressProtection(
  input: ReturnType<typeof normalizePrincipalHistoryInput>,
  options: PrincipalPolicyHistoryProgressOptions,
) {
  const { localKey, context } = options;
  if (
    !(localKey instanceof Uint8Array) ||
    localKey.byteLength !== 32 ||
    typeof context !== "string" ||
    context.length === 0
  )
    throwVerification(
      "invalid_shape",
      "principal history progress requires a local 32-byte key and context",
    );
  const additionalData = utf8.encode(
    serializeKeyingCanonicalJson(
      normalizeCanonicalJsonValue(
        [DOMAIN, PRINCIPAL_HISTORY_VERIFICATION_REVISION, context, input],
        "principal progress protection",
      ),
    ),
  );
  // Derive synchronously, before yielding to callers that own mutable buffers.
  const ownedKey = new Uint8Array(localKey);
  try {
    const key = hkdf(
      sha256,
      ownedKey,
      utf8.encode(DOMAIN),
      // Separate each normalized operation/scope/revision into its own key.
      sha256(additionalData),
      32,
    );
    return { key, additionalData };
  } finally {
    ownedKey.fill(0);
  }
}

type Protection = ReturnType<typeof ownPrincipalHistoryProgressProtection>;

export async function sealPrincipalHistoryProgress(
  plaintext: string,
  protection: Protection,
): Promise<string> {
  try {
    const encrypted = await encryptWithDek(
      utf8.encode(plaintext),
      protection.key,
      protection.additionalData,
    );
    return `v1.${bytesToBase64(encrypted.iv)}.${bytesToBase64(encrypted.ciphertext)}`;
  } finally {
    protection.key.fill(0);
  }
}

function canonicalBytes(value: string): Uint8Array {
  const bytes = base64ToBytes(value);
  if (bytesToBase64(bytes) !== value)
    throwVerification("invalid_shape", "noncanonical principal progress");
  return bytes;
}

export async function openPrincipalHistoryProgress(
  progress: string,
  protection: Protection,
): Promise<unknown> {
  try {
    const [version, iv, ciphertext, extra] = progress.split(".");
    if (version !== "v1" || !iv || !ciphertext || extra !== undefined)
      throwVerification("invalid_shape", "invalid principal history progress");
    const encrypted = {
      iv: canonicalBytes(iv),
      ciphertext: canonicalBytes(ciphertext),
    };
    if (
      encrypted.iv.length !== AES_GCM_IV_BYTES ||
      encrypted.ciphertext.length < AES_GCM_TAG_BYTES
    )
      throwVerification("invalid_shape", "invalid principal progress framing");
    let plaintext: Uint8Array;
    try {
      plaintext = await decryptWithDek(
        encrypted,
        protection.key,
        protection.additionalData,
      );
    } catch {
      throwVerification(
        "hash_mismatch",
        "principal history progress authentication failed",
      );
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
      );
    } finally {
      plaintext.fill(0);
    }
  } finally {
    protection.key.fill(0);
  }
}
