import type {
  OrganizationDirectory,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
} from "@tearleads/client-sdk";
import { useEffect, useState } from "react";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
} from "../../../components/mini-app/MiniAppLayout";
import { compactFingerprint, EMPTY_PROFILE_DISPLAY_NAMES } from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
import { PolicyHistorySection } from "../policy-history/PolicyHistory";
import { OrganizationProfileEditor } from "./OrganizationProfileEditor";

export function OrganizationView({
  directory,
  groups,
  organizationId,
  pending,
  policyHistory,
  profileDisplayNamesByUserId = EMPTY_PROFILE_DISPLAY_NAMES,
}: {
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  organizationId: string;
  // The organization's own data has not settled yet, so neither the profile nor
  // the policy history may report itself as unavailable.
  pending: boolean;
  policyHistory: OrganizationPolicyHistory | null;
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
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
        pending={pending}
        profileDocumentId={directory?.profileDocumentId ?? null}
      />
      <PolicyHistorySection
        directory={directory}
        groups={groups}
        heading={ORG_MANAGER_LABELS.organizationPolicyHistory}
        history={policyHistory}
        pending={pending}
        profileDisplayNamesByUserId={profileDisplayNamesByUserId}
      />
    </div>
  );
}
