import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { MAX_PRINCIPAL_STATE_VERSION } from "@tearleads/validators/util";
import { ML_KEM1024_PUBLIC_KEY_BYTES } from "./encapsulation/generateKeyPair";
import { toFingerprint } from "./fingerprint";
import { computePrincipalMemberEnvelopesRoot } from "./principalMemberEnvelopes";
import {
  comparePrincipalProjectionMembers,
  comparePrincipalStateMembers,
  hasDuplicateNormalizedPrincipalProjectionMembers,
  hasDuplicateNormalizedPrincipalStateMembers,
} from "./principalStateMembers";
import type {
  ManagedRecipientPrincipalType,
  PrincipalProjectionMember,
  PrincipalProjectionRole,
  PrincipalStateExternalAuthority,
  PrincipalStateHeaderInput,
  PrincipalStateMember,
  PrincipalStateMembershipMode,
  PrincipalStateSigningInput,
  SignedPrincipalState,
  UnsignedPrincipalState,
} from "./principalStateTypes";
import { sign } from "./signing/sign";
import { verify } from "./signing/verify";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export type {
  ManagedRecipientPrincipalType,
  PrincipalProjectionMember,
  PrincipalProjectionRole,
  PrincipalStateExternalAuthority,
  PrincipalStateHeaderInput,
  PrincipalStateMember,
  PrincipalStateMemberEnvelope,
  PrincipalStateMembershipMode,
  PrincipalStatePayloadCipherSuite,
  PrincipalStateSigningInput,
  SignedPrincipalState,
  UnsignedPrincipalState,
} from "./principalStateTypes";

function isValidPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isValidNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function isValidSignedAt(value: string): boolean {
  return !Number.isNaN(new Date(value).valueOf());
}

function encodeNormalizedPrincipalStateMembers(
  normalizedMembers: ReadonlyArray<PrincipalStateMember>,
): Uint8Array {
  return TEXT_ENCODER.encode(
    JSON.stringify(
      normalizedMembers.map((member) => ({
        userId: member.userId,
      })),
    ),
  );
}

function encodeNormalizedPrincipalProjectionMembers(
  normalizedMembers: ReadonlyArray<PrincipalProjectionMember>,
): Uint8Array {
  return TEXT_ENCODER.encode(
    JSON.stringify(
      normalizedMembers.map((member) => ({
        userId: member.userId,
        role: member.role,
      })),
    ),
  );
}

function encodeUnsignedPrincipalState(
  state: UnsignedPrincipalState,
): Uint8Array {
  return TEXT_ENCODER.encode(
    JSON.stringify({
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
    }),
  );
}

function toUnsignedPrincipalState(
  state: UnsignedPrincipalState,
): UnsignedPrincipalState {
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
  };
}

function isMembershipMode(
  value: string,
): value is PrincipalStateMembershipMode {
  return value === "projection";
}

function validatePrincipalStateIdentityFields(
  state: UnsignedPrincipalState,
): void {
  if (!isValidPositiveInteger(state.version)) {
    throw new Error("Principal state version must be a positive integer");
  }
  // The chain length a recovery walk can traverse is bounded, so accepting a
  // write past that ceiling would mint history no client could page back
  // through — the key would still exist and still be unreachable. Rejecting at
  // write time keeps the supported domain and the recoverable domain the same
  // set.
  if (state.version > MAX_PRINCIPAL_STATE_VERSION) {
    throw new Error(
      `Principal state version must not exceed ${MAX_PRINCIPAL_STATE_VERSION}`,
    );
  }

  if (!isValidPositiveInteger(state.keyEpoch)) {
    throw new Error("Principal state key epoch must be a positive integer");
  }

  if (state.principalId.length === 0) {
    throw new Error("Principal state principalId cannot be empty");
  }

  if (state.encapsulationPublicKey.length === 0) {
    throw new Error("Principal state encapsulationPublicKey cannot be empty");
  }

  if (state.keyFingerprint.length === 0) {
    throw new Error("Principal state keyFingerprint cannot be empty");
  }

  if (state.signerUserId.length === 0) {
    throw new Error("Principal state signerUserId cannot be empty");
  }

  if (state.signerUserKeyFingerprint.length === 0) {
    throw new Error("Principal state signerUserKeyFingerprint cannot be empty");
  }

  if (!isValidSignedAt(state.signedAt)) {
    throw new Error("Principal state signedAt must be a valid timestamp");
  }
}

