import type { OrganizationGroupPolicyHistory } from "@tearleads/client-sdk";
import type { GroupDetailsRefreshOptions } from "../refresh";

export function appendGroupPolicyHistoryPage(
  previous: OrganizationGroupPolicyHistory | null,
  page: OrganizationGroupPolicyHistory | null,
  beforeVersion: number,
): OrganizationGroupPolicyHistory | null {
  if (
    !previous ||
    !page ||
    previous.groupId !== page.groupId ||
    previous.organizationId !== page.organizationId ||
    previous.nextBeforeVersion !== beforeVersion ||
    page.entries[0]?.version !== beforeVersion - 1
  )
    return previous;
  return { ...page, entries: [...previous.entries, ...page.entries] };
}

export function loadOlderGroupPolicyHistory(
  history: OrganizationGroupPolicyHistory | null,
  refresh: (
    groupId: string | null,
    options?: GroupDetailsRefreshOptions,
  ) => Promise<void>,
): Promise<void> {
  const beforeVersion = history?.nextBeforeVersion;
  if (!history || beforeVersion == null) return Promise.resolve();
  return refresh(history.groupId, { beforeVersion, clearError: false });
}
