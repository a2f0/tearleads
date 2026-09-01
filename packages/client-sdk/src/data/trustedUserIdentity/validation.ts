import {
  KeyingVerificationError,
  ML_DSA87_PUBLIC_KEY_BYTES,
  ML_KEM1024_PUBLIC_KEY_BYTES,
  toFingerprint,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isUuidV4String } from "@tearleads/validators/util";
import type {
  LocalUserIdentityCandidate,
  RemoteUserIdentityCandidate,
  ValidatedUserIdentityCandidate,
} from "./types";

export function assertTrustedUserIdentityUserId(userId: string): void {
  if (!isUuidV4String(userId) || userId !== userId.toLowerCase()) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "Trusted user identity requires a canonical lowercase UUID v4 user id",
    );
  }
}

function decodeCanonicalPublicKey(input: {
  readonly encoded: string;
  readonly expectedLength: number;
  readonly label: string;
}): Uint8Array {
  let decoded: Uint8Array;
  try {
    decoded = base64ToBytes(input.encoded);
  } catch {
    throw new KeyingVerificationError(
      "invalid_shape",
      `${input.label} must use canonical base64 encoding`,
    );
  }

  if (bytesToBase64(decoded) !== input.encoded) {
    throw new KeyingVerificationError(
      "invalid_shape",
      `${input.label} must use canonical base64 encoding`,
    );
  }
  return validatePublicKeyLength({
    bytes: decoded,
    expectedLength: input.expectedLength,
    label: input.label,
  });
}

function validatePublicKeyLength(input: {
  readonly bytes: Uint8Array;
  readonly expectedLength: number;
  readonly label: string;
}): Uint8Array {
  if (input.bytes.length !== input.expectedLength) {
    throw new KeyingVerificationError(
      "invalid_shape",
      `${input.label} must contain exactly ${input.expectedLength} bytes`,
    );
  }
  return new Uint8Array(input.bytes);
}

async function validateFingerprints(input: {
  readonly encapsulationKeyFingerprint?: string | null | undefined;
  readonly encapsulationPublicKey: Uint8Array;
  readonly signingKeyFingerprint?: string | null | undefined;
  readonly signingPublicKey: Uint8Array;
}): Promise<{
  readonly encapsulationKeyFingerprint: string;
  readonly signingKeyFingerprint: string;
}> {
  const [signingKeyFingerprint, encapsulationKeyFingerprint] =
    await Promise.all([
      toFingerprint(input.signingPublicKey),
      toFingerprint(input.encapsulationPublicKey),
    ]);

  if (
    input.signingKeyFingerprint !== undefined &&
    input.signingKeyFingerprint !== null &&
    input.signingKeyFingerprint !== signingKeyFingerprint
  ) {
    throw new KeyingVerificationError(
      "hash_mismatch",
      "Trusted user identity signing fingerprint does not match its public key",
    );
  }
  if (
    input.encapsulationKeyFingerprint !== undefined &&
    input.encapsulationKeyFingerprint !== null &&
    input.encapsulationKeyFingerprint !== encapsulationKeyFingerprint
  ) {
    throw new KeyingVerificationError(
      "hash_mismatch",
      "Trusted user identity encapsulation fingerprint does not match its public key",
    );
  }

  return { encapsulationKeyFingerprint, signingKeyFingerprint };
}

async function buildValidatedUserIdentityCandidate(input: {
  readonly candidate: LocalUserIdentityCandidate;
  readonly identityTrustDomain: string;
  readonly userId: string;
  readonly encapsulationKeyFingerprint?: string | null | undefined;
}): Promise<ValidatedUserIdentityCandidate> {
  const signingPublicKey = validatePublicKeyLength({
    bytes: input.candidate.signingPublicKey,
    expectedLength: ML_DSA87_PUBLIC_KEY_BYTES,
    label: "Signing public key",
  });
  const encapsulationPublicKey = validatePublicKeyLength({
    bytes: input.candidate.encapsulationPublicKey,
    expectedLength: ML_KEM1024_PUBLIC_KEY_BYTES,
    label: "Encapsulation public key",
  });
  const fingerprints = await validateFingerprints({
    encapsulationKeyFingerprint: input.encapsulationKeyFingerprint,
    encapsulationPublicKey,
    signingKeyFingerprint: input.candidate.signingKeyFingerprint,
    signingPublicKey,
  });

  return {
    ...fingerprints,
    encapsulationPublicKey,
    identityTrustDomain: input.identityTrustDomain,
    signingPublicKey,
    userId: input.userId,
  };
}

export async function validateLocalUserIdentity(input: {
  readonly candidate: LocalUserIdentityCandidate;
  readonly identityTrustDomain: string;
  readonly userId: string;
}): Promise<ValidatedUserIdentityCandidate> {
  assertTrustedUserIdentityUserId(input.userId);
  return buildValidatedUserIdentityCandidate(input);
}

export async function validateRemoteUserIdentity(input: {
  readonly candidate: RemoteUserIdentityCandidate;
  readonly identityTrustDomain: string;
  readonly requestedUserId: string;
}): Promise<ValidatedUserIdentityCandidate> {
  assertTrustedUserIdentityUserId(input.requestedUserId);
  if (input.candidate.userId !== input.requestedUserId) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "Trusted user identity response does not match the requested user",
    );
  }

  const signingPublicKey = decodeCanonicalPublicKey({
    encoded: input.candidate.signingPublicKey,
    expectedLength: ML_DSA87_PUBLIC_KEY_BYTES,
    label: "Signing public key",
  });
  const encapsulationPublicKey = decodeCanonicalPublicKey({
    encoded: input.candidate.encapsulationPublicKey,
    expectedLength: ML_KEM1024_PUBLIC_KEY_BYTES,
    label: "Encapsulation public key",
  });

  return buildValidatedUserIdentityCandidate({
    candidate: {
      encapsulationPublicKey,
      signingKeyFingerprint: input.candidate.signingKeyFingerprint,
      signingPublicKey,
    },
    encapsulationKeyFingerprint: input.candidate.encapsulationKeyFingerprint,
    identityTrustDomain: input.identityTrustDomain,
    userId: input.requestedUserId,
  });
}