function resolveMembershipMode(
  membershipMode: string | undefined,
): PrincipalStateMembershipMode {
  if (!membershipMode || !isMembershipMode(membershipMode)) {
    throw new Error("Principal state membershipMode is unsupported");
  }
  return membershipMode;
}

function requireNonEmptyHeaderString(
  value: string | undefined,
  message: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

function resolveMemberCount(state: UnsignedPrincipalState): number {
  if (
    typeof state.memberCount !== "number" ||
    !isValidNonNegativeInteger(state.memberCount)
  ) {
    throw new Error(
      "Principal state memberCount must be a non-negative integer",
    );
  }

  return state.memberCount;
}

function normalizeExternalAuthority(
  authority: PrincipalStateExternalAuthority | null,
): PrincipalStateExternalAuthority | null {
  if (authority === null) {
    return null;
  }

  if (
    authority.principalType !== "group" ||
    authority.principalId.length === 0 ||
    !isValidPositiveInteger(authority.version) ||
    !isValidPositiveInteger(authority.keyEpoch) ||
    authority.stateHash.length === 0 ||
    authority.keyFingerprint.length === 0
  ) {
    throw new Error("Principal state externalAuthority is invalid");
  }

  return {
    principalType: "group",
    principalId: authority.principalId,
    version: authority.version,
    keyEpoch: authority.keyEpoch,
    stateHash: authority.stateHash,
    keyFingerprint: authority.keyFingerprint,
  };
}

async function validatePrincipalEncapsulationKey(
  state: UnsignedPrincipalState,
): Promise<void> {
  let publicKey: Uint8Array;
  try {
    publicKey = base64ToBytes(state.encapsulationPublicKey);
  } catch {
    throw new Error(
      "Principal state encapsulationPublicKey must use canonical base64 encoding",
    );
  }

  if (bytesToBase64(publicKey) !== state.encapsulationPublicKey) {
    throw new Error(
      "Principal state encapsulationPublicKey must use canonical base64 encoding",
    );
  }

  if (publicKey.length !== ML_KEM1024_PUBLIC_KEY_BYTES) {
    throw new Error(
      `Principal state encapsulationPublicKey must contain exactly ${ML_KEM1024_PUBLIC_KEY_BYTES} bytes`,
    );
  }

  const publicKeyFingerprint = await toFingerprint(publicKey);
  if (publicKeyFingerprint !== state.keyFingerprint) {
    throw new Error(
      "Principal state keyFingerprint does not match encapsulationPublicKey",
    );
  }
}

async function normalizeUnsignedPrincipalState(
  state: UnsignedPrincipalState,
): Promise<UnsignedPrincipalState> {
  validatePrincipalStateIdentityFields(state);

  const membershipMode = resolveMembershipMode(state.membershipMode);
  const resolvedMembershipRoot = requireNonEmptyHeaderString(
    state.membershipRoot,
    "Principal state membershipRoot is required",
  );
  const resolvedProjectionRoot = requireNonEmptyHeaderString(
    state.projectionRoot,
    "Principal state projectionRoot is required",
  );
  const resolvedMemberEnvelopesRoot = requireNonEmptyHeaderString(
    state.memberEnvelopesRoot,
    "Principal state memberEnvelopesRoot is required",
  );
  const resolvedPayloadCiphertextHash = requireNonEmptyHeaderString(
    state.payloadCiphertextHash,
    "Principal state payloadCiphertextHash is required",
  );
  const memberCount = resolveMemberCount(state);

  await validatePrincipalEncapsulationKey(state);

  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    prevStateHash: state.prevStateHash,
    keyEpoch: state.keyEpoch,
    encapsulationPublicKey: state.encapsulationPublicKey,
    keyFingerprint: state.keyFingerprint,
    membershipMode,
    membershipRoot: resolvedMembershipRoot,
    memberEnvelopesRoot: resolvedMemberEnvelopesRoot,
    projectionRoot: resolvedProjectionRoot,
    payloadCiphertextHash: resolvedPayloadCiphertextHash,
    memberCount,
    externalAuthority: normalizeExternalAuthority(state.externalAuthority),
    signedAt: state.signedAt,
    signerUserId: state.signerUserId,
    signerUserKeyFingerprint: state.signerUserKeyFingerprint,
  };
}

export function isManagedRecipientPrincipalType(
  value: string,
): value is ManagedRecipientPrincipalType {
  return value === "group" || value === "organization";
}

export function isPrincipalProjectionRole(
  value: string,
): value is PrincipalProjectionRole {
  return value === "member" || value === "admin";
}

