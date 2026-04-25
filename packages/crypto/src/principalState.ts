import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { toFingerprint } from "./fingerprint";
import { sign } from "./signing/sign";
import { verify } from "./signing/verify";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export type ManagedRecipientPrincipalType = "group" | "organization";
export type PrincipalStateMemberType = "user" | "group";
export type PrincipalProjectionRole = "member" | "admin";
export type PrincipalStateMembershipMode = "projection_v1";
export type PrincipalStatePayloadCipherSuite = "aes-256-gcm-v1";

export interface PrincipalStateMember {
  principalType: PrincipalStateMemberType;
  principalId: string;
}

export interface PrincipalProjectionMember {
  memberPrincipalType: PrincipalStateMemberType;
  memberPrincipalId: string;
  role: PrincipalProjectionRole;
}

export interface UnsignedPrincipalState {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  membershipMode: PrincipalStateMembershipMode;
  membershipRoot: string;
  projectionRoot: string;
  payloadCiphertextHash: string;
  memberCount: number;
  signedAt: string;
  signerUserId: string;
  signerUserKeyFingerprint: string;
}

export type PrincipalStateSigningInput = UnsignedPrincipalState;

export interface PrincipalStateHeaderInput {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  members: PrincipalStateMember[];
  projection: PrincipalProjectionMember[];
  payloadCiphertext: string;
  signedAt: string;
  signerUserId: string;
  signerUserKeyFingerprint: string;
}

export interface SignedPrincipalState extends UnsignedPrincipalState {
  signature: string;
}

interface PrincipalStateLike {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  signedAt: string;
  signerUserId: string;
  signerUserKeyFingerprint: string;
  membershipMode?: PrincipalStateMembershipMode;
  membershipRoot?: string;
  projectionRoot?: string;
  payloadCiphertextHash?: string;
  memberCount?: number;
  signature?: string;
}

function comparePrincipalStateMembers(
  left: PrincipalStateMember,
  right: PrincipalStateMember,
): number {
  if (left.principalType === right.principalType) {
    return left.principalId.localeCompare(right.principalId);
  }

  return left.principalType.localeCompare(right.principalType);
}

function comparePrincipalProjectionMembers(
  left: PrincipalProjectionMember,
  right: PrincipalProjectionMember,
): number {
  if (left.memberPrincipalType === right.memberPrincipalType) {
    return left.memberPrincipalId.localeCompare(right.memberPrincipalId);
  }

  return left.memberPrincipalType.localeCompare(right.memberPrincipalType);
}

function hasDuplicateNormalizedPrincipalStateMembers(
  normalizedMembers: ReadonlyArray<PrincipalStateMember>,
): boolean {
  for (let index = 1; index < normalizedMembers.length; index += 1) {
    const previousMember = normalizedMembers[index - 1];
    const currentMember = normalizedMembers[index];

    if (
      previousMember &&
      currentMember &&
      previousMember.principalType === currentMember.principalType &&
      previousMember.principalId === currentMember.principalId
    ) {
      return true;
    }
  }

  return false;
}

function hasDuplicateNormalizedPrincipalProjectionMembers(
  normalizedMembers: ReadonlyArray<PrincipalProjectionMember>,
): boolean {
  for (let index = 1; index < normalizedMembers.length; index += 1) {
    const previousMember = normalizedMembers[index - 1];
    const currentMember = normalizedMembers[index];

    if (
      previousMember &&
      currentMember &&
      previousMember.memberPrincipalType ===
        currentMember.memberPrincipalType &&
      previousMember.memberPrincipalId === currentMember.memberPrincipalId
    ) {
      return true;
    }
  }

  return false;
}

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
        principalType: member.principalType,
        principalId: member.principalId,
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
        memberPrincipalType: member.memberPrincipalType,
        memberPrincipalId: member.memberPrincipalId,
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
      projectionRoot: state.projectionRoot,
      payloadCiphertextHash: state.payloadCiphertextHash,
      memberCount: state.memberCount,
      signedAt: state.signedAt,
      signerUserId: state.signerUserId,
      signerUserKeyFingerprint: state.signerUserKeyFingerprint,
    }),
  );
}

