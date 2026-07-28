import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
} from "@tearleads/client-sdk";
import {
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { compactFingerprint, EMPTY_PROFILE_DISPLAY_NAMES } from "../display";
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
} from "../labels";

type OrgManagerGroupPolicyHistoryEntry =
  OrganizationGroupPolicyHistory["entries"][number];
type OrgManagerPrincipalMemberChange =
  OrgManagerGroupPolicyHistoryEntry["changes"][number];

function getPolicyUserLabel(input: {
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
  groups: ReadonlyArray<OrganizationGroupSummary>;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
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
  return getPolicyUserLabel({
    profileDisplayNamesByUserId: input.profileDisplayNamesByUserId,
    user: user ?? null,
    userId: input.change.memberPrincipalId,
  });
}

function getPolicyChangeLabel(input: {
  change: OrgManagerPrincipalMemberChange;
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
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

function PolicyHistoryChange({
  change,
  directory,
  groups,
  profileDisplayNamesByUserId,
}: {
  change: OrgManagerPrincipalMemberChange;
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
}) {
  const memberLabel = getPolicyMemberLabel({
    change,
    directory,
    groups,
    profileDisplayNamesByUserId,
  });
  const roleDetail = getPolicyChangeRoleDetail(change);

  return (
    <span
      className="org-manager-policy-change"
      title={getPolicyChangeLabel({
        change,
        directory,
        groups,
        profileDisplayNamesByUserId,
      })}
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

function PolicyHistoryEntry({
  directory,
  entry,
  groups,
  profileDisplayNamesByUserId,
}: {
  directory: OrganizationDirectory | null;
  entry: OrgManagerGroupPolicyHistoryEntry;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
}) {
  const signerUser =
    directory?.users.find((user) => user.userId === entry.signerUserId) ?? null;
  const signerLabel = getPolicyUserLabel({
    profileDisplayNamesByUserId,
    user: signerUser,
    userId: entry.signerUserId,
  });

  return (
    <MiniAppRow
      className="org-manager-policy-history-row"
      density="roomy"
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
            signerLabel,
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
                profileDisplayNamesByUserId={profileDisplayNamesByUserId}
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
  );
}

function PolicyHistory({
  directory,
  groups,
  history,
  pending,
  profileDisplayNamesByUserId,
}: {
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  history: OrganizationGroupPolicyHistory | OrganizationPolicyHistory | null;
  pending: boolean;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
}) {
  if (!history) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {pending
          ? ORG_MANAGER_LABELS.loadingPolicyHistory
          : ORG_MANAGER_LABELS.policyHistoryUnavailable}
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
        <PolicyHistoryEntry
          directory={directory}
          entry={entry}
          groups={groups}
          key={entry.stateHash}
          profileDisplayNamesByUserId={profileDisplayNamesByUserId}
        />
      ))}
    </div>
  );
}

export function PolicyHistorySection({
  directory,
  groups,
  heading,
  history,
  pending = false,
  profileDisplayNamesByUserId = EMPTY_PROFILE_DISPLAY_NAMES,
}: {
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  heading?: string | undefined;
  history: OrganizationGroupPolicyHistory | OrganizationPolicyHistory | null;
  // History arrives on its own refresh, well after the section first renders,
  // so an absent history is only reportable as unavailable once it has settled.
  pending?: boolean | undefined;
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
}) {
  return (
    <MiniAppSection>
      {heading ? (
        <MiniAppSectionHeading>{heading}</MiniAppSectionHeading>
      ) : null}
      <PolicyHistory
        directory={directory}
        groups={groups}
        history={history}
        pending={pending}
        profileDisplayNamesByUserId={profileDisplayNamesByUserId}
      />
    </MiniAppSection>
  );
}
