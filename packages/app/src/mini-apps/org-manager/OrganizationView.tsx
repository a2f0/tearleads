import type {
  OrgManagerDirectory,
  OrgManagerGroupSummary,
  OrgManagerPolicyHistory,
} from "../../stores/org-manager/OrgManagerProvider";
import { compactFingerprint } from "./display";
import { ORG_MANAGER_LABELS } from "./labels";
import { PolicyHistorySection } from "./PolicyHistory";

export function OrganizationView({
  directory,
  groups,
  organizationId,
  policyHistory,
}: {
  directory: OrgManagerDirectory | null;
  groups: ReadonlyArray<OrgManagerGroupSummary>;
  organizationId: string;
  policyHistory: OrgManagerPolicyHistory | null;
}) {
  return (
    <div>
      <div className="org-manager-detail-header">
        <div>
          <strong>{ORG_MANAGER_LABELS.organization}</strong>
          <span title={organizationId}>
            {compactFingerprint(organizationId)}
          </span>
        </div>
      </div>
      <PolicyHistorySection
        directory={directory}
        groups={groups}
        heading={ORG_MANAGER_LABELS.organizationPolicyHistory}
        history={policyHistory}
      />
    </div>
  );
}
