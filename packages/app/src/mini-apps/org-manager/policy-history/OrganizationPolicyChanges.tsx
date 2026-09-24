import type {
  OrganizationDirectory,
  OrganizationGroupSummary,
  OrganizationPolicyGroupChange,
} from "@tearleads/client-sdk";
import { compactFingerprint } from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
import { PolicyHistoryChange } from "./PolicyHistoryChange";

const groupChangeLabels = {
  created: ORG_MANAGER_LABELS.policyGroupCreated,
  updated: ORG_MANAGER_LABELS.policyGroupUpdated,
  deleted: ORG_MANAGER_LABELS.policyGroupDeleted,
};

export function OrganizationPolicyChanges({
  changes,
  directory,
  groups,
  profileDisplayNamesByUserId,
  hasAdminChanges,
}: {
  changes: readonly OrganizationPolicyGroupChange[] | null;
  directory: OrganizationDirectory | null;
  groups: readonly OrganizationGroupSummary[] | undefined;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
  hasAdminChanges: boolean;
}) {
  if (changes === null)
    return (
      <span className="org-manager-hint">
        {ORG_MANAGER_LABELS.policyGroupDetailsUnavailable}
      </span>
    );
  if (changes.length === 0)
    return hasAdminChanges ? null : (
      <span>{ORG_MANAGER_LABELS.policyUpdated}</span>
    );
  return (
    <>
      {changes.map((change) => {
        const name =
          groups
            ?.find((group) => group.groupId === change.groupId)
            ?.name?.trim() || compactFingerprint(change.groupId);
        return (
          <span className="org-manager-policy-change-list" key={change.groupId}>
            <strong title={change.groupId}>
              {groupChangeLabels[change.changeType]}: {name}
            </strong>
            {change.changes.map((member) => (
              <PolicyHistoryChange
                key={`${member.userId}:${member.changeType}`}
                change={member}
                directory={directory}
                profileDisplayNamesByUserId={profileDisplayNamesByUserId}
              />
            ))}
            {change.grantChanges.map((grant) => (
              <span key={grant.containerId} title={grant.containerId}>
                {ORG_MANAGER_LABELS.policyContainerAccess}:{" "}
                {compactFingerprint(grant.containerId)} (
                {grant.previousAccess ?? ORG_MANAGER_LABELS.none} →{" "}
                {grant.nextAccess ?? ORG_MANAGER_LABELS.none})
              </span>
            ))}
            {change.previousKeyEpoch !== null &&
              change.keyEpoch !== change.previousKeyEpoch && (
                <span>
                  {ORG_MANAGER_LABELS.policyKeyRotated}:{" "}
                  {change.previousKeyEpoch} → {change.keyEpoch}
                </span>
              )}
          </span>
        );
      })}
    </>
  );
}
