import type {
  OrganizationDirectory,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
} from "@tearleads/client-sdk";
import { useEffect, useState } from "react";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
} from "../../components/shared/MiniAppLayout";
import { compactFingerprint } from "./display";
import { ORG_MANAGER_LABELS } from "./labels";
import { OrganizationProfileEditor } from "./OrganizationProfileEditor";
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
  const [organizationName, setOrganizationName] = useState<string | null>(null);

  useEffect(() => {
    setOrganizationName(null);
  }, [organizationId]);

  return (
    <div>
      <MiniAppHeader className="org-manager-detail-header">
        <MiniAppHeaderCopy>
          <strong>{organizationName ?? ORG_MANAGER_LABELS.organization}</strong>
          <span title={organizationId}>
            {compactFingerprint(organizationId)}
          </span>
        </MiniAppHeaderCopy>
      </MiniAppHeader>
      <OrganizationProfileEditor
        canEdit={directory?.currentUser.isOrgAdmin ?? false}
        onNameChange={setOrganizationName}
        organizationId={organizationId}
        profileDocumentId={directory?.profileDocumentId ?? null}
      />
      <PolicyHistorySection
        directory={directory}
        groups={groups}
        heading={ORG_MANAGER_LABELS.organizationPolicyHistory}
        history={policyHistory}
      />
    </div>
  );
}
