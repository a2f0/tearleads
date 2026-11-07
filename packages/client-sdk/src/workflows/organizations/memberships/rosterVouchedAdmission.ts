import {
  computePrincipalMemberEnvelopesRoot,
  KeyingVerificationError,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type {
  CurrentPrincipalMemberEnvelopesResponse,
  PrincipalMemberEnvelopeResponse,
  PrincipalPolicyStateChainEntryResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import type { RecoveredPrincipalHistoryPage } from "../../principals/historyRecovery/loadRecoveredPrincipalHistoryPage";

// How far back one admission walks verified Members history to find where its
// recipient joined: 64 display pages of 32 states. A longer walk refuses, and
// the recipient's own identity link still admits them.
const MAX_MEMBERS_HISTORY_PAGES = 64;

/** This device's pin for a user, as the admission reads it. */
export interface RosterAdmissionPin {
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

function hasMember(
  entry: PrincipalPolicyStateChainEntryResponse,
  userId: string,
): boolean {
  return entry.projection.some((member) => member.userId === userId);
}

// One state in the walk back from `head`: same principal, the expected
// version, and the head's own hash at the head version.
function continuesHistory(
  state: PrincipalStateResponse,
  head: ReferencedPrincipalHead,
  expectedVersion: number,
): boolean {
  return (
    state.principalType === head.principalType &&
    state.principalId === head.principalId &&
    state.version === expectedVersion &&
    (state.version !== head.version || state.stateHash === head.stateHash)
  );
}

/**
 * The verified Members state that started the user's current, unbroken
 * membership: the earliest state of the run that reaches the head. Null when
 * the user is not a member at the head or the walk cannot place them.
 */
async function findMembershipStart(
  userId: string,
  head: ReferencedPrincipalHead,
  loadHistoryPage: RosterAdmissionEvidence["loadHistoryPage"],
): Promise<PrincipalPolicyStateChainEntryResponse | null> {
  let expectedVersion = head.version;
  let beforeVersion: number | undefined;
  let start: PrincipalPolicyStateChainEntryResponse | null = null;
  for (let pages = 0; pages < MAX_MEMBERS_HISTORY_PAGES; pages += 1) {
    const page = await loadHistoryPage(head, beforeVersion);
    for (const entry of [...page.entries].reverse()) {
      if (!continuesHistory(entry.state, head, expectedVersion)) return null;
      if (!hasMember(entry, userId)) return start;
      start = entry;
      if (entry.state.version === 1) return start;
      expectedVersion -= 1;
    }
    if (page.nextBeforeVersion === null || page.entries.length === 0)
      return null;
    beforeVersion = page.nextBeforeVersion;
  }
  return null;
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
    (await computePrincipalMemberEnvelopesRoot(envelopes.envelopes)) !==
      state.memberEnvelopesRoot ||
    envelopeUsers.size !== entry.projection.length ||
    entry.projection.some((member) => !envelopeUsers.has(member.userId))
  )
    throw new KeyingVerificationError(
      "hash_mismatch",
      "Members state envelopes do not match the signed state",
    );
}

/**
 * Whether the organization's signed roster vouches for `userId`'s encryption
 * key on this device. Adding someone to Members requires the adding admin to
 * have verified their identity link, so the Members state that started their
 * current membership is that admin's signed statement of the key they
 * verified. It counts only when this device itself verified that admin's
 * signing key (a link, or its own keys), and only for the encryption key that
 * state committed, which must still be the user's key in the current Members
 * state and in this device's pin. The user's signing key is not vouched for.
 */
export async function isRosterVouchedRecipient(
  userId: string,
  evidence: RosterAdmissionEvidence,
): Promise<boolean> {
  const recipient = await evidence.loadPin(userId);
  if (!recipient) return false;
  const members = await evidence.loadCurrentMembers();
  if (
    memberKeyFingerprint(members.envelopes, userId) !==
    recipient.encapsulationKeyFingerprint
  )
    return false;
  const start = await findMembershipStart(
    userId,
    members.head,
    evidence.loadHistoryPage,
  );
  if (!start || start.state.signerUserId === userId) return false;
  const signer = await evidence.loadPin(start.state.signerUserId);
  if (
    !signer?.verified ||
    signer.signingKeyFingerprint !== start.state.signerUserKeyFingerprint
  )
    return false;
  const envelopes = await evidence.loadStateEnvelopes(start.state);
  if (!envelopes) return false;
  await assertStateEnvelopes(start, envelopes);
  return (
    memberKeyFingerprint(envelopes.envelopes, userId) ===
    recipient.encapsulationKeyFingerprint
  );
}
