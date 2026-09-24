import type {
  OrganizationDirectory,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
  OrganizationPolicyHistoryEntry,
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
import { EMPTY_PROFILE_DISPLAY_NAMES } from "../display";
import {
  getOrgManagerEpochLabel,
  getOrgManagerPolicySignatureLabel,
  getOrgManagerPolicyVersionLabel,
  ORG_MANAGER_LABELS,
} from "../labels";
import { OrganizationPolicyChanges } from "./OrganizationPolicyChanges";
import { getPolicyUserLabel, PolicyHistoryChange } from "./PolicyHistoryChange";

function PolicyHistoryEntry({
  directory,
  groups,
  entry,
  profileDisplayNamesByUserId,
}: {
  directory: OrganizationDirectory | null;
  groups?: readonly OrganizationGroupSummary[] | undefined;
  entry:
    | OrganizationGroupPolicyHistory["entries"][number]
    | OrganizationPolicyHistoryEntry;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
}) {
  const signerUser =
    directory?.users.find((user) => user.userId === entry.signerUserId) ?? null;
  const signerLabel = getPolicyUserLabel({
    profileDisplayNamesByUserId,
    user: signerUser,
    userId: entry.signerUserId,
  });
  // Hide membership details already shown in a changed group, including the
  // admin-group mirror. Unrelated organization changes remain visible.
  const membershipChanges = entry.changes.filter(
    (change) =>
      !(
        "groupChanges" in entry &&
        entry.groupChanges?.some((group) =>
          group.changes.some(
            (member) =>
              member.userId === change.userId &&
              member.changeType === change.changeType &&
              member.previousRole === change.previousRole &&
              member.nextRole === change.nextRole,
          ),
        )
      ),
  );

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
          {membershipChanges.length > 0 ? (
            membershipChanges.map((change) => (
              <PolicyHistoryChange
                change={change}
                directory={directory}
                key={`${change.changeType}:${change.userId}`}
                profileDisplayNamesByUserId={profileDisplayNamesByUserId}
              />
            ))
          ) : !("groupChanges" in entry) ? (
            <span className="org-manager-policy-change org-manager-policy-change--empty">
              {ORG_MANAGER_LABELS.noMembershipChanges}
            </span>
          ) : null}
          {"groupChanges" in entry && (
            <OrganizationPolicyChanges
              changes={entry.groupChanges}
              directory={directory}
              groups={groups}
              profileDisplayNamesByUserId={profileDisplayNamesByUserId}
              hasAdminChanges={entry.changes.length > 0}
            />
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
  groups?: readonly OrganizationGroupSummary[] | undefined;
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
          groups={groups}
          entry={entry}
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
  groups?: readonly OrganizationGroupSummary[] | undefined;
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
