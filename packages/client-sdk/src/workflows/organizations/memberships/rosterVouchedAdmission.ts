import {
  computePrincipalMemberEnvelopesRoot,
  KeyingVerificationError,
  PrincipalMemberEnvelopeValidationError,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type {
  CurrentPrincipalMemberEnvelopesResponse,
  PrincipalMemberEnvelopeResponse,
  PrincipalPolicyStateChainEntryResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import type { RecoveredPrincipalHistoryPage } from "../../principals/historyRecovery/loadRecoveredPrincipalHistoryPage";

import { createRosterAdmissionHistory } from "./rosterAdmissionHistory";

const MAX_ADMISSION_DEPTH = 64;

/** This device's pin for a user, as the admission reads it. */
export interface RosterAdmissionPin {
  readonly identityBundleFingerprint: string;
  readonly encapsulationKeyFingerprint: string;
  readonly signingKeyFingerprint: string;
  /** Established by a verified identity link or this device's own keys. */
  readonly verified: boolean;
}

export interface RosterAdmissionEvidence {
  /** The organization's verified current Members head and its envelopes. */
  readonly loadCurrentMembers: () => Promise<{
    readonly envelopes: readonly PrincipalMemberEnvelopeResponse[];
    readonly head: ReferencedPrincipalHead;
    readonly projection: PrincipalPolicyStateChainEntryResponse["projection"];
  }>;
  /** Verified Members history ending at `head`, ascending, one page at a time. */
  readonly loadHistoryPage: (
    head: ReferencedPrincipalHead,
    beforeVersion: number | undefined,
  ) => Promise<RecoveredPrincipalHistoryPage>;
  /** This device's pin for `userId`, of any provenance, or null. */
  readonly loadPin: (userId: string) => Promise<RosterAdmissionPin | null>;
  /**
   * The server's member envelopes for one state, or null when it has none.
   * Unauthenticated: checked here against the state's signed root.
   */
  readonly loadStateEnvelopes: (
    state: PrincipalStateResponse,
  ) => Promise<CurrentPrincipalMemberEnvelopesResponse | null>;
}

function memberKeyFingerprint(
  envelopes: readonly PrincipalMemberEnvelopeResponse[],
  userId: string,
): string | null {
  return (
    envelopes.find((envelope) => envelope.userId === userId)
      ?.memberKeyFingerprint ?? null
  );
}

// The served list's root; a malformed list (duplicate members, non-canonical
// ciphertext) is tampering with received material, like a wrong root.
async function servedEnvelopesRoot(
  envelopes: readonly PrincipalMemberEnvelopeResponse[],
): Promise<string> {
  try {
    return await computePrincipalMemberEnvelopesRoot(envelopes);
  } catch (error) {
    if (error instanceof PrincipalMemberEnvelopeValidationError)
      throw new KeyingVerificationError("invalid_shape", error.message);
    throw error;
  }
}

// The server's envelope list for a state must be exactly the one its signed
// root commits, for exactly that state's members.
async function assertStateEnvelopes(
  entry: PrincipalPolicyStateChainEntryResponse,
  envelopes: CurrentPrincipalMemberEnvelopesResponse,
): Promise<void> {
  const { state } = entry;
  const envelopeUsers = new Set(envelopes.envelopes.map((item) => item.userId));
  if (
    envelopes.principalType !== state.principalType ||
    envelopes.principalId !== state.principalId ||
    envelopes.stateHash !== state.stateHash ||
    envelopes.epoch !== state.keyEpoch ||
    (await servedEnvelopesRoot(envelopes.envelopes)) !==
      state.memberEnvelopesRoot ||
    envelopeUsers.size !== entry.projection.length ||
    entry.projection.some((member) => !envelopeUsers.has(member.userId))
  )
    throw new KeyingVerificationError(
      "hash_mismatch",
      "Members state envelopes do not match the signed state",
    );
}

function assertIdentityCommitment(
  committed: string,
  pin: RosterAdmissionPin,
): void {
  if (committed !== pin.identityBundleFingerprint)
    throw new KeyingVerificationError(
      "hash_mismatch",
      "Members identity bundle differs from pinned identity",
    );
}

interface AdmissionSearch {
  readonly evidence: RosterAdmissionEvidence;
  readonly history: ReturnType<typeof createRosterAdmissionHistory>;
  readonly visited: Set<string>;
}

async function authenticate(
  id: string,
  pin: RosterAdmissionPin,
  atVersion: number,
  current: boolean,
  search: AdmissionSearch,
): Promise<boolean> {
  const { evidence, history, visited } = search;
  // Independently verified signers need not be Members (external Admins).
  if (!current && pin.verified) return true;
  if (visited.has(id) || visited.size >= MAX_ADMISSION_DEPTH) return false;
  visited.add(id);
  const start = await history.membershipStart(id, atVersion, current);
  if (!start || start.state.signerUserId === id) return false;
  const member = start.projection.find((item) => item.userId === id);
  if (!member) return false;
  assertIdentityCommitment(member.identityBundleFingerprint, pin);
  const signer = await evidence.loadPin(start.state.signerUserId);
  if (!signer) return false;
  if (signer.signingKeyFingerprint !== start.state.signerUserKeyFingerprint)
    throw new KeyingVerificationError(
      "hash_mismatch",
      "Members signer differs from pinned identity",
    );
  const signerMember = start.projection.find(
    (item) => item.userId === start.state.signerUserId,
  );
  if (signerMember)
    assertIdentityCommitment(signerMember.identityBundleFingerprint, signer);
  const envelopes = await evidence.loadStateEnvelopes(start.state);
  if (!envelopes) return false;
  await assertStateEnvelopes(start, envelopes);
  if (
    memberKeyFingerprint(envelopes.envelopes, id) !==
    pin.encapsulationKeyFingerprint
  )
    throw new KeyingVerificationError(
      "hash_mismatch",
      "Historical Members envelope differs from pinned identity",
    );
  return authenticate(
    start.state.signerUserId,
    signer,
    start.state.version - 1,
    false,
    search,
  );
}

/** Authenticate a full pinned identity through strictly earlier Members admissions. */
export async function isRosterVouchedRecipient(
  userId: string,
  evidence: RosterAdmissionEvidence,
): Promise<boolean> {
  const recipient = await evidence.loadPin(userId);
  if (!recipient) return false;
  const members = await evidence.loadCurrentMembers();
  const currentMember = members.projection.find(
    (member) => member.userId === userId,
  );
  if (!currentMember) return false;
  assertIdentityCommitment(currentMember.identityBundleFingerprint, recipient);
  if (
    memberKeyFingerprint(members.envelopes, userId) !==
    recipient.encapsulationKeyFingerprint
  )
    throw new KeyingVerificationError(
      "hash_mismatch",
      "Members envelope differs from pinned identity",
    );
  const history = createRosterAdmissionHistory(
    members.head,
    evidence.loadHistoryPage,
  );
  const visited = new Set<string>();

  return authenticate(userId, recipient, members.head.version, true, {
    evidence,
    history,
    visited,
  });
}
