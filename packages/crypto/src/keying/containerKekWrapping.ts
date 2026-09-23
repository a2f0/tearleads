import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  type EncapsulationKeyPair,
  generateKemKeyPair,
  ML_KEM1024_PUBLIC_KEY_BYTES,
  ML_KEM1024_SEED_BYTES,
} from "../encapsulation/generateKeyPair";
import { unwrapDek } from "../encapsulation/unwrapDek";
import { toFingerprint } from "../fingerprint";
import { throwVerification } from "./shared";

// Bounded public-only cache. A digest distinguishes mutable buffers without
// retaining KEK bytes, private keys, or derivation seeds between calls.
const publicWrappingKeys = new Map<string, string>();
const MAX_PUBLIC_WRAPPING_KEYS = 128;
const utf8 = new TextEncoder();
const wrappingKeyDomain = utf8.encode(
  "tearleads.container-kek.parent-wrapping.ml-kem-1024.v1",
);

/** A separate KEM key pair for each container KEK, without another secret to store. */
async function deriveContainerKekWrappingKeyPair(input: {
  readonly containerId: string;
  readonly keyMaterial: Uint8Array;
}): Promise<EncapsulationKeyPair> {
  if (!input.containerId || input.keyMaterial.byteLength !== 32) {
    throw new Error(
      "Container wrapping derivation requires an ID and 32-byte KEK",
    );
  }
  const keyMaterialCopy = input.keyMaterial.slice();
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("raw", keyMaterialCopy, "HKDF", false, [
      "deriveBits",
    ]);
  } finally {
    keyMaterialCopy.fill(0);
  }
  const seed = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: wrappingKeyDomain,
        info: utf8.encode(input.containerId),
      },
      key,
      ML_KEM1024_SEED_BYTES * 8,
    ),
  );
  try {
    return generateKemKeyPair(seed);
  } finally {
    seed.fill(0);
  }
}

export async function deriveContainerKekWrappingPublicKey(input: {
  readonly containerId: string;
  readonly keyMaterial: Uint8Array;
}): Promise<string> {
  if (!input.containerId || input.keyMaterial.byteLength !== 32) {
    throw new Error(
      "Container wrapping derivation requires an ID and 32-byte KEK",
    );
  }
  const keyMaterial = input.keyMaterial.slice();
  try {
    const cacheKey = `${input.containerId}:${await toFingerprint(keyMaterial)}`;
    const cached = publicWrappingKeys.get(cacheKey);
    if (cached) {
      publicWrappingKeys.delete(cacheKey);
      publicWrappingKeys.set(cacheKey, cached);
      return cached;
    }
    const pair = await deriveContainerKekWrappingKeyPair({
      ...input,
      keyMaterial,
    });
    try {
      const publicKey = bytesToBase64(pair.publicKey);
      publicWrappingKeys.set(cacheKey, publicKey);
      if (publicWrappingKeys.size > MAX_PUBLIC_WRAPPING_KEYS) {
        const oldest = publicWrappingKeys.keys().next().value;
        if (oldest !== undefined) publicWrappingKeys.delete(oldest);
      }
      return publicKey;
    } finally {
      pair.secretKey.fill(0);
    }
  } finally {
    keyMaterial.fill(0);
  }
}

export function normalizeContainerKekWrappingPublicKey(
  value: unknown,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throwVerification(
      "invalid_shape",
      "Container KEK public key must be base64",
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(value);
  } catch {
    throwVerification(
      "invalid_shape",
      "Container KEK public key must be base64",
    );
  }
  if (
    bytes.length !== ML_KEM1024_PUBLIC_KEY_BYTES ||
    bytesToBase64(bytes) !== value
  ) {
    throwVerification(
      "invalid_shape",
      "Container KEK public key must be canonical ML-KEM-1024",
    );
  }
  // FIPS 203 section 7.2: each packed 12-bit coefficient precedes the
  // final 32-byte public seed and must be less than q = 3329.
  for (let offset = 0; offset < bytes.length - 32; offset += 3) {
    const first = bytes[offset] ?? 0;
    const middle = bytes[offset + 1] ?? 0;
    const last = bytes[offset + 2] ?? 0;
    if (
      (first | ((middle & 15) << 8)) >= 3329 ||
      ((middle >> 4) | (last << 4)) >= 3329
    ) {
      throwVerification(
        "invalid_shape",
        "Container KEK public key has invalid ML-KEM coefficients",
      );
    }
  }
  return value;
}

/** Opens only the public-key parent wrapping protocol, including retained epochs. */
export async function unwrapContainerKekParentWrap(input: {
  readonly parentContainerId: string;
  readonly parentKeyMaterial: Uint8Array;
  readonly kemCipherText: string;
  readonly wrappedKey: string;
}): Promise<Uint8Array> {
  const pair = await deriveContainerKekWrappingKeyPair({
    containerId: input.parentContainerId,
    keyMaterial: input.parentKeyMaterial,
  });
  try {
    return await unwrapDek(
      [
        {
          keyFingerprint: await toFingerprint(pair.publicKey),
          kemCipherText: base64ToBytes(input.kemCipherText),
          wrappedKey: base64ToBytes(input.wrappedKey),
        },
      ],
      pair.secretKey,
    );
  } finally {
    pair.secretKey.fill(0);
  }
}
