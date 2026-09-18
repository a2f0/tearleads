import { bytesToBase64 } from "@tearleads/encoding";
import { generateKemKeyPair } from "../encapsulation/generateKeyPair";

const structuralPublicKey = bytesToBase64(
  generateKemKeyPair(new Uint8Array(64)).publicKey,
);

/** For signature/shape fixtures only; decryption fixtures derive from their actual KEK. */
export function containerWrappingPublicKeyForTest(epochId: string): string;
export function containerWrappingPublicKeyForTest(
  epochId: string | null,
): string | null;
export function containerWrappingPublicKeyForTest(
  epochId: string | null,
): string | null {
  return epochId === null ? null : structuralPublicKey;
}