function toUnsignedPrincipalState(
  state: PrincipalStateLike,
): PrincipalStateLike {
  const unsignedState: PrincipalStateLike = {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    prevStateHash: state.prevStateHash,
    keyEpoch: state.keyEpoch,
    encapsulationPublicKey: state.encapsulationPublicKey,
    keyFingerprint: state.keyFingerprint,
    signedAt: state.signedAt,
    signerUserId: state.signerUserId,
    signerUserKeyFingerprint: state.signerUserKeyFingerprint,
  };

  if (typeof state.membershipMode === "string") {
    unsignedState.membershipMode = state.membershipMode;
  }

  if (typeof state.membershipRoot === "string") {
    unsignedState.membershipRoot = state.membershipRoot;
  }

  if (typeof state.projectionRoot === "string") {
    unsignedState.projectionRoot = state.projectionRoot;
  }

  if (typeof state.payloadCiphertextHash === "string") {
    unsignedState.payloadCiphertextHash = state.payloadCiphertextHash;
  }

  if (typeof state.memberCount === "number") {
    unsignedState.memberCount = state.memberCount;
  }

  return unsignedState;
}

function isMembershipMode(
  value: string,
): value is PrincipalStateMembershipMode {
  return value === "projection_v1";
}

function validatePrincipalStateIdentityFields(state: PrincipalStateLike): void {
  if (!isValidPositiveInteger(state.version)) {
    throw new Error("Principal state version must be a positive integer");
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

function resolveMemberCount(state: PrincipalStateLike): number {
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

async function validatePrincipalEncapsulationKey(
  state: PrincipalStateLike,
): Promise<void> {
  const publicKeyFingerprint = await toFingerprint(
    base64ToBytes(state.encapsulationPublicKey),
  );
  if (publicKeyFingerprint !== state.keyFingerprint) {
    throw new Error(
      "Principal state keyFingerprint does not match encapsulationPublicKey",
    );
  }
}

async function normalizeUnsignedPrincipalState(
  state: PrincipalStateLike,
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
    projectionRoot: resolvedProjectionRoot,
    payloadCiphertextHash: resolvedPayloadCiphertextHash,
    memberCount,
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

export function isPrincipalStateMemberType(
  value: string,
): value is PrincipalStateMemberType {
  return value === "user" || value === "group";
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
    .map((member) => ({
      principalType: member.principalType,
      principalId: member.principalId,
    }))
    .sort(comparePrincipalStateMembers);
}

export function derivePrincipalProjectionMembers(
  members: ReadonlyArray<PrincipalStateMember>,
): PrincipalProjectionMember[] {
  return normalizePrincipalStateMembers(members).map((member) => ({
    memberPrincipalType: member.principalType,
    memberPrincipalId: member.principalId,
    role: "member",
  }));
}

export function normalizePrincipalProjectionMembers(
  members: ReadonlyArray<PrincipalProjectionMember>,
): PrincipalProjectionMember[] {
  return members
    .map((member) => ({
      memberPrincipalType: member.memberPrincipalType,
      memberPrincipalId: member.memberPrincipalId,
      role: member.role,
    }))
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
    membershipMode: "projection_v1",
    membershipRoot: await computePrincipalMembershipRoot(input.members),
    projectionRoot: await computePrincipalProjectionRoot(input.projection),
    payloadCiphertextHash: await computePrincipalStatePayloadCiphertextHash(
      input.payloadCiphertext,
    ),
    memberCount: input.projection.length,
    signedAt: input.signedAt,
    signerUserId: input.signerUserId,
    signerUserKeyFingerprint: input.signerUserKeyFingerprint,
  };
}

export async function serializeUnsignedPrincipalState(
  state: PrincipalStateLike,
): Promise<string> {
  const normalizedState = await normalizeUnsignedPrincipalState(state);
  return TEXT_DECODER.decode(encodeUnsignedPrincipalState(normalizedState));
}

export async function computePrincipalStateHash(
  state: PrincipalStateLike,
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
