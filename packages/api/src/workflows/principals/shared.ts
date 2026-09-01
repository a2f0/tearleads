import type {
  PrincipalPolicyValidationErrorCode,
  PrincipalStateExternalAuthority,
} from "@tearleads/crypto";
import { PrincipalPolicyValidationError } from "@tearleads/crypto";
import type { BillingErrorCode } from "@tearleads/validators/billing";
import type { PrincipalMemberEnvelopeRequest } from "@tearleads/validators/request";
import type {
  CurrentPrincipalMemberEnvelopesResponse,
  PrincipalMemberEnvelopeResponse,
  PrincipalStatePayloadResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";

export class PrincipalPolicyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503,
    readonly code?: BillingErrorCode,
  ) {
    super(message);
  }
}

export function assertStandalonePrincipalPolicyWrite(
  principalType: "group" | "organization",
): void {
  if (principalType === "group") {
    throw new PrincipalPolicyError(
      "Organization group policy updates require an authenticated organization commit",
      409,
    );
  }
}

function principalPolicyValidationStatus(
  code: PrincipalPolicyValidationErrorCode,
): 400 | 403 | 404 | 409 {
  switch (code) {
    case "invalid_artifact":
      return 400;
    case "unauthorized_signer":
      return 403;
    case "missing_state":
      return 404;
    case "state_conflict":
      return 409;
  }
}

export function toPrincipalPolicyError(
  error: unknown,
): PrincipalPolicyError | null {
  if (!(error instanceof PrincipalPolicyValidationError)) {
    return null;
  }

  const message =
    error.code === "missing_state"
      ? "Principal state not found"
      : error.message;
  return new PrincipalPolicyError(
    message,
    principalPolicyValidationStatus(error.code),
  );
}

export function toPrincipalStateResponse(state: {
  principalType: "group" | "organization";
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  membershipMode: "projection";
  membershipRoot: string;
  memberEnvelopesRoot: string;
  projectionRoot: string;
  grantRoot: string;
  payloadCiphertextHash: string;
  memberCount: number;
  grantCount: number;
  externalAuthority: PrincipalStateExternalAuthority | null;
  signedAt: string;
  signerUserId: string;
  signerUserKeyFingerprint: string;
  signature: string;
  stateHash: string;
  createdAt: Date;
}): PrincipalStateResponse {
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    prevStateHash: state.prevStateHash,
    keyEpoch: state.keyEpoch,
    encapsulationPublicKey: state.encapsulationPublicKey,
    keyFingerprint: state.keyFingerprint,
    membershipMode: state.membershipMode,
    membershipRoot: state.membershipRoot,
    memberEnvelopesRoot: state.memberEnvelopesRoot,
    projectionRoot: state.projectionRoot,
    grantRoot: state.grantRoot,
    payloadCiphertextHash: state.payloadCiphertextHash,
    memberCount: state.memberCount,
    grantCount: state.grantCount,
    externalAuthority: state.externalAuthority,
    signedAt: state.signedAt,
    signerUserId: state.signerUserId,
    signerUserKeyFingerprint: state.signerUserKeyFingerprint,
    signature: state.signature,
    stateHash: state.stateHash,
    createdAt: state.createdAt.toISOString(),
  };
}

export function toPrincipalStatePayloadResponse(input: {
  principalType: "group" | "organization";
  principalId: string;
  stateHash: string;
  cipherSuite: "aes-256-gcm";
  ciphertext: string;
  ciphertextHash: string;
  createdAt: Date;
}): PrincipalStatePayloadResponse {
  return {
    principalType: input.principalType,
    principalId: input.principalId,
    stateHash: input.stateHash,
    cipherSuite: input.cipherSuite,
    ciphertext: input.ciphertext,
    ciphertextHash: input.ciphertextHash,
    createdAt: input.createdAt.toISOString(),
  };
}

function toPrincipalMemberEnvelopeResponse(
  envelope: Pick<
    PrincipalMemberEnvelopeRequest,
    "userId" | "memberKeyFingerprint" | "kemCipherText" | "wrappedKey"
  >,
): PrincipalMemberEnvelopeResponse {
  return {
    userId: envelope.userId,
    memberKeyFingerprint: envelope.memberKeyFingerprint,
    kemCipherText: envelope.kemCipherText,
    wrappedKey: envelope.wrappedKey,
  };
}

export function toCurrentPrincipalMemberEnvelopesResponse(input: {
  principalType: "group" | "organization";
  principalId: string;
  stateHash: string;
  epoch: number;
  envelopes: ReadonlyArray<
    Pick<
      PrincipalMemberEnvelopeRequest,
      "userId" | "memberKeyFingerprint" | "kemCipherText" | "wrappedKey"
    >
  >;
}): CurrentPrincipalMemberEnvelopesResponse {
  return {
    principalType: input.principalType,
    principalId: input.principalId,
    stateHash: input.stateHash,
    epoch: input.epoch,
    envelopes: input.envelopes.map(toPrincipalMemberEnvelopeResponse),
  };
}
