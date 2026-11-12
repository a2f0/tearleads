import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationDirectoryUser,
  OrganizationGroupSummary,
} from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { useState } from "react";
import {
  groupDisplayName,
  groupSignedName,
  ORG_MANAGER_LABELS,
} from "../labels";
import { GroupDetailSection } from "./GroupDetailSection";

afterEach(cleanup);

const group: OrganizationGroupSummary = {
  createdAt: "2026-05-20T12:00:00.000Z",
  currentState: {
    keyEpoch: 2,
    keyFingerprint: "group-key-fingerprint",
    memberCount: 0,
    stateHash: "group-state-hash",
    version: 3,
  },
  groupId: "550e8400-e29b-41d4-a716-446655440010",
  isBuiltin: true,
  name: "Admins",
  nameUnreadable: false,
  organizationId: "organization-1",
};

const owner: OrganizationDirectoryUser = {
  userId: "owner",
  isPersonalOrganizationOwner: true,
  isSelf: false,
  status: "active",
  createdAt: group.createdAt,
  joinedAt: group.createdAt,
  leaveRequest: null,
  updatedAt: group.createdAt,
  profileDocumentId: null,
  disabledAt: null,
  disabledByUserId: null,
  signingKeyFingerprint: "signing-fingerprint",
  signingPublicKey: "signing-key",
  encapsulationKeyFingerprint: "kem-fingerprint",
  encapsulationPublicKey: "kem-key",
};

const memberControlProps = {
  addUser: () => undefined,
  addUserId: "",
  addableUsers: [],
  canMutateSelectedGroup: true,
  directory: {
    organizationId: group.organizationId,
    currentUser: { isOrgAdmin: true },
    profileDocumentId: null,
    users: [owner],
  },
  groupContainers: null,
  groupPolicyHistory: null,
  members: {
    groupId: group.groupId,
    organizationId: group.organizationId,
    members: ["owner", "peer"].map((userId) => ({
      signingKeyFingerprint: owner.signingKeyFingerprint,
      signingPublicKey: owner.signingPublicKey,
      encapsulationKeyFingerprint: owner.encapsulationKeyFingerprint,
      encapsulationPublicKey: owner.encapsulationPublicKey,
      userId,
      role: "admin" as const,
    })),
  },
  memberUserIds: new Set(["owner", "peer"]),
  mutating: false,
  pending: false,
  openGroupContextMenu: () => undefined,
  openRosterUser: () => undefined,
  removeMember: () => undefined,
  selectedGroup: group,
  setAddUserId: () => undefined,
  userId: "peer",
};

test("member controls hide for non-admins and protect owner and self in built-in groups", () => {
  const props = memberControlProps;
  const enabledRemoveButtons = () =>
    view
      .getAllByRole("button", { name: ORG_MANAGER_LABELS.remove })
      .filter((button) => !button.hasAttribute("disabled"));
  const view = render(<GroupDetailSection {...props} />);
  expect(
    view
      .getByTitle(ORG_MANAGER_LABELS.personalOrganizationOwnerProtection)
      .hasAttribute("disabled"),
  ).toBe(true);
  // Built-in: neither the owner nor the signed-in user can be removed here.
  expect(enabledRemoveButtons()).toHaveLength(0);
  view.rerender(
    <GroupDetailSection
      {...props}
      selectedGroup={{ ...group, isBuiltin: false, name: "Operators" }}
    />,
  );
  // Regular group: both rows, including the signed-in user, are removable.
  expect(enabledRemoveButtons()).toHaveLength(2);
  view.rerender(<GroupDetailSection {...props} mutating />);
  const add = view.getByRole("button", { name: ORG_MANAGER_LABELS.add });
  expect(add.hasAttribute("disabled")).toBe(true);
  expect(add.querySelector(".mini-app-button-spinner")).toBeNull();
  // Without organization admin authority the membership controls are hidden,
  // not disabled, while the member list stays readable.
  for (const selectedGroup of [group, { ...group, isBuiltin: false }]) {
    view.rerender(
      <GroupDetailSection
        {...props}
        canMutateSelectedGroup={false}
        selectedGroup={selectedGroup}
      />,
    );
    expect(
      view.queryAllByRole("button", { name: ORG_MANAGER_LABELS.remove }),
    ).toHaveLength(0);
    expect(
      view.queryByRole("button", { name: ORG_MANAGER_LABELS.add }),
    ).toBeNull();
    expect(view.queryByLabelText(ORG_MANAGER_LABELS.rosterIdentity)).toBeNull();
    expect(view.getByTitle("owner")).toBeTruthy();
    expect(view.getByTitle("peer")).toBeTruthy();
  }
});

