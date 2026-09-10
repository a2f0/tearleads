import type { OrganizationGroupMember } from "@tearleads/client-sdk";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowButton,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import {
  MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  useMiniAppVirtualRows,
} from "../../../components/mini-app/virtual/MiniAppVirtual";
import { compactFingerprint } from "../display";
import { getOrgManagerPolicyRoleLabel, ORG_MANAGER_LABELS } from "../labels";

export function GroupMembers({
  canMutateGroup,
  members,
  mutating,
  openRosterUser,
  protectedUserId,
  removeMember,
  userId,
}: {
  canMutateGroup: boolean;
  members: ReadonlyArray<OrganizationGroupMember>;
  mutating: boolean;
  openRosterUser: (userId: string) => void;
  protectedUserId: string | null;
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

  const adminCount = members.filter((member) => member.role === "admin").length;

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
            member.userId !== userId &&
            member.userId !== protectedUserId &&
            !isLastAdmin;

          return (
            <MiniAppVirtualListRow key={member.userId}>
              <MiniAppRow
                className="org-manager-member-row"
                density="roomy"
                variant="framed"
              >
                <MiniAppRowButton
                  className="org-manager-member-button"
                  onClick={() => openRosterUser(member.userId)}
                >
                  <strong title={member.userId}>
                    {compactFingerprint(member.userId)}
                  </strong>
                  <MiniAppRowText muted>
                    {getOrgManagerPolicyRoleLabel(member.role)}
                    {member.userId === protectedUserId
                      ? ` · ${ORG_MANAGER_LABELS.personalOrganizationOwner}`
                      : null}
                  </MiniAppRowText>
                </MiniAppRowButton>
                <MiniAppButton
                  disabled={!canRemove || mutating}
                  title={
                    member.userId === protectedUserId
                      ? ORG_MANAGER_LABELS.personalOrganizationOwnerProtection
                      : undefined
                  }
                  onClick={() => removeMember(member.userId)}
                >
                  {ORG_MANAGER_LABELS.remove}
                </MiniAppButton>
              </MiniAppRow>
            </MiniAppVirtualListRow>
          );
        })}
      </MiniAppVirtualList>
    </MiniAppVirtualListFrame>
  );
}
