import {
  AES_GCM_TAG_BYTES,
  ML_KEM1024_CIPHERTEXT_BYTES,
  ML_KEM1024_SECRET_KEY_BYTES,
  type PrincipalProjectionMember,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";

export async function memberEnvelopesForProjection(
  projection: readonly PrincipalProjectionMember[],
) {
  return Promise.all(
    projection.map(async (member, index) => ({
      userId: member.userId,
      memberKeyFingerprint: await toFingerprint(
        new TextEncoder().encode(member.userId),
      ),
      kemCipherText: bytesToBase64(
        new Uint8Array(ML_KEM1024_CIPHERTEXT_BYTES).fill(index + 1),
      ),
      wrappedKey: bytesToBase64(
        new Uint8Array(ML_KEM1024_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES).fill(
          index + 1,
        ),
      ),
    })),
  );
}
