import { MiniAppStatus } from "../../../components/mini-app/MiniAppLayout";
import { PendingPolicyMutation } from "../groups/PendingPolicyMutation";
import { ORG_MANAGER_LABELS } from "../labels";
import type { OrgManagerModel } from "../model/useOrgManagerModel";
import { OrganizationTwoFactorNotice } from "./OrganizationTwoFactorNotice";

export function OrgManagerFeedback({ model }: { model: OrgManagerModel }) {
  return (
    <>
      {!model.organizationId && !model.orgSwitcher.organizationsLoading && (
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.selectOrganization}
        </MiniAppStatus>
      )}
      {model.organizationId && (
        <OrganizationTwoFactorNotice
          organizationId={model.organizationId}
          signedIn={model.canLoadAuthenticatedOrgData}
        />
      )}
      {model.error && (
        <MiniAppStatus className="org-manager-error" tone="error">
          {model.error}
        </MiniAppStatus>
      )}
      {model.organizationId && model.canLoadAuthenticatedOrgData && (
        <PendingPolicyMutation
          key={`${model.organizationId}:${model.userId}`}
          organizationId={model.organizationId}
          groups={model.groups}
          refreshSignal={model.error}
          mutating={model.mutating}
          onResolved={model.refreshOrgManager}
        />
      )}
    </>
  );
}
