import { useEffect } from "react";
import { useOrgManagerDataUsageRefreshEffect } from "../billing/useOrgManagerDataUsageRefreshEffect";
import { useOrgManagerGrantsRefreshEffect } from "../grants/useOrgManagerGrantsRefreshEffect";
import type { OrgManagerView } from "../routes";

interface OrgManagerViewRefreshEffectsInput {
  readonly enabled: boolean;
  readonly readModelCursor: string | null;
  readonly scopeKey: string;
  readonly refreshDataUsage: () => Promise<void>;
  readonly refreshGrants: () => Promise<void>;
  readonly refreshOrganizationPolicyHistory: () => Promise<void>;
  readonly view: OrgManagerView;
}

export function useOrgManagerViewRefreshEffects(
  input: OrgManagerViewRefreshEffectsInput,
): void {
  useOrgManagerDataUsageRefreshEffect({
    enabled: input.enabled,
    refreshDataUsage: input.refreshDataUsage,
    visible: input.view === "usage",
  });

  useOrgManagerGrantsRefreshEffect({
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
