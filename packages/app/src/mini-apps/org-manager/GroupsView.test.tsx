import { afterEach, expect, test } from "bun:test";
import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
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
  canCreateGroup?: boolean | undefined;
  closeCreateGroupDialog?: (() => void) | undefined;
  createGroup?: (() => void) | undefined;
  error?: string | null | undefined;
  groupNameDraft?: string | undefined;
  isCreateGroupDialogOpen?: boolean | undefined;
  selectedGroup: OrganizationGroupSummary | null;
  selectedGroupId: string | null;
  selectGroup?: ((groupId: string | null) => void) | undefined;
  setGroupNameDraft?: ((groupName: string) => void) | undefined;
}) {
  return render(
    <GroupsView
      addUser={() => undefined}
      addUserId=""
      addUserListId="add-user-list"
      addableUsers={[]}
      canCreateGroup={input.canCreateGroup ?? false}
      canMutateSelectedGroup={false}
      closeCreateGroupDialog={input.closeCreateGroupDialog ?? (() => undefined)}
      createGroup={input.createGroup ?? (() => undefined)}
      directory={null}
      groupContainers={null}
      groupNameDraft={input.groupNameDraft ?? ""}
      groupPolicyHistory={null}
      groups={[group]}
      error={input.error ?? null}
      isCreateGroupDialogOpen={input.isCreateGroupDialogOpen ?? false}
      members={null}
      memberUserIds={new Set<string>()}
      mutating={false}
      removeMember={() => undefined}
      selectedGroup={input.selectedGroup}
      selectedGroupId={input.selectedGroupId}
      selectGroup={input.selectGroup ?? (() => undefined)}
      setAddUserId={() => undefined}
      setGroupNameDraft={input.setGroupNameDraft ?? (() => undefined)}
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

  expect(
    view.getByRole("table", { name: ORG_MANAGER_LABELS.groups }),
  ).toBeTruthy();
  expect(view.getByText(group.name)).toBeTruthy();
  expect(view.container.querySelector(".org-manager-panel--detail")).toBeNull();
  expect(view.queryByLabelText(ORG_MANAGER_LABELS.userId)).toBeNull();
  expect(view.queryByLabelText(ORG_MANAGER_LABELS.groupName)).toBeNull();

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
  expect(view.queryByLabelText(ORG_MANAGER_LABELS.groupName)).toBeNull();

  fireEvent.click(view.getByRole("button", { name: ORG_MANAGER_LABELS.back }));
  expect(selections).toEqual([null]);
});

test("org manager groups view submits the new group dialog", () => {
  let createCount = 0;
  const drafts: string[] = [];
  const view = renderGroupsView({
    canCreateGroup: true,
    createGroup: () => {
      createCount += 1;
    },
    groupNameDraft: "Operators",
    isCreateGroupDialogOpen: true,
    selectedGroup: null,
    selectedGroupId: null,
    setGroupNameDraft: (groupName) => drafts.push(groupName),
  });

  expect(
    view.getByRole("dialog", { name: ORG_MANAGER_LABELS.newGroupAction }),
  ).toBeTruthy();
  fireEvent.change(view.getByLabelText(ORG_MANAGER_LABELS.groupName), {
    target: { value: "Operators East" },
  });
  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.create }),
  );

  expect(drafts).toEqual(["Operators East"]);
  expect(createCount).toBe(1);
});

test("org manager groups view shows creation errors inside the dialog", () => {
  const view = renderGroupsView({
    canCreateGroup: true,
    error: "Failed to create group.",
    groupNameDraft: "Operators",
    isCreateGroupDialogOpen: true,
    selectedGroup: null,
    selectedGroupId: null,
  });
  const dialog = view.getByRole("dialog", {
    name: ORG_MANAGER_LABELS.newGroupAction,
  });

  expect(view.getByLabelText(ORG_MANAGER_LABELS.groupName)).toBeTruthy();
  expect(within(dialog).getByText("Failed to create group.")).toBeTruthy();
});
