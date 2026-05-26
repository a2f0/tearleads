import { afterEach, expect, test } from "bun:test";
import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { GroupsView } from "./GroupsView";
import { ORG_MANAGER_LABELS } from "./labels";

afterEach(() => cleanup());

const group: OrganizationGroupSummary = {
  createdAt: "2026-05-20T12:00:00.000Z",
  currentState: {
    keyEpoch: 2,
    memberCount: 1,
    stateHash: "group-state-hash",
    version: 3,
  },
  groupId: "550e8400-e29b-41d4-a716-446655440010",
  name: "Admins",
  organizationId: "organization-1",
};

function renderGroupsView(input: {
  selectedGroup: OrganizationGroupSummary | null;
  selectedGroupId: string | null;
  selectGroup?: ((groupId: string | null) => void) | undefined;
}) {
  return render(
    <GroupsView
      addUser={() => undefined}
      addUserId=""
      addUserListId="add-user-list"
      addableUsers={[]}
      canCreateGroup={false}
      canMutateSelectedGroup={false}
      createGroup={() => undefined}
      directory={null}
      groupContainers={null}
      groupNameDraft=""
      groupPolicyHistory={null}
      groups={[group]}
      members={null}
      memberUserIds={new Set<string>()}
      mutating={false}
      removeMember={() => undefined}
      selectedGroup={input.selectedGroup}
      selectedGroupId={input.selectedGroupId}
      selectGroup={input.selectGroup ?? (() => undefined)}
      setAddUserId={() => undefined}
      setGroupNameDraft={() => undefined}
      userId="user-1"
    />,
  );
}

test("org manager groups view hides group detail until a group is selected", () => {
  const selections: Array<string | null> = [];
  const view = renderGroupsView({
    selectedGroup: null,
    selectedGroupId: null,
    selectGroup: (groupId) => selections.push(groupId),
  });

  expect(view.getByText(group.name)).toBeTruthy();
  expect(view.container.querySelector(".org-manager-panel--detail")).toBeNull();
  expect(view.queryByText(ORG_MANAGER_LABELS.members)).toBeNull();

  fireEvent.click(view.getByText(group.name));
  expect(selections).toEqual([group.groupId]);
});

test("org manager groups view can dismiss group detail", () => {
  const selections: Array<string | null> = [];
  const view = renderGroupsView({
    selectedGroup: group,
    selectedGroupId: group.groupId,
    selectGroup: (groupId) => selections.push(groupId),
  });

  expect(view.getByText(ORG_MANAGER_LABELS.members)).toBeTruthy();
  expect(view.queryByPlaceholderText(ORG_MANAGER_LABELS.groupName)).toBeNull();

  fireEvent.click(view.getByRole("button", { name: ORG_MANAGER_LABELS.back }));
  expect(selections).toEqual([null]);
});
