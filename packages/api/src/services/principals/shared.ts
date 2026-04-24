import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import { isManagedRecipientPrincipalType } from "@tearleads/crypto";
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
  ) {
    super(message);
  }
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
  membershipMode: "projection_v1";
  membershipRoot: string;
  projectionRoot: string;
  payloadCiphertextHash: string;
  memberCount: number;
  signedAt: string;
  signerKeyId: string;
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
    projectionRoot: state.projectionRoot,
    payloadCiphertextHash: state.payloadCiphertextHash,
    memberCount: state.memberCount,
    signedAt: state.signedAt,
    signerKeyId: state.signerKeyId,
    signature: state.signature,
    stateHash: state.stateHash,
    createdAt: state.createdAt.toISOString(),
  };
}

export function toPrincipalStatePayloadResponse(input: {
  principalType: "group" | "organization";
  principalId: string;
  stateHash: string;
  cipherSuite: "xchacha20poly1305-v1";
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
