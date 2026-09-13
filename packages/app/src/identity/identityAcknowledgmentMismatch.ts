/**
 * The SDK refuses a login whose server-returned user ID differs from the one
 * already acknowledged for the active signing identity. That refusal is
 * integrity evidence (the server answered this key pair with another account),
 * not a connectivity problem, so hosts must name it instead of folding it into
 * the generic authentication failure.
 */
export const IDENTITY_ACKNOWLEDGMENT_MISMATCH_MESSAGE =
  "Authentication refused: the server returned a different account for this identity.";

export function isIdentityAcknowledgmentMismatch(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "KeyingVerificationError" &&
    Reflect.get(error, "code") === "object_mismatch"
  );
}
