import {
  KeyingVerificationError,
  type VerifiedAccessEvent,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { StoredManifestWork } from "./storedManifestWork";

const pureCryptoScope = {};
const verificationWork = new StoredManifestWork<VerifiedAccessEvent>(2_048);

export function clearStoredAccessEventVerificationCache(): void {
  verificationWork.clear();
}

/** Only pure signature/hash work is shared across database transactions. */
export async function verifyStoredAccessEvent(input: {
  readonly stored: VerifiedAccessEvent;
  readonly signerPublicKey: Uint8Array;
  readonly error: (message: string) => Error;
}): Promise<VerifiedAccessEvent> {
  try {
    return await verificationWork.run({
      scope: pureCryptoScope,
      key: input.stored.eventHash,
      source: {
        stored: input.stored,
        signerPublicKey: input.signerPublicKey,
      },
      verify: async () => {
        const result = await verifySignedAccessEvent({
          body: input.stored.body,
          event: input.stored.event,
          signerPublicKey: input.signerPublicKey,
        });
        if (!result.ok) throw result.error;
        if (result.value.eventHash !== input.stored.eventHash) {
          throw new KeyingVerificationError(
            "hash_mismatch",
            "access event hash is inconsistent",
          );
        }
        return result.value;
      },
    });
  } catch (error) {
    if (error instanceof KeyingVerificationError)
      throw input.error(error.message);
    throw error;
  }
}
