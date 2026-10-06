import {
  KeyingVerificationError,
  type PrincipalPolicyHistoryProgressOptions,
} from "@tearleads/crypto";

/** Own private key bytes before any asynchronous discovery or verification. */
export function ownPrincipalHistoryProtection(
  protection: PrincipalPolicyHistoryProgressOptions,
) {
  if (
    !(protection.localKey instanceof Uint8Array) ||
    protection.localKey.byteLength !== 32 ||
    typeof protection.context !== "string" ||
    protection.context.length === 0
  )
    throw new KeyingVerificationError(
      "invalid_shape",
      "Principal history recovery requires a private 32-byte key and trust context",
    );
  return {
    context: protection.context,
    localKey: new Uint8Array(protection.localKey),
  };
}
