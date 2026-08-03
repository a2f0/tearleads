import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  ML_KEM1024_CIPHERTEXT_BYTES,
  ML_KEM1024_SECRET_KEY_BYTES,
} from "./encapsulation/generateKeyPair";
import { toFingerprint } from "./fingerprint";
import type { PrincipalStateMemberEnvelope } from "./principalStateTypes";
import { AES_GCM_TAG_BYTES } from "./symmetric";

const TEXT_ENCODER = new TextEncoder();

export class PrincipalMemberEnvelopeValidationError extends Error {}

function invalidEnvelope(message: string): never {
  throw new PrincipalMemberEnvelopeValidationError(message);
}

/**
 * Envelopes are ordered by user id alone — recipient identity is the user id
 * now that a principal cannot contain another principal.
 */
function compareEnvelopes(
  left: PrincipalStateMemberEnvelope,
  right: PrincipalStateMemberEnvelope,
): number {
  return left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0;
}

function requireCanonicalBase64(value: string, label: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(value);
  } catch {
    invalidEnvelope(`${label} must use canonical base64 encoding`);
  }
  if (bytesToBase64(bytes) !== value) {
    invalidEnvelope(`${label} must use canonical base64 encoding`);
  }
  return bytes;
}

export function normalizePrincipalStateMemberEnvelopes(
  envelopes: ReadonlyArray<PrincipalStateMemberEnvelope>,
): PrincipalStateMemberEnvelope[] {
  const normalized = envelopes
    .map((envelope) => ({
      userId: envelope.userId,
      memberKeyFingerprint: envelope.memberKeyFingerprint,
      kemCipherText: envelope.kemCipherText,
      wrappedKey: envelope.wrappedKey,
    }))
    .sort(compareEnvelopes);

  for (const [index, envelope] of normalized.entries()) {
    if (
      envelope.userId.length === 0 ||
      !/^[0-9a-f]{64}$/.test(envelope.memberKeyFingerprint)
    ) {
      invalidEnvelope("Principal member envelope identity is invalid");
    }
    const previous = normalized[index - 1];
    if (previous?.userId === envelope.userId) {
      invalidEnvelope(
        "Principal state cannot contain duplicate member envelopes",
      );
    }
    const kemCipherText = requireCanonicalBase64(
      envelope.kemCipherText,
      "Principal member envelope KEM ciphertext",
    );
    if (kemCipherText.length !== ML_KEM1024_CIPHERTEXT_BYTES) {
      invalidEnvelope(
        `Principal member envelope KEM ciphertext must contain exactly ${ML_KEM1024_CIPHERTEXT_BYTES} bytes`,
      );
    }
    const wrappedKey = requireCanonicalBase64(
      envelope.wrappedKey,
      "Principal member envelope wrapped key",
    );
    const expectedWrappedKeyBytes =
      ML_KEM1024_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES;
    if (wrappedKey.length !== expectedWrappedKeyBytes) {
      invalidEnvelope(
        `Principal member envelope wrapped key must contain exactly ${expectedWrappedKeyBytes} bytes`,
      );
    }
  }

  return normalized;
}

export async function computePrincipalMemberEnvelopesRoot(
  envelopes: ReadonlyArray<PrincipalStateMemberEnvelope>,
): Promise<string> {
  return toFingerprint(
    TEXT_ENCODER.encode(
      JSON.stringify(normalizePrincipalStateMemberEnvelopes(envelopes)),
    ),
  );
}
