import {
  KeyingVerificationError,
  type VerifiedAccessEvent,
  verifySignedAccessEvent,
} from "@tearleads/crypto";

/** Re-verify a stored access event's signature and content hash. */
export async function verifyStoredAccessEvent(input: {
  readonly stored: VerifiedAccessEvent;
  readonly signerPublicKey: Uint8Array;
  readonly error: (message: string) => Error;
}): Promise<VerifiedAccessEvent> {
  const result = await verifySignedAccessEvent({
    body: input.stored.body,
    event: input.stored.event,
    signerPublicKey: input.signerPublicKey,
  });
  if (!result.ok) {
    throw input.error(
      result.error instanceof KeyingVerificationError
        ? result.error.message
        : "access event signature verification failed",
    );
  }
  if (result.value.eventHash !== input.stored.eventHash) {
    throw input.error("access event hash is inconsistent");
  }
  return result.value;
}
