import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationGroupContainers,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
} from "@tearleads/client-sdk";
import { type MouseEvent, useId, useState } from "react";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppSection,
  MiniAppSectionHeading,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../../components/mini-app/MiniAppLayout";
import { compactFingerprint, EMPTY_PROFILE_DISPLAY_NAMES } from "../display";
import {
  getOrgManagerEpochLabel,
  groupDisplayName,
  ORG_MANAGER_LABELS,
} from "../labels";
import { PolicyHistorySection } from "../policy-history/PolicyHistory";
import { GroupAddMemberToolbar } from "./GroupAddMemberToolbar";
import { GroupContainers } from "./GroupContainers";
import { GroupMembers } from "./GroupMembers";
import { useGroupMemberAction } from "./useGroupMemberAction";

type GroupDetailTabId = "members" | "policy-history" | "links";

const GROUP_DETAIL_TABS: ReadonlyArray<MiniAppTabDescriptor<GroupDetailTabId>> =
  [
    { id: "members", label: ORG_MANAGER_LABELS.members },
    { id: "policy-history", label: ORG_MANAGER_LABELS.policyHistory },
    { id: "links", label: ORG_MANAGER_LABELS.groupLinksTab },
  ];

function GroupDetailHeader({
  openGroupContextMenu,
  selectedGroup,
}: {
  openGroupContextMenu: (
    event: MouseEvent<HTMLElement>,
    groupId: string | null,
  ) => void;
  selectedGroup: OrganizationGroupSummary;
}) {
  return (
    <MiniAppHeader
      className="org-manager-detail-header"
      onContextMenu={(event) =>
        openGroupContextMenu(event, selectedGroup.groupId)
      }
    >
      <MiniAppHeaderCopy>
        <strong>{groupDisplayName(selectedGroup)}</strong>
        <span title={selectedGroup.groupId}>
          {compactFingerprint(selectedGroup.groupId)}
        </span>
      </MiniAppHeaderCopy>
      <span>
        {selectedGroup.currentState
          ? getOrgManagerEpochLabel(selectedGroup.currentState.keyEpoch)
          : ORG_MANAGER_LABELS.noPolicy}
      </span>
    </MiniAppHeader>
  );
}

export function GroupDetailSection({
  addUser,
  addUserId,
  addableUsers,
  canMutateSelectedGroup,
  directory,
  groupContainers,
  groupPolicyHistory,
  loadMoreGroupHistory,
  members,
  memberUserIds,
  mutating,
  pending,
  openGroupContextMenu,
  openRosterUser,
  profileDisplayNamesByUserId = EMPTY_PROFILE_DISPLAY_NAMES,
  removeMember,
  selectedGroup,
  setAddUserId,
  userId,
}: {
  addUser: () => void | Promise<void>;
  addUserId: string;
  addableUsers: ReadonlyArray<OrganizationDirectoryUser>;
  canMutateSelectedGroup: boolean;
  directory: OrganizationDirectory | null;
  groupContainers: OrganizationGroupContainers | null;
  groupPolicyHistory: OrganizationGroupPolicyHistory | null;
  loadMoreGroupHistory?: (() => Promise<void>) | undefined;
  members: OrganizationGroupMembers | null;
  memberUserIds: ReadonlySet<string>;
  mutating: boolean;
  pending: boolean;
  openGroupContextMenu: (
    event: MouseEvent<HTMLElement>,
    groupId: string | null,
  ) => void;
  openRosterUser: (userId: string) => void;
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
  removeMember: (userId: string) => void | Promise<void>;
  selectedGroup: OrganizationGroupSummary;
  setAddUserId: (userId: string) => void;
  userId: string | null;
}) {
  const idPrefix = useId();
  const [activeTab, setActiveTab] = useState<GroupDetailTabId>("members");
  const memberAction = useGroupMemberAction(selectedGroup.groupId);

  return (
    <section className="org-manager-panel">
      <GroupDetailHeader
        openGroupContextMenu={openGroupContextMenu}
        selectedGroup={selectedGroup}
      />
      <MiniAppTabList
        activeTab={activeTab}
        idPrefix={idPrefix}
        label={ORG_MANAGER_LABELS.groupDetailTabsLabel}
        onSelect={setActiveTab}
        tabs={GROUP_DETAIL_TABS}
      />
      <MiniAppTabPanel
        activeTab={activeTab}
        className="org-manager-detail-tab-panel"
        idPrefix={idPrefix}
      >
        {activeTab === "members" ? (
          <>
            {canMutateSelectedGroup ? (
              <GroupAddMemberToolbar
                addableUsers={addableUsers}
                adding={memberAction.adding}
                addUserId={addUserId}
                memberUserIds={memberUserIds}
                members={members}
                mutating={mutating}
                onAdd={() => void memberAction.add(addUser)}
                profileDisplayNamesByUserId={profileDisplayNamesByUserId}
                setAddUserId={setAddUserId}
              />
            ) : null}
            <MiniAppSection>
              <MiniAppSectionHeading>
                {ORG_MANAGER_LABELS.members}
              </MiniAppSectionHeading>
              <GroupMembers
                canMutateGroup={canMutateSelectedGroup}
                members={members?.members ?? []}
                mutating={mutating}
                openRosterUser={openRosterUser}
                profileDisplayNamesByUserId={profileDisplayNamesByUserId}
                protectedUserId={
                  selectedGroup.isBuiltin
                    ? (directory?.users.find(
                        (user) => user.isPersonalOrganizationOwner,
                      )?.userId ?? null)
                    : null
                }
                protectSelf={selectedGroup.isBuiltin}
                removeMember={(removedUserId) =>
                  void memberAction.remove(removedUserId, () =>
                    removeMember(removedUserId),
                  )
                }
                removingUserId={memberAction.removingUserId}
                userId={userId}
              />
            </MiniAppSection>
          </>
        ) : null}
        {activeTab === "policy-history" ? (
          <PolicyHistorySection
            directory={directory}
            history={groupPolicyHistory}
            loadMore={loadMoreGroupHistory}
            pending={pending}
            profileDisplayNamesByUserId={profileDisplayNamesByUserId}
          />
        ) : null}
        {activeTab === "links" ? (
          <MiniAppSection>
            <MiniAppSectionHeading>
              {ORG_MANAGER_LABELS.directContainerLinks}
            </MiniAppSectionHeading>
            <GroupContainers containers={groupContainers?.containers ?? []} />
          </MiniAppSection>
        ) : null}
      </MiniAppTabPanel>
    </section>
  );
}
