import type { OrganizationDataUsage } from "@tearleads/client-sdk";

interface DataUsageRefreshResolution {
  readonly shouldReportMissing: boolean;
  readonly value: OrganizationDataUsage | null;
}

export function resolveDataUsageRefresh(input: {
  readonly current: OrganizationDataUsage | null;
  readonly localOnly: boolean;
  readonly next: OrganizationDataUsage | null;
  readonly organizationId: string;
}): DataUsageRefreshResolution {
  if (input.next?.organizationId === input.organizationId) {
    return { shouldReportMissing: false, value: input.next };
  }

  if (input.localOnly) {
    const current =
      input.current?.organizationId === input.organizationId
        ? input.current
        : null;
    return { shouldReportMissing: false, value: current };
  }

  return { shouldReportMissing: true, value: null };
}
