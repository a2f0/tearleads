import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { OrganizationLeaveRequest } from "@tearleads/validators/util";
import type { RecoveredPrincipalHistoryPage } from "../../principals/historyRecovery/loadRecoveredPrincipalHistoryPage";

// How far back one request's check walks verified Members history: a request
// stays pending for days, not for hundreds of Members changes.
const MAX_MEMBERS_HISTORY_PAGES = 8;

export interface LeaveRequestMembershipEvidence {
  /** The Members head this device has verified, or null when it has none. */
  readonly loadMembersHead: () => Promise<ReferencedPrincipalHead | null>;
  /**
   * Verified Members history ending at `head`, one page at a time and in
   * ascending order. Absent where this device cannot read history.
   */
  readonly loadHistoryPage?:
    | ((
        head: ReferencedPrincipalHead,
        beforeVersion: number | undefined,
      ) => Promise<RecoveredPrincipalHistoryPage>)
    | undefined;
}

/** Whether a leave request still belongs to its member's current membership. */
export type LeaveRequestMembershipCheck = (
  request: OrganizationLeaveRequest,
) => Promise<boolean>;

function citesState(
  request: OrganizationLeaveRequest,
  state: RecoveredPrincipalHistoryPage["entries"][number]["state"],
): boolean {
  const cited = request.membersHead;
  return (
    state.version === cited.version &&
    state.stateHash === cited.stateHash &&
    state.keyEpoch === cited.keyEpoch &&
    state.keyFingerprint === cited.keyFingerprint
  );
}

// Walks verified Members history back from the head to the cited state,
// requiring the member in every state on the way.
async function memberStayedSinceCitedState(
  request: OrganizationLeaveRequest,
  head: ReferencedPrincipalHead,
  loadHistoryPage: NonNullable<
    LeaveRequestMembershipEvidence["loadHistoryPage"]
  >,
): Promise<boolean> {
  let expectedVersion = head.version;
  let beforeVersion: number | undefined;
  for (let pages = 0; pages < MAX_MEMBERS_HISTORY_PAGES; pages += 1) {
    const page = await loadHistoryPage(head, beforeVersion);
    for (const entry of [...page.entries].reverse()) {
      const { state } = entry;
      if (
        state.principalType !== head.principalType ||
        state.principalId !== head.principalId ||
        state.version !== expectedVersion ||
        (state.version === head.version && state.stateHash !== head.stateHash)
      )
        return false;
      if (!entry.projection.some((member) => member.userId === request.userId))
        return false;
      if (state.version === request.membersHead.version)
        return citesState(request, state);
      expectedVersion -= 1;
    }
    if (page.nextBeforeVersion === null || page.entries.length === 0)
      return false;
    beforeVersion = page.nextBeforeVersion;
  }
  return false;
}

/**
 * Checks each leave request against this device's verified Members head.
 * Removing anyone from Members rotates its key epoch, so a request citing the
 * head's own epoch has seen no removal since. One citing an earlier epoch
 * stands only if verified history shows its member in every Members state
 * from the cited one on; a request from a membership a removal ended never
 * does, whatever the server serves beside it. Display only: a request this
 * device cannot place is shown as no request.
 */
export function createLeaveRequestMembershipCheck(
  evidence: LeaveRequestMembershipEvidence,
): LeaveRequestMembershipCheck {
  let membersHead: Promise<ReferencedPrincipalHead | null> | undefined;
  return async (request) => {
    membersHead ??= evidence.loadMembersHead().catch(() => null);
    const head = await membersHead;
    const cited = request.membersHead;
    if (
      head?.principalType !== "group" ||
      cited.principalId !== head.principalId ||
      cited.keyEpoch > head.keyEpoch
    )
      return false;
    if (cited.keyEpoch === head.keyEpoch) return true;
    if (!evidence.loadHistoryPage || cited.version >= head.version)
      return false;
    return memberStayedSinceCitedState(
      request,
      head,
      evidence.loadHistoryPage,
    ).catch(() => false);
  };
}
