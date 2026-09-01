import { afterEach, expect, test } from "bun:test";
import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "../labels";
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
  organizationId: "organization-1",
};

test("group detail separates members, policy history, and links into tabs", () => {
  const view = render(
    <GroupDetailSection
      addUser={() => undefined}
      addUserId=""
      addUserListId="add-user-list"
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
  expect(view.queryByLabelText(ORG_MANAGER_LABELS.userId)).toBeNull();

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
