import type {
  OrganizationDirectory,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
} from "@tearleads/client-sdk";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
} from "../../components/shared/MiniAppLayout";
import { compactFingerprint } from "./display";
import { ORG_MANAGER_LABELS } from "./labels";
import { PolicyHistorySection } from "./PolicyHistory";

export function OrganizationView({
  directory,
  groups,
  organizationId,
  policyHistory,
}: {
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  organizationId: string;
  policyHistory: OrganizationPolicyHistory | null;
}) {
  return (
    <div>
      <MiniAppHeader className="org-manager-detail-header">
        <MiniAppHeaderCopy>
          <strong>{ORG_MANAGER_LABELS.organization}</strong>
          <span title={organizationId}>
            {compactFingerprint(organizationId)}
          </span>
        </MiniAppHeaderCopy>
      </MiniAppHeader>
      <PolicyHistorySection
        directory={directory}
        groups={groups}
        heading={ORG_MANAGER_LABELS.organizationPolicyHistory}
        history={policyHistory}
      />
    </div>
  );
}
