import { bytesToBase64 } from "@tearleads/encoding";
import { generateKemKeyPair } from "../encapsulation/generateKeyPair";

const utf8 = new TextEncoder();
const publicKeysByEpochId = new Map<string, string>();

/**
 * Distinct per epoch id: a rotation must publish a new wrapping key, so a
 * fixture that reused one key across epochs would make that check vacuous.
 */
function structuralSeed(epochId: string): Uint8Array {
  // Consume the whole id first: epoch ids share long container-scoped
  // prefixes, so sampling a fixed window would collide across epochs.
  let hash = 0x811c9dc5;
  for (const byte of utf8.encode(epochId)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  const seed = new Uint8Array(64);
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ (index + 1), 0x01000193) >>> 0;
    seed[index] = (hash >>> 24) & 0xff;
  }
  return seed;
}

/** For signature/shape fixtures only; decryption fixtures derive from their actual KEK. */
export function containerWrappingPublicKeyForTest(epochId: string): string;
export function containerWrappingPublicKeyForTest(
  epochId: string | null,
): string | null;
export function containerWrappingPublicKeyForTest(
  epochId: string | null,
): string | null {
  if (epochId === null) return null;
  const cached = publicKeysByEpochId.get(epochId);
  if (cached) return cached;
  const publicKey = bytesToBase64(
    generateKemKeyPair(structuralSeed(epochId)).publicKey,
  );
  publicKeysByEpochId.set(epochId, publicKey);
  return publicKey;
}
