import type { OrganizationPolicyHistory } from "@tearleads/client-sdk";
import { PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE } from "@tearleads/validators/response";
import { ORG_MANAGER_LABELS } from "../labels";

export function assertOrganizationPolicyHistoryPage(
  page: OrganizationPolicyHistory | null,
  organizationId: string,
  beforeVersion: number,
): void {
  if (
    !page ||
    page.organizationId !== organizationId ||
    page.principalId !== organizationId ||
    page.principalType !== "organization" ||
    page.entries.length === 0 ||
    page.entries.length > PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE ||
    page.entries.some(
      ({ version }, index) =>
        !Number.isSafeInteger(version) ||
        version < 1 ||
        version !== beforeVersion - 1 - index,
    ) ||
    page.nextBeforeVersion !==
      (page.entries.at(-1)?.version === 1 ? null : page.entries.at(-1)?.version)
  )
    throw new Error(ORG_MANAGER_LABELS.failedLoadOlderPolicyHistory);
}

export function appendOrganizationPolicyHistoryPage(
  previous: OrganizationPolicyHistory | null,
  page: OrganizationPolicyHistory | null,
  beforeVersion: number,
): OrganizationPolicyHistory | null {
  if (
    !previous ||
    !page ||
    previous.organizationId !== page.organizationId ||
    previous.nextBeforeVersion !== beforeVersion ||
    page.entries[0]?.version !== beforeVersion - 1
  )
    return previous;
  return { ...page, entries: [...previous.entries, ...page.entries] };
}
