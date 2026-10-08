import { MiniAppStatus } from "../../../components/mini-app/MiniAppLayout";
import { PendingPolicyMutation } from "../groups/PendingPolicyMutation";
import type { OrgManagerModel } from "../hooks/useOrgManagerModel";
import { ORG_MANAGER_LABELS } from "../labels";

export function OrgManagerFeedback({ model }: { model: OrgManagerModel }) {
  return (
    <>
      {!model.organizationId && (
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.selectOrganization}
        </MiniAppStatus>
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
