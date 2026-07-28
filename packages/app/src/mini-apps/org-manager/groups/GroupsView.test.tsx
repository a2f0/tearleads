import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationDirectory,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { ROUTED_TABLET_QUERY } from "../../../navigation/breakpoints";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { compactFingerprint } from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
import { GroupsView } from "./GroupsView";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-navigation-mode");
  globalThis.localStorage.clear();
  window.matchMedia = originalMatchMedia;
});

function usePhoneLayout() {
  window.matchMedia = ((query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => true,
    matches: query !== ROUTED_TABLET_QUERY,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  document.documentElement.setAttribute("data-navigation-mode", "routed");
}

const group: OrganizationGroupSummary = {
  createdAt: "2026-05-20T12:00:00.000Z",
  currentState: {
    keyEpoch: 2,
    keyFingerprint: "group-key-fingerprint",
    memberCount: 1,
    stateHash: "group-state-hash",
    version: 3,
  },
  groupId: "550e8400-e29b-41d4-a716-446655440010",
  isBuiltin: true,
  name: "Admins",
  organizationId: "organization-1",
};

const customGroup: OrganizationGroupSummary = {
  ...group,
  groupId: "550e8400-e29b-41d4-a716-446655440011",
  isBuiltin: false,
  name: "Operators",
};
const rosterUser = {
  createdAt: "2026-05-20T12:00:00.000Z",
  disabledAt: null,
  disabledByUserId: null,
  encapsulationKeyFingerprint: "encapsulation-fingerprint",
  encapsulationPublicKey: "encapsulation-public-key",
  isSelf: false,
  joinedAt: "2026-05-20T12:00:00.000Z",
  profileDocumentId: "550e8400-e29b-41d4-a716-446655440001",
  signingKeyFingerprint: "signing-fingerprint",
  signingPublicKey: "signing-public-key",
  status: "active",
  updatedAt: "2026-05-20T12:00:00.000Z",
  userId: "550e8400-e29b-41d4-a716-446655440000",
} satisfies OrganizationDirectory["users"][number];
const directory: OrganizationDirectory = {
  currentUser: { isOrgAdmin: true },
  organizationId: "organization-1",
  profileDocumentId: null,
  users: [rosterUser],
};
const groupPolicyHistory: OrganizationGroupPolicyHistory = {
  entries: [
    {
      changes: [
        {
          changeType: "added",
          memberPrincipalId: rosterUser.userId,
          memberPrincipalType: "user",
          nextRole: "member",
          previousRole: null,
        },
      ],
      createdAt: "2026-05-20T12:00:00.000Z",
      keyEpoch: 1,
      memberCount: 1,
      signedAt: "2026-05-20T12:00:00.000Z",
      signerUserId: rosterUser.userId,
      signerUserKeyFingerprint: "signing-fingerprint",
      stateHash: "policy-state-hash",
      version: 1,
    },
  ],
  groupId: group.groupId,
  organizationId: directory.organizationId,
  principalId: group.groupId,
  principalType: "group",
};

const groupMembers: OrganizationGroupMembers = {
  groupId: group.groupId,
  members: [
    {
      encapsulationKeyFingerprint: null,
      encapsulationPublicKey: null,
      groupId: null,
      groupName: null,
      memberPrincipalId: rosterUser.userId,
      memberPrincipalType: "user",
      role: "member",
      signingKeyFingerprint: null,
      signingPublicKey: null,
      userId: rosterUser.userId,
    },
  ],
  organizationId: "organization-1",
};

function renderGroupsView(input: {
  canDeleteGroup?: ((group: OrganizationGroupSummary) => boolean) | undefined;
  canCreateGroup?: boolean | undefined;
  closeCreateGroupDialog?: (() => void) | undefined;
  createGroup?: (() => void) | undefined;
  deleteGroup?: ((groupId: string) => void) | undefined;
  directory?: OrganizationDirectory | null | undefined;
  error?: string | null | undefined;
  groupNameDraft?: string | undefined;
  groupPolicyHistory?: OrganizationGroupPolicyHistory | null | undefined;
  groups?: ReadonlyArray<OrganizationGroupSummary> | undefined;
  isCreateGroupDialogOpen?: boolean | undefined;
  members?: OrganizationGroupMembers | null | undefined;
  openCreateGroupDialog?: (() => void) | undefined;
  openRosterUser?: ((userId: string) => void) | undefined;
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
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
      canDeleteGroup={input.canDeleteGroup ?? ((group) => !group.isBuiltin)}
      canMutateSelectedGroup={false}
      closeCreateGroupDialog={input.closeCreateGroupDialog ?? (() => undefined)}
      createGroup={input.createGroup ?? (() => undefined)}
      deleteGroup={input.deleteGroup ?? (() => undefined)}
      directory={input.directory ?? null}
      groupContainers={null}
      groupNameDraft={input.groupNameDraft ?? ""}
      groupPolicyHistory={input.groupPolicyHistory ?? null}
      groups={input.groups ?? [group]}
      error={input.error ?? null}
      isCreateGroupDialogOpen={input.isCreateGroupDialogOpen ?? false}
      members={input.members ?? null}
      memberUserIds={new Set<string>()}
      mutating={false}
      pending={false}
      openCreateGroupDialog={input.openCreateGroupDialog ?? (() => undefined)}
      openRosterUser={input.openRosterUser ?? (() => undefined)}
      profileDisplayNamesByUserId={input.profileDisplayNamesByUserId}
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
  expect(view.getByText(group.name).getAttribute("title")).toBe(group.groupId);
  expect(view.queryByText(compactFingerprint(group.groupId))).toBeNull();
  expect(view.getByText(ORG_MANAGER_LABELS.builtIn)).toBeTruthy();
  expect(view.container.querySelector(".org-manager-panel--detail")).toBeNull();
  expect(view.queryByLabelText(ORG_MANAGER_LABELS.userId)).toBeNull();
  expect(view.queryByLabelText(ORG_MANAGER_LABELS.groupName)).toBeNull();

  fireEvent.click(view.getByText(group.name));
  expect(selections).toEqual([group.groupId]);
});

test("org manager group policy history uses roster display names", () => {
  const displayLabel = `Countess (${compactFingerprint(rosterUser.userId)})`;
  const view = renderGroupsView({
    directory,
    groupPolicyHistory,
    profileDisplayNamesByUserId: new Map([[rosterUser.userId, "Countess"]]),
    selectedGroup: group,
    selectedGroupId: group.groupId,
  });
  fireEvent.click(view.getByRole("tab", { name: /Policy history/ }));
  expect(view.getByText(displayLabel)).toBeTruthy();
  expect(
    view.getByText((content) => content.includes(`signed by ${displayLabel}`)),
  ).toBeTruthy();
});

test("org manager groups view renders group detail without an inline back button", () => {
  // The detail "Back" affordance lives in the shared toolbar (registered by
  // OrgManagerRoutedChrome), not inline in GroupDetailSection.
  const view = renderGroupsView({
    selectedGroup: group,
    selectedGroupId: group.groupId,
  });

  expect(view.getByText(ORG_MANAGER_LABELS.members)).toBeTruthy();
  expect(view.queryByLabelText(ORG_MANAGER_LABELS.groupName)).toBeNull();
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.back }),
  ).toBeNull();
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

test("org manager groups view disables delete for built-in groups", () => {
  const view = renderGroupsView({
    selectedGroup: null,
    selectedGroupId: null,
  });

  fireEvent.contextMenu(view.getByText(group.name));

  expect(
    (
      view.getByRole("button", {
        name: ORG_MANAGER_LABELS.deleteGroupAction,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test("org manager groups view deletes custom groups from the context menu", () => {
  const deletedGroupIds: string[] = [];
  const view = renderGroupsView({
    deleteGroup: (groupId) => deletedGroupIds.push(groupId),
    groups: [customGroup],
    selectedGroup: null,
    selectedGroupId: null,
  });

  fireEvent.contextMenu(view.getByText(customGroup.name));
  fireEvent.click(
    view.getByRole("button", {
      name: ORG_MANAGER_LABELS.deleteGroupAction,
    }),
  );

  expect(deletedGroupIds).toEqual([customGroup.groupId]);
});

test("org manager groups view opens new group from the groups area context menu", () => {
  let openCreateGroupDialogCount = 0;
  const view = renderGroupsView({
    canCreateGroup: true,
    groups: [],
    openCreateGroupDialog: () => {
      openCreateGroupDialogCount += 1;
    },
    selectedGroup: null,
    selectedGroupId: null,
  });

  fireEvent.contextMenu(view.getByText(ORG_MANAGER_LABELS.noGroups));
  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.newGroupAction }),
  );

  expect(openCreateGroupDialogCount).toBe(1);
});

test("org manager groups view opens new group from whitespace below groups", () => {
  let openCreateGroupDialogCount = 0;
  const view = renderGroupsView({
    canCreateGroup: true,
    groups: [customGroup],
    openCreateGroupDialog: () => {
      openCreateGroupDialogCount += 1;
    },
    selectedGroup: null,
    selectedGroupId: null,
  });
  const groupListSection = view.getByRole("region", {
    name: ORG_MANAGER_LABELS.groups,
  });

  expect(
    groupListSection.classList.contains("org-manager-panel--context-target"),
  ).toBe(true);
  fireEvent.contextMenu(groupListSection);

  expect(
    view.queryByRole("button", {
      name: ORG_MANAGER_LABELS.deleteGroupAction,
    }),
  ).toBeNull();
  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.newGroupAction }),
  );

  expect(openCreateGroupDialogCount).toBe(1);
});

test("org manager groups view exposes new group from group row context menus", () => {
  let openCreateGroupDialogCount = 0;
  const view = renderGroupsView({
    canCreateGroup: true,
    groups: [customGroup],
    openCreateGroupDialog: () => {
      openCreateGroupDialogCount += 1;
    },
    selectedGroup: null,
    selectedGroupId: null,
  });

  fireEvent.contextMenu(view.getByText(customGroup.name));
  expect(
    (
      view.getByRole("button", {
        name: ORG_MANAGER_LABELS.deleteGroupAction,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.newGroupAction }),
  );

  expect(openCreateGroupDialogCount).toBe(1);
});

test("org manager groups view shows a touch kebab that opens the group menu", () => {
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  const deletedGroupIds: string[] = [];
  const view = renderGroupsView({
    deleteGroup: (groupId) => deletedGroupIds.push(groupId),
    groups: [customGroup],
    selectedGroup: null,
    selectedGroupId: null,
  });

  fireEvent.click(
    view.getByRole("button", {
      name: `${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${customGroup.name}`,
    }),
  );
  fireEvent.click(
    view.getByRole("button", {
      name: ORG_MANAGER_LABELS.deleteGroupAction,
    }),
  );

  expect(deletedGroupIds).toEqual([customGroup.groupId]);
});

test("org manager groups view uses two-line summaries on phone layouts", () => {
  usePhoneLayout();
  const view = renderGroupsView({
    selectedGroup: null,
    selectedGroupId: null,
  });
  const table = view.getByRole("table", { name: ORG_MANAGER_LABELS.groups });
  const summaries = table.querySelectorAll<HTMLElement>(
    ".mini-app-compact-table-lines",
  );

  expect(summaries).toHaveLength(2);
  const headerSummary = summaries.item(0);
  const headerLines = headerSummary.querySelectorAll<HTMLElement>(
    ".mini-app-compact-table-line",
  );
  expect(headerLines).toHaveLength(2);
  expect(
    within(headerLines.item(0)).getByText(ORG_MANAGER_LABELS.group),
  ).toBeTruthy();
  expect(
    within(headerLines.item(1)).getByText(ORG_MANAGER_LABELS.members),
  ).toBeTruthy();
  expect(
    within(headerLines.item(1)).getByText(ORG_MANAGER_LABELS.status),
  ).toBeTruthy();
  expect(
    within(headerLines.item(1)).getByText(ORG_MANAGER_LABELS.created),
  ).toBeTruthy();

  const rowSummary = summaries.item(1);
  const rowLines = rowSummary.querySelectorAll<HTMLElement>(
    ".mini-app-compact-table-line",
  );
  expect(rowLines).toHaveLength(2);
  expect(
    within(rowLines.item(0)).getByText(group.name).getAttribute("title"),
  ).toBe(group.groupId);
  expect(within(rowLines.item(1)).getByText("1 member")).toBeTruthy();
  expect(
    within(rowLines.item(1)).getByText(ORG_MANAGER_LABELS.builtIn),
  ).toBeTruthy();
  expect(
    within(rowLines.item(1))
      .getByText(formatMiniAppDate(group.createdAt))
      .getAttribute("title"),
  ).toBe(group.createdAt);
  view.getByRole("button", { name: ORG_MANAGER_LABELS.columns });
  view.getByRole("button", {
    name: `${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${group.name}`,
  });

  const frame = table.closest<HTMLElement>(".mini-app-table-frame");
  expect(frame?.classList.contains("mini-app-table-frame--two-line")).toBe(
    true,
  );
  expect(frame?.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "56px",
  );
});

test("org manager groups view opens roster detail from a group member", () => {
  const openedUserIds: string[] = [];
  const view = renderGroupsView({
    members: groupMembers,
    openRosterUser: (userId) => openedUserIds.push(userId),
    selectedGroup: group,
    selectedGroupId: group.groupId,
  });

  fireEvent.click(
    view.getByRole("button", {
      name: new RegExp(compactFingerprint(rosterUser.userId)),
    }),
  );

  expect(openedUserIds).toEqual([rosterUser.userId]);
});
