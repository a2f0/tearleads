import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import {
  getPaneUserId,
  interact,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { renderSeededDemo } from "../../../../test/helpers/dual-pane/dualPaneMiniAppKit";
import {
  addPeerToAdminsGroup,
  openOrgManager,
} from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { ORG_MANAGER_LABELS } from "../../../mini-apps/org-manager/labels";

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

test("Peer 2 cannot remove Peer 1 from the personal org after becoming an admin", async () => {
  useTestApiAppHandlers();
  const { leftPane, rightPane, leftRuntime, rightRuntime } =
    await renderSeededDemo();
  const ownerId = getPaneUserId(leftPane);
  await addPeerToAdminsGroup(leftPane, getPaneUserId(rightPane));
  const organizationId = leftRuntime.session.organizationId;
  invariant(organizationId, "Expected Peer 1 organization.");
  await interact(() => rightRuntime.session.setOrganizationId(organizationId));
  const before = await rightRuntime.organizations.loadDirectoryAndGroups();
  invariant(before, "Expected Peer 2 to load Peer 1's org.");
  expect(before.directory.currentUser.isOrgAdmin).toBe(true);
  expect(before.directory.users).toContainEqual(
    expect.objectContaining({
      userId: ownerId,
      isSelf: false,
      isPersonalOrganizationOwner: true,
      status: "active",
    }),
  );
  const admins = before.groups.find((group) => group.isBuiltin);
  invariant(admins, "Expected Admins group.");

  await openOrgManager(rightPane);
  await interact(() =>
    fireEvent.click(within(rightPane).getByRole("button", { name: "Groups" })),
  );
  await interact(() => fireEvent.click(within(rightPane).getByText("Admins")));
  await waitFor(() => {
    const ownerRemove = within(rightPane).getByTitle(
      ORG_MANAGER_LABELS.personalOrganizationOwnerProtection,
    );
    expect(ownerRemove.hasAttribute("disabled")).toBe(true);
  });

  // Bypass the UI and send the fully signed group + org successors produced
  // by the real SDK, including container rekeying for the shrinking Admins set.
  const requestStart = listProxiedApiRequests().length;
  await act(async () => {
    await expect(
      rightRuntime.organizations.removeUserFromGroup({
        groupId: admins.groupId,
        expectedGroupName: "Admins",
        removedUserId: ownerId,
      }),
    ).rejects.toThrow("Group policy update failed");
  });
  const rejectedCommit = listProxiedApiRequests()
    .slice(requestStart)
    .find((request) => request.url.endsWith("/policy-commit"));
  expect(rejectedCommit?.status).toBe(409);
  expect(JSON.parse(rejectedCommit?.responseBody ?? "null")).toEqual({
    error: "Personal organization owner must remain an active member and admin",
  });
  const after = await rightRuntime.organizations.loadDirectoryAndGroups();
  expect(after?.directory).toEqual(before.directory);
  expect(after?.groups).toEqual(before.groups);
}, 60_000);

test("a custom org still allows another admin to remove its creator from Admins", async () => {
  useTestApiAppHandlers();
  const { leftPane, rightPane, leftRuntime, rightRuntime } =
    await renderSeededDemo();
  const creatorId = getPaneUserId(leftPane);
  const personalOrganizationId = leftRuntime.session.organizationId;
  const custom = await act(() =>
    leftRuntime.session.createOrganization({
      organizationProfileName: "Shared organization",
    }),
  );
  invariant(custom, "Expected custom organization.");
  await interact(() => leftRuntime.session.setContext(custom));
  const { organizationId } = custom;
  expect(organizationId).not.toBe(personalOrganizationId);
  const billing = await act(() => leftRuntime.organizations.startTrial());
  expect(billing?.status).toBe("trialing");
  const creatorDirectory =
    await leftRuntime.organizations.loadDirectoryAndGroups();
  const adminGroup = creatorDirectory?.groups.find((group) => group.isBuiltin);
  invariant(
    creatorDirectory && adminGroup,
    "Expected custom organization groups.",
  );
  for (const [groupId, expectedGroupName] of [
    [creatorDirectory.memberGroupId, "Members"],
    [adminGroup.groupId, "Admins"],
  ] as const) {
    await act(() =>
      leftRuntime.organizations.addUserToGroup({
        groupId,
        expectedGroupName,
        targetUserId: getPaneUserId(rightPane),
      }),
    );
  }
  await interact(() => rightRuntime.session.setOrganizationId(organizationId));
  const before = await rightRuntime.organizations.loadDirectoryAndGroups();
  invariant(before, "Expected custom organization directory.");
  expect(
    before.directory.users.every((user) => !user.isPersonalOrganizationOwner),
  ).toBe(true);
  const admins = before.groups.find((group) => group.isBuiltin);
  invariant(admins, "Expected custom organization Admins.");
  await act(async () => {
    await rightRuntime.organizations.removeUserFromGroup({
      groupId: admins.groupId,
      expectedGroupName: "Admins",
      removedUserId: creatorId,
    });
  });
  const remaining = await rightRuntime.organizations.loadGroupMembers(
    admins.groupId,
  );
  expect(remaining?.members.map((member) => member.userId)).toEqual([
    getPaneUserId(rightPane),
  ]);
  const after = await rightRuntime.organizations.loadDirectoryAndGroups();
  expect(after?.directory.users).toContainEqual(
    expect.objectContaining({
      userId: creatorId,
      status: "active",
      isPersonalOrganizationOwner: false,
    }),
  );
}, 60_000);
