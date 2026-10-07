import type { OrganizationGroupPolicyHistory } from "@tearleads/client-sdk";
import { ORG_MANAGER_LABELS } from "../labels";
import type { GroupDetailsRefreshOptions } from "../refresh";

export function assertGroupPolicyHistoryPage(
  page: OrganizationGroupPolicyHistory | null,
  requested: {
    readonly groupId: string;
    readonly organizationId: string;
    readonly beforeVersion: number;
  },
): void {
  if (
    !page ||
    page.groupId !== requested.groupId ||
    page.organizationId !== requested.organizationId ||
    page.entries.length === 0 ||
    page.entries.some(
      ({ version }, index) =>
        !Number.isSafeInteger(version) ||
        version < 1 ||
        version !== requested.beforeVersion - 1 - index,
    ) ||
    page.nextBeforeVersion !==
      (page.entries.at(-1)?.version === 1 ? null : page.entries.at(-1)?.version)
  )
    throw new Error(ORG_MANAGER_LABELS.failedLoadOlderPolicyHistory);
}

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
    // The visible selection or cursor may have changed while this valid page
    // loaded. Its response was already checked against the original request.
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
  return refresh(history.groupId, { beforeVersion });
}
