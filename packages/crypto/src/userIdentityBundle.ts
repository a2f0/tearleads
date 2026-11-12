import { bytesToBase64 } from "@tearleads/encoding";
import { toFingerprint } from "./fingerprint";

/**
 * The identity-link v1 commitment shared by links and signed policy members.
 * Callers supply a validated user identity and its canonical deployment trust
 * domain; this function never substitutes a request origin or another domain.
 */
export function computeUserIdentityBundleFingerprint(input: {
  readonly identityTrustDomain: string;
  readonly userId: string;
  readonly signingPublicKey: Uint8Array;
  readonly encapsulationPublicKey: Uint8Array;
}): Promise<string> {
  return toFingerprint(
    new TextEncoder().encode(
      JSON.stringify([
        "tearleads.identity-link.v1",
        input.identityTrustDomain,
        input.userId,
        "ML-DSA-87",
        bytesToBase64(input.signingPublicKey),
        "ML-KEM-1024",
        bytesToBase64(input.encapsulationPublicKey),
      ]),
    ),
  );
}