test("the roster picker leads with names and distinguishes duplicate names by ID", () => {
  const picked: string[] = [];
  const users = ["first-roster-user-000001", "second-roster-user-000002"].map(
    (userId) => ({ ...owner, userId }),
  );
  const props = {
    ...memberControlProps,
    addableUsers: users,
    profileDisplayNamesByUserId: new Map(
      users.map((user) => [user.userId, "Alex Smith"]),
    ),
    setAddUserId: (userId: string) => picked.push(userId),
  };
  const view = render(<GroupDetailSection {...props} />);
  const picker = view.getByRole("combobox", { name: "Roster user" });
  fireEvent.click(picker);
  const options = view.getAllByRole("option");
  expect(
    options.map(
      (option) =>
        option.querySelector(".mini-app-select-menu-label")?.textContent,
    ),
  ).toEqual(["Alex Smith", "Alex Smith"]);
  expect(
    options.map(
      (option) =>
        option.querySelector(".mini-app-select-menu-option-secondary")
          ?.textContent,
    ),
  ).toEqual(["first-rost...000001", "second-ros...000002"]);
  fireEvent.click(options[1] as HTMLElement);
  expect(picked).toEqual(["second-roster-user-000002"]);
  view.rerender(
    <GroupDetailSection {...props} addUserId="second-roster-user-000002" />,
  );
  expect(picker.textContent).toBe("Alex Smith");
  expect(view.queryAllByRole("option")).toHaveLength(0);
});

test("the roster picker falls back to IDs and keeps identity-link entry available", async () => {
  const added: string[] = [];
  const userId = "unnamed-roster-user-000003";
  function Harness({ mutating = false }: { mutating?: boolean }) {
    const [value, setValue] = useState("");
    return (
      <GroupDetailSection
        {...memberControlProps}
        addableUsers={[{ ...owner, userId }]}
        addUser={() => {
          added.push(value);
          setValue("");
        }}
        addUserId={value}
        mutating={mutating}
        setAddUserId={setValue}
      />
    );
  }
  const view = render(<Harness />);
  const picker = view.getByRole("combobox", { name: "Roster user" });
  const input = view.getByRole("textbox", {
    name: ORG_MANAGER_LABELS.rosterIdentity,
  }) as HTMLInputElement;
  const add = view.getByRole("button", { name: ORG_MANAGER_LABELS.add });
  expect(add.hasAttribute("disabled")).toBe(true);
  fireEvent.click(picker);
  const option = view.getByRole("option", { name: "unnamed-ro...000003" });
  expect(
    option.querySelector(".mini-app-select-menu-option-secondary") === null,
  ).toBe(true);
  fireEvent.keyDown(picker, { key: "Enter" });
  expect(picker.textContent).toBe("unnamed-ro...000003");
  expect(input.value).toBe("");
  expect(add.hasAttribute("disabled")).toBe(false);
  await act(async () => fireEvent.click(add));
  expect(added).toEqual([userId]);
  expect(add.hasAttribute("disabled")).toBe(true);

  fireEvent.change(input, { target: { value: "tearleads://identity/test" } });
  expect(picker.textContent).toBe("Select a roster user");
  view.rerender(<Harness mutating />);
  expect(picker.hasAttribute("disabled")).toBe(true);
  expect(input.disabled).toBe(true);
  expect(add.hasAttribute("disabled")).toBe(true);
  view.rerender(<Harness />);
  await act(async () => fireEvent.click(add));
  expect(added).toEqual([userId, "tearleads://identity/test"]);

  fireEvent.change(input, { target: { value: "tearleads://identity/other" } });
  fireEvent.click(picker);
  fireEvent.click(view.getByRole("option", { name: "unnamed-ro...000003" }));
  expect(input.value).toBe("");
  await act(async () => fireEvent.click(add));
  expect(added).toEqual([userId, "tearleads://identity/test", userId]);
});

test("removing a member spins only that member's Remove until it settles", async () => {
  const removal = Promise.withResolvers<void>();
  const removedUserIds: string[] = [];
  const view = render(
    <GroupDetailSection
      {...memberControlProps}
      removeMember={(removedUserId) => {
        removedUserIds.push(removedUserId);
        return removal.promise;
      }}
      selectedGroup={{ ...group, isBuiltin: false, name: "Operators" }}
    />,
  );
  const removeButtonFor = (userId: string) =>
    within(
      view.getByTitle(userId).closest(".org-manager-member-row") as HTMLElement,
    ).getByRole("button", { name: ORG_MANAGER_LABELS.remove });

  fireEvent.click(removeButtonFor("owner"));

  expect(removedUserIds).toEqual(["owner"]);
  expect(
    removeButtonFor("owner").querySelector(".mini-app-button-spinner"),
  ).not.toBeNull();
  expect(removeButtonFor("owner").getAttribute("aria-busy")).toBe("true");
  expect(
    removeButtonFor("peer").querySelector(".mini-app-button-spinner"),
  ).toBeNull();
  expect(
    view
      .getByRole("button", { name: ORG_MANAGER_LABELS.add })
      .querySelector(".mini-app-button-spinner"),
  ).toBeNull();

  await act(async () => {
    removal.resolve();
    await removal.promise;
  });

  expect(
    removeButtonFor("owner").querySelector(".mini-app-button-spinner"),
  ).toBeNull();
});

