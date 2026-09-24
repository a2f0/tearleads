import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationGroupPolicyHistory,
} from "@tearleads/client-sdk";
import { compactFingerprint } from "../display";
import {
  getOrgManagerPolicyAddedLabel,
  getOrgManagerPolicyChangeTypeLabel,
  getOrgManagerPolicyRemovedLabel,
  getOrgManagerPolicyRoleChangedLabel,
  getOrgManagerPolicyRoleLabel,
  getOrgManagerPolicyRoleTransitionLabel,
  ORG_MANAGER_LABELS,
} from "../labels";

type OrgManagerGroupPolicyHistoryEntry =
  OrganizationGroupPolicyHistory["entries"][number];
type OrgManagerPrincipalMemberChange =
  OrgManagerGroupPolicyHistoryEntry["changes"][number];

export function getPolicyUserLabel(input: {
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
  user: Pick<OrganizationDirectoryUser, "isSelf" | "userId"> | null;
  userId: string;
}): string {
  const displayName = input.profileDisplayNamesByUserId.get(input.userId);
  if (displayName) {
    return `${displayName} (${compactFingerprint(input.userId)})`;
  }

  if (input.user?.isSelf) {
    return ORG_MANAGER_LABELS.self;
  }

  return compactFingerprint(input.userId);
}

function getPolicyMemberLabel(input: {
  change: OrgManagerPrincipalMemberChange;
  directory: OrganizationDirectory | null;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
}): string {
  const user = input.directory?.users.find(
    (directoryUser) => directoryUser.userId === input.change.userId,
  );
  return getPolicyUserLabel({
    profileDisplayNamesByUserId: input.profileDisplayNamesByUserId,
    user: user ?? null,
    userId: input.change.userId,
  });
}

function getPolicyChangeLabel(input: {
  change: OrgManagerPrincipalMemberChange;
  directory: OrganizationDirectory | null;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
}): string {
  const memberLabel = getPolicyMemberLabel(input);

  switch (input.change.changeType) {
    case "added":
      return getOrgManagerPolicyAddedLabel(memberLabel, input.change.nextRole);
    case "removed":
      return getOrgManagerPolicyRemovedLabel(memberLabel);
    case "role_changed":
      return getOrgManagerPolicyRoleChangedLabel(
        memberLabel,
        getOrgManagerPolicyRoleLabel(input.change.previousRole),
        getOrgManagerPolicyRoleLabel(input.change.nextRole),
      );
  }
}

function getPolicyChangeRoleDetail(
  change: OrgManagerPrincipalMemberChange,
): string | null {
  switch (change.changeType) {
    case "added":
      return change.nextRole
        ? getOrgManagerPolicyRoleLabel(change.nextRole)
        : null;
    case "removed":
      return change.previousRole
        ? getOrgManagerPolicyRoleLabel(change.previousRole)
        : null;
    case "role_changed":
      return getOrgManagerPolicyRoleTransitionLabel(
        getOrgManagerPolicyRoleLabel(change.previousRole),
        getOrgManagerPolicyRoleLabel(change.nextRole),
      );
  }
}

export function PolicyHistoryChange({
  change,
  directory,
  profileDisplayNamesByUserId,
}: {
  change: OrgManagerPrincipalMemberChange;
  directory: OrganizationDirectory | null;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
}) {
  const memberLabel = getPolicyMemberLabel({
    change,
    directory,
    profileDisplayNamesByUserId,
  });
  const roleDetail = getPolicyChangeRoleDetail(change);

  return (
    <span
      className="org-manager-policy-change"
      title={getPolicyChangeLabel({
        change,
        directory,
        profileDisplayNamesByUserId,
      })}
    >
      <span className="org-manager-policy-change-status">
        {getOrgManagerPolicyChangeTypeLabel(change.changeType)}
      </span>
      <span className="org-manager-policy-change-principal">
        <span
          className="org-manager-policy-change-principal-name"
          title={change.userId}
        >
          {memberLabel}
        </span>
      </span>
      {roleDetail && (
        <span className="org-manager-policy-change-role">{roleDetail}</span>
      )}
    </span>
  );
}
