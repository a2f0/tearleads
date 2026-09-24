import type {
  OrganizationDirectory,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
} from "@tearleads/client-sdk";
import { useEffect, useId, useState } from "react";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../../components/mini-app/MiniAppLayout";
import { compactFingerprint, EMPTY_PROFILE_DISPLAY_NAMES } from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
import { PolicyHistorySection } from "../policy-history/PolicyHistory";
import { OrganizationProfileEditor } from "./OrganizationProfileEditor";

type OrganizationDetailTabId = "profile" | "policy-history";

const ORGANIZATION_DETAIL_TABS: ReadonlyArray<
  MiniAppTabDescriptor<OrganizationDetailTabId>
> = [
  { id: "profile", label: ORG_MANAGER_LABELS.profile },
  { id: "policy-history", label: ORG_MANAGER_LABELS.policyHistory },
];

export function OrganizationView({
  directory,
  groups,
  organizationId,
  pending,
  policyHistory,
  policyHistoryPending,
  profileDisplayNamesByUserId = EMPTY_PROFILE_DISPLAY_NAMES,
}: {
  directory: OrganizationDirectory | null;
  groups: readonly OrganizationGroupSummary[];
  organizationId: string;
  // The directory (which the profile editor derives `canEdit` from) has not
  // settled yet.
  pending: boolean;
  policyHistory: OrganizationPolicyHistory | null;
  // Policy history runs its own refresh, so it settles separately.
  policyHistoryPending: boolean;
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
}) {
  const idPrefix = useId();
  const [activeTab, setActiveTab] =
    useState<OrganizationDetailTabId>("profile");
  const [organizationName, setOrganizationName] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab("profile");
    setOrganizationName(null);
  }, [organizationId]);

  return (
    <section className="org-manager-panel">
      <MiniAppHeader className="org-manager-detail-header">
        <MiniAppHeaderCopy>
          <strong>{organizationName ?? ORG_MANAGER_LABELS.organization}</strong>
          <span title={organizationId}>
            {compactFingerprint(organizationId)}
          </span>
        </MiniAppHeaderCopy>
      </MiniAppHeader>
      <MiniAppTabList
        activeTab={activeTab}
        idPrefix={idPrefix}
        label={ORG_MANAGER_LABELS.organizationDetailTabsLabel}
        onSelect={setActiveTab}
        tabs={ORGANIZATION_DETAIL_TABS}
      />
      <MiniAppTabPanel
        activeTab={activeTab}
        className="org-manager-detail-tab-panel"
        idPrefix={idPrefix}
      >
        {activeTab === "profile" ? (
          <OrganizationProfileEditor
            canEdit={directory?.currentUser.isOrgAdmin ?? false}
            onNameChange={setOrganizationName}
            organizationId={organizationId}
            pending={pending}
            profileDocumentId={directory?.profileDocumentId ?? null}
          />
        ) : null}
        {activeTab === "policy-history" ? (
          <PolicyHistorySection
            directory={directory}
            groups={groups}
            history={policyHistory}
            pending={policyHistoryPending}
            profileDisplayNamesByUserId={profileDisplayNamesByUserId}
          />
        ) : null}
      </MiniAppTabPanel>
    </section>
  );
}
