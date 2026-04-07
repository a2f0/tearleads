import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { toFingerprint } from "./fingerprint";
import { sign } from "./signing/sign";
import { verify } from "./signing/verify";

const TEXT_ENCODER = new TextEncoder();

export type ManagedRecipientPrincipalType = "group" | "organization";
export type PrincipalStateMemberType = "user" | "group";

export interface PrincipalStateMember {
  principalType: PrincipalStateMemberType;
  principalId: string;
}

export interface PrincipalStateSigningInput {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  members: PrincipalStateMember[];
  membershipRoot?: string;
  signedAt: string;
  signerKeyId: string;
}

export interface UnsignedPrincipalState {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  members: PrincipalStateMember[];
  membershipRoot: string;
  signedAt: string;
  signerKeyId: string;
}

export interface SignedPrincipalState extends UnsignedPrincipalState {
  signature: string;
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

function comparePrincipalStateMembers(
  left: PrincipalStateMember,
  right: PrincipalStateMember,
): number {
  if (left.principalType === right.principalType) {
    return left.principalId.localeCompare(right.principalId);
  }

  return left.principalType.localeCompare(right.principalType);
}

function hasDuplicatePrincipalStateMembers(
  members: ReadonlyArray<PrincipalStateMember>,
): boolean {
  const normalizedMembers = normalizePrincipalStateMembers(members);

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

function isValidPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isValidSignedAt(value: string): boolean {
  return !Number.isNaN(new Date(value).valueOf());
}

function encodePrincipalStateMembers(
  members: ReadonlyArray<PrincipalStateMember>,
): Uint8Array {
  return TEXT_ENCODER.encode(
    JSON.stringify(
      normalizePrincipalStateMembers(members).map((member) => ({
        principalType: member.principalType,
        principalId: member.principalId,
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
      members: normalizePrincipalStateMembers(state.members).map((member) => ({
        principalType: member.principalType,
        principalId: member.principalId,
      })),
      membershipRoot: state.membershipRoot,
      signedAt: state.signedAt,
      signerKeyId: state.signerKeyId,
    }),
  );
}

function toUnsignedPrincipalState(
  state:
    | PrincipalStateSigningInput
    | UnsignedPrincipalState
    | SignedPrincipalState,
): PrincipalStateSigningInput | UnsignedPrincipalState {
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    prevStateHash: state.prevStateHash,
    keyEpoch: state.keyEpoch,
    encapsulationPublicKey: state.encapsulationPublicKey,
    keyFingerprint: state.keyFingerprint,
    members: state.members,
    signedAt: state.signedAt,
    signerKeyId: state.signerKeyId,
    ...(typeof state.membershipRoot === "string"
      ? { membershipRoot: state.membershipRoot }
      : {}),
  };
}

async function normalizeUnsignedPrincipalState(
  state:
    | PrincipalStateSigningInput
    | UnsignedPrincipalState
    | SignedPrincipalState,
): Promise<UnsignedPrincipalState> {
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

  if (state.signerKeyId.length === 0) {
    throw new Error("Principal state signerKeyId cannot be empty");
  }

  if (!isValidSignedAt(state.signedAt)) {
    throw new Error("Principal state signedAt must be a valid timestamp");
  }

  if (hasDuplicatePrincipalStateMembers(state.members)) {
    throw new Error("Principal state cannot contain duplicate members");
  }

  const normalizedMembers = normalizePrincipalStateMembers(state.members);
  const membershipRoot =
    await computePrincipalMembershipRoot(normalizedMembers);
  const publicKeyFingerprint = await toFingerprint(
    base64ToBytes(state.encapsulationPublicKey),
  );

  if (publicKeyFingerprint !== state.keyFingerprint) {
    throw new Error(
      "Principal state keyFingerprint does not match encapsulationPublicKey",
    );
  }

  if (
    typeof state.membershipRoot === "string" &&
    state.membershipRoot.length > 0 &&
    state.membershipRoot !== membershipRoot
  ) {
    throw new Error("Principal state membershipRoot does not match members");
  }

  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    prevStateHash: state.prevStateHash,
    keyEpoch: state.keyEpoch,
    encapsulationPublicKey: state.encapsulationPublicKey,
    keyFingerprint: state.keyFingerprint,
    members: normalizedMembers,
    membershipRoot,
    signedAt: state.signedAt,
    signerKeyId: state.signerKeyId,
  };
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

export async function computePrincipalMembershipRoot(
  members: ReadonlyArray<PrincipalStateMember>,
): Promise<string> {
  return toFingerprint(encodePrincipalStateMembers(members));
}

export async function serializeUnsignedPrincipalState(
  state:
    | PrincipalStateSigningInput
    | UnsignedPrincipalState
    | SignedPrincipalState,
): Promise<string> {
  const normalizedState = await normalizeUnsignedPrincipalState(state);
  return new TextDecoder().decode(
    encodeUnsignedPrincipalState(normalizedState),
  );
}

export async function computePrincipalStateHash(
  state:
    | PrincipalStateSigningInput
    | UnsignedPrincipalState
    | SignedPrincipalState,
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
