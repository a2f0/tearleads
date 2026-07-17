import { useEffect } from "react";
import { useOrgManagerDataUsageRefresh } from "../billing/useOrgManagerDataUsageRefresh";
import type { OrgManagerView } from "../routes";

interface OrgManagerViewRefreshesInput {
  readonly enabled: boolean;
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

  useEffect(() => {
    if (input.view === "grants") {
      void input.refreshGrants();
    }
  }, [input.refreshGrants, input.view]);

  useEffect(() => {
    if (input.view === "organization") {
      void input.refreshOrganizationPolicyHistory();
    }
  }, [input.refreshOrganizationPolicyHistory, input.view]);
}
