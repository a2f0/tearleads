import { useEffect } from "react";
import { useOrgManagerDataUsageRefresh } from "../billing/useOrgManagerDataUsageRefresh";
import { useOrgManagerGrantsRefresh } from "../grants/useOrgManagerGrantsRefresh";
import type { OrgManagerView } from "../routes";

interface OrgManagerViewRefreshesInput {
  readonly enabled: boolean;
  readonly readModelCursor: string | null;
  readonly scopeKey: string;
  readonly refreshDataUsage: () => Promise<void>;
  readonly refreshGrants: () => Promise<void>;
  readonly refreshOrganizationPolicyHistory: () => Promise<void>;
  readonly view: OrgManagerView;
}

export function useOrgManagerViewRefreshes(
  input: OrgManagerViewRefreshesInput,
): void {
  useOrgManagerDataUsageRefresh({
    enabled: input.enabled,
    refreshDataUsage: input.refreshDataUsage,
    visible: input.view === "usage",
  });

  useOrgManagerGrantsRefresh({
    enabled: input.enabled,
    readModelCursor: input.readModelCursor,
    refreshGrants: input.refreshGrants,
    scopeKey: input.scopeKey,
    visible: input.view === "grants",
  });

  useEffect(() => {
    if (input.view === "organization") {
      void input.refreshOrganizationPolicyHistory();
    }
  }, [input.refreshOrganizationPolicyHistory, input.view]);
}
