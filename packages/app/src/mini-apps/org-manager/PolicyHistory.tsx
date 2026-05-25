import type {
  OrganizationDirectory,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
} from "@tearleads/client-sdk";
import {
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import { formatMiniAppDate } from "../../utils/formatMiniAppDate";
import { compactFingerprint } from "./display";
import {
  getOrgManagerEpochLabel,
  getOrgManagerPolicyAddedLabel,
  getOrgManagerPolicyChangeTypeLabel,
  getOrgManagerPolicyMemberTypeLabel,
  getOrgManagerPolicyRemovedLabel,
  getOrgManagerPolicyRoleChangedLabel,
  getOrgManagerPolicyRoleLabel,
  getOrgManagerPolicyRoleTransitionLabel,
  getOrgManagerPolicySignatureLabel,
  getOrgManagerPolicyVersionLabel,
  ORG_MANAGER_LABELS,
} from "./labels";

type OrgManagerGroupPolicyHistoryEntry =
  OrganizationGroupPolicyHistory["entries"][number];
type OrgManagerPrincipalMemberChange =
  OrgManagerGroupPolicyHistoryEntry["changes"][number];

function getPolicyMemberLabel(input: {
  change: OrgManagerPrincipalMemberChange;
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
}): string {
  if (input.change.memberPrincipalType === "group") {
    return (
      input.groups.find(
        (group) => group.groupId === input.change.memberPrincipalId,
      )?.name ?? compactFingerprint(input.change.memberPrincipalId)
    );
  }

  const user = input.directory?.users.find(
    (directoryUser) => directoryUser.userId === input.change.memberPrincipalId,
  );
  if (user?.isSelf) {
    return ORG_MANAGER_LABELS.self;
  }

  return compactFingerprint(input.change.memberPrincipalId);
}

function getPolicyChangeLabel(input: {
  change: OrgManagerPrincipalMemberChange;
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
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
    default:
      return null;
  }
}

function PolicyHistoryChange({
  change,
  directory,
  groups,
}: {
  change: OrgManagerPrincipalMemberChange;
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
}) {
  const memberLabel = getPolicyMemberLabel({ change, directory, groups });
  const roleDetail = getPolicyChangeRoleDetail(change);

  return (
    <span
      className="org-manager-policy-change"
      title={getPolicyChangeLabel({ change, directory, groups })}
    >
      <span className="org-manager-policy-change-status">
        {getOrgManagerPolicyChangeTypeLabel(change.changeType)}
      </span>
      <span className="org-manager-policy-change-principal">
        <span className="org-manager-policy-change-principal-type">
          {getOrgManagerPolicyMemberTypeLabel(change.memberPrincipalType)}
        </span>
        <span
          className="org-manager-policy-change-principal-name"
          title={change.memberPrincipalId}
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

function PolicyHistory({
  directory,
  groups,
  history,
}: {
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  history: OrganizationGroupPolicyHistory | OrganizationPolicyHistory | null;
}) {
  if (!history) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.policyHistoryUnavailable}
      </MiniAppStatus>
    );
  }

  if (history.entries.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noPolicyHistory}
      </MiniAppStatus>
    );
  }

  return (
    <div className="org-manager-policy-history">
      {history.entries.map((entry) => (
        <MiniAppRow
          className="org-manager-policy-history-row"
          density="roomy"
          key={entry.stateHash}
          variant="framed"
        >
          <MiniAppRowStack>
            <span className="org-manager-policy-history-heading">
              <strong title={entry.stateHash}>
                {getOrgManagerPolicyVersionLabel(entry.version)}
              </strong>
              <span className="org-manager-policy-history-epoch">
                {getOrgManagerEpochLabel(entry.keyEpoch)}
              </span>
            </span>
            <MiniAppRowText muted title={entry.signerUserId}>
              {getOrgManagerPolicySignatureLabel(
                formatMiniAppDate(entry.signedAt),
                compactFingerprint(entry.signerUserId),
              )}
            </MiniAppRowText>
            <span className="org-manager-policy-change-list">
              {entry.changes.length > 0 ? (
                entry.changes.map((change) => (
                  <PolicyHistoryChange
                    change={change}
                    directory={directory}
                    key={`${change.changeType}:${change.memberPrincipalType}:${change.memberPrincipalId}`}
                    groups={groups}
                  />
                ))
              ) : (
                <span className="org-manager-policy-change org-manager-policy-change--empty">
                  {ORG_MANAGER_LABELS.noMembershipChanges}
                </span>
              )}
            </span>
          </MiniAppRowStack>
        </MiniAppRow>
      ))}
    </div>
  );
}

export function PolicyHistorySection({
  directory,
  groups,
  heading,
  history,
}: {
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  heading: string;
  history: OrganizationGroupPolicyHistory | OrganizationPolicyHistory | null;
}) {
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>{heading}</MiniAppSectionHeading>
      <PolicyHistory directory={directory} groups={groups} history={history} />
    </MiniAppSection>
  );
}