export function normalizePrincipalStateMembers(
  members: ReadonlyArray<PrincipalStateMember>,
): PrincipalStateMember[] {
  return members
    .map((member) => ({ userId: member.userId }))
    .sort(comparePrincipalStateMembers);
}

export function derivePrincipalProjectionMembers(
  members: ReadonlyArray<PrincipalStateMember>,
): PrincipalProjectionMember[] {
  return normalizePrincipalStateMembers(members).map((member) => ({
    userId: member.userId,
    role: "member",
  }));
}

export function normalizePrincipalProjectionMembers(
  members: ReadonlyArray<PrincipalProjectionMember>,
): PrincipalProjectionMember[] {
  return members
    .map((member) => ({ userId: member.userId, role: member.role }))
    .sort(comparePrincipalProjectionMembers);
}

export async function computePrincipalMembershipRoot(
  members: ReadonlyArray<PrincipalStateMember>,
): Promise<string> {
  const normalizedMembers = normalizePrincipalStateMembers(members);

  if (hasDuplicateNormalizedPrincipalStateMembers(normalizedMembers)) {
    throw new Error("Principal state cannot contain duplicate members");
  }

  return toFingerprint(
    encodeNormalizedPrincipalStateMembers(normalizedMembers),
  );
}

export async function computePrincipalProjectionRoot(
  members: ReadonlyArray<PrincipalProjectionMember>,
): Promise<string> {
  const normalizedMembers = normalizePrincipalProjectionMembers(members);

  if (hasDuplicateNormalizedPrincipalProjectionMembers(normalizedMembers)) {
    throw new Error(
      "Principal state projection cannot contain duplicate members",
    );
  }

  return toFingerprint(
    encodeNormalizedPrincipalProjectionMembers(normalizedMembers),
  );
}

export async function computePrincipalStatePayloadCiphertextHash(
  ciphertext: string,
): Promise<string> {
  return toFingerprint(TEXT_ENCODER.encode(ciphertext));
}

export async function buildPrincipalStateSigningInput(
  input: PrincipalStateHeaderInput,
): Promise<PrincipalStateSigningInput> {
  return {
    principalType: input.principalType,
    principalId: input.principalId,
    version: input.version,
    prevStateHash: input.prevStateHash,
    keyEpoch: input.keyEpoch,
    encapsulationPublicKey: input.encapsulationPublicKey,
    keyFingerprint: input.keyFingerprint,
    membershipMode: "projection",
    membershipRoot: await computePrincipalMembershipRoot(input.members),
    memberEnvelopesRoot: await computePrincipalMemberEnvelopesRoot(
      input.memberEnvelopes,
    ),
    projectionRoot: await computePrincipalProjectionRoot(input.projection),
    payloadCiphertextHash: await computePrincipalStatePayloadCiphertextHash(
      input.payloadCiphertext,
    ),
    memberCount: input.projection.length,
    externalAuthority: input.externalAuthority,
    signedAt: input.signedAt,
    signerUserId: input.signerUserId,
    signerUserKeyFingerprint: input.signerUserKeyFingerprint,
  };
}

export async function serializeUnsignedPrincipalState(
  state: UnsignedPrincipalState,
): Promise<string> {
  const normalizedState = await normalizeUnsignedPrincipalState(state);
  return TEXT_DECODER.decode(encodeUnsignedPrincipalState(normalizedState));
}

export async function computePrincipalStateHash(
  state: UnsignedPrincipalState,
): Promise<string> {
  const normalizedState = await normalizeUnsignedPrincipalState(state);
  return toFingerprint(encodeUnsignedPrincipalState(normalizedState));
}

export async function signPrincipalState(
  state: PrincipalStateSigningInput,
  secretKey: Uint8Array,
): Promise<SignedPrincipalState> {
  const normalizedState = await normalizeUnsignedPrincipalState(
    toUnsignedPrincipalState(state),
  );
  const signature = sign(
    encodeUnsignedPrincipalState(normalizedState),
    secretKey,
  );

  return {
    ...normalizedState,
    signature: bytesToBase64(signature),
  };
}

export async function verifySignedPrincipalState(
  state: SignedPrincipalState,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    const normalizedState = await normalizeUnsignedPrincipalState(
      toUnsignedPrincipalState(state),
    );
    return verify(
      base64ToBytes(state.signature),
      encodeUnsignedPrincipalState(normalizedState),
      publicKey,
    );
  } catch {
    return false;
  }
}
