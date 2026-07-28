import { afterEach, expect, test } from "bun:test";
import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
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

test("group detail separates details from policy history with tabs", () => {
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
      groups={[group]}
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
  const detailsTab = view.getByRole("tab", {
    name: ORG_MANAGER_LABELS.groupDetailsTab,
  });
  const policyHistoryTab = view.getByRole("tab", {
    name: ORG_MANAGER_LABELS.policyHistory,
  });

  expect(
    view.getByRole("tablist", {
      name: ORG_MANAGER_LABELS.groupDetailTabsLabel,
    }),
  ).toBeTruthy();
  expect(detailsTab.getAttribute("aria-selected")).toBe("true");
  expect(view.getByText(ORG_MANAGER_LABELS.members)).toBeTruthy();
  expect(
    view.queryByText(ORG_MANAGER_LABELS.policyHistoryUnavailable),
  ).toBeNull();

  fireEvent.click(policyHistoryTab);

  expect(policyHistoryTab.getAttribute("aria-selected")).toBe("true");
  expect(
    view.getByText(ORG_MANAGER_LABELS.policyHistoryUnavailable),
  ).toBeTruthy();
  expect(view.queryByText(ORG_MANAGER_LABELS.members)).toBeNull();
  expect(view.queryByLabelText(ORG_MANAGER_LABELS.userId)).toBeNull();
});
