import type { OrganizationGroupMember } from "@tearleads/client-sdk";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowButton,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/shared/MiniAppRow";
import {
  MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  useMiniAppVirtualRows,
} from "../../../components/shared/MiniAppVirtual";
import { compactFingerprint } from "../display";
import { getOrgManagerPolicyRoleLabel, ORG_MANAGER_LABELS } from "../labels";

export function GroupMembers({
  canMutateGroup,
  members,
  mutating,
  openRosterUser,
  removeMember,
  userId,
}: {
  canMutateGroup: boolean;
  members: ReadonlyArray<OrganizationGroupMember>;
  mutating: boolean;
  openRosterUser: (userId: string) => void;
  removeMember: (userId: string) => void;
  userId: string | null;
}) {
  const virtualMembers = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
    rows: members,
  });

  if (members.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noGroupMembers}
      </MiniAppStatus>
    );
  }

  const adminCount = members.filter(
    (member) =>
      member.memberPrincipalType === "user" && member.role === "admin",
  ).length;

  return (
    <MiniAppVirtualListFrame
      className="org-manager-virtual-list"
      ref={virtualMembers.frameRef}
      rowHeight={MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT}
    >
      <MiniAppVirtualList
        bottomPadding={virtualMembers.bottomPadding}
        topPadding={virtualMembers.topPadding}
      >
        {virtualMembers.rows.map((member) => {
          const isLastAdmin = member.role === "admin" && adminCount <= 1;
          const canRemove =
            canMutateGroup &&
            member.memberPrincipalType === "user" &&
            member.memberPrincipalId !== userId &&
            !isLastAdmin;

          const memberUserId =
            member.memberPrincipalType === "user" ? member.userId : null;
          const memberLabel = (
            <>
              <strong title={member.memberPrincipalId}>
                {member.userId
                  ? compactFingerprint(member.userId)
                  : (member.groupName ??
                    compactFingerprint(member.memberPrincipalId))}
              </strong>
              <MiniAppRowText muted>
                {getOrgManagerPolicyRoleLabel(member.role)}
              </MiniAppRowText>
            </>
          );

          return (
            <MiniAppVirtualListRow key={member.memberPrincipalId}>
              <MiniAppRow
                className="org-manager-member-row"
                density="roomy"
                variant="framed"
              >
                {memberUserId ? (
                  <MiniAppRowButton
                    className="org-manager-member-button"
                    onClick={() => openRosterUser(memberUserId)}
                  >
                    {memberLabel}
                  </MiniAppRowButton>
                ) : (
                  <MiniAppRowStack>{memberLabel}</MiniAppRowStack>
                )}
                {member.memberPrincipalType === "user" && (
                  <MiniAppButton
                    disabled={!canRemove || mutating}
                    onClick={() => removeMember(member.memberPrincipalId)}
                  >
                    {ORG_MANAGER_LABELS.remove}
                  </MiniAppButton>
                )}
              </MiniAppRow>
            </MiniAppVirtualListRow>
          );
        })}
      </MiniAppVirtualList>
    </MiniAppVirtualListFrame>
  );
}
