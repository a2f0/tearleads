import { useEffect, useMemo } from "react";
import { useOrganizationBilling } from "../../../providers/billing/BillingProvider";
import type { OrgManagerModel } from "./useOrgManagerModel";

export function useOrgManagerBillingRosterState(
  model: OrgManagerModel,
  organizationId: string,
): {
  readonly billing: ReturnType<typeof useOrganizationBilling>;
  readonly billingMatchesOrganization: boolean;
  readonly syncSeatUserIds: ReadonlySet<string> | null;
} {
  const billing = useOrganizationBilling();
  const billingMatchesOrganization =
    billing.billing?.organizationId === organizationId;
  const activeRosterUserIds = useMemo(
    () =>
      model.directory?.users
        .filter((user) => user.status === "active")
        .map((user) => user.userId) ?? null,
    [model.directory],
  );
  const activeRosterMemberCount = activeRosterUserIds?.length ?? null;
  const billingActiveMemberCount = billingMatchesOrganization
    ? (billing.billing?.activeMemberCount ?? null)
    : null;
  const assignedUserIds = billingMatchesOrganization
    ? (billing.billing?.assignedUserIds ?? null)
    : null;
  const expectedAssignedSeatCount =
    activeRosterMemberCount !== null && billing.view
      ? Math.min(activeRosterMemberCount, billing.view.seatCount)
      : null;
  const activeRosterUserIdSet = new Set(activeRosterUserIds ?? []);
  // The API reconciles assignments in the same transaction as Members policy
  // changes, so settled billing must fill every available licensed seat with an
  // active roster user. A mismatch means this read predates that transaction.
  const seatAssignmentsAreStale =
    assignedUserIds !== null &&
    expectedAssignedSeatCount !== null &&
    (billing.view?.isActive || billing.view?.isTrialing) &&
    (assignedUserIds.length !== expectedAssignedSeatCount ||
      assignedUserIds.some((userId) => !activeRosterUserIdSet.has(userId)));
  const rosterBillingIsStale =
    (activeRosterMemberCount !== null &&
      billingActiveMemberCount !== null &&
      activeRosterMemberCount !== billingActiveMemberCount) ||
    seatAssignmentsAreStale;

  useEffect(() => {
    if (rosterBillingIsStale) {
      void billing.refresh();
    }
  }, [billing.refresh, organizationId, rosterBillingIsStale]);

  const syncSeatUserIds = useMemo(
    () =>
      billingMatchesOrganization &&
      (billing.view?.isActive || billing.view?.isTrialing)
        ? new Set(billing.billing?.assignedUserIds ?? [])
        : null,
    [billing.billing, billing.view, billingMatchesOrganization],
  );
  return { billing, billingMatchesOrganization, syncSeatUserIds };
}
