import type {
  OrganizationDirectory,
  OrganizationPolicyHistory,
} from "@symcrypt/client-sdk";
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
  organizationId,
  pending,
  policyHistory,
  policyHistoryPending,
  profileDisplayNamesByUserId = EMPTY_PROFILE_DISPLAY_NAMES,
}: {
  directory: OrganizationDirectory | null;
  organizationId: string;
  // The directory (which the profile editor derives `canEdit` from) has not
  // settled yet.
  pending: boolean;
  policyHistory: OrganizationPolicyHistory | null;
  // Policy history runs its own refresh, so it settles separately.
  policyHistoryPending: boolean;
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
        heading={ORG_MANAGER_LABELS.organizationPolicyHistory}
        history={policyHistory}
        pending={policyHistoryPending}
        profileDisplayNamesByUserId={profileDisplayNamesByUserId}
      />
    </div>
  );
}