test("a group whose signed name does not open shows a placeholder", () => {
  const view = render(
    <GroupDetailSection
      addUser={() => undefined}
      addUserId=""
      addableUsers={[]}
      canMutateSelectedGroup={false}
      directory={null}
      groupContainers={null}
      groupPolicyHistory={null}
      members={null}
      memberUserIds={new Set()}
      mutating={false}
      openGroupContextMenu={() => undefined}
      openRosterUser={() => undefined}
      pending={false}
      removeMember={() => undefined}
      selectedGroup={{ ...group, name: "", nameUnreadable: true }}
      setAddUserId={() => undefined}
      userId="user-1"
    />,
  );
  expect(view.getByText(ORG_MANAGER_LABELS.unreadableGroupName)).toBeTruthy();
});

test("only a readable signed name can select a group by name", () => {
  expect(groupSignedName({ name: "Operators", nameUnreadable: false })).toBe(
    "Operators",
  );
  // Not hydrated yet, unreadable, or gone: membership changes refuse to run.
  expect(groupSignedName({ name: "", nameUnreadable: false })).toBeNull();
  expect(groupSignedName({ name: "", nameUnreadable: true })).toBeNull();
  expect(groupSignedName(undefined)).toBeNull();
  expect(groupDisplayName({ name: "", nameUnreadable: false })).toBe(
    ORG_MANAGER_LABELS.unreadableGroupName,
  );
});

test("group detail separates members, policy history, and links into tabs", () => {
  const view = render(
    <GroupDetailSection
      addUser={() => undefined}
      addUserId=""
      addableUsers={[]}
      canMutateSelectedGroup={false}
      directory={null}
      groupContainers={null}
      groupPolicyHistory={null}
      members={null}
      memberUserIds={new Set()}
      mutating={false}
      openGroupContextMenu={() => undefined}
      openRosterUser={() => undefined}
      pending={false}
      removeMember={() => undefined}
      selectedGroup={group}
      setAddUserId={() => undefined}
      userId="user-1"
    />,
  );
  const membersTab = view.getByRole("tab", {
    name: ORG_MANAGER_LABELS.members,
  });
  const policyHistoryTab = view.getByRole("tab", {
    name: ORG_MANAGER_LABELS.policyHistory,
  });
  const linksTab = view.getByRole("tab", {
    name: ORG_MANAGER_LABELS.groupLinksTab,
  });

  expect(
    view.getByRole("tablist", {
      name: ORG_MANAGER_LABELS.groupDetailTabsLabel,
    }),
  ).toBeTruthy();
  expect(view.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    ORG_MANAGER_LABELS.members,
    ORG_MANAGER_LABELS.policyHistory,
    ORG_MANAGER_LABELS.groupLinksTab,
  ]);
  expect(membersTab.getAttribute("aria-selected")).toBe("true");
  expect(
    within(view.getByRole("tabpanel")).getByText(ORG_MANAGER_LABELS.members),
  ).toBeTruthy();
  expect(
    within(view.getByRole("tabpanel")).queryByText(
      ORG_MANAGER_LABELS.directContainerLinks,
    ),
  ).toBeNull();
  expect(
    view.queryByText(ORG_MANAGER_LABELS.policyHistoryUnavailable),
  ).toBeNull();

  fireEvent.click(policyHistoryTab);

  expect(policyHistoryTab.getAttribute("aria-selected")).toBe("true");
  expect(
    view.getByText(ORG_MANAGER_LABELS.policyHistoryUnavailable),
  ).toBeTruthy();
  expect(
    within(view.getByRole("tabpanel")).queryByText(ORG_MANAGER_LABELS.members),
  ).toBeNull();
  expect(view.queryByLabelText(ORG_MANAGER_LABELS.rosterIdentity)).toBeNull();

  fireEvent.click(linksTab);

  expect(linksTab.getAttribute("aria-selected")).toBe("true");
  expect(view.getByText(ORG_MANAGER_LABELS.directContainerLinks)).toBeTruthy();
  expect(
    within(view.getByRole("tabpanel")).queryByText(ORG_MANAGER_LABELS.members),
  ).toBeNull();
  expect(
    view.queryByText(ORG_MANAGER_LABELS.policyHistoryUnavailable),
  ).toBeNull();
});
