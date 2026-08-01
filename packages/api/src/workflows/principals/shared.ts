import type {
  ManagedRecipientPrincipalType,
  PrincipalStateExternalAuthority,
} from "@tearleads/crypto";
import {
  isManagedRecipientPrincipalType,
  PrincipalMemberEnvelopeValidationError,
} from "@tearleads/crypto";
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
    readonly status: 400 | 403 | 404 | 409,
    readonly code?: BillingErrorCode,
  ) {
    super(message);
  }
}

function toPrincipalStateError(error: unknown): PrincipalPolicyError | null {
  if (error instanceof PrincipalMemberEnvelopeValidationError) {
    return new PrincipalPolicyError(error.message, 400);
  }

  if (!(error instanceof Error)) {
    return null;
  }

  if (error.message === "Invalid principal state signature") {
    return new PrincipalPolicyError(error.message, 403);
  }

  if (
    error.message === "Principal state signer user not found" ||
    error.message === "Principal state signer fingerprint mismatch" ||
    error.message === "Principal state signer must be an admin" ||
    error.message ===
      "Directly authorized principal state cannot cite external authority"
  ) {
    return new PrincipalPolicyError(error.message, 403);
  }

  if (
    error.message === "Principal state version conflict" ||
    error.message === "Principal epoch key conflict" ||
    error.message === "Principal state previous hash mismatch" ||
    error.message === "Principal state payload conflict" ||
    error.message === "Principal state projection conflict" ||
    error.message === "Principal policy transition principal mismatch" ||
    error.message === "Principal policy transition version is not contiguous" ||
    error.message === "Principal policy transition previous hash mismatch" ||
    error.message === "Principal policy key epoch cannot decrease" ||
    error.message === "Principal policy key change requires a new key epoch" ||
    error.message ===
      "Principal policy key epoch advance requires new key material" ||
    error.message ===
      "Principal policy shrink requires a new key epoch and key material"
  ) {
    return new PrincipalPolicyError(error.message, 409);
  }

  if (
    error.message ===
      "Principal state payload ciphertext hash does not match ciphertext" ||
    error.message ===
      "Principal state payloadCiphertextHash does not match encrypted payload" ||
    error.message ===
      "Principal state projectionRoot does not match projection" ||
    error.message ===
      "Principal state membershipRoot does not match projection" ||
    error.message ===
      "Principal state memberEnvelopesRoot does not match member envelopes" ||
    error.message === "Principal state memberCount does not match projection" ||
    error.message ===
      "Principal state encapsulationPublicKey must use canonical base64 encoding" ||
    error.message.startsWith(
      "Principal state encapsulationPublicKey must contain exactly ",
    ) ||
    error.message ===
      "Principal state keyFingerprint does not match encapsulationPublicKey"
  ) {
    return new PrincipalPolicyError(error.message, 400);
  }

  return null;
}

function toPrincipalMemberEnvelopeError(
  error: unknown,
): PrincipalPolicyError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (
    error.message ===
    "Principal member envelopes do not match the signed state root"
  ) {
    return new PrincipalPolicyError(error.message, 400);
  }

  if (
    error.message ===
      "Principal member envelopes must target the current state" ||
    error.message === "Principal member envelope conflict"
  ) {
    return new PrincipalPolicyError(error.message, 409);
  }

  if (
    error.message ===
      "Principal member envelopes must match the current direct member set" ||
    error.message ===
      "Principal member envelopes must cover the current direct member set" ||
    error.message.startsWith(
      "Principal member envelope targets unknown member",
    ) ||
    error.message.startsWith("Principal member envelope fingerprint mismatch")
  ) {
    return new PrincipalPolicyError(error.message, 409);
  }

  if (
    error.message.startsWith(
      "Principal member envelope is missing wrapped material",
    )
  ) {
    return new PrincipalPolicyError(error.message, 400);
  }

  if (
    error.message.startsWith("Missing current principal state for ") ||
    error.message === "Principal state not found"
  ) {
    return new PrincipalPolicyError("Principal state not found", 404);
  }

  if (
    error.message.startsWith(
      "Missing user recipient key for principal state member",
    ) ||
    error.message.startsWith(
      "Missing current principal epoch key for group member",
    )
  ) {
    return new PrincipalPolicyError(error.message, 409);
  }

  return null;
}

export function toPrincipalPolicyError(
  error: unknown,
): PrincipalPolicyError | null {
  return toPrincipalStateError(error) ?? toPrincipalMemberEnvelopeError(error);
}

export function parseManagedPrincipalType(
  value: string,
): ManagedRecipientPrincipalType | null {
  if (!isManagedRecipientPrincipalType(value)) {
    return null;
  }

  return value;
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
  payloadCiphertextHash: string;
  memberCount: number;
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
    payloadCiphertextHash: state.payloadCiphertextHash,
    memberCount: state.memberCount,
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
    | "memberPrincipalType"
    | "memberPrincipalId"
    | "memberKeyFingerprint"
    | "kemCipherText"
    | "wrappedKey"
  >,
): PrincipalMemberEnvelopeResponse {
  return {
    memberPrincipalType: envelope.memberPrincipalType,
    memberPrincipalId: envelope.memberPrincipalId,
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
      | "memberPrincipalType"
      | "memberPrincipalId"
      | "memberKeyFingerprint"
      | "kemCipherText"
      | "wrappedKey"
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
