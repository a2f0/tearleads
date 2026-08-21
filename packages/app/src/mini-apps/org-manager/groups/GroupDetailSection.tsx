import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationGroupContainers,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
} from "@symcrypt/client-sdk";
import { type MouseEvent, useId, useState } from "react";
import {
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInput,
  MiniAppSection,
  MiniAppSectionHeading,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { compactFingerprint, EMPTY_PROFILE_DISPLAY_NAMES } from "../display";
import { getOrgManagerEpochLabel, ORG_MANAGER_LABELS } from "../labels";
import { PolicyHistorySection } from "../policy-history/PolicyHistory";
import { GroupContainers } from "./GroupContainers";
import { GroupMembers } from "./GroupMembers";

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
        <strong>{selectedGroup.name}</strong>
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
  addUserListId,
  addableUsers,
  canMutateSelectedGroup,
  directory,
  groupContainers,
  groupPolicyHistory,
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
  addUser: () => void;
  addUserId: string;
  addUserListId: string;
  addableUsers: ReadonlyArray<OrganizationDirectoryUser>;
  canMutateSelectedGroup: boolean;
  directory: OrganizationDirectory | null;
  groupContainers: OrganizationGroupContainers | null;
  groupPolicyHistory: OrganizationGroupPolicyHistory | null;
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
  removeMember: (userId: string) => void;
  selectedGroup: OrganizationGroupSummary;
  setAddUserId: (userId: string) => void;
  userId: string | null;
}) {
  const idPrefix = useId();
  const [activeTab, setActiveTab] = useState<GroupDetailTabId>("members");

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
        className="org-manager-group-detail-tab-panel"
        idPrefix={idPrefix}
      >
        {activeTab === "members" ? (
          <>
            <MiniAppToolbar className="org-manager-form-toolbar">
              <MiniAppInput
                aria-label={ORG_MANAGER_LABELS.userId}
                disabled={!canMutateSelectedGroup || mutating}
                list={addUserListId}
                onChange={(event) => setAddUserId(event.target.value)}
                placeholder={ORG_MANAGER_LABELS.userId}
                value={addUserId}
              />
              <datalist id={addUserListId}>
                {addableUsers.map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {user.isSelf
                      ? ORG_MANAGER_LABELS.self
                      : compactFingerprint(user.userId)}
                  </option>
                ))}
              </datalist>
              <MiniAppButton
                disabled={
                  !canMutateSelectedGroup ||
                  mutating ||
                  !members ||
                  addUserId.trim().length === 0 ||
                  memberUserIds.has(addUserId.trim())
                }
                onClick={addUser}
              >
                {ORG_MANAGER_LABELS.add}
              </MiniAppButton>
            </MiniAppToolbar>
            <MiniAppSection>
              <MiniAppSectionHeading>
                {ORG_MANAGER_LABELS.members}
              </MiniAppSectionHeading>
              <GroupMembers
                canMutateGroup={canMutateSelectedGroup}
                members={members?.members ?? []}
                mutating={mutating}
                openRosterUser={openRosterUser}
                removeMember={removeMember}
                userId={userId}
              />
            </MiniAppSection>
          </>
        ) : null}
        {activeTab === "policy-history" ? (
          <PolicyHistorySection
            directory={directory}
            history={groupPolicyHistory}
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
